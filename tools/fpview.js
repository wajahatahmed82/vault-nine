// The player's view of each weapon: hip, aimed and mid-reload, from the real
// game camera (not photo mode, which hides the gun). Frames go to
// tools/shotsrv.js as shots/fp_<tag>_<weapon>_<pose>.jpg. Needs ?capture.
//
//   const v = await import('/tools/fpview.js'); await v.capture(__rs, 'after')
//   await v.capture(__rs, 'before', { boxHands: true })

export async function capture(rs, tag = 'after', opts = {}) {
  const g = rs.game, R = rs.renderer, W = g.weapons;
  if (g.state !== 'play') g.start(rs.MODE.SURVIVAL);
  g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0;
  R.setPixelRatio(1); R.setSize(1280, 720, false);
  g.camera.aspect = 16 / 9; g.camera.updateProjectionMatrix(); if (g.post) g.post.setSize(1280, 720, 1);
  const ps = g.player.state; ps.x = opts.x ?? 1; ps.z = opts.z ?? 112; ps.y = g.player.groundAt(ps.x, ps.z, 5); ps.yaw = opts.yaw ?? Math.PI * 0.95; ps.pitch = -0.04;
  const out = [];
  // the old box hands, for "before" shots
  const arms = W.arms;
  if (opts.boxHands && arms) {
    W.arms = null; arms.root.visible = false;
    for (const k of W.ids) for (const h of W.models[k].hands.meshes) h.visible = true;
  }
  for (const id of opts.weapons || ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']) {
    W.owned = null;
    W.current = id;
    for (const k of W.ids) W.models[k].gun.visible = k === id;
    W.reloading = 0; W.swapT = 0; W.pendingSwap = null; W.inspectT = 0;
    for (const pose of opts.poses || ['hip', 'ads', 'reload']) {
      g.input.state = g.input.state || {};
      W.wantAds = pose === 'ads';
      W.ads = pose === 'ads' ? 1 : 0;
      W.reloading = 0;
      if (pose === 'reload') { W.reloadTotal = 2; W.reloading = 2 * 0.62; W.reloadEmpty = false; }
      for (let i = 0; i < 3; i++) { W.ads = pose === 'ads' ? 1 : 0; g.update(1 / 60); if (pose === 'reload') W.reloading = 2 * 0.62; }
      W.ads = pose === 'ads' ? 1 : 0;
      W.update(0, g.scene);
      R.shadowMap.needsUpdate = true; g.render();
      const name = `fp_${tag}_${id}_${pose}`;
      await fetch(`http://localhost:5179/?name=${name}`, { method: 'POST', body: R.domElement.toDataURL('image/jpeg', 0.9) });
      out.push(name);
    }
  }
  W.reloading = 0; W.ads = 0; W.wantAds = false;
  if (opts.boxHands && arms) W.useArms(arms), arms.root.visible = true;
  window.dispatchEvent(new Event('resize'));
  return out;
}
