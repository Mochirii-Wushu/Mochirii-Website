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
Earlier unpublished crop drafts remain in ignored evidence.
The two 1280-wide textures have 210 KiB/115 KiB delivery limits and preserve genuine branch alpha.
The poster uses the exact registered layers used by the renderer. New promotional art is not a member
screenshot. Existing artwork and protected branding are never re-encoded by this exporter.

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

The portrait scenery is a single original adaptation of the retained bamboo-valley artwork. Its 1024×1536
WebP is capped at 220 KiB, with bounded quality trials rather than increasing the ceiling. It begins below
the hero/sword transition, continues behind content and uses proportional desktop/phone crops and local
jade text surfaces. Masters, rejected variants, prompts, screenshots and performance traces stay under
ignored `.artifacts/operations/homepage-preview-4`. The generation service did not expose a model/checkpoint.
