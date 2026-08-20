# Official guild profile assets

If a later approved release adds general-purpose social-profile marks, `apps/web/public/assets/social-profiles` is their only Website location. Authentication-provider artwork under `assets/auth-providers` is a separate use case and must not be reused here.

The current source candidate renders direct, text-only profile links from `apps/web/config/public-urls.json`. It does not track or serve provider marks, or load provider widgets, SDKs, remote images, tracking parameters, or embeds. The visible provider label and account text supply each link's accessible name.

## Public-name release gate

- Public-name decision: `BLOCKED_APPROVAL`
- Meta mark decision: `BLOCKED_APPROVAL`
- TikTok mark decision: `BLOCKED_EXTERNAL`

This source-only candidate defines the exact Facebook, Instagram, and TikTok labels, account descriptors, HTTPS destinations, and header/mobile/footer surfaces needed by the requested Website shell. It does not authorize publication. The current full-completion disclosure review records no external-name exceptions, so the visible provider labels and destinations remain release-blocked until the user makes an exact public-name decision for these surfaces. Any later exception remains narrow and does not authorize marks, provider widgets, SDKs, embeds, tracking, remote assets, authentication changes, structured-data identity expansion, or any other provider configuration or branding surface.

## Reviewed sources and current acquisition state

| Profile | Authoritative source | Reviewed | Permission or terms state | Local asset |
| --- | --- | --- | --- | --- |
| Facebook | <https://www.meta.com/brand/resources/facebook/logo/> | 2026-08-01 | No authoritative record currently proves acceptance of the applicable mark terms. The source candidate is text-only. | Intentionally absent |
| Instagram | <https://www.meta.com/brand/resources/instagram/instagram-brand/> | 2026-08-01 | No authoritative record currently proves acceptance of the applicable mark terms. The source candidate is text-only. | Intentionally absent |
| TikTok | <https://developers.tiktok.com/doc/getting-started-design-guidelines/> | 2026-08-01 | TikTok's current developer guidance requires prior written permission to use its logo or icon. No permission evidence is recorded, so the Website uses a text-only TikTok link. | Intentionally absent |

Provider artwork must not be added until the applicable permission or terms decision is stored in the private legal evidence boundary and a public-safe approval record is added here. The optional mark gates remain intentionally red while the links are text-only.

## Recorded private asset review evidence

| Profile | Original archive | Archive SHA-256 | Original entry | Candidate path | Reviewed candidate SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Facebook | `Facebook-Brand-Asset-Pack.zip` | `5C51E2C9C2377B1656A3294B391ED4A42F88DD8C46FC05B98D3BC27AFFC97F3A` | `Facebook Brand Asset Pack/Logo/Secondary Logo/Facebook_Logo_Secondary.png` | `apps/web/public/assets/social-profiles/facebook-logo-secondary.png` | `EED4F69A017B533E7115397E47B6BA75077D0AF5FB13369C0C5E819694CEEF57` |
| Instagram | `IG_brand_asset_pack_2023.zip` | `A9E5CBE63DC01279B3D12D536EA9D94AB5236521601BD5CC4B4CAF7BA7060E82` | `01 Static Glyph/02 White Glyph/Instagram_Glyph_White.svg` | `apps/web/public/assets/social-profiles/instagram-glyph-white.svg` | `3347813E9E8F082CDF48495818BD370CCFF94B687EFB8AA1C8A7B36CFCFB8291` |

The downloaded archives and extracted candidates remain under the ignored operations-artifact boundary and are not tracked, served, or published by this branch. Both archives passed CRC and inventory checks for absolute paths, parent traversal, drive paths, alternate-data-stream syntax, duplicate normalized names, and links before the two candidate entries were reviewed.

The recorded Facebook PNG candidate retains Meta's supplied physical-resolution metadata instead of being re-encoded. If marks are later approved, the profile-specific contract validates the exact path, hashes, SVG safety, and PNG structure before either asset can be configured.

## Asset acceptance contract

Before a mark is added:

1. Download it from the authoritative source after the release owner accepts the current applicable guidelines.
2. Preserve the supplied file without tracing, recoloring, cropping, rotation, animation, filters, outlines, shadows, or combination with Mōchirīī artwork.
3. Record the exact source URL, retrieval date, original archive and filename, SHA-256, supplied color/background variant, and permission basis in this file.
4. Store only the reviewed extracted asset under `apps/web/public/assets/social-profiles`. Keep archives and screenshots in the ignored operations-artifact boundary.
5. Run `npm run check:official-guild-profiles`; the contract rejects missing or unregistered files, path escapes, scripts, event handlers, active or external references, embedded raster data, and hash drift.

All links remain ordinary, same-tab HTTPS links so users retain normal browser navigation and no provider request occurs before activation. Each link uses a `no-referrer` request policy so the destination does not receive the originating Mōchirīī page URL.
