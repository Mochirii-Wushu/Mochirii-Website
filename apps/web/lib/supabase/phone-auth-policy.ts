export const PHONE_OTP_RESEND_COOLDOWN_MS = 60_000;
export const PHONE_OTP_RESEND_STORAGE_KEY = "mochirii:phone-otp:resend-after";
export const PHONE_CAPTCHA_RESPONSE_MAX_CHARS = 4_096;

export type PhoneCaptchaProvider = "turnstile";

export type PhoneAuthReadiness = {
  phoneAuthReady: boolean;
  captchaEnabled: boolean;
  captchaProvider: string;
  captchaSiteKey: string;
  supabaseConfigured: boolean;
};

type ResendStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function phoneAuthConfigurationReady(readiness: PhoneAuthReadiness) {
  return (
    readiness.phoneAuthReady &&
    readiness.captchaEnabled &&
    readiness.captchaProvider === "turnstile" &&
    Boolean(readiness.captchaSiteKey.trim()) &&
    readiness.supabaseConfigured
  );
}

export function requirePhoneCaptchaToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token || token.length > PHONE_CAPTCHA_RESPONSE_MAX_CHARS) {
    throw new Error("Complete the verification challenge before requesting a code.");
  }
  return token;
}

export function normalizePhoneForOtp(value: unknown) {
  const phone = typeof value === "string" ? value.trim() : "";
  if (!phone.startsWith("+")) {
    throw new Error("Enter a phone number with its country code, beginning with +.");
  }

  const normalized = `+${phone.slice(1).replace(/[\s().-]/g, "")}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Enter a valid phone number with its country code.");
  }
  return normalized;
}

export function normalizePhoneOtpCode(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!/^\d{6,10}$/.test(token)) {
    throw new Error("Enter the verification code from your phone.");
  }
  return token;
}

export function createPhoneOtpResendDeadline(nowMs: number) {
  return Math.max(0, Math.trunc(nowMs)) + PHONE_OTP_RESEND_COOLDOWN_MS;
}

export function phoneOtpResendSecondsRemaining(deadlineMs: number, nowMs: number) {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1_000));
}

export function readPhoneOtpResendDeadline(storage: ResendStorage, nowMs: number) {
  const raw = storage.getItem(PHONE_OTP_RESEND_STORAGE_KEY);
  const deadline = Number(raw);
  const latestAllowed = nowMs + PHONE_OTP_RESEND_COOLDOWN_MS;

  if (!Number.isFinite(deadline) || deadline <= nowMs || deadline > latestAllowed) {
    storage.removeItem(PHONE_OTP_RESEND_STORAGE_KEY);
    return 0;
  }
  return deadline;
}

export function writePhoneOtpResendDeadline(storage: ResendStorage, deadlineMs: number) {
  storage.setItem(PHONE_OTP_RESEND_STORAGE_KEY, String(Math.trunc(deadlineMs)));
}
