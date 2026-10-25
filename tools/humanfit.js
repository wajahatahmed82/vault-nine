// How well the solved arms sit on the carried weapons: for each loadout,
// standing at low ready and shouldered, the distance from each palm centre to
// its grip point, and where the butt and muzzle are in the soldier's frame
// (+X his left, +Z forward, metres above his feet).
//
//   const f = await import('/tools/humanfit.js'); f.run(__rs)

export function run(rs, types = ['scout', 'assault', 'heavy', 'sniper', 'elite']) {
  const g = rs.game, THREE = rs.THREE;
  if (g.state !== 'play') g.start(rs.MODE.SURVIVAL);
  g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0;
  const ps = g.player.state; ps.x = 0; ps.z = 112; ps.y = g.player.groundAt(0, 112, 5);
  const out = {};
  for (const type of types) {
    for (const st of ['idle', 'attack']) {
      const r = rs.spawnSoldier(type, 0.3, 116, 0);
      r.dist = 4;
      for (let i = 0; i < 90; i++) {
        r.state = st;
        r.root.rotation.y = Math.atan2(-0.3, -4);
        r.root.position.y = g.player.groundAt(0.3, 116, 0);
        r._ctx = g._ctx();
        r._animate(1 / 60);
      }
      g.scene.updateMatrixWorld(true);
      const h = r.human, gm = h.gun.matrixWorld;
      const inv = r.root.matrixWorld.clone().invert();
      const W = (n) => h.B[n].getWorldPosition(new THREE.Vector3());
      const L = (v) => v.clone().applyMatrix4(inv).toArray().map((x) => +x.toFixed(2));
      const palm = (s) => W(`${s}_Hand`).add(W(`${s}_Finger2`)).multiplyScalar(0.5);
      out[`${type}/${st}`] = {
        look: h.look,
        grip: +palm('R').distanceTo(h.gunSpec.grip.clone().applyMatrix4(gm)).toFixed(3),
        guard: +palm('L').distanceTo(h.gunSpec.guard.clone().applyMatrix4(gm)).toFixed(3),
        butt: L(new THREE.Vector3(0, 0, h.gunSpec.stockZ).applyMatrix4(gm)),
        muzzle: L(h.gunSpec.muzzle.clone().applyMatrix4(gm)),
        shoulderR: L(W('R_UpperArm')),
      };
      g.scene.remove(r.root);
      g.robots.length = 0;
    }
  }
  return out;
}
