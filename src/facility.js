import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Meridian Ridge Research Station -- the campaign location.
//
// Built from rooms and corridors rather than one arena, so the player travels
// through a place instead of circling a box. Every wall, floor and prop is
// procedural: no model files, nothing licensed.
//
// Two levels. The ground floor sits at y=0 and the basement at y=-3.6, reached
// by a stair shaft. That needs one change to the player controller: `groundAt`
// used to default the floor to y=0 everywhere, which would hold the player up
// in mid-air over the basement. The building interior is registered as a
// `void` where only real slab colliders count, and the slabs are laid
// explicitly -- everywhere except the stair shaft.
//
// Geometry is bucketed by material and merged once, so the whole facility is a
// handful of draw calls.

const WALL_H = 4.2;
const BASE_Y = -3.6;
const CEIL_T = 0.25;

// Named areas the campaign uses for objectives, enemy placement and triggers.
// Kept as data so a second mission can reuse the building with new contents.
export const AREA = {};

export function buildFacility(scene, mats, PAL) {
  const colliders = [];
  const voids = [];
  const areas = {};
  const anchors = {};
  const buckets = { steel: [], panel: [], rust: [], crate: [], floor: [], ceil: [],
                    brick: [], painted: [], plaster: [], asphalt: [], paintMetal: [], glass: [],
                    gunMetalBucket: [] };
  const glow = { warm: [], cold: [], hazard: [] };
  const lights = [];

  // A BoxGeometry face is UV 0..1 whatever its size, so one texture is stretched
  // across a 20m wall and squeezed onto a 2m one. That is most of why the walls
  // read as repeated identical panels. Rewriting the UVs in metres makes brick
  // courses and concrete grain the same size everywhere.
  const scaleBoxUV = (geo, w, h, d, tile) => {
    const uv = geo.attributes.uv;
    if (!uv) return geo;
    const spans = [
      [d, h], [d, h],    // +X, -X
      [w, d], [w, d],    // +Y, -Y
      [w, h], [w, h],    // +Z, -Z
    ];
    for (let f = 0; f < 6; f++) {
      const su = spans[f][0] / tile, sv = spans[f][1] / tile;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      }
    }
    uv.needsUpdate = true;
    return geo;
  };

  const OBJ = new THREE.Object3D();
  const put = (geo, x, y, z, ry = 0) => {
    OBJ.position.set(x, y, z);
    OBJ.rotation.set(0, ry, 0);
    OBJ.scale.set(1, 1, 1);
    OBJ.updateMatrix();
    return geo.clone().applyMatrix4(OBJ.matrix);
  };

  const solid = (w, d, x, z, top, bottom) => {
    colliders.push({ minX: x - w / 2, maxX: x + w / 2,
                     minZ: z - d / 2, maxZ: z + d / 2, top, bottom });
  };

  // Metres covered by one texture repeat, per material. Brick courses have to
  // come out about 215mm long or it reads as a toy wall.
  const TILE = {
    brick: 0.90, painted: 2.6, plaster: 2.8, floor: 4.0, asphalt: 7.0,
    ceil: 2.4, steel: 2.0, panel: 2.4, rust: 1.6, crate: 1.1,
    paintMetal: 1.8, glass: 1.6, gunMetalBucket: 0.8,
  };

  // A box of geometry, optionally collidable.
  const box = (bucket, w, h, d, x, y, z, blocks = true) => {
    const geo = scaleBoxUV(new THREE.BoxGeometry(w, h, d), w, h, d, TILE[bucket] || 2.0);
    buckets[bucket].push(put(geo, x, y, z));
    if (blocks) solid(w, d, x, z, y + h / 2, y - h / 2);
  };

  const lamp = (kind, w, h, d, x, y, z) => {
    glow[kind].push(put(new THREE.BoxGeometry(w, h, d), x, y, z));
  };

  // ---------------------------------------------------------------- shell

  // Footprint of the building interior. Inside it the floor comes only from
  // slab colliders, which is what makes a basement possible at all.
  const IN = { minX: -31, maxX: 31, minZ: -61, maxZ: -0.5 };
  voids.push(IN);

  // Ground slab, laid as strips so the stair shaft can be left open.
  const SHAFT = { minX: -6.5, maxX: -0.5, minZ: -59.5, maxZ: -51.5 };
  const slab = (x1, z1, x2, z2, y) => {
    const w = x2 - x1, d = z2 - z1;
    if (w <= 0 || d <= 0) return;
    buckets.floor.push(put(scaleBoxUV(new THREE.BoxGeometry(w, 0.4, d), w, 0.4, d, TILE.floor),
      (x1 + x2) / 2, y - 0.2, (z1 + z2) / 2));
    solid(w, d, (x1 + x2) / 2, (z1 + z2) / 2, y, y - 0.4);
  };
  // four strips around the shaft
  slab(-31, -51.5, 31, -0.5, 0);
  slab(-31, -61, -6.5, -51.5, 0);
  slab(-0.5, -61, 31, -51.5, 0);
  slab(-6.5, -61, -0.5, -59.5, 0);

  // Basement slab and ceiling.
  slab(-28, -47, 26, -23, BASE_Y);
  // The stair flight descends south, so the basement has to open to the EAST of
  // it. Walking back north under the flight is impossible -- the treads are
  // solid overhead -- which is what stranded the player at the bottom.
  // Runs to the building's rear wall: with the shaft ending at -59.5 the flat
  // landing was 0.8m deep and the player is 0.8m wide, so they stood inside the
  // wall and could not move in any direction.
  slab(-6.5, -61, 6, -46.5, BASE_Y);

  // ---------------------------------------------------------------- walls

  // A wall run along one axis with doorway gaps cut out of it.
  // `gaps` are [centre, width] along the run.
  const wall = (x1, z1, x2, z2, h, gaps = [], y0 = 0, bucket = 'plaster') => {
    const horiz = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const a = horiz ? x1 : z1;
    const b = horiz ? x2 : z2;
    const fixed = horiz ? z1 : x1;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const segs = [];
    let cur = lo;
    for (const [c, w] of [...gaps].sort((p, q) => p[0] - q[0])) {
      const gs = c - w / 2, ge = c + w / 2;
      if (gs > cur) segs.push([cur, gs]);
      cur = Math.max(cur, ge);
    }
    if (cur < hi) segs.push([cur, hi]);
    for (const [s, e] of segs) {
      const len = e - s;
      if (len < 0.05) continue;
      const mid = (s + e) / 2;
      if (horiz) box(bucket, len, h, 0.3, mid, y0 + h / 2, fixed);
      else box(bucket, 0.3, h, len, fixed, y0 + h / 2, mid);
    }
    // header above each doorway, so a gap reads as a door not a missing wall
    for (const [c, w] of gaps) {
      const hh = h - 2.3;
      if (hh <= 0.05) continue;
      if (horiz) box(bucket, w, hh, 0.3, c, y0 + 2.3 + hh / 2, fixed, false);
      else box(bucket, 0.3, hh, w, fixed, y0 + 2.3 + hh / 2, c, false);
    }
  };

  const ceiling = (x1, z1, x2, z2, y) => {
    const w = x2 - x1, d = z2 - z1;
    // Concrete, not the ribbed panel: the panel's ribs smear into long streaks
    // when stretched over a span this size.
    buckets.ceil.push(put(scaleBoxUV(new THREE.BoxGeometry(w, CEIL_T, d), w, CEIL_T, d, TILE.ceil),
      (x1 + x2) / 2, y, (z1 + z2) / 2));
    solid(w, d, (x1 + x2) / 2, (z1 + z2) / 2, y + CEIL_T / 2, y - CEIL_T / 2);
  };

  const area = (name, x1, z1, x2, z2, y = 0) => {
    areas[name] = { name, minX: Math.min(x1, x2), maxX: Math.max(x1, x2),
                    minZ: Math.min(z1, z2), maxZ: Math.max(z1, z2), y,
                    cx: (x1 + x2) / 2, cz: (z1 + z2) / 2 };
    AREA[name] = areas[name];
    return areas[name];
  };

  // ---------------------------------------------------------------- exterior

  area('parking', -28, 14, 28, 40);
  area('gate', -8, 8, 8, 15);
  area('forecourt', -20, 0, 20, 8);

  // Perimeter fence: posts, rails and mesh infill. Built as a solid wall run it
  // read as a stone boundary wall and hid the whole building on approach.
  const fenceRun = (x1, z1, x2, z2, gaps) => {
    const horiz = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const a = horiz ? x1 : z1, b = horiz ? x2 : z2;
    const fixed = horiz ? z1 : x1;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const H = 2.4, BAY = 2.6;
    const inGap = (t) => (gaps || []).some((g) => Math.abs(t - g[0]) < g[1] / 2);
    for (let t = lo; t < hi; t += BAY) {
      const seg = Math.min(BAY, hi - t);
      const mid = t + seg / 2;
      if (inGap(mid)) continue;
      // post
      if (horiz) box('paintMetal', 0.12, H, 0.12, t, H / 2, fixed);
      else box('paintMetal', 0.12, H, 0.12, fixed, H / 2, t);
      // mesh infill plus top and bottom rails
      if (horiz) {
        box('steel', seg - 0.14, H - 0.35, 0.03, mid, H / 2, fixed, false);
        box('paintMetal', seg, 0.07, 0.07, mid, H - 0.1, fixed, false);
        box('paintMetal', seg, 0.07, 0.07, mid, 0.22, fixed, false);
        solid(seg, 0.2, mid, fixed, H, 0);
      } else {
        box('steel', 0.03, H - 0.35, seg - 0.14, fixed, H / 2, mid, false);
        box('paintMetal', 0.07, 0.07, seg, fixed, H - 0.1, mid, false);
        box('paintMetal', 0.07, 0.07, seg, fixed, 0.22, mid, false);
        solid(0.2, seg, fixed, mid, H, 0);
      }
    }
    // end post
    if (horiz) box('paintMetal', 0.12, H, 0.12, hi, H / 2, fixed);
    else box('paintMetal', 0.12, H, 0.12, fixed, H / 2, hi);
  };
  // south gate onto Station Road, down to the town
  fenceRun(-34, 42, 34, 42, [[0, 9]]);
  fenceRun(-34, 42, -34, -2, []);
  fenceRun(34, 42, 34, -2, []);
  fenceRun(-34, 14.5, 34, 14.5, [[0, 9]]);

  box('steel', 0.4, 3.2, 0.4, -4.6, 1.6, 42);
  box('steel', 0.4, 3.2, 0.4, 4.6, 1.6, 42);
  box('rust', 0.16, 2.4, 4.2, -6.9, 1.3, 40.2, false);
  box('rust', 0.16, 2.4, 4.2, 6.9, 1.3, 40.2, false);

  // gate posts and the swung-open leaves
  box('steel', 0.4, 3.2, 0.4, -4.6, 1.6, 14.5);
  box('steel', 0.4, 3.2, 0.4, 4.6, 1.6, 14.5);
  box('rust', 0.16, 2.4, 4.2, -4.9, 1.3, 12.3, false);
  box('rust', 0.16, 2.4, 4.2, 4.9, 1.3, 12.3, false);
  lamp('hazard', 0.5, 0.12, 0.12, -4.6, 3.3, 14.5);

  // guard hut at the gate
  wall(6, 12, 12, 12, 2.8, [], 0, 'painted');
  wall(6, 18, 12, 18, 2.8, [[9, 1.2]], 0, 'painted');
  wall(6, 12, 6, 18, 2.8, [[15, 1.2]], 0, 'painted');
  wall(12, 12, 12, 18, 2.8, [], 0, 'painted');
  ceiling(6, 12, 12, 18, 2.9);
  lamp('warm', 1.0, 0.08, 0.2, 9, 2.6, 15);

  // parked vehicles: a slab body, cab and wheels each
  // A saturated rust box reads as a bright orange slab, not a vehicle. Painted
  // bodywork, glazing, a dark sill line and rubber for the wheels.
  const vehicle = (x, z, ry, len) => {
    const L = len || 4.6;
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
    const [bx, bz] = at(0, 0);
    box('paintMetal', 2.05, 0.72, L, bx, 0.98, bz);
    box('paintMetal', 2.12, 0.16, L * 0.99, bx, 0.60, bz, false);   // sill
    const [cx2, cz2] = at(0, -L * 0.20);
    box('paintMetal', 1.88, 0.30, L * 0.34, cx2, 1.52, cz2, false); // cab shoulder
    const [gx, gz] = at(0, -L * 0.20);
    buckets.glass.push(put(scaleBoxUV(new THREE.BoxGeometry(1.78, 0.52, L * 0.33),
      1.78, 0.52, L * 0.33, TILE.glass), gx, 1.86, gz));
    box('paintMetal', 1.92, 0.12, L * 0.36, cx2, 2.14, cz2, false); // roof
    for (const w of [[-0.98, L * 0.32], [0.98, L * 0.32], [-0.98, -L * 0.32], [0.98, -L * 0.32]]) {
      const [wx, wz] = at(w[0], w[1]);
      box('gunMetalBucket', 0.30, 0.74, 0.74, wx, 0.37, wz, false);
    }
  };
  vehicle(-18, 24, 0.1); vehicle(-12, 24, 0.0); vehicle(12, 26, 0.05, 6.2);
  vehicle(20, 22, 1.55); vehicle(-22, 33, 0.0);
  anchors.crashedTruck = new THREE.Vector3(6, 0, 20);
  vehicle(6, 20, 0.6, 6.4);

  // light masts over the car park
  // Kept off the spawn sightline: a 7m mast on the centre line hides the whole
  // building on the approach, which is the first thing the player should see.
  for (const [x, z] of [[-25, 30], [25, 30], [-25, 19], [25, 19]]) {
    box('steel', 0.3, 7, 0.3, x, 3.5, z, true);
    lamp('warm', 1.6, 0.2, 0.5, x, 7.0, z);
  }

  // ---------------------------------------------------------------- ground floor

  const G = WALL_H;
  area('reception', -12, -14, 12, -0.5);
  area('checkpoint', 12, -12, 24, -0.5);
  area('security', 12, -26, 24, -12);
  area('offices', -30, -26, -12, -2);
  area('corridor', -30, -32, 24, -26);
  area('storage', -30, -48, -16, -32);
  area('medical', -14, -46, -2, -32);
  area('server', 0, -46, 12, -32);
  area('maintenance', 14, -48, 26, -32);
  area('stairwell', -6.5, -59.5, -0.5, -47);
  area('loading', 2, -61, 30, -50);

  // outer shell
  wall(-31, -0.5, 31, -0.5, G, [[0, 3.2]], 0, 'brick');     // front, main entrance
  wall(-31, -61, 31, -61, G, [[18, 7]], 0, 'painted');      // rear, loading door
  wall(-31, -0.5, -31, -61, G, [], 0, 'brick');
  wall(31, -0.5, 31, -61, G, [], 0, 'painted');
  ceiling(-31, -61, 31, -0.5, G);

  // reception / checkpoint / offices
  wall(12, -0.5, 12, -26, G, [[-6, 1.6], [-20, 1.6]]);      // reception|checkpoint
  wall(-12, -0.5, -12, -26, G, [[-8, 1.6], [-20, 1.6]]);    // reception|offices
  wall(-12, -14, 12, -14, G, [[0, 2.4]]);                   // reception rear
  wall(12, -12, 24, -12, G, [[18, 1.6]]);                   // checkpoint|security
  wall(-12, -26, 24, -26, G, [[-6, 1.8], [6, 1.8], [18, 1.8]]);   // corridor north wall
  wall(-30, -26, -12, -26, G, [[-20, 1.8]]);

  // corridor south wall, doors into each south room
  wall(-30, -32, 26, -32, G, [[-23, 1.8], [-8, 1.8], [6, 1.8], [20, 1.8]]);

  // south room partitions
  wall(-16, -48, -16, -32, G, []);
  wall(-2, -46, -2, -32, G, []);
  wall(0, -46, 0, -32, G, []);
  wall(12, -48, 12, -32, G, []);
  wall(-30, -48, -16, -48, G, [[-23, 1.8]]);
  wall(-14, -46, -2, -46, G, [[-8, 1.8]]);
  wall(0, -46, 12, -46, G, [[6, 1.8]]);
  wall(14, -48, 26, -48, G, [[20, 1.8]]);
  wall(12, -48, 14, -48, G, []);

  // rear corridor linking the south rooms to the stairwell and loading bay
  wall(-31, -50, 31, -50, G, [[-3.5, 2.2], [16, 6]]);
  area('rearCorridor', -31, -50, 31, -48);

  // Stair shaft. The west and south walls run full height because there is no
  // floor beyond them at basement level. The east side is only a ground-floor
  // railing, so the bottom of the stairs opens into the basement.
  // The basement floor under the shaft runs from x -6.5 to 6 and z -61 to
  // -46.5, so every edge of it needs a wall at basement level. The west wall
  // used to stop at z -51.5 and there were no east or south walls past the
  // stairs: a player stepping off the landing walked into the void below the
  // building. Ground-floor walls do not help here -- they start at y 0, and
  // the player ducks underneath them from the basement.
  //
  // Only the edges of the shaft opening rise above the ground floor (a 0.6m lip
  // that stops people walking into the hole). Everything that runs *under* the
  // ground floor stops exactly at y 0 -- at full height these walls stuck up
  // through the floor and put a knee-high barrier across the rear corridor on
  // the route to extraction.
  const UNDER = Math.abs(BASE_Y);
  wall(-6.5, -51.5, -6.5, -61, G, [], BASE_Y, 'painted');        // shaft edge, with lip
  wall(-6.5, -46.5, -6.5, -51.5, UNDER, [], BASE_Y, 'painted');  // under the floor
  wall(-6.5, -61, -0.5, -61, G, [], BASE_Y, 'painted');          // shaft edge, with lip
  wall(-0.5, -61, 6, -61, UNDER, [], BASE_Y, 'painted');
  wall(6, -61, 6, -46.5, UNDER, [], BASE_Y, 'painted');
  box('steel', 0.16, 1.15, 8.0, -0.5, 0.575, -55.5);

  // the stairs themselves
  // Tread tops must land exactly on the descent line. Centring the box at
  // `y + h/2` puts the top a whole box-height too high, which turned the first
  // step down into a step up.
  // Tread tops must land exactly on the descent line. Centring the box at
  // `y + h/2` puts the top a whole box-height too high, which turned the first
  // step down into a step up.
  const STEPS = 16;
  const RISE = Math.abs(BASE_Y) / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const top = -(i + 1) * RISE;
    const z = -52 - i * 0.42;
    box('steel', 5.6, 0.5, 0.54, -3.5, top - 0.25, z);
  }
  box('steel', 0.1, 1.1, 7.6, -0.75, BASE_Y + 2.2, -55.5, false);

  // ---------------------------------------------------------------- basement

  area('undergroundCorridor', -6, -47, 6, -24, BASE_Y);
  area('laboratory', -26, -46, -8, -26, BASE_Y);
  area('armory', 8, -44, 24, -28, BASE_Y);

  const BH = 3.2;
  wall(-6, -47, -6, -24, BH, [[-36, 1.8]], BASE_Y, 'painted');
  wall(6, -47, 6, -24, BH, [[-34, 1.8]], BASE_Y, 'painted');
  wall(-6, -24, 6, -24, BH, [], BASE_Y, 'painted');
  wall(-6, -47, 6, -47, BH, [[0, 3.0]], BASE_Y, 'painted');
  ceiling(-28, -47, 26, -23, BASE_Y + BH);

  wall(-26, -46, -26, -26, BH, [], BASE_Y, 'painted');
  wall(-26, -26, -6, -26, BH, [], BASE_Y, 'painted');
  wall(-26, -46, -6, -46, BH, [], BASE_Y, 'painted');
  wall(8, -44, 8, -28, BH, [[-34, 1.8]], BASE_Y, 'painted');
  wall(24, -44, 24, -28, BH, [], BASE_Y, 'painted');
  wall(8, -28, 24, -28, BH, [], BASE_Y, 'painted');
  wall(8, -44, 24, -44, BH, [], BASE_Y, 'painted');

  // The corridor door (x 6) and the armory door (x 8) are 2m apart, and that
  // gap was open at both ends. It led into dead space behind every basement
  // room, which ran to the edge of the basement slab with no wall -- the hole
  // scan found 194 reachable spots with nothing under them. A short vestibule
  // closes the passage, and a perimeter wall seals the slab edge regardless.
  wall(6, -32.9, 8, -32.9, BH, [], BASE_Y, 'painted');
  wall(6, -35.1, 8, -35.1, BH, [], BASE_Y, 'painted');
  wall(-28, -23, 26, -23, BH, [], BASE_Y, 'painted');
  wall(-28, -47, -28, -23, BH, [], BASE_Y, 'painted');
  wall(26, -47, 26, -23, BH, [], BASE_Y, 'painted');
  wall(-28, -47, -6, -47, BH, [], BASE_Y, 'painted');   // the corridor wall covers -6..6
  wall(6, -47, 26, -47, BH, [], BASE_Y, 'painted');

  // ---------------------------------------------------------------- props

  const desk = (x, z, ry = 0) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    buckets.steel.push(put(new THREE.BoxGeometry(1.7, 0.08, 0.8), x, 0.74, z, ry));
    solid(1.7 * Math.abs(c) + 0.8 * Math.abs(s), 0.8 * Math.abs(c) + 1.7 * Math.abs(s), x, z, 0.78, 0);
    for (const dx of [-0.75, 0.75]) {
      buckets.steel.push(put(new THREE.BoxGeometry(0.08, 0.7, 0.7), x + dx * c, 0.35, z + dx * s, ry));
    }
  };
  const monitor = (x, y, z, ry = 0, on = true) => {
    buckets.steel.push(put(new THREE.BoxGeometry(0.06, 0.36, 0.56), x, y + 0.2, z, ry));
    buckets.steel.push(put(new THREE.BoxGeometry(0.16, 0.06, 0.2), x, y + 0.02, z, ry));
    if (on) glow.cold.push(put(new THREE.BoxGeometry(0.02, 0.28, 0.46), x + 0.04 * Math.cos(ry), y + 0.2, z + 0.04 * Math.sin(ry), ry));
  };
  const locker = (x, z, ry = 0, n = 3) => {
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.62;
      buckets.steel.push(put(new THREE.BoxGeometry(0.6, 1.9, 0.5), x + off * Math.cos(ry), 0.95, z + off * Math.sin(ry), ry));
    }
    solid(n * 0.62 * Math.abs(Math.cos(ry)) + 0.5 * Math.abs(Math.sin(ry)),
          0.5 * Math.abs(Math.cos(ry)) + n * 0.62 * Math.abs(Math.sin(ry)), x, z, 1.9, 0);
  };
  const shelf = (x, z, ry = 0, len = 3.4, y0 = 0) => {
    for (let i = 0; i < 3; i++) {
      buckets.rust.push(put(new THREE.BoxGeometry(len, 0.06, 0.75), x, y0 + 0.5 + i * 0.72, z, ry));
    }
    for (const dx of [-len / 2 + 0.1, len / 2 - 0.1]) {
      buckets.rust.push(put(new THREE.BoxGeometry(0.09, 2.2, 0.75), x + dx * Math.cos(ry), y0 + 1.1, z + dx * Math.sin(ry), ry));
    }
    solid(len * Math.abs(Math.cos(ry)) + 0.75 * Math.abs(Math.sin(ry)),
          0.75 * Math.abs(Math.cos(ry)) + len * Math.abs(Math.sin(ry)), x, z, y0 + 2.2, y0);
  };
  const crate = (x, y, z, s = 1) => {
    buckets.crate.push(put(new THREE.BoxGeometry(1.1 * s, 0.9 * s, 1.1 * s), x, y + 0.45 * s, z));
    solid(1.1 * s, 1.1 * s, x, z, y + 0.9 * s, y);
  };
  const rack = (x, z, ry = 0, y0 = 0) => {
    buckets.steel.push(put(new THREE.BoxGeometry(0.9, 2.1, 1.0), x, y0 + 1.05, z, ry));
    solid(0.9, 1.0, x, z, y0 + 2.1, y0);
    for (let i = 0; i < 7; i++) {
      glow.cold.push(put(new THREE.BoxGeometry(0.03, 0.03, 0.5),
        x + 0.46 * Math.cos(ry), y0 + 0.35 + i * 0.25, z + 0.46 * Math.sin(ry), ry));
    }
  };
  const pipe = (x1, z1, x2, z2, y, r = 0.11) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ry = Math.atan2(x2 - x1, z2 - z1);
    const g = new THREE.CylinderGeometry(r, r, len, 7);
    g.rotateX(Math.PI / 2);
    buckets.rust.push(put(g, (x1 + x2) / 2, y, (z1 + z2) / 2, ry));
  };
  const sign = (x, y, z, ry, kind = 'cold') => {
    glow[kind].push(put(new THREE.BoxGeometry(1.1, 0.24, 0.05), x, y, z, ry));
  };
  const strip = (x, z, y = G - 0.35, len = 2.2, ry = 0) => {
    glow.warm.push(put(new THREE.BoxGeometry(len, 0.08, 0.16), x, y, z, ry));
  };

  // reception
  desk(0, -4.5); monitor(0, 0.78, -4.5, 0, false);
  desk(-4, -9, 0.4); desk(4.4, -9.5, -0.3);
  locker(-10.5, -12, 0);
  for (const z of [-3, -8, -12]) { strip(-6, z); strip(6, z); }
  sign(0, 2.6, -14.2, 0);
  crate(8.5, 0, -12); crate(9.6, 0, -12.6, 0.8);

  // checkpoint
  desk(18, -3, 0); monitor(18, 0.78, -3, 0);
  box('steel', 3.6, 1.1, 0.25, 18, 0.55, -6.5);
  locker(22.6, -9, Math.PI / 2, 2);
  strip(18, -4); strip(18, -10);

  // security room
  desk(18, -16, 0); monitor(17.2, 0.78, -16, 0); monitor(18.8, 0.78, -16, 0, false);
  for (let i = 0; i < 4; i++) monitor(14.4, 1.6 + i * 0.5, -18 - (i % 2) * 0.8, Math.PI / 2, i !== 2);
  locker(22.5, -22, Math.PI / 2, 3);
  strip(18, -20);
  anchors.securityTerminal = new THREE.Vector3(18, 1.0, -15.2);
  anchors.securityDoor = new THREE.Vector3(21.6, 0, -12);

  // offices: cubicle desks, some overturned
  for (let i = 0; i < 8; i++) {
    const x = -27 + (i % 4) * 4.4;
    const z = -6 - Math.floor(i / 4) * 7;
    desk(x, z, i % 3 === 0 ? 0.5 : 0);
    if (i % 3 !== 1) monitor(x, 0.78, z, 0, i % 4 === 0);
    if (i % 4 === 2) box('steel', 0.5, 0.9, 0.5, x + 1.4, 0.45, z + 0.9);
  }
  for (const z of [-6, -13, -20]) strip(-21, z, G - 0.35, 3.0);
  locker(-29.4, -23, Math.PI / 2, 3);
  anchors.officeDocument = new THREE.Vector3(-18.6, 0.85, -13);

  // main corridor: long, with flickering lights and a landmark stripe
  for (let i = 0; i < 9; i++) strip(-28 + i * 6.5, -29, G - 0.35, 3.0);
  sign(-6, 2.9, -26.1, 0); sign(6, 2.9, -26.1, 0); sign(18, 2.9, -26.1, 0);
  pipe(-30, -30.8, 24, -30.8, G - 0.6);
  pipe(-30, -31.2, 24, -31.2, G - 0.9, 0.07);

  // storage
  for (let i = 0; i < 4; i++) shelf(-27 + i * 0.0, -35 - i * 3.2, 0, 5.0);
  crate(-19, 0, -34); crate(-19, 0.9, -34); crate(-20.4, 0, -35.4, 1.2);
  crate(-24, 0, -46); crate(-22.4, 0, -45.6, 0.9);
  strip(-23, -36); strip(-23, -44);

  // medical
  for (const z of [-35, -39, -43]) {
    box('steel', 0.9, 0.6, 2.0, -11, 0.55, z);
    box('panel', 0.86, 0.12, 1.9, -11, 0.92, z, false);
  }
  locker(-3.4, -35, Math.PI / 2, 2);
  desk(-6, -44, 0); monitor(-6, 0.78, -44, 0);
  strip(-8, -38); strip(-8, -44);
  anchors.medicalLog = new THREE.Vector3(-6, 0.85, -43.4);

  // server room
  for (let i = 0; i < 5; i++) rack(2.5 + i * 1.6, -36, 0);
  for (let i = 0; i < 5; i++) rack(2.5 + i * 1.6, -42, Math.PI);
  strip(6, -39, G - 0.35, 3.2);
  pipe(1, -44.5, 11, -44.5, 3.4, 0.09);
  anchors.serverTerminal = new THREE.Vector3(6, 1.0, -39);

  // maintenance / generator
  box('rust', 3.2, 2.0, 1.8, 20, 1.0, -36);
  box('steel', 1.0, 1.2, 1.0, 22.4, 0.6, -36);
  pipe(16, -38, 25, -38, 2.6, 0.16);
  pipe(16, -38.6, 25, -38.6, 3.1, 0.12);
  shelf(24.6, -44, Math.PI / 2, 3.0);
  lamp('hazard', 0.4, 0.1, 0.1, 20, 2.2, -35);
  anchors.generator = new THREE.Vector3(20, 1.2, -34.6);

  // rear corridor + loading bay
  for (let i = 0; i < 8; i++) strip(-26 + i * 7, -49, G - 0.35, 2.6);
  crate(6, 0, -54); crate(6, 0.9, -54); crate(7.6, 0, -55.2, 1.1);
  crate(20, 0, -57, 1.3); crate(22.2, 0, -56, 1.0);
  shelf(28.6, -55, Math.PI / 2, 4.0);
  vehicle(14, -56, 0.02, 6.0);
  strip(16, -58, G - 0.35, 3.4);
  anchors.extraction = new THREE.Vector3(18, 0, -60);

  // basement corridor
  for (let i = 0; i < 7; i++) strip(0, -26 - i * 3.2, BASE_Y + BH - 0.3, 1.8);
  pipe(-5, -47, -5, -24, BASE_Y + BH - 0.5, 0.13);
  pipe(5, -47, 5, -24, BASE_Y + BH - 0.5, 0.13);
  sign(0, BASE_Y + 2.6, -24.2, 0, 'hazard');

  // laboratory: deliberately wrecked
  for (let i = 0; i < 6; i++) {
    const x = -23 + (i % 3) * 5.5, z = -31 - Math.floor(i / 3) * 6;
    box('steel', 2.6, 0.9, 1.0, x, 0.45 + BASE_Y, z);
    if (i % 2 === 0) monitor(x, BASE_Y + 0.95, z, 0.7, false);
  }
  shelf(-25.4, -40, Math.PI / 2, 4.0, BASE_Y);
  crate(-10, BASE_Y, -44, 0.9);
  strip(-16, -32, BASE_Y + BH - 0.3, 2.4); strip(-16, -42, BASE_Y + BH - 0.3, 2.4);
  anchors.labTerminal = new THREE.Vector3(-17.5, BASE_Y + 1.0, -30.5);
  anchors.labDoor = new THREE.Vector3(-6, BASE_Y, -36);

  // armory
  for (let i = 0; i < 4; i++) locker(10 + i * 1.3, -30, 0, 1);
  shelf(22.6, -36, Math.PI / 2, 4.0, BASE_Y);
  crate(16, BASE_Y, -42); crate(17.4, BASE_Y, -41.4, 0.85);
  strip(16, -36, BASE_Y + BH - 0.3, 2.6);
  anchors.armoryCache = new THREE.Vector3(12, BASE_Y + 0.9, -31);

  // ------------------------------------------------- exterior architecture
  //
  // A brick plane with nothing on it reads as a texture swatch, not a building.
  // Everything below is what makes an elevation look built: openings with real
  // reveals and frames, a roof edge, rainwater goods, plant and signage.

  // A window: recessed reveal, dark glass, frame, mullion and a projecting
  // cill. Not a hole -- the rooms behind are separate -- but built in layers so
  // it reads as joinery rather than a painted-on rectangle.
  const windowUnit = (x, y, z, w, h, axis, face) => {
    const n = axis === 'z' ? [0, face] : [face, 0];
    const ox = n[0] * 0.16, oz = n[1] * 0.16;
    const dim = (bw, bh, bd) => (axis === 'z' ? [bw, bh, bd] : [bd, bh, bw]);

    let d0 = dim(w, h, 0.06);
    box('paintMetal', d0[0], d0[1], d0[2], x - ox * 0.2, y, z - oz * 0.2, false);

    d0 = dim(w - 0.12, h - 0.12, 0.04);
    buckets.glass.push(put(scaleBoxUV(new THREE.BoxGeometry(d0[0], d0[1], d0[2]),
      d0[0], d0[1], d0[2], TILE.glass), x - ox * 0.1, y, z - oz * 0.1));

    d0 = dim(w, 0.09, 0.10);
    box('steel', d0[0], d0[1], d0[2], x + ox, y + h / 2, z + oz, false);
    box('steel', d0[0], d0[1], d0[2], x + ox, y - h / 2, z + oz, false);
    d0 = dim(0.09, h, 0.10);
    const jx = axis === 'z' ? w / 2 : 0;
    const jz = axis === 'z' ? 0 : w / 2;
    box('steel', d0[0], d0[1], d0[2], x + ox - jx, y, z + oz - jz, false);
    box('steel', d0[0], d0[1], d0[2], x + ox + jx, y, z + oz + jz, false);
    box('steel', d0[0], d0[1], d0[2], x + ox, y, z + oz, false);

    d0 = dim(w + 0.2, 0.10, 0.26);
    box('painted', d0[0], d0[1], d0[2], x + n[0] * 0.06, y - h / 2 - 0.09, z + n[1] * 0.06, false);
  };

  // Roof edge: coping plus a gutter, which is what stops a building looking
  // like an extruded rectangle.
  const roofEdge = (x1, z1, x2, z2, y) => {
    const horiz = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const len = Math.hypot(x2 - x1, z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    if (horiz) {
      box('painted', len, 0.34, 0.62, cx, y + 0.17, cz, false);
      box('paintMetal', len, 0.16, 0.20, cx, y - 0.12, cz + (z1 > -30 ? 0.34 : -0.34), false);
    } else {
      box('painted', 0.62, 0.34, len, cx, y + 0.17, cz, false);
      box('paintMetal', 0.20, 0.16, len, cx + (x1 > 0 ? 0.34 : -0.34), y - 0.12, cz, false);
    }
  };

  const downpipe = (x, z, yTop, yBot) => {
    const h = yTop - yBot;
    box('paintMetal', 0.16, h, 0.16, x, yBot + h / 2, z, false);
    box('paintMetal', 0.24, 0.08, 0.24, x, yBot + 0.25, z, false);
    box('paintMetal', 0.24, 0.08, 0.24, x, yTop - 0.4, z, false);
  };

  const acUnit = (x, y, z, w) => {
    const ww = w || 1.3;
    box('steel', ww, 0.85, 0.75, x, y, z, false);
    for (let i = 0; i < 5; i++) {
      box('paintMetal', ww - 0.18, 0.06, 0.04, x, y - 0.3 + i * 0.15, z + 0.39, false);
    }
    box('rust', 0.5, 0.12, 0.5, x, y - 0.48, z, false);
  };

  const louvre = (x, y, z, w, h, axis) => {
    const d = axis === 'z' ? [w, h, 0.1] : [0.1, h, w];
    box('paintMetal', d[0], d[1], d[2], x, y, z, false);
    const n = Math.max(2, Math.round(h / 0.12));
    for (let i = 0; i < n; i++) {
      const yy = y - h / 2 + 0.06 + i * (h / n);
      const sdim = axis === 'z' ? [w - 0.08, 0.04, 0.14] : [0.14, 0.04, w - 0.08];
      box('steel', sdim[0], sdim[1], sdim[2], x, yy, z, false);
    }
  };

  const cctv = (x, y, z, ry) => {
    const c = Math.cos(ry), sn = Math.sin(ry);
    box('painted', 0.1, 0.1, 0.34, x + sn * 0.17, y, z + c * 0.17, false);
    box('steel', 0.22, 0.16, 0.42, x + sn * 0.42, y - 0.06, z + c * 0.42, false);
    box('rust', 0.12, 0.12, 0.1, x + sn * 0.62, y - 0.06, z + c * 0.62, false);
  };

  const bollard = (x, z) => {
    box('paintMetal', 0.16, 1.0, 0.16, x, 0.5, z);
    box('painted', 0.2, 0.1, 0.2, x, 1.02, z, false);
  };

  const bin = (x, z) => {
    box('paintMetal', 0.74, 1.05, 0.62, x, 0.52, z);
    box('steel', 0.8, 0.08, 0.68, x, 1.08, z, false);
  };

  const palletStack = (x, z, n) => {
    for (let i = 0; i < (n || 3); i++) box('rust', 1.2, 0.14, 1.0, x, 0.07 + i * 0.15, z, i === 0);
  };

  const barrier = (x, z, ry) => {
    const w = ry ? 0.3 : 2.2, d = ry ? 2.2 : 0.3;
    box('paintMetal', w, 1.05, d, x, 0.52, z);
    box('painted', w, 0.16, d + 0.02, x, 0.86, z, false);
  };

  const signPlate = (x, y, z, w, h, axis) => {
    const d = axis === 'z' ? [w, h, 0.05] : [0.05, h, w];
    box('painted', d[0], d[1], d[2], x, y, z, false);
    const f = axis === 'z' ? [w + 0.06, h + 0.06, 0.03] : [0.03, h + 0.06, w + 0.06];
    box('steel', f[0], f[1], f[2], x, y, z, false);
  };

  const kerb = (x1, z1, x2, z2) => {
    const horiz = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const len = Math.hypot(x2 - x1, z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    if (horiz) box('painted', len, 0.14, 0.32, cx, 0.07, cz, false);
    else box('painted', 0.32, 0.14, len, cx, 0.07, cz, false);
  };
  const paintLine = (x, z, w, d) => box('painted', w, 0.02, d, x, 0.015, z, false);
  const manhole = (x, z) => {
    box('rust', 0.78, 0.04, 0.78, x, 0.022, z, false);
    box('steel', 0.62, 0.05, 0.62, x, 0.028, z, false);
  };

  // ---- front elevation ----
  for (const wx of [-28, -24, -20, -16, -12, 12, 16, 20, 24, 28]) windowUnit(wx, 2.5, -0.30, 2.0, 1.5, 'z', 1);
  box('painted', 4.6, 0.45, 0.5, 0, 3.35, -0.30, false);
  box('steel', 4.2, 0.12, 1.5, 0, 3.1, 0.35, false);
  box('steel', 0.12, 3.0, 0.12, -1.9, 1.5, 1.0);
  box('steel', 0.12, 3.0, 0.12, 1.9, 1.5, 1.0);
  signPlate(0, 3.9, -0.26, 5.2, 0.7, 'z');
  cctv(-3.2, 3.6, -0.3, Math.PI);
  cctv(3.2, 3.6, -0.3, Math.PI);

  // ---- side and rear elevations ----
  for (const wz of [-6, -12, -18, -24, -30, -36, -42, -48, -54]) {
    windowUnit(-31.22, 2.6, wz, 1.6, 1.4, 'x', -1);
    windowUnit(31.22, 2.6, wz, 1.6, 1.4, 'x', 1);
  }
  roofEdge(-31, -0.5, 31, -0.5, G);
  roofEdge(-31, -61, 31, -61, G);
  roofEdge(-31, -0.5, -31, -61, G);
  roofEdge(31, -0.5, 31, -61, G);
  for (const dp of [[-31.3, -12], [-31.3, -40], [31.3, -12], [31.3, -40], [-12, -0.22], [12, -0.22]]) {
    downpipe(dp[0], dp[1], G - 0.3, 0);
  }
  acUnit(30.0, 2.6, -20); acUnit(30.0, 2.6, -26); acUnit(30.0, 2.6, -32, 1.6);
  louvre(-31.22, 2.2, -30, 1.8, 1.2, 'x');
  louvre(31.22, 2.2, -46, 2.2, 1.4, 'x');
  louvre(0, 2.4, -61.22, 2.4, 1.2, 'z');
  cctv(-31.3, 3.3, -30, Math.PI / 2);
  cctv(22, 3.3, -60.5, 0);

  // ---- the yard ----
  kerb(-28, 13.6, 28, 13.6);
  kerb(-28, 1.2, -10, 1.2);
  kerb(10, 1.2, 28, 1.2);
  for (let i = 0; i < 9; i++) paintLine(-24 + i * 6, 24, 0.12, 5.0);
  for (let i = 0; i < 9; i++) paintLine(-24 + i * 6, 34, 0.12, 5.0);
  paintLine(0, 21.4, 52, 0.14);
  paintLine(0, 36.6, 52, 0.14);
  for (let i = 0; i < 14; i++) paintLine(-26 + i * 4, 9, 1.8, 0.16);
  manhole(-8, 10); manhole(14, 6); manhole(-20, 30);
  for (const bx of [-7.4, -5.2, 5.2, 7.4]) bollard(bx, 2.6);
  bin(-13, 2.4); bin(-11.6, 2.4);
  palletStack(22, 4, 4); palletStack(23.4, 5.2, 2);
  barrier(-16, 12); barrier(16, 12);
  signPlate(-4.6, 2.4, 14.2, 1.3, 0.9, 'z');
  signPlate(9, 2.1, 11.9, 1.1, 0.8, 'z');

  // ---- loading yard behind ----
  kerb(4, -62.4, 30, -62.4);
  palletStack(26, -59, 3); palletStack(27.4, -60.2, 2);
  bin(6, -62); barrier(12, -62.6);
  signPlate(18, 3.2, -61.26, 2.6, 0.6, 'z');

  // scattered debris through the whole building
  const rnd = (() => { let s = 4242; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  for (let i = 0; i < 90; i++) {
    const x = -30 + rnd() * 60, z = -60 + rnd() * 58;
    const y = (z > -47 && z < -23 && x > -28 && x < 26 && rnd() < 0.35) ? BASE_Y : 0;
    buckets.rust.push(put(new THREE.BoxGeometry(0.2 + rnd() * 0.4, 0.06 + rnd() * 0.1, 0.2 + rnd() * 0.4),
      x, y + 0.04, z, rnd() * 3));
  }

  // ---------------------------------------------------------------- merge

  const statics = [];
  const addMerged = (geos, mat) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m); statics.push(m);
  };
  addMerged(buckets.floor, mats.concreteFloor);
  addMerged(buckets.asphalt, mats.asphalt);
  addMerged(buckets.ceil, mats.ceilingTile);
  addMerged(buckets.brick, mats.brick);
  addMerged(buckets.painted, mats.painted);
  addMerged(buckets.plaster, mats.plaster);
  addMerged(buckets.panel, mats.panel);
  addMerged(buckets.paintMetal, mats.paintMetal);
  addMerged(buckets.glass, mats.glass);
  addMerged(buckets.gunMetalBucket, mats.gunMetal);
  addMerged(buckets.steel, mats.steel);
  addMerged(buckets.rust, mats.rust);
  addMerged(buckets.crate, mats.crate);

  const glowMesh = {};
  const addGlow = (geos, hex, key) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos, false),
      new THREE.MeshBasicMaterial({ color: hex, fog: true }));
    scene.add(m); glowMesh[key] = m;
  };
  addGlow(glow.warm, PAL.workLight, 'warm');
  addGlow(glow.cold, 0x63d8ff, 'cold');
  addGlow(glow.hazard, PAL.hazard, 'hazard');

  const spawn = { x: 0, z: 34, yaw: 0 };     // in the car park, facing the building

  return { colliders, voids, areas, anchors, statics, lights, glowMesh, spawn,
           BASE_Y, WALL_H };
}
