import * as THREE from 'three';
import { CFG } from './config.js';

// Player simulation, deliberately kept free of any renderer reads.
//
// `state` is a plain serialisable object and `step()` is a pure function of
// (state, input, dt). Collision runs against axis-aligned boxes that carry a
// `top` height, which is what gives the map stairs, platforms and crates you
// can climb rather than invisible walls.

const STEP_UP = 0.46;     // auto-climb height, so kerbs and low crates are free

export class Player {
  constructor(camera, colliders, spawn, voids, world) {
    this.camera = camera;
    this.colliders = colliders;
    // Outdoor ground is the terrain (plus kerb height on lots), and colliders
    // come from a grid rather than a list walk. Without a world, flat ground at
    // y=0 and a linear scan, which is what the tools' minimal setups use.
    this.surface = (world && world.surface) || (() => 0);
    this.grid = world && world.grid;
    this.bounds = world && world.bounds;
    // Inside a void the outdoor ground plane does not exist, so the floor comes
    // only from real slab colliders. Without this the basement is unreachable:
    // the player would stand on invisible ground at y=0.
    this.voids = voids || [];
    this.spawn = spawn || { x: 0, z: 0 };

    this.state = {
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0,
      health: CFG.player.maxHealth,
      armor: 0,
      grounded: true,
      crouch: 0,            // 0 standing -> 1 fully crouched
      sprinting: false,
    };

    this.bobT = 0;
    this.bobY = 0;
    this.bobX = 0;
    this.stepPhase = 0;
    this.landPunch = 0;
    this.moveAmount = 0;
    this.sprintHold = 0;
    this.onFootstep = () => {};
    this.onLand = () => {};
    this.sensMul = 1;
  }

  reset() {
    const s = this.state;
    s.x = this.spawn.x; s.z = this.spawn.z;
    s.y = this.inVoid(s.x, s.z) ? 0 : this.surface(s.x, s.z);
    s.vx = s.vy = s.vz = 0;
    s.yaw = this.spawn.yaw || 0; s.pitch = 0;
    s.health = CFG.player.maxHealth;
    s.armor = 0;
    s.grounded = true;
    s.crouch = 0;
    s.sprinting = false;
    this.bobT = this.bobY = this.bobX = 0;
    this.moveAmount = 0;
    this.sprintHold = 0;
    this.landPunch = 0;
  }

  get eyeHeight() {
    return THREE.MathUtils.lerp(CFG.camera.standHeight, CFG.camera.crouchHeight, this.state.crouch);
  }

  inVoid(x, z) {
    for (const v of this.voids) {
      if (x > v.minX && x < v.maxX && z > v.minZ && z < v.maxZ) return true;
    }
    return false;
  }

  // Highest surface directly under (x,z) that is at or below the feet.
  near(x, z, r) {
    return this.grid ? this.grid.query(x - r, z - r, x + r, z + r) : this.colliders;
  }

  groundAt(x, z, feetY) {
    const r = CFG.player.radius;
    let best = this.inVoid(x, z) ? -60 : this.surface(x, z);
    for (const c of this.near(x, z, r)) {
      if (x + r <= c.minX || x - r >= c.maxX || z + r <= c.minZ || z - r >= c.maxZ) continue;
      if (c.top <= feetY + STEP_UP && c.top > best) best = c.top;
    }
    return best;
  }

  blocked(x, z, feetY) {
    const r = CFG.player.radius;
    const head = feetY + this.eyeHeight + CFG.player.eyeToTop;
    // rising ground too steep to step up
    if (!this.inVoid(x, z) && this.surface(x, z) > feetY + STEP_UP) return true;
    for (const c of this.near(x, z, r)) {
      if (x + r <= c.minX || x - r >= c.maxX || z + r <= c.minZ || z - r >= c.maxZ) continue;
      // walk over anything low enough to step onto, duck under anything high
      if (c.top <= feetY + STEP_UP) continue;
      if (c.bottom !== undefined && c.bottom >= head) continue;
      return true;
    }
    return false;
  }

  // input: { moveX, moveY, lookDX, lookDY, jump, crouch, sprint }
  step(dt, input, adsAmount) {
    const s = this.state;
    const P = CFG.player;

    // ---- look ----
    const sens = CFG.camera.lookSens * this.sensMul *
      THREE.MathUtils.lerp(1, CFG.camera.adsSensMul, adsAmount);
    s.yaw -= input.lookDX * sens;
    s.pitch = THREE.MathUtils.clamp(s.pitch - input.lookDY * sens,
      CFG.camera.pitchMin, CFG.camera.pitchMax);
    if (s.yaw > Math.PI) s.yaw -= Math.PI * 2;
    if (s.yaw < -Math.PI) s.yaw += Math.PI * 2;

    // ---- crouch, blocked from standing under low ceilings ----
    let wantCrouch = input.crouch ? 1 : 0;
    if (!wantCrouch && s.crouch > 0) {
      const standHead = s.y + CFG.camera.standHeight + P.eyeToTop;
      for (const c of this.near(s.x, s.z, P.radius)) {
        if (s.x + P.radius <= c.minX || s.x - P.radius >= c.maxX ||
            s.z + P.radius <= c.minZ || s.z - P.radius >= c.maxZ) continue;
        if (c.bottom !== undefined && c.bottom < standHead && c.top > s.y + 0.2) { wantCrouch = 1; break; }
      }
    }
    const cRate = dt / CFG.camera.crouchTime;
    s.crouch = THREE.MathUtils.clamp(s.crouch + THREE.MathUtils.clamp(wantCrouch - s.crouch, -cRate, cRate), 0, 1);

    // ---- speed selection ----
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
    const wantSprint = input.sprint !== undefined
      ? input.sprint && mag > 0.5 && input.moveY < -0.3
      : mag > 0.88 && input.moveY < -0.55;
    this.sprintHold = (wantSprint && adsAmount < 0.3 && s.crouch < 0.5) ? this.sprintHold + dt : 0;
    s.sprinting = this.sprintHold > 0.12 && s.grounded;

    let speed = P.walkSpeed;
    if (s.sprinting) speed = P.sprintSpeed;
    else if (s.crouch > 0.5) speed = P.crouchSpeed;
    else if (adsAmount > 0.3) speed = P.adsSpeed;

    // ---- wish velocity in world space ----
    let wishX = 0, wishZ = 0;
    if (mag > 0.05) {
      const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
      wishX = (-sin * -input.moveY + cos * input.moveX) * speed;
      wishZ = (-cos * -input.moveY - sin * input.moveX) * speed;
    }

    const accel = s.grounded ? ((wishX || wishZ) ? P.accel : P.decel) : P.airAccel;
    s.vx = THREE.MathUtils.damp(s.vx, wishX, accel, dt);
    s.vz = THREE.MathUtils.damp(s.vz, wishZ, accel, dt);
    if (s.grounded && Math.abs(s.vx) < 0.02) s.vx = 0;
    if (s.grounded && Math.abs(s.vz) < 0.02) s.vz = 0;

    // ---- jump ----
    if (input.jump && s.grounded) {
      s.vy = P.jumpSpeed;
      s.grounded = false;
    }

    // ---- horizontal move, one axis at a time so walls slide ----
    const nx = s.x + s.vx * dt;
    if (!this.blocked(nx, s.z, s.y)) s.x = nx; else s.vx = 0;
    const nz = s.z + s.vz * dt;
    if (!this.blocked(s.x, nz, s.y)) s.z = nz; else s.vz = 0;

    if (this.bounds) {
      const B = this.bounds;
      s.x = Math.min(B.maxX, Math.max(B.minX, s.x));
      s.z = Math.min(B.maxZ, Math.max(B.minZ, s.z));
    } else {
      const d = Math.hypot(s.x, s.z);
      if (d > P.arenaRadius) { s.x = (s.x / d) * P.arenaRadius; s.z = (s.z / d) * P.arenaRadius; }
    }

    // ---- vertical ----
    const wasGrounded = s.grounded;
    s.vy -= P.gravity * dt;
    s.y += s.vy * dt;

    const floor = this.groundAt(s.x, s.z, s.y);
    if (s.y <= floor) {
      if (!s.grounded && s.vy < -4) {
        this.landPunch = Math.min(0.16, -s.vy * 0.016);
        this.onLand(-s.vy);
      }
      s.y = floor;
      s.vy = 0;
      s.grounded = true;
    } else if (wasGrounded && s.vy <= 0 && s.y - floor < 0.4) {
      // Follow the ground down slopes and stairs instead of falling a few
      // centimetres every frame, which made footsteps and jumping flicker.
      s.y = floor;
      s.vy = 0;
    } else if (s.y > floor + 0.02) {
      s.grounded = false;
    }

    // ---- head bob from real speed, not from input ----
    const vel = Math.hypot(s.vx, s.vz);
    this.moveAmount = THREE.MathUtils.clamp(vel / P.walkSpeed, 0, 1.6);
    const steady = (1 - adsAmount * 0.75) * (s.grounded ? 1 : 0.2);
    this.bobT += dt * vel * 1.9;
    const amt = Math.min(1, vel / P.walkSpeed) * steady;
    this.bobY = Math.abs(Math.sin(this.bobT)) * 0.042 * amt;
    this.bobX = Math.sin(this.bobT * 0.5) * 0.028 * amt;
    this.landPunch = Math.max(0, this.landPunch - dt * 0.55);

    if (vel > 0.8 && s.grounded) {
      const phase = Math.floor(this.bobT / Math.PI);
      if (phase !== this.stepPhase) {
        this.stepPhase = phase;
        this.onFootstep(s.sprinting);
      }
    }

    this.applyToCamera(adsAmount);
  }

  applyToCamera(adsAmount) {
    const s = this.state;
    const cam = this.camera;
    cam.position.set(s.x + this.bobX, s.y + this.eyeHeight + this.bobY - this.landPunch, s.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = s.yaw;
    cam.rotation.x = s.pitch;
    cam.rotation.z = -this.bobX * 0.32 * (1 - adsAmount * 0.85);
  }

  // Armour soaks two thirds of incoming damage until it is gone.
  hurt(dmg) {
    const s = this.state;
    if (s.armor > 0) {
      const soak = Math.min(s.armor, dmg * 0.66);
      s.armor -= soak;
      dmg -= soak;
    }
    s.health = Math.max(0, s.health - dmg);
    return s.health <= 0;
  }
}
