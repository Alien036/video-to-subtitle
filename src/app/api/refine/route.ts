import { NextRequest, NextResponse } from "next/server";
import {
  RefinableSegment,
  refineSegmentsWithLLM,
} from "@/utils/turkishRefiner";

export const maxDuration = 60;

let roundRobinCounter = Math.floor(Math.random() * 1000);

function getApiKeysPool(): string[] {
  return (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const keys = getApiKeysPool();
    const body = await request.json();
    const inputSegments: RefinableSegment[] = Array.isArray(body?.segments)
      ? body.segments.map((s: RefinableSegment, idx: number) => ({
          id: s.id ?? idx + 1,
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || "").trim(),
          no_speech_prob: s.no_speech_prob,
        }))
      : [];

    if (inputSegments.length === 0) {
      return NextResponse.json({
        segments: [],
        text: "",
        llmApplied: false,
        firstLine: "",
      });
    }

    const startKeyIndex =
      keys.length > 0 ? roundRobinCounter++ % keys.length : 0;

    const { segments, llmApplied, modelUsed, firstLine } =
      await refineSegmentsWithLLM(inputSegments, keys, startKeyIndex);

    const cleanFullText = segments.map((s) => s.text.trim()).join(" ");

    return NextResponse.json({
      segments,
      text: cleanFullText,
      llmApplied,
      modelUsed,
      firstLine,
    });
  } catch (err: unknown) {
    console.error("[/api/refine] Hata:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Metin tamiri sırasında beklenmeyen bir hata oluştu.",
      },
      { status: 500 }
    );
  }
}
