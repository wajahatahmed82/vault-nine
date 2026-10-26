import * as THREE from 'three';
import { CFG } from './config.js';
import { buildScene } from './scene.js';
import { Campaign } from './campaign.js';
import { Decals } from './decals.js';
import { WeaponSystem, VIEW_LAYER } from './weapons.js';
import { Player } from './player.js';
import { Robot, pickType, STATE as AI, GUN_CLASS } from './enemies.js';
import { FX } from './fx.js';
import { rayBox } from './collide.js';
import { buildNav } from './nav.js';
import { Gear } from './gear.js';
import { Vehicle } from './vehicle.js';
import { placeSnapped, NEAR_HALF, FAR_HALF } from './shadows.js';
import * as audio from './audio.js';
import * as settings from './settings.js';

const TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const STATE = { MENU: 'menu', PLAY: 'play', PAUSED: 'paused', OVER: 'over' };
export const MODE = { CAMPAIGN: 'campaign', SURVIVAL: 'survival', TIME: 'timeattack' };

// What each callout says, for the caption under the voice.
export const CALLOUT_TEXT = {
  contact: 'Contact!', reloading: 'Reloading!', manDown: 'Man down!', grenade: 'Grenade!',
  flash: 'Flashbang out!', search: "Where'd he go?",
};

export class Game {
  constructor(renderer, input, progression) {
    this.renderer = renderer;
    this.input = input;
    this.prog = progression;

    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.05, 400);

    const built = buildScene(renderer);
    this.scene = built.scene;
    this.blockers = built.blockers;
    this.colliders = built.colliders;
    this.sun = built.sun;
    this.sunFar = built.sunFar;
    this._farAt = new THREE.Vector3(1e9, 0, 0);
    this._farT = 0;
    this.spawnPoint = built.spawn;
    this.scene.add(this.camera);

    this.grid = built.grid;
    this.town = built.town;
    this.surfaceH = built.surfaceH;
    this.player = new Player(this.camera, this.colliders, built.spawn, built.voids,
      { surface: built.surfaceH, grid: built.grid, bounds: built.PLAY });
    this.areas = built.areas;
    this.anchors = built.anchors;
    this.voids = built.voids;
    this.mats = built.mats;
    this.glowMesh = built.glowMesh;
    this.powered = false;
    this.campaign = new Campaign(this);
    this.onPrompt = () => {};
    this.onDown = () => {};
    this.difficulty = 'normal';
    this.weapons = new WeaponSystem(this.camera, audio.sfx, built.mats, progression);
    // Casings land on whatever floor is under them -- y=0 left them hanging in
    // mid-air above the basement.
    this.weapons.floorAt = (x, z, hintY) => this.player.groundAt(x, z, (hintY === undefined ? 0 : hintY));
    this.fx = new FX(this.scene, this.camera);
    this.gear = new Gear(this);
    this.vehicle = new Vehicle(this);
    // one shared light that jumps to the latest enemy muzzle flash nearby
    this.enemyFlash = null;
    if (!TOUCH) {
      this.enemyFlash = new THREE.PointLight(0xffc27a, 0, 16, 2);
      this.scene.add(this.enemyFlash);
    }
    this.playBounds = built.PLAY;
    this.decals = new Decals(this.scene);
    // What each world material is made of, for impact marks, dust and sound.
    const M = built.mats;
    this.surface = new Map();
    for (const k of ['brick', 'painted', 'plaster', 'concreteFloor', 'asphalt', 'ceilingTile'])
      if (M[k]) this.surface.set(M[k], 'masonry');
    for (const k of ['steel', 'panel', 'paintMetal', 'rust', 'gunMetal'])
      if (M[k]) this.surface.set(M[k], 'metal');
    if (M.crate) this.surface.set(M.crate, 'wood');
    if (M.glass) this.surface.set(M.glass, 'glass');

    this.ray = new THREE.Raycaster();
    this.losRay = new THREE.Raycaster();
    this.losRay.far = 120;

    this.player.onFootstep = (s, stance) => audio.sfx.footstep(s, this.surfaceUnder(), stance, this.atmos && this.atmos.state.weather === 'rain' && !this.player.inVoid(this.player.state.x, this.player.state.z));
    this.player.onSlide = (on) => { if (on) audio.sfx.slide(); };
    this.player.onMantle = () => audio.sfx.mantle();
    this.player.onLand = () => audio.sfx.land();

    this.robots = [];
    this.state = STATE.MENU;
    this.mode = MODE.SURVIVAL;
    this.fovCurrent = settings.get('fov');
    this.losTick = 0;

    // HUD hooks
    this.onHit = () => {};
    this.onKill = () => {};
    this.onWave = () => {};
    this.onStateChange = () => {};
    this.onDamaged = () => {};
    this.onCombo = () => {};
    this.onLevelUp = () => {};

    this.applySettings();
    this.prewarm();
    this.reset();
  }

  // Build one of every archetype off-screen and compile its shaders, then throw
  // them away. Without this the first Marksman of a run costs a >100ms stall.
  prewarm() {
    const made = [];
    for (const type of Object.keys(CFG.robots)) {
      const r = new Robot(type, 0, -900, 1);
      this.scene.add(r.root);
      made.push(r);
    }
    this.scene.updateMatrixWorld(true);
    this.renderer.compile(this.scene, this.camera);
    for (const r of made) this.scene.remove(r.root);
  }

  applySettings() {
    this.player.sensMul = settings.get('sensitivity');
    this.input.invertY = settings.get('invertY');
    const fov = settings.get('fov');
    this.baseFov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  reset() {
    for (const r of this.robots) this.scene.remove(r.root);
    this.robots.length = 0;
    this.fx.clear();
    if (this.decals) this.decals.clear();
    this.player.reset();
    this.weapons.resetAll();

    this.score = 0;
    this.wave = 0;
    this.kills = 0;
    this.headshots = 0;
    this.elapsed = 0;
    this.hurtT = 0;
    this.breakT = 0;
    this.queued = 0;
    this.waveActive = false;
    this.runXp = 0;
    // Must be initialised here. Time Attack never calls startWave(), so an
    // undefined timer made `spawnTimer -= dt` NaN and nothing ever spawned.
    this.spawnTimer = 0;

    this.combo = 0;
    this.comboT = 0;
    this.multiplier = 1;

    this.timeLeft = CFG.timeAttack.duration;

    // presentation state
    this.fireMarks = [];            // where soldiers fired from, for map and compass
    this.calloutT = 0;              // shared cooldown so voices do not pile up
    this.pendingCallouts = [];
    this.won = false;
    this.stats = { downs: 0, damageTaken: 0, longestKill: 0, startT: 0 };
    if (this.screen) this.screen.reset();

    this.fovCurrent = this.baseFov;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.player.applyToCamera(0);
  }

  get health() { return this.player.state.health; }
  get armor() { return this.player.state.armor; }
  get aliveCount() { return this.robots.reduce((n, r) => n + (r.dead ? 0 : 1), 0); }
  get accuracy() { return this.weapons.shotsFired ? this.weapons.shotsHit / this.weapons.shotsFired : 0; }

  start(mode) {
    this.mode = mode || MODE.SURVIVAL;
    this.townPower = true;
    this.reset();
    this.state = STATE.PLAY;
    this.input.reset();
    this.input.enabled = true;
    this.input.wantPointerLock = true;
    // start() is called from a button click, which is the gesture the browser
    // needs; asking here means the mouse aims from the first frame.
    this.input.requestLock();
    audio.unlock();
    this.breakT = 2.0;
    this.stats.startT = this.elapsed;
    if (this.mode === MODE.CAMPAIGN) {
      // No wave director in the campaign: soldiers are placed by objective, and
      // the level starts empty.
      this.waveActive = false; this.queued = 0; this.breakT = 1e9;
      this.setPowered(false);
      this.campaign.start(this.difficulty || 'normal', this.campaignFrom || 'town');
    }
    // mission 2 is a night operation whatever the menu says; everything else
    // follows the setting
    this._setTime(this.mode === MODE.CAMPAIGN && this.campaign.mission === 2 ? 'night' : settings.get('timeOfDay'));
    this._stockGear();
    this.onStateChange(this.state);
  }

  // Loadout and crates for a fresh run. The campaign starts with one rifle and
  // the sidearm and finds the rest; arcade modes keep every unlocked gun.
  _stockGear() {
    this.gear.reset(this.mode);
    const W = this.weapons;
    if (this.mode !== MODE.CAMPAIGN) {
      W.clearLoadout();
      const sp = this.spawnPoint;
      this.gear.crate(sp.x + 2.4, sp.z + 1.6, [['plate'], ['frag'], ['smoke'], ['attachment', 'foregrip'], ['attachment', 'suppressor'], ['ammo']]);
      return;
    }
    const T = this.town;
    this.vehicle.remove();
    if (this.campaign.mission === 2) {
      // the courier's truck, on the station shelf
      this.vehicle.place(0, 27, Math.PI);   // lined up with the south gate
      // a night in town needs the long rifle and more kit
      W.setLoadout(['rifle', 'sniper']);
      W.switchTo('rifle', true);
      W.mount('rifle', 'suppressor');
      Object.assign(this.gear.counts, { plates: 2, meds: 2, frags: 2, smokes: 1, flashes: 1 });
      this.gear.crate(5.5, 33, [['ammo'], ['plate'], ['attachment', 'x2']]);
      this.gear.crate(-96, 214, [['ammo'], ['medkit'], ['frag'], ['plate']]);
      this.gear.crate(132, 128, [['ammo'], ['plate'], ['smoke'], ['flash']]);
      this.gear.crate(-8, 262, [['ammo'], ['medkit'], ['plate']]);
      return;
    }
    W.setLoadout(['rifle', null]);
    W.switchTo('rifle', true);
    if (this.campaign.fromTown && T) {
      // beside the road where the walk in starts
      this.gear.crate(-3, 312.5, [['attachment', 'suppressor'], ['plate'], ['ammo']]);
      // in the police station, by the report
      const pol = T.byTag('police');
      if (pol && pol.tagItem) {
        const q = T.local(pol, pol.tagItem.x + 1.4, pol.tagItem.z, 0);
        this.gear.crate(q.x, q.z, [['weapon', 'sniper'], ['attachment', 'foregrip'], ['medkit']], q.y);
      }
      // inside the substation, by the breaker
      const ss = T.spots.substation;
      if (ss) this.gear.crate(ss.switchAt.x + 1.6, ss.switchAt.z - 1.5, [['frag'], ['smoke'], ['plate'], ['attachment', 'extmag']]);
    } else {
      const sp = this.spawnPoint;
      this.gear.crate(sp.x + 2.4, sp.z + 1.6, [['weapon', 'smg'], ['plate'], ['frag'], ['attachment', 'suppressor']]);
    }
  }

  pause() {
    if (this.state !== STATE.PLAY) return;
    this.state = STATE.PAUSED;
    this.input.enabled = false;
    this.input.wantPointerLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.onStateChange(this.state);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAY;
    this.input.reset();
    this.input.enabled = true;
    this.input.wantPointerLock = true;
    this.input.requestLock();
    this.onStateChange(this.state);
  }

  _setTime(tod) {
    if (this._tod === tod || !this.atmos) return;
    this._tod = tod;
    this.atmos.setTime(tod);
    if (this.post) this.post.setGrade(tod);
  }

  toMenu() {
    if (this.vehicle && this.vehicle.driving) this.vehicle.exit();
    this.state = STATE.MENU;
    this.input.enabled = false;
    this.input.wantPointerLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.onStateChange(this.state);
  }

  // ---------------- waves ----------------

  waveCount(n) {
    const preset = CFG.wave.counts[n - 1];
    if (preset) return preset;
    return CFG.wave.counts[CFG.wave.counts.length - 1] + (n - CFG.wave.counts.length) * CFG.wave.growth;
  }

  startWave() {
    this.wave++;
    this.waveActive = true;
    this.queued = this.waveCount(this.wave);
    this.spawnTimer = 0;
    audio.sfx.waveStart();
    this.onWave(this.wave, this.queued, false);
  }

  spawnRobot() {
    const p = this.player.state;
    // Spawn out of sight where possible: try a few rings before giving up.
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 12 && !ok; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = CFG.wave.spawnMin + Math.random() * (CFG.wave.spawnMax - CFG.wave.spawnMin);
      x = p.x + Math.sin(ang) * dist;
      z = p.z + Math.cos(ang) * dist;
      x = THREE.MathUtils.clamp(x, -32, 32);
      z = THREE.MathUtils.clamp(z, -44, 24);
      ok = !this.blockedAt(x, z);
    }
    const type = pickType(this.wave);
    const tier = 1 + Math.max(0, this.wave - 1) * 0.07;
    const rb = new Robot(type, x, z, tier);
    this.scene.add(rb.root);
    this.robots.push(rb);
  }

  // ---------------- world queries used by the AI ----------------

  // What the player is standing on, for footsteps: a prop or roof they are on
  // top of, the station's concrete, a timber floor indoors, or the town's
  // ground (road, paving, grass, gravel, concrete).
  surfaceUnder() {
    const p = this.player.state;
    for (const c of this.grid.query(p.x, p.z, p.x, p.z)) {
      if (p.x < c.minX || p.x > c.maxX || p.z < c.minZ || p.z > c.maxZ || Math.abs(c.top - p.y) > 0.08) continue;
      return c.surf === 'metal' || c.surf === 'car' || c.surf === 'fuelcar' ? 'metal' : c.surf === 'wood' ? 'wood' : 'concrete';
    }
    if (this.player.inVoid(p.x, p.z)) return 'concrete';
    if (this.town) return this.town.groundKind(p.x, p.z, p.y);
    return 'asphalt';
  }

  // Feet height for the AI's blocked test. On the station shelf and inside the
  // building this is 0, exactly the old absolute thresholds; in town it is the
  // ground under the soldier.
  feetAt(x, z) {
    return this.player.inVoid(x, z) ? 0 : this.surfaceH(x, z);
  }

  // Next waypoint for a soldier heading to (gx, gz) in town, or null to walk
  // straight. Paths are re-planned at most every ~0.5 s per soldier.
  navSteer(e, gx, gz, dt) {
    const pos = e.root.position;
    if (!this.town) return null;
    if (!(pos.z > 47 || Math.abs(pos.x) > 46) || !(gz > 47 || Math.abs(gx) > 46)) return null;
    if (!this.nav) this.nav = buildNav(this);
    const N = this.nav;
    const st = e.navState || (e.navState = { t: 0, path: null, idx: 0, gx: 0, gz: 0, direct: true, best: Infinity, stuck: 0, noPull: 0 });
    st.t -= dt;
    st.noPull -= dt;
    // no progress toward the current waypoint for a second: plan again from here
    if (st.path) {
      const w = st.path[st.idx], d = Math.hypot(w.x - pos.x, w.z - pos.z);
      if (d < st.best - 0.25) { st.best = d; st.stuck = 0; } else st.stuck += dt;
      if (st.stuck > 1.0) { st.path = null; st.t = 0; st.stuck = 0; st.best = Infinity; st.noPull = 2; st.direct = false; st.gx = 1e9; }
    }
    if (st.t <= 0) {
      st.t = 0.4 + Math.random() * 0.25;
      st.direct = Math.hypot(gx - pos.x, gz - pos.z) < 2.5 || N.clear(pos.x, pos.z, gx, gz);
      if (st.direct) st.path = null;
      else if (!st.path || Math.hypot(gx - st.gx, gz - st.gz) > 3) {
        st.path = N.path(pos.x, pos.z, gx, gz); st.idx = 0; st.gx = gx; st.gz = gz; st.best = Infinity;
      }
      // string-pull: skip a waypoint whenever the one after it is in a straight line
      if (st.path && st.idx < st.path.length - 1 && st.noPull <= 0) {
        const n = st.path[st.idx + 1];
        if (N.clear(pos.x, pos.z, n.x, n.z)) st.idx++;
      }
    }
    if (st.direct || !st.path) return null;
    while (st.idx < st.path.length - 1 && Math.hypot(st.path[st.idx].x - pos.x, st.path[st.idx].z - pos.z) < 1.2) { st.idx++; st.best = Infinity; }
    return st.path[st.idx];
  }

  addCollider(c) {
    this.colliders.push(c);
    this.grid.add(c);
  }

  blockedAt(x, z) {
    const r = 0.55;
    const f = this.feetAt(x, z);
    for (const c of this.grid.query(x - r, z - r, x + r, z + r)) {
      if (c.top < f + 0.9) continue;                       // low enough to walk over
      if (c.bottom !== undefined && c.bottom > f + 1.9) continue;   // high enough to walk under
      if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
    }
    return false;
  }

  // Nearest hit on the town's collider boxes or the terrain along a ray. The
  // town is never raycast as meshes: a merged chunk is thousands of triangles
  // and three.js tests every one. Returns { distance, point, normal, kind }.
  castStatic(origin, dir, far) {
    const ox = origin.x, oy = origin.y, oz = origin.z, dx = dir.x, dy = dir.y, dz = dir.z;
    let best = null, bestT = far;
    this.grid.segment(ox, oz, ox + dx * far, oz + dz * far, (c) => {
      if (!c.town) return false;
      const h = rayBox(ox, oy, oz, dx, dy, dz, bestT, c);
      if (h && h.t < bestT) { bestT = h.t; best = { t: h.t, axis: h.axis, sign: h.sign, kind: c.surf, col: c }; }
      return false;
    });
    // terrain: coarse march out to the nearest box hit, then bisect. Skipped
    // inside the station building, whose floors are real geometry.
    if (!this.player.inVoid(ox, oz)) {
      const step = 3;
      let prevT = 0;
      for (let t = step; prevT < bestT; t += step) {
        const tt = Math.min(t, bestT);
        const y = oy + dy * tt;
        if (y > 60) break;
        if (y <= this.surfaceH(ox + dx * tt, oz + dz * tt)) {
          let a = prevT, b = tt;
          for (let k = 0; k < 8; k++) {
            const m = (a + b) / 2;
            if (oy + dy * m > this.surfaceH(ox + dx * m, oz + dz * m)) a = m; else b = m;
          }
          bestT = b; best = { t: b, axis: 1, sign: 1, kind: 'masonry', ground: true };
          break;
        }
        prevT = tt;
      }
    }
    if (!best) return null;
    const point = new THREE.Vector3(ox + dx * best.t, oy + dy * best.t, oz + dz * best.t);
    const normal = new THREE.Vector3();
    if (best.ground) {
      const e = 0.5;
      normal.set(this.surfaceH(point.x - e, point.z) - this.surfaceH(point.x + e, point.z), 2 * e,
        this.surfaceH(point.x, point.z - e) - this.surfaceH(point.x, point.z + e)).normalize();
    } else normal.setComponent(best.axis, best.sign);
    const kind = best.kind === 'car' || best.kind === 'fuelcar' ? 'metal' : best.kind;
    return { distance: best.t, point, normal, kind, col: best.col };
  }

  // Line of sight against the collider boxes rather than the render meshes.
  // Raycasting merged geometry walks every triangle in the map, which at a
  // dozen robots was costing more than the entire render.
  canSee(from, playerState, ignoreSmoke) {
    // aim at the player's head, wherever leaning or lying down has put it
    const ps = playerState;
    const tx = ps.x + (ps.leanX || 0) * 0.85, tz = ps.z + (ps.leanZ || 0) * 0.85;
    const ty = ps.y + (ps.prone > 0.5 ? 0.35 : ps.crouch > 0.5 ? 0.9 : 1.3);
    const dx = tx - from.x, dy = ty - from.y, dz = tz - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.5) return true;

    // smoke grenades block sight both ways
    if (!ignoreSmoke && this.gear && this.gear.smokes.length && this.gear.smokeBlocks(from, { x: tx, y: ty, z: tz })) return false;
    // hills and the station bank hide people too
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      const x = from.x + dx * t, z = from.z + dz * t;
      if (!this.player.inVoid(x, z) && from.y + dy * t < this.surfaceH(x, z) - 0.1) return false;
    }

    let seen = true;
    this.grid.segment(from.x, from.z, tx, tz, (c) => {
      const bottom = c.bottom === undefined ? 0 : c.bottom;
      // slab test over the parametric range [0,1] of the segment
      let t0 = 0, t1 = 1;
      const slab = (o, d, lo, hi) => {
        if (Math.abs(d) < 1e-6) return o >= lo && o <= hi;
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) { const s = a; a = b; b = s; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        return t1 >= t0;
      };
      if (!slab(from.x, dx, c.minX, c.maxX)) return false;
      if (!slab(from.y, dy, bottom, c.top)) return false;
      if (!slab(from.z, dz, c.minZ, c.maxZ)) return false;
      // ignore contacts right at the target, so standing against cover still sees
      if (t1 > 0.02 && t0 < 0.96) { seen = false; return true; }
      return false;
    });
    return seen;
  }

  // ---------------- combat ----------------

  // Nearest thing a shot from `origin` along `dir` hits within `far`: soldiers'
  // hitboxes (unless `noRobots`), the station's meshes, the town's boxes and
  // the ground. Returns { point, distance, object?, townHit?, normal? } or null.
  traceShot(origin, dir, far, noRobots) {
    this.ray.set(origin, dir);
    this.ray.far = far;
    let targets = this.blockers;
    if (!noRobots) {
      targets = this.blockers.slice();
      for (const r of this.robots) if (!r.dead) targets.push(...r.hitboxes);
    }
    const hits = this.ray.intersectObjects(targets, false);
    let hit = hits.length ? hits[0] : null;
    const st = this.castStatic(origin, dir, hit ? hit.distance : far);
    if (st) hit = { distance: st.distance, point: st.point, object: null, townHit: st, normal: st.normal };
    else if (hit && noRobots) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      hit.normal = n;
    }
    return hit;
  }

  // Damage, impact marks, sparks and sound for one hit. Returns what happened,
  // so the caller can aggregate hit markers across shotgun pellets.
  applyShotHit(hit, origin, dmgIn, quietMarker) {
    const ud = hit.object ? hit.object.userData : null;
    if (ud && ud.robot) {
      const robot = ud.robot;
      this.weapons.shotsHit++;
      const dmg = dmgIn * ud.mul;
      const res = robot.damage(dmg, ud.part);
      const n = new THREE.Vector3().subVectors(origin, hit.point).normalize();
      // dust and kit fragments, deliberately not blood
      this.fx.sparkBurst(hit.point, n, ud.part === 'head' ? 8 : 5);
      this.fx.puff(hit.point, 0.30, 0xd8cbb4);
      if (res.killed) {
        this.registerKill(robot, res.headshot, hit.point.clone());
        // A man going down is loud. Nearby soldiers come to look; the ones
        // closest treat it as contact rather than a noise.
        this.alertNear(robot.root.position, 20, false);
      } else {
        // Being shot at and missed still gives away roughly where you are.
        this.alertNear(robot.root.position, 12, false);
        if (!quietMarker) {
          audio.sfx[res.headshot || ud.part === 'head' ? 'headshot' : 'hit']();
          this.onHit(ud.part === 'head' ? 'head' : 'body', hit.point.clone(), Math.round(dmg));
        }
      }
      return { robot: true, dmg, killed: res.killed, head: res.headshot || ud.part === 'head' };
    }
    let n, kind;
    // windows shatter, cars alarm, the fuel car counts its hits
    if (hit.townHit && this.life && this.life.onBulletHit({ col: hit.townHit.col, point: hit.point })) return { robot: false };
    if (hit.townHit) {
      n = hit.townHit.normal;
      kind = hit.townHit.kind;
    } else {
      n = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
      // Merged statics have identity transforms, but doors and props may not.
      n.transformDirection(hit.object.matrixWorld);
      kind = this.surface.get(hit.object.material) || 'masonry';
    }
    this.decals.add(hit.point, n, kind);
    if (kind === 'metal') {
      this.fx.sparkBurst(hit.point, n, 7);
      this.fx.puff(hit.point, 0.18, 0x9a958c);
    } else if (kind === 'wood') {
      this.fx.puff(hit.point, 0.30, 0x8a6a46);
    } else if (kind === 'glass') {
      this.fx.sparkBurst(hit.point, n, 3);
    } else {
      this.fx.puff(hit.point, 0.42, 0xb3aa98);
      this.fx.sparkBurst(hit.point, n, 2);
    }
    audio.spatial.impact(hit.point.x, hit.point.y, hit.point.z, kind);
    return { robot: false };
  }

  tryFire() {
    const dirs = this.weapons.fire(this.scene, this.input.firing);
    if (!dirs) return;
    const W = this.weapons;

    this.fx.addShake(0.010 * (1 - W.ads * 0.45) * (W.spec.pellets > 1 ? 2.2 : 1));

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    const muzzle = new THREE.Vector3();
    W.model.muzzle.getWorldPosition(muzzle);

    if (this.life) this.life.onShot(origin);
    // Gunfire carries. Soldiers in earshot come to the shot; a suppressor
    // shrinks the radius to about a fifth.
    this.alertNear(origin, CFG.gear.hearing * W.noise, false);

    const range = W.spec.range;
    const vel = W.spec.velocity || 0;
    // Tracers on every third round of an automatic, every shot otherwise --
    // readable without turning a spray into a laser show.
    const tracerShot = !W.spec.auto || W.shotsFired % 3 === 1;
    let pelletTracers = 0;
    // a thin wisp off the muzzle
    if (W.shotsFired % (W.spec.auto ? 2 : 1) === 0 && !W.suppressed) this.fx.puff(muzzle, 0.10, 0xb9b2a6);
    let anyHit = false, anyKill = false, anyHead = false;
    let hitPoint = null, dealt = 0;
    const dmg = W.damage;

    for (const dir of dirs) {
      // Rifle rounds fly: inside 50 m the shot is resolved at once (drop there
      // is a few millimetres); past it the round becomes a projectile with
      // travel time and drop. The sight is zeroed: the barrel points a hair
      // up so the round crosses the line of sight at the zero range.
      const near = vel ? Math.min(range, 50) : range;
      const hit = this.traceShot(origin, dir, near);
      const drawTracer = tracerShot && (W.spec.pellets === 1 || pelletTracers++ < 2);
      if (!hit) {
        if (vel && range > 50) {
          const t50 = 50 / vel;
          const elev = Math.atan((9.81 * W.zero) / (2 * vel * vel));
          const v = dir.clone().multiplyScalar(vel);
          v.y += vel * elev - 9.81 * t50;
          const p = origin.clone().addScaledVector(dir, 50);
          p.y += 50 * elev - 0.5 * 9.81 * t50 * t50;
          this.gear.spawnRound(p, v, dmg, W.current);
          if (drawTracer) this.fx.tracer(muzzle, p);
        } else if (drawTracer) this.fx.tracer(muzzle, origin.clone().addScaledVector(dir, range));
        continue;
      }
      if (drawTracer) this.fx.tracer(muzzle, hit.point);
      const r = this.applyShotHit(hit, origin, dmg, true);
      if (r.robot) {
        dealt += r.dmg; hitPoint = hit.point.clone(); anyHit = true;
        if (r.killed) anyKill = true;
        if (r.head) anyHead = true;
      }
    }

    if (anyHit && !anyKill) {
      audio.sfx[anyHead ? 'headshot' : 'hit']();
      this.onHit(anyHead ? 'head' : 'body', hitPoint, Math.round(dealt));
    }
  }

  registerKill(robot, headshot, point) {
    this.kills++;
    if (headshot) this.headshots++;

    this.combo++;
    this.comboT = CFG.score.comboWindow;
    let mult = 1;
    for (const [need, m] of CFG.score.comboTiers) if (this.combo >= need) mult = m;
    if (mult !== this.multiplier) {
      this.multiplier = mult;
      if (mult > 1) { audio.sfx.combo(mult); this.onCombo(mult, this.combo); }
    }

    const base = robot.spec.score + (headshot ? CFG.score.headshotBonus : 0);
    this.score += Math.round(base * this.multiplier);

    const xp = robot.spec.xp + (headshot ? CFG.xp.headshot : 0);
    this.runXp += xp;

    // Salvage: every kill returns ammunition, capped at the weapon's pool.
    const w = this.weapons;
    const give = Math.max(3, Math.round(w.magSize * 0.22));
    w.reserve[w.current] = Math.min(w.spec.reserve, w.reserve[w.current] + give);

    this.fx.explode(point, 0xc9bda6);
    if (this.gear) this.gear.dropFrom(robot);
    const rp = robot.root.position;
    audio.spatial.death(rp.x, rp.y + 1, rp.z);
    audio.sfx.killConfirm(headshot);
    const ps = this.player.state;
    const dist = Math.hypot(rp.x - ps.x, rp.z - ps.z);
    this.stats.longestKill = Math.max(this.stats.longestKill, dist);
    // the nearest man still standing sees him go down
    let mate = null, md = 30;
    for (const r of this.robots) {
      if (r.dead || r === robot) continue;
      const d = Math.hypot(r.root.position.x - rp.x, r.root.position.z - rp.z);
      if (d < md) { md = d; mate = r; }
    }
    if (mate) this.pendingCallouts.push({ r: mate, kind: 'manDown', t: 0.6 });
    this.onKill({ headshot, point, type: robot.type, name: robot.spec.name, mult: this.multiplier,
      weapon: w.spec.name, dist: Math.round(dist) });
  }

  // A robot shot at the player. Ranged attacks are hitscan with a visible
  // tracer so incoming fire can be read and broken with cover.
  robotAttack(dmg, origin, dir, robot) {
    if (this.state !== STATE.PLAY) return;
    if (origin && dir) {
      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      // you hear where it came from, and it shows on the map and compass
      audio.spatial.shot(origin.x, origin.y, origin.z, GUN_CLASS[robot && robot.type] || 'rifle');
      if (this.enemyFlash && origin.distanceToSquared(camPos) < 2500) {
        this.enemyFlash.position.copy(origin);
        this.enemyFlash.intensity = 26;
      }
      this.fireMarks.push({ x: origin.x, z: origin.z, t: this.elapsed });
      if (this.fireMarks.length > 24) this.fireMarks.shift();
      const from = audio.toListener(origin.x, origin.y, origin.z);
      const end = origin.clone().addScaledVector(dir, 90);

      // does cover stop it first?
      this.ray.set(origin, dir);
      this.ray.far = 90;
      const blocked = this.ray.intersectObjects(this.blockers, false);
      const st = this.castStatic(origin, dir, blocked.length ? blocked[0].distance : 90);
      if (st) blocked.unshift({ distance: st.distance, point: st.point });
      const toPlayer = camPos.clone().sub(origin);
      const along = toPlayer.dot(dir);
      const perp = toPlayer.clone().addScaledVector(dir, -along).length();
      const coverDist = blocked.length ? blocked[0].distance : Infinity;

      if (coverDist < along) {
        this.fx.tracer(origin, blocked[0].point, 0xff8a5c);
        this.fx.puff(blocked[0].point, 0.35, 0xffb07a);
        // rounds smacking into the cover you are behind
        const bp = blocked[0].point;
        const near = bp.distanceTo(camPos);
        if (near < 3.5) {
          audio.spatial.impact(bp.x, bp.y, bp.z, 'masonry');
          if (this.screen) this.screen.suppress(0.22 * (1 - near / 3.5) + 0.08, from);
        }
        return;
      }
      this.fx.tracer(origin, end, 0xff8a5c);
      // 0.55m is roughly a torso; wider than that and it goes past
      if (perp > 0.55 || along < 0) {
        if (perp < 2.2 && along > 0) {
          // the crack is heard where the round passed
          const pass = origin.clone().addScaledVector(dir, along);
          audio.spatial.whiz(pass.x, pass.y, pass.z);
          if (this.screen) this.screen.suppress(0.32 * (1 - perp / 2.2) + 0.1, from);
        }
        return;
      }
      audio.sfx.impact();
    }
    this.hurt(dmg);
  }

  hurt(dmg) {
    if (this.state !== STATE.PLAY) return;
    if (this.vehicle && this.vehicle.driving) dmg *= 0.5;
    this.hurtT = CFG.player.regenDelay;
    this.fx.addShake(0.018);
    if (this.screen) this.screen.hit(dmg);
    this.stats.damageTaken += dmg;
    const dead = this.player.hurt(dmg);
    this.onDamaged(this.player.state.health / CFG.player.maxHealth);
    if (Math.random() < 0.5) audio.sfx.hurt();
    if (dead) this.gameOver();
  }

  gameOver() {
    // In the campaign, dying reloads the last checkpoint. The whole point of
    // checkpoints is that death is not a restart.
    if (this.mode === MODE.CAMPAIGN && this.campaign.hasCheckpoint() && this.state === STATE.PLAY) {
      this.onDown();
      this.reloadCheckpoint();
      return;
    }
    if (this.state === STATE.OVER) return;
    this.state = STATE.OVER;
    this.input.enabled = false;
    this.input.wantPointerLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    audio.sfx.gameOver();

    const levelled = this.prog.addXp(this.runXp);
    this.prog.recordRun({ score: this.score, wave: this.wave, kills: this.kills, mode: this.mode });
    if (levelled) this.onLevelUp(this.prog.level);
    this.onStateChange(this.state);
  }

  // ---------------- frame ----------------

  update(dt) {
    this.fx.update(dt);
    if (this.screen) this.screen.update(this.state === STATE.PLAY ? dt : 0, this.player.state.health, CFG.player.maxHealth);

    if (this.state !== STATE.PLAY) {
      if (this.state === STATE.MENU || this.state === STATE.OVER) {
        // let death animations finish playing behind the menu
        const c = this._ctx(); c.frame = ++this.losTick;
        for (const r of this.robots) if (r.dead) r.update(dt, c);
      }
      this.input.take();
      return;
    }

    this.elapsed += dt;
    const inp = this.input.take();

    if (inp.pause) { this.pause(); return; }

    // ---- at the wheel: the stick and keys drive, nothing fires ----
    const driving = this.vehicle.driving;
    // Space is held as 'fire' in the input layer, so that is the brake (and on
    // a phone, FIRE)
    const drive = { throttle: -inp.moveY, steer: inp.moveX, brake: inp.firing || inp.jump };
    // the mouse looks around the truck instead of turning the player; C or
    // SWAP flips between the chase and cab views
    const look = { dx: inp.dx, dy: inp.dy, view: inp.camView || inp.switchTo === 'next' };
    if (driving) {
      inp.dx = inp.dy = 0;
      inp.moveX = inp.moveY = 0; inp.jump = inp.crouch = inp.sprint = false; inp.lean = 0;
      inp.prone = inp.tactical = false; inp.firing = inp.ads = false;
      inp.reload = inp.frag = inp.smoke = inp.flash = inp.plate = inp.medkit = inp.inventory = false;
      inp.zero = 0; inp.switchTo = null; inp.inspect = false;
    }

    // ---- weapon intent ----
    this.weapons.triggerHeld = inp.firing;
    this.weapons.wantAds = inp.ads;
    if (inp.reload) this.weapons.startReload();
    if (inp.frag) this.gear.throw('frag');
    if (inp.smoke) this.gear.throw('smoke');
    if (inp.flash) this.gear.throw('flash');
    if (inp.plate) this.gear.usePlate();
    if (inp.medkit) this.gear.useMedkit();
    if (inp.zero && this.weapons.cycleZero(inp.zero)) audio.sfx.zero();
    if (inp.inventory && this.onInventory) this.onInventory();
    // sprinting puts the plate or medkit away unfinished
    if (this.player.state.sprinting && this.weapons.itemT > 0 && this.weapons.itemKind !== 'throw') {
      this.weapons.itemT = 0; this.weapons.itemKind = null;
    }
    if (typeof inp.switchTo === 'string' && inp.switchTo.startsWith('slot:')) this.weapons.switchSlot(+inp.switchTo.slice(5));
    else if (inp.switchTo === 'next') this.weapons.nextWeapon(1);
    else if (inp.switchTo === 'prev') this.weapons.nextWeapon(-1);
    else if (inp.switchTo && !inp.switchTo.startsWith('slot:')) this.weapons.switchTo(inp.switchTo);
    if (this.weapons.mag === 0 && !this.weapons.busy && this.weapons.pool > 0) {
      this.weapons.startReload();
    }

    if (inp.inspect) this.weapons.inspect();

    // ---- pattern recoil moves the real aim ----
    // Kick from last frame's shots, plus recovery once the spray has stopped.
    // Applied before the player steps, so this frame's camera already includes
    // it and the next bullet leaves along the kicked line.
    const ps = this.player.state;
    const [kp, ky] = this.weapons.consumeKick();
    const [rp, ry] = this.weapons.recover(dt);
    ps.pitch = THREE.MathUtils.clamp(ps.pitch + kp + rp, CFG.camera.pitchMin, CFG.camera.pitchMax);
    ps.yaw += -ky + ry;
    const prePitch = ps.pitch, preYaw = ps.yaw;

    // ---- player, before anything traces a ray through the camera ----
    this.player.step(dt, {
      moveX: inp.moveX, moveY: inp.moveY,
      lookDX: inp.dx, lookDY: inp.dy,
      jump: inp.jump, crouch: inp.crouch, sprint: inp.sprint,
      lean: inp.lean, prone: inp.prone, tactical: inp.tactical,
    }, this.weapons.ads);

    // Whatever the mouse did this frame counts against the recoil the player
    // is carrying, so pulling down pays it off instead of fighting recovery.
    let dYaw = ps.yaw - preYaw;
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.weapons.absorb(ps.pitch - prePitch, dYaw);
    if (inp.jump && this.player.state.grounded === false) audio.sfx.jump();

    // recoil rides on top of the player's own aim
    this.camera.rotation.y += this.weapons.camPunchYaw + this.fx.shake.x + this.weapons.scopeSwayY;
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.camera.rotation.x + this.weapons.camPunch + this.fx.shake.y + this.weapons.scopeSwayP,
      CFG.camera.pitchMin - 0.3, CFG.camera.pitchMax + 0.3);

    this.weapons.setMotion(this.player.moveAmount, inp.dx * 0.05, inp.dy * 0.05, {
      sprinting: ps.sprinting || ps.mantling,
      airborne: !ps.grounded && !ps.mantling,
      stance: ps.slideT > 0 ? 1.6 : ps.prone > 0.5 ? 0.55 : ps.crouch > 0.5 ? 0.85 : 1,
      // Shift while scoped holds breath; sprint is already blocked while aiming.
      holdBreath: inp.sprint && this.weapons.ads > 0.6,
    });
    this._fov(dt);

    // the ears follow the camera
    {
      const cam = this.camera, f = this._lf || (this._lf = new THREE.Vector3()), u = this._lu || (this._lu = new THREE.Vector3());
      cam.getWorldDirection(f);
      u.set(0, 1, 0).applyQuaternion(cam.quaternion);
      audio.setListener(cam.position, f, u);
    }
    this._stepsThisFrame = 0;
    if (this.enemyFlash && this.enemyFlash.intensity > 0) {
      this.enemyFlash.intensity *= Math.exp(-dt * 22);
      if (this.enemyFlash.intensity < 0.05) this.enemyFlash.intensity = 0;
    }
    if (this.calloutT > 0) this.calloutT -= dt;
    for (let i = this.pendingCallouts.length - 1; i >= 0; i--) {
      const c = this.pendingCallouts[i];
      c.t -= dt;
      if (c.t <= 0) { this.pendingCallouts.splice(i, 1); this.callout(c.r, c.kind); }
    }

    // ---- robots ----
    const ctx = this._ctx();
    ctx.frame = ++this.losTick;
    for (let i = this.robots.length - 1; i >= 0; i--) {
      const r = this.robots[i];
      r.update(dt, ctx);
      if (!r.dead) {
        // stand on the ground: slopes, kerbs, the station road
        const rp = r.root.position;
        rp.y = this.player.groundAt(rp.x, rp.z, rp.y + 0.3);
      }
      if (r.removable) { this.scene.remove(r.root); this.robots.splice(i, 1); }
    }

    // Raycasting reads matrixWorld, which the renderer would not refresh until
    // after this frame's draw call.
    this.scene.updateMatrixWorld(true);

    if (!driving && (inp.firing || !this.weapons.spec.auto)) this.tryFire();
    this.weapons.update(dt, this.scene);
    this.vehicle.update(dt, drive);
    if (this.vehicle.driving) {
      this.weapons.model.gun.visible = false;
      if (this.weapons.arms) this.weapons.arms.mesh.visible = false;
      this.vehicle.placeDriverAndCamera(dt, look);
    }

    // keep the shadow frustum on the player
    const p = this.player.state;
    // both cascades centred on the player, snapped to whole texels
    const so = this.sunOffset || this._sunDefault || (this._sunDefault = new THREE.Vector3(-34, 30, 18));
    const centre = this._sc || (this._sc = new THREE.Vector3());
    centre.set(p.x, p.y, p.z);
    placeSnapped(this.sun, centre, so, 60, NEAR_HALF);
    if (this.sunFar && this.sunFar.castShadow) {
      // the wide map is refreshed when the player has moved or every half second
      this._farT += dt;
      if (this._farT > 0.5 || this._farAt.distanceToSquared(centre) > 36) {
        this._farT = 0; this._farAt.copy(centre);
        placeSnapped(this.sunFar, centre, so, 320, FAR_HALF);
        this.sunFar.shadow.needsUpdate = true;
      }
    }
    if (this.scene.fog && this.baseFog) this.scene.fog.density = this.baseFog * (this.fogMul || 1);
    if (this.atmos) this.atmos.update(dt, this.camera.position);
    if (this.life) this.life.update(dt);

    // ---- combo decay ----
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.multiplier = 1; this.onCombo(1, 0); }
    }

    // ---- mode logic ----
    if (this.mode === MODE.CAMPAIGN) {
      this._campaignFlow(dt, inp);
    } else if (this.mode === MODE.TIME) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.gameOver(); return; }
      this._timeAttackFlow(dt);
    } else {
      this._survivalFlow(dt);
      this._lootPrompt(inp);
      this._interactHeld = !!(inp && inp.interact);
    }
    this.gear.update(dt);

    // ---- health regen ----
    if (this.hurtT > 0) this.hurtT -= dt;
    else if (p.health < CFG.player.maxHealth) {
      p.health = Math.min(CFG.player.maxHealth, p.health + CFG.player.regenRate * dt);
    }
  }

  _campaignFlow(dt, inp) {
    const p = this.player.state;

    // Falling out of the world is recoverable, not fatal: a hole in a slab
    // should cost a checkpoint reload, never an endless drop.
    if (p.y < -30) { this.reloadCheckpoint(); return; }

    this.campaign.update(dt);

    // interaction prompt + use; loot only when no story item is in reach
    const item = this.campaign.interact.pick(this.camera, p);
    if (item) {
      const locked = item.needs && this.campaign.keycard < item.needs;
      this.onPrompt(locked ? (item.lockedPrompt || 'LOCKED') : item.prompt, locked);
    }
    if (inp && inp.interact && item && !this._interactHeld) {
      const r = this.campaign.interact.use(item, { keycard: this.campaign.keycard });
      if (!r.ok && r.message) this.onPrompt(r.message, true);
      else if (r.ok) audio.sfx.ui && audio.sfx.ui();
    }
    if (!item) this._lootPrompt(inp);
    this._interactHeld = !!(inp && inp.interact);
  }

  // Floor height for placing a soldier: the campaign puts some of them in the
  // basement, where y=0 would leave them standing in the ceiling.
  floorAt(x, z) {
    return this.player.groundAt(x, z, this.feetAt(x, z) + 1.0);
  }

  setPowered(on) {
    this.powered = on;
    // Emissive strips are one merged mesh per colour; brightening the material
    // is the whole lighting change and costs nothing per frame.
    if (this.glowMesh && this.glowMesh.warm) {
      this.glowMesh.warm.material.color.setHex(on ? 0xffd9a0 : 0x6a4a24);
    }
  }

  grantAmmo() {
    const w = this.weapons;
    for (const id of Object.keys(w.reserve)) w.reserve[id] += CFG.weapons[id].reserve;
  }

  reloadCheckpoint() {
    if (!this.campaign.hasCheckpoint()) { this.gameOver(); return; }
    this.stats.downs++;
    if (this.screen) this.screen.reset();
    if (this.vehicle.driving) this.vehicle.exit();
    this.state = STATE.PLAY;
    this.campaign.restore();
    this.hurtT = 0;
    this.onStateChange(this.state);
  }

  _ctx() {
    if (!this._ctxCache) {
      this._ctxCache = {
        player: this.player.state,
        frame: 0,
        canSee: (from, ps) => this.canSee(from, ps),
        blocked: (x, z) => this.blockedAt(x, z),
        navSteer: (e, gx, gz, dt) => this.navSteer(e, gx, gz, dt),
        onAttack: (dmg, origin, dir, robot) => this.robotAttack(dmg, origin, dir, robot),
        onSpotted: (robot) => this.alertNear(robot.root.position, 16, true),
        callout: (robot, kind) => this.callout(robot, kind),
        onStep: (robot) => this._enemyStep(robot),
        throwNade: (robot, target) => this.gear.throwFrom(robot, target, 'flash'),
        groundAt: (x, z, y) => this.player.groundAt(x, z, y),
      };
    }
    this._ctxCache.player = this.player.state;
    return this._ctxCache;
  }

  // A shot, a shout or a body pulls nearby soldiers in to look. They
  // investigate the position rather than teleporting onto the player.
  alertNear(pos, radius, hard) {
    for (const r of this.robots) {
      if (r.dead) continue;
      const d = Math.hypot(r.root.position.x - pos.x, r.root.position.z - pos.z);
      if (d <= radius) r.alertTo(pos.x, pos.z, hard && d < radius * 0.6);
    }
  }

  // A soldier shouts. Heard from where he stands; captioned for the HUD.
  callout(robot, kind) {
    if (!robot || robot.dead || this.calloutT > 0) return false;
    if ((robot.calloutAt || -99) > this.elapsed - 4) return false;
    const p = robot.root.position;
    if (Math.hypot(p.x - this.player.state.x, p.z - this.player.state.z) > 70) return false;
    robot.calloutAt = this.elapsed;
    this.calloutT = 0.9;
    audio.spatial.voice(p.x, p.y + 1.65, p.z, kind, robot.voice || 120);
    if (this.onCallout) this.onCallout({ kind, text: CALLOUT_TEXT[kind] || kind, name: robot.spec.name, rel: audio.toListener(p.x, p.y + 1.65, p.z) });
    return true;
  }

  // The nearest soldier within `r` of a point calls it out.
  calloutNear(pt, r, kind) {
    let best = null, bd = r;
    for (const e of this.robots) {
      if (e.dead) continue;
      const d = Math.hypot(e.root.position.x - pt.x, e.root.position.z - pt.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? this.callout(best, kind) : false;
  }

  // Enemy footsteps, close ones only (and only a few per frame).
  _enemyStep(robot) {
    const p = robot.root.position, ps = this.player.state;
    const d = Math.hypot(p.x - ps.x, p.z - ps.z);
    if (d > 24 || this._stepsThisFrame > 3) return;
    this._stepsThisFrame = (this._stepsThisFrame || 0) + 1;
    const surface = this.town && !this.player.inVoid(p.x, p.z) ? this.town.groundKind(p.x, p.z, p.y + 0.5) : 'concrete';
    audio.spatial.step(p.x, p.y + 0.05, p.z, surface, robot.state === AI.CHASE ? 1.5 : 1);
  }

  // The campaign's last objective is done.
  completeMission() {
    if (this.state !== STATE.PLAY) return;
    this.won = true;
    this.state = STATE.OVER;
    this.input.enabled = false;
    this.input.wantPointerLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    audio.sfx.levelUp();
    this.stats.time = this.elapsed - this.stats.startT;
    const levelled = this.prog.addXp(this.runXp + 250);
    if (levelled) this.onLevelUp(this.prog.level);
    this.onStateChange(this.state);
  }

  // F on a weapon or attachment lying in reach.
  _lootPrompt(inp) {
    const vp = this.vehicle.prompt();
    if (vp) {
      this.onPrompt(vp, false);
      if (inp && inp.interact && !this._interactHeld) this.vehicle.toggle();
      return;
    }
    const it = this.gear.pickable();
    this.onPrompt(it ? this.gear.promptFor(it) : null, false);
    if (it && inp && inp.interact && !this._interactHeld) this.gear.take(it);
  }

  _survivalFlow(dt) {
    if (this.waveActive) {
      if (this.queued > 0 && this.robots.length < CFG.wave.maxAlive) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = 0.4 + Math.random() * 0.5;
          this.spawnRobot();
          this.queued--;
        }
      } else if (this.queued === 0 && this.aliveCount === 0) {
        this.waveActive = false;
        const bonus = CFG.score.waveClear * this.wave;
        this.score += bonus;
        this.runXp += CFG.xp.waveClear;
        this.breakT = CFG.wave.breakTime;
        audio.sfx.waveClear();
        this.onWave(this.wave, bonus, true);
        // a fresh magazine between waves keeps the pace up
        this.weapons.reserve[this.weapons.current] += this.weapons.magSize;
      }
    } else {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave();
    }
  }

  _timeAttackFlow(dt) {
    // Continuous pressure rather than discrete waves.
    this.wave = 1 + Math.floor((CFG.timeAttack.duration - this.timeLeft) / 45);
    if (this.robots.length < Math.min(CFG.wave.maxAlive, 5 + this.wave * 2)) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = Math.max(0.35, 1.4 - this.wave * 0.12);
        this.spawnRobot();
      }
    }
  }

  _fov(dt) {
    const c = CFG.camera;
    const spec = this.weapons.spec;
    let want = THREE.MathUtils.lerp(this.baseFov, this.weapons.fovAds, this.weapons.ads);
    if (this.player.state.sprinting && this.weapons.ads < 0.2) want = this.baseFov + 8;
    this.fovCurrent = THREE.MathUtils.damp(this.fovCurrent, want, 11, dt);
    if (Math.abs(this.camera.fov - this.fovCurrent) > 0.02) {
      this.camera.fov = this.fovCurrent;
      this.camera.updateProjectionMatrix();
    }
  }

  // Two passes: world on layer 0, weapon on its own layer with a fresh depth
  // buffer, so the weapon's lights cost nothing on world pixels and the barrel
  // can never clip through a wall.
  render() {
    if (this.town) {
      const d = this.camera.getWorldDirection(this._camDir || (this._camDir = new THREE.Vector3()));
      const l = Math.hypot(d.x, d.z) || 1;
      this.town.update(this.camera.position, undefined, { x: d.x / l, z: d.z / l });
    }
    if (this.post && this.atmos) {
      const A = this.atmos.state, T = A.T;
      const rain = A.weather === 'rain' ? 0.25 : 1;
      this.post.setRays(this.camera, A.sunDir || this.sunOffset, this.sun.color, (T.rays || 0) * rain);
    }
    if (this.post && this.post.mode !== 'off') this.post.render(1 / 60);
    else this.renderScene(null);
  }

  // World, then the weapon over a cleared depth buffer, into `target` (null =
  // the screen). The post-processing composer calls this with its own target.
  renderScene(target) {
    const cam = this.camera, r = this.renderer;
    r.setRenderTarget(target);
    const bg = this.scene.background;

    // The world pass uses a 20 cm near plane (nothing in the world comes closer
    // than the player's 40 cm radius); only the weapon needs a close one. Four
    // times the depth precision at range, which is what keeps roads draped a
    // few centimetres over terrain from flickering at 150 m.
    cam.near = 0.2; cam.updateProjectionMatrix();
    cam.layers.set(0);
    r.render(this.scene, cam);
    // ambient occlusion from this pass's depth, before the weapon clears it
    if (this.post) this.post.applyAO(target, cam);
    cam.near = 0.03; cam.updateProjectionMatrix();

    // The weapon pass must not repaint the sky. An equirectangular
    // scene.background is drawn by three as a full-screen mesh with depth
    // testing disabled on EVERY render() call, so leaving it set here painted
    // over the finished world and left only sky plus the gun on screen.
    this.scene.background = null;
    r.autoClear = false;
    r.clearDepth();
    cam.layers.set(VIEW_LAYER);
    r.render(this.scene, cam);
    r.autoClear = true;
    this.scene.background = bg;

    cam.layers.set(0);
  }
}
