// Contact sheet of every model kind (models.js KINDS): each on its own little
// floor with a 1 m grid, a red arrow along +Z (the way a kind should face)
// and its name, rendered to shots/kinds_<n>.jpg. Needs ?capture.
//
//   const v = await import('/tools/propview.js'); await v.run(__rs)

export async function run(rs, opts = {}) {
  const THREE = rs.THREE, R = rs.renderer;
  const M = await import('/src/models.js');
  await M.loadModels(R);
  const names = opts.kinds || Object.keys(M.KINDS);
  const per = opts.per || 12;
  const out = [];
  for (let page = 0; page * per < names.length; page++) {
    const list = names.slice(page * per, page * per + per);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8a96a3);
    scene.environment = rs.game.scene.environment;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(-3, 6, 4); scene.add(sun);
    const cols = 4, cell = 6;
    list.forEach((k, i) => {
      const cx = (i % cols) * cell, cz = Math.floor(i / cols) * cell;
      const grid = new THREE.GridHelper(4, 4, 0x333333, 0x666666); grid.position.set(cx, 0, cz); scene.add(grid);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(cx, 0.02, cz), 1.5, 0xff2020); scene.add(arrow);
      const g = M.instance([{ kind: k, x: cx, y: 0, z: cz, rot: 0 }]);
      if (g) scene.add(g);
      const c = document.createElement('canvas'); c.width = 256; c.height = 48;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.font = 'bold 26px sans-serif'; x.fillText(k + (M.kind(k) ? ` ${M.kind(k).size.toArray().map((v) => v.toFixed(1)).join('x')}` : ' MISSING'), 4, 32);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
      sp.scale.set(4, 0.75, 1); sp.position.set(cx, 4.2, cz - 2); scene.add(sp);
    });
    const cam = new THREE.PerspectiveCamera(35, 16 / 9, 0.1, 200);
    const rows = Math.ceil(list.length / cols);
    cam.position.set(((cols - 1) * cell) / 2 - 6, 9 + rows * 2, (rows - 1) * cell + 16);
    cam.lookAt(((cols - 1) * cell) / 2, 0.5, ((rows - 1) * cell) / 2);
    R.setPixelRatio(1); R.setSize(1600, 900, false);
    R.render(scene, cam);
    const name = `kinds_${page}`;
    await fetch(`http://localhost:5179/?name=${name}`, { method: 'POST', body: R.domElement.toDataURL('image/jpeg', 0.88) });
    out.push(name);
  }
  window.dispatchEvent(new Event('resize'));
  return out;
}
