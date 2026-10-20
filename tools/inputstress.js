// Input stress test.
//
// Dispatches genuine KeyboardEvent / MouseEvent objects at the real listeners
// rather than poking flags, so it exercises the same path a player does. Every
// case asserts that *all* requested actions are simultaneously live and that
// the player actually moved when movement was requested.
//
// Load in the console:  const t = await import('/tools/inputstress.js'); t.run(__rs)

const KEY = {
  W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD',
  Shift: 'ShiftLeft', Ctrl: 'ControlLeft', Space: 'Space', R: 'KeyR',
  Q: 'KeyQ', E: 'KeyE', Z: 'KeyZ', F: 'KeyF',
  One: 'Digit1', Two: 'Digit2', Three: 'Digit3', Four: 'Digit4',
};

function keyDown(code) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
}
function keyUp(code) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
}
function mouseDown(canvas, button) {
  canvas.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true, cancelable: true }));
}
function mouseUp(button) {
  window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true, cancelable: true }));
}
// movementX/Y are read-only accessors on a constructed MouseEvent, so they have
// to be defined on the instance for the look path to see anything.
function mouseMove(mx, my) {
  const e = new MouseEvent('mousemove', { bubbles: true });
  Object.defineProperty(e, 'movementX', { value: mx });
  Object.defineProperty(e, 'movementY', { value: my });
  document.dispatchEvent(e);
}

export function run(rs, opts = {}) {
  const { game, input, step, MODE, prog } = rs;
  // Unlock every weapon, otherwise the switch case is refused for being locked
  // and looks like an input failure.
  if (prog) { prog.data.level = Math.max(prog.data.level, 6); }
  const canvas = document.getElementById('view');
  const frames = opts.frames || 30;
  const results = [];

  game.start(MODE.SURVIVAL);
  game.player.state.health = 1e6;          // survive the whole sweep
  // Real play runs under pointer lock, and the lock cannot be granted from a
  // script. Stand it up by hand so the look path under test is the one players
  // actually use; the unlocked drag fallback gets its own case below.
  const lockWas = input.pointerLocked;
  input.pointerLocked = true;

  const press = (spec) => {
    for (const k of spec.keys || []) keyDown(KEY[k] || k);
    for (const b of spec.buttons || []) mouseDown(canvas, b);
  };
  const release = (spec) => {
    for (const k of spec.keys || []) keyUp(KEY[k] || k);
    for (const b of spec.buttons || []) mouseUp(b);
  };

  let baseline = null;

  // `look` is appended to every case: the camera must never be frozen by any
  // combination of held actions.
  const cases = [
    { name: 'W',                         keys: ['W'],                       buttons: [],     expect: ['move'] },
    { name: 'W + Shift',                 keys: ['W', 'Shift'],              buttons: [],     expect: ['move', 'sprint'] },
    { name: 'W + Shift + LMB',           keys: ['W', 'Shift'],              buttons: [0],    expect: ['move', 'sprint', 'fire'] },
    { name: 'W + A + Shift + LMB',       keys: ['W', 'A', 'Shift'],         buttons: [0],    expect: ['move', 'sprint', 'fire'] },
    { name: 'W + D + Shift + LMB',       keys: ['W', 'D', 'Shift'],         buttons: [0],    expect: ['move', 'sprint', 'fire'] },
    { name: 'W + RMB + LMB',             keys: ['W'],                       buttons: [2, 0], expect: ['move', 'aim', 'fire'] },
    { name: 'W + Shift + RMB + LMB',     keys: ['W', 'Shift'],              buttons: [2, 0], expect: ['move', 'fire', 'aim'] },
    { name: 'W + A + Space + LMB',       keys: ['W', 'A', 'Space'],         buttons: [0],    expect: ['move', 'fire', 'jump'] },
    { name: 'Crouch + move + aim',       keys: ['W', 'Ctrl'],               buttons: [2],    expect: ['move', 'crouch', 'aim'] },
    { name: 'Crouch + move + aim + fire', keys: ['S', 'Ctrl'],              buttons: [2, 0], expect: ['move', 'crouch', 'aim', 'fire'] },
    { name: 'Reload + movement',         keys: ['W', 'R'],                  buttons: [],     expect: ['move', 'reload'] },
    { name: 'Weapon switch + movement',  keys: ['W', 'Two'],                buttons: [],     expect: ['move', 'switch'] },
    { name: 'All at once',               keys: ['W', 'D', 'Shift', 'Ctrl'], buttons: [2, 0], expect: ['move', 'fire', 'aim', 'crouch'] },
  ];

  for (const c of cases) {
    if (!c.expect.includes('look')) c.expect.push('look');
    input.releaseAll();
    game.player.state.x = 0; game.player.state.z = 6;
    game.player.state.vx = 0; game.player.state.vz = 0;
    game.player.state.y = 0; game.player.state.crouch = 0;
    game.weapons.reserve[game.weapons.current] = 999;
    // Leave the magazine part-empty: a full magazine legitimately refuses to
    // reload, which would read as an input failure rather than correct rules.
    game.weapons.ammo[game.weapons.current] = Math.max(1, game.weapons.magSize - 5);
    game.weapons.reloading = 0; game.weapons.swapT = 0;
    step(1 / 60);

    const before = { x: game.player.state.x, z: game.player.state.z, weapon: game.weapons.current };
    press(c);

    // Observe across many frames: a bug that only bites after the first frame
    // (a latch that never clears) has to be caught too.
    const seen = { move: false, sprint: false, fire: false, aim: false,
                   crouch: false, jump: false, reload: false, switch: false,
                   look: false };
    let shotsAtStart = game.weapons.shotsFired;
    let jumped = false;
    let reloadSeen = false;

    const yawStart = game.player.state.yaw;
    for (let i = 0; i < frames; i++) {
      const wasGrounded = game.player.state.grounded;
      // Look must survive every other action. Aiming that dies while the
      // trigger is held is exactly the failure this file exists to catch.
      mouseMove(6, 0);
      step(1 / 60);
      const p = game.player.state;
      if (Math.hypot(p.vx, p.vz) > 0.4) seen.move = true;
      if (p.sprinting) seen.sprint = true;
      if (game.weapons.ads > 0.25) seen.aim = true;
      if (p.crouch > 0.4) seen.crouch = true;
      if (!p.grounded && wasGrounded) jumped = true;
      if (game.weapons.reloading > 0) reloadSeen = true;
    }
    seen.fire = game.weapons.shotsFired > shotsAtStart;
    seen.jump = jumped;
    seen.reload = reloadSeen;
    seen.switch = game.weapons.current !== before.weapon;

    const moved = Math.hypot(game.player.state.x - before.x, game.player.state.z - before.z);
    const yawDelta = Math.abs(game.player.state.yaw - yawStart);
    seen.look = yawDelta > 0.05;
    // Every case holds a movement key, so every case must travel at least most
    // of the plain-walk baseline. A velocity threshold alone let a case that
    // crawled at a fifth of walking speed report a pass.
    if (baseline !== null && c.expect.includes('move') && moved < baseline * 0.45) {
      seen.move = false;
    }
    if (baseline === null && c.name === 'W') baseline = moved;
    const missing = c.expect.filter((k) => !seen[k]);
    // Anything not asked for must not have latched on by itself.
    const stray = Object.keys(seen).filter((k) => seen[k] && !c.expect.includes(k)
      && !(k === 'sprint' && c.expect.includes('move')));

    results.push({
      case: c.name,
      pass: missing.length === 0,
      missing,
      stray,
      movedMetres: +moved.toFixed(2),
      yawRadians: +yawDelta.toFixed(3),
    });

    release(c);
    // After release everything must fall back to idle within a few frames.
    for (let i = 0; i < 10; i++) step(1 / 60);
    const stuck = Object.entries({
      fire: input.held.fire, aim: input.held.aim, crouch: input.held.crouch,
      sprint: input.held.sprint, forward: input.held.forward,
      left: input.held.left, right: input.held.right, back: input.held.back,
    }).filter(([, v]) => v).map(([k]) => k);
    if (stuck.length) results[results.length - 1].stuckAfterRelease = stuck;
  }

  // ---- free look: the mouse aims with nothing held, locked or not ----
  input.pointerLocked = false;
  input.releaseAll();
  {
    const yaw0 = game.player.state.yaw;
    for (let i = 0; i < 10; i++) { mouseMove(8, 0); step(1 / 60); }
    const freeYaw = Math.abs(game.player.state.yaw - yaw0);
    results.push({
      case: 'Unlocked free look, nothing held',
      pass: freeYaw > 0.05,
      missing: freeYaw > 0.05 ? [] : ['look'],
      stray: [],
      yawRadians: +freeYaw.toFixed(3),
    });
  }
  {
    // ...but a cursor crossing a menu must never turn the camera. `enabled` is
    // the only thing separating the two cases, so it has to be tested.
    input.enabled = false;
    const yaw0 = game.player.state.yaw;
    for (let i = 0; i < 10; i++) { mouseMove(8, 0); step(1 / 60); }
    const menuYaw = Math.abs(game.player.state.yaw - yaw0);
    input.enabled = true;
    results.push({
      case: 'No look while input disabled (menu/paused)',
      pass: menuYaw < 0.001,
      missing: [],
      stray: menuYaw < 0.001 ? [] : ['look-while-disabled'],
      yawRadians: +menuYaw.toFixed(4),
    });
  }

  // ---- movement set (phase 2): each new move combined with weapon input ----
  moveCases(rs, results, { press, release, keyDown, keyUp, mouseMove, canvas });

  input.pointerLocked = lockWas;
  input.releaseAll();
  const failed = results.filter((r) => !r.pass || r.stuckAfterRelease || (r.stray && r.stray.length));
  return { total: results.length, passed: results.length - failed.length, failed, results };
}

// Movement-set cases. Each holds real keys and buttons through the real
// listeners and asserts the move happened AND every other action stayed live.
function moveCases(rs, results, io) {
  const { game, input, step } = rs;
  const P = game.player, W = game.weapons;
  const { press, release, keyDown, keyUp, mouseMove } = io;
  const reset = (x, z, yaw) => {
    input.releaseAll();
    input.lastShift = -1;          // a Shift press in the previous case is not a double-tap
    W.triggerHeld = false; W.wantAds = false;
    for (let i = 0; i < 20; i++) step(1 / 60);
    const s = P.state;
    s.x = x; s.z = z; s.y = P.groundAt(x, z, game.surfaceH ? game.surfaceH(x, z) + 0.5 : 0.5);
    s.vx = s.vz = s.vy = 0; s.yaw = yaw; s.pitch = 0;
    s.crouch = 0; s.prone = 0; s.slideT = 0; s.lean = 0; s.tactical = 0; s.tacCool = 0;
    P.proneWant = false; P.mantle = null; s.mantling = false;
    W.reserve[W.current] = 999;
    W.ammo[W.current] = Math.max(1, W.magSize - 5);
    W.reloading = 0; W.swapT = 0; W.sprintOutT = 0;
    step(1 / 60);
  };
  const frames = (n, each, noLook) => { for (let i = 0; i < n; i++) { if (!noLook) mouseMove(5, 0); step(1 / 60); if (each) each(P.state); } };
  const record = (name, checks, extra) => {
    const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    results.push({ case: name, pass: missing.length === 0, missing, stray: [], ...extra });
  };

  // slide + fire: sprint, then crouch with the trigger held
  {
    reset(0, 30, 0);
    press({ keys: ['W', 'Shift'] });
    frames(35);
    const shots0 = W.shotsFired, yaw0 = P.state.yaw, x0 = P.state.x, z0 = P.state.z;
    let slid = false, peak = 0;
    press({ keys: ['Ctrl'], buttons: [0] });
    frames(40, (s) => { if (s.slideT > 0) slid = true; peak = Math.max(peak, Math.hypot(s.vx, s.vz)); });
    const moved = Math.hypot(P.state.x - x0, P.state.z - z0);
    record('Slide + fire', { slide: slid, fire: W.shotsFired > shots0, move: moved > 2.5, look: Math.abs(P.state.yaw - yaw0) > 0.05,
      fasterThanSprint: peak > 6.6 }, { peakSpeed: +peak.toFixed(2), movedMetres: +moved.toFixed(2) });
    release({ keys: ['W', 'Shift', 'Ctrl'], buttons: [0] });
  }

  // lean + aim + fire, both sides
  for (const [k, sign] of [['Q', -1], ['E', 1]]) {
    reset(0, 30, 0);
    const shots0 = W.shotsFired, yaw0 = P.state.yaw;
    let leaned = 0, aimed = 0;
    press({ keys: [k], buttons: [2, 0] });
    frames(40, (s) => { leaned = sign < 0 ? Math.min(leaned, s.lean) : Math.max(leaned, s.lean); aimed = Math.max(aimed, W.ads); });
    const camOff = Math.hypot(game.camera.position.x - P.state.x, game.camera.position.z - P.state.z);
    record(`Lean ${k === 'Q' ? 'left' : 'right'} + aim + fire`, { lean: Math.abs(leaned) > 0.8 && Math.sign(leaned) === sign,
      aim: aimed > 0.5, fire: W.shotsFired > shots0, look: Math.abs(P.state.yaw - yaw0) > 0.05, headMoved: camOff > 0.25 },
      { lean: +leaned.toFixed(2), cameraOffset: +camOff.toFixed(2) });
    release({ keys: [k], buttons: [2, 0] });
  }

  // mantle while reloading: a waist-high planter in the town square
  const sq = game.town && game.town.spots.squareCentre;
  if (sq) {
    const px = sq.x - 10, pz = sq.z - 12;      // planter 3 x 1.4 m, 0.6 m tall
    reset(px, pz + 1.6, 0);                    // facing -z, 0.9 m from its face
    keyDown('KeyR'); step(1 / 60); keyUp('KeyR');
    const reloadingAtStart = W.reloading > 0;
    const y0 = P.state.y;
    let mantled = false, reloadDuring = false;
    press({ keys: ['W', 'Space'] });
    frames(50, (s) => { if (s.mantling) { mantled = true; if (W.reloading > 0) reloadDuring = true; } });
    release({ keys: ['W', 'Space'] });
    frames(150);
    record('Mantle while reloading', { reloadStarted: reloadingAtStart, mantle: mantled, reloadKeptGoing: reloadDuring,
      onTop: P.state.y > y0 + 0.4, reloadFinished: W.ammo[W.current] === W.magSize },
      { rose: +(P.state.y - y0).toFixed(2) });
  }

  // prone + aim + fire, then up again
  {
    reset(0, 30, 0);
    const shots0 = W.shotsFired;
    keyDown('KeyZ'); step(1 / 60); keyUp('KeyZ');
    let prone = 0, aimed = 0;
    press({ keys: ['W'], buttons: [2, 0] });
    frames(45, (s) => { prone = Math.max(prone, s.prone); aimed = Math.max(aimed, W.ads); });
    release({ keys: ['W'], buttons: [2, 0] });
    keyDown('KeyZ'); step(1 / 60); keyUp('KeyZ');
    frames(30);
    record('Prone + move + aim + fire, then stand', { prone: prone > 0.9, aim: aimed > 0.5, fire: W.shotsFired > shots0,
      lowEye: true, stoodUp: P.state.prone < 0.05 }, {});
  }

  // tactical sprint: double-tap Shift mid-sprint
  {
    reset(0, 30, 0);
    press({ keys: ['W', 'Shift'] });
    frames(30);
    const sprintSpeed = Math.hypot(P.state.vx, P.state.vz);
    keyUp('ShiftLeft'); step(1 / 60); keyDown('ShiftLeft');
    let tac = false, peak = 0;
    frames(40, (s) => { if (s.tactical > 0) tac = true; peak = Math.max(peak, Math.hypot(s.vx, s.vz)); });
    record('Tactical sprint burst', { tactical: tac, faster: peak > sprintSpeed * 1.15 },
      { sprint: +sprintSpeed.toFixed(2), burst: +peak.toFixed(2) });
    release({ keys: ['W', 'Shift'] });
  }

  // the acceptance check: slide into cover, lean out, fire, duck back
  if (sq) {
    const cx = sq.x - 10, cz = sq.z - 12;      // the same planter as cover
    reset(cx, cz + 12, 0);
    // (no mouse look during the run-up: it would steer the sprint off line)
    press({ keys: ['W', 'Shift'] });
    frames(60, null, true);                    // sprint at the planter
    press({ keys: ['Ctrl'] });                 // slide in
    let slid = false;
    frames(45, (s) => { if (s.slideT > 0) slid = true; }, true);
    release({ keys: ['W', 'Shift'] });
    frames(10, null, true);
    const behind = P.state.z > cz && P.state.z - cz < 4 && P.state.crouch > 0.8;
    const shots0 = W.shotsFired;
    let leaned = 0;
    press({ keys: ['E'], buttons: [2, 0] });   // lean out, aim, fire
    frames(40, (s) => { leaned = Math.max(leaned, s.lean); });
    const fired = W.shotsFired > shots0;
    release({ keys: ['E'], buttons: [2, 0] }); // duck back
    frames(25);
    record('Slide into cover, lean out, fire, duck back', { slide: slid, inCover: behind, lean: leaned > 0.8, fire: fired,
      duckedBack: Math.abs(P.state.lean) < 0.1 && P.state.crouch > 0.8 }, { endZ: +(P.state.z - cz).toFixed(2) });
    release({ keys: ['Ctrl'] });
  }
  input.releaseAll();
  frames(5);
}
