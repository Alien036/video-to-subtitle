"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Shield,
  Users,
  KeyRound,
  Ban,
  CheckCircle2,
  RefreshCw,
  Search,
  Save,
  RotateCcw,
  Copy,
  Check,
  Sparkles,
  UserCheck,
  UserX,
  Plus,
  Minus,
} from "lucide-react";
import { AppSettings, QuotaPeriod, UserProfile } from "@/types/user";
import {
  adminUpdateUser,
  calculateNextResetTimestamp,
  getAllUsersForAdmin,
  getAppSettings,
  updateAppSettings,
} from "@/lib/userService";

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAdminUid: string;
}

export default function AdminPanelModal({
  isOpen,
  onClose,
  currentAdminUid,
}: AdminPanelModalProps) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "verified" | "unverified" | "blocked"
  >("all");

  // Sistem Ayarları (Gizli Doğrulama Kodu & Varsayılan Kota)
  const [settings, setSettings] = useState<AppSettings>({
    verificationCode: "VOXSUB2026",
    defaultQuotaLimit: 5,
    defaultQuotaPeriod: "weekly",
    updatedAt: Date.now(),
  });
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // İşlem yapılan kullanıcı UID takibi
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const [fetchedUsers, fetchedSettings] = await Promise.all([
        getAllUsersForAdmin(),
        getAppSettings(),
      ]);
      setUsers(fetchedUsers);
      setSettings(fetchedSettings);
    } catch (err) {
      console.error("Admin verileri yüklenemedi:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadAdminData();
    }
  }, [isOpen, loadAdminData]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const updated = await updateAppSettings({
        verificationCode: settings.verificationCode.trim().toUpperCase(),
        defaultQuotaLimit: Math.max(1, Number(settings.defaultQuotaLimit) || 5),
        defaultQuotaPeriod: settings.defaultQuotaPeriod,
      });
      setSettings(updated);
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch (err) {
      console.error("Ayarlar kaydedilemedi:", err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCopySecretCode = async () => {
    await navigator.clipboard.writeText(settings.verificationCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleToggleBlockUser = async (user: UserProfile) => {
    if (user.uid === currentAdminUid) return;
    setUpdatingUid(user.uid);
    try {
      const nextBlocked = !user.isBlocked;
      await adminUpdateUser(user.uid, { isBlocked: nextBlocked });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid ? { ...u, isBlocked: nextBlocked } : u
        )
      );
    } finally {
      setUpdatingUid(null);
    }
  };

  const handleToggleVerifyUser = async (user: UserProfile) => {
    setUpdatingUid(user.uid);
    try {
      const nextVerified = !user.isVerified;
      await adminUpdateUser(user.uid, { isVerified: nextVerified });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid ? { ...u, isVerified: nextVerified } : u
        )
      );
    } finally {
      setUpdatingUid(null);
    }
  };

  const handleAdjustQuotaLimit = async (user: UserProfile, delta: number) => {
    const nextLimit = Math.max(0, (user.quotaLimit || 0) + delta);
    setUpdatingUid(user.uid);
    try {
      await adminUpdateUser(user.uid, { quotaLimit: nextLimit });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid ? { ...u, quotaLimit: nextLimit } : u
        )
      );
    } finally {
      setUpdatingUid(null);
    }
  };

  const handleChangeQuotaPeriod = async (
    user: UserProfile,
    period: QuotaPeriod
  ) => {
    setUpdatingUid(user.uid);
    try {
      const nextReset = calculateNextResetTimestamp(period);
      await adminUpdateUser(user.uid, {
        quotaPeriod: period,
        quotaResetAt: nextReset,
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid
            ? { ...u, quotaPeriod: period, quotaResetAt: nextReset }
            : u
        )
      );
    } finally {
      setUpdatingUid(null);
    }
  };

  const handleResetUserQuota = async (user: UserProfile) => {
    setUpdatingUid(user.uid);
    try {
      const nextReset = calculateNextResetTimestamp(
        user.quotaPeriod || "weekly"
      );
      await adminUpdateUser(user.uid, {
        quotaUsed: 0,
        quotaResetAt: nextReset,
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid
            ? { ...u, quotaUsed: 0, quotaResetAt: nextReset }
            : u
        )
      );
    } finally {
      setUpdatingUid(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (u.displayName || "").toLowerCase().includes(q) ||
      (u.username || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (statusFilter === "verified") return u.isVerified && !u.isBlocked;
    if (statusFilter === "unverified") return !u.isVerified && !u.isBlocked;
    if (statusFilter === "blocked") return u.isBlocked;
    return true;
  });

  const totalUsersCount = users.length;
  const verifiedUsersCount = users.filter(
    (u) => u.isVerified && !u.isBlocked
  ).length;
  const blockedUsersCount = users.filter((u) => u.isBlocked).length;
  const totalVideosCount = users.reduce(
    (acc, u) => acc + (u.totalProcessed || 0),
    0
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden"
          >
            {/* Üst Başlık */}
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-indigo-500/20 border border-emerald-500/30">
                  <Shield className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>VoxSub Admin Paneli</span>
                    <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                      Tam Yetki
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Gizli Doğrulama Kodu, Kullanıcı Kota Yönetimi ve Kullanıcı
                    Engelleme Merkezi
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadAdminData}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                  />
                  <span>Yenile</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* İçerik Gövdesi */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Özet İstatistik Kartları */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Toplam Kullanıcı</span>
                    <Users className="h-4 w-4 text-indigo-400" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-white">
                    {totalUsersCount}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Doğrulanmış Aktif</span>
                    <UserCheck className="h-4 w-4 text-emerald-400" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-emerald-400">
                    {verifiedUsersCount}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Engellenen Kullanıcı</span>
                    <UserX className="h-4 w-4 text-red-400" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-red-400">
                    {blockedUsersCount}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-4">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Toplam İşlenen Video</span>
                    <Sparkles className="h-4 w-4 text-indigo-400" />
                  </div>
                  <p className="mt-2 text-2xl font-bold text-indigo-300">
                    {totalVideosCount}
                  </p>
                </div>
              </div>

              {/* Gizli Doğrulama Kodu & Varsayılan Kota Ayarları */}
              <form
                onSubmit={handleSaveSettings}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-white">
                      Gizli Doğrulama Kodu & Yeni Üye Varsayılan Kota Ayarları
                    </h3>
                  </div>
                  <span className="text-[11px] text-zinc-400">
                    Bu kodu paylaştığınız kullanıcılar hesaplarını anında
                    doğrulayabilir
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-zinc-300">
                      Aktif Gizli Doğrulama Kodu
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        value={settings.verificationCode}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            verificationCode: e.target.value.toUpperCase(),
                          }))
                        }
                        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm font-mono uppercase tracking-wider text-emerald-300 focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleCopySecretCode}
                        title="Kodu Kopyala"
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 cursor-pointer"
                      >
                        {copiedCode ? (
                          <Check className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Copy className="h-4 w-4 text-zinc-400" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-300">
                      Varsayılan Kota Hakkı
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={settings.defaultQuotaLimit}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            defaultQuotaLimit: Number(e.target.value) || 5,
                          }))
                        }
                        className="w-24 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-mono text-zinc-100 focus:border-emerald-500 focus:outline-none"
                      />
                      <select
                        value={settings.defaultQuotaPeriod}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            defaultQuotaPeriod: e.target.value as QuotaPeriod,
                          }))
                        }
                        className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="weekly">Haftalık</option>
                        <option value="monthly">Aylık</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-zinc-950 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {settingsSaved ? (
                        <>
                          <Check className="h-4 w-4" />
                          <span>Ayarlar Kaydedildi</span>
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          <span>Ayarları Kaydet</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>

              {/* Kullanıcı Arama & Filtreleme */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="İsim, @username veya e-posta ile kullanıcı ara..."
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 pl-10 pr-4 py-2 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: "all", label: "Tümü" },
                        { id: "verified", label: "Doğrulanmış" },
                        { id: "unverified", label: "Onay Bekleyen" },
                        { id: "blocked", label: "Engellenenler" },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setStatusFilter(tab.id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                          statusFilter === tab.id
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kullanıcı Tablosu */}
                <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/30">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/80 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        <th className="py-3.5 px-4">Kullanıcı</th>
                        <th className="py-3.5 px-4">Durum</th>
                        <th className="py-3.5 px-4">Kullanım Kotası</th>
                        <th className="py-3.5 px-4">Periyot</th>
                        <th className="py-3.5 px-4 text-right">
                          Yönetim & Engelleme
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70 text-xs sm:text-sm">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-10 text-center text-zinc-500 text-sm"
                          >
                             kriterlere uygun kullanıcı bulunamadı.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((u) => {
                          const isSelfAdmin =
                            u.uid === currentAdminUid || u.role === "admin";
                          const isBusy = updatingUid === u.uid;

                          return (
                            <tr
                              key={u.uid}
                              className={`transition-colors ${
                                u.isBlocked
                                  ? "bg-red-950/20 hover:bg-red-950/30"
                                  : "hover:bg-zinc-900/60"
                              }`}
                            >
                              {/* Kullanıcı Bilgisi */}
                              <td className="py-3.5 px-4">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-white">
                                      {u.displayName || "İsimsiz"}
                                    </span>
                                    <span className="font-mono text-xs text-emerald-400">
                                      @{u.username || "kullanici"}
                                    </span>
                                    {u.role === "admin" && (
                                      <span className="rounded bg-indigo-500/20 border border-indigo-500/40 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                                        ADMIN
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs text-zinc-500">
                                    {u.email}
                                  </span>
                                </div>
                              </td>

                              {/* Durum Rozeti */}
                              <td className="py-3.5 px-4">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {u.isBlocked ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2.5 py-0.5 text-xs font-medium text-red-300">
                                      <Ban className="h-3 w-3" />
                                      <span>Engellendi</span>
                                    </span>
                                  ) : u.isVerified ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                                      <CheckCircle2 className="h-3 w-3" />
                                      <span>Doğrulandı</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2.5 py-0.5 text-xs font-medium text-amber-300">
                                      <span>Kod Bekliyor</span>
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Kullanım Kotası */}
                              <td className="py-3.5 px-4">
                                {u.role === "admin" ? (
                                  <span className="font-mono text-xs text-indigo-300">
                                    Sınırsız ({u.totalProcessed || 0} işlendi)
                                  </span>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1">
                                      {u.quotaUsed || 0} / {u.quotaLimit ?? 5}{" "}
                                      Hak
                                    </span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          handleAdjustQuotaLimit(u, -1)
                                        }
                                        title="Kota Azalt (-1)"
                                        className="rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                                      >
                                        <Minus className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          handleAdjustQuotaLimit(u, 1)
                                        }
                                        title="Kota Artır (+1)"
                                        className="rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
                                      >
                                        <Plus className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleResetUserQuota(u)}
                                        title="Kullanılan Kotayı Sıfırla (0 yap)"
                                        className="rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-indigo-400 hover:bg-zinc-800 cursor-pointer"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Kota Periyodu */}
                              <td className="py-3.5 px-4">
                                {u.role === "admin" ? (
                                  <span className="text-xs text-zinc-500">
                                    Süresiz
                                  </span>
                                ) : (
                                  <select
                                    disabled={isBusy}
                                    value={u.quotaPeriod || "weekly"}
                                    onChange={(e) =>
                                      handleChangeQuotaPeriod(
                                        u,
                                        e.target.value as QuotaPeriod
                                      )
                                    }
                                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                                  >
                                    <option value="weekly">Haftalık</option>
                                    <option value="monthly">Aylık</option>
                                  </select>
                                )}
                              </td>

                              {/* Aksiyonlar: Doğrulama & Kullanıcı Engelleme */}
                              <td className="py-3.5 px-4 text-right">
                                <div className="inline-flex items-center justify-end gap-2">
                                  {!isSelfAdmin && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          handleToggleVerifyUser(u)
                                        }
                                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                                          u.isVerified
                                            ? "border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                                            : "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30"
                                        }`}
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        <span>
                                          {u.isVerified
                                            ? "Onayı Kaldır"
                                            : "Doğrula"}
                                        </span>
                                      </button>

                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleToggleBlockUser(u)}
                                        className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                                          u.isBlocked
                                            ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                                            : "bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30"
                                        }`}
                                      >
                                        <Ban className="h-3.5 w-3.5" />
                                        <span>
                                          {u.isBlocked
                                            ? "Engeli Kaldır"
                                            : "Kullanıcıyı Engelle"}
                                        </span>
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
