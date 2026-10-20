// Town navigation for soldiers.
//
// The station is corridors, where local steering is enough. The town is
// blocks of buildings: a soldier chasing you round a block needs to know the
// way round. This is a waypoint graph -- nodes along every street and
// pavement, across every lot, and through the doorways of every enterable
// building -- with edges only where the AI's own blocked() test says a soldier
// can walk the straight line. A* over it, string-pulled while following.
//
// Built lazily the first time a soldier in town asks for a path (~100-200 ms,
// during the moment a town fight starts), never in the station.

export function buildNav(game) {
  const t0 = performance.now();
  const town = game.town;
  const blocked = (x, z) => game.blockedAt(x, z);
  const nodes = [];
  const CELL = 10;
  const hash = new Map();
  const key = (ix, iz) => ix * 4096 + iz;
  const add = (x, z) => {
    if (Math.abs(x) > 212 || z < 46 || z > 342) return -1;
    if (blocked(x, z)) return -1;
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    // de-duplicate nodes closer than 2.5 m
    for (let a = ix - 1; a <= ix + 1; a++) for (let b = iz - 1; b <= iz + 1; b++) {
      const l = hash.get(key(a, b));
      if (l) for (const i of l) if ((nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2 < 6.25) return i;
    }
    nodes.push({ x, z, adj: [] });
    const i = nodes.length - 1;
    const k = key(ix, iz);
    if (!hash.has(k)) hash.set(k, []);
    hash.get(k).push(i);
    return i;
  };
  // streets: centre line and both pavements
  for (const s of town.streets) {
    const offs = s.pave > 0 ? [0, -(s.road / 2 + s.pave / 2), s.road / 2 + s.pave / 2] : [0, -s.road / 2 - 2, s.road / 2 + 2];
    for (let t = s.from; t <= s.to; t += 7) {
      for (const o of offs) s.axis === 'z' ? add(s.at + o, t) : add(t, s.at + o);
    }
  }
  // lots
  for (const b of town.blocks) {
    for (let x = b.x1 + 2; x < b.x2 - 1; x += 7) for (let z = b.z1 + 2; z < b.z2 - 1; z += 7) add(x, z);
  }
  // doorways and interiors of the buildings you can enter
  const doorPairs = [];
  for (const b of town.buildings) {
    if (!b.enter) continue;
    const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
    const W = (lx, lz) => [b.x + lx * cs + lz * sn, b.z - lx * sn + lz * cs];
    for (const [key2, u, n] of [['f', null, 1], ['b', null, -1]]) {
      for (const o of (b.openings[key2] || [])) {
        if (o.type !== 'door') continue;
        const uu = key2 === 'f' ? (o.u0 + o.u1) / 2 : -(o.u0 + o.u1) / 2;
        const out = W(uu, n * (b.d / 2 + 1.6)), inn = W(uu, n * (b.d / 2 - 1.4));
        const a = add(out[0], out[1]), c = add(inn[0], inn[1]);
        if (a >= 0 && c >= 0) doorPairs.push([a, c]);
      }
      void u;
    }
    for (let lx = -b.w / 2 + 1.5; lx < b.w / 2 - 1; lx += 3) for (let lz = -b.d / 2 + 1.5; lz < b.d / 2 - 1; lz += 3) {
      const p = W(lx, lz);
      add(p[0], p[1]);
    }
  }
  // edges
  const clear = (ax, az, bx, bz) => {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 0.5));
    for (let i = 1; i < n; i++) if (blocked(ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return false;
    return true;
  };
  const R = 10.5;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const ix = Math.floor(a.x / CELL), iz = Math.floor(a.z / CELL);
    for (let x = ix - 1; x <= ix + 1; x++) for (let z = iz - 1; z <= iz + 1; z++) {
      const l = hash.get(key(x, z));
      if (!l) continue;
      for (const j of l) {
        if (j <= i) continue;
        const b = nodes[j];
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > R || !clear(a.x, a.z, b.x, b.z)) continue;
        a.adj.push([j, d]); b.adj.push([i, d]);
      }
    }
  }
  for (const [a, c] of doorPairs) {
    if (!nodes[a].adj.some((e) => e[0] === c) && clear(nodes[a].x, nodes[a].z, nodes[c].x, nodes[c].z)) {
      const d = Math.hypot(nodes[a].x - nodes[c].x, nodes[a].z - nodes[c].z);
      nodes[a].adj.push([c, d]); nodes[c].adj.push([a, d]);
    }
  }

  const nearest = (x, z, max = 6) => {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    const cand = [];
    for (let r = 1; r <= 2 && cand.length < max; r++) {
      cand.length = 0;
      for (let a = ix - r; a <= ix + r; a++) for (let b = iz - r; b <= iz + r; b++) {
        const l = hash.get(key(a, b));
        if (l) for (const i of l) cand.push([(nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2, i]);
      }
    }
    cand.sort((p, q) => p[0] - q[0]);
    for (let k = 0; k < Math.min(max, cand.length); k++) {
      const n = nodes[cand[k][1]];
      if (clear(x, z, n.x, n.z)) return cand[k][1];
    }
    return cand.length ? cand[0][1] : -1;
  };

  // A* with a binary heap
  const g = new Float32Array(nodes.length), came = new Int32Array(nodes.length), stamp = new Int32Array(nodes.length);
  let run = 0;
  function path(ax, az, bx, bz) {
    const s = nearest(ax, az), e = nearest(bx, bz);
    if (s < 0 || e < 0) return null;
    run++;
    const hf = [0], hn = [s];          // binary heap: priorities and node ids
    const push = (f, n) => {
      let i = hf.length; hf.push(f); hn.push(n);
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; [hf[p], hf[i]] = [hf[i], hf[p]]; [hn[p], hn[i]] = [hn[i], hn[p]]; i = p; }
    };
    const pop = () => {
      const top = hn[0];
      const lf = hf.pop(), ln = hn.pop();
      if (hf.length) {
        hf[0] = lf; hn[0] = ln;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < hf.length && hf[l] < hf[m]) m = l;
          if (r < hf.length && hf[r] < hf[m]) m = r;
          if (m === i) break;
          [hf[m], hf[i]] = [hf[i], hf[m]]; [hn[m], hn[i]] = [hn[i], hn[m]]; i = m;
        }
      }
      return top;
    };
    stamp[s] = run; g[s] = 0; came[s] = -1;
    const closed = new Set();
    let expanded = 0;
    while (hf.length && expanded < 5000) {
      const cur = pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      expanded++;
      if (cur === e) break;
      for (const [nb, w] of nodes[cur].adj) {
        const ng = g[cur] + w;
        if (stamp[nb] !== run || ng < g[nb]) {
          stamp[nb] = run; g[nb] = ng; came[nb] = cur;
          push(ng + Math.hypot(nodes[nb].x - bx, nodes[nb].z - bz), nb);
        }
      }
    }
    if (stamp[e] !== run) return null;
    const out = [{ x: bx, z: bz }];
    for (let c = e; c >= 0; c = came[c]) out.push({ x: nodes[c].x, z: nodes[c].z });
    out.reverse();
    return out;
  }

  return {
    nodes, path, clear,
    edges: nodes.reduce((n, a) => n + a.adj.length, 0) / 2,
    buildMs: Math.round(performance.now() - t0),
    // Only outside the station shelf: inside it, local steering does the job.
    active: (x, z) => z > 47 || Math.abs(x) > 46,
  };
}
