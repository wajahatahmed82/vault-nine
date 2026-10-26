// Material build: ambientCG zips -> run-time texture files.
//
//   node tools/matbuild.mjs
//
// Reads raw/p3/tex/<id>_1K-JPG.zip (Phase 3 downloads) and the Phase 1 zips in
// raw/cc0/ (copied there from the original downloads), and writes, per
// material, into docs/assets/mat/:
//   <id>_c.jpg    colour (sRGB)
//   <id>_n.jpg    normal (OpenGL convention, as ambientCG ships it)
//   <id>_rh.jpg   R = roughness, G = height (for parallax), B = ambient occlusion
// at 512 px for desktop and <id>_*_lo.jpg at 256 px for phones. Decals (with
// an Opacity map) get <id>_d.webp instead: colour with alpha, plus _n / _rh.
// Facade, roof and ground layers are packed into texture arrays at run time
// (texgen.applyCC0), so these stay plain images rather than KTX2.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'assets', 'mat');
const TMP = path.join(ROOT, 'raw', 'unzip');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const zips = [];
for (const dir of ['raw/p3/tex', 'raw/cc0']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (f.endsWith('_1K-JPG.zip')) zips.push(path.join(d, f));
}

const SIZES = [[512, ''], [256, '_lo']];
const OPAQUE = new Set(['RoofingTiles012A', 'RoofingTiles013A']);
let total = { '': 0, _lo: 0 };

for (const zip of zips) {
  const id = path.basename(zip).replace('_1K-JPG.zip', '');
  const dir = path.join(TMP, id);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    // Python's zipfile: Git Bash's GNU tar reads "C:" as a remote host
    execFileSync('python', ['-I', '-c', 'import zipfile, sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir]);
  }
  const file = (kind) => {
    const f = fs.readdirSync(dir).find((n) => n.endsWith(`_${kind}.jpg`) || n.endsWith(`_${kind}.png`));
    return f ? path.join(dir, f) : null;
  };
  const color = file('Color'), normal = file('NormalGL'), rough = file('Roughness');
  // roof tiles ship an Opacity map for their cut edges; as array layers they are opaque
  const height = file('Displacement'), ao = file('AmbientOcclusion'), opacity = OPAQUE.has(id) ? null : file('Opacity');
  if (!color) { console.warn('no colour map in', id); continue; }
  for (const [S, sfx] of SIZES) {
    const grey = async (f, fill) => (f
      ? sharp(f).resize(S, S, { fit: 'fill' }).greyscale().raw().toBuffer()
      : Buffer.alloc(S * S, fill));
    if (opacity) {
      const a = await grey(opacity, 255);
      const rgb = await sharp(color).resize(S, S, { fit: 'fill' }).removeAlpha().raw().toBuffer();
      const rgba = Buffer.alloc(S * S * 4);
      for (let i = 0; i < S * S; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = a[i]; }
      await sharp(rgba, { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 85, alphaQuality: 90 }).toFile(path.join(OUT, `${id}_d${sfx}.webp`));
    } else {
      await sharp(color).resize(S, S, { fit: 'fill' }).jpeg({ quality: 86, mozjpeg: true }).toFile(path.join(OUT, `${id}_c${sfx}.jpg`));
    }
    if (normal) await sharp(normal).resize(S, S, { fit: 'fill' }).jpeg({ quality: 92, mozjpeg: true }).toFile(path.join(OUT, `${id}_n${sfx}.jpg`));
    const r = await grey(rough, 230), h = await grey(height, 128), o = await grey(ao, 255);
    const rh = Buffer.alloc(S * S * 3);
    for (let i = 0; i < S * S; i++) { rh[i * 3] = r[i]; rh[i * 3 + 1] = h[i]; rh[i * 3 + 2] = o[i]; }
    await sharp(rh, { raw: { width: S, height: S, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(OUT, `${id}_rh${sfx}.jpg`));
  }
  const bytes = (sfx) => fs.readdirSync(OUT).filter((f) => f.startsWith(id + '_') && (sfx ? f.includes('_lo.') : !f.includes('_lo.'))).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  total[''] += bytes(''); total._lo += bytes('_lo');
  console.log(id, (bytes('') / 1024).toFixed(0), 'KB', (bytes('_lo') / 1024).toFixed(0), 'KB lo', opacity ? '(decal)' : '');
}
console.log('total', (total[''] / 1e6).toFixed(2), 'MB desktop,', (total._lo / 1e6).toFixed(2), 'MB phones');
