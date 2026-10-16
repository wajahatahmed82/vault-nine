import * as THREE from 'three';

// Bullet impact decals, matched to the surface that was hit.
//
// One InstancedMesh per surface type, cycling through a fixed pool, so a wall
// full of holes is still four draw calls. Each surface gets its own mark:
// masonry chips out pale around a dark core, metal scuffs bright, wood
// splinters, glass cracks.

const POOL = 96;   // two full 30-round sprays plus change, per surface

function makeTexture(kind) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  const rnd = (() => { let s = kind.length * 97 + 13; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

  if (kind === 'glass') {
    g.strokeStyle = 'rgba(235,240,240,0.85)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rnd() * 0.4;
      const r = 14 + rnd() * 16;
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * r * 0.5 + (rnd() - 0.5) * 4, cy + Math.sin(a) * r * 0.5 + (rnd() - 0.5) * 4);
      g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.stroke();
    }
    g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(20,22,22,0.9)';
    g.beginPath(); g.arc(cx, cy, 3, 0, Math.PI * 2); g.fill();
  } else {
    const ring = { masonry: [196, 188, 172], metal: [214, 210, 200], wood: [150, 108, 64] }[kind];
    // chipped/scuffed ring: irregular, soft-edged
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 5 + rnd() * (kind === 'metal' ? 9 : 14);
      const sz = 1 + rnd() * (kind === 'wood' ? 4 : 3);
      g.fillStyle = `rgba(${ring[0]},${ring[1]},${ring[2]},${0.35 + rnd() * 0.45})`;
      g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, sz * (kind === 'wood' ? 2.2 : 1), sz);
    }
    // scorch / dirt halo
    const halo = g.createRadialGradient(cx, cy, 2, cx, cy, kind === 'metal' ? 12 : 16);
    halo.addColorStop(0, 'rgba(30,26,22,0.85)');
    halo.addColorStop(1, 'rgba(30,26,22,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
    // the hole itself
    g.fillStyle = 'rgba(8,7,6,0.98)';
    g.beginPath(); g.arc(cx, cy, kind === 'metal' ? 3.2 : 4.2, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Decals {
  constructor(scene) {
    this.scene = scene;
    this.sets = {};
    const geo = new THREE.PlaneGeometry(1, 1);
    for (const kind of ['masonry', 'metal', 'wood', 'glass']) {
      const mat = new THREE.MeshStandardMaterial({
        map: makeTexture(kind), transparent: true, depthWrite: false,
        roughness: 0.95, metalness: 0,
        // Pull the decal toward the camera in depth so it never z-fights the
        // wall it sits on, without floating visibly off it.
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, POOL);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.sets[kind] = { mesh, next: 0, used: 0 };
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0, 0, 1);
  }

  add(point, normal, kind) {
    const set = this.sets[kind] || this.sets.masonry;
    const size = kind === 'glass' ? 0.22 : kind === 'metal' ? 0.10 : 0.13;
    this._q.setFromUnitVectors(this._z, normal);
    this._q2.setFromAxisAngle(this._z, Math.random() * Math.PI * 2);
    this._q.multiply(this._q2);
    this._p.copy(point).addScaledVector(normal, 0.004);
    const s = size * (0.85 + Math.random() * 0.3);
    this._s.set(s, s, s);
    this._m.compose(this._p, this._q, this._s);
    set.mesh.setMatrixAt(set.next, this._m);
    set.next = (set.next + 1) % POOL;
    set.used = Math.min(POOL, set.used + 1);
    set.mesh.count = set.used;
    set.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const set of Object.values(this.sets)) {
      set.next = 0; set.used = 0; set.mesh.count = 0;
    }
  }

  get total() {
    return Object.values(this.sets).reduce((n, s) => n + s.used, 0);
  }
}
