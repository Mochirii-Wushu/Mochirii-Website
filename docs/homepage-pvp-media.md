# Homepage PvP media contract

Home keeps its approved activity cards and Gallery behavior. PvP Highlights follows those cards,
before Spotlight and updates. The source-controlled `apps/web/public/data/pvp-clips.json` is empty
until reviewed media and its publication destination are accepted. An empty pool renders an honest
message, without invented footage, duplicate cards, disabled play controls or provider requests.

The existing Twitch duel-editing task owns its agreed clips, Resolve project, render queue, masters
and editing decisions. Its handoff is the already agreed accepted outputs and a basic completed-output
inventory. Do not assign web derivatives, posters, captions, hosting or publication as a new clip-owner
project. Do not resume its workflow, retry failed lanes, change its project or infer publication rights
from an export file.

## Handoff and publication

The owner identifies its accepted completed outputs in the basic inventory. Website owns any essential
integration work on those outputs: verify stable IDs, durations/dimensions, codecs/frame rate, bytes/hashes
and factual titles/descriptions; prepare suitable web delivery and representative posters only when
needed within existing approval boundaries. Publication review must cover duel boundaries, identity/results,
frame integrity, color, audio sync/levels, private overlays and music/media rights. Meaningful speech needs
captions and a transcript before publication. Existing editing acceptance and backup evidence must be
preserved; an inventory alone does not establish publication clearance.
No video masters or exports belong in Git. Review metadata is public-safe; never include private paths,
private storage keys, credentials, signed URLs or undisclosed account information in public JSON.

Hosting remains a separate approval gate naming the exact target, access policy, delivery behavior and
cost. Existing private image buckets are not video hosting and must not be made public. Verify billing
plan, usage/headroom, egress/caching and range/content-type support; do not assume free delivery.
The current app CSP permits same-origin media only. A new external origin also needs a separately
reviewed narrow CSP decision; adding it to this manifest cannot bypass the browser's security policy.

The design Preview can be reviewed with the honest empty state; it does not depend on finished video
hosting, Reaper or unrelated Gallery processing. Only real clip cards/playback and their media-specific
accessibility/delivery checks require an accepted, cleared handoff. Leave uncleared media unpublished.

## Source and behavior

`lib/pvp-clips.ts` validates publication-cleared records and selects at most four unique clips from the
bounded 103-entry pool. It deduplicates IDs and sources, never fills by duplication, never mutates the
manifest and permits repeated selections on different requests. Selection happens once on the server
and the resulting card children remain stable through hydration/viewing. Home's existing dynamic
rendering and bounded asynchronous Spotlight remain unchanged; no cache bypass is added for video.

The initial public manifest has version 1, an empty approved-origin list and an empty clip array.
Accepted paths use `/assets/home/pvp/<id>/poster.webp`, `clip-h264.mp4` and optional `captions.vtt`.
External HTTPS URLs must use a reviewed exact origin and these exact paths. Credentials, query strings,
fragments, protocol-relative URLs and private/signed storage URLs are rejected. The manifest records
H.264/MP4 web exports and AAC or no audio. Source files and their limits need a fresh delivery/profile
review when actual media exists; metadata validity is not proof of rights or export quality.

Cards reserve the reviewed intrinsic aspect ratio, lazy-load posters and expose ordinary native media links without
JavaScript. A small client intent boundary loads the native-player controller on activation. Neither
video `src` nor caption `src` is present before intent. Native controls, plays-inline behavior, a visible
error/fallback link and one-playing-clip enforcement remain independent of decorative Motion settings.
Hidden documents pause playback; unmount aborts listeners and releases sources. Test actual requests,
playback/audio, captions, errors and cleanup in each available engine; `preload="none"` alone is no proof.

Do not label media integration complete until its accepted records and publication checks pass. An
empty-state design Preview still needs its own applicable performance, security and delivery checks.
