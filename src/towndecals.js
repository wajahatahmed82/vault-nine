import * as THREE from 'three';
import { fetchAsset } from './assets.js';
import { TOUCH_ONLY } from './input.js';

// Weathering and street decals: one 4 x 4 atlas, one transparent material,
// written as quads a few millimetres proud of walls and road into each
// chunk's decal buffer (one draw call per chunk).
//
// Photo cells come from the CC0 ambientCG decal sets (docs/assets/mat, see
// ASSETS.md): grime streaks (Leaking003), a patched tarmac repair
// (Asphalt013), manhole covers (ManholeCover003/007), a kerb drain (Grate001).
// Cracks, posters, graffiti and oil stains are drawn here. Every word on them
// is invented; nothing is copied from a real brand, band or tag.

export const DECAL = {
  grime: 0, grimeB: 1, crack: 2, crackB: 3, poster: 4, posterB: 5, posterC: 6, posterD: 7,
  graffiti: 8, graffitiB: 9, graffitiC: 10, patch: 11, manhole: 12, manholeRect: 13, grate: 14, oil: 15,
};
const N = 4;

// UVs for a quad written bottom-left, bottom-right, top-right, top-left.
export function decalUV(cell, flip) {
  const cx = cell % N, cy = Math.floor(cell / N);
  const u0 = cx / N + 0.002, u1 = (cx + 1) / N - 0.002, vt = 1 - cy / N - 0.002, vb = 1 - (cy + 1) / N + 0.002;
  return flip ? [u1, vb, u0, vb, u0, vt, u1, vt] : [u0, vb, u1, vb, u1, vt, u0, vt];
}

export function decalMaterial(tex) {
  return new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, vertexColors: true, roughness: 0.92, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

function rnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildDecalAtlas() {
  const S = TOUCH_ONLY ? 256 : 512, W = S * N;
  const c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d');
  const cell = (k, fn) => { const x = (k % N) * S, y = Math.floor(k / N) * S; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, S, S); g.clip(); g.scale(S / 512, S / 512); fn(g, rnd(k * 131 + 7)); g.restore(); };

  // cracks: a branching hairline with a darker core
  const crack = (gg, r) => {
    const walk = (x, y, a, len, w) => {
      gg.lineWidth = w; gg.beginPath(); gg.moveTo(x, y);
      for (let i = 0; i < len; i++) {
        a += (r() - 0.5) * 0.7; x += Math.cos(a) * 9; y += Math.sin(a) * 9;
        gg.lineTo(x, y);
        if (r() < 0.08 && w > 1) { gg.stroke(); walk(x, y, a + (r() < 0.5 ? 1 : -1) * (0.5 + r()), len * 0.4, w * 0.6); gg.beginPath(); gg.moveTo(x, y); }
      }
      gg.stroke();
    };
    gg.strokeStyle = 'rgba(30,26,22,0.9)'; gg.lineCap = 'round';
    walk(256, 10, Math.PI / 2 + (r() - 0.5) * 0.5, 50, 4);
  };
  cell(DECAL.crack, crack);
  cell(DECAL.crackB, (gg, r) => { gg.translate(512, 0); gg.scale(-1, 1); crack(gg, r); });

  // posters: paper with a torn edge, a headline, smaller lines, a picture block
  const poster = (bg, ink, accent, lines, img) => (gg, r) => {
    gg.fillStyle = bg;
    gg.beginPath(); gg.moveTo(40, 20);
    for (let x = 40; x <= 472; x += 24) gg.lineTo(x, 20 + r() * 8);
    for (let y = 20; y <= 492; y += 24) gg.lineTo(472 - r() * 8, y);
    for (let x = 472; x >= 40; x -= 24) gg.lineTo(x, 492 - r() * 10);
    gg.closePath(); gg.fill();
    gg.fillStyle = accent; if (img) gg.fillRect(80, 150, 352, 180);
    gg.fillStyle = ink; gg.textAlign = 'center';
    lines.forEach(([t, size, y]) => { gg.font = `bold ${size}px Georgia, serif`; gg.fillText(t, 256, y); });
    // weathering: fade and streaks
    gg.fillStyle = 'rgba(120,110,90,0.18)'; for (let i = 0; i < 6; i++) gg.fillRect(40 + r() * 400, 20, 6 + r() * 12, 480);
  };
  cell(DECAL.poster, poster('#e6d9b8', '#26201a', '#7a3a2a', [['THE NORTH WIND', 44, 100], ['LIVE AT THE TIMBERLINE', 26, 380], ['SATURDAY 9PM', 36, 440]], true));
  cell(DECAL.posterB, poster('#f2f0e8', '#1c1c1c', '#9aa0a4', [['MISSING', 60, 100], ['GREY TABBY  -  ANSWERS TO "MOTH"', 20, 370], ['CALL 4-1187', 34, 440]], true));
  cell(DECAL.posterC, poster('#2c4a6e', '#f4f0e0', '#c9a23a', [['RE-ELECT', 40, 110], ['HOLLIS', 84, 210], ['FOR COUNCIL', 34, 300], ['A STEADY HAND', 26, 430]], false));
  cell(DECAL.posterD, (gg, r) => {   // layers of torn posters
    for (let k = 0; k < 4; k++) {
      gg.fillStyle = ['#d9c8a0', '#b6463a', '#e8e4d8', '#3b5a40'][k];
      gg.beginPath(); const x0 = 30 + r() * 80, y0 = 30 + r() * 80;
      gg.moveTo(x0, y0); for (let i = 0; i < 9; i++) gg.lineTo(x0 + r() * 420, y0 + r() * 420); gg.closePath(); gg.fill();
    }
    gg.fillStyle = '#20201c'; gg.font = 'bold 40px Georgia, serif'; gg.fillText('FLEA MARKET', 120, 300);
  });

  // graffiti: bubble letters, a scrawled tag, a stencilled arrow
  cell(DECAL.graffiti, (gg) => {
    gg.font = 'bold 150px Impact, sans-serif'; gg.textAlign = 'center'; gg.lineJoin = 'round';
    gg.lineWidth = 26; gg.strokeStyle = '#1a1a1a'; gg.strokeText('RIDGE', 256, 300);
    gg.lineWidth = 12; gg.strokeStyle = '#f2f2f2'; gg.strokeText('RIDGE', 256, 300);
    const gr = gg.createLinearGradient(0, 180, 0, 320); gr.addColorStop(0, '#e8a83a'); gr.addColorStop(1, '#c2382a');
    gg.fillStyle = gr; gg.fillText('RIDGE', 256, 300);
  });
  cell(DECAL.graffitiB, (gg, r) => {
    gg.strokeStyle = '#2a6ad0'; gg.lineWidth = 10; gg.lineCap = 'round'; gg.lineJoin = 'round';
    gg.beginPath(); let x = 70, y = 300; gg.moveTo(x, y);
    for (let i = 0; i < 40; i++) { x += 9 + r() * 4; y = 300 + Math.sin(i * 0.9) * 70 * (0.5 + r() * 0.5) - (i % 7 === 0 ? 60 : 0); gg.lineTo(x, y); }
    gg.stroke();
    gg.beginPath(); gg.moveTo(60, 380); gg.quadraticCurveTo(256, 430, 460, 360); gg.stroke();
    gg.fillStyle = '#2a6ad0'; for (let i = 0; i < 30; i++) gg.fillRect(60 + r() * 400, 200 + r() * 220, 3, 6 + r() * 20);   // drips
  });
  cell(DECAL.graffitiC, (gg) => {
    gg.fillStyle = 'rgba(20,20,20,0.85)';
    gg.beginPath(); gg.moveTo(80, 230); gg.lineTo(330, 230); gg.lineTo(330, 160); gg.lineTo(450, 260); gg.lineTo(330, 360); gg.lineTo(330, 290); gg.lineTo(80, 290); gg.closePath(); gg.fill();
    gg.font = 'bold 54px Courier New, monospace'; gg.fillText('ZONE 4', 90, 440);
  });

  // oil and tyre marks
  cell(DECAL.oil, (gg, r) => {
    for (let i = 0; i < 9; i++) {
      const x = 120 + r() * 270, y = 120 + r() * 270, s = 30 + r() * 90;
      const gr = gg.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(12,12,14,0.55)'); gr.addColorStop(1, 'rgba(12,12,14,0)');
      gg.fillStyle = gr; gg.fillRect(x - s, y - s, s * 2, s * 2);
    }
  });

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // photo cells as they arrive
  const sfx = TOUCH_ONLY ? '_lo' : '';
  // `streak`: rain grime fades out downwards and at both sides, so the
  // decal reads as a run off the sill rather than a grey panel
  // `crop`: [x0, y0, x1, y1] of the photo, 0..1 (the drain grate's concrete
  // surround is cut off; the gutter around it is the road's own)
  const photo = async (k, id, flip, streak, crop) => {
    try {
      const buf = await fetchAsset(`assets/mat/${id}_d${sfx}.webp`);
      const img = await createImageBitmap(new Blob([buf], { type: 'image/webp' }));
      const x = (k % N) * S, y = Math.floor(k / N) * S;
      g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
      g.translate(x + (flip ? S : 0), y); if (flip) g.scale(-1, 1);
      g.clearRect(0, 0, S, S);
      if (crop) {
        const w = img.width, h = img.height;
        g.drawImage(img, crop[0] * w, crop[1] * h, (crop[2] - crop[0]) * w, (crop[3] - crop[1]) * h, 0, 0, S, S);
      } else g.drawImage(img, 0, 0, S, S);
      if (streak === 'patch') {
        // a repair whose edge is worn into the road, not a dark square
        g.globalCompositeOperation = 'destination-in';
        const r = g.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.5);
        r.addColorStop(0, 'rgba(0,0,0,0.9)'); r.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = r; g.fillRect(0, 0, S, S);
      } else if (streak) {
        g.globalCompositeOperation = 'destination-in';
        const v = g.createLinearGradient(0, 0, 0, S);
        v.addColorStop(0, 'rgba(0,0,0,0.95)'); v.addColorStop(0.35, 'rgba(0,0,0,0.6)'); v.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = v; g.fillRect(0, 0, S, S);
        const h = g.createLinearGradient(0, 0, S, 0);
        h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.18, 'rgba(0,0,0,1)'); h.addColorStop(0.82, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = h; g.fillRect(0, 0, S, S);
      }
      g.restore();
      tex.needsUpdate = true;
    } catch (e) { console.warn('decal not loaded', id, e.message); }
  };
  tex.ready = Promise.all([
    photo(DECAL.grime, 'Leaking003', false, true), photo(DECAL.grimeB, 'Leaking003', true, true), photo(DECAL.patch, 'Asphalt013', false, 'patch'),
    photo(DECAL.manhole, 'ManholeCover003'), photo(DECAL.manholeRect, 'ManholeCover007'), photo(DECAL.grate, 'Grate001', false, false, [0.275, 0.3, 0.75, 0.72]),
  ]);
  return tex;
}
