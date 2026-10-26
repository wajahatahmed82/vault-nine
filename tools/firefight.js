// The worst firefight, timed (graphics prompt 2, Phase 4 acceptance: "the
// worst firefight stays within the frame budget").
//
// On Main Street at the square: ten soldiers in the open firing at the
// player, the player holding the trigger on an automatic, a frag every two
// seconds, the burning car, rain optional. The simulation runs for real
// (game.update) at 60 Hz; each frame is timed CPU + GPU (gl.finish), HIGH
// preset, 1920x1080. Run it with effects on and off in the same session,
// alternating, and compare: the laptop throttles.
//
//   const f = await import('/tools/firefight.js'); await f.run(__rs, { vfx: true })

export async function run(rs, opts = {}) {
  const g = rs.game, R = rs.renderer, gl = R.getContext(), S = rs.settings, THREE = rs.THREE;
  const frames = opts.frames || 360;
  S.applyPreset(opts.preset || 'high');
  g.campaignFrom = 'town';
  g.start(rs.MODE.SURVIVAL);
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  R.setPixelRatio(1); R.setSize(1920, 1080, false);
  g.camera.aspect = 1920 / 1080; g.camera.updateProjectionMatrix();
  if (g.post) g.post.setSize(1920, 1080, 1);
  g._setTime(opts.time || 'day');
  if (g.atmos && g.atmos.setWeather) g.atmos.setWeather(opts.rain ? 'rain' : 'clear');
  if (g.life && g.life.setRain) g.life.setRain(!!opts.rain);
  const vfx = g.vfx;
  if (opts.vfx === false) { g.vfx = null; g.weapons.vfx = null; }   // the Phase 3 effects path
  const ps = g.player.state;
  ps.x = 0; ps.z = 180; ps.y = g.player.groundAt(0, 180, g.surfaceH(0, 180) + 0.5); ps.vx = ps.vy = ps.vz = 0;
  ps.yaw = Math.PI; ps.pitch = 0; ps.health = 1e9;
  const hurt = g.player.hurt;
  g.player.hurt = () => false;                     // he stands in it
  const spawned = [];
  for (let i = 0; i < 10; i++) {
    const x = -6 + (i % 5) * 3, z = 194 + Math.floor(i / 5) * 4;
    const e = rs.spawnSoldier(i % 3 ? 'assault' : 'heavy', x, z, 0);
    if (e) { e.hp = e.maxHp = 1e6; spawned.push(e); }
  }
  for (let i = 0; i < 60; i++) g.update(1 / 60);   // they see him and open up
  // a second of untimed frames: first-use uploads and compiles are not the firefight
  for (let i = 0; i < 60; i++) { g.input.firing = true; g.update(1 / 60); g.render(); }
  gl.finish();
  const times = [];
  let nadeT = 0;
  for (let f = 0; f < frames; f++) {
    g.input.firing = true;
    nadeT -= 1 / 60;
    if (nadeT <= 0 && g.gear && g.gear._explode) {
      nadeT = 2;
      g.gear._explode(new THREE.Vector3(-3 + Math.random() * 6, g.surfaceH(0, 190) + 0.1, 188 + Math.random() * 6));
    }
    ps.health = 1e9;
    for (const e of spawned) e.hp = 1e6;
    g.weapons.ammo[g.weapons.current] = g.weapons.magSize;   // never reloads: constant fire
    const t = performance.now();
    g.update(1 / 60);
    g.render();
    gl.finish();
    times.push(performance.now() - t);
  }
  g.input.firing = false;
  g.vfx = vfx; g.weapons.vfx = vfx;
  g.player.hurt = hurt;
  times.sort((a, b) => a - b);
  const q = (k) => +times[Math.min(times.length - 1, Math.floor(times.length * k))].toFixed(1);
  const res = { vfx: opts.vfx !== false, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +times[times.length - 1].toFixed(1),
    soldiers: g.robots.filter((r) => !r.dead).length, particles: vfx ? vfx.live : 0, debris: vfx ? vfx.debris.n + vfx.casings.n : 0 };
  for (const e of spawned) g.scene.remove(e.root);
  g.robots.length = 0;
  window.dispatchEvent(new Event('resize'));
  return res;
}
