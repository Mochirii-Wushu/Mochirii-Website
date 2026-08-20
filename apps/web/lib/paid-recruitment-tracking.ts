const APPROVED_UTM_CONTENT = new Set(["v3_home_control", "v3_home_enhanced"]);

const APPROVED_ATTRIBUTION_VALUES: Readonly<Record<string, ReadonlySet<string>>> = {
  utm_source: new Set(["fb", "ig"]),
  utm_medium: new Set(["paid_social"]),
  utm_campaign: new Set(["mochirii_recruitment_apac_2026_08"]),
};

export function paidRecruitmentJoinHref(search: string) {
  const input = new URLSearchParams(search);
  const utmContentValues = input.getAll("utm_content");
  if (utmContentValues.length !== 1 || !APPROVED_UTM_CONTENT.has(utmContentValues[0])) {
    return "/join";
  }

  const output = new URLSearchParams();
  for (const [key, allowedValues] of Object.entries(APPROVED_ATTRIBUTION_VALUES)) {
    const values = input.getAll(key);
    if (values.length === 1 && allowedValues.has(values[0])) output.set(key, values[0]);
  }
  output.set("utm_content", utmContentValues[0]);

  return `/join?${output.toString()}`;
}
