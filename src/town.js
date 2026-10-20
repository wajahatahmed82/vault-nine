import * as THREE from 'three';
import { GeoBuf } from './geobuf.js';
import { terrainH } from './terrain.js';

// Meridian Ridge, the town below the station.
//
// Phase 1 of the town: the street plan, every building placed and blocked out
// at its real size, ground and roads draped on the terrain, collision, and the
// chunk/LOD system that keeps it fast. Buildings are grey-box with real
// structure (storeys, roofs, window frames and sills, shopfronts) so the
// triangle and draw-call budgets measured now are honest about what the
// dressed town will cost.
//
// The plan is data. Later phases dress buildings and add interiors without
// moving anything, so the campaign, AI and tests keep their coordinates.
//
// Performance model
//   * Geometry is merged per 80 m chunk and per material: a chunk is about four
//     draw calls whatever it contains.
//   * Near detail (frames, sills, shopfronts, parapets, chimneys) is drawn only
//     within the view-distance setting. Beyond that a single whole-town mesh of
//     plain shells, inset 15 cm inside the detailed walls so the two never
//     fight, carries the skyline in one draw call.
//   * Ground and roads are drawn at every distance, frustum-culled per chunk.
//   * Collision is one box per building (two for pitched roofs) in a grid, so
//     the town adds nothing to the per-frame cost of movement or sight tests.

const CHUNK = 80;
const LOT_RAISE = 0.15;       // kerb height: lots and pavements sit above the road
const INSET = 0.15;           // far-LOD shells sit this far inside the near walls

// ------------------------------------------------------------------ plan --

// Street centrelines. Main Street runs south from the station gate; Ridge Road
// crosses the whole valley below the station.
const NS = [-150, -100, -50, 0, 50, 100, 150];
const EW = [110, 165, 220, 275, 325];
const STREETS = [];
for (const x of NS) {
  const main = x === 0;
  STREETS.push({ axis: 'z', at: x, from: 110, to: 325, road: main ? 10 : 7, pave: main ? 4 : 2.5,
                 name: main ? 'Main Street' : `${x < 0 ? 'West' : 'East'} ${Math.abs(x / 50)} Street` });
}
// Starts on the station's own asphalt: the road sits a few centimetres proud of
// the ground, and starting it at the shelf edge left a sliver of grass showing
// under its front lip.
STREETS.push({ axis: 'z', at: 0, from: 45, to: 110, road: 7.5, pave: 0, name: 'Station Road' });
for (const z of EW) {
  const ridge = z === 110;
  STREETS.push({ axis: 'x', at: z, from: ridge ? -200 : -150, to: ridge ? 200 : 150,
                 road: ridge ? 8 : 7, pave: ridge ? 3 : 2.5, name: ridge ? 'Ridge Road' : `Street ${z}` });
}

function streetAt(axis, at, lo, hi) {
  // a street along `axis` at `at` covering the span lo..hi (the block side)
  return STREETS.find((s) => s.axis === axis && Math.abs(s.at - at) < 0.01 &&
    s.from <= lo + 0.01 && s.to >= hi - 0.01 && s.pave > 0);
}

// Which district each central block belongs to: [column][row], columns west to
// east between NS streets, rows north to south between EW streets.
const DISTRICT = [
  /* x -150..-100 */ ['res', 'res', 'res', 'res'],
  /* x -100..-50  */ ['terrace', 'res', 'terrace', 'res'],
  /* x  -50..0    */ ['petrol', 'police', 'main', 'main'],
  /* x    0..50   */ ['main', 'square', 'main', 'main'],
  /* x   50..100  */ ['res', 'civic', 'res', 'terrace'],
  /* x  100..150  */ ['industrial', 'industrial', 'industrial', 'industrial'],
];

function makeBlocks() {
  const blocks = [];
  const side = (xa, xb, za, zb, kind, extra) => {
    const sW = streetAt('z', xa, za, zb), sE = streetAt('z', xb, za, zb);
    const sN = streetAt('x', za, xa, xb), sS = streetAt('x', zb, xa, xb);
    const b = {
      x1: xa + (sW ? sW.road / 2 : 0), x2: xb - (sE ? sE.road / 2 : 0),
      z1: za + (sN ? sN.road / 2 : 0), z2: zb - (sS ? sS.road / 2 : 0),
      pave: { w: sW ? sW.pave : 0, e: sE ? sE.pave : 0, n: sN ? sN.pave : 0, s: sS ? sS.pave : 0 },
      kind, ...extra,
    };
    b.seed = blocks.length * 7919 + 17;
    blocks.push(b);
    return b;
  };
  for (let c = 0; c < 6; c++) {
    for (let r = 0; r < 4; r++) side(NS[c], NS[c + 1], EW[r], EW[r + 1], DISTRICT[c][r], { col: c, row: r });
  }
  // the long edge blocks against the mountains
  side(-196, -150, 110, 325, 'res-edge', { face: 'e' });
  side(150, 196, 110, 325, 'heavy');
  // north side of Ridge Road, on the slope below the station shelf
  for (const [xa, xb, kind] of [[-196, -150, 'res-north'], [-150, -100, 'res-north'], [-100, -55, 'res-north'],
                               [55, 100, 'res-north'], [100, 150, 'yard'], [150, 196, 'substation']]) {
    side(xa, xb, 80, 110, kind, { face: 's' });
  }
  return blocks;
}

// ------------------------------------------------------------- utilities --

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const range = (r, a, b) => a + r() * (b - a);

// Grey-box palette. Muted on purpose: phase 2 replaces these with materials.
const WALLS = [
  [0.66, 0.63, 0.57], [0.72, 0.68, 0.60], [0.56, 0.46, 0.40], [0.60, 0.61, 0.60],
  [0.68, 0.64, 0.54], [0.52, 0.44, 0.38], [0.63, 0.58, 0.50], [0.58, 0.55, 0.52],
];
const ROOFS = [[0.25, 0.26, 0.28], [0.34, 0.24, 0.20], [0.30, 0.30, 0.31], [0.22, 0.22, 0.23]];
const TRIM = [0.80, 0.78, 0.73];
const PLINTH = [0.42, 0.41, 0.39];
const GLASS = [0.16, 0.19, 0.22];
const DOOR = [0.24, 0.20, 0.17];
const SIGN = [0.30, 0.34, 0.38];
const vary = (c, r, k) => { const v = 1 + (r() - 0.5) * k; return [c[0] * v, c[1] * v, c[2] * v]; };

// Lowest and highest terrain under a footprint, sampled on a 2 m lattice.
function footprintRange(x1, z1, x2, z2) {
  let lo = Infinity, hi = -Infinity;
  const nx = Math.max(1, Math.ceil((x2 - x1) / 2)), nz = Math.max(1, Math.ceil((z2 - z1) / 2));
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const h = terrainH(x1 + (x2 - x1) * i / nx, z1 + (z2 - z1) * j / nz);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return [lo, hi];
}

// Facing → rotation about Y that turns local +Z (the front) toward it.
const FACE_ROT = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };

// ------------------------------------------------------------- buildings --

// A building record. (x, z) is the footprint centre; w runs along the front,
// d from front to back. Everything else is derived.
function building(o) {
  const b = {
    kind: 'house', storeys: 2, sh: 3.0, roof: 'gable', pitch: 0.7, party: false,
    shop: false, chimney: false, ...o,
  };
  const rot = FACE_ROT[b.face];
  b.rot = rot;
  const along = b.face === 'n' || b.face === 's';
  b.ww = along ? b.w : b.d;   // world X size
  b.wd = along ? b.d : b.w;   // world Z size
  const [lo, hi] = footprintRange(b.x - b.ww / 2, b.z - b.wd / 2, b.x + b.ww / 2, b.z + b.wd / 2);
  b.base = hi + LOT_RAISE;
  b.foot = lo - 0.4;
  b.H = b.storeys * b.sh;
  const span = b.roof === 'gable' ? (b.w >= b.d ? b.d : b.w) : Math.min(b.w, b.d);
  b.rise = b.roof === 'flat' ? 0.7 : (span / 2) * b.pitch;
  return b;
}

// Emit one building. `near` gets full structure, `far` (when given) a plain
// shell inset inside it.
function emitBuilding(b, near, far, r) {
  const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
  const W = (lx, ly, lz) => [b.x + lx * cs + lz * sn, ly, b.z - lx * sn + lz * cs];
  const box = (buf, lx, ly, lz, sx, sy, sz, col) => {
    const [x, , z] = W(lx, 0, lz);
    buf.box(x, ly, z, sx, sy, sz, cs, sn, col);
  };
  const { w, d, base, foot, H } = b;
  const top = base + H;
  const wallC = b.wallC, roofC = b.roofC;

  // ---- far shell ----
  if (far) {
    const i = INSET;
    box(far.walls, 0, (foot + top) / 2, 0, w - 2 * i, top - foot, d - 2 * i, wallC);
    emitRoof(b, far.walls, far.roof, W, box, i, true);
  }
  if (!near) return;

  // ---- walls, plinth, string courses ----
  box(near.walls, 0, (foot + top) / 2, 0, w, top - foot, d, wallC);
  box(near.trim, 0, (foot + base + 0.45) / 2, 0, w + 0.08, base + 0.45 - foot, d + 0.08, PLINTH);
  for (let s = 1; s < b.storeys; s++) box(near.trim, 0, base + s * b.sh, 0, w + 0.1, 0.16, d + 0.1, TRIM);

  // ---- façades ----
  // n = outward normal in local XZ, t = direction along the face
  const faces = [
    { n: [0, 1], t: [1, 0], len: w, off: d / 2, front: true },
    { n: [0, -1], t: [-1, 0], len: w, off: d / 2, back: true },
    { n: [1, 0], t: [0, -1], len: d, off: w / 2, side: true },
    { n: [-1, 0], t: [0, 1], len: d, off: w / 2, side: true },
  ];
  const fpos = (f, u, o) => [f.n[0] * (f.off + o) + f.t[0] * u, f.n[1] * (f.off + o) + f.t[1] * u];
  const fbox = (buf, f, u, y, o, su, sy, so, col) => {
    const [lx, lz] = fpos(f, u, o);
    const alongX = f.n[1] !== 0;
    box(buf, lx, y, lz, alongX ? su : so, sy, alongX ? so : su, col);
  };
  const fquad = (buf, f, u, y, o, su, sy, col) => {
    const [ax, az] = fpos(f, u - su / 2, o), [bx, bz] = fpos(f, u + su / 2, o);
    const out = W(f.n[0], 0, f.n[1]); out[0] -= b.x; out[2] -= b.z; out[1] = 0;
    buf.quad(W(ax, y - sy / 2, az), W(bx, y - sy / 2, bz), W(bx, y + sy / 2, bz), W(ax, y + sy / 2, az),
      out, col, [0, 0, su, 0, su, sy, 0, sy]);
  };
  const windowAt = (f, u, y, ww, wh) => {
    fquad(near.glass, f, u, y, 0.02, ww, wh, GLASS);
    const ft = 0.09, fd = 0.10;
    fbox(near.trim, f, u, y + wh / 2 + ft / 2, 0.03, ww + 2 * ft, ft, fd, TRIM);
    fbox(near.trim, f, u, y - wh / 2 - ft / 2, 0.03, ww + 2 * ft, ft, fd, TRIM);
    fbox(near.trim, f, u - ww / 2 - ft / 2, y, 0.03, ft, wh, fd, TRIM);
    fbox(near.trim, f, u + ww / 2 + ft / 2, y, 0.03, ft, wh, fd, TRIM);
    fbox(near.trim, f, u, y - wh / 2 - ft - 0.04, 0.08, ww + 0.3, 0.08, 0.18, TRIM);   // sill
  };

  for (const f of faces) {
    if (f.side && b.party) continue;              // shares a wall with its neighbour
    if (b.kind === 'warehouse') {
      // big loading doors and a high strip of windows, not house windows
      if (f.front || f.back) {
        const n = Math.max(1, Math.floor(f.len / 9));
        for (let k = 0; k < n; k++) {
          const u = -f.len / 2 + (k + 0.5) * (f.len / n);
          fquad(near.glass, f, u, base + 2.4, 0.03, 4.2, 4.6, DOOR);
          fbox(near.trim, f, u, base + 4.85, 0.06, 4.6, 0.18, 0.14, TRIM);
        }
      }
      const n = Math.floor((f.len - 2) / 4);
      for (let k = 0; k < n; k++) fquad(near.glass, f, -f.len / 2 + 1 + (k + 0.5) * ((f.len - 2) / n), top - 1.2, 0.02, 2.6, 0.7, GLASS);
      continue;
    }
    const sp = b.kind === 'house' || b.kind === 'terrace' ? 3.0 : 2.7;
    const n = Math.max(f.len > 4 ? 1 : 0, Math.floor((f.len - 1.4) / sp));
    if (!n) continue;
    const step = f.len / n;
    for (let s = 0; s < b.storeys; s++) {
      const sy = base + s * b.sh;
      if (s === 0 && f.front && b.shop) {
        // shopfront: one wide glazed bay, a door, a fascia board for the sign
        fquad(near.glass, f, 0, sy + 1.6, 0.03, f.len - 1.3, 2.5, GLASS);
        fbox(near.trim, f, 0, sy + 3.15, 0.10, f.len - 0.4, 0.55, 0.22, SIGN);
        fbox(near.trim, f, -f.len / 2 + 0.3, sy + 1.45, 0.06, 0.45, 2.9, 0.14, TRIM);
        fbox(near.trim, f, f.len / 2 - 0.3, sy + 1.45, 0.06, 0.45, 2.9, 0.14, TRIM);
        continue;
      }
      for (let k = 0; k < n; k++) {
        const u = -f.len / 2 + (k + 0.5) * step;
        if (s === 0 && f.front && k === Math.floor(n / 2)) {
          // front door, with a little canopy
          fquad(near.glass, f, u, sy + 1.1, 0.03, 1.05, 2.15, DOOR);
          fbox(near.trim, f, u, sy + 2.3, 0.35, 1.6, 0.1, 0.7, TRIM);
          continue;
        }
        const tall = b.kind === 'civic' ? 2.3 : 1.45;
        windowAt(f, u, sy + 0.9 + tall / 2, b.kind === 'civic' ? 1.3 : 1.15, tall);
      }
    }
  }

  emitRoof(b, near.walls, near.roof, W, box, 0, false, near.trim);

  if (b.chimney) {
    const ch = b.rise + 1.3;
    const cx = (b.w >= b.d ? b.w : 0) * 0.3;
    box(near.walls, cx, top + ch / 2, b.w >= b.d ? 0 : b.d * 0.3, 0.7, ch, 0.7, wallC);
    box(near.trim, cx, top + ch + 0.06, b.w >= b.d ? 0 : b.d * 0.3, 0.85, 0.12, 0.85, TRIM);
  }
}

// Roofs. `i` insets everything for the far shell; overhangs only up close.
function emitRoof(b, walls, roof, W, box, i, isFar, trim) {
  const top = b.base + b.H;
  if (b.roof === 'flat') {
    if (isFar) { box(walls, 0, top + 0.35, 0, b.w - 2 * i, 0.7, b.d - 2 * i, b.wallC); return; }
    box(roof, 0, top + 0.06, 0, b.w - 0.4, 0.12, b.d - 0.4, b.roofC);
    const t = 0.25, h = 0.7;
    box(walls, 0, top + h / 2, b.d / 2 - t / 2, b.w, h, t, b.wallC);
    box(walls, 0, top + h / 2, -b.d / 2 + t / 2, b.w, h, t, b.wallC);
    box(walls, b.w / 2 - t / 2, top + h / 2, 0, t, h, b.d - 2 * t, b.wallC);
    box(walls, -b.w / 2 + t / 2, top + h / 2, 0, t, h, b.d - 2 * t, b.wallC);
    box(trim, 0, top + h + 0.04, b.d / 2 - t / 2, b.w + 0.1, 0.08, t + 0.1, TRIM);
    box(trim, 0, top + h + 0.04, -b.d / 2 + t / 2, b.w + 0.1, 0.08, t + 0.1, TRIM);
    return;
  }
  // pitched: work in (a, s) = (along ridge, across ridge)
  const alongX = b.w >= b.d;
  const A = (alongX ? b.w : b.d) - 2 * i, S = (alongX ? b.d : b.w) - 2 * i;
  const L = (a, y, s) => alongX ? W(a, y, s) : W(s, y, a);
  const dir = (a, y, s) => { const p = L(a, y, s), o = L(0, 0, 0); return [p[0] - o[0], y, p[2] - o[2]]; };
  const oh = isFar ? 0 : 0.35, ohg = isFar ? 0 : 0.25;
  const rise = b.rise, eaveY = top - oh * b.pitch, ridgeY = top + rise - i;
  const col = b.roofC;
  if (b.roof === 'gable') {
    for (const sgn of [1, -1]) {
      roof.quad(L(-A / 2 - ohg, eaveY, sgn * (S / 2 + oh)), L(A / 2 + ohg, eaveY, sgn * (S / 2 + oh)),
        L(A / 2 + ohg, ridgeY, 0), L(-A / 2 - ohg, ridgeY, 0), dir(0, 1, sgn), col);
      walls.tri(L(sgn * A / 2, top, -S / 2), L(sgn * A / 2, top, S / 2), L(sgn * A / 2, ridgeY, 0),
        dir(sgn, 0, 0), b.wallC);
    }
    if (!isFar && trim) {
      const p = L(0, 0, 0);
      const [cx, , cz] = p;
      const len = A + 2 * ohg;
      const cs2 = alongX ? Math.cos(b.rot) : Math.cos(b.rot + Math.PI / 2);
      const sn2 = alongX ? Math.sin(b.rot) : Math.sin(b.rot + Math.PI / 2);
      trim.box(cx, ridgeY + 0.05, cz, len, 0.14, 0.26, cs2, sn2, [0.2, 0.2, 0.21]);
    }
    return;
  }
  // hip (a pyramid when square)
  const half = Math.max(0, (A - S) / 2);
  for (const sgn of [1, -1]) {
    roof.quad(L(-A / 2 - oh, eaveY, sgn * (S / 2 + oh)), L(A / 2 + oh, eaveY, sgn * (S / 2 + oh)),
      L(half, ridgeY, 0), L(-half, ridgeY, 0), dir(0, 1, sgn), col);
    roof.tri(L(sgn * (A / 2 + oh), eaveY, -S / 2 - oh), L(sgn * (A / 2 + oh), eaveY, S / 2 + oh),
      L(sgn * half, ridgeY, 0), dir(sgn, 1, 0), col);
  }
}

// --------------------------------------------------------- block layouts --

// Each layout returns building records plus props. Coordinates are world.
function layoutBlock(blk) {
  const r = rng(blk.seed);
  const out = [];
  const props = [];
  // usable lot area inside the pavements
  const X1 = blk.x1 + blk.pave.w, X2 = blk.x2 - blk.pave.e;
  const Z1 = blk.z1 + blk.pave.n, Z2 = blk.z2 - blk.pave.s;
  const wall = () => vary(pick(r, WALLS), r, 0.08);
  const roofC = () => vary(pick(r, ROOFS), r, 0.1);

  // A row of buildings along one edge of the lot area, facing outwards.
  // `face`: which street it fronts. Returns the depth used.
  const row = (face, opts) => {
    const { wMin, wMax, depth, setback = 0, gap = 0, make, from = 0, to = 0 } = opts;
    const alongZ = face === 'e' || face === 'w';
    const lo = (alongZ ? Z1 : X1) + from, hi = (alongZ ? Z2 : X2) - to;
    let t = lo;
    while (hi - t > wMin * 0.8) {
      let wv = range(r, wMin, wMax);
      if (hi - t - wv < wMin) wv = hi - t;            // last lot takes the remainder
      const dd = typeof depth === 'function' ? depth() : depth;
      const mid = t + wv / 2;
      let x, z;
      if (face === 'e') { x = X2 - setback - dd / 2; z = mid; }
      else if (face === 'w') { x = X1 + setback + dd / 2; z = mid; }
      else if (face === 's') { z = Z2 - setback - dd / 2; x = mid; }
      else { z = Z1 + setback + dd / 2; x = mid; }
      const g = gap ? range(r, gap * 0.6, gap) : 0;
      const spec = make(wv - g, dd, x, z);
      if (spec) out.push(building({ face, x, z, w: wv - g, d: dd, ...spec }));
      t += wv;
    }
  };

  const houseSpec = () => ({
    kind: 'house', storeys: r() < 0.6 ? 2 : 1, sh: 2.9,
    roof: r() < 0.7 ? 'gable' : 'hip', pitch: range(r, 0.6, 0.8), chimney: r() < 0.6,
    wallC: wall(), roofC: roofC(),
  });
  const houses = (face, from, to) => row(face, {
    wMin: 15, wMax: 19, depth: () => range(r, 8, 10), setback: range(r, 4, 6), from, to,
    make: (wv) => ({ ...houseSpec(), w: Math.min(wv - 5, range(r, 8, 11)) }),
  });
  const terrace = (face) => {
    const wallC = wall(), rc = roofC();
    let n = 0;
    row(face, {
      wMin: 5.4, wMax: 6.2, depth: 9, setback: 3,
      make: () => (++n % 7 === 0 ? null : {
        kind: 'terrace', storeys: 2, sh: 2.8, roof: 'gable', pitch: 0.65, party: n % 7 !== 1 && n % 7 !== 6,
        chimney: n % 2 === 0, wallC: vary(wallC, r, 0.05), roofC: rc,
      }),
    });
  };
  const shops = (face, from, to) => row(face, {
    wMin: 8, wMax: 13, depth: () => range(r, 15, 18), from, to,
    make: () => ({
      kind: 'shop', shop: true, party: true, storeys: r() < 0.75 ? 2 : 3, sh: 3.3,
      roof: r() < 0.6 ? 'flat' : 'gable', pitch: 0.55, wallC: wall(), roofC: roofC(),
    }),
  });
  const mainFace = blk.x1 < 0 ? 'e' : 'w';
  const backFace = mainFace === 'e' ? 'w' : 'e';

  switch (blk.kind) {
    case 'main':
      shops(mainFace, 0, 0);
      row(backFace, { wMin: 9, wMax: 13, depth: 9, gap: 4, make: () => ({ kind: 'house', storeys: 2, sh: 2.9,
        roof: 'gable', pitch: 0.6, wallC: wall(), roofC: roofC() }) });
      break;
    case 'police': {
      const len = Z2 - Z1;
      const pw = 26, pd = 16;
      const x = mainFace === 'e' ? X2 - pd / 2 : X1 + pd / 2;
      out.push(building({ face: mainFace, x, z: Z1 + pw / 2, w: pw, d: pd, kind: 'civic', storeys: 2, sh: 3.6,
        roof: 'flat', wallC: [0.62, 0.60, 0.58], roofC: ROOFS[0], tag: 'police' }));
      shops(mainFace, pw + 2, 0);
      // walled car park behind the police station
      props.push({ type: 'wall', x1: X1, z1: Z1, x2: X1, z2: Z1 + len * 0.45, h: 2.2 });
      break;
    }
    case 'petrol': {
      const len = Z2 - Z1;
      const fx = mainFace === 'e' ? X2 : X1, sgn = mainFace === 'e' ? -1 : 1;
      props.push({ type: 'canopy', x: fx + sgn * 9, z: Z1 + 11, w: 11, d: 18, h: 5.2 });
      for (const dz of [-4.5, 4.5]) props.push({ type: 'pump', x: fx + sgn * 9, z: Z1 + 11 + dz });
      out.push(building({ face: mainFace, x: fx + sgn * 20.5, z: Z1 + 11, w: 12, d: 8, kind: 'shop', shop: true,
        storeys: 1, sh: 3.6, roof: 'flat', wallC: [0.74, 0.72, 0.68], roofC: ROOFS[2], tag: 'kiosk' }));
      out.push(building({ face: mainFace, x: fx + sgn * 6, z: Z1 + len * 0.62, w: 20, d: 11, kind: 'shop', shop: true,
        storeys: 1, sh: 3.8, roof: 'flat', wallC: [0.70, 0.62, 0.52], roofC: ROOFS[1], tag: 'diner' }));
      houses(backFace, 0, 0);
      break;
    }
    case 'square': {
      const cx = (X1 + X2) / 2, cz = (Z1 + Z2) / 2;
      props.push({ type: 'memorial', x: cx, z: cz });
      for (const [dx, dz] of [[-10, -12], [10, -12], [-10, 12], [10, 12]]) props.push({ type: 'planter', x: cx + dx, z: cz + dz });
      props.push({ type: 'shelter', x: blk.x1 + 2.2, z: cz + 14, face: 'w' });
      blk.paved = true;
      break;
    }
    case 'civic': {
      const w = 34, d = 22;
      const x = X1 + 9 + d / 2, z = (Z1 + Z2) / 2;
      out.push(building({ face: 'w', x, z, w, d, kind: 'civic', storeys: 2, sh: 4.2, roof: 'hip', pitch: 0.5,
        wallC: [0.70, 0.66, 0.58], roofC: ROOFS[0], tag: 'townhall' }));
      // clock tower on the front, centred on the square
      out.push(building({ face: 'w', x: X1 + 9 - 1, z, w: 6.5, d: 6.5, kind: 'civic', storeys: 5, sh: 4.2,
        roof: 'hip', pitch: 1.4, wallC: [0.70, 0.66, 0.58], roofC: ROOFS[0], tag: 'clocktower' }));
      blk.paved = true;
      break;
    }
    case 'res':
      if (r() < 0.5) { houses('e', 0, 0); houses('w', 0, 0); }
      else { houses('n', 0, 0); houses('s', 0, 0); }
      break;
    case 'terrace':
      terrace('e'); terrace('w');
      break;
    case 'res-edge':
      houses('e', 0, 0);
      row('w', { wMin: 14, wMax: 18, depth: 9, setback: 6, make: () => (r() < 0.5 ? houseSpec() : null) });
      break;
    case 'res-north':
      houses('s', 0, 0);
      break;
    case 'industrial': {
      const cx = (X1 + X2) / 2, cz = (Z1 + Z2) / 2;
      const ww = Math.min(30, X2 - X1 - 6), wd = Math.min(24, (Z2 - Z1) * 0.55);
      out.push(building({ face: 'w', x: cx, z: Z1 + 3 + wd / 2, w: wd, d: ww, kind: 'warehouse', storeys: 1, sh: 8,
        roof: 'gable', pitch: 0.18, wallC: vary([0.55, 0.56, 0.55], r, 0.1), roofC: ROOFS[2] }));
      out.push(building({ face: 'w', x: X1 + 8, z: Z2 - 8, w: 12, d: 10, kind: 'warehouse', storeys: 1, sh: 5,
        roof: 'flat', wallC: wall(), roofC: ROOFS[3] }));
      for (let k = 0; k < 3; k++) props.push({ type: 'container', x: X2 - 6, z: Z2 - 4 - k * 3.2, stack: 1 + (k % 2) });
      void cz;
      break;
    }
    case 'heavy': {
      // long industrial strip against the east mountains
      const cx = (X1 + X2) / 2;
      out.push(building({ face: 'w', x: cx, z: 150, w: 40, d: 30, kind: 'warehouse', storeys: 1, sh: 10,
        roof: 'gable', pitch: 0.18, wallC: [0.52, 0.54, 0.55], roofC: ROOFS[2], tag: 'warehouse' }));
      out.push(building({ face: 'w', x: cx, z: 225, w: 34, d: 26, kind: 'warehouse', storeys: 1, sh: 9,
        roof: 'gable', pitch: 0.18, wallC: [0.58, 0.52, 0.46], roofC: ROOFS[1] }));
      props.push({ type: 'watertower', x: cx + 4, z: 280 });
      for (let k = 0; k < 8; k++) props.push({ type: 'container', x: X1 + 6 + (k % 4) * 3.2, z: 185 + Math.floor(k / 4) * 7, stack: 1 + (k % 3 === 0) });
      out.push(building({ face: 'w', x: cx, z: 310, w: 14, d: 12, kind: 'warehouse', storeys: 1, sh: 5,
        roof: 'flat', wallC: wall(), roofC: ROOFS[3] }));
      break;
    }
    case 'yard':
      out.push(building({ face: 's', x: (X1 + X2) / 2, z: Z2 - 10, w: 24, d: 14, kind: 'warehouse', storeys: 1, sh: 6,
        roof: 'gable', pitch: 0.2, wallC: wall(), roofC: ROOFS[2] }));
      break;
    case 'substation': {
      const cx = (X1 + X2) / 2, cz = (Z1 + Z2) / 2;
      for (let k = 0; k < 4; k++) props.push({ type: 'transformer', x: cx - 9 + k * 6, z: cz });
      props.push({ type: 'fence', x1: cx - 15, z1: cz - 8, x2: cx + 15, z2: cz + 8 });
      blk.tag = 'substation';
      break;
    }
  }
  return { buildings: out, props };
}

// ------------------------------------------------------------- the build --

export function buildTown(scene, mats) {
  const t0 = performance.now();
  const blocks = makeBlocks();

  const mat = {
    walls: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
    roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.5 }),
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    road: mats.asphalt.clone(),
  };
  // Roads lie 6-8 cm above the terrain they are draped on. polygonOffset was
  // tried first and drew a bright seam along the road ends at grazing angles.

  const chunks = new Map();
  const chunkOf = (x, z) => {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const k = ix + ',' + iz;
    let c = chunks.get(k);
    if (!c) {
      c = { ix, iz, minX: ix * CHUNK, maxX: (ix + 1) * CHUNK, minZ: iz * CHUNK, maxZ: (iz + 1) * CHUNK,
            near: { walls: new GeoBuf(), roof: new GeoBuf(), trim: new GeoBuf(), glass: new GeoBuf() },
            ground: new GeoBuf(), road: new GeoBuf(), detail: null, base: null };
      chunks.set(k, c);
    }
    return c;
  };
  const far = { walls: new GeoBuf(), roof: new GeoBuf() };
  const colliders = [];
  const buildings = [];
  const r = rng(99);

  const solid = (minX, minZ, maxX, maxZ, bottom, top, surf, ref) => {
    colliders.push({ minX, maxX, minZ, maxZ, bottom, top, town: true, surf: surf || 'masonry', ref });
  };

  // ---- buildings and props ----
  for (const blk of blocks) {
    const { buildings: bl, props } = layoutBlock(blk);
    for (const b of bl) {
      const c = chunkOf(b.x, b.z);
      emitBuilding(b, c.near, far, r);
      buildings.push(b);
      const x1 = b.x - b.ww / 2, x2 = b.x + b.ww / 2, z1 = b.z - b.wd / 2, z2 = b.z + b.wd / 2;
      const top = b.base + b.H;
      solid(x1, z1, x2, z2, b.foot, top + (b.roof === 'flat' ? 0.7 : 0), 'masonry', b);
      if (b.roof !== 'flat') {
        // pitched roof: a box over the middle half, to roughly half the rise
        const ix = b.ww * 0.25, iz = b.wd * 0.25;
        solid(x1 + ix, z1 + iz, x2 - ix, z2 - iz, top, top + b.rise * 0.6, 'masonry', b);
      }
    }
    for (const p of props) emitProp(p, chunkOf(p.x ?? p.x1, p.z ?? p.z1), solid, blk);
    emitGround(blk, chunkOf((blk.x1 + blk.x2) / 2, (blk.z1 + blk.z2) / 2).ground);
  }

  // ---- roads ----
  for (const s of STREETS) {
    // split long streets at chunk lines so each piece culls with its chunk
    const step = CHUNK;
    for (let a = s.from; a < s.to - 0.01; a = Math.min(s.to, (Math.floor(a / step) + 1) * step)) {
      const b = Math.min(s.to, (Math.floor(a / step) + 1) * step);
      const mid = (a + b) / 2;
      const c = s.axis === 'z' ? chunkOf(s.at, mid) : chunkOf(mid, s.at);
      emitRoad(s, a, b, c.road);
    }
  }

  // ---- meshes ----
  const group = new THREE.Group();
  group.name = 'town';
  scene.add(group);
  let tris = 0;
  const mk = (buf, material, shadow) => {
    if (buf.empty) return null;
    const m = new THREE.Mesh(buf.geometry(), material);
    m.castShadow = shadow; m.receiveShadow = true;
    tris += buf.tris;
    return m;
  };
  for (const c of chunks.values()) {
    c.detail = new THREE.Group();
    c.base = new THREE.Group();
    for (const k of ['walls', 'roof', 'trim', 'glass']) {
      const m = mk(c.near[k], mat[k], k !== 'glass');
      if (m) c.detail.add(m);
    }
    const g = mk(c.ground, mat.ground, false);
    if (g) c.base.add(g);
    const rd = mk(c.road, mat.road, false);
    if (rd) c.base.add(rd);
    group.add(c.detail, c.base);
    c.near = null; c.ground = null; c.road = null;
  }
  const farWalls = mk(far.walls, mat.walls, false);
  const farRoof = mk(far.roof, mat.roof, false);
  const farGroup = new THREE.Group();
  if (farWalls) farGroup.add(farWalls);
  if (farRoof) farGroup.add(farRoof);
  group.add(farGroup);

  // lot lookup for the kerb height, on a coarse grid
  const LOTCELL = 25;
  const lotGrid = new Map();
  for (const blk of blocks) {
    for (let ix = Math.floor(blk.x1 / LOTCELL); ix <= Math.floor(blk.x2 / LOTCELL); ix++) {
      for (let iz = Math.floor(blk.z1 / LOTCELL); iz <= Math.floor(blk.z2 / LOTCELL); iz++) {
        const k = ix * 10007 + iz;
        if (!lotGrid.has(k)) lotGrid.set(k, []);
        lotGrid.get(k).push(blk);
      }
    }
  }
  const onLot = (x, z) => {
    const l = lotGrid.get(Math.floor(x / LOTCELL) * 10007 + Math.floor(z / LOTCELL));
    if (!l) return false;
    for (const b of l) if (x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2) return true;
    return false;
  };

  const town = {
    group, chunks: [...chunks.values()], far: farGroup, colliders, buildings, blocks, streets: STREETS,
    materials: mat, tris, buildMs: 0,
    detailDist: 150,
    surfaceH: (x, z) => terrainH(x, z) + (onLot(x, z) ? LOT_RAISE : 0),
    onLot,
    // Show near detail only for chunks inside the view distance. Called once
    // per frame; twenty-odd rectangle distance checks.
    update(cam, dist) {
      const d = dist === undefined ? this.detailDist : dist;
      const d2 = d * d;
      for (const c of this.chunks) {
        const dx = Math.max(c.minX - cam.x, 0, cam.x - c.maxX);
        const dz = Math.max(c.minZ - cam.z, 0, cam.z - c.maxZ);
        c.detail.visible = dx * dx + dz * dz < d2;
      }
    },
  };
  town.buildMs = Math.round(performance.now() - t0);
  return town;
}

// ------------------------------------------------------------ props/ground --

function emitProp(p, c, solid, blk) {
  const N = c.near;
  const metal = [0.42, 0.44, 0.46];
  switch (p.type) {
    case 'canopy': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      N.trim.box(p.x, y + p.h + 0.35, p.z, p.w, 0.7, p.d, 1, 0, [0.82, 0.82, 0.80]);
      for (const [dx, dz] of [[-p.w / 2 + 1, -p.d / 2 + 1.5], [p.w / 2 - 1, -p.d / 2 + 1.5], [-p.w / 2 + 1, p.d / 2 - 1.5], [p.w / 2 - 1, p.d / 2 - 1.5]]) {
        N.trim.box(p.x + dx, y + p.h / 2, p.z + dz, 0.4, p.h, 0.4, 1, 0, metal);
        solid(p.x + dx - 0.2, p.z + dz - 0.2, p.x + dx + 0.2, p.z + dz + 0.2, y - 0.5, y + p.h, 'metal');
      }
      solid(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, y + p.h, y + p.h + 0.7, 'metal');
      break;
    }
    case 'pump': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      N.trim.box(p.x, y + 0.15, p.z, 1.4, 0.3, 3.4, 1, 0, [0.6, 0.6, 0.58]);          // island
      N.walls.box(p.x, y + 1.1, p.z, 0.7, 1.6, 1.0, 1, 0, [0.70, 0.22, 0.18]);
      solid(p.x - 0.35, p.z - 0.5, p.x + 0.35, p.z + 0.5, y - 0.5, y + 1.9, 'metal');
      break;
    }
    case 'memorial': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      const stone = [0.66, 0.64, 0.60];
      N.trim.box(p.x, y + 0.3, p.z, 5, 0.6, 5, 1, 0, stone);
      N.trim.box(p.x, y + 1.1, p.z, 2.6, 1.0, 2.6, 1, 0, stone);
      N.trim.box(p.x, y + 4.6, p.z, 1.0, 6.0, 1.0, 1, 0, stone);
      solid(p.x - 2.5, p.z - 2.5, p.x + 2.5, p.z + 2.5, y - 0.5, y + 0.6, 'masonry');
      solid(p.x - 1.3, p.z - 1.3, p.x + 1.3, p.z + 1.3, y - 0.5, y + 1.6, 'masonry');
      solid(p.x - 0.5, p.z - 0.5, p.x + 0.5, p.z + 0.5, y - 0.5, y + 7.6, 'masonry');
      break;
    }
    case 'planter': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      N.walls.box(p.x, y + 0.3, p.z, 3.0, 0.6, 1.4, 1, 0, [0.58, 0.57, 0.54]);
      solid(p.x - 1.5, p.z - 0.7, p.x + 1.5, p.z + 0.7, y - 0.5, y + 0.6, 'masonry');
      break;
    }
    case 'shelter': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      N.trim.box(p.x, y + 2.5, p.z, 1.6, 0.12, 4.0, 1, 0, metal);
      N.glass.box(p.x - 0.7, y + 1.3, p.z, 0.05, 2.2, 3.8, 1, 0, [0.30, 0.34, 0.36]);
      for (const dz of [-1.9, 1.9]) N.trim.box(p.x - 0.7, y + 1.25, p.z + dz, 0.1, 2.5, 0.1, 1, 0, metal);
      solid(p.x - 0.75, p.z - 2, p.x - 0.65, p.z + 2, y - 0.5, y + 2.5, 'glass');
      break;
    }
    case 'container': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      const cols = [[0.55, 0.22, 0.16], [0.18, 0.32, 0.48], [0.26, 0.40, 0.28], [0.62, 0.50, 0.22]];
      for (let s = 0; s < p.stack; s++) {
        const col = cols[Math.floor(Math.abs(p.x * 7 + p.z * 3 + s * 5)) % cols.length];
        N.walls.box(p.x, y + 1.3 + s * 2.6, p.z, 6.0, 2.6, 2.45, 0, 1, col);
      }
      solid(p.x - 1.25, p.z - 3, p.x + 1.25, p.z + 3, y - 0.5, y + 2.6 * p.stack, 'metal');
      break;
    }
    case 'watertower': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      const H = 15;
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        N.trim.box(p.x + dx, y + H / 2, p.z + dz, 0.45, H, 0.45, 1, 0, metal);
        solid(p.x + dx - 0.25, p.z + dz - 0.25, p.x + dx + 0.25, p.z + dz + 0.25, y - 0.5, y + H, 'metal');
      }
      N.walls.cylinder(p.x, y + H, p.z, 4.5, 6, 16, [0.50, 0.56, 0.58], 2.2);
      solid(p.x - 4.2, p.z - 4.2, p.x + 4.2, p.z + 4.2, y + H, y + H + 7, 'metal');
      break;
    }
    case 'transformer': {
      const y = terrainH(p.x, p.z) + LOT_RAISE;
      N.walls.box(p.x, y + 1.3, p.z, 3.0, 2.6, 2.2, 1, 0, [0.44, 0.48, 0.44]);
      N.trim.box(p.x, y + 3.6, p.z, 0.25, 2.0, 0.25, 1, 0, metal);
      solid(p.x - 1.5, p.z - 1.1, p.x + 1.5, p.z + 1.1, y - 0.5, y + 2.6, 'metal');
      break;
    }
    case 'fence': case 'wall': {
      const pts = p.type === 'fence'
        ? [[p.x1, p.z1, p.x2, p.z1], [p.x2, p.z1, p.x2, p.z2], [p.x2, p.z2, p.x1, p.z2], [p.x1, p.z2, p.x1, p.z1 + (p.z2 - p.z1) * 0.35]]
        : [[p.x1, p.z1, p.x2, p.z2]];
      const h = p.h || 2.4;
      for (const [ax, az, bx, bz] of pts) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 4));
        for (let k = 0; k < n; k++) {
          const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n;
          const x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
          const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          const y = terrainH(mx, mz) + LOT_RAISE;
          const horiz = Math.abs(bx - ax) > Math.abs(bz - az);
          const seg = len / n;
          const buf = p.type === 'wall' ? N.walls : N.trim;
          const col = p.type === 'wall' ? [0.56, 0.54, 0.50] : metal;
          buf.box(mx, y + h / 2 - 0.2, mz, horiz ? seg : 0.2, h + 0.4, horiz ? 0.2 : seg, 1, 0, col);
          solid(Math.min(x0, x1) - (horiz ? 0 : 0.1), Math.min(z0, z1) - (horiz ? 0.1 : 0),
                Math.max(x0, x1) + (horiz ? 0 : 0.1), Math.max(z0, z1) + (horiz ? 0.1 : 0), y - 0.5, y + h,
                p.type === 'wall' ? 'masonry' : 'metal');
        }
      }
      break;
    }
  }
  void blk;
}

// Block surface: pavement ring and lot, draped on the terrain at kerb height,
// with kerb faces down to the road. Separate vertices per quad so colours stay
// crisp at the pavement edge.
function emitGround(blk, buf) {
  const { x1, x2, z1, z2, pave } = blk;
  const xs = lines(x1, x2, pave.w, pave.e), zs = lines(z1, z2, pave.n, pave.s);
  const lotCol = blk.paved || ['main', 'police', 'petrol', 'square', 'civic'].includes(blk.kind)
    ? [0.50, 0.49, 0.46]
    : ['industrial', 'heavy', 'yard', 'substation'].includes(blk.kind) ? [0.44, 0.44, 0.43] : [0.30, 0.37, 0.20];
  const paveCol = [0.60, 0.59, 0.56];
  const H = (x, z) => terrainH(x, z) + LOT_RAISE;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const ax = xs[i], bx = xs[i + 1], az = zs[j], bz = zs[j + 1];
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const inPave = (pave.w && cx < x1 + pave.w) || (pave.e && cx > x2 - pave.e) ||
                     (pave.n && cz < z1 + pave.n) || (pave.s && cz > z2 - pave.s);
      const n = (((Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1) + 1) % 1;
      const base = inPave ? paveCol : lotCol;
      const k = 0.94 + n * 0.1;
      const col = [base[0] * k, base[1] * k, base[2] * k];
      buf.quad([ax, H(ax, az), az], [bx, H(bx, az), az], [bx, H(bx, bz), bz], [ax, H(ax, bz), bz],
        [0, 1, 0], col, [ax / 3, az / 3, bx / 3, az / 3, bx / 3, bz / 3, ax / 3, bz / 3]);
    }
  }
  // kerbs on every side that meets a road
  const kerb = [0.66, 0.65, 0.62];
  const edge = (ax, az, bx, bz, out) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 4));
    for (let k = 0; k < n; k++) {
      const px = ax + (bx - ax) * k / n, pz = az + (bz - az) * k / n;
      const qx = ax + (bx - ax) * (k + 1) / n, qz = az + (bz - az) * (k + 1) / n;
      buf.quad([px, terrainH(px, pz) - 0.1, pz], [qx, terrainH(qx, qz) - 0.1, qz],
        [qx, H(qx, qz), qz], [px, H(px, pz), pz], out, kerb);
    }
  };
  if (pave.n) edge(x1, z1, x2, z1, [0, 0, -1]);
  if (pave.s) edge(x1, z2, x2, z2, [0, 0, 1]);
  if (pave.w) edge(x1, z1, x1, z2, [-1, 0, 0]);
  if (pave.e) edge(x2, z1, x2, z2, [1, 0, 0]);
}

function lines(a, b, pa, pb) {
  const out = [a];
  const ia = a + pa, ib = b - pb;
  if (pa) out.push(ia);
  const n = Math.max(1, Math.ceil((ib - ia) / 4));
  for (let k = 1; k < n; k++) out.push(ia + (ib - ia) * k / n);
  out.push(ib);
  if (pb) out.push(b);
  return out;
}

function emitRoad(s, a, b, buf) {
  const lift = s.axis === 'x' ? 0.08 : 0.06;
  const hw = s.road / 2;
  const n = Math.max(1, Math.ceil((b - a) / 4));
  const col = [1, 1, 1];
  const P = (t, o) => (s.axis === 'z' ? [s.at + o, terrainH(s.at + o, t) + lift, t] : [t, terrainH(t, s.at + o) + lift, s.at + o]);
  for (let k = 0; k < n; k++) {
    const t0 = a + (b - a) * k / n, t1 = a + (b - a) * (k + 1) / n;
    const T = 7;
    buf.quad(P(t0, -hw), P(t0, hw), P(t1, hw), P(t1, -hw), [0, 1, 0], col,
      [-hw / T, t0 / T, hw / T, t0 / T, hw / T, t1 / T, -hw / T, t1 / T]);
  }
}
