// Gear test for gunplay Phase 3.
//
// The two acceptance checks, measured rather than eyeballed:
//   - a suppressor makes stealth measurably easier: the same shot, with and
//     without one, and a count of the soldiers who heard it;
//   - a long rifle shot needs holdover: a sniper round aimed at a head 300 m
//     away lands low on the default zero, and hits once the shooter holds
//     over by the measured drop or dials the zero out to 300 m.
// Plus loot, attachments, grenades, smoke, plates and medkits, the pack screen
// and zeroing, all through the real game loop. Imports nothing, so it also
// runs against the minified single-file build.
//
//   const g = await import('/tools/geartest.js'); g.run(__rs)

function key(code) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

export function run(rs) {
  const { game, step, MODE, input, prog } = rs;
  const W = game.weapons, G = game.gear;
  const out = [];
  const rec = (name, pass, detail) => out.push({ check: name, pass: !!pass, ...detail });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { step(1 / 60); game.scene.updateMatrixWorld(); } };

  const fresh = () => {
    prog.data.level = 6;
    game.difficulty = 'normal';
    game.campaignFrom = 'town';
    game.start(MODE.CAMPAIGN);
    for (const r of game.robots) game.scene.remove(r.root);
    game.robots.length = 0;
    input.releaseAll();
    input.pointerLocked = true;
    input.swallowMove = false;
    game.player.state.health = 1e9;
    tick(2);
  };
  const place = (x, z, yaw, pitch = 0, y) => {
    const p = game.player.state;
    p.x = x; p.z = z; p.y = y !== undefined ? y : game.surfaceH(x, z);
    p.yaw = yaw; p.pitch = pitch; p.vx = p.vy = p.vz = 0;
    game.player.applyToCamera(0);
    return p;
  };
  // a posted soldier at (x, z) facing away from (fx, fz)
  const guard = (type, x, z, fx, fz) => {
    const r = rs.spawnSoldier(type, x, z, Math.atan2(x - fx, z - fz));
    return r;
  };
  const heard = (r) => r.alerted || r.awareness > 0.01;

  try { body(); } catch (err) { rec('test ran to the end', false, { error: String(err && err.stack || err) }); }
  input.releaseAll();
  game.toMenu && game.toMenu();
  const failed = out.filter((r) => !r.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out };

  function body() {
    // ---------------------------------------------------------------- start
    fresh();
    rec('campaign starts with one rifle plus the sidearm, and three crates in town',
      W.owned && W.owned.size === 1 && W.owns('rifle') && W.owns('pistol') && !W.owns('smg') &&
      W.slotList().join() === 'rifle,pistol' && G.items.filter((i) => i.kind === 'crateBox').length === 3,
      { slots: W.slotList(), crates: G.items.filter((i) => i.kind === 'crateBox').length });

    // ------------------------------------------------- suppressor: gunfire
    // Four guards 20-44 m up Main Street, backs turned. One shot into the air.
    const shotNoise = (suppressed) => {
      fresh();
      if (suppressed) W.mount('rifle', 'suppressor');
      const p = place(0, 300, 0, 0.5);
      const gs = [20, 28, 36, 44].map((d) => guard('assault', 0.5, 300 - d, 0, 300));
      tick(30);
      const before = gs.filter(heard).length;
      W.ammo.rifle = 30; W.cooldown = 0;
      input.touch.fire = true; tick(1); input.touch.fire = false;
      tick(20);
      void p;
      return { before, heard: gs.filter(heard).length, fired: W.shotsFired };
    };
    const loud = shotNoise(false), quiet = shotNoise(true);
    rec('suppressor: guards 20-44 m away hear an open shot but not a suppressed one',
      loud.before === 0 && quiet.before === 0 && loud.heard === 4 && quiet.heard === 0 && loud.fired > 0 && quiet.fired > 0,
      { open: loud, suppressed: quiet, radius: { open: 46, suppressed: +(46 * 0.22).toFixed(1) } });

    // --------------------------------------------- suppressor: a quiet kill
    // A guard 24 m away and his mate 21 m beyond him (out of reach of the
    // body falling, inside earshot of an open shot). Drop the guard.
    const quietKill = (suppressed) => {
      fresh();
      W.switchTo('sniper', true);
      if (suppressed) W.mount('sniper', 'suppressor');
      tick(40);
      const p = place(0, 300, 0, 0);
      const target = guard('assault', 0, 276, 0, 300);
      const mate = guard('assault', 7.5, 256, 0, 300);
      tick(30);
      const head = target.hitboxes[0].getWorldPosition(new rs.THREE.Vector3());
      const eye = game.camera.position;
      p.yaw = Math.atan2(-(head.x - eye.x), -(head.z - eye.z));
      p.pitch = Math.atan2(head.y - eye.y, Math.hypot(head.x - eye.x, head.z - eye.z));
      game.player.applyToCamera(0);
      // deterministic: the round goes exactly down the sight line
      const dir = head.clone().sub(eye).normalize();
      const realFire = W.fire;
      W.fire = () => { W.fire = realFire; W.shotsFired++; return [dir]; };
      game.tryFire();
      tick(30);
      return { killed: target.dead, mateHeard: heard(mate) };
    };
    const kOpen = quietKill(false), kQuiet = quietKill(true);
    rec('suppressor: drop a guard without his mate noticing (open shot alerts him)',
      kOpen.killed && kQuiet.killed && kOpen.mateHeard && !kQuiet.mateHeard,
      { open: kOpen, suppressed: kQuiet });

    // --------------------------------------------------------- holdover
    // Shooter and target 40 m up in clear air, so nothing but the round's
    // own flight decides where it lands. Head at 300 m.
    const longShot = (zeroIdx, holdMetres) => {
      fresh();
      W.switchTo('sniper', true);
      W.zeroIdx = zeroIdx;
      tick(40);
      const Y = 46;
      const p = place(0, 318, 0, 0, Y);
      const t = rs.spawnSoldier('assault', 0, 18, Math.PI);
      t.root.position.y = Y;
      t.update = () => {};   // a statue: nothing but the round decides the hit
      // and a floor under it, so the game does not settle it onto the ground
      const groundAt = game.player.groundAt;
      game.player.groundAt = (x, z, y) => (Math.abs(x) < 3 && Math.abs(z - 18) < 3 ? Y : groundAt.call(game.player, x, z, y));
      game.scene.updateMatrixWorld();
      const parts = [];
      t.damage = (amt, part) => { parts.push(part); return { killed: false, headshot: false }; };
      const head = t.hitboxes[0].getWorldPosition(new rs.THREE.Vector3());
      const eye = new rs.THREE.Vector3(); game.camera.getWorldPosition(eye);
      const aim = head.clone(); aim.y += holdMetres;
      const dir = aim.clone().sub(eye).normalize();
      const clear = !game.traceShot(eye, dir, 290, true);
      const realFire = W.fire;
      W.fire = () => { W.fire = realFire; W.shotsFired++; return [dir]; };
      let flown = 0, drop = null;
      game.tryFire();
      const instant = parts.length > 0;
      const pts = [];
      while (G.rounds.length && flown < 1.5) {
        pts.push(G.rounds[0].p.clone());
        // hold the shooter in the air while the round flies
        p.y = Y; p.vy = 0;
        tick(1); flown += 1 / 60;
      }
      // where the round crossed 285 m (the last point before it reaches the target), against the line of sight
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const da = eye.z - a.z, db = eye.z - b.z;
        if (da <= 285 && db >= 285) {
          const f = (285 - da) / (db - da);
          const y = a.y + (b.y - a.y) * f;
          const los = eye.y + (head.y - eye.y) * (285 / (eye.z - head.z));
          drop = +(y - los).toFixed(3);
        }
      }
      game.player.groundAt = groundAt;
      return { parts, instant, flight: +flown.toFixed(2), drop, clear, zero: W.zero, dist: +(eye.z - head.z).toFixed(1) };
    };
    const onZero100 = longShot(0, 0);
    rec('holdover: 300 m head shot on a 100 m zero lands low (misses the head)',
      onZero100.clear && !onZero100.instant && onZero100.flight >= 0.28 && onZero100.parts[0] !== 'head' && onZero100.drop < -0.3,
      onZero100);
    const held = longShot(0, -(onZero100.drop || -0.5));
    rec('holdover: holding over by the drop puts the same shot in the head', held.parts[0] === 'head', held);
    const dialled = longShot(2, 0);
    rec('zeroing: dialled to 300 m, aiming dead on hits the head', dialled.zero === 300 && dialled.parts[0] === 'head', dialled);

    // inside 50 m a rifle shot is still instant
    fresh();
    {
      const p = place(0, 300, 0, 0);
      const t = guard('assault', 0, 270, 0, 300);
      tick(5);
      const parts = [];
      t.damage = (amt, part) => { parts.push(part); return { killed: false, headshot: false }; };
      const c = t.hitboxes[1].getWorldPosition(new rs.THREE.Vector3());
      const eye = new rs.THREE.Vector3(); game.camera.getWorldPosition(eye);
      const dir = c.sub(eye).normalize();
      const realFire = W.fire;
      W.fire = () => { W.fire = realFire; W.shotsFired++; return [dir]; };
      game.tryFire();
      rec('inside 50 m the rifle still hits on the same frame', parts.length === 1 && G.rounds.length === 0, { parts, rounds: G.rounds.length });
      void p;
    }

    // --------------------------------------------------------------- loot
    fresh();
    {
      const p = place(0, 300, 0, -0.6);
      const it = G.spawn('weapon', 'smg', 0, 298.6);
      it.ammo = 20;
      tick(2);
      const prompt = G.pickable() === it;
      input.queue.interact++; tick(1);
      const gotSmg = W.owns('smg') && W.primaries[1] === 'smg';
      const it2 = G.spawn('weapon', 'shotgun', 0, 298.6);
      tick(2);
      input.queue.interact++; tick(1);
      tick(40);
      const dropped = G.items.find((i) => i.kind === 'weapon' && i !== it2 && Math.hypot(i.x - p.x, i.z - p.z) < 3);
      rec('loot: F picks up a weapon into the empty slot; a third swaps one out and drops it',
        prompt && gotSmg && W.owns('shotgun') && W.owned.size === 2 && !!dropped && W.current === 'shotgun',
        { prompt, gotSmg, owned: [...W.owned], dropped: dropped && dropped.id, inHand: W.current });

      const held = W.current;
      W.reserve[held] = 0;
      G.spawn('ammo', null, p.x, p.z);
      tick(2);
      rec('loot: walking over ammo refills reserves', W.reserve[held] > 0, { weapon: held, reserve: W.reserve[held] });

      // a guard's drops (forced: every roll succeeds)
      const r = guard('assault', 3, 296, 0, 300);
      tick(2);
      const n0 = G.items.length;
      const rnd = Math.random; Math.random = () => 0.01;
      try { r.damage(999, 'body'); game.registerKill(r, false, r.root.position.clone()); } finally { Math.random = rnd; }
      rec('loot: a dead soldier drops his weapon, ammo and kit', G.items.length - n0 >= 5,
        { dropped: G.items.slice(n0).map((i) => i.kind + (i.id ? ':' + i.id : '')) });
    }

    // -------------------------------------------------------- attachments
    const climb = (atts) => {
      fresh();
      W.switchTo('rifle', true);
      for (const a of atts) W.mount('rifle', a);
      const p = place(0, 300, 0, 0);
      input.touch.aim = true;
      tick(40);
      W.ammo.rifle = 60; W.reserve.rifle = 999;
      W.accumP = W.accumY = 0; W.pendingKickP = W.pendingKickY = 0; W.sprayIndex = 0; W.sinceShot = 99; W.cooldown = 0;
      const p0 = p.pitch;
      let peak = 0;
      input.touch.fire = true;
      for (let i = 0; i < 50; i++) { tick(1); peak = Math.max(peak, p.pitch - p0); }
      input.touch.fire = false; input.touch.aim = false;
      tick(10);
      return { peak: +peak.toFixed(4), shots: W.shotsFired };
    };
    const bare = climb([]), gripped = climb(['foregrip', 'compensator']);
    rec('attachments: foregrip + compensator cut vertical climb by about a third',
      gripped.peak < bare.peak * 0.75 && gripped.peak > bare.peak * 0.45,
      { bare, gripped, ratio: +(gripped.peak / bare.peak).toFixed(2) });

    fresh();
    W.mount('rifle', 'extmag'); W.mount('rifle', 'x4');
    const sizes = { mag: W.magSizeOf('rifle') };
    W.switchTo('rifle', true);
    input.touch.aim = true; tick(60);
    sizes.scoped = W.scoped; sizes.fov = +game.camera.fov.toFixed(1);
    input.touch.aim = false; tick(30);
    W.unmount('rifle', 'optic');
    input.touch.aim = true; tick(60);
    sizes.fovDot = +game.camera.fov.toFixed(1);
    input.touch.aim = false; tick(5);
    rec('attachments: extended mag holds 45, 4x scope zooms in and shows the scope',
      sizes.mag === 45 && sizes.scoped && sizes.fov < sizes.fovDot - 10, sizes);

    // ------------------------------------------------------------ grenades
    fresh();
    {
      const p = place(0, 300, 0, -0.15);
      G.counts.frags = 1;
      key('KeyG'); tick(1);
      const thrown = G.nades.length === 1 && G.counts.frags === 0;
      let rest = null, t = 0;
      while (G.nades.length && !G.nades[0].rest && t < 3) { tick(1); t += 1 / 60; }
      if (G.nades.length) rest = G.nades[0].p.clone();
      const victim = rest && guard('assault', rest.x + 1.5, rest.z, p.x, p.z);
      const hurt = rest && guard('assault', rest.x - 5.5, rest.z, p.x, p.z);
      const far = rest && guard('assault', rest.x + 14, rest.z, p.x, p.z);
      tick(1);
      const hp0 = far && far.hp;
      while (G.nades.length && t < 4) { tick(1); t += 1 / 60; }
      rec('frag: thrown with G, lands, rolls to rest; kills at 1.5 m, wounds at 5.5 m, nothing at 14 m',
        thrown && !!rest && victim.dead && !hurt.dead && hurt.hp < hp0 && far.hp === hp0,
        { thrown, rest: rest && [+rest.x.toFixed(1), +rest.z.toFixed(1)], fromPlayer: rest && +Math.hypot(rest.x - p.x, rest.z - p.z).toFixed(1),
          victimDead: victim && victim.dead, woundedHp: hurt && Math.round(hurt.hp), farHp: far && Math.round(far.hp) });
    }

    // a frag thrown at a house wall comes back off it
    fresh();
    {
      const T = game.town;
      const b = T.buildings.find((q) => q.kind === 'house' && q.z > 200 && q.z < 300);
      const A = T.local(b, b.w / 2 + 2.6, 0), B = T.local(b, b.w / 2, 0);
      const ab = Math.hypot(B.x - A.x, B.z - A.z), ux = (B.x - A.x) / ab, uz = (B.z - A.z) / ab;
      place(A.x, A.z, Math.atan2(-(B.x - A.x), -(B.z - A.z)), 0.05);
      G.counts.frags = 1;
      key('KeyG'); tick(1);
      let maxP = -1, t = 0, finalP = 0;
      while (G.nades.length && t < 2.8) {
        const n = G.nades[0];
        const proj = (n.p.x - A.x) * ux + (n.p.z - A.z) * uz;
        maxP = Math.max(maxP, proj); finalP = proj;
        tick(1); t += 1 / 60;
      }
      rec('frag: bounces off a wall back towards the thrower',
        maxP > ab - 0.5 && maxP < ab + 0.2 && finalP < maxP - 0.3,
        { wall: +ab.toFixed(2), deepest: +maxP.toFixed(2), final: +finalP.toFixed(2), house: [b.x, b.z] });
      tick(90);
    }

    // ---------------------------------------------------------------- smoke
    fresh();
    {
      const p = place(0, 300, 0, 0);
      const r = rs.spawnSoldier('assault', 0, 275, 0);
      tick(3);
      const eye = { x: 0, y: game.surfaceH(0, 275) + 1.6, z: 275 };
      const seeBefore = game.canSee(eye, p);
      G.counts.smokes = 1;
      key('KeyT'); tick(1);
      const thrown = G.nades.length === 1;
      for (let i = 0; i < 200 && G.smokes.length === 0; i++) tick(1);
      const deployed = G.smokes.length === 1;
      // and one placed squarely between the two
      G.smokes.length = 0;
      G.smokes.push({ p: new rs.THREE.Vector3(0, game.surfaceH(0, 288), 288), t: 3, r: 0 });
      tick(1);
      const seeAfter = game.canSee(eye, p);
      G.smokes.length = 0;
      tick(1);
      rec('smoke: thrown with T, deploys, and blocks a soldier’s line of sight', seeBefore && thrown && deployed && !seeAfter,
        { seeBefore, thrown, deployed, seeAfter });
      void r;
    }

    // ------------------------------------------------------ plate, medkit
    fresh();
    {
      const ps = game.player.state;
      ps.health = 100; ps.armor = 0;
      G.counts.plates = 1;
      key('KeyB'); tick(36);
      const mid = { armor: ps.armor, busy: W.busy };
      const fired0 = W.shotsFired;
      input.touch.fire = true; tick(2); input.touch.fire = false;
      const blocked = W.shotsFired === fired0;
      tick(40);
      const plate = { mid, blocked, armor: ps.armor, left: G.counts.plates };
      // natural regen held off so only the medkit moves the number
      ps.health = 30; G.counts.meds = 1; game.hurtT = 99;
      key('KeyH'); tick(120);
      const medMid = Math.round(ps.health);
      tick(50);
      const med = { mid: medMid, health: Math.round(ps.health), left: G.counts.meds };
      rec('plate: 1.2 s to fit, can’t shoot meanwhile, +50 armour',
        mid.armor === 0 && mid.busy && blocked && plate.armor === 50 && plate.left === 0, plate);
      rec('medkit: 2.6 s to use, then +65 health', med.mid === 30 && med.health === 95 && med.left === 0, med);

      // armour soaks damage now that something grants it
      ps.armor = 50; ps.health = 100;
      game.hurt(30);
      rec('armour takes damage before health', ps.armor < 50 && ps.health > 70, { armor: ps.armor, health: ps.health });
      ps.health = 1e9;
    }

    // ---------------------------------------------------- pack and zeroing
    fresh();
    {
      W.spare.push('foregrip');
      key('Tab'); tick(1);
      const open = game.state === rs.STATE.PAUSED && rs.hud.panel === 'inventory' && /PACK/.test(document.getElementById('screens').textContent);
      const btn = document.querySelector('[data-a="inv-on"][data-k="foregrip"]');
      if (btn) btn.click();
      const mounted = W.att.rifle.grip === 'foregrip';
      key('Tab'); tick(1);
      const closed = game.state === rs.STATE.PLAY;
      rec('pack (Tab): opens paused, fits a spare attachment, Tab closes', open && !!btn && mounted && closed, { open, button: !!btn, mounted, closed });

      W.setLoadout(['rifle', 'sniper']);
      key('Digit2'); tick(40);
      const inHand = W.current;
      key('BracketRight'); tick(1);
      const z1 = W.zero;
      const shown = document.getElementById('zero').textContent;
      key('Digit3'); tick(40);
      rec('number keys pick slots; ] steps the sniper zero to 200 m and the HUD shows it; 3 is the sidearm',
        inHand === 'sniper' && z1 === 200 && /200/.test(shown) && W.current === 'pistol', { inHand, zero: z1, shown, slot3: W.current });
    }
  }
}
