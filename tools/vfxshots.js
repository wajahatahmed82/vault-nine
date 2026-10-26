// Slow-motion sequences of every combat and weather effect (graphics prompt
// 2, Phase 4 acceptance). Each effect is set off in a fixed place in the town
// with the simulation frozen (tools/photo.js); then only the effects (and,
// for the gun, the weapon) are stepped in 1/240 s ticks and frames are taken
// at set times. HIGH preset, 1280x720, posted to tools/shotsrv.js (5179):
// shots/<prefix>_<effect>_<ms>.jpg.
//
//   const v = await import('/tools/vfxshots.js'); await v.capture(__rs, 'vfx')
//   await v.capture(__rs, 'vfx', { only: ['explosion'], time: 'night' })

import * as photo from './photo.js';

const TICK = 1 / 240;

export async function capture(rs, prefix = 'vfx', opts = {}) {
  const g = rs.game, R = rs.renderer, S = rs.settings, V = g.vfx, THREE = rs.THREE;
  const W = opts.w || 1280, H = opts.h || 720;
  S.applyPreset(opts.preset || 'high');
  g.campaignFrom = 'town';
  g.start(rs.MODE.SURVIVAL);
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0; g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  g.townPower = true;
  if (g.town && g.town.cc0Ready) await g.town.cc0Ready;
  const update = g.update.bind(g);
  for (let i = 0; i < 90; i++) update(1 / 60);       // the weapon comes up, models settle
  photo.on(rs);
  if (g.weapons.arms) g.weapons.arms.root.visible = false;
  R.setPixelRatio(1); R.setSize(W, H, false);
  g.camera.aspect = W / H; g.camera.updateProjectionMatrix();
  if (g.post) g.post.setSize(W, H, 1);
  g._setTime(opts.time || 'day');
  // let the sky and light settle, or the first frames are brighter than the rest
  if (g.atmos && g.atmos.update) for (let i = 0; i < 30; i++) g.atmos.update(0.5, g.camera.position);
  if (g.life && g.life.setRain) g.life.setRain(false);
  if (g.atmos && g.atmos.setWeather) g.atmos.setWeather('clear');

  const out = [];
  // legacy: the Phase 3 effects (fx.js puffs and sparks, townlife sprites)
  // at the same places and times, for before/after pairs
  const legacy = !!opts.legacy, keepV = g.vfx;
  if (legacy) { g.vfx = null; g.weapons.vfx = null; }
  const stepFx = (dt) => {
    if (legacy) { g.fx.update(dt); if (g.life && g.life.update) g.life.update(dt); } else V.update(dt);
  };
  const snap = async (name) => {
    g.render(); g.render();
    const url = R.domElement.toDataURL('image/jpeg', 0.9);
    const res = await fetch(`http://localhost:5179/?name=${prefix}_${name}`, { method: 'POST', body: url });
    out.push(`${name}: ${(await res.json()).bytes} B`);
  };
  const ps = g.player.state;
  const stand = (x, z) => { ps.x = x; ps.z = z; ps.y = g.player.groundAt(x, z, g.surfaceH(x, z) + 0.5); ps.vx = ps.vy = ps.vz = 0; };
  const dirOf = (yaw, pitch) => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  // step the effects (and anything else in `extra`) to each time and shoot
  const play = async (name, times, extra) => {
    let t = 0;
    for (const T of times) {
      while (t < T - 1e-6) { if (extra) extra(TICK, t); stepFx(TICK); t += TICK; }
      await snap(`${name}_${String(Math.round(T * 1000)).padStart(4, '0')}`);
    }
  };
  const reset = () => { V.clear(); if (g.decals) g.decals.clear(); };

  // Find a surface of the wanted kind 4-14 m in front of one of the eyes.
  const find = (want, eyes, pitches = [-0.05, 0.05, -0.2]) => {
    for (const [x, z] of eyes) {
      stand(x, z);
      const o = new THREE.Vector3(x, ps.y + 1.62, z);
      for (let k = 0; k < 24; k++) {
        const yaw = k / 24 * Math.PI * 2;
        for (const pitch of pitches) {
          const d = dirOf(yaw, pitch);
          const hit = g.traceShot(o, d, 16, true);
          if (!hit || hit.distance < 4 || hit.distance > 14) continue;
          const base = hit.townHit ? hit.townHit.kind : (g.surface.get(hit.object && hit.object.material) || 'masonry');
          if (g.impactKind(hit, base) === want) return { x, z, yaw, pitch, o, d, hit };
        }
      }
    }
    return null;
  };
  // fire `n` rounds at a found surface, spread a little, through the real hit code
  const shoot = (f, n, spread = 0.02) => {
    for (let i = 0; i < n; i++) {
      const d = f.d.clone(); d.x += (Math.random() - 0.5) * spread; d.y += (Math.random() - 0.5) * spread; d.z += (Math.random() - 0.5) * spread; d.normalize();
      const hit = g.traceShot(f.o, d, 30, true);
      if (hit) g.applyShotHit(hit, f.o, 0, true);
    }
  };

  const impacts = [
    ['brick', [[-2, 140], [-2, 160], [3, 175], [-3, 125]]],
    ['plaster', [[2, 128], [-3, 190], [3, 250], [-50, 275]]],
    ['concrete', [[150, 190], [128, 146], [0, 60], [150, 262]]],
    ['metal', [[128, 146], [185, 190], [0, 206], [150, 200]]],
    ['wood', [[-100, 240], [-100, 275], [-150, 220], [70, 118]]],
    ['grass', [[0, 75], [0, 90], [-150, 150]]],
    ['asphalt', [[0, 150], [0, 230]]],
  ];
  const IMPACT_T = [0.016, 0.05, 0.1, 0.2, 0.4, 0.8, 1.6];
  const only = (n) => !opts.only || opts.only.includes(n);
  for (const [kind, eyes] of impacts) {
    if (!only(kind)) continue;
    const f = find(kind, eyes, kind === 'grass' || kind === 'asphalt' ? [-0.25, -0.35, -0.18] : undefined);
    if (!f) { out.push(`${kind}: no surface found`); continue; }
    reset();
    // the camera 5 m from the hits (the rounds still come from where they were found)
    const P = f.hit.point, hl = Math.hypot(f.d.x, f.d.z) || 1;
    const ex = P.x - f.d.x / hl * 5, ez = P.z - f.d.z / hl * 5;
    const ey = g.player.groundAt(ex, ez, g.surfaceH(ex, ez) + 0.5) + 1.62;
    photo.eye(rs, ex, ez, f.yaw, Math.atan2(P.y - ey, 5));
    shoot(f, 3, 0.03);
    await play(kind, IMPACT_T);
  }

  // water: rounds into a wet road in the rain
  if (only('water')) {
    if (g.atmos && g.atmos.setWeather) g.atmos.setWeather('rain');
    if (g.life && g.life.setRain) g.life.setRain(true);
    const f = find('asphalt', [[0, 150], [0, 230]], [-0.3, -0.25]);
    if (f) {
      reset();
      photo.eye(rs, f.x, f.z, f.yaw, f.pitch);
      shoot(f, 3, 0.03);
      await play('water', IMPACT_T);
    }
  }
  // rain on the street: drips off the eaves, splashes, the wet sheen
  if (only('rain')) {
    reset();
    stand(-3, 160);
    photo.eye(rs, -3, 160, Math.PI * 0.62, 0.12);
    await play('rain', [0.5, 1.5, 3.0], (dt) => { if (g.life && g.life.update) g.life.update(dt); });
  }
  if (g.life && g.life.setRain) g.life.setRain(false);
  if (g.atmos && g.atmos.setWeather) g.atmos.setWeather('clear');

  // glass: a shop window takes a round (cracks) and then a second (goes)
  if (only('glass')) {
    const b = g.town.buildings.find((q) => q.shop && !q.enter && q.windows && q.windows.some((w) => w.f === 'f' && !w.real && w.y > q.base + 3));
    if (b) {
      const w = b.windows.find((q) => q.f === 'f' && !q.real && q.y > b.base + 3);
      const p = g.town.local(b, w.u, b.d / 2);
      p.y = w.y;
      const cs = Math.cos(b.rot), sn = Math.sin(b.rot), nx = sn, nz = cs;
      const ex = p.x + nx * 7, ez = p.z + nz * 7;
      stand(ex, ez);
      const eyeY = ps.y + 1.62;
      const yaw = Math.atan2(-(p.x - ex), -(p.z - ez)), pitch = Math.atan2(p.y - eyeY, 7);
      reset();
      photo.eye(rs, ex, ez, yaw, pitch);
      const o = new THREE.Vector3(ex, eyeY, ez), d = new THREE.Vector3(p.x - ex, p.y - eyeY, p.z - ez).normalize();
      const f = { o, d };
      shoot(f, 1, 0);
      await play('glass_crack', [0.05, 0.3]);
      shoot(f, 1, 0);
      await play('glass_shatter', [0.02, 0.1, 0.25, 0.5, 1.0]);
    } else out.push('glass: no window found');
  }

  // a frag on Main Street
  const blast = async (name, x, z, ex, ez, times, fn) => {
    reset();
    stand(ex, ez);
    const y = g.surfaceH(x, z);
    const yaw = Math.atan2(-(x - ex), -(z - ez));
    photo.eye(rs, ex, ez, yaw, 0.12);
    fn(new THREE.Vector3(x, y + 0.15, z));
    await play(name, times);
  };
  const BLAST_T = [0.02, 0.06, 0.12, 0.25, 0.5, 1.0, 2.0, 3.5, 5.0];
  if (only('explosion')) await blast('explosion', 0, 175, 1.5, 164, BLAST_T, (p) => (legacy ? g.gear._explode(p) : V.explosion(p, 1)));
  if (only('flashbang')) await blast('flashbang', 0, 175, 1.5, 162, [0.02, 0.08, 0.2, 0.6, 1.5], (p) => V.flashbang(p));
  if (only('smoke')) await blast('smoke', 0, 175, 2, 160, [0.5, 1.5, 3, 6], (p) => V.addSmokeScreen(p.x, p.y, p.z, 4.5, 20));

  // the burning car on Main Street (always burning)
  if (only('fire')) {
    reset();
    const bc = g.town.spots.burningCar;
    if (bc) {
      const fire = V.addFire(bc.x, bc.y + 0.9, bc.z, 1.0);
      stand(bc.x - 3, bc.z - 9);
      photo.eye(rs, bc.x - 3, bc.z - 9, Math.atan2(3, -9), 0.08);
      await play('fire', [0.5, 2, 4, 6]);
      fire.on = false;
    }
  }

  // the gun: muzzle flash, smoke, brass and the barrel heating up
  if (only('muzzle')) {
    reset();
    stand(0, 160);
    photo.eye(rs, 0, 160, Math.PI, -0.02);
    g.weapons.root.visible = true;
    g.weapons.cooldown = 0; g.weapons.ammo[g.weapons.current] = g.weapons.magSize;
    g.input.firing = true;
    const step = (dt, t) => {
      if (t < 0.9) g.tryFire();
      g.weapons.update(dt, g.scene);
      // keep the camera where it was put while the recoil moves the aim
      photo.eye(rs, 0, 160, Math.PI, -0.02);
    };
    await play('muzzle', [0.004, 0.03, 0.06, 0.12, 0.3, 0.6, 0.9, 1.4, 2.4], step);
    g.input.firing = false;
    g.weapons.root.visible = false;
  }

  // brass from the side, bouncing on the pavement
  if (only('casings')) {
    reset();
    stand(-5.5, 150);
    const P = new THREE.Vector3(-5.5, ps.y + 1.3, 150);
    photo.look(rs, P.x + 3.2, ps.y + 0.7, P.z + 1.6, P.x + 1.4, ps.y + 0.1, P.z);
    let k = 0;
    const step = (dt, t) => {
      if (t > k * 0.1 && k < 8) { k++; V.casing(P, new THREE.Vector3(1.8 + Math.random() * 0.6, 1.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4)); }
    };
    await play('casings', [0.15, 0.35, 0.6, 1.0, 2.0], step);
  }

  // the truck: exhaust and dust off the back wheels
  if (only('truck') && g.vehicle) {
    reset();
    const T = g.vehicle;
    T.place(0, 150, 0); T.driving = true; T.speed = 9;
    const step = (dt) => { T.update(dt, { throttle: 1, steer: 0, brake: false }); T.speed = 9; };
    stand(5, 128);
    for (let i = 0; i < 240; i++) { step(TICK); V.update(TICK); }
    photo.look(rs, T.x + 5, T.y + 2.4, T.z + 9, T.x, T.y + 0.8, T.z);
    await play('truck', [0.3, 0.8, 1.5], (dt) => { step(dt); photo.look(rs, T.x + 5, T.y + 2.4, T.z + 9, T.x, T.y + 0.8, T.z); });
    T.driving = false; T.active = false; T.speed = 0;
  }

  // a soldier hit: dust and kit, no blood
  if (only('kit') && rs.spawnSoldier) {
    reset();
    const e = rs.spawnSoldier('assault', 0, 164, 0);
    stand(0, 160);
    photo.eye(rs, 0, 160, Math.PI, -0.05);
    const o = new THREE.Vector3(0, ps.y + 1.62, 160);
    const tgt = e.hitboxes && e.hitboxes[1] ? e.hitboxes[1].getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, ps.y + 1.2, 164);
    const d = tgt.clone().sub(o).normalize();
    const hit = g.traceShot(o, d, 20, false);
    if (hit) g.applyShotHit(hit, o, 1, true);
    out.push('kit hit: ' + (hit ? (hit.object && hit.object.userData && hit.object.userData.robot ? 'soldier' : 'other') : 'none'));
    await play('kit', [0.02, 0.08, 0.2, 0.5]);
    g.scene.remove(e.root); g.robots.length = 0;
  }

  photo.off(rs);
  if (legacy) { g.vfx = keepV; g.weapons.vfx = keepV; }
  window.dispatchEvent(new Event('resize'));
  return out;
}
