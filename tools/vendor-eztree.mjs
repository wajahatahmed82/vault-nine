// Copies the ez-tree generator (MIT, Daniel Greenheck) from node_modules into
// src/vendor/ez-tree/ for the browser build:
//   - relative imports get their .js extension (the dev page runs unbundled),
//   - its bundled bark/leaf images are left out; textures.js here hands out
//     the CC0 ambientCG textures instead (see src/trees.js),
//   - the JSON presets become one JS module.
//   node tools/vendor-eztree.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules', '@dgreenheck', 'ez-tree');
const OUT = path.join(ROOT, 'src', 'vendor', 'ez-tree');
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(SRC, 'LICENSE'), path.join(OUT, 'LICENSE'));

const header = '// Vendored from @dgreenheck/ez-tree 1.1.0 (MIT, see LICENSE). Imports\n// patched for the unbundled dev page by tools/vendor-eztree.mjs.\n';
for (const f of ['tree.js', 'branch.js', 'rng.js', 'enums.js', 'options.js', 'trellis.js']) {
  let s = fs.readFileSync(path.join(SRC, 'src', 'lib', f), 'utf8');
  s = s.replace(/from '\.\/([a-z]+)'/g, "from './$1.js'").replace("from './presets/index'", "from './presets.js'");
  fs.writeFileSync(path.join(OUT, f), header + s);
}
const presets = {};
for (const f of fs.readdirSync(path.join(SRC, 'src', 'lib', 'presets'))) {
  if (!f.endsWith('.json')) continue;
  const name = f.replace('.json', '').split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  presets[name] = JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'lib', 'presets', f), 'utf8'));
}
fs.writeFileSync(path.join(OUT, 'presets.js'), header +
  "import TreeOptions from './options.js';\n\nexport const TreePreset = " + JSON.stringify(presets) + ";\n\n" +
  'export function loadPreset(name) {\n  const preset = TreePreset[name];\n  return preset ? structuredClone(preset) : new TreeOptions();\n}\n');
// textures: the game supplies them (src/trees.js sets these before generating)
fs.writeFileSync(path.join(OUT, 'textures.js'), header +
  "// The game's textures, set by src/trees.js.\nexport const TEX = { bark: null, barkNormal: null, barkRough: null, leaf: null };\n" +
  "export function getBarkTexture(type, file) {\n  return file === 'normal' ? TEX.barkNormal : file === 'roughness' ? TEX.barkRough : file === 'ao' ? null : TEX.bark;\n}\n" +
  'export function getLeafTexture() { return TEX.leaf; }\n');
console.log('vendored to', OUT, Object.keys(presets).join(', '));
