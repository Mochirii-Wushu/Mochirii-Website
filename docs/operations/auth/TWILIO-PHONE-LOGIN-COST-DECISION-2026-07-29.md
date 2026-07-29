# Twilio Phone Login Cost and Eligibility Decision

Date: 2026-07-29

Decision: `DEFERRED_COST_GATE`.

## Decision evidence

The required gate is a hard, non-trial, production-safe zero-cost ceiling with
no payment method, deposit, credit, promotion, usage fee, number fee, carrier
fee, regulatory fee, or possible billable overage. Current Twilio Verify
pricing charges per successful verification and may add channel fees. A trial
does not prove free production. The gate therefore fails.

Phone login remains disabled and absent from public UI. Do not create a Verify
service, configure Twilio/Supabase phone providers, add secrets, send an OTP,
or add a payment method. No provider mutation is authorized.

## Defensive implementation requirements

Any dormant login-only OTP code must set `shouldCreateUser=false` or its exact
equivalent. A future approved implementation also requires E.164 handling,
CAPTCHA, rate and resend limits, anti-enumeration responses, SIM-swap risk
review, abuse monitoring, deletion/recovery, international regulatory review,
and a tested kill switch. Budget alerts are not a hard cost cap.

## Re-evaluation packet

Re-evaluate only from current official pricing and an authenticated provider
readback proving every zero-cost condition. If any condition fails, retain
`DEFERRED_COST_GATE`; that result does not block other repository work.

## References

- [Twilio Verify pricing](https://www.twilio.com/en-us/verify/pricing)
- [Twilio trial account](https://www.twilio.com/docs/usage/trials)
- [Supabase Phone Login](https://supabase.com/docs/guides/auth/phone-login)
- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
