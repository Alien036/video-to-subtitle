import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

let roundRobinCounter = Math.floor(Math.random() * 1000);

const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-flash-latest"];

function formatMMSS(seconds: number): string {
  const safeSec =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseTimestampToSeconds(ts: string): number {
  const parts = ts.split(":").map((n) => parseInt(n, 10) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

function cleanMusicSegmentText(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  text = text
    .replace(/izmir'?den\s+feruk\s+otk[aâ]r/gi, "İzmir, Ben Fero, Khontkar")
    .replace(/istemedim\s+pis\s+gösterecek/gi, "İstemem pis gözleri çek")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

function getGeminiApiKeysPool(): string[] {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function parseGeminiLyricsOutput(rawOutput: string): Array<{
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
            const cleaned = cleanMusicSegmentText(match?.[2] || item);
            if (!cleaned) continue;
            const startSec = tsStr ? parseTimestampToSeconds(tsStr) : i * 4;
            parsed.push({
              id: parsed.length + 1,
              start: startSec,
              end: startSec + 4,
              text: cleaned,
            });
          } else if (item && typeof item === "object") {
            const rawText = cleanMusicSegmentText(
              String(item.text ?? item.content ?? item.line ?? "")
            );
            if (!rawText) continue;
            const startVal =
              typeof item.start === "number"
                ? item.start
                : typeof item.timestamp === "string"
                ? parseTimestampToSeconds(item.timestamp.replace(/[\[\]]/g, ""))
                : typeof item.time === "string"
                ? parseTimestampToSeconds(item.time.replace(/[\[\]]/g, ""))
                : i * 4;
            const endVal =
              typeof item.end === "number" && item.end > startVal
                ? item.end
                : startVal + 4;
            parsed.push({
              id: parsed.length + 1,
              start: startVal,
              end: endVal,
              text: rawText,
            });
          }
        }
      }
    } catch {
      // Satır bazlı ayrıştırmaya devam et
    }
  }

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
      const contentRaw = cleanMusicSegmentText(match[2] || "");
      if (!contentRaw) continue;

      const startSec = tsStr ? parseTimestampToSeconds(tsStr) : i * 4;
      parsed.push({
        id: parsed.length + 1,
        start: startSec,
        end: startSec + 4,
        text: contentRaw,
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

    const promptText = `Bu müzik/şarkı kaydının sözlerini (lyrics) nakarat tekrarlarını, kafiyeleri ve vokal satırlarını hiç silmeden zaman damgalı olarak çıkar.
${previousContext ? `Önceki parçanın son satırı: "${previousContext}"` : ""}
Çıktıyı her satır yeni satırda (\\n\\n) olacak şekilde şu formatta ver:
[DD:SS] şarkı sözü satırı`;

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
              console.error(
                "[/api/transcribe-music] Gemini API Hatası:",
                detail
              );
              errorDetails.push(detail);
              continue;
            }

            const geminiData = JSON.parse(rawResponseBody);
            const rawText: string =
              geminiData?.candidates?.[0]?.content?.parts
                ?.map((p: { text?: string }) => p.text || "")
                .join("\n")
                .trim() || "";

            const parsedSegments = parseGeminiLyricsOutput(rawText);
            if (parsedSegments.length > 0) {
              const formattedLyrics = parsedSegments
                .map((s) => `[${formatMMSS(s.start)}] ${s.text}`)
                .join("\n\n");

              return NextResponse.json({
                segments: parsedSegments,
                text: formattedLyrics,
                llmApplied: true,
                modelUsed: model,
                language,
                duration: 240,
              });
            } else {
              const emptyDetail = `[${ep.name} | Model: ${model} | Key #${keyIndex + 1}] Gemini boş veya ayrıştırılamayan yanıt döndürdü: ${rawResponseBody}`;
              console.error("[/api/transcribe-music]", emptyDetail);
              errorDetails.push(emptyDetail);
            }
          } catch (geminiErr: unknown) {
            const errMsg =
              geminiErr instanceof Error
                ? `${geminiErr.name}: ${geminiErr.message}`
                : String(geminiErr);
            const detail = `[${ep.name} | Model: ${model} | Key #${keyIndex + 1}] İstek Hatası: ${errMsg}`;
            console.error(
              "[/api/transcribe-music] Gemini İstisna Hatası:",
              detail
            );
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
      "[/api/transcribe-music] Tüm Gemini denemeleri başarısız oldu:\n",
      fullErrorReport
    );

    return NextResponse.json(
      {
        error: fullErrorReport,
      },
      { status: lastStatus }
    );
  } catch (error: unknown) {
    console.error("[/api/transcribe-music] Beklenmeyen Sunucu Hatası:", error);
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
