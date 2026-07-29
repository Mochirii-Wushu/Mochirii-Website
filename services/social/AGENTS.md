# Mochirii Social Guidance

- This directory remains the sole production source and immutable-image owner for
  `social.mochirii.com` until the separately approved Social history extraction,
  target CI, immutable-image parity, runtime cutover, and rollback checks all
  pass. `Mochirii-Wushu/Mochirii-Social` is only the intended target before
  that acceptance; do not delete this tree or grant both repositories active
  publication or deployment authority.
- Preserve upstream license and attribution. Upstream names may remain in code,
  dependencies, compatibility notes, and license files, but not in rendered
  Mochirii member-facing copy.
- Keep registration closed and ActivityPub federation disabled.
- Never commit runtime `.env` files, OAuth keys, database/media/cache state,
  backups, host addresses, credentials, or generated archives.
- Run Social commands from this directory. Use the repository workflows for
  image publication, deployment, recovery, and hosted verification.
- Production accepts only an immutable reviewed GHCR digest. Database
  migrations require a verified backup and explicit migration approval.
- Do not change DNS, Cloudflare, Spaces configuration, Droplet sizing, or
  federation as part of ordinary Social source work.
