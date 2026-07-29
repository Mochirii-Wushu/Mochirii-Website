import { readFileSync } from "node:fs";

const failures = [];

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function requireSnippets(label, text, snippets) {
  snippets.forEach((snippet) => {
    if (!text.includes(snippet)) failures.push(`${label}: missing ${snippet}`);
  });
}

function forbidSnippets(label, text, snippets) {
  snippets.forEach((snippet) => {
    if (text.includes(snippet)) failures.push(`${label}: forbidden ${snippet}`);
  });
}

const rootPackage = read("package.json");
const webPackage = read("apps/web/package.json");
const checkAll = read("scripts/check-all.mjs");
const envExample = read("apps/web/.env.example");
const config = read("apps/web/lib/supabase/config.ts");
const registry = read("apps/web/lib/supabase/auth-providers.ts");
const policy = read("apps/web/lib/supabase/phone-auth-policy.ts");
const policyTest = read("apps/web/lib/supabase/phone-auth-policy.test.mts");
const auth = read("apps/web/lib/supabase/auth.ts");
const panel = read("apps/web/components/member-workflow/AuthPanel.tsx");
const captcha = read("apps/web/components/member-workflow/AuthCaptcha.tsx");
const nextConfig = read("apps/web/next.config.ts");
const docs = read("docs/multi-provider-login-and-verification.md");

requireSnippets("root package", rootPackage, [
  '"check:phone-auth-abuse-controls": "node scripts/check-phone-auth-abuse-controls.mjs"',
  '"test:phone-auth-policy": "npm --prefix apps/web run test:phone-auth-policy"',
]);
requireSnippets("web package", webPackage, [
  '"test:phone-auth-policy": "node --experimental-default-type=module --experimental-strip-types --test lib/supabase/phone-auth-policy.test.mts"',
]);
requireSnippets("check suite", checkAll, [
  '["check:phone-auth-abuse-controls", ["node", "scripts/check-phone-auth-abuse-controls.mjs"]]',
  '["test:phone-auth-policy", [...npmCommand, "--prefix", "apps/web", "run", "test:phone-auth-policy"]]',
]);

requireSnippets("public env example", envExample, [
  "NEXT_PUBLIC_PHONE_AUTH_READY=false",
  "NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED=false",
  "NEXT_PUBLIC_AUTH_CAPTCHA_PROVIDER=",
  "NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY=",
]);
requireSnippets("public config", config, [
  "NEXT_PUBLIC_AUTH_CAPTCHA_PROVIDER",
  "NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY",
  "authCaptchaSiteKeyConfigured",
]);
requireSnippets("provider registry", registry, [
  "phoneAuthConfigurationReady({",
  'process.env.NEXT_PUBLIC_PHONE_AUTH_READY === "true"',
  'process.env.NEXT_PUBLIC_AUTH_CAPTCHA_ENABLED === "true"',
  "process.env.NEXT_PUBLIC_AUTH_CAPTCHA_PROVIDER",
  "process.env.NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY",
  "supabaseConfigured: isSupabaseConfigured()",
]);

requireSnippets("phone policy", policy, [
  "PHONE_OTP_RESEND_COOLDOWN_MS = 60_000",
  'readiness.captchaProvider === "turnstile"',
  "requirePhoneCaptchaToken",
  "normalizePhoneForOtp",
  "normalizePhoneOtpCode",
  "readPhoneOtpResendDeadline",
  "writePhoneOtpResendDeadline",
]);
requireSnippets("phone policy tests", policyTest, [
  "phone auth requires every explicit readiness input",
  "CAPTCHA tokens are mandatory, opaque, and bounded",
  "resend cooldown is exact, bounded, and ignores corrupt persisted values",
]);

requireSnippets("phone auth client", auth, [
  "if (!phoneAuthReady())",
  "requirePhoneCaptchaToken(captchaToken)",
  "shouldCreateUser: false",
  "captchaToken: cleanCaptchaToken",
]);
forbidSnippets("phone auth client", auth, ["shouldCreateUser = true", "captchaToken?: string"]);

requireSnippets("phone auth panel", panel, [
  "<AuthCaptcha",
  "NEXT_PUBLIC_AUTH_CAPTCHA_SITE_KEY",
  "window.sessionStorage",
  "createPhoneOtpResendDeadline",
  "readPhoneOtpResendDeadline",
  "resendSeconds > 0",
  "disabled={!canRequestPhoneCode}",
]);
forbidSnippets("phone auth panel", panel, ["window.localStorage", "console."]);

requireSnippets("CAPTCHA component", captcha, [
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  'size: "compact"',
  'action: "phone_otp"',
  '"response-field": false',
  '"expired-callback"',
  '"timeout-callback"',
  '"error-callback"',
  "window.turnstile.remove(widgetId)",
]);
forbidSnippets("CAPTCHA component", captcha, ["console.", "localStorage", "sessionStorage"]);

requireSnippets("narrow CAPTCHA CSP", nextConfig, [
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "frame-src 'self' https://discord.com https://open.spotify.com https://challenges.cloudflare.com",
]);

requireSnippets("phone activation docs", docs, [
  "## Phone OTP Activation Gate",
  "shouldCreateUser",
  "60-second session-scoped resend cooldown",
  "Supabase Auth remains the authoritative",
  "Phone remains absent from the public provider allowlist",
]);

const combinedBrowserSource = [config, registry, policy, auth, panel, captcha].join("\n");
forbidSnippets("browser secret boundary", combinedBrowserSource, [
  "AUTH_CAPTCHA_SECRET",
  "TURNSTILE_SECRET",
  "CAPTCHA_SECRET_KEY",
]);

if (failures.length) {
  console.error("Phone auth abuse-control validation failed.");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Phone auth abuse-control validation OK.");
