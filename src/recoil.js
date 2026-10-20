// Recoil patterns.
//
// The old recoil was a camera punch that sprang back on its own, with a random
// sideways component. The aim never actually moved, so there was nothing to
// learn and nothing to control -- every spray was different and every spray
// fixed itself. That is the single biggest reason gunplay felt weightless.
//
// Here each weapon has a fixed pattern: shot N always kicks the view by the
// same amount in the same direction. The kick moves the player's real aim, so
// the player has to pull against it, and because it is the same every time the
// pull can be learned. A small seeded jitter keeps it from feeling robotic
// without making it unlearnable -- the jitter is identical on every spray too.
//
// Units are radians of view rotation per shot. `up` raises the muzzle; `side`
// is positive to the right.

function seeded(i, salt) {
  let h = (i + 1) * 374761393 + salt * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;   // -1..1
}

// Each pattern is a function of shot index, so a 30-round magazine and an
// upgraded 39-round one follow the same curve without a hand-typed table.
const PATTERNS = {
  // Assault rifle: a steady climb for the first handful, then a drift right
  // that swings back left late in the magazine. The classic shape players learn
  // to pull down-and-left, then down-and-right against.
  rifle(i) {
    const up = 0.0098 * (i < 3 ? 1.35 : i < 12 ? 1.0 : 0.72);
    let side;
    if (i < 6) side = 0.0010;
    else if (i < 15) side = 0.0032;
    else if (i < 24) side = -0.0038;
    else side = 0.0016;
    return [up * (1 + seeded(i, 11) * 0.08), side + seeded(i, 12) * 0.0006];
  },

  // SMG: light, fast, and wanders. Low climb but a side-to-side weave that
  // drifts left overall, so it is controllable up close and sloppy at range.
  smg(i) {
    const up = 0.0058 * (i < 4 ? 1.3 : 0.9);
    const weave = Math.sin(i * 0.9) * 0.0034;
    const drift = -0.0011;
    return [up * (1 + seeded(i, 21) * 0.10), weave + drift + seeded(i, 22) * 0.0007];
  },

  // Shotgun: one heavy kick per shell, mostly vertical.
  shotgun(i) {
    return [0.046 * (1 + seeded(i, 31) * 0.06), 0.006 * seeded(i, 32)];
  },

  // Marksman rifle: a big single kick with a slight rightward lift.
  sniper(i) {
    return [0.058 * (1 + seeded(i, 41) * 0.05), 0.0045 + seeded(i, 42) * 0.0015];
  },

  // Pistol: a sharp flip per shot that settles fast.
  pistol(i) {
    return [0.017 * (1 + seeded(i, 51) * 0.08), 0.002 * seeded(i, 52)];
  },
};

export function recoilKick(weaponId, shotIndex) {
  const fn = PATTERNS[weaponId] || PATTERNS.rifle;
  return fn(shotIndex);
}

// How long after the last shot a spray is considered finished, relative to
// the weapon's fire interval. Past this the pattern restarts from shot 0.
export const SPRAY_RESET = 2.4;
