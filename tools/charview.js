// Look at built characters in the game world.
//
//   const v = await import('/tools/charview.js'); await v.show(__rs, 'military_male_01', 'walk', 0.4)
// Puts the soldier 3 m in front of a fixed camera on Main Street, poses the
// clip at the given fraction of its length, renders, and posts the frame to
// tools/shotsrv.js as shots/char_<look>_<clip>.jpg.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as photo from './photo.js';

const cache = {};
export async function show(rs, look, clipName = 'idle', frac = 0, opts = {}) {
  const g = rs.game, R = rs.renderer;
  const gltf = cache[look] || (cache[look] = await new GLTFLoader().loadAsync(`/docs/assets/chars/${look}.glb?v=${Date.now()}`));
  if (g.state !== 'play') g.start(rs.MODE.SURVIVAL);
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  if (opts.time) g._setTime(opts.time);
  const x = opts.x ?? 2, z = opts.z ?? 150;
  const ps = g.player.state; ps.x = x; ps.z = z;
  g.update(1 / 60);
  const model = gltf.scene;
  const yaw = opts.yaw ?? 0;
  model.position.set(x, g.surfaceH(x, z - (opts.dist ?? 3)), z - (opts.dist ?? 3));
  model.rotation.y = yaw;
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  g.scene.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = gltf.animations.find((c) => c.name === clipName);
  const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.play();
  mixer.setTime(clip.duration * frac);
  photo.on(rs);
  R.setPixelRatio(1); R.setSize(1280, 720, false);
  g.camera.aspect = 16 / 9; g.camera.updateProjectionMatrix(); if (g.post) g.post.setSize(1280, 720, 1);
  const cam = g.camera;
  const ty = model.position.y + (opts.lookY ?? 1.0);
  photo.look(rs, x + (opts.camX ?? 0), ty + (opts.camUp ?? 0.25), z, model.position.x, ty, model.position.z);
  R.shadowMap.needsUpdate = true; g.render(); g.render();
  const url = R.domElement.toDataURL('image/jpeg', 0.9);
  await fetch(`http://localhost:5179/?name=char_${look}_${clipName}${opts.tag || ''}`, { method: 'POST', body: url });
  photo.off(rs);
  g.scene.remove(model);
  window.dispatchEvent(new Event('resize'));
  return { clips: gltf.animations.map((c) => c.name), cam: cam.position.toArray().map((v) => +v.toFixed(2)) };
}
