// Bounds of every built prop, and of each named node in the modular kits.
//   node tools/propinfo.mjs [ids...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'assets', 'props');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const f = (v) => v.map((x) => +x.toFixed(2)).join(',');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter((n) => n.endsWith('.glb') && !n.endsWith('_lo.glb')).map((n) => n.slice(0, -4));
for (const id of ids) {
  const doc = await io.read(path.join(DIR, id + '.glb'));
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const kids = scene.listChildren();
  console.log(id.padEnd(28), 'min', f(b.min), 'max', f(b.max), 'nodes', kids.length);
  if (kids.length > 1 && kids.length < 40) for (const k of kids) { const kb = getBounds(k); console.log('   ', (k.getName() || '?').padEnd(36), f(kb.min), '|', f(kb.max)); }
}
