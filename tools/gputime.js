// GPU time per frame at a fixed view, with timer queries (needs
// EXT_disjoint_timer_query_webgl2). For paired comparisons between builds:
// call queue() in each build's tab in turn, then read() a moment later.
//
//   const t = await import('/tools/gputime.js'); t.queue(__rs, 'square', 'dusk'); ...; t.read(__rs)

import * as photo from './photo.js';
import { views } from './views.js';

let pending = null;

export async function queue(rs, view = 'square', tod = 'dusk', frames = 30) {
  const g = rs.game, R = rs.renderer, gl = R.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'no timer extension';
  rs.settings.applyPreset('high');
  if (g.state !== 'play') { g.start(rs.MODE.SURVIVAL); for (const r of g.robots) g.scene.remove(r.root); g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9; }
  g._setTime(tod);
  const v = views(rs)[view];
  const ps = g.player.state; ps.x = v[0]; ps.z = v[1];
  const update = g.update.bind(g);
  update(1 / 60);
  photo.on(rs);
  R.setPixelRatio(1); R.setSize(1280, 720, false);
  g.camera.aspect = 16 / 9; g.camera.updateProjectionMatrix();
  if (g.post) g.post.setSize(1280, 720, 1);
  photo.eye(rs, ...v);
  for (let i = 0; i < 5; i++) { R.shadowMap.needsUpdate = true; g.render(); }
  gl.finish();
  const qs = [];
  for (let i = 0; i < frames; i++) {
    // shadows every other frame, as the game does
    R.shadowMap.needsUpdate = i % 2 === 0;
    if (g.sunFar && i % 30 === 0) g.sunFar.shadow.needsUpdate = true;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    g.render();
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    qs.push(q);
  }
  gl.finish();
  pending = { qs, gl, ext };
  photo.off(rs);
  return 'queued';
}

export function read(rs) {
  if (!pending) return null;
  const { qs, gl, ext } = pending;
  rs.game.render(); gl.finish();
  const ms = qs.filter((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)).map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
  const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
  if (!ms.length) return { n: 0 };
  pending = null;
  const q = (p) => +ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(2);
  return { n: ms.length, p10: q(0.1), p50: q(0.5), p90: q(0.9), disjoint };
}
