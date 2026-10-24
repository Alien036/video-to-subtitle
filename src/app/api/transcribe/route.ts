import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

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
    const language =
      typeof languageInput === "string" && languageInput.trim().length > 0
        ? languageInput.trim()
        : "tr";

    if (!uploadedFile || !(uploadedFile instanceof File)) {
      return NextResponse.json(
        { error: "Geçerli bir ses dosyası ('file') gönderilmedi." },
        { status: 400 }
      );
    }

    // Failover denemelerinde dosya akışının (stream) tükenmemesi için belleğe ArrayBuffer olarak al
    const fileArrayBuffer = await uploadedFile.arrayBuffer();
    const fileName = uploadedFile.name || "chunk.mp3";
    const fileType = uploadedFile.type || "audio/mp3";

    const startIndex = roundRobinCounter++ % keys.length;
    let lastError: unknown = null;

    // Havuzu en fazla 2 tam tur dene (1. turda tüm keyler meşgulse 3 sn bekleyip 2. turu dene)
    const maxPoolPasses = 2;

    for (let pass = 0; pass < maxPoolPasses; pass++) {
      if (pass > 0) {
        console.warn(
          `[/api/transcribe] Havuzdaki tüm API anahtarları meşgul/limitli. 3 saniye beklenip 2. tur deneniyor...`
        );
        await sleep(3000);
      }

      for (let offset = 0; offset < keys.length; offset++) {
        const keyIndex = (startIndex + offset) % keys.length;
        const activeApiKey = keys[keyIndex];

        try {
          const groq = new Groq({ apiKey: activeApiKey });
          const retryableFile = new File([fileArrayBuffer], fileName, {
            type: fileType,
          });

          const transcription = (await groq.audio.transcriptions.create({
            file: retryableFile,
            model: "whisper-large-v3-turbo",
            language: language === "auto" ? undefined : language,
            response_format: "verbose_json",
            timestamp_granularities: ["segment"],
            temperature: 0,
          })) as unknown as VerboseTranscriptionResponse;

          return NextResponse.json({
            text: transcription.text ?? "",
            segments: Array.isArray(transcription.segments)
              ? transcription.segments.map((seg, idx) => ({
                  id: seg.id ?? idx,
                  start: Number(seg.start) || 0,
                  end: Number(seg.end) || 0,
                  text: (seg.text ?? "").trim(),
                }))
              : [],
            language: transcription.language ?? language,
            duration: transcription.duration ?? 0,
          });
        } catch (err: unknown) {
          lastError = err;
          const status = getErrorStatus(err);

          console.warn(
            `[/api/transcribe] Key #${keyIndex + 1}/${keys.length} hata verdi (Status: ${status ?? "unknown"}). Sıradaki anahtara geçiliyor...`
          );

          // 400 Bad Request gibi dosya formatı kaynaklı hatalarda diğer anahtarları denemeye gerek yok
          if (status === 400) {
            break;
          }
          // 429 (Rate Limit), 401/403 (Key sorunu) veya 5xx hatalarında havuzdaki bir sonraki anahtara geç
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
        : "Groq Whisper API yoğunluğu nedeniyle ses dosyası şu anda işlenemedi.";

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
