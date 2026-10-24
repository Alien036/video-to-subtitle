"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import {
  KeyRound,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  AlertCircle,
  LogOut,
  ArrowRight,
  Lock,
} from "lucide-react";
import { UserProfile } from "@/types/user";
import {
  adminUpdateUser,
  getAppSettings,
  getUserProfile,
} from "@/lib/userService";

interface VerificationViewProps {
  profile: UserProfile;
  onVerified: (updatedProfile: UserProfile) => void;
  onSignOut: () => void;
}

export default function VerificationView({
  profile,
  onVerified,
  onSignOut,
}: VerificationViewProps) {
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Eğer kullanıcı Admin tarafından engellenmişse (isBlocked === true)
  if (profile.isBlocked) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-red-500/10 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-red-500/5 blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="relative z-10 w-full max-w-md rounded-2xl border border-red-500/40 bg-zinc-900/90 p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6 text-center"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 border border-red-500/40">
            <ShieldAlert className="h-7 w-7 text-red-400" />
          </div>

          <div className="space-y-2">
            <span className="inline-block rounded-full bg-red-500/15 border border-red-500/30 px-3 py-0.5 text-xs font-medium text-red-300">
              Erişim Kısıtlandı
            </span>
            <h1 className="text-2xl font-bold text-white">
              Hesabınız Engellendi
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              Merhaba{" "}
              <span className="text-zinc-200 font-semibold">
                {profile.displayName}
              </span>{" "}
              (<code className="text-red-300">@{profile.username}</code>),
              hesabınızın platforma erişimi yönetici tarafından askıya
              alınmıştır. Bir hata olduğunu düşünüyorsanız yöneticiyle iletişime
              geçin.
            </p>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span>Çıkış Yap</span>
          </button>
        </motion.div>
      </div>
    );
  }

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmed = code.trim();
    if (!trimmed) {
      setErrorMsg("Lütfen gizli doğrulama kodunu girin.");
      return;
    }

    setLoading(true);
    try {
      const settings = await getAppSettings();

      const res = await fetch("/api/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: trimmed,
          configuredCode: settings.verificationCode,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.valid) {
        setErrorMsg(
          data.error ||
            "Girdiğiniz doğrulama kodu hatalı. Lütfen tekrar deneyin."
        );
        setLoading(false);
        return;
      }

      await adminUpdateUser(profile.uid, { isVerified: true });
      const refreshed = await getUserProfile(profile.uid);
      if (refreshed) {
        onVerified(refreshed);
      } else {
        onVerified({ ...profile, isVerified: true });
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Doğrulama sırasında bir bağlantı hatası oluştu."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-indigo-500/20 border border-emerald-500/30">
              <KeyRound className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Erişim Doğrulaması
              </span>
              <h1 className="text-xl font-bold text-white">
                Gizli Doğrulama Kodu
              </h1>
            </div>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            title="Çıkış Yap"
            className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-3.5 text-xs text-zinc-400 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-zinc-200">
              {profile.displayName}
            </span>
            <span className="font-mono text-emerald-400">
              @{profile.username}
            </span>
          </div>
          <p className="text-zinc-500">{profile.email}</p>
        </div>

        <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
          <strong className="text-zinc-200">VoxSub Studio</strong>&apos;yu
          kullanmaya başlamak için yöneticinizden aldığınız{" "}
          <span className="text-emerald-300 font-medium">
            Gizli Doğrulama Kodunu
          </span>{" "}
          aşağıya girin. Doğrulama yalnızca bir kez yapılır.
        </p>

        {errorMsg && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-red-200">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleVerifySubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">
              Gizli Doğrulama Kodu
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Doğrulama kodunu girin..."
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-4 py-3 text-sm font-mono tracking-wider text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none uppercase"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-indigo-500 disabled:opacity-50 cursor-pointer transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Kod Doğrulanıyor...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>Kodu Doğrula ve Stüdyoyu Aç</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
