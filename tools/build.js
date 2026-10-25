// Transforms index.html into one self-contained file: inlines the CSS, drops
// the dev importmap, replaces the module script with the bundle.
//
// Replacements use a FUNCTION, never a string. In a string replacement "$&"
// means "insert the matched text", and minified JS contains "$&" -- which
// silently re-injected the dev <script src> tag into its own replacement.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const css = read('css/style.css');
const js = read('dist/bundle.js').replace(/<\/script/gi, '<\/script');
let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => `<style>${css}</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, () => '');
html = html.replace(/<script type="module" src="src\/main\.js"><\/script>/, () => `<script>${js}</script>`);

const desc = 'A story-driven tactical shooter. Investigate a silent research station, uncover what was buried in Vault Nine, and get out alive.';
html = html.replace(/<title>VAULT NINE<\/title>/, () =>
  `<meta name="description" content="${desc}">
<meta property="og:title" content="VAULT NINE">
<meta property="og:description" content="${desc}">
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Crect%20width='100'%20height='100'%20rx='18'%20fill='%230b1017'/%3E%3Cg%20fill='none'%20stroke='%237fe9c4'%20stroke-linecap='round'%3E%3Ccircle%20cx='50'%20cy='50'%20r='38'%20stroke-width='6'/%3E%3Cg%20stroke-width='5'%3E%3Cline%20x1='50'%20y1='50'%20x2='50.0'%20y2='20.0'/%3E%3Cline%20x1='50'%20y1='50'%20x2='69.3'%20y2='27.0'/%3E%3Cline%20x1='50'%20y1='50'%20x2='79.5'%20y2='44.8'/%3E%3Cline%20x1='50'%20y1='50'%20x2='76.0'%20y2='65.0'/%3E%3Cline%20x1='50'%20y1='50'%20x2='60.3'%20y2='78.2'/%3E%3Cline%20x1='50'%20y1='50'%20x2='39.7'%20y2='78.2'/%3E%3Cline%20x1='50'%20y1='50'%20x2='24.0'%20y2='65.0'/%3E%3Cline%20x1='50'%20y1='50'%20x2='20.5'%20y2='44.8'/%3E%3Cline%20x1='50'%20y1='50'%20x2='30.7'%20y2='27.0'/%3E%3C/g%3E%3Ccircle%20cx='50'%20cy='50'%20r='9'%20stroke-width='6'%20fill='%230b1017'/%3E%3C/g%3E%3C/svg%3E">
<title>VAULT NINE</title>`);

for (const bad of ['importmap', 'src/main.js', 'css/style.css']) {
  if (html.includes(bad)) throw new Error('build left a dev reference behind: ' + bad);
}

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'docs/index.html'), html);
fs.writeFileSync(path.join(ROOT, 'docs/.nojekyll'), '');

// Run-time assets (skies now, models later) live in docs/assets, beside the
// built page; the dev server maps /assets/ there too. Only counted here.
let assetBytes = 0;
const count = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const a = path.join(dir, e.name);
    if (e.isDirectory()) count(a); else assetBytes += fs.statSync(a).size;
  }
};
count(path.join(ROOT, 'docs/assets'));

const kb = (p) => (fs.statSync(path.join(ROOT, p)).size / 1024).toFixed(0) + ' KB';
console.log('bundle.js        ' + kb('dist/bundle.js'));
console.log('docs/index.html  ' + kb('docs/index.html'));
console.log('docs/assets/     ' + (assetBytes / 1024).toFixed(0) + ' KB (loaded on demand)');
