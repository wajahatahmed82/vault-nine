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
  hydrant: { file: 'fire_hydrant', nodes: /^fire_hydrant(?!.*aged)/, rotY: 0, shadow: true },
  hydrantOld: { file: 'fire_hydrant', nodes: /aged/, shadow: true },
  // (the lids stand beside the cans in the scan; street bins keep theirs on)
  bin: { file: 'metal_trash_can', nodes: /^metal_trash_can(_handle_(left|right))?$/, shadow: true },
  binRust: { file: 'metal_trash_can', nodes: /^metal_trash_can_rust(_handle_(left|right))?$/, shadow: true },
  lampPost: { file: 'street_lamp_01', scale: 1.45, shadow: true },
  wallLamp: { file: 'street_lamp_02' },
  barrier: { file: 'concrete_road_barrier_02', shadow: true },
  fencePanel: { file: 'modular_chainlink_fence', nodes: /^modular_chainlink_fence_double$/, shadow: true },
  fencePost: { file: 'modular_chainlink_fence', nodes: /^modular_chainlink_fence_post$/, shadow: true },
  pole1: { file: 'modular_electricity_poles', nodes: /^preset_01_/, scale: 1.4, shadow: true },
  pole2: { file: 'modular_electricity_poles', nodes: /^preset_02_/, scale: 1.4, shadow: true },
  pole3: { file: 'modular_electricity_poles', nodes: /^preset_03_/, scale: 1.4, shadow: true },
  gutter: { file: 'modular_metal_gutter', nodes: /^modular_metal_gutter$/ },
  downpipe: { file: 'modular_metal_gutter', nodes: /^modular_metal_gutter_section$/ },
  pipeOutlet: { file: 'modular_metal_gutter', nodes: /^modular_metal_gutter_outlet$/ },
  pipeFunnel: { file: 'modular_metal_gutter', nodes: /^modular_metal_gutter_funnel$/ },
  seating: { file: 'modular_street_seating', nodes: /^(crossbar|legs_double|legs_single|back_support_r|back_support_l|arm_rest_01|arm_rest_02|seat|seat_back)$/, shadow: true },
  bench: { file: 'painted_wooden_bench', shadow: true },
  cabinet: { file: 'utility_box_01', shadow: true },
  cabinetWide: { file: 'utility_box_02', shadow: true },
  floodlight: { file: 'security_light' },
  aircon: { file: 'exterior_aircon_unit', nodes: /^exterior_aircon_unit$/ },
  airconRust: { file: 'exterior_aircon_unit', nodes: /rusted/ },
  shutterDoor: { file: 'rollershutter_door', nodes: /^rollershutter_door$/ },
  shutterWindow: { file: 'rollershutter_window_01', nodes: /^rollershutter_window_01$/ },
  tyre: { file: 'old_tyre' },
  coveredCar: { file: 'covered_car', shadow: true },
  fireEscape: { file: 'modular_fire_escape', shadow: true, keepY: true },
  planter: { file: 'planter_box_01', shadow: true },
  barrel: { file: 'Barrel_01', shadow: true },
  barrelB: { file: 'barrel_03', shadow: true },
  crate: { file: 'wooden_crate_01', shadow: true },
  crateLoot: { file: 'old_military_crate', nodes: /_a$/, shadow: true },
  plasticCrate: { file: 'plastic_crate_03' },
  box: { file: 'cardboard_box_01' },
  propane: { file: 'propane_tank', shadow: true },
  generator: { file: 'portable_generator', shadow: true },
  wetSign: { file: 'WetFloorSign_01' },
  shrubA: { file: 'shrub_02', nodes: /_a$/, shadow: true },
  shrubB: { file: 'shrub_02', nodes: /_b$/, shadow: true },
  shrubC: { file: 'shrub_02', nodes: /_c$/, shadow: true },
  shrubD: { file: 'shrub_02', nodes: /_d$/, shadow: true },
  weed: { file: 'weed_plant_02', nodes: /_a_LOD0$/ },
  weedB: { file: 'weed_plant_02', nodes: /_c_LOD0$/ },
  fern: { file: 'fern_02', nodes: /_b$/ },
  pot: { file: 'potted_plant_04' },
  claypot: { file: 'planter_pot_clay' },
  // interiors
  desk: { file: 'metal_office_desk', shadow: true },
  officeChair: { file: 'modern_arm_chair_01', shadow: true },
  chair: { file: 'SchoolChair_01', shadow: true },
  shelves: { file: 'steel_frame_shelves_01', scale: 0.1, shadow: true },
  rack: { file: 'worn_metal_rack', shadow: true },
  bookshelf: { file: 'wooden_bookshelf_worn', shadow: true },
  filing: { file: 'drawer_cabinet', shadow: true },
  tubeLight: { file: 'mounted_fluorescent_lights', keepY: true },
  till: { file: 'CashRegister_01' },
  sofa: { file: 'Sofa_01', shadow: true },
  coffeeTable: { file: 'CoffeeTable_01', shadow: true },
  tv: { file: 'Television_01' },
  laptop: { file: 'classic_laptop' },
  notepads: { file: 'office_notepads' },
  stool: { file: 'metal_stool_01', shadow: true },
  displayShelves: { file: 'wooden_display_shelves_01', shadow: true },
  toolCart: { file: 'tool_cart', shadow: true },
  toolChest: { file: 'metal_tool_chest', shadow: true },
  diningTable: { file: 'dining_table', shadow: true },
  cafeChair: { file: 'plastic_monobloc_chair_01', shadow: true },
  kitchenChair: { file: 'painted_wooden_chair_01', shadow: true },
  table: { file: 'painted_wooden_table', shadow: true },
  wallShelves: { file: 'painted_wooden_shelves', shadow: true },
  cupboard: { file: 'painted_wooden_cabinet', shadow: true },
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
  bench: 90, seating: 90, planter: 90, cabinet: 80, cabinetWide: 80, aircon: 70, airconRust: 70, floodlight: 70,
  bush: 55, lampPost: 110, pole1: 150, pole2: 150, pole3: 150, lightbar: 120, barrier: 140,
  car_hatch: 220, car_sedan: 220, car_estate: 220, car_van: 220, coveredCar: 160,
};
const NEAR_TREE = 80, FAR_TREE = 420;
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
    this.far = this.farName ? FAR_TREE : 0;
    this.list = placements;
    this.base = placements.map((p) => {
      _q.setFromAxisAngle(_UP, p.rot || 0);
      const sc = p.s || 1;
      _s.set(sc, sc * (p.sy || 1), sc);
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

  update(cam, force) {
    if (!force && Math.abs(cam.x - this.at.x) + Math.abs(cam.z - this.at.z) < 6) return;
    this.at.set(cam.x, 0, cam.z);
    const n2 = force === 'all' ? Infinity : this.near * this.near, f2 = this.far * this.far;
    let nn = 0, nf = 0;
    const near = [], far = [];
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i], dx = p.x - cam.x, dz = p.z - cam.z, d2 = dx * dx + dz * dz;
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
