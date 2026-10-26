import { NextRequest, NextResponse } from "next/server";
import {
  applyDeterministicTurkishFixes,
  ensureCounselingSpeakerLabel,
} from "@/utils/turkishRefiner";

export const maxDuration = 60;

// Round-Robin sayacı (aynı sunucu örneği içinde yükü eşit dağıtmak için)
let roundRobinCounter = Math.floor(Math.random() * 1000);

const COUNSELING_TERMS_PROMPT =
  "Danışman, danışan, süpervizörüm, YKS dönemi, sınav dönemi, balık etli, yurt, kütüphane";

const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-flash-latest"];

export function formatMMSS(seconds: number): string {
  const safeSec =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function parseTimestampToSeconds(ts: string): number {
  const parts = ts.split(":").map((n) => parseInt(n, 10) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function getGeminiApiKeysPool(): string[] {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function parseGeminiDialogueOutput(rawOutput: string): Array<{
  id: number;
  start: number;
  end: number;
  text: string;
}> {
  const trimmed = (rawOutput || "").trim();
  if (!trimmed) return [];

  const parsed: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }> = [];

  // 1. Eğer JSON formatında döndüyse (Array veya { segments: [...] }) parse et
  const cleanedJsonCandidate = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (
    cleanedJsonCandidate.startsWith("[") ||
    cleanedJsonCandidate.startsWith("{")
  ) {
    try {
      const jsonObj = JSON.parse(cleanedJsonCandidate);
      const list = Array.isArray(jsonObj)
        ? jsonObj
        : Array.isArray(jsonObj?.segments)
        ? jsonObj.segments
        : Array.isArray(jsonObj?.lines)
        ? jsonObj.lines
        : null;

      if (Array.isArray(list)) {
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          if (typeof item === "string") {
            const match = item
              .trim()
              .match(/^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(.*)$/);
            const tsStr = match?.[1];
            const rawLine = (match?.[2] || item).trim();
            const cleaned = applyDeterministicTurkishFixes(rawLine);
            if (!cleaned) continue;
            const startSec = tsStr ? parseTimestampToSeconds(tsStr) : i * 5;
            parsed.push({
              id: parsed.length + 1,
              start: startSec,
              end: startSec + 5,
              text: ensureCounselingSpeakerLabel(cleaned, parsed.length),
            });
          } else if (item && typeof item === "object") {
            const rawText = String(
              item.text ?? item.content ?? item.line ?? ""
            ).trim();
            if (!rawText) continue;
            const speakerRaw = String(item.speaker ?? item.role ?? "").trim();
            const combined = speakerRaw
              ? `**${speakerRaw.replace(/[:*]/g, "").trim()}:** ${rawText}`
              : rawText;
            const cleaned = applyDeterministicTurkishFixes(combined);
            if (!cleaned) continue;

            const startVal =
              typeof item.start === "number"
                ? item.start
                : typeof item.timestamp === "string"
                ? parseTimestampToSeconds(item.timestamp.replace(/[\[\]]/g, ""))
                : typeof item.time === "string"
                ? parseTimestampToSeconds(item.time.replace(/[\[\]]/g, ""))
                : i * 5;
            const endVal =
              typeof item.end === "number" && item.end > startVal
                ? item.end
                : startVal + 5;

            parsed.push({
              id: parsed.length + 1,
              start: startVal,
              end: endVal,
              text: ensureCounselingSpeakerLabel(cleaned, parsed.length),
            });
          }
        }
      }
    } catch {
      // JSON değilse aşağıdaki satır bazlı ayrıştırıcıya devam et
    }
  }

  // 2. Düz metin ([DD:SS] **Danışman:** ...) olarak döndüyse satır satır ayrıştır
  if (parsed.length === 0) {
    const lines = trimmed
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/\s*```$/i, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(
        /^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?(.*)$/
      );
      if (!match) continue;

      const tsStr = match[1];
      const contentRaw = (match[2] || "").trim();
      if (!contentRaw) continue;

      const cleaned = applyDeterministicTurkishFixes(contentRaw);
      if (!cleaned) continue;

      const startSec = tsStr ? parseTimestampToSeconds(tsStr) : i * 5;
      const labeledText = ensureCounselingSpeakerLabel(cleaned, parsed.length);

      parsed.push({
        id: parsed.length + 1,
        start: startSec,
        end: startSec + 5,
        text: labeledText,
      });
    }
  }

  for (let i = 0; i < parsed.length - 1; i++) {
    if (parsed[i + 1].start > parsed[i].start) {
      parsed[i].end = parsed[i + 1].start;
    }
  }

  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const geminiKeys = getGeminiApiKeysPool();

    if (geminiKeys.length === 0) {
      return NextResponse.json(
        {
          error:
            "Sunucu yapılandırma hatası: GEMINI_API_KEYS ortam değişkeni tanımlanmamış.",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const uploadedFile = formData.get("file");
    const languageInput = formData.get("language");
    const previousContextInput = formData.get("previousContext");
    const language =
      typeof languageInput === "string" && languageInput.trim().length > 0
        ? languageInput.trim()
        : "tr";
    const previousContext =
      typeof previousContextInput === "string" &&
      previousContextInput.trim().length > 0
        ? previousContextInput.trim()
        : "";

    if (!uploadedFile || !(uploadedFile instanceof File)) {
      return NextResponse.json(
        { error: "Geçerli bir ses dosyası ('file') gönderilmedi." },
        { status: 400 }
      );
    }

    const fileArrayBuffer = await uploadedFile.arrayBuffer();
    const fileType = uploadedFile.type || "audio/mp3";
    const base64Audio = Buffer.from(fileArrayBuffer).toString("base64");

    const currentCounter = roundRobinCounter++;
    const geminiStartIndex = currentCounter % geminiKeys.length;
    const errorDetails: string[] = [];
    let lastStatus = 500;

    const promptText = `Bu Türkçe psikolojik danışmanlık görüşmesi ses kaydını hiçbir kısık sesi veya cümleyi atlamadan (sıfır veri kaybıyla) deşifre et.
Psikolojik danışmanlık terimlerine dikkat et: "${COUNSELING_TERMS_PROMPT}".
${previousContext ? `Önceki parçanın son cümlesi (bağlam): "${previousContext}"` : ""}
Çıktıyı KESİNLİKLE şu formatta, her konuşma yeni satırda (\\n\\n) olacak şekilde üret:
[DD:SS] **Danışman:** ...

[DD:SS] **Danışan:** ...`;

    for (const model of GEMINI_MODELS) {
      for (let offset = 0; offset < geminiKeys.length; offset++) {
        const keyIndex = (geminiStartIndex + offset) % geminiKeys.length;
        const apiKey = geminiKeys[keyIndex];

        const endpoints = [
          {
            name: "GoogleAI (generativelanguage)",
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          },
          {
            name: "VertexAI (aiplatform)",
            url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${apiKey}`,
          },
        ];

        for (const ep of endpoints) {
          try {
            const geminiResponse = await fetch(ep.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify({
                contents: [
                  {
                    role: "user",
                    parts: [
                      {
                        inlineData: {
                          mimeType: fileType,
                          data: base64Audio,
                        },
                      },
                      {
                        text: promptText,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.1,
                },
              }),
            });

            const rawResponseBody = await geminiResponse.text();

            if (!geminiResponse.ok) {
              lastStatus = geminiResponse.status;
              const detail = `[${ep.name} | Model: ${model} | Key #${keyIndex + 1} | HTTP ${geminiResponse.status}] Google Yanıtı: ${rawResponseBody}`;
              console.error("[/api/transcribe] Gemini API Hatası:", detail);
              errorDetails.push(detail);
              continue;
            }

            const geminiData = JSON.parse(rawResponseBody);
            const rawText: string =
              geminiData?.candidates?.[0]?.content?.parts
                ?.map((p: { text?: string }) => p.text || "")
                .join("\n")
                .trim() || "";

            const parsedSegments = parseGeminiDialogueOutput(rawText);
            if (parsedSegments.length > 0) {
              const formattedText = parsedSegments
                .map((s) => `[${formatMMSS(s.start)}] ${s.text}`)
                .join("\n\n");

              return NextResponse.json({
                segments: parsedSegments,
                text: formattedText,
                llmApplied: true,
                modelUsed: model,
                firstLine: parsedSegments[0]?.text || "",
                language,
                duration: 240,
              });
            } else {
              const emptyDetail = `[${ep.name} | Model: ${model} | Key #${keyIndex + 1}] Gemini boş veya ayrıştırılamayan yanıt döndürdü: ${rawResponseBody}`;
              console.error("[/api/transcribe]", emptyDetail);
              errorDetails.push(emptyDetail);
            }
          } catch (geminiErr: unknown) {
            const errMsg =
              geminiErr instanceof Error
                ? `${geminiErr.name}: ${geminiErr.message}`
                : String(geminiErr);
            const detail = `[${ep.name} | Model: ${model} | Key #${keyIndex + 1}] İstek Hatası: ${errMsg}`;
            console.error("[/api/transcribe] Gemini İstisna Hatası:", detail);
            errorDetails.push(detail);
          }
        }
      }
    }

    const fullErrorReport =
      errorDetails.length > 0
        ? errorDetails.join("\n\n")
        : "Gemini API'den geçerli bir yanıt alınamadı.";

    console.error(
      "[/api/transcribe] Tüm Gemini denemeleri başarısız oldu:\n",
      fullErrorReport
    );

    return NextResponse.json(
      {
        error: fullErrorReport,
      },
      { status: lastStatus }
    );
  } catch (error: unknown) {
    console.error("[/api/transcribe] Beklenmeyen Sunucu Hatası:", error);
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
