import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { TOUCH_ONLY } from './input.js';
import * as audio from './audio.js';

// Combat and weather effects (graphics prompt 2, Phase 4). Everything is made
// here in code: no texture or model files.
//
//   smoke   lit, soft particles: a 4x4 atlas of noise puffs whose texels carry
//           a normal, lit by the sun, the sky/ground ambient and up to two
//           nearby lights (muzzle flashes, blasts, fires), faded where they
//           meet geometry (a half-res linear depth copy of the world pass)
//   fire    additive, a temperature ramp from white through orange to soot,
//           over 1.0 so it blooms
//   sparks  additive streaks stretched along their velocity
//   debris  instanced chips, splinters, shards and clods that bounce
//   casings instanced brass that bounces, clinks and stays a while
//
// Particles live in their own scene, drawn after the world (before the weapon
// pass) by Game.renderScene: three draw calls whatever is going on. Pools are
// fixed size; nothing allocates per frame.

const N = 4;                         // atlas is N x N cells
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------ noise --
function hash2(ix, iy, s) {
  let h = (ix * 374761393 + iy * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash2(xi, yi, s) * (1 - u) + hash2(xi + 1, yi, s) * u) * (1 - v) + (hash2(xi, yi + 1, s) * (1 - u) + hash2(xi + 1, yi + 1, s) * u) * v;
}
function fbm(x, y, s, oct) {
  let a = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { a += vnoise(x * f, y * f, s + i * 17) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return a / n;
}
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function dataTex(data, S) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Smoke puffs: alpha is density, rgb a normal in billboard space (a bulging
// sphere roughened by the density's own slope), so the puffs shade.
function smokeAtlas(C) {
  const S = C * N, data = new Uint8Array(S * S * 4), h = new Float32Array(C * C);
  for (let k = 0; k < N * N; k++) {
    const ox = (k % N) * C, oy = Math.floor(k / N) * C, seed = k * 31 + 7;
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1;
        const n1 = fbm(u * 2.2 + k * 3.7, v * 2.2 - k, seed, 5), n2 = fbm(u * 4.1 - k, v * 4.1 + k * 1.3, seed + 5, 3);
        const r = Math.hypot(u, v) + (n2 - 0.5) * 0.55;
        h[y * C + x] = Math.min(1, Math.max(0, sstep(1.0, 0.3, r) * (0.3 + 0.95 * n1)));
      }
    }
    const at = (x, y) => h[Math.min(C - 1, Math.max(0, y)) * C + Math.min(C - 1, Math.max(0, x))];
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1;
        const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
        const sz = Math.sqrt(Math.max(0, 1 - u * u - v * v));
        let nx = u * 0.75 - gx * C * 0.06, ny = v * 0.75 - gy * C * 0.06, nz = sz * 0.75 + 0.3;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const o = ((oy + y) * S + ox + x) * 4;
        data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (ny * 0.5 + 0.5) * 255; data[o + 2] = (nz * 0.5 + 0.5) * 255;
        data[o + 3] = at(x, y) * 255;
      }
    }
  }
  return dataTex(data, S);
}

// Fire and flash shapes in alpha: 0-11 flame tongues and fireball lumps,
// 12 a soft glow, 13 a muzzle star, 14 a muzzle side-flash, 15 a ring.
function fireAtlas(C) {
  const S = C * N, data = new Uint8Array(S * S * 4);
  for (let k = 0; k < N * N; k++) {
    const ox = (k % N) * C, oy = Math.floor(k / N) * C, seed = k * 53 + 3;
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1, r = Math.hypot(u, v), a = Math.atan2(v, u);
        let I;
        if (k < 12) {
          // a tongue: wide and dense low, torn into wisps higher up
          const n = fbm(u * 2.6 + k * 1.9, v * 2.0 - k * 0.7, seed, 5);
          const w = 0.75 - 0.35 * (v * 0.5 + 0.5);
          const shape = sstep(1.0, 0.2, Math.hypot(u / Math.max(0.2, w), (v + 0.15) * 0.9) + (n - 0.5) * 0.9);
          I = shape * (0.4 + 0.8 * n);
        } else if (k === 12) I = Math.exp(-r * r * 4.5);
        else if (k === 13) {
          const spikes = Math.pow(Math.abs(Math.cos(a * 2.5 + 0.3)), 10) * sstep(1.0, 0.1, r);
          I = Math.exp(-r * r * 9) + spikes * 0.9 + fbm(a * 3, r * 6, seed, 3) * Math.exp(-r * 3) * 0.4;
        } else if (k === 14) {
          // forward cone from the left edge
          const along = (u + 1) / 2;
          I = Math.exp(-Math.pow(v / (0.12 + along * 0.35), 2)) * sstep(1.0, 0.75, along) * sstep(0.0, 0.08, along) * (0.6 + 0.6 * fbm(u * 5, v * 5, seed, 3));
        } else I = Math.exp(-Math.pow((r - 0.72) / 0.08, 2));
        const o = ((oy + y) * S + ox + x) * 4;
        const c = Math.min(255, Math.max(0, I * 255));
        data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = c;
      }
    }
  }
  return dataTex(data, S);
}

// ------------------------------------------------------------ shaders --
const VERT = `
  attribute vec4 aPos;   // xyz, size
  attribute vec4 aData;  // rotation, atlas cell, alpha, heat
  attribute vec4 aCol;   // rgb, glow
  varying vec2 vUv; varying vec4 vCol; varying vec4 vData; varying vec3 vView; varying float vSize;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = viewMatrix * vec4( aPos.xyz, 1.0 );
    float c = cos( aData.x ), s = sin( aData.x );
    mvPosition.xy += vec2( c * position.x - s * position.y, s * position.x + c * position.y ) * aPos.w;
    gl_Position = projectionMatrix * mvPosition;
    vUv = ( vec2( mod( aData.y, 4.0 ), floor( aData.y / 4.0 ) ) + uv ) * 0.25;
    vCol = aCol; vData = aData; vView = mvPosition.xyz; vSize = aPos.w;
    #include <fog_vertex>
  }`;

const SOFT = `
  uniform sampler2D uDepth; uniform vec2 uRes; uniform float uSoft;
  float softFade( float size ) {
    float k = smoothstep( 0.25, 1.1, -vView.z );          // not in the player's face
    if ( uSoft > 0.5 ) {
      float scene = texture2D( uDepth, gl_FragCoord.xy / uRes ).r;
      k *= clamp( ( scene + vView.z ) / max( 0.25, size * 0.35 ), 0.0, 1.0 );
    }
    return k;
  }
  float fogAmount() {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
      #else
        return smoothstep( fogNear, fogFar, vFogDepth );
      #endif
    #else
      return 0.0;
    #endif
  }`;

const SMOKE_FRAG = `
  uniform sampler2D uAtlas;
  uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uUp;
  uniform vec4 uL0; uniform vec3 uL0c; uniform vec4 uL1; uniform vec3 uL1c;
  varying vec2 vUv; varying vec4 vCol; varying vec4 vData; varying vec3 vView; varying float vSize;
  #include <fog_pars_fragment>
  ${SOFT}
  vec3 pointLight( vec4 L, vec3 c, vec3 n ) {
    vec3 d = L.xyz - vView; float r = length( d );
    float att = clamp( 1.0 - r / L.w, 0.0, 1.0 ); att *= att;
    return c * att * ( dot( n, d / max( r, 1e-3 ) ) * 0.45 + 0.55 );
  }
  void main() {
    vec4 t = texture2D( uAtlas, vUv );
    float dens = t.a;
    float a = dens * vData.z;
    if ( a < 0.004 ) discard;
    vec3 nb = t.rgb * 2.0 - 1.0;
    float c = cos( vData.x ), s = sin( vData.x );
    vec3 n = normalize( vec3( c * nb.x - s * nb.y, s * nb.x + c * nb.y, nb.z ) );
    // wrapped diffuse, darker where the puff is thick; light scattered
    // through the thin edges when looking towards the sun
    float wrap = clamp( dot( n, uSunDir ) * 0.6 + 0.4, 0.0, 1.0 ) * ( 1.0 - 0.4 * dens );
    float fwd = pow( max( dot( normalize( vView ), uSunDir ), 0.0 ), 6.0 ) * ( 1.0 - dens ) * 1.4;
    vec3 lit = mix( uGround, uSky, dot( n, uUp ) * 0.5 + 0.5 ) + uSunCol * ( wrap + fwd );
    lit += pointLight( uL0, uL0c, n ) + pointLight( uL1, uL1c, n );
    vec3 col = vCol.rgb * lit + vec3( 1.0, 0.42, 0.12 ) * vCol.a * 3.0 * dens;
    gl_FragColor = vec4( col, a * softFade( vSize ) );
    #include <fog_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const FIRE_FRAG = `
  uniform sampler2D uAtlas; uniform float uHDR;
  varying vec2 vUv; varying vec4 vCol; varying vec4 vData; varying vec3 vView; varying float vSize;
  #include <fog_pars_fragment>
  ${SOFT}
  vec3 heatRamp( float h ) {
    vec3 c = mix( vec3( 0.08, 0.01, 0.0 ), vec3( 0.9, 0.18, 0.02 ), smoothstep( 0.0, 0.35, h ) );
    c = mix( c, vec3( 1.0, 0.55, 0.12 ), smoothstep( 0.3, 0.65, h ) );
    return mix( c, vec3( 1.0, 0.92, 0.75 ), smoothstep( 0.65, 1.0, h ) );
  }
  void main() {
    float I = texture2D( uAtlas, vUv ).a;
    float a = I * vData.z;
    if ( a < 0.003 ) discard;
    vec3 col = heatRamp( vData.w ) * vCol.rgb * uHDR * ( 0.35 + vData.w * 1.6 );
    // premultiplied, drawn over: overlapping lumps keep their colour and
    // shape instead of adding up to white, and cooled soot hides what is behind
    float k = a * softFade( vSize ) * ( 1.0 - fogAmount() );
    gl_FragColor = vec4( col * k, k * 0.9 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Streaks: aCol.xyz is the velocity; the quad runs from the particle back
// along it, width aPos.w.
const SPARK_VERT = `
  attribute vec4 aPos; attribute vec4 aData; attribute vec4 aCol;
  uniform float uStretch;
  varying vec2 vUv; varying vec4 vData; varying vec3 vView; varying float vSize; varying vec3 vTint;
  #include <fog_pars_vertex>
  void main() {
    vec4 v0 = viewMatrix * vec4( aPos.xyz, 1.0 );
    vec4 v1 = viewMatrix * vec4( aPos.xyz - aCol.xyz * uStretch, 1.0 );
    vec2 d = v0.xy - v1.xy; float len = length( d );
    d = len > 1e-5 ? d / len : vec2( 0.0, 1.0 );
    vec2 side = vec2( -d.y, d.x );
    vec4 mvPosition = mix( v1, v0, position.y + 0.5 );
    mvPosition.xy += side * position.x * aPos.w + d * position.y * aPos.w;
    gl_Position = projectionMatrix * mvPosition;
    vUv = uv; vData = aData; vView = mvPosition.xyz; vSize = aPos.w; vTint = vec3( aCol.w > 0.5 ? 1.0 : 0.0 );
    #include <fog_vertex>
  }`;
const SPARK_FRAG = `
  uniform float uHDR;
  varying vec2 vUv; varying vec4 vData; varying vec3 vView; varying float vSize; varying vec3 vTint;
  #include <fog_pars_fragment>
  ${SOFT}
  void main() {
    float x = vUv.x * 2.0 - 1.0;
    float I = exp( - x * x * 5.0 ) * smoothstep( 0.0, 0.25, vUv.y ) * vData.z;
    if ( I < 0.003 ) discard;
    // hot metal, or (tint) water drops lit by the sky
    vec3 hot = mix( vec3( 1.0, 0.35, 0.05 ), vec3( 1.0, 0.9, 0.6 ), vData.w );
    vec3 col = mix( hot * uHDR * ( 0.5 + vData.w ), vec3( 0.55, 0.6, 0.65 ), vTint.x );
    gl_FragColor = vec4( col * I * ( 1.0 - fogAmount() ), 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The half-res smoke and fire laid over the frame (premultiplied).
const COMPOSITE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D( tDiffuse, vUv ); }',
};

const DEPTH_COPY = {
  uniforms: { tDepth: { value: null }, uNear: { value: 0.2 }, uFar: { value: 1000 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
  fragmentShader: `uniform sampler2D tDepth; uniform float uNear; uniform float uFar; varying vec2 vUv;
    void main() {
      float d = texture2D( tDepth, vUv ).r * 2.0 - 1.0;
      float z = 2.0 * uNear * uFar / ( uFar + uNear - d * ( uFar - uNear ) );
      gl_FragColor = vec4( z, 0.0, 0.0, 1.0 );
    }`,
};

// ------------------------------------------------------------ particles --
// Struct-of-arrays pool. Dead particles are swapped out; the live ones are
// written to the instance attributes each frame (sorted far to near for the
// alpha-blended smoke).
const F = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'rot', 'rv', 'cell', 'a0', 'r', 'g', 'b', 'glow', 'grav', 'drag', 'lift', 'heat', 'cool', 'fadeIn'];
class Pool {
  constructor(max, material, sort) {
    this.max = max; this.n = 0; this.sort = sort;
    for (const k of F) this[k] = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    for (const a of [this.aPos, this.aData, this.aCol]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aData', this.aData); g.setAttribute('aCol', this.aCol);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.order = new Uint16Array(max); this.depth = new Float32Array(max);
  }

  // o: { x,y,z, vx,vy,vz, life, s0,s1, rot?, rv?, cell?, a0, r,g,b, glow?, grav?, drag?, lift?, heat?, cool?, fadeIn? }
  spawn(o) {
    let i = this.n;
    if (i >= this.max) {   // full: replace the oldest-looking one
      i = 0; let best = -1;
      for (let k = 0; k < this.max; k += 7) { const t = this.age[k] / this.life[k]; if (t > best) { best = t; i = k; } }
    } else this.n++;
    this.x[i] = o.x; this.y[i] = o.y; this.z[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    this.age[i] = 0; this.life[i] = o.life; this.s0[i] = o.s0; this.s1[i] = o.s1 === undefined ? o.s0 : o.s1;
    this.rot[i] = o.rot === undefined ? Math.random() * 6.283 : o.rot; this.rv[i] = o.rv || 0;
    this.cell[i] = o.cell === undefined ? Math.floor(Math.random() * 16) : o.cell;
    this.a0[i] = o.a0; this.r[i] = o.r; this.g[i] = o.g; this.b[i] = o.b; this.glow[i] = o.glow || 0;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0; this.lift[i] = o.lift || 0;
    this.heat[i] = o.heat || 0; this.cool[i] = o.cool || 0; this.fadeIn[i] = o.fadeIn === undefined ? 0.1 : o.fadeIn;
    return i;
  }

  kill(i) {
    const j = --this.n;
    if (i !== j) for (const k of F) this[k][i] = this[k][j];
  }

  update(dt, wx, wz, cam, kind) {
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      // drag pulls towards the wind, not to a standstill
      this.vx[i] = wx + (this.vx[i] - wx) * dr;
      this.vz[i] = wz + (this.vz[i] - wz) * dr;
      this.vy[i] = this.vy[i] * dr + (this.lift[i] - this.grav[i]) * dt;
      this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
      this.rot[i] += this.rv[i] * dt;
      this.heat[i] = Math.max(0, this.heat[i] - this.cool[i] * dt);
    }
    const n = this.n;
    let idx = this.order;
    for (let i = 0; i < n; i++) idx[i] = i;
    this._cmp = this._cmp || ((a, b) => this.depth[b] - this.depth[a]);
    if (this.sort && n > 1) {
      const D = this.depth;
      for (let i = 0; i < n; i++) { const dx = this.x[i] - cam.x, dy = this.y[i] - cam.y, dz = this.z[i] - cam.z; D[i] = dx * dx + dy * dy + dz * dz; }
      idx = idx.subarray(0, n).sort(this._cmp);
    }
    const P = this.aPos.array, Dd = this.aData.array, C = this.aCol.array;
    for (let k = 0; k < n; k++) {
      const i = idx[k], t = this.age[i] / this.life[i], o = k * 4;
      P[o] = this.x[i]; P[o + 1] = this.y[i]; P[o + 2] = this.z[i];
      P[o + 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));   // fast growth, then slow
      const fi = this.fadeIn[i];
      const a = this.a0[i] * (fi > 0 ? Math.min(1, t / fi) : 1) * (kind === 'smoke' ? Math.pow(1 - t, 1.3) : 1 - t * t);
      Dd[o] = this.rot[i]; Dd[o + 1] = this.cell[i]; Dd[o + 2] = a; Dd[o + 3] = this.heat[i];
      if (kind === 'spark') { C[o] = this.vx[i]; C[o + 1] = this.vy[i]; C[o + 2] = this.vz[i]; C[o + 3] = this.glow[i]; }
      else { C[o] = this.r[i]; C[o + 1] = this.g[i]; C[o + 2] = this.b[i]; C[o + 3] = this.glow[i] * Math.max(0, 1 - this.age[i] / 0.7); }
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) {
      for (const a of [this.aPos, this.aData, this.aCol]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }
}

// ------------------------------------------------------------ solids --
// Chips, splinters, shards, clods and casings: instanced, lit by the world's
// own lights (they live in the main scene), bounced off the floor under them.
class Solids {
  constructor(scene, geo, mat, max, opts = {}) {
    this.max = max; this.n = 0; this.opts = opts;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    const f = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'rx', 'ry', 'rz', 'wx', 'wy', 'wz', 'sx', 'sy', 'sz', 'age', 'life', 'floor', 'bounces', 'rest', 'r', 'g', 'b', 'snd'];
    for (const k of f) this[k] = new Float32Array(max);
    this.fields = f;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  spawn(o) {
    let i = this.n;
    if (i >= this.max) { i = Math.floor(Math.random() * this.max); } else this.n++;
    this.x[i] = o.x; this.y[i] = o.y; this.z[i] = o.z; this.vx[i] = o.vx; this.vy[i] = o.vy; this.vz[i] = o.vz;
    this.rx[i] = Math.random() * 6.28; this.ry[i] = Math.random() * 6.28; this.rz[i] = Math.random() * 6.28;
    const sp = o.spin === undefined ? 14 : o.spin;
    this.wx[i] = (Math.random() - 0.5) * sp; this.wy[i] = (Math.random() - 0.5) * sp; this.wz[i] = (Math.random() - 0.5) * sp;
    this.sx[i] = o.sx; this.sy[i] = o.sy === undefined ? o.sx : o.sy; this.sz[i] = o.sz === undefined ? o.sx : o.sz;
    this.age[i] = 0; this.life[i] = o.life; this.floor[i] = o.floor; this.bounces[i] = 0; this.rest[i] = 0;
    this.r[i] = o.r; this.g[i] = o.g; this.b[i] = o.b; this.snd[i] = o.snd || 0;
    return i;
  }

  kill(i) {
    const j = --this.n;
    if (i !== j) for (const k of this.fields) this[k][i] = this[k][j];
  }

  update(dt, onBounce) {
    const m = this.mesh;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
      if (!this.rest[i]) {
        this.vy[i] -= 9.8 * dt;
        const k = Math.max(0, 1 - 0.4 * dt);
        this.vx[i] *= k; this.vz[i] *= k;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
        this.rx[i] += this.wx[i] * dt; this.ry[i] += this.wy[i] * dt; this.rz[i] += this.wz[i] * dt;
        const fl = this.floor[i] + this.sy[i] * 0.4;
        if (this.y[i] < fl) {
          this.y[i] = fl;
          if (onBounce && this.bounces[i] < 2 && this.vy[i] < -1.2) onBounce(i, -this.vy[i]);
          this.bounces[i]++;
          this.vy[i] *= -0.32; this.vx[i] *= 0.55; this.vz[i] *= 0.55;
          this.wx[i] *= 0.5; this.wy[i] *= 0.5; this.wz[i] *= 0.5;
          if (Math.abs(this.vy[i]) < 0.35) {
            this.rest[i] = 1; this.vx[i] = this.vy[i] = this.vz[i] = 0;
            if (this.opts.flatRest) { this.rx[i] = Math.PI / 2; this.rz[i] = 0; }   // casings lie on their side
          }
        }
      }
      // shrink away over the last fifth of life
      const t = this.age[i] / this.life[i], k = t > 0.8 ? (1 - t) / 0.2 : 1;
      this._e.set(this.rx[i], this.ry[i], this.rz[i]);
      this._q.setFromEuler(this._e);
      this._p.set(this.x[i], this.y[i], this.z[i]);
      this._s.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k);
      m.setMatrixAt(i, this._m.compose(this._p, this._q, this._s));
      m.instanceColor.setXYZ(i, this.r[i], this.g[i], this.b[i]);
    }
    m.count = this.n;
    m.visible = this.n > 0;
    if (this.n) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }

  clear() { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; }
}

function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed();
  const p = g.attributes.position;
  // the same jitter for a shared vertex, so the chunk stays closed
  const key = (x, y, z) => Math.round(x * 100) + ',' + Math.round(y * 100) + ',' + Math.round(z * 100);
  const off = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i));
    if (!off.has(k)) off.set(k, 0.7 + hash2(i, off.size, 9) * 0.6);
    const s = off.get(k);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function casingGeometry() {
  // a brass case: body, a narrower neck, the rim; 5.6 mm x 45 mm
  const pts = [[0, -0.0225], [0.0048, -0.0225], [0.0048, -0.0205], [0.0043, -0.0200], [0.0047, -0.0195], [0.0047, 0.012], [0.0034, 0.016], [0.0032, 0.0225], [0, 0.0225]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 8);
  g.scale(1 / 0.045, 1 / 0.045, 1 / 0.045);   // unit length; the instance scale sets the size
  return g;
}

// ------------------------------------------------------------ materials --
const MATS = {
  // impact dust colours (linear-ish albedo) per surface
  brick: [0.42, 0.24, 0.17], concrete: [0.55, 0.53, 0.5], asphalt: [0.33, 0.32, 0.31], dirt: [0.33, 0.25, 0.17],
  grass: [0.31, 0.27, 0.18], wood: [0.45, 0.33, 0.2], metal: [0.4, 0.4, 0.4], glass: [0.7, 0.74, 0.76], kit: [0.4, 0.4, 0.34],
  plaster: [0.66, 0.63, 0.58],
};
const CHIPS = {
  brick: [[0.5, 0.22, 0.14], [0.6, 0.32, 0.22], [0.75, 0.7, 0.62]], concrete: [[0.55, 0.54, 0.5], [0.42, 0.41, 0.39]],
  plaster: [[0.75, 0.72, 0.66], [0.5, 0.48, 0.44]], asphalt: [[0.12, 0.12, 0.12], [0.25, 0.24, 0.23]],
  dirt: [[0.22, 0.16, 0.1], [0.3, 0.22, 0.14]], grass: [[0.18, 0.3, 0.1], [0.24, 0.17, 0.1]],
  wood: [[0.6, 0.45, 0.28], [0.48, 0.34, 0.2]], glass: [[0.75, 0.82, 0.85], [0.6, 0.7, 0.72]],
  metal: [[0.5, 0.5, 0.52]], kit: [[0.24, 0.26, 0.2], [0.12, 0.12, 0.12], [0.36, 0.33, 0.26]],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const R = () => Math.random() - 0.5;

export class VFX {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.fog = game.scene.fog;
    const cell = TOUCH_ONLY ? 48 : 96;
    const t0 = performance.now();
    this.smokeTex = smokeAtlas(cell);
    this.fireTex = fireAtlas(cell);
    this.buildMs = Math.round(performance.now() - t0);
    this.depthRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.depthQuad = new FullScreenQuad(new THREE.ShaderMaterial({ ...DEPTH_COPY, uniforms: THREE.UniformsUtils.clone(DEPTH_COPY.uniforms), depthTest: false, depthWrite: false }));
    // Smoke and fire are big, layered and fill-bound: a column of smoke took a
    // frame from 7 to 50 ms. They are drawn at half resolution (tested against
    // the half-res depth copy instead of the depth buffer) and laid over the
    // frame; the thin sparks stay at full resolution.
    this.partRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.compQuad = new FullScreenQuad(new THREE.ShaderMaterial({ ...COMPOSITE, uniforms: { tDiffuse: { value: this.partRT.texture } },
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
    this.halfRes = true;
    this._cc = new THREE.Color();
    const soft = { uDepth: { value: this.depthRT.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uSoft: { value: 0 } };
    this.soft = soft;
    const lightU = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color(0.5, 0.55, 0.6) }, uGround: { value: new THREE.Color(0.2, 0.18, 0.15) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
      uL0: { value: new THREE.Vector4(0, 0, 0, 1) }, uL0c: { value: new THREE.Color(0, 0, 0) },
      uL1: { value: new THREE.Vector4(0, 0, 0, 1) }, uL1c: { value: new THREE.Color(0, 0, 0) },
    };
    this.lightU = lightU;
    const common = (o) => new THREE.ShaderMaterial({
      ...o, fog: true, transparent: true, depthWrite: false, depthTest: true,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...soft, ...o.uniforms },
    });
    this.smoke = new Pool(TOUCH_ONLY ? 260 : 700, common({
      vertexShader: VERT, fragmentShader: SMOKE_FRAG, uniforms: { uAtlas: { value: this.smokeTex }, ...lightU },
      blending: THREE.NormalBlending,
    }), true);
    this.fire = new Pool(TOUCH_ONLY ? 140 : 360, common({
      vertexShader: VERT, fragmentShader: FIRE_FRAG, uniforms: { uAtlas: { value: this.fireTex }, uHDR: { value: 2.4 } },
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }), false);
    this.sparks = new Pool(TOUCH_ONLY ? 160 : 420, common({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, uniforms: { uHDR: { value: 3.0 }, uStretch: { value: 0.035 } },
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,   // the streak's winding follows its velocity
    }), false);
    this.smoke.mesh.renderOrder = 1; this.fire.mesh.renderOrder = 2; this.sparks.mesh.renderOrder = 3;
    this.scene.add(this.smoke.mesh, this.fire.mesh, this.sparks.mesh);

    // world-lit solids
    this.debris = new Solids(game.scene, chunkGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 }), TOUCH_ONLY ? 120 : 320);
    this.casings = new Solids(game.scene, casingGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.85 }), TOUCH_ONLY ? 60 : 180, { flatRest: true });

    // one light for blasts and big muzzle flashes, beside the game's own
    // enemy-flash light; desktop only (adding lights recompiles every shader)
    this.blast = null;
    if (!TOUCH_ONLY) {
      this.blast = new THREE.PointLight(0xffa860, 0, 34, 2);
      game.scene.add(this.blast);
    }
    this.blastT = 0; this.blastPeak = 0;
    this.emitters = [];
    this.shocks = [];
    this.wind = new THREE.Vector2(0.55, 0.22);
    this.timeScale = 1;
    this.budget = 1;
    this.softOn = !TOUCH_ONLY;
    this.stats = { lastMs: 0 };
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._m3 = new THREE.Matrix3();
  }

  setBudget(level) {
    this.budget = level === 'low' ? 0.4 : level === 'high' ? 1.25 : 1;
    this.softOn = level !== 'low' && !TOUCH_ONLY;
  }

  count(n) { return Math.max(1, Math.round(n * this.budget)); }

  floorAt(x, y, z) {
    const g = this.game;
    return g.player && g.player.groundAt ? g.player.groundAt(x, z, y + 0.4) : (g.surfaceH ? g.surfaceH(x, z) : 0);
  }

  // ---------------------------------------------------------- effects --

  // A bullet stopping on a surface. kind: brick, concrete, plaster, asphalt,
  // dirt, grass, wood, metal, glass, water.
  impact(p, n, kind) {
    const nx = n.x, ny = n.y, nz = n.z;
    const dust = MATS[kind] || MATS.concrete;
    const fl = this.floorAt(p.x, p.y, p.z);
    const chips = (count, size, speed, shape) => {
      const cols = CHIPS[kind] || CHIPS.concrete;
      for (let i = 0, c = this.count(count); i < c; i++) {
        const col = pick(cols), s = size * (0.5 + Math.random());
        this.debris.spawn({
          x: p.x + nx * 0.03, y: p.y + ny * 0.03, z: p.z + nz * 0.03,
          vx: nx * speed * (0.4 + Math.random()) + R() * speed, vy: ny * speed * (0.4 + Math.random()) + Math.random() * speed * 0.8, vz: nz * speed * (0.4 + Math.random()) + R() * speed,
          sx: shape === 'splinter' ? s * 3.5 : shape === 'shard' ? s * 1.6 : s, sy: shape === 'shard' ? s * 0.18 : shape === 'splinter' ? s * 0.5 : s, sz: shape === 'splinter' ? s * 0.5 : s,
          life: 2.5 + Math.random() * 2.5, floor: fl, r: col[0], g: col[1], b: col[2], spin: shape === 'shard' ? 22 : 16,
        });
      }
    };
    const puff = (count, s0, s1, speed, life, a0, up = 0.3) => {
      for (let i = 0, c = this.count(count); i < c; i++) {
        const k = 0.3 + Math.random() * 0.9;
        this.smoke.spawn({
          x: p.x + nx * 0.06, y: p.y + ny * 0.06, z: p.z + nz * 0.06,
          vx: nx * speed * k + R() * speed * 0.5, vy: ny * speed * k + Math.random() * speed * up, vz: nz * speed * k + R() * speed * 0.5,
          life: life * (0.7 + Math.random() * 0.6), s0: s0 * (0.7 + Math.random() * 0.5), s1: s1 * (0.8 + Math.random() * 0.5),
          a0, r: dust[0], g: dust[1], b: dust[2], drag: 3.2, lift: 0.15, grav: 0.0, rv: R() * 1.2, fadeIn: 0.04,
        });
      }
    };
    switch (kind) {
      case 'metal': {
        for (let i = 0, c = this.count(20); i < c; i++) {
          const v = 3 + Math.random() * 8;
          this.sparks.spawn({ x: p.x, y: p.y, z: p.z, vx: nx * v * 0.6 + R() * v, vy: ny * v * 0.6 + Math.random() * v * 0.7, vz: nz * v * 0.6 + R() * v,
            life: 0.22 + Math.random() * 0.4, s0: 0.03 + Math.random() * 0.02, a0: 1, heat: 1, cool: 1.8, grav: 9.8, drag: 0.6 });
        }
        this.fire.spawn({ x: p.x + nx * 0.05, y: p.y + ny * 0.05, z: p.z + nz * 0.05, life: 0.08, s0: 0.7, s1: 0.4, cell: 13, a0: 1, r: 1, g: 0.9, b: 0.7, heat: 1, fadeIn: 0 });
        this.fire.spawn({ x: p.x + nx * 0.05, y: p.y + ny * 0.05, z: p.z + nz * 0.05, life: 0.12, s0: 1.0, cell: 12, a0: 0.5, r: 1, g: 0.7, b: 0.4, heat: 0.9, fadeIn: 0 });
        puff(3, 0.2, 0.9, 1.4, 1.2, 0.4);
        break;
      }
      case 'wood':
        chips(8, 0.03, 2.8, 'splinter');
        puff(4, 0.25, 1.1, 1.8, 1.4, 0.6);
        break;
      case 'glass':
        chips(10, 0.035, 2.2, 'shard');
        for (let i = 0, c = this.count(5); i < c; i++) {
          this.sparks.spawn({ x: p.x, y: p.y, z: p.z, vx: nx * 2 + R() * 3, vy: Math.random() * 2, vz: nz * 2 + R() * 3, life: 0.35, s0: 0.006, a0: 0.6, heat: 0.8, glow: 1, grav: 9.8 });
        }
        break;
      case 'dirt': case 'grass': {
        // a kicked-up column and clods
        chips(12, 0.04, 3.4);
        puff(5, 0.3, 1.5, 2.8, 1.8, 0.8, 1.2);
        for (let i = 0; i < this.count(3); i++) this.smoke.spawn({ x: p.x, y: p.y + 0.05, z: p.z, vx: R() * 0.6, vy: 3.5 + Math.random() * 2.5, vz: R() * 0.6, life: 1.3, s0: 0.2, s1: 0.9, a0: 0.85, r: dust[0], g: dust[1], b: dust[2], drag: 2.5, grav: 3, fadeIn: 0.02 });
        break;
      }
      case 'water': {
        for (let i = 0, c = this.count(16); i < c; i++) {
          const v = 1.5 + Math.random() * 2.5, a = Math.random() * 6.28;
          this.sparks.spawn({ x: p.x, y: p.y + 0.02, z: p.z, vx: Math.cos(a) * v * 0.4, vy: v, vz: Math.sin(a) * v * 0.4, life: 0.5, s0: 0.018, a0: 0.8, glow: 1, grav: 9.8 });
        }
        puff(3, 0.25, 0.8, 0.9, 0.7, 0.35, 1);
        break;
      }
      default: {   // brick, concrete, plaster, asphalt
        const big = kind === 'concrete' || kind === 'plaster';
        chips(big ? 8 : 9, kind === 'brick' ? 0.04 : 0.032, 2.8);
        puff(big ? 6 : 5, 0.3, big ? 1.7 : 1.3, 2.4, big ? 2.0 : 1.6, big ? 0.8 : 0.72);
        // a fast jet straight out of the hole
        this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: nx * 6, vy: ny * 6 + 0.3, vz: nz * 6, life: 0.6, s0: 0.15, s1: 0.9, a0: 0.85, r: dust[0], g: dust[1], b: dust[2], drag: 7, fadeIn: 0 });
        if (Math.random() < 0.6) this.sparks.spawn({ x: p.x, y: p.y, z: p.z, vx: nx * 4 + R() * 3, vy: Math.random() * 3, vz: nz * 4 + R() * 3, life: 0.14, s0: 0.025, a0: 0.9, heat: 1, cool: 5, grav: 9.8 });
      }
    }
  }

  // A round striking a soldier: fabric and kit fragments and dust. Never blood.
  kit(p, n) {
    const c = MATS.kit;
    for (let i = 0, k = this.count(3); i < k; i++) {
      // out in front of the body, or the soft edge hides it against the man
      this.smoke.spawn({ x: p.x + n.x * 0.25, y: p.y + n.y * 0.25, z: p.z + n.z * 0.25, vx: n.x * 2.4 + R(), vy: n.y * 2.4 + Math.random() * 0.6, vz: n.z * 2.4 + R(), life: 0.9, s0: 0.18, s1: 0.75, a0: 0.55, r: c[0], g: c[1], b: c[2], drag: 4, fadeIn: 0.03 });
    }
    const fl = this.floorAt(p.x, p.y, p.z), cols = CHIPS.kit;
    for (let i = 0, k = this.count(4); i < k; i++) {
      const col = pick(cols), s = 0.012 + Math.random() * 0.02;
      this.debris.spawn({ x: p.x, y: p.y, z: p.z, vx: n.x * 2 + R() * 2, vy: Math.random() * 2, vz: n.z * 2 + R() * 2, sx: s * 1.6, sy: s * 0.3, sz: s, life: 2, floor: fl, r: col[0], g: col[1], b: col[2], spin: 20 });
    }
  }

  // Gun smoke at a muzzle. dir: barrel direction. big: shotgun / marksman.
  muzzle(p, dir, big) {
    for (let i = 0, k = big ? 3 : 1; i < k; i++) {
      const v = (big ? 2.2 : 1.4) * (0.6 + Math.random() * 0.6);
      this.smoke.spawn({ x: p.x + dir.x * 0.05, y: p.y + dir.y * 0.05, z: p.z + dir.z * 0.05,
        vx: dir.x * v + R() * 0.2, vy: dir.y * v + 0.15, vz: dir.z * v + R() * 0.2,
        life: 1.6 + Math.random(), s0: 0.05, s1: big ? 0.7 : 0.45, a0: big ? 0.28 : 0.18, r: 0.72, g: 0.71, b: 0.69, drag: 3.5, lift: 0.35, rv: R(), fadeIn: 0.05 });
    }
  }

  // An enemy's muzzle flash out in the world: a star and a side cone.
  enemyFlash(p, dir) {
    const cam = this.game.camera.position;
    const d = cam.distanceTo(p);
    const s = Math.min(0.9, 0.28 + d * 0.006);   // stays readable far away
    this.fire.spawn({ x: p.x, y: p.y, z: p.z, life: 0.05, s0: s, s1: s * 0.8, cell: 13, a0: 1, r: 1, g: 0.85, b: 0.6, heat: 1, fadeIn: 0 });
    this.fire.spawn({ x: p.x + dir.x * s * 0.4, y: p.y + dir.y * s * 0.4, z: p.z + dir.z * s * 0.4, life: 0.04, s0: s * 1.3, cell: 12, a0: 0.6, r: 1, g: 0.6, b: 0.3, heat: 0.8, fadeIn: 0 });
    if (d < 40) this.muzzle(p, dir, false);
  }

  casing(p, v, size = 1) {
    const s = 0.045 * size;
    this.casings.spawn({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, sx: s, sy: s, sz: s,
      life: 7 + Math.random() * 3, floor: this.floorAt(p.x, p.y, p.z), r: 0.95, g: 0.72, b: 0.36, spin: 26, snd: 1 });
  }

  // Frag, fuel car: fireball, flash of light, shockwave, debris, scorch,
  // a smoke column that keeps rising and drifting, and a shake.
  explosion(p, scale = 1) {
    const g = this.game, s = scale;
    const fl = this.floorAt(p.x, p.y + 0.5, p.z);
    // core flash
    this.fire.spawn({ x: p.x, y: p.y + 0.5 * s, z: p.z, life: 0.08, s0: 2.2 * s, s1: 3.2 * s, cell: 12, a0: 0.9, r: 1, g: 0.85, b: 0.6, heat: 1, fadeIn: 0 });
    // fireball: lumps thrown out, slowing, cooling to soot
    for (let i = 0, c = this.count(52); i < c; i++) {
      const a = Math.random() * 6.28, up = Math.random(), v = (4 + Math.random() * 7) * s;
      this.fire.spawn({ x: p.x + R() * 0.6, y: p.y + 0.4, z: p.z + R() * 0.6,
        vx: Math.cos(a) * v * (1 - up * 0.5), vy: up * v * 0.9 + 1.2, vz: Math.sin(a) * v * (1 - up * 0.5),
        life: 0.7 + Math.random() * 0.6, s0: 1.4 * s, s1: 4.2 * s, cell: Math.floor(Math.random() * 12), a0: 0.85, r: 1, g: 1, b: 1,
        heat: 0.7 + Math.random() * 0.28, cool: 1.0, drag: 3.2, lift: 2.2, rv: R() * 2, fadeIn: 0.02 });
    }
    // the fireball's own smoke: thick, lit by the fire at first
    for (let i = 0, c = this.count(16); i < c; i++) {
      const a = Math.random() * 6.28, v = (1.5 + Math.random() * 3) * s;
      this.smoke.spawn({ x: p.x + R() * 0.8, y: p.y + 0.8 * s, z: p.z + R() * 0.8, vx: Math.cos(a) * v, vy: 1.5 + Math.random() * 2, vz: Math.sin(a) * v,
        life: 3.5 + Math.random() * 1.5, s0: 1.2 * s, s1: 4.6 * s, a0: 0.85, r: 0.1, g: 0.09, b: 0.085, glow: 1, drag: 1.6, lift: 0.5, rv: R() * 0.5, fadeIn: 0.18 });
    }
    // sparks and burning fragments
    for (let i = 0, c = this.count(46); i < c; i++) {
      const v = (6 + Math.random() * 14) * s;
      this.sparks.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: R() * 2 * v, vy: Math.random() * v * 0.9, vz: R() * 2 * v,
        life: 0.4 + Math.random() * 0.9, s0: 0.05, a0: 1, heat: 1, cool: 1.1, grav: 9.8, drag: 0.4 });
    }
    // debris: dirt, stones, metal
    const cols = [[0.2, 0.17, 0.13], [0.35, 0.32, 0.28], [0.12, 0.12, 0.12], [0.42, 0.3, 0.2]];
    for (let i = 0, c = this.count(34); i < c; i++) {
      const v = (4 + Math.random() * 9) * s, col = pick(cols), sz = 0.03 + Math.random() * 0.07;
      this.debris.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: R() * 1.6 * v, vy: 2 + Math.random() * v, vz: R() * 1.6 * v,
        sx: sz * 1.4, life: 4 + Math.random() * 3, floor: fl, r: col[0], g: col[1], b: col[2], spin: 18 });
    }
    // ground dust ring, running out fast and stopping
    for (let i = 0, c = this.count(18); i < c; i++) {
      const a = (i / c) * 6.28 + R() * 0.3, v = (7 + Math.random() * 4) * s;
      this.smoke.spawn({ x: p.x, y: fl + 0.35, z: p.z, vx: Math.cos(a) * v, vy: 0.4, vz: Math.sin(a) * v,
        life: 2.5 + Math.random(), s0: 0.8 * s, s1: 3.0 * s, a0: 0.65, r: 0.42, g: 0.38, b: 0.33, drag: 3.2, lift: 0.3, rv: R(), fadeIn: 0.05 });
    }
    // the column: dark, rising and drifting for a few seconds
    this.emitters.push({ kind: 'column', x: p.x, y: p.y + 0.5, z: p.z, t: 0, dur: 5 * s, rate: 13 * s, acc: 0, s, glow: 1 });
    // light and a pressure wave
    this.flashLight(p, 700 * s, 0.6);
    this.shocks.push({ x: p.x, y: p.y + 0.5, z: p.z, t: 0, s });
    if (g.decals && g.decals.add) {
      this._v.set(p.x, fl + 0.02, p.z);
      g.decals.add(this._v, UP, 'scorch', 2.6 * s);
    }
    const camD = g.camera.position.distanceTo(p);
    if (g.fx) g.fx.addShake(Math.max(0, 0.075 * s * (1 - camD / 35)));
  }

  flashbang(p) {
    this.fire.spawn({ x: p.x, y: p.y + 0.2, z: p.z, life: 0.22, s0: 3, s1: 4.5, cell: 12, a0: 1, r: 1, g: 1, b: 1, heat: 1, fadeIn: 0 });
    for (let i = 0, c = this.count(18); i < c; i++) {
      const v = 3 + Math.random() * 6;
      this.sparks.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vx: R() * 2 * v, vy: Math.random() * v, vz: R() * 2 * v, life: 0.3, s0: 0.015, a0: 1, heat: 1, cool: 2, grav: 9.8 });
    }
    for (let i = 0; i < this.count(6); i++) this.smoke.spawn({ x: p.x, y: p.y + 0.3, z: p.z, vx: R() * 2, vy: 0.6, vz: R() * 2, life: 3, s0: 0.3, s1: 1.8, a0: 0.45, r: 0.8, g: 0.8, b: 0.8, drag: 2, lift: 0.2, fadeIn: 0.05 });
    this.flashLight(p, 900, 0.25, 0xfff4e8);
  }

  flashLight(p, peak, dur, colour = 0xffa860) {
    if (!this.blast) return;
    if (peak < this.blast.intensity) return;
    this.blast.position.set(p.x, p.y + 0.8, p.z);
    this.blast.color.setHex(colour);
    this.blastPeak = peak; this.blastT = 0; this.blastDur = dur;
    this.blast.intensity = peak;
  }

  // Continuous fire (a burning car): returns a handle; set .on = false to stop.
  addFire(x, y, z, size = 1) {
    const e = { kind: 'fire', x, y, z, s: size, on: true, accF: 0, accS: 0, t: 0 };
    this.emitters.push(e);
    return e;
  }

  // A smoke grenade's wall, rising from radius 0 to r over a couple of seconds.
  addSmokeScreen(x, y, z, r, dur) {
    const e = { kind: 'screen', x, y, z, r, dur, t: 0, acc: 0 };
    this.emitters.push(e);
    return e;
  }

  // vehicle: exhaust at the pipe; dust (or spray in the rain) at the wheels
  exhaust(p, dir, k) {
    if (Math.random() > 0.35 + k) return;
    this.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: dir.x * 1.2 + R() * 0.3, vy: 0.25, vz: dir.z * 1.2 + R() * 0.3,
      life: 1.4, s0: 0.08, s1: 0.6 + k * 0.6, a0: 0.18 + k * 0.25, r: 0.32, g: 0.33, b: 0.36, drag: 2.5, lift: 0.4, rv: R(), fadeIn: 0.05 });
  }

  wheelDust(p, speed, kind, wet) {
    if (wet) {
      for (let i = 0; i < 2; i++) this.sparks.spawn({ x: p.x + R() * 0.3, y: p.y + 0.1, z: p.z + R() * 0.3, vx: R() * 2, vy: 1 + Math.random() * speed * 0.15, vz: R() * 2, life: 0.45, s0: 0.006, a0: 0.5, glow: 1, grav: 9.8 });
      return;
    }
    const c = MATS[kind] || MATS.asphalt;
    const k = kind === 'asphalt' || kind === 'paving' ? 0.35 : 1;
    if (Math.random() > speed * 0.06 * k) return;
    this.smoke.spawn({ x: p.x + R() * 0.4, y: p.y + 0.15, z: p.z + R() * 0.4, vx: R() * 0.8, vy: 0.4 + Math.random() * 0.4, vz: R() * 0.8,
      life: 2.2, s0: 0.3, s1: 1.6 + speed * 0.06, a0: 0.32 * k + 0.08, r: c[0], g: c[1], b: c[2], drag: 1.6, lift: 0.2, rv: R(), fadeIn: 0.08 });
  }

  // a drop falling off a roof edge in the rain
  drip(x, y, z, floorY) {
    const h = Math.max(0.5, y - (floorY === undefined ? y - 6 : floorY));
    this.sparks.spawn({ x, y, z, vx: 0, vy: -0.4, vz: 0, life: Math.sqrt(2 * h / 9.8), s0: 0.006, a0: 0.55, glow: 1, grav: 9.8, fadeIn: 0 });
  }

  // ---------------------------------------------------------- update --

  update(dt) {
    dt *= this.timeScale;
    if (dt <= 0) return;
    const t0 = performance.now();
    const cam = this.game.camera.position;
    const wind = this.game.atmos && this.game.atmos.state && this.game.atmos.state.weather === 'rain' ? 1.5 : 1;
    const wx = this.wind.x * wind, wz = this.wind.y * wind;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt;
      if (e.kind === 'column') {
        if (e.t > e.dur) { this.emitters.splice(i, 1); continue; }
        const fade = 1 - e.t / e.dur;
        e.acc += dt * e.rate * this.budget;
        for (; e.acc >= 1; e.acc--) {
          const hot = Math.max(0, 1 - e.t / 0.8);
          this.smoke.spawn({ x: e.x + R() * 0.8 * e.s, y: e.y + R() * 0.3, z: e.z + R() * 0.8 * e.s,
            vx: R() * 0.6, vy: 2.2 + Math.random() * 1.5, vz: R() * 0.6, life: 5.5 + Math.random() * 2, s0: 1.4 * e.s, s1: 5.5 * e.s,
            a0: 0.85 * (0.4 + 0.6 * fade), r: 0.09 + 0.05 * fade, g: 0.085 + 0.045 * fade, b: 0.08 + 0.04 * fade, glow: hot,
            drag: 0.6, lift: 0.1, rv: R() * 0.4, fadeIn: 0.12 });
        }
      } else if (e.kind === 'fire') {
        if (!e.on) { this.emitters.splice(i, 1); continue; }
        const d2 = (e.x - cam.x) ** 2 + (e.z - cam.z) ** 2;
        if (d2 > 160 * 160) continue;
        e.accF += dt * 30 * e.s * this.budget;
        for (; e.accF >= 1; e.accF--) {
          this.fire.spawn({ x: e.x + R() * 1.4 * e.s, y: e.y, z: e.z + R() * 1.0 * e.s, vx: R() * 0.4, vy: 1.6 + Math.random() * 1.6, vz: R() * 0.4,
            life: 0.55 + Math.random() * 0.45, s0: 0.7 * e.s, s1: 1.5 * e.s, cell: Math.floor(Math.random() * 12), a0: 0.9, r: 1, g: 1, b: 1,
            heat: 0.75 + Math.random() * 0.25, cool: 1.3, drag: 1.2, lift: 1.2, rv: R() * 1.5, fadeIn: 0.08 });
        }
        e.accS += dt * 7 * e.s * this.budget;
        for (; e.accS >= 1; e.accS--) {
          this.smoke.spawn({ x: e.x + R() * e.s, y: e.y + 1.6 * e.s, z: e.z + R() * e.s, vx: R() * 0.4, vy: 1.6 + Math.random(), vz: R() * 0.4,
            life: 6 + Math.random() * 2, s0: 0.9 * e.s, s1: 4.5 * e.s, a0: 0.7, r: 0.08, g: 0.075, b: 0.07, glow: 0.8,
            drag: 0.5, lift: 0.15, rv: R() * 0.3, fadeIn: 0.15 });
        }
      } else if (e.kind === 'screen') {
        if (e.t > e.dur) { this.emitters.splice(i, 1); continue; }
        const grow = Math.min(1, e.t / 2.2);
        if (e.t < e.dur - 2.5) {
          e.acc += dt * 16 * this.budget;
          for (; e.acc >= 1; e.acc--) {
            const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * Math.max(0.8, e.r * grow) * 0.85, c = 0.72 + Math.random() * 0.08;
            this.smoke.spawn({ x: e.x + Math.cos(a) * rr, y: e.y + 0.3 + Math.random() * 2.2, z: e.z + Math.sin(a) * rr,
              vx: Math.cos(a) * 0.4, vy: 0.15, vz: Math.sin(a) * 0.4, life: 7, s0: 1.6, s1: 4.2, a0: 0.85, r: c, g: c, b: c + 0.01,
              drag: 0.8, lift: 0.05, rv: R() * 0.3, fadeIn: 0.15 });
          }
        }
      }
    }
    this.smoke.update(dt, wx, wz, cam, 'smoke');
    this.fire.update(dt, wx * 0.5, wz * 0.5, cam, 'fire');
    this.sparks.update(dt, 0, 0, cam, 'spark');
    this.debris.update(dt, null);
    // clinks: close ones only, and at most ~8 a second (each is a small
    // audio graph with its own panner; a firefight throws dozens of cases)
    this.clinkT = Math.max(0, (this.clinkT || 0) - dt);
    this.casings.update(dt, this._onCase || (this._onCase = (i, v) => {
      const C = this.casings, c = this.game.camera.position;
      if (this.clinkT > 0.5 || Math.hypot(C.x[i] - c.x, C.z[i] - c.z) > 9 || !audio.spatial.casing) return;
      this.clinkT += 0.125;
      audio.spatial.casing(C.x[i], C.y[i], C.z[i], Math.min(1, v / 3) * (C.bounces[i] ? 0.55 : 1));
    }));
    // the blast light falls away fast, with a flicker while it burns
    if (this.blast && this.blast.intensity > 0) {
      this.blastT += dt;
      const k = Math.max(0, 1 - this.blastT / (this.blastDur || 0.5));
      this.blast.intensity = this.blastPeak * k * k * (0.85 + Math.random() * 0.3);
      if (k <= 0) this.blast.intensity = 0;
    }
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      this.shocks[i].t += dt;
      if (this.shocks[i].t > 0.6) this.shocks.splice(i, 1);
    }
    this.stats.lastMs = performance.now() - t0;
  }

  get live() { return this.smoke.n + this.fire.n + this.sparks.n; }

  // Shockwaves and barrel haze as screen positions for the post pass.
  distortion(camera, size) {
    const out = [];
    for (const s of this.shocks) {
      this._v.set(s.x, s.y, s.z).project(camera);
      if (this._v.z > 1 || Math.abs(this._v.x) > 1.4 || Math.abs(this._v.y) > 1.4) continue;
      const d = camera.position.distanceTo(this._v2.set(s.x, s.y, s.z));
      const k = s.t / 0.6;
      // the ring grows to ~12 m; its screen radius shrinks with distance
      const rad = (2 + k * 12 * s.s) / Math.max(2, d) * 0.6;
      out.push([this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5, rad, (1 - k) * Math.min(1, 12 / Math.max(3, d)) * s.s]);
      if (out.length === 2) break;
    }
    return out;
  }

  // ---------------------------------------------------------- render --

  // Lights for the smoke, in view space: the sun, the sky, and the two
  // strongest point lights near the camera.
  _lights(camera) {
    const g = this.game, U = this.lightU, V = camera.matrixWorldInverse;
    const m3 = this._m3.setFromMatrix4(V);
    const sunDir = (g.atmos && g.atmos.state && g.atmos.state.sunDir) || g.sunOffset || UP;
    U.uSunDir.value.copy(sunDir).normalize().applyMatrix3(m3).normalize();
    U.uUp.value.copy(UP).applyMatrix3(m3).normalize();
    if (g.sun) U.uSunCol.value.copy(g.sun.color).multiplyScalar(Math.min(3, g.sun.intensity) * 0.42);
    const hemi = this.hemi || (this.hemi = g.scene.children.find((o) => o.isHemisphereLight));
    if (hemi) {
      const k = Math.min(1.2, hemi.intensity * 0.22);
      U.uSky.value.copy(hemi.color).multiplyScalar(k);
      U.uGround.value.copy(hemi.groundColor).multiplyScalar(k * 0.8);
    }
    // candidate point lights
    const cands = this._cands || (this._cands = []);
    cands.length = 0;
    const add = (L) => {
      if (!L || !(L.intensity > 0.05)) return;
      L.getWorldPosition(this._v);
      const d = this._v.distanceTo(camera.position);
      cands.push({ x: this._v.x, y: this._v.y, z: this._v.z, c: L.color, i: L.intensity, r: L.distance || 20, w: L.intensity / (1 + d * d * 0.02) });
    };
    add(this.blast); add(g.enemyFlash); add(g.weapons && g.weapons.flashLight); add(g.life && g.life.fireLight);
    cands.sort((a, b) => b.w - a.w);
    const set = (k, c) => {
      const P = k ? U.uL1 : U.uL0, C = k ? U.uL1c : U.uL0c;
      if (!c) { C.value.setRGB(0, 0, 0); return; }
      this._v.set(c.x, c.y, c.z).applyMatrix4(V);
      P.value.set(this._v.x, this._v.y, this._v.z, c.r * 1.5);
      C.value.copy(c.c).multiplyScalar(Math.min(40, c.i) * 0.06);
    };
    set(0, cands[0]); set(1, cands[1]);
  }

  // Called by Game.renderScene after the world pass, into the same target.
  render(renderer, target, camera) {
    if (!this.live) return;
    this.scene.fog = this.game.scene.fog;   // the atmosphere swaps fog objects
    const soft = this.softOn && target && target.depthTexture;
    if (soft) {
      const w = Math.max(1, target.width >> 1), h = Math.max(1, target.height >> 1);
      if (this.depthRT.width !== w || this.depthRT.height !== h) this.depthRT.setSize(w, h);
      const u = this.depthQuad.material.uniforms;
      u.tDepth.value = target.depthTexture; u.uNear.value = camera.near; u.uFar.value = camera.far;
      renderer.setRenderTarget(this.depthRT);
      this.depthQuad.render(renderer);
      this.soft.uRes.value.set(target.width, target.height);
    }
    this.soft.uSoft.value = soft ? 1 : 0;
    this._lights(camera);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    const half = soft && this.halfRes && (this.smoke.n || this.fire.n);
    if (half) {
      const D = this.depthRT;
      if (this.partRT.width !== D.width || this.partRT.height !== D.height) this.partRT.setSize(D.width, D.height);
      this.soft.uRes.value.set(D.width, D.height);
      const sm = this.smoke.mesh.material, fm = this.fire.mesh.material, sv = this.sparks.mesh.visible;
      sm.depthTest = fm.depthTest = false;          // the soft fade does the depth test
      this.sparks.mesh.visible = false;
      renderer.getClearColor(this._cc); const ca = renderer.getClearAlpha();
      renderer.setRenderTarget(this.partRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(this.scene, camera);
      renderer.setClearColor(this._cc, ca);
      sm.depthTest = fm.depthTest = true;
      renderer.setRenderTarget(target);
      this.compQuad.render(renderer);
      // then the sparks, full size, against the real depth buffer
      this.sparks.mesh.visible = sv;
      if (sv) {
        this.soft.uRes.value.set(target.width, target.height);
        const s0 = this.smoke.mesh.visible, f0 = this.fire.mesh.visible;
        this.smoke.mesh.visible = this.fire.mesh.visible = false;
        renderer.render(this.scene, camera);
        this.smoke.mesh.visible = s0; this.fire.mesh.visible = f0;
      }
    } else {
      renderer.setRenderTarget(target);
      renderer.render(this.scene, camera);
    }
    renderer.autoClear = auto;
  }

  // Compile every effect's shader at load (main.js), not at the first shot:
  // the meshes are hidden while empty and renderer.compile skips them.
  warm(renderer, camera) {
    const all = [this.smoke.mesh, this.fire.mesh, this.sparks.mesh, this.debris.mesh, this.casings.mesh];
    const vis = all.map((m) => m.visible);
    for (const m of all) m.visible = true;
    renderer.compile(this.scene, camera);
    renderer.compile(this.game.scene, camera);
    all.forEach((m, i) => { m.visible = vis[i]; });
  }

  clear() {
    this.smoke.clear(); this.fire.clear(); this.sparks.clear(); this.debris.clear(); this.casings.clear();
    this.emitters.length = 0; this.shocks.length = 0;
    if (this.blast) this.blast.intensity = 0;
  }
}
