// Dev static server that refuses to cache.
//
// The default python http.server sends cacheable responses, which meant edits
// to one module loaded while another stayed stale -- producing a scene lit by
// new intensities and old colours. Not worth debugging twice.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || 5181);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  // run-time assets live once, in docs/assets (what Pages serves); the dev
  // page at the root asks for assets/... so map it there
  if (url.startsWith('/assets/')) file = path.join(ROOT, 'docs', url);

  // never serve outside the project
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('forbidden'); }

  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, buf) => {
      if (err2) { res.statusCode = 404; return res.end('not found'); }
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(buf);
    });
  });
}).listen(PORT, () => console.log('robot-strike dev server on ' + PORT));
