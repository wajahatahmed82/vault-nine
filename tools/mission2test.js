// Mission 2 ("Dead Ground") playthrough test.
//
// Walks the real player controller through all eight objectives -- out of the
// station, the pharmacy dead drop, three junction boxes across town, the
// rooftop marksmen, the jammer, the 75 s hold, the petrol station, the south
// roadblock -- using the real interaction system. Soldiers stand still for
// the walking (the test is about the mission being completable, not about
// winning fights) but the hold's reinforcements, the standing patrols and a
// checkpoint reload are checked for real. Also reports the route length and
// the least time it could take with no fighting at all.
//
//   const t = await import('/tools/mission2test.js'); t.run(__rs)

function walkTo(rs, tx, tz, maxSeconds = 80) {
  const { game } = rs;
  const p = game.player.state;
  let t = 0, slide = 1, flips = 0, last = Infinity, stuck = 0;
  while (t < maxSeconds) {
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.1) return { ok: true, t };
    p.yaw = Math.atan2(-dx, -dz);
    const strafing = stuck > 0.25;
    game.player.step(1 / 60, { moveX: strafing ? slide : 0, moveY: strafing ? -0.4 : -1,
      lookDX: 0, lookDY: 0, jump: false, crouch: false, sprint: false }, 0);
    if (Math.abs(last - d) < 0.004) { stuck += 1 / 60; if (stuck > 1.5) { slide = -slide; stuck = 0.3; flips++; } }
    else if (!strafing) stuck = 0;
    last = d;
    if (flips > 8) return { ok: false, t, at: [+p.x.toFixed(1), +p.z.toFixed(1)] };
    t += 1 / 60;
  }
  return { ok: false, t, at: [+p.x.toFixed(1), +p.z.toFixed(1)] };
}

export function run(rs) {
  const { game, step, MODE } = rs;
  const T = game.town, c = game.campaign;
  const out = [];
  const rec = (name, pass, detail) => out.push({ check: name, pass: !!pass, ...detail });
  let walked = 0, walkTime = 0;
  const route = (pts) => {
    const p = game.player.state;
    for (const [x, z] of pts) {
      const d0 = Math.hypot(x - p.x, z - p.z);
      const r = walkTo(rs, x, z);
      walked += d0; walkTime += r.t;
      if (!r.ok) return { ok: false, to: [x, z], at: r.at };
    }
    return { ok: true };
  };
  const freeze = () => { for (const r of game.robots) { r.update = () => {}; } };
  const use = (id) => {
    const it = c.interact.get(id);
    if (!it) return { ok: false, why: 'no ' + id };
    const p = game.player.state;
    // step up to it like a player would
    if (Math.hypot(it.pos.x - p.x, it.pos.z - p.z) > 1.5) walkTo(rs, it.pos.x, it.pos.z, 6);
    p.yaw = Math.atan2(-(it.pos.x - p.x), -(it.pos.z - p.z));
    const eye = p.y + game.player.eyeHeight;
    p.pitch = Math.atan2(it.pos.y - eye, Math.hypot(it.pos.x - p.x, it.pos.z - p.z));
    step(1 / 60);
    const got = c.interact.pick(game.camera, p);
    if (!got || got.id !== id) return { ok: false, why: 'not picked: ' + (got && got.id), dist: +Math.hypot(it.pos.x - p.x, it.pos.z - p.z).toFixed(2) };
    const r = c.interact.use(got, { keycard: c.keycard });
    step(1 / 60);
    p.pitch = 0;
    return { ok: r.ok };
  };
  const door = (tag) => {
    const b = T.byTag(tag);
    const du = b.doorsU[0];
    const o = T.local(b, du, b.d / 2 + 1.8), i = T.local(b, du, b.d / 2 - 2.2);
    const ti = b.tagItem;
    const f = T.local(b, ti.x, ti.z + 1.4);
    return { o: [o.x, o.z], i: [i.x, i.z], f: [f.x, f.z] };
  };

  try { body(); } catch (err) { rec('test ran to the end', false, { error: String(err && err.stack || err) }); }
  const failed = out.filter((r) => !r.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out, walkedMetres: Math.round(walked), walkMinutes: +(walkTime / 60).toFixed(1) };

  function body() {
    game.difficulty = 'normal';
    game.campaignFrom = 'm2';
    game.start(MODE.CAMPAIGN);
    game.player.state.health = 1e9;
    step(1 / 60);
    const p = game.player.state;
    rec('mission 2 starts at night on the station shelf, with eight standing patrols',
      c.mission === 2 && c.objective.id === 'm2road' && game._tod === 'night' && c.persist.length === 8 && p.z < 35,
      { tod: game._tod, patrols: c.persist.length });

    // the patrols really walk
    const pat = c.persist.map((e) => e.robot.root.position.clone());
    // they pause at each end of their beat, so give them ten seconds
    for (let i = 0; i < 600; i++) step(1 / 60);
    const moved = c.persist.filter((e, i) => e.robot.root.position.distanceTo(pat[i]) > 3).length;
    rec('standing patrols walk their streets', moved >= 6, { moved });
    freeze();

    // 1. down Station Road
    let r = route([[0, 44], [0, 75], [0, 108]]);
    step(1 / 60);
    rec('1 walk out of the station to the Ridge Road junction', r.ok && c.objective.id === 'm2drop', { ...r, obj: c.objective.id });
    freeze();

    // 2. pharmacy
    const ph = door('pharmacy');
    r = route([[8, 112], [8, ph.o[1]], ph.o, ph.i, ph.f]);
    let u = use('deadDrop');
    step(1 / 60);
    rec('2 in through the pharmacy door, dead drop found', r.ok && u.ok && c.objective.id === 'm2boxes', { walk: r, use: u, obj: c.objective.id });
    freeze();

    // 3. junction boxes
    r = route([ph.i, ph.o, [8, 112], [-100, 112], [-150, 108], [-155, 105.5]]);
    u = use('boxW');
    const r2 = route([[-150, 110], [-100, 110], [-100, 222], [-97, 227.5]]);
    const u2 = use('boxNW');
    const r3 = route([[-100, 220], [100, 220], [105, 224.5]]);
    const u3 = use('boxE');
    step(1 / 60);
    rec('3 all three junction boxes reached and cut', r.ok && u.ok && r2.ok && u2.ok && r3.ok && u3.ok && c.objective.id === 'm2marks',
      { w: [r.ok, u], nw: [r2.ok, u2], e: [r3.ok, u3], obj: c.objective.id });

    // 4. marksmen: on real rooftops, with a long sightline from the street
    const targets = game.robots.filter((x) => x.isTarget && !x.dead);
    const onRoofs = targets.every((t) => t.root.position.y > game.surfaceH(t.root.position.x, t.root.position.z) + 3);
    let longest = 0;
    for (const t of targets) {
      for (const [sx, sz] of [[2, 128], [0, 150], [2, 300], [40, 220], [0, 200], [-30, 220]]) {
        const ps = { x: sx, y: game.surfaceH(sx, sz), z: sz };
        const e = t.root.position;
        if (game.canSee({ x: e.x, y: e.y + 1.6, z: e.z }, ps)) longest = Math.max(longest, Math.hypot(e.x - sx, e.z - sz));
      }
    }
    for (const t of targets) { t.damage(9999, 'head'); game.registerKill(t, true, t.root.position.clone()); }
    step(1 / 60);
    rec('4 three marksmen on rooftops, one visible from the street at 100 m or more', targets.length === 3 && onRoofs && longest >= 100 && c.objective.id === 'm2jammer',
      { targets: targets.length, onRoofs, longestSightline: Math.round(longest), obj: c.objective.id });
    freeze();

    // 5. jammer
    r = route([[100, 220], [150, 220], [150, 150], [147.2, 150]]);
    u = use('jammer');
    step(1 / 60);
    rec('5 jammer reached and charge planted', r.ok && u.ok && c.objective.id === 'm2hold', { walk: r, use: u, obj: c.objective.id });

    // 6. hold: reinforcements arrive, the charge blows at 75 s
    const n0 = game.robots.length;
    let peak = 0;
    for (let i = 0; i < 60 * 77 && c.objective.id === 'm2hold'; i++) {
      step(1 / 60);
      peak = Math.max(peak, game.robots.length - n0);
      game.player.state.health = 1e9;
    }
    rec('6 hold the yard: reinforcements come, the charge blows after 75 s', c.objective.id === 'm2manifest' && peak >= 9,
      { reinforcements: peak, obj: c.objective.id });
    for (const x of game.robots) if (!x.dead && !c.persist.some((e) => e.robot === x)) { x.damage(9999, 'body'); }
    step(1 / 60);
    freeze();

    // checkpoint reload must not double the stage's soldiers
    const alive = () => game.robots.filter((x) => !x.dead).length;
    const before = alive();
    game.reloadCheckpoint();
    step(1 / 60);
    const after = alive();
    // the stage's own soldiers come back once each, plus the living patrols
    const expect = c.stageEnemies.length + c.persist.length;
    rec('a checkpoint reload brings back the stage and the patrols without doubling them', after === expect && c.persist.length > 0,
      { before, after, expect, stage: c.stageEnemies.length, patrols: c.persist.length, obj: c.objective.id });
    freeze();

    // 7. petrol station
    const k = door('kiosk');
    r = route([[150, 112], [-10, 112], [k.o[0], 112], k.o, k.i, k.f]);
    u = use('manifest');
    step(1 / 60);
    rec('7 into the petrol station office, manifest taken', r.ok && u.ok && c.objective.id === 'm2exfil', { walk: r, use: u, obj: c.objective.id });
    freeze();

    // 8. exfil
    // round the burning car in the middle of Main Street at z 206
    r = route([k.i, k.o, [k.o[0], 112], [0, 112], [0, 194], [-2.5, 200], [-2.5, 214], [0, 222], [0, 286], [8.2, 288], [8.2, 316], [5, 318.5]]);  // the roadblock: round it on the east pavement
    for (let i = 0; i < 3; i++) step(1 / 60);
    rec('8 reach the pickup: mission complete screen', r.ok && game.won && game.state === rs.STATE.OVER, { walk: r, won: game.won, state: game.state });
  }
}
