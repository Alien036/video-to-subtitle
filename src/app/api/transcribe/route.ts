import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import {
  applyDeterministicTurkishFixes,
  ensureCounselingSpeakerLabel,
  refineSegmentsWithLLM,
} from "@/utils/turkishRefiner";

export const maxDuration = 60;

export interface WhisperSegment {
  id: number;
  seek?: number;
  start: number;
  end: number;
  text: string;
  tokens?: number[];
  temperature?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  no_speech_prob?: number;
}

export interface VerboseTranscriptionResponse {
  task?: string;
  language?: string;
  duration?: number;
  text: string;
  segments?: WhisperSegment[];
}

// Round-Robin sayacı (aynı sunucu örneği içinde yükü eşit dağıtmak için)
let roundRobinCounter = Math.floor(Math.random() * 1000);

const COUNSELING_TERMS_PROMPT =
  "Danışman, danışan, süpervizörüm, YKS dönemi, sınav dönemi, balık etli, yurt, kütüphane";

const GEMINI_MODELS = [
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-pro-latest",
];

const HALLUCINATION_PATTERNS: RegExp[] = [
  /altyazı\s*m\.?\s*k\.?/i,
  /altyazi\s*m\.?\s*k\.?/i,
  /abone\s+olmayı\s+unutma/i,
  /kanala\s+abone\s+ol/i,
  /\babone\s+olun\b/i,
  /\babonem\s+yok\b/i,
  /izlediğiniz\s+için\s+teşekkür/i,
  /dinlediğiniz\s+için\s+teşekkür/i,
  /beğenmeyi\s+ve\s+abone/i,
  /videoyu\s+beğenmeyi/i,
  /bir\s+sonraki\s+videoda\s+görüşmek/i,
  /^altyazı\s*:?\s*$/i,
  /^çeviri\s*:?\s*$/i,
  /amara\.org/i,
  /subtitles?\s+by/i,
  /^iyi\s+seyirler\.?$/i,
  /müzik\s+dinle/i,
  /müzik\s+çal/i,
  /^müzik\.?$/i,
  /şarkı\s+söz/i,
  /^enstrümantal\.?$/i,
];

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

export function normalizeForComparison(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[.,!?;:…"''"()[\]\-_♪♫\s]+/g, " ")
    .trim();
}

export function collapseRepeatedPhrases(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const sentences = trimmed
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const uniqueConsecutiveSentences: string[] = [];
  let lastNorm = "";

  for (const sentence of sentences) {
    const norm = normalizeForComparison(sentence);
    if (!norm) continue;
    if (norm === lastNorm && norm.split(" ").length > 3) {
      continue;
    }
    uniqueConsecutiveSentences.push(sentence);
    lastNorm = norm;
  }

  let result = uniqueConsecutiveSentences.join(" ").trim();

  result = result.replace(
    /\b((?:\S+\s+){2,7}\S+)(?:[,;\s]+\1\b)+/gi,
    "$1"
  );

  return result.trim();
}

/**
 * Kısık sesleri silen no_speech_prob ve avg_logprob filtreleri KESİNLİKLE kullanılmaz!
 * Sadece boş metinler ve sahte YouTube altyazı reklam halüsinasyonları filtrelenir.
 */
export function isHallucinatedSegment(
  seg: {
    text?: string;
  },
  segmentIndex = 0
): boolean {
  const rawText = (seg.text ?? "").trim();
  if (!rawText) {
    return true;
  }

  if (/^[\s.…♪♫♬♩\-_*,!?;:()[\]"']+$/u.test(rawText)) {
    return true;
  }

  const lower = rawText.toLocaleLowerCase("tr").trim();
  const normalized = lower
    .replace(/^[.…\s,-]+|[.…\s!-]+$/g, "")
    .trim();

  if (!normalized || normalized.length < 1) {
    return true;
  }

  if (
    lower.includes("izlediğiniz için") ||
    lower.includes("dinlediğiniz için") ||
    lower.includes("abone ol") ||
    lower.includes("abonem") ||
    lower.includes("altyazı m.k") ||
    lower.includes("altyazi m.k") ||
    lower.includes("noktalama işaretleri") ||
    lower.includes("müzik dinleyin") ||
    lower.includes("müzik çalıyor") ||
    lower.includes("şarkı sözleri") ||
    lower.includes("amara.org") ||
    lower.includes("subtitles by")
  ) {
    return true;
  }

  if (
    segmentIndex === 0 &&
    (normalized === "altyazı" || normalized === "çeviri")
  ) {
    return true;
  }

  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

function getGeminiApiKeysPool(): string[] {
  return (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function getGroqApiKeysPool(): string[] {
  return (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  if (err instanceof Error) {
    if (err.message.includes("429") || /rate limit/i.test(err.message)) {
      return 429;
    }
    if (err.message.includes("401")) return 401;
    if (err.message.includes("403")) return 403;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseGeminiDialogueLines(rawOutput: string): Array<{
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
    const contentRaw = (match[2] || "").trim();
    if (!contentRaw) continue;

    const cleaned = applyDeterministicTurkishFixes(contentRaw);
    if (!cleaned || isHallucinatedSegment({ text: cleaned }, i)) {
      continue;
    }

    const startSec = tsStr ? parseTimestampToSeconds(tsStr) : i * 5;
    const labeledText = ensureCounselingSpeakerLabel(cleaned, parsed.length);

    parsed.push({
      id: parsed.length + 1,
      start: startSec,
      end: startSec + 5,
      text: labeledText,
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
    const groqKeys = getGroqApiKeysPool();

    if (geminiKeys.length === 0 && groqKeys.length === 0) {
      return NextResponse.json(
        {
          error:
            "Sunucu yapılandırma hatası: GEMINI_API_KEYS veya GROQ_API_KEYS ortam değişkeni tanımlanmamış.",
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
    const fileName = uploadedFile.name || "chunk.mp3";
    const fileType = uploadedFile.type || "audio/mp3";
    const currentCounter = roundRobinCounter++;

    // 1. ÖNCE GEMINI MODELLERİNİ DENE (gemini-2.5-flash -> gemini-2.0-flash)
    if (geminiKeys.length > 0) {
      const base64Audio = Buffer.from(fileArrayBuffer).toString("base64");
      const geminiStartIndex = currentCounter % geminiKeys.length;

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
                        text: `Bu Türkçe psikolojik danışmanlık görüşmesi ses kaydını hiçbir kısık sesi veya cümleyi atlamadan (sıfır veri kaybıyla) deşifre et.
Psikolojik danışmanlık terimlerine dikkat et: "${COUNSELING_TERMS_PROMPT}".
${previousContext ? `Önceki parçanın son cümlesi (bağlam): "${previousContext}"` : ""}
Çıktıyı KESİNLİKLE şu formatta, her konuşma yeni satırda (\\n\\n) olacak şekilde üret:
[DD:SS] **Danışman:** ...

[DD:SS] **Danışan:** ...`,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.1,
                },
              }),
            });

            if (!geminiResponse.ok) {
              const errText = await geminiResponse.text();
              console.warn(
                `[/api/transcribe] Gemini (${geminiModel}) Key #${keyIndex + 1} yetki/API hatası (${geminiResponse.status}): ${errText.slice(0, 160)}`
              );
              continue;
            }

            const geminiData = await geminiResponse.json();
            const rawText: string =
              geminiData?.candidates?.[0]?.content?.parts
                ?.map((p: { text?: string }) => p.text || "")
                .join("\n")
                .trim() || "";

            const parsedSegments = parseGeminiDialogueLines(rawText);
            if (parsedSegments.length > 0) {
              const formattedText = parsedSegments
                .map((s) => `[${formatMMSS(s.start)}] ${s.text}`)
                .join("\n\n");

              return NextResponse.json({
                segments: parsedSegments,
                text: formattedText,
                llmApplied: true,
                modelUsed: geminiModel,
                firstLine: parsedSegments[0]?.text || "",
                language,
                duration: 240,
              });
            }
          } catch (geminiErr: unknown) {
            console.warn(
              `[/api/transcribe] Gemini (${geminiModel}) Key #${keyIndex + 1} bağlantı uyarısı:`,
              geminiErr
            );
          }
        }
      }

      console.warn(
        "[/api/transcribe] Gemini modelleri (gemini-flash-latest / gemini-3.8-flash / gemini-pro-latest) yetki hatası verdi. Otomatik olarak GROQ_API_KEYS (whisper-large-v3 + openai/gpt-oss-120b) yedek (fallback) sistemi devreye sokuluyor..."
      );
    }

    // 2. KESİN YEDEK (FALLBACK): GROQ_API_KEYS (whisper-large-v3 + openai/gpt-oss-120b)
    if (groqKeys.length === 0) {
      return NextResponse.json(
        {
          error:
            "Gemini API yetki hatası verdi ve yedek GROQ_API_KEYS tanımlanmamış.",
        },
        { status: 500 }
      );
    }

    const startIndex = currentCounter % groqKeys.length;
    let lastError: unknown = null;
    const maxPoolPasses = 2;

    const whisperPrompt = previousContext
      ? `${COUNSELING_TERMS_PROMPT}. ${previousContext}`.slice(-800)
      : COUNSELING_TERMS_PROMPT;

    for (let pass = 0; pass < maxPoolPasses; pass++) {
      if (pass > 0) {
        console.warn(
          `[/api/transcribe] Havuzdaki tüm Groq API anahtarları meşgul/limitli. 3 saniye beklenip 2. tur deneniyor...`
        );
        await sleep(3000);
      }

      for (let offset = 0; offset < groqKeys.length; offset++) {
        const keyIndex = (startIndex + offset) % groqKeys.length;
        const activeApiKey = groqKeys[keyIndex];

        try {
          const groq = new Groq({ apiKey: activeApiKey });
          const audioFile = new File([fileArrayBuffer], fileName, {
            type: fileType,
          });

          const transcription = (await groq.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-large-v3",
            language: language === "auto" ? undefined : language || "tr",
            response_format: "verbose_json",
            temperature: 0,
            prompt: whisperPrompt,
          })) as unknown as VerboseTranscriptionResponse;

          const filteredSegments: Array<{
            id: number;
            start: number;
            end: number;
            text: string;
          }> = [];
          let lastSegmentNorm = "";

          if (Array.isArray(transcription.segments)) {
            for (let idx = 0; idx < transcription.segments.length; idx++) {
              const seg = transcription.segments[idx];
              const withoutPromptLeak = applyDeterministicTurkishFixes(
                seg.text ?? ""
              );
              const cleanedText = collapseRepeatedPhrases(withoutPromptLeak);
              if (!cleanedText) continue;

              // Kısık sesleri silen no_speech_prob ve avg_logprob filtreleri KESİNLİKLE kullanılmaz!
              if (isHallucinatedSegment({ text: cleanedText }, idx)) {
                continue;
              }

              const currentNorm = normalizeForComparison(cleanedText);
              if (
                !currentNorm ||
                (currentNorm === lastSegmentNorm &&
                  currentNorm.split(" ").length > 4)
              ) {
                continue;
              }

              lastSegmentNorm = currentNorm;
              filteredSegments.push({
                id: seg.id ?? idx,
                start: Number(seg.start) || 0,
                end: Number(seg.end) || 0,
                text: cleanedText,
              });
            }
          }

          // openai/gpt-oss-120b ile psikolojik danışmanlık redaksiyonu ve **Danışman:** / **Danışan:** konuşmacı ayrımı
          const refineResult = await refineSegmentsWithLLM(
            filteredSegments,
            groqKeys,
            keyIndex
          );

          // Çıktıyı [DD:SS] **Danışman:** ... / [DD:SS] **Danışan:** ... formatında, her konuşma yeni satırda (\n\n) olacak şekilde oluştur
          const formattedDialogueText = refineResult.segments
            .map((s) => {
              const mmss = formatMMSS(s.start);
              const cleanLine = s.text
                .trim()
                .replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "");
              return `[${mmss}] ${cleanLine}`;
            })
            .join("\n\n");

          return NextResponse.json({
            segments: refineResult.segments,
            text: formattedDialogueText,
            llmApplied: true,
            modelUsed: refineResult.modelUsed || "openai/gpt-oss-120b",
            firstLine: refineResult.firstLine,
            language: transcription.language ?? language,
            duration: Number(transcription.duration) || 0,
          });
        } catch (err: unknown) {
          lastError = err;
          const status = getErrorStatus(err);

          console.warn(
            `[/api/transcribe] Groq Key #${keyIndex + 1}/${groqKeys.length} hata verdi (Status: ${status ?? "unknown"}). Sıradaki anahtara geçiliyor...`
          );

          if (status === 400) {
            break;
          }
          continue;
        }
      }
    }

    console.error(
      "[/api/transcribe] Tüm API anahtarları denendi ancak işlem başarısız oldu:",
      lastError
    );

    const status = getErrorStatus(lastError) || 500;
    const message =
      lastError instanceof Error
        ? lastError.message
        : "API yoğunluğu nedeniyle ses dosyası şu anda işlenemedi.";

    return NextResponse.json({ error: message }, { status });
  } catch (error: unknown) {
    console.error("[/api/transcribe] Beklenmeyen Sunucu Hatası:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Ses dosyası metne dönüştürülürken beklenmeyen bir hata oluştu.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
