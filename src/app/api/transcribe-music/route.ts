import { NextRequest, NextResponse } from "next/server";
import { AutomaticSpeechRecognition } from "deepinfra";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const maxDuration = 60;

const MODEL = "openai/whisper-large-v3";

let roundRobinCounter = Math.floor(Math.random() * 1000);

function getDeepInfraApiKeysPool(): string[] {
  return (process.env.DEEPINFRA_API_KEYS || process.env.DEEPINFRA_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const keys = getDeepInfraApiKeysPool();

    if (keys.length === 0) {
      return NextResponse.json(
        {
          error:
            "Sunucu yapılandırma hatası: DEEPINFRA_API_KEY ortam değişkeni tanımlanmamış.",
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

    const fileArrayBuffer = await uploadedFile.arrayBuffer();
    const ext = path.extname(uploadedFile.name || "audio.mp3") || ".mp3";
    tempFilePath = path.join(
      os.tmpdir(),
      `music-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
    );

    await fs.writeFile(tempFilePath, Buffer.from(fileArrayBuffer));

    const startIndex = roundRobinCounter++ % keys.length;
    let lastError: unknown = null;

    for (let offset = 0; offset < keys.length; offset++) {
      const keyIndex = (startIndex + offset) % keys.length;
      const apiKey = keys[keyIndex];

      try {
        const client = new AutomaticSpeechRecognition(MODEL, apiKey);

        const input = {
          audio: tempFilePath,
        };

        const response = await client.generate(input);
        console.log(response.text);

        const rawText = response.text || "";
        const durationSec =
          typeof response.input_length_ms === "number" &&
          response.input_length_ms > 0
            ? response.input_length_ms / 1000
            : 240;

        const rawSegments = Array.isArray(response.segments)
          ? response.segments
              .map((seg, idx) => ({
                id: seg.id ?? idx + 1,
                start: Number(seg.start) || 0,
                end: Number(seg.end) || 0,
                text: String(seg.text ?? "").trim(),
                no_speech_prob: seg.no_speech_prob,
              }))
              .filter((seg) => seg.text.length > 0)
          : [];

        const segments =
          rawSegments.length > 0
            ? rawSegments
            : rawText.trim().length > 0
            ? [
                {
                  id: 1,
                  start: 0,
                  end: durationSec,
                  text: rawText.trim(),
                },
              ]
            : [];

        return NextResponse.json({
          text: rawText,
          segments,
          modelUsed: MODEL,
          language: response.language || language,
          duration: durationSec,
        });
      } catch (err: unknown) {
        lastError = err;
        console.error(
          `[/api/transcribe-music] DeepInfra Key #${keyIndex + 1} Hatası:`,
          err
        );
      }
    }

    const message =
      lastError instanceof Error
        ? `${lastError.name}: ${lastError.message}`
        : String(lastError || "DeepInfra API'den geçerli bir yanıt alınamadı.");

    return NextResponse.json({ error: message }, { status: 500 });
  } catch (error: unknown) {
    console.error("[/api/transcribe-music] Beklenmeyen Sunucu Hatası:", error);
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(() => {});
    }
  }
}
