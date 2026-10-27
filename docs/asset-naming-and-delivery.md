# Website asset names and delivery

Use lowercase descriptive kebab-case for new Website-owned files. A variant suffix describes its
delivered geometry, such as `shot-01-720.webp` or `cherry-valley-panorama-1344.webp`. Keep files in
`apps/web/public/assets`; public data consumers stay in `apps/web/public/data`. Remote storage keys,
member uploads and other repositories are outside this migration.

Stable brand, favicon, touch icon, social card, licensed font, protected audio and private Spinner
paths are explicit exceptions. Preserve their bytes, license files and required attribution. Duplicate
hashes alone do not authorize deletion. Keep every published legacy URL functional.

The two leadership names now use `lotus-warden.webp` and `petal-keeper.webp` in controlled JSON.
The underscore paths remain byte-identical compatibility files. Profiles, order and the Twills
fallback destination are unchanged.

`scripts/export-gallery-thumbnails.mjs` derives the 73 static Gallery thumbnails from reviewed existing
thumbnails: maximum edge 720, WebP quality 76 (bounded lower-quality fallback only if necessary), effort 6,
metadata stripped, no crop or enlargement, maximum 80 KiB each. Full viewer images and original thumbnail
URLs remain unchanged, including both exact-pixel `shot-44.webp` assets and their immutable validators.
The worst 24 derivatives must stay below the existing 2 MiB aggregate limit. Runtime member media keeps
its independently owned contract.

`scripts/export-home-scene.mjs <reviewed-master-directory>` exports the registered promotional scene.
The original generated master, clean plate and genuine-alpha branch remain in ignored operations evidence.
The 1536 × 1024 artboard registers the branch at x536/y0 after resizing it to 1000 × 667; attachment is
x1536/y100. One poster uses crop x0/y215/1536 × 560, resized proportionally to
1344 × 490, WebP quality 60, maximum 80 KiB. The phone's CSS crop selects
x640/y215/896 × 560 on that same artboard, with 784 delivered crop pixels.
There is one eager, high-priority poster request and no hidden alternate image.
Home serves this already compressed poster as-is through the per-image `unoptimized` option;
its 1344 × 490 pixels, CSS framing and original file stay intact. Other `StaticImage` consumers retain optimization.
Earlier unpublished crop drafts remain in ignored evidence.
The two 1280-wide textures have 210 KiB/115 KiB delivery limits and preserve genuine branch alpha.
The fixed, visible gutter swords load eagerly at Low priority; their unchanged source is shared by all
four images. Native lazy loading would wait for layout to discover these initial-viewport decorations.
The poster uses the exact registered layers used by the renderer. New promotional art is not a member
screenshot. Existing artwork and protected branding are never re-encoded by this exporter.

Home's fixed background uses five static delivery candidates at 640, 828, 1080, 1200 and 1536 pixels.
`scripts/export-home-background-delivery.mjs [fresh-owned-output-directory]` copies only the five
reviewed Next 16.3.8 quality-75 cache responses, checking source, dimensions and exact hashes before
writing. It never encodes, overwrites an output, changes the original background or modifies the cache.
The original `/assets/bg/wuxia-bg.webp` remains the native image fallback. The candidates retain the
established optimizer pixels for matching selections and the fixed centered cover geometry; the absent
750-pixel candidate uses 828 pixels instead. Native DPR/save-data selection must be observed in browser
evidence. Other routes retain their existing Next Image delivery.

`scripts/export-home-decoration.mjs` contains authored SVG geometry using local gradients and paths only.
It exports lossless WebP alpha masks into `assets/home/decor`, with a predeclared 32 KiB ceiling per mask.
CSS reveals those paths for mist, ink, texture and event light. The retained public inventory excludes SVG
files and the document guard excludes inline SVG/picture contexts; both validators stay intact. CSS mask
delivery also keeps late decoration out of image LCP candidates. The original vector drafts remain ignored.

Generated catalogs and compatibility maps belong in ignored `.artifacts/operations/homepage-preview-3`.
Record SHA-256, bytes, dimensions, alpha/metadata, consumers, provenance, crop, anchors and recipe for each
new derivative. Validate references, case collisions, legacy bytes, negotiated format, currentSrc and
delivered dimensions. Inspect quality at actual display size before publication. A source inventory refresh
must use actual files and rerun hostile controls; never relax validation to accept an unexplained mismatch.

Preview 4 adds a separate closed vector registry in the static-surface validator. It permits only the
exact hashes and paths for the owned arrow, two original jian ornaments and the unmodified official
white Discord symbol. SVG remains absent from the general format registry; unknown vectors, changed
bytes and inline SVG remain rejected. Earlier profiles and protected assets retain their exact bytes.

`scripts/export-home-preview-4-scene.mjs <reviewed-ignored-master-directory>` creates additive
`home/hero/cherry-valley-dawn-v2` textures and a portrait scenery derivative. It retains the original
poster and old public URLs. Original-pixel hair locks and one silk ribbon have genuine alpha, independent
pinned motion weights and reconstructed background under their bounded masks. The fixed body, face,
hands and weapon do not enter those masks. The small atlas is registered on the 1536×1024 artboard at
x1196/y372, 244×184. The existing registered branch remains a separate texture. Use the ignored export
manifest for current hashes/bytes/recipes; inspect rest and moving composites before acceptance.

The retained portrait scenery is an original adaptation of the bamboo-valley artwork. Its 1024×1536
WebP remains capped at 220 KiB. Home now uses the original fixed, centered `wuxia-bg.webp` shell background,
matching production scale/crop rather than enlarging portrait art through the content height. Existing
portrait and original public URLs remain intact. Masters, rejected variants, prompts, screenshots and
performance traces stay under ignored `.artifacts/operations/homepage-preview-4`.

`scripts/export-home-swords.mjs <reviewed-alpha-png> <ignored-evidence-directory>` trims only transparent
margin and proportionally exports the new `forged-jian-1024.webp`, maximum width 1024 and 80 KiB. Bounded
WebP quality trials are 80/74/68, alpha quality 100, effort 6, metadata stripped, no enlargement. One asset
is reused by both background-side pairs; earlier sword SVGs and all approved artwork remain unchanged.
Record actual delivered geometry, SHA-256, alpha, reviewed blade contact anchor and displayed quality.
The original illustration is Song-era-inspired, not an exact reconstruction: the National Museum of
China's Southern Song *Four Generals* painting supplies a restrained carried silhouette, and Smithsonian
S2012.9.939 supplies carved jade fitting detail. Exposed steel, wrapped grip, bronze ornament and contact
poses are creative interpretation. The Met's 2000.609 is a Eurasian comparative reference, not Chinese
provenance. Keep primary references and the complete generation/cleanup prompts with ignored evidence.
The generation service did not expose a model/checkpoint.
