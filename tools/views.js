// Before/after captures from fixed camera positions.
//
// Five views (Main Street, the square, Station Road, the warehouse yard,
// inside the police station) at day, dusk and night, rendered at 1280x720 on
// the HIGH preset with the HUD hidden, and posted to tools/shotsrv.js (port
// 5179), which writes shots/<prefix>_<time>_<view>.jpg.
//
//   const v = await import('/tools/views.js'); await v.capture(__rs, 'before')

import * as photo from './photo.js';

export function views(rs) {
  const T = rs.game.town;
  const pol = T.byTag('police');
  const a = T.local(pol, pol.tagItem.x + 3, pol.tagItem.z + 3.5, 0);
  const b = T.local(pol, pol.tagItem.x - 1, pol.tagItem.z - 0.5, 0);
  return {
    main: [2, 128, Math.PI, 0.02],
    square: [24, 196, -Math.PI / 2 + 0.25, 0.04],
    station: [0, 72, Math.PI, -0.04],
    yard: [128, 146, -Math.PI / 2 - 0.05, 0.05],
    police: [a.x, a.z, Math.atan2(-(b.x - a.x), -(b.z - a.z)), -0.22],
  };
}

export async function capture(rs, prefix, opts = {}) {
  const g = rs.game, R = rs.renderer, S = rs.settings;
  const W = opts.w || 1280, H = opts.h || 720;
  const keep = { tod: S.get('timeOfDay'), q: S.get('quality'), hud: S.get('showHud') };
  S.applyPreset(opts.preset || 'high');
  g.campaignFrom = 'town';
  g.start(rs.MODE.SURVIVAL);
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  g.townPower = true;
  if (g.town && g.town.cc0Ready) await g.town.cc0Ready;
  // the real update, kept so each view can run one frame of it: that puts the
  // sun's shadow box (and the lamps' real lights) round the view, in old and
  // new code alike, before the simulation is frozen for the picture
  const update = g.update.bind(g);
  photo.on(rs);
  R.setPixelRatio(1);
  R.setSize(W, H, false);
  g.camera.aspect = W / H; g.camera.updateProjectionMatrix();
  if (g.post) g.post.setSize(W, H, 1);
  const out = [];
  const V = opts.views || views(rs);
  for (const tod of opts.times || ['day', 'dusk', 'night']) {
    g._setTime(tod);
    if (opts.onTime) await opts.onTime(tod);
    for (const [name, v] of Object.entries(V)) {
      if (opts.only && !opts.only.includes(name)) continue;
      const ps = g.player.state;
      ps.x = v[0]; ps.z = v[1]; ps.y = g.player.groundAt(v[0], v[1], g.surfaceH(v[0], v[1]) + 0.5); ps.vx = ps.vy = ps.vz = 0;
      g.atmos.state.lastAssign = -1;
      g.input.releaseAll();
      update(1 / 60);
      if (g.sunFar) g.sunFar.shadow.needsUpdate = true;
      photo.eye(rs, ...v);
      g.atmos.update(0.3, g.camera.position);
      R.shadowMap.needsUpdate = true;
      g.render();
      for (let i = 0; i < 2; i++) g.render();
      const url = R.domElement.toDataURL('image/jpeg', 0.9);
      const res = await fetch(`http://localhost:5179/?name=${prefix}_${tod}_${name}`, { method: 'POST', body: url });
      out.push(`${prefix}_${tod}_${name}: ${(await res.json()).bytes} B`);
    }
  }
  photo.off(rs);
  S.set('timeOfDay', keep.tod);
  g._setTime(keep.tod);
  window.dispatchEvent(new Event('resize'));
  return out;
}
