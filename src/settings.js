const KEY = 'robotstrike.settings.v1';

export const DEFAULTS = {
  masterVol: 0.8,
  musicVol: 0.5,
  sfxVol: 0.9,
  sensitivity: 1.0,       // multiplier on look speed
  fov: 74,
  quality: 'auto',        // auto | low | medium | high | ultra | custom
  // Individual knobs. Changing any of them switches quality to 'custom'.
  shadowQuality: 'medium',   // off | low | medium | high
  renderScale: 1.0,          // 0.5 .. 2.0
  effects: 'medium',         // low | medium | high  -- particle and spark budget
  viewDistance: 'medium',    // near | medium | far
  postFx: 'full',            // off | light (grade + FXAA) | full (+ bloom)
  ao: false,                 // ambient occlusion (HIGH / ULTRA)
  timeOfDay: 'dusk',         // day | dusk | night
  weather: 'clear',          // clear | rain
  antialias: false,          // needs a page reload; the context is fixed at boot
  vsync: true,            // when off, the frame limiter is removed
  crosshairSize: 1.0,
  crosshairColour: '#7fe9c4',
  showFps: false,
  damageNumbers: false,     // floating damage figures on hit
  invertY: false,
  // camera effects, each switchable
  fxSuppression: true,
  fxLowHealth: true,
  fxFlash: true,
  fxChroma: true,
  showHud: true,
};

let data = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function get(k) { return data[k]; }
export function all() { return { ...data }; }

const KNOBS = ['shadowQuality', 'renderScale', 'effects', 'viewDistance', 'antialias', 'postFx', 'ao'];

export function set(k, v) {
  data[k] = v;
  // Touching an individual knob means the preset no longer describes reality.
  if (KNOBS.includes(k) && data.quality !== 'custom') data.quality = 'custom';
  flush();
  listeners.forEach((fn) => fn(k, v));
}

// Presets write the individual knobs, so the two never disagree.
export const PRESETS = {
  low:    { shadowQuality: 'off',    renderScale: 0.70, effects: 'low',    viewDistance: 'near',   antialias: false, postFx: 'off',   ao: false },
  medium: { shadowQuality: 'low',    renderScale: 1.00, effects: 'medium', viewDistance: 'medium', antialias: false, postFx: 'light', ao: false },
  high:   { shadowQuality: 'medium', renderScale: 1.25, effects: 'high',   viewDistance: 'far',    antialias: true,  postFx: 'full',  ao: true },
  ultra:  { shadowQuality: 'high',   renderScale: 1.50, effects: 'high',   viewDistance: 'far',    antialias: true,  postFx: 'full',  ao: true },
};

export function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return false;
  Object.assign(data, p, { quality: name });
  flush();
  listeners.forEach((fn) => fn('quality', name));
  return true;
}

export function reset() {
  data = { ...DEFAULTS };
  flush();
  listeners.forEach((fn) => fn(null, null));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let pending = false;
function flush() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  }, 0);
}
