import * as THREE from 'three';

// The land under Meridian Ridge.
//
// The research station sits on a flat shelf cut into the mountainside at y=0,
// exactly where it always has, so nothing inside it moves. South of the shelf
// the ground falls to the town about seven metres below; north of it the
// mountain climbs. Past the playable edge the land rises into peaks that fence
// the town in.
//
// Everything is one analytic height function. The player, the AI, bullets and
// the mesh all read the same numbers, so what you see is what you stand on.

export const PLAY = { minX: -200, maxX: 200, minZ: -80, maxZ: 330 };
// Must sit on the 2.5 m terrain grid: quads wholly inside are not built, the
// station's own asphalt slab covers them.
export const SHELF = { minX: -45, maxX: 45, minZ: -77.5, maxZ: 47.5 };

const INNER = { minX: -250, maxX: 250, minZ: -125, maxZ: 375 };   // fine mesh
const FINE = 2.5;
const COARSE = 25;
const OUTER = 1000;

function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}
function fbm(x, z, oct) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f) * a; f *= 2.03; a *= 0.5; }
  return s;
}
// smooth max(0, t), so slope changes have no crease
function ramp(t, k) {
  if (t <= -k) return 0;
  if (t >= k) return t;
  return (t + k) * (t + k) / (4 * k);
}
const smooth = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

// The valley floor before the shelf is cut into it.
function lowland(x, z) {
  let h = -6.5 + ramp(100 - z, 18) * 0.08 - ramp(z - 100, 18) * 0.01;
  h += (fbm(x / 70 + 11.3, z / 70 - 4.1, 3) - 0.5) * 2.2;
  return h;
}

export function terrainH(x, z) {
  // the shelf: flat at y=0, blending into the valley over 60 m
  const ox = Math.max(SHELF.minX - x, 0, x - SHELF.maxX);
  const oz = Math.max(SHELF.minZ - z, 0, z - SHELF.maxZ);
  const d = Math.hypot(ox, oz);
  let h = d <= 0 ? 0 : lowland(x, z) * smooth(0, 60, d);
  // mountains past the playable edge (starting a little inside it, so the
  // edge reads as rising ground rather than a wall)
  const ex = Math.max(PLAY.minX + 15 - x, 0, x - PLAY.maxX + 15);
  const ez = Math.max(PLAY.minZ + 10 - z, 0, z - PLAY.maxZ + 15);
  const e = Math.hypot(ex, ez);
  if (e > 0) {
    const peaks = fbm(x / 160 + 3.7, z / 160 + 8.2, 4);
    h += e * 0.25 + e * e * 0.0003 + peaks * Math.min(1, e / 120) * 55;
  }
  return h;
}

// Ground colour from height, slope and noise. Vertex colours, one material:
// meadow grass in the valley, dark conifer forest on the lower mountain
// slopes, grey rock on steep faces and high ground, snow on the peaks. Bare
// earth only on a narrow band of banks -- coloured that way across every steep
// slope it turned the mountains into an orange mud wall.
function groundColour(x, z, h, slope, out) {
  const n = fbm(x / 9, z / 9, 3);
  const n2 = fbm(x / 41 + 5, z / 41 - 2, 2);
  let r = 0.27 + n * 0.10 + n2 * 0.06, g = 0.32 + n * 0.10 + n2 * 0.04, b = 0.17 + n * 0.05;
  // forest: patchy, on the slopes above the valley floor
  const forest = smooth(4, 16, h) * (1 - smooth(70, 120, h)) * smooth(0.42, 0.58, n2 + n * 0.25) * (1 - smooth(0.75, 1.0, slope));
  r += (0.13 + n * 0.04 - r) * forest; g += (0.19 + n * 0.05 - g) * forest; b += (0.11 + n * 0.03 - b) * forest;
  const earth = smooth(0.30, 0.45, slope) * (1 - smooth(0.5, 0.7, slope)) * (1 - forest) * 0.6;
  r += (0.38 - r) * earth; g += (0.34 - g) * earth; b += (0.27 - b) * earth;
  const rock = Math.min(1, smooth(0.55, 0.9, slope) + smooth(60, 130, h) * (1 - forest * 0.5));
  const grey = 0.38 + n * 0.12;
  r += (grey - r) * rock; g += (grey * 0.99 - g) * rock; b += (grey * 0.96 - b) * rock;
  const snow = smooth(150, 220, h + n * 30);
  r += (0.88 - r) * snow; g += (0.89 - g) * snow; b += (0.91 - b) * snow;
  out[0] = r; out[1] = g; out[2] = b;
}

function gridMesh(x0, z0, x1, z1, step, keepQuad, edgeLerp) {
  const nx = Math.round((x1 - x0) / step), nz = Math.round((z1 - z0) / step);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const nor = new Float32Array(pos.length);
  const col = new Float32Array(pos.length);
  const c3 = [0, 0, 0];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      let h = edgeLerp ? edgeLerp(x, z) : terrainH(x, z);
      const e = 1.0;
      const hx = terrainH(x + e, z) - terrainH(x - e, z);
      const hz = terrainH(x, z + e) - terrainH(x, z - e);
      const k = (j * (nx + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      const nl = Math.hypot(hx, 2 * e, hz);
      nor[k] = -hx / nl; nor[k + 1] = 2 * e / nl; nor[k + 2] = -hz / nl;
      const slope = Math.hypot(hx, hz) / (2 * e);
      groundColour(x, z, h, slope, c3);
      // sRGB in, linear out (three.js treats vertex colours as linear)
      col[k] = Math.pow(c3[0], 2.2); col[k + 1] = Math.pow(c3[1], 2.2); col[k + 2] = Math.pow(c3[2], 2.2);
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const qx = x0 + (i + 0.5) * step, qz = z0 + (j + 0.5) * step;
      if (keepQuad && !keepQuad(qx, qz)) continue;
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

// Heights on the fine mesh's outer border are taken from the coarse mesh's
// straight edges, so the two meet without cracks.
function seamH(x, z) {
  const onX = Math.abs(x - INNER.minX) < 1e-6 || Math.abs(x - INNER.maxX) < 1e-6;
  const onZ = Math.abs(z - INNER.minZ) < 1e-6 || Math.abs(z - INNER.maxZ) < 1e-6;
  if (!onX && !onZ) return terrainH(x, z);
  if (onX && onZ) return terrainH(x, z);
  if (onX) {
    const z0 = Math.floor(z / COARSE) * COARSE, t = (z - z0) / COARSE;
    return terrainH(x, z0) * (1 - t) + terrainH(x, z0 + COARSE) * t;
  }
  const x0 = Math.floor(x / COARSE) * COARSE, t = (x - x0) / COARSE;
  return terrainH(x0, z) * (1 - t) + terrainH(x0 + COARSE, z) * t;
}

export function buildTerrain(scene) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 });
  const tiles = [];
  const T = 125;
  const inShelf = (x, z) => x > SHELF.minX && x < SHELF.maxX && z > SHELF.minZ && z < SHELF.maxZ;
  for (let x = INNER.minX; x < INNER.maxX; x += T) {
    for (let z = INNER.minZ; z < INNER.maxZ; z += T) {
      const geo = gridMesh(x, z, x + T, z + T, FINE, (qx, qz) => !inShelf(qx, qz), seamH);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      m.name = 'terrain';
      scene.add(m);
      tiles.push(m);
    }
  }
  const outerGeo = gridMesh(-OUTER, -OUTER + 125, OUTER, OUTER + 125, COARSE,
    (qx, qz) => !(qx > INNER.minX && qx < INNER.maxX && qz > INNER.minZ && qz < INNER.maxZ));
  const outer = new THREE.Mesh(outerGeo, mat);
  outer.name = 'mountains';
  scene.add(outer);
  return { tiles, outer, material: mat };
}
