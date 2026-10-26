import * as THREE from 'three';
import * as audio from './audio.js';
import { CFG } from './config.js';

// One drivable vehicle: a courier's pickup truck, mission 2 only.
//
// Arcade handling -- throttle, brake (Space), steering that scales with speed
// -- on the analytic terrain, colliding with the same boxes the player does
// (the truck's footprint is sampled at eight points). The camera orbits behind
// it on its own, swinging round behind the direction of travel; the mouse
// can look around and the view drifts back 1.5 s after it stops. C (or SWAP)
// switches to a cab view. F gets in and out. Running a soldier down at speed kills
// him. Rounds aimed at the driver do half damage through the cab.
//
// Original design: a plain two-tone pickup built from boxes.

const LEN = 4.6, WID = 2.0;
const MAX_FWD = 17, MAX_REV = 6, ACCEL = 9, BRAKE = 16, DRAG = 0.55, TURN = 1.35;

function truckMesh() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0x3f5a6e, roughness: 0.55, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.15, metalness: 0.6 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xfff2d0, emissiveIntensity: 2.5 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0a08, emissive: 0xff2010, emissiveIntensity: 1.2 });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  // the truck faces -Z, like the camera does at yaw 0
  box(WID, 0.55, LEN, paint, 0, 0.75, 0);                 // chassis and bed floor
  box(WID * 0.96, 0.85, 1.9, paint, 0, 1.45, -0.75);      // cab
  box(WID * 0.9, 0.5, 0.06, glass, 0, 1.6, -1.72);        // windscreen
  box(0.06, 0.45, 1.3, glass, WID * 0.49, 1.6, -0.75);
  box(0.06, 0.45, 1.3, glass, -WID * 0.49, 1.6, -0.75);
  box(0.1, 0.45, 2.3, paint, WID / 2 - 0.05, 1.25, 1.1);  // bed sides
  box(0.1, 0.45, 2.3, paint, -WID / 2 + 0.05, 1.25, 1.1);
  box(WID, 0.45, 0.1, paint, 0, 1.25, LEN / 2 - 0.05);
  box(WID * 1.02, 0.25, 0.2, dark, 0, 0.6, -LEN / 2);     // bumpers
  box(WID * 1.02, 0.25, 0.2, dark, 0, 0.6, LEN / 2);
  box(0.3, 0.16, 0.05, lamp, 0.7, 0.92, -LEN / 2 - 0.03);
  box(0.3, 0.16, 0.05, lamp, -0.7, 0.92, -LEN / 2 - 0.03);
  box(0.22, 0.14, 0.05, tail, 0.75, 0.95, LEN / 2 + 0.03);
  box(0.22, 0.14, 0.05, tail, -0.75, 0.95, LEN / 2 + 0.03);
  const wheels = [];
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14).rotateZ(Math.PI / 2);
  for (const [x, z] of [[1, -1.45], [-1, -1.45], [1, 1.45], [-1, 1.45]]) {
    const w = new THREE.Mesh(wg, dark);
    w.position.set(x * (WID / 2 - 0.05), 0.42, z);
    g.add(w); wheels.push(w);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, wheels };
}

export class Vehicle {
  constructor(game) {
    this.game = game;
    const m = truckMesh();
    this.mesh = m.group; this.wheels = m.wheels;
    this.mesh.visible = false;
    game.scene.add(this.mesh);
    // headlights that really light the road (desktop): one spot between the lamps
    this.beam = null;
    if (!(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)) {
      this.beam = new THREE.SpotLight(0xfff0d0, 0, 55, 0.62, 0.55, 1.4);
      this.beam.position.set(0, 1.0, -LEN / 2 - 0.1);
      this.beam.target.position.set(0, -0.6, -LEN / 2 - 14);
      this.mesh.add(this.beam, this.beam.target);
    }
    this.active = false;     // present in this run
    this.driving = false;
    this.x = 0; this.z = 0; this.y = 0; this.heading = 0; this.speed = 0;
    this.bumps = 0;          // collisions this run, for tests
    this._v = new THREE.Vector3();
    this._t = new THREE.Vector3();
    // chase camera
    this.view = 'chase';
    this.camYaw = 0; this.lookYaw = 0; this.lookPitch = 0; this.lookIdle = 9;
    this.camDist = 6.5; this.shake = 0;
  }

  place(x, z, heading) {
    this.active = true;
    this.driving = false;
    this.x = x; this.z = z; this.heading = heading; this.speed = 0;
    this.bumps = 0;
    this.mesh.visible = true;
    this._pose(0);
  }

  remove() {
    if (this.driving) this.exit();
    this.active = false;
    this.mesh.visible = false;
    if (this.beam) this.beam.intensity = 0;
  }

  // the F prompt, when the player is next to it or in it
  prompt() {
    if (!this.active) return null;
    if (this.driving) return 'Get out';
    const p = this.game.player.state;
    return Math.hypot(p.x - this.x, p.z - this.z) < 3.4 && Math.abs(p.y - this.y) < 2 ? 'Drive the truck' : null;
  }

  toggle() { if (this.driving) this.exit(); else this.enter(); }

  enter() {
    const g = this.game;
    this.driving = true;
    this.speed = 0;
    g.weapons.model.gun.visible = false;
    g.weapons.wantAds = false;
    const p = g.player.state;
    p.yaw = this.heading; p.pitch = -0.12;
    this.camYaw = this.heading; this.lookYaw = 0; this.lookPitch = 0; this.lookIdle = 9;
    this.camDist = 6.5; this.shake = 0; this.yawRate = 0; this._lastHeading = this.heading;
    audio.engine.start();
  }

  exit() {
    const g = this.game, p = g.player.state;
    this.driving = false;
    this.speed = 0;
    audio.engine.stop();
    // out of the driver's door, or the other one if that is against a wall
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    for (const side of [-1, 1, 0]) {
      const x = side ? this.x + c * side * (WID / 2 + 0.9) : this.x + s * (LEN / 2 + 1);
      const z = side ? this.z - s * side * (WID / 2 + 0.9) : this.z + c * (LEN / 2 + 1);
      if (!g.blockedAt(x, z)) { p.x = x; p.z = z; break; }
    }
    p.y = g.player.groundAt(p.x, p.z, this.y + 1.5);
    p.vx = p.vy = p.vz = 0;
    g.weapons.model.gun.visible = true;
    g.camera.fov = g.fovCurrent = g.baseFov;
    g.camera.updateProjectionMatrix();
    g.player.applyToCamera(0);
  }

  // Would the truck's footprint at (x, z, heading) hit anything?
  _blocked(x, z, h) {
    const g = this.game, s = Math.sin(h), c = Math.cos(h);
    // blockedAt already pads each point by 0.55 m, so these sit 0.55 m inside
    // the body: the footprint comes out at the truck's real 2.0 x 4.6 m
    for (const [lx, lz] of [[-0.45, -1.75], [0.45, -1.75], [-0.45, 1.75], [0.45, 1.75], [-0.45, 0], [0.45, 0], [0, -1.75], [0, 1.75]]) {
      // local +x is the truck's right, -z its front
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      if (g.blockedAt(wx, wz)) return true;
    }
    return false;
  }

  // inp: { throttle -1..1, steer -1..1, brake }
  update(dt, inp) {
    if (!this.active) return;
    if (this.driving) {
      const t = inp.throttle, st = inp.steer;
      if (inp.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), BRAKE * dt);
      else if (t) {
        // pressing against the direction of travel brakes first
        const k = Math.sign(t) !== Math.sign(this.speed) && Math.abs(this.speed) > 0.5 ? BRAKE : ACCEL;
        this.speed += t * k * dt;
      }
      this.speed *= 1 - DRAG * dt * (t ? 0.25 : 1);
      this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REV, MAX_FWD);
      const grip = THREE.MathUtils.clamp(this.speed / 6, -1, 1);
      this.heading -= st * TURN * grip * dt;
    } else {
      this.speed *= 1 - 3 * dt;
    }
    if (Math.abs(this.speed) < 0.02) this.speed = 0;

    // move, refusing any step that would put the footprint into a box
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const nx = this.x - s * this.speed * dt, nz = this.z - c * this.speed * dt;
    if (this.speed !== 0) {
      if (this._blocked(nx, nz, this.heading)) {
        if (Math.abs(this.speed) > 4) { audio.spatial.impact(nx, this.y + 0.8, nz, 'metal'); this.shake = Math.min(1, Math.abs(this.speed) / 10); }
        this.speed *= -0.25;
        this.bumps++;
      } else {
        this.x = nx; this.z = nz;
      }
    }
    const P = this.game.playBounds;
    if (P) { this.x = THREE.MathUtils.clamp(this.x, P.minX + 3, P.maxX - 3); this.z = THREE.MathUtils.clamp(this.z, P.minZ + 3, P.maxZ - 3); }

    // run-overs
    if (Math.abs(this.speed) > 5) {
      for (const r of this.game.robots) {
        if (r.dead) continue;
        const q = r.root.position;
        const lx = (q.x - this.x) * c - (q.z - this.z) * s, lz = (q.x - this.x) * s + (q.z - this.z) * c;
        if (Math.abs(lx) < WID / 2 + 0.3 && Math.abs(lz) < LEN / 2 + 0.3) {
          const res = r.damage(999, 'body');
          if (res && res.killed) this.game.registerKill(r, false, q.clone());
          this.speed *= 0.8;
        }
      }
    }
    this._pose(dt);
    this._effects(dt, inp);
    if (this.beam) {
      const n = this.game.atmos ? this.game.atmos.night : 0;
      this.beam.intensity = this.active ? 90 * Math.max(n, this.driving ? 0.15 : 0) : 0;
    }
    if (this.driving) audio.engine.set(Math.abs(this.speed) / MAX_FWD, Math.abs(inp.throttle || 0));
  }

  // exhaust at the pipe; dust behind the rear wheels (spray in the rain)
  _effects(dt, inp) {
    const g = this.game, V = g.vfx;
    if (!V || !this.active) return;
    if (g.camera.position.distanceToSquared(this.mesh.position) > 80 * 80) return;
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const fx = -s, fz = -c, rx = c, rz = -s;           // forward, right
    const k = this.driving ? Math.min(1, Math.abs(inp.throttle || 0) * 0.7 + Math.abs(this.speed) / MAX_FWD * 0.3) : 0.05;
    const v = this._ev || (this._ev = new THREE.Vector3()), d = this._ed || (this._ed = new THREE.Vector3(-fx, 0, -fz));
    d.set(-fx, 0, -fz);
    v.set(this.x - fx * 2.45 - rx * 0.62, this.y + 0.38, this.z - fz * 2.45 - rz * 0.62);
    if (this.driving || Math.random() < 0.3) V.exhaust(v, d, k);
    const sp = Math.abs(this.speed);
    if (sp > 2.5) {
      const wet = g.atmos && g.atmos.state && g.atmos.state.weather === 'rain';
      for (const e of [-1, 1]) {
        v.set(this.x - fx * 1.5 + rx * 0.85 * e, this.y, this.z - fz * 1.5 + rz * 0.85 * e);
        V.wheelDust(v, sp, g.town ? g.town.groundKind(v.x, v.z) : 'asphalt', wet);
      }
    }
  }

  _pose(dt) {
    const g = this.game;
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    const yF = g.player.groundAt(this.x - s * 1.6, this.z - c * 1.6, this.y + 1.5);
    const yB = g.player.groundAt(this.x + s * 1.6, this.z + c * 1.6, this.y + 1.5);
    this.y = (yF + yB) / 2;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.rotation.y = this.heading;
    this.mesh.rotateX(Math.atan2(yF - yB, 3.2));
    for (const w of this.wheels) w.rotation.x -= this.speed * dt / 0.42;
  }

  // The driver sits in the cab. The camera follows on its own: its base
  // direction springs round to the truck's heading (faster at speed), the
  // mouse adds a look offset that relaxes back once the mouse is still, the
  // boom lengthens and the FOV widens with speed, and the boom is shortened
  // against anything solid between the truck and the camera.
  // look: { dx, dy, view } -- this frame's mouse movement and the view key.
  placeDriverAndCamera(dt, look = {}) {
    const g = this.game, p = g.player.state, cam = g.camera;
    p.x = this.x; p.z = this.z; p.y = this.y + 0.2;
    p.vx = p.vy = p.vz = 0;
    if (look.view) this.view = this.view === 'chase' ? 'cab' : 'chase';
    const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

    const sens = CFG.camera.lookSens * (g.player.sensMul || 1);
    if (look.dx || look.dy) {
      this.lookYaw = wrap(this.lookYaw - (look.dx || 0) * sens);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - (look.dy || 0) * sens, -0.9, 0.7);
      this.lookIdle = 0;
    } else this.lookIdle += dt;
    if (this.lookIdle > 1.5) {
      const k = 1 - Math.exp(-3 * dt);
      this.lookYaw -= this.lookYaw * k; this.lookPitch -= this.lookPitch * k;
    }
    // behind the truck whichever way it is rolling: reversing keeps the view
    // looking along the bonnet, it never spins round
    const sp = Math.abs(this.speed);
    // lead into turns: aim where the truck will be pointing a moment from now,
    // so in a tight corner the road it is turning onto stays in view
    if (this._lastHeading === undefined) this._lastHeading = this.heading;
    const rate = dt > 0 ? wrap(this.heading - this._lastHeading) / dt : 0;
    this._lastHeading = this.heading;
    this.yawRate = THREE.MathUtils.damp(this.yawRate || 0, rate, 6, dt);
    // half the turn the truck will make in the next 0.8 s: the middle of the arc
    const lead = THREE.MathUtils.clamp(this.yawRate * 0.4, -0.6, 0.6);
    this.camYaw = wrap(this.camYaw + wrap(this.heading + lead - this.camYaw) * (1 - Math.exp(-(5 + sp * 0.2 + Math.abs(this.yawRate) * 8) * dt)));
    const k01 = Math.min(1, sp / MAX_FWD);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const rumble = k01 * 0.004 + this.shake * 0.03;
    const sx = (Math.random() - 0.5) * rumble, sy = (Math.random() - 0.5) * rumble;

    let yaw, pitch;
    if (this.view === 'cab') {
      yaw = wrap(this.heading + this.lookYaw);
      pitch = this.lookPitch - 0.04;
      // a bonnet camera: centred, just behind the windscreen, above the cab
      // line so the bonnet is a strip at the bottom of the view, not half of it
      const s = Math.sin(this.heading), c = Math.cos(this.heading);
      cam.position.set(this.x - s * 1.55, this.y + 2.05, this.z - c * 1.55);
    } else {
      yaw = wrap(this.camYaw + this.lookYaw);
      pitch = -0.16 - k01 * 0.04 + this.lookPitch;
      const dir = this._v.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const T = this._t.set(this.x, this.y + 1.9, this.z);
      const want = 6.2 + 2.6 * k01;
      this.camDist = THREE.MathUtils.damp(this.camDist, want, 3, dt);
      let d = this.camDist;
      // shorten the boom against walls, the station and the hillside
      const back = dir.clone().negate();
      const hit = g.traceShot(T, back, d + 0.4, true);
      if (hit && hit.distance < d + 0.4) d = Math.max(1.4, hit.distance - 0.4);
      const cx = T.x - dir.x * d, cz = T.z - dir.z * d;
      // outdoors the hillside can be above the truck: ask from above both
      const top = g.player.inVoid && g.player.inVoid(cx, cz) ? T.y + 2 : Math.max(T.y, g.surfaceH(cx, cz)) + 2;
      const floor = g.player.groundAt(cx, cz, top) + 0.5;
      cam.position.set(cx, Math.max(T.y - dir.y * d, floor), cz);
    }
    p.yaw = yaw; p.pitch = pitch;
    cam.rotation.set(pitch + sy, yaw + sx, 0, 'YXZ');
    const fov = g.baseFov + (this.view === 'chase' ? 9 * k01 : 4 * k01);
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = fov; cam.updateProjectionMatrix(); }
    g.fovCurrent = fov;
  }
}
