# Mochirii release guides

Guides for safely releasing and maintaining the website, storefront theme, and
shared community services.

## Find a guide

- [Current state](CURRENT-STATE.md): recorded releases and outstanding checks.
- [Deployment](deployment.md): release, verification, and rollback.
- [Integration changes](integration-operations-runbook.md): approvals and safety.
- [Repository ownership](repository-ownership.md): where each component belongs.
- [Private live spinner](private-spinner.md): delivery, privacy, and recovery.
- [Verification summaries](evidence/README.md): recording reviewed results.

The `history` directory preserves superseded plans and past release records;
check current guidance before using a historical procedure.

## Related projects

[Mochirii Social](https://github.com/Mochirii-Wushu/Mochirii-Social) owns the
social application and its releases.
[Mochirii Pets](https://github.com/Mochirii-Wushu/Mochirii-Pets) owns the fresh
game foundation. The website currently provides only its concept page and
optional tester doorway; no playable artifact is connected.

## Documentation rules

Keep durable, sanitized guidance here. Put generated screenshots, logs, exports,
and archives in the ignored `.artifacts/operations` directory. Never commit
credentials, private member data, supplier records, or recovery material.

Use focused changes and the required review process. Production changes,
database migrations, secret changes, and storefront publication need the exact
approval described in the relevant guide. A successful source check does not
authorize a release.
