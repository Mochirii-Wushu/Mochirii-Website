# Supabase Backend Guidance

- Keep schema changes migration-based and Edge Function changes scoped.
- Preserve RLS, explicit grants, JWT/signature/shared-secret boundaries, and
  fail-closed behavior.
- Read runtime secrets only through `Deno.env`; never print, hash, cache, or
  expose secret values.
- Browser and leader-facing messages use product language such as `Member user
  ID`, not infrastructure terminology.
- The Website repository remains the production owner of every configured Edge
  Function until an exact, separately approved cutover. The Reaper target may
  prepare only the six bot-owned candidates named in the repository-separation
  ADR; candidate source must not deploy, remove Website source, change the
  configured inventory, or create a second active deployment owner. Preserve
  Discord signature checks, role authorization, and `allowed_mentions`
  containment throughout the transition.
- Do not deploy functions, mutate secrets, or change the production database
  outside an explicitly approved release packet.
