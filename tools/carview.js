// The generated car bodies (cars.js) on a plain floor, from four sides, to
// shots/cars_<n>.jpg. Needs ?capture.
//   const v = await import('/tools/carview.js'); await v.run(__rs)
export async function run(rs) {
  const THREE = rs.THREE, R = rs.renderer;
  const M = await import('/src/models.js');
  const C = await import('/src/cars.js');
  C.registerCars();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aa6b2);
  scene.environment = rs.game.scene.environment;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(-4, 7, 5); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55585a, roughness: 0.9 }));
  scene.add(floor);
  const cols = [[0.55, 0.1, 0.08], [0.12, 0.2, 0.36], [0.62, 0.62, 0.6], [0.2, 0.33, 0.24]];
  const list = [...C.CAR_KINDS].map((k, i) => ({ kind: k, x: (i - 1.5) * 3.2, y: 0, z: 0, rot: 0, col: cols[i % cols.length] }));
  scene.add(M.instance(list));
  const cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
  R.setPixelRatio(1); R.setSize(1600, 900, false);
  const views = [[8, 3.2, 10], [-9, 2.6, -6], [0, 9, 0.01], [12, 1.2, 0]];
  const out = [];
  for (let i = 0; i < views.length; i++) {
    cam.position.set(...views[i]); cam.lookAt(0, 0.7, 0);
    R.render(scene, cam);
    await fetch(`http://localhost:5179/?name=cars_${i}`, { method: 'POST', body: R.domElement.toDataURL('image/jpeg', 0.9) });
    out.push(`cars_${i}`);
  }
  window.dispatchEvent(new Event('resize'));
  return out;
}
