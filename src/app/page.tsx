"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { motion, AnimatePresence } from "framer-motion";
import {
  UploadCloud,
  FileVideo,
  Cpu,
  HardDriveDownload,
  Sparkles,
  CheckCircle2,
  Download,
  FileText,
  Subtitles,
  Music,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  Clock,
  Globe,
  ShieldCheck,
  Layers,
  Play,
  Edit3,
  ListOrdered,
} from "lucide-react";
import {
  SubtitleSegment,
  formatSrtTime,
  generateSrtContent,
  generatePlainTextContent,
} from "@/utils/srtFormatter";

type ProcessingStep = 0 | 1 | 2 | 3 | 4;

const CHUNK_DURATION_SECONDS = 600; // 10 dakika = 600 saniye

const LANGUAGES = [
  { code: "tr", label: "Türkçe (TR)" },
  { code: "en", label: "İngilizce (EN)" },
  { code: "de", label: "Almanca (DE)" },
  { code: "fr", label: "Fransızca (FR)" },
  { code: "es", label: "İspanyolca (ES)" },
  { code: "ar", label: "Arapça (AR)" },
  { code: "ru", label: "Rusça (RU)" },
  { code: "auto", label: "Otomatik Algıla" },
];

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

export default function VideoToSubtitlePage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [language, setLanguage] = useState<string>("tr");

  // Stepper & Progress States
  // 0: Beklemede, 1: FFmpeg Hazırlanıyor, 2: WORKERFS Ses Ayıklama, 3: Groq Whisper API, 4: Tamamlandı
  const [currentStep, setCurrentStep] = useState<ProcessingStep>(0);
  const [extractionProgress, setExtractionProgress] = useState<number>(0);
  const [processedTimeStr, setProcessedTimeStr] = useState<string>("00:00:00");
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [statusLog, setStatusLog] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Output States
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlobSize, setAudioBlobSize] = useState<number>(0);
  const [segments, setSegments] = useState<SubtitleSegment[]>([]);
  const [srtText, setSrtText] = useState<string>("");
  const [plainText, setPlainText] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"srt" | "segments" | "txt">("srt");
  const [copied, setCopied] = useState<boolean>(false);

  // Refs
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const videoDurationRef = useRef<number>(0);

  // Cleanup Object URL on unmount or reset
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file) return;
    setErrorMessage(null);
    setVideoFile(file);
    setCurrentStep(0);
    setExtractionProgress(0);
    setCurrentChunkIndex(0);
    setTotalChunks(0);
    setSegments([]);
    setSrtText("");
    setPlainText("");
    setStatusLog("");
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  }, [audioUrl]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentStep > 0 && currentStep < 4) return;
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (currentStep > 0 && currentStep < 4) return;

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const loadFFmpegEngine = async (): Promise<FFmpeg> => {
    if (ffmpegRef.current && ffmpegRef.current.loaded) {
      return ffmpegRef.current;
    }

    const ffmpeg = new FFmpeg();

    ffmpeg.on("log", ({ message }) => {
      // Toplam video süresini FFmpeg loglarından yakala (progress yedeği olarak)
      const durationMatch = message.match(
        /Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/
      );
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10);
        const minutes = parseInt(durationMatch[2], 10);
        const seconds = parseInt(durationMatch[3], 10);
        videoDurationRef.current = hours * 3600 + minutes * 60 + seconds;
      }

      const timeMatch = message.match(/time=(\d{2}:\d{2}:\d{2})\.\d{2}/);
      if (timeMatch) {
        setProcessedTimeStr(timeMatch[1]);
      }
    });

    ffmpeg.on("progress", ({ progress, time }) => {
      if (typeof progress === "number" && Number.isFinite(progress) && progress > 0 && progress <= 1) {
        setExtractionProgress(Math.min(100, Math.max(1, Math.round(progress * 100))));
      } else if (time > 0 && videoDurationRef.current > 0) {
        const currentSec = time / 1_000_000;
        const pct = Math.round((currentSec / videoDurationRef.current) * 100);
        setExtractionProgress(Math.min(99, Math.max(1, pct)));
      }
    });

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.9/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      ),
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  const startProcessing = async () => {
    if (!videoFile) return;

    setErrorMessage(null);
    setExtractionProgress(0);
    setProcessedTimeStr("00:00:00");
    setCurrentChunkIndex(0);
    setTotalChunks(0);
    setSegments([]);
    setSrtText("");
    setPlainText("");
    videoDurationRef.current = 0;

    let ffmpeg: FFmpeg | null = null;

    try {
      // ADIM 1: FFmpeg Motoru Hazırlanıyor
      setCurrentStep(1);
      setStatusLog("WebAssembly FFmpeg çekirdeği tarayıcıda başlatılıyor...");
      ffmpeg = await loadFFmpegEngine();

      // ADIM 2: 5 GB Video Diskten Okunuyor (WORKERFS) ve Ses Ayıklanıyor
      setCurrentStep(2);
      setStatusLog(
        "WORKERFS sanal disk bağlantısı kuruluyor (RAM'e kopyalanmadan doğrudan diskten okunuyor)..."
      );

      // Önceki çalışmadan kalan mount veya dosyalar varsa temizle
      try {
        await ffmpeg.unmount("/input");
      } catch {
        // Henüz mount edilmemiş olabilir
      }
      try {
        await ffmpeg.createDir("/input");
      } catch {
        // Klasör zaten mevcut olabilir
      }

      // Eski çıktı dosyalarını temizle
      try {
        const rootFiles = await ffmpeg.listDir("/");
        for (const f of rootFiles) {
          if (
            !f.isDir &&
            (f.name === "full_audio.mp3" || /^chunk_\d+\.mp3$/.test(f.name))
          ) {
            await ffmpeg.deleteFile(f.name);
          }
        }
      } catch {
        // Yoksay
      }

      // KRİTİK KURAL: 5 GB dosyayı belleğe (MEMFS) yazmak yerine WORKERFS ile doğrudan bağla!
      await ffmpeg.mount(
        "WORKERFS" as any,
        { files: [videoFile] },
        "/input"
      );

      setStatusLog(
        "Ses akışı Mono 16kHz 64kbps MP3 olarak daraltılıyor ve 10 dakikalık parçalara bölünüyor..."
      );

      // Tek bir FFmpeg komutuyla hem tam MP3 hem de 10 dakikalık (600 sn) chunk_XXX.mp3 üret
      const exitCode = await ffmpeg.exec([
        "-i",
        `/input/${videoFile.name}`,
        // 1. Çıktı: Kullanıcının indirebileceği ve dinleyebileceği tam MP3
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        "full_audio.mp3",
        // 2. Çıktı: Groq Whisper 25MB sınırına takılmamak için 10'ar dakikalık (~4.5MB) parçalar
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        "-f",
        "segment",
        "-segment_time",
        String(CHUNK_DURATION_SECONDS),
        "-reset_timestamps",
        "1",
        "chunk_%03d.mp3",
      ]);

      // WORKERFS bağlantısını ayır
      try {
        await ffmpeg.unmount("/input");
      } catch {
        // Yoksay
      }

      if (exitCode !== 0) {
        throw new Error(
          `FFmpeg ses ayrıştırma işlemi hata kodu ile sonlandı (Kod: ${exitCode}). Videoda ses kanalı bulunduğundan emin olun.`
        );
      }

      setExtractionProgress(100);

      // Tam MP3 dosyasını oku ve Blob URL oluştur, ardından WASM RAM'inden sil
      const fullAudioData = await ffmpeg.readFile("full_audio.mp3");
      const fullAudioUint8 = new Uint8Array(fullAudioData as Uint8Array);
      const fullAudioBlob = new Blob([fullAudioUint8], { type: "audio/mp3" });
      const generatedAudioUrl = URL.createObjectURL(fullAudioBlob);
      setAudioUrl(generatedAudioUrl);
      setAudioBlobSize(fullAudioBlob.size);

      try {
        await ffmpeg.deleteFile("full_audio.mp3");
      } catch {
        // Yoksay
      }

      // Oluşan chunk_XXX.mp3 dosyalarını listele ve sırala
      const dirFiles = await ffmpeg.listDir("/");
      const chunkFileNames = dirFiles
        .filter((node) => !node.isDir && /^chunk_\d+\.mp3$/.test(node.name))
        .map((node) => node.name)
        .sort();

      if (chunkFileNames.length === 0) {
        throw new Error(
          "Videodan ses parçaları (chunk_XXX.mp3) üretilemedi. Videoda geçerli bir ses akışı bulunmuyor olabilir."
        );
      }

      // ADIM 3: Ses Parçaları Yapay Zeka (Groq Whisper) ile Altyazıya Dönüştürülüyor
      setCurrentStep(3);
      setTotalChunks(chunkFileNames.length);

      const allSyncedSegments: SubtitleSegment[] = [];

      for (let chunkIndex = 0; chunkIndex < chunkFileNames.length; chunkIndex++) {
        const chunkName = chunkFileNames[chunkIndex];
        setCurrentChunkIndex(chunkIndex + 1);
        setStatusLog(
          `Parça ${chunkIndex + 1} / ${chunkFileNames.length} (${chunkName}) Groq Whisper Large V3 Turbo ile işleniyor...`
        );

        const chunkData = await ffmpeg.readFile(chunkName);
        const chunkUint8 = new Uint8Array(chunkData as Uint8Array);
        const chunkFile = new File([chunkUint8], chunkName, {
          type: "audio/mp3",
        });

        // Okunan chunk'ı hemen sanal bellekten silerek RAM kullanımını minimumda tut
        try {
          await ffmpeg.deleteFile(chunkName);
        } catch {
          // Yoksay
        }

        const formData = new FormData();
        formData.append("file", chunkFile);
        formData.append("language", language);

        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
              `Parça ${chunkIndex + 1} işlenirken API hatası oluştu (HTTP ${response.status}).`
          );
        }

        const timeOffsetSeconds = chunkIndex * CHUNK_DURATION_SECONDS;

        if (Array.isArray(result.segments) && result.segments.length > 0) {
          for (const seg of result.segments) {
            allSyncedSegments.push({
              id: allSyncedSegments.length + 1,
              start: Number(seg.start) + timeOffsetSeconds,
              end: Number(seg.end) + timeOffsetSeconds,
              text: String(seg.text || "").trim(),
            });
          }
        } else if (result.text && String(result.text).trim().length > 0) {
          allSyncedSegments.push({
            id: allSyncedSegments.length + 1,
            start: timeOffsetSeconds,
            end:
              timeOffsetSeconds +
              (Number(result.duration) || CHUNK_DURATION_SECONDS),
            text: String(result.text).trim(),
          });
        }

        // Canlı önizleme için her chunk sonrasında state'i güncelle
        const partialSrt = generateSrtContent(allSyncedSegments);
        const partialTxt = generatePlainTextContent(allSyncedSegments);
        setSegments([...allSyncedSegments]);
        setSrtText(partialSrt);
        setPlainText(partialTxt);
      }

      // ADIM 4: Tamamlandı!
      setCurrentStep(4);
      setStatusLog(
        `Tüm işlemler başarıyla tamamlandı! Toplam ${allSyncedSegments.length} altyazı segmenti senkronize edildi.`
      );
    } catch (err: unknown) {
      console.error("İşlem Hatası:", err);
      const msg =
        err instanceof Error
          ? err.message
          : "İşlem sırasında beklenmeyen bir hata meydana geldi.";
      setErrorMessage(msg);
      setCurrentStep(0);
    }
  };

  const handleCopyContent = async () => {
    const contentToCopy = activeTab === "txt" ? plainText : srtText;
    if (!contentToCopy) return;
    await navigator.clipboard.writeText(contentToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (
    content: string | Blob,
    filename: string,
    mimeType: string
  ) => {
    const blob =
      content instanceof Blob
        ? content
        : new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const baseFileName = videoFile
    ? videoFile.name.replace(/\.[^/.]+$/, "")
    : "altyazi";

  const seekAudioTo = (seconds: number) => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = seconds;
      audioPlayerRef.current.play().catch(() => {});
    }
  };

  const isProcessing = currentStep >= 1 && currentStep <= 3;

  const steps = [
    {
      id: 1,
      title: "FFmpeg Motoru Hazırlanıyor",
      description: "WebAssembly ses işleme çekirdeği yükleniyor",
      icon: Cpu,
    },
    {
      id: 2,
      title: "5 GB Video Diskten Okunuyor ve Ses Ayıklanıyor",
      description:
        "WORKERFS ile RAM şişmeden 16kHz Mono MP3 ve 10 dk parçalar üretiliyor",
      icon: HardDriveDownload,
    },
    {
      id: 3,
      title: "Ses Parçaları Yapay Zeka ile Altyazıya Dönüştürülüyor",
      description:
        totalChunks > 0
          ? `Parça ${currentChunkIndex} / ${totalChunks} işleniyor... (Groq Whisper Large V3 Turbo)`
          : "Groq Whisper API ile zaman damgalı segmentler çıkarılıyor",
      icon: Sparkles,
    },
    {
      id: 4,
      title: "Tamamlandı!",
      description: "Tam senkronize .SRT altyazı ve .MP3 ses dosyası hazır",
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden">
      {/* Arka Plan Dekoratif Işıklandırmalar */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      {/* Üst Bilgi Çubuğu (Header) */}
      <header className="relative z-10 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-indigo-500/20 border border-emerald-500/30 shadow-inner">
              <Subtitles className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-lg text-white">
                  VoxSub <span className="text-emerald-400">Studio</span>
                </span>
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  Zero-Upload WORKERFS
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                5 GB+ Videolar İçin Tarayıcı İçi Ses Ayrıştırma & Groq Whisper
                SRT Üretici
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>Video Sunucuya Yüklenmez</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5">
              <Layers className="h-4 w-4 text-indigo-400" />
              <span>10 Dk Otomatik Chunking</span>
            </div>
          </div>
        </div>
      </header>

      {/* Ana İçerik */}
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Başlık Bölümü */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-1 text-xs font-medium text-indigo-300"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>FFmpeg.wasm WORKERFS + Groq Whisper Large V3 Turbo</span>
          </motion.div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
            Devasa Videoları RAM Çökmeden{" "}
            <span className="bg-gradient-to-r from-emerald-400 to-indigo-400 bg-clip-text text-transparent">
              Sese ve Altyazıya
            </span>{" "}
            Dönüştürün
          </h1>
          <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">
            40-60+ dakikalık ve 5 GB üzerindeki videolarınız sunucuya yüklenmez.
            Doğrudan diskinizden{" "}
            <code className="text-emerald-300 font-mono text-xs bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
              WORKERFS
            </code>{" "}
            ile okunur, 16kHz Mono MP3&apos;e sıkıştırılır ve 10&apos;ar dakikalık
            parçalar halinde yüksek doğruluklu{" "}
            <code className="text-indigo-300 font-mono text-xs bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
              .SRT
            </code>{" "}
            altyazıya çevrilir.
          </p>
        </div>

        {/* Sürükle-Bırak (Drag & Drop) ve Ayarlar Alanı */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 backdrop-blur-sm shadow-2xl"
        >
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => {
              if (!isProcessing) fileInputRef.current?.click();
            }}
            className={`relative group cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200 p-8 sm:p-12 text-center ${
              isDragging
                ? "border-emerald-400 bg-emerald-500/10"
                : videoFile
                ? "border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60"
                : "border-zinc-800 bg-zinc-950/60 hover:border-indigo-500/50 hover:bg-zinc-900/60"
            } ${isProcessing ? "pointer-events-none opacity-75" : ""}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*,.mkv,.mp4,.mov,.avi,.webm,.flv,.wmv,.m4v"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                handleFileSelect(file);
              }}
            />

            {!videoFile ? (
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-indigo-500/20 border border-zinc-700/80 group-hover:scale-105 transition-transform">
                  <UploadCloud className="h-8 w-8 text-emerald-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-base sm:text-lg font-semibold text-zinc-100">
                    Video dosyanızı buraya sürükleyip bırakın veya{" "}
                    <span className="text-emerald-400 underline underline-offset-4">
                      dosya seçin
                    </span>
                  </p>
                  <p className="text-xs sm:text-sm text-zinc-400">
                    MP4, MKV, MOV, AVI, WebM desteklenir • 5 GB+ boyutlu uzun
                    videolar için optimize edildi
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-left max-w-3xl mx-auto">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30">
                    <FileVideo className="h-7 w-7 text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wider text-emerald-400">
                      Seçilen Video Dosyası
                    </p>
                    <h3 className="truncate text-base sm:text-lg font-semibold text-white max-w-xs sm:max-w-md">
                      {videoFile.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span className="rounded-md bg-zinc-800 px-2 py-0.5 font-mono text-emerald-300">
                        {formatFileSize(videoFile.size)}
                      </span>
                      <span>•</span>
                      <span>{videoFile.type || "Video Dosyası"}</span>
                      <span>•</span>
                      <span className="text-indigo-300">
                        Doğrudan Disk Akışı (WORKERFS)
                      </span>
                    </div>
                  </div>
                </div>

                {!isProcessing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-800/90 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
                  >
                    Dosyayı Değiştir
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Kontrol Çubuğu: Dil Seçimi & Başlat Butonu */}
          <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-4 border-t border-zinc-800/80">
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="language-select"
                className="flex items-center gap-2 text-xs font-medium text-zinc-400"
              >
                <Globe className="h-4 w-4 text-indigo-400" />
                <span>Konuşma Dili:</span>
              </label>
              <select
                id="language-select"
                disabled={isProcessing}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={!videoFile || isProcessing}
              onClick={startProcessing}
              className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 transition-all cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>İşleniyor...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>
                    {currentStep === 4
                      ? "Yeniden İşle ve Altyazı Üret"
                      : "Sesi Ayıkla ve Altyazı (.SRT) Üret"}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Hata Mesajı Gösterimi */}
          <AnimatePresence>
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3 text-red-200"
              >
                <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm space-y-1">
                  <p className="font-semibold text-red-300">İşlem Başarısız</p>
                  <p className="text-red-200/90">{errorMessage}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Adım Adım Canlı İlerleme Durumu (Progress Stepper) */}
        <AnimatePresence>
          {currentStep > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-6 backdrop-blur-sm space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <Clock className="h-4 w-4 text-emerald-400" />
                    <span>Canlı İşlem Hattı (Pipeline Durumu)</span>
                  </h2>
                  {statusLog && (
                    <p className="text-xs text-zinc-400 mt-1">{statusLog}</p>
                  )}
                </div>
                {currentStep === 2 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-mono text-emerald-300">
                    İşlenen Süre: {processedTimeStr} • %{extractionProgress}
                  </span>
                )}
                {currentStep === 3 && totalChunks > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 px-3 py-1 text-xs font-mono text-indigo-300">
                    Parça {currentChunkIndex} / {totalChunks} işleniyor...
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {steps.map((step) => {
                  const Icon = step.icon;
                  const isCompleted =
                    currentStep > step.id || currentStep === 4;
                  const isActive = currentStep === step.id && currentStep !== 4;

                  return (
                    <div
                      key={step.id}
                      className={`relative rounded-xl border p-4 transition-all ${
                        isActive
                          ? "border-emerald-500/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/5"
                          : isCompleted
                          ? "border-emerald-500/30 bg-zinc-900/80"
                          : "border-zinc-800/70 bg-zinc-950/50 opacity-50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
                            isCompleted
                              ? "bg-emerald-500 text-zinc-950"
                              : isActive
                              ? "bg-indigo-500 text-white animate-pulse"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {isCompleted ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Icon className="h-4 w-4" />
                          )}
                        </span>
                        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
                          Adım {step.id} / 4
                        </span>
                      </div>

                      <h3 className="text-sm font-semibold text-zinc-100 leading-snug">
                        {step.title}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                        {step.description}
                      </p>

                      {/* Adım 2 için % İlerleme Çubuğu */}
                      {step.id === 2 && (isActive || isCompleted) && (
                        <div className="mt-3 space-y-1">
                          <div className="flex justify-between text-[11px] font-mono text-emerald-300">
                            <span>Ses Ayıklama</span>
                            <span>
                              %{isCompleted ? 100 : extractionProgress}
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{
                                width: `${
                                  isCompleted ? 100 : extractionProgress
                                }%`,
                              }}
                              transition={{ ease: "easeOut", duration: 0.3 }}
                              className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500"
                            />
                          </div>
                        </div>
                      )}

                      {/* Adım 3 için Chunk İlerleme Çubuğu */}
                      {step.id === 3 &&
                        totalChunks > 0 &&
                        (isActive || isCompleted) && (
                          <div className="mt-3 space-y-1">
                            <div className="flex justify-between text-[11px] font-mono text-indigo-300">
                              <span>
                                Parça{" "}
                                {isCompleted ? totalChunks : currentChunkIndex}{" "}
                                / {totalChunks}
                              </span>
                              <span>
                                %
                                {isCompleted
                                  ? 100
                                  : Math.round(
                                      (currentChunkIndex / totalChunks) * 100
                                    )}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{
                                  width: `${
                                    isCompleted
                                      ? 100
                                      : Math.round(
                                          (currentChunkIndex / totalChunks) *
                                            100
                                        )
                                  }%`,
                                }}
                                transition={{ ease: "easeOut", duration: 0.3 }}
                                className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400"
                              />
                            </div>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* SONUÇ EKRANI: Ses Oynatıcı + Altyazı Önizleme / Düzenleme + İndirme Butonları */}
        <AnimatePresence>
          {(audioUrl || srtText) && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Tam MP3 Oynatma ve İndirme Kartı */}
              {audioUrl && (
                <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-6 backdrop-blur-sm">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="flex items-start sm:items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30">
                        <Music className="h-6 w-6 text-emerald-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-semibold text-white">
                            Ayıklanan Tam Ses Dosyası (full_audio.mp3)
                          </h3>
                          <span className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-xs font-mono text-emerald-300">
                            {formatFileSize(audioBlobSize)}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          16kHz • Mono • 64kbps optimize edilmiş MP3 ses akışı
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 flex-1 max-w-2xl lg:justify-end">
                      <audio
                        ref={audioPlayerRef}
                        controls
                        src={audioUrl}
                        className="w-full sm:w-80 h-10 rounded-lg"
                      />
                      <a
                        href={audioUrl}
                        download={`${baseFileName}_full_audio.mp3`}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors"
                      >
                        <Download className="h-4 w-4" />
                        <span>MP3 Olarak İndir</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Altyazı Önizleme, Düzenleme ve İndirme Kartı */}
              {segments.length > 0 && (
                <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/50 p-6 backdrop-blur-sm space-y-5">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Subtitles className="h-5 w-5 text-indigo-400" />
                        <span>
                          Senkronize Altyazı Önizleme ve Düzenleyici
                        </span>
                        <span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-0.5 text-xs font-mono text-indigo-300">
                          {segments.length} Segment
                        </span>
                      </h3>
                      <p className="text-xs text-zinc-400 mt-1">
                        Altyazı metnini aşağıdan doğrudan düzenleyebilir,
                        kopyalayabilir veya{" "}
                        <code className="text-emerald-300">.SRT</code> /{" "}
                        <code className="text-indigo-300">.TXT</code> olarak
                        indirebilirsiniz.
                      </p>
                    </div>

                    {/* İndirme ve Kopyalama Butonları */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleCopyContent}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/90 px-3.5 py-2.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors cursor-pointer"
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4 text-emerald-400" />
                            <span className="text-emerald-300">
                              Panoya Kopyalandı!
                            </span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 text-zinc-400" />
                            <span>Metni Kopyala</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          downloadFile(
                            srtText,
                            `${baseFileName}.srt`,
                            "application/x-subrip"
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs sm:text-sm font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors cursor-pointer shadow-lg shadow-emerald-500/10"
                      >
                        <Subtitles className="h-4 w-4" />
                        <span>.SRT Altyazı İndir</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          downloadFile(
                            plainText,
                            `${baseFileName}.txt`,
                            "text/plain"
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-indigo-500 transition-colors cursor-pointer shadow-lg shadow-indigo-500/10"
                      >
                        <FileText className="h-4 w-4" />
                        <span>Düz Metin (.TXT) İndir</span>
                      </button>
                    </div>
                  </div>

                  {/* Sekme Seçici: Düzenlenebilir SRT Editörü | Zaman Damgalı Segment Listesi | Düz Metin */}
                  <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab("srt")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        activeTab === "srt"
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Düzenlenebilir .SRT Önizleme</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("segments")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        activeTab === "segments"
                          ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      <ListOrdered className="h-3.5 w-3.5" />
                      <span>Zaman Damgalı Segmentler ({segments.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("txt")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        activeTab === "txt"
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>Düz Metin (.TXT)</span>
                    </button>
                  </div>

                  {/* Sekme İçeriği */}
                  {activeTab === "srt" && (
                    <div className="space-y-2">
                      <textarea
                        value={srtText}
                        onChange={(e) => setSrtText(e.target.value)}
                        rows={16}
                        spellCheck={false}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 font-mono text-xs sm:text-sm text-zinc-200 leading-relaxed focus:border-emerald-500/60 focus:outline-none"
                        placeholder="Oluşturulan .SRT altyazı içeriği burada görünecek..."
                      />
                    </div>
                  )}

                  {activeTab === "segments" && (
                    <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                      {segments.map((seg, idx) => (
                        <div
                          key={idx}
                          className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3.5 hover:border-indigo-500/40 transition-colors"
                        >
                          <div className="flex items-start sm:items-center gap-3">
                            <button
                              type="button"
                              onClick={() => seekAudioTo(seg.start)}
                              title="Bu saniyeden dinle"
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-1 font-mono text-xs text-indigo-300 hover:bg-indigo-500/20 transition-colors cursor-pointer"
                            >
                              <Play className="h-3 w-3 fill-current" />
                              <span>
                                {formatSrtTime(seg.start)} →{" "}
                                {formatSrtTime(seg.end)}
                              </span>
                            </button>
                            <p className="text-sm text-zinc-200 leading-relaxed">
                              {seg.text}
                            </p>
                          </div>
                          <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                            #{idx + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === "txt" && (
                    <div className="space-y-2">
                      <textarea
                        value={plainText}
                        onChange={(e) => setPlainText(e.target.value)}
                        rows={14}
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 text-sm text-zinc-200 leading-relaxed focus:border-indigo-500/60 focus:outline-none"
                        placeholder="Düz metin içeriği burada görünecek..."
                      />
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
