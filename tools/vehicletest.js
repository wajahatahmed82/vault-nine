// Truck test (mission 2's drivable vehicle).
//
// Through the real input path: F gets in, W drives, A/D steer, Space brakes,
// F gets out. Checks it climbs Station Road, stops at walls instead of
// passing through them, kills a soldier it hits at speed, halves damage to
// the driver, and puts the player back on foot with the gun in hand.
//
//   const t = await import('/tools/vehicletest.js'); t.run(__rs)

export function run(rs) {
  const { game, step, MODE, input } = rs;
  const out = [];
  const rec = (name, pass, detail) => out.push({ check: name, pass: !!pass, ...detail });
  const tick = (n) => { for (let i = 0; i < n; i++) step(1 / 60); };
  const V = game.vehicle;
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const tap = (code) => { key(code, true); tick(1); key(code, false); tick(1); };
  const hold = (code, frames) => { key(code, true); tick(frames); key(code, false); };

  try { body(); } catch (err) { rec('test ran to the end', false, { error: String(err && err.stack || err) }); }
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
    const p = game.player.state;
    p.health = 1e9;
    tick(2);

    // walk up to it: the prompt, then F
    p.x = V.x + 2.6; p.z = V.z; p.y = game.surfaceH(p.x, p.z);
    tick(2);
    const prompt = document.getElementById('prompt-text').textContent;
    tap('KeyF');
    rec('F next to the truck gets in (prompt says so), the gun goes away', V.driving && /Drive/.test(prompt) && !game.weapons.model.gun.visible,
      { prompt, driving: V.driving });

    // out through the gate and down Station Road
    const z0 = V.z;
    hold('KeyW', 240);
    const speed = V.speed, travelled = V.z - z0;
    hold('Space', 90);
    rec('W drives: 4 s of throttle covers 30 m+ down Station Road, Space stops it', travelled > 30 && speed > 10 && Math.abs(V.speed) < 0.5,
      { travelled: +travelled.toFixed(1), topSpeed: +speed.toFixed(1), afterBrake: +V.speed.toFixed(2) });
    rec('the camera sits behind the truck, not in the driver’s head', game.camera.position.distanceTo(new rs.THREE.Vector3(V.x, V.y + 1.8, V.z)) > 4, {});

    // steering
    const h0 = V.heading;
    key('KeyW', true); key('KeyA', true); tick(90); key('KeyA', false); key('KeyW', false);
    hold('Space', 60);
    rec('A steers left while moving', V.heading - h0 > 0.5, { turned: +(V.heading - h0).toFixed(2) });

    // walls stop it: aim it at a house and floor it
    const T = game.town;
    const b = T.buildings.find((q) => q.kind === 'house' && q.z > 120 && q.z < 200 && q.x < -60);
    const B = T.local(b, 0, 0);
    // back out from the house along its axis to clear ground, then 8 m more
    let off = b.w / 2 + 3, A;
    const hd = (q) => Math.atan2(-(B.x - q.x), -(B.z - q.z));
    for (; off < 60; off += 1) { A = T.local(b, off, 0); if (!V._blocked(A.x, A.z, hd(A))) break; }
    A = T.local(b, off + 8, 0);
    V.x = A.x; V.z = A.z; V.speed = 0; V.heading = hd(A);
    tick(1);
    const bumps0 = V.bumps;
    hold('KeyW', 300);
    const inside = V._blocked(V.x, V.z, V.heading);
    const dWall = Math.hypot(V.x - B.x, V.z - B.z);
    rec('driving into a house stops at the wall, never inside it', V.bumps > bumps0 && !inside && dWall > b.w / 2,
      { bumps: V.bumps - bumps0, centreToHouse: +dWall.toFixed(1), halfWidth: +(b.w / 2).toFixed(1) });

    // a soldier in the road
    hold('Space', 60);
    V.x = 0; V.z = 150; V.heading = Math.PI; V.speed = 0;   // facing south down Main Street
    tick(1);
    const s = rs.spawnSoldier('assault', 0, 168, 0);
    s.update = () => {};
    hold('KeyW', 120);
    rec('a soldier hit at speed is killed', s.dead, { speed: +V.speed.toFixed(1) });
    hold('Space', 60);

    // the cab takes half
    p.health = 100;
    game.hurt(20);
    rec('rounds through the cab do half damage', Math.abs(p.health + p.armor * 0 - 90) < 0.6 || p.health === 90, { health: p.health });
    p.health = 1e9;

    // and out
    tap('KeyF');
    const gx = p.x - V.x, gz = p.z - V.z;
    rec('F gets out beside the truck, on foot, gun back', !V.driving && game.weapons.model.gun.visible && Math.hypot(gx, gz) > 1 && Math.hypot(gx, gz) < 4 && !game.blockedAt(p.x, p.z),
      { at: +Math.hypot(gx, gz).toFixed(1) });
  }
}
