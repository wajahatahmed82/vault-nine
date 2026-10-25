// Files loaded at run time (skies, soldier models), with one thin progress bar
// across the top of the screen while anything is loading.
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

// Bump when a file under docs/assets changes, so players' cached copies are
// replaced instead of kept forever.
const CACHE = 'vn-assets-2';
let cacheP = null;
function cache() {
  if (cacheP) return cacheP;
  cacheP = (typeof caches === 'undefined' || !window.isSecureContext)
    ? Promise.resolve(null)
    : caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vn-assets-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE))
      .catch(() => null);
  return cacheP;
}

// Fetch a file as an ArrayBuffer through the progress bar, keeping a copy in
// Cache Storage so the next visit (and the APK, offline) skips the download.
export async function fetchAsset(path) {
  const url = assetUrl(path);
  const store = await cache();
  if (store) {
    const hit = await store.match(url).catch(() => null);
    if (hit) return hit.arrayBuffer();
  }
  jobs.set(url, { loaded: 0, total: 0 });
  paint();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const total = +res.headers.get('content-length') || 0;
    let buf;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length;
        const j = jobs.get(url); j.loaded = got; j.total = total; paint();
      }
      const all = new Uint8Array(got);
      let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      buf = all.buffer;
    } else buf = await res.arrayBuffer();
    if (store) store.put(url, new Response(buf.slice(0), { headers: { 'content-type': res.headers.get('content-type') || 'application/octet-stream' } })).catch(() => {});
    return buf;
  } finally {
    jobs.delete(url); paint();
  }
}

// Progress of everything loading right now, 0..1 (1 when idle).
export function progress() {
  let l = 0, t = 0;
  for (const j of jobs.values()) { l += j.loaded; t += Math.max(j.total, j.loaded); }
  return jobs.size ? (t ? l / t : 0) : 1;
}

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
