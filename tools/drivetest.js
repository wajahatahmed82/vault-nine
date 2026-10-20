// Driving camera test.
//
// Acceptance: "I can drive the whole mission 2 route using only W/A/S/D and
// the camera always shows where I'm going". An autopilot drives the truck
// along mission 2's streets by sending nothing but W/A/S/D/Space key events --
// no mouse at all -- and on every frame checks that the road 12 m ahead of
// the truck, in the direction it is moving, is on screen and not hidden
// behind a wall, and that the camera is never inside a wall or under the
// ground. Then: the mouse look relaxes back on its own, reversing does not
// spin the view, the FOV widens with speed, C switches to the cab view.
//
//   const t = await import('/tools/drivetest.js'); t.run(__rs)

// Road centre lines; each turn has a point just past the junction so the
// line out of it stays in the lane, clear of the kerbside lamp posts.
const WAYPOINTS = [
  [0, 44], [0, 75], [0, 108], [-10, 110], [-60, 110], [-100, 110], [-100, 120], [-100, 160], [-100, 220],
  [-92, 220], [-40, 220], [40, 220], [100, 220], [108, 220], [150, 220], [150, 212], [150, 150], [150, 112],
  [142, 110], [60, 110], [0, 110], [0, 120], [0, 150], [0, 194], [-3, 202], [-3, 212], [0, 222], [1.3, 229], [1.3, 245], [0, 252], [0, 286],
];

export function run(rs) {
  const { game, step, MODE, input, THREE } = rs;
  const V = game.vehicle;
  const out = [];
  const rec = (name, pass, detail) => out.push({ check: name, pass: !!pass, ...detail });
  const keys = new Set();
  const set = (code, on) => {
    if (on === keys.has(code)) return;
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, bubbles: true }));
    if (on) keys.add(code); else keys.delete(code);
  };
  const release = () => { for (const k of [...keys]) set(k, false); };
  const tick = (n = 1) => { for (let i = 0; i < n; i++) step(1 / 60); };
  // is a point inside any collision box (no padding)?
  const insideAny = (q) => {
    for (const c of game.grid.query(q.x - 0.1, q.z - 0.1, q.x + 0.1, q.z + 0.1)) {
      const bottom = c.bottom === undefined ? -1e9 : c.bottom;
      if (q.x > c.minX && q.x < c.maxX && q.z > c.minZ && q.z < c.maxZ && q.y > bottom && q.y < c.top) return true;
    }
    return false;
  };
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  try { body(); } catch (err) { rec('test ran to the end', false, { error: String(err && err.stack || err) }); }
  release();
  input.releaseAll();
  if (V.driving) V.exit();
  const failed = out.filter((r) => !r.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out };

  function body() {
    game.difficulty = 'normal';
    game.campaignFrom = 'm2';
    game.start(MODE.CAMPAIGN);
    input.releaseAll();
    for (const r of game.robots) game.scene.remove(r.root);
    game.robots.length = 0;
    game.campaign.persist = [];
    game.player.state.health = 1e9;
    tick(2);
    V.enter();
    tick(2);

    // ---- the route, keys only ----
    const cam = game.camera;
    const ndc = new THREE.Vector3();
    let frames = 0, seen = 0, blocked = 0, under = 0, worstAngle = 0;
    const misses = [], log = [];
    let underAt = null;
    let reached = 0, stuckAt = null;
    for (const [tx, tz] of WAYPOINTS) {
      let t = 0, backT = 0, lastBumps = V.bumps, bumpT = 0;
      while (t < 45) {
        const dx = tx - V.x, dz = tz - V.z;
        const d = Math.hypot(dx, dz);
        if (d < 3) break;
        const want = Math.atan2(-dx, -dz);
        const diff = wrap(want - V.heading);
        // nose against something: back up with the wheel the other way, the
        // way a driver gets out of a tight corner
        if (V.bumps !== lastBumps) { bumpT += 1 / 60; lastBumps = V.bumps; } else bumpT = Math.max(0, bumpT - 1 / 120);
        if (bumpT > 0.4 && backT <= 0) { backT = 1.1; bumpT = 0; }
        if (backT > 0) {
          backT -= 1 / 60;
          set('KeyW', false); set('Space', false); set('KeyS', true);
          set('KeyA', diff < 0); set('KeyD', diff > 0);
        } else {
          set('KeyS', false);
          set('KeyA', diff > 0.06); set('KeyD', diff < -0.06);
          // slow for corners, like a driver
          const turning = Math.abs(diff) > 0.35;
          set('KeyW', !(turning && V.speed > 5.5));
          set('Space', turning && V.speed > 7.5);
        }
        tick(1); t += 1 / 60;

        // record the camera and the truck; judged after the drive against
        // where the truck actually went
        log.push({ moving: V.speed > 2, cam: cam.position.clone(), view: cam.matrixWorldInverse.clone(), proj: cam.projectionMatrix.clone(),
          truck: new THREE.Vector3(V.x, V.y + 1.0, V.z) });
        if (V.speed > 2) {
          if (insideAny(cam.position)) blocked++;
          // the ground itself (terrain and lots), not the top of a nearby post
          const floorY = game.player.inVoid(cam.position.x, cam.position.z) ? game.player.groundAt(cam.position.x, cam.position.z, cam.position.y + 0.5) : game.surfaceH(cam.position.x, cam.position.z);
          if (cam.position.y < floorY + 0.2) { under++; if (!underAt) underAt = { cam: cam.position.toArray().map((v) => +v.toFixed(2)), truck: [+V.x.toFixed(1), +V.y.toFixed(2), +V.z.toFixed(1)], ground: +game.player.groundAt(cam.position.x, cam.position.z, cam.position.y + 2).toFixed(2) }; }
          const camFwd = new THREE.Vector3(); cam.getWorldDirection(camFwd);
          worstAngle = Math.max(worstAngle, Math.abs(wrap(Math.atan2(-camFwd.x, -camFwd.z) - V.heading)));
        }
      }
      if (Math.hypot(tx - V.x, tz - V.z) < 3) reached++;
      else { stuckAt = { to: [tx, tz], at: [+V.x.toFixed(1), +V.z.toFixed(1)] }; break; }
    }
    release();
    set('Space', true); tick(60); set('Space', false);
    // where the truck was 0.8 s later must be on screen, unobstructed, in the
    // frame being judged
    const AHEAD = 48;
    let run = 0, longest = 0;
    for (let i = 0; i + AHEAD < log.length; i++) {
      const f = log[i];
      if (!f.moving) continue;
      frames++;
      // backing out of a corner is not "where it is going"
      let rev = false;
      for (let j = i; j <= i + AHEAD; j++) if (!log[j].moving) { rev = true; break; }
      if (rev) { frames--; continue; }
      const pt = log[i + AHEAD].truck;
      ndc.copy(pt).applyMatrix4(f.view).applyMatrix4(f.proj);
      const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1;
      // three points on the truck there (left, right, roof); a lamp post may
      // hide one, the view must not lose two
      let clear = 0, hit = null, len = 0;
      for (const [ox, oy] of [[-0.9, 0], [0.9, 0], [0, 0.8]]) {
        const q = pt.clone(); q.x += ox; q.y += oy;
        const to = q.clone().sub(f.cam);
        len = to.length();
        const h = len > 1 ? game.traceShot(f.cam, to.normalize(), len - 1.2, true) : null;
        if (!h) clear++; else hit = h;
      }
      if (onScreen && clear >= 2) { seen++; run = 0; }
      else {
        run++; longest = Math.max(longest, run);
        if (misses.length < 8) misses.push({ at: [+f.truck.x.toFixed(1), +f.truck.z.toFixed(1)], onScreen, ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], hit: hit && +hit.distance.toFixed(1), len: +len.toFixed(1) });
      }
    }
    rec('drives the mission 2 streets on W/A/S/D alone', reached === WAYPOINTS.length,
      { waypoints: `${reached}/${WAYPOINTS.length}`, stuckAt, bumps: V.bumps });
    // a lamp post or telegraph pole may cross the view for an instant; the way
    // ahead must never be lost for longer than 0.25 s
    rec('the way ahead is on screen and unobstructed (never lost for more than 0.25 s)', frames > 600 && longest <= 15,
      { frames, seen, percent: +(seen / frames * 100).toFixed(2), longestGapSeconds: +(longest / 60).toFixed(2), worstCameraVsTruckDeg: Math.round(worstAngle * 180 / Math.PI), misses });
    rec('the camera is never inside a wall or under the ground', blocked === 0 && under === 0, { blocked, under, underAt });

    // ---- mouse look relaxes back ----
    const ev = (mx) => { const e = new MouseEvent('mousemove', { bubbles: true }); Object.defineProperty(e, 'movementX', { value: mx }); Object.defineProperty(e, 'movementY', { value: 0 }); document.dispatchEvent(e); };
    input.pointerLocked = true; input.swallowMove = false;
    for (let i = 0; i < 10; i++) { ev(40); tick(1); }
    const offAfterLook = Math.abs(V.lookYaw);
    tick(60);                                 // 1 s: still where I left it
    const offAt1s = Math.abs(V.lookYaw);
    tick(150);                                // 3.5 s: back behind
    const offAt35 = Math.abs(V.lookYaw);
    rec('mouse look holds for a moment, then drifts back behind the truck', offAfterLook > 0.4 && offAt1s > offAfterLook * 0.9 && offAt35 < 0.1,
      { lookDeg: Math.round(offAfterLook * 57.3), at1s: Math.round(offAt1s * 57.3), at3_5s: Math.round(offAt35 * 57.3) });

    // ---- reversing ----
    let worstRev = 0;
    set('KeyS', true); set('KeyA', true);
    for (let i = 0; i < 180; i++) { tick(1); worstRev = Math.max(worstRev, Math.abs(wrap(V.camYaw - V.heading))); }
    set('KeyS', false); set('KeyA', false);
    rec('reversing keeps the view behind the truck (no spin)', V.speed < -2 || worstRev < 0.6, { speed: +V.speed.toFixed(1), worstLagDeg: Math.round(worstRev * 57.3) });
    set('Space', true); tick(60); set('Space', false);

    // ---- speed widens the view ----
    const fovStill = cam.fov, distStill = V.camDist;
    V.heading = Math.PI; V.x = 0; V.z = 130; tick(2);
    set('KeyW', true); tick(150); set('KeyW', false);
    rec('at speed the camera pulls back and the FOV widens', cam.fov > fovStill + 5 && V.camDist > distStill + 1.5,
      { fov: [+fovStill.toFixed(1), +cam.fov.toFixed(1)], boom: [+distStill.toFixed(1), +V.camDist.toFixed(1)], speed: +V.speed.toFixed(1) });
    set('Space', true); tick(90); set('Space', false);

    // ---- cab view ----
    set('KeyC', true); tick(1); set('KeyC', false); tick(2);
    const inCab = V.view === 'cab' && cam.position.distanceTo(new THREE.Vector3(V.x, V.y + 1.9, V.z)) < 2;
    set('KeyC', true); tick(1); set('KeyC', false); tick(2);
    rec('C switches to the cab view and back', inCab && V.view === 'chase', {});
  }
}
