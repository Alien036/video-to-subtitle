import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AppSettings, QuotaPeriod, UserProfile } from "@/types/user";

const DEFAULT_ADMIN_EMAILS =
  "umutakilli4646@gmail.com,mali190346@gmail.com";

export function getAdminEmails(): string[] {
  const combined = `${process.env.NEXT_PUBLIC_ADMIN_EMAIL || ""},${DEFAULT_ADMIN_EMAILS}`;
  return Array.from(
    new Set(
      combined
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export const DEFAULT_VERIFICATION_CODE = "VOXSUB2026";
export const DEFAULT_QUOTA_LIMIT = 5;
export const DEFAULT_QUOTA_PERIOD: QuotaPeriod = "weekly";

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const adminEmails = getAdminEmails();
  return adminEmails.includes(email.trim().toLowerCase());
}

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "");
}

export function calculateNextResetTimestamp(period: QuotaPeriod): number {
  const now = Date.now();
  const days = period === "monthly" ? 30 : 7;
  return now + days * 24 * 60 * 60 * 1000;
}

export async function getAppSettings(): Promise<AppSettings> {
  try {
    const ref = doc(db, "settings", "appConfig");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as Partial<AppSettings>;
      return {
        verificationCode: data.verificationCode || DEFAULT_VERIFICATION_CODE,
        defaultQuotaLimit:
          typeof data.defaultQuotaLimit === "number"
            ? data.defaultQuotaLimit
            : DEFAULT_QUOTA_LIMIT,
        defaultQuotaPeriod: data.defaultQuotaPeriod || DEFAULT_QUOTA_PERIOD,
        updatedAt: data.updatedAt || Date.now(),
      };
    }
  } catch (err) {
    console.warn("Varsayılan uygulama ayarları okunamadı:", err);
  }

  return {
    verificationCode: DEFAULT_VERIFICATION_CODE,
    defaultQuotaLimit: DEFAULT_QUOTA_LIMIT,
    defaultQuotaPeriod: DEFAULT_QUOTA_PERIOD,
    updatedAt: Date.now(),
  };
}

export async function updateAppSettings(
  partial: Partial<Omit<AppSettings, "updatedAt">>
): Promise<AppSettings> {
  const current = await getAppSettings();
  const updated: AppSettings = {
    ...current,
    ...partial,
    updatedAt: Date.now(),
  };
  const ref = doc(db, "settings", "appConfig");
  await setDoc(ref, updated, { merge: true });
  return updated;
}

/**
 * Kullanıcı adının (@username) başka bir kullanıcı tarafından alınıp alınmadığını kontrol eder.
 */
export async function isUsernameTaken(
  username: string,
  excludeUid?: string
): Promise<boolean> {
  const clean = normalizeUsername(username);
  if (!clean) return false;

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", clean));
  const snapshot = await getDocs(q);

  if (snapshot.empty) return false;
  if (!excludeUid) return true;

  return snapshot.docs.some((d) => d.id !== excludeUid);
}

/**
 * Kullanıcı adı (@username) ile giriş yapılmak istendiğinde e-posta adresini bulur.
 */
export async function getEmailByUsername(
  username: string
): Promise<string | null> {
  const clean = normalizeUsername(username);
  if (!clean) return null;

  const usersRef = collection(db, "users");
  const q = query(usersRef, where("username", "==", clean));
  const snapshot = await getDocs(q);

  if (snapshot.empty) return null;
  const userData = snapshot.docs[0].data() as Partial<UserProfile>;
  return userData.email || null;
}

/**
 * UID ile kullanıcı profilini getirir, admin e-postasıysa otomatik admin'e yükseltir
 * ve kota sıfırlama zamanı geçmişse otomatik sıfırlar.
 */
export async function getUserProfile(
  uid: string,
  authEmail?: string | null
): Promise<UserProfile | null> {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    return null;
  }

  const data = snap.data() as UserProfile;
  const now = Date.now();
  const effectiveEmail = data.email || authEmail || "";
  const isUserAdmin =
    isAdminEmail(effectiveEmail) ||
    data.role === "admin" ||
    Boolean(data.isAdmin);

  // Admin e-postasıysa (daha önce user olarak kayıt olmuş olsa bile) Firestore'da otomatik Admin'e yükselt
  if (
    isUserAdmin &&
    (data.role !== "admin" ||
      !data.isAdmin ||
      !data.isVerified ||
      data.isBlocked)
  ) {
    const adminUpgrades: Partial<UserProfile> = {
      role: "admin",
      isAdmin: true,
      isVerified: true,
      isBlocked: false,
      quotaLimit: 999999,
      lastLoginAt: now,
    };
    await updateDoc(userRef, adminUpgrades);
    return {
      ...data,
      ...adminUpgrades,
    };
  }

  // Kota periyodu süresi dolmuşsa otomatik sıfırla
  if (data.quotaResetAt && now >= data.quotaResetAt) {
    const nextReset = calculateNextResetTimestamp(
      data.quotaPeriod || DEFAULT_QUOTA_PERIOD
    );
    const updatedFields: Partial<UserProfile> = {
      quotaUsed: 0,
      quotaResetAt: nextReset,
      lastLoginAt: now,
    };
    await updateDoc(userRef, updatedFields);
    return {
      ...data,
      ...updatedFields,
      role: isUserAdmin ? "admin" : data.role || "user",
      isAdmin: isUserAdmin,
      isVerified: isUserAdmin ? true : Boolean(data.isVerified),
    };
  }

  return {
    ...data,
    role: isUserAdmin ? "admin" : data.role || "user",
    isAdmin: isUserAdmin,
    isVerified: isUserAdmin ? true : Boolean(data.isVerified),
  };
}

/**
 * Yeni kullanıcı profilini Firestore `users/{uid}` altında oluşturur.
 */
export async function createUserProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  photoURL?: string | null;
}): Promise<UserProfile> {
  const settings = await getAppSettings();
  const cleanUsername = normalizeUsername(params.username);
  const now = Date.now();
  const adminFlag = isAdminEmail(params.email);

  const profile: UserProfile = {
    uid: params.uid,
    email: params.email.trim(),
    displayName: params.displayName.trim(),
    username: cleanUsername,
    photoURL: params.photoURL || null,
    role: adminFlag ? "admin" : "user",
    isAdmin: adminFlag,
    isVerified: adminFlag ? true : false,
    isBlocked: false,
    quotaPeriod: settings.defaultQuotaPeriod,
    quotaLimit: adminFlag ? 999999 : settings.defaultQuotaLimit,
    quotaUsed: 0,
    quotaResetAt: calculateNextResetTimestamp(settings.defaultQuotaPeriod),
    totalProcessed: 0,
    createdAt: now,
    lastLoginAt: now,
  };

  await setDoc(doc(db, "users", params.uid), profile);
  return profile;
}

/**
 * Kullanıcının kullanım kotasından 1 hak düşer (veya kullanılan sayacı +1 artırır).
 */
export async function consumeUserQuota(uid: string): Promise<UserProfile | null> {
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    quotaUsed: increment(1),
    totalProcessed: increment(1),
    lastLoginAt: Date.now(),
  });
  return await getUserProfile(uid);
}

/**
 * Admin Paneli için tüm kullanıcıları getirir (Admin listesindeki e-postaları otomatik yükseltir).
 */
export async function getAllUsersForAdmin(): Promise<UserProfile[]> {
  const usersRef = collection(db, "users");
  const snapshot = await getDocs(usersRef);
  const list: UserProfile[] = [];
  const upgradePromises: Promise<unknown>[] = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data() as UserProfile;
    const adminFlag =
      isAdminEmail(data.email) ||
      data.role === "admin" ||
      Boolean(data.isAdmin);

    if (
      adminFlag &&
      (data.role !== "admin" || !data.isAdmin || !data.isVerified)
    ) {
      upgradePromises.push(
        updateDoc(doc(db, "users", docSnap.id), {
          role: "admin",
          isAdmin: true,
          isVerified: true,
          isBlocked: false,
          quotaLimit: 999999,
        }).catch(() => {})
      );
    }

    list.push({
      ...data,
      role: adminFlag ? "admin" : data.role || "user",
      isAdmin: adminFlag,
      isVerified: adminFlag ? true : Boolean(data.isVerified),
    });
  });

  if (upgradePromises.length > 0) {
    await Promise.all(upgradePromises);
  }

  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/**
 * Admin: Kullanıcı alanlarını günceller (Engelleme, Doğrulama, Kota Limiti, Kota Periyodu, Kota Sıfırlama).
 */
export async function adminUpdateUser(
  uid: string,
  updates: Partial<UserProfile>
): Promise<void> {
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, updates);
}
