// Character build tool: Rocketbox soldiers + Quaternius motion -> GLB.
//
// Runs in the dev page. Reads the processed sources in raw/ (git-ignored:
// raw/chars/<Look>/<Look>.fbx and its textures as JPEG, raw/anim/UAL1_Standard.glb),
// and for each soldier:
//   - packs its parts' colour, normal and roughness into one atlas and one
//     MeshStandardMaterial (parts 1024 px for desktop, 512 px for phones), so
//     the soldier is a single draw call,
//   - retargets the motion clips onto its 3ds Max biped skeleton: each mapped
//     bone takes the source bone's rotation relative to the source rest pose,
//     carried into the target's frame (the target's A-pose limbs are first
//     swung into the source's T-pose); the hips also take the source's
//     translation, scaled by leg length,
//   - bakes a mirrored copy of the death so there are two,
//   - exports a GLB (metres, facing +Z, JPEG textures) to tools/assetsrv.js,
//     which writes docs/assets/chars/<look>.glb and <look>_lo.glb.
//
//   const c = await import('/tools/charbuild.js'); await c.buildAll()

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const LOOKS = [
  'Military_Male_01', 'Military_Male_02', 'Military_Male_03', 'Military_Male_04',
  'Military_Male_05', 'Military_Male_06', 'Military_Female_01', 'Military_Female_02',
];

// source (Unreal-style mannequin) -> target (3ds Max biped)
const MAP = {
  pelvis: 'Bip01_Pelvis', spine_01: 'Bip01_Spine', spine_02: 'Bip01_Spine1', spine_03: 'Bip01_Spine2',
  neck_01: 'Bip01_Neck', Head: 'Bip01_Head',
  clavicle_l: 'Bip01_L_Clavicle', upperarm_l: 'Bip01_L_UpperArm', lowerarm_l: 'Bip01_L_Forearm', hand_l: 'Bip01_L_Hand',
  clavicle_r: 'Bip01_R_Clavicle', upperarm_r: 'Bip01_R_UpperArm', lowerarm_r: 'Bip01_R_Forearm', hand_r: 'Bip01_R_Hand',
  thigh_l: 'Bip01_L_Thigh', calf_l: 'Bip01_L_Calf', foot_l: 'Bip01_L_Foot', ball_l: 'Bip01_L_Toe0',
  thigh_r: 'Bip01_R_Thigh', calf_r: 'Bip01_R_Calf', foot_r: 'Bip01_R_Foot', ball_r: 'Bip01_R_Toe0',
};
// limb bones and the child each points at, parent first
const LIMBS = [
  ['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'], ['upperarm_r', 'lowerarm_r'], ['lowerarm_r', 'hand_r'],
  ['thigh_l', 'calf_l'], ['calf_l', 'foot_l'], ['foot_l', 'ball_l'], ['thigh_r', 'calf_r'], ['calf_r', 'foot_r'], ['foot_r', 'ball_r'],
];
const MIRROR = (n) => n.replace(/_l$/, '__L').replace(/_r$/, '_l').replace(/__L$/, '_r');

const CLIPS = [
  ['Idle_Loop', 'idle'], ['Walk_Loop', 'walk'], ['Jog_Fwd_Loop', 'jog'], ['Sprint_Loop', 'sprint'],
  ['Crouch_Idle_Loop', 'crouchIdle'], ['Crouch_Fwd_Loop', 'crouchWalk'],
  ['Hit_Chest', 'hitChest'], ['Hit_Head', 'hitHead'], ['Death01', 'death'],
];
const FPS = 30;
const JPEG_Q = 0.85;

let srcCache = null;
async function source() {
  if (srcCache) return srcCache;
  const g = await new GLTFLoader().loadAsync('/raw/anim/UAL1_Standard.glb');
  let skin; g.scene.traverse((o) => { if (o.isSkinnedMesh && !skin) skin = o; });
  srcCache = { scene: g.scene, skin, clips: g.animations };
  return srcCache;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const worldQuat = (o, out) => o.getWorldQuaternion(out);
const worldPos = (o, out) => o.getWorldPosition(out);
// forward of a rig: heel to toe on both feet (the toes splay, so one foot
// alone is off by ~14 degrees), flattened
function forward(bones, footL, toeL, footR, toeR) {
  const d = (f, t) => worldPos(bones(t), new THREE.Vector3()).sub(worldPos(bones(f), new THREE.Vector3()));
  const f = d(footL, toeL).add(d(footR, toeR)); f.y = 0; return f.normalize();
}

// Put a skeleton in its bind pose. Skeleton.pose() takes a root bone's bind
// matrix as its local matrix and so drops whatever transform the bone's
// (non-bone) parent carries -- the glTF armature's -90 degree X turn, here,
// which laid every retargeted clip flat on its back. The bind-time world of
// each bone is skin.matrixWorld * bindMatrix^-1 * boneInverse^-1.
function restPose(skin) {
  skin.updateMatrixWorld(true);
  const base = skin.matrixWorld.clone().multiply(skin.bindMatrix.clone().invert());
  const world = new Map();
  skin.skeleton.bones.forEach((b, i) => world.set(b, base.clone().multiply(skin.skeleton.boneInverses[i].clone().invert())));
  const m = new THREE.Matrix4();
  const set = (b) => {
    const parentWorld = world.get(b.parent) || b.parent.matrixWorld;
    m.copy(parentWorld).invert().multiply(world.get(b));
    m.decompose(b.position, b.quaternion, b.scale);
    for (const c of b.children) if (world.has(c)) set(c);
  };
  // roots: bones whose parent is outside the skeleton (FBX makes that parent
  // a Bone too, so isBone does not tell)
  for (const b of skin.skeleton.bones) if (!world.has(b.parent)) { b.parent.updateMatrixWorld(true); set(b); }
}

const img = (url) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });

// Guillotine packing: biggest first, each into the first free rectangle that
// takes it, the rest of that rectangle split in two.
function pack(items, W) {
  const free = [{ x: 0, y: 0, w: W, h: W * 2 }];
  let H = 0;
  for (const it of [...items].sort((a, b) => b.w * b.h - a.w * a.h)) {
    free.sort((a, b) => a.y - b.y || a.x - b.x);
    const f = free.find((r) => r.w >= it.w && r.h >= it.h);
    free.splice(free.indexOf(f), 1);
    it.x = f.x; it.y = f.y;
    free.push({ x: f.x + it.w, y: f.y, w: f.w - it.w, h: it.h }, { x: f.x, y: f.y + it.h, w: f.w, h: f.h - it.h });
    H = Math.max(H, it.y + it.h);
  }
  let h = 1; while (h < H) h *= 2;
  return { w: W, h };
}

// The source uniforms carry a real national flag on the sleeve. The game's
// forces are invented, so each flag is painted over with a plain unit patch:
// find small cells holding flag red or flag blue, group touching cells, and
// cover every group that has both colours. Runs on the part's rectangle of the
// colour atlas (the normal map there is flattened so the patch is smooth).
// Faces are skipped: the mouth interior is dark red too.
function coverFlags(cg, ng, p, S) {
  const C = Math.max(4, S / 128), need = C * C / 8, cw = Math.floor(p.w / C), ch = Math.floor(p.h / C);
  const px = cg.getImageData(p.x, p.y, cw * C, ch * C).data, W = cw * C;
  const kind = new Uint8Array(cw * ch);   // 1 red, 2 blue
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let red = 0, blue = 0;
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const i = ((cy * C + y) * W + cx * C + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      // the printed flag is dark and desaturated: red (106,34,45), pink
      // stripes (165,88,104), blue (68,85,154). Skin has b < g; camo is grey.
      if (r > 80 && r - g > 40 && r - b > 20 && b >= g - 5) red++;
      else if (b > 100 && b - r > 40 && b - g > 25) blue++;
    }
    kind[cy * cw + cx] = red >= need ? 1 : blue >= need ? 2 : 0;
  }
  const seen = new Uint8Array(cw * ch);
  for (let i = 0; i < kind.length; i++) {
    if (!kind[i] || seen[i]) continue;
    const stack = [i]; seen[i] = 1;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, reds = 0, blues = 0;
    while (stack.length) {
      const j = stack.pop(), x = j % cw, y = (j / cw) | 0;
      if (kind[j] === 1) reds++; else blues++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      // 8-neighbours and one cell further, so white stripes do not split a flag
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy, k = ny * cw + nx;
        if (nx >= 0 && ny >= 0 && nx < cw && ny < ch && kind[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    if (reds < 2 || blues < 1) continue;
    const X = p.x + (x0 - 0.5) * C, Y = p.y + (y0 - 0.5) * C, Wd = (x1 - x0 + 2) * C, Ht = (y1 - y0 + 2) * C;
    cg.fillStyle = '#3f4433'; cg.fillRect(X, Y, Wd, Ht);
    cg.strokeStyle = '#2a2d22'; cg.lineWidth = Math.max(2, C / 3); cg.strokeRect(X + 2, Y + 2, Wd - 4, Ht - 4);
    // invented insignia: a tan chevron
    cg.fillStyle = '#9c8f6a';
    cg.beginPath(); cg.moveTo(X + Wd * 0.25, Y + Ht * 0.35); cg.lineTo(X + Wd * 0.5, Y + Ht * 0.62); cg.lineTo(X + Wd * 0.75, Y + Ht * 0.35);
    cg.lineTo(X + Wd * 0.75, Y + Ht * 0.5); cg.lineTo(X + Wd * 0.5, Y + Ht * 0.77); cg.lineTo(X + Wd * 0.25, Y + Ht * 0.5); cg.closePath(); cg.fill();
    ng.fillStyle = 'rgb(128,128,255)'; ng.fillRect(X, Y, Wd, Ht);
    p.flags = (p.flags || 0) + 1;
  }
}

// Colour, normal and roughness/metalness atlases for one soldier. Each part's
// textures are <pre>_<part>_color{_acu}.jpg and _normal.jpg; a part with none
// (the combat knife) gets a small flat patch. S is the side of a full-size part.
async function buildAtlas(dir, mats, S) {
  const suffix = S < 1024 ? '_512' : '';
  const parts = [];
  for (const m of mats) {
    const name = m.name, part = name.split('_').slice(1).join('_');
    const color = (await img(`${dir}${name}_color_acu${suffix}.jpg`)) || (await img(`${dir}${name}_color${suffix}.jpg`));
    const normal = await img(`${dir}${name}_normal${suffix}.jpg`);
    const rough = part.startsWith('head') ? 0.55 : part.startsWith('helmet') ? 0.6 : part.startsWith('pistol') || part.includes('knife') ? 0.45 : 0.86;
    const metal = part.includes('knife') || part.startsWith('pistol') ? 0.6 : 0.02;
    // parts keep their aspect; equipment sheets are 2:1, the pistol is half size
    let w = S / 16, h = S / 16;
    if (color) { const k = part.startsWith('pistol') ? 0.5 : 1; w = S * k; h = Math.round(S * k * color.height / color.width); }
    parts.push({ name, color, normal, rough, metal, w, h });
  }
  const size = pack(parts, S * 2);
  const canvas = (w, h, fill) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, w, h); return [c, g]; };
  const [cc, cg] = canvas(size.w, size.h, '#202020');
  const [nc, ng] = canvas(size.w, size.h, 'rgb(128,128,255)');
  const R = 8;   // roughness atlas at 1/8 resolution
  const [rc, rg] = canvas(size.w / R, size.h / R, 'rgb(0,220,0)');
  for (const p of parts) {
    if (p.normal) ng.drawImage(p.normal, p.x, p.y, p.w, p.h);
    if (p.color) { cg.drawImage(p.color, p.x, p.y, p.w, p.h); if (!p.name.includes('_head')) coverFlags(cg, ng, p, S); } else { cg.fillStyle = '#2a2b2c'; cg.fillRect(p.x, p.y, p.w, p.h); }
    rg.fillStyle = `rgb(0,${Math.round(p.rough * 255)},${Math.round(p.metal * 255)})`;
    rg.fillRect(Math.floor(p.x / R), Math.floor(p.y / R), Math.ceil(p.w / R), Math.ceil(p.h / R));
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = false;
    t.userData.mimeType = 'image/jpeg';
    return t;
  };
  const mr = tex(rc, false);
  const material = new THREE.MeshStandardMaterial({
    name: 'soldier', map: tex(cc, true), normalMap: tex(nc, false),
    roughness: 1, metalness: 1, roughnessMap: mr, metalnessMap: mr,
  });
  return { material, rects: parts.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })), size, flags: parts.reduce((n, p) => n + (p.flags || 0), 0), canvas: cc };
}

// The FBX arrives unindexed (three vertices per triangle) with an unused
// vertex colour, float skin weights and one group per material: 3.5 MB and a
// draw call per part. Move the UVs into the atlas, index it, drop the colour,
// store weights and joints as bytes and UVs as unsigned shorts.
// Runs once per FBX load (it rewrites the UVs in place).
function packGeometry(geo, rects, size) {
  geo.deleteAttribute('color');
  // FBX UVs count v up from the bottom, glTF's from the top (the textures are
  // drawn into the atlas the right way up and exported with flipY off)
  const uv = geo.attributes.uv;
  for (let i = 1; i < uv.array.length; i += 2) uv.array[i] = 1 - uv.array[i];
  // each material's UVs into its rectangle of the atlas; the geometry is still
  // unindexed here, so a group's range is its vertices
  for (const g of geo.groups) {
    const r = rects[g.materialIndex];
    for (let v = g.start; v < g.start + g.count; v++) {
      const u0 = THREE.MathUtils.clamp(uv.array[v * 2], 0, 1), v0 = THREE.MathUtils.clamp(uv.array[v * 2 + 1], 0, 1);
      uv.array[v * 2] = (r.x + u0 * r.w) / size.w;
      uv.array[v * 2 + 1] = (r.y + v0 * r.h) / size.h;
    }
  }
  geo.clearGroups();
  geo = mergeVertices(geo, 1e-4);
  const w = geo.attributes.skinWeight, n = w.count, W = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = [w.getX(i), w.getY(i), w.getZ(i), w.getW(i)], tot = v[0] + v[1] + v[2] + v[3] || 1;
    let sum = 0, big = 0;
    for (let k = 0; k < 4; k++) { W[i * 4 + k] = Math.round(v[k] / tot * 255); sum += W[i * 4 + k]; if (v[k] > v[big]) big = k; }
    W[i * 4 + big] += 255 - sum;
  }
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(W, 4, true));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(Uint8Array.from(geo.attributes.skinIndex.array), 4));
  geo.setAttribute('uv', new THREE.BufferAttribute(Uint16Array.from(geo.attributes.uv.array, (x) => Math.round(x * 65535)), 2, true));
  return geo;
}

async function buildLook(look, { lo = false } = {}) {
  const dir = `/raw/chars/${look}/`;
  const fbx = await new FBXLoader().loadAsync(dir + look + '.fbx');
  let mesh; fbx.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });

  // ---- one material: every part's colour, normal and roughness packed into
  // an atlas, so a soldier is one draw call instead of one per part ----
  const atlas = await buildAtlas(dir, Array.isArray(mesh.material) ? mesh.material : [mesh.material], lo ? 512 : 1024);
  mesh.material = atlas.material;

  // ---- rigs at rest ----
  const S = await source();
  const sBones = (n) => S.skin.skeleton.bones.find((b) => b.name === n);
  const tBones = (n) => mesh.skeleton.bones.find((b) => b.name === n);
  restPose(S.skin); S.scene.updateMatrixWorld(true);
  restPose(mesh); fbx.updateMatrixWorld(true);
  // character frames: rotate the source onto the target's facing
  const fS = forward(sBones, 'foot_l', 'ball_l', 'foot_r', 'ball_r'), fT = forward(tBones, 'Bip01_L_Foot', 'Bip01_L_Toe0', 'Bip01_R_Foot', 'Bip01_R_Toe0');
  const R = new THREE.Quaternion().setFromUnitVectors(fS, fT), Ri = R.clone().invert();
  // The source rests in a T-pose, the Rocketbox soldiers in an A-pose (hands
  // ~40 cm lower). Swing each limb bone of the target so it points at its
  // child the way the source bone does, parent first; the deltas below are
  // then measured from the same physical pose on both rigs.
  for (const [s, sc] of LIMBS) {
    fbx.updateMatrixWorld(true);
    const tb = tBones(MAP[s]), tc = tBones(MAP[sc]);
    const dS = worldPos(sBones(sc), new THREE.Vector3()).sub(worldPos(sBones(s), new THREE.Vector3())).applyQuaternion(R).normalize();
    const dT = worldPos(tc, new THREE.Vector3()).sub(worldPos(tb, new THREE.Vector3())).normalize();
    const want = new THREE.Quaternion().setFromUnitVectors(dT, dS).multiply(worldQuat(tb, new THREE.Quaternion()));
    tb.quaternion.copy(worldQuat(tb.parent, new THREE.Quaternion()).invert().multiply(want));
  }
  fbx.updateMatrixWorld(true);
  const qS0 = {}, qT0 = {}, restLocalT = {};
  for (const [s, t] of Object.entries(MAP)) {
    qS0[s] = worldQuat(sBones(s), new THREE.Quaternion());
    qT0[t] = worldQuat(tBones(t), new THREE.Quaternion());
  }
  for (const b of mesh.skeleton.bones) restLocalT[b.name] = { q: b.quaternion.clone(), p: b.position.clone() };
  const sPel0 = worldPos(sBones('pelvis'), new THREE.Vector3()), tPel0 = worldPos(tBones('Bip01_Pelvis'), new THREE.Vector3());
  // leg length ratio, target units per source unit
  const legS = sPel0.y - worldPos(sBones('foot_l'), new THREE.Vector3()).y;
  const legT = tPel0.y - worldPos(tBones('Bip01_L_Foot'), new THREE.Vector3()).y;
  const ratio = legT / legS;
  // target bones in parent-first order
  const order = [], inSkel = new Set(mesh.skeleton.bones);
  const visit = (b) => { order.push(b); for (const c of b.children) if (inSkel.has(c)) visit(c); };
  for (const b of mesh.skeleton.bones) if (!inSkel.has(b.parent)) visit(b);
  const tToS = Object.fromEntries(Object.entries(MAP).map(([s, t]) => [t, s]));

  const mixer = new THREE.AnimationMixer(S.scene);
  const bake = (clip, outName, mirror) => {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip); action.play();
    const n = Math.max(2, Math.round(clip.duration * FPS) + 1);
    const times = new Float32Array(n);
    const qv = {}; for (const t of Object.values(MAP)) qv[t] = new Float32Array(n * 4);
    const pv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const time = Math.min(clip.duration, i / FPS);
      times[i] = time;
      action.time = time; mixer.update(0);
      S.scene.updateMatrixWorld(true);
      // reset target to rest, then set mapped bones parent-first
      for (const b of mesh.skeleton.bones) { b.quaternion.copy(restLocalT[b.name].q); b.position.copy(restLocalT[b.name].p); }
      fbx.updateMatrixWorld(true);
      for (const b of order) {
        const sName = tToS[b.name];
        if (!sName) { b.updateMatrixWorld(true); continue; }
        const from = mirror ? MIRROR(sName) : sName;
        // source world delta from rest, in the source frame
        worldQuat(sBones(from), _q);
        _q.multiply(_q2.copy(qS0[from]).invert());
        if (mirror) { _q.y = -_q.y; _q.z = -_q.z; }
        // carried into the target frame, applied to the target's rest
        const dT = R.clone().multiply(_q).multiply(Ri);
        const wantWorld = dT.multiply(qT0[b.name]);
        const parentWorld = b.parent ? worldQuat(b.parent, new THREE.Quaternion()) : new THREE.Quaternion();
        b.quaternion.copy(parentWorld.invert().multiply(wantWorld));
        if (b.name === 'Bip01_Pelvis') {
          const d = worldPos(sBones('pelvis'), _v).sub(sPel0);
          if (mirror) d.x = -d.x;
          d.applyQuaternion(R).multiplyScalar(ratio);
          const want = tPel0.clone().add(d);
          b.parent.worldToLocal(want);
          b.position.copy(want);
        }
        b.updateMatrixWorld(true);
        const o = i * 4;
        qv[b.name][o] = b.quaternion.x; qv[b.name][o + 1] = b.quaternion.y; qv[b.name][o + 2] = b.quaternion.z; qv[b.name][o + 3] = b.quaternion.w;
        if (b.name === 'Bip01_Pelvis') { pv[i * 3] = b.position.x; pv[i * 3 + 1] = b.position.y; pv[i * 3 + 2] = b.position.z; }
      }
    }
    const tracks = Object.entries(qv).map(([t, v]) => new THREE.QuaternionKeyframeTrack(`${t}.quaternion`, times, v));
    tracks.push(new THREE.VectorKeyframeTrack('Bip01_Pelvis.position', times, pv));
    return new THREE.AnimationClip(outName, clip.duration, tracks);
  };

  const clips = [];
  for (const [src, name] of CLIPS) {
    const c = S.clips.find((x) => x.name === src);
    if (!c) { console.warn('missing clip', src); continue; }
    clips.push(bake(c, name, false));
    if (name === 'death') clips.push(bake(c, 'death2', true));
  }
  // back to rest for export
  for (const b of mesh.skeleton.bones) { b.quaternion.copy(restLocalT[b.name].q); b.position.copy(restLocalT[b.name].p); }

  mesh.geometry = packGeometry(mesh.geometry, atlas.rects, atlas.size);

  // ---- export: metres, facing +Z ----
  const root = new THREE.Group();
  root.name = look;
  const holder = new THREE.Group();
  holder.scale.setScalar(0.01);
  // turn the model so its toes point down +Z
  holder.quaternion.setFromUnitVectors(new THREE.Vector3(fT.x, 0, fT.z).normalize(), new THREE.Vector3(0, 0, 1));
  root.add(holder);
  holder.add(fbx);
  root.updateMatrixWorld(true);
  // GLTFExporter re-encodes every texture through canvas.toBlob at the browser
  // default (0.92 for JPEG); 0.85 is about two thirds the bytes
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, type) { return toBlob.call(this, cb, type, JPEG_Q); };
  let glb;
  try { glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips, onlyVisible: false }); } finally { HTMLCanvasElement.prototype.toBlob = toBlob; }
  const path = `chars/${look.toLowerCase()}${lo ? '_lo' : ''}.glb`;
  const res = await fetch(`http://localhost:5177/?path=${path}`, { method: 'POST', body: glb });
  const info = await res.json();
  return { look, lo, path, bytes: info.bytes, tris: (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3, bones: mesh.skeleton.bones.length, clips: clips.map((c) => c.name), ratio: +ratio.toFixed(3), facing: [+fT.x.toFixed(2), +fT.z.toFixed(2)], flags: atlas.flags, atlas: atlas.canvas };
}

export async function buildAll(opts = {}) {
  const out = [];
  for (const look of opts.looks || LOOKS) {
    out.push(await buildLook(look, { lo: false }));
    out.push(await buildLook(look, { lo: true }));
  }
  return out;
}
export { buildLook };
