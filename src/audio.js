import * as settings from './settings.js';

// Fully procedural audio. No sample files, so nothing to license and nothing to
// download. Each weapon gets its own report built from three layers: a
// highpassed transient (the crack), a lowpass-swept noise body (the boom), and
// a delayed slap-back standing in for the room.
//
// Structured so royalty-free samples can replace any single entry later without
// touching call sites.

let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null, ready = false;

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  master.connect(ctx.destination);
  sfxBus.connect(master);
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

function noise({ dur, vol, type = 'lowpass', f0, f1, q = 1, delay = 0, bus }) {
  if (!ready) return;
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
  src.connect(filt); filt.connect(g); g.connect(bus || sfxBus);
  src.start(t); src.stop(t + dur + 0.03);
}

function tone({ type = 'sine', f0, f1, dur, vol, delay = 0, bus }) {
  if (!ready) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus || sfxBus);
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
  shot(id) { (GUNS[id] || GUNS.rifle)(); },
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
  footstep(sprint) {
    const v = sprint ? 0.14 : 0.09;
    noise({ dur: 0.07, vol: v, type: 'lowpass', f0: 1100, f1: 240, q: 1.1 });
    noise({ dur: 0.04, vol: v * 0.5, type: 'highpass', f0: 2800, q: 0.8 });
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
