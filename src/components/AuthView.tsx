"use client";

import React, { useState, useEffect } from "react";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  User as FirebaseUser,
} from "firebase/auth";
import { motion, AnimatePresence } from "framer-motion";
import {
  Subtitles,
  Mail,
  Lock,
  Eye,
  EyeOff,
  User,
  AtSign,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { auth, googleProvider } from "@/lib/firebase";
import {
  createUserProfile,
  getEmailByUsername,
  getUserProfile,
  isUsernameTaken,
  normalizeUsername,
} from "@/lib/userService";
import { UserProfile } from "@/types/user";

interface AuthViewProps {
  pendingGoogleUser: FirebaseUser | null;
  onProfileReady: (profile: UserProfile) => void;
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#EA4335"
        d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z"
      />
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z"
      />
      <path
        fill="#FBBC05"
        d="M5.3 14.8c-.2-.8-.4-1.6-.4-2.5s.2-1.7.4-2.5L1.6 7C.6 9 0 11.2 0 12.3s.6 3.3 1.6 5.3l3.7-2.8z"
      />
      <path
        fill="#34A853"
        d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5L1.6 16c1.9 3.9 5.8 7 10.4 7z"
      />
    </svg>
  );
}

export default function AuthView({
  pendingGoogleUser,
  onProfileReady,
}: AuthViewProps) {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");

  // Login State
  const [loginIdentifier, setLoginIdentifier] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [showLoginPassword, setShowLoginPassword] = useState<boolean>(false);

  // Register State
  const [displayName, setDisplayName] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showRegisterPassword, setShowRegisterPassword] =
    useState<boolean>(false);

  // Username Availability Live Check
  const [checkingUsername, setCheckingUsername] = useState<boolean>(false);
  const [usernameTaken, setUsernameTaken] = useState<boolean>(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean>(false);

  // Google First-Time Profile Completion Modal State
  const [googleStepUser, setGoogleStepUser] = useState<FirebaseUser | null>(
    pendingGoogleUser
  );
  const [googleDisplayName, setGoogleDisplayName] = useState<string>(
    pendingGoogleUser?.displayName || ""
  );
  const [googleUsername, setGoogleUsername] = useState<string>("");
  const [checkingGoogleUsername, setCheckingGoogleUsername] =
    useState<boolean>(false);
  const [googleUsernameTaken, setGoogleUsernameTaken] =
    useState<boolean>(false);
  const [googleUsernameAvailable, setGoogleUsernameAvailable] =
    useState<boolean>(false);

  // General Loading & Error
  const [loading, setLoading] = useState<boolean>(false);
  const [googleLoading, setGoogleLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (pendingGoogleUser) {
      setGoogleStepUser(pendingGoogleUser);
      setGoogleDisplayName(pendingGoogleUser.displayName || "");
      const suggested = normalizeUsername(
        pendingGoogleUser.email?.split("@")[0] || ""
      );
      if (suggested && !googleUsername) {
        setGoogleUsername(suggested);
      }
    }
  }, [pendingGoogleUser, googleUsername]);

  // Canlı @username kontrolü (Kayıt Ol sekmesi)
  useEffect(() => {
    const clean = normalizeUsername(username);
    setUsernameTaken(false);
    setUsernameAvailable(false);

    if (clean.length < 3) {
      setCheckingUsername(false);
      return;
    }

    let cancelled = false;
    setCheckingUsername(true);

    const timer = setTimeout(async () => {
      try {
        const taken = await isUsernameTaken(clean);
        if (!cancelled) {
          setUsernameTaken(taken);
          setUsernameAvailable(!taken);
        }
      } catch {
        // Yoksay
      } finally {
        if (!cancelled) setCheckingUsername(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  // Canlı @username kontrolü (Google Profil Tamamlama Modalı)
  useEffect(() => {
    const clean = normalizeUsername(googleUsername);
    setGoogleUsernameTaken(false);
    setGoogleUsernameAvailable(false);

    if (clean.length < 3) {
      setCheckingGoogleUsername(false);
      return;
    }

    let cancelled = false;
    setCheckingGoogleUsername(true);

    const timer = setTimeout(async () => {
      try {
        const taken = await isUsernameTaken(clean, googleStepUser?.uid);
        if (!cancelled) {
          setGoogleUsernameTaken(taken);
          setGoogleUsernameAvailable(!taken);
        }
      } catch {
        // Yoksay
      } finally {
        if (!cancelled) setCheckingGoogleUsername(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [googleUsername, googleStepUser]);

  const translateFirebaseError = (err: unknown): string => {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (
      code.includes("auth/invalid-credential") ||
      code.includes("auth/wrong-password") ||
      code.includes("auth/user-not-found")
    ) {
      return "E-posta/kullanıcı adı veya şifre hatalı.";
    }
    if (code.includes("auth/email-already-in-use")) {
      return "Bu e-posta adresiyle zaten bir hesap mevcut.";
    }
    if (code.includes("auth/weak-password")) {
      return "Şifreniz en az 6 karakter uzunluğunda olmalıdır.";
    }
    if (code.includes("auth/invalid-email")) {
      return "Lütfen geçerli bir e-posta adresi girin.";
    }
    if (code.includes("auth/popup-closed-by-user")) {
      return "Google giriş penceresi kapatıldı.";
    }
    if (err instanceof Error) return err.message;
    return "İşlem sırasında beklenmeyen bir hata oluştu.";
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const identifier = loginIdentifier.trim();
    if (!identifier || !loginPassword) {
      setErrorMsg("Lütfen e-posta/kullanıcı adı ve şifrenizi girin.");
      return;
    }

    setLoading(true);
    try {
      let targetEmail = identifier;

      // Eğer @username veya e-posta olmayan bir kullanıcı adı girildiyse Firestore'dan e-postayı bul
      if (!identifier.includes("@") || identifier.startsWith("@")) {
        const foundEmail = await getEmailByUsername(identifier);
        if (!foundEmail) {
          setErrorMsg(
            `"${identifier}" kullanıcı adına sahip bir hesap bulunamadı.`
          );
          setLoading(false);
          return;
        }
        targetEmail = foundEmail;
      }

      const credential = await signInWithEmailAndPassword(
        auth,
        targetEmail,
        loginPassword
      );
      const existingProfile = await getUserProfile(credential.user.uid);

      if (existingProfile) {
        onProfileReady(existingProfile);
      } else {
        // Eğer Auth kaydı var ama Firestore kaydı yoksa profil tamamlama ekranını aç
        setGoogleStepUser(credential.user);
        setGoogleDisplayName(
          credential.user.displayName || targetEmail.split("@")[0]
        );
        setGoogleUsername(normalizeUsername(targetEmail.split("@")[0]));
      }
    } catch (err: unknown) {
      setErrorMsg(translateFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanName = displayName.trim();
    const cleanUser = normalizeUsername(username);
    const cleanEmail = email.trim();

    if (!cleanName) {
      setErrorMsg("Lütfen görünen isminizi girin.");
      return;
    }
    if (cleanUser.length < 3) {
      setErrorMsg(
        "Kullanıcı adı (@username) en az 3 karakter olmalı ve sadece küçük harf, rakam veya alt çizgi içermelidir."
      );
      return;
    }
    if (!cleanEmail || !password) {
      setErrorMsg("Lütfen e-posta adresinizi ve şifrenizi girin.");
      return;
    }
    if (password.length < 6) {
      setErrorMsg("Şifreniz en az 6 karakter olmalıdır.");
      return;
    }

    setLoading(true);
    try {
      const taken = await isUsernameTaken(cleanUser);
      if (taken) {
        setUsernameTaken(true);
        setErrorMsg("Bu kullanıcı adı zaten kullanılıyor!");
        setLoading(false);
        return;
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        cleanEmail,
        password
      );

      await updateProfile(credential.user, {
        displayName: cleanName,
      });

      const newProfile = await createUserProfile({
        uid: credential.user.uid,
        email: cleanEmail,
        displayName: cleanName,
        username: cleanUser,
        photoURL: credential.user.photoURL,
      });

      onProfileReady(newProfile);
    } catch (err: unknown) {
      setErrorMsg(translateFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setGoogleLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      const existingProfile = await getUserProfile(user.uid);
      if (existingProfile && existingProfile.username) {
        onProfileReady(existingProfile);
      } else {
        // İlk kez Google ile giriş yapan kullanıcıya "Son Bir Adım: Profilini Tamamla" modalını göster
        setGoogleStepUser(user);
        setGoogleDisplayName(
          user.displayName || user.email?.split("@")[0] || "Kullanıcı"
        );
        const suggested = normalizeUsername(user.email?.split("@")[0] || "");
        setGoogleUsername(suggested);
      }
    } catch (err: unknown) {
      setErrorMsg(translateFirebaseError(err));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleCompleteGoogleProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleStepUser) return;
    setErrorMsg(null);

    const cleanName = googleDisplayName.trim();
    const cleanUser = normalizeUsername(googleUsername);

    if (!cleanName) {
      setErrorMsg("Lütfen görünen isminizi girin.");
      return;
    }
    if (cleanUser.length < 3) {
      setErrorMsg(
        "Kullanıcı adı (@username) en az 3 karakter olmalı ve sadece küçük harf, rakam veya alt çizgi içermelidir."
      );
      return;
    }

    setLoading(true);
    try {
      const taken = await isUsernameTaken(cleanUser, googleStepUser.uid);
      if (taken) {
        setGoogleUsernameTaken(true);
        setErrorMsg("Bu kullanıcı adı zaten kullanılıyor!");
        setLoading(false);
        return;
      }

      if (googleStepUser.displayName !== cleanName) {
        await updateProfile(googleStepUser, { displayName: cleanName });
      }

      const profile = await createUserProfile({
        uid: googleStepUser.uid,
        email: googleStepUser.email || "",
        displayName: cleanName,
        username: cleanUser,
        photoURL: googleStepUser.photoURL,
      });

      setGoogleStepUser(null);
      onProfileReady(profile);
    } catch (err: unknown) {
      setErrorMsg(translateFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* Arka Plan Işıklandırmaları */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-40 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      {/* Google ile İlk Girişte Kullanıcı Adı Seçtirme Modalı */}
      <AnimatePresence>
        {googleStepUser ? (
          <motion.div
            key="google-complete-modal"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-indigo-500/20 border border-emerald-500/30">
                <Sparkles className="h-6 w-6 text-emerald-400" />
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Google Hesabı Bağlandı
                </span>
                <h2 className="text-xl font-bold text-white">
                  Son Bir Adım: Profilini Tamamla
                </h2>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              <span className="text-zinc-200 font-medium">
                {googleStepUser.email}
              </span>{" "}
              ile giriş yaptınız. Devam etmeden önce görünen adınızı düzenleyin
              ve hesabınıza özel benzersiz bir{" "}
              <code className="text-emerald-300">@username</code> seçin.
            </p>

            {errorMsg && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-red-200">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleCompleteGoogleProfile} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Görünen İsim
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="text"
                    required
                    value={googleDisplayName}
                    onChange={(e) => setGoogleDisplayName(e.target.value)}
                    placeholder="Örn: Umut Akıllı"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                  <span>Kullanıcı Adı (@username)</span>
                  <span className="text-[11px] text-zinc-500">
                    Küçük harf, rakam ve alt çizgi (_)
                  </span>
                </label>
                <div className="relative">
                  <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                  <input
                    type="text"
                    required
                    value={googleUsername}
                    onChange={(e) =>
                      setGoogleUsername(normalizeUsername(e.target.value))
                    }
                    placeholder="umut_akilli"
                    className={`w-full rounded-xl border bg-zinc-950/90 pl-10 pr-10 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${
                      googleUsernameTaken
                        ? "border-red-500/70 focus:border-red-500"
                        : googleUsernameAvailable
                        ? "border-emerald-500/70 focus:border-emerald-500"
                        : "border-zinc-800 focus:border-emerald-500"
                    }`}
                  />
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                    {checkingGoogleUsername && (
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                    )}
                    {!checkingGoogleUsername && googleUsernameTaken && (
                      <AlertCircle className="h-4 w-4 text-red-400" />
                    )}
                    {!checkingGoogleUsername && googleUsernameAvailable && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    )}
                  </div>
                </div>
                {googleUsernameTaken && (
                  <p className="text-xs text-red-400">
                    Bu kullanıcı adı zaten kullanılıyor!
                  </p>
                )}
                {googleUsernameAvailable && (
                  <p className="text-xs text-emerald-400">
                    @{googleUsername} kullanılabilir.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || googleUsernameTaken}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-indigo-500 disabled:opacity-50 cursor-pointer transition-all"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Profil Kaydediliyor...</span>
                  </>
                ) : (
                  <>
                    <span>Profili Kaydet ve Devam Et</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          </motion.div>
        ) : (
          /* Ana Giriş Yap / Kayıt Ol Kartı */
          <motion.div
            key="main-auth-card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 sm:p-8 backdrop-blur-xl shadow-2xl space-y-6"
          >
            {/* Logo & Başlık */}
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-indigo-500/20 border border-emerald-500/30 shadow-inner">
                <Subtitles className="h-6 w-6 text-emerald-400" />
              </div>
              <div className="flex items-center justify-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  VoxSub <span className="text-emerald-400">Studio</span>
                </h1>
              </div>
              <p className="text-xs text-zinc-400">
                5 GB+ Video Ses Ayrıştırma & Groq Whisper Altyazı Platformu
              </p>
            </div>

            {/* Üst Sekmeler (Giriş Yap / Kayıt Ol) */}
            <div className="grid grid-cols-2 rounded-xl bg-zinc-950/90 p-1 border border-zinc-800/80">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("login");
                  setErrorMsg(null);
                }}
                className={`rounded-lg py-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === "login"
                    ? "bg-gradient-to-r from-emerald-500/20 to-indigo-500/20 text-emerald-300 border border-emerald-500/30 shadow"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("register");
                  setErrorMsg(null);
                }}
                className={`rounded-lg py-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                  activeTab === "register"
                    ? "bg-gradient-to-r from-emerald-500/20 to-indigo-500/20 text-emerald-300 border border-emerald-500/30 shadow"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Kayıt Ol
              </button>
            </div>

            {/* Hata Mesajı */}
            <AnimatePresence>
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-red-200"
                >
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* GİRİŞ YAP SEKMESİ */}
            {activeTab === "login" ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    E-posta Adresi veya @kullanici_adi
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type="text"
                      required
                      value={loginIdentifier}
                      onChange={(e) => setLoginIdentifier(e.target.value)}
                      placeholder="ornek@gmail.com veya @kullanici"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Şifre
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type={showLoginPassword ? "text" : "password"}
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-10 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      aria-label="Şifreyi Göster/Gizle"
                    >
                      {showLoginPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-indigo-500 disabled:opacity-50 cursor-pointer transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Giriş Yapılıyor...</span>
                    </>
                  ) : (
                    <>
                      <span>Giriş Yap</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-zinc-800" />
                  <span className="flex-shrink mx-3 text-xs text-zinc-500">
                    veya
                  </span>
                  <div className="flex-grow border-t border-zinc-800" />
                </div>

                <button
                  type="button"
                  disabled={loading || googleLoading}
                  onClick={handleGoogleSignIn}
                  className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-zinc-700/80 bg-zinc-950 hover:bg-zinc-900 px-5 py-2.5 text-xs sm:text-sm font-medium text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {googleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span>Google (Gmail) ile Giriş Yap</span>
                </button>
              </form>
            ) : (
              /* KAYIT OL SEKMESİ */
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Görünen İsim
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Örn: Umut Akıllı"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
                    <span>Kullanıcı Adı (@username)</span>
                    <span className="text-[11px] text-zinc-500">
                      Küçük harf, rakam, _
                    </span>
                  </label>
                  <div className="relative">
                    <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) =>
                        setUsername(normalizeUsername(e.target.value))
                      }
                      placeholder="umut_akilli"
                      className={`w-full rounded-xl border bg-zinc-950/90 pl-10 pr-10 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none ${
                        usernameTaken
                          ? "border-red-500/70 focus:border-red-500"
                          : usernameAvailable
                          ? "border-emerald-500/70 focus:border-emerald-500"
                          : "border-zinc-800 focus:border-emerald-500"
                      }`}
                    />
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      {checkingUsername && (
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                      )}
                      {!checkingUsername && usernameTaken && (
                        <AlertCircle className="h-4 w-4 text-red-400" />
                      )}
                      {!checkingUsername && usernameAvailable && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      )}
                    </div>
                  </div>
                  {usernameTaken && (
                    <p className="text-xs text-red-400">
                      Bu kullanıcı adı zaten kullanılıyor!
                    </p>
                  )}
                  {usernameAvailable && (
                    <p className="text-xs text-emerald-400">
                      @{username} kullanılabilir.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    E-posta Adresi
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ornek@gmail.com"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Şifre
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type={showRegisterPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="En az 6 karakter"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/90 pl-10 pr-10 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRegisterPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                      aria-label="Şifreyi Göster/Gizle"
                    >
                      {showRegisterPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || googleLoading || usernameTaken}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-indigo-500 disabled:opacity-50 cursor-pointer transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Hesap Oluşturuluyor...</span>
                    </>
                  ) : (
                    <>
                      <span>Hesap Oluştur</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-zinc-800" />
                  <span className="flex-shrink mx-3 text-xs text-zinc-500">
                    veya
                  </span>
                  <div className="flex-grow border-t border-zinc-800" />
                </div>

                <button
                  type="button"
                  disabled={loading || googleLoading}
                  onClick={handleGoogleSignIn}
                  className="w-full inline-flex items-center justify-center gap-2.5 rounded-xl border border-zinc-700/80 bg-zinc-950 hover:bg-zinc-900 px-5 py-2.5 text-xs sm:text-sm font-medium text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {googleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span>Google (Gmail) ile Kayıt Ol</span>
                </button>
              </form>
            )}

            <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-center gap-2 text-[11px] text-zinc-500">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>
                5 GB+ videolar sunucuya yüklenmeden tarayıcınızda işlenir
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
