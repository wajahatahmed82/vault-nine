import * as THREE from 'three';
import { TOUCH_ONLY } from './input.js';

// Town materials: shader patches on MeshStandardMaterial, so the town keeps
// three.js lighting, shadows, fog and the environment map, and only adds what
// stock materials cannot do.
//
//   * arrayMaterial: albedo, normal and roughness from texture-array layers
//     chosen per vertex, plus baked contact shadow at the foot of every wall
//     (darkens the bottom 1.6 m, which is what makes a building sit on the
//     ground instead of floating on it).
//   * interiorGlass: a fake room behind every window (interior mapping): a
//     ray from the eye is intersected with a box room in tangent space, so
//     walls, floor and ceiling shift with parallax as you move. Lit or dark
//     per window, brighter at night.
//
// SHARED holds the time-of-day uniforms every patched material reads.

export const SHARED = {
  uDay: { value: 1 },       // 1 daylight .. 0 night
  uNight: { value: 0 },     // 0 day .. 1 night (window and sign lighting)
  uTime: { value: 0 },
  uWet: { value: 0 },
};

const dummy = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
dummy.needsUpdate = true;
const dummyN = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
dummyN.needsUpdate = true;

// Parallax occlusion: each array layer carries height in its albedo alpha,
// and walls, roofs and paving are stepped into along the view ray so joints,
// courses and slab edges have real depth as you move past. `depths` gives the
// depth per layer in texture units (metres of relief / metres per repeat);
// 0 skips the march. Faded out from 14 to 24 m, where it stops showing, and
// left out entirely on phones.
const POM = !TOUCH_ONLY;
const POM_SRC = `
  {
    int li = int( vLayer + 0.5 );
    float depth = uDepth[ li ];
    float fade = 1.0 - smoothstep( 14.0, 24.0, length( vViewPosition ) );
    if ( depth > 0.0 && fade > 0.0 ) {
      mat3 tf = getTangentFrame( - vViewPosition, normalize( vNormal ), vMapUv );
      vec3 V = normalize( vViewPosition );
      vec3 vt = normalize( vec3( dot( V, tf[ 0 ] ), dot( V, tf[ 1 ] ), dot( V, tf[ 2 ] ) ) );
      vec2 gx = dFdx( vMapUv ), gy = dFdy( vMapUv );
      float n = mix( 14.0, 5.0, abs( vt.z ) );
      float stp = 1.0 / n;
      vec2 dUv = vt.xy / max( vt.z, 0.25 ) * depth * fade * stp;
      float cur = 0.0;
      vec2 uv = vMapUv;
      float d = 1.0 - textureGrad( tAlb, vec3( uv, vLayer ), gx, gy ).a;
      for ( int i = 0; i < 14; i ++ ) {
        if ( cur >= d ) break;
        uv -= dUv;
        d = 1.0 - textureGrad( tAlb, vec3( uv, vLayer ), gx, gy ).a;
        cur += stp;
      }
      vec2 prev = uv + dUv;
      float after = d - cur;
      float before = ( 1.0 - textureGrad( tAlb, vec3( prev, vLayer ), gx, gy ).a ) - cur + stp;
      pUv = mix( uv, prev, after / ( after - before + 1e-5 ) );
    }
  }`;

export function arrayMaterial(arr, opts = {}) {
  const wetLayer = opts.wetLayer ?? -1;
  const mossLayer = opts.mossLayer ?? -1;
  const depths = new Float32Array(16);
  if (opts.depths) depths.set(opts.depths.slice(0, 16));
  const pom = POM && !!opts.depths;
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 0,
    side: opts.side ?? THREE.FrontSide,
    map: dummy, normalMap: dummyN,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tAlb = { value: arr.albedo };
    sh.uniforms.tNR = { value: arr.normalRough };
    sh.uniforms.uWet = SHARED.uWet;
    sh.uniforms.uDepth = { value: depths };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float layer;\nattribute float aobase;\nvarying float vLayer;\nvarying float vAo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayer = layer;\nvAo = position.y - aobase;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray tAlb;\nuniform highp sampler2DArray tNR;\nuniform float uWet;\nuniform float uDepth[ 16 ];\nvarying float vLayer;\nvarying float vAo;')
      .replace('#include <map_fragment>', `vec2 pUv = vMapUv;
        ${pom ? POM_SRC : ''}
        vec4 sampledDiffuseColor = texture( tAlb, vec3( pUv, vLayer ) );
        diffuseColor *= vec4( sampledDiffuseColor.rgb, 1.0 );
        #if ${mossLayer} >= 0
        {
          // damp and moss creeping up from the foot of the wall, ragged edge
          float nz = texture( tAlb, vec3( vMapUv * 0.37, ${mossLayer}.0 ) ).g;
          float damp = 1.0 - smoothstep( 0.0, 0.8 + nz * 0.7, vAo );
          float moss = 1.0 - smoothstep( 0.0, 0.25 + nz * 0.55, vAo );
          diffuseColor.rgb *= mix( 1.0, 0.7, damp );
          diffuseColor.rgb = mix( diffuseColor.rgb, texture( tAlb, vec3( pUv * 1.3, ${mossLayer}.0 ) ).rgb, moss * moss * 0.7 );
        }
        #endif`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * texture( tNR, vec3( pUv, vLayer ) ).a;
        #if ${wetLayer} >= 0
        if ( uWet > 0.0 ) {
          // rain: everything darkens a little, the road goes glossy with puddles
          vec2 q = vMapUv * 1.3;
          vec2 i0 = floor( q ), f0 = fract( q ); f0 = f0 * f0 * ( 3.0 - 2.0 * f0 );
          float h00 = fract( sin( dot( i0, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
          float h10 = fract( sin( dot( i0 + vec2( 1, 0 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
          float h01 = fract( sin( dot( i0 + vec2( 0, 1 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
          float h11 = fract( sin( dot( i0 + vec2( 1, 1 ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
          float pn = mix( mix( h00, h10, f0.x ), mix( h01, h11, f0.x ), f0.y );
          float road = 1.0 - step( 0.5, abs( vLayer - ${wetLayer}.0 ) );
          float pud = smoothstep( 0.58, 0.74, pn ) * road;
          roughnessFactor = mix( roughnessFactor, mix( mix( 0.45, 0.25, road ), 0.03, pud ), uWet );
          diffuseColor.rgb *= mix( 1.0, mix( mix( 0.8, 0.6, road ), 0.35, pud ), uWet );
        }
        #endif`)
      .replace('texture2D( normalMap, vNormalMapUv )', 'texture( tNR, vec3( pUv, vLayer ) )')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float cao = mix( 0.5, 1.0, smoothstep( 0.0, 1.6, vAo ) );
        reflectedLight.indirectDiffuse *= cao;
        reflectedLight.indirectSpecular *= cao;
        reflectedLight.directDiffuse *= mix( 0.75, 1.0, cao );`);
  };
  m.customProgramCacheKey = () => 'townArray' + wetLayer + '|' + mossLayer + '|' + pom;
  return m;
}

export function interiorGlass() {
  const m = new THREE.MeshStandardMaterial({
    color: 0x0c0e10, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.3,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDay = SHARED.uDay;
    sh.uniforms.uNight = SHARED.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float win;\nvarying vec3 vTV;\nvarying vec2 vWUv;\nvarying float vWin;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 wN = normalize( normal );
        vec3 wT = normalize( cross( vec3( 0.0, 1.0, 0.0 ), wN ) );
        vec3 V = position - cameraPosition;
        vTV = vec3( dot( V, wT ), V.y, dot( V, wN ) );
        vWUv = uv; vWin = win;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDay;\nuniform float uNight;\nvarying vec3 vTV;\nvarying vec2 vWUv;\nvarying float vWin;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float shop = step( vWin, 0.0 );
          float id = abs( vWin );
          float h = fract( sin( id * 12.9898 ) * 43758.5453 );
          float h2 = fract( h * 7.13 + 0.17 );
          vec3 d = normalize( vTV );
          d.z = min( d.z, -0.05 );
          vec3 o = vec3( mix( 0.3, 0.05, shop ) + mix( 0.4, 0.9, shop ) * vWUv.x,
                         mix( 0.25, 0.05, shop ) + mix( 0.5, 0.85, shop ) * vWUv.y, 0.0 );
          float depth = mix( 0.9 + h * 0.8, 1.6, shop );
          float tx = d.x > 0.0 ? ( 1.0 - o.x ) / d.x : -o.x / min( d.x, -1e-4 );
          float ty = d.y > 0.0 ? ( 1.0 - o.y ) / d.y : -o.y / min( d.y, -1e-4 );
          float tz = -depth / d.z;
          float t = min( tx, min( ty, tz ) );
          vec3 p = o + d * t;
          vec3 wallC = mix( vec3( 0.58, 0.52, 0.44 ), vec3( 0.42, 0.46, 0.5 ), h2 );
          vec3 col = wallC * 0.9;
          if ( t == tz ) {
            col = wallC * 0.72;
            // a piece of furniture against the back wall
            if ( p.y < 0.3 + 0.12 * h && abs( p.x - 0.3 - 0.4 * h2 ) < 0.2 ) col *= 0.35;
            if ( shop > 0.5 && fract( p.y * 4.0 ) < 0.12 ) col *= 0.4;   // shelving
          } else if ( t == ty ) {
            col = d.y < 0.0 ? vec3( 0.34, 0.26, 0.19 ) * ( 0.8 + 0.3 * h ) : vec3( 0.72 );
          } else if ( shop > 0.5 && fract( p.y * 4.0 ) < 0.12 ) col *= 0.45;
          col *= mix( 0.45, 1.0, exp( p.z * 0.9 ) );
          if ( shop < 0.5 && h2 > 0.72 && vWUv.y > 0.5 )
            col = vec3( 0.72, 0.68, 0.6 ) * ( 0.75 + 0.25 * step( 0.5, fract( vWUv.y * 14.0 ) ) );
          float lit = step( 0.6, h ) * uNight;
          vec3 roomLight = mix( vec3( 0.06 ), vec3( 1.0, 0.8, 0.55 ) * 1.6, lit ) + uDay * 0.3;
          totalEmissiveRadiance += col * roomLight;
        }`);
  };
  m.customProgramCacheKey = () => 'townGlass';
  return m;
}

// Real glass for the buildings you can walk into: you see the actual room.
export function clearGlass() {
  return new THREE.MeshStandardMaterial({
    color: 0x9fb4bd, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22,
    depthWrite: false, envMapIntensity: 1.5, side: THREE.DoubleSide,
  });
}

export function signMaterial(atlas) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0 });
  m.userData.night = true;
  return m;
}
