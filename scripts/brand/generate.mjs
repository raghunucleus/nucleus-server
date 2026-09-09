/**
 * Nucleus brand asset generator.
 *
 *   npm run brand:generate            (from the nucleus-server root)
 *
 * Renders every favicon, app icon, splash image, manifest, email logo and the
 * generated TypeScript geometry modules for ALL sibling repos from the single
 * source of truth in `mark.mjs` + `src/wordmark.json`. Output files are
 * committed in each consuming repo; never hand-edit them — change `mark.mjs`
 * and re-run.
 *
 * Uses the `sharp` already shipped by nucleus-server (libvips + librsvg) and
 * a tiny PNG-in-ICO writer; no extra dependencies.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import {
  PALETTES,
  CSS_VAR_PALETTE,
  EMPLOYEE_TILE,
  ORBIT_PERIODS_MS,
  ORBIT_DIRECTIONS,
  VIEWBOX_ATTR,
  markSvg,
  markInner,
  horizontalLockupSvg,
  stackedLockupSvg,
  resolve as resolveMark,
} from './mark.mjs';

const here = dirname(fileURLToPath(import.meta.url));
/** Parent folder holding every Nucleus repo. */
const ROOT = join(here, '..', '..', '..');
const repo = (name, ...p) => join(ROOT, name, ...p);

const wordmark = JSON.parse(readFileSync(join(here, 'src', 'wordmark.json'), 'utf8'));

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const written = [];

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  written.push(relative(ROOT, path));
}

function remove(path) {
  if (existsSync(path)) {
    rmSync(path);
    written.push(`${relative(ROOT, path)} (deleted)`);
  }
}

/** Rasterise an SVG string. `background` flattens alpha onto a solid colour. */
async function png(svg, { background = null } = {}) {
  let img = sharp(Buffer.from(svg));
  if (background) img = img.flatten({ background });
  return img.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

/** ICO container with PNG-encoded entries (supported by every modern browser and Windows). */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = [];
  const blobs = [];
  for (const { size, buffer } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buffer.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buffer.length;
    dir.push(e);
    blobs.push(buffer);
  }
  return Buffer.concat([header, ...dir, ...blobs]);
}

/** A plain tile (no mark) — the employee Android adaptive-icon background. */
function tileSvg({ size, from, to }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#t)"/></svg>`;
}

/** The email header lockup: white rounded tile with the colour mark + white wordmark. */
function emailLogoSvg({ height = 80 }) {
  const [, , ww, wh] = wordmark.viewBox;
  const wordH = height * 0.45;
  const wordW = Number(((ww / wh) * wordH).toFixed(1));
  const gap = height * 0.2;
  const width = Math.ceil(height + gap + wordW);
  const rx = Number((760 * 0.22).toFixed(0));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Nucleus"><svg x="0" y="0" width="${height}" height="${height}" viewBox="${VIEWBOX_ATTR}"><rect x="-380" y="-380" width="760" height="760" rx="${rx}" fill="#ffffff"/><g transform="scale(0.76)">${markInner({ palette: PALETTES.light, idPrefix: 'em' })}</g></svg><svg x="${height + gap}" y="${(height - wordH) / 2}" width="${wordW}" height="${wordH}" viewBox="${wordmark.viewBox.join(' ')}" preserveAspectRatio="xMinYMid meet"><path d="${wordmark.d}" fill="#ffffff"/></svg></svg>`;
}

/** Open Graph card: light canvas with the horizontal lockup centred. */
function ogImageSvg() {
  const lockup = horizontalLockupSvg({ wordmark, palette: PALETTES.light, height: 300, idPrefix: 'og' });
  const width = Number(lockup.match(/width="([\d.]+)"/)[1]);
  const viewBox = lockup.match(/viewBox="([^"]+)"/)[1];
  const x = (1200 - width) / 2;
  const y = (630 - 300) / 2;
  // Keep the lockup's own viewBox on the nested <svg> so its 760-unit space scales into the card.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#f4f4f5"/><svg x="${x}" y="${y}" width="${width}" height="300" viewBox="${viewBox}">${lockup.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg></svg>`;
}

/* -------------------------------------------------------------------------- */
/* Generated TypeScript modules                                                */
/* -------------------------------------------------------------------------- */

/** Serialise a plain value as a TS literal (single quotes, unquoted keys). */
function ts(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const simple = value.every((v) => typeof v !== 'object' || v === null);
    if (simple) return `[${value.map((v) => ts(v)).join(', ')}]`;
    return `[\n${value.map((v) => `${padIn}${ts(v, indent + 1)}`).join(',\n')},\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((k) => `${padIn}${k}: ${ts(value[k], indent + 1)}`).join(',\n')},\n${pad}}`;
  }
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(value);
}

const GENERATED_HEADER = `/* GENERATED by nucleus-server/scripts/brand/generate.mjs — do not edit by hand.
 * Source of truth: nucleus-server/scripts/brand/mark.mjs. Re-run \`npm run brand:generate\`. */
`;

function geometryModule() {
  const shape = (variant) => {
    const m = resolveMark(variant);
    const grad = (g) => ({
      ...(g.cx !== undefined
        ? { cx: g.cx, cy: g.cy, r: g.r, fx: g.fx, fy: g.fy }
        : { x1: g.x, y1: g.y, x2: g.x2, y2: g.y2 }),
      stops: g.stops.map(([offset, tone]) => ({ offset, tone })),
    });
    const gradients = Object.fromEntries(Object.entries(m.gradients).map(([k, g]) => [k, grad(g)]));
    return { stroke: m.stroke, coreRadius: m.coreRadius, paths: m.paths, gradients, electrons: m.electrons };
  };
  return `${GENERATED_HEADER}
export type NucleusPaletteKey = 'p1' | 'p2' | 'o1' | 'o2' | 'c1' | 'c2' | 'c3' | 'wordmark';
export type NucleusPalette = Record<NucleusPaletteKey, string>;
export type NucleusTone = 'light' | 'dark' | 'white' | 'mono';

/** The 760-unit canvas every mark path is drawn in (centre at the origin). */
export const NUCLEUS_VIEWBOX = '${VIEWBOX_ATTR}';
export const NUCLEUS_CANVAS = 760;

export const NUCLEUS_PALETTES: Record<NucleusTone, NucleusPalette> = ${ts({
    light: PALETTES.light,
    dark: PALETTES.dark,
    white: PALETTES.white,
    mono: PALETTES.mono,
  })};

/** Employee app tile — deep purple diagonal gradient (top-left → bottom-right). */
export const NUCLEUS_EMPLOYEE_TILE = ${ts(EMPLOYEE_TILE)};

export interface NucleusGradientStop {
  offset: number;
  tone: NucleusPaletteKey;
}
export interface NucleusLinearGradient {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stops: NucleusGradientStop[];
}
export interface NucleusRadialGradient {
  cx: number;
  cy: number;
  r: number;
  fx: number;
  fy: number;
  stops: NucleusGradientStop[];
}
export interface NucleusElectron {
  x: number;
  y: number;
  r: number;
  tone: NucleusPaletteKey;
}
export interface NucleusMarkGeometry {
  stroke: number;
  coreRadius: number;
  paths: {
    outerPurple: string;
    outerOrange: string;
    innerPurple?: string;
    innerBlend?: string;
  };
  gradients: {
    outerPurple: NucleusLinearGradient;
    outerOrange: NucleusLinearGradient;
    innerPurple?: NucleusLinearGradient;
    innerBlend?: NucleusLinearGradient;
    core: NucleusRadialGradient;
  };
  electrons: NucleusElectron[];
}

/** The full mark: two rings, gradient core, four electrons. */
export const NUCLEUS_MARK: NucleusMarkGeometry = ${ts(shape('full'))};

/** Simplified mark for tiny renders (≤ 32 px). */
export const NUCLEUS_MARK_SMALL: NucleusMarkGeometry = ${ts(shape('small'))};

/**
 * Loader animation: each ring revolves *with* its own electrons as one rigid
 * group about the still core, so a ring's gaps always sit where the logo puts
 * them and no electron is ever stranded in one. The outer group carries the
 * ring plus all four electrons at their logo angles; the inner ring spins bare
 * and the other way — its two gaps are what make its motion readable. The first
 * frame is therefore pixel-identical to the static logo.
 */
export const NUCLEUS_ORBIT_PERIODS_MS = ${ts(ORBIT_PERIODS_MS)} as const;

/** Turn direction per ring: 1 = clockwise, -1 = anticlockwise. */
export const NUCLEUS_ORBIT_DIRECTIONS = ${ts(ORBIT_DIRECTIONS)} as const;
`;
}

function wordmarkModule() {
  const [x, y, w, h] = wordmark.viewBox;
  return `${GENERATED_HEADER}
/** The "nucleus" wordmark, traced from the original artwork. Fill with the palette's \`wordmark\` colour. */
export const NUCLEUS_WORDMARK = {
  viewBox: '${x} ${y} ${w} ${h}',
  width: ${w},
  height: ${h},
  d: ${ts(wordmark.d)},
} as const;
`;
}

/* -------------------------------------------------------------------------- */
/* Asset sets                                                                  */
/* -------------------------------------------------------------------------- */

const DARK = PALETTES.dark;

async function webFaviconSet(dir, { name, shortName, withOg = false }) {
  // Vector favicon: simplified mark, self-contained dark-scheme override.
  write(join(dir, 'favicon.svg'), markSvg({ size: 64, variant: 'small', pad: 0.02, darkPalette: DARK }));

  const small16 = await png(markSvg({ size: 16, variant: 'small', pad: 0.02 }));
  const small32 = await png(markSvg({ size: 32, variant: 'small', pad: 0.02 }));
  const full48 = await png(markSvg({ size: 48, pad: 0.02 }));
  write(join(dir, 'favicon.ico'), ico([
    { size: 16, buffer: small16 },
    { size: 32, buffer: small32 },
    { size: 48, buffer: full48 },
  ]));
  write(join(dir, 'favicon-96x96.png'), await png(markSvg({ size: 96, pad: 0.02 })));

  // Home-screen icons: mark on a white tile (iOS/Android mask the corners).
  const white = { fill: '#ffffff' };
  write(join(dir, 'apple-touch-icon.png'), await png(markSvg({ size: 180, pad: 0.12, tile: white }), { background: '#ffffff' }));
  write(join(dir, 'icon-192.png'), await png(markSvg({ size: 192, pad: 0.12, tile: white }), { background: '#ffffff' }));
  write(join(dir, 'icon-512.png'), await png(markSvg({ size: 512, pad: 0.12, tile: white }), { background: '#ffffff' }));
  write(join(dir, 'icon-512-maskable.png'), await png(markSvg({ size: 512, pad: 0.2, tile: white }), { background: '#ffffff' }));

  write(join(dir, 'site.webmanifest'), JSON.stringify({
    name,
    short_name: shortName,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    theme_color: '#2563eb',
    background_color: '#f4f4f5',
    display: 'standalone',
    start_url: '/',
  }, null, 2) + '\n');

  // Reusable vector lockups.
  write(join(dir, 'brand', 'nucleus-mark.svg'), markSvg({ size: 256, pad: 0.02, darkPalette: DARK }));
  write(join(dir, 'brand', 'nucleus-logo-horizontal.svg'), horizontalLockupSvg({ wordmark, height: 96, darkPalette: DARK }));
  write(join(dir, 'brand', 'nucleus-logo-stacked.svg'), stackedLockupSvg({ wordmark, width: 320, darkPalette: DARK }));

  if (withOg) write(join(dir, 'og-image.png'), await png(ogImageSvg(), { background: '#f4f4f5' }));
}

async function mobileSet(dir, { tile }) {
  const purple = tile === 'purple';
  const iconTile = purple ? { from: EMPLOYEE_TILE.from, to: EMPLOYEE_TILE.to } : { fill: '#ffffff' };
  const markPalette = purple ? PALETTES.white : PALETTES.light;

  // iOS universal icon — opaque, square (the OS masks corners).
  write(join(dir, 'icon.png'), await png(markSvg({ size: 1024, pad: 0.14, tile: iconTile, palette: markPalette }), { background: purple ? EMPLOYEE_TILE.solid : '#ffffff' }));
  // iOS 18 appearance variants: dark keeps alpha (system paints a dark ground), tinted is grayscale.
  write(join(dir, 'icon-ios-dark.png'), await png(markSvg({ size: 1024, pad: 0.14, palette: purple ? PALETTES.white : PALETTES.dark })));
  write(join(dir, 'icon-ios-tinted.png'), await png(markSvg({ size: 1024, pad: 0.14, palette: PALETTES.tinted })));

  // Android adaptive layers — mark inside the 66 % safe zone.
  write(join(dir, 'android-icon-foreground.png'), await png(markSvg({ size: 1024, pad: 0.21, palette: markPalette })));
  if (purple) {
    write(join(dir, 'android-icon-background.png'), await png(tileSvg({ size: 1024, from: EMPLOYEE_TILE.from, to: EMPLOYEE_TILE.to })));
  } else {
    // Solid white comes from `adaptiveIcon.backgroundColor`; an image would override it.
    remove(join(dir, 'android-icon-background.png'));
  }
  write(join(dir, 'android-icon-monochrome.png'), await png(markSvg({ size: 1024, pad: 0.21, palette: PALETTES.mono })));

  // Native splash — mark only (Android 12+ circle-masks the splash icon).
  write(join(dir, 'splash-icon.png'), await png(markSvg({ size: 1024, pad: 0.04 })));
  write(join(dir, 'splash-icon-dark.png'), await png(markSvg({ size: 1024, pad: 0.04, palette: PALETTES.dark })));

  write(join(dir, 'favicon.png'), await png(markSvg({ size: 48, pad: 0.02 })));
  // Android status-bar glyph: white alpha silhouette, tinted by the OS.
  write(join(dir, 'notification-icon.png'), await png(markSvg({ size: 96, variant: 'small', pad: 0.06, palette: PALETTES.mono })));
}

async function serverSet(dir) {
  write(join(dir, 'email-logo.png'), await png(emailLogoSvg({ height: 80 })));
  write(join(dir, 'favicon.svg'), markSvg({ size: 64, variant: 'small', pad: 0.02, darkPalette: DARK }));
  write(join(dir, 'mark-192.png'), await png(markSvg({ size: 192, pad: 0.02 })));
  write(join(dir, 'mark-512.png'), await png(markSvg({ size: 512, pad: 0.02 })));
  write(join(dir, 'nucleus-logo-horizontal.svg'), horizontalLockupSvg({ wordmark, height: 96, darkPalette: DARK }));
}

function tsModules(dir) {
  write(join(dir, 'nucleus-mark-geometry.ts'), geometryModule());
  write(join(dir, 'nucleus-wordmark-path.ts'), wordmarkModule());
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

await webFaviconSet(repo('nucleus-ui', 'public'), { name: 'Nucleus', shortName: 'Nucleus' });
await webFaviconSet(repo('nucleus-admin-ui', 'public'), { name: 'Nucleus Admin', shortName: 'Nucleus Admin' });
await webFaviconSet(repo('nucleus-website', 'public'), { name: "Raghu's Nucleus", shortName: 'Nucleus', withOg: true });
tsModules(repo('nucleus-ui', 'src', 'components', 'brand'));
tsModules(repo('nucleus-admin-ui', 'src', 'components', 'brand'));

await mobileSet(repo('nucleus-mobile', 'assets', 'images'), { tile: 'white' });
await mobileSet(repo('nucleus-employee-mobile', 'assets', 'images'), { tile: 'purple' });
tsModules(repo('nucleus-mobile', 'components', 'ui'));
tsModules(repo('nucleus-employee-mobile', 'components', 'ui'));

await serverSet(repo('nucleus-server', 'src', 'brand', 'assets'));

write(repo('nucleus-dev', 'public', 'favicon.svg'), markSvg({ size: 64, variant: 'small', pad: 0.02, darkPalette: DARK }));

// Preview sheet for eyeballing every variant at once (not consumed by any app).
write(join(here, 'preview', 'mark-light.svg'), markSvg({ size: 512, pad: 0.02 }));
write(join(here, 'preview', 'mark-dark.svg'), markSvg({ size: 512, pad: 0.02, palette: PALETTES.dark, tile: { fill: '#202124' } }));
write(join(here, 'preview', 'mark-small.svg'), markSvg({ size: 512, variant: 'small', pad: 0.02 }));
write(join(here, 'preview', 'mark-animated.svg'), markSvg({ size: 512, pad: 0.02, animated: true }));
write(join(here, 'preview', 'lockup-horizontal.svg'), horizontalLockupSvg({ wordmark, height: 160 }));
write(join(here, 'preview', 'lockup-stacked.svg'), stackedLockupSvg({ wordmark, width: 480 }));
// Snippets to paste into HTML (boot splashes / website veil): orbit markup, no intrinsic size, no <style>
// (the host page ships the keyframes). `inline-cssvars` colours via --nucleus-* custom properties;
// `inline-dark` uses literal dark-palette colours.
write(join(here, 'preview', 'mark-inline-cssvars.svg'), markSvg({ size: null, palette: CSS_VAR_PALETTE, idPrefix: 'ns', animated: true, embedCss: false }));
write(join(here, 'preview', 'mark-inline-dark.svg'), markSvg({ size: null, palette: PALETTES.dark, idPrefix: 'nv', animated: true, embedCss: false }));

console.log(written.map((f) => `  ${f}`).join('\n'));
console.log(`\n${written.length} files written.`);
