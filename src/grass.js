import * as THREE from 'three';
import { fetchAsset } from './assets.js';
import { TOUCH_ONLY } from './input.js';
import { SHARED } from './townmat.js';
import { CollisionGrid } from './collide.js';

// Grass tufts on grass ground round the camera. A tuft is four crossed cards
// cut from the bottom row of the CC0 Foliage006 blade sheet (ASSETS.md); all
// tufts are one instanced mesh, refilled from a fixed jittered grid whenever
// the camera has moved a few metres, so a tuft stays where it grew. Tufts
// sink into the ground toward the edge of the patch (no pop on refill) and
// their tips move in the wind (the trees' shared time and wind uniforms).

const R = TOUCH_ONLY ? 14 : 24;          // patch radius, metres
const SP = TOUCH_ONLY ? 0.75 : 0.5;      // grid spacing
const MAX = TOUCH_ONLY ? 1800 : 8000;
const MOVE = 3;                          // refill after this much movement

function tuftGeometry() {
  const P = [], N = [], U = [], I = [];
  const w = 0.5, h = 0.34;
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 4 + 0.2, cx = Math.cos(a) * w / 2, cz = Math.sin(a) * w / 2;
    const u0 = (k % 2) * 0.5, b = P.length / 3;
    P.push(-cx, 0, -cz, cx, 0, cz, cx, h, cz, -cx, h, -cz);
    // normals up, as the ground's: the cards light like the lawn they grow in
    for (let i = 0; i < 4; i++) N.push(0, 1, 0);
    U.push(u0, 0.01, u0 + 0.5, 0.01, u0 + 0.5, 0.5, u0, 0.5);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  return g;
}

function grassMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, color: 0xa9b886 });
  if (!SHARED.uWind) SHARED.uWind = { value: 1 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SHARED.uTime;
    sh.uniforms.uWind = SHARED.uWind;
    sh.uniforms.uR = { value: R };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform float uR;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3( instanceMatrix[ 3 ] );
        // shrink into the ground over the last 6 m of the patch
        float fade = smoothstep( uR, uR - 6.0, distance( ip.xz, cameraPosition.xz ) );
        transformed.y *= fade;
        // tips bend with the wind, each tuft on its own phase
        float tip = position.y * position.y * 6.0;
        float ph = ip.x * 0.71 + ip.z * 0.43;
        float gust = 0.6 + 0.4 * sin( uTime * 0.6 + ip.x * 0.05 );
        transformed.x += sin( uTime * 2.1 + ph ) * 0.06 * tip * uWind * gust;
        transformed.z += cos( uTime * 1.7 + ph * 1.3 ) * 0.045 * tip * uWind * gust;`);
  };
  m.customProgramCacheKey = () => 'grassTufts';
  return m;
}

const hash = (ix, iz, k) => { const h = Math.sin(ix * 127.1 + iz * 311.7 + k * 74.7) * 43758.5453; return h - Math.floor(h); };

export class Grass {
  // town: groundKind / surfaceH; colliders: the town's boxes (no grass grows
  // under a building, a wall, a car or a hedge)
  constructor(town, colliders, group) {
    this.town = town;
    this.grid = new CollisionGrid(8);
    for (const c of colliders) this.grid.add(c);
    const tex = new THREE.Texture();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    fetchAsset(`assets/mat/Foliage006_d${TOUCH_ONLY ? '_lo' : ''}.webp`)
      .then((buf) => createImageBitmap(new Blob([buf], { type: 'image/webp' }), { imageOrientation: 'flipY' }))
      .then((img) => { tex.image = img; tex.flipY = false; tex.needsUpdate = true; this.mesh.visible = this.count > 0; this.ready = true; })
      .catch((e) => console.warn('grass texture not loaded', e.message));
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), grassMaterial(tex), MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;      // bounds follow the camera; the patch is always round it
    this.mesh.name = 'grass';
    group.add(this.mesh);
    this.at = new THREE.Vector2(1e9, 1e9);
    this.count = 0;
  }

  blocked(x, z) {
    for (const c of this.grid.query(x - 0.2, z - 0.2, x + 0.2, z + 0.2)) {
      if (x > c.minX - 0.15 && x < c.maxX + 0.15 && z > c.minZ - 0.15 && z < c.maxZ + 0.15) return true;
    }
    return false;
  }

  update(cam) {
    if (Math.abs(cam.x - this.at.x) + Math.abs(cam.z - this.at.y) < MOVE) return;
    this.at.set(cam.x, cam.z);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const T = this.town, R2 = R * R;
    let n = 0;
    const i0 = Math.floor((cam.x - R) / SP), i1 = Math.ceil((cam.x + R) / SP);
    const k0 = Math.floor((cam.z - R) / SP), k1 = Math.ceil((cam.z + R) / SP);
    for (let i = i0; i <= i1 && n < MAX; i++) {
      for (let k = k0; k <= k1 && n < MAX; k++) {
        if (hash(i, k, 0) < 0.25) continue;            // bare patches
        const x = (i + hash(i, k, 1)) * SP, z = (k + hash(i, k, 2)) * SP;
        const dx = x - cam.x, dz = z - cam.z;
        if (dx * dx + dz * dz > R2) continue;
        if (T.groundKind(x, z) !== 'grass' || this.blocked(x, z)) continue;
        const sc = 0.6 + hash(i, k, 3) * 0.6;
        q.setFromAxisAngle(up, hash(i, k, 4) * Math.PI * 2);
        s.set(sc, sc * (0.75 + hash(i, k, 5) * 0.45), sc);
        p.set(x, T.surfaceH(x, z) - 0.02, z);
        this.mesh.setMatrixAt(n, m.compose(p, q, s));
        const v = hash(i, k, 6);
        this.mesh.setColorAt(n, col.setRGB(0.85 + v * 0.3, 0.9 + v * 0.2, 0.75 + v * 0.2));
        n++;
      }
    }
    this.count = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0 && !!this.ready;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
