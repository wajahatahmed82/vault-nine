// Close-ups of the soldiers in the game world, for the Phase 2 acceptance
// shots: idle, running, firing and dying at 2, 10 and 40 m from the player's
// eye. Animation only -- the AI is not run -- so every pose is the one asked
// for. Frames go to tools/shotsrv.js as shots/<tag>_<state>_<d>m.jpg.
//
//   const v = await import('/tools/humanview.js'); await v.capture(__rs, 'after')
//   await v.capture(__rs, 'before', { procedural: true })   // the old soldiers
//   await v.capture(__rs, 'hands', { states: ['firing'], dists: [3], camAt: [1.1, 1.4, -0.6] })

import * as photo from './photo.js';

const STATES = ['idle', 'running', 'firing', 'dying'];
const DISTS = [2, 10, 40];

export async function capture(rs, tag = 'after', opts = {}) {
  const g = rs.game, R = rs.renderer, THREE = rs.THREE;
  if (g.state !== 'play') g.start(rs.MODE.SURVIVAL);
  g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  if (opts.time) g._setTime(opts.time);
  const X = opts.x ?? 0, Z = opts.z ?? 112;      // the open junction on Main Street
  const out = [];
  for (const state of opts.states || STATES) {
    for (const d of opts.dists || DISTS) {
      for (const r of g.robots) g.scene.remove(r.root);
      g.robots.length = 0;
      const ps = g.player.state; ps.x = X; ps.z = Z; ps.yaw = Math.PI;   // looking down +Z
      g.update(1 / 60);
      const sx = X + (state === 'running' ? -0.6 : 0.3), sz = Z + d;
      const r = rs.spawnSoldier(opts.type || 'assault', sx, sz, Math.PI * 0.82);
      const h = r.human;
      if (opts.procedural && h) throw new Error('models are loaded; reload with them blocked for "before" shots');
      r.dist = d;
      // pose it: drive the animation only
      const step = (dt) => {
        if (r.dead) { r._death(dt); return; }
        if (state === 'running') { r.root.position.x += 3.4 * dt; r.walking = true; r.state = 'chase'; r.root.rotation.y = Math.PI / 2; }
        if (state === 'firing') { r.state = 'attack'; r.root.rotation.y = Math.atan2(X - r.root.position.x, Z - r.root.position.z); if (((t * 10) | 0) % 3 === 0) r.fireT = 1; }
        r.root.position.y = g.player.groundAt(r.root.position.x, r.root.position.z, r.root.position.y + 0.3);
        r._animate(dt);
      };
      let t = 0;
      const dur = state === 'dying' ? 0.9 : 1.6;
      for (; t < dur; t += 1 / 60) {
        if (state === 'dying' && !r.dead && t > 0.25) r.damage(9999, 'body');
        step(1 / 60);
      }
      if (state === 'firing') { r.fireT = 1; step(1 / 60); r.flash.visible = true; r.flash.material.opacity = 0.9; }
      // camera: player's eye, looking at the soldier's chest
      photo.on(rs);
      R.setPixelRatio(1); R.setSize(1280, 720, false);
      g.camera.aspect = 16 / 9; g.camera.updateProjectionMatrix(); if (g.post) g.post.setSize(1280, 720, 1);
      const eyeY = g.player.groundAt(X, Z, 5) + 1.62;
      const rp = r.root.position;
      const lookY = rp.y + (state === 'dying' ? 0.3 : 1.15);
      if (opts.camAt) {
        // a close inspection camera relative to the soldier instead of the eye
        const [cx, cy, cz] = opts.camAt;
        photo.look(rs, rp.x + cx, rp.y + cy, rp.z + cz, rp.x, rp.y + (opts.lookY ?? 1.15), rp.z);
      } else photo.look(rs, X, eyeY, Z, rp.x, d <= 2 ? lookY : (lookY + eyeY) * 0.5 - (d > 20 ? 0.2 : 0), rp.z);
      if (opts.fov) { g.camera.fov = opts.fov; g.camera.updateProjectionMatrix(); }
      R.shadowMap.needsUpdate = true; g.render(); g.render();
      const url = R.domElement.toDataURL('image/jpeg', 0.9);
      const name = `${tag}_${state}_${d}m`;
      await fetch(`http://localhost:5179/?name=${name}`, { method: 'POST', body: url });
      photo.off(rs);
      out.push(name);
    }
  }
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0;
  window.dispatchEvent(new Event('resize'));
  return out;
}
