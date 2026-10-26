// Paired frame-cost benchmark that needs nothing but window.__rs, so the same
// code runs on the live site (an older build, no tools/) and on a local build.
// Paste BENCH into each tab (console or javascript_tool) alternately, A B A B,
// and compare only adjacent runs: the laptop throttles. The first run after a
// page load includes texture and shader uploads; throw it away.
//
// Per view (HIGH preset, 1920x1080, day): 20 warm-up frames, 40 frames of
// game.update + render timed on the CPU (gl.finish every 4th), then 16 frames
// timed with gl.finish each (CPU + GPU). Medians in ms. Timer queries are not
// available in the desktop app's browser, so there is no separate GPU figure.
// Draw calls / triangles: renderer.info with autoReset off over one frame.

export const BENCH = `window.__M = null; window.__measure = async () => {
  const rs = __rs, g = rs.game, R = rs.renderer, gl = R.getContext(), S = rs.settings;
  const views = { main: [2, 128, Math.PI, 0.02], square: [24, 196, -Math.PI / 2 + 0.25, 0.04], station: [0, 72, Math.PI, -0.04], yard: [128, 146, -Math.PI / 2 - 0.05, 0.05], terraces: [-100, 240, 0, 0.0], ridge: [-120, 110, -Math.PI / 2, 0.0] };
  S.applyPreset('high'); g.campaignFrom = 'town'; g.start(rs.MODE.SURVIVAL);
  for (const r of g.robots) g.scene.remove(r.root); g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  R.setPixelRatio(1); R.setSize(1920, 1080, false); g.camera.aspect = 1920 / 1080; g.camera.updateProjectionMatrix(); if (g.post) g.post.setSize(1920, 1080, 1);
  g._setTime('day');
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[b.length >> 1].toFixed(2); };
  const out = {};
  for (const [name, [x, z, yaw, pitch]] of Object.entries(views)) {
    const ps = g.player.state; ps.x = x; ps.z = z; ps.y = g.player.groundAt(x, z, g.surfaceH(x, z) + 0.5); ps.vx = ps.vy = ps.vz = 0; ps.yaw = yaw; ps.pitch = pitch;
    const frame = (i) => { g.update(1 / 60); R.shadowMap.needsUpdate = i % 2 === 0; g.render(); };
    for (let i = 0; i < 20; i++) frame(i);
    gl.finish();
    const cpu = [], full = [];
    for (let i = 0; i < 40; i++) { const t = performance.now(); frame(i); cpu.push(performance.now() - t); if (i % 4 === 3) gl.finish(); }
    for (let i = 0; i < 16; i++) { const t = performance.now(); frame(i); gl.finish(); full.push(performance.now() - t); }
    R.info.autoReset = false; R.info.reset(); frame(1); gl.finish();
    out[name] = { cpu: med(cpu), withFinish: med(full), calls: R.info.render.calls, ktris: Math.round(R.info.render.triangles / 1000) };
    R.info.autoReset = true;
    await new Promise((r) => setTimeout(r, 30));
  }
  window.dispatchEvent(new Event('resize'));
  return out;
};
setTimeout(() => window.__measure().then((r) => window.__M = r).catch((e) => window.__M = 'ERR ' + e.message), 50);
'scheduled';`;
