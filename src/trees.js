import * as THREE from 'three';
import { Tree } from './vendor/ez-tree/tree.js';
import { TEX } from './vendor/ez-tree/textures.js';
import { registerKind } from './models.js';
import { fetchAsset } from './assets.js';
import { SHARED } from './townmat.js';
import { TOUCH_ONLY } from './input.js';

// Real trees. Each species is grown once by ez-tree (MIT, vendored in
// src/vendor/ez-tree) from one of its presets, with the CC0 ambientCG bark
// (Bark006) and leaf set (LeafSet026) instead of its own images, scaled to a
// real height and registered as a model kind, so a street of trees is one
// instanced draw for bark and one for leaves per 160 m cell. The leaves sway
// in the wind (the shared wind uniform the old foliage used).
//
// The distant hillside forest stays the cheap cone trees; these replace the
// ones inside the playable area.

export const SPECIES = {
  tree_pine: { preset: 'Pine Medium', height: 12, seed: 4211, needles: true },
  tree_pineS: { preset: 'Pine Small', height: 7, seed: 977, needles: true },
  tree_oak: { preset: 'Oak Medium', height: 10, seed: 35729 },
  tree_ash: { preset: 'Ash Medium', height: 11, seed: 1377 },
  tree_aspen: { preset: 'Aspen Medium', height: 10, seed: 815 },
  bush: { preset: 'Bush 1', height: 1.7, seed: 31 },
};

function texture(srgb) {
  const t = new THREE.Texture();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}
async function fill(t, path, type) {
  try {
    const buf = await fetchAsset(path);
    t.image = await createImageBitmap(new Blob([buf], { type }), { imageOrientation: 'flipY' });
    t.flipY = false;
    t.needsUpdate = true;
  } catch (e) {
    console.warn('tree texture not loaded', path, e.message);
  }
}

function leafMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  if (!SHARED.uWind) SHARED.uWind = { value: 1 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SHARED.uTime;
    sh.uniforms.uWind = SHARED.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // crowns sway, more toward the top; each tree on its own phase
        #ifdef USE_INSTANCING
          vec3 ip = vec3( instanceMatrix[ 3 ] );
        #else
          vec3 ip = vec3( 0.0 );
        #endif
        float hh = max( position.y - 1.5, 0.0 );
        float ph = ip.x * 0.37 + ip.z * 0.21 + position.x * 0.8;
        transformed.x += sin( uTime * 1.3 + ph ) * hh * 0.012 * uWind;
        transformed.z += cos( uTime * 1.05 + ph * 1.4 ) * hh * 0.009 * uWind;
        transformed.y += sin( uTime * 2.7 + ph * 3.0 ) * 0.02 * uWind;`);
  };
  m.customProgramCacheKey = () => 'treeLeaves';
  return m;
}

let grown = false;
export function growTrees() {
  if (grown) return;
  grown = true;
  const sfx = TOUCH_ONLY ? '_lo' : '';
  TEX.bark = texture(true); TEX.barkNormal = texture(false); TEX.barkRough = texture(false); TEX.leaf = texture(true);
  const needleTex = texture(true);
  fill(TEX.bark, `assets/mat/Bark006_c${sfx}.jpg`, 'image/jpeg');
  fill(TEX.barkNormal, `assets/mat/Bark006_n${sfx}.jpg`, 'image/jpeg');
  fill(TEX.leaf, `assets/mat/LeafSet026_d${sfx}.webp`, 'image/webp');
  // conifers: the grass-blade set reads as needles where broad leaves would not
  fill(needleTex, `assets/mat/Foliage006_d${sfx}.webp`, 'image/webp');
  const bark = new THREE.MeshStandardMaterial({ map: TEX.bark, normalMap: TEX.barkNormal, roughness: 0.95, metalness: 0, color: 0xd8d0c4 });
  const leaves = leafMaterial(TEX.leaf);
  leaves.color.setRGB(0.66, 0.74, 0.56);
  const needles = leafMaterial(needleTex);
  needles.color.setRGB(0.42, 0.55, 0.4);
  needles.alphaTest = 0.3;
  const jobs = [];
  for (const [name, sp] of Object.entries(SPECIES)) {
    jobs.push([name, sp, false]);
  }
  farTrees(bark);
  for (const [name, sp, far] of jobs) {
    const t = new Tree();
    t.loadPreset(sp.preset);
    t.options.seed = sp.seed;
    // lighter than the presets (they are made for one hero tree): fewer
    // sections along each branch, fewer sides round it, fewer leaf cards
    const o = t.options;
    for (const k of Object.keys(o.branch.sections)) o.branch.sections[k] = Math.max(2, Math.round(o.branch.sections[k] * 0.6));
    for (const k of Object.keys(o.branch.segments)) o.branch.segments[k] = Math.max(3, Math.round(o.branch.segments[k] * 0.6));
    if (o.leaves) o.leaves.count = Math.max(2, Math.round((o.leaves.count || 10) * (TOUCH_ONLY ? 0.3 : 0.45)));
    if (name === 'bush' && o.leaves) o.leaves.count = Math.max(2, Math.round(o.leaves.count * 0.35));
    // conifers have one branch level, so their needle cards are the whole
    // crown: keep the count, and make the cards bigger to fill the gaps
    if (sp.needles && o.leaves) { o.leaves.count = Math.round(o.leaves.count / (TOUCH_ONLY ? 0.3 : 0.45) * 0.9); o.leaves.size *= 1.8; }

    t.generate();
    const bg = t.branchesMesh.geometry, lg = t.leavesMesh.geometry;
    bg.computeBoundingBox(); lg.computeBoundingBox();
    const box = bg.boundingBox.clone().union(lg.boundingBox);
    const s = sp.height / Math.max(0.1, box.max.y - box.min.y);
    const m = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(0, -box.min.y, 0));
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(s);
    registerKind(name, {
      parts: [
        { geometry: bg, material: bark, matrix: m },
        { geometry: lg, material: sp.needles ? needles : leaves, matrix: m.clone() },
      ],
      size, shadow: true,
      tris: (bg.index ? bg.index.count : bg.attributes.position.count) / 3 + (lg.index ? lg.index.count : lg.attributes.position.count) / 3,
    });
  }
}

// Beyond 80 m a tree is a few dozen pixels in the haze: a cone stack (the
// conifers) or a lumpy crown on a trunk, ~100 triangles, no shadow. Sized
// and coloured to match the grown tree it stands in for.
function farTrees(bark) {
  const green = (r, g, b) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), roughness: 0.95, flatShading: true });
  const pine = green(0.13, 0.22, 0.13), broad = green(0.24, 0.33, 0.16);
  const trunk = (h) => new THREE.CylinderGeometry(0.12, 0.2, h, 5).translate(0, h / 2, 0);
  const cones = (H, R) => {
    const g = [];
    for (let k = 0; k < 3; k++) g.push(new THREE.ConeGeometry(R * (1 - k * 0.25), H * 0.42, 7).translate(0, H * (0.3 + k * 0.2), 0));
    return merge(g);
  };
  const crown = (H, R) => {
    const g = new THREE.IcosahedronGeometry(R, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const n = 1 + 0.18 * Math.sin(p.getX(i) * 3.1 + p.getZ(i) * 2.3) * Math.cos(p.getY(i) * 2.7);
      p.setXYZ(i, p.getX(i) * n, p.getY(i) * n * 0.85 + H - R * 0.9, p.getZ(i) * n);
    }
    g.computeVertexNormals();
    return g;
  };
  const one = (name, H, R, conifer) => {
    registerKind(name + '_far', {
      parts: [
        { geometry: trunk(H * (conifer ? 0.35 : 0.5)), material: bark, matrix: new THREE.Matrix4() },
        { geometry: conifer ? cones(H, R) : crown(H, R), material: conifer ? pine : broad, matrix: new THREE.Matrix4() },
      ],
      size: new THREE.Vector3(R * 2, H, R * 2), shadow: false, noShadow: true,
    });
  };
  one('tree_pine', 12, 3.1, true);
  one('tree_pineS', 7, 1.6, true);
  one('tree_oak', 10, 3.6, false);
  one('tree_ash', 11, 4.2, false);
  one('tree_aspen', 10, 2.3, false);
}

function merge(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
