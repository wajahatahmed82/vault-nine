import * as THREE from 'three';
import { CFG, PAL } from './config.js';
import { buildMaterials } from './materials.js';
import { buildFacility } from './facility.js';
import { buildTerrain, terrainH, SHELF, PLAY } from './terrain.js';
import { buildTown } from './town.js';
import { CollisionGrid } from './collide.js';

// Sky, light and ground for the campaign location. The building itself is
// built by facility.js; this file owns everything around it.
//
// Two hard rules, both learned from bugs:
//   1. Only two real lights touch the world. Everything that looks like a lamp
//      is emissive geometry, which costs nothing per pixel.
//   2. The spawn must have open ground in every direction. It is asserted at
//      the end of this file.

function gradientSky() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  grad.addColorStop(0.0, hex(PAL.skyTop));
  grad.addColorStop(0.55, hex(PAL.skyMid));
  grad.addColorStop(1.0, hex(PAL.skyLow));
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildScene(renderer) {
  const mats = buildMaterials();
  const scene = new THREE.Scene();

  const sky = gradientSky();
  scene.background = sky;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromEquirectangular(sky).texture;
  pmrem.dispose();
  // The environment map is the only light that reaches interiors without a
  // shadow test, so it carries the indoor fill. It must be neutral: a blue sky
  // here is what made every wall in the building read cold.
  scene.environmentIntensity = 1.15;
  scene.fog = new THREE.FogExp2(PAL.fog, 0.0062);

  // ---------------- light ----------------
  // Hemisphere fill lands in indirect diffuse, which the Lambert BRDF divides
  // by PI. It has to be large or every surface facing away from the key light
  // crushes to black.
  // Was 5.0 with a blue sky colour, which flooded the whole level with cold
  // fill. Lower and neutral now; the environment map makes up the difference.
  scene.add(new THREE.HemisphereLight(PAL.ambientSky, PAL.ambientGround, 2.6));

  const sun = new THREE.DirectionalLight(PAL.sun, 3.4);
  sun.position.set(-34, 34, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  const S = 46;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---------------- ground ----------------
  // The station shelf is asphalt, tiled in metres. Around it the terrain mesh
  // takes over: the shelf's quads are left out of the terrain, and this slab
  // covers exactly that hole.
  // Overlaps the terrain by 30 cm and sits 1 cm low: the terrain is still flat
  // at the edge, so the overlap hides under it and closes the hairline crack
  // where two meshes with different vertex spacing meet.
  const sw = SHELF.maxX - SHELF.minX + 0.6, sd = SHELF.maxZ - SHELF.minZ + 0.6;
  const groundGeo = new THREE.PlaneGeometry(sw, sd);
  const guv = groundGeo.attributes.uv;
  for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * sw / 7, guv.getY(i) * sd / 7);
  guv.needsUpdate = true;
  const ground = new THREE.Mesh(groundGeo, mats.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((SHELF.minX + SHELF.maxX) / 2, -0.01, (SHELF.minZ + SHELF.maxZ) / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  const terrain = buildTerrain(scene);
  const town = buildTown(scene, mats);

  // ---------------- the facility ----------------
  const f = buildFacility(scene, mats, PAL);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // Forward is (-sin(yaw), -cos(yaw)), so yaw 0 looks down -Z: from the car
  // park that faces the building, which is where the mission starts.
  const spawn = f.spawn;
  const pr = CFG.player.radius + 0.35;
  const conflicts = f.colliders.filter((c) =>
    spawn.x + pr > c.minX && spawn.x - pr < c.maxX &&
    spawn.z + pr > c.minZ && spawn.z - pr < c.maxZ && c.top > 0.5);
  if (conflicts.length) console.warn('spawn is inside cover', conflicts);

  // Town meshes are not raycast: bullets test the town's collider boxes and
  // the terrain height function instead, which costs a few boxes rather than
  // every triangle in a chunk.
  const blockers = f.statics.concat([ground]);
  const colliders = f.colliders.concat(town.colliders);
  const grid = new CollisionGrid(8);
  for (const c of colliders) grid.add(c);
  return {
    terrain, town, grid, terrainH, PLAY,
    surfaceH: town.surfaceH,
    scene, sun, blockers, mats, spawn,
    colliders,
    voids: f.voids,
    areas: f.areas,
    anchors: f.anchors,
    glowMesh: f.glowMesh,
    bounds: { L: -34, R: 34, N: -62, F: 42, WH: f.WALL_H },
  };
}
