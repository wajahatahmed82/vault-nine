import * as THREE from 'three';
import { CFG } from './config.js';
import { STATE, MODE } from './game.js';
import { UPGRADES, MAX_RANK } from './progression.js';
import * as audio from './audio.js';
import * as settings from './settings.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString();
const clock = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return m + ':' + (r < 10 ? '0' : '') + r;
};

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

    game.onPrompt = (text, locked) => this.setPrompt(text, locked);
    game.onDown = () => this.banner('CHECKPOINT RELOADED');
    game.campaign.onObjective = (stage, i, n) => this.setObjective(stage, i, n);
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

    game.onHit = (part, pos, dmg) => this.hit(part, pos, dmg);
    game.onKill = (info) => this.kill(info);
    game.onWave = (n, x, cleared) => this.wave(n, x, cleared);
    game.onDamaged = () => { this.vignetteT = 0.7; };
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
      <span class="fn">${info.name}</span>${mult}`;
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

      if (g.mode === MODE.TIME) {
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
      $('scope').classList.toggle('on', w.ads > 0.75 && s.shape.optic === 'scope');

      const rl = $('reload-ring');
      if (w.reloading > 0) {
        rl.classList.add('show');
        rl.style.setProperty('--p', (1 - w.reloading / w.reloadTotal).toFixed(3));
      } else rl.classList.remove('show');

      // weapon slots
      for (const id of w.ids) {
        const el = $('slot-' + id);
        if (!el) continue;
        el.classList.toggle('active', w.current === id);
        el.classList.toggle('locked', !w.unlocked(id));
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
    if (this.panel === 'loadout') node = this.loadoutPanel();
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
        <div class="brand"><span>ROBOT</span><b>STRIKE</b></div>
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
          <b>WASD</b> move &middot; <b>Shift</b> sprint &middot; <b>Ctrl</b> crouch &middot; <b>Space</b> jump<br>
          <b>Mouse</b> aim &middot; <b>RMB</b> sights &middot; <b>R</b> reload &middot; <b>1-4</b> weapons &middot; <b>Esc</b> pause<br>
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

  overPanel() {
    const g = this.game;
    const acc = Math.round(g.accuracy * 100);
    const best = g.mode === MODE.TIME ? this.prog.bestTimeAttack : this.prog.bestScore;
    const isBest = g.score >= best && g.score > 0;
    return this.el(`
      <div class="panel wide fade">
        <div class="dead">${g.mode === MODE.TIME ? 'TIME UP' : 'SYSTEMS DOWN'}</div>
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

  setObjective(stage, i, n) {
    if (!stage) { this.objBox.classList.add('hidden'); return; }
    this.objText.textContent = stage.text;
    this.objHint.textContent = (stage.hint || '') + '   ' + (i + 1) + '/' + n;
    this.objBox.classList.remove('hidden');
  }

  setPrompt(text, locked) {
    if (text === this._promptShown) return;
    this._promptShown = text;
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
            this.panel = 'main';
            g.difficulty = this.difficulty || 'normal';
            g.start(MODE.CAMPAIGN); audio.startAmbience(); break;
          case 'diff-easy': this.difficulty = 'easy'; this.go('main'); break;
          case 'diff-normal': this.difficulty = 'normal'; this.go('main'); break;
          case 'diff-hard': this.difficulty = 'hard'; this.go('main'); break;
          case 'play-survival': this.panel = 'main'; g.start(MODE.SURVIVAL); audio.startAmbience(); break;
          case 'play-time': this.panel = 'main'; g.start(MODE.TIME); audio.startAmbience(); break;
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
