import * as THREE from 'three';
import { Game, STATE, MODE } from './game.js';
import { Input, TOUCH_ONLY } from './input.js';
import { HUD } from './hud.js';
import { Progression } from './progression.js';
import * as audio from './audio.js';
import * as settings from './settings.js';
import { createAtmosphere } from './sky.js';
import { createPost } from './post.js';
import { ScreenFX } from './screenfx.js';
import { createLife } from './townlife.js';
import { loadHumans, humansReady, humansProgress, useHumans, FPArms } from './humans.js';
import { VIEW_LAYER } from './weapons.js';

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

// Atmosphere before the shader warm-up below, so its lights are part of every
// compiled program. Phones get no real point lights: the per-pixel light loop
// is the most expensive thing a mobile GPU could be asked to do here.
game.atmos = createAtmosphere(game, renderer, { pointLights: TOUCH_ONLY ? 0 : 6, time: settings.get('timeOfDay') });
game.atmos.setWeather(settings.get('weather'));
game.life = createLife(game, { lowEffects: TOUCH_ONLY, fireLight: !TOUCH_ONLY });
game.life.setRain(settings.get('weather') === 'rain');
game.post = createPost(renderer, game);
game.screen = new ScreenFX(renderer.domElement);
game.screen.post = game.post;
game.post.setGrade(settings.get('timeOfDay'));

// ---------------------------------------------------------------- quality ----
// Presets write individual knobs; the knobs are what actually drive the
// renderer, so the two can never disagree. "auto" additionally tracks measured
// frame time and gives up shadows before it gives up resolution, because soft
// edges read worse than missing shadows.
const DPR_CAP = Math.min(window.devicePixelRatio || 1, 2);
const SHADOW_SIZE = { off: 0, low: 512, medium: 1024, high: 2048 };
const VIEW_FOG = { near: 0.016, medium: 0.0075, far: 0.0035 };
const VIEW_FAR = { near: 160, medium: 280, far: 900 };
// How far town buildings keep their full structure. Past this a single
// whole-town mesh of plain shells stands in, and fog covers the change.
const VIEW_DETAIL = { near: 90, medium: 150, far: 220 };

let renderScale = 1.0;
let shadowsOn = true;
let frameAvg = 16.7;

function setShadows(on, size) {
  const changed = shadowsOn !== on;
  shadowsOn = on;
  renderer.shadowMap.enabled = on;
  // the wide second cascade on desktop at medium shadows and up
  const far = on && !TOUCH_ONLY && (size || 0) >= 1024;
  if (game.sunFar && game.sunFar.castShadow !== far) {
    game.sunFar.castShadow = far;
    game.sunFar.shadow.needsUpdate = true;
  }
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
  if (game.post) game.post.setSize(w, h, renderer.getPixelRatio());
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
}

function applyQuality() {
  const q = settings.get('quality');
  if (q === 'auto') {
    // Phones start lean and earn quality back: a 3x-density screen at 1.2x
    // with shadows is a slideshow on most mobile GPUs. Desktop starts high.
    if (TOUCH_ONLY) {
      renderScale = Math.min(DPR_CAP, 0.9);
      setShadows(false, 512);
      game.fx.setBudget('low');
    } else {
      renderScale = Math.min(DPR_CAP, 1.2);
      setShadows(true, 1024);
    }
  } else {
    renderScale = settings.get('renderScale');
    const sq = settings.get('shadowQuality');
    setShadows(sq !== 'off', SHADOW_SIZE[sq] || 1024);
  }

  // Phones on auto keep the near view distance: town detail stops at 90 m,
  // which takes the worst view in town from ~134 draw calls to ~80.
  const vd = q === 'auto' && TOUCH_ONLY ? 'near' : settings.get('viewDistance');
  game.baseFog = VIEW_FOG[vd] ?? VIEW_FOG.medium;
  if (game.scene.fog) game.scene.fog.density = game.baseFog * (game.fogMul || 1);
  game.camera.far = VIEW_FAR[vd] ?? VIEW_FAR.medium;
  if (game.town) game.town.detailDist = VIEW_DETAIL[vd] ?? VIEW_DETAIL.medium;
  game.camera.updateProjectionMatrix();

  game.fx.setBudget(settings.get('effects'));
  // post effects: phones on auto skip them entirely
  const pf = q === 'auto' ? (TOUCH_ONLY ? 'off' : 'full') : settings.get('postFx');
  if (game.post) {
    game.post.setMode(pf);
    // AO on HIGH / ULTRA (and desktop auto, which drops it first when slow)
    game.post.ao = pf !== 'off' && (q === 'auto' ? !TOUCH_ONLY : !!settings.get('ao'));
    game.post.raysOn = pf === 'full' && !TOUCH_ONLY;
  }
  applySize();
}
applyQuality();
settings.onChange((k) => {
  if (k === null || ['quality', 'shadowQuality', 'renderScale', 'effects', 'viewDistance', 'postFx', 'ao'].includes(k)) {
    applyQuality();
  }
  if (k === null || k === 'timeOfDay') game._setTime(settings.get('timeOfDay'));
  if (k === null || k === 'weather') {
    game.atmos.setWeather(settings.get('weather'));
    game.life.setRain(settings.get('weather') === 'rain');
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
    // give up, in order: the wide shadow cascade, AO, then shadows
    if (game.sunFar && game.sunFar.castShadow) game.sunFar.castShadow = false;
    else if (game.post && game.post.ao) game.post.ao = false;
    else if (shadowsOn) setShadows(false, 512);
    else if (renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.12); applySize(); }
  } else if (frameAvg < 12.5) {
    const cap = TOUCH_ONLY ? 1.0 : Math.min(DPR_CAP, 1.4);
    if (renderScale < cap) {
      renderScale = Math.min(cap, renderScale + 0.08);
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

// Upload every town buffer to the GPU now. A chunk's geometry is otherwise
// first sent when it first comes into view, which showed up as a 40 ms hitch
// the first time the player turned toward a new street.
{
  const culled = [];
  game.scene.traverse((o) => { if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
  if (game.town) game.town.update({ x: 0, z: 0 }, Infinity);
  renderer.render(game.scene, game.camera);
  for (const o of culled) o.frustumCulled = true;
}

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
  // Tune on real frame time, not CPU time. Phones are usually GPU-bound, and
  // `cost` only measures how long it took to submit the frame, so on a slow
  // phone it stayed low and auto-quality never reacted.
  autoTune(dt, Math.max(cost, dt * 1000));
  hud.setFps(1 / Math.max(dt, 0.0001), renderScale);
}
requestAnimationFrame(frame);

// Soldier models: fetched (or read from the cache) while the menu is up; the
// mission buttons wait for them. If they cannot load, the built-in soldiers
// stand in and the menu opens anyway.
let humansDone = false;
const humans = loadHumans().then(() => {
  humansDone = true;
  if (humansReady()) game.weapons.useArms(new FPArms(VIEW_LAYER));
});
(function watchLoad() {
  hud.setLoading(humansProgress(), humansDone);
  if (!humansDone) setTimeout(watchLoad, 150);
})();

window.__rs = {
  game, hud, input, renderer, prog, settings, step, THREE, STATE, MODE,
  // test hook: place a soldier without importing enemies.js, so the tools also
  // run against the single-file build
  spawnSoldier: (type, x, z, yaw) => game.campaign._spawn(type, x, z, { yaw: yaw || 0 }),
  audioLog: () => audio.spatialLog,
  humans,                          // resolves once the soldier models are in
  get humansReady() { return humansReady(); },
  useHumans,
  get renderScale() { return renderScale; },
  get shadowsOn() { return shadowsOn; },
  setQuality(q) { settings.set('quality', q); applyQuality(); },
};
