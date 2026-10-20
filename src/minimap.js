import { TOUCH_ONLY } from './input.js';

// Minimap and compass bar.
//
// The map is drawn once from the collision boxes (every wall, building and
// parked car the player can bump into) plus the town's streets, at 2 px per
// metre (1 on phones), as two layers: ground level and the station basement.
// Each frame a rotated crop of the right layer is drawn round the player, so
// the view direction is always up. On top: the objective (clamped to the rim
// with an arrow when it is off the map), soldiers who have just fired, and a
// north mark on the rim.
//
// The compass bar shows 120 degrees around the heading with the objective and
// recent gunfire marked on it.

const RANGE = 55;           // metres from the centre to the edge of the map

export class Minimap {
  constructor(game, mapCanvas, compassCanvas) {
    this.game = game;
    this.map = mapCanvas;
    this.comp = compassCanvas;
    this.layers = null;
    this.t = 0;
    // last draw, for tools/presenttest.js
    this.last = { objective: null, onRim: false, enemies: 0, heading: 0 };
  }

  build() {
    const g = this.game;
    const all = g.grid ? g.grid.all : [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const c of all) {
      if (c.maxX - c.minX > 400 || c.maxZ - c.minZ > 400) continue;
      x0 = Math.min(x0, c.minX); z0 = Math.min(z0, c.minZ); x1 = Math.max(x1, c.maxX); z1 = Math.max(z1, c.maxZ);
    }
    if (!isFinite(x0)) { x0 = z0 = -100; x1 = z1 = 100; }
    x0 -= 60; z0 -= 60; x1 += 60; z1 += 60;
    const s = TOUCH_ONLY ? 1 : 2;
    const W = Math.ceil((x1 - x0) * s), H = Math.ceil((z1 - z0) * s);
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const ground = mk(), base = mk();
    const gx = ground.getContext('2d'), bx = base.getContext('2d');
    const T = g.town;
    if (T && T.streets) {
      gx.fillStyle = 'rgba(120,140,155,0.30)';
      for (const st of T.streets) {
        const w = st.road + st.pave * 2;
        if (st.axis === 'z') gx.fillRect((st.at - w / 2 - x0) * s, (st.from - z0) * s, w * s, (st.to - st.from) * s);
        else gx.fillRect((st.from - x0) * s, (st.at - w / 2 - z0) * s, (st.to - st.from) * s, w * s);
      }
    }
    for (const c of all) {
      const bottom = c.bottom === undefined ? 0 : c.bottom;
      if (c.top - bottom < 0.9) continue;
      if (c.maxX - c.minX > 400 || c.maxZ - c.minZ > 400) continue;
      const tall = c.top - bottom > 2.2;
      const rect = (ctx) => {
        ctx.fillStyle = tall ? 'rgba(178,198,214,0.62)' : 'rgba(150,168,182,0.42)';
        ctx.fillRect((c.minX - x0) * s, (c.minZ - z0) * s, Math.max(1, (c.maxX - c.minX) * s), Math.max(1, (c.maxZ - c.minZ) * s));
      };
      if (c.top > -0.5) rect(gx);
      if (bottom < -1.0) rect(bx);
    }
    this.layers = { ground, base, x0, z0, s };
  }

  // World point to map pixels, rotated so the view is up.
  _toMap(dx, dz, yaw, k) {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    return [(dx * c - dz * sn) * k, (dx * sn + dz * c) * k];
  }

  update(dt) {
    this.t += dt;
    if (this.t < 1 / 30) return;
    this.t = 0;
    if (!this.layers) this.build();
    const g = this.game, p = g.player.state;
    const yaw = p.yaw;
    const L = this.layers;
    const obj = g.campaign && g.mode === 'campaign' ? g.campaign.markerPos() : null;
    const marks = g.fireMarks || [];
    const now = g.elapsed;

    // ---- map ----
    const cv = this.map, ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, R = W / 2;
    const k = R / RANGE;                       // px per metre on screen
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(8,14,20,0.62)'; ctx.fillRect(0, 0, W, H);
    ctx.translate(R, R);
    ctx.rotate(yaw);
    const img = p.y < -1.5 ? L.base : L.ground;
    const f = k / L.s;
    ctx.drawImage(img, (L.x0 - p.x) * k, (L.z0 - p.z) * k, img.width * f, img.height * f);
    ctx.restore();

    // rim and north
    ctx.strokeStyle = 'rgba(127,233,196,0.45)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.stroke();
    const [nx, ny] = this._toMap(0, -1, yaw, 1);
    ctx.fillStyle = '#dfe9f2'; ctx.font = `bold ${Math.round(W / 14)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', R + nx * (R - 9), R + ny * (R - 9));

    // gunfire from soldiers in the last 2.5 s
    let enemies = 0;
    for (const m of marks) {
      const age = now - m.t;
      if (age > 2.5) continue;
      const [mx, my] = this._toMap(m.x - p.x, m.z - p.z, yaw, k);
      if (Math.hypot(mx, my) > R - 4) continue;
      enemies++;
      ctx.fillStyle = `rgba(255,77,61,${(1 - age / 2.5).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(R + mx, R + my, Math.max(2.5, W / 45), 0, Math.PI * 2); ctx.fill();
    }

    // objective
    let onRim = false;
    if (obj) {
      let [ox, oy] = this._toMap(obj.x - p.x, obj.z - p.z, yaw, k);
      const d = Math.hypot(ox, oy), lim = R - 8;
      if (d > lim) { ox *= lim / d; oy *= lim / d; onRim = true; }
      ctx.save();
      ctx.translate(R + ox, R + oy);
      ctx.fillStyle = '#ffb547';
      if (onRim) {
        ctx.rotate(Math.atan2(oy, ox) + Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
      } else {
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4, -4, 8, 8);
      }
      ctx.restore();
    }

    // the player
    ctx.fillStyle = '#7fe9c4';
    ctx.beginPath(); ctx.moveTo(R, R - 7); ctx.lineTo(R + 5, R + 5); ctx.lineTo(R, R + 2); ctx.lineTo(R - 5, R + 5); ctx.closePath(); ctx.fill();

    // ---- compass ----
    const heading = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const cc = this.comp, c2 = cc.getContext('2d');
    const CW = cc.width, CH = cc.height, ppd = CW / 120;
    c2.clearRect(0, 0, CW, CH);
    c2.fillStyle = 'rgba(8,14,20,0.45)'; c2.fillRect(0, 0, CW, CH);
    c2.textAlign = 'center'; c2.textBaseline = 'middle';
    const NAMES = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    const start = Math.floor((heading - 60) / 5) * 5;
    for (let a = start; a <= heading + 60; a += 5) {
      const x = CW / 2 + (a - heading) * ppd;
      const na = ((a % 360) + 360) % 360;
      if (NAMES[na] !== undefined) {
        c2.fillStyle = na === 0 ? '#7fe9c4' : '#dfe9f2';
        c2.font = `bold ${Math.round(CH * 0.42)}px system-ui, sans-serif`;
        c2.fillText(NAMES[na], x, CH * 0.58);
      } else {
        c2.fillStyle = 'rgba(223,233,242,0.5)';
        c2.fillRect(x - 0.5, CH * (na % 15 === 0 ? 0.55 : 0.68), 1, CH * 0.3);
      }
    }
    const bearingTo = (x, z) => ((Math.atan2(x - p.x, -(z - p.z)) * 180 / Math.PI) + 360) % 360;
    const rel = (b) => { let d = b - heading; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
    for (const m of marks) {
      const age = now - m.t;
      if (age > 2.5) continue;
      const d = Math.max(-58, Math.min(58, rel(bearingTo(m.x, m.z))));
      c2.fillStyle = `rgba(255,77,61,${(1 - age / 2.5).toFixed(2)})`;
      c2.fillRect(CW / 2 + d * ppd - 2, 1, 4, CH * 0.28);
    }
    if (obj) {
      const d = Math.max(-58, Math.min(58, rel(bearingTo(obj.x, obj.z))));
      const x = CW / 2 + d * ppd;
      c2.fillStyle = '#ffb547';
      c2.beginPath(); c2.moveTo(x, CH * 0.34); c2.lineTo(x - 5, 1); c2.lineTo(x + 5, 1); c2.closePath(); c2.fill();
    }
    c2.fillStyle = '#7fe9c4'; c2.fillRect(CW / 2 - 1, CH - 5, 2, 5);

    this.last = { objective: obj ? { x: obj.x, z: obj.z } : null, onRim, enemies, heading: Math.round(heading) };
  }
}
