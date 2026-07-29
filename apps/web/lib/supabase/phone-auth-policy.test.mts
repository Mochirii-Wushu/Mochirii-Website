import assert from "node:assert/strict";
import test from "node:test";
import {
  PHONE_OTP_REQUEST_PUBLIC_MESSAGE,
  PHONE_OTP_VERIFY_PUBLIC_ERROR_MESSAGE,
  PHONE_OTP_RESEND_COOLDOWN_MS,
  PHONE_OTP_RESEND_STORAGE_KEY,
  createPhoneOtpResendDeadline,
  normalizePhoneForOtp,
  normalizePhoneOtpCode,
  phoneAuthConfigurationReady,
  phoneOtpRequestPublicOutcome,
  phoneOtpResendSecondsRemaining,
  readPhoneOtpResendDeadline,
  requirePhoneCaptchaToken,
  writePhoneOtpResendDeadline,
} from "./phone-auth-policy.ts";

function readiness(overrides: Partial<Parameters<typeof phoneAuthConfigurationReady>[0]> = {}) {
  return {
    phoneAuthReady: true,
    captchaEnabled: true,
    captchaProvider: "turnstile",
    captchaSiteKey: "public-site-key",
    supabaseConfigured: true,
    ...overrides,
  };
}

test("phone auth requires every explicit readiness input", () => {
  assert.equal(phoneAuthConfigurationReady(readiness()), true);
  assert.equal(phoneAuthConfigurationReady(readiness({ phoneAuthReady: false })), false);
  assert.equal(phoneAuthConfigurationReady(readiness({ captchaEnabled: false })), false);
  assert.equal(phoneAuthConfigurationReady(readiness({ captchaProvider: "" })), false);
  assert.equal(phoneAuthConfigurationReady(readiness({ captchaProvider: "hcaptcha" })), false);
  assert.equal(phoneAuthConfigurationReady(readiness({ captchaSiteKey: "  " })), false);
  assert.equal(phoneAuthConfigurationReady(readiness({ supabaseConfigured: false })), false);
});

test("phone auth remains closed for every partial activation state", () => {
  const readinessInputs = 5;
  const fullyReadyMask = (1 << readinessInputs) - 1;

  for (let mask = 0; mask < fullyReadyMask; mask += 1) {
    const partial = readiness({
      phoneAuthReady: Boolean(mask & 1),
      captchaEnabled: Boolean(mask & 2),
      captchaProvider: mask & 4 ? "turnstile" : "",
      captchaSiteKey: mask & 8 ? "public-site-key" : "",
      supabaseConfigured: Boolean(mask & 16),
    });
    assert.equal(phoneAuthConfigurationReady(partial), false);
  }
});

test("phone OTP request responses do not disclose provider account lookup results", () => {
  const accepted = phoneOtpRequestPublicOutcome(null);
  const unknownAccount = phoneOtpRequestPublicOutcome(new Error("User not found"));
  const existingAccountFailure = phoneOtpRequestPublicOutcome(new Error("SMS delivery failed"));

  assert.deepEqual(unknownAccount, accepted);
  assert.deepEqual(existingAccountFailure, accepted);
  assert.equal(accepted.message, PHONE_OTP_REQUEST_PUBLIC_MESSAGE);
  assert.match(PHONE_OTP_VERIFY_PUBLIC_ERROR_MESSAGE, /could not be confirmed/i);
  assert.doesNotMatch(accepted.message, /sent|exists|found|registered/i);
});

test("CAPTCHA tokens are mandatory, opaque, and bounded", () => {
  assert.equal(requirePhoneCaptchaToken("  opaque-token  "), "opaque-token");
  assert.throws(() => requirePhoneCaptchaToken(""), /verification challenge/i);
  assert.throws(() => requirePhoneCaptchaToken("x".repeat(4_097)), /verification challenge/i);
});

test("phone and OTP input normalization is strict without storing either value", () => {
  assert.equal(normalizePhoneForOtp(" +1 (555) 010-0000 "), "+15550100000");
  assert.throws(() => normalizePhoneForOtp("15550100000"), /country code/i);
  assert.throws(() => normalizePhoneForOtp("+0123"), /valid phone/i);
  assert.equal(normalizePhoneOtpCode(" 123456 "), "123456");
  assert.throws(() => normalizePhoneOtpCode("12345"), /verification code/i);
  assert.throws(() => normalizePhoneOtpCode("12345a"), /verification code/i);
});

test("resend cooldown is exact, bounded, and ignores corrupt persisted values", () => {
  const now = 1_000_000;
  const deadline = createPhoneOtpResendDeadline(now);
  assert.equal(deadline, now + PHONE_OTP_RESEND_COOLDOWN_MS);
  assert.equal(phoneOtpResendSecondsRemaining(deadline, now), 60);
  assert.equal(phoneOtpResendSecondsRemaining(deadline, now + 59_001), 1);
  assert.equal(phoneOtpResendSecondsRemaining(deadline, deadline), 0);

  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };

  writePhoneOtpResendDeadline(storage, deadline);
  assert.equal(values.get(PHONE_OTP_RESEND_STORAGE_KEY), String(deadline));
  assert.equal(readPhoneOtpResendDeadline(storage, now), deadline);

  values.set(PHONE_OTP_RESEND_STORAGE_KEY, "not-a-number");
  assert.equal(readPhoneOtpResendDeadline(storage, now), 0);
  assert.equal(values.has(PHONE_OTP_RESEND_STORAGE_KEY), false);

  values.set(PHONE_OTP_RESEND_STORAGE_KEY, String(deadline + 1));
  assert.equal(readPhoneOtpResendDeadline(storage, now), 0);
});
