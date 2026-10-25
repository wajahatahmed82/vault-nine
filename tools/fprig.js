// Side and top views of the first-person rig (arms + weapon hung from the
// camera), drawn with a second camera beside the player's, plus how far each
// palm is from its grip point. For tuning FPArms. Needs ?capture.
//
//   const f = await import('/tools/fprig.js'); await f.run(__rs, 'rifle')

export async function run(rs, id = 'rifle', opts = {}) {
  const g = rs.game, R = rs.renderer, W = g.weapons, THREE = rs.THREE;
  if (g.state !== 'play') g.start(rs.MODE.SURVIVAL);
  g.queued = 0; g.waveActive = false; g.breakT = 1e9;
  for (const r of g.robots) g.scene.remove(r.root);
  g.robots.length = 0;
  const ps = g.player.state; ps.x = 0; ps.z = 112; ps.y = g.player.groundAt(0, 112, 5); ps.yaw = Math.PI; ps.pitch = 0;
  W.owned = null; W.current = id;
  for (const k of W.ids) W.models[k].gun.visible = k === id;
  W.reloading = 0; W.swapT = 0; W.pendingSwap = null; W.inspectT = 0;
  const pose = opts.pose || 'hip';
  for (let i = 0; i < 4; i++) {
    W.ads = pose === 'ads' ? 1 : 0; W.wantAds = pose === 'ads';
    if (pose === 'reload') { W.reloadTotal = 2; W.reloading = 2 * (1 - (opts.t ?? 0.4)); }
    g.update(1 / 60);
  }
  W.ads = pose === 'ads' ? 1 : 0;
  if (pose === 'reload') W.reloading = 2 * (1 - (opts.t ?? 0.4));
  W.update(0, g.scene);
  const cam = g.camera;
  cam.updateMatrixWorld(true);
  const m = W.model, A = W.arms;
  const P = (o) => o.getWorldPosition(new THREE.Vector3());
  const toCam = (v) => v.clone().applyMatrix4(cam.matrixWorldInverse).toArray().map((x) => +x.toFixed(3));
  const palm = (s) => P(A.B[`${s}_Hand`]).add(P(A.B[`${s}_Finger2`])).multiplyScalar(0.5);
  const grip = m.hands.grip.clone().applyMatrix4(m.gun.matrixWorld), guard = m.hands.guard.clone().applyMatrix4(m.gun.matrixWorld);
  const info = {
    gripErr: +palm('R').distanceTo(grip).toFixed(3), guardErr: +palm('L').distanceTo(guard).toFixed(3),
    shR: toCam(P(A.B.R_UpperArm)), elR: toCam(P(A.B.R_Forearm)), haR: toCam(P(A.B.R_Hand)), grip: toCam(grip),
    shL: toCam(P(A.B.L_UpperArm)), elL: toCam(P(A.B.L_Forearm)), haL: toCam(P(A.B.L_Hand)), guard: toCam(guard),
    tris: A.mesh.geometry.index.count / 3,
  };
  // views: side (from the right), top, and the player's own
  const side = new THREE.PerspectiveCamera(40, 16 / 9, 0.01, 50);
  side.layers.enableAll();
  const shots = { side: [1.4, 0.05, -0.35], top: [0.05, 1.3, -0.4], left: [-1.4, 0.05, -0.35] };
  const prevBg = g.scene.background;
  R.setPixelRatio(1); R.setSize(1280, 720, false);
  for (const [name, off] of Object.entries(shots)) {
    const o = new THREE.Vector3(...off).applyMatrix4(cam.matrixWorld);
    const t = new THREE.Vector3(0.05, -0.2, -0.35).applyMatrix4(cam.matrixWorld);
    side.position.copy(o);
    side.up.set(0, 1, 0);
    if (name === 'top') side.up.copy(new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld));
    side.lookAt(t);
    side.updateMatrixWorld(true);
    g.scene.background = new THREE.Color(0x56606c);
    R.render(g.scene, side);
    await fetch(`http://localhost:5179/?name=fprig_${id}_${pose}_${name}`, { method: 'POST', body: R.domElement.toDataURL('image/jpeg', 0.88) });
  }
  g.scene.background = prevBg;
  W.reloading = 0; W.ads = 0; W.wantAds = false;
  window.dispatchEvent(new Event('resize'));
  return info;
}
