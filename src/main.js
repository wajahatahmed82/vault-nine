import * as THREE from 'three';
import { Game, STATE, MODE } from './game.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { Progression } from './progression.js';
import * as audio from './audio.js';
import * as settings from './settings.js';

const canvas = document.getElementById('view');

// preserveDrawingBuffer makes the driver keep a full copy of every frame. It is
// only needed for automated screenshots, so it is opt-in and never on for
// players.
const CAPTURE = new URLSearchParams(location.search).has('capture');

const renderer = new THREE.WebGLRenderer({
  canvas,
  // Fixed at context creation, so it only takes effect on reload. The settings
  // panel says so rather than pretending the toggle is live.
  antialias: settings.get('antialias'),
  powerPreference: 'high-performance',
  preserveDrawingBuffer: CAPTURE,
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;   // ACES crushes darks to black
renderer.toneMappingExposure = 1.0;
// render() draws two passes, so stats must accumulate across both.
renderer.info.autoReset = false;

const prog = new Progression();
const input = new Input(canvas);
const game = new Game(renderer, input, prog);
const hud = new HUD(game, input, prog);

// ---------------------------------------------------------------- quality ----
// Presets write individual knobs; the knobs are what actually drive the
// renderer, so the two can never disagree. "auto" additionally tracks measured
// frame time and gives up shadows before it gives up resolution, because soft
// edges read worse than missing shadows.
const DPR_CAP = Math.min(window.devicePixelRatio || 1, 2);
const SHADOW_SIZE = { off: 0, low: 512, medium: 1024, high: 2048 };
const VIEW_FOG = { near: 0.016, medium: 0.0075, far: 0.0035 };
const VIEW_FAR = { near: 160, medium: 280, far: 400 };

let renderScale = 1.0;
let shadowsOn = true;
let frameAvg = 16.7;

function setShadows(on, size) {
  const changed = shadowsOn !== on;
  shadowsOn = on;
  renderer.shadowMap.enabled = on;
  if (size && game.sun.shadow.mapSize.width !== size) {
    game.sun.shadow.mapSize.set(size, size);
    game.sun.shadow.map?.dispose();
    game.sun.shadow.map = null;
  }
  // Toggling shadow support changes the shader permutation, so materials have
  // to recompile. Only do it when the flag actually flipped.
  if (changed) {
    game.scene.traverse((o) => {
      if (o.isMesh && o.material) {
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((x) => { x.needsUpdate = true; });
      }
    });
  }
}

function applySize() {
  const w = window.innerWidth || 800;
  const h = window.innerHeight || 600;
  renderer.setPixelRatio(Math.min(renderScale, DPR_CAP * 1.5));
  renderer.setSize(w, h, false);
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
}

function applyQuality() {
  const q = settings.get('quality');
  if (q === 'auto') {
    renderScale = Math.min(DPR_CAP, 1.2);
    setShadows(true, 1024);
  } else {
    renderScale = settings.get('renderScale');
    const sq = settings.get('shadowQuality');
    setShadows(sq !== 'off', SHADOW_SIZE[sq] || 1024);
  }

  const vd = settings.get('viewDistance');
  if (game.scene.fog) game.scene.fog.density = VIEW_FOG[vd] ?? VIEW_FOG.medium;
  game.camera.far = VIEW_FAR[vd] ?? VIEW_FAR.medium;
  game.camera.updateProjectionMatrix();

  game.fx.setBudget(settings.get('effects'));
  applySize();
}
applyQuality();
settings.onChange((k) => {
  if (k === null || ['quality', 'shadowQuality', 'renderScale', 'effects', 'viewDistance'].includes(k)) {
    applyQuality();
  }
});

let tuneT = 0;
function autoTune(dt, frameMs) {
  if (settings.get('quality') !== 'auto') return;
  frameAvg += (frameMs - frameAvg) * 0.06;
  tuneT += dt;
  if (tuneT < 0.9) return;
  tuneT = 0;
  if (frameAvg > 17.5) {
    if (shadowsOn) setShadows(false, 512);
    else if (renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.12); applySize(); }
  } else if (frameAvg < 12.5) {
    if (renderScale < Math.min(DPR_CAP, 1.4)) {
      renderScale = Math.min(Math.min(DPR_CAP, 1.4), renderScale + 0.08);
      applySize();
    } else if (!shadowsOn) setShadows(true, 1024);
  }
}

window.addEventListener('resize', applySize);
window.addEventListener('orientationchange', () => setTimeout(applySize, 150));
if (window.ResizeObserver) new ResizeObserver(applySize).observe(document.body);

// Shadow maps re-render the whole scene. Almost nothing that casts one moves
// fast, so refreshing every other frame is free quality.
renderer.shadowMap.autoUpdate = false;
let shadowTick = 0;

// Compile every shader up front, otherwise the first frame showing a new
// material stalls for over 100ms mid-firefight.
renderer.compile(game.scene, game.camera);

const unlockOnce = () => { audio.unlock(); window.removeEventListener('pointerdown', unlockOnce); };
window.addEventListener('pointerdown', unlockOnce);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAY) game.pause();
});
document.addEventListener('pointerlockchange', () => {
  // Losing the lock mid-game means the player hit Esc or tabbed away.
  if (!document.pointerLockElement && game.state === STATE.PLAY && input.wantPointerLock) game.pause();
});

let last = performance.now();

function step(dt) {
  game.update(dt);
  hud.update(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;      // a stall must never tunnel a bullet

  renderer.info.reset();
  const t0 = performance.now();
  step(dt);

  shadowTick = (shadowTick + 1) % 2;
  renderer.shadowMap.needsUpdate = shadowsOn && shadowTick === 0;

  game.render();
  const cost = performance.now() - t0;
  autoTune(dt, cost);
  hud.setFps(1 / Math.max(dt, 0.0001), renderScale);
}
requestAnimationFrame(frame);

window.__rs = {
  game, hud, input, renderer, prog, settings, step, THREE, STATE, MODE,
  // test hook: place a soldier without importing enemies.js, so the tools also
  // run against the single-file build
  spawnSoldier: (type, x, z, yaw) => game.campaign._spawn(type, x, z, { yaw: yaw || 0 }),
  get renderScale() { return renderScale; },
  get shadowsOn() { return shadowsOn; },
  setQuality(q) { settings.set('quality', q); applyQuality(); },
};
