import * as THREE from 'three';
import { TOUCH_ONLY } from './input.js';

// Texture arrays for the town.
//
// Every facade material lives in one DataArrayTexture (albedo) plus one more
// (normal in RGB, roughness in A), and each vertex says which layer it uses.
// So brick, render, cladding, stone and corrugated metal are all ONE material
// and one draw call per chunk -- the "shared materials, texture atlas" rule,
// done with array layers so each surface still tiles at its real size.
//
// Drawn with canvas 2D (bricks, boards, slabs as shapes) plus a shared noise
// tile, then normals derived from a height canvas. No image files.

// Procedural layers are drawn at 256 px. The arrays themselves are 512 px on
// desktop so the CC0 photo textures keep their detail, 256 on phones.
export const TEX = 256;
export const OUT = TOUCH_ONLY ? 256 : 512;

function noiseTile(size) {
  const d = new Float32Array(size * size);
  const g = (x, y, s) => {
    const r = (ix, iy) => {
      ix = ((ix % s) + s) % s; iy = ((iy % s) + s) % s;
      let h = (ix * 374761393 + iy * 668265263) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (r(xi, yi) * (1 - u) + r(xi + 1, yi) * u) * (1 - v) + (r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u) * v;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0, a = 0.5, f = 8, n = 0;
      for (let o = 0; o < 4; o++) { s += g(x / size * f, y / size * f, f) * a; n += a; a *= 0.5; f *= 2; }
      d[y * size + x] = s / n;
    }
  }
  return d;
}

let NOISE = null;
function rnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A layer: draw(ctx, hctx, r) paints albedo and height (grey) canvases.
// `rough` is the base roughness, `nrm` normal strength, `grain` noise amount.
function bake(layers) {
  const S = TEX, n = layers.length;
  if (!NOISE) NOISE = noiseTile(S);
  const alb = new Uint8Array(S * S * 4 * n);
  const nr = new Uint8Array(S * S * 4 * n);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const h = document.createElement('canvas'); h.width = h.height = S;
  const cx = c.getContext('2d', { willReadFrequently: true });
  const hx = h.getContext('2d', { willReadFrequently: true });
  layers.forEach((L, li) => {
    cx.fillStyle = '#808080'; cx.fillRect(0, 0, S, S);
    hx.fillStyle = '#808080'; hx.fillRect(0, 0, S, S);
    L.draw(cx, hx, rnd(li * 977 + 13));
    const a = cx.getImageData(0, 0, S, S).data;
    const hd = hx.getImageData(0, 0, S, S).data;
    const H = new Float32Array(S * S);
    const grain = L.grain ?? 0.12;
    const off = li * 37;
    for (let i = 0; i < S * S; i++) {
      const nz = NOISE[(i + off * S + off) % (S * S)];
      H[i] = hd[i * 4] / 255 + (nz - 0.5) * grain * 0.6;
      const k = 1 + (nz - 0.5) * grain;
      const o = li * S * S * 4 + i * 4;
      alb[o] = Math.min(255, a[i * 4] * k); alb[o + 1] = Math.min(255, a[i * 4 + 1] * k);
      alb[o + 2] = Math.min(255, a[i * 4 + 2] * k); alb[o + 3] = 255;
    }
    const st = L.nrm ?? 3;
    const at = (x, y) => H[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * st, dy = (at(x, y + 1) - at(x, y - 1)) * st;
        const len = Math.hypot(dx, dy, 1);
        const o = li * S * S * 4 + (y * S + x) * 4;
        nr[o] = (-dx / len * 0.5 + 0.5) * 255;
        nr[o + 1] = (-dy / len * 0.5 + 0.5) * 255;   // data rows run +v (no flipY)
        nr[o + 2] = (1 / len * 0.5 + 0.5) * 255;
        // low spots (mortar, joints, dirt) are rougher
        nr[o + 3] = Math.max(0, Math.min(255, ((L.rough ?? 0.9) + (0.5 - at(x, y)) * 0.25) * 255));
      }
    }
  });
  const up = (src) => {
    if (OUT === S) return src;
    // bilinear upsample, layer by layer, in plain JS (canvas would premultiply
    // the roughness stored in alpha and corrupt the normals)
    const O = OUT, dst = new Uint8Array(O * O * 4 * n);
    for (let l = 0; l < n; l++) {
      const sb = l * S * S * 4, db = l * O * O * 4;
      for (let y = 0; y < O; y++) {
        const fy = (y + 0.5) * S / O - 0.5, y0 = Math.floor(fy), ty = fy - y0;
        const ya = ((y0 % S) + S) % S, yb = (ya + 1) % S;
        for (let x = 0; x < O; x++) {
          const fx = (x + 0.5) * S / O - 0.5, x0 = Math.floor(fx), tx = fx - x0;
          const xa = ((x0 % S) + S) % S, xb = (xa + 1) % S;
          const o = db + (y * O + x) * 4;
          for (let c = 0; c < 4; c++) {
            const a = src[sb + (ya * S + xa) * 4 + c], b = src[sb + (ya * S + xb) * 4 + c];
            const cc = src[sb + (yb * S + xa) * 4 + c], d = src[sb + (yb * S + xb) * 4 + c];
            dst[o + c] = (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
          }
        }
      }
    }
    return dst;
  };
  const mk = (data, srgb) => {
    data = up(data);
    const t = new THREE.DataArrayTexture(data, OUT, OUT, n);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: mk(alb, true), normalRough: mk(nr, false), layers: n };
}

const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const grey = (v) => rgb(v, v, v);

// Running-bond courses: unit w x h px, mortar m px.
function courses(cx, hx, r, w, h, m, colour, mortar, opts = {}) {
  const S = TEX;
  cx.fillStyle = mortar; cx.fillRect(0, 0, S, S);
  hx.fillStyle = grey(70); hx.fillRect(0, 0, S, S);
  for (let row = 0, y = 0; y < S; row++, y += h) {
    const shift = (row % 2) * (opts.bond ?? 0.5) * w;
    for (let x = -w; x < S + w; x += w) {
      const c = colour(r);
      cx.fillStyle = rgb(...c);
      cx.fillRect(x + shift + m / 2, y + m / 2, w - m, h - m);
      hx.fillStyle = grey(opts.face ?? 200);
      hx.fillRect(x + shift + m / 2, y + m / 2, w - m, h - m);
      if (opts.bevel) {
        hx.fillStyle = grey(235);
        hx.fillRect(x + shift + m / 2, y + m / 2, w - m, 2);
      }
    }
  }
}

function streaks(cx, r, n, alpha) {
  for (let i = 0; i < n; i++) {
    const x = r() * TEX, w = 1 + r() * 4, len = TEX * (0.2 + r() * 0.6);
    const g = cx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(40,36,30,${alpha})`); g.addColorStop(1, 'rgba(40,36,30,0)');
    cx.fillStyle = g; cx.fillRect(x, r() * TEX * 0.3, w, len);
  }
}

function blotches(cx, r, n, col, alpha, size) {
  for (let i = 0; i < n; i++) {
    const x = r() * TEX, y = r() * TEX, s = size * (0.5 + r());
    const g = cx.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, `rgba(${col},${alpha})`); g.addColorStop(1, `rgba(${col},0)`);
    cx.fillStyle = g; cx.fillRect(x - s, y - s, s * 2, s * 2);
  }
}

// ----------------------------------------------------------------- layers --

// Facade layers. Metres per texture repeat in FACADE_TILE (same order).
export const FACADE = { brickRed: 0, brickBuff: 1, render: 2, cladding: 3, stone: 4, corrugated: 5, concrete: 6, farWindows: 7 };
// Metres per texture repeat, [u, v] where the source image is not square.
// Layers backed by CC0 photo textures (see CC0_LAYERS) are sized to them.
export const FACADE_TILE = [[1.5, 0.75], 1.8, 2.2, 3.0, 2.4, 1.2, [3.0, 1.5], 1.0];
export const ROOF = { tiles: 0, slate: 1, corrugated: 2, felt: 3, shingles: 4 };
export const ROOF_TILE = [1.2, 2.0, 1.2, 3.0, 3.0];
export const GROUND = { slabs: 0, grass: 1, concrete: 2, setts: 3, paint: 4, gravel: 5, asphalt: 6 };
export const GROUND_TILE = [2.4, 2.5, [4.0, 2.0], [1.6, 3.2], 1.0, 3.0, 3.0];

// Set a buffer's UV scale for a layer from one of the tables above.
export function tile(buf, table, layer) {
  const t = table[layer];
  if (Array.isArray(t)) { buf.su = 1 / t[0]; buf.sv = 1 / t[1]; } else { buf.su = buf.sv = 1 / t; }
}

export function buildFacadeArray() {
  return bake([
    { rough: 0.92, nrm: 4, draw: (cx, hx, r) => {   // red brick: 8 per 1.8 m, 24 courses
      courses(cx, hx, r, 32, 10.67, 2.2, (r) => { const v = r(); return [150 + v * 40, 68 + v * 22, 52 + v * 16]; }, rgb(176, 168, 156));
      blotches(cx, r, 10, '60,52,46', 0.18, 40);
    } },
    { rough: 0.92, nrm: 4, draw: (cx, hx, r) => {   // buff brick
      courses(cx, hx, r, 32, 10.67, 2.2, (r) => { const v = r(); return [198 + v * 28, 176 + v * 24, 132 + v * 26]; }, rgb(190, 184, 172));
      blotches(cx, r, 10, '70,64,54', 0.15, 40);
    } },
    { rough: 0.9, nrm: 2, grain: 0.16, draw: (cx, hx, r) => {   // render / stucco
      cx.fillStyle = rgb(226, 220, 208); cx.fillRect(0, 0, TEX, TEX);
      blotches(cx, r, 18, '120,110,96', 0.12, 50);
      streaks(cx, r, 14, 0.16);
      hx.fillStyle = grey(150); hx.fillRect(0, 0, TEX, TEX);
    } },
    { rough: 0.8, nrm: 5, draw: (cx, hx, r) => {   // timber cladding, 0.2 m boards
      const bh = TEX / 12;
      for (let i = 0; i < 12; i++) {
        const v = 0.93 + r() * 0.1;
        cx.fillStyle = rgb(214 * v, 208 * v, 196 * v); cx.fillRect(0, i * bh, TEX, bh);
        cx.fillStyle = 'rgba(30,26,22,0.45)'; cx.fillRect(0, i * bh + bh - 2, TEX, 2);
        const g = hx.createLinearGradient(0, i * bh, 0, i * bh + bh);
        g.addColorStop(0, grey(120)); g.addColorStop(0.9, grey(220)); g.addColorStop(1, grey(40));
        hx.fillStyle = g; hx.fillRect(0, i * bh, TEX, bh);
      }
      streaks(cx, r, 8, 0.1);
    } },
    { rough: 0.9, nrm: 4, draw: (cx, hx, r) => {   // ashlar stone 0.6 x 0.3
      courses(cx, hx, r, 64, 32, 3, (r) => { const v = r(); return [186 + v * 22, 180 + v * 18, 164 + v * 18]; }, rgb(150, 144, 134), { bond: 0.5, bevel: true });
      blotches(cx, r, 12, '80,76,64', 0.16, 36);
    } },
    { rough: 0.55, nrm: 6, grain: 0.08, draw: (cx, hx, r) => {   // corrugated sheet, vertical
      for (let x = 0; x < TEX; x++) {
        const s = Math.sin(x / TEX * Math.PI * 2 * 16);
        const v = 0.78 + 0.22 * s;
        cx.fillStyle = rgb(206 * v, 206 * v, 202 * v); cx.fillRect(x, 0, 1, TEX);
        hx.fillStyle = grey(128 + 110 * s); hx.fillRect(x, 0, 1, TEX);
      }
      blotches(cx, r, 14, '120,70,40', 0.22, 30);
    } },
    { rough: 0.95, nrm: 2, grain: 0.2, draw: (cx, hx, r) => {   // concrete panels
      cx.fillStyle = rgb(198, 194, 186); cx.fillRect(0, 0, TEX, TEX);
      blotches(cx, r, 16, '90,86,78', 0.14, 50);
      streaks(cx, r, 10, 0.14);
      hx.fillStyle = grey(160); hx.fillRect(0, 0, TEX, TEX);
      cx.fillStyle = 'rgba(60,58,54,0.6)'; hx.fillStyle = grey(30);
      for (const p of [0, TEX / 2]) { cx.fillRect(p, 0, 2, TEX); cx.fillRect(0, p, TEX, 2); hx.fillRect(p, 0, 2, TEX); hx.fillRect(0, p, TEX, 2); }
    } },
    { rough: 0.85, nrm: 2, draw: (cx, hx) => {   // far facade: one window bay per tile
      cx.fillStyle = rgb(206, 200, 190); cx.fillRect(0, 0, TEX, TEX);
      hx.fillStyle = grey(160); hx.fillRect(0, 0, TEX, TEX);
      const x0 = TEX * 0.29, w = TEX * 0.42, y0 = TEX * 0.22, h = TEX * 0.48;
      cx.fillStyle = rgb(232, 228, 220); cx.fillRect(x0 - 5, y0 - 5, w + 10, h + 14);
      cx.fillStyle = rgb(38, 46, 54); cx.fillRect(x0, y0, w, h);
      cx.fillStyle = rgb(70, 82, 92); cx.fillRect(x0, y0, w, h * 0.35);
      hx.fillStyle = grey(40); hx.fillRect(x0, y0, w, h);
    } },
  ]);
}

export function buildRoofArray() {
  return bake([
    { rough: 0.8, nrm: 5, draw: (cx, hx, r) => {   // clay tiles: 0.3 m courses
      const ch = TEX / 4, tw = TEX / 6;
      for (let row = 0; row < 4; row++) {
        for (let k = -1; k < 7; k++) {
          const v = 0.85 + r() * 0.25;
          const x = k * tw + (row % 2) * tw / 2;
          const g = cx.createLinearGradient(x, 0, x + tw, 0);
          g.addColorStop(0, rgb(120 * v, 60 * v, 44 * v)); g.addColorStop(0.5, rgb(176 * v, 92 * v, 66 * v)); g.addColorStop(1, rgb(110 * v, 56 * v, 42 * v));
          cx.fillStyle = g; cx.fillRect(x, row * ch, tw, ch);
          const hg = hx.createLinearGradient(x, 0, x + tw, 0);
          hg.addColorStop(0, grey(70)); hg.addColorStop(0.5, grey(220)); hg.addColorStop(1, grey(70));
          hx.fillStyle = hg; hx.fillRect(x, row * ch, tw, ch);
        }
        cx.fillStyle = 'rgba(20,10,8,0.5)'; cx.fillRect(0, row * ch + ch - 4, TEX, 4);
      }
      blotches(cx, r, 10, '50,60,30', 0.2, 30);
    } },
    { rough: 0.6, nrm: 4, draw: (cx, hx, r) => {   // slate
      courses(cx, hx, r, 42.7, 32, 2, (r) => { const v = r(); return [76 + v * 18, 78 + v * 18, 84 + v * 18]; }, rgb(40, 40, 44), { bond: 0.5, bevel: true });
    } },
    { rough: 0.5, nrm: 6, grain: 0.08, draw: (cx, hx, r) => {   // corrugated roof
      for (let x = 0; x < TEX; x++) {
        const s = Math.sin(x / TEX * Math.PI * 2 * 16), v = 0.75 + 0.25 * s;
        cx.fillStyle = rgb(160 * v, 162 * v, 160 * v); cx.fillRect(x, 0, 1, TEX);
        hx.fillStyle = grey(128 + 110 * s); hx.fillRect(x, 0, 1, TEX);
      }
      blotches(cx, r, 16, '110,64,36', 0.25, 30);
    } },
    { rough: 0.95, nrm: 3, grain: 0.3, draw: (cx, hx, r) => {   // felt / gravel flat roof
      cx.fillStyle = rgb(112, 110, 106); cx.fillRect(0, 0, TEX, TEX);
      for (let i = 0; i < 2500; i++) { const v = 80 + r() * 90; cx.fillStyle = grey(v); cx.fillRect(r() * TEX, r() * TEX, 2, 2); }
      blotches(cx, r, 10, '50,48,44', 0.25, 50);
      hx.fillStyle = grey(128); hx.fillRect(0, 0, TEX, TEX);
    } },
    { rough: 0.9, nrm: 3, draw: (cx, hx, r) => {   // asphalt shingles (replaced by CC0)
      courses(cx, hx, r, 21.3, 21.3, 2, (r) => { const v = r(); return [58 + v * 14, 58 + v * 14, 62 + v * 14]; }, rgb(36, 36, 40), { bond: 0.5 });
    } },
  ]);
}

export function buildGroundArray() {
  return bake([
    { rough: 0.9, nrm: 4, draw: (cx, hx, r) => {   // paving slabs 0.6 m
      courses(cx, hx, r, 64, 64, 3, (r) => { const v = r(); return [186 + v * 18, 182 + v * 18, 172 + v * 18]; }, rgb(120, 116, 108), { bond: 0 });
      blotches(cx, r, 16, '70,66,58', 0.18, 30);
    } },
    { rough: 1.0, nrm: 3, grain: 0.35, draw: (cx, hx, r) => {   // grass
      cx.fillStyle = rgb(92, 124, 62); cx.fillRect(0, 0, TEX, TEX);
      for (let i = 0; i < 6000; i++) {
        const v = r();
        cx.fillStyle = rgb(70 + v * 60, 100 + v * 60, 40 + v * 34);
        cx.fillRect(r() * TEX, r() * TEX, 1, 3);
      }
      blotches(cx, r, 12, '120,110,60', 0.25, 30);
      hx.fillStyle = grey(128); hx.fillRect(0, 0, TEX, TEX);
    } },
    { rough: 0.95, nrm: 2, grain: 0.22, draw: (cx, hx, r) => {   // concrete hardstanding
      cx.fillStyle = rgb(176, 172, 165); cx.fillRect(0, 0, TEX, TEX);
      blotches(cx, r, 16, '80,76,70', 0.2, 50);
      blotches(cx, r, 6, '40,38,34', 0.25, 20);
      hx.fillStyle = grey(160); hx.fillRect(0, 0, TEX, TEX);
      cx.fillStyle = 'rgba(60,58,54,0.7)'; cx.fillRect(0, 0, TEX, 2); cx.fillRect(0, 0, 2, TEX);
      hx.fillStyle = grey(20); hx.fillRect(0, 0, TEX, 2); hx.fillRect(0, 0, 2, TEX);
    } },
    { rough: 0.85, nrm: 5, draw: (cx, hx, r) => {   // granite setts
      courses(cx, hx, r, 32, 32, 4, (r) => { const v = r(); return [130 + v * 40, 126 + v * 34, 118 + v * 30]; }, rgb(70, 68, 64), { bond: 0.5, bevel: true });
    } },
    { rough: 0.7, nrm: 1, grain: 0.1, draw: (cx, hx) => {   // road paint
      cx.fillStyle = rgb(236, 234, 226); cx.fillRect(0, 0, TEX, TEX);
      hx.fillStyle = grey(128); hx.fillRect(0, 0, TEX, TEX);
    } },
    { rough: 1.0, nrm: 3, grain: 0.35, draw: (cx, hx, r) => {   // gravel drive
      cx.fillStyle = rgb(150, 140, 122); cx.fillRect(0, 0, TEX, TEX);
      for (let i = 0; i < 4000; i++) { const v = 90 + r() * 110; cx.fillStyle = rgb(v, v * 0.95, v * 0.85); cx.fillRect(r() * TEX, r() * TEX, 2, 2); }
      hx.fillStyle = grey(128); hx.fillRect(0, 0, TEX, TEX);
    } },
    { rough: 0.95, nrm: 2.5, grain: 0.3, draw: (cx, hx, r) => {   // road asphalt
      cx.fillStyle = rgb(72, 71, 70); cx.fillRect(0, 0, TEX, TEX);
      for (let i = 0; i < 7000; i++) { const v = 40 + r() * 70; cx.fillStyle = rgb(v, v, v * 0.98); cx.fillRect(r() * TEX, r() * TEX, 1.5, 1.5); }
      blotches(cx, r, 10, '30,28,26', 0.28, 34);
      blotches(cx, r, 6, '110,108,104', 0.12, 40);
      hx.fillStyle = grey(140); hx.fillRect(0, 0, TEX, TEX);
      cx.strokeStyle = 'rgba(25,24,23,0.7)'; hx.strokeStyle = grey(40); cx.lineWidth = hx.lineWidth = 1.2;
      for (let k = 0; k < 5; k++) {
        let x = r() * TEX, y = r() * TEX;
        cx.beginPath(); hx.beginPath(); cx.moveTo(x, y); hx.moveTo(x, y);
        for (let s = 0; s < 8; s++) { x += (r() - 0.5) * 30; y += (r() - 0.5) * 30; cx.lineTo(x, y); hx.lineTo(x, y); }
        cx.stroke(); hx.stroke();
      }
    } },
  ]);
}

// Shop signs. Invented names only -- no real brands.
export const SIGNS = [
  'HALVORSEN HARDWARE', 'RIDGE PHARMACY', 'BLUE KETTLE DINER', 'MERIDIAN POST',
  'PINE & CO. GROCER', 'ALDER BOOKS', 'NORTHWIND OUTFITTERS', 'KESTREL BAKERY',
  'TIMBERLINE TAVERN', 'SUMMIT BARBERS', 'CEDAR LAUNDRY', 'IRONWOOD AUTO PARTS',
  'RIDGE FUEL', 'POLICE', 'TOWN HALL', 'RIDGE SAVINGS & LOAN',
  'COPPERLEAF CAFE', 'HOLLIS & SON BUTCHERS', 'VALLEY RADIO REPAIR', 'MAPLE STREET FLORIST',
  'GRANITE HOUSE HOTEL', 'OLD MILL ANTIQUES', 'FALKNER OPTICIANS', 'LUCKY STAR VIDEO',
  'WELCOME TO MERIDIAN RIDGE', 'RESEARCH STATION', 'ROAD CLOSED', '',
];
export const SIGN_COLS = 4, SIGN_ROWS = 7;

export function buildSignAtlas() {
  const W = 1024, H = 448;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cw = W / SIGN_COLS, ch = H / SIGN_ROWS;
  const bgs = ['#2c3a46', '#4a2b26', '#26402f', '#3d3428', '#22303d', '#47402c', '#3a2836', '#2a3c3c'];
  SIGNS.forEach((name, i) => {
    const x = (i % SIGN_COLS) * cw, y = Math.floor(i / SIGN_COLS) * ch;
    if (!name) { g.fillStyle = '#fff6dc'; g.fillRect(x, y, cw, ch); return; }   // plain glow cell
    g.fillStyle = bgs[i % bgs.length]; g.fillRect(x, y, cw, ch);
    g.strokeStyle = 'rgba(230,220,190,0.75)'; g.lineWidth = 3; g.strokeRect(x + 5, y + 5, cw - 10, ch - 10);
    g.fillStyle = '#efe6cc';
    let size = 30;
    g.font = `bold ${size}px Georgia, serif`;
    while (g.measureText(name).width > cw - 26 && size > 12) { size--; g.font = `bold ${size}px Georgia, serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, x + cw / 2, y + ch / 2 + 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export const signIndex = (name) => Math.max(0, SIGNS.indexOf(name));
export const GLOW_CELL = SIGNS.indexOf('');

// ---------------------------------------------------------------- CC0 --

// CC0 photo textures from ambientCG (see ASSETS.md), downscaled to 512 px and
// embedded in cc0data.js. They replace the procedural layer of the same
// name once decoded; until then (a moment at load) the procedural one shows.
export const CC0_LAYERS = {
  facade: { brickRed: 'Bricks104', render: 'Plaster001', cladding: 'WoodSiding008', concrete: 'Concrete034' },
  roof: { slate: 'RoofingTiles003', shingles: 'RoofingTiles013A' },
  ground: { grass: 'Grass005', concrete: 'Concrete034', setts: 'PavingStones138', asphalt: 'Asphalt033' },
};

async function decode(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export async function applyCC0(arrays, data) {
  const c = document.createElement('canvas'); c.width = c.height = OUT;
  const g = c.getContext('2d', { willReadFrequently: true });
  const read = (img) => { g.clearRect(0, 0, OUT, OUT); g.drawImage(img, 0, 0, OUT, OUT); return g.getImageData(0, 0, OUT, OUT).data; };
  const index = { facade: FACADE, roof: ROOF, ground: GROUND };
  let applied = 0;
  for (const [kind, map] of Object.entries(CC0_LAYERS)) {
    const arr = arrays[kind];
    if (!arr) continue;
    for (const [layerName, asset] of Object.entries(map)) {
      const d = data[asset];
      if (!d) continue;
      const [col, nrm, rgh] = await Promise.all([decode(d.color), decode(d.normal), decode(d.rough)]);
      const L = index[kind][layerName];
      const base = L * OUT * OUT * 4;
      const A = arr.albedo.image.data, NR = arr.normalRough.image.data;
      const cp = read(col);
      for (let i = 0; i < OUT * OUT * 4; i++) A[base + i] = cp[i];
      const np = read(nrm);
      for (let i = 0; i < OUT * OUT; i++) { NR[base + i * 4] = np[i * 4]; NR[base + i * 4 + 1] = np[i * 4 + 1]; NR[base + i * 4 + 2] = np[i * 4 + 2]; }
      const rp = read(rgh);
      for (let i = 0; i < OUT * OUT; i++) NR[base + i * 4 + 3] = rp[i * 4];
      applied++;
    }
    arr.albedo.needsUpdate = true;
    arr.normalRough.needsUpdate = true;
  }
  return applied;
}
