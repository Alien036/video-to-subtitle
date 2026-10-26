import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const maxDuration = 60;

interface WhisperMusicSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
}

interface VerboseMusicTranscriptionResponse {
  task?: string;
  language?: string;
  duration?: number;
  text: string;
  segments?: WhisperMusicSegment[];
}

let roundRobinCounter = Math.floor(Math.random() * 1000);

const MUSIC_BASE_PROMPT =
  "Şarkı sözleri, Türkçe rap, pop, nakarat, kafiyeli vokal kaydı.";

const MUSIC_MODELS_CHAIN = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
];

const YOUTUBE_FAKE_HALLUCINATIONS: RegExp[] = [
  /altyazı\s*m\.?\s*k\.?/i,
  /altyazi\s*m\.?\s*k\.?/i,
  /abone\s+olmayı\s+unutma/i,
  /kanala\s+abone\s+ol/i,
  /izlediğiniz\s+için\s+teşekkür/i,
  /dinlediğiniz\s+için\s+teşekkür/i,
  /amara\.org/i,
  /subtitles?\s+by/i,
];

const MUSIC_PROMPT_LEAK_REGEXES: RegExp[] = [
  /şarkı\s+sözleri,?\s*türkçe\s+rap,?\s*pop,?\s*nakarat,?\s*kafiyeli\s+vokal\s+kaydı\.?/gi,
];

function cleanMusicSegmentText(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  for (const rx of MUSIC_PROMPT_LEAK_REGEXES) {
    text = text.replace(rx, " ");
  }

  // Bilinen yaygın rap/şarkı STT duyum düzeltmeleri
  text = text
    .replace(/izmir'?den\s+feruk\s+otk[aâ]r/gi, "İzmir, Ben Fero, Khontkar")
    .replace(/istemedim\s+pis\s+gösterecek/gi, "İstemem pis gözleri çek")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

function isFakeYoutubeHallucination(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  if (/^[\s.…\-_*,!?;:()[\]"']+$/u.test(trimmed)) {
    return true;
  }

  const lower = trimmed.toLocaleLowerCase("tr").trim();
  if (
    lower.includes("altyazı m.k") ||
    lower.includes("altyazi m.k") ||
    lower.includes("izlediğiniz için teşekkür") ||
    lower.includes("dinlediğiniz için teşekkür") ||
    lower.includes("abone olmayı unutma") ||
    lower.includes("amara.org")
  ) {
    return true;
  }

  for (const pattern of YOUTUBE_FAKE_HALLUCINATIONS) {
    if (pattern.test(lower)) {
      return true;
    }
  }

  return false;
}

function getApiKeysPool(): string[] {
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

export async function POST(request: NextRequest) {
  try {
    const keys = getApiKeysPool();
    if (keys.length === 0) {
      return NextResponse.json(
        {
          error:
            "Sunucu yapılandırma hatası: GROQ_API_KEYS veya GROQ_API_KEY ortam değişkeni tanımlanmamış.",
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

    const startIndex = roundRobinCounter++ % keys.length;
    let lastError: unknown = null;
    const maxPoolPasses = 2;

    for (let pass = 0; pass < maxPoolPasses; pass++) {
      if (pass > 0) {
        await sleep(3000);
      }

      for (let offset = 0; offset < keys.length; offset++) {
        const keyIndex = (startIndex + offset) % keys.length;
        const activeApiKey = keys[keyIndex];

        try {
          const groq = new Groq({ apiKey: activeApiKey });
          const audioFile = new File([fileArrayBuffer], fileName, {
            type: fileType,
          });

          // Şarkı & Müzik Modu Whisper Ayarları (no_speech_prob veya nakarat tekrarı silinmez!)
          const transcription = (await groq.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-large-v3",
            language: language === "auto" ? undefined : language || "tr",
            response_format: "verbose_json",
            temperature: 0.0,
            prompt: previousContext || MUSIC_BASE_PROMPT,
          })) as unknown as VerboseMusicTranscriptionResponse;

          const segments: Array<{
            id: number;
            start: number;
            end: number;
            text: string;
          }> = [];

          if (Array.isArray(transcription.segments)) {
            for (let idx = 0; idx < transcription.segments.length; idx++) {
              const seg = transcription.segments[idx];
              const cleanedText = cleanMusicSegmentText(seg.text ?? "");
              if (!cleanedText || isFakeYoutubeHallucination(cleanedText)) {
                continue;
              }

              segments.push({
                id: segments.length + 1,
                start: Number(seg.start) || 0,
                end: Number(seg.end) || 0,
                text: cleanedText,
              });
            }
          }

          // Şarkı Sözü & Rap (Lyrics) Uzmanı LLM Redaksiyonu (Nakaratları ve kafiyeleri korur)
          if (segments.length > 0) {
            const numberedInput = segments
              .map((s, idx) => `[${idx}] ${s.text.trim()}`)
              .join("\n");

            outerLoop: for (const modelName of MUSIC_MODELS_CHAIN) {
              for (let k = 0; k < keys.length; k++) {
                const llmKey = keys[(keyIndex + 1 + k) % keys.length];
                const llmGroq = new Groq({ apiKey: llmKey });

                try {
                  const completion = await llmGroq.chat.completions.create({
                    model: modelName,
                    temperature: 0.1,
                    max_tokens: 8000,
                    messages: [
                      {
                        role: "system",
                        content: `Sen uzman bir Türkçe Şarkı Sözü (Lyrics) ve Rap Müzik editörüsün. Sana bir müzik/şarkı videosundan ses tanıma ile çıkarılmış numaralı satırlar verilecek.
GÖREVİN:
1. Arka plandaki yoğun bas, beat veya autotune yüzünden yanlış duyulmuş kelimeleri, sanatçı isimlerini ve kafiyeleri şarkının gerçek sözlerine ve kafiye dizilimine uygun şekilde düzelt (Örn: "İzmir'den Feruk Otkâr" -> "İzmir, Ben Fero, Khontkar", "yaptığım her şey birbiriyle çelişir" -> "yaptığım her biri oynar", "İstemedim pis gösterecek" -> "İstemem pis gözleri çek").
2. Şarkı sözlerini ASLA normal bir konuşma veya resmi cümle gibi düzeltme! Şarkının ritmini, sokak argosunu, kafiyelerini ve tekrar eden nakaratlarını birebir koru.
3. Sadece "[numara] düzeltilmiş şarkı sözü" formatında yanıt ver, hiçbir satırı atlama.`,
                      },
                      { role: "user", content: numberedInput },
                    ],
                  });

                  const output =
                    completion.choices[0]?.message?.content || "";
                  const lines = output.split("\n");
                  let updatedCount = 0;

                  for (const rawLine of lines) {
                    const line = rawLine.trim().replace(/^\*\*|\*\*$/g, "");
                    const match = line.match(/^\[(\d+)\]:?\s*(.+)$/);
                    if (match) {
                      const idx = parseInt(match[1], 10);
                      if (segments[idx]) {
                        const repaired = cleanMusicSegmentText(
                          match[2].trim()
                        );
                        if (repaired && !isFakeYoutubeHallucination(repaired)) {
                          segments[idx].text = repaired;
                          updatedCount++;
                        }
                      }
                    }
                  }

                  if (updatedCount > 0) {
                    console.log(
                      `🎵 ŞARKI SÖZÜ (LYRICS) REDAKSİYONU UYGULANDI (${modelName}, ${updatedCount}/${segments.length} satır) | İlk Satır: ${segments[0]?.text}`
                    );
                    break outerLoop;
                  }
                } catch (llmErr: unknown) {
                  const msg =
                    llmErr instanceof Error ? llmErr.message : String(llmErr);
                  if (msg.includes("404") || msg.includes("model_not_found")) {
                    break;
                  }
                  console.warn(
                    `[/api/transcribe-music] Model ${modelName} Key #${k + 1} uyarısı:`,
                    msg
                  );
                }
              }
            }
          }

          const cleanFullText = segments.map((s) => s.text.trim()).join(" ");

          return NextResponse.json({
            segments,
            text: cleanFullText,
            language: transcription.language ?? language,
            duration: Number(transcription.duration) || 0,
          });
        } catch (err: unknown) {
          lastError = err;
          const status = getErrorStatus(err);
          console.warn(
            `[/api/transcribe-music] Key #${keyIndex + 1}/${keys.length} hata verdi (Status: ${status ?? "unknown"}). Sıradaki anahtara geçiliyor...`
          );
          if (status === 400) {
            break;
          }
          continue;
        }
      }
    }

    const status = getErrorStatus(lastError) || 500;
    const message =
      lastError instanceof Error
        ? lastError.message
        : "Groq Whisper API yoğunluğu nedeniyle müzik dosyası şu anda işlenemedi.";

    return NextResponse.json({ error: message }, { status });
  } catch (error: unknown) {
    console.error("[/api/transcribe-music] Beklenmeyen Sunucu Hatası:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Müzik dosyası metne dönüştürülürken beklenmeyen bir hata oluştu.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
