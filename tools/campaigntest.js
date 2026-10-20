// Campaign playthrough test.
//
// Drives the real player controller and the real interaction system through
// mission 1 from the car park to the loading bay, asserting that every
// objective advances for the reason it is supposed to, that the level contains
// no soldiers until the pacing says so, and that locked doors actually stop the
// player until the right keycard is held.
//
//   const c = await import('/tools/campaigntest.js'); c.run(__rs)

function walkTo(rs, tx, tz, ty, maxSeconds = 30) {
  const { game } = rs;
  const p = game.player.state;
  let t = 0, slide = 1, flips = 0, last = Infinity, stuck = 0;
  while (t < maxSeconds) {
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.3 && (ty === undefined || Math.abs(p.y - ty) < 1.3)) return true;
    p.yaw = Math.atan2(-dx, -dz);
    const strafing = stuck > 0.25;
    game.player.step(1 / 60, {
      moveX: strafing ? slide : 0, moveY: strafing ? -0.4 : -1,
      lookDX: 0, lookDY: 0, jump: false, crouch: false, sprint: false,
    }, 0);
    if (Math.abs(last - d) < 0.004) {
      stuck += 1 / 60;
      if (stuck > 1.5) { slide = -slide; stuck = 0.3; flips++; }
    } else if (!strafing) stuck = 0;
    last = d;
    if (flips > 8) return false;
    t += 1 / 60;
  }
  return false;
}

// Stand at an interactable, look at it, and press E through the real path.
function useById(rs, id) {
  const { game, step } = rs;
  const c = game.campaign;
  const it = c.interact.get(id);
  if (!it) return { ok: false, why: 'no such interactable: ' + id };
  const p = game.player.state;
  // stand just short of it and face it
  const back = 1.1;
  const dir = Math.atan2(p.x - it.pos.x, p.z - it.pos.z);
  p.x = it.pos.x + Math.sin(dir) * back;
  p.z = it.pos.z + Math.cos(dir) * back;
  p.y = Math.abs(it.pos.y + 3.6) < 1.6 ? -3.6 : 0;
  p.yaw = Math.atan2(-(it.pos.x - p.x), -(it.pos.z - p.z));
  step(1 / 60);
  const picked = c.interact.pick(game.camera, p);
  if (!picked || picked.id !== id) return { ok: false, why: 'not picked, got ' + (picked && picked.id) };
  const r = c.interact.use(picked, { keycard: c.keycard });
  step(1 / 60);
  return { ok: r.ok, message: r.message };
}

export function run(rs) {
  const { game, step, MODE } = rs;
  const c = game.campaign;
  const out = [];
  const record = (name, pass, detail) => out.push({ step: name, pass, ...detail });

  game.difficulty = 'normal';
  // the original station mission; the town prologue has its own test
  game.campaignFrom = 'station';
  game.start(MODE.CAMPAIGN);
  game.player.state.health = 1e9;
  step(1 / 60);

  record('starts on objective 1', c.objective.id === 'approach', { objective: c.objective.id });
  record('level is empty of soldiers at start', game.robots.length === 0, { soldiers: game.robots.length });

  // 1 - approach
  walkTo(rs, 0, 4, 0);
  step(1 / 60);
  record('objective 1 completes on reaching the forecourt', c.objective.id === 'enter',
    { objective: c.objective.id });

  // 2 - enter the building
  walkTo(rs, 0, -2, 0); walkTo(rs, 0, -8, 0);
  step(1 / 60);
  record('objective 2 completes on entering reception', c.objective.id === 'reception',
    { objective: c.objective.id });
  record('still no soldiers after entering', game.robots.length === 0, { soldiers: game.robots.length });

  // 3 - find the keycard
  const log1 = useById(rs, 'visitorLog');
  const key = useById(rs, 'keycard2');
  step(1 / 60);
  record('visitor log readable', log1.ok, log1);
  record('keycard pickup grants level 2', key.ok && c.keycard === 2, { keycard: c.keycard });
  record('objective 3 completes on taking the keycard', c.objective.id === 'security',
    { objective: c.objective.id });

  // 4 - the security door must refuse a level-2 lock only when unheld
  const doorCol = c.securityDoor.col;
  const doorBlocksWhenShut = doorCol.top > 0;
  record('security door blocks while locked', doorBlocksWhenShut, { colliderTop: doorCol.top });
  const openDoor = useById(rs, 'securityDoor');
  record('security door opens with the level 2 keycard', openDoor.ok && c.securityDoor.open,
    { open: c.securityDoor.open });
  const tape = useById(rs, 'securityTerminal');
  step(1 / 60);
  record('security recording plays', tape.ok, tape);
  record('objective 4 completes after the recording', c.objective.id === 'power',
    { objective: c.objective.id });

  // 5 - first contact should exist now, and be small
  record('first soldiers appear only at objective 5', game.robots.length > 0 && game.robots.length <= 3,
    { soldiers: game.robots.length });
  const unaware = game.robots.every((r) => !r.alerted);
  record('first soldiers start unaware of the player', unaware,
    { alerted: game.robots.filter((r) => r.alerted).length });

  const gen = useById(rs, 'generator');
  step(1 / 60);
  record('generator can be started', gen.ok, gen);
  record('power flag set', game.powered === true, { powered: game.powered });
  record('objective 5 completes after power', c.objective.id === 'descend',
    { objective: c.objective.id });

  // 6 - armoury keycard, then down the stairs
  const cache = useById(rs, 'armoryCache');
  record('armoury cache grants level 4', cache.ok && c.keycard === 4, { keycard: c.keycard });

  game.player.state.x = -3.5; game.player.state.z = -51; game.player.state.y = 0;
  // Target the flat landing, not the last tread: at 1.3m tolerance a target of
  // -59 is satisfied while still standing on the stairs.
  const down = walkTo(rs, -3.5, -59.5, -3.6, 40);
  record('player can walk down to the basement', down && game.player.state.y < -3,
    { y: +game.player.state.y.toFixed(2) });
  // Step clear of the staircase before heading north: the treads are solid
  // overhead, so the way into the basement is around the flight, not under it.
  walkTo(rs, 3, -56, -3.6, 30);
  walkTo(rs, 0.5, -49, -3.6, 30);
  const inCorridor = walkTo(rs, 0, -40, -3.6, 40);
  step(1 / 60);
  record('objective 6 completes in the underground corridor',
    inCorridor && c.objective.id === 'lab', { objective: c.objective.id, reached: inCorridor });

  // 7 - the laboratory
  const labOpen = useById(rs, 'labDoor');
  record('laboratory door opens with the level 4 keycard', labOpen.ok && c.labDoor.open,
    { open: c.labDoor.open });
  walkTo(rs, -16, -36, -3.6, 40);
  const data = useById(rs, 'labTerminal');
  step(1 / 60);
  record('research data recovered', data.ok, data);
  record('objective 7 completes after the data', c.objective.id === 'escape',
    { objective: c.objective.id });

  // 8 - escape
  const escapeSoldiers = game.robots.filter((r) => !r.dead).length;
  record('escape stage is the biggest fight', escapeSoldiers >= 5, { soldiers: escapeSoldiers });

  game.player.state.x = 0; game.player.state.z = -44; game.player.state.y = -3.6;
  walkTo(rs, 0.5, -50, -3.6, 30);
  walkTo(rs, -3.0, -58.5, -3.6, 30);
  walkTo(rs, -3.5, -51.5, 0, 40);
  walkTo(rs, 16, -49, 0, 40);
  const atExit = walkTo(rs, 18, -58, 0, 40);
  step(1 / 60);
  record('reaches extraction and the mission ends', atExit && !c.active,
    { active: c.active, objIdx: c.objIdx });

  const failed = out.filter((o) => !o.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out };
}
