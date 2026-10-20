import * as THREE from 'three';
import { TOUCH_ONLY } from './input.js';
import { CFG } from './config.js';
import { STATE, MODE } from './game.js';
import { UPGRADES, MAX_RANK } from './progression.js';
import * as audio from './audio.js';
import * as settings from './settings.js';
import { Minimap } from './minimap.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString();
const clock = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return m + ':' + (r < 10 ? '0' : '') + r;
};

// Phones: fill the screen and hold landscape. Both need a user gesture, and
// both are optional -- if the browser refuses, the game still runs.
function goFullscreen() {
  if (!TOUCH_ONLY) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement) return;
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    const lock = () => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (_) {} };
    if (p && p.then) p.then(lock).catch(() => {}); else lock();
  } catch (_) { /* not available: carry on windowed */ }
}

// "Take security keycard" -> "TAKE". A thumb-sized button needs a verb, not
// a sentence; the full prompt is still shown above it.
function shortVerb(text) {
  const w = String(text).trim().split(/\s+/)[0] || 'USE';
  return w.length > 8 ? 'USE' : w.toUpperCase();
}

export class HUD {
  constructor(game, input, prog) {
    this.game = game;
    this.input = input;
    this.prog = prog;

    this.screens = $('screens');
    this.combat = $('combat');
    this.cross = $('crosshair');
    this.marker = $('hitmarker');
    this.floats = $('floats');
    this.feed = $('killfeed');
    this.stick = $('stick');
    this.stickNub = $('stick-nub');
    this.fpsEl = $('fps');

    this.markerT = 0;
    this.bannerT = 0;
    this.vignetteT = 0;
    this.comboT = 0;
    this.fpsAcc = 0;
    this.panel = 'main';
    this.difficulty = 'normal';
    this.objBox = $('objective');
    this.objText = $('obj-text');
    this.objHint = $('obj-hint');
    this.promptBox = $('prompt');
    this.promptText = $('prompt-text');
    this.logBox = $('log');
    this.logTitle = $('log-title');
    this.logLines = $('log-lines');
    this.logT = 0;
    this._promptShown = null;
    this.logBox.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.logT = 0;
      this.logBox.classList.add('hidden');
    });

    game.onPrompt = (text, locked) => this.setPrompt(text, locked);
    game.onDown = () => this.banner('CHECKPOINT RELOADED');
    game.campaign.onObjective = (stage, i, n, first) => this.setObjective(stage, i, n, first);
    game.campaign.onLog = (entry) => this.showLog(entry);
    game.campaign.onCheckpoint = () => this.banner('CHECKPOINT');
    game.campaign.onComplete = () => this.banner('MISSION COMPLETE');
    this._v = new THREE.Vector3();

    // Each on-screen button drives one named action and nothing else.
    input.bindHold($('btn-fire'), 'fire');
    input.bindToggle($('btn-ads'), 'aim');
    input.bindToggle($('btn-crouch'), 'crouch');
    input.bindTap($('btn-reload'), () => this.game.weapons.startReload());
    input.bindTap($('btn-jump'), () => { this.input.jumpQueued = true; });
    input.bindTap($('btn-swap'), () => { this.input.switchQueued = 'next'; });
    input.bindTap($('btn-pause'), () => this.game.pause());
    // Phone controls for everything the campaign needs.
    // A tap, not a hold: queued so it cannot fall between two frames.
    input.bindTap($('btn-interact'), () => { this.input.queue.interact++; });
    input.bindHold($('btn-breath'), 'sprint');      // sprint while scoped = hold breath
    input.bindTap($('btn-inspect'), () => { this.input.queue.inspect++; });
    input.bindHold($('btn-leanl'), 'leanL');
    input.bindHold($('btn-leanr'), 'leanR');
    input.bindTap($('btn-prone'), () => { this.input.queue.prone++; });
    input.bindTap($('btn-tac'), () => { this.input.queue.tactical++; });
    input.bindTap($('btn-nade'), () => { this.input.queue.frag++; });
    input.bindTap($('btn-bag'), () => { this.input.queue.inventory++; });
    game.gear.onToast = (msg) => this.toast(msg);
    this.minimap = new Minimap(game, $('minimap'), $('compass'));
    game.onCallout = (c) => this.comms(c);
    game.campaign.onComplete = () => game.completeMission();
    this._lastObjId = null;
    game.onInventory = () => { this.panel = 'inventory'; game.pause(); };
    // Tab or Esc closes the pack. Gameplay input is off while paused, so the
    // keys are caught here; resume() clears the Esc the input layer queued.
    window.addEventListener('keydown', (e) => {
      if (this.panel !== 'inventory' || game.state !== STATE.PAUSED) return;
      if (e.code !== 'Tab' && e.code !== 'Escape') return;
      e.preventDefault();
      this.panel = 'main';
      game.resume();
    });
    this.tacBtn = $('btn-tac');
    this.useBtn = $('btn-interact');
    this.breathBtn = $('btn-breath');

    game.onHit = (part, pos, dmg) => this.hit(part, pos, dmg);
    game.onKill = (info) => this.kill(info);
    game.onWave = (n, x, cleared) => this.wave(n, x, cleared);
    // the red hit edge is a screen effect now (screenfx.js), so it survives a hidden HUD
    game.onDamaged = () => {};
    game.onCombo = (mult) => this.showCombo(mult);
    game.onLevelUp = (lvl) => this.levelUp(lvl);
    game.onStateChange = (s) => this.render(s);

    this.applyCrosshair();
    settings.onChange(() => this.applyCrosshair());
    this.render(game.state);
  }

  applyCrosshair() {
    const c = this.cross;
    c.style.setProperty('--ch-col', settings.get('crosshairColour'));
    c.style.setProperty('--ch-scale', settings.get('crosshairSize'));
    this.fpsEl.classList.toggle('on', settings.get('showFps'));
  }

  // ---------------- combat feedback ----------------

  project(pos) {
    this._v.copy(pos).project(this.game.camera);
    if (this._v.z > 1) return null;
    return {
      x: (this._v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this._v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  float(pos, text, cls) {
    const p = this.project(pos);
    if (!p) return;
    const d = document.createElement('div');
    d.className = 'float ' + (cls || '');
    d.textContent = text;
    d.style.left = p.x + 'px';
    d.style.top = p.y + 'px';
    this.floats.appendChild(d);
    setTimeout(() => d.remove(), 850);
  }

  hit(part, pos, dmg) {
    this.markerT = 0.16;
    this.marker.classList.toggle('head', part === 'head');
    if (pos && settings.get('damageNumbers')) this.float(pos, String(dmg), part === 'head' ? 'head' : '');
  }

  kill(info) {
    this.markerT = 0.28;
    this.marker.classList.add('kill');
    if (info.headshot) this.marker.classList.add('head');
    if (info.point) this.float(info.point, info.headshot ? 'HEADSHOT' : 'ELIMINATED',
      info.headshot ? 'head big' : 'big');
    this.pushFeed(info);
  }

  pushFeed(info) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    const mult = info.mult > 1 ? `<b class="mx">x${info.mult}</b>` : '';
    row.innerHTML = `<span class="fk">${info.headshot ? 'HEADSHOT' : 'KILL'}</span>
      <span class="fn">${info.name}</span>${mult}${info.weapon ? `<span class="fw">${info.weapon} &middot; ${info.dist} m</span>` : ''}`;
    this.feed.appendChild(row);
    setTimeout(() => { row.classList.add('out'); }, 2600);
    setTimeout(() => row.remove(), 3100);
    while (this.feed.children.length > 5) this.feed.firstChild.remove();
  }

  wave(n, x, cleared) {
    const b = $('banner');
    if (cleared) b.innerHTML = `<b>WAVE ${n} CLEAR</b><span>+${fmt(x)} &middot; RESUPPLIED</span>`;
    else b.innerHTML = `<b>WAVE ${n}</b><span>${x} HOSTILES INBOUND</span>`;
    b.classList.add('show');
    this.bannerT = 2.4;
  }

  // Short centre banner reused by the campaign for checkpoints and mission end.
  banner(title, sub) {
    const b = $('banner');
    b.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    b.classList.add('show');
    this.bannerT = 2.0;
  }

  showCombo(mult) {
    const el = $('combo');
    if (mult <= 1) { el.classList.remove('show'); return; }
    el.textContent = 'x' + mult;
    el.classList.add('show', 'pop');
    this.comboT = 1.4;
    setTimeout(() => el.classList.remove('pop'), 220);
  }

  levelUp(lvl) {
    audio.sfx.levelUp();
    const b = $('banner');
    b.innerHTML = `<b>LEVEL ${lvl}</b><span>UPGRADE POINT EARNED</span>`;
    b.classList.add('show');
    this.bannerT = 2.6;
  }

  setFps(fps, scale) {
    if (!settings.get('showFps')) return;
    this.fpsAcc++;
    if (this.fpsAcc % 12) return;
    this.fpsEl.textContent = Math.round(fps) + ' FPS  ' + scale.toFixed(2) + 'x';
    this.fpsEl.classList.toggle('bad', fps < 50);
  }

  // ---------------- per-frame ----------------

  update(dt) {
    if (this.tacBtn) {
      const ps = this.game.player.state;
      this.tacBtn.classList.toggle('show', ps.sprinting && ps.tactical <= 0 && ps.tacCool <= 0);
    }
    if (this.breathBtn) {
      const w = this.game.weapons;
      this.breathBtn.classList.toggle('show', w.current === 'sniper' && w.ads > 0.6);
    }
    // story log auto-dismiss
    if (this.logT > 0) {
      this.logT -= dt;
      if (this.logT <= 0) this.logBox.classList.add('hidden');
    }

    const g = this.game;
    const w = g.weapons;

    if (g.state === STATE.PLAY) {
      $('ammo-mag').textContent = w.mag;
      $('ammo-res').textContent = w.pool;
      $('ammo').classList.toggle('low', w.mag <= Math.ceil(w.magSize * 0.25));
      $('ammo').classList.toggle('reloading', w.reloading > 0);
      $('wname').textContent = w.spec.name;
      $('score').textContent = fmt(g.score);
      $('kills').textContent = g.kills;

      const hp = Math.max(0, g.health);
      $('hp-fill').style.width = hp + '%';
      $('hp-num').textContent = Math.ceil(hp);
      $('hp').classList.toggle('critical', hp <= 30);
      $('ar-fill').style.width = Math.max(0, g.armor) + '%';

      this.combat.classList.toggle('campaign', g.mode === MODE.CAMPAIGN);
      if (g.mode === MODE.CAMPAIGN) {
        // nothing: the objective panel carries the campaign
      } else if (g.mode === MODE.TIME) {
        $('obj-label').textContent = 'TIME LEFT';
        $('obj-value').textContent = clock(g.timeLeft);
        $('obj').classList.toggle('urgent', g.timeLeft < 30);
      } else {
        $('obj-label').textContent = g.waveActive ? 'HOSTILES' : 'NEXT WAVE';
        $('obj-value').textContent = g.waveActive
          ? String(g.aliveCount + g.queued)
          : Math.ceil(Math.max(0, g.breakT)) + 's';
        $('obj').classList.remove('urgent');
      }
      $('wave-n').textContent = g.wave || 1;

      // crosshair opens with bloom, closes when aiming
      const s = w.spec;
      // The weapon's real cone, so moving, jumping and sustained fire all open
      // the crosshair by exactly as much as they open the spread.
      const cone = w.cone;
      const px = Math.min(150, cone * window.innerHeight * 1.4) + 5;
      this.cross.style.setProperty('--gap', px.toFixed(1) + 'px');
      this.cross.style.opacity = (1 - w.ads * 0.95).toFixed(2);
      $('scope').classList.toggle('on', w.ads > 0.75 && w.scoped);
      this.combat.classList.toggle('nohud', !settings.get('showHud'));
      if (settings.get('showHud')) this.minimap.update(dt);
      this.gearHud(w, dt);

      const rl = $('reload-ring');
      if (w.reloading > 0) {
        rl.classList.add('show');
        rl.style.setProperty('--p', (1 - w.reloading / w.reloadTotal).toFixed(3));
      } else rl.classList.remove('show');

      // weapon slots, numbered as the number keys pick them
      const list = w.slotList();
      for (const id of w.ids) {
        const el = $('slot-' + id);
        if (!el) continue;
        const i = list.indexOf(id);
        el.classList.toggle('active', w.current === id);
        el.classList.toggle('locked', i < 0);
        el.style.display = w.owned && i < 0 ? 'none' : '';
        el.firstChild.textContent = i >= 0 ? String(i + 1) : '-';
      }
    }

    if (this.input.stickActive) {
      this.stick.classList.add('on');
      this.stick.style.left = this.input.stickOx + 'px';
      this.stick.style.top = this.input.stickOy + 'px';
      const nx = this.input.stickX - this.input.stickOx;
      const ny = this.input.stickY - this.input.stickOy;
      const d = Math.hypot(nx, ny) || 1;
      const cl = Math.min(d, 62);
      this.stickNub.style.transform =
        `translate(${((nx / d) * cl - 17).toFixed(1)}px, ${((ny / d) * cl - 17).toFixed(1)}px)`;
    } else this.stick.classList.remove('on');

    if (this.markerT > 0) {
      this.markerT -= dt;
      this.marker.classList.add('show');
      if (this.markerT <= 0) this.marker.classList.remove('show', 'kill', 'head');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) $('banner').classList.remove('show');
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0 && this.game.multiplier <= 1) $('combo').classList.remove('show');
    }
    if (this.vignetteT > 0) {
      this.vignetteT -= dt;
      $('vignette').style.opacity = Math.max(0, this.vignetteT / 0.7).toFixed(2);
    }
  }

  // Counts, zeroing, the item-in-hand bar and pickup toasts.
  gearHud(w, dt) {
    const C = this.game.gear.counts;
    for (const k of ['plates', 'meds', 'frags', 'smokes', 'flashes']) {
      const el = $('g-' + k);
      el.lastChild.textContent = C[k];
      el.classList.toggle('none', !C[k]);
    }
    const z = $('zero');
    const zs = w.spec.zeroing;
    z.classList.toggle('hidden', !zs);
    if (zs) z.children[0].textContent = w.zero;
    const a = w.attOf();
    $('atts').textContent = ['optic', 'muzzle', 'grip', 'mag'].map((k) => a[k] && CFG.attachments[a[k]].name).filter(Boolean).join(' · ');
    const ib = $('itembar');
    if (w.itemT > 0 && w.itemKind !== 'throw') {
      ib.classList.add('on');
      $('item-name').textContent = w.itemKind === 'plate' ? 'ARMOUR PLATE' : 'MEDKIT';
      ib.style.setProperty('--p', (1 - w.itemT / w.itemTotal).toFixed(3));
    } else ib.classList.remove('on');
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) $('toast').classList.remove('on');
    }
  }

  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    this.toastT = 2.2;
  }

  // ---- inventory: the loadout in hand, attachments and consumables ----
  inventoryPanel() {
    const g = this.game, w = g.weapons, C = g.gear.counts, G = CFG.gear, ps = g.player.state;
    const slotNames = { optic: 'OPTIC', muzzle: 'MUZZLE', grip: 'GRIP', mag: 'MAG' };
    const list = w.slotList();
    const rows = list.map((id, n) => {
      const a = w.att[id];
      const fits = CFG.fits[id] || [];
      const cells = Object.keys(slotNames).filter((sl) => fits.some((k) => CFG.attachments[k].slot === sl)).map((sl) => {
        const on = a[sl];
        const spares = [...new Set(w.spare)].filter((k) => fits.includes(k) && CFG.attachments[k].slot === sl && k !== on);
        return `<span class="att">${slotNames[sl]}:
          ${on ? `<button class="chip" data-a="inv-off" data-id="${id}" data-slot="${sl}">${CFG.attachments[on].name} &times;</button>` : '<i>&mdash;</i>'}
          ${spares.map((k) => `<button class="chip off" data-a="inv-on" data-id="${id}" data-k="${k}">+ ${CFG.attachments[k].name}</button>`).join('')}</span>`;
      }).join('');
      return `<div class="row"><b>${n + 1} &middot; ${CFG.weapons[id].name}${w.current === id ? ' (IN HAND)' : ''}</b>
        <i>${w.ammo[id]} / ${w.reserve[id]}</i><div style="width:100%">${cells}</div></div>`;
    }).join('');
    const loose = w.spare.filter((k) => !list.some((id) => (CFG.fits[id] || []).includes(k)));
    const item = (label, n, max, act) => `<div class="row"><span>${label}</span><i>${n} / ${max}</i>
      ${act ? `<button class="chip${n ? '' : ' off'}" data-a="${act}">USE</button>` : ''}</div>`;
    return this.el(`
      <div class="panel wide inv fade">
        <div class="h1">PACK</div>
        <div class="sub">HEALTH ${Math.ceil(ps.health)} &middot; ARMOUR ${Math.ceil(ps.armor)}</div>
        <div class="h2">WEAPONS</div>
        ${rows}
        ${loose.length ? `<div class="row"><i>Carried, fits nothing in hand: ${loose.map((k) => CFG.attachments[k].name).join(', ')}</i></div>` : ''}
        <div class="h2">GEAR</div>
        ${item('Armour plate (B) &middot; +' + G.plateArmour + ' armour', C.plates, G.maxPlates, 'inv-plate')}
        ${item('Medkit (H) &middot; +' + G.medHeal + ' health', C.meds, G.maxMeds, 'inv-med')}
        ${item('Frag grenade (G)', C.frags, G.maxFrags, 'inv-frag')}
        ${item('Smoke grenade (T)', C.smokes, G.maxSmokes, 'inv-smoke')}
        ${item('Flashbang (V)', C.flashes || 0, G.maxFlashes, 'inv-flash')}
        <button class="btn primary" data-a="resume">Back (Tab)</button>
      </div>`);
  }

  // ---------------- screens ----------------

  render(state) {
    const playing = state === STATE.PLAY;
    this.combat.classList.toggle('hidden', !playing);
    this.screens.classList.toggle('hidden', playing);
    this.screens.innerHTML = '';
    if (playing) return;

    // Panel overrides win over game state, otherwise Loadout and Settings are
    // unreachable from the pause and game-over screens.
    let node;
    if (this.panel === 'inventory' && state === STATE.PAUSED) node = this.inventoryPanel();
    else if (this.panel === 'loadout') node = this.loadoutPanel();
    else if (this.panel === 'settings') node = this.settingsPanel(state === STATE.PAUSED);
    else if (state === STATE.PAUSED) node = this.pausePanel();
    else if (state === STATE.OVER) node = this.overPanel();
    else node = this.mainPanel();

    this.screens.appendChild(node);
    this.wire(node);
  }

  go(panel) {
    this.panel = panel;
    this.render(this.game.state);
  }

  el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  // ---- main menu ----
  mainPanel() {
    const p = this.prog;
    const pct = Math.round((p.xpIntoLevel / p.xpNeeded) * 100);
    const next = p.nextUnlock();
    return this.el(`
      <div class="panel wide fade">
        <div class="brand"><span>VAULT</span><b>NINE</b></div>
        <div class="tagline">Meridian Ridge Research Station &middot; something happened here</div>

        <div class="lvlbar">
          <div class="lvlrow"><span>LEVEL ${p.level}</span><span>${p.xpIntoLevel} / ${p.xpNeeded} XP</span></div>
          <div class="bar"><i style="width:${pct}%"></i></div>
          ${next ? `<div class="lvlhint">Next unlock: <b>${next.spec.name}</b> at level ${next.spec.unlockLevel}</div>` : ''}
        </div>

        <div class="modes">
          <button class="mode" data-a="play-campaign">
            <b>CAMPAIGN — THE SIGNAL</b><span>Meridian Ridge Research Station. Find out what happened.</span>
            <i>DIFFICULTY ${(this.difficulty || 'normal').toUpperCase()}</i>
          </button>
          <div class="row diffrow">
            <button class="btn sm" data-a="diff-easy">Easy</button>
            <button class="btn sm" data-a="diff-normal">Normal</button>
            <button class="btn sm" data-a="diff-hard">Hard</button>
          </div>
          <button class="mode" data-a="play-survival">
            <b>SURVIVAL</b><span>Endless waves. Wave 1 starts with five.</span>
            <i>BEST WAVE ${p.bestWave || '--'}</i>
          </button>
          <button class="mode" data-a="play-time">
            <b>TIME ATTACK</b><span>Five minutes. Destroy everything you can.</span>
            <i>BEST ${fmt(p.bestTimeAttack)}</i>
          </button>
        </div>

        <div class="row">
          <button class="btn" data-a="loadout">Loadout${p.points ? ` <em>${p.points}</em>` : ''}</button>
          <button class="btn" data-a="settings">Settings</button>
        </div>
        <div class="hint">
          <b>WASD</b> move &middot; <b>Shift</b> sprint (twice: dash) &middot; <b>Ctrl</b> crouch / slide &middot; <b>Z</b> prone &middot; <b>Space</b> jump / vault<br>
          <b>Q E</b> lean &middot; <b>F</b> use &middot; <b>Mouse</b> aim &middot; <b>RMB</b> sights &middot; <b>R</b> reload &middot; <b>1-5</b> weapons &middot; <b>Esc</b> pause<br>
          <b>G</b> frag &middot; <b>T</b> smoke &middot; <b>B</b> armour plate &middot; <b>H</b> medkit &middot; <b>V</b> flashbang &middot; <b>Tab</b> pack &middot; <b>[ ]</b> sniper zero<br>
          On phone: left thumb moves, right thumb aims, buttons bottom-right.
        </div>
      </div>`);
  }

  // ---- loadout: weapons and upgrades ----
  loadoutPanel() {
    const p = this.prog;
    const w = this.game.weapons;
    const guns = Object.entries(CFG.weapons).map(([id, s]) => {
      const locked = p.level < s.unlockLevel;
      return `<div class="gun ${locked ? 'locked' : ''} ${w.current === id ? 'sel' : ''}">
        <div class="gl">
          <div class="gn">${s.name}</div>
          <div class="gs">${s.auto ? 'AUTO' : 'SEMI'} &middot; ${s.rpm} RPM &middot; ${s.magSize} RND
            &middot; ${s.pellets > 1 ? s.pellets + ' PELLETS' : s.damage + ' DMG'}</div>
        </div>
        ${locked
          ? `<span class="pill">LVL ${s.unlockLevel}</span>`
          : `<button class="btn sm" data-a="equip" data-id="${id}">${w.current === id ? 'Equipped' : 'Equip'}</button>`}
      </div>`;
    }).join('');

    const ups = Object.entries(UPGRADES).map(([id, u]) => {
      const rank = p.rank(id);
      const pips = Array.from({ length: MAX_RANK }, (_, i) =>
        `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      const maxed = rank >= MAX_RANK;
      return `<div class="upg">
        <div class="ul"><div class="un">${u.name}</div><div class="ud">${u.desc}</div>
          <div class="pips">${pips}</div></div>
        <button class="btn sm" data-a="buy" data-id="${id}"
          ${maxed || !p.canBuy(id) ? 'disabled' : ''}>${maxed ? 'MAX' : 'Upgrade'}</button>
      </div>`;
    }).join('');

    return this.el(`
      <div class="panel wide fade">
        <div class="h1">LOADOUT</div>
        <div class="sub">Level ${p.level} &middot; <b>${p.points}</b> upgrade point${p.points === 1 ? '' : 's'}</div>
        <div class="sec">WEAPONS</div>
        <div class="list">${guns}</div>
        <div class="sec">UPGRADES</div>
        <div class="list">${ups}</div>
        <button class="btn" data-a="back">Back</button>
      </div>`);
  }

  // ---- settings ----
  settingsPanel(fromPause) {
    const s = settings.all();
    const slider = (key, label, min, max, step, fmtFn) => `
      <div class="opt">
        <div class="ol"><span>${label}</span><b id="v-${key}">${fmtFn(s[key])}</b></div>
        <input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">
      </div>`;
    const toggle = (key, label) => `
      <div class="opt row-between">
        <span>${label}</span>
        <button class="btn sm toggle ${s[key] ? 'on' : ''}" data-toggle="${key}">${s[key] ? 'On' : 'Off'}</button>
      </div>`;
    const choice = (key, label, opts) => `
      <div class="opt row-between">
        <span>${label}</span>
        <div class="seg">${opts.map((o) =>
          `<button class="${s[key] === o ? 'on' : ''}" data-choice="${key}" data-val="${o}">${o}</button>`).join('')}</div>
      </div>`;

    return this.el(`
      <div class="panel wide fade">
        <div class="h1">SETTINGS</div>
        <div class="sec">AUDIO</div>
        ${slider('masterVol', 'Master Volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')}
        ${slider('musicVol', 'Music Volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')}
        ${slider('sfxVol', 'Effects Volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')}
        <div class="sec">CONTROLS</div>
        ${slider('sensitivity', 'Look Sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2) + 'x')}
        ${toggle('invertY', 'Invert Vertical Look')}
        <div class="sec">DISPLAY</div>
        ${slider('fov', 'Field of View', 60, 105, 1, (v) => Math.round(v) + '&deg;')}
        ${toggle('vsync', 'Frame Limiter')}
        ${toggle('showFps', 'Show FPS')}
        ${toggle('damageNumbers', 'Damage Numbers')}
        ${toggle('showHud', 'Show HUD')}
        <div class="sec">CAMERA EFFECTS</div>
        ${toggle('fxSuppression', 'Suppression Blur')}
        ${toggle('fxLowHealth', 'Low-Health Colour Drain')}
        ${toggle('fxFlash', 'Flashbang White-out')}
        ${toggle('fxChroma', 'Hit Colour Split')}

        <div class="sec">GRAPHICS PRESET</div>
        <div class="opt row-between">
          <span>Preset</span>
          <div class="seg">${['low', 'medium', 'high', 'ultra', 'auto'].map((o) =>
            `<button class="${s.quality === o ? 'on' : ''}" data-preset="${o}">${o}</button>`).join('')}
          </div>
        </div>
        ${s.quality === 'custom' ? '<div class="lvlhint">Custom &mdash; individual settings below</div>' : ''}

        <div class="sec">DETAIL</div>
        ${choice('shadowQuality', 'Shadow Quality', ['off', 'low', 'medium', 'high'])}
        ${slider('renderScale', 'Resolution Scale', 0.5, 2.0, 0.05, (v) => v.toFixed(2) + 'x')}
        ${choice('effects', 'Effects Detail', ['low', 'medium', 'high'])}
        ${choice('viewDistance', 'View Distance', ['near', 'medium', 'far'])}
        ${choice('postFx', 'Post Effects', ['off', 'light', 'full'])}
        ${toggle('ao', 'Ambient Occlusion')}
        <div class="sec">WORLD</div>
        ${choice('timeOfDay', 'Time of Day', ['day', 'dusk', 'night'])}
        ${choice('weather', 'Weather', ['clear', 'rain'])}
        ${toggle('antialias', 'Anti-Aliasing')}
        <div class="lvlhint">Anti-aliasing is fixed when the page loads &mdash; reload to apply.</div>
        <div class="sec">CROSSHAIR</div>
        ${slider('crosshairSize', 'Crosshair Size', 0.5, 2, 0.1, (v) => v.toFixed(1) + 'x')}
        <div class="opt row-between">
          <span>Crosshair Colour</span>
          <div class="swatches">
            ${['#7fe9c4', '#ffffff', '#ff4d3d', '#ffd24a', '#63d8ff'].map((c) =>
              `<button class="sw ${s.crosshairColour === c ? 'on' : ''}"
                 style="background:${c}" data-colour="${c}"></button>`).join('')}
          </div>
        </div>
        <div class="row">
          <button class="btn" data-a="defaults">Reset Defaults</button>
          <button class="btn primary" data-a="${fromPause ? 'back-pause' : 'back'}">Done</button>
        </div>
      </div>`);
  }

  pausePanel() {
    const g = this.game;
    return this.el(`
      <div class="panel fade">
        <div class="h1">PAUSED</div>
        <div class="sub">${g.mode === MODE.TIME ? 'TIME ATTACK' : 'SURVIVAL'} &middot;
          WAVE ${g.wave} &middot; ${fmt(g.score)} PTS</div>
        <button class="btn primary" data-a="resume">Resume</button>
        <button class="btn" data-a="settings-pause">Settings</button>
        <button class="btn" data-a="restart">Restart</button>
        <button class="btn ghost" data-a="quit">Main Menu</button>
      </div>`);
  }

  completePanel() {
    const g = this.game, S = g.stats;
    const acc = Math.round(g.accuracy * 100);
    return this.el(`
      <div class="panel wide fade">
        <div class="dead" style="color:var(--teal)">MISSION COMPLETE</div>
        <div class="sub">THE SIGNAL &middot; ${(g.difficulty || 'normal').toUpperCase()}</div>
        <div class="grid4">
          <div class="stat"><div class="k">Time</div><div class="v">${clock(S.time || 0)}</div></div>
          <div class="stat"><div class="k">Kills</div><div class="v">${g.kills}</div></div>
          <div class="stat"><div class="k">Headshots</div><div class="v">${g.headshots}</div></div>
          <div class="stat"><div class="k">Accuracy</div><div class="v">${acc}%</div></div>
          <div class="stat"><div class="k">Longest kill</div><div class="v">${Math.round(S.longestKill)} m</div></div>
          <div class="stat"><div class="k">Damage taken</div><div class="v">${Math.round(S.damageTaken)}</div></div>
          <div class="stat"><div class="k">Checkpoint reloads</div><div class="v">${S.downs}</div></div>
          <div class="stat"><div class="k">Score</div><div class="v">${fmt(g.score)}</div></div>
        </div>
        <div class="xpline">+${g.runXp + 250} XP &middot; Level ${this.prog.level}</div>
        <button class="btn primary" data-a="restart">Play Again</button>
        <button class="btn ghost" data-a="quit">Main Menu</button>
      </div>`);
  }

  overPanel() {
    const g = this.game;
    if (g.won) return this.completePanel();
    const acc = Math.round(g.accuracy * 100);
    const best = g.mode === MODE.TIME ? this.prog.bestTimeAttack : this.prog.bestScore;
    const isBest = g.score >= best && g.score > 0;
    return this.el(`
      <div class="panel wide fade">
        <div class="dead">${g.mode === MODE.TIME ? 'TIME UP' : 'KILLED IN ACTION'}</div>
        <div class="bigscore">${fmt(g.score)}</div>
        ${isBest ? '<div class="best">NEW PERSONAL BEST</div>' : `<div class="sub">BEST ${fmt(best)}</div>`}
        <div class="grid4">
          <div class="stat"><div class="k">Kills</div><div class="v">${g.kills}</div></div>
          <div class="stat"><div class="k">Headshots</div><div class="v">${g.headshots}</div></div>
          <div class="stat"><div class="k">Accuracy</div><div class="v">${acc}%</div></div>
          <div class="stat"><div class="k">${g.mode === MODE.TIME ? 'Survived' : 'Wave'}</div>
            <div class="v">${g.mode === MODE.TIME ? clock(CFG.timeAttack.duration) : g.wave}</div></div>
        </div>
        <div class="xpline">+${g.runXp} XP &middot; Level ${this.prog.level}
          &middot; ${this.prog.xpIntoLevel}/${this.prog.xpNeeded}</div>
        <div class="bar"><i style="width:${Math.round((this.prog.xpIntoLevel / this.prog.xpNeeded) * 100)}%"></i></div>
        <button class="btn primary" data-a="restart">Redeploy</button>
        <div class="row">
          <button class="btn" data-a="loadout-over">Loadout${this.prog.points ? ` <em>${this.prog.points}</em>` : ''}</button>
          <button class="btn ghost" data-a="quit">Main Menu</button>
        </div>
      </div>`);
  }

  setObjective(stage, i, n, first) {
    if (!stage) { this.objBox.classList.add('hidden'); return; }
    if (!first && this._lastObjId !== stage.id) this.objectivePop(stage.text);
    this._lastObjId = stage.id;
    this.objText.textContent = stage.text;
    this.objHint.textContent = (stage.hint || '') + '   ' + (i + 1) + '/' + n;
    this.objBox.classList.remove('hidden');
  }

  objectivePop(text) {
    const el = $('objpop');
    el.children[1].textContent = text;
    el.classList.add('show');
    audio.sfx.waveClear();
    clearTimeout(this._popT);
    this._popT = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // A soldier's callout: who, what, and which way he is.
  comms(c) {
    const box = $('comms');
    const r = c.rel;
    const arrow = Math.abs(r.right) < Math.abs(r.ahead) * 0.4 ? (r.ahead > 0 ? '&#9650;' : '&#9660;') : r.right > 0 ? '&#9654;' : '&#9664;';
    const row = document.createElement('div');
    row.innerHTML = `<i>${arrow}</i><em>${c.name}</em>&ldquo;${c.text}&rdquo;`;
    box.appendChild(row);
    setTimeout(() => row.classList.add('out'), 2600);
    setTimeout(() => row.remove(), 3100);
    while (box.children.length > 3) box.firstChild.remove();
  }

  setPrompt(text, locked) {
    if (text === this._promptShown && !!locked === !!this._promptLocked) return;
    this._promptShown = text;
    this._promptLocked = !!locked;
    // The USE button mirrors the prompt: present only when something is in
    // reach, labelled with the action, red when it needs a keycard.
    if (this.useBtn) {
      this.useBtn.classList.toggle('show', !!text);
      this.useBtn.classList.toggle('locked', !!locked);
      if (text) this.useBtn.textContent = locked ? 'LOCKED' : shortVerb(text);
    }
    if (!text) { this.promptBox.classList.add('hidden'); return; }
    this.promptText.textContent = text;
    this.promptBox.classList.toggle('locked', !!locked);
    this.promptBox.classList.remove('hidden');
  }

  showLog(entry) {
    if (!entry) return;
    this.logTitle.textContent = entry.title || '';
    this.logLines.innerHTML = (entry.lines || []).map((l) => '<div></div>').join('');
    [...this.logLines.children].forEach((d, i) => { d.textContent = entry.lines[i]; });
    this.logBox.classList.remove('hidden');
    // Long enough to read, short enough not to stall the player.
    this.logT = 3.2 + (entry.lines || []).length * 1.5;
  }

  // ---------------- wiring ----------------

  wire(scope) {
    const g = this.game;

    scope.querySelectorAll('[data-a]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.unlock();
        const a = b.dataset.a;
        audio.sfx[a === 'back' || a === 'quit' ? 'uiBack' : 'ui']();
        switch (a) {
          case 'play-campaign':
            goFullscreen();
            this.panel = 'main';
            g.difficulty = this.difficulty || 'normal';
            g.start(MODE.CAMPAIGN); audio.startAmbience(); break;
          case 'diff-easy': this.difficulty = 'easy'; this.go('main'); break;
          case 'diff-normal': this.difficulty = 'normal'; this.go('main'); break;
          case 'diff-hard': this.difficulty = 'hard'; this.go('main'); break;
          case 'play-survival': goFullscreen(); this.panel = 'main'; g.start(MODE.SURVIVAL); audio.startAmbience(); break;
          case 'play-time': goFullscreen(); this.panel = 'main'; g.start(MODE.TIME); audio.startAmbience(); break;
          case 'loadout': this.go('loadout'); break;
          case 'loadout-over': this.go('loadout'); break;
          case 'settings': this.go('settings'); break;
          case 'settings-pause': this.go('settings'); break;
          case 'back': this.go('main'); break;
          case 'back-pause': this.go('main'); break;
          case 'resume': this.panel = 'main'; g.resume(); break;
          case 'restart': this.panel = 'main'; g.start(g.mode); break;
          case 'quit': this.panel = 'main'; g.toMenu(); break;
          case 'defaults': settings.reset(); g.applySettings(); this.render(g.state); break;
          case 'inv-on': g.weapons.mount(b.dataset.id, b.dataset.k); this.render(g.state); break;
          case 'inv-off': g.weapons.unmount(b.dataset.id, b.dataset.slot); this.render(g.state); break;
          case 'inv-plate': this.panel = 'main'; g.resume(); g.gear.usePlate(); break;
          case 'inv-med': this.panel = 'main'; g.resume(); g.gear.useMedkit(); break;
          case 'inv-frag': this.panel = 'main'; g.resume(); g.gear.throw('frag'); break;
          case 'inv-smoke': this.panel = 'main'; g.resume(); g.gear.throw('smoke'); break;
          case 'inv-flash': this.panel = 'main'; g.resume(); g.gear.throw('flash'); break;
          case 'equip':
            g.weapons.switchTo(b.dataset.id, true);
            this.render(g.state);
            break;
          case 'buy':
            if (this.prog.buy(b.dataset.id)) {
              audio.sfx.levelUp();
              g.weapons.resetAll();
              this.render(g.state);
            }
            break;
        }
      });
    });

    // sliders write straight through to persisted settings
    scope.querySelectorAll('input[type=range][data-set]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.set;
        const val = parseFloat(inp.value);
        settings.set(key, val);
        const label = $('v-' + key);
        if (label) {
          if (key === 'fov') label.innerHTML = Math.round(val) + '&deg;';
          else if (key === 'sensitivity') label.textContent = val.toFixed(2) + 'x';
          else if (key === 'crosshairSize') label.textContent = val.toFixed(1) + 'x';
          else label.textContent = Math.round(val * 100) + '%';
        }
        g.applySettings();
        this.applyCrosshair();
      });
    });

    scope.querySelectorAll('[data-toggle]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = b.dataset.toggle;
        const v = !settings.get(key);
        settings.set(key, v);
        b.classList.toggle('on', v);
        b.textContent = v ? 'On' : 'Off';
        audio.sfx.ui();
        g.applySettings();
        this.applyCrosshair();
      });
    });

    scope.querySelectorAll('[data-preset]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = b.dataset.preset;
        if (name === 'auto') settings.set('quality', 'auto');
        else settings.applyPreset(name);
        audio.sfx.ui();
        g.applySettings();
        this.render(g.state);          // redraw so the knobs show the new values
      });
    });

    scope.querySelectorAll('[data-choice]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = b.dataset.choice;
        settings.set(key, b.dataset.val);
        b.parentElement.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        audio.sfx.ui();
        g.applySettings();
        this.render(g.state);
      });
    });

    scope.querySelectorAll('[data-colour]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.set('crosshairColour', b.dataset.colour);
        b.parentElement.querySelectorAll('.sw').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        this.applyCrosshair();
        audio.sfx.ui();
      });
    });
  }
}
