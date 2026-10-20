import * as settings from './settings.js';

// Fully procedural audio. No sample files, so nothing to license and nothing to
// download. Each weapon gets its own report built from three layers: a
// highpassed transient (the crack), a lowpass-swept noise body (the boom), and
// a delayed slap-back standing in for the room.
//
// Structured so royalty-free samples can replace any single entry later without
// touching call sites.

let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null, ready = false;
// Everything in the world goes through `muffle` on its way out, so a
// flashbang can dull the whole mix and let it come back.
let muffle = null;
// While a positional sound is being built, its tone/noise layers route here.
let curBus = null;

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  master.connect(ctx.destination);
  muffle = ctx.createBiquadFilter();
  muffle.type = 'lowpass'; muffle.frequency.value = 22000; muffle.Q.value = 0.5;
  sfxBus.connect(muffle); muffle.connect(master);
  musicBus.connect(master);
  applyVolumes();

  const n = Math.floor(ctx.sampleRate * 1.5);
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  ready = true;
}

export function applyVolumes() {
  if (!master) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.get('masterVol'), t, 0.02);
  sfxBus.gain.setTargetAtTime(settings.get('sfxVol'), t, 0.02);
  musicBus.gain.setTargetAtTime(settings.get('musicVol'), t, 0.02);
}
settings.onChange(applyVolumes);

// A gain ramp to exactly 0 throws, and a throw inside the frame loop drops the
// rest of that frame. Distance-scaled calls reach 0 out of earshot.
function noise({ dur, vol, type = 'lowpass', f0, f1, q = 1, delay = 0, bus }) {
  if (!ready || !(vol > 0.0005)) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const filt = ctx.createBiquadFilter();
  filt.type = type; filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt); filt.connect(g); g.connect(bus || curBus || sfxBus);
  src.start(t); src.stop(t + dur + 0.03);
}

function tone({ type = 'sine', f0, f1, dur, vol, delay = 0, bus }) {
  if (!ready || !(vol > 0.0005)) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus || curBus || sfxBus);
  o.start(t); o.stop(t + dur + 0.02);
}

// Per-weapon reports. Bigger calibre means more low end and a longer tail.
const GUNS = {
  rifle() {
    noise({ dur: 0.042, vol: 0.50, type: 'highpass', f0: 2600, f1: 5200, q: 0.6 });
    noise({ dur: 0.15, vol: 0.70, type: 'lowpass', f0: 3400, f1: 260, q: 1.2 });
    tone({ type: 'sine', f0: 130, f1: 48, dur: 0.12, vol: 0.38 });
    noise({ dur: 0.28, vol: 0.14, type: 'lowpass', f0: 1500, f1: 300, q: 0.8, delay: 0.05 });
  },
  smg() {
    noise({ dur: 0.030, vol: 0.38, type: 'highpass', f0: 3000, f1: 5600, q: 0.6 });
    noise({ dur: 0.10, vol: 0.52, type: 'lowpass', f0: 3800, f1: 400, q: 1.1 });
    tone({ type: 'sine', f0: 165, f1: 70, dur: 0.08, vol: 0.24 });
  },
  shotgun() {
    noise({ dur: 0.06, vol: 0.62, type: 'highpass', f0: 1800, f1: 3600, q: 0.5 });
    noise({ dur: 0.34, vol: 0.85, type: 'lowpass', f0: 2600, f1: 120, q: 1.3 });
    tone({ type: 'sine', f0: 92, f1: 34, dur: 0.28, vol: 0.52 });
    noise({ dur: 0.55, vol: 0.20, type: 'lowpass', f0: 900, f1: 160, q: 0.7, delay: 0.08 });
  },
  sniper() {
    noise({ dur: 0.05, vol: 0.70, type: 'highpass', f0: 3200, f1: 7000, q: 0.5 });
    noise({ dur: 0.42, vol: 0.80, type: 'lowpass', f0: 3200, f1: 110, q: 1.4 });
    tone({ type: 'sine', f0: 78, f1: 28, dur: 0.36, vol: 0.55 });
    noise({ dur: 0.85, vol: 0.22, type: 'lowpass', f0: 1100, f1: 130, q: 0.7, delay: 0.10 });
    noise({ dur: 1.1, vol: 0.10, type: 'lowpass', f0: 700, f1: 100, q: 0.6, delay: 0.26 });
  },
};

export const sfx = {
  // A suppressed shot is a dull cough, not silence: still audible close by.
  shot(id, suppressed) {
    if (!suppressed) { (GUNS[id] || GUNS.rifle)(); return; }
    noise({ dur: 0.09, vol: 0.16, type: 'lowpass', f0: 1400, f1: 300, q: 0.8 });
    noise({ dur: 0.03, vol: 0.06, type: 'highpass', f0: 3200, q: 0.7 });
  },
  pickup() { tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.07, vol: 0.1 }); noise({ dur: 0.05, vol: 0.06, type: 'bandpass', f0: 1800, q: 1.2 }); },
  plate() { noise({ dur: 0.18, vol: 0.14, type: 'bandpass', f0: 900, f1: 500, q: 1.4 }); tone({ type: 'square', f0: 140, f1: 110, dur: 0.1, vol: 0.05, delay: 0.15 }); },
  medkit() { noise({ dur: 0.35, vol: 0.08, type: 'highpass', f0: 2500, f1: 1800, q: 0.7 }); tone({ type: 'sine', f0: 660, f1: 880, dur: 0.18, vol: 0.06, delay: 0.3 }); },
  pin() { tone({ type: 'triangle', f0: 2400, f1: 2000, dur: 0.05, vol: 0.07 }); noise({ dur: 0.06, vol: 0.05, type: 'highpass', f0: 4000, q: 1 }); },
  throwIt() { noise({ dur: 0.12, vol: 0.07, type: 'bandpass', f0: 700, f1: 300, q: 0.7 }); },
  bounce(vol = 1) { tone({ type: 'triangle', f0: 900, f1: 600, dur: 0.06, vol: 0.06 * vol }); },
  zero() { tone({ type: 'square', f0: 1800, f1: 1700, dur: 0.025, vol: 0.05 }); },
  dryFire() {
    noise({ dur: 0.03, vol: 0.26, type: 'highpass', f0: 3200, q: 1.5 });
    tone({ type: 'square', f0: 900, f1: 300, dur: 0.025, vol: 0.10 });
  },
  hit() { tone({ type: 'square', f0: 1500, f1: 1150, dur: 0.035, vol: 0.15 }); },
  headshot() {
    tone({ type: 'square', f0: 1950, f1: 1950, dur: 0.045, vol: 0.16 });
    tone({ type: 'square', f0: 2700, f1: 2700, dur: 0.07, vol: 0.13, delay: 0.045 });
  },
  impact() { noise({ dur: 0.09, vol: 0.16, type: 'lowpass', f0: 2200, f1: 400, q: 1 }); },
  // Ricochet ping off steel: a short bright ring over the noise burst.
  impactMetal() {
    noise({ dur: 0.05, vol: 0.12, type: 'highpass', f0: 3000, f1: 1800, q: 2 });
    tone({ type: 'triangle', f0: 2600 + Math.random() * 900, f1: 1900, dur: 0.09, vol: 0.06 });
  },
  impactGlass() {
    noise({ dur: 0.12, vol: 0.13, type: 'highpass', f0: 5200, f1: 2600, q: 1.5 });
    tone({ type: 'sine', f0: 3800, f1: 3200, dur: 0.06, vol: 0.05 });
  },
  // Kill confirm: distinct from the hit tick, so a kill is obvious without
  // looking. A headshot adds a higher second note.
  killConfirm(head) {
    tone({ type: 'square', f0: 900, f1: 900, dur: 0.05, vol: 0.13 });
    setTimeout(() => tone({ type: 'square', f0: head ? 1750 : 1350, f1: head ? 1750 : 1350, dur: 0.07, vol: 0.13 }), 55);
  },
  nearMiss() {
    noise({ dur: 0.10, vol: 0.13, type: 'bandpass', f0: 2600, f1: 900, q: 6 });
  },
  robotDeath() {
    noise({ dur: 0.34, vol: 0.34, type: 'lowpass', f0: 2400, f1: 140, q: 1.1 });
    tone({ type: 'sawtooth', f0: 420, f1: 60, dur: 0.30, vol: 0.20 });
    tone({ type: 'square', f0: 1400, f1: 200, dur: 0.14, vol: 0.09 });
  },
  hurt() {
    noise({ dur: 0.26, vol: 0.30, type: 'lowpass', f0: 700, f1: 110, q: 1.1 });
    tone({ type: 'sine', f0: 92, f1: 40, dur: 0.28, vol: 0.24 });
  },
  reload(total) {
    noise({ dur: 0.05, vol: 0.26, type: 'highpass', f0: 1800, q: 1.2, delay: total * 0.10 });
    noise({ dur: 0.07, vol: 0.32, type: 'lowpass', f0: 1400, f1: 400, q: 1.4, delay: total * 0.55 });
    tone({ type: 'square', f0: 420, f1: 190, dur: 0.05, vol: 0.12, delay: total * 0.55 });
    noise({ dur: 0.06, vol: 0.34, type: 'highpass', f0: 2400, q: 1.6, delay: total * 0.86 });
    tone({ type: 'square', f0: 800, f1: 320, dur: 0.04, vol: 0.13, delay: total * 0.86 });
  },
  swap() {
    noise({ dur: 0.05, vol: 0.20, type: 'highpass', f0: 2200, q: 1.2 });
    tone({ type: 'square', f0: 520, f1: 780, dur: 0.06, vol: 0.10, delay: 0.16 });
  },
  // Footsteps by what is underfoot. `stance` quietens crouched and crawling
  // steps; `wet` adds a splash on top of whatever the surface is.
  footstep(sprint, surface = 'concrete', stance = 'walk', wet = false) {
    const v = (sprint ? 0.14 : 0.09) * (stance === 'crouch' ? 0.5 : stance === 'crawl' ? 0.3 : 1);
    if (stance === 'crawl') {
      noise({ dur: 0.22, vol: v * 0.9, type: 'bandpass', f0: 700, f1: 400, q: 0.7 });
    } else if (surface === 'grass') {
      noise({ dur: 0.13, vol: v * 0.8, type: 'bandpass', f0: 900, f1: 500, q: 0.6 });
      noise({ dur: 0.05, vol: v * 0.25, type: 'highpass', f0: 3500, q: 0.6 });
    } else if (surface === 'gravel') {
      for (let i = 0; i < 4; i++) noise({ dur: 0.03 + Math.random() * 0.03, vol: v * 0.55, type: 'bandpass', f0: 1800 + Math.random() * 1800, f1: 1200, q: 2.2, delay: i * 0.018 });
    } else if (surface === 'wood') {
      tone({ type: 'triangle', f0: 190, f1: 120, dur: 0.07, vol: v * 0.9 });
      noise({ dur: 0.05, vol: v * 0.5, type: 'lowpass', f0: 900, f1: 300, q: 1.2 });
    } else if (surface === 'metal') {
      tone({ type: 'square', f0: 430, f1: 380, dur: 0.12, vol: v * 0.22 });
      noise({ dur: 0.06, vol: v * 0.6, type: 'highpass', f0: 2400, q: 1.5 });
    } else {
      // concrete, asphalt, paving: a dull thump and a crisp scuff
      const bright = surface === 'paving' ? 1.25 : surface === 'asphalt' ? 0.85 : 1;
      noise({ dur: 0.07, vol: v, type: 'lowpass', f0: 1100 * bright, f1: 240, q: 1.1 });
      noise({ dur: 0.04, vol: v * 0.5, type: 'highpass', f0: 2800 * bright, q: 0.8 });
    }
    if (wet && stance !== 'crawl') noise({ dur: 0.09, vol: v * 0.7, type: 'highpass', f0: 2200, f1: 1200, q: 0.9, delay: 0.01 });
  },
  slide() { noise({ dur: 0.55, vol: 0.12, type: 'bandpass', f0: 1200, f1: 500, q: 0.6 }); },
  mantle() {
    noise({ dur: 0.12, vol: 0.1, type: 'lowpass', f0: 900, f1: 300, q: 1 });
    noise({ dur: 0.18, vol: 0.06, type: 'bandpass', f0: 1500, f1: 800, q: 0.8, delay: 0.12 });
  },
  jump() { noise({ dur: 0.05, vol: 0.09, type: 'lowpass', f0: 900, f1: 300, q: 1 }); },
  land() {
    noise({ dur: 0.12, vol: 0.20, type: 'lowpass', f0: 800, f1: 150, q: 1.2 });
    tone({ type: 'sine', f0: 90, f1: 45, dur: 0.10, vol: 0.14 });
  },
  waveStart() {
    tone({ type: 'sawtooth', f0: 84, f1: 62, dur: 0.9, vol: 0.20 });
    tone({ type: 'sine', f0: 168, f1: 124, dur: 0.9, vol: 0.10 });
    noise({ dur: 0.7, vol: 0.07, type: 'bandpass', f0: 400, f1: 180, q: 3 });
  },
  waveClear() {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ type: 'triangle', f0: f, f1: f, dur: 0.20, vol: 0.14, delay: i * 0.08 }));
  },
  combo(mult) {
    const base = 520 + mult * 90;
    tone({ type: 'triangle', f0: base, f1: base * 1.5, dur: 0.13, vol: 0.14 });
  },
  levelUp() {
    [392, 523, 659, 784, 1046].forEach((f, i) =>
      tone({ type: 'triangle', f0: f, f1: f, dur: 0.24, vol: 0.15, delay: i * 0.09 }));
  },
  ui() { tone({ type: 'triangle', f0: 620, f1: 930, dur: 0.055, vol: 0.12 }); },
  uiBack() { tone({ type: 'triangle', f0: 620, f1: 380, dur: 0.06, vol: 0.11 }); },
  gameOver() {
    tone({ type: 'sawtooth', f0: 220, f1: 52, dur: 1.4, vol: 0.24 });
    noise({ dur: 1.0, vol: 0.15, type: 'lowpass', f0: 900, f1: 90, q: 0.8 });
  },
};

// ---- town sounds ----
// `vol` scales with distance at the call site (0..1).
export const townSfx = {
  carAlarm(vol = 1) {
    // two-tone whoop, eight seconds, scheduled in one go
    for (let i = 0; i < 16; i++) {
      tone({ type: 'square', f0: i % 2 ? 980 : 760, f1: i % 2 ? 760 : 980, dur: 0.45, vol: 0.05 * vol, delay: i * 0.5 });
    }
  },
  explosion(vol = 1) {
    noise({ dur: 1.6, vol: 0.55 * vol, type: 'lowpass', f0: 900, f1: 60, q: 0.7 });
    noise({ dur: 0.3, vol: 0.35 * vol, type: 'highpass', f0: 1800, f1: 600, q: 0.7 });
    tone({ type: 'sine', f0: 70, f1: 28, dur: 1.2, vol: 0.45 * vol });
  },
  spark(vol = 1) {
    for (let i = 0; i < 4; i++) noise({ dur: 0.05 + Math.random() * 0.06, vol: 0.12 * vol, type: 'highpass', f0: 3000, f1: 1500, q: 2, delay: i * 0.05 });
    tone({ type: 'sawtooth', f0: 120, f1: 118, dur: 0.25, vol: 0.03 * vol });
  },
  birds(vol = 1) {
    for (let i = 0; i < 9; i++) tone({ type: 'sine', f0: 2600 + Math.random() * 1200, f1: 1800 + Math.random() * 900, dur: 0.08, vol: 0.04 * vol, delay: Math.random() * 0.9 });
    for (let i = 0; i < 6; i++) noise({ dur: 0.06, vol: 0.05 * vol, type: 'bandpass', f0: 900, f1: 700, q: 1.5, delay: i * 0.07 });
  },
  glassShatter(vol = 1) {
    for (let i = 0; i < 7; i++) tone({ type: 'triangle', f0: 3000 + Math.random() * 3000, f1: 1500, dur: 0.12 + Math.random() * 0.2, vol: 0.06 * vol, delay: Math.random() * 0.25 });
    noise({ dur: 0.35, vol: 0.2 * vol, type: 'highpass', f0: 4000, f1: 2000, q: 0.8 });
  },
  fireCrackle(vol = 1) {
    noise({ dur: 0.06, vol: 0.08 * vol, type: 'bandpass', f0: 1400 + Math.random() * 1600, f1: 900, q: 3 });
  },
};

// Rain: a looping filtered noise bed, faded in and out.
let rainSrc = null, rainGain = null;
export function setRain(on) {
  if (!ready) return;
  if (on && !rainSrc) {
    rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuf; rainSrc.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.4;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(f); f.connect(rainGain); rainGain.connect(sfxBus);
    rainSrc.start();
    rainGain.gain.setTargetAtTime(0.09, ctx.currentTime, 1.2);
  } else if (!on && rainSrc) {
    const src = rainSrc;
    rainGain.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
    setTimeout(() => { try { src.stop(); } catch (e) { /* already stopped */ } }, 3000);
    rainSrc = null;
  }
}
// Muffle the rain indoors.
export function rainLevel(v) { if (rainGain && ctx) rainGain.gain.setTargetAtTime(0.09 * v, ctx.currentTime, 0.3); }

// ---- ambience: a slow industrial drone on the music bus ----
let droneTimer = null;
export function startAmbience() {
  if (!ready || droneTimer) return;
  const beat = () => {
    tone({ type: 'sine', f0: 55, f1: 48, dur: 2.6, vol: 0.16, bus: musicBus });
    tone({ type: 'sine', f0: 82.4, f1: 78, dur: 2.2, vol: 0.08, bus: musicBus });
    noise({ dur: 2.0, vol: 0.02, type: 'lowpass', f0: 320, f1: 140, q: 0.6, bus: musicBus });
  };
  beat();
  droneTimer = setInterval(beat, 2800);
}
export function stopAmbience() {
  if (droneTimer) { clearInterval(droneTimer); droneTimer = null; }
}

// ---------------------------------------------------------------- 3D audio --
//
// World sounds are placed with a PannerNode (HRTF on desktop, cheaper
// equal-power on phones) so direction and distance can be heard: gunfire,
// footsteps, voices, explosions, impacts. Far sounds also lose their top end
// through a lowpass, which is most of what makes a shot sound distant.
// The listener follows the camera every frame.

const TOUCH = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
let active = 0;
const listenerPos = { x: 0, y: 0, z: 0 }, listenerFwd = { x: 0, y: 0, z: -1 }, listenerUp = { x: 0, y: 1, z: 0 };
// The last few positional events, for tools/presenttest.js.
export const spatialLog = [];
let spatialSeq = 0;

export function setListener(pos, fwd, up) {
  listenerPos.x = pos.x; listenerPos.y = pos.y; listenerPos.z = pos.z;
  listenerFwd.x = fwd.x; listenerFwd.y = fwd.y; listenerFwd.z = fwd.z;
  listenerUp.x = up.x; listenerUp.y = up.y; listenerUp.z = up.z;
  if (!ready) return;
  const L = ctx.listener, t = ctx.currentTime;
  if (L.positionX) {
    L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
    L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
    L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
  } else {
    L.setPosition(pos.x, pos.y, pos.z);
    L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
  }
}

// Where a world position sits relative to the listener: x right, y up,
// z ahead, plus the distance. Used by the log and by the screen effects.
export function toListener(x, y, z) {
  const dx = x - listenerPos.x, dy = y - listenerPos.y, dz = z - listenerPos.z;
  const f = listenerFwd, u = listenerUp;
  // right = forward x up
  const rx = f.y * u.z - f.z * u.y, ry = f.z * u.x - f.x * u.z, rz = f.x * u.y - f.y * u.x;
  return { right: dx * rx + dy * ry + dz * rz, up: dx * u.x + dy * u.y + dz * u.z, ahead: dx * f.x + dy * f.y + dz * f.z, dist: Math.hypot(dx, dy, dz) };
}

// Run `build` (which calls tone/noise) with its output placed at (x, y, z).
// `ref` is the distance at full volume, `roll` how fast it falls off.
function at(x, y, z, kind, build, { ref = 3, roll = 1, life = 1.5, far = 160 } = {}) {
  const rel = toListener(x, y, z);
  spatialLog.push({ seq: ++spatialSeq, kind, x, y, z, ...rel, t: ready ? ctx.currentTime : 0 });
  if (spatialLog.length > 40) spatialLog.shift();
  if (!ready || rel.dist > far) return;
  // a cap on simultaneous panners; past it only close sounds get through
  if (active > (TOUCH ? 14 : 28) && rel.dist > 25) return;
  const p = ctx.createPanner();
  p.panningModel = TOUCH ? 'equalpower' : 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 1000;
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else p.setPosition(x, y, z);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.max(900, 20000 * Math.exp(-rel.dist / 55));
  lp.connect(p); p.connect(sfxBus);
  active++;
  curBus = lp;
  try { build(); } finally { curBus = null; }
  setTimeout(() => { try { lp.disconnect(); p.disconnect(); } catch (e) { /* gone */ } active--; }, life * 1000);
}

// Formant voice: a buzzing glottal source through vowel resonances, one
// syllable per entry, with a consonant burst in front. Not words -- a shouted
// bark with the rhythm and pitch of the callout; the text says the words.
const VOWEL = { a: [800, 1200, 2500], e: [500, 1850, 2500], i: [320, 2300, 3000], o: [500, 900, 2400], u: [350, 800, 2300] };
const CALLOUTS = {
  contact: ['ko', 'ta'], reloading: ['ri', 'lo', 'di'], manDown: ['ma', 'do'],
  grenade: ['ge', 'ne'], flash: ['fa', 'ba'], search: ['we', 'i', 'hi'], moving: ['mu', 'vi'],
};
function syllable(t0, pitch, vow, cons, vol) {
  const t = ctx.currentTime + t0;
  const dur = 0.16;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(pitch * 1.12, t);
  o.frequency.exponentialRampToValueAtTime(pitch * 0.9, t + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  env.gain.setValueAtTime(vol, t + dur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(env);
  const F = VOWEL[vow] || VOWEL.a;
  [1, 0.55, 0.25].forEach((gv, k) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = F[k]; bp.Q.value = 7;
    const g = ctx.createGain(); g.gain.value = gv * 2.4;
    env.connect(bp); bp.connect(g); g.connect(curBus || sfxBus);
  });
  o.start(t); o.stop(t + dur + 0.02);
  if (cons && 'ktgpbdf'.includes(cons)) noise({ dur: 0.035, vol: vol * 0.5, type: 'highpass', f0: cons === 'f' ? 2800 : 1800, q: 0.8, delay: t0 - 0.02 });
}

export const spatial = {
  // Enemy gunfire, by weapon class. Loud and carrying.
  shot(x, y, z, cls = 'rifle') {
    at(x, y, z, 'shot', () => (GUNS[cls] || GUNS.rifle)(), { ref: 6, roll: 0.55, life: 1.6, far: 400 });
  },
  // The crack of a round passing close by, placed where it passed.
  whiz(x, y, z) {
    at(x, y, z, 'whiz', () => {
      noise({ dur: 0.07, vol: 0.32, type: 'bandpass', f0: 3400, f1: 1200, q: 4 });
      noise({ dur: 0.02, vol: 0.25, type: 'highpass', f0: 5000, q: 0.7 });
    }, { ref: 1.5, roll: 1, life: 0.6 });
  },
  step(x, y, z, surface, vol = 1) {
    at(x, y, z, 'step', () => sfx.footstep(vol > 1, surface, 'walk'), { ref: 2, roll: 1.4, life: 0.6, far: 40 });
  },
  voice(x, y, z, kind, pitch = 120) {
    const syl = CALLOUTS[kind] || CALLOUTS.contact;
    at(x, y, z, 'voice:' + kind, () => {
      syl.forEach((sy, i) => {
        const vow = sy[sy.length - 1], cons = sy.length > 1 ? sy[0] : null;
        syllable(i * 0.19, pitch * (i === syl.length - 1 ? 0.92 : 1.05), vow, cons, 0.22);
      });
    }, { ref: 4, roll: 0.8, life: 1.4, far: 90 });
  },
  death(x, y, z) { at(x, y, z, 'death', () => sfx.robotDeath(), { ref: 4, roll: 0.9 }); },
  impact(x, y, z, kind) {
    at(x, y, z, 'impact', () => (kind === 'metal' ? sfx.impactMetal() : kind === 'glass' ? sfx.impactGlass() : sfx.impact()), { ref: 3, roll: 1, life: 0.6, far: 80 });
  },
  explosion(x, y, z) { at(x, y, z, 'explosion', () => townSfx.explosion(1), { ref: 10, roll: 0.5, life: 2.2, far: 600 }); },
  bang(x, y, z) {
    at(x, y, z, 'bang', () => {
      noise({ dur: 0.5, vol: 0.9, type: 'highpass', f0: 1200, f1: 400, q: 0.5 });
      noise({ dur: 0.9, vol: 0.5, type: 'lowpass', f0: 1600, f1: 120, q: 0.7 });
      tone({ type: 'sine', f0: 90, f1: 40, dur: 0.5, vol: 0.4 });
    }, { ref: 8, roll: 0.5, life: 1.6, far: 400 });
  },
  bounce(x, y, z, vol = 1) { at(x, y, z, 'bounce', () => sfx.bounce(vol), { ref: 2, roll: 1, life: 0.4, far: 40 }); },
  glass(x, y, z) { at(x, y, z, 'glass', () => townSfx.glassShatter(1), { ref: 5, roll: 0.8, life: 1 }); },
  alarm(x, y, z) { at(x, y, z, 'alarm', () => townSfx.carAlarm(1), { ref: 6, roll: 0.7, life: 8.5, far: 200 }); },
};

// Flashbang ears: the world goes dull and a tone rings, then both recover.
export function deafen(amount, seconds) {
  if (!ready || !(amount > 0.02)) return;
  const t = ctx.currentTime;
  muffle.frequency.cancelScheduledValues(t);
  muffle.frequency.setValueAtTime(Math.max(350, 22000 * (1 - amount * 0.985)), t);
  muffle.frequency.setTargetAtTime(22000, t + seconds * 0.4, seconds * 0.35);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = 3600;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09 * amount, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + seconds + 0.05);
}
