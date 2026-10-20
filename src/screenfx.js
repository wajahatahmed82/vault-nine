import * as settings from './settings.js';

// Screen effects that say what is happening without the HUD:
//
//   suppression  rounds cracking past or hitting cover close by: the edges
//                blur and darken, heavier on the side the fire came from
//   hurt         a red edge pulse when hit (always on)
//   chroma       a short RGB split on each hit
//   low health   colour drains out below 40 health
//   flash        a flashbang whites the screen out, then fades
//
// Each of the four named ones has a setting. With post-processing on they are
// one shader pass (post.js); with it off (phones, LOW) a few CSS layers stand
// in -- vignettes, white-out and a saturate() filter on the canvas, but no blur
// and no RGB split, which need the shader.

export class ScreenFX {
  constructor(canvas) {
    this.canvas = canvas;
    this.supp = 0; this.suppHold = 0;
    this.dir = { x: 0, y: 0 };
    this.hurt = 0; this.chroma = 0;
    this.flash = 0; this.flashHold = 0;
    this.desat = 0;
    this.post = null;
    // what was actually applied last frame, after the settings
    this.out = { supp: 0, hurt: 0, chroma: 0, flash: 0, desat: 0 };
    const layer = document.getElementById('screenfx');
    this.el = layer ? { v: layer.children[0], r: layer.children[1], w: layer.children[2] } : null;
    this._filter = '';
  }

  reset() {
    this.supp = this.suppHold = this.hurt = this.chroma = this.flash = this.flashHold = this.desat = 0;
  }

  // `rel` is where the fire came from, relative to the view (audio.toListener).
  suppress(amount, rel) {
    this.supp = Math.min(1, this.supp + amount);
    this.suppHold = 0.45;
    if (rel) {
      const l = Math.hypot(rel.right, rel.ahead) || 1;
      this.dir.x = rel.right / l; this.dir.y = rel.ahead / l;
    }
  }

  hit(dmg) {
    this.hurt = Math.min(1, this.hurt + 0.35 + dmg / 60);
    this.chroma = 1;
  }

  flashbang(strength) {
    if (strength > this.flash) this.flash = strength;
    this.flashHold = Math.max(this.flashHold, 0.5 + strength * 1.8);
  }

  update(dt, health, maxHealth) {
    if (this.suppHold > 0) this.suppHold -= dt;
    else this.supp = Math.max(0, this.supp - dt * 0.55);
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
    this.chroma = Math.max(0, this.chroma - dt * 3.2);
    if (this.flashHold > 0) this.flashHold -= dt;
    else this.flash = Math.max(0, this.flash - dt * 0.45);
    const h = health / maxHealth;
    this.desat = h < 0.4 ? Math.min(0.85, (0.4 - h) / 0.4 * 0.85 + 0.15) : 0;

    const o = this.out;
    o.supp = settings.get('fxSuppression') ? this.supp : 0;
    o.hurt = this.hurt;
    o.chroma = settings.get('fxChroma') ? this.chroma : 0;
    o.flash = settings.get('fxFlash') ? Math.min(1, this.flash) : 0;
    o.desat = settings.get('fxLowHealth') ? this.desat : 0;

    const P = this.post;
    if (P && P.mode !== 'off') {
      P.setEffects(o, this.dir);
      this._css(0, 0, 0, 0);
    } else {
      if (P) P.setEffects(null);
      this._css(o.supp, o.hurt, o.flash, o.desat);
    }
  }

  _css(supp, hurt, flash, desat) {
    const e = this.el;
    if (!e) return;
    e.v.style.opacity = (supp * 0.85).toFixed(3);
    if (supp > 0.01) {
      // the clear centre slides away from the incoming side
      const cx = 50 - this.dir.x * 14, cy = 50 + this.dir.y * 14;
      e.v.style.background = `radial-gradient(circle at ${cx.toFixed(0)}% ${cy.toFixed(0)}%, rgba(0,0,0,0) 38%, rgba(0,0,0,.88) 100%)`;
    }
    e.r.style.opacity = (hurt * 0.75).toFixed(3);
    e.w.style.opacity = flash.toFixed(3);
    const f = desat > 0.02 ? `saturate(${(1 - desat).toFixed(2)})` : '';
    if (f !== this._filter) { this._filter = f; this.canvas.style.filter = f; }
  }
}
