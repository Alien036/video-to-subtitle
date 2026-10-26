import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

let roundRobinCounter = Math.floor(Math.random() * 1000);

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

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

function parseGeminiLyricsLines(rawOutput: string): Array<{
  id: number;
  start: number;
  end: number;
  text: string;
}> {
  const lines = rawOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const parsed: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
  }> = [];

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

    for (const geminiModel of GEMINI_MODELS) {
      for (let offset = 0; offset < geminiKeys.length; offset++) {
        const keyIndex = (geminiStartIndex + offset) % geminiKeys.length;
        const apiKey = geminiKeys[keyIndex];

        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`;
          const geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      inline_data: {
                        mime_type: fileType,
                        data: base64Audio,
                      },
                    },
                    {
                      text: `Bu müzik/şarkı kaydının sözlerini (lyrics) nakarat tekrarlarını, kafiyeleri ve vokal satırlarını hiç silmeden zaman damgalı olarak çıkar.
${previousContext ? `Önceki parçanın son satırı: "${previousContext}"` : ""}
Çıktıyı her satır yeni satırda (\\n\\n) olacak şekilde şu formatta ver:
[DD:SS] şarkı sözü satırı`,
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
            const detail = `[Model: ${geminiModel} | Key #${keyIndex + 1} | HTTP ${geminiResponse.status}] Google Yanıtı: ${rawResponseBody}`;
            console.error("[/api/transcribe-music] Gemini API Hatası:", detail);
            errorDetails.push(detail);
            continue;
          }

          const geminiData = JSON.parse(rawResponseBody);
          const rawText: string =
            geminiData?.candidates?.[0]?.content?.parts
              ?.map((p: { text?: string }) => p.text || "")
              .join("\n")
              .trim() || "";

          const parsedSegments = parseGeminiLyricsLines(rawText);
          if (parsedSegments.length > 0) {
            const formattedLyrics = parsedSegments
              .map((s) => `[${formatMMSS(s.start)}] ${s.text}`)
              .join("\n\n");

            return NextResponse.json({
              segments: parsedSegments,
              text: formattedLyrics,
              llmApplied: true,
              modelUsed: geminiModel,
              language,
              duration: 240,
            });
          } else {
            const emptyDetail = `[Model: ${geminiModel} | Key #${keyIndex + 1}] Gemini boş veya ayrıştırılamayan yanıt döndürdü: ${rawResponseBody}`;
            console.error("[/api/transcribe-music]", emptyDetail);
            errorDetails.push(emptyDetail);
          }
        } catch (geminiErr: unknown) {
          const errMsg =
            geminiErr instanceof Error
              ? `${geminiErr.name}: ${geminiErr.message}`
              : String(geminiErr);
          const detail = `[Model: ${geminiModel} | Key #${keyIndex + 1}] İstek Hatası: ${errMsg}`;
          console.error(
            "[/api/transcribe-music] Gemini İstisna Hatası:",
            detail
          );
          errorDetails.push(detail);
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
