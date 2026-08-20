# Official guild profile assets

`apps/web/public/assets/social-profiles` is the only Website location for general-purpose social-profile marks. Authentication-provider artwork under `assets/auth-providers` is a separate use case and must not be reused here.

The Website renders direct profile links from `apps/web/config/public-urls.json`. It does not load provider widgets, SDKs, remote images, tracking parameters, or embeds. Profile marks are decorative; the provider label and visible account text supply each link's accessible name. Where Meta's guidance prevents repeating the provider word beside its mark, the provider label remains available to assistive technology.

## Approved public-name exception

On 2026-08-01, the release owner expressly approved a narrow exception to the otherwise Mōchirīī-only public-name rule for official guild-profile links in the Website header, mobile menu, footer, and Organization `sameAs` metadata. The exception is limited to the exact profile labels, account descriptors, HTTPS destinations, surfaces, and organization-identity flags in `apps/web/config/public-urls.json`, plus the exact reviewed marks and text-only fallbacks recorded below. It does not authorize provider widgets, SDKs, embeds, tracking, remote assets, authentication changes, publication, or any other provider configuration or branding surface.

## Approved sources and current acquisition state

| Profile | Authoritative source | Reviewed | Permission or terms state | Local asset |
| --- | --- | --- | --- | --- |
| Facebook | <https://www.meta.com/brand/resources/facebook/logo/> | 2026-08-01 | The release owner approved accepting Meta's applicable guidelines on 2026-08-01. The unmodified supplied secondary white logo is used on the Website's dark translucent link surfaces. | `facebook-logo-secondary.png` |
| Instagram | <https://www.meta.com/brand/resources/instagram/instagram-brand/> | 2026-08-01 | The release owner approved accepting Meta's applicable guidelines on 2026-08-01. This ordinary Website use does not fall within Meta's separately permissioned broadcast, radio, out-of-home, or print-larger-than-A4 categories. The unmodified supplied white glyph is used on dark surfaces. | `instagram-glyph-white.svg` |
| TikTok | <https://developers.tiktok.com/doc/getting-started-design-guidelines/> | 2026-08-01 | TikTok's current developer guidance requires prior written permission to use its logo or icon. No permission evidence is recorded, so the Website uses a text-only TikTok link. | Intentionally absent |

Facebook requires the current complete logo, at least 16 CSS pixels wide, with clear space of one quarter of the logo width and at least half a logo between it and other content. The Website renders the supplied 24-pixel logo inside a 36-pixel reserved mark box, providing six pixels of clear space on every side, followed by a 12-pixel layout gap. When the logo is present, `Facebook` remains in the accessible name but is not repeated visibly beside the logo; the Mōchirīī account descriptor remains visible. Instagram uses an unmodified current asset supplied by Meta for the actual dark background. TikTok artwork must not be added until qualifying written permission is stored in the private legal evidence boundary and a public-safe approval record is added here.

## Accepted asset provenance

| Profile | Original archive | Archive SHA-256 | Original entry | Tracked asset | Tracked SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Facebook | `Facebook-Brand-Asset-Pack.zip` | `5C51E2C9C2377B1656A3294B391ED4A42F88DD8C46FC05B98D3BC27AFFC97F3A` | `Facebook Brand Asset Pack/Logo/Secondary Logo/Facebook_Logo_Secondary.png` | `apps/web/public/assets/social-profiles/facebook-logo-secondary.png` | `EED4F69A017B533E7115397E47B6BA75077D0AF5FB13369C0C5E819694CEEF57` |
| Instagram | `IG_brand_asset_pack_2023.zip` | `A9E5CBE63DC01279B3D12D536EA9D94AB5236521601BD5CC4B4CAF7BA7060E82` | `01 Static Glyph/02 White Glyph/Instagram_Glyph_White.svg` | `apps/web/public/assets/social-profiles/instagram-glyph-white.svg` | `3347813E9E8F082CDF48495818BD370CCFF94B687EFB8AA1C8A7B36CFCFB8291` |

The downloaded archives and extraction review remain under the ignored operations-artifact boundary and are not tracked or published. Both archives passed CRC and inventory checks for absolute paths, parent traversal, drive paths, alternate-data-stream syntax, duplicate normalized names, and links before the two allowlisted entries were extracted.

The Facebook PNG retains Meta's supplied physical-resolution metadata instead of being re-encoded. The repository-wide asset scan accepts that file only when both its exact canonical path and the SHA-256 above match; the profile-specific contract also independently validates its PNG structure, dimensions, allowed chunks, and hash.

## Asset acceptance contract

Before a mark is added:

1. Download it from the authoritative source after the release owner accepts the current applicable guidelines.
2. Preserve the supplied file without tracing, recoloring, cropping, rotation, animation, filters, outlines, shadows, or combination with Mōchirīī artwork.
3. Record the exact source URL, retrieval date, original archive and filename, SHA-256, supplied color/background variant, and permission basis in this file.
4. Store only the reviewed extracted asset under `apps/web/public/assets/social-profiles`. Keep archives and screenshots in the ignored operations-artifact boundary.
5. Run `npm run check:official-guild-profiles`; the contract rejects missing or unregistered files, path escapes, scripts, event handlers, active or external references, embedded raster data, and hash drift.

The Mōchirīī shell may style the surrounding link, but never the provider mark itself. All links remain ordinary, same-tab HTTPS links so users retain normal browser navigation and no new provider request occurs before activation. Each link uses a `no-referrer` request policy so the destination does not receive the originating Mōchirīī page URL.
