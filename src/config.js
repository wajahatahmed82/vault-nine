// VAULT NINE - all tuning in one place.

export const CFG = {
  camera: {
    fovBase: 74,
    fovSprint: 82,
    adsTime: 0.14,
    standHeight: 1.68,
    crouchHeight: 1.02,
    crouchTime: 0.14,
    pitchMin: -1.30,
    pitchMax: 1.30,
    lookSens: 0.0040,      // radians per screen pixel, scaled by settings
    adsSensMul: 0.52,
  },

  player: {
    maxHealth: 100,
    maxArmor: 100,
    regenDelay: 5.5,
    regenRate: 10,

    walkSpeed: 4.2,
    sprintSpeed: 6.6,
    crouchSpeed: 2.0,
    adsSpeed: 2.4,
    accel: 16,
    decel: 20,
    airAccel: 3,
    jumpSpeed: 5.0,
    gravity: 18,
    radius: 0.40,
    // Far safety net only. The facility walls and perimeter fence do the real
    // containment; at 54 this circular leash cut across the stair shaft and
    // stopped the player halfway down to the basement.
    arenaRadius: 130,
    eyeToTop: 0.18,        // headroom above the eye for ceiling checks
  },

  // Four weapons. Every value here is live -- damage, spread, recoil and the
  // viewmodel proportions all read from this table, so balancing is one edit.
  weapons: {
    rifle: {
      sprintToFire: 0.20,
      name: 'VK-7 RIFLE', slot: 1, auto: true,
      rpm: 640, magSize: 30, reserve: 240, damage: 26, headMul: 2.6,
      reloadTime: 2.0, reloadEmpty: 2.5, range: 220, pellets: 1,
      spreadHip: 0.048, spreadAds: 0.0026, spreadPerShot: 0.010,
      spreadMax: 0.095, spreadRecover: 0.17, moveSpreadMul: 1.6,
      recoilPitch: 0.0115, recoilYaw: 0.0048, recoilRecover: 8.0, kickBack: 0.026,
      fovAds: 46, adsZoom: 1, unlockLevel: 1,
      velocity: 600,           // m/s; past 50 m the round flies and drops
      shape: { barrel: 0.30, stock: true, mag: 'long', optic: 'dot', bulk: 1.0 },
    },
    smg: {
      sprintToFire: 0.14,
      name: 'HORNET SMG', slot: 2, auto: true,
      rpm: 950, magSize: 40, reserve: 320, damage: 17, headMul: 2.2,
      reloadTime: 1.7, reloadEmpty: 2.1, range: 120, pellets: 1,
      spreadHip: 0.062, spreadAds: 0.0060, spreadPerShot: 0.009,
      spreadMax: 0.120, spreadRecover: 0.22, moveSpreadMul: 1.15,
      recoilPitch: 0.0080, recoilYaw: 0.0055, recoilRecover: 10.0, kickBack: 0.020,
      fovAds: 54, adsZoom: 1, unlockLevel: 2,
      shape: { barrel: 0.16, stock: false, mag: 'long', optic: 'dot', bulk: 0.82 },
    },
    shotgun: {
      sprintToFire: 0.24,
      name: 'BREACHER 12', slot: 3, auto: false,
      rpm: 85, magSize: 6, reserve: 48, damage: 17, headMul: 1.6,
      reloadTime: 2.6, reloadEmpty: 3.0, range: 45, pellets: 9,
      spreadHip: 0.085, spreadAds: 0.048, spreadPerShot: 0.0,
      spreadMax: 0.085, spreadRecover: 0.3, moveSpreadMul: 1.1,
      recoilPitch: 0.045, recoilYaw: 0.010, recoilRecover: 6.0, kickBack: 0.075,
      fovAds: 62, adsZoom: 1, unlockLevel: 3,
      shape: { barrel: 0.34, stock: true, mag: 'tube', optic: 'iron', bulk: 1.12 },
    },
    sniper: {
      sprintToFire: 0.34,
      name: 'LONGVIEW .50', slot: 4, auto: false,
      rpm: 48, magSize: 5, reserve: 35, damage: 135, headMul: 2.4,
      reloadTime: 2.9, reloadEmpty: 3.4, range: 400, pellets: 1,
      spreadHip: 0.115, spreadAds: 0.0002, spreadPerShot: 0.0,
      spreadMax: 0.115, spreadRecover: 0.3, moveSpreadMul: 2.2,
      recoilPitch: 0.055, recoilYaw: 0.012, recoilRecover: 5.0, kickBack: 0.090,
      fovAds: 16, adsZoom: 4, unlockLevel: 4,
      velocity: 760, zeroing: [100, 200, 300, 400],
      shape: { barrel: 0.52, stock: true, mag: 'short', optic: 'scope', bulk: 1.2 },
    },
    // Sidearm: always carried, never takes a primary slot.
    pistol: {
      sprintToFire: 0.10,
      name: 'P9 SIDEARM', slot: 5, auto: false, sidearm: true,
      rpm: 400, magSize: 12, reserve: 72, damage: 24, headMul: 2.4,
      reloadTime: 1.45, reloadEmpty: 1.75, range: 90, pellets: 1,
      spreadHip: 0.034, spreadAds: 0.0055, spreadPerShot: 0.012,
      spreadMax: 0.075, spreadRecover: 0.32, moveSpreadMul: 1.0,
      recoilPitch: 0.020, recoilYaw: 0.006, recoilRecover: 9.0, kickBack: 0.032,
      fovAds: 58, adsZoom: 1, unlockLevel: 1,
      shape: { barrel: 0.04, stock: false, mag: 'short', optic: 'iron', bulk: 0.6 },
    },
  },

  // Attachments change real numbers, not just looks. Multipliers on the base
  // weapon; `slot` is where it mounts (one per slot).
  attachments: {
    dot:         { slot: 'optic',  name: 'RED DOT',      adsTime: 0.85, fovMul: 0.95 },
    x2:          { slot: 'optic',  name: '2X SCOPE',     zoom: 2.0, adsTime: 1.1 },
    x4:          { slot: 'optic',  name: '4X SCOPE',     zoom: 4.0, adsTime: 1.25, scope: true },
    suppressor:  { slot: 'muzzle', name: 'SUPPRESSOR',   noise: 0.22, damage: 0.92, flash: 0 },
    compensator: { slot: 'muzzle', name: 'COMPENSATOR',  recoilUp: 0.85, recoilSide: 0.5 },
    foregrip:    { slot: 'grip',   name: 'FOREGRIP',     recoilUp: 0.75, recoilSide: 0.8 },
    extmag:      { slot: 'mag',    name: 'EXTENDED MAG', mag: 1.5 },
  },
  // which attachments fit which weapon
  fits: {
    rifle: ['dot', 'x2', 'x4', 'suppressor', 'compensator', 'foregrip', 'extmag'],
    smg: ['dot', 'x2', 'suppressor', 'compensator', 'foregrip', 'extmag'],
    shotgun: ['dot', 'compensator', 'foregrip', 'extmag'],
    sniper: ['suppressor', 'extmag'],
    pistol: ['dot', 'suppressor', 'extmag'],
  },

  // Gear and consumables.
  gear: {
    hearing: 46,          // metres an unsuppressed shot carries to soldiers
    plateArmour: 50, plateTime: 1.2, maxPlates: 4,
    medHeal: 65, medTime: 2.6, maxMeds: 3,
    maxFrags: 3, maxSmokes: 2, maxFlashes: 2,
    flashFuse: 1.6, flashRadius: 22, flashBlind: 14,
    fragFuse: 3.0, fragRadius: 8, fragCore: 2.5, fragDamage: 150,
    smokeDelay: 1.4, smokeTime: 18, smokeRadius: 5.5,
    throwSpeed: 16,
  },

  // Four enemy loadouts. Distinct silhouette, speed and behaviour each.
  // Key kept as `robots` so save data and existing lookups stay valid.
  robots: {
    scout: {
      // Was 5.0 m/s and 7 damage: faster than the player can walk, which killed
      // a new player inside wave 1. Wave 1 has to be winnable.
      name: 'RECON', health: 55, speed: 3.9, damage: 5, attackRange: 3.0,
      attackCd: 0.95, score: 100, xp: 10, colour: 0x4fd6ff, scale: 0.86,   // ~1.73m
      ranged: false, sightRange: 26, wave: 1,
      reaction: 0.85, spread: 0.05, visionCone: 1.20,
    },
    assault: {
      name: 'RIFLEMAN', health: 130, speed: 3.0, damage: 7, attackRange: 20,
      attackCd: 1.8, score: 150, xp: 18, colour: 0xffb03a, scale: 0.90,   // ~1.81m
      ranged: true, burst: 3, sightRange: 34, wave: 2,
      reaction: 0.95, spread: 0.075, visionCone: 1.10,
    },
    heavy: {
      name: 'GUNNER', health: 420, speed: 1.7, damage: 20, attackRange: 14,
      attackCd: 2.3, score: 300, xp: 45, colour: 0xff4d3d, scale: 0.97,   // ~1.95m, bulk gives the presence
      ranged: true, burst: 2, sightRange: 30, wave: 4,
      reaction: 1.25, spread: 0.10, visionCone: 1.00,
    },
    sniper: {
      name: 'MARKSMAN', health: 95, speed: 2.6, damage: 34, attackRange: 55,
      attackCd: 3.2, score: 400, xp: 55, colour: 0x8ad6a0, scale: 0.90,   // ~1.81m
      ranged: true, burst: 1, sightRange: 60, wave: 5,
      reaction: 1.5, spread: 0.030, visionCone: 0.85,
      keepDistance: 26,        // backs off if the player closes
      telegraph: 0.9,          // laser settles before the shot, so it is dodgeable
    },
    elite: {
      name: 'OPERATOR', health: 260, speed: 4.2, damage: 14, attackRange: 22,
      attackCd: 1.15, score: 500, xp: 70, colour: 0xc45cff, scale: 0.91,   // ~1.83m
      ranged: true, burst: 4, sightRange: 32, wave: 6,
      reaction: 0.7, spread: 0.055, visionCone: 1.25, smart: true,
    },
  },

  wave: {
    counts: [5, 8, 12],        // explicit for the first three, then formula
    growth: 4,
    breakTime: 5.0,
    maxAlive: 14,              // hard cap; the rest queue up
    spawnMin: 22,
    spawnMax: 44,
  },

  timeAttack: { duration: 300 },   // 5 minutes

  score: {
    kill: 100, headshotBonus: 100, waveClear: 500,
    comboWindow: 3.0,
    // kills within the window -> multiplier
    comboTiers: [[3, 2], [5, 3], [10, 5]],
  },

  xp: {
    perKill: 10, headshot: 8, waveClear: 120,
    // XP needed for level N is level * curve
    curve: 260,
  },
};

// Cold industrial facility: blue-grey steel, sodium work lights, red hazard.
// Difficulty changes how soldiers behave, not how much health they have.
// Multiplying hitpoints makes a fight longer, not harder, and makes every
// weapon feel weaker -- which is the opposite of the intent.
export const DIFFICULTY = {
  easy:   { name: 'EASY',   accuracy: 0.55, reaction: 1.7, awareness: 0.6, damage: 0.6 },
  normal: { name: 'NORMAL', accuracy: 1.0,  reaction: 1.0, awareness: 1.0, damage: 1.0 },
  hard:   { name: 'HARD',   accuracy: 1.6,  reaction: 0.6, awareness: 1.5, damage: 1.45 },
};

export const PAL = {
  // Overcast late afternoon, not moonlight. Every value here was blue-heavy,
  // and because the sky doubles as the environment map it tinted every PBR
  // surface in the game before the albedo got a say.
  skyTop: 0x39434c,
  skyMid: 0x6d7176,
  skyLow: 0x9d968b,
  sun: 0xffeed6,
  ambientSky: 0xc2c3c2,
  ambientGround: 0x837c72,
  fog: 0x7d7a73,
  workLight: 0xffc27a,
  hazard: 0xff3b30,
  emergency: 0xff5a3c,
};
