import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Parametric first-person weapon builder.
//
// Every gun is authored from small primitives and merged per material, so a
// 60-piece weapon costs about four draw calls. The `shape` block in config
// drives barrel length, stock, magazine style, optic and overall bulk, so the
// four weapons read as genuinely different objects from one code path.
//
// Local axes: muzzle points down -Z, +Y up, origin on the optic centre line so
// aiming down sights is a pure translation.

const OBJ = new THREE.Object3D();
function at(geo, pos, rot, scl) {
  OBJ.position.set(pos[0], pos[1], pos[2]);
  OBJ.rotation.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
  OBJ.scale.set(scl ? scl[0] : 1, scl ? scl[1] : 1, scl ? scl[2] : 1);
  OBJ.updateMatrix();
  return geo.clone().applyMatrix4(OBJ.matrix);
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);

function limb(from, to, w, h) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = B(w, h, len);
  geo.translate(0, 0, -len / 2);
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, -1), dir.clone().normalize());
  return geo.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
}

export const SIGHT_Y = 0.088;

export function buildWeaponModel(shape, mats) {
  const k = shape.bulk;
  const metal = [], poly = [], dark = [], glove = [], sleeve = [], cuff = [];

  // ---- receiver ----
  metal.push(at(B(0.076 * k, 0.074 * k, 0.42 * k), [0, 0.010, -0.03]));
  dark.push(at(B(0.006, 0.034, 0.096), [0.039 * k, 0.014, -0.05]));       // ejection port
  metal.push(at(B(0.050, 0.013, 0.046), [0, 0.043 * k, 0.175 * k]));      // charging handle

  // top rail, drawn as individual ridges so it reads as picatinny
  const railLen = 0.42 * k;
  const ridges = Math.round(railLen / 0.038);
  for (let i = 0; i < ridges; i++) {
    metal.push(at(B(0.026, 0.009, 0.011), [0, 0.052 * k, -0.26 + i * 0.038]));
  }
  metal.push(at(B(0.022, 0.006, railLen + 0.08), [0, 0.047 * k, -0.06]));

  // ---- handguard + barrel ----
  const bl = shape.barrel;
  poly.push(at(C(0.041 * k, 0.041 * k, Math.max(0.14, bl * 0.9), 8),
    [0, 0.006, -0.20 - bl * 0.45], [Math.PI / 2, 0, Math.PI / 8]));
  for (let i = 0; i < 4; i++) {
    const z = -0.22 - i * 0.05;
    if (-z > 0.2 + bl) break;
    dark.push(at(B(0.006, 0.014, 0.030), [0.040 * k, 0.004, z]));
    dark.push(at(B(0.006, 0.014, 0.030), [-0.040 * k, 0.004, z]));
  }
  metal.push(at(C(0.011 * k, 0.011 * k, bl, 10), [0, 0.008, -0.24 - bl / 2], [Math.PI / 2, 0, 0]));

  // muzzle device
  const muzzleZ = -0.24 - bl - 0.03;
  metal.push(at(C(0.020 * k, 0.018 * k, 0.070, 10), [0, 0.008, muzzleZ], [Math.PI / 2, 0, 0]));
  for (let i = 0; i < 3; i++) {
    dark.push(at(B(0.044 * k, 0.005, 0.008), [0, 0.008, muzzleZ + 0.018 - i * 0.018]));
  }

  // ---- lower receiver, grip, trigger group ----
  poly.push(at(B(0.066 * k, 0.072 * k, 0.20 * k), [0, -0.055, 0.020]));
  poly.push(at(B(0.058 * k, 0.088, 0.080), [0, -0.088, -0.048], [0.16, 0, 0]));
  poly.push(at(B(0.012, 0.009, 0.062), [0, -0.104, 0.056]));
  poly.push(at(B(0.012, 0.038, 0.009), [0, -0.088, 0.086]));
  dark.push(at(B(0.008, 0.026, 0.008), [0, -0.086, 0.052], [0.25, 0, 0]));
  poly.push(at(B(0.040 * k, 0.118, 0.052), [0, -0.118, 0.104], [0.34, 0, 0]));
  dark.push(at(B(0.042 * k, 0.014, 0.050), [0, -0.176, 0.126], [0.34, 0, 0]));

  // ---- stock ----
  if (shape.stock) {
    metal.push(at(C(0.018, 0.018, 0.15, 10), [0, -0.004, 0.200], [Math.PI / 2, 0, 0]));
    poly.push(at(B(0.060 * k, 0.070 * k, 0.120), [0, -0.008, 0.235]));
    poly.push(at(B(0.048, 0.030, 0.090), [0, 0.036 * k, 0.230]));
    dark.push(at(B(0.062 * k, 0.098 * k, 0.020), [0, -0.006, 0.302]));
  } else {
    metal.push(at(C(0.016, 0.016, 0.10, 8), [0, -0.004, 0.180], [Math.PI / 2, 0, 0]));
    dark.push(at(B(0.030, 0.055, 0.020), [0, -0.010, 0.230]));           // folding brace
  }

  // ---- optic ----
  const OY = SIGHT_Y;
  if (shape.optic === 'scope') {
    dark.push(at(C(0.030, 0.030, 0.26, 12), [0, OY + 0.006, -0.05], [Math.PI / 2, 0, 0]));
    dark.push(at(C(0.040, 0.036, 0.05, 12), [0, OY + 0.006, -0.19], [Math.PI / 2, 0, 0]));
    dark.push(at(C(0.034, 0.030, 0.04, 12), [0, OY + 0.006, 0.08], [Math.PI / 2, 0, 0]));
    dark.push(at(B(0.026, 0.030, 0.030), [0, OY - 0.026, -0.12]));
    dark.push(at(B(0.026, 0.030, 0.030), [0, OY - 0.026, 0.01]));
    metal.push(at(C(0.012, 0.012, 0.022, 8), [0.030, OY + 0.010, -0.05], [0, 0, Math.PI / 2]));
  } else if (shape.optic === 'dot') {
    dark.push(at(B(0.010, 0.062, 0.076), [0.030, OY - 0.008, -0.10]));
    dark.push(at(B(0.010, 0.062, 0.076), [-0.030, OY - 0.008, -0.10]));
    dark.push(at(B(0.070, 0.012, 0.076), [0, OY + 0.026, -0.10]));
    dark.push(at(B(0.058, 0.020, 0.060), [0, OY - 0.042, -0.10]));
  } else {
    dark.push(at(B(0.030, 0.038, 0.012), [0, OY - 0.010, -0.28]));       // front post
    dark.push(at(B(0.036, 0.026, 0.012), [0, OY - 0.014, 0.10]));        // rear notch
  }

  // ---- hands ----
  const gripZ = 0.104, guardZ = -0.20 - bl * 0.55;
  glove.push(at(B(0.046, 0.070, 0.052), [0.006, -0.120, gripZ + 0.004], [0.34, 0, 0]));
  for (let i = 0; i < 4; i++) {
    glove.push(at(B(0.052, 0.020, 0.022), [0, -0.082 - i * 0.024, gripZ - 0.030 + i * 0.009], [0.30, 0, 0]));
  }
  glove.push(at(B(0.020, 0.048, 0.024), [-0.026, -0.086, gripZ - 0.018], [0.5, 0, 0.3]));
  glove.push(at(B(0.050, 0.040, 0.040), [0.004, -0.062, gripZ + 0.024], [0.34, 0, 0]));

  glove.push(at(B(0.048, 0.062, 0.048), [-0.004, -0.070, guardZ]));
  for (let i = 0; i < 4; i++) {
    glove.push(at(B(0.054, 0.019, 0.020), [0, -0.042 - i * 0.023, guardZ + 0.002]));
  }
  glove.push(at(B(0.052, 0.038, 0.038), [-0.002, -0.024, guardZ - 0.004]));

  sleeve.push(limb([0.020, -0.150, 0.150], [0.135, -0.330, 0.380], 0.072, 0.072));
  sleeve.push(limb([-0.010, -0.095, guardZ + 0.03], [-0.140, -0.310, -0.060], 0.072, 0.072));
  cuff.push(at(B(0.080, 0.080, 0.028), [0.048, -0.196, 0.212], [0.6, 0.5, 0]));
  cuff.push(at(B(0.080, 0.080, 0.028), [-0.052, -0.150, guardZ + 0.14], [0.6, -0.5, 0]));

  // ---- assemble ----
  const gun = new THREE.Group();
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.66, metalness: 0.20 });
  const add = (geos, mat) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.frustumCulled = false;
    gun.add(m);
    return m;
  };
  const parts = {
    metal: add(metal, mats.gunMetal),
    poly: add(poly, mats.gunPoly),
    dark: add(dark, darkMat),
    glove: add(glove, mats.glove),
    sleeve: add(sleeve, mats.camo),
    cuff: add(cuff, darkMat),
  };

  // ---- magazine as a separate object so it can drop during reload ----
  let magGeos;
  if (shape.mag === 'tube') {
    magGeos = [at(C(0.026, 0.026, Math.max(0.2, bl * 0.8), 10), [0, -0.052, -0.24 - bl * 0.4], [Math.PI / 2, 0, 0])];
  } else if (shape.mag === 'short') {
    magGeos = [at(B(0.046, 0.070, 0.070), [0, -0.048, 0]), at(B(0.050, 0.012, 0.074), [0, -0.088, 0])];
  } else {
    magGeos = [
      at(B(0.048, 0.075, 0.078), [0, -0.040, 0]),
      at(B(0.046, 0.070, 0.076), [0, -0.104, 0.014], [0.12, 0, 0]),
      at(B(0.044, 0.060, 0.074), [0, -0.166, 0.036], [0.24, 0, 0]),
    ];
  }
  const mag = new THREE.Mesh(mergeGeometries(magGeos, false), mats.gunPoly);
  mag.frustumCulled = false;
  mag.position.set(0, shape.mag === 'tube' ? 0 : -0.108, shape.mag === 'tube' ? 0 : -0.046);
  gun.add(mag);

  // ---- reticle ----
  const reticle = new THREE.Mesh(
    new THREE.CircleGeometry(shape.optic === 'scope' ? 0.0016 : 0.0030, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3018, fog: false, depthTest: false, transparent: true }));
  reticle.renderOrder = 30;
  reticle.position.set(0, OY - 0.006, shape.optic === 'scope' ? -0.16 : -0.078);
  reticle.visible = false;
  gun.add(reticle);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.008, muzzleZ - 0.04);
  const port = new THREE.Object3D();
  port.position.set(0.046, 0.016, -0.05);
  gun.add(muzzle, port);

  gun.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  // Hand points, in gun space: palm centres on the pistol grip and the
  // handguard. The box hands above sit on them; real arms are solved onto them.
  const hands = {
    grip: new THREE.Vector3(0.004, -0.112, gripZ + 0.012),
    // real arms hold the rear of the handguard; the box hand sits further out
    guard: new THREE.Vector3(-0.004, -0.052, Math.max(guardZ, -0.27)),
    meshes: [parts.glove, parts.sleeve, parts.cuff].filter(Boolean),
  };

  return { gun, mag, reticle, muzzle, port, magHome: mag.position.clone(), parts, hands };
}

// The same weapon for a soldier to carry: one geometry with the three gun
// colours baked into vertex colours (one draw call), no hands, turned so the
// muzzle points down +Z like the soldier. Cached per shape.
const CARRIED = new Map();
const CARRY_COL = { metal: [0.40, 0.41, 0.42], poly: [0.25, 0.255, 0.26], dark: [0.16, 0.165, 0.17] };
export function buildCarriedGun(shape) {
  const key = JSON.stringify(shape);
  if (CARRIED.has(key)) return CARRIED.get(key);
  const plain = new THREE.MeshStandardMaterial();
  const m = buildWeaponModel(shape, { gunMetal: plain, gunPoly: plain, glove: plain, camo: plain });
  const geos = [];
  const take = (mesh, rgb) => {
    let g = mesh.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    const c = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mesh.updateMatrix();
    g.applyMatrix4(mesh.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    geos.push(g);
  };
  for (const k of ['metal', 'poly', 'dark']) if (m.parts[k]) take(m.parts[k], CARRY_COL[k]);
  take(m.mag, CARRY_COL.poly);
  const geo = mergeGeometries(geos, false);
  // The viewmodel is built long for the screen; a carried one at 85% is the
  // length of a real carbine and keeps the handguard inside arm's reach.
  const K = 0.85;
  const turn = new THREE.Matrix4().makeRotationY(Math.PI).scale(new THREE.Vector3(K, K, K));
  geo.applyMatrix4(turn);
  geo.computeBoundingSphere();
  const flip = (v) => v.clone().applyMatrix4(turn);
  const out = {
    geometry: geo,
    // support hand on the rear of the handguard, not out at the box hand
    grip: flip(m.hands.grip), guard: flip(new THREE.Vector3(-0.004, -0.052, -0.25)),
    magwell: flip(new THREE.Vector3(0, -0.10, -0.03)),
    muzzle: flip(m.muzzle.position),
    stockZ: (shape.stock ? -0.31 : -0.23) * K,
  };
  CARRIED.set(key, out);
  return out;
}
