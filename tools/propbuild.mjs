// Prop build: Poly Haven glTF (raw/p3/models/<id>/) -> game GLBs.
//
//   node tools/propbuild.mjs            # every model
//   node tools/propbuild.mjs fire_hydrant metal_trash_can
//
// Per model, two files in docs/assets/props/:
//   <id>.glb     desktop: simplified to the triangle budget below, textures at
//                512 px as KTX2 (ETC1S; normal maps in normal-map mode)
//   <id>_lo.glb  phones: half the triangles, 256 px textures
// Both meshopt-compressed (EXT_meshopt_compression + quantization). Named
// nodes are kept apart so modular kits (fences, poles, gutters) can be used
// piece by piece; everything else in a node is joined to cut draw calls.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, reorder, quantize, meshopt, join, flatten, sparse } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { ktx2 } from 'ktx2-encoder/gltf-transform';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'raw', 'p3', 'models');
const OUT = path.join(ROOT, 'docs', 'assets', 'props');
fs.mkdirSync(OUT, { recursive: true });

// Desktop triangle budget per model (phones get half). Unlisted: 2500.
const BUDGET = {
  fire_hydrant: 2500, street_lamp_01: 1400, street_lamp_02: 1400, metal_trash_can: 2000,
  concrete_road_barrier_02: 1500, modular_chainlink_fence: 6000, modular_electricity_poles: 4500,
  modular_metal_gutter: 3000, modular_street_seating: 5000, modular_fire_escape: 6000,
  exterior_aircon_unit: 2500, covered_car: 4000, portable_generator: 2500, cardboard_box_01: 800,
  plastic_crate_03: 1500, wooden_crate_01: 1000, Barrel_01: 1200, barrel_03: 1000, old_tyre: 900,
  utility_box_01: 1200, utility_box_02: 1200, security_light: 1200, WetFloorSign_01: 300,
  rollershutter_door: 600, rollershutter_window_01: 600, old_military_crate: 1500, propane_tank: 1200,
  painted_wooden_bench: 700, planter_box_01: 2000,
  shrub_02: 3500, shrub_03: 3500, shrub_04: 3500, weed_plant_02: 1500, fern_02: 1500, potted_plant_04: 2500, planter_pot_clay: 800,
  metal_office_desk: 2000, modern_arm_chair_01: 2500, SchoolChair_01: 1500, steel_frame_shelves_01: 1500,
  worn_metal_rack: 2000, wooden_bookshelf_worn: 2500, drawer_cabinet: 2500, mounted_fluorescent_lights: 1500,
  CashRegister_01: 2000, Sofa_01: 2500, CoffeeTable_01: 2000, Television_01: 1200, classic_laptop: 1500,
  office_notepads: 400, metal_stool_01: 1500, wooden_display_shelves_01: 2000, tool_cart: 3000,
  metal_tool_chest: 2500, dining_table: 1000, plastic_monobloc_chair_01: 1500, painted_wooden_chair_01: 700,
  painted_wooden_table: 600, painted_wooden_shelves: 500, painted_wooden_cabinet: 1500,
  korean_fire_extinguisher_01: 1500, wall_clock: 800, modern_ceiling_lamp_01: 1200, hanging_industrial_lamp: 2000,
};

// Small props a player sees at arm's length at most: 256 px textures (128 on phones).
const SMALL = new Set(['Barrel_01', 'barrel_03', 'wooden_crate_01', 'plastic_crate_03', 'cardboard_box_01', 'old_tyre',
  'WetFloorSign_01', 'propane_tank', 'office_notepads', 'wall_clock', 'classic_laptop', 'Television_01', 'CashRegister_01',
  'metal_stool_01', 'painted_wooden_chair_01', 'SchoolChair_01', 'plastic_monobloc_chair_01', 'korean_fire_extinguisher_01',
  'modern_ceiling_lamp_01', 'planter_pot_clay', 'weed_plant_02', 'fern_02', 'security_light', 'painted_wooden_table',
  'painted_wooden_shelves', 'dining_table', 'CoffeeTable_01']);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
});

const decode = async (buffer) => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

const tris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
};

async function build(id, lo) {
  const dir = path.join(SRC, id);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const doc = await io.read(path.join(dir, file));
  const before = tris(doc);
  const budget = (BUDGET[id] || 2500) * (lo ? 0.5 : 1);
  const ratio = Math.min(1, budget / before);
  const S = (SMALL.has(id) ? 256 : 512) / (lo ? 2 : 1);
  await doc.transform(
    dedup(), prune(), flatten(), join({ keepNamed: true }), weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: lo ? 0.05 : 0.02 }),
    textureCompress({ encoder: sharp, resize: [S, S], targetFormat: 'png' }),
  );
  // colour maps in sRGB, normal maps in normal-map mode, the rest linear
  await doc.transform(
    ktx2({ slots: /^(baseColorTexture|emissiveTexture)$/, isUASTC: false, qualityLevel: 160, isSetKTX2SRGBTransferFunc: true, isPerceptual: true, generateMipmap: true, imageDecoder: decode }),
    ktx2({ slots: /^normalTexture$/, isUASTC: false, qualityLevel: 200, isNormalMap: true, isPerceptual: false, generateMipmap: true, imageDecoder: decode }),
    ktx2({ slots: /.*/, isUASTC: false, qualityLevel: 160, isPerceptual: false, generateMipmap: true, imageDecoder: decode }),
  );
  await doc.transform(prune(), reorder({ encoder: MeshoptEncoder }), quantize(), sparse(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, `${id}${lo ? '_lo' : ''}.glb`);
  await io.write(out, doc);
  return { before, after: tris(doc), bytes: fs.statSync(out).size };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(SRC);
let sum = { hi: 0, lo: 0 };
for (const id of ids) {
  try {
    const hi = await build(id, false), lo = await build(id, true);
    sum.hi += hi.bytes; sum.lo += lo.bytes;
    console.log(id.padEnd(28), `${hi.before} -> ${hi.after} / ${lo.after} tris`, `${(hi.bytes / 1024).toFixed(0)} KB / ${(lo.bytes / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.warn(id, 'FAILED', e.message);
  }
}
console.log('total', (sum.hi / 1e6).toFixed(2), 'MB desktop,', (sum.lo / 1e6).toFixed(2), 'MB phones');
