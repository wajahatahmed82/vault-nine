import * as THREE from 'three';
import { CFG } from './config.js';

// Player simulation, deliberately kept free of any renderer reads.
//
// `state` is a plain serialisable object and `step()` is a pure function of
// (state, input, dt). Collision runs against axis-aligned boxes that carry a
// `top` height, which is what gives the map stairs, platforms and crates you
// can climb rather than invisible walls.

const STEP_UP = 0.46;     // auto-climb height, so kerbs and low crates are free

// Movement tuning. Times in seconds, distances in metres.
export const MOVE = {
  slideTime: 0.85,         // how long a slide carries
  slideTilt: 0.075,        // camera roll while sliding (radians)
  tacticalTime: 2.6,       // tactical sprint burst
  tacticalCooldown: 7,
  tacticalMul: 1.32,       // over normal sprint speed
  proneSpeed: 1.05,
  proneHeight: 0.42,       // eye height lying down
  proneTime: 0.32,
  leanReach: 0.42,         // how far the head moves out
  leanRoll: 0.16,
  leanRate: 6,
  mantleMin: 0.45,         // anything lower is a step, not a climb
  mantleMax: 1.3,          // waist to chest height
  mantleTime: 0.5,
  vaultTime: 0.62,
};

// 2D ray (x,z)+(fx,fz)*t against a box's X/Z footprint, t in [0, maxT].
// Returns [entry, exit] or null.
function segBox(x, z, fx, fz, maxT, c) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[x, fx, c.minX, c.maxX], [z, fz, c.minZ, c.maxZ]]) {
    if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return null; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t1 < t0) return null;
  }
  return t0 <= maxT ? [t0, t1] : null;
}

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
      prone: 0,             // 0 up -> 1 lying down
      lean: 0, leanX: 0, leanZ: 0,
      slideT: 0,
      tactical: 0, tacCool: 0,
      mantling: false,
    };
    this.slideDir = new THREE.Vector2(0, -1);
    this.slideSpeed = 0;
    this.slideTilt = 0;
    this.proneWant = false;
    this.lastCrouch = false;
    this.mantle = null;
    this.onSlide = () => {};
    this.onMantle = () => {};

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
    s.prone = 0; s.lean = 0; s.leanX = 0; s.leanZ = 0;
    s.slideT = 0; s.tactical = 0; s.tacCool = 0; s.mantling = false;
    this.proneWant = false; this.lastCrouch = false; this.mantle = null; this.slideTilt = 0;
    this.bobT = this.bobY = this.bobX = 0;
    this.moveAmount = 0;
    this.sprintHold = 0;
    this.landPunch = 0;
  }

  get eyeHeight() {
    const h = THREE.MathUtils.lerp(CFG.camera.standHeight, CFG.camera.crouchHeight, this.state.crouch);
    return THREE.MathUtils.lerp(h, MOVE.proneHeight, this.state.prone || 0);
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

  // input: { moveX, moveY, lookDX, lookDY, jump, crouch, sprint,
  //          lean (-1/0/1), prone (toggle edge), tactical (edge) }
  //
  // Movement set: walk, sprint, tactical sprint (a short faster burst on a
  // second sprint press), crouch, prone, slide (crouch while sprinting), lean
  // (camera and aim shift sideways, the body stays put), and mantle/vault
  // over waist-high cover on jump. Every state is driven by its own input and
  // none of them blocks firing, aiming or reloading.
  step(dt, input, adsAmount) {
    const s = this.state;
    const P = CFG.player;
    const M = MOVE;

    // ---- look ----
    const sens = CFG.camera.lookSens * this.sensMul *
      THREE.MathUtils.lerp(1, CFG.camera.adsSensMul, adsAmount) * (s.prone > 0.5 ? 0.8 : 1);
    s.yaw -= input.lookDX * sens;
    s.pitch = THREE.MathUtils.clamp(s.pitch - input.lookDY * sens,
      CFG.camera.pitchMin, CFG.camera.pitchMax);
    if (s.yaw > Math.PI) s.yaw -= Math.PI * 2;
    if (s.yaw < -Math.PI) s.yaw += Math.PI * 2;

    // ---- mantle / vault in progress: the move owns the body ----
    if (this.mantle) {
      this._stepMantle(dt);
      this._lean(dt, 0);
      this._bob(dt, adsAmount, 0);
      this.applyToCamera(adsAmount);
      return;
    }

    let jump = !!input.jump;
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));

    // ---- prone: toggle; jump or sprint gets you up ----
    if (input.prone) this.proneWant = !this.proneWant && s.grounded;
    if (this.proneWant && (jump || (input.sprint && mag > 0.5))) { this.proneWant = false; jump = false; }
    let wantProne = this.proneWant ? 1 : 0;
    if (!wantProne && s.prone > 0 && this._ceilingBelow(s.y + CFG.camera.crouchHeight + P.eyeToTop)) wantProne = 1;
    const pRate = dt / M.proneTime;
    s.prone = THREE.MathUtils.clamp(s.prone + THREE.MathUtils.clamp(wantProne - s.prone, -pRate, pRate), 0, 1);

    // ---- mantle starts on jump when waist-high cover is right in front ----
    if (jump && s.grounded && s.prone < 0.1 && this._tryMantle()) {
      this._lean(dt, 0);
      this.applyToCamera(adsAmount);
      return;
    }

    // ---- slide: crouch pressed while sprinting ----
    const crouchEdge = input.crouch && !this.lastCrouch;
    this.lastCrouch = !!input.crouch;
    if (crouchEdge && s.sprinting && s.grounded && s.slideT <= 0) {
      const v = Math.hypot(s.vx, s.vz) || 1;
      this.slideDir.set(s.vx / v, s.vz / v);
      this.slideSpeed = Math.max(v, P.sprintSpeed) * (s.tactical > 0 ? 1.08 : 1.15);
      s.slideT = M.slideTime;
      s.tactical = 0;
      this.onSlide(true);
    }
    const sliding = s.slideT > 0;

    // ---- crouch (forced during a slide), blocked from standing under ceilings ----
    let wantCrouch = (input.crouch || sliding) ? 1 : 0;
    if (!wantCrouch && s.crouch > 0 && this._ceilingBelow(s.y + CFG.camera.standHeight + P.eyeToTop)) wantCrouch = 1;
    const cRate = dt / CFG.camera.crouchTime;
    s.crouch = THREE.MathUtils.clamp(s.crouch + THREE.MathUtils.clamp(wantCrouch - s.crouch, -cRate, cRate), 0, 1);

    // ---- sprint and the tactical burst ----
    const wantSprint = input.sprint !== undefined
      ? input.sprint && mag > 0.5 && input.moveY < -0.3
      : mag > 0.88 && input.moveY < -0.55;
    this.sprintHold = (wantSprint && adsAmount < 0.3 && s.crouch < 0.5 && s.prone < 0.3 && !sliding) ? this.sprintHold + dt : 0;
    s.sprinting = this.sprintHold > 0.12 && s.grounded;
    s.tacCool = Math.max(0, s.tacCool - dt);
    // A double-tap of Shift drops the sprint for a frame or two, so the request
    // is held briefly and fires as soon as the sprint is back.
    if (input.tactical) this.tacBuffer = 0.45;
    this.tacBuffer = Math.max(0, (this.tacBuffer || 0) - dt);
    if (this.tacBuffer > 0 && (s.sprinting || (wantSprint && this.sprintHold > 0)) && s.tacCool <= 0 && s.tactical <= 0) {
      s.tactical = M.tacticalTime; this.tacBuffer = 0;
    }
    if (s.tactical > 0) {
      s.tactical -= dt;
      if ((!s.sprinting && !wantSprint) || s.tactical <= 0) { s.tactical = 0; s.tacCool = M.tacticalCooldown; }
    }

    let speed = P.walkSpeed;
    if (s.tactical > 0 && wantSprint) speed = P.sprintSpeed * M.tacticalMul;
    else if (s.sprinting) speed = P.sprintSpeed;
    else if (s.prone > 0.5) speed = M.proneSpeed;
    else if (s.crouch > 0.5) speed = P.crouchSpeed;
    else if (adsAmount > 0.3) speed = P.adsSpeed;

    // ---- wish velocity in world space ----
    let wishX = 0, wishZ = 0;
    if (mag > 0.05) {
      const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
      wishX = (-sin * -input.moveY + cos * input.moveX) * speed;
      wishZ = (-cos * -input.moveY - sin * input.moveX) * speed;
    }

    if (sliding) {
      // momentum carries; friction bleeds it off; a little steering
      s.slideT -= dt;
      const k = Math.max(0, s.slideT / M.slideTime);
      const sp = THREE.MathUtils.lerp(P.crouchSpeed, this.slideSpeed, k * k * (3 - 2 * k));
      if (mag > 0.05) {
        const wl = Math.hypot(wishX, wishZ) || 1;
        this.slideDir.x += (wishX / wl - this.slideDir.x) * Math.min(1, dt * 1.2);
        this.slideDir.y += (wishZ / wl - this.slideDir.y) * Math.min(1, dt * 1.2);
        this.slideDir.normalize();
      }
      s.vx = this.slideDir.x * sp; s.vz = this.slideDir.y * sp;
      if (jump) { s.slideT = 0; this.onSlide(false); }
      else if (s.slideT <= 0) this.onSlide(false);
    } else {
      const accel = s.grounded ? ((wishX || wishZ) ? P.accel : P.decel) : P.airAccel;
      s.vx = THREE.MathUtils.damp(s.vx, wishX, accel, dt);
      s.vz = THREE.MathUtils.damp(s.vz, wishZ, accel, dt);
      if (s.grounded && Math.abs(s.vx) < 0.02) s.vx = 0;
      if (s.grounded && Math.abs(s.vz) < 0.02) s.vz = 0;
    }

    // ---- jump ----
    if (jump && s.grounded && s.prone < 0.3) {
      s.vy = P.jumpSpeed;
      s.grounded = false;
    }

    // ---- horizontal move, one axis at a time so walls slide ----
    const nx = s.x + s.vx * dt;
    if (!this.blocked(nx, s.z, s.y)) s.x = nx; else { s.vx = 0; if (sliding) { s.slideT = 0; this.onSlide(false); } }
    const nz = s.z + s.vz * dt;
    if (!this.blocked(s.x, nz, s.y)) s.z = nz; else { s.vz = 0; if (sliding && s.slideT > 0) { s.slideT = 0; this.onSlide(false); } }
    this._clampBounds();

    // ---- vertical ----
    const wasGrounded = s.grounded;
    s.vy -= P.gravity * dt;
    s.y += s.vy * dt;

    const floor = this.groundAt(s.x, s.z, s.y);
    if (s.y <= floor) {
      if (!s.grounded && s.vy < -4) {
        // landing dip scales with how hard you came down
        this.landPunch = Math.min(0.2, -s.vy * 0.018);
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

    // ---- lean: no leaning while sprinting or sliding ----
    this._lean(dt, (s.sprinting || sliding) ? 0 : (input.lean || 0));

    this._bob(dt, adsAmount, sliding ? 0 : 1);
    this.applyToCamera(adsAmount);
  }

  _clampBounds() {
    const s = this.state, P = CFG.player;
    if (this.bounds) {
      const B = this.bounds;
      s.x = Math.min(B.maxX, Math.max(B.minX, s.x));
      s.z = Math.min(B.maxZ, Math.max(B.minZ, s.z));
    } else {
      const d = Math.hypot(s.x, s.z);
      if (d > P.arenaRadius) { s.x = (s.x / d) * P.arenaRadius; s.z = (s.z / d) * P.arenaRadius; }
    }
  }

  // Any ceiling over the player lower than `headY`?
  _ceilingBelow(headY) {
    const s = this.state, r = CFG.player.radius;
    for (const c of this.near(s.x, s.z, r)) {
      if (s.x + r <= c.minX || s.x - r >= c.maxX || s.z + r <= c.minZ || s.z - r >= c.maxZ) continue;
      if (c.bottom !== undefined && c.bottom < headY && c.top > s.y + 0.2) return true;
    }
    return false;
  }

  // Lean toward `want` (-1 left .. 1 right), backing off if a wall is in the way
  // of the head, so leaning never puts the camera through a wall.
  _lean(dt, want) {
    const s = this.state;
    const reach = MOVE.leanReach * (s.prone > 0.5 ? 0.6 : 1);
    if (want) {
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      const head = s.y + this.eyeHeight;
      const hx = s.x + rx * reach * want, hz = s.z + rz * reach * want;
      for (const c of this.near(hx, hz, 0.2)) {
        if (hx + 0.18 <= c.minX || hx - 0.18 >= c.maxX || hz + 0.18 <= c.minZ || hz - 0.18 >= c.maxZ) continue;
        if (c.top > head - 0.1 && (c.bottom === undefined || c.bottom < head + 0.1)) { want *= 0.25; break; }
      }
    }
    s.lean += THREE.MathUtils.clamp(want - s.lean, -dt * MOVE.leanRate, dt * MOVE.leanRate);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    s.leanX = rx * reach * s.lean;
    s.leanZ = rz * reach * s.lean;
  }

  _bob(dt, adsAmount, on) {
    const s = this.state, P = CFG.player;
    const vel = Math.hypot(s.vx, s.vz);
    this.moveAmount = THREE.MathUtils.clamp(vel / P.walkSpeed, 0, 1.6);
    const steady = (1 - adsAmount * 0.75) * (s.grounded ? 1 : 0.2) * on * (s.prone > 0.5 ? 0.4 : 1);
    this.bobT += dt * vel * 1.9;
    const amt = Math.min(1, vel / P.walkSpeed) * steady;
    this.bobY = Math.abs(Math.sin(this.bobT)) * 0.042 * amt;
    this.bobX = Math.sin(this.bobT * 0.5) * 0.028 * amt;
    this.landPunch = Math.max(0, this.landPunch - dt * 0.55);
    // slide tilt eases in and out
    const tiltWant = s.slideT > 0 ? MOVE.slideTilt : 0;
    this.slideTilt += (tiltWant - this.slideTilt) * Math.min(1, dt * 10);

    if (vel > 0.8 && s.grounded && s.slideT <= 0) {
      const phase = Math.floor(this.bobT / Math.PI);
      if (phase !== this.stepPhase) {
        this.stepPhase = phase;
        this.onFootstep(s.sprinting, s.prone > 0.5 ? 'crawl' : s.crouch > 0.5 ? 'crouch' : 'walk');
      }
    }
  }

  // ---- mantle and vault ----

  // Waist-high cover straight ahead within reach? Then climb onto it, or over
  // it when it is thin and there is lower ground on the far side.
  _tryMantle() {
    const s = this.state, P = CFG.player;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const px = s.x + fx * 0.75, pz = s.z + fz * 0.75;
    let best = null;
    for (const c of this.near(px, pz, 0.45)) {
      if (c.top <= s.y + MOVE.mantleMin || c.top > s.y + MOVE.mantleMax) continue;
      if (c.bottom !== undefined && c.bottom > s.y + 0.4) continue;
      const hit = segBox(s.x, s.z, fx, fz, 1.3, c);
      if (!hit) continue;
      if (!best || hit[0] < best.t0) best = { c, t0: hit[0], t1: hit[1] };
    }
    if (!best) return false;
    const top = best.c.top;
    // the top of everything under the climb path must be within reach too
    const depth = best.t1 - best.t0;
    const over = best.t1 + 0.6;
    const ox = s.x + fx * over, oz = s.z + fz * over;
    const ground = this.groundAt(ox, oz, top + 0.2);
    let to;
    if (depth < 1.1 && ground < top - 0.25 && !this.blocked(ox, oz, ground)) {
      to = { x: ox, y: ground, z: oz, vault: true };
    } else {
      const ux = s.x + fx * (best.t0 + 0.5), uz = s.z + fz * (best.t0 + 0.5);
      const onTop = this.groundAt(ux, uz, top + 0.1);
      if (onTop < top - 0.05 || this.blocked(ux, uz, onTop)) return false;
      to = { x: ux, y: onTop, z: uz, vault: false };
    }
    // headroom over the obstacle for the whole move
    const head = top + CFG.camera.crouchHeight + P.eyeToTop;
    const mx = s.x + fx * (best.t0 + 0.3), mz = s.z + fz * (best.t0 + 0.3);
    for (const c of this.near(mx, mz, P.radius)) {
      if (c === best.c) continue;
      if (mx + 0.3 <= c.minX || mx - 0.3 >= c.maxX || mz + 0.3 <= c.minZ || mz - 0.3 >= c.maxZ) continue;
      if (c.top > top + 0.2 && (c.bottom === undefined || c.bottom < head)) return false;
    }
    this.mantle = { t: 0, dur: to.vault ? MOVE.vaultTime : MOVE.mantleTime, from: { x: s.x, y: s.y, z: s.z }, to, top };
    s.vx = s.vz = s.vy = 0;
    s.slideT = 0;
    s.mantling = true;
    this.onMantle(to.vault);
    return true;
  }

  _stepMantle(dt) {
    const s = this.state, m = this.mantle;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    const e = k * k * (3 - 2 * k);
    // up first, then across, then (for a vault) down the far side
    const lift = Math.min(1, k / 0.45);
    const peak = m.top + 0.12;
    let y;
    if (m.to.vault) y = k < 0.55 ? THREE.MathUtils.lerp(m.from.y, peak, lift * lift * (3 - 2 * lift)) : THREE.MathUtils.lerp(peak, m.to.y, (k - 0.55) / 0.45);
    else y = THREE.MathUtils.lerp(m.from.y, m.to.y, lift * lift * (3 - 2 * lift));
    const across = Math.max(0, (e - 0.15) / 0.85);
    s.x = THREE.MathUtils.lerp(m.from.x, m.to.x, across);
    s.z = THREE.MathUtils.lerp(m.from.z, m.to.z, across);
    s.y = y;
    s.grounded = false;
    if (k >= 1) {
      s.y = m.to.y; s.grounded = true; s.mantling = false;
      // carry a little forward speed out of a vault
      if (m.to.vault) { const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw); s.vx = fx * 2.5; s.vz = fz * 2.5; }
      this.mantle = null;
      this.landPunch = 0.05;
      this.onLand(3);
    }
  }

  applyToCamera(adsAmount) {
    const s = this.state;
    const cam = this.camera;
    const m = this.mantle;
    const dip = m ? Math.sin(Math.min(1, m.t / m.dur) * Math.PI) * 0.12 : 0;
    cam.position.set(s.x + this.bobX + (s.leanX || 0), s.y + this.eyeHeight + this.bobY - this.landPunch - dip
      - Math.abs(s.lean || 0) * 0.06, s.z + (s.leanZ || 0));
    cam.rotation.order = 'YXZ';
    cam.rotation.y = s.yaw;
    cam.rotation.x = s.pitch;
    cam.rotation.z = -this.bobX * 0.32 * (1 - adsAmount * 0.85) - (s.lean || 0) * MOVE.leanRoll + this.slideTilt
      + (m ? Math.sin(Math.min(1, m.t / m.dur) * Math.PI) * 0.05 : 0);
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
