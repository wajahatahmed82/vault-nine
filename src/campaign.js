import * as THREE from 'three';
import { CFG, DIFFICULTY } from './config.js';
import { Robot } from './enemies.js';
import { Interactables } from './interact.js';

// Mission 1 -- "The Signal".
//
// The structure is data, not code: a list of objectives, each with an `enter`
// that dresses the world and a `done` that tests for completion. Adding
// mission 2 means adding another list, not rewriting the director.
//
// Pacing rule, enforced by the data rather than by hope: no soldier exists in
// the level until objective 3. The first several minutes are an empty building.

const STORY = {
  intro: {
    title: 'MERIDIAN RIDGE RESEARCH STATION',
    lines: [
      'Contact with the station stopped fourteen hours ago.',
      'The department is calling it a communications failure.',
      'You are here to confirm that. Nothing else.',
    ],
  },
  receptionNote: {
    title: 'VISITOR LOG — RECEPTION',
    lines: [
      'Last entry is four days old.',
      'Below it, in different handwriting:',
      '"They came back for the drives. Do not sign anyone in."',
    ],
  },
  officeMemo: {
    title: 'INTERNAL MEMO — UNSIGNED',
    lines: [
      'All Vault Nine material is to be moved off site by Friday.',
      'Personnel not cleared for Vault Nine will be reassigned.',
      'Do not discuss the reassignment list.',
    ],
  },
  securityTape: {
    title: 'SECURITY RECORDING — 03:41',
    lines: [
      'The evacuation finished at 21:00. The cameras show an empty yard.',
      'Then, six hours later, three vehicles come back through the gate.',
      'The men who get out are not station staff. They are carrying breaching kit.',
      'The recording ends when someone reaches up and turns the camera to the wall.',
    ],
  },
  medicalLog: {
    title: 'MEDICAL LOG — DR. ARIS VEHN',
    lines: [
      'Two more staff refused to sign the non-disclosure and were escorted out.',
      'I am not able to account for them.',
      'If anyone reads this: the material in Vault Nine was never stable.',
    ],
  },
  generatorNote: {
    title: 'POWER RESTORED',
    lines: [
      'The generator coughs, catches, and the corridor lights come up one bank at a time.',
      'Somewhere below you, a door releases its lock.',
    ],
  },
  armoryNote: {
    title: 'ARMOURY — LOCKER 4',
    lines: [
      'Someone emptied this room in a hurry and left one locker open.',
      'Inside: ammunition, and a laboratory keycard still on its lanyard.',
      'The name on the lanyard has been scratched off.',
    ],
  },
  labFind: {
    title: 'VAULT NINE — RESEARCH DATA',
    lines: [
      'The laboratory has been taken apart deliberately. Not looted -- erased.',
      'One drive survived, wedged behind a bench.',
      'It is a test schedule. Every entry is signed off by the same department',
      'that told you this was a communications failure.',
    ],
  },
  escape: {
    title: 'THEY KNOW YOU ARE HERE',
    lines: [
      'The station intercom clicks on and stays open.',
      'Someone is reading your name off a list.',
      'Get to the loading bay.',
    ],
  },
  end: {
    title: 'EXTRACTION',
    lines: [
      'You clear the loading bay door with the drive in your pocket.',
      'Nobody is waiting to collect you.',
      'That answers a different question.',
    ],
  },
};

export class Campaign {
  constructor(game) {
    this.game = game;
    this.interact = new Interactables();
    this.objIdx = -1;
    this.active = false;
    this.difficulty = 'normal';
    this.keycard = 0;
    this.doors = [];
    this.checkpoint = null;
    this.stageEnemies = [];
    this.flags = {};
    this.onObjective = () => {};
    this.onLog = () => {};
    this.onCheckpoint = () => {};
    this.onComplete = () => {};
    this._t = 0;
    this._build();
  }

  get diff() { return DIFFICULTY[this.difficulty] || DIFFICULTY.normal; }
  get objective() { return this.stages[this.objIdx] || null; }

  // ------------------------------------------------------------ world setup

  _build() {
    const g = this.game;
    const A = g.areas, N = g.anchors;

    // Two locked doors. A door is a mesh plus a collider we switch off, so
    // "unlocked" is one flag rather than a rebuild of the level.
    this.securityDoor = this._door(21.4, 0, -12, 1.8, 'z');
    this.labDoor = this._door(-6, g.BASE_Y === undefined ? -3.6 : g.BASE_Y, -36, 1.8, 'x', -3.6);

    this.stages = [
      {
        id: 'approach',
        text: 'Investigate the communications failure',
        hint: 'Approach the station',
        enter: () => this.onLog(STORY.intro),
        done: () => this._inArea(A.forecourt),
      },
      {
        id: 'enter',
        text: 'Enter the main building',
        hint: 'The entrance is ahead',
        done: () => this._inArea(A.reception),
      },
      {
        id: 'reception',
        text: 'Search reception for station access',
        hint: 'Look for a keycard',
        enter: () => {
          this.interact.add({
            id: 'visitorLog', pos: new THREE.Vector3(0, 0.85, -4.9),
            prompt: 'Read visitor log',
            onUse: () => { this.onLog(STORY.receptionNote); },
          });
          this.interact.add({
            id: 'keycard2', pos: new THREE.Vector3(18, 0.85, -3.4),
            prompt: 'Take security keycard',
            onUse: () => {
              this.keycard = Math.max(this.keycard, 2);
              this.onLog({ title: 'SECURITY KEYCARD — LEVEL 2', lines: ['Opens the security office and the service stair.'] });
            },
          });
        },
        done: () => this.keycard >= 2,
      },
      {
        id: 'security',
        text: 'Review the security recording',
        hint: 'Security office, east side',
        enter: () => {
          this.interact.add({
            id: 'securityDoor', pos: new THREE.Vector3(21.4, 1.0, -12),
            prompt: 'Open security door', needs: 2,
            lockedPrompt: 'LOCKED — LEVEL 2 KEYCARD REQUIRED',
            onUse: () => this._openDoor(this.securityDoor),
          });
          this.interact.add({
            id: 'securityTerminal', pos: N.securityTerminal,
            prompt: 'Play security recording',
            onUse: () => {
              this.onLog(STORY.securityTape);
              this.flags.sawTape = true;
            },
          });
          this.interact.add({
            id: 'officeMemo', pos: N.officeDocument,
            prompt: 'Read memo', onUse: () => this.onLog(STORY.officeMemo),
          });
        },
        done: () => !!this.flags.sawTape,
      },
      {
        id: 'power',
        text: 'Restore facility power',
        hint: 'Generator room, south-east',
        enter: () => {
          // First contact. One soldier, searching a room, with his back to the
          // door the player will come through.
          this._spawn('scout', -20, -37, { yaw: Math.PI, post: true });
          this._spawn('assault', 18, -29, { route: [[22, -29], [6, -29], [22, -29]] });
          this.interact.add({
            id: 'medicalLog', pos: N.medicalLog,
            prompt: 'Read medical log', onUse: () => this.onLog(STORY.medicalLog),
          });
          this.interact.add({
            id: 'generator', pos: N.generator,
            prompt: 'Start generator',
            onUse: () => {
              this.onLog(STORY.generatorNote);
              this.flags.power = true;
              this.game.setPowered(true);
            },
          });
        },
        done: () => !!this.flags.power,
      },
      {
        id: 'descend',
        text: 'Reach the underground laboratory',
        hint: 'Service stair, behind the south rooms',
        enter: () => {
          this._spawn('assault', -10, -49, { route: [[-20, -49], [4, -49], [-20, -49]] });
          this._spawn('scout', 14, -55, { yaw: Math.PI * 0.5, post: true });
          this.interact.add({
            id: 'armoryCache', pos: N.armoryCache,
            prompt: 'Search locker',
            onUse: () => {
              this.keycard = Math.max(this.keycard, 4);
              this.game.grantAmmo();
              this.onLog(STORY.armoryNote);
            },
          });
        },
        done: () => this._inArea(A.undergroundCorridor),
      },
      {
        id: 'lab',
        text: 'Recover the research data',
        hint: 'The laboratory needs a level 4 keycard',
        enter: () => {
          this._spawn('assault', 16, -34, { yaw: -Math.PI / 2, post: true });
          this._spawn('scout', 2, -30, { route: [[2, -44], [2, -27], [2, -44]] });
          this._spawn('elite', -3, -42, { yaw: 0, post: true });
          this.interact.add({
            id: 'labDoor', pos: new THREE.Vector3(-6, -2.7, -36),
            prompt: 'Open laboratory door', needs: 4,
            lockedPrompt: 'SEALED — LEVEL 4 KEYCARD REQUIRED',
            onUse: () => this._openDoor(this.labDoor),
          });
          this.interact.add({
            id: 'labTerminal', pos: N.labTerminal,
            prompt: 'Recover data drive',
            onUse: () => { this.flags.data = true; this.onLog(STORY.labFind); },
          });
        },
        done: () => !!this.flags.data,
      },
      {
        id: 'escape',
        text: 'Reach the loading bay and get out',
        hint: 'They know you are here',
        enter: () => {
          this.onLog(STORY.escape);
          // The way out is now contested, but still spread across the route
          // rather than dumped in one room.
          this._spawn('assault', 0, -44, { yaw: Math.PI, post: true });
          this._spawn('elite', -3, -52, { yaw: 0, post: true });
          this._spawn('assault', 12, -49, { yaw: Math.PI / 2, post: true });
          this._spawn('heavy', 18, -55, { yaw: 0, post: true });
          this._spawn('scout', 24, -57, { yaw: 0, post: true });
          for (const e of this.game.robots) e.alertTo(this.game.player.state.x, this.game.player.state.z, false);
        },
        done: () => this._nearAnchor(this.game.anchors.extraction, 4.5),
      },
    ];
  }

  _door(x, y, z, w, axis, baseY) {
    const g = this.game;
    const yy = baseY !== undefined ? baseY : y;
    const geo = axis === 'z'
      ? new THREE.BoxGeometry(0.22, 2.3, w * 1.5)
      : new THREE.BoxGeometry(w * 1.5, 2.3, 0.22);
    const mesh = new THREE.Mesh(geo, g.mats.steel);
    mesh.position.set(x, yy + 1.15, z);
    mesh.castShadow = true;
    g.scene.add(mesh);
    // A shut door has to stop bullets too. Raycasts ignore visibility, so an
    // opened door must also leave this list or it keeps blocking shots.
    g.blockers.push(mesh);
    const half = w * 0.75;
    const col = axis === 'z'
      ? { minX: x - 0.2, maxX: x + 0.2, minZ: z - half, maxZ: z + half, top: yy + 2.3, bottom: yy }
      : { minX: x - half, maxX: x + half, minZ: z - 0.2, maxZ: z + 0.2, top: yy + 2.3, bottom: yy };
    g.colliders.push(col);
    // Remember the shut collider so a restart can put the door back. Without
    // this a replay starts with every door already open.
    const d = { mesh, col, open: false, shutTop: col.top, shutBottom: col.bottom };
    this.doors.push(d);
    return d;
  }

  _openDoor(d) {
    if (!d || d.open) return;
    d.open = true;
    d.mesh.visible = false;
    const bi = this.game.blockers.indexOf(d.mesh);
    if (bi >= 0) this.game.blockers.splice(bi, 1);
    // Sink the collider out of the world rather than splicing the array, which
    // other systems are iterating.
    d.col.top = -998;
    d.col.bottom = -999;
  }

  _closeAllDoors() {
    for (const d of this.doors) {
      d.open = false;
      d.mesh.visible = true;
      if (!this.game.blockers.includes(d.mesh)) this.game.blockers.push(d.mesh);
      d.col.top = d.shutTop;
      d.col.bottom = d.shutBottom;
    }
  }

  // ------------------------------------------------------------ helpers

  _inArea(a) {
    if (!a) return false;
    const p = this.game.player.state;
    return p.x > a.minX && p.x < a.maxX && p.z > a.minZ && p.z < a.maxZ &&
           Math.abs(p.y - a.y) < 2.0;
  }

  _nearAnchor(v, r) {
    if (!v) return false;
    const p = this.game.player.state;
    return Math.hypot(p.x - v.x, p.z - v.z) < r;
  }

  _spawn(type, x, z, opts = {}) {
    const g = this.game;
    const e = new Robot(type, x, z, 1);
    e.diff = this.diff;
    if (opts.route) e.setRoute(opts.route);
    else e.setPost(x, z, opts.yaw || 0);
    // Basement soldiers stand on the lower slab.
    const floor = g.floorAt ? g.floorAt(x, z) : 0;
    e.root.position.y = floor;
    g.scene.add(e.root);
    g.robots.push(e);
    this.stageEnemies.push({ type, x, z, opts });
    return e;
  }

  // ------------------------------------------------------------ lifecycle

  start(difficulty) {
    this.difficulty = difficulty || this.difficulty;
    this.active = true;
    this.keycard = 0;
    this.flags = {};
    this.interact.clear();
    this._closeAllDoors();
    this.objIdx = -1;
    this.checkpoint = null;
    this.stageEnemies.length = 0;
    this._advance();
  }

  _advance() {
    this.objIdx++;
    const s = this.objective;
    if (!s) {
      this.active = false;
      this.onLog(STORY.end);
      this.onComplete();
      return;
    }
    this.stageEnemies.length = 0;
    if (s.enter) s.enter();
    this.onObjective(s, this.objIdx, this.stages.length);
    this._saveCheckpoint();
  }

  update(dt) {
    if (!this.active) return;
    this._t += dt;
    const s = this.objective;
    if (!s) return;
    if (s.done()) this._advance();
  }

  // ------------------------------------------------------------ checkpoints

  _saveCheckpoint() {
    const p = this.game.player.state;
    this.checkpoint = {
      objIdx: this.objIdx,
      keycard: this.keycard,
      flags: { ...this.flags },
      player: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, health: p.health },
      used: this.interact.items.filter((i) => i.used).map((i) => i.id),
      doors: this.doors.map((d) => d.open),
      enemies: this.stageEnemies.map((e) => ({ ...e })),
      weapons: this.game.weapons.snapshot ? this.game.weapons.snapshot() : null,
    };
    this.onCheckpoint(this.objective);
  }

  hasCheckpoint() { return !!this.checkpoint; }

  // Reload the last checkpoint instead of restarting the campaign.
  restore() {
    const c = this.checkpoint;
    if (!c) return false;
    const g = this.game;

    for (const r of g.robots) g.scene.remove(r.root);
    g.robots.length = 0;

    this.objIdx = c.objIdx;
    this.keycard = c.keycard;
    this.flags = { ...c.flags };
    this.active = true;

    // Rebuild this stage's interactables, then mark the ones already used.
    this.interact.clear();
    const s = this.objective;
    if (s && s.enter) s.enter();
    for (const id of c.used) {
      const it = this.interact.get(id);
      if (it) it.used = true;
    }
    this.doors.forEach((d, i) => { if (c.doors[i]) this._openDoor(d); });

    // The stage's soldiers come back, because the player is replaying the fight.
    this.stageEnemies.length = 0;
    for (const e of c.enemies) this._spawn(e.type, e.x, e.z, e.opts);

    const p = g.player.state;
    p.x = c.player.x; p.y = c.player.y; p.z = c.player.z; p.yaw = c.player.yaw;
    p.vx = p.vy = p.vz = 0;
    p.health = Math.max(c.player.health, CFG.player.maxHealth * 0.6);
    if (c.weapons && g.weapons.restore) g.weapons.restore(c.weapons);
    g.player.applyToCamera(0);
    return true;
  }
}
