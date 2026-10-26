import * as THREE from 'three';
import { GeoBuf } from './geobuf.js';
import { terrainH, PLAY, SHELF } from './terrain.js';
import {
  buildFacadeArray, buildRoofArray, buildGroundArray, buildSignAtlas,
  FACADE, ROOF, GROUND, GROUND_TILE, FACADE_TILE, ROOF_TILE, signIndex, tile, applyCC0,
} from './texgen.js';
import { arrayMaterial, interiorGlass, clearGlass, signMaterial, SHARED } from './townmat.js';
import { emitBuilding, KIT } from './townkit.js';
import * as PR from './props.js';
import { KindInstances, kind as modelKind, modelsReady } from './models.js';
import { registerCars } from './cars.js';
import { growTrees } from './trees.js';

// Meridian Ridge, the town below the station.
//
// The plan (streets, blocks, districts) is data. Blocks are filled with
// building records, the records go through the kit in townkit.js, props come
// from props.js, and everything is merged per 80 m chunk and per material:
//
//   detail (hidden past the view distance): walls, roofs, trim, glass, signs
//   base   (always, frustum-culled):         ground, roads, foliage
//   keep   (always):                          the enterable buildings
//   far    (always, one mesh):                plain shells with window-pattern
//                                             facades, inset 15 cm inside the
//                                             detailed walls
//
// Collision is boxes in the shared grid; bullets test those boxes, never the
// meshes. Enterable buildings have real wall pieces, so windows and doors are
// real openings for movement, sight and bullets.

const CHUNK = 80;
const LOT_RAISE = 0.15;

// ------------------------------------------------------------------ plan --

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
  return STREETS.find((s) => s.axis === axis && Math.abs(s.at - at) < 0.01 &&
    s.from <= lo + 0.01 && s.to >= hi - 0.01 && s.pave > 0);
}

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
  side(-196, -150, 110, 325, 'res-edge', { face: 'e' });
  side(150, 196, 110, 325, 'heavy');
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
const vary = (c, r, k) => { const v = 1 + (r() - 0.5) * k; return [c[0] * v, c[1] * v, c[2] * v]; };

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

const FACE_ROT = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };

// Palettes. Textured layers are tinted close to white; render and cladding
// carry the paint colour.
const RENDER_TINTS = [[0.95, 0.92, 0.84], [0.86, 0.9, 0.9], [0.86, 0.9, 0.8], [0.95, 0.86, 0.8], [0.93, 0.9, 0.86], [0.82, 0.84, 0.86]];
const CLAD_TINTS = [[0.95, 0.95, 0.92], [0.7, 0.82, 0.74], [0.68, 0.3, 0.24], [0.62, 0.72, 0.82], [0.9, 0.86, 0.7]];
const ROOF_TINTS = [[0.95, 0.95, 0.95], [0.85, 0.85, 0.88], [1.0, 0.92, 0.88]];
const SHOP_PAINT = [[0.16, 0.26, 0.2], [0.42, 0.12, 0.1], [0.14, 0.2, 0.32], [0.2, 0.2, 0.22], [0.36, 0.3, 0.18], [0.5, 0.48, 0.42]];

// ------------------------------------------------------------- buildings --

function building(o, r) {
  const b = {
    kind: 'house', storeys: 2, sh: 3.0, roof: 'gable', pitch: 0.7, party: false,
    shop: false, chimney: false, ...o,
  };
  b.rot = FACE_ROT[b.face];
  const along = b.face === 'n' || b.face === 's';
  b.ww = along ? b.w : b.d;
  b.wd = along ? b.d : b.w;
  const [lo, hi] = footprintRange(b.x - b.ww / 2, b.z - b.wd / 2, b.x + b.ww / 2, b.z + b.wd / 2);
  b.base = hi + LOT_RAISE;
  b.foot = lo - 0.4;
  b.H = b.storeys * b.sh;
  const span = Math.min(b.w, b.d);
  b.rise = b.roof === 'flat' ? 0.7 : (span / 2) * b.pitch;
  if (b.mat === undefined) {
    const m = {
      shop: [FACADE.brickRed, FACADE.brickRed, FACADE.brickBuff, FACADE.render, FACADE.stone],
      house: [FACADE.brickRed, FACADE.render, FACADE.render, FACADE.cladding, FACADE.cladding, FACADE.brickBuff],
      terrace: [FACADE.brickRed, FACADE.brickRed, FACADE.brickBuff],
      civic: [FACADE.stone],
      warehouse: [FACADE.corrugated, FACADE.corrugated, FACADE.concrete],
    }[b.kind] || [FACADE.render];
    b.mat = pick(r, m);
  }
  if (b.roofMat === undefined) {
    b.roofMat = b.roof === 'flat' ? ROOF.felt
      : b.kind === 'warehouse' ? ROOF.corrugated : pick(r, b.kind === 'house' ? [ROOF.tiles, ROOF.slate, ROOF.shingles, ROOF.shingles] : [ROOF.tiles, ROOF.slate, ROOF.slate]);
  }
  if (!b.wallC) {
    b.wallC = b.mat === FACADE.render ? pick(r, RENDER_TINTS)
      : b.mat === FACADE.cladding ? pick(r, CLAD_TINTS)
      : b.mat === FACADE.corrugated ? pick(r, [[0.8, 0.82, 0.82], [0.7, 0.76, 0.8], [0.82, 0.74, 0.62], [0.62, 0.7, 0.64]])
      : vary([0.98, 0.96, 0.94], r, 0.12);
  }
  b.roofC = b.roofC || vary(pick(r, ROOF_TINTS), r, 0.08);
  b.doorC = b.doorC || pick(r, KIT.DOOR_COLS);
  b.shopC = b.shopC || pick(r, SHOP_PAINT);
  b.lintel = b.lintel ?? (b.mat === FACADE.brickRed || b.mat === FACADE.brickBuff);
  b.cornice = b.cornice ?? (b.roof === 'flat' && b.kind !== 'warehouse');
  b.quoins = b.quoins ?? (b.kind === 'civic' || (b.kind === 'house' && b.mat === FACADE.render && r() < 0.3));
  b.porch = b.porch ?? (b.kind === 'house' && r() < 0.45);
  b.windows = [];
  return b;
}

// Ground-floor openings, partitions and furniture for the buildings you can
// walk into. Local frame: front is +z, x across the front.
function makeEnterable(b, type) {
  b.enter = type;
  const w = b.w, d = b.d, T = 0.25;
  const open = { f: [], b: [], l: [], r: [] };
  const doorAt = (u) => ({ type: 'door', u0: u - 0.95, u1: u + 0.95, y0: 0, y1: 2.35 });
  const winAt = (u) => ({ type: 'window', u0: u - 0.65, u1: u + 0.65, y0: 1.0, y1: 2.35 });
  const doors = type === 'townhall' ? [-8, 8] : [w > 9 ? w / 2 - 2.2 : 0];
  b.doorsU = doors;
  for (const u of doors) open.f.push(doorAt(u));
  const addWins = (key, len, avoid) => {
    const n = Math.max(1, Math.floor((len - 1.6) / 2.8));
    for (let k = 0; k < n; k++) {
      const u = -len / 2 + (k + 0.5) * (len / n);
      if (avoid.some((a) => Math.abs(a - u) < 1.9)) continue;
      if (u - 0.65 < -len / 2 + 0.4 || u + 0.65 > len / 2 - 0.4) continue;
      open[key].push(winAt(u));
    }
  };
  addWins('f', w, doors);
  addWins('b', w, [0]);
  open.b.push(doorAt(0));
  if (!b.party) { addWins('l', d, []); addWins('r', d, []); }
  for (const k of Object.keys(open)) open[k].sort((a, c) => a.u0 - c.u0);
  b.openings = open;

  const P = [];
  const sh = b.sh;
  const wall = (x, z, sx, sz) => P.push({ kind: 'wall', x, z, sx, sz, h: sh });
  const item = (x, z, sx, sy, sz, col, solid, y) => P.push({ x, z, sx, sy, sz, col, solid, y });
  const WOOD = [0.45, 0.33, 0.22], METAL = [0.42, 0.44, 0.46], FAB = [0.32, 0.36, 0.42];
  const iw = w - 2 * T, id = d - 2 * T;
  switch (type) {
    case 'shop': case 'pharmacy': case 'hardware': case 'grocer': {
      item(iw / 2 - 1.6, -id / 2 + 2.4, 2.2, 1.0, 0.7, WOOD);
      for (let x = -iw / 2 + 1.2; x < iw / 2 - 3.6; x += 2.4) item(x, 0.8, 0.55, 1.8, id * 0.42, METAL);
      wall(-1.4, -id / 2 + 1.4, iw - 2.8, 0.15);
      for (let k = 0; k < 4; k++) item(-iw / 2 + 0.8 + k * 0.9, -id / 2 + 0.6, 0.6, 0.6, 0.6, [0.55, 0.44, 0.3], false);
      b.tagItem = { x: iw / 2 - 1.6, z: -id / 2 + 2.4 };
      break;
    }
    case 'diner': {
      item(0, -id / 2 + 1.6, iw - 4, 1.05, 0.7, [0.7, 0.2, 0.16]);
      for (let x = -iw / 2 + 2; x < iw / 2 - 2; x += 1.2) item(x, -id / 2 + 2.4, 0.38, 0.75, 0.38, METAL, false);
      for (let x = -iw / 2 + 1.6; x < iw / 2 - 4.5; x += 3.0) {
        item(x, id / 2 - 1.3, 1.2, 0.76, 0.8, [0.85, 0.82, 0.76]);
        item(x - 0.95, id / 2 - 1.3, 0.5, 1.0, 0.9, [0.62, 0.16, 0.14]);
        item(x + 0.95, id / 2 - 1.3, 0.5, 1.0, 0.9, [0.62, 0.16, 0.14]);
      }
      wall(0, -id / 2 + 0.7, iw - 6, 0.15);
      break;
    }
    case 'police': {
      wall(-2, id / 2 - 4.2, iw - 4, 0.15);
      item(iw / 2 - 4.8, id / 2 - 4.9, 3, 1.1, 0.6, WOOD);
      for (let k = 0; k < 4; k++) item(-iw / 2 + 2.5 + k * 3.4, -0.5, 1.6, 0.76, 0.9, WOOD);
      for (let k = 0; k < 3; k++) {
        const x = -iw / 2 + 1.8 + k * 3.0;
        wall(x + 1.5, -id / 2 + 1.6, 0.15, 3.2);
        for (let bx = -1.2; bx <= 1.2; bx += 0.3) item(x + bx, -id / 2 + 3.2, 0.05, 2.4, 0.05, METAL, false);
      }
      b.tagItem = { x: -iw / 2 + 2.5, z: -0.5 };
      break;
    }
    case 'townhall': {
      for (let row = 0; row < 5; row++) for (const sx of [-1, 1]) item(sx * 4.2, id / 2 - 6 - row * 1.6, 5, 0.45, 0.5, WOOD);
      item(0, -id / 2 + 2.2, 6, 0.9, 1.2, WOOD);
      wall(-iw / 2 + 4.5, -2, 0.15, id - 8);
      item(-iw / 2 + 2, -id / 2 + 2, 1.6, 0.76, 0.9, WOOD);
      b.tagItem = { x: -iw / 2 + 2, z: -id / 2 + 2 };
      break;
    }
    case 'house': {
      wall(-iw / 4 - 0.5, -0.3, iw / 2 - 1, 0.15);
      item(-iw / 2 + 1.2, id / 2 - 1.8, 0.9, 0.8, 2.0, FAB);
      item(iw / 4, id / 2 - 2.2, 1.4, 0.76, 0.9, WOOD);
      item(-iw / 2 + 0.4, -id / 2 + 1.8, 0.6, 0.9, 3, [0.8, 0.8, 0.78]);
      b.tagItem = { x: iw / 4, z: id / 2 - 2.2 };
      break;
    }
    case 'kiosk': {
      item(-iw / 2 + 1.6, 0.6, 2.4, 1.0, 0.7, WOOD);
      for (let x = 0.5; x < iw / 2 - 1; x += 1.6) item(x, -id / 2 + 1, 0.5, 1.6, id * 0.4, METAL);
      b.tagItem = { x: -iw / 2 + 1.6, z: 0.6 };
      break;
    }
    case 'warehouse': {
      for (let x = -iw / 2 + 3; x < iw / 2 - 3; x += 5) item(x, -id / 4, 1.2, 4.2, id * 0.4, [0.5, 0.36, 0.18]);
      for (let k = 0; k < 6; k++) item(-iw / 2 + 3 + k * 2.4, id / 2 - 4, 1.2, 1.0, 1.2, [0.55, 0.44, 0.3]);
      b.tagItem = { x: 0, z: id / 2 - 6 };
      break;
    }
  }
  // steps up to the front door when the floor is above the pavement
  const fx = b.face === 'e' ? 1 : b.face === 'w' ? -1 : 0, fz = b.face === 's' ? 1 : b.face === 'n' ? -1 : 0;
  const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
  for (const u of doors) {
    const ox = b.x + fx * (d / 2 + 0.8) + u * cs, oz = b.z + fz * (d / 2 + 0.8) - u * sn;
    const ground = terrainH(ox, oz) + LOT_RAISE;
    const drop = b.base - ground;
    if (drop > 0.28) {
      const n = Math.ceil(drop / 0.28), rise = drop / n;
      for (let k = 0; k < n; k++) P.push({ x: u, z: d / 2 + 0.18 + (n - k) * 0.36, sx: 2.2, sy: (k + 1) * rise, sz: 0.38, y: -drop, col: [0.66, 0.64, 0.6], surf: 'masonry' });
    }
  }
  b.parts = P;
  b.lamps = [];
  for (let x = -iw / 2 + 2.5; x < iw / 2 - 1; x += 5.5) for (let z = -id / 2 + 2.5; z < id / 2 - 1; z += 5.5) b.lamps.push({ x, z });
  // darker than outdoors: the hemisphere fill reaches indoors unshadowed
  b.interiorTint = type === 'warehouse' ? [0.42, 0.42, 0.4] : [0.56, 0.53, 0.5];
}

// --------------------------------------------------------- block layouts --

const SHOP_NAMES = ['MERIDIAN POST', 'ALDER BOOKS', 'NORTHWIND OUTFITTERS', 'KESTREL BAKERY', 'TIMBERLINE TAVERN',
  'SUMMIT BARBERS', 'CEDAR LAUNDRY', 'IRONWOOD AUTO PARTS', 'RIDGE SAVINGS & LOAN', 'COPPERLEAF CAFE',
  'HOLLIS & SON BUTCHERS', 'VALLEY RADIO REPAIR', 'MAPLE STREET FLORIST', 'GRANITE HOUSE HOTEL', 'OLD MILL ANTIQUES',
  'FALKNER OPTICIANS', 'LUCKY STAR VIDEO'];

function layoutBlock(blk, ctx) {
  const r = rng(blk.seed);
  const out = [];
  const props = [];
  const X1 = blk.x1 + blk.pave.w, X2 = blk.x2 - blk.pave.e;
  const Z1 = blk.z1 + blk.pave.n, Z2 = blk.z2 - blk.pave.s;
  const B = (o) => { const b = building(o, r); out.push(b); return b; };

  const row = (face, opts) => {
    const { wMin, wMax, depth, setback = 0, gap = 0, make, from = 0, to = 0 } = opts;
    const alongZ = face === 'e' || face === 'w';
    const lo = (alongZ ? Z1 : X1) + from, hi = (alongZ ? Z2 : X2) - to;
    let t = lo;
    while (hi - t > wMin * 0.8) {
      let wv = range(r, wMin, wMax);
      if (hi - t - wv < wMin) wv = hi - t;
      const dd = typeof depth === 'function' ? depth() : depth;
      const mid = t + wv / 2;
      let x, z;
      if (face === 'e') { x = X2 - setback - dd / 2; z = mid; }
      else if (face === 'w') { x = X1 + setback + dd / 2; z = mid; }
      else if (face === 's') { z = Z2 - setback - dd / 2; x = mid; }
      else { z = Z1 + setback + dd / 2; x = mid; }
      const g = gap ? range(r, gap * 0.6, gap) : 0;
      const spec = make(wv - g, dd, x, z);
      if (spec) {
        const b = B({ face, x, z, w: wv - g, d: dd, ...spec });
        b.lot = { face, a0: t, a1: t + wv, setback, X1, X2, Z1, Z2 };
      }
      t += wv;
    }
  };

  const houseSpec = () => ({
    kind: 'house', storeys: r() < 0.6 ? 2 : 1, sh: 2.9,
    roof: r() < 0.7 ? 'gable' : 'hip', pitch: range(r, 0.6, 0.8), chimney: r() < 0.6,
  });
  const houses = (face, from, to) => row(face, {
    wMin: 15, wMax: 19, depth: () => range(r, 8, 10), setback: range(r, 4.5, 6), from, to,
    make: (wv) => ({ ...houseSpec(), w: Math.min(wv - 5, range(r, 8, 11)) }),
  });
  const terrace = (face) => {
    let n = 0;
    const mat = pick(r, [FACADE.brickRed, FACADE.brickRed, FACADE.brickBuff]);
    const roofC = vary([0.9, 0.9, 0.92], r, 0.06);
    row(face, {
      wMin: 5.4, wMax: 6.2, depth: 9, setback: 3,
      make: () => (++n % 7 === 0 ? null : {
        kind: 'terrace', storeys: 2, sh: 2.8, roof: 'gable', pitch: 0.65, party: n % 7 !== 1 && n % 7 !== 6,
        chimney: n % 2 === 0, mat, roofMat: ROOF.slate, roofC, porch: false,
        doorC: pick(r, KIT.DOOR_COLS),
      }),
    });
  };
  const shops = (face, from, to) => row(face, {
    wMin: 8, wMax: 13, depth: () => range(r, 15, 18), from, to,
    make: () => ({
      kind: 'shop', shop: true, party: true, storeys: r() < 0.75 ? 2 : 3, sh: 3.4,
      roof: r() < 0.6 ? 'flat' : 'gable', pitch: 0.55,
      sign: signIndex(SHOP_NAMES[ctx.shopN++ % SHOP_NAMES.length]),
      awning: r() < 0.45 ? pick(r, KIT.AWNING) : null,
    }),
  });
  const mainFace = blk.x1 < 0 ? 'e' : 'w';
  const backFace = mainFace === 'e' ? 'w' : 'e';

  switch (blk.kind) {
    case 'main': {
      const first = out.length;
      shops(mainFace, 0, 0);
      // the first three shops north of the square on the east side are open
      if (blk.col === 3 && blk.row === 0) {
        const names = [['RIDGE PHARMACY', 'pharmacy'], ['HALVORSEN HARDWARE', 'hardware'], ['PINE & CO. GROCER', 'grocer']];
        for (let k = 0; k < 3 && first + k < out.length; k++) {
          const b = out[first + k];
          b.sign = signIndex(names[k][0]); b.tag = names[k][1];
          makeEnterable(b, names[k][1]);
        }
      }
      row(backFace, { wMin: 9, wMax: 13, depth: 9, gap: 4, make: () => ({ kind: 'house', storeys: 2, sh: 2.9,
        roof: 'gable', pitch: 0.6 }) });
      break;
    }
    case 'police': {
      const pw = 26, pd = 16;
      const x = mainFace === 'e' ? X2 - pd / 2 : X1 + pd / 2;
      const p = B({ face: mainFace, x, z: Z1 + pw / 2, w: pw, d: pd, kind: 'civic', storeys: 2, sh: 3.6,
        roof: 'flat', mat: FACADE.concrete, wallC: [0.92, 0.9, 0.86], tag: 'police', sign: signIndex('POLICE'), quoins: false });
      makeEnterable(p, 'police');
      shops(mainFace, pw + 2, 0);
      props.push({ type: 'wall', x1: X1 + 0.3, z1: Z1, x2: X1 + 0.3, z2: Z1 + 22, h: 2.2 });
      for (const k of [0, 1]) props.push({ type: 'car', x: X1 + 6 + k * 3.2, z: Z1 + 8, rot: 0, police: true });
      break;
    }
    case 'petrol': {
      const len = Z2 - Z1;
      const fx = mainFace === 'e' ? X2 : X1, sgn = mainFace === 'e' ? -1 : 1;
      props.push({ type: 'canopy', x: fx + sgn * 9, z: Z1 + 11, w: 11, d: 18, h: 5.2 });
      for (const dz of [-4.5, 4.5]) props.push({ type: 'pump', x: fx + sgn * 9, z: Z1 + 11 + dz });
      const k = B({ face: mainFace, x: fx + sgn * 20.5, z: Z1 + 11, w: 12, d: 8, kind: 'shop', shop: true,
        storeys: 1, sh: 3.6, roof: 'flat', mat: FACADE.render, wallC: [0.95, 0.94, 0.9], tag: 'kiosk', sign: signIndex('RIDGE FUEL') });
      makeEnterable(k, 'kiosk');
      const dn = B({ face: mainFace, x: fx + sgn * 6, z: Z1 + len * 0.7, w: 20, d: 11, kind: 'shop', shop: true,
        storeys: 1, sh: 3.8, roof: 'flat', mat: FACADE.cladding, wallC: [0.82, 0.32, 0.26], tag: 'diner',
        sign: signIndex('BLUE KETTLE DINER') });
      makeEnterable(dn, 'diner');
      props.push({ type: 'fuelcar', x: fx + sgn * 12.5, z: Z1 + 6.5, rot: 0.15 });
      houses(backFace, 22, 0);
      blk.forecourt = { x1: Math.min(fx, fx + sgn * 16), x2: Math.max(fx, fx + sgn * 16), z1: Z1, z2: Z1 + 22 };
      break;
    }
    case 'square': {
      const cx = (X1 + X2) / 2, cz = (Z1 + Z2) / 2;
      props.push({ type: 'memorial', x: cx, z: cz });
      for (const [dx, dz] of [[-10, -12], [10, -12], [-10, 12], [10, 12]]) props.push({ type: 'planter', x: cx + dx, z: cz + dz });
      for (const [dx, dz, rot] of [[-6, -7, 0], [6, -7, 0], [-6, 7, Math.PI], [6, 7, Math.PI], [-12, 0, Math.PI / 2], [12, 0, -Math.PI / 2]])
        props.push({ type: 'bench', x: cx + dx, z: cz + dz, rot });
      props.push({ type: 'shelter', x: blk.x1 + 2.2, z: cz + 14, face: 'w' });
      for (const [dx, dz] of [[-14, -18], [14, -18], [-14, 18], [14, 18]]) props.push({ type: 'tree', x: cx + dx, z: cz + dz, kind: 'deciduous', s: 1.1 });
      blk.paved = GROUND.setts;
      ctx.spots.squareCentre = { x: cx, z: cz };
      break;
    }
    case 'civic': {
      const w = 34, d = 22;
      const x = X1 + 9 + d / 2, z = (Z1 + Z2) / 2;
      const th = B({ face: 'w', x, z, w, d, kind: 'civic', storeys: 2, sh: 4.2, roof: 'hip', pitch: 0.5,
        tag: 'townhall', sign: signIndex('TOWN HALL') });
      makeEnterable(th, 'townhall');
      B({ face: 'w', x: X1 + 9 - 1, z, w: 6.5, d: 6.5, kind: 'civic', storeys: 5, sh: 4.2,
        roof: 'hip', pitch: 1.4, tag: 'clocktower', mat: FACADE.stone });
      blk.paved = GROUND.slabs;
      ctx.spots.flag = { x: x + 4, y: th.base + th.H + th.rise, z: z + 6 };
      ctx.spots.birds = { x, y: th.base + th.H + th.rise + 0.15, z };
      break;
    }
    case 'res': {
      const first = out.length;
      if (r() < 0.5) { houses('e', 0, 0); houses('w', 0, 0); }
      else { houses('n', 0, 0); houses('s', 0, 0); }
      if (blk.col === 4 && blk.row === 0) {
        for (let k = 0; k < 2 && first + k < out.length; k++) {
          const b = out[first + k];
          b.tag = 'house' + k;
          makeEnterable(b, 'house');
        }
      }
      break;
    }
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
      const cx = (X1 + X2) / 2;
      const ww = Math.min(30, X2 - X1 - 6), wd = Math.min(24, (Z2 - Z1) * 0.55);
      B({ face: 'w', x: cx, z: Z1 + 3 + wd / 2, w: wd, d: ww, kind: 'warehouse', storeys: 1, sh: 8,
        roof: 'gable', pitch: 0.18 });
      B({ face: 'w', x: X1 + 8, z: Z2 - 8, w: 12, d: 10, kind: 'warehouse', storeys: 1, sh: 5, roof: 'flat' });
      for (let k = 0; k < 3; k++) props.push({ type: 'container', x: X2 - 3 - k * 3.0, z: Z2 - 5, stack: 1 + (k % 2) });
      props.push({ type: 'pallets', x: X1 + 16, z: Z2 - 4 }, { type: 'drums', x: X1 + 19, z: Z2 - 3 }, { type: 'skip', x: X2 - 4, z: Z1 + wd + 8, rot: 0 });
      blk.paved = GROUND.concrete;
      break;
    }
    case 'heavy': {
      const cx = (X1 + X2) / 2;
      const wh = B({ face: 'w', x: cx - 3, z: 150, w: 40, d: 26, kind: 'warehouse', storeys: 1, sh: 10,
        roof: 'gable', pitch: 0.18, tag: 'warehouse', mat: FACADE.corrugated });
      makeEnterable(wh, 'warehouse');
      B({ face: 'w', x: cx - 3, z: 225, w: 34, d: 24, kind: 'warehouse', storeys: 1, sh: 9, roof: 'gable', pitch: 0.18 });
      props.push({ type: 'watertower', x: cx + 2, z: 280 });
      for (let k = 0; k < 8; k++) props.push({ type: 'container', x: X1 + 6 + (k % 4) * 3.2, z: 185 + Math.floor(k / 4) * 7, stack: 1 + (k % 3 === 0) });
      B({ face: 'w', x: cx - 3, z: 310, w: 14, d: 12, kind: 'warehouse', storeys: 1, sh: 5, roof: 'flat' });
      props.push({ type: 'rail', x: 191, z0: 116, z1: 322 }, { type: 'wagon', x: 191, z: 252 });
      for (let k = 0; k < 4; k++) props.push({ type: 'pallets', x: X1 + 8 + k * 2, z: 262 });
      props.push({ type: 'drums', x: X1 + 4, z: 268 }, { type: 'skip', x: X1 + 5, z: 300, rot: Math.PI / 2 });
      blk.paved = GROUND.concrete;
      break;
    }
    case 'yard':
      B({ face: 's', x: (X1 + X2) / 2, z: Z2 - 10, w: 24, d: 14, kind: 'warehouse', storeys: 1, sh: 6, roof: 'gable', pitch: 0.2 });
      props.push({ type: 'skip', x: X1 + 6, z: Z1 + 6, rot: 0 }, { type: 'pallets', x: X2 - 5, z: Z1 + 5 });
      blk.paved = GROUND.gravel;
      break;
    case 'substation': {
      const cx = (X1 + X2) / 2, cz = (Z1 + Z2) / 2;
      for (let k = 0; k < 4; k++) props.push({ type: 'transformer', x: cx - 9 + k * 6, z: cz });
      props.push({ type: 'fence', x1: cx - 15, z1: cz - 8, x2: cx + 15, z2: cz + 8 });
      ctx.spots.substation = { x: cx, z: cz, switchAt: { x: cx - 13, y: terrainH(cx - 13, cz + 6) + LOT_RAISE, z: cz + 6 } };
      blk.paved = GROUND.gravel;
      break;
    }
  }
  return { buildings: out, props };
}

// ------------------------------------------------------------- the build --

// Relief per texture layer in metres (how deep a joint or slab edge goes),
// turned into texture units for the parallax march by the layer's repeat size.
const FACADE_RELIEF = [0.014, 0.012, 0.004, 0.012, 0.02, 0.01, 0.004, 0, 0.016, 0.016, 0.018, 0.008, 0];
const ROOF_RELIEF = [0.035, 0.012, 0.015, 0.004, 0.01];
const GROUND_RELIEF = [0.012, 0.01, 0.004, 0.02, 0, 0.006, 0.004, 0.004];
function depthsFor(relief, table) {
  return relief.map((m, i) => {
    const t = table[i];
    return m / (Array.isArray(t) ? (t[0] + t[1]) / 2 : t);
  });
}

export function buildTown(scene, mats) {
  const t0 = performance.now();
  registerCars();
  growTrees();
  const blocks = makeBlocks();

  const arr = { facade: buildFacadeArray(), roof: buildRoofArray(), ground: buildGroundArray() };
  const atlas = buildSignAtlas();
  const mat = {
    walls: arrayMaterial(arr.facade, { normalScale: 1.2, mossLayer: FACADE.moss, depths: depthsFor(FACADE_RELIEF, FACADE_TILE) }),
    roof: arrayMaterial(arr.roof, { side: THREE.DoubleSide, depths: depthsFor(ROOF_RELIEF, ROOF_TILE) }),
    trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.02 }),
    glass: interiorGlass(),
    clear: clearGlass(),
    signs: signMaterial(atlas),
    ground: arrayMaterial(arr.ground, { wetLayer: GROUND.asphalt, depths: depthsFor(GROUND_RELIEF, GROUND_TILE) }),
    foliage: foliageMaterial(),
  };
  const texMs = Math.round(performance.now() - t0);

  const newBufs = () => ({
    walls: new GeoBuf({ layer: true, base: true }), roof: new GeoBuf({ layer: true, base: true }),
    trim: new GeoBuf(), glass: new GeoBuf({ win: true }), signs: new GeoBuf(), clear: new GeoBuf(),
    props: new GeoBuf(),
  });
  const chunks = new Map();
  const chunkOf = (x, z) => {
    const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
    const k = ix + ',' + iz;
    let c = chunks.get(k);
    if (!c) {
      c = { ix, iz, minX: ix * CHUNK, maxX: (ix + 1) * CHUNK, minZ: iz * CHUNK, maxZ: (iz + 1) * CHUNK,
            near: newBufs(), keep: newBufs(), placements: [],
            ground: new GeoBuf({ layer: true, base: true }), road: new GeoBuf(), foliage: new GeoBuf({ base: true }) };
      chunks.set(k, c);
    }
    return c;
  };
  const far = { walls: new GeoBuf({ layer: true, base: true }), roof: new GeoBuf({ layer: true, base: true }) };
  // The ten enterable buildings share one always-visible set of meshes
  // (they cost six draw calls in every chunk they sat in).
  const keep = newBufs();
  // Trees in coarse 160 m cells: hillside forest otherwise made a chunk, and a
  // draw call, out of every 80 m of empty slope.
  const FCELL = 160;
  const foliageCells = new Map();
  const foliageOf = (x, z) => {
    const k = Math.floor(x / FCELL) + ',' + Math.floor(z / FCELL);
    if (!foliageCells.has(k)) foliageCells.set(k, new GeoBuf({ base: true }));
    return foliageCells.get(k);
  };
  const colliders = [];
  const buildings = [];
  const lamps = [];
  const glows = [];
  const wires = [];
  const indoor = [];
  const ctx = { shopN: 0, spots: { drains: [], hangingSigns: [] } };
  const r = rng(99);

  const solid = (minX, minZ, maxX, maxZ, bottom, top, surf, ref) => {
    colliders.push({ minX, maxX, minZ, maxZ, bottom, top, town: true, surf: surf || 'masonry', ref });
  };
  const P = (x, z) => {
    const c = chunkOf(x, z);
    return {
      walls: c.near.walls, trim: c.near.trim, glass: c.near.glass, foliage: foliageOf(x, z), ground: c.ground,
      props: c.near.props,
      place: (kind, px, py, pz, rot, s, sy, col) => c.placements.push({ kind, x: px, y: py, z: pz, rot, s, sy, col }),
    };
  };
  const lotH = (x, z) => terrainH(x, z) + LOT_RAISE;

  // ---- buildings and block props ----
  for (const blk of blocks) {
    const { buildings: bl, props } = layoutBlock(blk, ctx);
    for (const b of bl) {
      const c = chunkOf(b.x, b.z);
      buildings.push(b);
      if (b.enter) {
        b.cols = colliders;
        emitBuilding(b, keep, null, keep.signs);
        indoor.push({ minX: b.x - b.ww / 2, maxX: b.x + b.ww / 2, minZ: b.z - b.wd / 2, maxZ: b.z + b.wd / 2,
                      y0: b.base - 0.5, y1: b.base + b.sh, b });
        const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
        for (const lp of b.lamps) lamps.push({ x: b.x + lp.x * cs + lp.z * sn, y: b.base + b.sh - 0.3, z: b.z - lp.x * sn + lp.z * cs, kind: 'indoor' });
        continue;
      }
      emitBuilding(b, c.near, far, c.near.signs);
      const x1 = b.x - b.ww / 2, x2 = b.x + b.ww / 2, z1 = b.z - b.wd / 2, z2 = b.z + b.wd / 2;
      const top = b.base + b.H;
      solid(x1, z1, x2, z2, b.foot, top + (b.roof === 'flat' ? 0.7 : 0),
        b.kind === 'warehouse' && b.mat === FACADE.corrugated ? 'metal' : 'masonry', b);
      if (b.roof !== 'flat') {
        const ix = b.ww * 0.25, iz = b.wd * 0.25;
        solid(x1 + ix, z1 + iz, x2 - ix, z2 - iz, top, top + b.rise * 0.6, 'masonry', b);
      }
      if (b.kind === 'house' && b.lot) dressHouse(b, P, solid, lotH, r);
    }
    for (const p of props) emitProp(p, P, solid, lotH, ctx, r);
    emitGround(blk, chunkOf((blk.x1 + blk.x2) / 2, (blk.z1 + blk.z2) / 2).ground, blk.forecourt);
    dressPavements(blk, P, solid, lotH, lamps, wires, ctx, r);
  }

  // ---- streets ----
  for (const s of STREETS) {
    for (let a = s.from; a < s.to - 0.01; a = Math.min(s.to, (Math.floor(a / CHUNK) + 1) * CHUNK)) {
      const b = Math.min(s.to, (Math.floor(a / CHUNK) + 1) * CHUNK);
      const mid = (a + b) / 2;
      const c = s.axis === 'z' ? chunkOf(s.at, mid) : chunkOf(mid, s.at);
      emitRoad(s, a, b, c.ground);
      emitMarkings(s, a, b, c.ground);
    }
  }
  dressStreets(P, solid, glows, ctx, r);
  scatterTrees(blocks, P, solid, r);

  // ---- meshes ----
  const group = new THREE.Group();
  group.name = 'town';
  scene.add(group);
  let tris = 0;
  const mk = (buf, material, shadow) => {
    if (!buf || buf.empty) return null;
    const m = new THREE.Mesh(buf.geometry(), material);
    m.castShadow = shadow; m.receiveShadow = true;
    tris += buf.tris;
    return m;
  };
  for (const c of chunks.values()) {
    c.detail = new THREE.Group();
    c.baseG = new THREE.Group();
    c.keepG = new THREE.Group();
    for (const [k, cast] of [['walls', true], ['roof', true], ['trim', true], ['glass', false], ['signs', false]]) {
      const m = mk(c.near[k], mat[k], cast); if (m) c.detail.add(m);
    }
    c.standIn = mk(c.near.props, mat.trim, true); if (c.standIn) c.detail.add(c.standIn);
    const gm = mk(c.ground, mat.ground, false); if (gm) c.baseG.add(gm);
    group.add(c.detail, c.baseG);
    c.near = c.keep = c.ground = c.road = c.foliage = null;
  }
  const keepG = new THREE.Group();
  keepG.name = 'enterable';
  for (const [k, cast] of [['walls', true], ['roof', true], ['trim', true], ['glass', false], ['signs', false]]) {
    const m = mk(keep[k], mat[k], cast); if (m) keepG.add(m);
  }
  const cl = mk(keep.clear, mat.clear, false); if (cl) { cl.renderOrder = 2; keepG.add(cl); }
  group.add(keepG);
  const foliageG = new THREE.Group();
  foliageG.name = 'foliage';
  for (const buf of foliageCells.values()) { const m = mk(buf, mat.foliage, true); if (m) foliageG.add(m); }
  group.add(foliageG);
  const farGroup = new THREE.Group();
  for (const [buf, material] of [[far.walls, mat.walls], [far.roof, mat.roof]]) {
    const m = mk(buf, material, false); if (m) farGroup.add(m);
  }
  group.add(farGroup);

  if (wires.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1c1c1e }));
    lines.name = 'wires';
    group.add(lines);
  }

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
    materials: mat, arrays: arr, atlas, tris, buildMs: 0, texMs, lamps, glows, indoor, spots: ctx.spots,
    detailDist: 150,
    surfaceH: (x, z) => terrainH(x, z) + (onLot(x, z) ? LOT_RAISE : 0),
    onLot,
    indoorAt(x, z, y) {
      for (const q of indoor) {
        if (x > q.minX && x < q.maxX && z > q.minZ && z < q.maxZ && (y === undefined || (y > q.y0 && y < q.y1 + 1))) return q;
      }
      return null;
    },
    byTag(tag) { return buildings.find((b) => b.tag === tag); },
    // Models (models.js): one KindInstances per kind for the whole town, each
    // refilled with the placements within its view distance as the camera
    // moves (per 80 m chunk it was 800 meshes, a draw call each; per 160 m
    // cell, every tree and hedge bush in range was drawn at full detail: 6.2M
    // triangles). Called once when the town is built (generated cars, trees)
    // and again when the scanned props arrive; each call adds the kinds that
    // are new. The stand-ins hide once the scans are in.
    attachModels() {
      if (!this.kindSets) {
        this.kindSets = new Map();
        this.modelsG = new THREE.Group(); this.modelsG.name = 'props';
        this.group.add(this.modelsG);
      }
      const byKind = new Map();
      for (const c of this.chunks) for (const p of c.placements) {
        if (this.kindSets.has(p.kind) || !modelKind(p.kind)) continue;
        if (!byKind.has(p.kind)) byKind.set(p.kind, []);
        byKind.get(p.kind).push(p);
      }
      for (const [k, list] of byKind) this.kindSets.set(k, new KindInstances(k, list, this.modelsG));
      if (modelsReady()) for (const c of this.chunks) if (c.standIn) c.standIn.visible = false;
      let placed = 0;
      for (const ks of this.kindSets.values()) placed += ks.list.length;
      this.modelsAttached = { kinds: this.kindSets.size, meshes: this.modelsG.children.length, placed };
      return this.modelsAttached;
    },
    // What the ground is made of at (x, z), for footstep sounds.
    groundKind(x, z, y) {
      if (y !== undefined && this.indoorAt(x, z, y)) return 'wood';
      const l = lotGrid.get(Math.floor(x / LOTCELL) * 10007 + Math.floor(z / LOTCELL));
      const blk = l && l.find((b) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2);
      if (blk) {
        const p = blk.pave;
        if ((p.w && x < blk.x1 + p.w) || (p.e && x > blk.x2 - p.e) || (p.n && z < blk.z1 + p.n) || (p.s && z > blk.z2 - p.s)) return 'paving';
        if (blk.paved === GROUND.gravel) return 'gravel';
        if (blk.paved === GROUND.concrete || blk.kind === 'industrial' || blk.kind === 'heavy') return 'concrete';
        if (blk.paved !== undefined || ['main', 'police', 'petrol'].includes(blk.kind)) return 'paving';
        return 'grass';
      }
      if (x > SHELF.minX && x < SHELF.maxX && z > SHELF.minZ && z < SHELF.maxZ) return 'asphalt';
      for (const s of STREETS) {
        const hw = s.road / 2 + 0.3;
        if (s.axis === 'z' ? Math.abs(x - s.at) < hw && z >= s.from && z <= s.to : Math.abs(z - s.at) < hw && x >= s.from && x <= s.to) return 'asphalt';
      }
      return 'grass';
    },
    // world position of a building-local point at floor height
    local(b, lx, lz, ly = 0) {
      const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
      return new THREE.Vector3(b.x + lx * cs + lz * sn, b.base + ly, b.z - lx * sn + lz * cs);
    },
    update(cam, dist) {
      const d = dist === undefined ? this.detailDist : dist;
      const d2 = d * d;
      for (const c of this.chunks) {
        const dx = Math.max(c.minX - cam.x, 0, cam.x - c.maxX);
        const dz = Math.max(c.minZ - cam.z, 0, cam.z - c.maxZ);
        c.detail.visible = dx * dx + dz * dz < d2;
      }
      if (this.kindSets) for (const ks of this.kindSets.values()) ks.update(cam, d === Infinity ? 'all' : false);
    },
  };
  town.attachModels();   // the generated cars; the scans follow when loaded
  town.buildMs = Math.round(performance.now() - t0);
  // CC0 photo textures (docs/assets/mat) replace their procedural layers once
  // fetched and decoded, during the menu. If they fail the procedural ones stay.
  town.cc0Ready = applyCC0(arr).then((n) => { town.cc0Applied = n; return n; })
    .catch((e) => { console.warn('CC0 textures not applied', e); town.cc0Applied = 0; return 0; });
  return town;
}

// ---------------------------------------------------------- materials ----

function foliageMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  if (!SHARED.uWind) SHARED.uWind = { value: 1 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SHARED.uTime;
    sh.uniforms.uWind = SHARED.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aobase;\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hh = max( position.y - aobase - 1.8, 0.0 );
        float ph = position.x * 0.31 + position.z * 0.23;
        transformed.x += sin( uTime * 1.4 + ph ) * hh * 0.022 * uWind;
        transformed.z += cos( uTime * 1.1 + ph * 1.3 ) * hh * 0.016 * uWind;`);
  };
  m.customProgramCacheKey = () => 'townFoliage';
  return m;
}

// ---------------------------------------------------------------- props --

function emitProp(p, P, solid, H, ctx, r) {
  const at = (x, z) => P(x, z);
  switch (p.type) {
    case 'canopy': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      N.trim.box(p.x, y + p.h + 0.35, p.z, p.w, 0.7, p.d, 1, 0, [0.86, 0.86, 0.84]);
      N.trim.box(p.x, y + p.h + 0.35, p.z, p.w + 0.1, 0.25, p.d + 0.1, 1, 0, [0.7, 0.14, 0.12]);
      for (const [dx, dz] of [[-p.w / 2 + 1, -p.d / 2 + 1.5], [p.w / 2 - 1, -p.d / 2 + 1.5], [-p.w / 2 + 1, p.d / 2 - 1.5], [p.w / 2 - 1, p.d / 2 - 1.5]]) {
        N.trim.box(p.x + dx, y + p.h / 2, p.z + dz, 0.4, p.h, 0.4, 1, 0, [0.82, 0.82, 0.8]);
        solid(p.x + dx - 0.2, p.z + dz - 0.2, p.x + dx + 0.2, p.z + dz + 0.2, y - 0.5, y + p.h, 'metal');
      }
      solid(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, y + p.h, y + p.h + 0.7, 'metal');
      ctx.spots.canopyLights = { x: p.x, y: y + p.h - 0.05, z: p.z, w: p.w, d: p.d };
      break;
    }
    case 'pump': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      N.trim.box(p.x, y + 0.15, p.z, 1.4, 0.3, 3.4, 1, 0, [0.6, 0.6, 0.58]);
      N.trim.box(p.x, y + 1.1, p.z, 0.7, 1.6, 1.0, 1, 0, [0.72, 0.18, 0.14]);
      N.trim.box(p.x, y + 1.5, p.z, 0.72, 0.4, 0.8, 1, 0, [0.9, 0.9, 0.88]);
      solid(p.x - 0.35, p.z - 0.5, p.x + 0.35, p.z + 0.5, y - 0.5, y + 1.9, 'metal');
      break;
    }
    case 'fuelcar': {
      // The car itself is a separate mesh in townlife (it can explode); here,
      // the fuel puddle leaking under it and its collider.
      const y = H(p.x, p.z);
      ctx.spots.fuelCar = { x: p.x, y, z: p.z, rot: p.rot };
      const N = at(p.x, p.z);
      N.trim.quad([p.x - 1.4, y + 0.025, p.z + 1.6], [p.x + 1.1, y + 0.025, p.z + 1.4], [p.x + 1.6, y + 0.025, p.z + 3.4], [p.x - 1.0, y + 0.025, p.z + 3.6],
        [0, 1, 0], [0.1, 0.09, 0.12]);
      solid(p.x - 1.1, p.z - 2.3, p.x + 1.1, p.z + 2.3, y - 0.5, y + 1.4, 'fuelcar');
      break;
    }
    case 'car': {
      const y = H(p.x, p.z);
      PR.car(at(p.x, p.z), solid, p.x, y, p.z, p.rot || 0, p.police ? [0.1, 0.12, 0.18] : (p.col || pick(r, PR.COLOURS.car)), { police: p.police });
      break;
    }
    case 'memorial': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      const stone = [0.56, 0.54, 0.5];
      N.trim.box(p.x, y + 0.3, p.z, 5, 0.6, 5, 1, 0, stone);
      N.trim.box(p.x, y + 1.1, p.z, 2.6, 1.0, 2.6, 1, 0, stone);
      N.trim.box(p.x, y + 4.6, p.z, 1.0, 6.0, 1.0, 1, 0, stone);
      N.trim.box(p.x, y + 7.75, p.z, 0.5, 0.5, 0.5, 1, 0, stone);
      N.trim.box(p.x, y + 1.15, p.z + 1.31, 1.6, 0.5, 0.02, 1, 0, [0.4, 0.34, 0.2]);
      solid(p.x - 2.5, p.z - 2.5, p.x + 2.5, p.z + 2.5, y - 0.5, y + 0.6, 'masonry');
      solid(p.x - 1.3, p.z - 1.3, p.x + 1.3, p.z + 1.3, y - 0.5, y + 1.6, 'masonry');
      solid(p.x - 0.5, p.z - 0.5, p.x + 0.5, p.z + 0.5, y - 0.5, y + 8.0, 'masonry');
      break;
    }
    case 'planter': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      N.trim.box(p.x, y + 0.3, p.z, 3.0, 0.6, 1.4, 1, 0, [0.6, 0.59, 0.56]);
      N.foliage.B = y; N.foliage.box(p.x, y + 0.66, p.z, 2.7, 0.14, 1.1, 1, 0, [0.22, 0.3, 0.14]);
      for (const dx of [-0.8, 0, 0.8]) N.place('bush', p.x + dx, y + 0.6, p.z, dx * 2.1, 0.45);
      solid(p.x - 1.5, p.z - 0.7, p.x + 1.5, p.z + 0.7, y - 0.5, y + 0.6, 'masonry');
      break;
    }
    case 'bench': PR.bench(at(p.x, p.z), solid, p.x, H(p.x, p.z), p.z, p.rot); break;
    case 'tree': PR.tree(at(p.x, p.z), solid, p.x, H(p.x, p.z), p.z, p.s || 1, p.kind, r); break;
    case 'shelter': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      const metal = [0.3, 0.32, 0.33];
      N.trim.box(p.x, y + 2.5, p.z, 1.6, 0.12, 4.0, 1, 0, metal);
      N.trim.box(p.x - 0.7, y + 1.3, p.z, 0.05, 2.2, 3.8, 1, 0, [0.4, 0.46, 0.48]);
      for (const dz of [-1.9, 1.9]) N.trim.box(p.x - 0.7, y + 1.25, p.z + dz, 0.1, 2.5, 0.1, 1, 0, metal);
      N.trim.box(p.x - 0.3, y + 0.45, p.z, 0.4, 0.06, 2.4, 1, 0, [0.45, 0.33, 0.22]);
      solid(p.x - 0.75, p.z - 2, p.x - 0.65, p.z + 2, y - 0.5, y + 2.5, 'glass');
      break;
    }
    case 'container': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      const cols = [[0.55, 0.22, 0.16], [0.18, 0.32, 0.48], [0.26, 0.40, 0.28], [0.62, 0.50, 0.22]];
      for (let s = 0; s < p.stack; s++) {
        const col = cols[Math.floor(Math.abs(p.x * 7 + p.z * 3 + s * 5)) % cols.length];
        N.walls.L = FACADE.corrugated; tile(N.walls, FACADE_TILE, FACADE.corrugated); N.walls.B = -1000;
        N.walls.box(p.x, y + 1.3 + s * 2.6, p.z, 6.0, 2.6, 2.45, 0, 1, col);
      }
      solid(p.x - 1.25, p.z - 3, p.x + 1.25, p.z + 3, y - 0.5, y + 2.6 * p.stack, 'metal');
      break;
    }
    case 'watertower': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      const metal = [0.36, 0.38, 0.4];
      const Ht = 15;
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        N.trim.box(p.x + dx, y + Ht / 2, p.z + dz, 0.45, Ht, 0.45, 1, 0, metal);
        solid(p.x + dx - 0.25, p.z + dz - 0.25, p.x + dx + 0.25, p.z + dz + 0.25, y - 0.5, y + Ht, 'metal');
      }
      for (const yy of [4, 9]) {
        N.trim.box(p.x, y + yy, p.z - 3, 6, 0.15, 0.15, 1, 0, metal); N.trim.box(p.x, y + yy, p.z + 3, 6, 0.15, 0.15, 1, 0, metal);
        N.trim.box(p.x - 3, y + yy, p.z, 0.15, 0.15, 6, 1, 0, metal); N.trim.box(p.x + 3, y + yy, p.z, 0.15, 0.15, 6, 1, 0, metal);
      }
      N.trim.cylinder(p.x, y + Ht, p.z, 4.5, 6, 18, [0.5, 0.56, 0.58], 2.2);
      N.trim.cylinder(p.x, y + Ht + 6, p.z, 4.6, 0.3, 18, [0.42, 0.46, 0.48]);
      solid(p.x - 4.2, p.z - 4.2, p.x + 4.2, p.z + 4.2, y + Ht, y + Ht + 7, 'metal');
      break;
    }
    case 'transformer': {
      const N = at(p.x, p.z), y = H(p.x, p.z);
      N.trim.box(p.x, y + 1.3, p.z, 3.0, 2.6, 2.2, 1, 0, [0.42, 0.47, 0.42]);
      for (let k = -1; k <= 1; k++) N.trim.cylinder(p.x + k * 0.8, y + 2.6, p.z, 0.12, 1.0, 6, [0.6, 0.45, 0.3]);
      N.trim.box(p.x, y + 4.5, p.z, 0.25, 4.0, 0.25, 1, 0, [0.4, 0.41, 0.42]);
      N.trim.box(p.x, y + 6.3, p.z, 3.4, 0.2, 0.2, 1, 0, [0.4, 0.41, 0.42]);
      solid(p.x - 1.5, p.z - 1.1, p.x + 1.5, p.z + 1.1, y - 0.5, y + 2.6, 'metal');
      break;
    }
    case 'pallets': PR.pallets(at(p.x, p.z), solid, p.x, H(p.x, p.z), p.z, 3 + Math.floor(r() * 4)); break;
    case 'drums': for (let k = 0; k < 4; k++) PR.drum(at(p.x, p.z), solid, p.x + (k % 2) * 0.7, H(p.x, p.z), p.z + Math.floor(k / 2) * 0.7, k === 2 ? [0.6, 0.2, 0.12] : null); break;
    case 'skip': PR.skip(at(p.x, p.z), solid, p.x, H(p.x, p.z), p.z, p.rot || 0); break;
    case 'rail': {
      for (let z = p.z0; z < p.z1; z += 6) {
        const C = P(p.x, z + 3);
        C.ground.L = GROUND.gravel; tile(C.ground, GROUND_TILE, GROUND.gravel); C.ground.B = -1000;
        const y0 = H(p.x, z), y1 = H(p.x, z + 6);
        C.ground.quad([p.x - 2, y0 + 0.04, z], [p.x + 2, y0 + 0.04, z], [p.x + 2, y1 + 0.04, z + 6], [p.x - 2, y1 + 0.04, z + 6], [0, 1, 0], [0.8, 0.78, 0.74],
          [p.x - 2, z, p.x + 2, z, p.x + 2, z + 6, p.x - 2, z + 6]);
        PR.rail(C, solid, p.x, z, z + 6, H);
      }
      at(p.x, p.z1).trim.box(p.x, H(p.x, p.z1) + 0.6, p.z1, 2.8, 1.0, 0.4, 1, 0, [0.62, 0.15, 0.1]);
      break;
    }
    case 'wagon': PR.wagon(at(p.x, p.z), solid, p.x, H(p.x, p.z), p.z); break;
    case 'fence': case 'wall': {
      const pts = p.type === 'fence'
        ? [[p.x1, p.z1, p.x2, p.z1], [p.x2, p.z1, p.x2, p.z2], [p.x2, p.z2, p.x1, p.z2], [p.x1, p.z2, p.x1, p.z1 + (p.z2 - p.z1) * 0.35]]
        : [[p.x1, p.z1, p.x2, p.z2]];
      const h = p.h || 2.4;
      for (const [ax, az, bx, bz] of pts) {
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.ceil(len / 3));
        for (let k = 0; k < n; k++) {
          const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n;
          const x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
          const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
          const y = H(mx, mz);
          const horiz = Math.abs(bx - ax) > Math.abs(bz - az);
          const seg = len / n;
          const N = at(mx, mz);
          if (p.type === 'wall') {
            N.walls.L = FACADE.concrete; tile(N.walls, FACADE_TILE, FACADE.concrete); N.walls.B = y;
            N.walls.box(mx, y + h / 2 - 0.2, mz, horiz ? seg : 0.25, h + 0.4, horiz ? 0.25 : seg, 1, 0, [0.9, 0.88, 0.84]);
          } else {
            N.trim.box(x0, y + h / 2, z0, 0.1, h, 0.1, 1, 0, [0.4, 0.42, 0.44]);
            N.trim.box(mx, y + h - 0.05, mz, horiz ? seg : 0.05, 0.05, horiz ? 0.05 : seg, 1, 0, [0.4, 0.42, 0.44]);
            N.trim.box(mx, y + h / 2, mz, horiz ? seg : 0.02, h - 0.2, horiz ? 0.02 : seg, 1, 0, [0.34, 0.36, 0.36]);
          }
          solid(Math.min(x0, x1) - (horiz ? 0 : 0.12), Math.min(z0, z1) - (horiz ? 0.12 : 0),
                Math.max(x0, x1) + (horiz ? 0 : 0.12), Math.max(z0, z1) + (horiz ? 0.12 : 0), y - 0.5, y + h,
                p.type === 'wall' ? 'masonry' : 'metal');
        }
      }
      break;
    }
  }
}

// Front boundaries, driveways, cars and garden trees for a house.
function dressHouse(b, P, solid, H, r) {
  const L = b.lot;
  const N = P(b.x, b.z);
  const along = L.face === 'n' || L.face === 's';
  const front = L.face === 'e' ? L.X2 : L.face === 'w' ? L.X1 : L.face === 's' ? L.Z2 : L.Z1;
  const out = L.face === 'e' || L.face === 's' ? 1 : -1;
  const lineAt = (t, o) => along ? [t, front - out * o] : [front - out * o, t];
  const doorT = along ? b.x : b.z;
  // the driveway runs beside the house, not into its wall
  const side = r() < 0.5 ? 1 : -1;
  let drive = doorT + side * (b.w / 2 + 1.7);
  if (drive > L.a1 - 1.6 || drive < L.a0 + 1.6) drive = doorT - side * (b.w / 2 + 1.7);
  const driveFits = drive <= L.a1 - 1.6 && drive >= L.a0 + 1.6;
  const hedge = r() < 0.5;
  const gaps = [[doorT - 0.8, doorT + 0.8], [drive - 1.6, drive + 1.6]].sort((a, c) => a[0] - c[0]);
  let t = L.a0 + 0.3;
  const segs = [];
  for (const [g0, g1] of gaps) { if (g0 > t + 0.5) segs.push([t, g0]); t = Math.max(t, g1); }
  if (L.a1 - 0.3 > t + 0.5) segs.push([t, L.a1 - 0.3]);
  for (const [s0, s1] of segs) {
    const [ax, az] = lineAt(s0, 0.4), [bx, bz] = lineAt(s1, 0.4);
    const y = H((ax + bx) / 2, (az + bz) / 2);
    const th = hedge ? 0.35 : 0.14;
    const x1 = Math.min(ax, bx) - (along ? 0 : th), x2 = Math.max(ax, bx) + (along ? 0 : th);
    const z1 = Math.min(az, bz) - (along ? th : 0), z2 = Math.max(az, bz) + (along ? th : 0);
    if (hedge) PR.hedge(N, solid, x1, z1, x2, z2, y, 1.0);
    else PR.lowWall(N, solid, x1, z1, x2, z2, y, 0.75);
  }
  // gravel driveway, maybe a car on it
  const [d0x, d0z] = lineAt(drive, 0), [d1x, d1z] = lineAt(drive, L.setback + b.d * 0.6);
  const G = N.ground;
  G.L = GROUND.gravel; tile(G, GROUND_TILE, GROUND.gravel); G.B = -1000;
  const w2 = 1.4;
  const dq = along
    ? [[d0x - w2, d0z], [d0x + w2, d0z], [d1x + w2, d1z], [d1x - w2, d1z]]
    : [[d0x, d0z - w2], [d0x, d0z + w2], [d1x, d1z + w2], [d1x, d1z - w2]];
  G.quad(...dq.map(([x, z]) => [x, H(x, z) + 0.012, z]), [0, 1, 0], [1, 1, 1], dq.flatMap(([x, z]) => [x, z]));
  // parked well inside the gap, so the way in and out stays open
  if (driveFits && r() < 0.45) {
    const [cx, cz] = lineAt(drive, 3.7);
    PR.car(N, solid, cx, H(cx, cz), cz, b.rot + (r() < 0.5 ? 0 : Math.PI), pick(r, PR.COLOURS.car));
  }
  if (r() < 0.55) {
    const [tx, tz] = lineAt(doorT + (drive > doorT ? -1 : 1) * 4.5, L.setback * 0.5);
    PR.tree(N, solid, tx, H(tx, tz), tz, 0.75 + r() * 0.4, r() < 0.3 ? 'conifer' : 'deciduous', r);
  }
  if (r() < 0.65) {
    const [tx, tz] = lineAt(doorT + (r() - 0.5) * 6, L.setback + b.d + 4 + r() * 3);
    if (Math.abs(tx) < 205 && tz < 330) PR.tree(N, solid, tx, H(tx, tz), tz, 0.8 + r() * 0.5, r() < 0.4 ? 'conifer' : 'deciduous', r);
  }
}

// Lamps, bins, benches, hydrants, post boxes and telegraph poles along every
// pavement, manhole covers on the road, litter.
function dressPavements(blk, P, solid, H, lamps, wires, ctx, r) {
  const sides = [
    { key: 'w', pave: blk.pave.w, a0: blk.z1, a1: blk.z2, at: (t, o) => [blk.x1 + o, t], rot: -Math.PI / 2 },
    { key: 'e', pave: blk.pave.e, a0: blk.z1, a1: blk.z2, at: (t, o) => [blk.x2 - o, t], rot: Math.PI / 2 },
    { key: 'n', pave: blk.pave.n, a0: blk.x1, a1: blk.x2, at: (t, o) => [t, blk.z1 + o], rot: Math.PI },
    { key: 's', pave: blk.pave.s, a0: blk.x1, a1: blk.x2, at: (t, o) => [t, blk.z2 - o], rot: 0 },
  ];
  const busy = ['main', 'police', 'square', 'civic', 'petrol'].includes(blk.kind);
  const resi = ['res', 'terrace', 'res-edge', 'res-north'].includes(blk.kind);
  for (const s of sides) {
    if (!s.pave) continue;
    const len = s.a1 - s.a0;
    const lampStep = busy ? 26 : 34;
    for (let t = s.a0 + 6 + (r() * 4); t < s.a1 - 4; t += lampStep) {
      const [x, z] = s.at(t, 0.45);
      PR.lamp(P(x, z), solid, x, H(x, z), z, s.rot, lamps);
    }
    if (busy) {
      for (let t = s.a0 + 12; t < s.a1 - 6; t += 22) {
        const [x, z] = s.at(t, 0.6);
        PR.bin(P(x, z), solid, x, H(x, z), z);
      }
      for (let t = s.a0 + 18; t < s.a1 - 8; t += 30) {
        const [x, z] = s.at(t, Math.min(s.pave - 0.7, 1.6));
        PR.bench(P(x, z), solid, x, H(x, z), z, s.rot + Math.PI);
      }
      if (blk.kind === 'main' || blk.kind === 'police') {
        const [x, z] = s.at(s.a0 + len * 0.5, 0.55);
        PR.postBox(P(x, z), solid, x, H(x, z), z, s.rot);
        if (r() < 0.8) {
          const [hx, hz] = s.at(s.a0 + len * (0.25 + r() * 0.5), s.pave - 0.9);
          ctx.spots.hangingSigns.push({ x: hx, y: H(hx, hz) + 3.6, z: hz, rot: s.rot, sign: Math.floor(r() * 17) });
        }
      }
    }
    for (let t = s.a0 + 9; t < s.a1 - 4; t += 55) {
      const [x, z] = s.at(t, 0.5);
      PR.hydrant(P(x, z), solid, x, H(x, z), z);
    }
    if (resi && (s.key === 'e' || s.key === 'n')) {
      let prev = null;
      for (let t = s.a0 + 3; t < s.a1 - 2; t += 30) {
        const [x, z] = s.at(t, s.pave - 0.35);
        const top = PR.pole(P(x, z), solid, x, H(x, z), z);
        if (prev) sag(wires, prev, top, s.key === 'n');
        prev = top;
      }
    }
    if (busy || r() < 0.3) {
      const [x, z] = s.at(s.a0 + len * (0.3 + r() * 0.4), -2.2);
      const y = terrainH(x, z);
      PR.manhole(P(x, z), x, y, z);
      ctx.spots.drains.push({ x, y: y + 0.1, z });
    }
    const n = busy ? 14 : 5;
    for (let k = 0; k < n; k++) {
      const [x, z] = s.at(s.a0 + r() * len, r() * (s.pave + 2) - 1.5);
      const onLot = x >= blk.x1 && x <= blk.x2 && z >= blk.z1 && z <= blk.z2;
      PR.litter(P(x, z), x, onLot ? H(x, z) : terrainH(x, z) + 0.08, z, r);
    }
  }
}

function sag(wires, a, b, alongX) {
  const n = 8;
  for (const off of [-0.6, 0.6]) {
    const p = (t) => [a[0] + (b[0] - a[0]) * t + (alongX ? 0 : off), a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * 0.9,
                      a[2] + (b[2] - a[2]) * t + (alongX ? off : 0)];
    for (let i = 0; i < n; i++) wires.push(...p(i / n), ...p((i + 1) / n));
  }
}

// On and across the roads: parked and abandoned cars, the roadblock, traffic
// lights, stop signs, the welcome sign, the downed power line.
function dressStreets(P, solid, glows, ctx, r) {
  const T = (x, z) => terrainH(x, z) + 0.06;
  for (const side of [-1, 1]) {
    for (let z = 118; z < 320; z += 6.2) {
      if (Math.abs(z - 165) < 9 || Math.abs(z - 220) < 9 || Math.abs(z - 275) < 9 || Math.abs(z - 196) < 6 || Math.abs(z - 302) < 8) continue;
      if (r() > 0.45) continue;
      const x = side * 3.9;
      PR.car(P(x, z), solid, x, T(x, z), z, side > 0 ? 0 : Math.PI, pick(r, PR.COLOURS.car));
    }
  }
  // abandoned with its door open; leaves a lane a vehicle can get through
  PR.car(P(-1.6, 236), solid, -1.6, T(-1.6, 236), 236, 0.15, PR.COLOURS.car[2], { doorOpen: true });
  PR.car(P(3.6, 150), solid, 3.6, T(3.6, 150), 150, -0.6, PR.COLOURS.car[1]);
  PR.car(P(-60, 166), solid, -60, T(-60, 166), 166, 1.2, PR.COLOURS.car[5], { doorOpen: true });
  PR.car(P(48, 248), solid, 48, T(48, 248), 248, 0.2, PR.COLOURS.car[6]);
  ctx.spots.burningCar = { x: 1.5, y: T(1.5, 206), z: 206 };
  PR.car(P(1.5, 206), solid, 1.5, T(1.5, 206), 206, 2.6, [0.12, 0.11, 0.1]);
  for (const [x, rot] of [[-2.6, 1.1], [2.4, -1.25]]) PR.car(P(x, 302), solid, x, T(x, 302), 302, rot, [0.1, 0.12, 0.18], { police: true });
  for (const x of [-4.2, 4.4]) PR.barrier(P(x, 297), solid, x, T(x, 297), 297, 0);
  for (let k = 0; k < 6; k++) PR.cone(P(-5 + k * 2, 295), -5 + k * 2, T(-5 + k * 2, 295), 295);
  ctx.spots.roadblock = { x: 0, z: 302 };
  for (const z of [110, 220]) {
    PR.trafficLight(P(6.2, z - 5.5), solid, 6.2, T(6.2, z - 5.5) + 0.1, z - 5.5, 0, glows);
    PR.trafficLight(P(-6.2, z + 5.5), solid, -6.2, T(-6.2, z + 5.5) + 0.1, z + 5.5, Math.PI, glows);
  }
  for (const z of [165, 275]) {
    PR.roadSign(P(-7.2, z - 4.5), solid, -7.2, T(-7.2, z - 4.5) + 0.1, z - 4.5, -Math.PI / 2, 'stop');
    PR.roadSign(P(7.2, z + 4.5), solid, 7.2, T(7.2, z + 4.5) + 0.1, z + 4.5, Math.PI / 2, 'stop');
  }
  const board = (x, z, rot, name) => {
    const N = P(x, z), y = terrainH(x, z);
    for (const dx of [-1.4, 1.4]) N.trim.box(x + dx, y + 1.1, z, 0.14, 2.2, 0.14, 1, 0, [0.35, 0.27, 0.2]);
    N.trim.box(x, y + 1.9, z, 3.4, 1.1, 0.1, 1, 0, [0.35, 0.27, 0.2]);
    ctx.spots.boards = ctx.spots.boards || [];
    ctx.spots.boards.push({ x, y: y + 1.9, z, rot, name });
    solid(x - 1.7, z - 0.1, x + 1.7, z + 0.1, y - 0.5, y + 2.5, 'wood');
  };
  board(9, 320, 0, 'WELCOME TO MERIDIAN RIDGE');
  board(-6.5, 58, Math.PI, 'RESEARCH STATION');
  const sp = ctx.spots.substation;
  if (sp) {
    const x = sp.x + 18, z = 104, y = terrainH(x, z) + 0.15;
    P(x, z).trim.box(x + 1.5, y + 3.5, z, 0.26, 8.0, 0.26, 0.86, 0.5, [0.32, 0.25, 0.18]);
    ctx.spots.spark = { x: x + 4.2, y: y + 0.3, z: z - 0.4, top: [x + 3.2, y + 7.2, z] };
  }
  void glows;
}

// Conifers on the hillsides between the town edges and the mountains, and a
// fringe past the playable edge to soften the mountain foot.
function scatterTrees(blocks, P, solid, r) {
  const nearRoad = (x, z) => STREETS.some((s) => s.axis === 'z'
    ? Math.abs(x - s.at) < s.road / 2 + 4 && z > s.from - 4 && z < s.to + 4
    : Math.abs(z - s.at) < s.road / 2 + 4 && x > s.from - 4 && x < s.to + 4);
  const inBlock = (x, z) => blocks.some((b) => x > b.x1 - 1 && x < b.x2 + 1 && z > b.z1 - 1 && z < b.z2 + 1);
  const inShelf = (x, z) => x > SHELF.minX - 6 && x < SHELF.maxX + 6 && z > SHELF.minZ - 6 && z < SHELF.maxZ + 8;
  let placed = 0;
  for (let k = 0; k < 2600 && placed < 620; k++) {
    const x = -260 + r() * 520, z = -120 + r() * 490;
    if (inShelf(x, z) || nearRoad(x, z) || inBlock(x, z)) continue;
    const inside = x > PLAY.minX && x < PLAY.maxX && z > PLAY.minZ && z < PLAY.maxZ;
    const edge = Math.min(x - PLAY.minX, PLAY.maxX - x, z - PLAY.minZ, PLAY.maxZ - z);
    const density = inside ? (edge < 40 ? 0.9 : z < 100 ? 0.55 : 0.18) : 0.8;
    if (r() > density) continue;
    const y = terrainH(x, z);
    if (y > 70) continue;
    PR.tree(P(x, z), solid, x, y, z, 0.9 + r() * 0.8, r() < 0.82 ? 'conifer' : 'deciduous', r, inside);
    placed++;
  }
}

// ----------------------------------------------------------- ground/road --

function emitGround(blk, buf, forecourt) {
  const { x1, x2, z1, z2, pave } = blk;
  const xs = lines(x1, x2, pave.w, pave.e), zs = lines(z1, z2, pave.n, pave.s);
  const lot = blk.paved !== undefined ? blk.paved
    : ['main', 'police', 'petrol'].includes(blk.kind) ? GROUND.slabs
    : ['industrial', 'heavy'].includes(blk.kind) ? GROUND.concrete : GROUND.grass;
  const H = (x, z) => terrainH(x, z) + LOT_RAISE;
  buf.B = -1000;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const ax = xs[i], bx = xs[i + 1], az = zs[j], bz = zs[j + 1];
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const inPave = (pave.w && cx < x1 + pave.w) || (pave.e && cx > x2 - pave.e) ||
                     (pave.n && cz < z1 + pave.n) || (pave.s && cz > z2 - pave.s);
      const inFore = forecourt && cx > forecourt.x1 && cx < forecourt.x2 && cz > forecourt.z1 && cz < forecourt.z2;
      const layer = inPave ? GROUND.slabs : inFore ? GROUND.concrete : lot;
      buf.L = layer; tile(buf, GROUND_TILE, layer);
      buf.quad([ax, H(ax, az), az], [bx, H(bx, az), az], [bx, H(bx, bz), bz], [ax, H(ax, bz), bz],
        [0, 1, 0], GROUND_TINT[layer] || WHITE, [ax, az, bx, az, bx, bz, ax, bz]);
    }
  }
  const edge = (ax, az, bx, bz, out) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 4));
    buf.L = GROUND.concrete; buf.su = buf.sv = 1 / 1.5;
    for (let k = 0; k < n; k++) {
      const px = ax + (bx - ax) * k / n, pz = az + (bz - az) * k / n;
      const qx = ax + (bx - ax) * (k + 1) / n, qz = az + (bz - az) * (k + 1) / n;
      buf.quad([px, terrainH(px, pz) - 0.1, pz], [qx, terrainH(qx, qz) - 0.1, qz],
        [qx, H(qx, qz), qz], [px, H(px, pz), pz], out, [0.95, 0.94, 0.9]);
    }
  };
  if (pave.n) edge(x1, z1, x2, z1, [0, 0, -1]);
  if (pave.s) edge(x1, z2, x2, z2, [0, 0, 1]);
  if (pave.w) edge(x1, z1, x1, z2, [-1, 0, 0]);
  if (pave.e) edge(x2, z1, x2, z2, [1, 0, 0]);
}

// The CC0 lawn is a saturated photo green and the pale procedural slabs went
// glare-white in full sun; both are toned down here.
const WHITE = [1, 1, 1];
const GROUND_TINT = { [GROUND.grass]: [0.78, 0.8, 0.7], [GROUND.slabs]: [0.86, 0.86, 0.85] };

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
  buf.L = GROUND.asphalt; tile(buf, GROUND_TILE, GROUND.asphalt); buf.B = -1000;
  for (let k = 0; k < n; k++) {
    const t0 = a + (b - a) * k / n, t1 = a + (b - a) * (k + 1) / n;
    buf.quad(P(t0, -hw), P(t0, hw), P(t1, hw), P(t1, -hw), [0, 1, 0], col,
      [-hw, t0, hw, t0, hw, t1, -hw, t1]);
  }
}

// Dashed centre lines and the zebra crossing by the square.
function emitMarkings(s, a, b, buf) {
  const lift = (s.axis === 'x' ? 0.08 : 0.06) + 0.012;
  buf.L = GROUND.paint; buf.su = buf.sv = 1; buf.B = -1000;
  const crossing = (t) => STREETS.some((o) => o.axis !== s.axis && Math.abs(o.at - t) < o.road / 2 + 1 &&
    s.at >= o.from - 1 && s.at <= o.to + 1);
  const P = (t, o) => (s.axis === 'z' ? [s.at + o, terrainH(s.at + o, t) + lift, t] : [t, terrainH(t, s.at + o) + lift, s.at + o]);
  const strip = (t0, t1, o0, o1) => buf.quad(P(t0, o0), P(t0, o1), P(t1, o1), P(t1, o0), [0, 1, 0], [1, 1, 1]);
  for (let t = Math.ceil(a / 8) * 8; t < b - 3; t += 8) {
    if (crossing(t) || crossing(t + 3)) continue;
    strip(t, t + 3, -0.07, 0.07);
  }
  if (s.name === 'Main Street' && a <= 196 && b >= 196) {
    for (let o = -s.road / 2 + 0.6; o < s.road / 2 - 0.4; o += 1.0) strip(193, 199, o, o + 0.5);
  }
}
