// Dev-only writer for built run-time assets. The in-browser build tools POST
// binary files here and they land in docs/assets/<path>. Not part of the app.
//
//   node tools/assetsrv.js        # port 5177
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'docs', 'assets');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('post only'); }
  const rel = (new URL(req.url, 'http://x').searchParams.get('path') || '').replace(/\\/g, '/');
  if (!/^[a-z0-9_\-/]+\.(glb|json|jpg|png|ktx2)$/i.test(rel) || rel.includes('..')) { res.statusCode = 400; return res.end('bad path'); }
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    fs.writeFileSync(file, Buffer.concat(chunks));
    res.end(JSON.stringify({ ok: true, path: rel, bytes: fs.statSync(file).size }));
  });
}).listen(5177, () => console.log('assetsrv on 5177'));
