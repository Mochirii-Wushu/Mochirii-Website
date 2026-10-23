# Home color and decorative motion

Home uses server-rendered classes and the existing artwork and local fonts. Its geometry remains separate from
shared `PageHero`. Header and menu surfaces have opaque bases; the footer brand and introduction stack above a
wrapping navigation grid. Other ordinary routes retain their background and navigation inventories.

## Tokens

The Home palette lives in `apps/web/app/styles/public-home-visual.css`, scoped to `.home-page`.

| Role | Value |
| --- | --- |
| Base / surface / elevated | `#081014` / `#10191d` / `#18252a` |
| Primary / secondary text | `#fff5e4` / `#c7d1cd` |
| Jade / antique gold | `#1f7a63` / `#c8a24b` |
| Celadon / blossom rose / muted plum | `#a0c7b1` / `#bf9fab` / `#776574` |
| Focus | `#f5dba7`, immediate 2px outline with 4px offset |
| Spacing anchors | 12 / 24 / 32px; existing fluid section spacing remains |
| Corner radii | 16 / 24 / 28px, with proportionate phone geometry |

Celadon, rose and plum derive from the approved artwork palette. Jade/gold emphasize the event; gallery images
carry their own color, onboarding uses numbered steps, resources stay compact, and the protected seal closes the
page. Plum is a wash/border color, not small body text. Descriptions use 16px and supporting copy approximately
14px. Actual composited contrast and font metrics govern acceptance, not a nominal font-size minimum.

## Preference and fallback contract

`DecorativeMotion` belongs to the ordinary route shell. Spinner returns before this component mounts and retains
its independent raffle preference. One keyboard-accessible footer utility toggle controls Home and shared-shell
decoration. `mochirii.decorative-motion.v1` stores only `on` or `off` locally, without tracking or a server write.

Server rendering and hydration begin static. Once local preferences can be read, an absent setting permits normal
decoration only when the OS does not request reduced motion. Unknown saved values or unavailable storage stay
static. Explicit Off persists across navigation/reload; storage events synchronize other tabs. Live OS reduced
motion takes precedence. While the OS or unavailable storage prevents enabling effects, the control remains
focusable, exposes `aria-disabled`, and explains the effective static state.

All content is visible at rest and throughout entrance effects. No text depends on hydration or detecting browser
search. Without IntersectionObserver, content stays static. Anchor targets remain outside entrance transforms;
focus and hash navigation finish the affected content immediately.

## Effect inventory

| Effect | Trigger and duration | Fallback and cost |
| --- | --- | --- |
| Below-fold content settles | First viewport entry after native scrolling; 420ms, 12px, opacity .96 to 1 | Visible/static without enhancement; small transform/opacity regions |
| Onboarding stagger | Same entry; 50ms between three steps, completing in 520ms | No delay in static mode; no per-card scroll listeners |
| Section rule | First entry; 380ms scale/opacity on its separate rule | Full static rule; text/layout do not move |
| Event and seal edge | First entry; 1350ms, thin SVG stroke over the static border | Hidden decorative SVG, static border remains; stroke movement can repaint and requires trace inspection |
| Footer brand settles | First footer entry; 420ms, 12px, opacity .96 to 1 | Stable brand/introduction geometry and static fallback |
| Interactive feedback | 180ms color/border response; suitable links lift 2px only for fine-pointer hover | Immediate focus, static reduced/Off state, touch pressed border |
| Previous CTA shimmer/card border loops | Static | No continuous decorative animation |

One IntersectionObserver handles entry markers. Stable keys prevent replay within an ordinary-shell visit.
Offscreen/hidden effects finish, hidden documents disconnect observation, and route/preference changes clean up
observers, listeners and bounded timers. The hero, LCP image, primary proposition and Join action have no entry
effect. Scrolling stays native; there is no pinning, parallax, cursor effect or animation dependency.

## Validation and evidence

Run the governing Home/Shell checks, `npm run test:homepage-presentation`, and
`npm run smoke:home-polish -- --base-url http://127.0.0.1:8765` against the safely configured built local server.
The focused smoke covers narrow/intermediate/wide footer geometry, opaque menu surfaces, preference persistence,
live OS changes, no-JS/storage/observer fallbacks, and actual finite border motion across Chromium/Firefox/WebKit.
No backend or authenticated workflow is activated by this smoke.

Keep existing bundle/security/content guards intact. Count new shared motion code in shared and total payloads;
do not move Home code to evade its 5120-byte incremental limit. Compare baseline/layout/Off/On using a tolerance
locked before editing, retain traces and spread, and distinguish local lab, hosted reads and field results.
Rendering/contrast observations and measured costs belong in ignored operations evidence. No conversion or field
Web Vitals improvement follows from a visual treatment or Lighthouse score alone.
