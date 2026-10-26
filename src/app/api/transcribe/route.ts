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

const basePrompt =
  "Merhaba, hoş geldiniz. Nasılsınız, görüşmeler nasıl gidiyor? Kendinizden ve yaşadığınız duygulardan biraz bahseder misiniz?";

const PROMPT_LEAK_REGEXES: RegExp[] = [
  /merhaba,?\s*hoş\s*geldiniz\.?/gi,
  /nasılsınız,?\s*görüşmeler\s*nasıl\s*gidiyor\??/gi,
  /kendinizden\s+ve\s+yaşadığınız\s+duygulardan\s+biraz\s+bahseder\s+misiniz\??/gi,
  /noktalama\s+işaretleri(ne)?(\s+ve\s+türkçe\s+imla\s+kurallarına(\s+dikkat\s+et|\s+uygun\s+metin))?\.?/gi,
  /doğal\s+türkçe\s+konuşma\s+ve\s+seans\s+kaydı\.?/gi,
  /bu\s+bir\s+türkçe\s+konuşma\s+kaydıdır\.?/gi,
];

export function stripPromptLeakage(text: string): string {
  let cleaned = text;
  for (const rx of PROMPT_LEAK_REGEXES) {
    cleaned = cleaned.replace(rx, " ");
  }
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

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
  /^teşekkürler\.?$/i,
  /^teşekkür\s+ederim\.?$/i,
  /^iyi\s+seyirler\.?$/i,
];

export function normalizeForComparison(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/[.,!?;:…"''"()[\]\-_♪♫\s]+/g, " ")
    .trim();
}

/**
 * Segment içindeki ardışık tekrar eden cümleleri ve kelime öbeklerini tekilleştirir
 * (Örn: "Dediğin gibi, deli bir şey var." x6 -> tek cümle)
 */
export function collapseRepeatedPhrases(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  // 1. Cümle bazında ardışık tekrarları temizle
  const sentences = trimmed
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const uniqueConsecutiveSentences: string[] = [];
  let lastNorm = "";

  for (const sentence of sentences) {
    const norm = normalizeForComparison(sentence);
    if (!norm) continue;
    if (norm === lastNorm) {
      continue;
    }
    uniqueConsecutiveSentences.push(sentence);
    lastNorm = norm;
  }

  let result = uniqueConsecutiveSentences.join(" ").trim();

  // 2. Virgül veya boşlukla ayrılmış ardışık aynı ifadeleri (3+ kelimelik) tekilleştir
  result = result.replace(
    /\b((?:\S+\s+){2,7}\S+)(?:[,;\s]+\1\b)+/gi,
    "$1"
  );

  return result.trim();
}

export function isHallucinatedSegment(
  seg: {
    text?: string;
    no_speech_prob?: number;
    avg_logprob?: number;
    compression_ratio?: number;
  },
  segmentIndex = 0
): boolean {
  // 1. Sessizlik olasılığı yüksekse filtrele
  if (typeof seg.no_speech_prob === "number" && seg.no_speech_prob > 0.5) {
    return true;
  }

  // 2. Sessizlik ihtimali orta düzeyde olup modelin kelime güveni (avg_logprob) çok düşükse filtrele
  if (
    typeof seg.no_speech_prob === "number" &&
    seg.no_speech_prob > 0.35 &&
    typeof seg.avg_logprob === "number" &&
    seg.avg_logprob < -0.9
  ) {
    return true;
  }

  // 3. Model tamamen düşük güvenle uyduruyorsa filtrele
  if (typeof seg.avg_logprob === "number" && seg.avg_logprob < -1.35) {
    return true;
  }

  const rawText = (seg.text ?? "").trim();
  if (!rawText) {
    return true;
  }

  // Sadece noktalama işareti, üç nokta veya müzik sembollerinden oluşuyorsa filtrele
  if (/^[\s.…♪♫\-_*,!?;:()[\]"']+$/u.test(rawText)) {
    return true;
  }

  const lower = rawText.toLocaleLowerCase("tr").trim();
  const normalized = lower
    .replace(/^[.…\s,-]+|[.…\s!-]+$/g, "")
    .trim();

  if (!normalized || normalized.length < 2) {
    return true;
  }

  // Türkçe harf duyarlı (toLocaleLowerCase('tr')) kesin halüsinasyon kontrolleri
  if (
    lower.includes("izlediğiniz için") ||
    lower.includes("dinlediğiniz için") ||
    lower.includes("abone ol") ||
    lower.includes("abonem") ||
    lower.includes("altyazı") ||
    lower.includes("altyazi") ||
    lower.includes("noktalama işaretleri") ||
    lower.includes("amara.org") ||
    lower.includes("subtitles by")
  ) {
    return true;
  }

  if (
    segmentIndex < 2 &&
    (lower.includes("teşekkür ederim") || lower.includes("teşekkürler"))
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
          const audioFile = new File([fileArrayBuffer], fileName, {
            type: fileType,
          });

          const transcription = (await groq.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-large-v3",
            language: language === "auto" ? undefined : language || "tr",
            response_format: "verbose_json",
            temperature: 0, // KRİTİK: Modelin kelime uydurmasını ve halüsinasyonu engeller!
            prompt:
              previousContext ||
              basePrompt, // Doğal konuşma bağlamı
          })) as unknown as VerboseTranscriptionResponse;

          const filteredSegments: Array<{
            id: number;
            start: number;
            end: number;
            text: string;
            no_speech_prob: number;
          }> = [];
          let lastSegmentNorm = "";

          if (Array.isArray(transcription.segments)) {
            for (let idx = 0; idx < transcription.segments.length; idx++) {
              const seg = transcription.segments[idx];
              const withoutPromptLeak = stripPromptLeakage(seg.text ?? "");
              const cleanedText = collapseRepeatedPhrases(withoutPromptLeak);
              if (!cleanedText) continue;

              if (
                isHallucinatedSegment(
                  {
                    ...seg,
                    text: cleanedText,
                  },
                  idx
                )
              ) {
                continue;
              }

              // Ardışık kısır döngü (tekrar) filtresi: Bir önceki segmentle birebir aynıysa atla
              const currentNorm = normalizeForComparison(cleanedText);
              if (!currentNorm || currentNorm === lastSegmentNorm) {
                continue;
              }

              lastSegmentNorm = currentNorm;
              filteredSegments.push({
                id: seg.id ?? idx,
                start: Number(seg.start) || 0,
                end: Number(seg.end) || 0,
                text: cleanedText,
                no_speech_prob:
                  typeof seg.no_speech_prob === "number"
                    ? seg.no_speech_prob
                    : 0,
              });
            }
          }

          // 3. Llama-3.3-70B Tamirini 25'erli Gruplar Halinde ve Kesin Çalışacak Şekilde Yap
          const BATCH_SIZE = 25;
          for (let i = 0; i < filteredSegments.length; i += BATCH_SIZE) {
            const batch = filteredSegments.slice(i, i + BATCH_SIZE);
            const numberedLines = batch
              .map((s, idx) => `[${i + idx}] ${s.text.trim()}`)
              .join("\n");
            try {
              const completion = await groq.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                temperature: 0.1,
                max_tokens: 4096,
                messages: [
                  {
                    role: "system",
                    content: `Sen uzman bir Türkçe deşifre redaktörüsün. Aşağıdaki numaralı satırlarda ses boğukluğundan dolayı yarım çıkmış tek harfli kopuklukları (Örn: "hayat bu t a insanlar m Arkada m" -> "hayatında tam insanlar mı, arkadaşların mı", "yedirece i b vicdan k oldu" -> "yedireceği için böyle vicdanım kötü oldu", "yazarken de m olmad da biliyorum do olarak" -> "yazarken de mükemmel olmadığımı da biliyorum doğal olarak") bağlama göre tamir et. Ayrıca sesten yanlış duyulmuş anlamsız kelimeleri ("siz de de ölürsünüz" -> "siz de görürsünüz", "eğri dolar gibi" -> "elimde olan bir şey") psikolojik danışmanlık seansı bağlamına uygun düzelt. Sadece "[numara] düzeltilmiş metin" formatında yanıt ver.`,
                  },
                  { role: "user", content: numberedLines },
                ],
              });
              const lines = (
                completion.choices[0]?.message?.content || ""
              ).split("\n");
              for (const line of lines) {
                const match = line.match(/\[(\d+)\]\s*(.+)/);
                if (match) {
                  const index = parseInt(match[1], 10);
                  if (filteredSegments[index]) {
                    const repaired = stripPromptLeakage(match[2].trim());
                    if (repaired) {
                      filteredSegments[index].text = repaired;
                    }
                  }
                }
              }
            } catch (err) {
              console.error("Llama batch error:", err);
            }
          }

          const cleanFullText = filteredSegments
            .map((s) => s.text.trim())
            .join(" ");

          return NextResponse.json({
            segments: filteredSegments,
            text: cleanFullText,
            language: transcription.language ?? language,
            duration: Number(transcription.duration) || 0,
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
