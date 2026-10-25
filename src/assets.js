// Files loaded at run time (skies now; models and textures later), with one
// thin progress bar across the top of the screen while anything is loading.
// Paths are relative to the page, so the same code works on the dev server
// (assets/ at the repo root), the built site (docs/assets/) and the APK.

const jobs = new Map();   // url -> { loaded, total }
let bar = null;

function paint() {
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'assetbar';
    bar.innerHTML = '<i></i><span></span>';
    document.body.appendChild(bar);
  }
  let l = 0, t = 0;
  for (const j of jobs.values()) { l += j.loaded; t += Math.max(j.total, j.loaded); }
  const on = jobs.size > 0;
  bar.classList.toggle('on', on);
  if (on) {
    const p = t ? l / t : 0;
    bar.firstChild.style.width = (p * 100).toFixed(1) + '%';
    bar.lastChild.textContent = `Loading ${(l / 1e6).toFixed(1)} / ${(t / 1e6).toFixed(1)} MB`;
  }
}

export function assetUrl(path) { return new URL(path, document.baseURI).href; }

// Wrap a three.js loader call: load(url, onLoad, onProgress, onError).
export function load(loader, path) {
  const url = assetUrl(path);
  jobs.set(url, { loaded: 0, total: 0 });
  paint();
  return new Promise((resolve, reject) => {
    const done = () => { jobs.delete(url); paint(); };
    loader.load(url, (r) => { done(); resolve(r); },
      (e) => { const j = jobs.get(url); if (j) { j.loaded = e.loaded; j.total = e.lengthComputable ? e.total : 0; paint(); } },
      (err) => { done(); reject(err); });
  });
}
