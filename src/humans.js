import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { fetchAsset, progress } from './assets.js';
import { TOUCH_ONLY } from './input.js';
import { buildCarriedGun } from './viewmodel.js';
import { CFG } from './config.js';

// Real soldiers: eight Microsoft Rocketbox military avatars (MIT) driven by
// Quaternius' Universal Animation Library motion capture (CC0), retargeted
// onto the Rocketbox skeleton offline by tools/charbuild.js. Each GLB is one
// skinned mesh with one atlas material, an 80-bone 3ds Max biped and ten clips
// (idle, walk, jog, sprint, crouch idle/walk, two hit reactions, two deaths).
//
// The clips own the legs, hips and spine. Everything a rifleman does that a
// civilian clip does not -- carry and shoulder a rifle, aim up and down, fire,
// reload, throw, twist the chest toward a target while the legs walk another
// way, plant the feet on a slope -- is layered on top procedurally after the
// mixer runs, in the order the bones depend on each other:
//
//   mixer -> hip yaw toward travel -> spine twist + aim pitch -> foot plant
//         -> weapon mount on the chest -> two-bone arm IK onto grip and guard
//
// Desktop loads all eight at 1024 px per part; phones load six at 512 px.

export const LOOK_FILES = [
  'military_male_01', 'military_male_02', 'military_male_03', 'military_male_04',
  'military_male_05', 'military_male_06', 'military_female_01', 'military_female_02',
];
const PHONE_SKIP = new Set(['military_male_01', 'military_female_02']);
// Which looks can wear which loadout. Caps and no vest for the recon troops,
// plate carriers and helmets for the rest.
const TYPE_LOOKS = {
  scout: ['military_male_02', 'military_male_05', 'military_male_06'],
  assault: ['military_male_01', 'military_female_01', 'military_male_04'],
  heavy: ['military_male_04', 'military_male_01'],
  sniper: ['military_male_03', 'military_female_02'],
  elite: ['military_male_04', 'military_male_03'],
};
const GUN_FOR = { scout: 'smg', assault: 'rifle', heavy: 'shotgun', sniper: 'sniper', elite: 'smg' };
const LOCO = ['idle', 'walk', 'jog', 'sprint', 'crouchIdle', 'crouchWalk'];
const MOVING = ['walk', 'jog', 'sprint'];

const lib = { looks: {}, ready: false, failed: false, promise: null, loaded: 0, total: 0 };
export function humansReady() { return lib.ready && !lib.off; }
// Test hook: spawn the built-in soldiers instead (before/after shots, paired
// benchmarks). Affects soldiers created after the call.
export function useHumans(on) { lib.off = !on; }
// files done, plus the bytes of the ones still coming
export function humansProgress() {
  if (!lib.total) return 0;
  if (lib.ready || lib.failed) return 1;
  return Math.min(0.99, (lib.loaded + progress() * (lib.total - lib.loaded)) / lib.total);
}

export function loadHumans() {
  if (lib.promise) return lib.promise;
  const lo = TOUCH_ONLY;
  const names = LOOK_FILES.filter((n) => !lo || !PHONE_SKIP.has(n));
  const loader = new GLTFLoader();
  lib.total = names.length;
  lib.promise = Promise.all(names.map(async (n) => {
    const buf = await fetchAsset(`assets/chars/${n}${lo ? '_lo' : ''}.glb`);
    const gltf = await loader.parseAsync(buf, '');
    lib.looks[n] = prepare(gltf);
    lib.loaded++;
  })).then(() => { lib.ready = true; }, (e) => { lib.failed = true; console.warn('soldier models failed to load; using the built-in soldiers', e); });
  return lib.promise;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
// World transforms read straight from matrixWorld. Object3D.getWorld*() first
// re-multiplies every ancestor (a dozen matrices for a finger), and the
// solver reads hundreds per soldier per frame -- that alone made the people
// cost seven times the old soldiers. The rule instead: update() refreshes the
// whole rig once after the mixer; a bone the solver turns refreshes only its
// own matrix (`own`), plus the joints the next step reads; and each stage
// ends with one subtree refresh, so matrixWorld is current where it is read.
const _ps = new THREE.Vector3(), _sc = new THREE.Vector3();
const wpos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
const wquat = (o, out) => { o.matrixWorld.decompose(_ps, out, _sc); return out; };
const short = (n) => n.replace('Bip01_', '');
function own(b) { b.updateMatrix(); b.matrixWorld.multiplyMatrices(b.parent.matrixWorld, b.matrix); }

// Rotate a bone about a world-space axis, keeping its parent where it is.
function turnWorld(bone, axis, angle) {
  if (!angle) return;
  wquat(bone.parent, _q2); wquat(bone, _q3);
  _q.setFromAxisAngle(axis, angle);
  _q3.premultiply(_q);
  bone.quaternion.copy(_q2.invert().multiply(_q3));
  own(bone);
}
// Give a bone a world rotation.
function setWorldQuat(bone, q) {
  wquat(bone.parent, _q2);
  bone.quaternion.copy(_q2.invert().multiply(q));
  own(bone);
}

// Two-bone IK: swing `upper` so the middle joint lands where a triangle of the
// two bone lengths puts it (bent toward `pole`), then swing `lower` so `end`
// reaches the target. Swings only, so the clip's own twist survives. Targets
// past 99.5% of reach are pulled in, so the limb never locks straight.
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3(), _D = new THREE.Vector3();
const _E = new THREE.Vector3(), _G = new THREE.Vector3(), _P = new THREE.Vector3(), _W = new THREE.Quaternion();
function solveLimb(upper, lower, end, target, pole) {
  const a = wpos(upper, _A), b = wpos(lower, _B), c = wpos(end, _C);
  const la = a.distanceTo(b), lb = b.distanceTo(c);
  const d = _D.copy(target).sub(a);
  let dist = d.length();
  const max = (la + lb) * 0.995, min = Math.abs(la - lb) + 1e-4;
  dist = THREE.MathUtils.clamp(dist, min, max);
  const u = d.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = _P.copy(pole).addScaledVector(u, -pole.dot(u));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0);
  perp.normalize();
  const elbow = _E.copy(a).addScaledVector(u, cosA * la).addScaledVector(perp, sinA * la);
  const goal = _G.copy(a).addScaledVector(u, dist);
  // upper: (b - a) -> (elbow - a)
  _q.setFromUnitVectors(b.sub(a).normalize(), elbow.sub(a).normalize());
  wquat(upper, _W); _W.premultiply(_q); setWorldQuat(upper, _W);
  own(lower); own(end);
  // lower: (c - elbow) -> (goal - elbow)
  wpos(lower, b); wpos(end, c);
  _q.setFromUnitVectors(c.sub(b).normalize(), goal.sub(b).normalize());
  wquat(lower, _W); _W.premultiply(_q); setWorldQuat(lower, _W);
  own(end);
}

// Rotation that carries the frame (f, n) onto (F, N); both pairs unit and
// orthogonal.
function frameQuat(f, n, F, N, out) {
  const s = new THREE.Vector3().crossVectors(f, n), S = new THREE.Vector3().crossVectors(F, N);
  _m.makeBasis(f, n, s);
  _m2.makeBasis(F, N, S);
  _m2.multiply(_m.transpose());
  return out.setFromRotationMatrix(_m2);
}

// Per look, once: clips by name, height, how fast each gait travels, which
// way the hands and fingers point at rest.
function prepare(gltf) {
  const scene = gltf.scene;
  let mesh;
  scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  mesh.geometry.computeBoundingSphere();
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  const bones = {};
  for (const b of mesh.skeleton.bones) bones[short(b.name)] = b;
  scene.updateMatrixWorld(true);
  const crown = new THREE.Box3().setFromObject(scene).max.y;

  // Hands at rest. For a right hand palm down, fingers point along -X and the
  // thumb along +Z, so the palm normal (out of the palm) is thumb x fingers;
  // the left hand is mirrored.
  const hand = {};
  for (const side of ['L', 'R']) {
    const h = bones[`${side}_Hand`], hp = wpos(h, new THREE.Vector3());
    const f = wpos(bones[`${side}_Finger2`], new THREE.Vector3()).sub(hp).normalize();
    const t = wpos(bones[`${side}_Finger0`], new THREE.Vector3()).sub(hp);
    t.addScaledVector(f, -t.dot(f)).normalize();
    const n = side === 'R' ? new THREE.Vector3().crossVectors(t, f) : new THREE.Vector3().crossVectors(f, t);
    const inv = wquat(h, new THREE.Quaternion()).invert();
    // palm centre: halfway to the knuckles, a little toward the palm
    const knuckles = wpos(bones[`${side}_Finger2`], new THREE.Vector3()).distanceTo(hp);
    // finger curl axes, in each finger bone's own frame
    const curls = [];
    for (let k = 0; k <= 4; k++) {
      for (const seg of ['', '1', '2']) {
        const b = bones[`${side}_Finger${k}${seg}`];
        if (!b) continue;
        const child = b.children.find((c) => c.isBone);
        const dir = child ? wpos(child, new THREE.Vector3()).sub(wpos(b, new THREE.Vector3())).normalize() : f.clone();
        const axis = new THREE.Vector3().crossVectors(dir, n).normalize().applyQuaternion(wquat(b, new THREE.Quaternion()).invert());
        curls.push({ name: `${side}_Finger${k}${seg}`, axis, thumb: k === 0, seg: seg === '' ? 0 : +seg });
      }
    }
    hand[side] = { f: f.applyQuaternion(inv), n: n.applyQuaternion(inv), knuckles, curls };
  }

  // Gait speeds. A planted foot moves backward under an in-place clip at the
  // speed the body would travel; `lead` is where in the cycle the left foot is
  // furthest forward, so every gait can be phase-matched for blending.
  const rest = mesh.skeleton.bones.map((b) => [b.position.clone(), b.quaternion.clone()]);
  const mixer = new THREE.AnimationMixer(scene);
  const gait = {};
  for (const name of ['walk', 'jog', 'sprint', 'crouchWalk']) {
    const clip = clips[name];
    const a = mixer.clipAction(clip); a.play();
    const N = 48, ys = [], zs = [];
    for (let i = 0; i < N; i++) {
      mixer.setTime(clip.duration * i / N);
      scene.updateMatrixWorld(true);
      const p = wpos(bones.L_Toe0, new THREE.Vector3());
      ys.push(p.y); zs.push(p.z);
    }
    a.stop();
    const low = Math.min(...ys);
    let sum = 0, n = 0;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (ys[i] < low + 0.03 && ys[j] < low + 0.03) { sum += (zs[j] - zs[i]) / (clip.duration / N); n++; }
    }
    const speed = n ? Math.max(0.3, -sum / n) : 1;
    let lead = 0;
    for (let i = 1; i < N; i++) if (zs[i] > zs[lead]) lead = i;
    gait[name] = { speed, lead: lead / N, dist: speed * clip.duration };
  }
  mixer.stopAllAction(); mixer.uncacheRoot(scene);
  mesh.skeleton.bones.forEach((b, i) => { b.position.copy(rest[i][0]); b.quaternion.copy(rest[i][1]); });
  scene.updateMatrixWorld(true);
  return { scene, mesh, clips, crown, gait, hand };
}

// Hand frames on the weapon, in gun space (+Z muzzle, +X the soldier's left):
// fingers' direction from the wrist, and the palm's normal.
const GRIP_F = new THREE.Vector3(0.22, -0.32, 1).normalize();
const GRIP_N = new THREE.Vector3(1, 0.05, -0.22);
const GUARD_F = new THREE.Vector3(-0.55, 0.28, 0.79).normalize();
const GUARD_N = new THREE.Vector3(-0.28, 1, 0.02);
for (const [f, n] of [[GRIP_F, GRIP_N], [GUARD_F, GUARD_N]]) n.addScaledVector(f, -n.dot(f)).normalize();
// elbows: right one out and down, support one down and a little out
const POLE_R = new THREE.Vector3(-0.55, -0.78, -0.2).normalize();
const POLE_L = new THREE.Vector3(0.42, -0.88, -0.1).normalize();
const KNEE = new THREE.Vector3(0, 0.1, 1).normalize();

const GUN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });

export class Human {
  constructor(type, rand = Math.random) {
    const pool = (TYPE_LOOKS[type] || TYPE_LOOKS.assault).filter((n) => lib.looks[n]);
    const name = pool.length ? pool[(rand() * pool.length) | 0] : Object.keys(lib.looks)[0];
    const L = lib.looks[name];
    this.L = L;
    this.look = name;
    this.crown = L.crown;
    this.build = (type === 'heavy' ? 1.04 : 0.97) + rand() * 0.06;

    this.root = cloneSkinned(L.scene);
    this.root.traverse((o) => { if (o.isSkinnedMesh) this.mesh = o; });
    const mesh = this.mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Culling uses one sphere per skinned mesh, taken from the bind pose; a
    // body on the ground reaches well outside it, so it is widened (never
    // frustumCulled = false, see CLAUDE.md).
    mesh.boundingSphere = L.mesh.geometry.boundingSphere.clone();
    mesh.boundingSphere.radius *= 2.4;
    // Bone matrices are uploaded every frame even when the pose is held (the
    // distance LOD poses far soldiers every 2nd-6th frame): they are world
    // space, so skipping the upload would leave the body behind a moving root.
    const sk = this.skeleton = mesh.skeleton;
    const B = this.B = {};
    for (const b of sk.bones) B[short(b.name)] = b;
    // nodes from the root down to the hips, refreshed one by one each frame
    // instead of a full pass over the rig
    this.toHips = [];
    for (let o = B.Pelvis; o && o !== this.root; o = o.parent) this.toHips.unshift(o);
    this.legs = ['L_Thigh', 'L_Calf', 'L_Foot', 'R_Thigh', 'R_Calf', 'R_Foot'].map((n) => B[n]);
    this.groundT = 0; this.gl = 0; this.gr = 0;

    // grip: fingers curled once (no clip touches them)
    for (const side of ['L', 'R']) {
      for (const c of L.hand[side].curls) {
        const amt = c.thumb ? [0.25, 0.35, 0.3][c.seg] : side === 'R' ? [1.05, 1.15, 0.85][c.seg] : [0.75, 0.9, 0.7][c.seg];
        B[c.name].quaternion.multiply(_q.setFromAxisAngle(c.axis, amt));
      }
    }

    this.mixer = new THREE.AnimationMixer(this.root);
    this.act = {};
    for (const [n, c] of Object.entries(L.clips)) this.act[n] = this.mixer.clipAction(c);
    for (const n of LOCO) { const a = this.act[n]; a.play(); a.timeScale = 0; a.setEffectiveWeight(n === 'idle' ? 1 : 0); }
    this.phase = rand();
    this.idleT = rand() * 3;
    this.w = { idle: 1, walk: 0, jog: 0, sprint: 0, crouchIdle: 0, crouchWalk: 0 };
    this.crouchW = 0;
    this.hipYaw = 0; this.twist = 0; this.pitch = 0;
    this.drop = 0;
    this.fwdSpeed = 0;

    // Rest pose: the root is at the origin, so world here is model space.
    this.root.updateMatrixWorld(true);
    const p = (n) => wpos(B[n], new THREE.Vector3());
    const spine2 = p('Spine2'), shoulderR = p('R_UpperArm');
    this.shoulderY = shoulderR.y - spine2.y;
    this.shoulderX = shoulderR.x - spine2.x;

    // Weapon: a chest frame on Spine2 with the body's axes, the mount inside it.
    this.chest = new THREE.Object3D();
    this.chest.position.copy(spine2);
    this.root.add(this.chest);
    B.Spine2.attach(this.chest);
    this.mount = new THREE.Object3D();
    this.chest.add(this.mount);
    const g = this.gunSpec = buildCarriedGun(CFG.weapons[GUN_FOR[type] || 'rifle'].shape);
    this.gun = new THREE.Mesh(g.geometry, GUN_MAT);
    this.gun.castShadow = true;
    this.mount.add(this.gun);
    this.muzzlePos = g.muzzle.clone();
    // low ready and shouldered, in chest space (+X the soldier's left)
    // Where the butt sits, from the right shoulder joint in chest space (+X
    // his left): shouldered, in the pocket just inside and in front of the
    // joint; at low ready, lower on the chest with the muzzle down and across.
    this.pocketAim = new THREE.Vector3(0.045, -0.05, 0.085);
    this.pocketLow = new THREE.Vector3(0.06, -0.16, 0.11);
    this.mountLow = { r: new THREE.Euler(0.36, 0.3, 0.12) };

    this.fire = 0; this.reload = 0; this.throwT = 0; this.hitT = 0; this.hitPart = 'body'; this.hitSide = 1;
    this.dead = false; this.deathT = 0;
    this.gunFall = null;
  }

  // Hit volumes on the bones, built in the rest pose and attached so they keep
  // their place on the body through every clip: head, chest, pelvis, upper
  // and lower arms, thighs and shins. hitboxes[0] stays the head.
  hitboxes(material) {
    const B = this.B, out = [];
    // measured with the model on its own, so world space is model space
    const parent = this.root.parent;
    if (parent) parent.remove(this.root);
    this.root.updateMatrixWorld(true);
    const at = (n) => wpos(B[n], new THREE.Vector3());
    const box = (bone, centre, w, h, d, part, dir) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      m.position.copy(centre);
      if (dir) m.quaternion.setFromUnitVectors(UP, dir);
      this.root.add(m);
      B[bone].attach(m);
      out.push({ mesh: m, part });
    };
    const seg = (bone, child, r, part) => {
      const a = at(bone), b = at(child);
      box(bone, a.clone().add(b).multiplyScalar(0.5), r * 2, a.distanceTo(b) + r * 0.6, r * 2, part, b.clone().sub(a).normalize());
    };
    const head = at('Head');
    box('Head', head.clone().add(new THREE.Vector3(0, 0.085, 0.015)), 0.23, 0.27, 0.26, 'head');
    const s1 = at('Spine1'), neck = at('Neck');
    box('Spine2', s1.clone().add(neck).multiplyScalar(0.5).add(new THREE.Vector3(0, 0, 0.01)), 0.40, neck.y - s1.y + 0.06, 0.27, 'body');
    const pel = at('Pelvis');
    box('Pelvis', pel.clone().add(new THREE.Vector3(0, -0.02, 0)), 0.36, 0.26, 0.25, 'body');
    seg('L_UpperArm', 'L_Forearm', 0.068, 'arms'); seg('R_UpperArm', 'R_Forearm', 0.068, 'arms');
    seg('L_Forearm', 'L_Hand', 0.055, 'arms'); seg('R_Forearm', 'R_Hand', 0.055, 'arms');
    seg('L_Thigh', 'L_Calf', 0.095, 'legs'); seg('R_Thigh', 'R_Calf', 0.095, 'legs');
    seg('L_Calf', 'L_Foot', 0.07, 'legs'); seg('R_Calf', 'R_Foot', 0.07, 'legs');
    if (parent) parent.add(this.root);
    return out;
  }

  setShadow(on) {
    if (this.mesh.castShadow !== on) { this.mesh.castShadow = on; this.gun.castShadow = on; }
  }

  hit(part, side) {
    if (this.dead) return;
    this.hitT = 1; this.hitPart = part; this.hitSide = side;
    const clip = part === 'head' ? 'hitHead' : part === 'legs' ? null : 'hitChest';
    if (clip) {
      const a = this.act[clip];
      a.reset(); a.setLoop(THREE.LoopOnce, 1); a.timeScale = 1;
      a.setEffectiveWeight(0.85); a.fadeOut(a.getClip().duration); a.play();
    }
  }

  throw() { this.throwT = 1; }

  // `toShooter`: world direction to whoever fired the last shot. Both deaths
  // fall backwards, so the body first turns square to the shot.
  die(headshot, toShooter, groundY) {
    if (this.dead) return;
    this.dead = true; this.deathT = 0;
    for (const n of LOCO) this.act[n].fadeOut(0.18);
    for (const n of ['hitChest', 'hitHead']) this.act[n].fadeOut(0.1);
    const a = this.act[Math.random() < 0.5 ? 'death' : 'death2'];
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
    a.timeScale = headshot ? 1.3 : 1.0;
    a.setEffectiveWeight(1); a.fadeIn(0.12); a.play();
    this.deathYaw = 0;
    if (toShooter) {
      const parent = this.root.parent;
      parent.getWorldQuaternion(_q);
      const local = toShooter.clone().applyQuaternion(_q.invert());
      this.deathYaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.4, 1.4);
    }
    this.groundY = groundY;
  }

  // p: { dt, vx, vz (world velocity), aim 0..1, fire 0..1, reload bool,
  //      crouch bool, pitch (radians, + up), target (world point) | null,
  //      dist, ground(x, z, yHint) | null }
  update(p) {
    const dt = p.dt;
    if (this.dead) return this._dead(dt);
    const L = this.L, w = this.w;

    // ---- locomotion: speed along the body's facing, gait weights, phase ----
    const parent = this.root.parent;
    parent.updateWorldMatrix(true, false);    // the AI turned and moved the soldier
    wquat(parent, _q);
    const fwd = _v.set(0, 0, 1).applyQuaternion(_q); fwd.y = 0; fwd.normalize();
    const right = _v2.set(fwd.z, 0, -fwd.x);   // the body's +X (its left)
    const scale = this.sc = _v3.setFromMatrixScale(parent.matrixWorld).y;   // gait speeds are in model metres
    const speed = Math.hypot(p.vx, p.vz) / scale;
    // travel direction relative to facing; legs turn toward it, chest stays
    let yawWant = 0, sign = 1;
    if (speed > 0.4) {
      const a = Math.atan2(p.vx * right.x + p.vz * right.z, p.vx * fwd.x + p.vz * fwd.z);
      if (Math.abs(a) <= 1.95) yawWant = THREE.MathUtils.clamp(a, -1.1, 1.1);
      else { sign = -1; yawWant = THREE.MathUtils.clamp(a - Math.sign(a) * Math.PI, -1.1, 1.1); }
    }
    this.hipYaw += (yawWant - this.hipYaw) * Math.min(1, dt * 7);
    this.fwdSpeed += (sign * speed - this.fwdSpeed) * Math.min(1, dt * 8);
    const v = Math.abs(this.fwdSpeed);
    this.crouchW += ((p.crouch ? 1 : 0) - this.crouchW) * Math.min(1, dt * 6);

    const G = L.gait;
    const stand = { idle: 0, walk: 0, jog: 0, sprint: 0 };
    if (v < 0.15) stand.idle = 1;
    else if (v < G.walk.speed) { const k = v / G.walk.speed; stand.idle = 1 - k; stand.walk = k; }
    else if (v < G.jog.speed) { const k = (v - G.walk.speed) / (G.jog.speed - G.walk.speed); stand.walk = 1 - k; stand.jog = k; }
    else if (v < G.sprint.speed) { const k = (v - G.jog.speed) / (G.sprint.speed - G.jog.speed); stand.jog = 1 - k; stand.sprint = k; }
    else stand.sprint = 1;
    const cw = THREE.MathUtils.clamp(v / G.crouchWalk.speed, 0, 1);
    const want = {
      idle: stand.idle * (1 - this.crouchW), walk: stand.walk * (1 - this.crouchW),
      jog: stand.jog * (1 - this.crouchW), sprint: stand.sprint * (1 - this.crouchW),
      crouchIdle: (1 - cw) * this.crouchW, crouchWalk: cw * this.crouchW,
    };
    // one shared phase, advanced by distance over the blended stride
    let dist = 0, wsum = 0;
    for (const n of MOVING) { dist += G[n].dist * want[n]; wsum += want[n]; }
    dist += G.crouchWalk.dist * want.crouchWalk; wsum += want.crouchWalk;
    if (wsum > 0.01) this.phase += (this.fwdSpeed * dt) / (dist / wsum);   // fwdSpeed is model metres too
    this.phase -= Math.floor(this.phase);
    this.idleT += dt;
    for (const n of LOCO) {
      w[n] += (want[n] - w[n]) * Math.min(1, dt * 10);
      const a = this.act[n];
      a.setEffectiveWeight(w[n]);
      const d = a.getClip().duration;
      if (n === 'idle' || n === 'crouchIdle') a.time = this.idleT % d;
      else a.time = ((this.phase + G[n].lead) % 1) * d;
    }
    this.mixer.update(dt);

    // ---- hips toward travel, chest back toward the target ----
    this.root.rotation.y = this.hipYaw;
    own(this.root);
    for (const o of this.toHips) own(o);
    const B = this.B;
    own(B.Spine);
    for (const b of this.legs) own(b);
    const hit = this.hitT;
    this.hitT = Math.max(0, this.hitT - dt * 4);
    // a shooter blades the chest toward the gun side when shouldering, which
    // brings the support shoulder forward to the handguard
    let twist = -this.hipYaw - 0.32 * p.aim;
    if (hit > 0 && this.hitPart === 'arms') twist += 0.3 * hit * this.hitSide;
    this.pitch += ((p.pitch || 0) * p.aim - this.pitch) * Math.min(1, dt * 6);

    // ---- feet on the ground (near soldiers only) ----
    if (p.ground && p.dist < 16) this._plant(p.ground, dt, hit);
    else if (hit > 0 && this.hitPart === 'legs') this._legHit(hit);

    // twist on the upper spine only: the thighs hang off Bip01_Spine in this
    // rig, so turning that bone would swing the legs too. Pitch is about the
    // body's +X: a positive turn tips the chest forward.
    const chestRight = _v.set(1, 0, 0).applyQuaternion(wquat(parent, _q));
    // (own() first: a bone's matrixWorld must hold this frame's clip pose
    // before it is read, or last frame's twist compounds)
    own(B.Spine1); turnWorld(B.Spine1, UP, twist * 0.45); turnWorld(B.Spine1, chestRight, -this.pitch * 0.4);
    own(B.Spine2); turnWorld(B.Spine2, UP, twist * 0.55); turnWorld(B.Spine2, chestRight, -this.pitch * 0.6);
    B.Spine.updateMatrixWorld(true);

    // ---- weapon: the butt hangs off the right shoulder ----
    // Placed from the shoulder bone every frame, so it stays in the pocket
    // whatever the clip, the twist and the pitch did to the chest. Shouldered,
    // the muzzle points at the target itself, not wherever the chest leans.
    this.fire = p.fire;
    const aim = p.aim, m = this.mount, gs = this.gunSpec;
    const sc = this.sc;
    const chestQ = wquat(this.chest, new THREE.Quaternion());
    const shoulder = wpos(B.R_UpperArm, new THREE.Vector3());
    // low ready angles are from the body's facing, not the chest, so a clip
    // that leans forward does not point the muzzle at the feet
    const qLow = wquat(this.root, new THREE.Quaternion()).multiply(_q.setFromAxisAngle(UP, -this.hipYaw)).multiply(_q2.setFromEuler(this.mountLow.r));
    let qAim = chestQ.clone();
    const pocketAim = shoulder.clone().add(_v2.copy(this.pocketAim).multiplyScalar(sc).applyQuaternion(chestQ));
    if (p.target) {
      _m.lookAt(p.target, pocketAim, UP);
      qAim = new THREE.Quaternion().setFromRotationMatrix(_m);
      // no more than 70 degrees off the chest's own forward
      const off = qAim.angleTo(chestQ);
      if (off > 1.2) qAim.slerp(chestQ, 1 - 1.2 / off);
    }
    const q = qLow.slerp(qAim, aim);
    const pocket = shoulder.clone().add(_v2.copy(this.pocketLow).multiplyScalar(sc).applyQuaternion(chestQ)).lerp(pocketAim, aim);
    // recoil: muzzle up, butt driven back into the shoulder
    q.multiply(_q.setFromAxisAngle(_v.set(1, 0, 0), -0.09 * p.fire));
    pocket.addScaledVector(_v.set(0, 0, 1).applyQuaternion(q), -0.035 * p.fire * sc);
    this.reload += ((p.reload ? 1 : 0) - this.reload) * Math.min(1, dt * 6);
    if (this.reload > 0.01) {
      q.multiply(_q.setFromEuler(new THREE.Euler(0.25 * this.reload, 0, 0.45 * this.reload)));
      pocket.y -= 0.05 * this.reload * sc;
    }
    // gun origin from the butt
    const origin = pocket.sub(_v.set(0, -0.01, gs.stockZ).multiplyScalar(sc).applyQuaternion(q));
    m.position.copy(this.chest.worldToLocal(origin));
    m.quaternion.copy(chestQ.invert().multiply(q));
    m.updateMatrixWorld(true);

    // ---- arms onto the gun ----
    this._arms(dt);
  }

  _plant(ground, dt, hit) {
    const B = this.B, root = this.root;
    const base = wpos(this.root.parent, _v4).y;   // where the body stands
    const lf = wpos(B.L_Foot, new THREE.Vector3()), rf = wpos(B.R_Foot, new THREE.Vector3());
    const scale = this.sc;
    // ground under each foot, sampled ten times a second (each sample is a
    // collider query; slopes and steps do not change faster than that)
    this.groundT -= dt;
    if (this.groundT <= 0) {
      this.groundT = 0.1;
      this.gl = ground(lf.x, lf.z, base + 0.6) - base;
      this.gr = ground(rf.x, rf.z, base + 0.6) - base;
    }
    const gl = this.gl, gr = this.gr;
    // the lower foot sets how far the hips sink; the other leg folds up
    let want = Math.min(0, Math.min(gl, gr));
    if (want < -0.45 * scale) want = 0;     // a ledge, not a slope: stand
    if (hit > 0 && this.hitPart === 'legs') want -= 0.08 * hit * scale;
    this.drop += (want - this.drop) * Math.min(1, dt * 10);
    if (Math.abs(this.drop) < 1e-4 && Math.abs(gl) < 0.01 && Math.abs(gr) < 0.01) return;
    const pel = wpos(B.Pelvis, new THREE.Vector3());
    pel.y += this.drop;
    B.Pelvis.position.copy(B.Pelvis.parent.worldToLocal(pel));
    own(B.Pelvis); own(B.Spine);   // the thighs' parent
    const fq = new THREE.Quaternion();
    const knee = _v2.copy(KNEE).applyQuaternion(wquat(root, _q));
    for (const [side, g, foot] of [['L', gl, lf], ['R', gr, rf]]) {
      if (Math.abs(g) > 0.45 * scale) continue;
      wquat(B[`${side}_Foot`], fq);
      const target = foot.clone(); target.y += g;
      solveLimb(B[`${side}_Thigh`], B[`${side}_Calf`], B[`${side}_Foot`], target, knee);
      setWorldQuat(B[`${side}_Foot`], fq);
    }
  }

  _legHit(hit) {
    const pel = wpos(this.B.Pelvis, new THREE.Vector3());
    pel.y -= 0.07 * hit * this.sc;
    this.B.Pelvis.position.copy(this.B.Pelvis.parent.worldToLocal(pel));
    own(this.B.Pelvis); own(this.B.Spine);
  }

  _arms(dt) {
    const B = this.B, gun = this.gun, gs = this.gunSpec, H = this.L.hand;
    gun.updateMatrixWorld(true);
    wquat(gun, _q);
    const gq = _q.clone();
    const chestQ = wquat(this.chest, new THREE.Quaternion());
    // right hand: on the grip, unless it is throwing
    const gripT = gs.grip.clone().applyMatrix4(gun.matrixWorld);
    this.throwT = Math.max(0, this.throwT - dt * 1.4);
    if (this.throwT > 0) {
      // up behind the head, then over and forward
      const t = 1 - this.throwT, sc = this.sc;
      const k = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
      const off = new THREE.Vector3(this.shoulderX * 0.8, this.shoulderY + 0.25 * k, t < 0.45 ? -0.25 * k : 0.45 * (1 - k) - 0.1).multiplyScalar(sc);
      const over = wpos(this.chest, new THREE.Vector3()).add(off.applyQuaternion(chestQ));
      gripT.lerp(over, Math.min(1, Math.sin(Math.min(1, t * 1.2) * Math.PI) * 1.5));
    }
    this._hand('R', gripT, gq, GRIP_F, GRIP_N, POLE_R, chestQ, H.R);
    // left hand: on the handguard, or down to the magazine while reloading
    const guardT = gs.guard.clone().applyMatrix4(gun.matrixWorld);
    // out of reach (low ready, a short soldier): slide back along the gun
    {
      const sh = wpos(B.L_UpperArm, new THREE.Vector3()), sc = this.sc;
      const reach = (wpos(B.L_Forearm, _v2).distanceTo(sh) + wpos(B.L_Hand, _v3).distanceTo(_v2) + H.L.knuckles * 0.55 * sc) * 0.97;
      if (guardT.distanceTo(sh) > reach) {
        const back = gs.magwell.clone().applyMatrix4(gun.matrixWorld), g0 = guardT.clone();
        for (let k = 1; k <= 4 && guardT.distanceTo(sh) > reach; k++) guardT.copy(g0).lerp(back, k / 4);
      }
    }
    if (this.reload > 0.01) {
      const well = gs.magwell.clone().applyMatrix4(gun.matrixWorld);
      const bob = (Math.sin(performance.now() * 0.006) * 0.5 + 0.5) * 0.12 * this.sc;
      well.y -= bob;
      guardT.lerp(well, this.reload);
    }
    this._hand('L', guardT, gq, GUARD_F, GUARD_N, POLE_L, chestQ, H.L);
  }

  // Place one hand: orient it on the weapon, put its palm on the target, then
  // pass part of the wrist's roll to the forearm so the wrist does not twist
  // like a sweet wrapper (the rig has no forearm twist bones).
  _hand(side, palmAt, gunQ, F, N, pole, chestQ, h) {
    const B = this.B, hand = B[`${side}_Hand`], fore = B[`${side}_Forearm`], upper = B[`${side}_UpperArm`];
    const Fw = F.clone().applyQuaternion(gunQ), Nw = N.clone().applyQuaternion(gunQ);
    const want = frameQuat(h.f, h.n, Fw, Nw, new THREE.Quaternion());
    // palm centre sits half the knuckle distance along the fingers from the wrist
    const sc = this.sc;
    const wrist = palmAt.clone().addScaledVector(Fw, -h.knuckles * sc * 0.55).addScaledVector(Nw, -0.025 * sc);
    solveLimb(upper, fore, hand, wrist, pole.clone().applyQuaternion(chestQ));
    // roll the forearm about its own axis toward the hand's roll
    const axis = wpos(hand, new THREE.Vector3()).sub(wpos(fore, new THREE.Vector3())).normalize();
    const cur = wquat(hand, new THREE.Quaternion());
    const delta = want.clone().multiply(cur.invert());   // world rotation still needed at the hand
    if (delta.w < 0) { delta.x = -delta.x; delta.y = -delta.y; delta.z = -delta.z; delta.w = -delta.w; }
    // its twist about the forearm axis (swing-twist split)
    const ang = 2 * Math.atan2(delta.x * axis.x + delta.y * axis.y + delta.z * axis.z, delta.w);
    turnWorld(fore, axis, ang * 0.6);
    own(hand);
    setWorldQuat(hand, want);
    upper.updateMatrixWorld(true);   // fingers and the arm's hit boxes
  }

  _dead(dt) {
    this.deathT += dt;
    if (this.deathYaw) this.root.rotation.y += (this.deathYaw - this.root.rotation.y) * Math.min(1, dt * 10);
    this.mixer.update(dt);
    // the rifle leaves the hands and drops
    if (!this.gunFall && this.deathT > 0.12) {
      const holder = this.root.parent.parent;   // the soldier's root group
      holder.attach(this.gun);
      this.gunFall = { vy: 0.4, spin: (Math.random() - 0.5) * 6 };
    }
    if (this.gunFall && !this.gunFall.rest) {
      const g = this.gun, f = this.gunFall;
      const floor = (this.groundY !== undefined ? this.groundY : g.parent.getWorldPosition(_v).y) + 0.04;
      f.vy -= 9.8 * dt;
      g.position.y += f.vy * dt / g.parent.getWorldScale(_v).y;
      g.rotation.z += f.spin * dt;
      if (g.getWorldPosition(_v).y <= floor) {
        g.position.y += (floor - _v.y) / g.parent.getWorldScale(_v2).y;
        g.rotation.set(0, g.rotation.y, Math.PI / 2);   // on its side
        f.rest = true;
      }
    }
    if (this.deathT > 2.2) this.gun.visible = false;
  }
}

// ------------------------------------------------------------ first person
//
// The player's own arms: a soldier's sleeves, gloves and fingers cut from one
// of the loaded models (only triangles skinned to the arm bones), hung from
// the camera at the shoulders and solved onto each weapon's grip and
// handguard every frame with the same two-bone IK, so the hands stay on the
// gun through sway, recoil, ADS and swaps. During a reload the support hand
// follows the magazine down and back. Drawn in the weapon pass.
const FP_LOOKS = ['military_male_04', 'military_male_01', 'military_female_01', 'military_male_03'];
const ARM_BONE = /_(UpperArm|Forearm|Hand|Finger\d*)$/;
const FP_SCALE = 1.15;      // a viewmodel is seen from inside the head; real-length arms fall short of a long gun
const FP_BLADE = -0.35;     // torso turned toward the gun side: support shoulder forward, as in a real stance
const FP_POLE_R = new THREE.Vector3(0.62, -0.75, 0.25).normalize();
const FP_POLE_L = new THREE.Vector3(-0.55, -0.82, 0.15).normalize();
const FLIP = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

export class FPArms {
  constructor(layer) {
    const name = FP_LOOKS.find((n) => lib.looks[n]) || Object.keys(lib.looks)[0];
    const L = this.L = lib.looks[name];
    this.root = cloneSkinned(L.scene);
    let mesh;
    this.root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    // keep the arm triangles only
    const src = mesh.geometry, arm = new Set();
    mesh.skeleton.bones.forEach((b, i) => { if (ARM_BONE.test(b.name)) arm.add(i); });
    const si = src.attributes.skinIndex, sw = src.attributes.skinWeight, idx = src.index.array, keep = [];
    const armW = (v) => {
      let w = 0;
      for (let k = 0; k < 4; k++) if (arm.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      return w;
    };
    for (let t = 0; t < idx.length; t += 3) {
      if (armW(idx[t]) > 0.6 && armW(idx[t + 1]) > 0.6 && armW(idx[t + 2]) > 0.6) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    }
    const geo = src.clone();
    geo.setIndex(keep);
    mesh.geometry = geo;
    mesh.frustumCulled = false;   // always in front of the camera, nowhere else
    mesh.castShadow = false;
    mesh.layers.set(layer);
    this.mesh = mesh;
    const B = this.B = {};
    for (const b of mesh.skeleton.bones) B[short(b.name)] = b;
    this.rest = mesh.skeleton.bones.map((b) => b.quaternion.clone());
    for (const side of ['L', 'R']) {
      for (const c of L.hand[side].curls) {
        const amt = c.thumb ? [0.25, 0.35, 0.3][c.seg] : side === 'R' ? [1.05, 1.15, 0.85][c.seg] : [0.75, 0.9, 0.7][c.seg];
        B[c.name].quaternion.multiply(_q.setFromAxisAngle(c.axis, amt));
      }
    }
    this.restArms = ['L_UpperArm', 'L_Forearm', 'L_Hand', 'R_UpperArm', 'R_Forearm', 'R_Hand'].map((n) => [B[n], B[n].quaternion.clone()]);
    // face down the camera's -Z with the shoulders just under and ahead of the eye
    this.root.updateMatrixWorld(true);
    const sh = wpos(B.R_UpperArm, new THREE.Vector3());
    this.root.scale.setScalar(FP_SCALE);
    this.root.quaternion.setFromAxisAngle(UP, FP_BLADE).multiply(FLIP);
    this.root.position.set(0, -0.25 - sh.y * FP_SCALE, -0.03 + sh.z * FP_SCALE);
    this.sc = FP_SCALE;
  }

  // gun: the weapon's group (FP space: muzzle -Z); hands: { grip, guard }
  // in gun space; mag: the magazine object, or null; reload 0..1 weight.
  update(camera, gun, hands, mag, reload, shown = true) {
    // the arms live on the camera, not in the weapon's group, so they have to
    // follow its visibility by hand (scoped, driving, photo mode)
    this.mesh.visible = gun.visible && shown;
    if (!this.mesh.visible) return;
    for (const [b, q] of this.restArms) b.quaternion.copy(q);
    camera.updateMatrixWorld(true);
    const H = this.L.hand;
    const camQ = wquat(camera, new THREE.Quaternion());
    // the carried-gun hand frames are written for +Z muzzle; this gun is -Z
    const gq = wquat(gun, new THREE.Quaternion()).multiply(FLIP);
    const grip = hands.grip.clone().applyMatrix4(gun.matrixWorld);
    let guard = hands.guard.clone().applyMatrix4(gun.matrixWorld);
    // out of reach: slide back along the gun toward the magazine well
    const shL = wpos(this.B.L_UpperArm, new THREE.Vector3());
    const reach = (wpos(this.B.L_Forearm, _v2).distanceTo(shL) + wpos(this.B.L_Hand, _v3).distanceTo(_v2) + H.L.knuckles * 0.55 * this.sc) * 0.96;
    if (guard.distanceTo(shL) > reach) {
      const back = new THREE.Vector3(0, -0.06, -0.02).applyMatrix4(gun.matrixWorld), g0 = guard.clone();
      for (let k = 1; k <= 6 && guard.distanceTo(shL) > reach; k++) guard.copy(g0).lerp(back, k / 6);
    }
    if (mag && reload > 0) guard.lerp(new THREE.Vector3(0, -0.03, 0.02).applyMatrix4(mag.matrixWorld), reload);
    this._hand('R', grip, gq, GRIP_F, GRIP_N, FP_POLE_R, camQ, H.R);
    this._hand('L', guard, gq, GUARD_F, GUARD_N, FP_POLE_L, camQ, H.L);
  }
}
FPArms.prototype._hand = Human.prototype._hand;
