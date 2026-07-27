// Relay-host-only configuration. Supabase Edge entrypoints must never import
// this module; it contains the upstream connection boundary and key checks.
export const PROVIDER_BASE_URLS = {
  sandbox: "https://testflight.tremendous.com/api/v2",
  production: "https://api.tremendous.com/api/v2",
} as const;

export type ProviderMode = "disabled" | "sandbox" | "production";

export type ProviderEnvironmentValidation =
  | {
    ok: true;
    mode: ProviderMode;
    baseUrl: string | null;
    ordersEnabled: boolean;
  }
  | {
    ok: false;
    reason:
      | "invalid_mode"
      | "orders_disabled"
      | "missing_api_key"
      | "key_environment_mismatch"
      | "missing_organization"
      | "missing_campaign";
  };

export function validateProviderEnvironment(input: {
  mode: string | null | undefined;
  apiKey: string | null | undefined;
  expectedOrganizationId: string | null | undefined;
  campaignId: string | null | undefined;
  ordersEnabled: boolean;
}): ProviderEnvironmentValidation {
  const mode = String(input.mode || "disabled").trim().toLowerCase();
  if (mode !== "disabled" && mode !== "sandbox" && mode !== "production") {
    return { ok: false, reason: "invalid_mode" };
  }
  if (mode === "disabled") {
    return input.ordersEnabled
      ? { ok: false, reason: "orders_disabled" }
      : { ok: true, mode, baseUrl: null, ordersEnabled: false };
  }
  if (!input.ordersEnabled) return { ok: false, reason: "orders_disabled" };
  const apiKey = String(input.apiKey || "");
  if (!apiKey) return { ok: false, reason: "missing_api_key" };
  const expectedPrefix = mode === "sandbox" ? "TEST_" : "PROD_";
  if (!apiKey.startsWith(expectedPrefix)) {
    return { ok: false, reason: "key_environment_mismatch" };
  }
  if (!safeIdentifier(input.expectedOrganizationId)) {
    return { ok: false, reason: "missing_organization" };
  }
  if (!safeIdentifier(input.campaignId)) {
    return { ok: false, reason: "missing_campaign" };
  }
  return {
    ok: true,
    mode,
    baseUrl: PROVIDER_BASE_URLS[mode],
    ordersEnabled: true,
  };
}

function safeIdentifier(value: unknown): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(
    String(value || "").trim(),
  );
}
