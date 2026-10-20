import * as THREE from 'three';
import * as audio from './audio.js';

// One drivable vehicle: a courier's pickup truck, mission 2 only.
//
// Arcade handling -- throttle, brake (Space), steering that scales with speed
// -- on the analytic terrain, colliding with the same boxes the player does
// (the truck's footprint is sampled at eight points). The camera orbits behind
// it with the mouse. F gets in and out. Running a soldier down at speed kills
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
    this.active = false;     // present in this run
    this.driving = false;
    this.x = 0; this.z = 0; this.y = 0; this.heading = 0; this.speed = 0;
    this.bumps = 0;          // collisions this run, for tests
    this._v = new THREE.Vector3();
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
    g.player.applyToCamera(0);
  }

  // Would the truck's footprint at (x, z, heading) hit anything?
  _blocked(x, z, h) {
    const g = this.game, s = Math.sin(h), c = Math.cos(h);
    for (const [lx, lz] of [[-0.75, -2.0], [0.75, -2.0], [-0.75, 2.0], [0.75, 2.0], [-0.75, 0], [0.75, 0], [0, -2.1], [0, 2.1]]) {
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
        if (Math.abs(this.speed) > 4) { audio.spatial.impact(nx, this.y + 0.8, nz, 'metal'); this.game.fx.addShake(Math.min(0.05, Math.abs(this.speed) * 0.003)); }
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
    if (this.driving) audio.engine.set(Math.abs(this.speed) / MAX_FWD, Math.abs(inp.throttle || 0));
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

  // The driver sits in the cab; the camera orbits behind with the mouse.
  placeDriverAndCamera() {
    const g = this.game, p = g.player.state, cam = g.camera;
    p.x = this.x; p.z = this.z; p.y = this.y + 0.2;
    p.vx = p.vy = p.vz = 0;
    const dir = this._v.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    const tx = this.x, ty = this.y + 1.8, tz = this.z;
    let d = 7;
    // pull in if the boom would go into a wall
    for (; d > 2.5; d -= 0.5) if (!g.blockedAt(tx - dir.x * d, tz - dir.z * d)) break;
    cam.position.set(tx - dir.x * d, Math.max(ty - dir.y * d, g.player.groundAt(tx - dir.x * d, tz - dir.z * d, ty + 3) + 0.6), tz - dir.z * d);
    cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  }
}
