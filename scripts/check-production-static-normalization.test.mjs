import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalizeProductionFlightResourceEnvelopeStream as canonicalize,
  productionDocumentProfileMatches,
} from "./check-production.mjs";

const checkerUrl = new URL("./check-production.mjs", import.meta.url);
const privateSource = readFileSync(checkerUrl, "utf8")
  .replaceAll("import.meta.url", JSON.stringify(checkerUrl.href))
  + "\nexport { normalizeProductionStaticSourceFlight as normalizeSource, canonicalizeProductionFlightResourceEnvelopeStreamWithProfile as parseFlight, productionDocumentPolicyForFlight as selectPolicy, PRODUCTION_DOCUMENT_POLICIES as policies };\n";
const { normalizeSource, parseFlight, selectPolicy, policies } = await import(
  "data:text/javascript;base64," + Buffer.from(privateSource).toString("base64"),
);
const data = JSON.parse(readFileSync(new URL("../apps/web/public/data/recruitment.json", import.meta.url)));
const publicPath = (value) => value.replace(/^\.\//, "/");
const e = (name, properties, key = null) => ["$", name, key, properties];
const hash = (value) => createHash("sha256").update(value).digest("hex").toUpperCase();

// Typed source fixtures reconstruct the independently verified clean 35-record
// graph. Protected prose comes from its canonical data owner. The alternative
// 32-record layout is derived below before comparison with any hosted evidence.
// These fixtures are local contract tests, not proof of a provider observation.
function sourceFrames() {
  return [
    { id: "1", kind: "", value: "$Sreact.fragment" },
    { id: "2", kind: "I", value: [45129, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "SiteRouteShell"] },
    { id: "3", kind: "I", value: [10291, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default"] },
    { id: "4", kind: "I", value: [2968, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default"] },
    { id: "5", kind: "I", value: [
      50675,
      ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"],
      "BodyPageMarker"
    ] },
    { id: "6", kind: "I", value: [
      57153,
      ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"],
      "Image"
    ] },
    { id: "7", kind: "I", value: [7575, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], ""] },
    { id: "14", kind: "I", value: [24462, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default", 1] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/media/noto_serif_sc_latin.p.__NEXT_GENERATED__.woff2", "font", { "crossOrigin": "", "type": "font/woff2" }] },
    { id: "", kind: "HL", value: ["/_next/static/media/zhi_mang_xing_latin.p.__NEXT_GENERATED__.woff2", "font", { "crossOrigin": "", "type": "font/woff2" }] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: [publicPath(data.hero.atmosphere), "image"] },
    { id: "12", kind: "X" },
    { id: "0", kind: "", value: {
      "P": null,
      "c": ["", "recruitment"],
      "q": "",
      "i": false,
      "f": [
        [
          [
            "",
            { "children": ["recruitment", { "children": ["__PAGE__", {  }, "$undefined", "$undefined", 4608] }, "$undefined", "$undefined", 4608] },
            "$undefined",
            "$undefined",
            4624
          ],
          [
            e("$1", {
              "children": [
                [
                  e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0"),
                  e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-0"),
                  e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-1")
                ],
                e("html", {
                  "lang": "en-SG",
                  "className": "displayfont_12184ccb-module__YUH9_a__variable bodyfont_24fec695-module__4PpgrG__variable",
                  "children": e("body", {
                    "data-page": "home",
                    "children": e("$L2", {
                      "children": e("$L3", {
                        "parallelRouterKey": "children",
                        "error": "$undefined",
                        "errorStyles": "$undefined",
                        "errorScripts": "$undefined",
                        "template": e("$L4", {  }, null),
                        "templateStyles": "$undefined",
                        "templateScripts": "$undefined",
                        "notFound": [
                          [
                            e("$L5", { "page": "not-found" }, null),
                            e("main", {
                              "className": "page-main not-found-main",
                              "id": "main",
                              "children": e("div", {
                                "className": "container not-found-shell",
                                "children": e("section", {
                                  "className": "glass-card glass-card--strong glass-pad center-stack not-found-card",
                                  "aria-labelledby": "not-found-heading",
                                  "children": [
                                    e("$L6", {
                                      "className": "not-found-emblem",
                                      "src": "/assets/img/brand/emblem.webp",
                                      "alt": "",
                                      "width": 112,
                                      "height": 112,
                                      "sizes": "(max-width: 640px) 72px, 112px",
                                      "priority": true
                                    }, null),
                                    e("p", { "className": "kicker", "children": "404" }, null),
                                    e("h1", { "className": "display-title", "id": "not-found-heading", "children": "Page not found" }, null),
                                    e("p", { "className": "lede", "children": "We couldn't find this page." }, null),
                                    e("div", { "className": "hero-cta-row", "children": e("$L7", { "className": "hero-cta hero-cta--primary", "href": "/", "children": "Return Home" }, null) }, null)
                                  ]
                                }, null)
                              }, null)
                            }, null)
                          ],
                          [
                            e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0")
                          ]
                        ],
                        "forbidden": "$undefined",
                        "unauthorized": "$undefined"
                      }, null)
                    }, null)
                  }, null)
                }, null)
              ]
            }, "c"),
            {
              "children": [
                e("$1", {
                  "children": [
                    null,
                    e("$L3", {
                      "parallelRouterKey": "children",
                      "error": "$undefined",
                      "errorStyles": "$undefined",
                      "errorScripts": "$undefined",
                      "template": e("$L4", {  }, null),
                      "templateStyles": "$undefined",
                      "templateScripts": "$undefined",
                      "notFound": "$undefined",
                      "forbidden": "$undefined",
                      "unauthorized": "$undefined"
                    }, null)
                  ]
                }, "c"),
                {
                  "children": [
                    e("$1", {
                      "children": [
                        [
                          e("$L5", { "page": "recruitment" }, null),
                          e("header", {
                            "className": "page-hero-shell",
                            "aria-label": "Recruitment hero",
                            "children": [
                              e("div", {
                                "className": "container",
                                "children": e("section", {
                                  "className": "page-hero page-hero--tall",
                                  "children": [
                                    e("$L6", {
                                      "id": "recruitmentHeroImage",
                                      "src": publicPath(data.hero.image),
                                      "alt": data.hero.alt,
                                      "className": "page-hero__img",
                                      "width": 1536,
                                      "height": 1024,
                                      "sizes": "(max-width: 1232px) calc(100vw - 32px), 1200px",
                                      "style": "$undefined",
                                      "loading": "eager",
                                      "fetchPriority": "high"
                                    }, null),
                                    e("img", {
                                      "id": "recruitmentAtmosphere",
                                      "src": publicPath(data.hero.atmosphere),
                                      "alt": "",
                                      "className": "page-hero__atmos",
                                      "decoding": "async",
                                      "aria-hidden": "true"
                                    }, null)
                                  ]
                                }, null)
                              }, null),
                              e("div", {
                                "className": "container hero-overlap",
                                "children": e("section", {
                                  "className": "glass-card glass-card--strong glass-pad hero-intro center-stack",
                                  "children": [
                                    e("p", { "className": "kicker", "id": "recruitmentKicker", "children": data.meta.kicker }, null),
                                    e("h1", { "className": "display-title", "id": "recruitmentHeading", "children": data.meta.heading }, null),
                                    e("div", {
                                      "className": "meta-row",
                                      "aria-label": "Recruitment metadata",
                                      "children": [
                                        e("$1", { "children": [null, e("span", { "className": "meta-text", "children": data.meta.author }, null)] }, data.meta.author),
                                        e("$1", {
                                          "children": [
                                            e("span", { "className": "meta-dot", "aria-hidden": "true", "children": "•" }, null),
                                            e("span", { "className": "meta-text", "children": "1 Feb 2026" }, null)
                                          ]
                                        }, "1 Feb 2026")
                                      ]
                                    }, null),
                                    e("p", { "className": "lede", "id": "recruitmentIntro", "children": data.meta.intro }, null),
                                    e("div", {
                                      "id": "recruitmentBadges",
                                      "className": "badge-row",
                                      "aria-label": "Recruitment tags",
                                      "children": [
                                        e("span", { "children": data.meta.badges[0] }, "The Jianghu-text"),
                                        e("span", { "children": data.meta.badges[1] }, "Kind conduct-text"),
                                        e("span", { "children": data.meta.badges[2] }, "Presence-text"),
                                        e("span", { "children": data.meta.badges[3] }, "Discord onboarding-text")
                                      ]
                                    }, null),
                                    e("p", { "id": "recruitmentError", "className": "sr-only", "role": "status", "aria-live": "polite" }, null)
                                  ]
                                }, null)
                              }, null)
                            ]
                          }, null),
                          e("main", {
                            "className": "page-main",
                            "id": "main",
                            "children": e("div", {
                              "className": "container",
                              "children": e("div", {
                                "className": "grid-12 grid-gap",
                                "children": [
                                  e("section", {
                                    "className": "col-4",
                                    "aria-describedby": "recruitmentAudioDesc",
                                    "children": e("div", { "className": "glass-card glass-card--soft glass-pad center-stack", "children": ["$L8", "$L9", "$La", "$Lb"] }, null)
                                  }, null),
                                  "$Lc",
                                  "$Ld"
                                ]
                              }, null)
                            }, null)
                          }, null)
                        ],
                        ["$Le", "$Lf", "$L10"],
                        "$L11"
                      ]
                    }, "c"),
                    {  },
                    null,
                    false,
                    null
                  ]
                },
                null,
                false,
                "$12"
              ]
            },
            null,
            false,
            null
          ],
          "$L13",
          false
        ]
      ],
      "m": "$undefined",
      "G": ["$14", ["$L15"]],
      "S": true,
      "h": null,
      "r": "$undefined",
      "s": "$undefined",
      "a": "$undefined",
      "l": "$undefined",
      "p": "$undefined",
      "d": "$undefined",
      "b": "__NEXT_BUILD_ID__"
    } },
    { id: "16", kind: "I", value: [
      63084,
      ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"],
      "RecruitmentAudioPlayer"
    ] },
    { id: "1b", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "OutletBoundary"] },
    { id: "1c", kind: "", value: "$Sreact.suspense" },
    { id: "1e", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "ViewportBoundary"] },
    { id: "20", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "MetadataBoundary"] },
    { id: "8", kind: "", value: e("h2", { "className": "section-title section-title--sm", "id": "recruitmentAudioTitle", "children": data.audio.title }, null) },
    { id: "9", kind: "", value: e("p", { "className": "muted", "id": "recruitmentAudioDesc", "children": data.audio.description }, null) },
    { id: "a", kind: "", value: e("$L16", { "sources": [{ "src": publicPath(data.audio.sources[0].src), "type": data.audio.sources[0].type }] }, null) },
    { id: "b", kind: "", value: e("div", {
      "id": "recruitmentAudioBadges",
      "className": "badge-row",
      "aria-label": "Audio formats",
      "children": [e("span", { "children": "Audio: mpeg" }, "Audio: mpeg-text")]
    }, null) },
    { id: "c", kind: "", value: e("section", {
      "className": "col-8",
      "children": e("div", {
        "className": "glass-card glass-card--primary glass-pad",
        "children": [
          e("h2", { "className": "section-title", "id": "recruitmentBodyTitle", "children": data.content.title }, null),
          e("div", {
            "id": "recruitmentBody",
            "className": "prose-stack",
            "children": [
              e("p", { "children": data.content.paragraphs[0] }, data.content.paragraphs[0]),
              e("p", { "children": data.content.paragraphs[1] }, data.content.paragraphs[1]),
              e("p", { "children": data.content.paragraphs[2] }, data.content.paragraphs[2]),
              e("p", { "children": data.content.paragraphs[3] }, data.content.paragraphs[3]),
              "$L17",
              "$L18",
              "$L19"
            ]
          }, null),
          "$L1a"
        ]
      }, null)
    }, null) },
    { id: "d", kind: "", value: e("div", { "className": "col-divider", "aria-hidden": "true" }, null) },
    { id: "e", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0") },
    { id: "f", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "1") },
    { id: "10", kind: "", value: e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-0") },
    { id: "11", kind: "", value: e("$L1b", { "children": e("$1c", { "name": "Next.MetadataOutlet", "children": "$@1d" }, null) }, null) },
    { id: "13", kind: "", value: e("$1", {
      "children": [
        null,
        e("$L1e", { "children": "$L1f" }, null),
        e("div", { "hidden": true, "children": e("$L20", { "children": e("$1c", { "name": "Next.Metadata", "children": "$L21" }, null) }, null) }, null),
        null
      ]
    }, "h") },
    { id: "15", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0") },
    { id: "12", kind: "C" },
    { id: "17", kind: "", value: e("p", { "children": data.content.paragraphs[4] }, data.content.paragraphs[4]) },
    { id: "18", kind: "", value: e("p", { "children": data.content.paragraphs[5] }, data.content.paragraphs[5]) },
    { id: "19", kind: "", value: e("p", { "children": data.content.paragraphs[6] }, data.content.paragraphs[6]) },
    { id: "1a", kind: "", value: e("div", {
      "id": "recruitmentConclusion",
      "className": "prose-stack",
      "children": [e("p", { "children": data.content.conclusion[0] }, data.content.conclusion[0])]
    }, null) },
    { id: "1f", kind: "", value: [
      e("meta", { "charSet": "utf-8" }, "0"),
      e("meta", { "name": "viewport", "content": "width=device-width, initial-scale=1, viewport-fit=cover" }, "1"),
      e("meta", { "name": "theme-color", "content": "#0a0c0e" }, "2")
    ] },
    { id: "22", kind: "I", value: [60329, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "IconMark"] },
    { id: "1d", kind: "", value: null },
    { id: "21", kind: "", value: [
      e("title", { "children": "Mōchirīī Recruitment • Where Winds Meet Guild" }, "0"),
      e("meta", {
        "name": "description",
        "content": "A Mōchirīī recruitment note about joining through Discord, growing the guild with care, and keeping the hall warm."
      }, "1"),
      e("link", { "rel": "canonical", "href": "https://mochirii.com/recruitment" }, "2"),
      e("meta", { "property": "og:title", "content": "Mōchirīī Recruitment • Where Winds Meet Guild" }, "3"),
      e("meta", {
        "property": "og:description",
        "content": "A Mōchirīī recruitment note about joining through Discord, growing the guild with care, and keeping the hall warm."
      }, "4"),
      e("meta", { "property": "og:url", "content": "https://mochirii.com/recruitment" }, "5"),
      e("meta", { "property": "og:site_name", "content": "Mōchirīī" }, "6"),
      e("meta", { "property": "og:locale", "content": "en_SG" }, "7"),
      e("meta", { "property": "og:image", "content": "https://mochirii.com/assets/img/recruitment/hero.webp" }, "8"),
      e("meta", { "property": "og:type", "content": "website" }, "9"),
      e("meta", { "name": "twitter:card", "content": "summary_large_image" }, "10"),
      e("meta", { "name": "twitter:title", "content": "Mōchirīī Recruitment • Where Winds Meet Guild" }, "11"),
      e("meta", {
        "name": "twitter:description",
        "content": "A Mōchirīī recruitment note about joining through Discord, growing the guild with care, and keeping the hall warm."
      }, "12"),
      e("meta", { "name": "twitter:image", "content": "https://mochirii.com/assets/img/recruitment/hero.webp" }, "13"),
      e("link", { "rel": "icon", "href": "/favicon.ico" }, "14"),
      e("link", { "rel": "apple-touch-icon", "href": "/assets/img/brand/apple-touch-icon.png" }, "15"),
      e("$L22", {  }, "16")
    ] },
  ];
}

// These static legal-page fixtures come from the same independently verified
// clean source oracles; their source-only outlined variants are derived below.
function privacySourceFrames() {
  return [
    { id: "1", kind: "", value: "$Sreact.fragment" },
    { id: "2", kind: "I", value: [45129, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "SiteRouteShell"] },
    { id: "3", kind: "I", value: [10291, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default"] },
    { id: "4", kind: "I", value: [2968, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default"] },
    { id: "5", kind: "I", value: [
      50675,
      ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"],
      "BodyPageMarker"
    ] },
    { id: "6", kind: "I", value: [
      57153,
      ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"],
      "Image"
    ] },
    { id: "7", kind: "I", value: [7575, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], ""] },
    { id: "13", kind: "I", value: [24462, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default", 1] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/media/noto_serif_sc_latin.p.__NEXT_GENERATED__.woff2", "font", { "crossOrigin": "", "type": "font/woff2" }] },
    { id: "", kind: "HL", value: ["/_next/static/media/zhi_mang_xing_latin.p.__NEXT_GENERATED__.woff2", "font", { "crossOrigin": "", "type": "font/woff2" }] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "11", kind: "X" },
    { id: "0", kind: "", value: {
      "P": null,
      "c": ["", "privacy"],
      "q": "",
      "i": false,
      "f": [
        [
          [
            "",
            { "children": ["privacy", { "children": ["__PAGE__", {  }, "$undefined", "$undefined", 4608] }, "$undefined", "$undefined", 4608] },
            "$undefined",
            "$undefined",
            4624
          ],
          [
            e("$1", {
              "children": [
                [
                  e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0"),
                  e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-0"),
                  e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-1")
                ],
                e("html", {
                  "lang": "en-SG",
                  "className": "displayfont_12184ccb-module__YUH9_a__variable bodyfont_24fec695-module__4PpgrG__variable",
                  "children": e("body", {
                    "data-page": "home",
                    "children": e("$L2", {
                      "children": e("$L3", {
                        "parallelRouterKey": "children",
                        "error": "$undefined",
                        "errorStyles": "$undefined",
                        "errorScripts": "$undefined",
                        "template": e("$L4", {  }, null),
                        "templateStyles": "$undefined",
                        "templateScripts": "$undefined",
                        "notFound": [
                          [
                            e("$L5", { "page": "not-found" }, null),
                            e("main", {
                              "className": "page-main not-found-main",
                              "id": "main",
                              "children": e("div", {
                                "className": "container not-found-shell",
                                "children": e("section", {
                                  "className": "glass-card glass-card--strong glass-pad center-stack not-found-card",
                                  "aria-labelledby": "not-found-heading",
                                  "children": [
                                    e("$L6", {
                                      "className": "not-found-emblem",
                                      "src": "/assets/img/brand/emblem.webp",
                                      "alt": "",
                                      "width": 112,
                                      "height": 112,
                                      "sizes": "(max-width: 640px) 72px, 112px",
                                      "priority": true
                                    }, null),
                                    e("p", { "className": "kicker", "children": "404" }, null),
                                    e("h1", { "className": "display-title", "id": "not-found-heading", "children": "Page not found" }, null),
                                    e("p", { "className": "lede", "children": "We couldn't find this page." }, null),
                                    e("div", { "className": "hero-cta-row", "children": e("$L7", { "className": "hero-cta hero-cta--primary", "href": "/", "children": "Return Home" }, null) }, null)
                                  ]
                                }, null)
                              }, null)
                            }, null)
                          ],
                          [
                            e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0")
                          ]
                        ],
                        "forbidden": "$undefined",
                        "unauthorized": "$undefined"
                      }, null)
                    }, null)
                  }, null)
                }, null)
              ]
            }, "c"),
            {
              "children": [
                e("$1", {
                  "children": [
                    null,
                    e("$L3", {
                      "parallelRouterKey": "children",
                      "error": "$undefined",
                      "errorStyles": "$undefined",
                      "errorScripts": "$undefined",
                      "template": e("$L4", {  }, null),
                      "templateStyles": "$undefined",
                      "templateScripts": "$undefined",
                      "notFound": "$undefined",
                      "forbidden": "$undefined",
                      "unauthorized": "$undefined"
                    }, null)
                  ]
                }, "c"),
                {
                  "children": [
                    e("$1", {
                      "children": [
                        [
                          e("$L5", { "page": "privacy" }, null),
                          e("header", {
                            "className": "page-hero-shell",
                            "aria-label": "Privacy information hero",
                            "children": [
                              e("div", {
                                "className": "container",
                                "children": e("section", {
                                  "className": "page-hero page-hero--tall",
                                  "children": [
                                    e("$L6", {
                                      "id": "privacyHeroImage",
                                      "src": "/assets/img/gallery/hero.webp",
                                      "alt": "A martial artist viewing illuminated landscape paintings in a lantern-lit corridor",
                                      "className": "page-hero__img",
                                      "width": 1536,
                                      "height": 1024,
                                      "sizes": "(max-width: 1232px) calc(100vw - 32px), 1200px",
                                      "style": "$undefined",
                                      "loading": "eager",
                                      "fetchPriority": "high"
                                    }, null),
                                    null
                                  ]
                                }, null)
                              }, null),
                              e("div", {
                                "className": "container hero-overlap",
                                "children": e("section", {
                                  "className": "glass-card glass-card--strong glass-pad hero-intro",
                                  "children": [
                                    e("p", { "className": "kicker", "id": "privacyKicker", "children": "Privacy" }, null),
                                    e("h1", { "className": "display-title", "id": "privacyHeading", "children": "Privacy" }, null),
                                    "$undefined",
                                    e("p", {
                                      "className": "lede",
                                      "id": "privacyIntro",
                                      "children": "This page summarizes information handled by the Mōchirīī website and provides a contact for privacy questions. It does not describe every Mōchirīī service or replace a third-party provider's notice."
                                    }, null),
                                    e("div", {
                                      "id": "privacyBadges",
                                      "className": "badge-row",
                                      "aria-label": "Privacy information topics",
                                      "children": [
                                        e("span", { "children": "Website scope" }, "Website scope-text"),
                                        e("span", { "children": "Privacy contact" }, "Privacy contact-text"),
                                        e("span", { "children": "Provider notices remain separate" }, "Provider notices remain separate-text")
                                      ]
                                    }, null),
                                    e("p", { "id": "privacyError", "className": "sr-only", "role": "status", "aria-live": "polite" }, null)
                                  ]
                                }, null)
                              }, null)
                            ]
                          }, null),
                          e("main", {
                            "className": "page-main legal-page",
                            "id": "main",
                            "children": e("div", {
                              "className": "container",
                              "children": e("div", {
                                "className": "grid-12 grid-gap",
                                "children": [
                                  e("section", {
                                    "className": "col-8 glass-card glass-card--primary glass-pad",
                                    "aria-labelledby": "privacyScopeTitle",
                                    "children": [
                                      e("p", { "className": "kicker", "children": ["Last updated ", e("time", { "dateTime": "2026-08-30", "children": "30 Aug 2026" }, null)] }, null),
                                      e("h2", { "className": "section-title", "id": "privacyScopeTitle", "children": "Website scope" }, null),
                                      e("div", {
                                        "className": "prose-stack",
                                        "children": [
                                          e("p", {
                                            "children": "The website source includes public pages, member sign-in and guild verification, protected account and Gallery workflows, analytics and performance components, and user-activated external links or embeds. Some deployed-runtime and provider details still require separate verification."
                                          }, null),
                                          "$L8"
                                        ]
                                      }, null)
                                    ]
                                  }, null),
                                  "$L9",
                                  "$La",
                                  "$Lb",
                                  "$Lc"
                                ]
                              }, null)
                            }, null)
                          }, null)
                        ],
                        ["$Ld", "$Le", "$Lf"],
                        "$L10"
                      ]
                    }, "c"),
                    {  },
                    null,
                    false,
                    null
                  ]
                },
                null,
                false,
                "$11"
              ]
            },
            null,
            false,
            null
          ],
          "$L12",
          false
        ]
      ],
      "m": "$undefined",
      "G": ["$13", ["$L14"]],
      "S": true,
      "h": null,
      "r": "$undefined",
      "s": "$undefined",
      "a": "$undefined",
      "l": "$undefined",
      "p": "$undefined",
      "d": "$undefined",
      "b": "__NEXT_BUILD_ID__"
    } },
    { id: "15", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "OutletBoundary"] },
    { id: "16", kind: "", value: "$Sreact.suspense" },
    { id: "18", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "ViewportBoundary"] },
    { id: "1a", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "MetadataBoundary"] },
    { id: "8", kind: "", value: e("p", {
      "children": "Depending on the feature used, the website can handle account and provider identifiers, profile and guild-role information, session and verification state, Gallery images and submission metadata, moderation records, and optional Instagram-sharing choices."
    }, null) },
    { id: "9", kind: "", value: e("aside", {
      "className": "col-4 glass-card glass-card--soft glass-pad",
      "aria-labelledby": "privacyContactTitle",
      "children": [
        e("h2", { "className": "section-title section-title--sm", "id": "privacyContactTitle", "children": "Questions and requests" }, null),
        e("p", {
          "children": [
            "For privacy, correction, withdrawal, or deletion questions about Mōchirīī-held website data, email",
            " ",
            e("a", { "href": "mailto:support@mochirii.com", "children": "support@mochirii.com" }, null),
            "."
          ]
        }, null),
        e("p", { "children": "Do not include a password, access token, recovery code, signed media URL, or identity document in the initial email." }, null),
        e("div", {
          "className": "hero-cta-row u-mt-18",
          "children": e("$L7", { "className": "hero-cta", "href": "/meta-data-deletion", "children": "Deletion request instructions" }, null)
        }, null)
      ]
    }, null) },
    { id: "a", kind: "", value: e("section", {
      "className": "col-12 glass-card glass-card--soft glass-pad",
      "aria-labelledby": "privacySpotlightTitle",
      "children": [
        e("h2", { "className": "section-title", "id": "privacySpotlightTitle", "children": "Monthly member Spotlight" }, null),
        e("p", {
          "children": [
            "Beginning on the first day of each month, the website selects one current active member account at random for the Mōchirīī Spotlight. Only the selected member's website display name and Spotlight month are published; the candidate list, account identifier, and selection audit details remain private. For a name correction or withdrawal request, email",
            " ",
            e("a", { "href": "mailto:support@mochirii.com", "children": "support@mochirii.com" }, null),
            "."
          ]
        }, null)
      ]
    }, null) },
    { id: "b", kind: "", value: e("section", {
      "className": "col-12 glass-card glass-card--soft glass-pad",
      "aria-labelledby": "privacyChoicesTitle",
      "children": [
        e("h2", { "className": "section-title", "id": "privacyChoicesTitle", "children": "Gallery choices and public copies" }, null),
        e("div", {
          "className": "legal-grid",
          "children": [
            e("section", {
              "aria-labelledby": "privacySharingTitle",
              "children": [
                e("h3", { "className": "section-title section-title--sm", "id": "privacySharingTitle", "children": "Optional sharing" }, null),
                e("p", { "children": "Instagram sharing is optional and defaults off in source. Gallery approval and external sharing are separate actions." }, null)
              ]
            }, null),
            e("section", {
              "aria-labelledby": "privacyDeliveryTitle",
              "children": [
                e("h3", { "className": "section-title section-title--sm", "id": "privacyDeliveryTitle", "children": "Approved Gallery items" }, null),
                e("p", { "children": "Approved Gallery items can include uploader display information and are delivered through bounded public media URLs." }, null)
              ]
            }, null)
          ]
        }, null)
      ]
    }, null) },
    { id: "c", kind: "", value: e("section", {
      "className": "col-12 glass-card glass-card--primary glass-pad",
      "aria-labelledby": "privacyLimitsTitle",
      "children": [
        e("h2", { "className": "section-title", "id": "privacyLimitsTitle", "children": "Current limits" }, null),
        e("p", {
          "children": "If content has been published or shared outside Mōchirīī, copies may remain outside Mōchirīī's control. The current source does not establish one complete retention schedule or a guaranteed response deadline."
        }, null)
      ]
    }, null) },
    { id: "d", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0") },
    { id: "e", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "1") },
    { id: "f", kind: "", value: e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-0") },
    { id: "10", kind: "", value: e("$L15", { "children": e("$16", { "name": "Next.MetadataOutlet", "children": "$@17" }, null) }, null) },
    { id: "12", kind: "", value: e("$1", {
      "children": [
        null,
        e("$L18", { "children": "$L19" }, null),
        e("div", { "hidden": true, "children": e("$L1a", { "children": e("$16", { "name": "Next.Metadata", "children": "$L1b" }, null) }, null) }, null),
        null
      ]
    }, "h") },
    { id: "14", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0") },
    { id: "11", kind: "C" },
    { id: "19", kind: "", value: [
      e("meta", { "charSet": "utf-8" }, "0"),
      e("meta", { "name": "viewport", "content": "width=device-width, initial-scale=1, viewport-fit=cover" }, "1"),
      e("meta", { "name": "theme-color", "content": "#0a0c0e" }, "2")
    ] },
    { id: "1c", kind: "I", value: [60329, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "IconMark"] },
    { id: "17", kind: "", value: null },
    { id: "1b", kind: "", value: [
      e("title", { "children": "Privacy • Mōchirīī" }, "0"),
      e("meta", { "name": "description", "content": "Website privacy information and contact options for Mōchirīī account and Gallery questions." }, "1"),
      e("link", { "rel": "canonical", "href": "https://mochirii.com/privacy" }, "2"),
      e("meta", { "property": "og:title", "content": "Privacy • Mōchirīī" }, "3"),
      e("meta", { "property": "og:description", "content": "Website privacy information and contact options for Mōchirīī account and Gallery questions." }, "4"),
      e("meta", { "property": "og:url", "content": "https://mochirii.com/privacy" }, "5"),
      e("meta", { "property": "og:site_name", "content": "Mōchirīī" }, "6"),
      e("meta", { "property": "og:locale", "content": "en_SG" }, "7"),
      e("meta", { "property": "og:image", "content": "https://mochirii.com/assets/img/gallery/hero.webp" }, "8"),
      e("meta", { "property": "og:type", "content": "website" }, "9"),
      e("meta", { "name": "twitter:card", "content": "summary_large_image" }, "10"),
      e("meta", { "name": "twitter:title", "content": "Privacy • Mōchirīī" }, "11"),
      e("meta", { "name": "twitter:description", "content": "Website privacy information and contact options for Mōchirīī account and Gallery questions." }, "12"),
      e("meta", { "name": "twitter:image", "content": "https://mochirii.com/assets/img/gallery/hero.webp" }, "13"),
      e("link", { "rel": "icon", "href": "/favicon.ico" }, "14"),
      e("link", { "rel": "apple-touch-icon", "href": "/assets/img/brand/apple-touch-icon.png" }, "15"),
      e("$L1c", {  }, "16")
    ] },
  ];
}

function deletionSourceFrames() {
  return [
    { id: "1", kind: "", value: "$Sreact.fragment" },
    { id: "2", kind: "I", value: [45129, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "SiteRouteShell"] },
    { id: "3", kind: "I", value: [10291, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default"] },
    { id: "4", kind: "I", value: [2968, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default"] },
    { id: "5", kind: "I", value: [
      50675,
      ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"],
      "BodyPageMarker"
    ] },
    { id: "6", kind: "I", value: [
      57153,
      ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"],
      "Image"
    ] },
    { id: "7", kind: "I", value: [7575, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], ""] },
    { id: "12", kind: "I", value: [24462, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "default", 1] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/media/noto_serif_sc_latin.p.__NEXT_GENERATED__.woff2", "font", { "crossOrigin": "", "type": "font/woff2" }] },
    { id: "", kind: "HL", value: ["/_next/static/media/zhi_mang_xing_latin.p.__NEXT_GENERATED__.woff2", "font", { "crossOrigin": "", "type": "font/woff2" }] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "", kind: "HL", value: ["/_next/static/chunks/__NEXT_GENERATED__.css", "style"] },
    { id: "10", kind: "X" },
    { id: "0", kind: "", value: {
      "P": null,
      "c": ["", "meta-data-deletion"],
      "q": "",
      "i": false,
      "f": [
        [
          [
            "",
            { "children": ["meta-data-deletion", { "children": ["__PAGE__", {  }, "$undefined", "$undefined", 4608] }, "$undefined", "$undefined", 4608] },
            "$undefined",
            "$undefined",
            4624
          ],
          [
            e("$1", {
              "children": [
                [
                  e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0"),
                  e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-0"),
                  e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-1")
                ],
                e("html", {
                  "lang": "en-SG",
                  "className": "displayfont_12184ccb-module__YUH9_a__variable bodyfont_24fec695-module__4PpgrG__variable",
                  "children": e("body", {
                    "data-page": "home",
                    "children": e("$L2", {
                      "children": e("$L3", {
                        "parallelRouterKey": "children",
                        "error": "$undefined",
                        "errorStyles": "$undefined",
                        "errorScripts": "$undefined",
                        "template": e("$L4", {  }, null),
                        "templateStyles": "$undefined",
                        "templateScripts": "$undefined",
                        "notFound": [
                          [
                            e("$L5", { "page": "not-found" }, null),
                            e("main", {
                              "className": "page-main not-found-main",
                              "id": "main",
                              "children": e("div", {
                                "className": "container not-found-shell",
                                "children": e("section", {
                                  "className": "glass-card glass-card--strong glass-pad center-stack not-found-card",
                                  "aria-labelledby": "not-found-heading",
                                  "children": [
                                    e("$L6", {
                                      "className": "not-found-emblem",
                                      "src": "/assets/img/brand/emblem.webp",
                                      "alt": "",
                                      "width": 112,
                                      "height": 112,
                                      "sizes": "(max-width: 640px) 72px, 112px",
                                      "priority": true
                                    }, null),
                                    e("p", { "className": "kicker", "children": "404" }, null),
                                    e("h1", { "className": "display-title", "id": "not-found-heading", "children": "Page not found" }, null),
                                    e("p", { "className": "lede", "children": "We couldn't find this page." }, null),
                                    e("div", { "className": "hero-cta-row", "children": e("$L7", { "className": "hero-cta hero-cta--primary", "href": "/", "children": "Return Home" }, null) }, null)
                                  ]
                                }, null)
                              }, null)
                            }, null)
                          ],
                          [
                            e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0")
                          ]
                        ],
                        "forbidden": "$undefined",
                        "unauthorized": "$undefined"
                      }, null)
                    }, null)
                  }, null)
                }, null)
              ]
            }, "c"),
            {
              "children": [
                e("$1", {
                  "children": [
                    null,
                    e("$L3", {
                      "parallelRouterKey": "children",
                      "error": "$undefined",
                      "errorStyles": "$undefined",
                      "errorScripts": "$undefined",
                      "template": e("$L4", {  }, null),
                      "templateStyles": "$undefined",
                      "templateScripts": "$undefined",
                      "notFound": "$undefined",
                      "forbidden": "$undefined",
                      "unauthorized": "$undefined"
                    }, null)
                  ]
                }, "c"),
                {
                  "children": [
                    e("$1", {
                      "children": [
                        [
                          e("$L5", { "page": "meta-data-deletion" }, null),
                          e("header", {
                            "className": "page-hero-shell",
                            "aria-label": "Data deletion request information hero",
                            "children": [
                              e("div", {
                                "className": "container",
                                "children": e("section", {
                                  "className": "page-hero page-hero--tall",
                                  "children": [
                                    e("$L6", {
                                      "id": "meta-data-deletionHeroImage",
                                      "src": "/assets/img/gallery/hero.webp",
                                      "alt": "A martial artist viewing illuminated landscape paintings in a lantern-lit corridor",
                                      "className": "page-hero__img",
                                      "width": 1536,
                                      "height": 1024,
                                      "sizes": "(max-width: 1232px) calc(100vw - 32px), 1200px",
                                      "style": "$undefined",
                                      "loading": "eager",
                                      "fetchPriority": "high"
                                    }, null),
                                    null
                                  ]
                                }, null)
                              }, null),
                              e("div", {
                                "className": "container hero-overlap",
                                "children": e("section", {
                                  "className": "glass-card glass-card--strong glass-pad hero-intro",
                                  "children": [
                                    e("p", { "className": "kicker", "id": "meta-data-deletionKicker", "children": "Data requests" }, null),
                                    e("h1", { "className": "display-title", "id": "meta-data-deletionHeading", "children": "Data Deletion Requests" }, null),
                                    "$undefined",
                                    e("p", {
                                      "className": "lede",
                                      "id": "metaDataDeletionIntro",
                                      "children": "Use this page to ask Mōchirīī to review deletion of eligible website data it controls. This is not a promise that every record or third-party copy can be deleted."
                                    }, null),
                                    e("div", {
                                      "id": "metaDataDeletionBadges",
                                      "className": "badge-row",
                                      "aria-label": "Deletion request safeguards",
                                      "children": [
                                        e("span", { "children": "Requester verification" }, "Requester verification-text"),
                                        e("span", { "children": "No secrets by email" }, "No secrets by email-text"),
                                        e("span", { "children": "Scope reviewed individually" }, "Scope reviewed individually-text")
                                      ]
                                    }, null),
                                    e("p", { "id": "meta-data-deletionError", "className": "sr-only", "role": "status", "aria-live": "polite" }, null)
                                  ]
                                }, null)
                              }, null)
                            ]
                          }, null),
                          e("main", {
                            "className": "page-main legal-page",
                            "id": "main",
                            "children": e("div", {
                              "className": "container",
                              "children": e("div", {
                                "className": "grid-12 grid-gap",
                                "children": [
                                  e("section", {
                                    "className": "col-8 glass-card glass-card--primary glass-pad",
                                    "aria-labelledby": "deletionRequestTitle",
                                    "children": [
                                      e("p", { "className": "kicker", "children": ["Last updated ", e("time", { "dateTime": "2026-08-13", "children": "13 Aug 2026" }, null)] }, null),
                                      e("h2", { "className": "section-title", "id": "deletionRequestTitle", "children": "How to make a request" }, null),
                                      "$L8",
                                      "$L9"
                                    ]
                                  }, null),
                                  "$La",
                                  "$Lb"
                                ]
                              }, null)
                            }, null)
                          }, null)
                        ],
                        ["$Lc", "$Ld", "$Le"],
                        "$Lf"
                      ]
                    }, "c"),
                    {  },
                    null,
                    false,
                    null
                  ]
                },
                null,
                false,
                "$10"
              ]
            },
            null,
            false,
            null
          ],
          "$L11",
          false
        ]
      ],
      "m": "$undefined",
      "G": ["$12", ["$L13"]],
      "S": true,
      "h": null,
      "r": "$undefined",
      "s": "$undefined",
      "a": "$undefined",
      "l": "$undefined",
      "p": "$undefined",
      "d": "$undefined",
      "b": "__NEXT_BUILD_ID__"
    } },
    { id: "14", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "OutletBoundary"] },
    { id: "15", kind: "", value: "$Sreact.suspense" },
    { id: "17", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "ViewportBoundary"] },
    { id: "19", kind: "I", value: [82520, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "MetadataBoundary"] },
    { id: "8", kind: "", value: e("ol", {
      "className": "list-stack legal-steps",
      "children": [
        e("li", {
          "children": [
            "Email ",
            e("a", { "href": "mailto:support@mochirii.com?subject=M%C5%8Dchir%C4%AB%C4%AB%20data%20deletion%20request", "children": "support@mochirii.com" }, null),
            " with the subject “",
            "Mōchirīī data deletion request",
            "”. Send from the email associated with your Mōchirīī website account when possible."
          ]
        }, null),
        e("li", {
          "children": "Include only enough information to locate the data, such as your website or Discord handle and a Gallery title or approximate submission date."
        }, null),
        e("li", { "children": "Do not send a password, access token, recovery code, signed media URL, or identity document in the initial request." }, null),
        e("li", { "children": "Mōchirīī may need additional information to verify the requester and locate the data before acting." }, null)
      ]
    }, null) },
    { id: "9", kind: "", value: e("div", {
      "className": "hero-cta-row u-mt-18",
      "children": [
        e("a", {
          "className": "hero-cta hero-cta--primary",
          "href": "mailto:support@mochirii.com?subject=M%C5%8Dchir%C4%AB%C4%AB%20data%20deletion%20request",
          "children": "Start an email request"
        }, null),
        e("$L7", { "className": "hero-cta", "href": "/privacy", "children": "Read the privacy page" }, null)
      ]
    }, null) },
    { id: "a", kind: "", value: e("aside", {
      "className": "col-4 glass-card glass-card--soft glass-pad",
      "aria-labelledby": "deletionScopeTitle",
      "children": [
        e("h2", { "className": "section-title section-title--sm", "id": "deletionScopeTitle", "children": "Request scope" }, null),
        e("p", {
          "children": "A request may concern website-account, Gallery-submission, consent, moderation, or optional Instagram-publication records associated with the requester."
        }, null),
        e("p", { "children": "This page does not delete Facebook, Instagram, Discord, or other provider accounts and cannot remove copies outside Mōchirīī's control." }, null)
      ]
    }, null) },
    { id: "b", kind: "", value: e("section", {
      "className": "col-12 glass-card glass-card--primary glass-pad",
      "aria-labelledby": "deletionLimitsTitle",
      "children": [
        e("h2", { "className": "section-title", "id": "deletionLimitsTitle", "children": "Current limits" }, null),
        e("p", {
          "children": "No automatic site-wide deletion, complete provider propagation, or response deadline is represented here. Account, Storage, approved-feed, external-copy, backup, moderation, security, dispute, and legal-hold outcomes require review."
        }, null)
      ]
    }, null) },
    { id: "c", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0") },
    { id: "d", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "1") },
    { id: "e", kind: "", value: e("script", { "src": "/_next/static/chunks/__NEXT_GENERATED__.js", "async": true, "nonce": "$undefined" }, "script-0") },
    { id: "f", kind: "", value: e("$L14", { "children": e("$15", { "name": "Next.MetadataOutlet", "children": "$@16" }, null) }, null) },
    { id: "11", kind: "", value: e("$1", {
      "children": [
        null,
        e("$L17", { "children": "$L18" }, null),
        e("div", { "hidden": true, "children": e("$L19", { "children": e("$15", { "name": "Next.Metadata", "children": "$L1a" }, null) }, null) }, null),
        null
      ]
    }, "h") },
    { id: "13", kind: "", value: e("link", { "rel": "stylesheet", "href": "/_next/static/chunks/__NEXT_GENERATED__.css", "precedence": "next", "crossOrigin": "$undefined", "nonce": "$undefined" }, "0") },
    { id: "10", kind: "C" },
    { id: "18", kind: "", value: [
      e("meta", { "charSet": "utf-8" }, "0"),
      e("meta", { "name": "viewport", "content": "width=device-width, initial-scale=1, viewport-fit=cover" }, "1"),
      e("meta", { "name": "theme-color", "content": "#0a0c0e" }, "2")
    ] },
    { id: "1b", kind: "I", value: [60329, ["/_next/static/chunks/__NEXT_GENERATED__.js", "/_next/static/chunks/__NEXT_GENERATED__.js"], "IconMark"] },
    { id: "16", kind: "", value: null },
    { id: "1a", kind: "", value: [
      e("title", { "children": "Data Deletion Requests • Mōchirīī" }, "0"),
      e("meta", { "name": "description", "content": "How to ask Mōchirīī to review deletion of eligible website data it controls." }, "1"),
      e("link", { "rel": "canonical", "href": "https://mochirii.com/meta-data-deletion" }, "2"),
      e("meta", { "property": "og:title", "content": "Data Deletion Requests • Mōchirīī" }, "3"),
      e("meta", { "property": "og:description", "content": "How to ask Mōchirīī to review deletion of eligible website data it controls." }, "4"),
      e("meta", { "property": "og:url", "content": "https://mochirii.com/meta-data-deletion" }, "5"),
      e("meta", { "property": "og:site_name", "content": "Mōchirīī" }, "6"),
      e("meta", { "property": "og:locale", "content": "en_SG" }, "7"),
      e("meta", { "property": "og:image", "content": "https://mochirii.com/assets/img/gallery/hero.webp" }, "8"),
      e("meta", { "property": "og:type", "content": "website" }, "9"),
      e("meta", { "name": "twitter:card", "content": "summary_large_image" }, "10"),
      e("meta", { "name": "twitter:title", "content": "Data Deletion Requests • Mōchirīī" }, "11"),
      e("meta", { "name": "twitter:description", "content": "How to ask Mōchirīī to review deletion of eligible website data it controls." }, "12"),
      e("meta", { "name": "twitter:image", "content": "https://mochirii.com/assets/img/gallery/hero.webp" }, "13"),
      e("link", { "rel": "icon", "href": "/favicon.ico" }, "14"),
      e("link", { "rel": "apple-touch-icon", "href": "/assets/img/brand/apple-touch-icon.png" }, "15"),
      e("$L1b", {  }, "16")
    ] },
  ];
}

function visit(value, transform) {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map((item) => visit(item, transform));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item, transform)]));
  }
  return value;
}

function findElement(value, predicate) {
  if (Array.isArray(value)) {
    if (value.length === 4 && value[0] === "$" && predicate(value)) return value;
    for (const item of value) {
      const result = findElement(item, predicate);
      if (result) return result;
    }
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      const result = findElement(item, predicate);
      if (result) return result;
    }
  }
  return null;
}

function fixtureFrames(layout = "clean35") {
  const frames = sourceFrames();
  if (layout === "clean35") return frames;
  assert.equal(layout, "derived32");
  const byId = new Map(frames.filter((frame) => frame.id).map((frame) => [frame.id, frame]));
  const audio = findElement(byId.get("0").value, (element) => element[1] === "section"
    && element[3]["aria-describedby"] === "recruitmentAudioDesc")[3];
  const wrapper = audio.children;
  assert.deepEqual(wrapper[3].children, ["$L8", "$L9", "$La", "$Lb"]);
  wrapper[3].children = ["8", "9", "a", "b"].map((id) => byId.get(id).value);
  audio.children = "$L8";
  byId.get("8").value = wrapper;
  const renameId = (id) => id && Number.parseInt(id, 16) >= 12
    ? (Number.parseInt(id, 16) - 3).toString(16) : id;
  return frames.filter((frame) => !["9", "a", "b"].includes(frame.id)).map((frame) => ({
    ...frame, id: renameId(frame.id),
    ...(frame.value === undefined ? {} : { value: visit(frame.value, (value) => {
      const reference = /^\$(L|@)?([0-9a-f]+)$/.exec(value);
      return reference ? "$" + (reference[1] || "") + renameId(reference[2]) : value;
    }) }),
  }));
}

const canonicalWire = (frames) => frames.map(({ id, kind, value }) =>
  id + ":" + kind + (value === undefined ? "" : JSON.stringify(value)) + "\n").join("");
const wire = (frames) => canonicalWire(frames)
  .replaceAll("__NEXT_GENERATED__", "1coumcuouv5-a")
  .replaceAll("__NEXT_BUILD_ID__", "0123456789abcdefghijk");
function normalize(stream, profile = "recruitment") {
  const parsed = parseFlight(stream, new Set());
  return parsed === null ? null : normalizeSource(parsed, profile);
}
function assertRejected(mutate, message, layout = "clean35") {
  const frames = fixtureFrames(layout);
  mutate(frames);
  assert.equal(normalize(wire(frames)), null, message);
}

test("both exact clean-source layouts yield the same bounded private canonical stream", () => {
  const expectedWireHashes = {
    clean35: "BB2593CEF50B2E394986011989577B06A6763764717DAF014019C320CD9C9330",
    derived32: "2BAC81D42024CDCD36D45D765C2EED986E8B939B3F731549395FA8430D494388",
  };
  const results = [];
  for (const layout of Object.keys(expectedWireHashes)) {
    const stream = wire(fixtureFrames(layout));
    const generic = canonicalize(stream, new Set());
    assert.equal(hash(generic), expectedWireHashes[layout]);
    const result = normalize(stream);
    assert(result && Object.isFrozen(result));
    assert.equal(result.homeSourceProfile, null);
    assert.equal(result.staticSourceProfile, "recruitment");
    assert.equal(hash(result.stream), "1DE65277D31F48EC512678CB6ECD19398A0DF4AF79A7537CA6063BFDDC7D8732");
    assert.equal(canonicalize(stream, new Set()), generic, "public canonicalizer retains its existing API and output");
    results.push(result.stream);
  }
  assert.equal(results[0], results[1]);
});

test("every observed regular, import and deferred reference prefix remains significant", () => {
  for (const layout of ["clean35", "derived32"]) {
    const source = canonicalWire(fixtureFrames(layout));
    const references = [...source.matchAll(/"(\$(?:L|@)?[0-9a-f]+)"/g)].map((match) => match[1]);
    assert(references.length > 20);
    for (const [position, reference] of references.entries()) {
      const changed = reference.startsWith("$L") || reference.startsWith("$@")
        ? "$" + reference.slice(2) : "$L" + reference.slice(1);
      assertRejected((frames) => {
        let occurrence = 0;
        for (const frame of frames) if (frame.value !== undefined) {
          frame.value = visit(frame.value, (value) => {
            if (!/^\$(?:L|@)?[0-9a-f]+$/.test(value)) return value;
            return occurrence++ === position ? changed : value;
          });
        }
      }, layout + " rejects prefix swap at " + position + ": " + reference, layout);
    }
  }
});

test("valid-kind outlining, relocation and sharing cannot bypass the exact layout", () => {
  for (const layout of ["clean35", "derived32"]) {
    const frames = fixtureFrames(layout);
    const root = frames.find((frame) => frame.id === "0").value;
    const intro = findElement(root, (element) => element[3].id === "recruitmentIntro");
    assert(intro);
    const outlined = structuredClone(intro);
    function outline(value) {
      if (Array.isArray(value)) return value === intro ? "$L3f" : value.map(outline);
      if (value !== null && typeof value === "object") return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, outline(item)]),
      );
      return value;
    }
    frames.find((frame) => frame.id === "0").value = outline(root);
    frames.push({ id: "3f", kind: "", value: outlined });
    const stream = wire(frames);
    assert.notEqual(parseFlight(stream, new Set()), null, "generic parser accepts a valid lazy server record");
    assert.equal(normalize(stream), null, "unapproved extra outline must still fail");
  }
  assertRejected((frames) => {
    const heading = frames.find((frame) => frame.id === "8");
    heading.value[3].children = "$L8";
  }, "self-cycle");
  assertRejected((frames) => frames.push({ id: "3f", kind: "", value: [] }), "orphan record");
  assertRejected((frames) => frames.push(structuredClone(frames.find((frame) => frame.id === "8"))), "duplicate record");
  assertRejected((frames) => {
    const root = frames.find((frame) => frame.id === "0").value;
    root.f.push("$L8", "$L8");
  }, "shared reference layout");
});

test("static content, import identities, key order and resource values stay source-bound", () => {
  const mutants = [
    [(frames) => { frames.find((frame) => frame.id === "8").value[3].children += " altered"; }, "literal content"],
    [(frames) => { frames.find((frame) => frame.id === "16").value[0] += 1; }, "import module"],
    [(frames) => { frames.find((frame) => frame.id === "16").value[2] = "OtherPlayer"; }, "import export"],
    [(frames) => { frames.find((frame) => frame.id === "16").value[1].pop(); }, "import chunk count"],
    [(frames) => { const target = frames.find((frame) => frame.id === "8").value; target[3] = Object.fromEntries(Object.entries(target[3]).reverse()); }, "property key order"],
    [(frames) => { frames.find((frame) => frame.id === "a").value[3].sources[0].src = "/assets/audio/other.mp3"; }, "audio resource"],
    [(frames) => { frames.find((frame) => frame.id === "0").value.c = ["", "privacy"]; }, "cross-route root"],
    [(frames) => { frames.find((frame) => frame.id === "21").value[2][3].href = "https://mochirii.com/privacy"; }, "canonical route"],
    [(frames) => { frames.find((frame) => frame.kind === "HL").value[0] = "/_next/static/chunks/other.css"; }, "resource hint"],
    [(frames) => frames.push(structuredClone(frames.find((frame) => frame.kind === "HL"))), "duplicate hint"],
    [(frames) => { const hint = frames.findIndex((frame) => frame.kind === "HL"); [frames[hint], frames[hint + 1]] = [frames[hint + 1], frames[hint]]; }, "hint order"],
  ];
  for (const [mutate, label] of mutants) assertRejected(mutate, label);
  const canonical = canonicalWire(fixtureFrames());
  const duplicateKey = canonical.replace('"children":"A Note From Twills"', '"children":"A Note From Twills","children":"A Note From Twills"');
  assert.notEqual(duplicateKey, canonical);
  assert.equal(normalizeSource(Object.freeze({ stream: duplicateKey, homeSourceProfile: null }), "recruitment"), null);
  assert.equal(normalizeSource(Object.freeze({ stream: canonical.replace('"P":null', '"P": null'), homeSourceProfile: null }), "recruitment"), null);
  assert.equal(normalizeSource(Object.freeze({ stream: canonical.replace('"i":false', '"i":-0'), homeSourceProfile: null }), "recruitment"), null);
});

test("closed deferred shape, bounded work and private metadata fail closed", () => {
  for (const kind of ["x", "C\"$8\"", "X\n12:X", "C\n12:C"]) {
    assertRejected((frames) => { frames.find((frame) => frame.kind === "X").kind = kind; }, "deferred open mutation " + kind);
  }
  assertRejected((frames) => frames.splice(frames.findIndex((frame) => frame.kind === "C"), 1), "missing deferred close");
  assertRejected((frames) => {
    const close = frames.splice(frames.findIndex((frame) => frame.kind === "C"), 1)[0];
    frames.unshift(close);
  }, "deferred close before open");
  assertRejected((frames) => {
    const target = frames.find((frame) => frame.id === "8");
    target.value[3].children = "𐐀".repeat(60000);
  }, "near256KiB UTF-8 string");
  assertRejected((frames) => {
    for (let index = 0; index < 8; index += 1) frames.push({ id: (63 + index).toString(16), kind: "", value: ["$L" + (64 + index).toString(16), "$L" + (64 + index).toString(16)] });
  }, "DAG amplification exceeds layout/frame bounds");
  const parsed = parseFlight(wire(fixtureFrames()), new Set());
  assert.equal(normalizeSource({ ...parsed }, "recruitment"), null, "mutable fabricated metadata");
  assert.equal(normalizeSource(Object.freeze({ ...parsed, homeSourceProfile: "base" }), "recruitment"), null);
  assert.equal(normalizeSource(Object.freeze({ ...parsed, extra: true }), "recruitment"), null);
  const normalized = normalizeSource(parsed, "recruitment");
  const sentinel = Object.freeze({ header: "A".repeat(64), resources: "B".repeat(64) });
  const groups = { ...policies, recruitmentSource: sentinel };
  assert.equal(selectPolicy(groups, "recruitment", normalized, null), sentinel);
  for (const route of ["home", "privacy", "deletion", "recruitmentSource", "unknown"]) {
    assert.equal(selectPolicy(groups, route, normalized, null), null, route + " cannot select Recruitment source policy");
  }
  assert.equal(selectPolicy(groups, "recruitment", normalized, { requestStartedAtMs: 0, responseReceivedAtMs: 0 }), null);
  assert.equal(productionDocumentProfileMatches("recruitmentSource", sentinel.header, sentinel.resources), false);
  assert.equal(selectPolicy(groups, "recruitment", parsed, null), policies.recruitment, "legacy exact profile stays intact");
});

function legalFixtureFrames(profile, outlined = false) {
  const frames = profile === "privacy" ? privacySourceFrames() : deletionSourceFrames();
  if (!outlined) return frames;
  const root = frames.find((frame) => frame.id === "0");
  const target = profile === "privacy"
    ? findElement(root.value, (element) => element[3]["aria-labelledby"] === "privacyScopeTitle")[3].children[2][3].children[0]
    : findElement(root.value, (element) => element[3].id === "deletionRequestTitle");
  assert(Array.isArray(target));
  const renameId = (id) => id && Number.parseInt(id, 16) >= 8
    ? (Number.parseInt(id, 16) + 1).toString(16) : id;
  function transform(value) {
    if (value === target) return "$L8";
    if (typeof value === "string") {
      const reference = /^\$(L|@)?([0-9a-f]+)$/.exec(value);
      return reference ? "$" + (reference[1] || "") + renameId(reference[2]) : value;
    }
    if (Array.isArray(value)) return value.map(transform);
    if (value !== null && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, transform(item)]),
    );
    return value;
  }
  for (const frame of frames) {
    frame.id = renameId(frame.id);
    if (frame.value !== undefined) frame.value = transform(frame.value);
  }
  const insertAt = frames.findIndex((frame) => frame.id === "9" && frame.kind === "");
  assert(insertAt > 0);
  frames.splice(insertAt, 0, { id: "8", kind: "", value: target });
  return frames;
}

const legalHashes = {
  privacy: {
    source: "B7E097D28ADF42B12BA09973D6F901336A1ADA8F4068E878C2DD73D8CDF8A472",
    outlined: "AD248D2C8D9230734B6552C3F4A9CFBC7BD204C94DFBE7053D5A18886A4F838F",
    normalized: "BE08C564D99BDB73BBBE215A001D74FF227FB974462492C9698A0CDE60716221",
  },
  deletion: {
    source: "2253DA747C14BE5FE5A10CC078BE6D154EE7CAE8774C6861949B969B74BCD6F2",
    outlined: "ED3DD2CC99BDADBD88AC77B1ECE1DFE3BF5204897708EF5DEF86CF0000BEA887",
    normalized: "F1CDD0B7C7243B095F933366F58EAD3E1FA620B073F4D4509C2E1BB0215500D8",
  },
};

for (const profile of ["privacy", "deletion"]) {
  test(profile + ": exact source-derived layouts, all reference positions and route isolation", () => {
    const sentinel = Object.freeze({ header: "A".repeat(64), resources: "B".repeat(64) });
    const groups = { ...policies, [profile + "Source"]: sentinel };
    const outputs = [];
    for (const outlined of [false, true]) {
      const frames = legalFixtureFrames(profile, outlined);
      const stream = wire(frames);
      const generic = canonicalize(stream, new Set());
      assert.equal(hash(generic), legalHashes[profile][outlined ? "outlined" : "source"]);
      const result = normalize(stream, profile);
      assert(result && Object.isFrozen(result));
      assert.equal(result.staticSourceProfile, profile);
      assert.equal(result.homeSourceProfile, null);
      assert.equal(hash(result.stream), legalHashes[profile].normalized);
      outputs.push(result.stream);
      assert.equal(selectPolicy(groups, profile, result, null), sentinel);
      assert.equal(productionDocumentProfileMatches(profile + "Source", sentinel.header, sentinel.resources), false);
      for (const other of ["home", "recruitment", "privacy", "deletion", "unknown", "__proto__"]) {
        if (other === profile) continue;
        assert.equal(normalize(stream, other), null, "wrong graph/profile " + other);
        assert.equal(selectPolicy(groups, other, result, null), null, "wrong metadata/profile " + other);
      }
      assert.equal(selectPolicy({}, profile, result, null), null, "no cross-profile fallback");
      const references = [...canonicalWire(frames).matchAll(/"(\$(?:L|@)?[0-9a-f]+)"/g)].map((match) => match[1]);
      assert(references.length > 20);
      for (const [position, reference] of references.entries()) {
        const mutants = legalFixtureFrames(profile, outlined);
        let occurrence = 0;
        for (const frame of mutants) if (frame.value !== undefined) {
          frame.value = visit(frame.value, (value) => {
            if (!/^\$(?:L|@)?[0-9a-f]+$/.test(value)) return value;
            if (occurrence++ !== position) return value;
            return reference.startsWith("$L") || reference.startsWith("$@")
              ? "$" + reference.slice(2) : "$L" + reference.slice(1);
          });
        }
        assert.equal(normalize(wire(mutants), profile), null, "reference kind at " + position);
      }
    }
    assert.equal(outputs[0], outputs[1]);
  });

  test(profile + ": content, imports, hints, order, orphan and unapproved outlining mutations reject", () => {
    const reject = (mutate, label) => {
      const frames = legalFixtureFrames(profile);
      mutate(frames);
      assert.equal(normalize(wire(frames), profile), null, label);
    };
    const introId = profile === "privacy" ? "privacyIntro" : "metaDataDeletionIntro";
    reject((frames) => { findElement(frames.find((frame) => frame.id === "0").value, (element) => element[3].id === introId)[3].children += " changed"; }, "static content");
    reject((frames) => { frames.find((frame) => frame.kind === "I").value[0] += 1; }, "client module identity");
    reject((frames) => { frames.find((frame) => frame.kind === "I").value[2] += "Changed"; }, "client export identity");
    reject((frames) => { frames.find((frame) => frame.kind === "I").value[1].pop(); }, "client chunk count");
    reject((frames) => { const element = findElement(frames.find((frame) => frame.id === "0").value, (item) => item[3].id === introId); element[3] = Object.fromEntries(Object.entries(element[3]).reverse()); }, "property key order");
    reject((frames) => { frames.find((frame) => frame.kind === "HL").value[0] = "/_next/static/chunks/other.css"; }, "resource hint");
    reject((frames) => frames.push(structuredClone(frames.find((frame) => frame.kind === "HL"))), "extra hint");
    reject((frames) => frames.push({ id: "3f", kind: "", value: [] }), "orphan record");
    reject((frames) => frames.push(structuredClone(frames.find((frame) => frame.kind === "I"))), "duplicate import");
    reject((frames) => { frames.find((frame) => frame.kind === "X").kind = "x"; }, "deferred case");
    reject((frames) => { frames.find((frame) => frame.kind === "C").kind = 'C"$8"'; }, "deferred return value");
    reject((frames) => { frames.find((frame) => frame.id === "0").value.c = ["", "recruitment"]; }, "cross-route root");
    const frames = legalFixtureFrames(profile);
    const root = frames.find((frame) => frame.id === "0");
    const intro = findElement(root.value, (element) => element[3].id === introId);
    function outline(value) {
      if (value === intro) return "$L3f";
      if (Array.isArray(value)) return value.map(outline);
      if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, outline(item)]));
      return value;
    }
    root.value = outline(root.value);
    frames.push({ id: "3f", kind: "", value: intro });
    assert.notEqual(parseFlight(wire(frames), new Set()), null);
    assert.equal(normalize(wire(frames), profile), null, "additional valid lazy outlining is not an approved layout");
  });
}
