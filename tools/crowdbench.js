// Crowd cost: N soldiers in a ring 5-45 m round the player at the Main Street
// junction, the real AI running (they see and shoot; the player is kept
// alive). Reports the soldiers' own update time per frame (AI + animation,
// timed alone -- a second update per frame, so they move at double speed),
// draw calls and triangles, and the whole frame with gl.finish(), at
// 1920x1080 times the preset's render scale. Rigged people and the built-in
// soldiers are interleaved round by round, because the laptop throttles and
// only paired numbers mean anything (see CLAUDE.md).
//
//   const b = await import('/tools/crowdbench.js'); await b.run(__rs, { n: 24 })

export async function run(rs, opts = {}) {
  const g = rs.game, R = rs.renderer, S = rs.settings;
  const n = opts.n || 24, frames = opts.frames || 90, rounds = opts.rounds || 3;
  const preset = opts.preset || 'high';
  S.applyPreset(preset); rs.setQuality(preset);
  const W = 1920, H = 1080, scale = S.get('renderScale');
  R.setPixelRatio(scale); R.setSize(W, H, false);
  g.camera.aspect = W / H; g.camera.updateProjectionMatrix();
  if (g.post) g.post.setSize(W, H, scale);
  if (g.state !== 'play') g.start(rs.MODE.SURVIVAL);
  const gl = R.getContext();
  const types = ['assault', 'scout', 'heavy', 'sniper', 'elite'];
  const result = { human: [], procedural: [] };
  const one = (kind) => {
    rs.useHumans(kind === 'human');
    for (const r of g.robots) g.scene.remove(r.root);
    g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9;
    const ps = g.player.state; ps.x = 0; ps.z = 112; ps.yaw = Math.PI; ps.pitch = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, d = 5 + (i % 6) * 8;
      const x = Math.sin(a) * d * 0.5, z = 112 + 4 + Math.abs(Math.cos(a)) * d;
      const r = rs.spawnSoldier(types[i % types.length], x, z, Math.PI);
      r.alerted = true; r.awareness = 1;
    }
    for (let i = 0; i < 30; i++) { ps.health = 1e6; rs.step(1 / 60); }
    const t = [], ai = [];
    // the soldiers' own share: their update (AI + animation) timed alone
    const ctx = g._ctx();
    R.info.autoReset = false;
    let calls = 0, tris = 0;
    for (let i = 0; i < frames; i++) {
      ps.health = 1e6;
      const t0 = performance.now();
      rs.step(1 / 60);
      const t1 = performance.now();
      ctx.frame = ++g.losTick;
      for (const r of g.robots) r.update(1 / 60, ctx);
      ai.push(performance.now() - t1);
      R.info.reset();
      R.shadowMap.needsUpdate = i % 2 === 0;
      g.render();
      gl.finish();
      if (i === frames - 1) { calls = R.info.render.calls; tris = R.info.render.triangles; }
      t.push(performance.now() - t0 - ai[ai.length - 1]);
    }
    R.info.autoReset = true;
    const pc = (a, q) => +[...a].sort((x, y) => x - y)[Math.floor(a.length * q)].toFixed(2);
    return {
      frame: [pc(t, 0.1), pc(t, 0.5), pc(t, 0.9)], soldiers: [pc(ai, 0.1), pc(ai, 0.5), pc(ai, 0.9)],
      calls, tris, alive: g.robots.filter((r) => !r.dead).length,
    };
  };
  for (let k = 0; k < rounds; k++) {
    result.human.push(one('human'));
    result.procedural.push(one('procedural'));
  }
  rs.useHumans(true);
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0;
  window.dispatchEvent(new Event('resize'));
  return result;
}
