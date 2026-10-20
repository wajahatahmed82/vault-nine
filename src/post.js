import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Post-processing, switchable per preset.
//
//   off   -- the scene renders straight to the screen (phones, LOW).
//   light -- HDR target, tone mapping, colour grade + vignette, FXAA.
//   full  -- light + bloom. The bloom threshold sits above 1.0 in linear HDR,
//            so only lamp heads, lit windows, fire and muzzle flash bloom;
//            sunlit walls never do.
//
// The game's two-pass render (world, then the weapon over a cleared depth
// buffer) runs inside the composer's first pass, so the weapon gets the same
// grade and the muzzle flash blooms.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.05 }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3(0, 0, 0) },
    uVig: { value: 0.28 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat; uniform vec3 uGain; uniform vec3 uLift; uniform float uVig;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb;
      float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
      c = mix( vec3( l ), c, uSat );
      c = c * uGain + uLift * ( 1.0 - c );
      float v = smoothstep( 0.95, 0.3, distance( vUv, vec2( 0.5 ) ) );
      c *= mix( 1.0 - uVig, 1.0, v );
      gl_FragColor = vec4( c, 1.0 );
    }`,
};

// Camera effects (screenfx.js): RGB split, suppression blur and directional
// vignette, red hurt edge, low-health desaturation, flashbang white-out.
const EffectsShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSupp: { value: 0 }, uDir: { value: new THREE.Vector2() }, uHurt: { value: 0 },
    uChroma: { value: 0 }, uDesat: { value: 0 }, uFlash: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSupp; uniform vec2 uDir; uniform float uHurt;
    uniform float uChroma; uniform float uDesat; uniform float uFlash;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length( c );
      float ca = uChroma * 0.018 * r;
      vec3 col = vec3( texture2D( tDiffuse, vUv + c * ca ).r, texture2D( tDiffuse, vUv ).g, texture2D( tDiffuse, vUv - c * ca ).b );
      if ( uSupp > 0.01 ) {
        // a radial smear that leaves the centre sharp
        float k = uSupp * 0.05 * smoothstep( 0.12, 0.6, r );
        vec3 acc = col;
        for ( int i = 1; i < 6; i ++ ) acc += texture2D( tDiffuse, vUv - c * k * float( i ) / 5.0 ).rgb;
        col = acc / 6.0;
      }
      float side = clamp( dot( c / max( r, 1e-4 ), uDir ), 0.0, 1.0 );
      col *= 1.0 - smoothstep( 0.22, 0.75, r ) * uSupp * ( 0.5 + 0.5 * side ) * 0.8;
      col = mix( col, vec3( 0.5, 0.03, 0.02 ), smoothstep( 0.3, 0.8, r ) * uHurt * 0.6 );
      float l = dot( col, vec3( 0.299, 0.587, 0.114 ) );
      col = mix( col, vec3( l ) * vec3( 0.98, 0.97, 1.0 ), uDesat );
      col = mix( col, vec3( 1.0 ), uFlash );
      gl_FragColor = vec4( col, 1.0 );
    }`,
};

// Ambient occlusion from the world pass's depth alone (no extra scene render):
// view positions are rebuilt from depth, the normal from their derivatives,
// and eight taps on a rotated disc look for nearby geometry in front of the
// surface. Half resolution, then multiplied into the frame with a small blur,
// before the weapon is drawn. HIGH and ULTRA only.
const AOShader = {
  uniforms: {
    tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uProj: { value: new THREE.Matrix4() },
    uRadius: { value: 0.8 }, uStrength: { value: 1.6 }, uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
  fragmentShader: `uniform sampler2D tDepth; uniform mat4 uProjInv; uniform mat4 uProj; uniform float uRadius; uniform float uStrength; uniform vec2 uRes;
    varying vec2 vUv;
    vec3 viewPos( vec2 uv ) {
      float d = texture2D( tDepth, uv ).x;
      vec4 v = uProjInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
      return v.xyz / v.w;
    }
    void main() {
      float d0 = texture2D( tDepth, vUv ).x;
      if ( d0 >= 0.99999 ) { gl_FragColor = vec4( 1.0 ); return; }
      vec3 P = viewPos( vUv );
      if ( -P.z > 90.0 ) { gl_FragColor = vec4( 1.0 ); return; }
      vec3 N = normalize( cross( dFdx( P ), dFdy( P ) ) );
      // screen radius of uRadius metres at this depth
      float rs = uRadius * uProj[ 1 ][ 1 ] * 0.5 / -P.z;
      float ang = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831;
      float occ = 0.0;
      for ( int i = 0; i < 8; i ++ ) {
        float fi = float( i );
        float a = ang + fi * 2.3999;
        float rr = rs * ( 0.25 + 0.75 * ( fi + 0.5 ) / 8.0 );
        vec2 uv = vUv + vec2( cos( a ), sin( a ) ) * rr * vec2( uRes.y / uRes.x, 1.0 );
        vec3 S = viewPos( uv );
        vec3 v = S - P;
        float dist = length( v );
        occ += max( 0.0, dot( N, v / max( dist, 1e-4 ) ) - 0.12 ) * ( 1.0 - smoothstep( uRadius, uRadius * 2.5, dist ) );
      }
      float ao = clamp( 1.0 - uStrength * occ / 8.0, 0.0, 1.0 );
      // fade out with distance so far hills are untouched
      ao = mix( ao, 1.0, smoothstep( 40.0, 90.0, -P.z ) );
      gl_FragColor = vec4( vec3( ao ), 1.0 );
    }`,
};

const AOBlendShader = {
  uniforms: { tAO: { value: null }, uTexel: { value: new THREE.Vector2() } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
  fragmentShader: `uniform sampler2D tAO; uniform vec2 uTexel; varying vec2 vUv;
    void main() {
      float a = texture2D( tAO, vUv ).r * 0.4;
      a += texture2D( tAO, vUv + vec2( uTexel.x, 0.0 ) ).r * 0.15;
      a += texture2D( tAO, vUv - vec2( uTexel.x, 0.0 ) ).r * 0.15;
      a += texture2D( tAO, vUv + vec2( 0.0, uTexel.y ) ).r * 0.15;
      a += texture2D( tAO, vUv - vec2( 0.0, uTexel.y ) ).r * 0.15;
      gl_FragColor = vec4( vec3( a ), 1.0 );
    }`,
};

// `bloom` is the threshold: by day sunlit pale paving goes past 1.0 and
// would glow, so only lights (and the sun) are allowed over it.
export const GRADES = {
  day: { sat: 1.06, gain: [1.0, 1.0, 1.0], lift: [0.0, 0.0, 0.01], vig: 0.22, bloom: 1.9 },
  dusk: { sat: 1.1, gain: [1.05, 0.99, 0.93], lift: [0.02, 0.0, 0.02], vig: 0.3, bloom: 1.2 },
  night: { sat: 0.82, gain: [0.92, 0.98, 1.1], lift: [0.0, 0.01, 0.03], vig: 0.38, bloom: 1.0 },
};

class GamePass extends Pass {
  constructor(game) { super(); this.game = game; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) { this.game.renderScene(readBuffer); }
}

export function createPost(renderer, game) {
  const composer = new EffectComposer(renderer);
  const gamePass = new GamePass(game);
  const size = new THREE.Vector2(800, 600);
  const bloom = new UnrealBloomPass(new THREE.Vector2(400, 300), 0.6, 0.35, 1.05);
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  const effects = new ShaderPass(EffectsShader);
  effects.enabled = false;
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(gamePass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  composer.addPass(effects);
  composer.addPass(fxaa);

  // depth for AO: the world pass renders into one of these
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height);
    rt.depthTexture.type = THREE.UnsignedIntType;
  }
  const aoRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.UnsignedByteType, depthBuffer: false });
  const aoMat = new THREE.ShaderMaterial({ ...AOShader, uniforms: THREE.UniformsUtils.clone(AOShader.uniforms), depthTest: false, depthWrite: false });
  const aoQuad = new FullScreenQuad(aoMat);
  // dst * src: darkens the frame by the AO term
  const blendMat = new THREE.ShaderMaterial({
    ...AOBlendShader, uniforms: THREE.UniformsUtils.clone(AOBlendShader.uniforms),
    depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
  });
  const blendQuad = new FullScreenQuad(blendMat);

  const post = {
    mode: 'full',
    ao: false,
    composer,
    effects,
    // Called by Game.renderScene between the world and weapon passes.
    applyAO(target, camera) {
      if (!this.ao || this.mode === 'off' || !target || !target.depthTexture) return false;
      const u = aoMat.uniforms;
      u.tDepth.value = target.depthTexture;
      u.uProj.value.copy(camera.projectionMatrix);
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uRes.value.set(aoRT.width, aoRT.height);
      const auto = renderer.autoClear;
      renderer.setRenderTarget(aoRT);
      aoQuad.render(renderer);
      renderer.setRenderTarget(target);
      renderer.autoClear = false;
      blendMat.uniforms.tAO.value = aoRT.texture;
      blendMat.uniforms.uTexel.value.set(1 / aoRT.width, 1 / aoRT.height);
      blendQuad.render(renderer);
      renderer.autoClear = auto;
      return true;
    },
    setEffects(o, dir) {
      if (!o) { effects.enabled = false; return; }
      const on = o.supp > 0.005 || o.hurt > 0.005 || o.chroma > 0.005 || o.desat > 0.005 || o.flash > 0.005;
      effects.enabled = on;
      if (!on) return;
      const u = effects.uniforms;
      u.uSupp.value = o.supp; u.uHurt.value = o.hurt; u.uChroma.value = o.chroma;
      u.uDesat.value = o.desat; u.uFlash.value = o.flash;
      u.uDir.value.set(dir.x, dir.y);
    },
    setMode(m) {
      this.mode = m;
      bloom.enabled = m === 'full';
    },
    setGrade(name) {
      const G = GRADES[name] || GRADES.dusk;
      grade.uniforms.uSat.value = G.sat;
      grade.uniforms.uGain.value.set(...G.gain);
      grade.uniforms.uLift.value.set(...G.lift);
      grade.uniforms.uVig.value = G.vig;
      bloom.threshold = G.bloom;
    },
    setSize(w, h, pr) {
      size.set(w, h);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      aoRT.setSize(Math.max(1, Math.round(w * pr / 2)), Math.max(1, Math.round(h * pr / 2)));
      bloom.resolution.set(w * pr / 2, h * pr / 2);
    },
    render(dt) {
      if (this.mode === 'off') { game.renderScene(null); return; }
      composer.render(dt);
    },
  };
  post.setMode('full');
  post.setGrade('dusk');
  return post;
}
