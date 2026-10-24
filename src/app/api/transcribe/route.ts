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

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "Sunucu yapılandırma hatası: GROQ_API_KEY ortam değişkeni tanımlanmamış.",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const languageInput = formData.get("language");
    const language =
      typeof languageInput === "string" && languageInput.trim().length > 0
        ? languageInput.trim()
        : "tr";

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Geçerli bir ses dosyası ('file') gönderilmedi." },
        { status: 400 }
      );
    }

    const groq = new Groq({ apiKey });

    const transcription = (await groq.audio.transcriptions.create({
      file,
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
  } catch (error: unknown) {
    console.error("[/api/transcribe] Groq Whisper API Hatası:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Ses dosyası metne dönüştürülürken beklenmeyen bir hata oluştu.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
