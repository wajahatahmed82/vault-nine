import * as THREE from 'three';
import { recoilKick, SPRAY_RESET } from './recoil.js';
import { CFG } from './config.js';
import { buildWeaponModel, SIGHT_Y } from './viewmodel.js';

// The first-person weapon renders in a second pass on its own layer, so its
// two lights only shade the weapon rather than every pixel in the world, and
// a fresh depth clear stops the barrel poking through walls.
export const VIEW_LAYER = 1;

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 22);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,226,150,0.85)');
  grad.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,236,190,0.75)';
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 4;
    g.lineWidth = i % 2 ? 2.5 : 4.5;
    g.beginPath();
    g.moveTo(32 - Math.cos(a) * 30, 32 - Math.sin(a) * 30);
    g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
    g.stroke();
  }
  return new THREE.CanvasTexture(c);
}

export class WeaponSystem {
  constructor(camera, audio, mats, progression) {
    this.camera = camera;
    this.audio = audio;
    this.prog = progression;

    this.root = new THREE.Group();
    camera.add(this.root);
    this.sway = new THREE.Group();
    this.root.add(this.sway);
    this.recoilGroup = new THREE.Group();
    this.sway.add(this.recoilGroup);

    this.ids = Object.keys(CFG.weapons);
    this.models = {};
    this.ammo = {};
    this.reserve = {};
    this.mats = mats;
    // Attachments per weapon, one per slot. Spare ones the player carries but
    // has not mounted live in `spare`.
    this.att = {};
    for (const id of this.ids) this.att[id] = { optic: null, muzzle: null, grip: null, mag: null };
    this.spare = [];
    // Ownership. `owned === null` means the arcade rule: every weapon your level
    // has unlocked. The campaign sets a real loadout: two primaries + sidearm.
    this.owned = null;
    this.primaries = [null, null];
    this.zeroIdx = 0;               // marksman zeroing step
    this.itemT = 0; this.itemTotal = 0; this.itemKind = null;   // plate / medkit in hand

    for (const id of this.ids) {
      const spec = CFG.weapons[id];
      const m = buildWeaponModel(spec.shape, mats);
      m.gun.scale.setScalar(0.80);
      m.gun.visible = false;
      this.recoilGroup.add(m.gun);
      this.models[id] = m;
      this.ammo[id] = spec.magSize;
      this.reserve[id] = spec.reserve;
    }

    this.current = 'rifle';
    this.models.rifle.gun.visible = true;

    this.cooldown = 0;
    this.reloading = 0;
    this.reloadTotal = 0;
    this.swapT = 0;
    this.pendingSwap = null;
    this.ads = 0;
    this.wantAds = false;
    this.spread = 0;
    this.triggerHeld = false;
    this.firedThisPress = false;

    this.recoilPitch = 0; this.recoilYaw = 0; this.kick = 0;
    this.camPunch = 0; this.camPunchYaw = 0;

    // Pattern recoil. `pendingKick*` is view rotation waiting to be applied to
    // the player's real aim this frame; `accum*` is how much un-compensated
    // recoil the player is carrying, which recovers once the trigger stops.
    this.sprayIndex = 0;
    this.sinceShot = 99;
    this.pendingKickP = 0; this.pendingKickY = 0;
    this.accumP = 0; this.accumY = 0;

    // Scope sway and breath on the marksman rifle.
    this.swayT = Math.random() * 10;
    this.breathHeld = false;
    this.breathLeft = 4.5;          // seconds of held breath available
    this.breathTired = 0;           // penalty window after holding too long
    this.scopeSwayP = 0; this.scopeSwayY = 0;

    this.sprinting = false;
    this.airborne = false;
    this.sprintOutT = 0;            // sprint-to-fire delay remaining
    this.inspectT = 0;
    this.lagX = 0; this.lagY = 0;   // weapon trails the view, then catches up
    this.floorAt = null;            // set by the game, for shell casings

    this.shotsFired = 0; this.shotsHit = 0;
    this.moveAmount = 0; this.bobT = 0; this.breath = 0;
    this.swayX = 0; this.swayY = 0;

    this._lights();
    this._flash();

    this.hipPos = new THREE.Vector3(0.20, -0.165, -0.40);
    this.hipRot = new THREE.Euler(0.030, -0.115, 0.040);
    this.adsPos = new THREE.Vector3(0, -SIGHT_Y * 0.80, -0.28);
    this.root.position.copy(this.hipPos);
    this.root.rotation.copy(this.hipRot);

    this.shells = [];
    this.shellGeo = new THREE.CylinderGeometry(0.006, 0.0065, 0.026, 6);
    this.shellMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.3, metalness: 0.9 });

    this.root.traverse((o) => o.layers.set(VIEW_LAYER));
    this._lightRefs.forEach((l) => {
      l.layers.set(VIEW_LAYER);
      if (l.target) l.target.layers.set(VIEW_LAYER);
    });
  }

  _lights() {
    this._lightRefs = [];
    const key = new THREE.DirectionalLight(0xfff0dc, 3.2);
    key.position.set(0.7, 0.9, 0.5);
    this.camera.add(key, key.target);
    key.target.position.set(0, -0.25, -1);
    const fill = new THREE.PointLight(0xc8d4dc, 0.55, 4.0, 2);
    fill.position.set(-0.55, 0.05, -0.35);
    this.camera.add(fill);
    this._lightRefs.push(key, fill);
  }

  _flash() {
    this.flashMat = new THREE.MeshBasicMaterial({
      map: flashTexture(), color: 0xffe0a8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide, fog: false,
    });
    this.flash = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), this.flashMat);
      q.rotation.z = i * Math.PI / 3;
      q.renderOrder = 25;
      this.flash.add(q);
    }
    this.flash.visible = false;
    this.recoilGroup.add(this.flash);

    // Short range and a low cap: at range 10 / intensity 8, automatic fire
    // strobed the whole room. (Change carried over from the published artifact.)
    this.flashLight = new THREE.PointLight(0xffbb66, 0, 6, 2);
    this.recoilGroup.add(this.flashLight);
  }

  // Real arms (humans.js FPArms) replace the box hands once the soldier
  // models have loaded.
  useArms(arms) {
    this.arms = arms;
    this.camera.add(arms.root);
    for (const id of this.ids) for (const h of this.models[id].hands.meshes) h.visible = false;
  }

  // ---------- accessors ----------
  get spec() { return CFG.weapons[this.current]; }
  get model() { return this.models[this.current]; }
  get mag() { return this.ammo[this.current]; }
  // Checkpoints restore the loadout as it was, so reloading does not hand the
  // player a free refill or punish them with an empty gun.
  snapshot() {
    return { current: this.current, ammo: { ...this.ammo }, reserve: { ...this.reserve },
      att: JSON.parse(JSON.stringify(this.att)), spare: [...this.spare],
      owned: this.owned ? [...this.owned] : null, primaries: [...this.primaries] };
  }

  restore(s) {
    if (!s) return;
    this.current = s.current;
    this.ammo = { ...s.ammo };
    this.reserve = { ...s.reserve };
    if (s.att) { this.att = JSON.parse(JSON.stringify(s.att)); for (const id of this.ids) this.refreshAttachments(id); }
    if (s.spare) this.spare = [...s.spare];
    if (s.owned !== undefined) { this.owned = s.owned ? new Set(s.owned) : null; this.primaries = [...(s.primaries || [null, null])]; }
    for (const id of this.ids) this.models[id].gun.visible = id === this.current;
    this.reloading = 0;
    this.swapT = 0;
    this.itemT = 0;
  }

  get pool() { return this.reserve[this.current]; }
  get busy() { return this.reloading > 0 || this.swapT > 0 || this.itemT > 0; }

  // ---------- attachments ----------
  // Combined multiplier for one stat across the mounted attachments.
  attMul(stat, id = this.current) {
    let m = 1;
    const a = this.att[id];
    if (!a) return 1;
    for (const k of Object.values(a)) {
      const spec = k && CFG.attachments[k];
      if (spec && spec[stat] !== undefined) m *= spec[stat];
    }
    return m;
  }
  attOf(id = this.current) { return this.att[id] || {}; }
  get noise() { return this.attMul('noise'); }
  get suppressed() { return this.attOf().muzzle === 'suppressor'; }
  // Scoped view: the marksman rifle's own scope or a mounted 4x.
  get scoped() { return this.spec.shape.optic === 'scope' || this.attOf().optic === 'x4'; }
  get fovAds() {
    const z = this.attMul('zoom');
    return this.spec.fovAds * this.attMul('fovMul') / z;
  }
  get adsTimeMul() { return this.attMul('adsTime'); }
  get zero() {
    const zs = this.spec.zeroing;
    return zs ? zs[this.zeroIdx % zs.length] : 100;
  }
  cycleZero(dir) {
    const zs = this.spec.zeroing;
    if (!zs) return false;
    this.zeroIdx = Math.max(0, Math.min(zs.length - 1, this.zeroIdx + dir));
    return true;
  }

  // Mount an attachment on a weapon; whatever was in that slot goes to spare.
  mount(id, key) {
    const spec = CFG.attachments[key];
    if (!spec || !(CFG.fits[id] || []).includes(key)) return false;
    const a = this.att[id];
    if (a[spec.slot]) this.spare.push(a[spec.slot]);
    a[spec.slot] = key;
    const i = this.spare.indexOf(key);
    if (i >= 0) this.spare.splice(i, 1);
    if (spec.slot === 'mag') this.ammo[id] = Math.min(this.ammo[id], this.magSizeOf(id));
    this.refreshAttachments(id);
    return true;
  }
  unmount(id, slot) {
    const a = this.att[id];
    if (!a || !a[slot]) return false;
    this.spare.push(a[slot]);
    a[slot] = null;
    this.ammo[id] = Math.min(this.ammo[id], this.magSizeOf(id));
    this.refreshAttachments(id);
    return true;
  }

  // Small meshes on the viewmodel so you can see what is mounted.
  refreshAttachments(id) {
    const m = this.models[id];
    if (!m) return;
    if (m.attGroup) m.gun.remove(m.attGroup);
    const g = new THREE.Group();
    const a = this.att[id];
    const dark = this.mats.gunMetal, poly = this.mats.gunPoly;
    const mz = m.muzzle.position.z, my = m.muzzle.position.y;
    const cyl = (r, len, mat, z, y = my) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
      c.rotation.x = Math.PI / 2; c.position.set(0, y, z);
      g.add(c);
    };
    if (a.muzzle === 'suppressor') cyl(0.026, 0.17, dark, mz - 0.085);
    if (a.muzzle === 'compensator') cyl(0.024, 0.055, dark, mz - 0.025);
    if (a.grip === 'foregrip') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.085, 0.034), poly);
      b.position.set(0, -0.062, mz * 0.55);
      g.add(b);
    }
    if (a.optic === 'dot' && this.spec && CFG.weapons[id].shape.optic !== 'dot') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.05), dark);
      b.position.set(0, 0.032, -0.07); g.add(b);
    }
    if (a.optic === 'x2') cyl(0.019, 0.11, dark, -0.07, 0.04);
    if (a.optic === 'x4') cyl(0.024, 0.18, dark, -0.07, 0.045);
    m.mag.scale.y = a.mag === 'extmag' ? 1.45 : 1;
    g.traverse((o) => o.layers.set(VIEW_LAYER));
    m.gun.add(g);
    m.attGroup = g;
  }

  // ---------- ownership and slots ----------
  owns(id) {
    if (CFG.weapons[id]?.sidearm) return true;
    return this.owned ? this.owned.has(id) : this.unlocked(id);
  }
  // Weapons in number-key order.
  slotList() {
    if (this.owned) return [...this.primaries.filter(Boolean), 'pistol'];
    return this.ids.filter((i) => !CFG.weapons[i].sidearm && this.unlocked(i)).concat('pistol');
  }
  switchSlot(n) {
    const id = this.slotList()[n];
    return id ? this.switchTo(id) : false;
  }
  // Campaign loadout: two primaries and the sidearm.
  setLoadout(primaries) {
    this.owned = new Set(primaries.filter(Boolean));
    this.primaries = [primaries[0] || null, primaries[1] || null];
    if (!this.owns(this.current)) this.switchTo(this.primaries[0] || 'pistol', true);
  }
  clearLoadout() { this.owned = null; this.primaries = [null, null]; }
  // Pick up a weapon. Returns the weapon it replaced (to drop), or null.
  give(id) {
    if (!this.owned || this.owned.has(id) || CFG.weapons[id]?.sidearm) return null;
    let slot = this.primaries.indexOf(null);
    let dropped = null;
    if (slot < 0) {
      slot = this.primaries.indexOf(this.current);
      if (slot < 0) slot = 1;
      dropped = this.primaries[slot];
      this.owned.delete(dropped);
    }
    this.primaries[slot] = id;
    this.owned.add(id);
    // mid-swap, retarget the swap so the dropped gun never ends up in hand
    if (this.swapT > 0) this.pendingSwap = id;
    else this.switchTo(id);
    return dropped;
  }

  // ---------- consumables in hand ----------
  useItem(kind, time) {
    if (this.itemT > 0 || this.reloading > 0 || this.swapT > 0) return false;
    this.itemKind = kind; this.itemT = time; this.itemTotal = time;
    return true;
  }
  // Hip cone right now, for the dynamic crosshair.
  get cone() {
    const s = this.spec;
    const base = THREE.MathUtils.lerp(s.spreadHip, s.spreadAds, this.ads);
    const air = this.airborne ? 2.4 : 1;
    return Math.max(base, this.spread * THREE.MathUtils.lerp(1, 0.18, this.ads))
      * (1 + this.moveAmount * s.moveSpreadMul) * air * (this.stance || 1);
  }

  // Upgrades are multipliers held by the progression system.
  up(stat) { return this.prog ? this.prog.upgradeMul(stat) : 1; }
  get damage() { return this.spec.damage * this.up('damage') * this.attMul('damage'); }
  get magSize() { return this.magSizeOf(this.current); }
  magSizeOf(id) { return Math.round(CFG.weapons[id].magSize * this.up('magazine') * this.attMul('mag', id)); }
  get fireInterval() { return 60 / (this.spec.rpm * this.up('fireRate')); }

  resetAll() {
    for (const id of this.ids) {
      this.att[id] = { optic: null, muzzle: null, grip: null, mag: null };
      this.refreshAttachments(id);
      this.ammo[id] = Math.round(CFG.weapons[id].magSize * this.up('magazine'));
      this.reserve[id] = CFG.weapons[id].reserve;
    }
    this.spare = [];
    this.zeroIdx = 0;
    this.itemT = 0; this.itemKind = null;
    this.switchTo('rifle', true);
    this.reloading = 0; this.swapT = 0; this.cooldown = 0;
    this.ads = 0; this.spread = this.spec.spreadHip;
    this.recoilPitch = this.recoilYaw = this.camPunch = this.camPunchYaw = 0;
    this.shotsFired = 0; this.shotsHit = 0;
  }

  unlocked(id) {
    return !this.prog || this.prog.level >= CFG.weapons[id].unlockLevel;
  }

  switchTo(id, instant) {
    // `instant` is the tools' and restores' path and skips ownership
    if (!CFG.weapons[id] || id === this.current || (!instant && !this.owns(id))) return false;
    if (instant) {
      this.model.gun.visible = false;
      this.current = id;
      this.model.gun.visible = true;
      this.spread = this.spec.spreadHip;
      return true;
    }
    if (this.swapT > 0) return false;
    this.reloading = 0;
    this.pendingSwap = id;
    this.swapT = 0.42;
    this.audio?.swap();
    return true;
  }

  nextWeapon(dir) {
    const avail = this.slotList();
    const i = avail.indexOf(this.current);
    return this.switchTo(avail[(i + dir + avail.length) % avail.length]);
  }

  startReload() {
    const s = this.spec;
    if (this.busy || this.pool <= 0 || this.mag >= this.magSize) return false;
    const mul = 1 / this.up('reload');
    // Empty reloads are slower because the bolt has to be racked; a tactical
    // reload keeps a round chambered and skips that step.
    this.reloadEmpty = this.mag === 0;
    this.reloadTotal = (this.reloadEmpty ? s.reloadEmpty : s.reloadTime) * mul;
    this.reloading = this.reloadTotal;
    this.audio?.reload(this.reloadTotal);
    return true;
  }

  _finishReload() {
    const need = this.magSize - this.ammo[this.current];
    const take = Math.min(need, this.reserve[this.current]);
    this.ammo[this.current] += take;
    this.reserve[this.current] -= take;
  }

  setMotion(moveAmount, turnX, turnY, state) {
    this.moveAmount = moveAmount;
    this.swayX = THREE.MathUtils.clamp(turnX, -1, 1);
    this.swayY = THREE.MathUtils.clamp(turnY, -1, 1);
    if (state) {
      // Leaving a sprint arms the sprint-to-fire delay: the weapon has to come
      // up before it can fire, which is what makes sprinting a commitment.
      if (this.sprinting && !state.sprinting) this.sprintOutT = this.spec.sprintToFire || 0.2;
      this.sprinting = !!state.sprinting;
      this.airborne = !!state.airborne;
      this.breathHeld = !!state.holdBreath;
      this.stance = state.stance || 1;
    }
  }

  // View rotation the game must add to the player's aim this frame.
  consumeKick() {
    const k = [this.pendingKickP, this.pendingKickY];
    this.pendingKickP = 0; this.pendingKickY = 0;
    return k;
  }

  // The player pulling the mouse against the recoil pays it off, so there is
  // nothing left to "recover" afterwards and the view does not drift past
  // where they put it. `mouseP` is pitch change from the mouse (negative =
  // pulled down); `mouseY` is yaw change (negative = turned right).
  absorb(mouseP, mouseY) {
    if (this.accumP > 0 && mouseP < 0) this.accumP = Math.max(0, this.accumP + mouseP);
    if (this.accumY > 0 && mouseY > 0) this.accumY = Math.max(0, this.accumY - mouseY);
    else if (this.accumY < 0 && mouseY < 0) this.accumY = Math.min(0, this.accumY - mouseY);
  }

  // Once the spray stops, hand back un-compensated recoil so the view settles
  // near where the spray began. Returns [pitchDelta, yawDelta] to apply.
  recover(dt) {
    if (this.sinceShot < this.fireInterval * 1.6) return [0, 0];
    const k = 1 - Math.exp(-(this.spec.recoilRecover || 7) * dt);
    const dp = this.accumP * k, dy = this.accumY * k;
    this.accumP -= dp; this.accumY -= dy;
    return [-dp, dy];
  }

  inspect() {
    if (this.busy || this.ads > 0.2 || this.inspectT > 0) return false;
    this.inspectT = 2.4;
    return true;
  }

  // Returns an array of directions (more than one for the shotgun), or null.
  fire(scene, triggerDown) {
    const s = this.spec;
    if (!s.auto) {
      if (!triggerDown || this.firedThisPress) return null;
    }
    if (this.cooldown > 0 || this.busy) return null;
    // Weapon still coming up out of a sprint.
    if (this.sprinting || this.sprintOutT > 0) return null;
    this.inspectT = 0;
    if (this.mag <= 0) {
      if (!this.firedThisPress) { this.audio?.dryFire(); this.firedThisPress = true; }
      return null;
    }

    this.ammo[this.current]--;
    this.cooldown = this.fireInterval;
    this.shotsFired++;
    this.firedThisPress = true;

    const rc = this.up('recoil');
    // Restart the pattern if the last spray finished.
    if (this.sinceShot > this.fireInterval * SPRAY_RESET) this.sprayIndex = 0;
    const [kickUp, kickSide] = recoilKick(this.current, this.sprayIndex);
    this.sprayIndex++;
    this.sinceShot = 0;
    // Aiming down sights tames the pattern but does not change its shape.
    const tame = (1 - this.ads * 0.25) / rc;
    // grip and compensator tame the pattern without changing its shape
    const upM = this.attMul('recoilUp'), sideM = this.attMul('recoilSide');
    this.pendingKickP += kickUp * tame * upM;
    this.pendingKickY += kickSide * tame * sideM;
    this.accumP += kickUp * tame * upM;
    this.accumY += kickSide * tame * sideM;

    // Viewmodel kick: purely visual now, it no longer steers the shot.
    this.recoilPitch += s.recoilPitch / rc * (1 - this.ads * 0.28);
    this.recoilYaw += kickSide * 1.4 / rc;
    this.kick = s.kickBack;
    // A small camera jolt for impact; the pattern above does the real work.
    this.camPunch += kickUp * 0.12 / rc;
    this.camPunchYaw += kickSide * 0.10 / rc;
    this.spread = Math.min(s.spreadMax, this.spread + s.spreadPerShot);

    const m = this.model;
    this.flash.position.copy(m.muzzle.position).multiplyScalar(0.80);
    this.flashLight.position.copy(this.flash.position);
    this.flash.visible = !this.suppressed;
    this.flashMat.opacity = 0.7;
    this.flash.rotation.z = Math.random() * Math.PI;
    const fs = (0.8 + Math.random() * 0.55) * (s.pellets > 1 ? 1.5 : 1);
    this.flash.scale.set(fs, fs, fs);
    // accumulate toward a cap rather than slamming to full every round
    if (!this.suppressed) this.flashLight.intensity = Math.min(2.2, this.flashLight.intensity + 1.5);

    this._ejectShell(scene);
    this.audio?.shot(this.current, this.suppressed);

    const acc = this.up('accuracy');
    const base = THREE.MathUtils.lerp(s.spreadHip, s.spreadAds, this.ads) / acc;
    // prone steadies the shot, a slide throws it about
    const movePenalty = (1 + this.moveAmount * s.moveSpreadMul) * (this.airborne ? 2.4 : 1) * (this.stance || 1);
    const cone = Math.max(base, this.spread * THREE.MathUtils.lerp(1, 0.18, this.ads) / acc) * movePenalty;

    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    const dirs = [];
    for (let i = 0; i < s.pellets; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * cone;
      dirs.push(fwd.clone()
        .addScaledVector(right, Math.cos(a) * rad)
        .addScaledVector(up, Math.sin(a) * rad).normalize());
    }
    return dirs;
  }

  _ejectShell(scene) {
    if (this.shells.length > 16) scene.remove(this.shells.shift().mesh);
    const m = new THREE.Mesh(this.shellGeo, this.shellMat);
    this.model.port.getWorldPosition(m.position);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const vel = right.multiplyScalar(1.9 + Math.random() * 0.8)
      .add(new THREE.Vector3(0, 1.5 + Math.random() * 0.7, 0))
      .addScaledVector(fwd, 0.3);
    scene.add(m);
    this.shells.push({
      mesh: m, vel, life: 2.4, floorHint: m.position.y,
      spin: new THREE.Vector3((Math.random() - .5) * 22, (Math.random() - .5) * 22, (Math.random() - .5) * 22),
    });
  }

  update(dt, scene) {
    const s = this.spec;
    if (this.cooldown > 0) this.cooldown -= dt;
    this.sinceShot += dt;
    if (!this.sprinting && this.sprintOutT > 0) this.sprintOutT = Math.max(0, this.sprintOutT - dt);
    if (this.inspectT > 0) {
      this.inspectT -= dt;
      if (this.wantAds || this.reloading > 0 || this.triggerHeld) this.inspectT = 0;
    }

    // ---- scope sway and held breath ----
    // Only the marksman rifle sways enough to matter; holding breath steadies
    // it for a few seconds, and holding too long makes it worse for a while.
    const scoped = this.scoped && this.ads > 0.6;
    this.swayT += dt;
    let swayAmt = 0;
    if (scoped) {
      if (this.breathHeld && this.breathLeft > 0 && this.breathTired <= 0) {
        this.breathLeft -= dt;
        swayAmt = 0.08;
        if (this.breathLeft <= 0) this.breathTired = 2.6;
      } else {
        swayAmt = this.breathTired > 0 ? 1.9 : 1.0;
        if (!this.breathHeld) this.breathLeft = Math.min(4.5, this.breathLeft + dt * 0.9);
      }
    } else {
      this.breathLeft = Math.min(4.5, this.breathLeft + dt * 1.5);
    }
    if (this.breathTired > 0) this.breathTired -= dt;
    const A = 0.0068 * swayAmt;
    this.scopeSwayP = THREE.MathUtils.damp(this.scopeSwayP, Math.sin(this.swayT * 0.83) * A * 0.7, 6, dt);
    this.scopeSwayY = THREE.MathUtils.damp(this.scopeSwayY, Math.sin(this.swayT * 0.57 + 1.3) * A, 6, dt);

    // the weapon trails the view a little, then catches up
    this.lagX = THREE.MathUtils.damp(this.lagX, this.swayX, 9, dt);
    this.lagY = THREE.MathUtils.damp(this.lagY, this.swayY, 9, dt);
    if (!this.triggerHeld) this.firedThisPress = false;

    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.pendingSwap && this.swapT <= 0.21) {
        this.model.gun.visible = false;
        this.current = this.pendingSwap;
        this.pendingSwap = null;
        this.model.gun.visible = true;
        this.spread = this.spec.spreadHip;
      }
      if (this.swapT <= 0) this.swapT = 0;
    }

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this._finishReload(); }
    }
    if (this.itemT > 0) {
      this.itemT -= dt;
      if (this.itemT <= 0) { this.itemT = 0; const k = this.itemKind; this.itemKind = null; this.onItemDone && this.onItemDone(k); }
    }

    const target = (this.wantAds && !this.busy) ? 1 : 0;
    const rate = dt / (CFG.camera.adsTime * this.adsTimeMul);
    this.ads = THREE.MathUtils.clamp(this.ads + THREE.MathUtils.clamp(target - this.ads, -rate, rate), 0, 1);

    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, s.recoilRecover, dt);
    this.recoilYaw = THREE.MathUtils.damp(this.recoilYaw, 0, s.recoilRecover, dt);
    this.kick = THREE.MathUtils.damp(this.kick, 0, 14, dt);
    this.camPunch = THREE.MathUtils.damp(this.camPunch, 0, 9, dt);
    this.camPunchYaw = THREE.MathUtils.damp(this.camPunchYaw, 0, 9, dt);
    this.spread = Math.max(THREE.MathUtils.lerp(s.spreadHip, s.spreadAds, this.ads),
      this.spread - s.spreadRecover * dt);

    // ---- pose ----
    const pos = new THREE.Vector3().lerpVectors(this.hipPos, this.adsPos, this.ads);
    const steady = 1 - this.ads * 0.72;

    this.bobT += dt * (6.5 + this.moveAmount * 4.5);
    const bob = this.moveAmount * 0.016 * steady;
    pos.x += Math.sin(this.bobT) * bob;
    pos.y += Math.abs(Math.cos(this.bobT)) * -bob * 0.9;

    this.breath += dt * 1.35;
    pos.x += Math.sin(this.breath * 0.7) * 0.0016 * steady;
    pos.y += Math.sin(this.breath) * 0.0022 * steady;

    pos.x += -this.lagX * 0.034 * steady;
    pos.y += this.lagY * 0.024 * steady;

    // lower the weapon while swapping or sprinting
    const swapDip = this.swapT > 0 ? Math.sin((1 - Math.abs(this.swapT - 0.21) / 0.21) * Math.PI / 2)
      : this.itemT > 0 ? Math.sin(Math.min(1, (1 - this.itemT / this.itemTotal) * 4) * Math.PI / 2) * (this.itemT < 0.3 ? this.itemT / 0.3 : 1) : 0;
    const sprintDip = this.sprinting ? 1 : THREE.MathUtils.clamp(this.sprintOutT * 5, 0, 1);
    const dip = Math.max(swapDip, sprintDip * 0.8);
    pos.y -= dip * 0.16;
    pos.z += dip * 0.08;

    this.root.position.copy(pos);
    this.root.rotation.set(
      THREE.MathUtils.lerp(this.hipRot.x, 0, this.ads) + this.lagY * 0.09 * steady + dip * 0.45,
      THREE.MathUtils.lerp(this.hipRot.y, 0, this.ads) - this.lagX * 0.11 * steady + dip * 0.30,
      THREE.MathUtils.lerp(this.hipRot.z, 0, this.ads) + this.lagX * 0.14 * steady
        + Math.sin(this.bobT) * bob * 1.4 + dip * 0.25);

    this.recoilGroup.rotation.x = this.recoilPitch * 2.4;
    this.recoilGroup.rotation.y = this.recoilYaw * 1.6;
    this.recoilGroup.position.z = this.kick;

    for (const id of this.ids) this.models[id].reticle.visible = false;
    this.model.reticle.visible = this.ads > 0.3;
    // Behind a scope the overlay is the view; the gun model would sit in it.
    this.model.gun.visible = !(this.scoped && this.ads > 0.75);

    this._reloadPose();
    if (this.arms) {
      // support hand to the magazine for the middle of a reload
      let w = 0;
      if (this.reloading > 0) {
        const t = 1 - this.reloading / this.reloadTotal;
        w = THREE.MathUtils.smoothstep(t, 0.06, 0.2) * (1 - THREE.MathUtils.smoothstep(t, 0.8, 0.92));
      }
      const m = this.model;
      this.arms.update(this.camera, m.gun, m.hands, m.mag, w, this.root.visible);
    }

    if (this.flash.visible) {
      this.flashMat.opacity -= dt * 22;
      if (this.flashMat.opacity <= 0) {
        this.flash.visible = false;
        this.flashMat.opacity = 0;
      }
    }
    // The light fades on its own curve, so a burst glows instead of flickering.
    if (this.flashLight.intensity > 0) {
      this.flashLight.intensity *= Math.exp(-dt * 12);
      if (this.flashLight.intensity < 0.03) this.flashLight.intensity = 0;
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.life -= dt;
      if (sh.life <= 0) { scene.remove(sh.mesh); this.shells.splice(i, 1); continue; }
      sh.vel.y -= 9.8 * dt;
      sh.mesh.position.addScaledVector(sh.vel, dt);
      const fl = (this.floorAt ? this.floorAt(sh.mesh.position.x, sh.mesh.position.z, sh.floorHint) : 0) + 0.01;
      if (sh.mesh.position.y < fl) {
        sh.mesh.position.y = fl;
        sh.vel.y *= -0.3; sh.vel.x *= 0.6; sh.vel.z *= 0.6;
        sh.spin.multiplyScalar(0.5);
        if (Math.abs(sh.vel.y) < 0.4) sh.vel.set(0, 0, 0);
      }
      sh.mesh.rotation.x += sh.spin.x * dt;
      sh.mesh.rotation.y += sh.spin.y * dt;
      sh.mesh.rotation.z += sh.spin.z * dt;
    }
  }

  _reloadPose() {
    const m = this.model;
    if (this.reloading <= 0) {
      m.mag.position.copy(m.magHome);
      m.mag.rotation.set(0, 0, 0);
      if (this.inspectT > 0) {
        // Inspect: roll the weapon to show its side, hold, roll back.
        const t = 1 - this.inspectT / 2.4;
        const e = Math.sin(Math.min(1, t * 1.25) * Math.PI);
        const hold = t > 0.35 && t < 0.75 ? Math.sin((t - 0.35) / 0.4 * Math.PI) * 0.12 : 0;
        this.sway.rotation.set(e * 0.25, e * 0.85 + hold, e * 0.55);
        this.sway.position.set(-e * 0.06, e * 0.03, e * 0.05);
      } else {
        this.sway.rotation.set(0, 0, 0);
        this.sway.position.set(0, 0, 0);
      }
      return;
    }
    const t = 1 - this.reloading / this.reloadTotal;
    const dip = Math.sin(Math.min(1, t * 1.15) * Math.PI);
    this.sway.rotation.x = dip * 0.40;
    this.sway.rotation.z = dip * 0.22;
    this.sway.position.y = -dip * 0.095;
    this.sway.position.x = -dip * 0.05;

    const home = m.magHome;
    if (t < 0.32) {
      const k = t / 0.32;
      m.mag.position.set(home.x, home.y - k * 0.34, home.z);
      m.mag.rotation.z = k * 0.55;
    } else if (t < 0.52) {
      m.mag.position.set(home.x, home.y - 0.60, home.z);
      m.mag.rotation.z = 0.55;
    } else {
      const k = Math.min(1, (t - 0.52) / 0.34);
      m.mag.position.set(home.x, home.y - (1 - k) * 0.38, home.z);
      m.mag.rotation.z = (1 - k) * 0.46;
    }

    // Empty only: cant the weapon and rack the bolt at the end.
    if (this.reloadEmpty && t > 0.80) {
      const r = (t - 0.80) / 0.20;
      const yank = Math.sin(Math.min(1, r * 2.2) * Math.PI);
      this.sway.rotation.z += 0.32 * Math.sin(r * Math.PI);
      this.sway.position.x += -0.035 * yank;
      this.sway.position.z += 0.03 * yank;
    }
  }
}
