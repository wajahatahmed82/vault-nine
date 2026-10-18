// Hole scan.
//
// Flood-fills every spot a player can reach, using the real collision and
// floor code, and reports any reachable spot with no floor under it. A route
// test only catches holes on its route; this catches holes anywhere.
//
//   const h = await import('/tools/holescan.js'); h.run(__rs)

export function run(rs, opts = {}) {
  const { game, MODE } = rs;
  const P = game.player;
  const step = opts.step || 0.5;
  game.start(MODE.SURVIVAL);
  for (const r of game.robots) game.scene.remove(r.root);
  game.robots.length = 0;
  game.queued = 0; game.waveActive = false; game.breakT = 1e9;
  // keycard doors open, so the whole building is reachable
  if (game.campaign) for (const d of game.campaign.doors) game.campaign._openDoor(d);

  const seeds = opts.seeds || [
    { x: 0, z: 34, y: 0 },        // car park
    { x: -3.5, z: -59.5, y: -3.6 } // stair landing (also reachable from the stairs)
  ];
  const key = (x, z, y) => `${Math.round(x / step)},${Math.round(z / step)},${Math.round(y * 2)}`;
  const seen = new Set();
  const queue = [];
  const holes = [];
  let cells = 0;
  for (const s of seeds) { queue.push(s); seen.add(key(s.x, s.z, s.y)); }

  const bounds = { minX: -40, maxX: 40, minZ: -70, maxZ: 48 };
  while (queue.length && cells < 200000) {
    const c = queue.shift();
    cells++;
    for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const nx = c.x + dx, nz = c.z + dz;
      if (nx < bounds.minX || nx > bounds.maxX || nz < bounds.minZ || nz > bounds.maxZ) continue;
      if (P.blocked(nx, nz, c.y)) continue;
      const floor = P.groundAt(nx, nz, c.y);
      if (floor < -10) {
        holes.push({ from: [c.x, c.y, c.z], into: [+nx.toFixed(2), +nz.toFixed(2)] });
        continue;
      }
      // a drop of more than ~1m is a fall, not a step; follow it anyway so the
      // area below is scanned, but it is still reachable floor
      const k = key(nx, nz, floor);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, z: nz, y: floor });
    }
  }

  // collapse neighbouring hole cells into regions so the report is readable
  const regions = [];
  for (const h of holes) {
    const r = regions.find((g) => Math.abs(g.x - h.into[0]) < 2 && Math.abs(g.z - h.into[1]) < 2 && g.y === h.from[1]);
    if (r) { r.count++; } else regions.push({ x: h.into[0], z: h.into[1], y: h.from[1], count: 1 });
  }
  // Optional: confirm named spots are reachable at all (by any path), which
  // separates "this room is sealed" from "the route probe could not steer".
  const reached = {};
  for (const [name, x, z, y] of (opts.probes || [])) {
    let ok = false;
    for (let ix = -1; ix <= 1 && !ok; ix++) for (let iz = -1; iz <= 1 && !ok; iz++) {
      if (seen.has(key(x + ix * step, z + iz * step, P.groundAt(x, z, y + 0.3)))) ok = true;
    }
    reached[name] = ok;
  }
  return { cellsReached: cells, holeCells: holes.length, holeRegions: regions, reached };
}
