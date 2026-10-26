import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fetchAsset, assetUrl } from './assets.js';
import { TOUCH_ONLY } from './input.js';

// Scanned CC0 props from Poly Haven (see ASSETS.md), built by
// tools/propbuild.mjs into docs/assets/props/<file>{_lo}.glb: meshopt
// geometry, KTX2 textures. Many files hold several variants or a modular kit
// side by side, so a KIND names one file plus the nodes that make it up; the
// kind is recentred (x/z centre, feet at y=0) and turned/scaled to face +Z the
// way the town's own props are written.
//
// The town is built before these arrive. Its emitters (props.js) record a
// placement per prop and write a simple stand-in into a separate buffer; when
// the models load, each chunk gets instanced meshes and the stand-ins hide.
// If the files cannot load, the stand-ins simply stay.

export const KINDS = {
  hydrant: { file: 'fire_hydrant', nodes: /^fire_hydrant(?!.*aged)/, rotY: 0 },
  hydrantOld: { file: 'fire_hydrant', nodes: /aged/ },
  // (the lids stand beside the cans in the scan; street bins keep theirs on)
  bin: { file: 'metal_trash_can', nodes: /^metal_trash_can(_handle_(left|right))?$/ },
  binRust: { file: 'metal_trash_can', nodes: /^metal_trash_can_rust(_handle_(left|right))?$/ },
  lampPost: { file: 'street_lamp_01', scale: 1.45, shadow: true },
  barrier: { file: 'concrete_road_barrier_02', shadow: true },
  fencePanel: { file: 'modular_chainlink_fence', nodes: /^modular_chainlink_fence_double$/, shadow: true },
  fencePost: { file: 'modular_chainlink_fence', nodes: /^modular_chainlink_fence_post$/, shadow: true },
  pole1: { file: 'modular_electricity_poles', nodes: /^preset_01_/, scale: 1.4 },
  pole2: { file: 'modular_electricity_poles', nodes: /^preset_02_/, scale: 1.4 },
  pole3: { file: 'modular_electricity_poles', nodes: /^preset_03_/, scale: 1.4 },
  downpipe: { file: 'modular_metal_gutter', nodes: /^modular_metal_gutter_section$/ },
  pipeOutlet: { file: 'modular_metal_gutter', nodes: /^modular_metal_gutter_outlet$/ },
  pipeFunnel: { file: 'modular_metal_gutter', nodes: /^modular_metal_gutter_funnel$/ },
  bench: { file: 'painted_wooden_bench', shadow: true },
  cabinet: { file: 'utility_box_01' },
  cabinetWide: { file: 'utility_box_02' },
  floodlight: { file: 'security_light' },
  aircon: { file: 'exterior_aircon_unit', nodes: /^exterior_aircon_unit$/ },
  airconRust: { file: 'exterior_aircon_unit', nodes: /rusted/ },
  tyre: { file: 'old_tyre' },
  coveredCar: { file: 'covered_car', shadow: true },
  fireEscape: { file: 'modular_fire_escape', shadow: true, keepY: true },
  planter: { file: 'planter_box_01' },
  barrel: { file: 'Barrel_01' },
  barrelB: { file: 'barrel_03' },
  crate: { file: 'wooden_crate_01' },
  crateLoot: { file: 'old_military_crate', nodes: /_a$/ },
  plasticCrate: { file: 'plastic_crate_03' },
  box: { file: 'cardboard_box_01' },
  propane: { file: 'propane_tank' },
  generator: { file: 'portable_generator' },
  wetSign: { file: 'WetFloorSign_01' },
  shrubA: { file: 'shrub_02', nodes: /_a$/ },
  shrubB: { file: 'shrub_02', nodes: /_b$/ },
  shrubC: { file: 'shrub_02', nodes: /_c$/ },
  shrubD: { file: 'shrub_02', nodes: /_d$/ },
  weed: { file: 'weed_plant_02', nodes: /_a_LOD0$/ },
  weedB: { file: 'weed_plant_02', nodes: /_c_LOD0$/ },
  fern: { file: 'fern_02', nodes: /_b$/ },
  pot: { file: 'potted_plant_04' },
  claypot: { file: 'planter_pot_clay' },
  // interiors
  desk: { file: 'metal_office_desk' },
  officeChair: { file: 'modern_arm_chair_01' },
  chair: { file: 'SchoolChair_01' },
  shelves: { file: 'steel_frame_shelves_01', scale: 0.1 },
  rack: { file: 'worn_metal_rack' },
  bookshelf: { file: 'wooden_bookshelf_worn' },
  filing: { file: 'drawer_cabinet' },
  tubeLight: { file: 'mounted_fluorescent_lights', keepY: true },
  till: { file: 'CashRegister_01' },
  sofa: { file: 'Sofa_01' },
  coffeeTable: { file: 'CoffeeTable_01' },
  tv: { file: 'Television_01' },
  laptop: { file: 'classic_laptop' },
  notepads: { file: 'office_notepads' },
  stool: { file: 'metal_stool_01' },
  displayShelves: { file: 'wooden_display_shelves_01' },
  toolCart: { file: 'tool_cart' },
  toolChest: { file: 'metal_tool_chest' },
  cafeChair: { file: 'plastic_monobloc_chair_01' },
  kitchenChair: { file: 'painted_wooden_chair_01' },
  table: { file: 'painted_wooden_table' },
  wallShelves: { file: 'painted_wooden_shelves' },
  cupboard: { file: 'painted_wooden_cabinet' },
  extinguisher: { file: 'korean_fire_extinguisher_01' },
  clock: { file: 'wall_clock', keepY: true },
  ceilingLamp: { file: 'modern_ceiling_lamp_01', keepY: true },
  hangingLamp: { file: 'hanging_industrial_lamp', keepY: true },
};

const lib = { files: {}, kinds: {}, ready: false, failed: false, promise: null };
export const modelsReady = () => lib.ready;
export const kind = (k) => lib.kinds[k];
// Kinds made in code (cars.js) join the same instancing, with no download.
export function registerKind(name, k) { lib.kinds[name] = k; }

// Light stand-ins for the scans past their near distance: a telegraph pole is
// 9k triangles and a lamp post 2.5k, both seen from 400 m down a street. A
// tapered post (and cross-arm or lantern) of the scan's own height, ~60
// triangles, no shadow.
function farProps() {
  const mat = (r, g, b) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), roughness: 0.9 });
  const wood = mat(0.3, 0.24, 0.18), iron = mat(0.06, 0.06, 0.07);
  const one = (name, build) => {
    const k = lib.kinds[name];
    if (!k) return;
    lib.kinds[name + '_far'] = { parts: build(k.size).map((geometry) => ({ geometry, material: geometry.userData.m, matrix: new THREE.Matrix4() })), size: k.size, shadow: false, noShadow: true };
  };
  const tag = (g, m) => { g.userData.m = m; return g; };
  for (const p of ['pole1', 'pole2', 'pole3']) {
    one(p, (sz) => [
      tag(new THREE.CylinderGeometry(0.11, 0.15, sz.y, 6).translate(0, sz.y / 2, 0), wood),
      tag(new THREE.BoxGeometry(Math.max(1.2, sz.x * 0.9), 0.12, 0.12).translate(0, sz.y * 0.93, 0), wood),
    ]);
  }
  const glow = mat(0.75, 0.72, 0.62);
  one('lampPost', (sz) => [
    tag(new THREE.CylinderGeometry(0.05, 0.09, sz.y * 0.86, 6).translate(0, sz.y * 0.43, 0), iron),
    tag(new THREE.CylinderGeometry(0.2, 0.13, sz.y * 0.14, 6).translate(0, sz.y * 0.93, 0), glow),
  ]);
  // the lantern glass of the scan and the far lantern light up at night (sky.js)
  const glass = lib.kinds.lampPost && lib.kinds.lampPost.parts.find((p) => /glass/.test(p.material.name));
  lib.lampGlow = [glow].concat(glass ? [glass.material] : []);
}

// materials sky.js lights with the street lamps
export function lampGlow() { return lib.lampGlow || []; }

// Rain on the props, plants and cars: rougher things go glossier and darker.
// The dry values are kept on the material the first time.
let wetNow = -1;
export function setWet(w) {
  if (w === wetNow) return;
  wetNow = w;
  const seen = new Set();
  for (const k of Object.values(lib.kinds)) {
    for (const part of k.parts) {
      const m = part.material;
      if (!m || seen.has(m) || !m.isMeshStandardMaterial) continue;
      seen.add(m);
      const d = m.userData.dry || (m.userData.dry = { r: m.roughness, c: m.color.clone() });
      m.roughness = d.r * (1 - 0.5 * w) + 0.06 * w;
      m.color.copy(d.c).multiplyScalar(1 - 0.2 * w);
    }
  }
}

let loader = null;
function gltfLoader(renderer) {
  if (loader) return loader;
  const ktx2 = new KTX2Loader().setTranscoderPath(assetUrl('assets/libs/basis/')).detectSupport(renderer);
  loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

// A kind: the meshes under the matched top-level nodes, each with its matrix
// relative to the kind's origin. One InstancedMesh per part later.
function makeKind(spec, scene) {
  scene.updateMatrixWorld(true);
  const roots = spec.nodes ? scene.children.filter((c) => spec.nodes.test(c.name)) : scene.children;
  const box = new THREE.Box3();
  const parts = [];
  for (const r of roots) {
    r.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
    });
  }
  if (!parts.length) return null;
  const s = spec.scale || 1;
  const centre = box.getCenter(new THREE.Vector3());
  const pre = new THREE.Matrix4().makeRotationY(spec.rotY || 0)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, spec.keepY ? 0 : -box.min.y, -centre.z));
  for (const p of parts) p.matrix.premultiply(pre);
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(s);
  // One part per material: a kit piece is often a dozen small meshes (bolts,
  // brackets, insulators) on one texture, and every part is an instanced draw.
  const byMat = new Map();
  for (const p of parts) {
    if (!byMat.has(p.material)) byMat.set(p.material, []);
    byMat.get(p.material).push(p);
  }
  const merged = [];
  for (const [material, list] of byMat) {
    // the scans read slightly glossy under the town's environment light
    material.envMapIntensity = 0.9;
    if (list.length === 1) { merged.push(list[0]); continue; }
    const geos = list.map((p) => {
      const g = p.geometry.clone();
      // quantized attributes (meshopt) must be plain floats to bake a matrix in
      for (const k of Object.keys(g.attributes)) {
        const a = g.attributes[k];
        if (a.normalized || !(a.array instanceof Float32Array)) {
          const f = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
          g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
        }
      }
      return g.applyMatrix4(p.matrix);
    });
    const keep = Object.keys(geos[0].attributes).filter((k) => geos.every((g) => g.attributes[k]));
    for (const g of geos) for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
    const geo = mergeGeometries(geos.map((g) => (g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()]))), false);
    if (geo) merged.push({ geometry: geo, material, matrix: new THREE.Matrix4() });
    else merged.push(...list);
  }
  return { parts: merged, size, shadow: !!spec.shadow };
}

export function loadModels(renderer) {
  if (lib.promise) return lib.promise;
  const lo = TOUCH_ONLY;
  const files = [...new Set(Object.values(KINDS).map((k) => k.file))];
  const L = gltfLoader(renderer);
  lib.promise = Promise.all(files.map(async (f) => {
    try {
      const buf = await fetchAsset(`assets/props/${f}${lo ? '_lo' : ''}.glb`);
      lib.files[f] = (await L.parseAsync(buf, '')).scene;
    } catch (e) {
      console.warn('prop not loaded', f, e.message);
    }
  })).then(() => {
    for (const [name, spec] of Object.entries(KINDS)) {
      const scene = lib.files[spec.file];
      if (scene) { const k = makeKind(spec, scene); if (k) lib.kinds[name] = k; }
    }
    farProps();
    if (wetNow > 0) { const w = wetNow; wetNow = -1; setWet(w); }   // raining already
    lib.ready = Object.keys(lib.kinds).length > 0;
    lib.failed = !lib.ready;
    return lib.ready;
  });
  return lib.promise;
}

const _c = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0);

// Instanced meshes for a list of placements { kind, x, y, z, rot, s, sy }.
// Returns a Group (one InstancedMesh per kind part), or null.
export function instance(placements, opts = {}) {
  const byKind = new Map();
  for (const p of placements) {
    if (!lib.kinds[p.kind]) continue;
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  if (!byKind.size) return null;
  const g = new THREE.Group();
  for (const [k, list] of byKind) {
    const K = lib.kinds[k];
    for (const part of K.parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((p, i) => {
        _q.setFromAxisAngle(_UP, p.rot || 0);
        const s = p.s || 1;
        _s.set(s, s * (p.sy || 1), s);
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s).multiply(part.matrix);
        im.setMatrixAt(i, _m);
        // per-instance paint (cars): sRGB colour, as the props are written
        if (part.paint) im.setColorAt(i, _c.setRGB(...(p.col || [0.8, 0.8, 0.8]), THREE.SRGBColorSpace));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = K.shadow && opts.shadow !== false;
      im.receiveShadow = true;
      im.userData.kind = k;
      g.add(im);
    }
  }
  return g;
}

// ------------------------------------------------------------ in the town --
//
// How far each kind is drawn, in metres. A hydrant or a weed is a few pixels
// beyond 60 m and costs as many triangles as up close; trees swap to a light
// version (`far`) past their near distance. Everything not listed: 120 m.
const VIEW = {
  weed: 35, weedB: 35, fern: 35, box: 45, tyre: 45, pot: 30, claypot: 30,
  hydrant: 70, hydrantOld: 70, bin: 70, binRust: 70, barrel: 70, barrelB: 70, crate: 60, plasticCrate: 50,
  bench: 60, seating: 90, planter: 70, cabinet: 80, cabinetWide: 80, aircon: 70, airconRust: 70, floodlight: 70,
  bush: 35, lampPost: 45, pole1: 70, pole2: 70, pole3: 70, lightbar: 120, barrier: 140,
  car_hatch: 220, car_sedan: 220, car_estate: 220, car_van: 220, coveredCar: 160,
  downpipe: 70, pipeOutlet: 50, pipeFunnel: 60, fireEscape: 140, shrubA: 60, shrubB: 60, shrubC: 60, shrubD: 60,
  // indoors: seen through a door or a window at most
  desk: 28, officeChair: 28, chair: 28, shelves: 35, rack: 28, bookshelf: 28, filing: 28, tubeLight: 28,
  till: 28, sofa: 28, coffeeTable: 28, tv: 28, laptop: 28, notepads: 28, stool: 28, displayShelves: 28,
  table: 28, diningTable: 28, cafeChair: 28, kitchenChair: 28, cupboard: 28, wallShelves: 28,
  extinguisher: 28, clock: 28, ceilingLamp: 28, hangingLamp: 35, wetSign: 28, toolCart: 28, toolChest: 28,
};
const NEAR_TREE = 80, FAR_TREE = 420;
// how far a kind's light `_far` version is drawn (past its near distance)
const FAR = { lampPost: 180, pole1: 420, pole2: 420, pole3: 420, bush: 120 };
export function viewDistance(k) {
  if (k.startsWith('tree_')) return NEAR_TREE;
  return VIEW[k] || 120;
}

// One kind's placements in the whole town as a single instanced mesh per
// part, refilled with just the placements in range whenever the camera has
// moved a few metres. One draw per part for the kind, however many there
// are, and no triangles spent beyond the kind's view distance. A kind with a
// far version (trees) fills that between the near and far distances.
export class KindInstances {
  constructor(name, placements, group) {
    this.name = name;
    this.near = viewDistance(name);
    this.farName = lib.kinds[name + '_far'] ? name + '_far' : null;
    this.far = this.farName ? FAR[name] || FAR_TREE : 0;
    this.list = placements;
    this.base = placements.map((p) => {
      _q.setFromAxisAngle(_UP, p.rot || 0);
      const sc = p.s || 1;
      _s.set(sc * (p.sx || 1), sc * (p.sy || 1), sc);
      return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), _q, _s);
    });
    const make = (k) => lib.kinds[k].parts.map((part) => {
      const im = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
      im.count = 0;
      im.castShadow = lib.kinds[k].shadow && !lib.kinds[k].noShadow;
      im.receiveShadow = true;
      im.frustumCulled = true;
      im.userData = { kind: k, part };
      if (part.paint) for (let i = 0; i < placements.length; i++) im.setColorAt(i, _c.setRGB(1, 1, 1));
      group.add(im);
      return im;
    });
    this.meshesNear = make(name);
    this.meshesFar = this.farName ? make(this.farName) : [];
    this.at = new THREE.Vector3(1e9, 0, 0);
  }

  // dir: the camera's horizontal view direction (x, z), when known. An
  // InstancedMesh is culled as a whole, so instances well outside the view
  // cone are left out here (beyond 25 m: nearer ones still cast shadows into
  // view), and the fill is redone when the camera turns as well as moves.
  update(cam, force, dir) {
    const turned = dir && this.dir && this.dir.x * dir.x + this.dir.z * dir.z < 0.96;
    if (!force && !turned && Math.abs(cam.x - this.at.x) + Math.abs(cam.z - this.at.z) < 6) return;
    this.at.set(cam.x, 0, cam.z);
    this.dir = dir && force !== 'all' ? { x: dir.x, z: dir.z } : null;
    const D = this.dir;
    const n2 = force === 'all' ? Infinity : this.near * this.near, f2 = this.far * this.far;
    let nn = 0, nf = 0;
    const near = [], far = [];
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i], dx = p.x - cam.x, dz = p.z - cam.z, d2 = dx * dx + dz * dz;
      // outside a 150 degree cone (the view plus the turn before a refill)
      if (D && d2 > 625 && dx * D.x + dz * D.z < -0.26 * Math.sqrt(d2)) continue;
      if (d2 < n2) near.push(i); else if (d2 < f2) far.push(i);
    }
    const fill = (meshes, idx) => {
      for (const im of meshes) {
        const part = im.userData.part;
        idx.forEach((i, j) => {
          im.setMatrixAt(j, _m.multiplyMatrices(this.base[i], part.matrix));
          if (part.paint) im.setColorAt(j, _c.setRGB(...(this.list[i].col || [0.8, 0.8, 0.8]), THREE.SRGBColorSpace));
        });
        im.count = idx.length;
        im.visible = idx.length > 0;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        if (idx.length) im.computeBoundingSphere();
      }
    };
    fill(this.meshesNear, near); nn = near.length;
    fill(this.meshesFar, far); nf = far.length;
    this.shown = { near: nn, far: nf };
  }
}
