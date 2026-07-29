# Media Spaces Readiness

Broad member uploads must wait until Mochirii Social uses a dedicated
DigitalOcean Space as primary media storage. The policy is large member uploads
with hard safety caps, not unlimited uploads.

## Storage Boundary

- Use one dedicated DigitalOcean Space for Mochirii Social media.
- Keep bucket listing disabled.
- Keep access keys on the Droplet only.
- Use least-privilege keys where the provider allows it.
- Keep backups separate from public media.
- Do not share the media bucket with database backups or private host notes.

The authenticated application gateway, two-factor checkpoint, and request
limits are specified in [Private Media Authentication](private-media-authentication.md).

## Upload Safety

Before broad member upload testing, verify:

- Allowlisted image and video MIME types.
- Server-side file type validation.
- Generated filenames and paths.
- Hard file-size and dimension caps.
- Pixelfed image resize/optimization enabled before custom code.
- EXIF and metadata stripping for generated display assets.
- Thumbnail generation for grid and profile surfaces.
- Rejection of oversized and invalid file uploads.
- Virus or malware scanning if available in the selected runtime.
- local-after-cloud cleanup so Droplet disk does not remain the long-term media
  store after successful cloud upload.

## Image Optimization Policy

Member uploads should feel forgiving, but they are not unlimited. Use large
member uploads with hard safety caps, then keep optimized derivatives as the
long-term media.

- Production cap: `90 MiB` at Pixelfed, `95 MiB` per PHP file, `100 MiB`
  per PHP request, and `100 MB` at Caddy. The layered margin keeps multipart
  overhead below the proxied request ceiling.
- Originals are processing inputs only and should be deleted after successful
  optimized media plus thumbnail upload.
- Post images preserve aspect ratio, do not upscale, and target an
  Instagram-style display ceiling of `1080px` wide with portrait height capped
  for feed performance.
- Profile images use square derivatives, with `640px` primary and `320px`
  thumbnail assets.
- JPEG, PNG, and WebP are the default allowlist. AVIF and HEIC may be enabled
  only after the running Pixelfed image pipeline and host libraries prove
  support.
- EXIF/GPS metadata must be stripped from generated display assets.
- Invalid MIME/signature mismatches, SVG, archives, executable payloads,
  decompression-bomb patterns, and over-cap uploads must fail with member-safe
  copy.

Align Pixelfed, PHP, Nginx, queue worker, and CDN/cache behavior around these
limits. The member-facing copy should say Mochirii Social optimizes large
uploads automatically, not that uploads are literally unlimited.

## CORS

Configure exact-origin CORS for:

```text
https://social.mochirii.com
```

Do not use wildcard origins for member media upload or authenticated browser
flows. Re-check CORS after Cloudflare proxy or CDN changes.

## Current Provider State

As of 2026-07-05, the dedicated DigitalOcean Space exists as
`mochirii-social` in `sgp1`.

- Bucket listing is restricted.
- CDN is enabled.
- CORS is configured for `https://social.mochirii.com` only.
- Allowed browser methods are `GET` and `HEAD`.
- Access Control Max Age is `3600` seconds.
- A bucket-scoped `Read/Write/Delete` Spaces access key exists for Pixelfed
  media. The key material is stored only under
  `C:\Github Repo's\Mochirii Website\Mochi Creds\DigitalOcean`.
- Signed S3-compatible smoke passed: temporary object `PUT`, signed `GET`,
  and `DELETE` all succeeded, and cleanup completed.

Runtime cutover completed on `social.mochirii.com`:

- Droplet SSH access used the approved key from the local agent.
- Pixelfed S3-compatible environment values were set on the Droplet only.
- Laravel config cache was cleared and rebuilt.
- App-side Compose services `pixelfed`, `horizon`, and `scheduler` were
  recreated so container environment values reflected the updated `.env`.
- Non-secret runtime readback confirmed cloud storage enabled, S3 disk, `sgp1`,
  Space `mochirii-social`, exact endpoint, public visibility, and supported
  checksum settings.
- Docker health was green for `pixelfed`, `horizon`, and `scheduler`;
  `php artisan horizon:status` reported Horizon running.
- External page fetch confirmed `https://social.mochirii.com` reachable and
  Mochirii-branded. Local PowerShell fetch still hits the known workstation TLS
  reset and should not be treated as social-host outage evidence.

Avatar upload validation completed on 2026-07-05:

- The live avatar settings UI advertises JPEG, PNG, and WebP up to `100 MB`.
- A signed-in admin profile image upload succeeded through the browser.
- Runtime config readback confirmed `MAX_AVATAR_SIZE=102400` and
  `PF_LOCAL_AVATAR_TO_CLOUD=true`.

The historical `100 MB` avatar limit above is superseded by the tracked
production-wide `90 MiB` Pixelfed cap in the current release packet.
- The avatar policy generates `640px` primary and `320px` thumbnail
  derivatives and keeps originals as temporary processing inputs.

Pending validation:

- Run Pixelfed post-image UI upload/downscale/thumbnail/delete validation while
  signed in as the admin account.
- Verify post-image optimized derivatives are served from Spaces and the local
  original/temp files are cleaned up after successful queue processing.
- Before every Social runtime publication, repeat the anonymous direct-object
  and CDN denial checks and read back the private-media cutover. The protected
  deployment workflow must remain blocked until those same-window checks pass.

## Smoke Tests

Before member rollout:

1. Upload a valid image.
2. Confirm optimized dimensions and quality.
3. Confirm EXIF stripping.
4. Confirm thumbnail generation.
5. Confirm public read behavior matches the chosen media visibility policy.
6. Confirm delete removes the application reference and expected media objects.
7. Confirm oversized and invalid uploads fail cleanly.
8. Confirm backup/restore notes cover media and database consistency.

Federation should stay disabled while media storage is being cut over.
