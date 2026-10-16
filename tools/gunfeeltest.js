// Gunfeel test for Phase 1.
//
// Drives the real input path (synthetic mouse/keyboard events) and measures
// what the acceptance check names: is the recoil pattern the same every spray,
// can the player pull against it, does it recover, does each weapon differ,
// and is a kill unmistakable. Imports nothing, so it also runs against the
// minified single-file build.
//
//   const g = await import('/tools/gunfeeltest.js'); g.run(__rs)

function mouseMove(mx, my) {
  const e = new MouseEvent('mousemove', { bubbles: true });
  Object.defineProperty(e, 'movementX', { value: mx });
  Object.defineProperty(e, 'movementY', { value: my });
  document.dispatchEvent(e);
}

function setup(rs, weapon) {
  const { game, step, MODE, prog, input } = rs;
  prog.data.level = 6;
  game.difficulty = 'normal';
  game.start(MODE.CAMPAIGN);
  game.player.state.health = 1e9;
  for (const r of game.robots) game.scene.remove(r.root);
  game.robots.length = 0;
  input.releaseAll();
  input.pointerLocked = true;
  const W = game.weapons;
  W.switchTo(weapon, true);
  for (let i = 0; i < 30; i++) step(1 / 60);
  // Stand in the main corridor facing the west shell wall, 11m away.
  const p = game.player.state;
  p.x = -20; p.z = -29; p.y = 0; p.yaw = Math.PI / 2; p.pitch = 0;
  p.vx = p.vz = p.vy = 0;
  W.ammo[weapon] = 999; W.reserve[weapon] = 999;
  W.accumP = W.accumY = 0; W.pendingKickP = W.pendingKickY = 0;
  W.sprayIndex = 0; W.sinceShot = 99; W.cooldown = 0;
  return { game, step, input, W, p };
}

// Fire `n` shots with ADS held, optionally countering the pattern through the
// mouse. Returns the view offset after each shot and the decal impact points.
function spray(rs, weapon, n, opts = {}) {
  const { game, step, input, W, p } = setup(rs, weapon);
  input.touch.aim = true;
  for (let i = 0; i < 40; i++) step(1 / 60);
  const p0 = p.pitch, y0 = p.yaw;

  // calibrate how much pitch one unit of mouse travel produces while aiming
  let perUnit = 0;
  if (opts.compensate) {
    const before = p.pitch;
    mouseMove(0, 20); step(1 / 60);
    perUnit = (before - p.pitch) / 20;
    mouseMove(0, -20); step(1 / 60);
  }

  const impacts = [];
  const realAdd = game.decals.add.bind(game.decals);
  game.decals.add = (pt, nrm, kind) => { impacts.push([pt.x, pt.y, pt.z]); realAdd(pt, nrm, kind); };

  const path = [];
  let fired = 0, frames = 0;
  const start = W.shotsFired;
  input.touch.fire = true;
  while (fired < n && frames < 2000) {
    if (opts.compensate && perUnit > 0) {
      // pull down by whatever kick is waiting, the way a player learns to
      const want = W.pendingKickP;
      if (want > 0) mouseMove(0, want / perUnit);
      const wantY = W.pendingKickY;
      if (wantY !== 0) mouseMove(wantY / perUnit, 0);
    }
    step(1 / 60);
    frames++;
    if (W.shotsFired - start > fired) {
      fired = W.shotsFired - start;
      path.push([+(p.pitch - p0).toFixed(5), +(y0 - p.yaw).toFixed(5)]);
    }
    if (!W.spec.auto) { input.touch.fire = false; step(1 / 60); input.touch.fire = true; }
  }
  input.touch.fire = false;
  const endClimb = p.pitch - p0;
  // let recovery run
  for (let i = 0; i < 90; i++) step(1 / 60);
  const afterRecover = p.pitch - p0;
  input.touch.aim = false;
  game.decals.add = realAdd;
  return { path, impacts, endClimb, afterRecover };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function run(rs) {
  const out = [];
  const rec = (check, pass, detail) => out.push({ check, pass, ...detail });
  const { game, step, input } = rs;

  // ---- 1. same pattern every spray ----
  const a = spray(rs, 'rifle', 30);
  const b = spray(rs, 'rifle', 30);
  const n = Math.min(a.impacts.length, b.impacts.length);
  let repeatErr = 0;
  for (let i = 0; i < n; i++) repeatErr += dist(a.impacts[i], b.impacts[i]);
  repeatErr /= Math.max(1, n);
  const ys = a.impacts.map((q) => q[1]);
  const xs = a.impacts.map((q) => q[2]);
  const patternH = Math.max(...ys) - Math.min(...ys);
  const patternW = Math.max(...xs) - Math.min(...xs);
  rec('rifle: 30-round spray lands in the same pattern twice',
    n >= 28 && repeatErr < patternH * 0.08,
    { impacts: n, avgRepeatErrorM: +repeatErr.toFixed(3),
      patternHeightM: +patternH.toFixed(2), patternWidthM: +patternW.toFixed(2) });

  // ---- 2. the player can pull against it ----
  const c = spray(rs, 'rifle', 30, { compensate: true });
  const cy = c.impacts.map((q) => q[1]);
  const compH = cy.length ? Math.max(...cy) - Math.min(...cy) : 99;
  rec('rifle: pulling down against the pattern collapses the spray',
    compH < patternH * 0.25,
    { uncompensatedHeightM: +patternH.toFixed(2), compensatedHeightM: +compH.toFixed(2) });
  rec('compensated spray does not drift down after release',
    Math.abs(c.afterRecover - c.endClimb) < 0.01,
    { endClimbRad: +c.endClimb.toFixed(4), afterRecoverRad: +c.afterRecover.toFixed(4) });

  // ---- 3. recovery ----
  const r = spray(rs, 'rifle', 10);
  rec('uncompensated recoil recovers after release',
    r.endClimb > 0.05 && Math.abs(r.afterRecover) < r.endClimb * 0.15,
    { climbRad: +r.endClimb.toFixed(4), leftAfterRecoveryRad: +r.afterRecover.toFixed(4) });

  // ---- 4. weapons differ ----
  const shapes = {};
  for (const [w, k] of [['rifle', 30], ['smg', 30], ['shotgun', 4], ['sniper', 3]]) {
    const s = spray(rs, w, k);
    const last = s.path[s.path.length - 1] || [0, 0];
    const sides = s.path.map((q) => q[1]);
    shapes[w] = {
      shots: s.path.length,
      climbPerShotRad: +(last[0] / Math.max(1, s.path.length)).toFixed(4),
      netSideRad: +last[1].toFixed(4),
      sideRangeRad: +(Math.max(...sides) - Math.min(...sides)).toFixed(4),
    };
  }
  const climbs = Object.values(shapes).map((x) => x.climbPerShotRad);
  rec('each weapon has a different pattern',
    new Set(climbs.map((x) => x.toFixed(3))).size === 4, { shapes });

  // ---- 5. spread opens when moving and jumping ----
  {
    const { W, p, step: st } = setup(rs, 'rifle');
    st(1 / 60);
    const still = W.cone;
    W.setMotion(1.0, 0, 0, { sprinting: false, airborne: false });
    const moving = W.cone;
    W.setMotion(1.0, 0, 0, { sprinting: false, airborne: true });
    const air = W.cone;
    W.setMotion(0, 0, 0, { sprinting: false, airborne: false });
    rec('hip spread grows walking and grows again airborne',
      moving > still * 1.3 && air > moving * 1.8,
      { stillRad: +still.toFixed(4), movingRad: +moving.toFixed(4), airborneRad: +air.toFixed(4) });
  }

  // ---- 6. sprint-to-fire delay ----
  {
    const { W, step: st, input: inp } = setup(rs, 'rifle');
    W.setMotion(1.6, 0, 0, { sprinting: true, airborne: false });
    W.setMotion(1.0, 0, 0, { sprinting: false, airborne: false });
    const blocked = W.fire(game.scene, true) === null;
    for (let i = 0; i < 20; i++) W.update(1 / 60, game.scene);
    W.cooldown = 0;
    const allowed = W.fire(game.scene, true) !== null;
    rec('weapon cannot fire straight out of a sprint, then can',
      blocked && allowed, { blockedImmediately: blocked, firesAfterDelay: allowed,
        delayS: game.weapons.spec.sprintToFire });
  }

  // ---- 7. held breath steadies the scope ----
  {
    const measure = (hold) => {
      const { W, step: st, input: inp } = setup(rs, 'sniper');
      inp.touch.aim = true;
      for (let i = 0; i < 40; i++) st(1 / 60);
      inp.touch.sprint = hold;
      // let the sway settle into its new amplitude before measuring it, or the
      // transition from the old amplitude counts as sway
      for (let i = 0; i < 50; i++) st(1 / 60);
      let mn = 9, mx = -9;
      for (let i = 0; i < 150; i++) { st(1 / 60); mn = Math.min(mn, W.scopeSwayY); mx = Math.max(mx, W.scopeSwayY); }
      inp.touch.sprint = false; inp.touch.aim = false;
      return mx - mn;
    };
    const free = measure(false), held = measure(true);
    rec('holding breath cuts scope sway', held < free * 0.4,
      { swayFreeRad: +free.toFixed(5), swayHeldRad: +held.toFixed(5) });
  }

  // ---- 8. tactical vs empty reload ----
  {
    const { W } = setup(rs, 'rifle');
    W.ammo.rifle = 10; W.reloading = 0; W.swapT = 0;
    W.startReload(); const tac = W.reloadTotal; const tacEmpty = W.reloadEmpty;
    W.reloading = 0; W.ammo.rifle = 0;
    W.startReload(); const emp = W.reloadTotal; const empEmpty = W.reloadEmpty;
    W.reloading = 0;
    rec('empty reload is slower and racks the bolt', emp > tac && empEmpty && !tacEmpty,
      { tacticalS: +tac.toFixed(2), emptyS: +emp.toFixed(2) });
  }

  // ---- 9. inspect ----
  {
    const { W, step: st } = setup(rs, 'rifle');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', bubbles: true }));
    st(1 / 60);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyI', bubbles: true }));
    const inspecting = W.inspectT > 0;
    input.touch.aim = true; st(1 / 60); input.touch.aim = false;
    rec('I inspects the weapon; aiming cancels it', inspecting && W.inspectT === 0,
      { startedInspect: inspecting, cancelledByAim: W.inspectT === 0 });
  }

  // ---- 10. impacts match the surface ----
  {
    const { W, p, step: st } = setup(rs, 'rifle');
    const before = Object.fromEntries(Object.entries(game.decals.sets).map(([k, v]) => [k, v.used]));
    const shootAt = (x, y, z, yaw, pitch) => {
      p.x = x; p.z = z; p.y = y; p.yaw = yaw; p.pitch = pitch;
      W.cooldown = 0; W.sinceShot = 99; W.pendingKickP = W.pendingKickY = 0;
      st(1 / 60);
      p.x = x; p.z = z; p.y = y; p.yaw = yaw; p.pitch = pitch;
      game.player.applyToCamera(0);
      game.scene.updateMatrixWorld(true);
      input.touch.fire = true; game.tryFire(); input.touch.fire = false;
      W.update(0.3, game.scene);
    };
    shootAt(-20, 0, -29, Math.PI / 2, 0);            // shell wall: brick
    shootAt(0, 0, 8, 0, -0.05);                      // front elevation
    shootAt(20, 0, -55, 0, -0.35);                   // loading bay crate area
    shootAt(-16, 0, 4.2, 0, 0.12);                   // a front window
    shootAt(-12, 0, 30, 0, -0.22);                   // a parked car's bodywork
    const after = Object.fromEntries(Object.entries(game.decals.sets).map(([k, v]) => [k, v.used]));
    const kinds = Object.keys(after).filter((k) => after[k] > before[k]);
    rec('bullet impacts leave surface-specific marks', kinds.length >= 2,
      { surfacesMarked: kinds, counts: after });
  }

  // ---- 11. a kill is unmistakable ----
  {
    const { W, p, step: st } = setup(rs, 'rifle');
    let confirms = 0;
    const sfx = W.audio;
    const realKill = sfx.killConfirm;
    sfx.killConfirm = (h) => { confirms++; realKill(h); };
    const feedBefore = document.querySelectorAll('#killfeed > *').length;
    let killMarkerSeen = false;
    const enemy = game.robots[0];
    // put a soldier in front and shoot him down
    const make = rs.spawnSoldier;
    if (make) make('assault', p.x - 7, p.z, -Math.PI / 2);
    for (let i = 0; i < 400 && game.robots.some((r) => !r.dead); i++) {
      const t = game.robots.find((r) => !r.dead);
      if (!t) break;
      const hp = new t.root.position.constructor();
      t.hitboxes[1].getWorldPosition(hp);
      const dx = hp.x - p.x, dz = hp.z - p.z;
      p.yaw = Math.atan2(-dx, -dz);
      p.pitch = Math.atan2(hp.y - (p.y + 1.6), Math.hypot(dx, dz));
      W.ammo.rifle = 99;
      input.touch.fire = true;
      st(1 / 60);
      if (document.getElementById('hitmarker').classList.contains('kill')) killMarkerSeen = true;
    }
    input.touch.fire = false;
    sfx.killConfirm = realKill;
    const feedAfter = document.querySelectorAll('#killfeed > *').length;
    rec('a kill shows the kill marker, adds a feed entry and plays its own sound',
      killMarkerSeen && feedAfter > feedBefore && confirms > 0,
      { killMarker: killMarkerSeen, feedEntries: feedAfter - feedBefore, killSounds: confirms,
        hadTarget: !!make });
  }

  const failed = out.filter((o) => !o.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out };
}
