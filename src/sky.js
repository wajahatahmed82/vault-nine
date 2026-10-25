import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SHARED } from './townmat.js';
import { load as loadAsset } from './assets.js';
import { TOUCH_ONLY } from './input.js';

// Atmosphere: sky, time of day, height fog, street lighting.
//
// The sky is painted into an equirectangular canvas once per time-of-day
// change: gradient, sun and its glow, clouds, stars at night, and two layers
// of distant mountain ridgeline along the horizon -- so the valley reads as a
// valley at every view distance, even when fog has eaten the real mountains.
// The same image feeds the PMREM environment map, so reflections match.
//
// When the photographed sky for the time of day has loaded (assets/sky,
// CC0 HDRIs from Poly Haven, see ASSETS.md) it replaces the painted one for
// the background and the lighting: the sun or moon is put where the photo has
// it, the two ridgelines are drawn into the photo's horizon in its own
// colours, and the fog takes the photo's horizon colour so the edge of the
// world melts into the sky. The painted sky stays as the fallback.
//
// Fog is three.js exponential fog with a height term patched into the shader
// chunks: thicker on the valley floor, thinner up the mountainsides, so peaks
// stand above the haze.
//
// Lights at night: emissive lamp heads (one instanced mesh), soft additive
// light pools on the ground under every street lamp (one instanced mesh), and
// a few real point lights moved to whichever lamps are nearest the camera.

// ---- height fog (patched before any material compiles) ----
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying float vFogY;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogY = ( inverse( viewMatrix ) * mvPosition ).y;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogY;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogH = exp( - max( vFogY + 8.0, 0.0 ) * 0.03 );
		float fogD = fogDensity * mix( 0.5, 1.45, fogH );
		float fogFactor = 1.0 - exp( - fogD * fogD * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const TIMES = {
  day: {
    sunEl: 52, sunAz: -128, sunCol: [1.0, 0.96, 0.88], sunI: 3.3,
    zenith: [0.30, 0.50, 0.78], horizon: [0.74, 0.80, 0.86], sunGlow: [1.0, 0.95, 0.85], glowAmt: 0.25,
    hemiSky: [0.78, 0.84, 0.92], hemiGround: [0.46, 0.43, 0.38], hemiI: 2.3,
    fog: [0.60, 0.66, 0.73], fogMul: 0.6, exposure: 1.0, env: 1.1, day: 1, night: 0, clouds: 0.45,
    ridgeFar: [0.62, 0.68, 0.76], ridgeNear: [0.48, 0.54, 0.6],
    // the photographed sky: where its sun is, how bright to show and light with
    hdr: { sunEl: 48, sunAz: 34.2, bg: 0.85, env: 0.38, hemi: 0.3, sunI: 2.9, exposure: 0.82, fog: 0.9 },
    rays: 0.35,
  },
  dusk: {
    sunEl: 6, sunAz: -96, sunCol: [1.0, 0.62, 0.36], sunI: 2.6,
    zenith: [0.15, 0.20, 0.38], horizon: [0.56, 0.47, 0.52], sunGlow: [1.0, 0.58, 0.32], glowAmt: 1.0,
    hemiSky: [0.58, 0.55, 0.66], hemiGround: [0.34, 0.29, 0.27], hemiI: 1.7,
    fog: [0.43, 0.40, 0.47], fogMul: 1.0, exposure: 1.08, env: 0.8, day: 0.5, night: 0.6, clouds: 0.55,
    ridgeFar: [0.37, 0.34, 0.42], ridgeNear: [0.26, 0.24, 0.31],
    // the photo's sun sits 2 degrees up; the light comes from 7 so the town
    // is not all one long shadow
    hdr: { sunEl: 2, sunAz: 37.7, lightEl: 7, bg: 0.55, env: 0.55, hemi: 0.5, sunI: 2.4, exposure: 1.0, fog: 0.75 },
    rays: 1.1,
  },
  night: {
    sunEl: 38, sunAz: 60, sunCol: [0.55, 0.64, 0.92], sunI: 0.42,
    zenith: [0.012, 0.018, 0.04], horizon: [0.06, 0.07, 0.11], sunGlow: [0.5, 0.56, 0.7], glowAmt: 0.12,
    hemiSky: [0.20, 0.23, 0.34], hemiGround: [0.07, 0.07, 0.08], hemiI: 1.0,
    fog: [0.055, 0.065, 0.095], fogMul: 1.1, exposure: 1.35, env: 0.25, day: 0, night: 1, clouds: 0.3, stars: true,
    ridgeFar: [0.05, 0.06, 0.09], ridgeNear: [0.03, 0.035, 0.05],
    // a clear moonlit sky, exposed far brighter than night looks: shown dim
    hdr: { sunEl: 17, sunAz: 35.6, bg: 0.09, env: 0.16, hemi: 0.8, sunI: 0.42, exposure: 1.35, fog: 0.85 },
  },
};

function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
}
function fbm(x, y, o) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += vn(x * f, y * f) * a; a *= 0.5; f *= 2.02; } return s; }

export function sunDir(T) {
  const el = THREE.MathUtils.degToRad(T.sunEl), az = THREE.MathUtils.degToRad(T.sunAz);
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
}

function paintSky(T, W = 1024, H = 512) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const S = sunDir(T);
  const toS = (v) => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255);
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    const el = (v - 0.5) * Math.PI;
    const ce = Math.cos(el), se = Math.sin(el);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const az = (u - 0.5) * Math.PI * 2;
      const dx = ce * Math.cos(az), dy = se, dz = ce * Math.sin(az);
      const sd = Math.max(0, dx * S.x + dy * S.y + dz * S.z);
      // gradient, warmer toward the sun near the horizon
      const t = Math.pow(Math.max(0, se), 0.45);
      let col = lerp3(T.horizon, T.zenith, t);
      const glow = Math.pow(sd, 6) * T.glowAmt * (1 - t * 0.6);
      col = lerp3(col, T.sunGlow, Math.min(1, glow));
      // clouds: stretched fbm, lit from the sun side
      if (se > 0.0) {
        const cx = az * 2.2, cy = se * 9;
        const n = fbm(cx + 3.1, cy - 1.7, 5);
        const cover = Math.max(0, (n - (0.62 - T.clouds * 0.25)) * 3.2) * Math.min(1, se * 8) * (1 - Math.max(0, se - 0.6) * 1.6);
        if (cover > 0) {
          const lit = 0.55 + 0.45 * Math.pow(sd, 3);
          const cc = lerp3(lerp3(T.horizon, T.zenith, 0.3), T.sunGlow, 0.35 * T.glowAmt);
          col = lerp3(col, [cc[0] * lit + 0.05, cc[1] * lit + 0.05, cc[2] * lit + 0.05], Math.min(0.85, cover));
        }
      }
      if (T.stars && se > 0.05) {
        const sx = Math.floor(u * W * 1.0), sy = Math.floor(v * H);
        if (hash(sx, sy) > 0.9975) { const b = 0.4 + hash(sy, sx) * 0.6; col = [col[0] + b, col[1] + b, col[2] + b * 1.05]; }
      }
      // distant ridges: two layers of mountains along the horizon
      const ridgeFar = (2.2 + fbm(az * 3.0 + 10, 0.5, 4) * 5.5) * Math.PI / 180;
      const ridgeNear = (0.6 + fbm(az * 5.0 - 4, 2.5, 4) * 3.4) * Math.PI / 180;
      if (el < ridgeFar && el > -0.02) col = lerp3(T.ridgeFar, col, 0.25 + 0.5 * Math.max(0, el / ridgeFar) * 0.3);
      if (el < ridgeNear && el > -0.02) col = lerp3(T.ridgeNear, T.fog, 0.35);
      if (el <= -0.02) col = T.fog;
      // the sun disc itself
      if (sd > 0.9994 && T.sunEl > 0) col = lerp3(col, [3, 2.8, 2.5], 0.9);
      const o = (y * W + x) * 4;
      d[o] = toS(col[0]); d[o + 1] = toS(col[1]); d[o + 2] = toS(col[2]); d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function poolTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

export function createAtmosphere(game, renderer, opts = {}) {
  const scene = game.scene;
  const hemi = scene.children.find((o) => o.isHemisphereLight);
  const sun = game.sun;
  const town = game.town;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const lampsStreet = town.lamps.filter((l) => l.kind === 'street');
  // street lamps first, so pool i and head i are the same lamp
  const lampsAll = lampsStreet.concat(town.lamps.filter((l) => l.kind !== 'street'),
    town.glows.map((g) => ({ ...g, kind: 'signal' })));

  // ---- lamp heads ----
  const headGeo = new THREE.BoxGeometry(0.34, 0.08, 0.46);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampsAll.length);
  const m4 = new THREE.Matrix4();
  lampsAll.forEach((l, i) => {
    const s = l.kind === 'indoor' ? [3.2, 0.6, 0.8] : l.kind === 'signal' ? [0.6, 2.2, 0.4] : [1, 1, 1];
    m4.makeScale(...s).setPosition(l.x, l.y, l.z);
    heads.setMatrixAt(i, m4);
    heads.setColorAt(i, new THREE.Color(0.2, 0.2, 0.2));
  });
  heads.name = 'lampHeads';
  scene.add(heads);

  // ---- light pools under street lamps ----
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, color: 0xffffff, fog: true });
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampsStreet.length);
  lampsStreet.forEach((l, i) => {
    const y = town.surfaceH(l.x, l.z) + 0.1;
    m4.makeScale(15, 1, 15).setPosition(l.x, y, l.z);
    pools.setMatrixAt(i, m4);
    pools.setColorAt(i, new THREE.Color(1, 0.75, 0.45));
  });
  pools.renderOrder = 1;
  pools.name = 'lightPools';
  pools.frustumCulled = false;
  scene.add(pools);

  // ---- shop windows spill light onto the pavement at night ----
  const winSpots = [];
  for (const b of town.buildings) {
    if (!b.shop) continue;
    for (let lx = -b.w / 2 + 2; lx <= b.w / 2 - 2; lx += 3.5) {
      const q = town.local(b, lx, b.d / 2 + 1.4);
      winSpots.push([q.x, town.surfaceH(q.x, q.z) + 0.11, q.z, b.rot]);
    }
  }
  const winPools = new THREE.InstancedMesh(poolGeo, poolMat.clone(), Math.max(1, winSpots.length));
  winSpots.forEach(([x, y, z, rot], i) => {
    m4.makeRotationY(rot).scale(new THREE.Vector3(4.2, 1, 2.6)).setPosition(x, y, z);
    winPools.setMatrixAt(i, m4);
    winPools.setColorAt(i, new THREE.Color(0.55, 0.42, 0.26));
  });
  winPools.count = winSpots.length;
  winPools.renderOrder = 1;
  winPools.frustumCulled = false;
  winPools.name = 'windowPools';
  scene.add(winPools);

  // ---- wet roads: each nearby lamp leaves a long streak on the tarmac ----
  // A reflection on a wet road runs from under the lamp towards the viewer,
  // stretched by the water; one additive strip per lamp, re-aimed every frame.
  const streakTex = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 128;
    const gx = c.getContext('2d');
    const gr = gx.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 32, 128);
    const side = gx.createLinearGradient(0, 0, 32, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.5, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    gx.globalCompositeOperation = 'destination-out'; gx.fillStyle = side; gx.fillRect(0, 0, 32, 128);
    return new THREE.CanvasTexture(c);
  })();
  const NS = 18;
  const streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }), NS);
  streaks.renderOrder = 2;
  streaks.frustumCulled = false;
  streaks.visible = false;
  streaks.name = 'wetStreaks';
  scene.add(streaks);
  const _s = new THREE.Vector3(1, 1, 1), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

  // ---- a few real lights, moved to the nearest lamps ----
  const NL = opts.pointLights ?? 4;
  const lights = [];
  for (let i = 0; i < NL; i++) {
    const L = new THREE.PointLight(0xffc38a, 0, 20, 1.6);
    scene.add(L);
    lights.push(L);
  }

  // Flicker: a handful of street lamps stutter, signals blink.
  const flicker = new Set();
  for (let i = 0; i < lampsAll.length; i += 23) flicker.add(i);

  const state = { time: 'dusk', T: TIMES.dusk, night: 0, weather: 'clear', t: 0, lastAssign: -1, hdr: null };
  let skyTex = null, envRT = null;
  const photo = new Map();          // time -> { tex, fog } once loaded and processed
  const loading = new Set();
  const rgbe = new RGBELoader().setDataType(THREE.FloatType);

  // Ridgelines and below-horizon fill drawn into the photo in its own light,
  // then converted to half floats for the GPU. Returns the horizon colour.
  function processPhoto(tex, T) {
    const { width: W, height: H, data } = tex.image;
    // average colour just above the horizon (rows are top-down after flipY),
    // away from the sun: the glow round a low sun is not the haze colour
    let hr = 0, hg = 0, hb = 0, n = 0;
    const sAz = THREE.MathUtils.degToRad(T.hdr.sunAz);
    for (let y = 0; y < H; y++) {
      const el = (0.5 - (y + 0.5) / H) * Math.PI;
      if (el < 0.005 || el > 0.12) continue;
      for (let x = 0; x < W; x += 2) {
        let d = Math.abs(((x + 0.5) / W - 0.5) * Math.PI * 2 - sAz);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < 1.4) continue;
        const o = (y * W + x) * 4; hr += data[o]; hg += data[o + 1]; hb += data[o + 2]; n++;
      }
    }
    const hz = [hr / n, hg / n, hb / n];
    const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    // ridges: the painted sky's colours relative to its own fog, scaled into
    // the photo's brightness
    const rel = (c) => [c[0] / Math.max(0.01, T.fog[0]), c[1] / Math.max(0.01, T.fog[1]), c[2] / Math.max(0.01, T.fog[2])];
    const rf = rel(T.ridgeFar), rn = rel(T.ridgeNear);
    const far = [hz[0] * Math.min(1.1, rf[0]), hz[1] * Math.min(1.1, rf[1]), hz[2] * Math.min(1.1, rf[2])];
    const near = [hz[0] * Math.min(1, rn[0]) * 0.85, hz[1] * Math.min(1, rn[1]) * 0.85, hz[2] * Math.min(1, rn[2]) * 0.85];
    const below = mul(hz, 0.55);
    // ridge heights depend only on direction: one pair per column
    const RN = new Float32Array(W), RF = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const az = ((x + 0.5) / W - 0.5) * Math.PI * 2;
      RN[x] = (0.6 + fbm(az * 5.0 - 4, 2.5, 4) * 3.4) * Math.PI / 180;
      RF[x] = (2.2 + fbm(az * 3.0 + 10, 0.5, 4) * 5.5) * Math.PI / 180;
    }
    for (let y = 0; y < H; y++) {
      const el = (0.5 - (y + 0.5) / H) * Math.PI;
      if (el > 0.15) continue;
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        let c = null;
        if (el <= -0.02) c = below;
        else {
          const ridgeNear = RN[x], ridgeFar = RF[x];
          if (el < ridgeNear) c = near;
          else if (el < ridgeFar) {
            const k = 0.55 + 0.35 * Math.max(0, el / ridgeFar);
            c = [far[0] + (data[o] - far[0]) * (1 - k) * 0.4, far[1] + (data[o + 1] - far[1]) * (1 - k) * 0.4, far[2] + (data[o + 2] - far[2]) * (1 - k) * 0.4];
          }
        }
        if (c) { data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; }
      }
    }
    // half floats: filterable everywhere, half the memory
    const half = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.min(65000, data[i]));
    const out = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    out.mapping = THREE.EquirectangularReflectionMapping;
    out.colorSpace = THREE.LinearSRGBColorSpace;
    out.flipY = tex.flipY;
    out.magFilter = THREE.LinearFilter; out.minFilter = THREE.LinearFilter;
    out.generateMipmaps = false;
    out.needsUpdate = true;
    tex.dispose();
    return { tex: out, fog: hz };
  }

  function requestPhoto(name) {
    if (photo.has(name) || loading.has(name) || opts.photoSky === false) return;
    loading.add(name);
    loadAsset(rgbe, `assets/sky/${name}_${TOUCH_ONLY ? '1k' : '2k'}.hdr`).then((tex) => {
      loading.delete(name);
      photo.set(name, processPhoto(tex, TIMES[name]));
      if (state.time === name) applyPhoto(name);
    }).catch((err) => { loading.delete(name); console.warn('sky photo failed, keeping the painted sky', err); });
  }

  function applyPhoto(name) {
    const P = photo.get(name), T = TIMES[name], H = T.hdr;
    scene.background = P.tex;
    scene.backgroundIntensity = H.bg;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromEquirectangular(P.tex);
    scene.environment = envRT.texture;
    scene.environmentIntensity = H.env;
    // the light comes from where the photo's sun (or moon) is
    const sd = sunDir({ sunEl: H.lightEl ?? H.sunEl, sunAz: H.sunAz });
    game.sunOffset = sd.clone().multiplyScalar(60);
    state.sunDir = sunDir({ sunEl: H.sunEl, sunAz: H.sunAz });
    sun.intensity = H.sunI;
    if (hemi) hemi.intensity = T.hemiI * H.hemi;
    renderer.toneMappingExposure = H.exposure;
    // fog in the photo's horizon colour, as it is shown
    state.fogPhoto = [P.fog[0] * H.bg * H.fog, P.fog[1] * H.bg * H.fog, P.fog[2] * H.bg * H.fog];
    state.hdr = name;
    applyWeather();
  }

  function setTime(name) {
    const T = TIMES[name] || TIMES.dusk;
    state.time = name; state.T = T;
    state.hdr = null; state.fogPhoto = null;
    scene.backgroundIntensity = 1;
    if (skyTex) skyTex.dispose();
    skyTex = paintSky(T);
    scene.background = skyTex;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromEquirectangular(skyTex);
    scene.environment = envRT.texture;
    scene.environmentIntensity = T.env;
    const sd = sunDir(T);
    game.sunOffset = sd.clone().multiplyScalar(60);
    sun.color.setRGB(...T.sunCol);
    sun.intensity = T.sunI;
    if (hemi) { hemi.color.setRGB(...T.hemiSky); hemi.groundColor.setRGB(...T.hemiGround); hemi.intensity = T.hemiI; }
    if (scene.fog) scene.fog.color.setRGB(...T.fog);
    game.fogMul = T.fogMul;
    renderer.toneMappingExposure = T.exposure;
    SHARED.uDay.value = T.day;
    SHARED.uNight.value = T.night;
    state.night = T.night;
    town.materials.signs.emissiveIntensity = T.night * 0.9;
    state.sunDir = sd;
    applyWeather();
    // swap in the photographed sky (now if it is already here, else when it lands)
    if (photo.has(name)) applyPhoto(name); else requestPhoto(name);
  }

  function applyWeather() {
    const rain = state.weather === 'rain';
    SHARED.uWet.value = rain ? 1 : 0;
    if (SHARED.uWind) SHARED.uWind.value = rain ? 2.2 : 1;
    if (scene.fog) {
      const T = state.T;
      const base = state.fogPhoto || T.fog;
      const f = rain ? lerp3(base, [base[0] * 0.8, base[1] * 0.82, base[2] * 0.86], 0.6) : base;
      scene.fog.color.setRGB(...f);
      game.fogMul = T.fogMul * (rain ? 1.35 : 1);
    }
    sun.intensity = (state.hdr ? state.T.hdr.sunI : state.T.sunI) * (rain ? 0.45 : 1);
  }

  function setWeather(w) { state.weather = w; applyWeather(); }

  const col = new THREE.Color();
  function update(dt, cam) {
    state.t += dt;
    SHARED.uTime.value = state.t;
    const n = state.night;
    // town lamps are dark until the campaign restores power
    const pw = game.townPower === false ? 0 : 1;
    // lamp heads and pools
    for (let i = 0; i < lampsAll.length; i++) {
      const l = lampsAll[i];
      let k = n;
      if (l.kind === 'signal') k = (Math.sin(state.t * 3.3) > 0 ? 1 : 0.05) * pw;
      else {
        k *= pw;
        if (flicker.has(i)) k *= (Math.sin(state.t * 23 + i) + Math.sin(state.t * 7.1 + i * 3)) > 0.6 ? 0.08 : 1;
      }
      if (l.kind === 'signal') col.setRGB(3.0 * k, 1.6 * k, 0.2 * k);
      else if (l.kind === 'indoor') col.setRGB(0.25 + 2.2 * k, 0.24 + 2.0 * k, 0.22 + 1.7 * k);
      else col.setRGB(0.18 + 3.4 * k, 0.17 + 2.6 * k, 0.15 + 1.6 * k);
      heads.setColorAt(i, col);
      if (i < lampsStreet.length) {
        // pools follow street-lamp order (street lamps come first in lampsAll)
        col.setRGB(0.55 * k, 0.4 * k, 0.24 * k);
        pools.setColorAt(i, col);
      }
    }
    heads.instanceColor.needsUpdate = true;
    pools.instanceColor.needsUpdate = true;
    pools.visible = n > 0.05;
    winPools.visible = n > 0.05;
    winPools.material.color.setScalar(n * pw);

    // wet-road streaks under the nearest lit street lamps
    const wet = SHARED.uWet.value;
    streaks.visible = wet > 0.05 && n > 0.05 && pw > 0;
    if (streaks.visible) {
      const near = [];
      for (const l of lampsStreet) {
        const d = (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2;
        if (d < 2500) near.push([d, l]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < NS; i++) {
        const e = near[i];
        if (!e) { m4.makeScale(0, 0, 0); streaks.setMatrixAt(i, m4); continue; }
        const l = e[1];
        const dx = cam.x - l.x, dz = cam.z - l.z, dd = Math.hypot(dx, dz) || 1;
        const len = Math.min(9, 2 + dd * 0.35);
        _p.set(l.x + dx / dd * len * 0.5, town.surfaceH(l.x, l.z) + 0.12, l.z + dz / dd * len * 0.5);
        _q.setFromAxisAngle(_up, Math.atan2(dx, dz));
        _s.set(0.9, 1, len);
        m4.compose(_p, _q, _s);
        streaks.setMatrixAt(i, m4);
        streaks.setColorAt(i, col.setRGB(1.1 * n * wet, 0.8 * n * wet, 0.5 * n * wet));
      }
      streaks.instanceMatrix.needsUpdate = true;
      if (streaks.instanceColor) streaks.instanceColor.needsUpdate = true;
    }

    // assign point lights to the nearest lamps a few times a second
    if (NL && state.t - state.lastAssign > 0.25) {
      state.lastAssign = state.t;
      const near = [];
      for (const l of town.lamps) {
        const d = (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2;
        if (d < 3600) near.push([d, l]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < NL; i++) {
        const L = lights[i], e = near[i];
        if (!e || n < 0.05 || !pw) { L.intensity = 0; continue; }
        const l = e[1];
        L.position.set(l.x, l.y - 0.3, l.z);
        L.intensity = (l.kind === 'indoor' ? 9 : 22) * n;
        L.distance = l.kind === 'indoor' ? 11 : 20;
      }
    }
  }

  setTime(opts.time || 'dusk');
  return { setTime, setWeather, update, state, heads, pools, lights, photo, get night() { return state.night; } };
}
