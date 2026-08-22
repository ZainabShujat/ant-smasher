/* Visual feedback: debris particles, splat marks, floating score popups,
   screen shake and full-screen colour flashes.

   Splats are lightweight objects with a pre-generated outline: they hold at
   full strength for a few seconds, then fade out and are recycled, so marks
   never pile up forever on the wood. */
(function (global) {
  'use strict';
  const { TAU, rand, clamp, lerp } = global.U;

  const SPLAT_HOLD = 3.2;    // seconds at full opacity
  const SPLAT_FADE = 4.0;    // seconds fading out
  const SPLAT_MAX = 44;      // oldest marks are dropped past this

  class Effects {
    constructor() {
      this.particles = [];
      this.popups = [];
      this.splats = [];
      this.shake = 0;
      this.flash = null;
    }

    reset() {
      this.particles.length = 0;
      this.popups.length = 0;
      this.splats.length = 0;
      this.shake = 0;
      this.flash = null;
    }

    burst(x, y, count, color) {
      for (let i = 0; i < count; i++) {
        const a = rand(0, TAU);
        const sp = rand(40, 220);
        this.particles.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          size: rand(1.2, 3.6),
          life: rand(0.22, 0.5),
          age: 0,
          color: color || '#1b1209'
        });
      }
    }

    /* Colour comes from the insect that died, so each species leaves its own
       stain on the plank. */
    splat(x, y, radius, color) {
      const pts = [];
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * TAU;
        const r = radius * rand(0.55, 1.05);
        pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.85]);
      }
      const drops = [];
      for (let i = 0; i < 6; i++) {
        const a = rand(0, TAU), d = rand(radius * 0.9, radius * 2.1);
        drops.push([Math.cos(a) * d, Math.sin(a) * d, rand(0.8, 2.4), rand(0.8, 2.2)]);
      }
      this.splats.push({ x, y, rot: rand(0, TAU), color: color || '#2c1c10', pts, drops, age: 0 });
      if (this.splats.length > SPLAT_MAX) this.splats.shift();
    }

    popup(x, y, text, color, big) {
      this.popups.push({ x, y, text, color: color || '#ffe9a8', age: 0, life: big ? 1.0 : 0.75, big: !!big });
    }

    kick(amount) { this.shake = Math.min(18, this.shake + amount); }

    screenFlash(color, life) { this.flash = { color, age: 0, life: life || 0.35 }; }

    update(dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.age += dt;
        if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
        p.vy += 520 * dt;
        p.vx *= 0.96;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      for (let i = this.splats.length - 1; i >= 0; i--) {
        const s = this.splats[i];
        s.age += dt;
        if (s.age >= SPLAT_HOLD + SPLAT_FADE) this.splats.splice(i, 1);
      }

      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.age += dt;
        if (p.age >= p.life) this.popups.splice(i, 1);
      }

      this.shake = Math.max(0, this.shake - dt * 55);

      if (this.flash) {
        this.flash.age += dt;
        if (this.flash.age >= this.flash.life) this.flash = null;
      }
    }

    drawSplats(g) {
      for (let i = 0; i < this.splats.length; i++) {
        const s = this.splats[i];
        const fade = 1 - clamp((s.age - SPLAT_HOLD) / SPLAT_FADE, 0, 1);
        if (fade <= 0) continue;
        g.save();
        g.translate(s.x, s.y);
        g.rotate(s.rot);
        g.fillStyle = s.color;

        g.globalAlpha = 0.5 * fade;
        g.beginPath();
        for (let k = 0; k < s.pts.length; k++) {
          const p = s.pts[k];
          if (k === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
        }
        g.closePath();
        g.fill();

        g.globalAlpha = 0.35 * fade;
        for (let k = 0; k < s.drops.length; k++) {
          const d = s.drops[k];
          g.beginPath();
          g.ellipse(d[0], d[1], d[2], d[3], 0, 0, TAU);
          g.fill();
        }
        g.restore();
      }
      g.globalAlpha = 1;
    }

    draw(g) {
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        g.globalAlpha = 1 - p.age / p.life;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;

      for (let i = 0; i < this.popups.length; i++) {
        const p = this.popups[i];
        const t = p.age / p.life;
        const rise = lerp(0, p.big ? -52 : -34, t);
        const scale = t < 0.18 ? lerp(0.6, 1.18, t / 0.18) : lerp(1.18, 1, clamp((t - 0.18) / 0.3, 0, 1));
        g.save();
        g.globalAlpha = 1 - clamp((t - 0.55) / 0.45, 0, 1);
        g.translate(p.x, p.y + rise);
        g.scale(scale, scale);
        g.font = 'bold ' + (p.big ? 30 : 22) + 'px "Trebuchet MS", Verdana, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(35,20,7,.85)';
        g.strokeText(p.text, 0, 0);
        g.fillStyle = p.color;
        g.fillText(p.text, 0, 0);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    drawFlash(g, w, h) {
      if (!this.flash) return;
      const t = this.flash.age / this.flash.life;
      g.save();
      g.globalAlpha = (1 - t) * 0.45;
      g.fillStyle = this.flash.color;
      g.fillRect(0, 0, w, h);
      g.restore();
      g.globalAlpha = 1;
    }
  }

  global.Effects = Effects;
})(window);
