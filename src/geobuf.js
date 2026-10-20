import * as THREE from 'three';

// Fast geometry writer for generated buildings.
//
// A town is tens of thousands of boxes. Building a THREE.BoxGeometry for each
// and merging them allocates a mesh object per box and costs seconds; writing
// vertices straight into flat arrays costs milliseconds. Every face carries
// position, normal, UV in metres (so a texture added later tiles at real
// scale) and a vertex colour.

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export class GeoBuf {
  // opts.layer / opts.base / opts.win add the per-vertex attributes the town
  // materials read: texture-array layer, wall-foot height for contact shadow,
  // window id for the interior shader. Set this.L / this.B / this.W before
  // emitting; this.su / this.sv scale UVs (metres -> texture repeats).
  constructor(opts = {}) {
    this.p = []; this.n = []; this.u = []; this.c = [];
    this.opts = opts;
    this.l = opts.layer ? [] : null;
    this.b = opts.base ? [] : null;
    this.w = opts.win ? [] : null;
    this.L = 0; this.B = -1000; this.W = 0; this.su = 1; this.sv = 1;
    this.tris = 0;
  }

  // Colours are written as sRGB (what a colour picker shows) and stored
  // linear, which is what three.js expects of vertex colours. Without the
  // conversion every surface renders washed out.
  _v(x, y, z, nx, ny, nz, u, v, col) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u * this.su, v * this.sv);
    if (this.l) this.l.push(this.L);
    if (this.b) this.b.push(this.B);
    if (this.w) this.w.push(this.W);
    if (col !== this._lc) { this._lc = col; this._ll = [lin(col[0]), lin(col[1]), lin(col[2])]; }
    this.c.push(this._ll[0], this._ll[1], this._ll[2]);
  }

  // Quad from four corners in order around the edge. `out` is any vector
  // pointing out of the visible side; the winding is fixed to match it.
  quad(a, b, c, d, out, col, uvs) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let flip = out && (nx * out[0] + ny * out[1] + nz * out[2]) < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const t = uvs || [0, 0, 1, 0, 1, 1, 0, 1];
    // two triangles a-b-c, a-c-d (counter-clockwise from the normal side)
    const order = flip ? [0, 3, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3];
    const P = [a, b, c, d];
    for (const k of order) this._v(P[k][0], P[k][1], P[k][2], nx, ny, nz, t[k * 2], t[k * 2 + 1], col);
    this.tris += 2;
  }

  tri(a, b, c, out, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const flip = out && (nx * out[0] + ny * out[1] + nz * out[2]) < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const P = flip ? [a, c, b] : [a, b, c];
    // planar UV in metres along the dominant axes
    for (const q of P) {
      const uu = Math.abs(nx) > Math.abs(nz) ? q[2] : q[0];
      this._v(q[0], q[1], q[2], nx, ny, nz, uu, q[1], col);
    }
    this.tris += 1;
  }

  // Box centred at (cx,cy,cz), sizes along its own axes, turned about Y by the
  // angle whose cos/sin are given. Bottom face skipped unless asked for: almost
  // nothing in a town is seen from below.
  box(cx, cy, cz, sx, sy, sz, cs, sn, col, bottom) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const W = (lx, ly, lz) => [cx + lx * cs + lz * sn, cy + ly, cz - lx * sn + lz * cs];
    const R = (lx, lz) => [lx * cs + lz * sn, 0, -lx * sn + lz * cs];
    const u = (a, b) => [0, 0, a, 0, a, b, 0, b];
    // +X
    this.quad(W(hx, -hy, hz), W(hx, -hy, -hz), W(hx, hy, -hz), W(hx, hy, hz), R(1, 0), col, u(sz, sy));
    // -X
    this.quad(W(-hx, -hy, -hz), W(-hx, -hy, hz), W(-hx, hy, hz), W(-hx, hy, -hz), R(-1, 0), col, u(sz, sy));
    // +Z
    this.quad(W(-hx, -hy, hz), W(hx, -hy, hz), W(hx, hy, hz), W(-hx, hy, hz), R(0, 1), col, u(sx, sy));
    // -Z
    this.quad(W(hx, -hy, -hz), W(-hx, -hy, -hz), W(-hx, hy, -hz), W(hx, hy, -hz), R(0, -1), col, u(sx, sy));
    // top
    this.quad(W(-hx, hy, hz), W(hx, hy, hz), W(hx, hy, -hz), W(-hx, hy, -hz), [0, 1, 0], col, u(sx, sz));
    if (bottom) this.quad(W(-hx, -hy, -hz), W(hx, -hy, -hz), W(hx, -hy, hz), W(-hx, -hy, hz), [0, -1, 0], col, u(sx, sz));
  }

  // Upright cylinder with a cone cap (water tower tank, silos).
  cylinder(cx, y0, cz, r, h, seg, col, cap) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const am = (a0 + a1) / 2;
      this.quad([x0, y0, z0], [x1, y0, z1], [x1, y0 + h, z1], [x0, y0 + h, z0],
        [Math.cos(am), 0, Math.sin(am)], col, [0, 0, r * 0.4, 0, r * 0.4, h, 0, h]);
      if (cap) this.tri([x0, y0 + h, z0], [x1, y0 + h, z1], [cx, y0 + h + cap, cz],
        [Math.cos(am), 0.6, Math.sin(am)], col);
    }
  }

  get empty() { return this.p.length === 0; }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.l) g.setAttribute('layer', new THREE.Float32BufferAttribute(this.l, 1));
    if (this.b) g.setAttribute('aobase', new THREE.Float32BufferAttribute(this.b, 1));
    if (this.w) g.setAttribute('win', new THREE.Float32BufferAttribute(this.w, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
