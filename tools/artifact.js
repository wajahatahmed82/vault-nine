// Builds the artifact-ready variant of the single-file game.
//
// An Artifact supplies its own <!doctype>, <html>, <head> and <body>, so the
// page has to be written as content only: <title>, <style>, the body markup,
// then the bundle. Shipping the full document instead nests <html> inside
// <body> and the browser drops half of it.
//
// Everything else is the same build as docs/index.html -- same CSS, same
// bundle, no external requests, which is what the Artifact CSP requires.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('css/style.css');
const js = read('dist/bundle.js').replace(/<\/script/gi, '<\\/script');
const html = read('index.html');

const body = html.match(/<body>([\s\S]*?)<\/body>/i);
if (!body) throw new Error('index.html has no <body>');

let markup = body[1]
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/i, '')
  .replace(/<script type="module" src="src\/main\.js"><\/script>/i, '')
  .trim();

const out = `<title>Vault Nine</title>
<style>
/* The game paints its own ground; the artifact host must not show through. */
html, body { height: 100%; margin: 0; background: #0b1017; overflow: hidden; }
${css}
</style>

${markup}

<script>${js}<\/script>
`;

for (const bad of ['importmap', 'src/main.js', 'css/style.css', '<!doctype', '<html', '<body']) {
  if (out.toLowerCase().includes(bad.toLowerCase())) {
    throw new Error('artifact build left a document wrapper or dev reference: ' + bad);
  }
}

const dest = process.argv[2] || path.join(ROOT, 'dist/artifact.html');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log('artifact page  ' + (fs.statSync(dest).size / 1024).toFixed(0) + ' KB  ->  ' + dest);
