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
  townIntro: {
    title: 'MERIDIAN RIDGE',
    lines: [
      'Contact with the research station stopped fourteen hours ago.',
      'The town below it went quiet at the same time.',
      "The road in is blocked by the town's own police. Nobody is manning it.",
    ],
  },
  policeReport: {
    title: 'INCIDENT REPORT — SGT. L. ORMOND',
    lines: [
      '21:40. Station staff evacuated through town by bus. Orderly.',
      '02:15. Three unmarked vehicles came down Station Road without lights.',
      '02:30. Power cut to the whole town from the substation. Not a fault.',
      '02:50. Men in town. Not ours. Not theirs. I have sent everyone home.',
    ],
  },
  substation: {
    title: 'SUBSTATION — BREAKER 4',
    lines: [
      'The breaker has been pulled by hand and wired open.',
      "You cut the wire and throw it. Below you, the town's lights come back one street at a time.",
    ],
  },
  gatePass: {
    title: "TOWN HALL — MAYOR'S OFFICE",
    lines: [
      'A station gate pass, issued to the mayor "for emergencies".',
      'Under it, a letter from the station thanking the town for its discretion.',
    ],
  },
  gateOpen: {
    title: 'STATION ROAD',
    lines: [
      'The gate motor whines and the leaves swing in.',
      "The car park beyond is full of the staff's cars. Nobody drove them away.",
    ],
  },
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
    // the station's south gate onto Station Road, shut until the town hall pass
    this.gateDoor = this._door(0, 0, 42, 6, 'x');
    const T = g.town;
    const tagged = (t) => (T ? T.byTag(t) : null);
    const itemAt = (b, y = 1.0) => (b && b.tagItem ? T.local(b, b.tagItem.x, b.tagItem.z, y) : new THREE.Vector3(0, -50, 0));
    const insideTag = (t) => {
      const p = this.game.player.state;
      const q = T && T.indoorAt(p.x, p.z, p.y);
      return !!(q && q.b.tag === t);
    };
    const sp = T ? T.spots : {};
    this.prologue = [
      {
        id: 'town',
        text: 'Find out why Meridian Ridge went silent',
        hint: 'The police station is on Main Street',
        town: true,
        enter: () => this.onLog(STORY.townIntro),
        done: () => insideTag('police'),
      },
      {
        id: 'report',
        text: 'Read the incident report',
        hint: 'Police station, the desks behind the counter',
        town: true,
        enter: () => {
          this.interact.add({
            id: 'policeReport', pos: itemAt(tagged('police')),
            prompt: 'Read incident report',
            onUse: () => {
              this.onLog(STORY.policeReport);
              this.flags.report = true;
            },
          });
        },
        done: () => !!this.flags.report,
      },
      {
        id: 'substation',
        text: 'Restore power at the substation',
        hint: 'North-east, past the end of Ridge Road',
        town: true,
        enter: () => {
          // first contact: a patrol on Main Street and a lookout on the square
          // as you leave the police station, then the substation guards
          this._spawn('assault', 6, 238, { route: [[6, 238], [6, 200], [30, 202], [6, 238]] });
          this._spawn('scout', 24, 206, { yaw: Math.PI / 2, post: true });
          const s = sp.substation;
          if (s) {
            this._spawn('assault', s.x - 6, s.z - 9, { yaw: Math.PI, post: true });
            this._spawn('scout', s.x + 10, s.z - 9, { yaw: Math.PI, post: true });
            this._spawn('assault', 150, 114, { route: [[150, 114], [118, 113], [150, 114]] });
          }
          this.interact.add({
            id: 'breaker', pos: s ? new THREE.Vector3(s.switchAt.x, s.switchAt.y + 1.0, s.switchAt.z) : new THREE.Vector3(0, -50, 0),
            prompt: 'Throw the breaker',
            onUse: () => { this.onLog(STORY.substation); this.flags.townPower = true; this.game.townPower = true; },
          });
        },
        done: () => !!this.flags.townPower,
      },
      {
        id: 'gatepass',
        text: 'Find the station gate pass in the town hall',
        hint: 'Town hall, east side of the square',
        town: true,
        enter: () => {
          this._spawn('assault', 30, 186, { yaw: Math.PI / 2, post: true });
          this._spawn('elite', 54, 200, { yaw: Math.PI / 2, post: true });
          this._spawn('scout', 18, 216, { route: [[18, 216], [40, 216], [40, 176], [18, 176], [18, 216]] });
          // a marksman on a flat roof across Main Street from the square
          const roof = T && T.buildings.find((b) => b.kind === 'shop' && b.roof === 'flat' && !b.enter && b.x < 0 && b.z > 222 && b.z < 250);
          if (roof) {
            const e = this._spawn('scout', roof.x, roof.z, { yaw: -Math.PI / 2, post: true });
            e.root.position.y = roof.base + roof.H + 0.7;
            this.stageEnemies[this.stageEnemies.length - 1].y = e.root.position.y;
          }
          this.interact.add({
            id: 'gatePass', pos: itemAt(tagged('townhall')),
            prompt: 'Take the gate pass',
            onUse: () => { this.keycard = Math.max(this.keycard, 1); this.onLog(STORY.gatePass); },
          });
        },
        done: () => this.keycard >= 1,
      },
      {
        id: 'gate',
        text: 'Open the station gate',
        hint: 'Up Station Road, north of town',
        town: true,
        enter: () => {
          this._spawn('assault', -3, 72, { yaw: 0, post: true });
          this._spawn('scout', 4, 58, { yaw: 0, post: true });
          this.interact.add({
            id: 'gateDoor', pos: new THREE.Vector3(0, 1.0, 43.2),
            prompt: 'Open the station gate', needs: 1,
            lockedPrompt: 'LOCKED — GATE PASS REQUIRED',
            onUse: () => { this._openDoor(this.gateDoor); this.onLog(STORY.gateOpen); },
          });
        },
        done: () => this.gateDoor.open,
      },
    ];
    this.labDoor = this._door(-6, g.BASE_Y === undefined ? -3.6 : g.BASE_Y, -36, 1.8, 'x', -3.6);

    this.stages = [
      {
        id: 'approach',
        text: 'Investigate the communications failure',
        hint: 'Approach the station',
        enter: () => { if (!this.fromTown) this.onLog(STORY.intro); },
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
    this.stationStart = this.prologue.length;
    this.stages = this.prologue.concat(this.stages);
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
    g.addCollider(col);
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
    e.townSearch = z > 47 || Math.abs(x) > 46;
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

  // from: 'town' (the full mission, starting at the roadblock on Main Street)
  // or 'station' (the original mission, starting in the station car park).
  start(difficulty, from) {
    this.difficulty = difficulty || this.difficulty;
    this.active = true;
    this.keycard = 0;
    this.flags = {};
    this.interact.clear();
    this._closeAllDoors();
    this.checkpoint = null;
    this.stageEnemies.length = 0;
    this.fromTown = from !== 'station' && !!this.game.town;
    if (this.fromTown) {
      this.objIdx = -1;
      this.game.townPower = false;
      const p = this.game.player.state;
      p.x = 0; p.z = 316; p.y = this.game.surfaceH(0, 316); p.yaw = 0; p.vx = p.vy = p.vz = 0;
      this.game.player.applyToCamera(0);
    } else {
      this.objIdx = this.stationStart - 1;
      this.game.townPower = true;
      this._openDoor(this.gateDoor);
    }
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
    for (const e of c.enemies) {
      const r = this._spawn(e.type, e.x, e.z, e.opts);
      if (e.y !== undefined) { r.root.position.y = e.y; this.stageEnemies[this.stageEnemies.length - 1].y = e.y; }
    }
    this.game.townPower = !this.fromTown || !!this.flags.townPower;

    const p = g.player.state;
    p.x = c.player.x; p.y = c.player.y; p.z = c.player.z; p.yaw = c.player.yaw;
    p.vx = p.vy = p.vz = 0;
    p.health = Math.max(c.player.health, CFG.player.maxHealth * 0.6);
    if (c.weapons && g.weapons.restore) g.weapons.restore(c.weapons);
    g.player.applyToCamera(0);
    return true;
  }
}
