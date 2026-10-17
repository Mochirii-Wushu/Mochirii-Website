# Release verification summaries

Keep concise, sanitized summaries in `YYYY-MM-DD/<service>/`.

Each summary should record:

- UTC timestamp and the exact repository commit
- The affected service and a safe reference
- Checks performed and their results
- Recovery or rollback status
- Any remaining approval or verification requirement

Raw logs, screenshots, exports, and generated archives belong in the ignored
`.artifacts/operations` directory. Never include credentials, authorization
headers, cookies, signed URLs, private payloads, member data, or database
connection strings.

See the [release guides](../README.md) for the relevant procedure.
