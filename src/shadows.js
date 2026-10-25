import * as THREE from 'three';

// Two shadow cascades for the sun.
//
// The sun's own shadow map covers a 64 m square round the player at high
// resolution. A second directional light with no brightness of its own casts a
// wide, coarser map (340 m) that is refreshed only every few frames. One patch
// to three's light loop blends the two for the sun: inside the near square the
// sharp map, fading at its edge into the far one -- so shadows reach down whole
// streets instead of stopping 46 m away. When the far light is off (LOW,
// phones) the loop is three's own, untouched.
//
// Both cascades are snapped to whole shadow-map texels as the player moves,
// or every shadow edge would crawl.

const LOOP_SHADOW = 'directionalLightShadow = directionalLightShadows[ i ];\n\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';

const CASCADED = `directionalLightShadow = directionalLightShadows[ i ];
		#if ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 0 )
		{
			vec3 nc = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
			float edge = min( min( nc.x, 1.0 - nc.x ), min( nc.y, 1.0 - nc.y ) );
			float wNear = smoothstep( 0.0, 0.1, edge ) * step( nc.z, 1.0 );
			float sNear = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
			float sFar = getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] );
			directLight.color *= ( directLight.visible && receiveShadow ) ? mix( sFar, sNear, wNear ) : 1.0;
		}
		#elif ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 1 )
			// the far cascade's own light is black: nothing to shade
		#else
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

const chunk = THREE.ShaderChunk.lights_fragment_begin;
if (!chunk.includes(LOOP_SHADOW)) throw new Error('shadows.js: three.js light loop changed; update the cascade patch');
THREE.ShaderChunk.lights_fragment_begin = chunk.replace(LOOP_SHADOW, CASCADED);

export const NEAR_HALF = 32, FAR_HALF = 170;

// The far cascade: added after the sun so three orders it second.
export function addFarCascade(scene, sun) {
  const far = new THREE.DirectionalLight(0xffffff, 0);
  far.castShadow = true;
  far.shadow.mapSize.set(2048, 2048);
  const c = far.shadow.camera;
  c.left = -FAR_HALF; c.right = FAR_HALF; c.top = FAR_HALF; c.bottom = -FAR_HALF;
  c.near = 1; c.far = 700;
  far.shadow.bias = -0.0006;
  far.shadow.normalBias = 0.12;
  far.shadow.radius = 2.5;          // softer far away
  far.shadow.intensity = 0.85;
  far.shadow.autoUpdate = false;    // refreshed every few frames by the game
  far.name = 'sunFarCascade';
  scene.add(far, far.target);
  // the near cascade gets tighter and sharper
  const n = sun.shadow.camera;
  n.left = -NEAR_HALF; n.right = NEAR_HALF; n.top = NEAR_HALF; n.bottom = -NEAR_HALF;
  n.updateProjectionMatrix();
  return far;
}

const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _dir = new THREE.Vector3(), _t = new THREE.Vector3();
// Put a directional light's shadow box round `center`, `dist` back along
// `dir`, with the centre snapped to whole texels in the light's own plane.
export function placeSnapped(light, center, dir, dist, half) {
  _dir.copy(dir).normalize();
  _right.set(0, 1, 0).cross(_dir);
  if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
  _right.normalize();
  _up.copy(_dir).cross(_right).normalize();
  const texel = (half * 2) / light.shadow.mapSize.width;
  const r = Math.round(center.dot(_right) / texel) * texel;
  const u = Math.round(center.dot(_up) / texel) * texel;
  const f = center.dot(_dir);
  _t.copy(_right).multiplyScalar(r).addScaledVector(_up, u).addScaledVector(_dir, f);
  light.target.position.copy(_t);
  light.position.copy(_t).addScaledVector(_dir, dist);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}
