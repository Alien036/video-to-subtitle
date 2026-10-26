import Groq from "groq-sdk";

export interface RefinableSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  no_speech_prob?: number;
}

// Groq üzerinde aktif olan en güçlü çok dilli LLM modelleri (sırasıyla failover yapar)
const ACTIVE_GROQ_LLM_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
];

const PROMPT_LEAK_REGEXES: RegExp[] = [
  /merhaba,?\s*hoş\s*geldiniz\.?/gi,
  /nasılsınız,?\s*görüşmeler\s*nasıl\s*gidiyor\??/gi,
  /kendinizden\s+ve\s+yaşadığınız\s+duygulardan\s+biraz\s+bahseder\s+misiniz\??/gi,
  /noktalama\s+işaretleri(ne)?(\s+ve\s+türkçe\s+imla\s+kurallarına(\s+dikkat\s+et|\s+uygun\s+metin))?\.?/gi,
  /doğal\s+türkçe\s+konuşma\s+ve\s+seans\s+kaydı\.?/gi,
  /bu\s+bir\s+türkçe\s+konuşma\s+kaydıdır\.?/gi,
  /\[?\s*(?:müzik|music|alkış|gülüşmeler|şarkı|enstrümantal)\s*\]?/gi,
  /\(\s*(?:müzik|music|alkış|gülüşmeler|şarkı|enstrümantal)\s*\)/gi,
  /[♪♫♬♩]+/g,
];

export function stripPromptLeakage(text: string): string {
  let cleaned = text;
  for (const rx of PROMPT_LEAK_REGEXES) {
    cleaned = cleaned.replace(rx, " ");
  }
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/**
 * Whisper'ın boğuk Türkçe seans kayıtlarında sık yaptığı hece kopukluklarını
 * ve yanlış duyulan kalıpları deterministik olarak da tamir eder.
 */
export function applyDeterministicTurkishFixes(input: string): string {
  let text = stripPromptLeakage(input);
  if (!text) return "";

  const replacements: Array<[RegExp, string]> = [
    [/siz\s+de\s+de\s+ölürsünüz/gi, "siz de görürsünüz"],
    [/siz\s+de\s+ölürsünüz/gi, "siz de görürsünüz"],
    [/eğri\s+dolar\s+gibi\s+şey\s+değil/gi, "elimde olan bir şey değil"],
    [/eğri\s+dolar\s+gibi/gi, "elimde olan bir şey gibi"],
    [
      /peki,?\s*hayat\s+bu\s+t\s*a\s*m?\s+insanlar\s+m[ıi]?\s+arkada\s*(?:var\s*)?m[ıi]?\??/gi,
      "Peki hayatında tam insanlar mı, arkadaşların mı?",
    ],
    [
      /hayat\s+bu\s+t\s*a\s*m?\s+insanlar\s+m[ıi]?/gi,
      "hayatında tam insanlar mı",
    ],
    [/\barkada\s+var\s+m\b/gi, "arkadaşların var mı"],
    [/\barkada\s+m\b/gi, "arkadaşların mı"],
    [
      /tabii\s+can\s+biraz\s+ye(?:dire|te)ce\s+i\s+b\s+vicdan\s+k\s+oldu/gi,
      "Tabii canım biraz yanacağı için böyle vicdanım kötü oldu",
    ],
    [
      /can\s+biraz\s+ye(?:dire|te)ce\s+i\s+b\s+vicdan\s+k\s+oldu/gi,
      "Canım biraz yanacağı için böyle vicdanım kötü oldu",
    ],
    [
      /ye(?:dire|te)ce\s+i\s+b\s+vicdan\s+k\s+oldu/gi,
      "yedireceği için böyle vicdanım kötü oldu",
    ],
    [
      /yazarken\s+de\s+m\s+olmad\s+da\s+biliyorum\s+do\s+olarak/gi,
      "Yazarken de mükemmel olmadığımı da biliyorum doğal olarak",
    ],
    [
      /bir\s+oldu\s+s\s+s\s+a\s+ya/gi,
      "Bir şey olduğunu söyle söyle açtım ya",
    ],
    [/\basl\s+anlatay\b/gi, "aslında anlatayım"],
    [/\basl\s+hala\s+bakt\s+zaman\b/gi, "aslında hâlâ baktığın zaman"],
    [/\bneresinden\s+u\s+a\s+bilmiyorum\b/gi, "neresinden tutacağımı bilmiyorum"],
    // Genel kopuk Türkçe ek tamirleri
    [/\b([a-zçğıöşü]{2,})ece\s+i\b/gi, "$1eceği"],
    [/\b([a-zçğıöşü]{2,})aca\s+ı\b/gi, "$1acağı"],
    [/\b([a-zçğıöşü]{2,})دی\s+i\b/gi, "$1diği"],
    [/\bdo\s+olarak\b/gi, "doğal olarak"],
    [/\bvicdan\s+k\s+oldu\b/gi, "vicdanım kötü oldu"],
    [/\bm\s+olmad\s+da\b/gi, "mükemmel olmadığımı da"],
  ];

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text.replace(/\s{2,}/g, " ").trim();
}

export async function refineSegmentsWithLLM(
  segments: RefinableSegment[],
  keys: string[],
  startKeyIndex = 0
): Promise<{
  segments: RefinableSegment[];
  llmApplied: boolean;
  modelUsed: string | null;
  firstLine: string;
}> {
  if (segments.length === 0) {
    return {
      segments,
      llmApplied: false,
      modelUsed: null,
      firstLine: "",
    };
  }

  // Önce deterministik düzeltmeleri uygula
  for (const seg of segments) {
    seg.text = applyDeterministicTurkishFixes(seg.text);
  }

  if (keys.length === 0) {
    return {
      segments,
      llmApplied: false,
      modelUsed: null,
      firstLine: segments[0]?.text || "",
    };
  }

  const numberedInput = segments
    .map((s, idx) => `[${idx}] ${s.text.trim()}`)
    .join("\n");

  let llmApplied = false;
  let modelUsed: string | null = null;

  outerLoop: for (const modelName of ACTIVE_GROQ_LLM_MODELS) {
    for (let k = 0; k < keys.length; k++) {
      const llmKey = keys[(startKeyIndex + 1 + k) % keys.length];
      const llmGroq = new Groq({ apiKey: llmKey });

      try {
        const completion = await llmGroq.chat.completions.create({
          model: modelName,
          temperature: 0.1,
          max_tokens: 4096,
          messages: [
            {
              role: "system",
              content: `Sen uzman bir Türkçe psikolojik danışmanlık deşifre redaktörüsün. Sana numaralı satırlar halinde ses tanıma (Whisper) çıktısı verilecek.
GÖREVİN:
1. Ses boğukluğundan dolayı tek/iki harf olarak yarım çıkmış TÜM kopuk heceleri cümlenin gelişine göre tamir et (Örn: "Peki hayat bu t a insanlar m Arkada m" -> "Peki hayatında tam insanlar mı, arkadaşların mı?", "Tabii can biraz yedirece i b vicdan k oldu" -> "Tabii canım biraz yanacağı için böyle vicdanım kötü oldu", "Yazarken de m olmad da biliyorum do olarak" -> "Yazarken de mükemmel olmadığımı da biliyorum doğal olarak", "Bir oldu s s a ya" -> "Bir şey olduğunu söyle söyle açtım ya").
2. Sesten yanlış duyulmuş anlamsız kelimeleri psikolojik seans bağlamına göre düzelt (Örn: "siz de de ölürsünüz" -> "siz de görürsünüz", "eğri dolar gibi şey değil" -> "elimde olan bir şey değil").
3. SIFIR VERİ KAYBI KURALI: Hiçbir satırı silme, birleştirme veya atlama! Satır numaralarını ([0], [1], ...) KESİNLİKLE birebir koru ve her satırı "[numara] düzeltilmiş metin" formatında döndür.`,
            },
            { role: "user", content: numberedInput },
          ],
        });

        const output = completion.choices[0]?.message?.content || "";
        const lines = output.split("\n");
        let updatedCount = 0;

        for (const rawLine of lines) {
          const line = rawLine.trim().replace(/^\*\*|\*\*$/g, "");
          const match = line.match(/^\[(\d+)\]:?\s*(.+)$/);
          if (match) {
            const idx = parseInt(match[1], 10);
            if (segments[idx]) {
              const rawContent = match[2].trim();
              if (/^\[?s[iı]l\]?$/i.test(rawContent)) {
                continue;
              }
              const repaired = applyDeterministicTurkishFixes(rawContent);
              if (repaired) {
                segments[idx].text = repaired;
                updatedCount++;
              }
            }
          }
        }

        if (updatedCount > 0) {
          llmApplied = true;
          modelUsed = modelName;
          console.log(
            `✅ LLAMA REDAKSİYONU UYGULANDI (${modelName}, ${updatedCount}/${segments.length} satır) | İlk Satır: ${segments[0]?.text}`
          );
          break outerLoop;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Eğer model_not_found (404) ise aynı modeli diğer key'lerle deneme, doğrudan sonraki modele geç
        if (msg.includes("404") || msg.includes("model_not_found")) {
          console.warn(
            `[Refiner] Model ${modelName} bulunamadı, sıradaki modele geçiliyor...`
          );
          break;
        }
        console.warn(
          `[Refiner] Model ${modelName} Key #${k + 1} hatası, sıradaki key deneniyor:`,
          msg
        );
      }
    }
  }

  return {
    segments,
    llmApplied,
    modelUsed,
    firstLine: segments[0]?.text || "",
  };
}
