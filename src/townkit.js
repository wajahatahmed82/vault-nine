import { FACADE, FACADE_TILE, ROOF_TILE, SIGN_COLS, SIGN_ROWS, tile } from './texgen.js';
import { decalUV, DECAL } from './towndecals.js';
import { terrainH } from './terrain.js';

// deterministic 0..1 from a building and a position on it
const hash = (b, u, y) => { const h = Math.sin(b.x * 12.9898 + b.z * 78.233 + u * 37.719 + y * 11.13) * 43758.5453; return h - Math.floor(h); };

// The modular building kit.
//
// A building record (town.js `building()`) is turned into geometry here from a
// fixed set of parts: wall shell, plinth, string courses, cornice, quoins,
// window bays (reveal + glass with a fake room behind + frame + sash rail +
// sill + lintel), shopfronts (stall riser, glazing, mullions, fascia, sign,
// awning), doors with frames, porches, roofs with gutters, chimneys with pots.
// The same record is the far LOD: a plain shell whose texture is a window
// pattern, so distant buildings still read as buildings with windows.
//
// Enterable buildings swap the shell for real wall pieces with openings, a
// floor, a ceiling, partitions and furniture (see emitEnterable).

const TRIM = [0.84, 0.82, 0.77];
const STONE = [0.74, 0.71, 0.66];
const DARK = [0.16, 0.15, 0.14];
const DOOR_COLS = [[0.20, 0.27, 0.22], [0.36, 0.16, 0.14], [0.17, 0.22, 0.32], [0.28, 0.22, 0.16], [0.12, 0.12, 0.13]];
const AWNING = [[[0.55, 0.14, 0.12], [0.88, 0.86, 0.80]], [[0.16, 0.30, 0.20], [0.86, 0.84, 0.76]], [[0.18, 0.26, 0.42], [0.86, 0.85, 0.80]], [[0.42, 0.32, 0.16], [0.86, 0.80, 0.66]]];

let WIN_ID = 1;

// Local frame helpers bound to one building.
function frame(b) {
  const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
  const W = (lx, ly, lz) => [b.x + lx * cs + lz * sn, ly, b.z - lx * sn + lz * cs];
  const box = (buf, lx, ly, lz, sx, sy, sz, col, bottom) => {
    const [x, , z] = W(lx, 0, lz);
    buf.box(x, ly, z, sx, sy, sz, cs, sn, col, bottom);
  };
  const faces = [
    { n: [0, 1], t: [1, 0], len: b.w, off: b.d / 2, front: true, key: 'f' },
    { n: [0, -1], t: [-1, 0], len: b.w, off: b.d / 2, back: true, key: 'b' },
    { n: [1, 0], t: [0, -1], len: b.d, off: b.w / 2, side: true, key: 'r' },
    { n: [-1, 0], t: [0, 1], len: b.d, off: b.w / 2, side: true, key: 'l' },
  ];
  const fpos = (f, u, o) => [f.n[0] * (f.off + o) + f.t[0] * u, f.n[1] * (f.off + o) + f.t[1] * u];
  const fbox = (buf, f, u, y, o, su, sy, so, col, bottom) => {
    const [lx, lz] = fpos(f, u, o);
    const alongX = f.n[1] !== 0;
    box(buf, lx, y, lz, alongX ? su : so, sy, alongX ? so : su, col, bottom);
  };
  const outward = (f) => { const p = W(f.n[0], 0, f.n[1]); return [p[0] - b.x, 0, p[2] - b.z]; };
  const fquad = (buf, f, u, y, o, su, sy, col, uvs) => {
    const [ax, az] = fpos(f, u - su / 2, o), [bx, bz] = fpos(f, u + su / 2, o);
    buf.quad(W(ax, y - sy / 2, az), W(bx, y - sy / 2, bz), W(bx, y + sy / 2, bz), W(ax, y + sy / 2, az),
      outward(f), col, uvs || [0, 0, su, 0, su, sy, 0, sy]);
  };
  return { W, box, faces, fpos, fbox, fquad, outward, cs, sn };
}

const setTile = (buf, layer, tiles) => { buf.L = layer; tile(buf, tiles, layer); };

// One window bay: wall-coloured reveal standing proud so the glass reads as
// set back, the glass with its room, a painted frame, a sash rail, a stone
// sill and a lintel.
function windowBay(K, N, f, u, y, ww, wh, b, opts = {}) {
  const { fbox, fquad } = K;
  const rv = 0.11;
  // reveal
  setTile(N.walls, b.mat, FACADE_TILE); N.walls.B = b.base;
  fbox(N.walls, f, u, y + wh / 2 + 0.09, rv / 2, ww + 0.36, 0.18, rv, b.wallC);
  fbox(N.walls, f, u - ww / 2 - 0.09, y, rv / 2, 0.18, wh, rv, b.wallC);
  fbox(N.walls, f, u + ww / 2 + 0.09, y, rv / 2, 0.18, wh, rv, b.wallC);
  // glass: uv 0..1 across the pane for the interior shader
  N.glass.W = opts.shop ? -(WIN_ID++) : WIN_ID++;
  fquad(N.glass, f, u, y, 0.015, ww, wh, [1, 1, 1], [0, 0, 1, 0, 1, 1, 0, 1]);
  // frame, sash rail, mullion
  const fc = b.frameC || TRIM, ft = 0.06;
  fbox(N.trim, f, u, y + wh / 2 - ft / 2, 0.03, ww, ft, 0.06, fc);
  fbox(N.trim, f, u, y - wh / 2 + ft / 2, 0.03, ww, ft, 0.06, fc);
  fbox(N.trim, f, u - ww / 2 + ft / 2, y, 0.03, ft, wh, 0.06, fc);
  fbox(N.trim, f, u + ww / 2 - ft / 2, y, 0.03, ft, wh, 0.06, fc);
  if (!opts.shop) {
    fbox(N.trim, f, u, y + (opts.sashY ?? 0.08), 0.035, ww, 0.05, 0.07, fc);
    if (ww > 1.0) fbox(N.trim, f, u, y, 0.03, 0.04, wh, 0.05, fc);
  }
  // sill and lintel
  fbox(N.trim, f, u, y - wh / 2 - 0.05, 0.13, ww + 0.3, 0.09, 0.2, STONE);
  if (b.lintel) fbox(N.trim, f, u, y + wh / 2 + 0.24, 0.13, ww + 0.34, 0.18, 0.04, STONE);
  // rain off the sill streaks the wall below it
  if (N.decal && hash(b, u, y) < 0.55) {
    const gh = 0.6 + hash(b, y, u) * 0.8;
    N.decal.su = N.decal.sv = 1;
    fquad(N.decal, f, u, y - wh / 2 - 0.1 - gh / 2, 0.012, ww + 0.2, gh, [0.85, 0.85, 0.85], decalUV(hash(b, u, 1) < 0.5 ? DECAL.grime : DECAL.grimeB));
  }
  b.windows.push({ f: f.key, u, y, w: ww, h: wh });
}

function door(K, N, f, u, y0, b, wide) {
  const { fbox, fquad } = K;
  const dw = wide ? 1.8 : 1.0, dh = 2.15;
  const dc = b.doorC;
  setTile(N.walls, b.mat, FACADE_TILE); N.walls.B = b.base;
  fbox(N.walls, f, u, y0 + dh + 0.1, 0.06, dw + 0.36, 0.2, 0.12, b.wallC);
  fquad(N.trim, f, u, y0 + dh / 2, 0.02, dw, dh, dc);
  fbox(N.trim, f, u - dw / 2 - 0.04, y0 + dh / 2, 0.04, 0.08, dh, 0.08, TRIM);
  fbox(N.trim, f, u + dw / 2 + 0.04, y0 + dh / 2, 0.04, 0.08, dh, 0.08, TRIM);
  fbox(N.trim, f, u, y0 + dh + 0.04, 0.04, dw + 0.16, 0.08, 0.08, TRIM);
  if (!wide) {
    fquad(N.glass, f, u, y0 + dh - 0.32, 0.03, dw * 0.6, 0.35, [1, 1, 1], [0, 0, 1, 0, 1, 1, 0, 1]);
    fbox(N.trim, f, u + dw * 0.32, y0 + 1.0, 0.06, 0.05, 0.05, 0.08, [0.75, 0.62, 0.3]);   // handle
  }
  fbox(N.trim, f, u, y0 - 0.06, 0.25, dw + 0.5, 0.12, 0.5, STONE);   // step
}

// ------------------------------------------------------------- shell/roof --

export function emitBuilding(b, N, F, signs) {
  const K = frame(b);
  const { box, faces, fbox } = K;
  const { w, d, base, foot, H } = b;
  const top = base + H;
  b.windows = [];

  // ---- far shell: window-pattern facade, one bay per 2.7 m x storey ----
  if (F) {
    const i = 0.15;
    F.walls.L = FACADE.farWindows; F.walls.su = 1 / 2.7; F.walls.sv = 1 / b.sh; F.walls.B = base;
    const farCol = b.kind === 'warehouse' ? b.wallC : b.wallC.map((c) => c * 0.95);
    if (b.kind === 'warehouse') setTile(F.walls, b.mat, FACADE_TILE);
    box(F.walls, 0, (base + top) / 2, 0, w - 2 * i, top - base, d - 2 * i, farCol);
    setTile(F.walls, FACADE.stone, FACADE_TILE);
    box(F.walls, 0, (foot + base) / 2, 0, w - 2 * i, base - foot, d - 2 * i, [0.6, 0.58, 0.55]);
    setTile(F.walls, b.mat, FACADE_TILE);
    emitRoof(b, F.walls, F.roof, K, i, true, null);
  }
  if (!N) return;
  if (b.enter) { emitEnterable(b, N, K, signs); return; }

  // ---- walls ----
  setTile(N.walls, b.mat, FACADE_TILE); N.walls.B = base;
  box(N.walls, 0, (base + top) / 2, 0, w, top - base, d, b.wallC);
  setTile(N.walls, FACADE.stone, FACADE_TILE);
  box(N.walls, 0, (foot + base + 0.5) / 2, 0, w + 0.1, base + 0.5 - foot, d + 0.1, [0.62, 0.6, 0.56]);
  for (let s = 1; s < b.storeys; s++) box(N.trim, 0, base + s * b.sh, 0, w + 0.12, 0.16, d + 0.12, TRIM);
  if (b.quoins) {
    for (const [qx, qz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (let y = base + 0.5, k = 0; y < top - 0.3; y += 0.6, k++) {
        const big = k % 2 === 0;
        box(N.trim, qx * (w / 2 - (big ? 0.2 : 0.14)), y + 0.27, qz * (d / 2 + 0.02), big ? 0.44 : 0.3, 0.54, 0.06, STONE);
        box(N.trim, qx * (w / 2 + 0.02), y + 0.27, qz * (d / 2 - (big ? 0.14 : 0.2)), 0.06, 0.54, big ? 0.3 : 0.44, STONE);
      }
    }
  }

  // ---- façades ----
  for (const f of faces) {
    if (f.side && b.party) continue;
    if (b.kind === 'warehouse') { warehouseFace(K, N, f, b); wallMarks(K, N, f, b, true); wallKit(K, N, f, b); continue; }
    const sp = b.kind === 'house' || b.kind === 'terrace' ? 3.0 : 2.7;
    const n = Math.max(f.len > 4 ? 1 : 0, Math.floor((f.len - 1.4) / sp));
    downpipes(K, N, f, b);
    wallKit(K, N, f, b);
    if (!n) { wallMarks(K, N, f, b, false); continue; }
    const step = f.len / n;
    for (let s = 0; s < b.storeys; s++) {
      const sy = base + s * b.sh;
      if (s === 0 && f.front && b.shop) { shopfront(K, N, f, b, sy, signs); continue; }
      for (let k = 0; k < n; k++) {
        const u = -f.len / 2 + (k + 0.5) * step;
        if (s === 0 && f.front && k === Math.floor(n / 2)) {
          door(K, N, f, u, sy, b, false);
          if (b.porch) porch(K, N, f, u, sy, b);
          continue;
        }
        const tall = b.kind === 'civic' ? 2.3 : 1.45;
        const ww = b.kind === 'civic' ? 1.3 : 1.1;
        windowBay(K, N, f, u, sy + 0.95 + tall / 2, ww, tall, b);
        if (s >= 1 && f.front && b.storeys >= 3 && b.kind !== 'house' && hash(b, u, s) < 0.35) balcony(K, N, f, u, sy, ww, b);
      }
    }
  }

  emitRoof(b, N.walls, N.roof, K, 0, false, N.trim);
  if (b.chimney) chimney(K, N, b);
  if (b.tag === 'clocktower') clockFaces(K, N, b);
  void fbox;
}

// Downpipes from the gutter to the ground at both ends of the long faces, on
// brackets, with a shoe at the foot.
// The pipes are the CC0 gutter kit (models.js downpipe, hopper, shoe); the
// box pipe stands in until they arrive.
function downpipes(K, N, f, b) {
  if (f.side || !N.trim) return;
  const { fbox } = K, top = b.base + b.H, y0 = b.foot;
  const col = hash(b, 1, 2) < 0.5 ? [0.16, 0.16, 0.17] : [0.72, 0.72, 0.7];
  for (const end of [-1, 1]) {
    if (hash(b, end, f.n[0] + f.n[1] * 2) < 0.35) continue;
    const u = end * (f.len / 2 - 0.22);
    for (let y = y0 + 1.2; y < top - 0.4; y += 1.8) fbox(N.trim, f, u, y, 0.06, 0.12, 0.04, 0.12, col);
    const [x, , z] = K.W(...(([lx, lz]) => [lx, 0, lz])(K.fpos(f, u, 0.1)));
    if (b.place && N.props) {
      const g = Math.max(y0 + 0.4, terrainH(x, z) + 0.15), rot = faceRot(b, f);
      fbox(N.props, f, u, (g + top) / 2, 0.09, 0.08, top - g - 0.1, 0.08, col);
      b.place('pipeOutlet', x, g, z, rot, 1);
      b.place('downpipe', x, g + 0.38, z, rot, 1, Math.max(0.5, top - 0.75 - g));
      b.place('pipeFunnel', x, top - 0.38, z, rot, 1);
    } else {
      fbox(N.trim, f, u, (y0 + top) / 2, 0.09, 0.08, top - y0 - 0.1, 0.08, col);
      fbox(N.trim, f, u, y0 + 0.12, 0.16, 0.1, 0.1, 0.22, col);
    }
  }
}

// world yaw that turns a model's front (+Z) out of face f
const faceRot = (b, f) => b.rot + Math.atan2(f.n[0], f.n[1]);
const faceAt = (K, f, u, o) => { const [lx, lz] = K.fpos(f, u, o); return K.W(lx, 0, lz); };

// Services on the walls: air-con units at the back of shops and terraces,
// floodlights over warehouse doors, fire escapes on tall shop backs.
function wallKit(K, N, f, b) {
  if (!b.place) return;
  const rot = faceRot(b, f);
  if (f.back && ['shop', 'terrace', 'civic'].includes(b.kind) && hash(b, 5, 1) < 0.6 && f.len > 4) {
    const u = (hash(b, 5, 2) - 0.5) * (f.len - 2.4);
    const [x, , z] = faceAt(K, f, u, 0.2);
    b.place(hash(b, 5, 3) < 0.4 ? 'airconRust' : 'aircon', x, terrainH(x, z) + 0.15, z, rot, 1);
    if (hash(b, 5, 4) < 0.4 && b.storeys > 1) {
      const [x2, , z2] = faceAt(K, f, -u * 0.6, 0.2);
      b.place('aircon', x2, b.base + b.sh + 0.15, z2, rot, 1);   // on a bracket at the first floor
    }
  }
  if (b.kind === 'warehouse' && (f.front || f.back)) {
    for (const e of [-1, 1]) {
      const [x, , z] = faceAt(K, f, e * f.len / 4, 0.2);
      b.place('floodlight', x, b.base + Math.min(b.sh - 1, 4.6), z, rot, 1.3);
    }
  }
  if (f.back && b.kind === 'shop' && b.storeys >= 3 && f.len >= 7.5 && hash(b, 6, 1) < 0.6) {
    const [x, , z] = faceAt(K, f, (hash(b, 6, 2) - 0.5) * (f.len - 7), 0.71);
    b.place('fireEscape', x, b.base + 3.65, z, rot, 1);
  }
}

// Blank walls and warehouse sides collect posters, graffiti and cracks.
function wallMarks(K, N, f, b, industrial) {
  if (!N.decal || f.len < 3) return;
  const { fquad } = K;
  N.decal.su = N.decal.sv = 1;
  const n = Math.floor(f.len / 6);
  for (let k = 0; k < n; k++) {
    const h = hash(b, k, f.n[0] * 3 + f.n[1]);
    if (h > (industrial ? 0.5 : 0.4)) continue;
    const u = -f.len / 2 + (k + 0.5) * (f.len / n) + (hash(b, f.n[1], k) - 0.5) * 1.5;
    const pick = hash(b, k * 7, 3);
    if (pick < 0.4) {
      const cell = [DECAL.graffiti, DECAL.graffitiB, DECAL.graffitiC][Math.floor(hash(b, k, 9) * 3)];
      fquad(N.decal, f, u, b.base + 0.4 + 1.0, 0.012, 2.6, 2.0, [0.92, 0.92, 0.92], decalUV(cell));
    } else if (pick < 0.75 && !industrial) {
      const cell = [DECAL.poster, DECAL.posterB, DECAL.posterC, DECAL.posterD][Math.floor(hash(b, k, 5) * 4)];
      fquad(N.decal, f, u, b.base + 1.55, 0.012, 0.75, 0.75, [1, 1, 1], decalUV(cell));
      if (hash(b, k, 6) < 0.5) fquad(N.decal, f, u + 0.8, b.base + 1.5, 0.013, 0.7, 0.7, [0.95, 0.95, 0.95], decalUV(DECAL.posterD));
    } else {
      fquad(N.decal, f, u, b.base + 1.2 + hash(b, k, 4) * 2, 0.012, 1.2, 1.8, [1, 1, 1], decalUV(hash(b, k, 8) < 0.5 ? DECAL.crack : DECAL.crackB));
    }
  }
}

// A balcony at one upper window: a slab on brackets, railing posts and rails.
function balcony(K, N, f, u, sy, ww, b) {
  const { fbox } = K, y = sy + 0.12;
  const W = ww + 0.8, D = 0.85, metal = [0.14, 0.14, 0.15];
  fbox(N.trim, f, u, y, D / 2, W, 0.14, D, [0.7, 0.69, 0.66]);
  for (const e of [-1, 1]) fbox(N.trim, f, u + e * (W / 2 - 0.15), y - 0.22, 0.3, 0.08, 0.3, 0.5, [0.6, 0.59, 0.56]);
  fbox(N.trim, f, u, y + 0.98, D - 0.03, W, 0.05, 0.05, metal);
  fbox(N.trim, f, u, y + 0.5, D - 0.03, W, 0.03, 0.03, metal);
  for (let k = 0; k <= 10; k++) fbox(N.trim, f, u - W / 2 + k * W / 10, y + 0.55, D - 0.03, 0.025, 0.86, 0.025, metal);
  for (const e of [-1, 1]) {
    fbox(N.trim, f, u + e * W / 2, y + 0.98, D / 2, 0.05, 0.05, D, metal);
    for (let k = 1; k < 4; k++) fbox(N.trim, f, u + e * W / 2, y + 0.55, k * D / 4, 0.025, 0.86, 0.025, metal);
  }
}

function warehouseFace(K, N, f, b) {
  const { fbox, fquad } = K;
  const top = b.base + b.H;
  if (f.front || f.back) {
    const n = Math.max(1, Math.floor(f.len / 9));
    for (let k = 0; k < n; k++) {
      const u = -f.len / 2 + (k + 0.5) * (f.len / n);
      // roller door with horizontal slats
      fquad(N.trim, f, u, b.base + 2.4, 0.03, 4.2, 4.6, [0.42, 0.44, 0.45]);
      for (let s = 0; s < 9; s++) fbox(N.trim, f, u, b.base + 0.3 + s * 0.5, 0.05, 4.2, 0.04, 0.03, [0.3, 0.31, 0.32]);
      fbox(N.trim, f, u, b.base + 4.85, 0.08, 4.8, 0.3, 0.2, [0.32, 0.33, 0.34]);
      fbox(N.trim, f, u - 2.25, b.base + 2.4, 0.06, 0.15, 4.8, 0.12, [0.7, 0.6, 0.15]);   // hazard posts
      fbox(N.trim, f, u + 2.25, b.base + 2.4, 0.06, 0.15, 4.8, 0.12, [0.7, 0.6, 0.15]);
    }
  }
  const n = Math.floor((f.len - 2) / 4);
  for (let k = 0; k < n; k++) {
    const u = -f.len / 2 + 1 + (k + 0.5) * ((f.len - 2) / n);
    N.glass.W = WIN_ID++;
    fquad(N.glass, f, u, top - 1.2, 0.02, 2.6, 0.7, [1, 1, 1], [0, 0, 1, 0, 1, 1, 0, 1]);
    fbox(N.trim, f, u, top - 1.6, 0.05, 2.8, 0.06, 0.1, TRIM);
    b.windows.push({ f: f.key, u, y: top - 1.2, w: 2.6, h: 0.7 });
  }
}

// A raised sign board on a fascia whose face is at `o`: a 5 cm board with
// a moulded frame standing 3 cm proud of it, the lettering on the board.
function signBoard(K, N, f, y, o, w, h, col) {
  const { fbox } = K, fr = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55], t = 0.06;
  fbox(N.trim, f, 0, y, o + 0.025, w + 0.04, h + 0.04, 0.05, col);
  fbox(N.trim, f, 0, y + h / 2 + t / 2, o + 0.04, w + 2 * t, t, 0.08, fr);
  fbox(N.trim, f, 0, y - h / 2 - t / 2, o + 0.04, w + 2 * t, t, 0.08, fr);
  fbox(N.trim, f, -w / 2 - t / 2, y, o + 0.04, t, h, 0.08, fr);
  fbox(N.trim, f, w / 2 + t / 2, y, o + 0.04, t, h, 0.08, fr);
}

function shopfront(K, N, f, b, sy, signs) {
  const { fbox, fquad } = K;
  const L = f.len;
  const gw = L - 1.0;
  // stall riser, glazing with mullions, recessed door at one end
  fbox(N.trim, f, 0, sy + 0.3, 0.08, L - 0.4, 0.6, 0.16, b.shopC);
  const doorU = L / 2 - 1.2;
  windowBay(K, N, f, -0.6, sy + 1.75, gw - 1.6, 2.3, b, { shop: true });
  fbox(N.trim, f, doorU, sy + 1.1, -0.02, 1.0, 2.2, 0.05, b.shopC);    // door panel, set back
  N.glass.W = -(WIN_ID++);
  fquad(N.glass, f, doorU, sy + 1.35, 0.0, 0.7, 1.4, [1, 1, 1], [0, 0, 1, 0, 1, 1, 0, 1]);
  const mull = Math.max(1, Math.round((gw - 1.6) / 1.6));
  for (let k = 1; k < mull; k++) fbox(N.trim, f, -0.6 - (gw - 1.6) / 2 + k * (gw - 1.6) / mull, sy + 1.75, 0.05, 0.07, 2.3, 0.08, b.shopC);
  // pilasters and fascia
  fbox(N.trim, f, -L / 2 + 0.22, sy + 1.6, 0.1, 0.44, 3.2, 0.22, b.shopC);
  fbox(N.trim, f, L / 2 - 0.22, sy + 1.6, 0.1, 0.44, 3.2, 0.22, b.shopC);
  fbox(N.trim, f, 0, sy + 3.25, 0.12, L - 0.1, 0.7, 0.26, b.shopC);
  fbox(N.trim, f, 0, sy + 3.66, 0.18, L + 0.05, 0.12, 0.36, TRIM);     // cornice over the fascia
  // sign board on the fascia, from the atlas
  if (signs && b.sign !== undefined) {
    const col = b.sign % SIGN_COLS, row = Math.floor(b.sign / SIGN_COLS);
    const u0 = col / SIGN_COLS, u1 = (col + 1) / SIGN_COLS;
    const v1 = 1 - row / SIGN_ROWS, v0 = 1 - (row + 1) / SIGN_ROWS;
    // atlas cells are 4:1; allow a little stretch on wide fascias
    const sw = Math.min(L - 0.8, 3.0);
    signBoard(K, N, f, sy + 3.25, 0.25, sw, 0.6, b.shopC);
    fquad(signs, f, 0, sy + 3.25, 0.302, sw, 0.6, [1, 1, 1], [u0, v0, u1, v0, u1, v1, u0, v1]);
  }
  if (b.awning) {
    const [c1, c2] = b.awning;
    const depth = 1.4, drop = 0.55, y = sy + 2.95;
    const n = Math.max(4, Math.round((L - 0.6) / 0.5));
    const sw = (L - 0.6) / n;
    const pitch = Math.atan2(drop, depth);
    for (let k = 0; k < n; k++) {
      const u = -(L - 0.6) / 2 + (k + 0.5) * sw;
      // each stripe a thin slab tilted down and out: approximate with a box at mid-slope
      const len = Math.hypot(depth, drop);
      const mo = depth / 2;
      fbox(N.trim, f, u, y - drop / 2, mo, sw, 0.04 + drop * 0.0, len, k % 2 ? c1 : c2);
      void pitch;
    }
    fbox(N.trim, f, 0, y - drop - 0.1, depth, L - 0.6, 0.22, 0.03, c1);   // valance
  }
}

function porch(K, N, f, u, sy, b) {
  const { fbox } = K;
  fbox(N.trim, f, u, sy + 2.55, 0.8, 2.2, 0.12, 1.6, b.roofTrim || [0.3, 0.3, 0.32]);
  fbox(N.trim, f, u - 0.95, sy + 1.25, 1.45, 0.12, 2.5, 0.12, TRIM);
  fbox(N.trim, f, u + 0.95, sy + 1.25, 1.45, 0.12, 2.5, 0.12, TRIM);
  fbox(N.trim, f, u, sy + 0.08, 0.9, 2.2, 0.16, 1.7, STONE);
}

function chimney(K, N, b) {
  const { box } = K;
  const top = b.base + b.H;
  const ch = b.rise + 1.3;
  const alongX = b.w >= b.d;
  const cx = alongX ? b.w * 0.3 : 0, cz = alongX ? 0 : b.d * 0.3;
  setTile(N.walls, b.mat === FACADE.render ? FACADE.brickRed : b.mat, FACADE_TILE);
  N.walls.B = -1000;
  box(N.walls, cx, top + ch / 2, cz, 0.75, ch, 0.75, b.mat === FACADE.render ? [0.8, 0.76, 0.72] : b.wallC);
  box(N.trim, cx, top + ch + 0.06, cz, 0.9, 0.12, 0.9, STONE);
  box(N.trim, cx - 0.15, top + ch + 0.3, cz, 0.18, 0.4, 0.18, [0.55, 0.32, 0.24]);
  box(N.trim, cx + 0.15, top + ch + 0.3, cz, 0.18, 0.4, 0.18, [0.55, 0.32, 0.24]);
}

function clockFaces(K, N, b) {
  const { faces, fbox } = K;
  const y = b.base + b.H - 1.8;
  for (const f of faces) {
    fbox(N.trim, f, 0, y, 0.06, 1.9, 1.9, 0.08, [0.9, 0.88, 0.82]);
    fbox(N.trim, f, 0, y, 0.11, 1.6, 1.6, 0.02, [0.95, 0.94, 0.9]);
    fbox(N.trim, f, 0, y + 0.3, 0.13, 0.06, 0.6, 0.02, DARK);    // hands stopped at 3:41
    fbox(N.trim, f, 0.22, y + 0.05, 0.13, 0.45, 0.06, 0.02, DARK);
  }
}

export function emitRoof(b, walls, roof, K, i, isFar, trim) {
  const { W, box } = K;
  const top = b.base + b.H;
  roof.L = b.roofMat; tile(roof, ROOF_TILE, b.roofMat); roof.B = -1000;
  walls.B = -1000;
  if (b.roof === 'flat') {
    if (isFar) { box(walls, 0, top + 0.35, 0, b.w - 2 * i, 0.7, b.d - 2 * i, b.wallC); return; }
    box(roof, 0, top + 0.06, 0, b.w - 0.4, 0.12, b.d - 0.4, b.roofC);
    const t = 0.25, h = 0.7;
    box(walls, 0, top + h / 2, b.d / 2 - t / 2, b.w, h, t, b.wallC);
    box(walls, 0, top + h / 2, -b.d / 2 + t / 2, b.w, h, t, b.wallC);
    box(walls, b.w / 2 - t / 2, top + h / 2, 0, t, h, b.d - 2 * t, b.wallC);
    box(walls, -b.w / 2 + t / 2, top + h / 2, 0, t, h, b.d - 2 * t, b.wallC);
    // coping and a corbelled cornice
    box(trim, 0, top + h + 0.04, b.d / 2 - t / 2, b.w + 0.1, 0.08, t + 0.12, TRIM);
    box(trim, 0, top + h + 0.04, -b.d / 2 + t / 2, b.w + 0.1, 0.08, t + 0.12, TRIM);
    box(trim, b.w / 2 - t / 2, top + h + 0.04, 0, t + 0.12, 0.08, b.d, TRIM);
    box(trim, -b.w / 2 + t / 2, top + h + 0.04, 0, t + 0.12, 0.08, b.d, TRIM);
    if (b.cornice) {
      box(trim, 0, top - 0.12, b.d / 2 + 0.08, b.w + 0.2, 0.22, 0.16, TRIM);
      box(trim, 0, top + 0.02, b.d / 2 + 0.14, b.w + 0.3, 0.1, 0.28, TRIM);
    }
    return;
  }
  const alongX = b.w >= b.d;
  const A = (alongX ? b.w : b.d) - 2 * i, S = (alongX ? b.d : b.w) - 2 * i;
  const L = (a, y, s) => alongX ? W(a, y, s) : W(s, y, a);
  const dir = (a, y, s) => { const p = L(a, y, s), o = L(0, 0, 0); return [p[0] - o[0], y, p[2] - o[2]]; };
  const oh = isFar ? 0 : 0.35, ohg = isFar ? 0 : 0.25;
  const rise = b.rise, eaveY = top - oh * b.pitch, ridgeY = top + rise - i;
  const col = b.roofC;
  const slope = Math.hypot(S / 2 + oh, rise + oh * b.pitch);
  if (b.roof === 'gable') {
    for (const sgn of [1, -1]) {
      roof.quad(L(-A / 2 - ohg, eaveY, sgn * (S / 2 + oh)), L(A / 2 + ohg, eaveY, sgn * (S / 2 + oh)),
        L(A / 2 + ohg, ridgeY, 0), L(-A / 2 - ohg, ridgeY, 0), dir(0, 1, sgn), col,
        [0, 0, A + 2 * ohg, 0, A + 2 * ohg, slope, 0, slope]);
      walls.tri(L(sgn * A / 2, top, -S / 2), L(sgn * A / 2, top, S / 2), L(sgn * A / 2, ridgeY, 0), dir(sgn, 0, 0), b.wallC);
    }
    if (!isFar && trim) {
      const [cx, , cz] = L(0, 0, 0);
      const len = A + 2 * ohg;
      const rr = alongX ? b.rot : b.rot + Math.PI / 2;
      trim.box(cx, ridgeY + 0.05, cz, len, 0.14, 0.26, Math.cos(rr), Math.sin(rr), [0.22, 0.2, 0.2]);
      for (const sgn of [1, -1]) {        // gutters
        const [gx, , gz] = L(0, 0, sgn * (S / 2 + oh));
        trim.box(gx, eaveY - 0.06, gz, len, 0.12, 0.14, Math.cos(rr), Math.sin(rr), [0.2, 0.21, 0.22]);
        // barge boards on the gable ends
        for (const e of [1, -1]) {
          const p0 = L(e * (A / 2 + ohg), eaveY, sgn * (S / 2 + oh)), p1 = L(e * (A / 2 + ohg), ridgeY, 0);
          const out = dir(e, 0, 0);
          trim.quad(p0, p1, [p1[0], p1[1] - 0.22, p1[2]], [p0[0], p0[1] - 0.22, p0[2]], out, TRIM);
        }
      }
    }
    return;
  }
  const half = Math.max(0, (A - S) / 2);
  for (const sgn of [1, -1]) {
    roof.quad(L(-A / 2 - oh, eaveY, sgn * (S / 2 + oh)), L(A / 2 + oh, eaveY, sgn * (S / 2 + oh)),
      L(half, ridgeY, 0), L(-half, ridgeY, 0), dir(0, 1, sgn), col,
      [0, 0, A + 2 * oh, 0, A + 2 * oh, slope, 0, slope]);
    roof.tri(L(sgn * (A / 2 + oh), eaveY, -S / 2 - oh), L(sgn * (A / 2 + oh), eaveY, S / 2 + oh),
      L(sgn * half, ridgeY, 0), dir(sgn, 1, 0), col);
  }
  if (!isFar && trim) {
    const rr = alongX ? b.rot : b.rot + Math.PI / 2;
    for (const sgn of [1, -1]) {
      const [gx, , gz] = L(0, 0, sgn * (S / 2 + oh));
      trim.box(gx, eaveY - 0.06, gz, A + 2 * oh, 0.12, 0.14, Math.cos(rr), Math.sin(rr), [0.2, 0.21, 0.22]);
    }
  }
}

// ------------------------------------------------------------ enterables --

// Real walls with openings, a floor, a ceiling, partitions and furniture.
// Ground floor only; the upper storey is a closed volume with fake windows.
export function emitEnterable(b, N, K, signs) {
  const { box, faces, fbox, fquad } = K;
  const { w, d, base, foot, H, sh } = b;
  const top = base + H;
  const T = 0.25;
  const cols = b.cols;          // collider sink (town.js supplies)
  const solidL = (lx0, lz0, lx1, lz1, y0, y1, surf) => {
    const [ax, , az] = K.W(lx0, 0, lz0), [bx, , bz] = K.W(lx1, 0, lz1);
    cols.push({ minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz),
      bottom: y0, top: y1, town: true, surf: surf || 'masonry', ref: b });
  };
  const inner = b.interiorTint || [0.78, 0.75, 0.7];

  // floor slab and plinth
  setTile(N.walls, FACADE.stone, FACADE_TILE); N.walls.B = base;
  box(N.walls, 0, (foot + base) / 2, 0, w + 0.1, base - foot, d + 0.1, [0.62, 0.6, 0.56]);
  solidL(-w / 2, -d / 2, w / 2, d / 2, foot, base);
  setTile(N.walls, FACADE.cladding, FACADE_TILE); N.walls.B = -1000;
  box(N.walls, 0, base + 0.01, 0, w - 2 * T, 0.02, d - 2 * T, b.floorC || [0.55, 0.42, 0.3]);

  // ceiling at the top of the ground storey, and the closed upper volume
  setTile(N.walls, FACADE.render, FACADE_TILE);
  box(N.walls, 0, base + sh - 0.1, 0, w - 2 * T, 0.2, d - 2 * T, [0.58, 0.57, 0.55], true);
  solidL(-w / 2 + T, -d / 2 + T, w / 2 - T, d / 2 - T, base + sh - 0.2, top + 0.7);

  // exterior walls: pieces around the openings, plaster lining inside
  for (const f of faces) {
    const opens = (b.openings && b.openings[f.key]) || [];
    const pieces = wallPieces(f.len, sh, opens);
    for (const p of pieces) {
      const u = (p.u0 + p.u1) / 2, su = p.u1 - p.u0, y = base + (p.y0 + p.y1) / 2, sy = p.y1 - p.y0;
      setTile(N.walls, b.mat, FACADE_TILE); N.walls.B = base;
      fbox(N.walls, f, u, y, -T / 2, su, sy, T, b.wallC);
      setTile(N.walls, FACADE.render, FACADE_TILE); N.walls.B = base;
      fbox(N.walls, f, u, y, -T - 0.01, su, sy, 0.02, inner);
      const [l0x, l0z] = K.fpos(f, p.u0, -T), [l1x, l1z] = K.fpos(f, p.u1, 0);
      solidL(l0x, l0z, l1x, l1z, base + p.y0, base + p.y1);
    }
    for (const o of opens) {
      const u = (o.u0 + o.u1) / 2, ow = o.u1 - o.u0;
      if (o.type === 'window') {
        N.clear.L = 0;
        fquad(N.clear, f, u, base + (o.y0 + o.y1) / 2, -T / 2, ow, o.y1 - o.y0, [1, 1, 1]);
        fbox(N.trim, f, u, base + o.y0 - 0.05, 0.1, ow + 0.3, 0.09, 0.2 + T, STONE);
        fbox(N.trim, f, u, base + (o.y0 + o.y1) / 2, -T / 2, 0.06, o.y1 - o.y0, T, TRIM);
        b.windows.push({ f: f.key, u, y: base + (o.y0 + o.y1) / 2, w: ow, h: o.y1 - o.y0, real: true });
      } else {
        // door frame around a real opening
        fbox(N.trim, f, o.u0 - 0.05, base + 1.1, -T / 2, 0.1, 2.3, T + 0.04, TRIM);
        fbox(N.trim, f, o.u1 + 0.05, base + 1.1, -T / 2, 0.1, 2.3, T + 0.04, TRIM);
        fbox(N.trim, f, u, base + o.y1 + 0.05, -T / 2, ow + 0.2, 0.1, T + 0.04, TRIM);
      }
    }
    // upper storey: solid wall with fake rooms behind its windows
    if (b.storeys > 1) {
      const sy0 = base + sh;
      setTile(N.walls, b.mat, FACADE_TILE); N.walls.B = base;
      fbox(N.walls, f, 0, (sy0 + top) / 2, -T / 2, f.len, top - sy0, T, b.wallC);
      const sp = 2.8, n = Math.max(1, Math.floor((f.len - 1.4) / sp));
      for (let s = 1; s < b.storeys; s++) {
        for (let k = 0; k < n; k++) {
          const uu = -f.len / 2 + (k + 0.5) * (f.len / n);
          const tall = b.kind === 'civic' ? 2.3 : 1.45;
          windowBay(K, N, f, uu, base + s * sh + 0.95 + tall / 2, 1.15, tall, b);
        }
      }
    }
  }
  box(N.trim, 0, base + sh, 0, w + 0.12, 0.16, d + 0.12, TRIM);

  // shop sign if any (front fascia above the door line)
  if (signs && b.sign !== undefined) {
    const f = faces[0];
    const col = b.sign % SIGN_COLS, row = Math.floor(b.sign / SIGN_COLS);
    const u0 = col / SIGN_COLS, u1 = (col + 1) / SIGN_COLS, v1 = 1 - row / SIGN_ROWS, v0 = 1 - (row + 1) / SIGN_ROWS;
    fbox(N.trim, f, 0, base + sh - 0.55, 0.06, Math.min(f.len - 0.6, 5.2), 0.75, 0.12, b.shopC || [0.25, 0.3, 0.32]);
    signBoard(K, N, f, base + sh - 0.55, 0.12, Math.min(f.len - 1.0, 4.6), 0.62, b.shopC || [0.25, 0.3, 0.32]);
    fquad(signs, f, 0, base + sh - 0.55, 0.172, Math.min(f.len - 1.0, 4.6), 0.62, [1, 1, 1], [u0, v0, u1, v0, u1, v1, u0, v1]);
  }

  emitRoof(b, N.walls, N.roof, K, 0, false, N.trim);
  if (b.chimney) chimney(K, N, b);

  // partitions and furniture, described in local coordinates by the layout
  const place = (m, lx, y, lz, rot, s, sy, sx) => {
    if (!b.place) return;
    const [x, , z] = K.W(lx, 0, lz);
    b.place(m, x, y, z, b.rot + rot, s, sy, undefined, sx);
  };
  for (const p of (b.parts || [])) {
    const yy = base + (p.y || 0);
    if (p.kind === 'model') { place(p.m, p.x, yy, p.z, p.rot, p.s, p.sy, p.sx); continue; }
    if (p.kind === 'wall') {
      setTile(N.walls, FACADE.render, FACADE_TILE); N.walls.B = base;
      box(N.walls, p.x, yy + (p.h || sh) / 2, p.z, p.sx, p.h || sh, p.sz, inner);
      solidL(p.x - p.sx / 2, p.z - p.sz / 2, p.x + p.sx / 2, p.z + p.sz / 2, yy, yy + (p.h || sh));
    } else {
      box(p.stand && b.standBuf ? b.standBuf : N.trim, p.x, yy + p.sy / 2, p.z, p.sx, p.sy, p.sz, p.col || [0.45, 0.36, 0.26]);
      if (p.solid !== false) solidL(p.x - p.sx / 2, p.z - p.sz / 2, p.x + p.sx / 2, p.z + p.sz / 2, yy, yy + p.sy, p.surf || 'wood');
    }
  }
  // ceiling lamps
  // ceiling lights: fluorescent fittings (hanging lamps in the sheds); the
  // flat panels stand in until the models arrive
  for (const lp of (b.lamps || [])) {
    box(b.place && b.standBuf ? b.standBuf : N.trim, lp.x, base + sh - 0.24, lp.z, 1.2, 0.06, 0.3, [0.9, 0.9, 0.86]);
    if (b.kind === 'warehouse') place('hangingLamp', lp.x, base + sh - 0.2, lp.z, 0, 1.3);
    else if (b.kind === 'house') place('ceilingLamp', lp.x, base + sh - 0.2 - 1.17, lp.z, 0, 1);
    else place('tubeLight', lp.x, base + sh - 0.2, lp.z, Math.PI / 2, 1.2);
  }
  void DOOR_COLS; void AWNING;
}

// Split a wall of length L and height h into boxes around rectangular
// openings { u0, u1, y0, y1 } (u from -L/2).
function wallPieces(L, h, opens) {
  const xs = [-L / 2, L / 2];
  for (const o of opens) xs.push(o.u0, o.u1);
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const u0 = xs[i], u1 = xs[i + 1];
    if (u1 - u0 < 0.01) continue;
    const mid = (u0 + u1) / 2;
    const o = opens.find((q) => mid > q.u0 && mid < q.u1);
    if (!o) { out.push({ u0, u1, y0: 0, y1: h }); continue; }
    if (o.y0 > 0.01) out.push({ u0, u1, y0: 0, y1: o.y0 });
    if (o.y1 < h - 0.01) out.push({ u0, u1, y0: o.y1, y1: h });
  }
  return out;
}

export const KIT = { DOOR_COLS, AWNING, TRIM, STONE };
