export type SafeMetaTelemetry = {
  provider?: "facebook_page" | "instagram";
  destination?: "facebook_page" | "instagram";
  stage?: string;
  outcome?: string;
  errorCategory?: string;
  statusCode?: number;
  configured?: boolean;
  publishEnabled?: boolean;
  identityMatches?: boolean;
  quotaReadable?: boolean;
};

const SAFE_LABEL_RE = /^[a-z][a-z0-9_]{0,79}$/;

function safeLabel(value: unknown): string | undefined {
  const label = String(value ?? "").trim().toLowerCase();
  return SAFE_LABEL_RE.test(label) ? label : undefined;
}

export function safeMetaTelemetryFields(
  values: Record<string, unknown>,
): SafeMetaTelemetry {
  const statusCode = Number(values.statusCode);
  return {
    provider: values.provider === "facebook_page" ||
        values.provider === "instagram"
      ? values.provider
      : undefined,
    destination: values.destination === "facebook_page" ||
        values.destination === "instagram"
      ? values.destination
      : undefined,
    stage: safeLabel(values.stage),
    outcome: safeLabel(values.outcome),
    errorCategory: safeLabel(values.errorCategory),
    statusCode: Number.isSafeInteger(statusCode) &&
        statusCode >= 100 && statusCode <= 599
      ? statusCode
      : undefined,
    configured: typeof values.configured === "boolean"
      ? values.configured
      : undefined,
    publishEnabled: typeof values.publishEnabled === "boolean"
      ? values.publishEnabled
      : undefined,
    identityMatches: typeof values.identityMatches === "boolean"
      ? values.identityMatches
      : undefined,
    quotaReadable: typeof values.quotaReadable === "boolean"
      ? values.quotaReadable
      : undefined,
  };
}

export function logSafeMetaEvent(
  level: "info" | "warn" | "error",
  event: string,
  values: Record<string, unknown> = {},
): void {
  const safeEvent = safeLabel(event) || "meta_gallery_event";
  console[level](safeEvent, safeMetaTelemetryFields(values));
}
