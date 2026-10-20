// Town prologue test.
//
// Drives the real player controller and interaction system through the five
// town objectives: in through the police station's real front door, the
// report on the desk, through the substation fence to the breaker, into the
// town hall for the gate pass, then the locked station gate. Also checks the
// lights follow the power, a rooftop soldier really stands on the roof, and a
// soldier finds his way round a block of buildings instead of grinding into it.
//
//   const t = await import('/tools/towntest.js'); t.run(__rs)

function walkTo(rs, tx, tz, maxSeconds = 40) {
  const { game } = rs;
  const p = game.player.state;
  let t = 0, slide = 1, flips = 0, last = Infinity, stuck = 0;
  while (t < maxSeconds) {
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.0) return true;
    p.yaw = Math.atan2(-dx, -dz);
    const strafing = stuck > 0.25;
    game.player.step(1 / 60, { moveX: strafing ? slide : 0, moveY: strafing ? -0.4 : -1,
      lookDX: 0, lookDY: 0, jump: false, crouch: false, sprint: false }, 0);
    if (Math.abs(last - d) < 0.004) { stuck += 1 / 60; if (stuck > 1.5) { slide = -slide; stuck = 0.3; flips++; } }
    else if (!strafing) stuck = 0;
    last = d;
    if (flips > 8) return false;
    t += 1 / 60;
  }
  return false;
}

function route(rs, pts) {
  for (const [x, z] of pts) if (!walkTo(rs, x, z)) return { ok: false, at: [x, z] };
  return { ok: true };
}

function useById(rs, id) {
  const { game, step } = rs;
  const c = game.campaign;
  const it = c.interact.get(id);
  if (!it) return { ok: false, why: 'no such interactable: ' + id };
  const p = game.player.state;
  const picked = c.interact.pick(game.camera, p);
  // face it from where we stand
  p.yaw = Math.atan2(-(it.pos.x - p.x), -(it.pos.z - p.z));
  const eye = p.y + game.player.eyeHeight;
  p.pitch = Math.atan2(it.pos.y - eye, Math.hypot(it.pos.x - p.x, it.pos.z - p.z));
  step(1 / 60);
  const got = c.interact.pick(game.camera, p);
  void picked;
  if (!got || got.id !== id) return { ok: false, why: 'not picked, got ' + (got && got.id), dist: Math.hypot(it.pos.x - p.x, it.pos.z - p.z) };
  const r = c.interact.use(got, { keycard: c.keycard });
  step(1 / 60);
  p.pitch = 0;
  return { ok: r.ok, message: r.message };
}

export function run(rs) {
  const { game, step, MODE } = rs;
  const T = game.town, c = game.campaign;
  const out = [];
  const rec = (name, pass, detail) => out.push({ check: name, pass: !!pass, ...detail });

  try { body(); } catch (err) { rec('test ran to the end', false, { error: String(err) }); }
  game.atmos.setTime(rs.settings.get('timeOfDay'));
  const failed = out.filter((r) => !r.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out };

  function body() {
  game.difficulty = 'normal';
  game.campaignFrom = 'town';
  game.start(MODE.CAMPAIGN);
  game.player.state.health = 1e9;
  game.atmos.setTime('night');
  step(1 / 60);
  const p = game.player.state;

  rec('town start: objective, position, empty town, power off',
    c.objective.id === 'town' && Math.abs(p.z - 316) < 1 && game.robots.length === 0 && game.townPower === false,
    { objective: c.objective.id, z: +p.z.toFixed(1), soldiers: game.robots.length, power: game.townPower });
  game.atmos.update(0.3, game.camera.position);
  const lampOff = game.atmos.lights.every((L) => L.intensity === 0);
  rec('street lamps are dark before the power is restored', lampOff, {});

  // round the roadblock on the east pavement, up Main Street, in the front door
  const police = T.byTag('police');
  const du = police.doorsU[0];
  const outside = T.local(police, du, police.d / 2 + 1.8), inside = T.local(police, du, police.d / 2 - 2.2);
  // up the east pavement (clear of the benches and lamps at its kerb side),
  // across Main Street, in through the door
  const r1 = route(rs, [[6, 318.5], [8.2, 316], [8.2, 288], [8.2, outside.z], [0, outside.z], [outside.x, outside.z], [inside.x, inside.z]]);
  step(1 / 60);
  rec('walk round the roadblock and in through the police station door', r1.ok && c.objective.id === 'report',
    { ...r1, objective: c.objective.id, at: [+p.x.toFixed(1), +p.z.toFixed(1)] });

  // round the row of desks: along the open aisle between them and the lobby wall
  const ti = police.tagItem;
  const aisle = T.local(police, 5, ti.z + 1.6), front = T.local(police, ti.x, ti.z + 1.5);
  const r2 = route(rs, [[aisle.x, aisle.z], [front.x, front.z]]);
  const u2 = useById(rs, 'policeReport');
  step(1 / 60);
  rec('read the report at the desk inside', r2.ok && u2.ok && c.objective.id === 'substation',
    { walk: r2.ok, use: u2, objective: c.objective.id });
  rec('first contact arrives only after the report', game.robots.length >= 3, { soldiers: game.robots.length });

  // substation: through the gap in the west side of the fence to the breaker
  const sp = T.spots.substation;
  p.x = sp.x - 22; p.z = 112; p.y = game.surfaceH(p.x, p.z);
  const brk = c.interact.get('breaker');
  const r3 = route(rs, [[sp.x - 18, sp.z - 6], [sp.x - 16.5, sp.z - 5], [sp.x - 13.5, sp.z - 3], [brk.pos.x + 0.9, brk.pos.z]]);
  const u3 = useById(rs, 'breaker');
  step(1 / 60);
  game.atmos.state.lastAssign = -1;
  game.atmos.update(0.3, game.camera.position);
  rec('reach the breaker through the fence gap and restore power', r3.ok && u3.ok && c.objective.id === 'gatepass' && game.townPower,
    { walk: r3, use: u3, objective: c.objective.id, power: game.townPower });

  // town hall: gate pass in the side office
  const th = T.byTag('townhall');
  const tdu = th.doorsU[0];
  const tout = T.local(th, tdu, th.d / 2 + 1.8), tin = T.local(th, tdu, th.d / 2 - 2.2);
  const passIt = c.interact.get('gatePass');
  p.x = 44; p.z = tout.z; p.y = game.surfaceH(p.x, p.z);
  // the side office opens at its north and south ends; the desk is at the far end
  const tt = th.tagItem;
  const hall = T.local(th, -th.w / 2 + 7, -th.d / 2 + 1.4);
  const office = T.local(th, tt.x, tt.z + 1.4);
  const r4 = route(rs, [[tout.x, tout.z], [tin.x, tin.z], [hall.x, hall.z], [office.x, office.z]]);
  void passIt;
  const u4 = useById(rs, 'gatePass');
  step(1 / 60);
  rec('walk into the town hall and take the gate pass', r4.ok && u4.ok && c.keycard >= 1 && c.objective.id === 'gate',
    { walk: r4, use: u4, keycard: c.keycard, objective: c.objective.id });

  const roofGuy = game.robots.find((r) => r.root.position.y > 6 + game.surfaceH(r.root.position.x, r.root.position.z));
  rec('a marksman stands on a rooftop', !!roofGuy, { y: roofGuy && +roofGuy.root.position.y.toFixed(1) });

  // station gate: locked without the pass, opens with it
  p.x = 0; p.z = 44.8; p.y = game.surfaceH(0, 44.8); p.vx = p.vz = 0;
  const kc = c.keycard; c.keycard = 0;
  const locked = useById(rs, 'gateDoor');
  c.keycard = kc;
  const opened = useById(rs, 'gateDoor');
  step(1 / 60);
  rec('station gate refuses without the pass, opens with it', !locked.ok && opened.ok && c.gateDoor.open && c.objective.id === 'approach',
    { locked, opened, objective: c.objective.id });
  const r5 = route(rs, [[0, 38], [0, 30]]);
  rec('walk through the open gate into the car park', r5.ok, r5);

  // pathfinding: a soldier behind a block must come round it, not into it
  for (const r of game.robots) game.scene.remove(r.root);
  game.robots.length = 0;
  p.x = 2; p.z = 248; p.y = game.surfaceH(2, 248); p.health = 1e9;
  const e = rs.spawnSoldier('assault', 75, 248, 0);   // a block of houses and Main Street's shops are in the way
  e.alertTo(p.x, p.z, true);
  const start = Math.hypot(e.root.position.x - p.x, e.root.position.z - p.z);
  let minD = start;
  for (let i = 0; i < 60 * 30; i++) {
    step(1 / 60);
    p.health = 1e9;
    minD = Math.min(minD, Math.hypot(e.root.position.x - p.x, e.root.position.z - p.z));
  }
  // the straight line is blocked by two rows of buildings; closing 30 m means
  // it found the way round (the AI then flanks, so it does not walk to your feet)
  rec('a soldier routes round two blocks toward you', minD < start - 30 && game.nav && game.nav.nodes.length > 200,
    { startM: +start.toFixed(1), closestM: +minD.toFixed(1), navNodes: game.nav && game.nav.nodes.length, navEdges: game.nav && game.nav.edges, navBuildMs: game.nav && game.nav.buildMs });

  }
}
