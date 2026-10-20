import * as THREE from 'three';
import { CFG } from './config.js';
import { buildWeaponModel } from './viewmodel.js';
import * as audio from './audio.js';

// Gear: everything the player picks up, carries, throws and fires that flies.
//
//   loot        enemy drops and crates; ammo and consumables are taken by
//               walking over them, weapons and attachments with F
//   rounds      rifle and marksman bullets past 50 m: real projectiles with
//               travel time and drop (inside 50 m the game resolves the shot
//               instantly, where drop is a few millimetres)
//   grenades    frag and smoke, thrown in an arc, bouncing off walls and ground
//   smoke       clouds that block soldiers' line of sight
//   items       armour plates and medkits, used with the weapon lowered
//   noise       gunfire carries; soldiers within earshot come to look, and a
//               suppressor shrinks that radius
//
// Pools and caps everywhere; nothing grows without bound.

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const DROP_WEAPON = { assault: 'rifle', scout: 'smg', heavy: 'shotgun', sniper: 'sniper', elite: 'rifle' };
const ATT_KEYS = Object.keys(CFG.attachments);
const ITEM_NAMES = { ammo: 'AMMO', plate: 'ARMOUR PLATE', medkit: 'MEDKIT', frag: 'FRAG GRENADE', smoke: 'SMOKE GRENADE' };

export class Gear {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.items = [];
    this.rounds = [];
    this.nades = [];
    this.smokes = [];
    this.counts = { plates: 0, meds: 0, frags: 0, smokes: 0 };
    this.ray = new THREE.Raycaster();
    this.tmp = new THREE.Vector3();
    this.onToast = () => {};
    this._meshes();
    game.weapons.onItemDone = (k) => this._itemDone(k);
  }

  // ---------------------------------------------------------- set-up --

  _meshes() {
    const M = this.game.mats;
    const box = (sx, sy, sz, col) => new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color: col, roughness: 0.7 }));
    this.make = {
      ammo: () => { const g = new THREE.Group(); const b = box(0.34, 0.18, 0.2, 0x4a5236); b.position.y = 0.09; g.add(b);
        const l = box(0.36, 0.03, 0.22, 0x3a4029); l.position.y = 0.19; g.add(l); return g; },
      plate: () => { const g = new THREE.Group(); const b = box(0.28, 0.035, 0.36, 0x2b2e30); b.position.y = 0.02; g.add(b); return g; },
      medkit: () => { const g = new THREE.Group(); const b = box(0.3, 0.12, 0.22, 0xe8e6e0); b.position.y = 0.06; g.add(b);
        const c1 = box(0.16, 0.005, 0.05, 0xc0261c); c1.position.y = 0.123; const c2 = box(0.05, 0.005, 0.16, 0xc0261c); c2.position.y = 0.123; g.add(c1, c2); return g; },
      frag: () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x46522e, roughness: 0.6 }));
        s.position.y = 0.055; g.add(s); const lv = box(0.015, 0.06, 0.02, 0x8a8a84); lv.position.set(0.03, 0.1, 0); g.add(lv); return g; },
      smoke: () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.13, 10), new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.6 }));
        c.position.y = 0.065; g.add(c); return g; },
      attachment: () => { const g = new THREE.Group(); const b = box(0.16, 0.06, 0.08, 0x23262a); b.position.y = 0.03; g.add(b);
        const t = box(0.17, 0.012, 0.02, 0xc9a227); t.position.y = 0.062; g.add(t); return g; },
      weapon: (id) => {
        const m = buildWeaponModel(CFG.weapons[id].shape, M);
        m.gun.scale.setScalar(1.7);
        m.gun.rotation.set(0, 0, Math.PI / 2);
        m.gun.position.y = 0.06;
        m.reticle.visible = false;
        const g = new THREE.Group(); g.add(m.gun); return g;
      },
    };
    // a faint ring under every item so loot reads at a glance
    this.ringGeo = new THREE.RingGeometry(0.32, 0.4, 24).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe9c4, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
    // thrown grenades
    this.nadeGeo = new THREE.SphereGeometry(0.055, 8, 6);
    this.nadeMat = { frag: new THREE.MeshStandardMaterial({ color: 0x46522e }), smoke: new THREE.MeshStandardMaterial({ color: 0x8c8f92 }) };
  }

  reset(mode) {
    for (const it of this.items) this.scene.remove(it.mesh);
    for (const n of this.nades) this.scene.remove(n.mesh);
    this.items.length = 0; this.rounds.length = 0; this.nades.length = 0; this.smokes.length = 0;
    const campaign = mode === 'campaign';
    this.counts = campaign ? { plates: 1, meds: 1, frags: 1, smokes: 1 } : { plates: 2, meds: 1, frags: 2, smokes: 1 };
  }

  snapshot() { return { counts: { ...this.counts } }; }
  restore(s) { if (s && s.counts) this.counts = { ...s.counts }; }

  // ---------------------------------------------------------- loot --

  // kind: 'ammo' | 'plate' | 'medkit' | 'frag' | 'smoke' | 'attachment' | 'weapon'
  spawn(kind, id, x, z, y) {
    if (this.items.length >= 40) { const old = this.items.shift(); this.scene.remove(old.mesh); }
    const mesh = kind === 'weapon' ? this.make.weapon(id) : kind === 'attachment' ? this.make.attachment() : this.make[kind]();
    const g = this.game;
    const floor = y !== undefined ? y : g.player.groundAt(x, z, (g.surfaceH ? g.surfaceH(x, z) : 0) + 1.2);
    mesh.position.set(x, floor + 0.02, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.position.y = 0.015;
    mesh.add(ring);
    mesh.traverse((o) => { if (o.isMesh && o !== ring) o.castShadow = true; });
    this.scene.add(mesh);
    const it = { kind, id, mesh, x, z, y: floor, t: 0, ammo: null };
    this.items.push(it);
    return it;
  }

  // What a soldier leaves behind.
  dropFrom(robot) {
    const p = robot.root.position;
    const r = Math.random;
    const at = (k) => [p.x + Math.cos(k) * 0.7, p.z + Math.sin(k) * 0.7];
    const wid = DROP_WEAPON[robot.type];
    if (wid && r() < 0.6) { const [x, z] = at(0); const it = this.spawn('weapon', wid, x, z); it.ammo = Math.round(CFG.weapons[wid].magSize * (0.5 + r() * 0.5)); }
    if (r() < 0.75) { const [x, z] = at(2); this.spawn('ammo', null, x, z); }
    if (r() < 0.22) { const [x, z] = at(3); this.spawn('plate', null, x, z); }
    if (r() < 0.15) { const [x, z] = at(4); this.spawn('medkit', null, x, z); }
    if (r() < 0.2) { const [x, z] = at(5); this.spawn('frag', null, x, z); }
    if (r() < 0.2) { const [x, z] = at(1); this.spawn('attachment', ATT_KEYS[Math.floor(r() * ATT_KEYS.length)], x, z); }
  }

  // A crate: an open box with things laid on it.
  crate(x, z, contents, floorY) {
    const g = this.game;
    const y = floorY !== undefined ? floorY : g.player.groundAt(x, z, (g.surfaceH ? g.surfaceH(x, z) : 0) + 1.2);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.7), g.mats.crate || new THREE.MeshStandardMaterial({ color: 0x6b5236 }));
    box.position.set(x, y + 0.25, z);
    box.castShadow = box.receiveShadow = true;
    this.scene.add(box);
    this.items.push({ kind: 'crateBox', mesh: box, x, z, y, t: 0, static: true });
    contents.forEach((c, i) => {
      const it = this.spawn(c[0], c[1] || null, x - 0.3 + (i % 3) * 0.3, z - 0.12 + Math.floor(i / 3) * 0.24, y + 0.5);
      if (c[0] === 'weapon') it.ammo = CFG.weapons[c[1]].magSize * 2;
    });
  }

  _take(it) {
    const g = this.game, W = g.weapons, C = this.counts, G2 = CFG.gear;
    let msg = null;
    switch (it.kind) {
      case 'ammo': {
        const ids = W.owned ? [...W.owned, 'pistol'] : W.ids.filter((i) => W.owns(i));
        let any = false;
        for (const id of ids) {
          const cap = CFG.weapons[id].reserve;
          if (W.reserve[id] < cap) { W.reserve[id] = Math.min(cap, W.reserve[id] + W.magSizeOf(id)); any = true; }
        }
        if (!any) return false;
        msg = '+ AMMO';
        break;
      }
      case 'plate': if (C.plates >= G2.maxPlates) return false; C.plates++; msg = '+1 ARMOUR PLATE'; break;
      case 'medkit': if (C.meds >= G2.maxMeds) return false; C.meds++; msg = '+1 MEDKIT'; break;
      case 'frag': if (C.frags >= G2.maxFrags) return false; C.frags++; msg = '+1 FRAG GRENADE'; break;
      case 'smoke': if (C.smokes >= G2.maxSmokes) return false; C.smokes++; msg = '+1 SMOKE GRENADE'; break;
      case 'attachment': {
        const key = it.id, spec = CFG.attachments[key];
        // mount on the weapon in hand if it fits and the slot is free, else
        // on another owned weapon, else carry it
        const cand = [W.current, ...W.slotList()].filter((id, i, a) => a.indexOf(id) === i);
        const fit = cand.find((id) => (CFG.fits[id] || []).includes(key) && !W.att[id][spec.slot]);
        if (fit) { W.mount(fit, key); msg = `${spec.name} fitted to ${CFG.weapons[fit].name}`; }
        else { W.spare.push(key); msg = `${spec.name} — in your pack (TAB)`; }
        break;
      }
      case 'weapon': {
        const id = it.id;
        if (W.owns(id)) {
          W.reserve[id] = Math.min(CFG.weapons[id].reserve * 1.5, W.reserve[id] + (it.ammo || W.magSizeOf(id)));
          msg = `+ ${CFG.weapons[id].name} AMMO`;
        } else if (W.owned) {
          const dropped = W.give(id);
          W.ammo[id] = Math.min(W.magSizeOf(id), it.ammo || W.magSizeOf(id));
          if (dropped) {
            const p = g.player.state;
            const d = this.spawn('weapon', dropped, p.x + 0.6, p.z + 0.6);
            d.ammo = W.ammo[dropped];
            msg = `${CFG.weapons[id].name} — dropped ${CFG.weapons[dropped].name}`;
          } else msg = CFG.weapons[id].name;
        } else return false;
        break;
      }
      default: return false;
    }
    this.scene.remove(it.mesh);
    this.items.splice(this.items.indexOf(it), 1);
    audio.sfx.pickup();
    this.onToast(msg);
    return true;
  }

  // The weapon or attachment the player is looking at within reach, for the
  // F prompt. Ammo and consumables are taken by walking over them instead.
  pickable() {
    const g = this.game, cam = g.camera;
    const fwd = this.tmp; cam.getWorldDirection(fwd);
    let best = null, bestScore = 0.55;
    for (const it of this.items) {
      if (it.kind !== 'weapon' && it.kind !== 'attachment') continue;
      const dx = it.x - cam.position.x, dy = it.y + 0.1 - cam.position.y, dz = it.z - cam.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 2.6) continue;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (d || 1);
      if (dot > bestScore) { bestScore = dot; best = it; }
    }
    return best;
  }

  promptFor(it) {
    if (it.kind === 'weapon') return `Take ${CFG.weapons[it.id].name}`;
    return `Take ${CFG.attachments[it.id].name}`;
  }

  take(it) { return this._take(it); }

  // ---------------------------------------------------------- rounds --

  // A bullet that is still flying. `p` start, `v` velocity (m/s).
  spawnRound(p, v, dmg, weaponId) {
    if (this.rounds.length >= 24) this.rounds.shift();
    // flies until it has covered the weapon's range (it starts 50 m out)
    const range = (CFG.weapons[weaponId] && CFG.weapons[weaponId].range) || 300;
    this.rounds.push({ p: p.clone(), v: v.clone(), dmg, weaponId, life: Math.max(0.05, (range - 50) / v.length()), tr: 0 });
  }

  _stepRounds(dt) {
    const g = this.game;
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      r.life -= dt;
      const from = r.p.clone();
      r.v.y -= G * dt;
      const step = r.v.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().divideScalar(len);
      const hit = g.traceShot(from, dir, len);
      if (hit) {
        g.fx.tracer(from, hit.point, 0xffe0a0);
        g.applyShotHit(hit, from, r.dmg);
        this.rounds.splice(i, 1);
        continue;
      }
      r.p.add(step);
      if ((r.tr++ & 1) === 0) g.fx.tracer(from, r.p, 0xffe0a0);
      if (r.life <= 0 || r.p.y < -60) this.rounds.splice(i, 1);
    }
  }

  // ---------------------------------------------------------- grenades --

  throw(kind) {
    const g = this.game, W = g.weapons, C = this.counts;
    const key = kind === 'frag' ? 'frags' : 'smokes';
    if (C[key] <= 0 || W.busy) return false;
    if (!W.useItem('throw', 0.5)) return false;
    C[key]--;
    const cam = g.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    const p = cam.position.clone().addScaledVector(fwd, 0.45).add(new THREE.Vector3(0, -0.12, 0));
    const v = fwd.clone().multiplyScalar(CFG.gear.throwSpeed).add(new THREE.Vector3(0, 3.2, 0));
    const ps = g.player.state;
    v.x += ps.vx * 0.6; v.z += ps.vz * 0.6;
    const mesh = new THREE.Mesh(this.nadeGeo, this.nadeMat[kind]);
    mesh.position.copy(p); mesh.castShadow = true;
    this.scene.add(mesh);
    this.nades.push({ kind, p, v, mesh, t: 0, fuse: kind === 'frag' ? CFG.gear.fragFuse : CFG.gear.smokeDelay, rest: false });
    audio.sfx.pin(); audio.sfx.throwIt();
    return true;
  }

  _stepNades(dt) {
    const g = this.game;
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      n.t += dt;
      if (!n.rest) {
        for (let s = 0; s < 2; s++) {
          const h = dt / 2;
          n.v.y -= G * h;
          const step = n.v.clone().multiplyScalar(h);
          const len = step.length();
          if (len > 1e-5) {
            const dir = step.clone().divideScalar(len);
            const hit = g.traceShot(n.p, dir, len + 0.06, true);
            if (hit) {
              const nrm = hit.normal || UP;
              n.p.copy(hit.point).addScaledVector(nrm, 0.07);
              const vn = n.v.dot(nrm);
              n.v.addScaledVector(nrm, -1.45 * vn).multiplyScalar(0.55);
              if (Math.abs(vn) > 2) audio.sfx.bounce(Math.min(1, Math.abs(vn) / 10));
              continue;
            }
            n.p.add(step);
          }
          const floor = g.player.groundAt(n.p.x, n.p.z, n.p.y + 0.2);
          if (n.p.y - 0.055 < floor) {
            n.p.y = floor + 0.055;
            if (Math.abs(n.v.y) > 2) audio.sfx.bounce(Math.min(1, Math.abs(n.v.y) / 10));
            n.v.y = -n.v.y * 0.38; n.v.x *= 0.62; n.v.z *= 0.62;
            if (n.v.length() < 0.6) { n.v.set(0, 0, 0); n.rest = true; }
          }
        }
        n.mesh.position.copy(n.p);
        n.mesh.rotation.x += dt * 9; n.mesh.rotation.z += dt * 6;
      }
      if (n.t >= n.fuse) {
        if (n.kind === 'frag') this._explode(n.p);
        else this.smokes.push({ p: n.p.clone(), t: 0, r: 0 });
        this.scene.remove(n.mesh);
        this.nades.splice(i, 1);
      }
    }
  }

  _explode(p) {
    const g = this.game, G2 = CFG.gear;
    g.fx.explode(p, 0xffb060);
    const life = g.life;
    if (life) {
      for (let i = 0; i < 26; i++) life.pools.glow.spawn(p.x, p.y + 0.2, p.z, (Math.random() - 0.5) * 10, Math.random() * 7, (Math.random() - 0.5) * 10, 0.5, 0.9, 0.25, 3, 1.5, 0.5, 1, 7, 0.4);
      for (let i = 0; i < 12; i++) life.pools.smoke.spawn(p.x, p.y + 0.5, p.z, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 4, 3 + Math.random() * 2, 1.2, 4.5, 0.2, 0.19, 0.17, 0.6, 0, 0.6);
    }
    const ps = g.player.state;
    const camD = g.camera.position.distanceTo(p);
    audio.townSfx.explosion(Math.max(0.25, 1 - camD / 90));
    g.fx.addShake(Math.max(0, 0.07 * (1 - camD / 30)));
    // damage, shielded by solid cover
    const R = G2.fragRadius;
    // canSee aims 1.3 m above the feet it is given; ask about the chest.
    // Smoke does not stop shrapnel.
    const seen = (x, y, z) => g.canSee({ x: p.x, y: p.y + 0.3, z: p.z }, { x, y: y + 0.9 - 1.3, z }, true);
    // full damage inside the core, falling to nothing at the edge
    const fall = (d) => (d < G2.fragCore ? 1 : 1 - (d - G2.fragCore) / (R - G2.fragCore));
    const dp = Math.hypot(ps.x - p.x, ps.y + 0.9 - p.y, ps.z - p.z);
    if (dp < R && seen(ps.x, ps.y, ps.z)) g.hurt(G2.fragDamage * 0.6 * fall(dp));
    for (const r of g.robots) {
      if (r.dead) continue;
      const q = r.root.position;
      const d = Math.hypot(q.x - p.x, q.y + 0.9 - p.y, q.z - p.z);
      if (d > R || !seen(q.x, q.y, q.z)) continue;
      const res = r.damage(G2.fragDamage * fall(d), 'body');
      if (res && res.killed) g.registerKill(r, false, q.clone());
    }
    g.alertNear(p, 60, false);
  }

  _stepSmokes(dt) {
    const g = this.game, G2 = CFG.gear;
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t += dt;
      const grow = Math.min(1, s.t / 2.2), fade = Math.min(1, (G2.smokeTime - s.t) / 3);
      s.r = G2.smokeRadius * grow * Math.max(0, fade);
      // a wall, not a wisp: it hides men, so it has to look like it would
      if (g.life && s.t < G2.smokeTime - 2) {
        s.acc = (s.acc || 0) + dt * 22;
        for (; s.acc >= 1; s.acc--) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * Math.max(1, s.r) * 0.8;
          const c = 0.70 + Math.random() * 0.08;
          g.life.pools.smoke.spawn(s.p.x + Math.cos(a) * rr, s.p.y + 0.4 + Math.random() * 2.2, s.p.z + Math.sin(a) * rr,
            (Math.random() - 0.5) * 0.5, 0.18, (Math.random() - 0.5) * 0.5, 6.5, 3.0, 7.0, c, c, c + 0.01, 0.95, 0, 0.1);
        }
      }
      if (s.t >= G2.smokeTime) this.smokes.splice(i, 1);
    }
  }

  // Does a sight line pass through smoke?
  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      if (s.r < 0.5) continue;
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const l2 = abx * abx + aby * aby + abz * abz || 1;
      let t = ((s.p.x - a.x) * abx + (s.p.y + 1 - a.y) * aby + (s.p.z - a.z) * abz) / l2;
      t = Math.max(0, Math.min(1, t));
      const dx = a.x + abx * t - s.p.x, dy = a.y + aby * t - (s.p.y + 1), dz = a.z + abz * t - s.p.z;
      if (dx * dx + dy * dy * 1.5 + dz * dz < s.r * s.r) return true;
    }
    return false;
  }

  // ---------------------------------------------------------- items --

  usePlate() {
    const g = this.game, C = this.counts, ps = g.player.state;
    if (C.plates <= 0 || ps.armor >= CFG.player.maxArmor) return false;
    if (!g.weapons.useItem('plate', CFG.gear.plateTime)) return false;
    audio.sfx.plate();
    return true;
  }

  useMedkit() {
    const g = this.game, C = this.counts, ps = g.player.state;
    if (C.meds <= 0 || ps.health >= CFG.player.maxHealth) return false;
    if (!g.weapons.useItem('med', CFG.gear.medTime)) return false;
    audio.sfx.medkit();
    return true;
  }

  _itemDone(kind) {
    const g = this.game, C = this.counts, ps = g.player.state;
    if (kind === 'plate' && C.plates > 0) {
      C.plates--;
      ps.armor = Math.min(CFG.player.maxArmor, ps.armor + CFG.gear.plateArmour);
      this.onToast('ARMOUR +' + CFG.gear.plateArmour);
    } else if (kind === 'med' && C.meds > 0) {
      C.meds--;
      ps.health = Math.min(CFG.player.maxHealth, ps.health + CFG.gear.medHeal);
      this.onToast('HEALTH +' + CFG.gear.medHeal);
    }
  }

  // ---------------------------------------------------------- frame --

  update(dt) {
    const g = this.game, p = g.player.state;
    // walk-over pickups
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.static) {
        it.t += dt;
        const ring = it.mesh.children[it.mesh.children.length - 1];
        if (ring && ring.material === this.ringMat) ring.scale.setScalar(1 + Math.sin(it.t * 3) * 0.08);
      }
      if (it.kind === 'weapon' || it.kind === 'attachment' || it.static) continue;
      if (Math.hypot(it.x - p.x, it.z - p.z) < 1.25 && Math.abs(it.y - p.y) < 1.6) this._take(it);
    }
    this._stepRounds(dt);
    this._stepNades(dt);
    this._stepSmokes(dt);
  }
}
