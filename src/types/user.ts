export type QuotaPeriod = "weekly" | "monthly";

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  photoURL?: string | null;
  role: "admin" | "user";
  isVerified: boolean;
  isBlocked: boolean;
  quotaPeriod: QuotaPeriod;
  quotaLimit: number;
  quotaUsed: number;
  quotaResetAt: number; // Unix timestamp (ms)
  totalProcessed: number;
  createdAt: number;
  lastLoginAt: number;
}

export interface AppSettings {
  verificationCode: string;
  defaultQuotaLimit: number;
  defaultQuotaPeriod: QuotaPeriod;
  updatedAt: number;
}
