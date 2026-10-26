// Photo mode for verifying the world from real viewpoints.
//
//   const p = await import('/tools/photo.js'); p.on(__rs)
//   p.eye(__rs, x, z, yaw, pitch)        // stand somewhere, eye height
//   p.look(__rs, px, py, pz, tx, ty, tz) // free camera
//   p.off(__rs)
//
// Freezes the simulation, hides every DOM overlay and the weapon, and leaves
// the render loop drawing the camera where it is put, so the pane's own
// screenshot shows exactly the world.

let saved = null;

export function on(rs) {
  const g = rs.game;
  if (saved) return;
  saved = { update: g.update, vis: [] };
  g.update = () => {};
  for (const e of document.querySelectorAll('body > *')) {
    if (e.id === 'view') continue;
    saved.vis.push([e, e.style.visibility]);
    e.style.visibility = 'hidden';
  }
  g.weapons.root.visible = false;
  if (g.weapons.arms) g.weapons.arms.root.visible = false;
}

export function off(rs) {
  const g = rs.game;
  if (!saved) return;
  g.update = saved.update;
  for (const [e, v] of saved.vis) e.style.visibility = v;
  g.weapons.root.visible = true;
  if (g.weapons.arms) g.weapons.arms.root.visible = true;
  saved = null;
}

// the town draws only the props in the camera's view cone (models.js), so
// refresh it for the new camera before drawing
function townFor(g) {
  if (!g.town) return;
  const d = g.camera.getWorldDirection(g.camera.position.clone());
  const l = Math.hypot(d.x, d.z) || 1;
  g.town.update(g.camera.position, undefined, { x: d.x / l, z: d.z / l });
}

export function eye(rs, x, z, yaw, pitch = 0) {
  const g = rs.game;
  const y = g.player.groundAt(x, z, g.surfaceH ? g.surfaceH(x, z) + 0.5 : 0.5) + 1.62;
  const cam = g.camera;
  cam.position.set(x, y, z);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(pitch, yaw, 0);
  cam.updateMatrixWorld();
  townFor(g);
  // draw now: a hidden pane throttles requestAnimationFrame
  g.render();
  return y;
}

export function look(rs, px, py, pz, tx, ty, tz) {
  const cam = rs.game.camera;
  cam.position.set(px, py, pz);
  cam.lookAt(tx, ty, tz);
  cam.updateMatrixWorld();
  townFor(rs.game);
  rs.game.render();
}
