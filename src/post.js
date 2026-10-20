import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
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
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(gamePass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);
  composer.addPass(fxaa);

  const post = {
    mode: 'full',
    composer,
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
