import { FACADE, FACADE_TILE, tile } from './texgen.js';

// Street furniture, vehicles and vegetation.
//
// Static props are merged straight into their chunk's buffers -- a bench, a
// lamp or a parked car adds triangles but never a draw call. Each emitter
// takes the chunk buffers (P), a collider sink (solid) and a world position,
// and writes vertex-coloured geometry.
//
// Where a scanned model exists (models.js KINDS) the emitter also records a
// placement with P.place, and writes its own geometry into P.props instead:
// a stand-in that shows until the models load, and stays if they cannot.

const METAL = [0.30, 0.31, 0.32];
const DARKMETAL = [0.16, 0.16, 0.17];
const CONC = [0.62, 0.61, 0.58];
const WOOD = [0.45, 0.33, 0.22];
const GLASS = [0.10, 0.13, 0.15];
const R = (cs, sn) => ({ cs, sn });
const SB = (P) => P.props || P.trim;
const place = (P, kind, x, y, z, rot, s) => { if (P.place) P.place(kind, x, y, z, rot || 0, s || 1); };
// deterministic per-position choice, so a rebuild gives the same street
const pickAt = (x, z, list) => list[Math.abs(Math.floor(x * 7.31 + z * 3.17)) % list.length];

function rotBox(buf, x, y, z, sx, sy, sz, rot, col, lx = 0, lz = 0) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  buf.box(x + lx * cs + lz * sn, y, z - lx * sn + lz * cs, sx, sy, sz, cs, sn, col);
}

function cyl(buf, x, y0, z, r, h, seg, col, cap) {
  buf.cylinder(x, y0, z, r, h, seg, col, cap || 0);
}

// A cast-iron lantern post (5.6 m). The light sits in the lantern.
export function lamp(P, solid, x, y, z, rot, lamps) {
  const B = SB(P);
  cyl(B, x, y, z, 0.16, 0.7, 8, DARKMETAL, 0.06);
  cyl(B, x, y + 0.7, z, 0.07, 4.3, 8, DARKMETAL);
  rotBox(B, x, y + 5.0, z, 0.34, 0.55, 0.34, rot, [0.1, 0.1, 0.11]);
  place(P, 'lampPost', x, y, z, rot);
  lamps.push({ x, y: y + 4.98, z, kind: 'street', head: [0.2, 0.32, 0.2] });
  solid(x - 0.16, z - 0.16, x + 0.16, z + 0.16, y - 0.5, y + 5.6, 'metal');
}

export function bench(P, solid, x, y, z, rot, kind) {
  const B = SB(P);
  rotBox(B, x, y + 0.45, z, 1.8, 0.06, 0.45, rot, WOOD);
  rotBox(B, x, y + 0.75, z, 1.8, 0.4, 0.05, rot, WOOD, 0, -0.22);
  for (const e of [-0.8, 0.8]) rotBox(B, x, y + 0.22, z, 0.06, 0.45, 0.45, rot, DARKMETAL, e, 0);
  place(P, kind || 'bench', x, y, z, rot, kind === 'seating' ? 1 : 1.3);
  solid(x - 0.9, z - 0.9, x + 0.9, z + 0.9, y - 0.5, y + 0.5, 'wood');
}

export function bin(P, solid, x, y, z) {
  const B = SB(P);
  cyl(B, x, y, z, 0.28, 0.9, 10, [0.18, 0.24, 0.2]);
  cyl(B, x, y + 0.9, z, 0.31, 0.08, 10, DARKMETAL);
  place(P, pickAt(x, z, ['bin', 'bin', 'binRust']), x, y, z, (x * 13.7 + z) % 6.28);
  solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3, y - 0.5, y + 0.98, 'metal');
}

export function hydrant(P, solid, x, y, z) {
  const B = SB(P);
  cyl(B, x, y, z, 0.13, 0.62, 10, [0.68, 0.16, 0.12], 0.12);
  B.box(x, y + 0.42, z, 0.42, 0.1, 0.1, 1, 0, [0.68, 0.16, 0.12]);
  place(P, pickAt(x, z, ['hydrant', 'hydrantOld']), x, y, z, (x * 5.1 + z * 2.3) % 6.28);
  solid(x - 0.15, z - 0.15, x + 0.15, z + 0.15, y - 0.5, y + 0.74, 'metal');
}

export function postBox(P, solid, x, y, z, rot) {
  cyl(P.trim, x, y, z, 0.26, 1.35, 10, [0.66, 0.1, 0.08], 0.18);
  rotBox(P.trim, x, y + 1.05, z, 0.28, 0.05, 0.08, rot, DARKMETAL, 0, 0.24);
  solid(x - 0.26, z - 0.26, x + 0.26, z + 0.26, y - 0.5, y + 1.5, 'metal');
}

export function bollard(P, solid, x, y, z) {
  cyl(P.trim, x, y, z, 0.1, 0.9, 6, DARKMETAL, 0.06);
  solid(x - 0.1, z - 0.1, x + 0.1, z + 0.1, y - 0.5, y + 0.95, 'metal');
}

// Telegraph pole: one of the three scanned pole rigs (8.4 m), wires at the top.
export function pole(P, solid, x, y, z) {
  const B = SB(P);
  cyl(B, x, y, z, 0.13, 8.4, 8, [0.32, 0.25, 0.18]);
  B.box(x, y + 7.9, z, 1.6, 0.1, 0.12, 1, 0, [0.32, 0.25, 0.18]);
  place(P, pickAt(x, z, ['pole2', 'pole2', 'pole1', 'pole3']), x, y, z, 0);
  solid(x - 0.14, z - 0.14, x + 0.14, z + 0.14, y - 0.5, y + 8.4, 'wood');
  return [x, y + 8.08, z];
}

export function trafficLight(P, solid, x, y, z, rot, glows) {
  cyl(P.trim, x, y, z, 0.08, 3.2, 6, DARKMETAL);
  rotBox(P.trim, x, y + 3.6, z, 0.34, 0.95, 0.28, rot, [0.12, 0.12, 0.12]);
  const cs = Math.cos(rot), sn = Math.sin(rot);
  glows.push({ x: x + 0.16 * sn, y: y + 3.6, z: z + 0.16 * cs, colour: 0xffaa22, blink: 1.0 });
  solid(x - 0.1, z - 0.1, x + 0.1, z + 0.1, y - 0.5, y + 4.1, 'metal');
}

export function roadSign(P, solid, x, y, z, rot, kind) {
  cyl(P.trim, x, y, z, 0.04, 2.3, 5, METAL);
  if (kind === 'stop') {
    rotBox(P.trim, x, y + 2.3, z, 0.7, 0.7, 0.04, rot, [0.7, 0.1, 0.08]);
    rotBox(P.trim, x, y + 2.3, z, 0.5, 0.12, 0.05, rot, [0.92, 0.9, 0.86]);
  } else {
    rotBox(P.trim, x, y + 2.3, z, 0.6, 0.6, 0.04, rot, [0.9, 0.9, 0.88]);
    rotBox(P.trim, x, y + 2.3, z, 0.5, 0.5, 0.05, rot, [0.75, 0.12, 0.1]);
    rotBox(P.trim, x, y + 2.3, z, 0.38, 0.38, 0.06, rot, [0.92, 0.92, 0.9]);
  }
  solid(x - 0.06, z - 0.06, x + 0.06, z + 0.06, y - 0.5, y + 2.6, 'metal');
}

// A parked car. In the town it is one of the generated bodies (cars.js):
// style picked from the position, paint per car, police cars get a light
// bar. Written as boxes only into a private buffer (the fuel-leak car in
// townlife, which can explode) or where no placement sink exists.
const CAR_STYLES = ['car_hatch', 'car_sedan', 'car_hatch', 'car_estate', 'car_sedan', 'car_van'];
export function car(P, solid, x, y, z, rot, col, opts = {}) {
  if (!opts.buf && P.place) {
    const style = opts.police ? 'car_sedan' : pickAt(x, z, CAR_STYLES);
    P.place(style, x, y + (opts.tilt || 0), z, rot, 1, 1, col);
    if (opts.police) P.place('lightbar', x, y + 1.42, z, rot);
    const L = style === 'car_van' ? 5.0 : style === 'car_hatch' ? 4.1 : 4.6, Wd = style === 'car_van' ? 1.95 : 1.8;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const ex = Math.abs(cs) * Wd / 2 + Math.abs(sn) * L / 2, ez = Math.abs(sn) * Wd / 2 + Math.abs(cs) * L / 2;
    solid(x - ex, z - ez, x + ex, z + ez, y - 0.5, y + (style === 'car_van' ? 2.0 : 1.4), 'car', opts.ref);
    return;
  }
  const buf = opts.buf || P.trim;
  const L = opts.len || 4.3, Wd = 1.8;
  const tilt = opts.tilt || 0;
  const yy = y + tilt;
  rotBox(buf, x, yy + 0.55, z, Wd, 0.55, L, rot, col);
  rotBox(buf, x, yy + 0.3, z, Wd + 0.04, 0.12, L - 0.3, rot, DARKMETAL);
  // cabin: glass band and roof
  rotBox(buf, x, yy + 1.06, z, Wd - 0.12, 0.46, L * 0.48, rot, GLASS, 0, -0.1);
  rotBox(buf, x, yy + 1.32, z, Wd - 0.18, 0.08, L * 0.42, rot, col, 0, -0.12);
  for (const pillar of [-1, 1]) rotBox(buf, x, yy + 1.06, z, Wd - 0.08, 0.46, 0.08, rot, col, 0, -0.1 + pillar * L * 0.24);
  // bonnet and boot shoulders
  rotBox(buf, x, yy + 0.86, z, Wd - 0.06, 0.08, L * 0.28, rot, col, 0, L * 0.34);
  // lights
  rotBox(buf, x, yy + 0.66, z, 0.3, 0.12, 0.04, rot, [0.92, 0.9, 0.82], -0.62, L / 2);
  rotBox(buf, x, yy + 0.66, z, 0.3, 0.12, 0.04, rot, [0.92, 0.9, 0.82], 0.62, L / 2);
  rotBox(buf, x, yy + 0.7, z, 0.3, 0.1, 0.04, rot, [0.6, 0.08, 0.06], -0.62, -L / 2);
  rotBox(buf, x, yy + 0.7, z, 0.3, 0.1, 0.04, rot, [0.6, 0.08, 0.06], 0.62, -L / 2);
  // wheels
  const cs = Math.cos(rot), sn = Math.sin(rot);
  for (const [wx, wz] of [[-0.82, L * 0.32], [0.82, L * 0.32], [-0.82, -L * 0.32], [0.82, -L * 0.32]]) {
    const cx = x + wx * cs + wz * sn, cz = z - wx * sn + wz * cs;
    buf.box(cx, yy + 0.33, cz, 0.24, 0.62, 0.62, cs, sn, [0.08, 0.08, 0.08]);
  }
  if (opts.doorOpen) rotBox(buf, x, yy + 0.8, z, 0.06, 0.8, 1.0, rot + 0.9, col, 1.3, 0.3);
  if (opts.police) {
    rotBox(buf, x, yy + 1.42, z, 1.0, 0.12, 0.25, rot, [0.15, 0.2, 0.7], 0, -0.1);
    rotBox(buf, x, yy + 0.6, z, Wd + 0.02, 0.16, L * 0.6, rot, [0.92, 0.92, 0.9]);
  }
  // collider: AABB of the rotated footprint
  const ex = Math.abs(cs) * Wd / 2 + Math.abs(sn) * L / 2, ez = Math.abs(sn) * Wd / 2 + Math.abs(cs) * L / 2;
  solid(x - ex, z - ez, x + ex, z + ez, y - 0.5, y + 1.4, 'car', opts.ref);
}

// Roadblock: two concrete barrier sections end to end (2.5 m).
export function barrier(P, solid, x, y, z, rot) {
  const B = SB(P);
  rotBox(B, x, y + 0.85, z, 2.4, 0.22, 0.08, rot, [0.9, 0.88, 0.84]);
  for (const s of [-0.8, -0.2, 0.4]) rotBox(B, x, y + 0.85, z, 0.3, 0.22, 0.09, rot, [0.75, 0.12, 0.1], s, 0);
  for (const e of [-1.1, 1.1]) rotBox(B, x, y + 0.42, z, 0.06, 0.84, 0.5, rot, METAL, e, 0);
  const bc = Math.cos(rot), bs = Math.sin(rot);
  for (const o of [-0.78, 0.78]) place(P, 'barrier', x + o * bc, y, z - o * bs, rot + (o > 0 ? Math.PI : 0));
  const cs = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
  solid(x - 1.2 * cs - 0.2 * sn, z - 1.2 * sn - 0.2 * cs, x + 1.2 * cs + 0.2 * sn, z + 1.2 * sn + 0.2 * cs, y - 0.5, y + 1.0, 'wood');
}

export function cone(P, x, y, z) {
  cyl(P.trim, x, y, z, 0.18, 0.06, 6, [0.85, 0.35, 0.08], 0.62);
}

export function drum(P, solid, x, y, z, col) {
  cyl(SB(P), x, y, z, 0.3, 0.88, 10, col || [0.2, 0.32, 0.5]);
  place(P, col ? 'barrelB' : 'barrel', x, y, z, (x * 3.3 + z * 7.1) % 6.28);
  solid(x - 0.3, z - 0.3, x + 0.3, z + 0.3, y - 0.5, y + 0.88, 'metal');
}

export function pallets(P, solid, x, y, z, n) {
  for (let i = 0; i < n; i++) P.trim.box(x, y + 0.08 + i * 0.16, z, 1.2, 0.14, 1.0, 1, 0, [0.55, 0.44, 0.3]);
  solid(x - 0.6, z - 0.5, x + 0.6, z + 0.5, y - 0.5, y + n * 0.16, 'wood');
}

export function skip(P, solid, x, y, z, rot) {
  rotBox(P.trim, x, y + 0.6, z, 1.8, 1.2, 3.6, rot, [0.75, 0.55, 0.12]);
  rotBox(P.trim, x, y + 1.15, z, 1.6, 0.1, 3.4, rot, [0.25, 0.22, 0.18]);
  const cs = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
  solid(x - 0.9 * cs - 1.8 * sn, z - 0.9 * sn - 1.8 * cs, x + 0.9 * cs + 1.8 * sn, z + 0.9 * sn + 1.8 * cs, y - 0.5, y + 1.2, 'metal');
}

export function litter(P, x, y, z, r) {
  const s = 0.18 + r() * 0.2, a = r() * Math.PI;
  const c = 0.75 + r() * 0.2;
  const cs = Math.cos(a) * s, sn = Math.sin(a) * s;
  P.trim.quad([x - cs, y + 0.02, z - sn], [x + sn, y + 0.02, z - cs], [x + cs, y + 0.02, z + sn], [x - sn, y + 0.02, z + cs],
    [0, 1, 0], [c, c * 0.98, c * 0.92]);
  // now and then something bigger: a crushed box, a weed, an old tyre
  const k = r();
  if (k < 0.12) place(P, 'box', x + 0.3, y, z, a);
  else if (k < 0.3) place(P, k < 0.21 ? 'weed' : 'weedB', x - 0.2, y, z + 0.1, a);
  else if (k < 0.33) place(P, 'tyre', x + 0.4, y + 0.08, z, a, 1);
}

export function manhole(P, x, y, z) {
  P.trim.box(x, y + 0.075, z, 0.8, 0.02, 0.8, 1, 0, [0.14, 0.14, 0.15]);
}

// A hedge: a dark core so it never shows daylight through, with grown bushes
// (trees.js 'bush') shoulder to shoulder along it for the leafy surface.
export function hedge(P, solid, x1, z1, x2, z2, y, h) {
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const sx = Math.max(0.8, Math.abs(x2 - x1)), sz = Math.max(0.8, Math.abs(z2 - z1));
  P.foliage.B = y;
  P.foliage.box(mx, y + h * 0.42, mz, sx * 0.86, h * 0.84, sz * 0.7, 1, 0, [0.1, 0.16, 0.08]);
  if (P.place) {
    const along = sx > sz, len = along ? sx : sz, n = Math.max(1, Math.round(len / 1.1));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      P.place('bush', along ? mx + t * len : mx, y - 0.05, along ? mz : mz + t * len, (i * 2.39 + mx) % 6.28, (h / 1.7) * (0.95 + ((i * 7) % 3) * 0.05));
    }
  }
  solid(mx - sx / 2, mz - sz / 2, mx + sx / 2, mz + sz / 2, y - 0.5, y + h, 'wood');
}

export function lowWall(P, solid, x1, z1, x2, z2, y, h) {
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const sx = Math.max(0.3, Math.abs(x2 - x1)), sz = Math.max(0.3, Math.abs(z2 - z1));
  P.walls.L = FACADE.brickRed; tile(P.walls, FACADE_TILE, FACADE.brickRed); P.walls.B = y;
  P.walls.box(mx, y + h / 2, mz, sx, h, sz, 1, 0, [0.95, 0.93, 0.9]);
  P.trim.box(mx, y + h + 0.04, mz, sx + 0.06, 0.08, sz + 0.06, 1, 0, [0.7, 0.68, 0.64]);
  solid(mx - sx / 2, mz - sz / 2, mx + sx / 2, mz + sz / 2, y - 0.5, y + h + 0.08, 'masonry');
}

// Trees. Inside the playable area (collide) they are grown trees (trees.js)
// placed as model kinds; the hillside forest beyond stays these cheap cone
// and blob trees, written into the always-visible foliage buffer, where
// `aobase` carries the tree's foot height so the shader sways crowns.
const DECIDUOUS = ['tree_oak', 'tree_ash', 'tree_aspen', 'tree_oak'];
export function tree(P, solid, x, y, z, s, kind, r, collide = true) {
  if (collide && P.place) {
    const k = kind === 'conifer' ? (s < 1.05 ? 'tree_pineS' : 'tree_pine') : pickAt(x, z, DECIDUOUS);
    P.place(k, x, y - 0.05, z, r() * Math.PI * 2, 0.75 + s * 0.3);
    solid(x - 0.25 * s, z - 0.25 * s, x + 0.25 * s, z + 0.25 * s, y - 0.5, y + 3 * s, 'wood');
    return;
  }
  const F = P.foliage;
  F.B = y;
  const trunk = [0.30, 0.23, 0.16];
  if (kind === 'conifer') {
    F.cylinder(x, y, z, 0.18 * s, 2.2 * s, 5, trunk);
    const g = 0.75 + r() * 0.3;
    const col = [0.11 * g, 0.2 * g, 0.12 * g];
    for (let k = 0; k < 3; k++) {
      const yy = y + (1.6 + k * 2.1) * s, rr = (2.1 - k * 0.55) * s;
      F.cylinder(x, yy, z, rr, 0.01, 7, col, (3.2 - k * 0.5) * s);
    }
  } else {
    F.cylinder(x, y, z, 0.16 * s, 3.0 * s, 5, trunk);
    const g = 0.8 + r() * 0.3;
    const col = [0.22 * g, 0.32 * g, 0.14 * g];
    blob(F, x, y + 4.0 * s, z, 2.2 * s, col);
    blob(F, x + 0.9 * s, y + 3.4 * s, z + 0.4 * s, 1.5 * s, [col[0] * 0.9, col[1] * 0.92, col[2] * 0.9]);
  }
  if (collide) solid(x - 0.2 * s, z - 0.2 * s, x + 0.2 * s, z + 0.2 * s, y - 0.5, y + 3 * s, 'wood');
}

// low-poly crown: an octahedron pushed toward a sphere
function blob(F, x, y, z, r, col) {
  const v = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, -1, 0]];
  const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1], [5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]];
  const mid = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; const l = Math.hypot(...m); return [m[0] / l, m[1] / l, m[2] / l]; };
  for (const [a, b, c] of faces) {
    const A = v[a], B = v[b], C = v[c], ab = mid(A, B), bc = mid(B, C), ca = mid(C, A);
    for (const [p, q, s] of [[A, ab, ca], [ab, B, bc], [ca, bc, C], [ab, bc, ca]]) {
      const P2 = (u) => [x + u[0] * r, y + u[1] * r * 0.85, z + u[2] * r];
      const cx = (p[0] + q[0] + s[0]) / 3, cy = (p[1] + q[1] + s[1]) / 3, cz = (p[2] + q[2] + s[2]) / 3;
      const shade = 0.85 + cy * 0.15;
      F.tri(P2(p), P2(q), P2(s), [cx, cy, cz], [col[0] * shade, col[1] * shade, col[2] * shade]);
    }
  }
}

// Rail siding: ballast, sleepers, two rails.
export function rail(P, solid, x, z0, z1, H) {
  for (let z = z0; z < z1; z += 0.75) {
    const y = H(x, z);
    P.trim.box(x, y + 0.1, z, 2.6, 0.12, 0.24, 1, 0, [0.3, 0.24, 0.18]);
  }
  for (const rx of [-0.72, 0.72]) {
    for (let z = z0; z < z1; z += 8) {
      const zz = Math.min(z1, z + 8), y = H(x, (z + zz) / 2);
      P.trim.box(x + rx, y + 0.24, (z + zz) / 2, 0.08, 0.14, zz - z, 1, 0, [0.36, 0.33, 0.3]);
    }
  }
  void solid;
}

export function wagon(P, solid, x, y, z) {
  P.walls.L = FACADE.corrugated; tile(P.walls, FACADE_TILE, FACADE.corrugated); P.walls.B = -1000;
  P.walls.box(x, y + 2.3, z, 2.9, 2.6, 13, 1, 0, [0.55, 0.3, 0.2]);
  P.trim.box(x, y + 0.75, z, 2.6, 0.3, 13.4, 1, 0, DARKMETAL);
  for (const dz of [-4.5, 4.5]) for (const dx of [-0.72, 0.72]) P.trim.box(x + dx, y + 0.5, z + dz, 0.2, 0.8, 0.8, 1, 0, [0.1, 0.1, 0.1]);
  solid(x - 1.45, z - 6.7, x + 1.45, z + 6.7, y - 0.5, y + 3.6, 'metal');
}

export function garage(P, solid, x, y, z, rot, wallC) {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  P.walls.L = FACADE.render; tile(P.walls, FACADE_TILE, FACADE.render); P.walls.B = y;
  P.walls.box(x, y + 1.3, z, 3.4, 2.6, 6, cs, sn, wallC);
  P.trim.box(x, y + 2.65, z, 3.6, 0.12, 6.2, cs, sn, [0.25, 0.25, 0.26]);
  rotBox(P.trim, x, y + 1.05, z, 2.6, 2.1, 0.04, rot, [0.7, 0.7, 0.68], 0, 3.0);
  const ex = Math.abs(cs) * 1.7 + Math.abs(sn) * 3, ez = Math.abs(sn) * 1.7 + Math.abs(cs) * 3;
  solid(x - ex, z - ez, x + ex, z + ez, y - 0.5, y + 2.7, 'masonry');
}

export const COLOURS = {
  car: [[0.55, 0.1, 0.08], [0.12, 0.2, 0.36], [0.62, 0.62, 0.6], [0.16, 0.16, 0.17], [0.85, 0.84, 0.8],
        [0.2, 0.33, 0.24], [0.5, 0.42, 0.25], [0.36, 0.38, 0.4]],
};
export { R, place, pickAt };
