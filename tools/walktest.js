// Walk test.
//
// A level that looks right in a screenshot but cannot be walked through is
// worthless, and collider bugs do not show up in a still. This drives the real
// player controller -- same collision, same step-up, same gravity -- along the
// campaign route and reports which legs actually completed.
//
// Load in the console:
//   const w = await import('/tools/walktest.js'); w.run(__rs)

// Waypoints go through the doorways, because that is the route a player takes.
// A straight line from room centre to room centre walks into walls and proves
// nothing about whether the level connects.
// [name, x, z, expectedFloorY]
// The height matters: without it, standing on the ground floor directly above
// the basement counts as "reached the basement", and a sealed staircase passes.
const B = -3.6;
const ROUTE = [
  ['spawn',               0, 34, 0],
  ['gate',                0, 12, 0],
  ['forecourt',           0, 4, 0],
  ['main entrance',       0, -2, 0],
  ['reception',           3, -8, 0],
  ['reception rear door', 0, -14, 0],
  ['back of house',       0, -20, 0],
  ['corridor door E',     6, -26, 0],
  ['main corridor',       6, -29, 0],
  ['corridor west',     -20, -29, 0],
  ['office door',       -20, -25, 0],
  ['offices',           -20, -14, 0],
  ['office door out',   -20, -25, 0],
  ['corridor west 2',   -23, -29, 0],
  ['storage door',      -23, -32, 0],
  ['storage',           -23, -40, 0],
  ['storage south door', -23, -48, 0],
  ['rear corridor W',   -23, -49, 0],
  ['rear corridor C',   -12, -49, 0],
  ['rear corridor mid', -3.5, -49, 0],
  ['stair top',         -3.5, -52.5, -0.7],
  ['stair bottom',      -3.5, -59.6, B],
  ['shaft floor east',     3, -56, B],
  ['basement door',        0, -47, B],
  ['basement corridor',    0, -40, B],
  ['lab door',            -6, -36, B],
  ['laboratory',         -16, -36, B],
  ['lab door out',        -6, -36, B],
  ['armory door',          7, -34, B],
  ['armory',              16, -36, B],
  ['armory door out',      7, -34, B],
  ['back to corridor',     0, -42, B],
  ['basement door out',    0, -47, B],
  ['stair bottom 2',    -3.5, -59.6, B],
  ['stair top 2',       -3.5, -51.5, 0],
  ['rear corridor E',     16, -49, 0],
  ['loading bay',         18, -56, 0],
];

// Mission 2, DEAD GROUND: the street route between its objectives (the
// building interiors are covered by tools/mission2test.js).
const M2_ROUTE = [
  ['station shelf',       0, 30, 0],
  ['south gate',          0, 44, 0],
  ['ridge junction',      0, 108, null],
  ['pharmacy front',      8, 122, null],
  ['ridge road west',  -150, 108, null],
  ['box west',         -155, 105.5, null],
  ['west 2 street',    -100, 110, null],
  ['terraces corner',  -100, 222, null],
  ['box terraces',      -97, 227.5, null],
  ['back to street 220', -100, 220, null],
  ['street 220 east',   100, 220, null],
  ['box east',          105, 224.5, null],
  ['east 3 at 220',     150, 220, null],
  ['jammer yard',       147.2, 150, null],
  ['ridge road east',   150, 112, null],
  ['petrol forecourt',  -10, 112, null],
  ['main street',         0, 194, null],
  ['past the burning car', -2.5, 214, null],
  ['main south',          0, 286, null],
  ['east pavement',     8.2, 288, null],
  ['roadblock pavement', 8.2, 316, null],
  ['pickup',              5, 318.5, null],
];

// The town: out of the station's south gate, down Station Road and through
// every district. Expected heights are read from the ground itself (null).
const TOWN_ROUTE = [
  ['car park',          0, 34, 0],
  ['south gate',        0, 44, 0],
  ['station road',      0, 75, null],
  ['ridge junction',    0, 110, null],
  ['main street',       0, 150, null],
  ['square',           20, 192, null],
  ['town hall street', 50, 192, null],
  ['main south',        0, 230, null],
  ['main end',          0, 300, null],
  ['main at 275',       0, 275, null],
  ['street 275 west', -50, 275, null],
  ['terrace street', -100, 275, null],
  ['west 3 street',  -150, 220, null],
  ['ridge road west', -150, 110, null],
  ['ridge road east',  100, 110, null],
  ['east 3 street',    150, 200, null],
  ['between warehouses', 185, 190, null],
  ['back to street',   150, 190, null],
  ['east 3 street south', 150, 262, null],
  ['water tower yard', 168, 270, null],
];

export function run(rs, opts = {}) {
  const { game, step, MODE } = rs;
  const maxSeconds = opts.maxSeconds || (opts.route === 'town' || opts.route === 'mission2' ? 90 : 26);
  game.start(MODE.SURVIVAL);
  game.player.state.health = 1e9;
  // This test is about whether the level connects, not about locks, so open the
  // campaign's keycard doors. Otherwise the result depends on which test ran
  // before (campaigntest leaves them open, everything else closes them), and a
  // shut lab door was being misread as the probe failing to steer.
  if (game.campaign) for (const d of game.campaign.doors) game.campaign._openDoor(d);
  // The route is about the level, not about combat.
  game.queued = 0; game.waveActive = false; game.breakT = 1e9;
  for (const r of game.robots) game.scene.remove(r.root);
  game.robots.length = 0;

  const route = opts.route === 'town' ? TOWN_ROUTE : opts.route === 'mission2' ? M2_ROUTE : ROUTE;
  const p = game.player.state;
  p.x = route[0][1]; p.z = route[0][2]; p.y = 0; p.vx = p.vz = p.vy = 0;

  const legs = [];
  for (let i = 1; i < route.length; i++) {
    const [name, tx, tz, ty0] = route[i];
    const ty = ty0 === null ? game.surfaceH(tx, tz) : ty0;
    const startX = p.x, startZ = p.z;
    let t = 0, reached = false, minD = Infinity;
    let stuckFor = 0, lastD = Infinity;
    let slideDir = 1, slideFlips = 0, closing = 0;

    while (t < maxSeconds) {
      const dx = tx - p.x, dz = tz - p.z;
      const d = Math.hypot(dx, dz);
      minD = Math.min(minD, d);
      // Both horizontally there and on the right floor.
      if (d < 1.4 && Math.abs(p.y - ty) < 1.2) { reached = true; break; }
      // Steer at the target; yaw 0 looks down -Z. When progress stalls, strafe
      // for a moment -- a player walks around a desk rather than giving up, and
      // a test that gives up reports furniture as a broken level.
      p.yaw = Math.atan2(-dx, -dz);
      const strafing = stuckFor > 0.25;
      game.player.step(1 / 60, {
        moveX: strafing ? slideDir : 0, moveY: strafing ? -0.35 : -1,
        lookDX: 0, lookDY: 0,
        jump: false, crouch: false, sprint: false,
      }, 0);
      if (Math.abs(lastD - d) < 0.004) {
        stuckFor += 1 / 60;
        if (stuckFor > 1.6) { slideDir = -slideDir; stuckFor = 0.3; slideFlips++; }
      } else if (!strafing) stuckFor = 0;
      // Once round the obstacle, closing again and with a clear line ahead,
      // walk straight at the target. Without this a strafe never ended: the
      // probe spiralled round the target and wedged itself against a bench.
      closing = lastD - d > 0.004 ? closing + 1 / 60 : 0;
      if (strafing && closing > 0.5) {
        let clear = true;
        for (let s = 0.6; s <= 2.1 && clear; s += 0.5) if (game.blockedAt(p.x + dx / d * s, p.z + dz / d * s)) clear = false;
        if (clear) { stuckFor = 0; closing = 0; }
      }
      lastD = d;
      if (slideFlips > 6) break;
      t += 1 / 60;
    }
    legs.push({
      leg: route[i - 1][0] + ' -> ' + name,
      reached,
      seconds: +t.toFixed(1),
      closestApproach: +minD.toFixed(2),
      expectedY: ty,
      endedAt: [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)],
      travelled: +Math.hypot(p.x - startX, p.z - startZ).toFixed(1),
    });
    if (!reached) {
      // Teleport past the blockage so later legs still get tested; the failure
      // is already recorded.
      p.x = tx; p.z = tz; p.y = ty; p.vx = p.vz = p.vy = 0;
      for (let k = 0; k < 30; k++) {
        game.player.step(1 / 60, { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0,
          jump: false, crouch: false, sprint: false }, 0);
      }
    }
  }

  const failed = legs.filter((l) => !l.reached);
  // A leg that ends far below any floor means the walker found a hole in the
  // level, which matters far more than a leg the probe could not steer.
  // (the valley floor itself is down to about -10)
  const fellOut = legs.filter((l) => l.endedAt[1] < -30).map((l) => l.leg);
  return { total: legs.length, passed: legs.length - failed.length, failed, fellOut, legs };
}
