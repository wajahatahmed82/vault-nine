// Uniform 2D grid over collider boxes.
//
// The station had ~600 colliders and every movement, floor and sight test
// walked all of them. The town adds hundreds more, and that linear scan would
// have become the most expensive thing in the frame. The grid hands each query
// only the boxes in the cells it touches.
//
// Colliders are plain objects { minX, maxX, minZ, maxZ, top, bottom? }. Their
// X/Z extents must not change after `add` (doors sink their top/bottom instead,
// which is fine). Queries dedupe with a stamp written onto each collider.

export class CollisionGrid {
  constructor(cell = 8) {
    this.cell = cell;
    this.map = new Map();
    this.all = [];
    this.stamp = 1;
    this.out = [];
  }

  _key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }

  add(c) {
    c._q = 0;
    this.all.push(c);
    const s = this.cell;
    const x0 = Math.floor(c.minX / s), x1 = Math.floor(c.maxX / s);
    const z0 = Math.floor(c.minZ / s), z1 = Math.floor(c.maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let b = this.map.get(k);
        if (!b) { b = []; this.map.set(k, b); }
        b.push(c);
      }
    }
  }

  // Boxes whose cells overlap the rectangle. Returns a shared array: copy it if
  // you need it to survive the next query.
  query(minX, minZ, maxX, maxZ) {
    const out = this.out;
    out.length = 0;
    const q = ++this.stamp;
    const s = this.cell;
    const x0 = Math.floor(minX / s), x1 = Math.floor(maxX / s);
    const z0 = Math.floor(minZ / s), z1 = Math.floor(maxZ / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const b = this.map.get(this._key(ix, iz));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) {
          const c = b[i];
          if (c._q === q) continue;
          c._q = q;
          out.push(c);
        }
      }
    }
    return out;
  }

  // Walk the cells a 2D segment crosses, in order (Amanatides & Woo). `fn(c)`
  // sees each box once; return true from it to stop early.
  segment(ax, az, bx, bz, fn) {
    const q = ++this.stamp;
    const s = this.cell;
    let ix = Math.floor(ax / s), iz = Math.floor(az / s);
    const ex = Math.floor(bx / s), ez = Math.floor(bz / s);
    const dx = bx - ax, dz = bz - az;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(s / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(s / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (ix + 1) * s - ax : ax - ix * s) / Math.abs(dx)) : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (iz + 1) * s - az : az - iz * s) / Math.abs(dz)) : Infinity;
    for (let guard = 0; guard < 4096; guard++) {
      const b = this.map.get(this._key(ix, iz));
      if (b) {
        for (let i = 0; i < b.length; i++) {
          const c = b[i];
          if (c._q === q) continue;
          c._q = q;
          if (fn(c)) return true;
        }
      }
      if (ix === ex && iz === ez) break;
      if (tmx < tmz) { if (tmx > 1) break; tmx += tdx; ix += stepX; }
      else { if (tmz > 1) break; tmz += tdz; iz += stepZ; }
    }
    return false;
  }
}

// Ray against one box over t in [0, tMax]. Returns the entry distance and the
// face axis it entered through, or null. Starting inside a box is not a hit:
// that is how bullets leave the cover the shooter is standing against.
export function rayBox(ox, oy, oz, dx, dy, dz, tMax, c) {
  let t0 = 0, t1 = tMax, axis = -1;
  const bottom = c.bottom === undefined ? -1e4 : c.bottom;
  const lo = [c.minX, bottom, c.minZ], hi = [c.maxX, c.top, c.maxZ];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) {
      if (o[k] < lo[k] || o[k] > hi[k]) return null;
      continue;
    }
    let a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) { t0 = a; axis = k; }
    if (b < t1) t1 = b;
    if (t1 < t0) return null;
  }
  if (axis < 0) return null;
  return { t: t0, axis, sign: d[axis] > 0 ? -1 : 1 };
}
