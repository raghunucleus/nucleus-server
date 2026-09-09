/**
 * Nucleus brand mark — the single geometric source of truth.
 *
 * Everything brand-shaped in every repo (favicons, app icons, splash images,
 * the email logo, the inline React / React Native components and their
 * animated loaders) is derived from the numbers in this file. The values were
 * measured off the supplied `src/nucleus-logo-original.jpg` (1254 px square)
 * and then made concentric; angles use the maths convention (0° = right,
 * counter-clockwise positive), so `point(r, deg)` flips Y for SVG.
 *
 * Units: a 760-unit canvas centred on the origin (`viewBox="-380 -380 760 760"`).
 * The mark including its electrons spans a radius of ~362 units.
 */

export const VIEWBOX = [-380, -380, 760, 760];
export const VIEWBOX_ATTR = VIEWBOX.join(' ');

/** Ring / core geometry of the full mark. */
export const FULL = {
  stroke: 26,
  outer: {
    r: 304,
    /**
     * Deep purple → violet arc through the top, left and bottom. Starts 7°
     * clear of the orange electron: `stroke-linecap="round"` adds (stroke/2)/r
     * = 2.45° to each end, and the electron subtends ±asin(55/304) = ±10.42°
     * about 37.4°, so it occupies 26.98°–47.82°.
     */
    purple: [57.3, 318],
    /** Orange arc up the right-hand side (through 0°), ending 7° below the electron. */
    orange: [321, 377.5],
  },
  inner: {
    r: 192,
    /** Upper-left purple arc. */
    purple: [58.5, 193.4],
    /** One continuous arc through the bottom whose stroke fades purple → orange. */
    blend: [216.7, 403],
  },
  core: { r: 116 },
  /** Electrons sit on the outer ring. `tone` names a palette key. */
  electrons: [
    { angle: 148.7, r: 40, tone: 'p1' },
    { angle: 198.2, r: 50, tone: 'p1' },
    { angle: 313.2, r: 28, tone: 'p1' },
    { angle: 37.4, r: 55, tone: 'o1' },
  ],
};

/** One revolution per ring, in milliseconds. */
export const ORBIT_PERIODS_MS = { outer: 4000, inner: 1800 };

/**
 * Which way each ring turns: 1 = clockwise, -1 = anticlockwise. Counter-rotating
 * the two reads as a gyroscope and makes the speed difference obvious even small.
 */
export const ORBIT_DIRECTIONS = { outer: 1, inner: -1 };

/**
 * Simplified mark for tiny renders (16–32 px favicons, the 96 px Android
 * notification glyph): thicker ring, no inner ring, bigger core, three
 * electrons. Reads as "ring + electron" where the full mark would smear.
 */
export const SMALL = {
  stroke: 72,
  outer: {
    r: 300,
    /** 10° of air each side of the orange electron — the gap scales with the stroke. */
    purple: [67, 314],
    orange: [326, 367.8],
  },
  core: { r: 140 },
  electrons: [
    { angle: 148.7, r: 46, tone: 'p1' },
    { angle: 198.2, r: 58, tone: 'p1' },
    { angle: 37.4, r: 66, tone: 'o1' },
  ],
};

/**
 * Colour palettes. `light` is sampled straight from the JPG. `dark` lifts the
 * deep purple so the mark stays legible on #111 / #202124 / OLED surfaces.
 * `white` is for coloured tiles (employee app icon, the blue email bar).
 */
export const PALETTES = {
  light: {
    p1: '#3e0db5', p2: '#7a35d0',
    o1: '#ff9e08', o2: '#ff8a1c',
    c1: '#8b47d3', c2: '#4b249b', c3: '#1a1560',
    wordmark: '#041d55',
  },
  dark: {
    p1: '#7b58f5', p2: '#a98cff',
    o1: '#ffa826', o2: '#ff8f2e',
    c1: '#c9b0ff', c2: '#7b58f5', c3: '#3a2190',
    wordmark: '#f4f4f5',
  },
  white: {
    p1: '#ffffff', p2: '#efe8ff',
    o1: '#ffb020', o2: '#ff9a1c',
    c1: '#ffffff', c2: '#efe8ff', c3: '#c9b6ff',
    wordmark: '#ffffff',
  },
  mono: {
    p1: '#ffffff', p2: '#ffffff',
    o1: '#ffffff', o2: '#ffffff',
    c1: '#ffffff', c2: '#ffffff', c3: '#ffffff',
    wordmark: '#ffffff',
  },
  /** iOS 18 "tinted" icons must be grayscale; the system applies the hue. */
  tinted: {
    p1: '#ffffff', p2: '#ffffff',
    o1: '#d4d4d4', o2: '#c4c4c4',
    c1: '#ffffff', c2: '#e2e2e2', c3: '#9c9c9c',
    wordmark: '#ffffff',
  },
};

/** Employee app tile — a deep purple diagonal gradient. */
export const EMPLOYEE_TILE = { from: '#2a0a7a', to: '#4c16c9', solid: '#3a0fa0' };

const rad = (deg) => (deg * Math.PI) / 180;
const fmt = (n) => Number(n.toFixed(2));

/** A point on a circle of radius `r` at `deg` (maths angle), in SVG coords. */
export function point(r, deg) {
  return { x: fmt(r * Math.cos(rad(deg))), y: fmt(-r * Math.sin(rad(deg))) };
}

/**
 * SVG path for a circular arc from `a0` to `a1` degrees, counter-clockwise on
 * screen (increasing maths angle). `a1` may exceed 360 to pass through 0°.
 */
export function arcPath(r, a0, a1) {
  const s = point(r, a0);
  const e = point(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  // sweep-flag 0 = negative-angle direction in SVG's y-down space = CCW on screen.
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

/**
 * Gradient vectors in user space (objectBoundingBox degenerates on thin arcs).
 * Stops reference palette keys so the same geometry works for every palette.
 */
export function gradients(geo) {
  const R = geo.outer.r;
  const outerPurple = { ...point(R, 150), ...suffix(point(R, 65)) };
  // End anchor tracks the arc's end so the tip still reaches the final stop.
  const outerOrange = { ...point(R, 321), ...suffix(point(R, geo.outer.orange[1] - 360)) };
  const g = {
    outerPurple: { ...outerPurple, stops: [[0, 'p1'], [0.35, 'p1'], [1, 'p2']] },
    outerOrange: { ...outerOrange, stops: [[0, 'o2'], [0.4, 'o1'], [1, 'o1']] },
    core: { cx: 0.62, cy: 0.36, r: 0.78, fx: 0.68, fy: 0.28, stops: [[0, 'c1'], [0.45, 'c2'], [1, 'c3']] },
  };
  if (geo.inner) {
    const r = geo.inner.r;
    g.innerPurple = { ...point(r, 150), ...suffix(point(r, 60)), stops: [[0, 'p1'], [0.55, 'p1'], [1, 'p2']] };
    g.innerBlend = { ...point(r, 270), ...suffix(point(r, 0)), stops: [[0, 'p1'], [0.48, 'p1'], [0.82, 'o2'], [1, 'o1']] };
  }
  return g;
}

function suffix(p) {
  return { x2: p.x, y2: p.y };
}

/**
 * Resolved drawing instructions for a variant — path strings, electron
 * positions and gradient vectors — ready for any renderer (string SVG here,
 * JSX / react-native-svg in the apps via the generated TS module).
 */
export function resolve(variant = 'full') {
  const geo = variant === 'small' ? SMALL : FULL;
  const paths = {
    outerPurple: arcPath(geo.outer.r, ...geo.outer.purple),
    outerOrange: arcPath(geo.outer.r, ...geo.outer.orange),
  };
  if (geo.inner) {
    paths.innerPurple = arcPath(geo.inner.r, ...geo.inner.purple);
    paths.innerBlend = arcPath(geo.inner.r, ...geo.inner.blend);
  }
  const place = (r) => (e) => ({ ...point(r, e.angle), r: e.r, tone: e.tone });
  return {
    variant,
    viewBox: VIEWBOX_ATTR,
    stroke: geo.stroke,
    coreRadius: geo.core.r,
    paths,
    gradients: gradients(geo),
    electrons: geo.electrons.map(place(geo.outer.r)),
  };
}

/* -------------------------------------------------------------------------- */
/* String SVG rendering (used by generate.mjs for every raster + static SVG).  */
/* -------------------------------------------------------------------------- */

/**
 * Palette whose values are CSS custom properties — for SVG inlined into HTML
 * (boot splashes) so the mark re-colours with the page theme. librsvg cannot
 * resolve these, so never use it for rasterised targets.
 */
export const CSS_VAR_PALETTE = Object.fromEntries(
  ['p1', 'p2', 'o1', 'o2', 'c1', 'c2', 'c3', 'wordmark'].map((k) => [k, `var(--nucleus-${k})`]),
);

/** `var(...)` only works through `style`, not presentation attributes, in every browser. */
function colorAttr(prop, value) {
  return value.startsWith('var(') ? `style="${prop}:${value}"` : `${prop}="${value}"`;
}

function linearGradient(id, g, palette, cls) {
  const stops = g.stops
    .map(([o, key]) => `<stop offset="${o}" ${colorAttr('stop-color', palette[key])}${cls ? ` class="${cls}-${key}"` : ''}/>`)
    .join('');
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${g.x}" y1="${g.y}" x2="${g.x2}" y2="${g.y2}">${stops}</linearGradient>`;
}

function radialGradient(id, g, palette, cls) {
  const stops = g.stops
    .map(([o, key]) => `<stop offset="${o}" ${colorAttr('stop-color', palette[key])}${cls ? ` class="${cls}-${key}"` : ''}/>`)
    .join('');
  return `<radialGradient id="${id}" cx="${g.cx}" cy="${g.cy}" r="${g.r}" fx="${g.fx}" fy="${g.fy}">${stops}</radialGradient>`;
}

/**
 * Inner markup of the mark (defs + shapes) in the 760-unit space.
 *
 * Structure (the contract every renderer — CSS, React, React Native — follows):
 *   static:    <g data-part="ring-outer"> <g data-part="ring-inner">
 *              <circle data-part="core">  <g data-part="electrons">
 *   animated:  <g data-part="orbit-outer"> wrapping ring-outer + electrons
 *              <g data-part="orbit-inner"> wrapping ring-inner
 *              <circle data-part="core">
 *
 * With `animated`, each ring travels *with* its own electrons as one rigid
 * group, so a ring's gaps always sit exactly where the logo puts them and an
 * electron can never be caught stranded in a gap. The outer group carries all
 * four electrons at their logo angles and the inner ring spins bare — its two
 * gaps are what make its motion readable — so the first frame is pixel-identical
 * to the static logo. Only the core stays still.
 *
 * Each orbit group starts with an invisible rect spanning the whole canvas, so
 * the group's fill-box is centred on the nucleus and CSS can pivot on it with
 * `transform-box: fill-box; transform-origin: center`. (`view-box` cannot be
 * used: Chromium measures it from the viewport corner, not the viewBox origin,
 * which put the pivot at the bottom-right corner and flung the electrons off
 * their rings.)
 */
export function markInner({ palette = PALETTES.light, variant = 'full', idPrefix = 'nm', darkClass = null, animated = false } = {}) {
  const m = resolve(variant);
  const id = (k) => `${idPrefix}-${k}`;
  const cls = darkClass;
  const defs = [
    linearGradient(id('op'), m.gradients.outerPurple, palette, cls),
    linearGradient(id('oo'), m.gradients.outerOrange, palette, cls),
    m.gradients.innerPurple ? linearGradient(id('ip'), m.gradients.innerPurple, palette, cls) : '',
    m.gradients.innerBlend ? linearGradient(id('ib'), m.gradients.innerBlend, palette, cls) : '',
    radialGradient(id('core'), m.gradients.core, palette, cls),
  ].join('');
  const stroke = `fill="none" stroke-width="${m.stroke}" stroke-linecap="round"`;
  const circle = (e) =>
    `<circle cx="${e.x}" cy="${e.y}" r="${e.r}" ${colorAttr('fill', palette[e.tone])}${cls ? ` class="${cls}-${e.tone}"` : ''}/>`;
  const ringOuter = `<g data-part="ring-outer"><path d="${m.paths.outerPurple}" ${stroke} stroke="url(#${id('op')})"/><path d="${m.paths.outerOrange}" ${stroke} stroke="url(#${id('oo')})"/></g>`;
  const ringInner = m.paths.innerPurple
    ? `<g data-part="ring-inner"><path d="${m.paths.innerPurple}" ${stroke} stroke="url(#${id('ip')})"/><path d="${m.paths.innerBlend}" ${stroke} stroke="url(#${id('ib')})"/></g>`
    : '';
  const core = `<circle data-part="core" cx="0" cy="0" r="${m.coreRadius}" fill="url(#${id('core')})"/>`;
  const electrons = `<g data-part="electrons">${m.electrons.map(circle).join('')}</g>`;
  const pivot = `<rect data-pivot="" x="${VIEWBOX[0]}" y="${VIEWBOX[1]}" width="${VIEWBOX[2]}" height="${VIEWBOX[3]}" fill="none"/>`;
  const body =
    animated && ringInner
      ? `<g data-part="orbit-outer">${pivot}${ringOuter}${electrons}</g><g data-part="orbit-inner">${pivot}${ringInner}</g>${core}`
      : `${ringOuter}${ringInner}${core}${electrons}`;
  return `<defs>${defs}</defs>${body}`;
}

/**
 * Keyframes shared by every animated rendering of the mark: the core stays
 * still while each ring revolves with its own electrons, the inner one the
 * other way (`animation-direction:reverse` — one keyframe serves both).
 * `fill-box` + the pivot rect (see markInner) puts the origin on the nucleus
 * in every browser.
 */
export const ANIMATION_CSS = `[data-part^=orbit]{transform-box:fill-box;transform-origin:center}
[data-part=orbit-outer]{animation:nucleus-orbit ${ORBIT_PERIODS_MS.outer}ms linear infinite}
[data-part=orbit-inner]{animation:nucleus-orbit ${ORBIT_PERIODS_MS.inner}ms linear infinite reverse}
@keyframes nucleus-orbit{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){[data-part^=orbit]{animation:none}}`;

/**
 * A complete standalone SVG of the mark.
 *
 * @param {object} o
 * @param {number} o.size            width/height attribute (librsvg renders at 72 dpi otherwise)
 * @param {object} o.palette         one of PALETTES
 * @param {'full'|'small'} o.variant
 * @param {number} o.pad             fraction of the canvas left empty around the mark (0–0.5)
 * @param {object|null} o.tile       { fill } | { from, to } | null — background behind the mark
 * @param {number} o.tileRadius      corner radius as a fraction of the size (0 = square)
 * @param {boolean} o.animated       use the orbit markup (electrons split across the two tracks)
 * @param {boolean} o.embedCss       include the orbit keyframes in a <style> (default: same as `animated`;
 *                                   pass false for snippets pasted into HTML that ships the CSS itself)
 * @param {object|null} o.darkPalette embed a prefers-color-scheme override (browser-only, e.g. favicon.svg)
 */
export function markSvg({
  size = 760,
  palette = PALETTES.light,
  variant = 'full',
  pad = 0,
  tile = null,
  tileRadius = 0,
  animated = false,
  embedCss = animated,
  darkPalette = null,
  idPrefix = 'nm',
  title = 'Nucleus',
} = {}) {
  const scale = fmt(1 - 2 * pad);
  const darkClass = darkPalette ? `${idPrefix}c` : null;
  let background = '';
  let tileDefs = '';
  if (tile) {
    const rx = tileRadius ? fmt(760 * tileRadius) : 0;
    if (tile.from) {
      tileDefs = `<linearGradient id="${idPrefix}-tile" gradientUnits="userSpaceOnUse" x1="-380" y1="-380" x2="380" y2="380"><stop offset="0" stop-color="${tile.from}"/><stop offset="1" stop-color="${tile.to}"/></linearGradient>`;
      background = `<rect x="-380" y="-380" width="760" height="760" rx="${rx}" fill="url(#${idPrefix}-tile)"/>`;
    } else {
      background = `<rect x="-380" y="-380" width="760" height="760" rx="${rx}" fill="${tile.fill}"/>`;
    }
  }
  const styles = [];
  if (embedCss) styles.push(ANIMATION_CSS);
  if (darkPalette) {
    const rules = Object.entries(darkPalette)
      .filter(([k]) => k !== 'wordmark')
      .map(([k, v]) => `.${darkClass}-${k}{stop-color:${v};fill:${v}}`)
      .join('');
    styles.push(`@media (prefers-color-scheme:dark){${rules}}`);
  }
  const style = styles.length ? `<style>${styles.join('\n')}</style>` : '';
  // size === null → no intrinsic size (CSS sizes it); used for markup inlined into HTML.
  const dims = size == null ? '' : ` width="${size}" height="${size}"`;
  const body = markInner({ palette, variant, idPrefix, darkClass, animated });
  const inner = scale === 1 ? body : `<g transform="scale(${scale})">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg"${dims} viewBox="${VIEWBOX_ATTR}" role="img" aria-label="${title}">${style}${tileDefs ? `<defs>${tileDefs}</defs>` : ''}${background}${inner}</svg>`;
}

/* -------------------------------------------------------------------------- */
/* Lockups                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Horizontal lockup: mark on the left, wordmark to the right, ascender height
 * ≈ 46 % of the mark canvas. `wordmark` = { viewBox: [x, y, w, h], d }.
 */
export function horizontalLockupSvg({ wordmark, palette = PALETTES.light, height = 96, gap = 70, idPrefix = 'nl', tile = null, tileRadius = 0.22, darkPalette = null }) {
  const [, , ww, wh] = wordmark.viewBox;
  const wordH = 350;
  const wordW = fmt((ww / wh) * wordH);
  const totalW = 760 + gap + wordW;
  const width = fmt((height * totalW) / 760);
  const darkClass = darkPalette ? `${idPrefix}c` : null;
  const wordFill = palette.wordmark;
  const inner = markSvgFragment({ palette, tile, tileRadius, idPrefix, darkClass });
  const darkStyle = darkPalette
    ? `<style>@media (prefers-color-scheme:dark){${Object.entries(darkPalette).map(([k, v]) => `.${darkClass}-${k}{stop-color:${v};fill:${v}}`).join('')}}</style>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${totalW} 760" role="img" aria-label="Nucleus">${darkStyle}<svg x="0" y="0" width="760" height="760" viewBox="${VIEWBOX_ATTR}">${inner}</svg><svg x="${760 + gap}" y="${fmt((760 - wordH) / 2)}" width="${wordW}" height="${wordH}" viewBox="${wordmark.viewBox.join(' ')}" preserveAspectRatio="xMinYMid meet"><path d="${wordmark.d}" fill="${wordFill}"${darkClass ? ` class="${darkClass}-wordmark"` : ''}/></svg></svg>`;
}

/**
 * Stacked lockup (the layout of the supplied logo): mark above the wordmark,
 * wordmark ≈ 1.6× the mark's diameter.
 */
export function stackedLockupSvg({ wordmark, palette = PALETTES.light, width = 320, gap = 40, idPrefix = 'ns', darkPalette = null }) {
  const [, , ww, wh] = wordmark.viewBox;
  const wordW = 1180;
  const wordH = fmt((wh / ww) * wordW);
  const totalW = 1260;
  const totalH = 760 + gap + wordH + 30;
  const height = fmt((width * totalH) / totalW);
  const darkClass = darkPalette ? `${idPrefix}c` : null;
  const inner = markSvgFragment({ palette, tile: null, idPrefix, darkClass });
  const darkStyle = darkPalette
    ? `<style>@media (prefers-color-scheme:dark){${Object.entries(darkPalette).map(([k, v]) => `.${darkClass}-${k}{stop-color:${v};fill:${v}}`).join('')}}</style>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${totalW} ${totalH}" role="img" aria-label="Nucleus">${darkStyle}<svg x="${(totalW - 760) / 2}" y="0" width="760" height="760" viewBox="${VIEWBOX_ATTR}">${inner}</svg><svg x="${(totalW - wordW) / 2}" y="${760 + gap}" width="${wordW}" height="${wordH}" viewBox="${wordmark.viewBox.join(' ')}" preserveAspectRatio="xMidYMin meet"><path d="${wordmark.d}" fill="${palette.wordmark}"${darkClass ? ` class="${darkClass}-wordmark"` : ''}/></svg></svg>`;
}

function markSvgFragment({ palette, tile, tileRadius = 0.22, idPrefix, darkClass }) {
  let background = '';
  let scale = 1;
  if (tile) {
    const rx = fmt(760 * tileRadius);
    background = `<rect x="-380" y="-380" width="760" height="760" rx="${rx}" fill="${tile.fill}"/>`;
    scale = 0.76;
  }
  return `${background}<g transform="scale(${scale})">${markInner({ palette, variant: 'full', idPrefix, darkClass })}</g>`;
}
