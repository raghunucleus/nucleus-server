/**
 * One-off: vectorise the "nucleus" wordmark from the supplied JPG.
 *
 * Output is committed as `src/wordmark.json` so nothing downstream needs the
 * JPG or this script again. Re-run only if the source artwork changes.
 *
 * ⚠ THIS SCRIPT'S RAW OUTPUT IS NOT SHIPPABLE. `src/wordmark.json` carries two
 * hand-corrections that re-running this WILL DISCARD — re-apply both:
 *
 *   1. potrace traces the `e`'s counter with the SAME winding as the letter's
 *      outer contour, which `fill-rule: nonzero` (the default everywhere —
 *      browsers, react-native-svg, librsvg) renders as a solid blob with no
 *      eye. Reverse that subpath so the windings cancel.
 *   2. The viewBox below is derived from the source image's ink box, but
 *      potrace's fitted curves overshoot the pixels they were fitted to by a
 *      couple of units — that box clipped the baseline of c/e/u/u/s and the
 *      right flank of the s. Derive the viewBox from the PATH's bounding box
 *      (plus ~1 unit of margin), never from the pixel extents.
 *
 * `potrace` is deliberately NOT a dependency of nucleus-server — install it
 * somewhere temporary and point NODE_PATH at it:
 *
 *   mkdir %TEMP%\potrace && cd %TEMP%\potrace && npm init -y && npm i potrace
 *   set NODE_PATH=%TEMP%\potrace\node_modules
 *   node scripts/brand/trace-wordmark.mjs        (from the nucleus-server root)
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const potrace = require('potrace');

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'src', 'nucleus-logo-original.jpg');
const OUT = join(here, 'src', 'wordmark.json');

// Wordmark ink in the 1254 px source spans x 82–1171, y 850–1075. Crop with a
// margin, upscale 3× so the anti-aliased edges become sub-pixel accurate curves,
// then threshold: navy (#041d55) → black, paper → white.
const CROP = { left: 60, top: 836, width: 1134, height: 256 };
const SCALE = 3;

const bitmap = await sharp(readFileSync(SOURCE))
  .extract(CROP)
  .resize(CROP.width * SCALE, CROP.height * SCALE, { kernel: 'lanczos3' })
  .grayscale()
  .threshold(140)
  .png()
  .toBuffer();

const svg = await new Promise((resolve, reject) => {
  potrace.trace(
    bitmap,
    { threshold: 128, turdSize: 10, optCurve: true, optTolerance: 0.2, alphaMax: 1, color: '#000000' },
    (err, out) => (err ? reject(err) : resolve(out)),
  );
});

const match = svg.match(/<path[^>]*\sd="([^"]+)"/);
if (!match) throw new Error('potrace produced no <path>');
const d = match[1].replace(/\s+/g, ' ').trim();

// Tight ink box in crop×scale coordinates (from the measured source extents).
const minX = (82 - CROP.left) * SCALE;
const minY = (850 - CROP.top) * SCALE;
const maxX = (1171 - CROP.left + 1) * SCALE;
const maxY = (1075 - CROP.top + 1) * SCALE;

const out = {
  source: 'nucleus-logo-original.jpg',
  note: 'Traced with potrace from a 3x lanczos upscale of the wordmark crop; viewBox is the tight ink box.',
  viewBox: [minX, minY, maxX - minX, maxY - minY],
  d,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${OUT} (${d.length} chars, viewBox ${out.viewBox.join(' ')})`);
