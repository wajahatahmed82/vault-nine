// Town performance harness.
//
//   const p = await import('/tools/perftest.js'); await p.run(__rs, { preset: 'high' })
//
// 1. Searches the whole map on a grid, eight headings per spot, for the views
//    with the most draw calls and the most triangles. That is where budgets are
//    judged, not a flattering hand-picked angle.
// 2. Times the worst views and a set of named views at 1920x1080 times the
//    preset's render scale, with gl.finish() so GPU time is counted, shadows
//    refreshed every other frame exactly as the game does.
//
// The laptop throttles, so timings are reported as ranges (10th-90th
// percentile frame time) and only comparable within one run.

import * as photo from './photo.js';

const NAMED = {
  gate: [0, 44, Math.PI, -0.04],
  stationRoad: [0, 72, Math.PI, -0.06],
  mainStreet: [2, 128, Math.PI, 0],
  square: [24, 196, -Math.PI / 2, 0],
  residential: [-75, 140, Math.PI, 0],
  terraces: [-52, 245, Math.PI, 0],
  industrial: [152, 140, Math.PI, 0],
  ridgeRoad: [-120, 110, -Math.PI / 2, 0],
};

export async function run(rs, opts = {}) {
  const g = rs.game, R = rs.renderer, S = rs.settings;
  const preset = opts.preset || 'high';
  const frames = opts.frames || 60;
  const W = opts.w || 1920, H = opts.h || 1080;

  S.applyPreset(preset);
  rs.setQuality(preset);
  await new Promise((r) => setTimeout(r, 50));
  const scale = S.get('renderScale');
  R.setPixelRatio(scale);
  R.setSize(W, H, false);
  g.camera.aspect = W / H;
  g.camera.updateProjectionMatrix();

  if (g.state !== 'play') g.start(rs.MODE.SURVIVAL);
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  photo.on(rs);

  const shadows = R.shadowMap.enabled;
  const measure = () => {
    R.info.reset();
    R.shadowMap.needsUpdate = shadows;
    g.render();
    return { calls: R.info.render.calls, tris: R.info.render.triangles };
  };

  // ---- search ----
  const views = [];
  const P = g.player;
  for (let x = -190; x <= 190; x += opts.step || 25) {
    for (let z = -60; z <= 325; z += opts.step || 25) {
      const y = P.groundAt(x, z, g.surfaceH(x, z) + 0.5);
      if (P.blocked(x, z, y)) continue;
      for (let k = 0; k < 8; k++) {
        const yaw = (k / 8) * Math.PI * 2 - Math.PI;
        photo.eye(rs, x, z, yaw, 0);
        const m = measure();
        views.push({ x, z, yaw: +yaw.toFixed(2), ...m });
      }
    }
  }
  const byCalls = [...views].sort((a, b) => b.calls - a.calls).slice(0, 3);
  const byTris = [...views].sort((a, b) => b.tris - a.tris).slice(0, 3);

  // ---- timing ----
  const gl = R.getContext();
  const time = (x, z, yaw, pitch) => {
    photo.eye(rs, x, z, yaw, pitch || 0);
    for (let i = 0; i < 5; i++) measure();
    gl.finish();
    const t = [];
    let last = performance.now();
    for (let i = 0; i < frames; i++) {
      R.info.reset();
      R.shadowMap.needsUpdate = shadows && (i % 2 === 0);
      g.render();
      gl.finish();
      const now = performance.now();
      t.push(now - last);
      last = now;
    }
    t.sort((a, b) => a - b);
    const q = (p) => t[Math.min(t.length - 1, Math.floor(p * t.length))];
    return {
      ms: [+q(0.1).toFixed(2), +q(0.5).toFixed(2), +q(0.9).toFixed(2)],
      fps: `${Math.round(1000 / q(0.9))}-${Math.round(1000 / q(0.1))}`,
    };
  };
  const timed = {};
  for (const [name, v] of Object.entries(NAMED)) {
    photo.eye(rs, v[0], v[1], v[2], v[3]);
    timed[name] = { ...measure(), ...time(...v) };
  }
  const worst = {
    calls: byCalls.map((v) => ({ ...v, ...time(v.x, v.z, v.yaw) })),
    tris: byTris.map((v) => ({ ...v, ...time(v.x, v.z, v.yaw) })),
  };

  photo.off(rs);
  window.dispatchEvent(new Event('resize'));
  return {
    preset, resolution: `${W}x${H} x${scale}`, shadows,
    viewsSearched: views.length,
    maxCalls: byCalls[0].calls, maxTris: byTris[0].tris,
    worst, named: timed,
    town: { buildings: g.town.buildings.length, chunks: g.town.chunks.length, builtTris: g.town.tris,
            colliders: g.colliders.length, buildMs: g.town.buildMs },
  };
}
