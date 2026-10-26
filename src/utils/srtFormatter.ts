export interface SubtitleSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

/**
 * Saniye cinsinden zaman değerini (örn: 625.42)
 * standart SRT zaman damgası formatına (00:10:25,420) dönüştürür.
 */
export function formatSrtTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalMilliseconds = Math.round(safeSeconds * 1000);

  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const milliseconds = totalMilliseconds % 1_000;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const mmm = String(milliseconds).padStart(3, "0");

  return `${hh}:${mm}:${ss},${mmm}`;
}

/**
 * Tüm altyazı segmentlerini standart .srt formatında tek bir metne dönüştürür.
 */
export function generateSrtContent(segments: SubtitleSegment[]): string {
  if (!Array.isArray(segments) || segments.length === 0) {
    return "";
  }

  return segments
    .filter((segment) => segment.text && segment.text.trim().length > 0)
    .map((segment, index) => {
      const sequenceNumber = index + 1;
      const startTime = formatSrtTime(segment.start);
      const endTime = formatSrtTime(
        segment.end > segment.start ? segment.end : segment.start + 1
      );
      const cleanText = segment.text.trim();

      return `${sequenceNumber}\n${startTime} --> ${endTime}\n${cleanText}`;
    })
    .join("\n\n");
}

/**
 * Saniye cinsinden zaman değerini kısa diyalog zaman damgasına (MM:SS veya HH:MM:SS) dönüştürür.
 */
export function formatDialogueTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Tüm altyazı segmentlerini zaman damgalı diyalog formatında (.txt) okunaklı satırlara dönüştürür.
 */
export function generatePlainTextContent(segments: SubtitleSegment[]): string {
  if (!Array.isArray(segments) || segments.length === 0) {
    return "";
  }

  return segments
    .filter((segment) => segment.text && segment.text.trim().length > 0)
    .map((segment) => {
      const startStr = formatDialogueTime(segment.start);
      const endStr = formatDialogueTime(
        segment.end > segment.start ? segment.end : segment.start + 1
      );
      const cleanText = segment.text.trim().replace(/\s+/g, " ");
      return `[${startStr} - ${endStr}] ${cleanText}`;
    })
    .join("\n");
}
