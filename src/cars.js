import * as THREE from 'three';
import { registerKind } from './models.js';

// Parked cars, generated. No CC0 car looks real enough (the free packs are
// cartoon style), so the bodies are lofted here: cross-sections along the
// length, each a rounded box that narrows toward the roof (tumblehome), with
// the sill lifted over the wheels so the arches open. The top of the section
// is glass between the windscreen and the rear window, with paint left for
// the roof, the pillars and a drip rail round the windows. Wheels are lathed
// tyres on five-spoke rims. Each body style becomes a model kind (models.js),
// so every parked car of that style is one instanced draw per material, and
// the paint colour is per instance.
//
// +Z is the front, +X the car's left, y up from the road. Metres.

const STYLES = {
  // s runs 0 (rear bumper) .. 1 (front bumper)
  hatch: {
    L: 4.1, W: 1.76, wheelR: 0.31, axles: [0.17, 0.8], belt: [0.86, 0.95], deck: [0.82, 0.92],
    roof: 1.45, glass: { rearLow: 0.04, rearTop: 0.2, roofFront: 0.6, cowl: 0.72 }, pillars: [0.42, 0.21],
  },
  sedan: {
    L: 4.6, W: 1.8, wheelR: 0.32, axles: [0.19, 0.8], belt: [0.86, 0.94], deck: [0.84, 0.95],
    roof: 1.42, glass: { rearLow: 0.2, rearTop: 0.32, roofFront: 0.62, cowl: 0.73 }, pillars: [0.48, 0.3],
  },
  estate: {
    L: 4.7, W: 1.8, wheelR: 0.32, axles: [0.18, 0.8], belt: [0.88, 0.96], deck: [0.86, 0.96],
    roof: 1.47, glass: { rearLow: 0.03, rearTop: 0.09, roofFront: 0.62, cowl: 0.73 }, pillars: [0.46, 0.22],
  },
  van: {
    L: 5.0, W: 1.95, wheelR: 0.34, axles: [0.17, 0.82], belt: [1.0, 1.02], deck: [0.98, 1.0],
    roof: 2.05, glass: { rearLow: 0.02, rearTop: 0.02, roofFront: 0.72, cowl: 0.8 }, pillars: [0.66, 0.66], cargo: true,
  },
};

function paintMat() {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.1 });
}
const MATS = () => ({
  paint: paintMat(),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0e11, metalness: 0.25, roughness: 0.04, envMapIntensity: 1.3 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.75, metalness: 0.05 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.22, metalness: 1 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.92, metalness: 0 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xf2efe4, roughness: 0.15, metalness: 0.1, emissive: 0x000000 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a1410, roughness: 0.2, metalness: 0.1 }),
  plate: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.5 }),
  mixed: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 }),
});

// geometry writer: positions/normals per material, smooth normals computed later
class Parts {
  constructor() { this.p = {}; }
  buf(name) { return this.p[name] || (this.p[name] = { pos: [], idx: [] }); }
  tri(name, a, b, c) {
    const B = this.buf(name), o = B.pos.length / 3;
    B.pos.push(...a, ...b, ...c); B.idx.push(o, o + 1, o + 2);
  }
  quad(name, a, b, c, d) { this.tri(name, a, b, c); this.tri(name, a, c, d); }
  geometries() {
    const out = {};
    for (const [k, B] of Object.entries(this.p)) {
      let g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.setIndex(B.idx);
      g = mergeVerts(g);
      g.computeVertexNormals();
      out[k] = g;
    }
    return out;
  }
}
// weld identical positions so the loft shades smooth
function mergeVerts(g) {
  const pos = g.attributes.position.array, map = new Map(), np = [], remap = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const key = `${pos[i * 3].toFixed(4)},${pos[i * 3 + 1].toFixed(4)},${pos[i * 3 + 2].toFixed(4)}`;
    let j = map.get(key);
    if (j === undefined) { j = np.length / 3; map.set(key, j); np.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    remap.push(j);
  }
  const idx = g.index.array, ni = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = remap[idx[i]], b = remap[idx[i + 1]], c = remap[idx[i + 2]];
    if (a !== b && b !== c && a !== c) ni.push(a, b, c);
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
  o.setIndex(ni);
  return o;
}

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function buildStyle(S) {
  const P = new Parts();
  const L = S.L, hwMax = S.W / 2, G = S.glass;
  const NS = 40;                     // stations along the length
  const clear = 0.17;                // sill height off the road
  // profile at s (0 rear .. 1 front)
  const prof = (s) => {
    const zz = (s - 0.5) * 2;
    // plan view: rounded at both ends
    const hw = hwMax * (1 - 0.1 * Math.pow(Math.abs(zz), 6)) * (s < 0.03 || s > 0.97 ? 0.94 : 1);
    // sill, lifted over each wheel (the arch)
    let yb = clear;
    for (const a of S.axles) {
      const d = Math.abs(s - a) * L;
      const R = S.wheelR + 0.06;
      if (d < R) yb = Math.max(yb, S.wheelR + Math.sqrt(R * R - d * d) * 0.95 - 0.02);
    }
    // nose and tail roll under
    yb = Math.max(yb, clear + smooth(0.06, 0, s) * 0.18 + smooth(0.94, 1, s) * 0.2);
    const belt = lerp(S.belt[1], S.belt[0], s);
    const deck = lerp(S.deck[1], S.deck[0], s);
    // roof line: rear window, roof, windscreen, bonnet
    let top;
    if (s < G.rearLow) top = lerp(deck * 0.96, deck, s / Math.max(G.rearLow, 1e-3));
    else if (s < G.rearTop) top = lerp(deck, S.roof, smooth(G.rearLow, G.rearTop, s));
    else if (s < G.roofFront) top = S.roof - 0.02 * Math.pow((s - (G.rearTop + G.roofFront) / 2) / (G.roofFront - G.rearTop) * 2, 2);
    else if (s < G.cowl) top = lerp(S.roof, belt + 0.06, smooth(G.roofFront, G.cowl, s));
    else top = lerp(belt + 0.06, deck - 0.1, smooth(G.cowl, 1, s));
    if (S.cargo && s < G.roofFront) top = S.roof;
    const cabin = top > belt + 0.12;
    return { hw, yb, belt, top, cabin };
  };
  // ring of points around a station: [x, y, kind] from the bottom centre
  // round the right side to the top centre (the left side is the mirror)
  const ring = (s) => {
    const { hw, yb, belt, top, cabin } = prof(s);
    const pts = [];
    const r = 0.1;
    pts.push([0, yb + 0.02, 'under'], [hw * 0.82, yb, 'under'], [hw - 0.02, yb + r * 0.5, 'body']);
    pts.push([hw, yb + r * 1.4, 'body'], [hw, (yb + belt) / 2, 'body'], [hw * 0.995, belt - 0.03, 'body']);
    const tum = cabin ? 0.8 : 0.93;
    const yTop = cabin ? top : Math.max(top, belt + 0.02);
    pts.push([hw * 0.985, belt + 0.01, cabin ? 'rail' : 'body']);
    if (cabin) {
      pts.push([hw * lerp(0.985, tum, 0.5), lerp(belt, yTop, 0.5), 'side']);
      pts.push([hw * tum, yTop - 0.07, 'side']);
      pts.push([hw * tum * 0.94, yTop - 0.02, 'rail']);
      pts.push([hw * tum * 0.6, yTop, 'top'], [0, yTop + 0.012, 'top']);
    } else {
      pts.push([hw * 0.9, yTop - 0.015, 'top'], [hw * 0.55, yTop, 'top'], [0, yTop + 0.01, 'top']);
    }
    return { pts, cabin, s };
  };
  const z = (s) => (s - 0.5) * L;
  const rings = [];
  for (let i = 0; i <= NS; i++) rings.push(ring(i / NS));
  // the material of a strip between two ring points at stations a, b
  const matOf = (k0, k1, A, B) => {
    const k = k0 === 'top' && k1 === 'top' ? 'top' : (k0 === 'side' || k1 === 'side') && k0 !== 'rail' && k1 !== 'rail' ? 'side' : k0 === 'under' && k1 === 'under' ? 'under' : 'body';
    const sm = (A.s + B.s) / 2;
    if (k === 'under') return 'trim';
    if (k === 'top') {
      // rear window and windscreen are glass; roof is paint
      if (!A.cabin || !B.cabin) return 'paint';
      if (sm < G.rearTop || sm > G.roofFront) return 'glass';
      return 'paint';
    }
    if (k === 'side') {
      if (!A.cabin || !B.cabin) return 'paint';
      for (const pl of S.pillars) if (Math.abs(sm - pl) < 0.018) return 'paint';
      if (sm < G.rearLow + 0.015 || sm > G.cowl - 0.01) return 'paint';
      if (S.cargo && sm < S.pillars[0] - 0.02) return 'paint';
      return 'glass';
    }
    return 'paint';
  };
  for (let i = 0; i < NS; i++) {
    const A = rings[i], B = rings[i + 1];
    const n = Math.min(A.pts.length, B.pts.length);
    const ptsA = A.pts.length === n ? A.pts : resample(A.pts, n), ptsB = B.pts.length === n ? B.pts : resample(B.pts, n);
    for (let j = 0; j < n - 1; j++) {
      const m = matOf(ptsA[j][2], ptsA[j + 1][2], A, B);
      for (const side of [1, -1]) {
        const a = [side * ptsA[j][0], ptsA[j][1], z(A.s)], b = [side * ptsA[j + 1][0], ptsA[j + 1][1], z(A.s)];
        const c = [side * ptsB[j + 1][0], ptsB[j + 1][1], z(B.s)], d = [side * ptsB[j][0], ptsB[j][1], z(B.s)];
        // outward winding: up the ring then forward is counter-clockwise from outside on the right
        if (side > 0) P.quad(m, a, b, c, d); else P.quad(m, a, d, c, b);
      }
    }
  }
  // end caps: nose and tail, fanned from the centre line
  for (const [R, face] of [[rings[0], -1], [rings[NS], 1]]) {
    const zc = z(R.s) + face * 0.01;
    const cy = R.pts.reduce((a, p) => a + p[1], 0) / R.pts.length;
    for (let j = 0; j < R.pts.length - 1; j++) {
      for (const side of [1, -1]) {
        const a = [side * R.pts[j][0], R.pts[j][1], zc], b = [side * R.pts[j + 1][0], R.pts[j + 1][1], zc];
        const c = [0, cy, zc];
        if (side * face > 0) P.tri('paint', a, b, c); else P.tri('paint', a, c, b);
      }
    }
  }
  // bumpers (black lower band), grille, lamps, plates
  const box = (m, cx, cy, cz, sx, sy, sz) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    P.quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    P.quad(m, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    P.quad(m, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    P.quad(m, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    P.quad(m, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
  };
  const f = prof(0.99), r0 = prof(0.01);
  const zf = L / 2, zr = -L / 2;
  box('trim', 0, 0.36, zf - 0.04, f.hw * 1.92, 0.2, 0.14);
  box('trim', 0, 0.37, zr + 0.04, r0.hw * 1.92, 0.22, 0.14);
  box('trim', 0, 0.58, zf + 0.005, f.hw * 0.9, 0.16, 0.03);
  for (const sx of [-1, 1]) {
    box('lamp', sx * f.hw * 0.68, 0.63, zf - 0.01, 0.34, 0.1, 0.05);
    box('tail', sx * r0.hw * 0.72, 0.72, zr + 0.01, 0.28, 0.13, 0.05);
    // mirrors at the foot of the windscreen
    const mz = z(S.glass.cowl - 0.02), mp = prof(S.glass.cowl - 0.02);
    box('paint', sx * (mp.hw + 0.08), mp.belt + 0.1, mz, 0.14, 0.1, 0.06);
  }
  box('plate', 0, 0.37, zf + 0.04, 0.52, 0.11, 0.01);
  box('plate', 0, 0.5, zr - 0.035, 0.52, 0.11, 0.01);
  // a dark cabin so the glass never shows the sky through the car
  box('trim', 0, (S.belt[0] + S.roof) / 2 - 0.05, z((G.rearTop + G.roofFront) / 2), hwMax * 1.5, (S.roof - S.belt[0]) * 0.8, L * (G.cowl - G.rearLow) * 0.9);
  // wheels
  const tyre = lathe([[0.19, -0.1], [0.27, -0.105], [S.wheelR - 0.02, -0.09], [S.wheelR, -0.05], [S.wheelR, 0.05], [S.wheelR - 0.02, 0.09], [0.27, 0.105], [0.19, 0.1]], 20);
  const rim = lathe([[0, 0.085], [0.12, 0.08], [0.19, 0.06], [0.2, 0.0]], 20);
  const geos = P.geometries();
  const wheelGeo = { tyre: [], rim: [] };
  for (const a of S.axles) {
    for (const sx of [-1, 1]) {
      const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(sx * (hwMax - 0.12), S.wheelR, z(a)));
      if (sx > 0) m.multiply(new THREE.Matrix4().makeRotationX(Math.PI));
      wheelGeo.tyre.push(tyre.clone().applyMatrix4(m));
      const rg = rim.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0)).applyMatrix4(m);
      wheelGeo.rim.push(rg);
    }
  }
  return { geos, wheelGeo };
}

// resample a ring to n points (rings differ in length where the cabin starts)
function resample(pts, n) {
  if (pts.length === n) return pts;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (pts.length - 1), i0 = Math.floor(t), i1 = Math.min(pts.length - 1, i0 + 1), f = t - i0;
    out.push([lerp(pts[i0][0], pts[i1][0], f), lerp(pts[i0][1], pts[i1][1], f), f < 0.5 ? pts[i0][2] : pts[i1][2]]);
  }
  return out;
}

// a solid of revolution about Y from [radius, y] points, closed at the ends
function lathe(profile, seg) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.computeVertexNormals();
  return g;
}

function mergeList(list) {
  if (!list.length) return null;
  const clean = list.map((g) => {
    const o = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal') o.deleteAttribute(k);
    return o;
  });
  let n = 0;
  for (const g of clean) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of clean) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// position, normal and colour of several geometries in one
function mergeColoured(list) {
  const clean = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of clean) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of clean) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

export const CAR_KINDS = [];
let built = false;
export function registerCars() {
  if (built) return;
  built = true;
  const M = MATS();
  for (const [name, S] of Object.entries(STYLES)) {
    const { geos, wheelGeo } = buildStyle(S);
    // paint (per-car colour), glass and chrome keep their own materials; trim,
    // lamps, tail lights, plates and tyres share one vertex-coloured material:
    // 4 draws a style instead of 8, in every pass
    const parts = [], mixed = [];
    const tint = (g, m) => {
      if (!g) return;
      const c = m.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      mixed.push(g);
    };
    for (const [k, g] of Object.entries(geos)) {
      if (k === 'paint' || k === 'glass' || k === 'chrome') parts.push({ geometry: g, material: M[k], matrix: new THREE.Matrix4(), paint: k === 'paint' });
      else tint(g, M[k]);
    }
    tint(mergeList(wheelGeo.tyre), M.tyre);
    parts.push({ geometry: mergeList(wheelGeo.rim), material: M.chrome, matrix: new THREE.Matrix4() });
    if (mixed.length) parts.push({ geometry: mergeColoured(mixed), material: M.mixed, matrix: new THREE.Matrix4() });
    registerKind('car_' + name, { parts, size: new THREE.Vector3(S.W, S.roof, S.L), shadow: true });
    CAR_KINDS.push('car_' + name);
  }
  // police light bar, set on a saloon roof
  const bar = (w, h, d, x) => new THREE.BoxGeometry(w, h, d).translate(x, h / 2, 0);
  registerKind('lightbar', {
    parts: [
      { geometry: bar(1.1, 0.05, 0.26, 0), material: M.trim, matrix: new THREE.Matrix4() },
      { geometry: bar(0.5, 0.11, 0.22, -0.27).translate(0, 0.05, 0), material: new THREE.MeshStandardMaterial({ color: 0x1a3cff, emissive: 0x0a1a80, roughness: 0.2 }), matrix: new THREE.Matrix4() },
      { geometry: bar(0.5, 0.11, 0.22, 0.27).translate(0, 0.05, 0), material: new THREE.MeshStandardMaterial({ color: 0xff2414, emissive: 0x801008, roughness: 0.2 }), matrix: new THREE.Matrix4() },
    ],
    size: new THREE.Vector3(1.1, 0.16, 0.26), shadow: false,
  });
}
