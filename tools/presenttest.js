// Presentation test for gunplay Phase 4.
//
// Acceptance: "with the HUD hidden I can still tell what's happening from
// sound and screen effects alone". A machine cannot listen, so this checks the
// channels that carry it: every world sound is placed where it happens (left
// is left, behind is behind, relative to the camera), soldiers' voices come
// from the soldier, and the screen effects fire for incoming fire, hits, low
// health and flashbangs -- with the HUD switched off. Plus the HUD pieces
// themselves: minimap, compass, killfeed, objective pop-up, mission complete,
// each effect's setting, and AO only on the high presets.
//
//   const t = await import('/tools/presenttest.js'); t.run(__rs)

export function run(rs) {
  const { game, step, MODE, input, settings, THREE } = rs;
  const out = [];
  const rec = (name, pass, detail) => out.push({ check: name, pass: !!pass, ...detail });
  const tick = (n = 1) => { for (let i = 0; i < n; i++) step(1 / 60); };
  const log = () => rs.audioLog();
  // the log is a short ring; entries carry a running sequence number
  const mark = () => { const l = log(); return l.length ? l[l.length - 1].seq : 0; };
  const since = (n0) => log().filter((e) => e.seq > n0);
  const keep = {};
  for (const k of ['showHud', 'fxSuppression', 'fxLowHealth', 'fxFlash', 'fxChroma']) keep[k] = settings.get(k);

  const fresh = () => {
    game.difficulty = 'normal';
    game.campaignFrom = 'town';
    game.start(MODE.CAMPAIGN);
    for (const r of game.robots) game.scene.remove(r.root);
    game.robots.length = 0;
    input.releaseAll();
    game.player.state.health = 1e9;
    tick(2);
  };
  const place = (x, z, yaw, pitch = 0) => {
    const p = game.player.state;
    p.x = x; p.z = z; p.y = game.surfaceH(x, z); p.yaw = yaw; p.pitch = pitch; p.vx = p.vy = p.vz = 0;
    game.player.applyToCamera(0);
    tick(1);
    return p;
  };
  // a soldier who will shoot at the player at once
  const shooter = (x, z) => {
    const r = rs.spawnSoldier('assault', x, z, 0);
    r.alerted = true; r.awareness = 1;
    return r;
  };
  const fireAt = (r, missBy) => {
    // one round from his muzzle, aimed at or beside the player's head
    const o = new THREE.Vector3(); r.muzzle.getWorldPosition(o);
    const cam = game.camera.position;
    const tgt = cam.clone();
    // a miss goes over the head, so it is never in line with the shot
    if (missBy) tgt.y += missBy;
    game.robotAttack(10, o, tgt.sub(o).normalize(), r);
  };

  try { body(); } catch (err) { rec('test ran to the end', false, { error: String(err && err.stack || err) }); }
  for (const k of Object.keys(keep)) settings.set(k, keep[k]);
  input.releaseAll();
  const failed = out.filter((r) => !r.pass);
  return { total: out.length, passed: out.length - failed.length, failed, all: out };

  function body() {
    // ------------------------------------------------------------- the HUD
    fresh();
    settings.set('showHud', true);
    let p = place(0, 300, 0);
    tick(4);
    const mm = rs.hud.minimap;
    rec('compass reads N facing up Main Street, E after turning right', mm.last.heading === 0 &&
      (place(0, 300, -Math.PI / 2), tick(3), mm.last.heading === 90), { heading: mm.last.heading });

    // the objective dead ahead shows above the centre of the map
    const obj = game.campaign.markerPos();
    p = place(obj.x, obj.z + 30, 0);
    tick(3);
    const cv = document.getElementById('minimap'), cx = cv.getContext('2d');
    const img = cx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, sx = 0, sy = 0, painted = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      if (img[i + 3] > 0) painted++;
      if (img[i] > 230 && img[i + 1] > 160 && img[i + 1] < 200 && img[i + 2] < 100) { n++; sx += x; sy += y; }
    }
    const R = cv.width / 2;
    rec('minimap draws the town and puts the objective straight ahead of the player arrow',
      painted > cv.width * cv.height * 0.5 && n > 10 && Math.abs(sx / n - R) < 6 && sy / n < R - 20,
      { painted, amberPx: n, at: n ? [Math.round(sx / n), Math.round(sy / n)] : null, centre: R });

    // killfeed, with the weapon and range
    const r0 = rs.spawnSoldier('assault', p.x + 3, p.z - 18, 0);
    tick(2);
    const feed = document.getElementById('killfeed');
    const rows0 = feed.children.length;
    r0.damage(9999, 'body'); game.registerKill(r0, false, r0.root.position.clone());
    const last = feed.lastChild;
    rec('killfeed row names the kill, the weapon and the range', feed.children.length > rows0 && /RIFLE/.test(last.textContent) && /18 m/.test(last.textContent),
      { text: last && last.textContent.replace(/\s+/g, ' ').trim() });

    // objective pop-up on a new objective
    game.campaign._advance();
    tick(1);
    const pop = document.getElementById('objpop');
    rec('a new objective pops up in the middle of the screen', pop.classList.contains('show') && pop.textContent.includes(game.campaign.objective.text),
      { text: pop.textContent.replace(/\s+/g, ' ').trim() });

    // ------------------------------------------------- positional sound
    // at the Ridge Road / Main Street junction: open road on all four sides
    fresh();
    settings.set('showHud', false);
    p = place(0, 110, 0);
    const dirOf = (kind, n0) => since(n0).filter((e) => e.kind === kind).pop();
    const sideTest = (dx, dz) => {
      for (const r of game.robots) game.scene.remove(r.root);
      game.robots.length = 0;
      const r = shooter(p.x + dx, p.z + dz);
      tick(2);
      const n0 = mark();
      fireAt(r, 1.2);
      tick(1);
      return { shot: dirOf('shot', n0), whiz: dirOf('whiz', n0) };
    };
    const L = sideTest(-24, 0), Rt = sideTest(24, 0), B = sideTest(0, 24), F = sideTest(0, -24);
    const fmt = (e) => e && { right: +e.right.toFixed(1), ahead: +e.ahead.toFixed(1) };
    rec('enemy gunfire is placed where it is: left, right, behind, ahead (HUD hidden)',
      L.shot && L.shot.right < -20 && Rt.shot.right > 20 && B.shot.ahead < -20 && F.shot.ahead > 20,
      { left: fmt(L.shot), right: fmt(Rt.shot), behind: fmt(B.shot), ahead: fmt(F.shot) });
    rec('a near miss cracks where the round passed', L.whiz && Math.abs(L.whiz.dist) < 3, { whiz: L.whiz && { dist: +L.whiz.dist.toFixed(2) } });

    // footsteps of a soldier walking past
    fresh();
    p = place(0, 110, 0);
    const walker = rs.spawnSoldier('assault', -8, 100, 0);
    walker.setRoute([[-8, 100], [-8, 122], [-8, 100]]);
    let n0 = mark();
    tick(300);
    const steps = since(n0).filter((e) => e.kind === 'step');
    rec('a walking soldier’s footsteps are heard from his side', steps.length >= 4 && steps.every((e) => e.right < 0),
      { steps: steps.length, firstRight: steps[0] && +steps[0].right.toFixed(1) });

    // ------------------------------------------------------------ voices
    fresh();
    p = place(0, 110, 0);
    // a guard up the road, facing the player, notices him: "Contact!"
    const g1 = rs.spawnSoldier('assault', 6, 92, Math.atan2(0 - 6, 110 - 92));
    n0 = mark();
    let caption = '';
    const prev = game.onCallout;
    game.onCallout = (c) => { caption = c.text; prev && prev(c); };
    for (let i = 0; i < 300 && !since(n0).some((e) => e.kind === 'voice:contact'); i++) tick(1);
    const contact = since(n0).find((e) => e.kind === 'voice:contact');
    rec('a soldier who spots you shouts "Contact!" from where he stands', contact && contact.right > 3 && caption === 'Contact!',
      { voice: fmt(contact), caption });

    // empty magazine: "Reloading!"
    game.calloutT = 0; g1.calloutAt = -99;
    g1.rounds = 1;
    n0 = mark();
    for (let i = 0; i < 400 && !since(n0).some((e) => e.kind === 'voice:reloading'); i++) tick(1);
    rec('a soldier who runs dry calls "Reloading!" and stops firing for a moment', since(n0).some((e) => e.kind === 'voice:reloading') && g1.reloadT > 0,
      { reloadT: +g1.reloadT.toFixed(2) });

    // his mate goes down: "Man down!"
    const g2 = rs.spawnSoldier('assault', 10, 90, 0);
    tick(2);
    game.calloutT = 0; g1.calloutAt = -99;
    n0 = mark();
    g2.damage(9999, 'body'); game.registerKill(g2, false, g2.root.position.clone());
    tick(50);
    rec('when a soldier is killed, the nearest one calls "Man down!"', since(n0).some((e) => e.kind === 'voice:manDown'), {});
    game.onCallout = prev;

    // ------------------------------------------------------ screen effects
    fresh();
    settings.set('showHud', false);
    p = place(0, 110, 0);
    const S = game.screen;
    const sh = shooter(-20, 110);
    tick(2);
    fireAt(sh, 1.0);
    tick(1);
    rec('rounds cracking past blur and darken the screen, heavier on the side they came from',
      S.out.supp > 0.15 && S.dir.x < -0.5, { supp: +S.out.supp.toFixed(2), dir: [+S.dir.x.toFixed(2), +S.dir.y.toFixed(2)] });
    fireAt(sh, 0);
    tick(1);
    rec('being hit flashes the screen edge red with a colour split', S.out.hurt > 0.3 && S.out.chroma > 0.5,
      { hurt: +S.out.hurt.toFixed(2), chroma: +S.out.chroma.toFixed(2) });
    const usingShader = game.post.mode !== 'off' && game.post.effects.enabled;
    rec('effects run through the post shader on desktop', usingShader, { mode: game.post.mode });

    game.player.state.health = 18;
    tick(2);
    const lowHp = S.out.desat;
    game.player.state.health = 100;
    tick(2);
    rec('low health drains the colour, full health does not', lowHp > 0.45 && S.out.desat === 0, { at18: +lowHp.toFixed(2), at100: S.out.desat });

    // flashbang in front, then behind
    const bang = (dz) => {
      S.reset(); tick(1);
      game.gear.nades.length = 0;
      const q = new THREE.Vector3(p.x, game.surfaceH(p.x, p.z + dz) + 0.1, p.z + dz);
      game.gear._flash(q);
      tick(1);
      return S.out.flash;
    };
    const front = bang(-6), behind = bang(6);
    const blindGuy = rs.spawnSoldier('assault', p.x + 2, p.z - 8, 0);
    tick(2);
    game.gear._flash(new THREE.Vector3(p.x + 2, game.surfaceH(p.x, p.z - 6) + 0.1, p.z - 6));
    rec('a flashbang in view whites the screen out; behind you it barely does; soldiers near it are blinded',
      front > 0.8 && behind < front * 0.5 && blindGuy.blindT > 2, { front: +front.toFixed(2), behind: +behind.toFixed(2), blind: +(blindGuy.blindT || 0).toFixed(1) });

    // a soldier who lost sight of you throws one
    fresh();
    p = place(0, 110, 0);
    const el = rs.spawnSoldier('elite', 0, 92, 0);
    el.alerted = true; el.awareness = 1; el.nadeCd = 0; el.lastSeen.set(0, 0, 110);
    // hide the player from him: smoke between
    game.gear.smokes.push({ p: new THREE.Vector3(0, game.surfaceH(0, 101), 101), t: 3, r: 0 });
    let thrown = null;
    for (let i = 0; i < 300 && !thrown; i++) { tick(1); thrown = game.gear.nades.find((q) => q.enemy && q.kind === 'flash'); }
    rec('a soldier who loses sight of you lobs a flashbang at your last position', !!thrown, { nades: game.gear.nades.map((q) => q.kind) });
    game.gear.smokes.length = 0; game.gear.nades.length = 0;

    // each effect has a setting
    fresh();
    p = place(0, 300, 0);
    for (const k of ['fxSuppression', 'fxLowHealth', 'fxFlash', 'fxChroma']) settings.set(k, false);
    S.suppress(1, { right: -1, ahead: 0 }); S.hit(40); S.flashbang(1);
    game.player.state.health = 10;
    tick(1);
    const offs = { ...S.out };
    for (const k of ['fxSuppression', 'fxLowHealth', 'fxFlash', 'fxChroma']) settings.set(k, true);
    tick(1);
    rec('each camera effect switches off in settings', offs.supp === 0 && offs.desat === 0 && offs.flash === 0 && offs.chroma === 0 &&
      S.out.supp > 0 && S.out.desat > 0 && S.out.flash > 0 && S.out.chroma > 0, { off: offs });
    game.player.state.health = 1e9;

    // without post-processing the CSS layer stands in
    const mode = game.post.mode;
    game.post.setMode('off');
    S.flashbang(1); tick(1);
    const cssFlash = +document.querySelector('#screenfx i:nth-child(3)').style.opacity;
    game.post.setMode(mode);
    S.reset(); tick(1);
    rec('with post-processing off (phones), a CSS layer shows the white-out', cssFlash > 0.8, { opacity: cssFlash });

    // ------------------------------------------------------------- AO
    const q0 = settings.get('quality');
    settings.applyPreset('high');
    const aoHigh = game.post.ao;
    let applied = false;
    const realAO = game.post.applyAO.bind(game.post);
    game.post.applyAO = (t, c) => { const r = realAO(t, c); applied = applied || r; return r; };
    game.post.render(1 / 60);
    settings.applyPreset('medium');
    const aoMed = game.post.ao;
    settings.applyPreset('low');
    const aoLow = game.post.ao;
    game.post.applyAO = realAO;
    if (!settings.applyPreset(q0)) rs.setQuality(q0);
    rec('ambient occlusion runs on HIGH, not on MEDIUM or LOW', aoHigh && applied && !aoMed && !aoLow, { high: aoHigh, applied, medium: aoMed, low: aoLow });

    // ------------------------------------------------------------ the HUD off
    settings.set('showHud', false);
    tick(1);
    const hidden = ['minimap', 'compass', 'vitals', 'weaponbox', 'crosshair'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none');
    rec('Show HUD off hides the map, compass, vitals, ammo and crosshair', hidden && document.getElementById('combat').classList.contains('nohud'), {});

    // ---------------------------------------------------- mission complete
    fresh();
    const c = game.campaign;
    c.objIdx = c.stages.length - 2;
    c._advance();
    c._advance();
    tick(1);
    const scr = document.getElementById('screens').textContent;
    rec('finishing the last objective shows a mission-complete screen with stats',
      game.won && game.state === rs.STATE.OVER && /MISSION COMPLETE/.test(scr) && /Accuracy/.test(scr) && /Longest kill/.test(scr),
      { state: game.state, won: game.won });
    game.toMenu && game.toMenu();
  }
}
