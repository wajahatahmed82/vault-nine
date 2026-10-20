import * as THREE from 'three';
import { GeoBuf } from './geobuf.js';
import { SHARED } from './townmat.js';
import * as PR from './props.js';
import * as audio from './audio.js';
import { SIGN_COLS, SIGN_ROWS } from './texgen.js';

// Weather and the life of the town.
//
// Every effect here is pooled and capped: particle systems are fixed-size
// instanced meshes written in place, nothing is allocated per frame, and
// effects far from the camera are not simulated.
//
//   weather: rain streaks (one line set, moved entirely in the vertex shader),
//            splash rings on the ground, litter blown by the wind, dust motes
//            drifting in sunlight indoors
//   world:   steam from drains, a burning car (fire, smoke, flickering light),
//            birds that scatter at gunfire, hanging signs swinging in the wind,
//            a flag on the town hall, a downed power line that sparks
//   combat:  windows that shatter, car alarms, a car leaking fuel that
//            explodes when shot enough

const UP = new THREE.Vector3(0, 1, 0);

function softTexture(kind) {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  if (kind === 'ring') {
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 4;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 6, 0, Math.PI * 2); g.stroke();
  } else if (kind === 'hole') {
    g.fillStyle = '#000';
    g.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = (0.3 + (i % 2 ? 0.12 : 0.02) + Math.random() * 0.08) * s;
      g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * s * 0.5, s / 2 + Math.sin(a) * s * 0.5); g.stroke();
    }
  } else {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  return new THREE.CanvasTexture(c);
}

// ------------------------------------------------------------ billboards --

// Camera-facing particles with per-instance colour and alpha. One draw call
// per pool; a ring buffer of fixed size.
function billboards(scene, count, additive) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  geo.setAttribute('aColor', aColor);
  geo.setAttribute('aAlpha', aAlpha);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: softTexture('soft') } }]),
    vertexShader: `attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vec4 c = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        float s = length( instanceMatrix[0].xyz );
        vec4 mvPosition = viewMatrix * c;
        mvPosition.xy += position.xy * s;
        gl_Position = projectionMatrix * mvPosition;
        vC = aColor; vA = aAlpha; vUv = uv;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D( map, vUv ).a * vA;
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( vC, a );
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);
  const P = [];
  for (let i = 0; i < count; i++) P.push({ life: 0, max: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0 });
  let head = 0;
  const m4 = new THREE.Matrix4();
  return {
    mesh,
    spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0) {
      const p = P[head]; head = (head + 1) % count;
      p.life = life; p.max = life; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
      p.s0 = s0; p.s1 = s1; p.r = r; p.g = g; p.b = b; p.a = a; p.grav = grav; p.drag = drag;
    },
    update(dt) {
      let alive = 0;
      for (let i = 0; i < count; i++) {
        const p = P[i];
        if (p.life <= 0) { aAlpha.array[i] = 0; continue; }
        alive++;
        p.life -= dt;
        const t = 1 - Math.max(0, p.life) / p.max;
        p.vy -= p.grav * dt;
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vz *= k; p.vy *= (p.grav ? 1 : k);
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const s = p.s0 + (p.s1 - p.s0) * t;
        m4.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
        mesh.setMatrixAt(i, m4);
        aColor.array[i * 3] = p.r; aColor.array[i * 3 + 1] = p.g; aColor.array[i * 3 + 2] = p.b;
        aAlpha.array[i] = p.a * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      }
      mesh.visible = alive > 0;
      if (!alive) return;
      mesh.instanceMatrix.needsUpdate = true;
      aColor.needsUpdate = true;
      aAlpha.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------ the module --

export function createLife(game, opts = {}) {
  const scene = game.scene, town = game.town, sp = town.spots;
  const cam = game.camera;
  const smoke = billboards(scene, 360, false);   // room for a smoke grenade's wall
  const glow = billboards(scene, 140, true);
  const tmp = new THREE.Vector3();
  // scratch objects reused every frame -- nothing allocates in update()
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), EU = new THREE.Euler();
  const ONE = new THREE.Vector3(1, 1, 1), SC = new THREE.Vector3();
  const life = { t: 0, raining: false, broken: new Set(), alarms: [], fuel: null, birds: null };

  // ---- rain ----
  const RN = opts.lowEffects ? 1500 : 3200;
  const rainGeo = new THREE.BufferGeometry();
  const seeds = new Float32Array(RN * 2 * 3), tails = new Float32Array(RN * 2);
  for (let i = 0; i < RN; i++) {
    const sx = Math.random(), sy = Math.random(), sz = Math.random();
    for (let k = 0; k < 2; k++) { seeds.set([sx, sy, sz], (i * 2 + k) * 3); tails[i * 2 + k] = k; }
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
  rainGeo.setAttribute('tail', new THREE.BufferAttribute(tails, 1));
  const rainMat = new THREE.ShaderMaterial({
    uniforms: { uTime: SHARED.uTime, uCam: { value: new THREE.Vector3() }, uNight: SHARED.uNight },
    vertexShader: `attribute float tail; uniform float uTime; uniform vec3 uCam;
      void main() {
        vec3 box = vec3( 36.0, 22.0, 36.0 );
        vec3 p;
        p.x = uCam.x - box.x * 0.5 + mod( position.x * box.x - uCam.x + uTime * 1.6, box.x );
        p.z = uCam.z - box.z * 0.5 + mod( position.z * box.z - uCam.z + uTime * 0.6, box.z );
        p.y = uCam.y - 6.0 + mod( position.y * box.y - uTime * 15.0, box.y );
        p.y += tail * 0.55; p.x -= tail * 0.06;
        gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: 'uniform float uNight; void main() { gl_FragColor = vec4( mix( vec3( 0.75, 0.78, 0.82 ), vec3( 0.35, 0.38, 0.45 ), uNight ), 0.32 ); }',
    transparent: true, depthWrite: false,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.visible = false;
  rain.renderOrder = 4;
  scene.add(rain);

  // splash rings, lying flat
  const RINGS = 140;
  const ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ringAge = new THREE.InstancedBufferAttribute(new Float32Array(RINGS), 1);
  ringGeo.setAttribute('aAge', ringAge);
  const ringMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: softTexture('ring') } },
    vertexShader: 'attribute float aAge; varying float vAge; varying vec2 vUv; void main() { vAge = aAge; vUv = uv; vec3 p = position * ( 0.15 + aAge * 0.6 ); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( p, 1.0 ); }',
    fragmentShader: 'uniform sampler2D map; varying float vAge; varying vec2 vUv; void main() { float a = texture2D( map, vUv ).a * ( 1.0 - vAge ) * 0.55; if ( vAge >= 1.0 || a < 0.01 ) discard; gl_FragColor = vec4( 0.85, 0.88, 0.92, a ); }',
    transparent: true, depthWrite: false,
  });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, RINGS);
  rings.frustumCulled = false;
  rings.visible = false;
  scene.add(rings);
  const ringPos = new Float32Array(RINGS * 3);
  for (let i = 0; i < RINGS; i++) ringAge.array[i] = 1;
  let ringHead = 0;

  // litter on the wind
  const LN = 36;
  const litterMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.9, side: THREE.DoubleSide }), LN);
  litterMesh.frustumCulled = false;
  scene.add(litterMesh);
  const litter = [];
  for (let i = 0; i < LN; i++) litter.push({ x: 0, y: -999, z: 0, vy: 0, rx: Math.random() * 6, ry: Math.random() * 6, spin: 1 + Math.random() * 3 });

  // dust motes indoors
  const DN = 120;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DN * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffe6b8, size: 0.035, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  dust.frustumCulled = false;
  dust.visible = false;
  scene.add(dust);
  const dustSeed = new Float32Array(DN * 3).map(() => Math.random());

  // ---- birds on the town hall roof ----
  if (sp.birds) {
    const NB = 14;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.12, -0.32, 0.06, 0.04, 0, 0, 0.12, 0, 0, -0.12, 0, 0, 0.12, 0.32, 0.06, 0.04], 3));
    bg.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ color: 0x1a1a1c, side: THREE.DoubleSide }), NB);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const list = [];
    for (let i = 0; i < NB; i++) {
      const home = new THREE.Vector3(sp.birds.x + (i - NB / 2) * 0.9 + Math.random() * 0.3, sp.birds.y, sp.birds.z + (Math.random() - 0.5) * 0.4);
      list.push({ home, p: home.clone(), v: new THREE.Vector3(), state: 'perch', t: 0, phase: Math.random() * 6, ang: Math.random() * 6.28, rad: 18 + Math.random() * 14, alt: 22 + Math.random() * 12 });
    }
    life.birds = { mesh, list };
  }

  // ---- hanging signs, swung in the vertex shader ----
  if (sp.hangingSigns.length) {
    const buf = new GeoBuf();
    const pivots = [], axes = [], swing = [], phases = [];
    const push = (from, pv, ax, sw, ph) => {
      for (let i = from; i < buf.p.length / 3; i++) { pivots.push(...pv); axes.push(...ax); swing.push(sw); phases.push(ph); }
    };
    sp.hangingSigns.forEach((h, i) => {
      const cs = Math.cos(h.rot), sn = Math.sin(h.rot);
      // bracket out from the wall (toward the road), board hanging below it
      const out = [sn, 0, cs];
      let from = buf.p.length / 3;
      buf.box(h.x + out[0] * 0.5, h.y + 0.6, h.z + out[2] * 0.5, 0.06, 0.06, 1.1, cs, sn, [0.12, 0.12, 0.12]);
      push(from, [0, 0, 0], [1, 0, 0], 0, 0);
      from = buf.p.length / 3;
      const col = h.sign % SIGN_COLS, row = Math.floor(h.sign / SIGN_COLS);
      const u0 = col / SIGN_COLS, u1 = (col + 1) / SIGN_COLS, v1 = 1 - row / SIGN_ROWS, v0 = 1 - (row + 1) / SIGN_ROWS;
      const cx = h.x + out[0] * 0.55, cz = h.z + out[2] * 0.55;
      const half = 0.5, top = h.y + 0.5, bot = h.y - 0.0;
      const A = [cx - out[0] * half, bot, cz - out[2] * half], B = [cx + out[0] * half, bot, cz + out[2] * half];
      const C = [B[0], top, B[2]], D = [A[0], top, A[2]];
      const side = [cs, 0, -sn];
      buf.quad(A, B, C, D, side, [1, 1, 1], [u0, v0, u1, v0, u1, v1, u0, v1]);
      buf.quad(B, A, D, C, [-side[0], 0, -side[2]], [1, 1, 1], [u0, v0, u1, v0, u1, v1, u0, v1]);
      push(from, [cx, h.y + 0.6, cz], out, 1, i * 1.7);
    });
    const geo = buf.geometry();
    geo.setAttribute('aPivot', new THREE.Float32BufferAttribute(pivots, 3));
    geo.setAttribute('aAxis', new THREE.Float32BufferAttribute(axes, 3));
    geo.setAttribute('aSwing', new THREE.Float32BufferAttribute(swing, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
    const m = town.materials.signs.clone();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = SHARED.uTime; sh.uniforms.uWind = SHARED.uWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aPivot; attribute vec3 aAxis; attribute float aSwing; attribute float aPhase; uniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          if ( aSwing > 0.5 ) {
            float ang = sin( uTime * 1.9 + aPhase ) * 0.16 * uWind;
            vec3 r = transformed - aPivot; vec3 k = normalize( aAxis );
            float c = cos( ang ), s = sin( ang );
            transformed = aPivot + r * c + cross( k, r ) * s + k * dot( k, r ) * ( 1.0 - c );
          }`);
    };
    m.customProgramCacheKey = () => 'swingSign';
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    scene.add(mesh);
    life.signsMesh = mesh;
  }

  // ---- flag on the town hall ----
  if (sp.flag) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#2f5a3c'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = '#e8e2cc'; g.beginPath(); g.moveTo(40, 130); g.lineTo(110, 40); g.lineTo(150, 95); g.lineTo(175, 65); g.lineTo(220, 130); g.fill();
    g.fillStyle = '#2f5a3c'; g.beginPath(); g.moveTo(98, 70); g.lineTo(110, 54); g.lineTo(122, 70); g.fill();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(2.4, 1.5, 16, 8).translate(1.2, 0, 0);
    const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = SHARED.uTime; sh.uniforms.uWind = SHARED.uWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fx = position.x / 2.4;
          transformed.z += sin( position.x * 2.6 - uTime * 6.0 * uWind ) * 0.22 * fx;
          transformed.y -= fx * fx * 0.12;`);
    };
    m.customProgramCacheKey = () => 'flag';
    const flag = new THREE.Mesh(geo, m);
    flag.position.set(sp.flag.x, sp.flag.y + 4.6, sp.flag.z);
    flag.rotation.y = Math.PI / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 6, 6), new THREE.MeshStandardMaterial({ color: 0xd0ccc0, roughness: 0.5 }));
    pole.position.set(sp.flag.x, sp.flag.y + 2.6, sp.flag.z);
    scene.add(flag, pole);
  }

  // ---- downed power line ----
  if (sp.spark) {
    const g = new THREE.BufferGeometry();
    const a = sp.spark.top, b = [sp.spark.x, sp.spark.y, sp.spark.z];
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const p = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * 1.2, a[2] + (b[2] - a[2]) * t];
      pts.push(...p(i / 10), ...p((i + 1) / 10));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x18181a })));
    life.sparkT = 1;
  }

  // ---- the car leaking fuel ----
  if (sp.fuelCar) {
    const f = sp.fuelCar;
    const buf = new GeoBuf();
    PR.car({ trim: buf }, () => {}, 0, 0, 0, 0, [0.48, 0.38, 0.22], { buf });
    const mesh = new THREE.Mesh(buf.geometry(), town.materials.trim.clone());
    mesh.position.set(f.x, f.y, f.z);
    mesh.rotation.y = f.rot;
    mesh.castShadow = true;
    scene.add(mesh);
    life.fuel = { mesh, hp: 7, burning: 0, dead: false, pos: new THREE.Vector3(f.x, f.y + 0.8, f.z) };
  }

  // a real flickering light at the burning car (desktop only)
  if (sp.burningCar && opts.fireLight) {
    life.fireLight = new THREE.PointLight(0xff8a3a, 0, 16, 1.8);
    life.fireLight.position.set(sp.burningCar.x, sp.burningCar.y + 1.6, sp.burningCar.z);
    scene.add(life.fireLight);
  }

  // broken window overlays
  const HOLES = 48;
  const holeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: softTexture('hole'), transparent: true, alphaTest: 0.4, depthWrite: true, color: 0x0a0b0c }), HOLES);
  holeMesh.count = 0;
  scene.add(holeMesh);

  // ------------------------------------------------------------ helpers --

  const near = (p, r) => (p.x - cam.position.x) ** 2 + (p.z - cam.position.z) ** 2 < r * r;
  const distTo = (x, z) => Math.hypot(x - cam.position.x, z - cam.position.z);

  function burn(x, y, z, dt, big) {
    const fire = big ? 26 : 14, puffs = big ? 9 : 5;
    if (Math.random() < fire * dt) glow.spawn(x + (Math.random() - 0.5) * 1.6, y, z + (Math.random() - 0.5) * 1.2, 0, 2.6, 0, 0.55, 0.7, 0.2, 2.6, 1.0, 0.3, 0.8);
    if (Math.random() < puffs * dt) smoke.spawn(x + (Math.random() - 0.5), y + 0.8, z + (Math.random() - 0.5), 0.5, 1.6, 0.2, 5.5, 0.9, 4.5, 0.12, 0.11, 0.1, 0.55, 0, 0.1);
    if (Math.random() < 3 * dt && distTo(x, z) < 25) audio.townSfx.fireCrackle(Math.max(0, 1 - distTo(x, z) / 25));
  }

  function shatter(b, w, hitPoint) {
    const key = b.x.toFixed(1) + ',' + b.z.toFixed(1) + ',' + w.f + ',' + w.u.toFixed(1) + ',' + w.y.toFixed(1);
    if (life.broken.has(key)) return false;
    life.broken.add(key);
    // glass shards falling out of the frame
    for (let i = 0; i < 16; i++) {
      smoke.spawn(hitPoint.x, hitPoint.y + (Math.random() - 0.3) * w.h * 0.5, hitPoint.z,
        (Math.random() - 0.5) * 2.2, Math.random() * 1.5, (Math.random() - 0.5) * 2.2,
        0.9 + Math.random() * 0.5, 0.06, 0.04, 0.75, 0.85, 0.9, 0.9, 9.8, 0.2);
    }
    if (holeMesh.count < HOLES) {
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const fn = { f: [0, 1], b: [0, -1], r: [1, 0], l: [-1, 0] }[w.f];
      const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
      const nx = fn[0] * cs + fn[1] * sn, nz = -fn[0] * sn + fn[1] * cs;
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, 0, nz));
      m4.compose(new THREE.Vector3(hitPoint.x + nx * 0.035, w.y, hitPoint.z + nz * 0.035), q, new THREE.Vector3(w.w * 0.95, w.h * 0.95, 1));
      holeMesh.setMatrixAt(holeMesh.count++, m4);
      holeMesh.instanceMatrix.needsUpdate = true;
    }
    audio.spatial.glass(hitPoint.x, hitPoint.y, hitPoint.z);
    return true;
  }

  // Which window (if any) a bullet hit on building b at world point p.
  function windowAt(b, p) {
    if (!b.windows || !b.windows.length) return null;
    const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
    const dx = p.x - b.x, dz = p.z - b.z;
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
    const eps = 0.25;
    let f, u;
    if (Math.abs(lz - b.d / 2) < eps) { f = 'f'; u = lx; }
    else if (Math.abs(lz + b.d / 2) < eps) { f = 'b'; u = -lx; }
    else if (Math.abs(lx - b.w / 2) < eps) { f = 'r'; u = -lz; }
    else if (Math.abs(lx + b.w / 2) < eps) { f = 'l'; u = lz; }
    else return null;
    for (const w of b.windows) {
      if (w.f === f && !w.real && Math.abs(u - w.u) < w.w / 2 && Math.abs(p.y - w.y) < w.h / 2) return w;
    }
    return null;
  }

  function explodeFuelCar() {
    const F = life.fuel;
    if (!F || F.dead) return;
    F.dead = true;
    F.burning = 45;
    const p = F.pos;
    game.fx.explode(p, 0xffa040);
    game.fx.addShake(0.06);
    for (let i = 0; i < 40; i++) glow.spawn(p.x, p.y, p.z, (Math.random() - 0.5) * 12, Math.random() * 9, (Math.random() - 0.5) * 12, 0.7, 1.2, 0.3, 3, 1.4, 0.4, 1, 6, 0.5);
    for (let i = 0; i < 18; i++) smoke.spawn(p.x, p.y + 1, p.z, (Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5, 4 + Math.random() * 3, 1.5, 6, 0.1, 0.09, 0.08, 0.7, 0, 0.6);
    audio.spatial.explosion(p.x, p.y, p.z);
    F.mesh.material.color.setRGB(0.12, 0.11, 0.1);
    F.mesh.rotation.z = 0.08; F.mesh.position.y += 0.05;
    // blast damage
    const R = 7;
    const ps = game.player.state;
    const dp = Math.hypot(ps.x - p.x, ps.y + 1 - p.y, ps.z - p.z);
    if (dp < R) game.hurt(90 * (1 - dp / R));
    for (const r of game.robots) {
      if (r.dead) continue;
      const d = r.root.position.distanceTo(p);
      if (d < R) {
        const res = r.damage(220 * (1 - d / R), 'body');
        if (res && res.killed) game.registerKill(r, false, r.root.position.clone());
      }
    }
    life.onExplode && life.onExplode(p);
  }

  // ------------------------------------------------------------- public --

  life.setRain = (on) => {
    life.raining = on;
    rain.visible = on; rings.visible = on;
    audio.setRain(on);
  };

  // Called by Game for every bullet that stops on town geometry. Returns true
  // when the hit was fully handled here (a window shattering).
  life.onBulletHit = (hit) => {
    const c = hit.col;
    if (!c) return false;
    if (c.surf === 'car') {
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      const a = life.alarms.find((q) => Math.abs(q.x - cx) < 0.5 && Math.abs(q.z - cz) < 0.5);
      if (!a) {
        life.alarms.push({ x: cx, z: cz, y: c.bottom + 1.2, t: 8, ex: (c.maxX - c.minX) / 2, ez: (c.maxZ - c.minZ) / 2 });
        audio.spatial.alarm(cx, 1, cz);
        game.alertNear && game.alertNear(new THREE.Vector3(cx, 0, cz), 30, false);
      }
      return false;
    }
    if (c.surf === 'fuelcar' && life.fuel && !life.fuel.dead) {
      life.fuel.hp--;
      glow.spawn(hit.point.x, hit.point.y, hit.point.z, 0, 0.5, 0, 0.12, 0.4, 0.2, 2, 1.6, 0.6, 1);
      if (life.fuel.hp <= 0) explodeFuelCar();
      return false;
    }
    if (c.ref && c.surf !== 'metal') {
      const w = windowAt(c.ref, hit.point);
      if (w) return shatter(c.ref, w, hit.point);
    }
    return false;
  };

  life.onShot = (pos) => {
    // birds scatter from gunfire within 70 m
    const B = life.birds;
    if (B && Math.hypot(pos.x - B.list[0].home.x, pos.z - B.list[0].home.z) < 70 && B.list.some((b) => b.state === 'perch')) {
      for (const b of B.list) {
        if (b.state !== 'perch') continue;
        b.state = 'flee'; b.t = 0;
        b.v.set((Math.random() - 0.5) * 8, 5 + Math.random() * 3, (Math.random() - 0.5) * 8);
      }
      audio.townSfx.birds(Math.max(0.2, 1 - distTo(B.list[0].home.x, B.list[0].home.z) / 70));
    }
  };

  life.update = (dt) => {
    life.t += dt;
    const cp = cam.position;
    const indoor = !!(town.indoorAt(cp.x, cp.z, cp.y - 1.6) || game.player.inVoid(cp.x, cp.z));

    // rain and splashes
    if (life.raining) {
      rainMat.uniforms.uCam.value.copy(cp);
      rain.visible = !indoor;
      audio.rainLevel(indoor ? 0.35 : 1);
      if (!indoor) {
        for (let k = 0; k < 6; k++) {
          const x = cp.x + (Math.random() - 0.5) * 24, z = cp.z + (Math.random() - 0.5) * 24;
          if (game.grid.query(x, z, x, z).some((c) => c.top > cp.y + 1 && c.bottom < cp.y)) continue;
          const y = game.surfaceH(x, z) + 0.1;
          const i = ringHead; ringHead = (ringHead + 1) % RINGS;
          ringPos[i * 3] = x; ringPos[i * 3 + 1] = y; ringPos[i * 3 + 2] = z;
          ringAge.array[i] = 0;
        }
      }
      for (let i = 0; i < RINGS; i++) {
        if (ringAge.array[i] < 1) ringAge.array[i] = Math.min(1, ringAge.array[i] + dt * 2.2);
        M4.makeTranslation(ringPos[i * 3], ringPos[i * 3 + 1], ringPos[i * 3 + 2]);
        rings.setMatrixAt(i, M4);
      }
      rings.instanceMatrix.needsUpdate = true;
      ringAge.needsUpdate = true;
    }

    // litter: blown along the wind, gusting
    const wind = (SHARED.uWind ? SHARED.uWind.value : 1);
    const gust = 0.5 + 0.5 * Math.sin(life.t * 0.37) * Math.sin(life.t * 0.13 + 1);
    for (let i = 0; i < LN; i++) {
      const L = litter[i];
      if (L.y < -900 || Math.abs(L.x - cp.x) > 30 || Math.abs(L.z - cp.z) > 30) {
        L.x = cp.x - 25 + Math.random() * 10; L.z = cp.z + (Math.random() - 0.5) * 50;
        L.y = game.surfaceH(L.x, L.z) + 0.05; L.vy = 0;
      }
      const g = game.surfaceH(L.x, L.z) + 0.03;
      const sp2 = (0.6 + gust * 2.8) * wind;
      const nx = L.x + sp2 * dt, nz = L.z + Math.sin(life.t * 0.8 + i) * 0.6 * dt;
      // stop against walls
      if (!game.grid.query(nx, nz, nx, nz).some((c) => c.top > L.y + 0.3 && c.bottom < L.y)) { L.x = nx; L.z = nz; }
      if (gust > 0.75 && Math.random() < dt * 0.8) L.vy = 1.5 + Math.random() * 1.5;
      L.vy -= 3.5 * dt;
      L.y = Math.max(g, L.y + L.vy * dt);
      const air = L.y > g + 0.02;
      if (air) { L.rx += L.spin * dt * 3; L.ry += L.spin * dt * 2; }
      EU.set(air ? L.rx : -Math.PI / 2, L.ry, 0);
      Q.setFromEuler(EU);
      tmp.set(L.x, L.y, L.z);
      M4.compose(tmp, Q, ONE);
      litterMesh.setMatrixAt(i, M4);
    }
    litterMesh.instanceMatrix.needsUpdate = true;

    // dust motes in daylight indoors
    dust.visible = indoor && SHARED.uDay.value > 0.3;
    if (dust.visible) {
      for (let i = 0; i < DN; i++) {
        const s = dustSeed;
        dustPos[i * 3] = cp.x - 4 + ((s[i * 3] * 8 + Math.sin(life.t * 0.2 + i) * 0.3) % 8 + 8) % 8;
        dustPos[i * 3 + 1] = cp.y - 1.2 + ((s[i * 3 + 1] * 2.6 + life.t * 0.03) % 2.6);
        dustPos[i * 3 + 2] = cp.z - 4 + ((s[i * 3 + 2] * 8 + Math.cos(life.t * 0.17 + i) * 0.3) % 8 + 8) % 8;
      }
      dustGeo.attributes.position.needsUpdate = true;
    }

    // steam from the nearest drains
    let steamed = 0;
    for (const d of sp.drains) {
      if (steamed > 5 || !near(d, 55)) continue;
      steamed++;
      if (Math.random() < dt * 2.2) smoke.spawn(d.x + (Math.random() - 0.5) * 0.4, d.y, d.z + (Math.random() - 0.5) * 0.4, 0.15 * wind, 0.7, 0, 3.2, 0.5, 2.4, 0.86, 0.86, 0.86, 0.22, 0, 0.05);
    }

    // the burning car on Main Street
    if (sp.burningCar && near(sp.burningCar, 120)) {
      burn(sp.burningCar.x, sp.burningCar.y + 0.9, sp.burningCar.z, dt, false);
      if (life.fireLight) life.fireLight.intensity = 14 + Math.sin(life.t * 17) * 4 + Math.sin(life.t * 31) * 3;
    } else if (life.fireLight) life.fireLight.intensity = 0;
    if (life.fuel && life.fuel.burning > 0) {
      life.fuel.burning -= dt;
      burn(life.fuel.pos.x, life.fuel.pos.y, life.fuel.pos.z, dt, true);
    }

    // sparks from the downed line
    if (sp.spark && near(sp.spark, 40)) {
      life.sparkT -= dt;
      if (life.sparkT <= 0) {
        life.sparkT = 0.4 + Math.random() * 2.4;
        tmp.set(sp.spark.x, sp.spark.y + 0.1, sp.spark.z);
        game.fx.sparkBurst(tmp, UP, 12);
        glow.spawn(tmp.x, tmp.y + 0.2, tmp.z, 0, 0, 0, 0.12, 1.4, 0.4, 2.2, 2.6, 3.0, 1);
        audio.townSfx.spark(Math.max(0, 1 - distTo(tmp.x, tmp.z) / 40));
      }
    }

    // car alarms: flashing indicators until they time out
    for (let i = life.alarms.length - 1; i >= 0; i--) {
      const a = life.alarms[i];
      a.t -= dt;
      if (a.t <= 0) { life.alarms.splice(i, 1); continue; }
      if (Math.floor(a.t * 2) !== Math.floor((a.t + dt) * 2) && Math.floor(a.t * 2) % 2 === 0) {
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) glow.spawn(a.x + sx * a.ex, a.y - 0.5, a.z + sz * a.ez, 0, 0, 0, 0.35, 0.5, 0.5, 2.6, 1.4, 0.2, 1);
      }
    }

    // birds
    const B = life.birds;
    if (B) {
      for (let i = 0; i < B.list.length; i++) {
        const b = B.list[i];
        b.t += dt;
        if (b.state === 'flee') {
          b.p.addScaledVector(b.v, dt);
          b.v.y = Math.max(0.5, b.v.y - dt * 1.5);
          if (b.t > 2.5) { b.state = 'circle'; b.t = 0; }
        } else if (b.state === 'circle') {
          b.ang += dt * (0.5 + (i % 3) * 0.1);
          const tx = b.home.x + Math.cos(b.ang) * b.rad, tz = b.home.z + Math.sin(b.ang) * b.rad, ty = b.home.y + b.alt;
          b.p.x += (tx - b.p.x) * dt * 1.2; b.p.y += (ty - b.p.y) * dt; b.p.z += (tz - b.p.z) * dt * 1.2;
          if (b.t > 16 + (i % 5) * 2) { b.state = 'land'; b.t = 0; }
        } else if (b.state === 'land') {
          b.p.lerp(b.home, Math.min(1, dt * 0.8));
          if (b.p.distanceTo(b.home) < 0.15) { b.p.copy(b.home); b.state = 'perch'; }
        }
        const flying = b.state !== 'perch';
        const flap = flying ? Math.sin(life.t * 18 + b.phase) : 0.2;
        const heading = flying ? Math.atan2(b.p.x - b.home.x, b.p.z - b.home.z) + Math.PI / 2 : b.phase;
        Q.setFromAxisAngle(UP, heading);
        SC.set(1, flap, 1);
        M4.compose(b.p, Q, SC);
        B.mesh.setMatrixAt(i, M4);
      }
      B.mesh.instanceMatrix.needsUpdate = true;
    }

    smoke.update(dt);
    glow.update(dt);
  };

  life.explodeFuelCar = explodeFuelCar;
  life.windowAt = windowAt;
  life.pools = { smoke, glow };
  return life;
}
