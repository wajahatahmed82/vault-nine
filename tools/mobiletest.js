// Phone controls test.
//
// The campaign used to be impossible to finish on a phone: every keycard,
// door and terminal needed the E key, and there was no touch equivalent. Then
// the first USE button lost real taps, because it was wired as a hold and a
// tap presses and releases between two frames. This file pins both down.
//
//   const m = await import('/tools/mobiletest.js'); m.run(__rs)

function tap(el) {
  // press and release with no frame in between -- exactly what a quick thumb does
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
}

const shown = (el) => el.classList.contains('show');

export function run(rs) {
  const { game, step, MODE, prog, input } = rs;
  const out = [];
  const rec = (check, pass, detail) => out.push({ check, pass, ...detail });
  const use = document.getElementById('btn-interact');
  const breath = document.getElementById('btn-breath');
  const inspect = document.getElementById('btn-inspect');
  const c = game.campaign;

  prog.data.level = 6;
  game.difficulty = 'normal';
  game.start(MODE.CAMPAIGN);
  game.player.state.health = 1e9;
  input.releaseAll();
  const p = game.player.state;
  const stand = (x, z, yaw, pitch) => {
    p.x = x; p.z = z; p.y = 0; p.yaw = yaw; p.pitch = pitch; p.vx = p.vz = 0;
    step(1 / 60);
    p.x = x; p.z = z; p.yaw = yaw; p.pitch = pitch;
    step(1 / 60);
  };

  rec('USE button exists', !!use, {});
  stand(0, 30, 0, 0);
  rec('USE hidden when nothing is in reach', !shown(use), { label: use.textContent });

  // objective gates
  stand(0, 4, 0, 0); stand(0, -8, 0, 0);
  stand(0, -3.6, 0, -0.3);
  rec('USE appears at the visitor log, labelled with the verb',
    shown(use) && use.textContent === 'READ', { label: use.textContent });

  tap(use);
  step(1 / 60);
  rec('a sub-frame tap on USE is not lost', c.interact.get('visitorLog').used,
    { used: c.interact.get('visitorLog').used });

  stand(18, -2.3, 0, -0.35);
  rec('keycard shows TAKE', use.textContent === 'TAKE', { label: use.textContent });
  tap(use); step(1 / 60);
  // the campaign checks completion before it handles the tap, so the mission
  // advances on the following frame
  step(1 / 60);
  rec('tapping TAKE grants the keycard and advances the mission',
    c.keycard === 2 && c.objective.id === 'security', { keycard: c.keycard, objective: c.objective.id });

  // the lab door asks for level 4: the button must read as locked
  c.keycard = 2;
  const door = c.interact.get('securityDoor');
  door.needs = 9;                         // force a locked state for the check
  stand(21.4, -10.6, 0, -0.05);
  const lockedLabel = use.textContent, lockedClass = use.classList.contains('locked');
  door.needs = 2;
  step(1 / 60); step(1 / 60);
  rec('a door needing a higher keycard shows LOCKED in red', lockedLabel === 'LOCKED' && lockedClass,
    { label: lockedLabel, redClass: lockedClass });
  tap(use); step(1 / 60);
  rec('tapping OPEN with the right keycard opens the door', c.securityDoor.open, { open: c.securityDoor.open });

  // breath button only while scoped with the marksman rifle
  const W = game.weapons;
  W.switchTo('sniper', true);
  for (let i = 0; i < 25; i++) step(1 / 60);
  const hiddenUnscoped = !shown(breath);
  input.touch.aim = true;
  for (let i = 0; i < 40; i++) step(1 / 60);
  const visibleScoped = shown(breath);
  breath.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
  for (let i = 0; i < 6; i++) step(1 / 60);
  const held = W.breathHeld;
  breath.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
  input.touch.aim = false;
  for (let i = 0; i < 20; i++) step(1 / 60);
  rec('BREATH appears only when scoped, and holding it holds breath',
    hiddenUnscoped && visibleScoped && held, { hiddenUnscoped, visibleScoped, held });

  W.switchTo('rifle', true);
  for (let i = 0; i < 25; i++) step(1 / 60);
  tap(inspect); step(1 / 60);
  rec('inspect button inspects', W.inspectT > 0, { inspectT: +W.inspectT.toFixed(2) });

  const combat = document.getElementById('combat');
  const waveCell = document.querySelector('#topbar .tb');
  rec('campaign hides the wave-survival top bar',
    combat.classList.contains('campaign') && getComputedStyle(waveCell).display === 'none',
    { campaignClass: combat.classList.contains('campaign') });

  const failed = out.filter((o) => !o.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out };
}
