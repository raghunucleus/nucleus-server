# Nucleus brand assets

Single source of truth for the Nucleus logo across every repo. **Never hand-edit a generated icon,
favicon, splash image or the generated `nucleus-mark-geometry.ts` / `nucleus-wordmark-path.ts` modules** —
change the source here and regenerate.

```
npm run brand:generate        # from the nucleus-server root; writes into all sibling repos
```

| File | Role |
|---|---|
| `mark.mjs` | The geometry (ring radii, arc angles, electron positions, gradients, palettes, loader orbits) and the string-SVG renderers. Edit this to change the mark. |
| `src/wordmark.json` | The "nucleus" wordmark as one SVG path, traced once from the original artwork **and hand-corrected twice** — see below. |
| `src/nucleus-logo-original.jpg` | The artwork the mark and wordmark were measured/traced from (provenance only). |
| `trace-wordmark.mjs` | One-off tracer (needs `potrace` on `NODE_PATH`; see the header comment). Only re-run if the artwork changes. |
| `generate.mjs` | Renders every target with the `sharp` already installed here: favicons + ICO + PWA icons + manifests for the web apps and website, both mobile icon sets (iOS light/dark/tinted, Android adaptive + monochrome, splash light/dark, notification glyph), the email logo and Swagger favicon in `src/brand/assets/`, and the TypeScript geometry modules the web/mobile components draw from. |
| `preview/` | Eyeball sheets (light/dark/small/animated marks, lockups) and the inline snippets pasted into the portals' `index.html` boot splashes and the website preloader. |

## Where the outputs go

- `nucleus-ui/public/`, `nucleus-admin-ui/public/`, `nucleus-website/public/` — favicon set, manifest, `brand/*.svg` (+ `og-image.png` for the website)
- `nucleus-ui/src/components/brand/`, `nucleus-admin-ui/src/components/brand/` — generated geometry + wordmark modules
- `nucleus-mobile/assets/images/`, `nucleus-employee-mobile/assets/images/` — app icons, splash, notification icon
- `nucleus-mobile/components/ui/`, `nucleus-employee-mobile/components/ui/` — generated geometry + wordmark modules
- `nucleus-server/src/brand/assets/` — served at `/brand/*` (email header logo, Swagger favicon)
- `nucleus-dev/public/favicon.svg`

## The wordmark's two hand-corrections

`src/wordmark.json` is **not** raw tracer output. Re-running `trace-wordmark.mjs` discards both of these,
so re-apply them if the artwork is ever re-traced:

1. **The `e`'s counter is reversed.** potrace traces it with the same winding as the letter's outer contour,
   and `fill-rule: nonzero` (the default in browsers, react-native-svg and librsvg alike) then fills it —
   the `e` renders as a solid blob with no eye. The subpath is stored reversed so the windings cancel.
2. **The viewBox is the path's bounding box, not the source image's ink box.** potrace's fitted curves
   overshoot the pixels they were fitted to by 1–3 units, so a pixel-derived box clips the artwork — it was
   flattening the baseline of `c`/`e`/`u`/`u`/`s` and the right flank of the `s`. Always derive it from the
   path bbox plus ~1 unit of margin.

## Loader animation

Every loading indicator built from the mark follows the same contract (`data-part` groups emitted by
`markInner`): the core stays still while **each ring revolves together with its own electrons** as one rigid
group — the outer ring plus all four electrons clockwise (one revolution per `ORBIT_PERIODS_MS.outer`), the
inner ring bare and anticlockwise (`ORBIT_PERIODS_MS.inner`, see `ORBIT_DIRECTIONS`). Because a ring's gaps
travel with its electrons, no electron is ever stranded in a gap and the first frame is pixel-identical to
the static logo. Reduced-motion users get that still logo.

After regenerating, re-paste `preview/mark-inline-cssvars.svg` into both portals' `index.html` boot splash and
`preview/mark-inline-dark.svg` into `nucleus-website/index.html` (the veil) if the markup changed.
