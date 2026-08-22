/* Visual feedback: debris particles, splat marks, floating score popups,
   screen shake and full-screen colour flashes.

   Splats are lightweight objects with a pre-generated outline: they hold at
   full strength for a few seconds, then fade out and are recycled, so marks
   never pile up forever on the wood. */
(function (global) {
  'use strict';
  const { TAU, rand, clamp, lerp } = global.U;

  const SPLAT_HOLD = 7.5;    // seconds at full opacity
  const SPLAT_FADE = 3.0;    // seconds fading out  (~10.5s on screen)
  const SPLAT_MAX = 90;      // oldest marks are dropped past this
  const CORPSE_HOLD = 7.5;
  const CORPSE_FADE = 3.0;
  const CORPSE_MAX = 80;
  const SPLAT_VARIANTS = 5;
  const splatCache = new Map();

  /* One baked splat: ragged blob, thrown droplets and tapering streaks. */
  function makeSplatSprite(color, radius, dpr) {
    const S = Math.ceil(radius * 7);
    const c = document.createElement('canvas');
    c.width = Math.ceil(S * dpr);
    c.height = Math.ceil(S * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(S / 2, S / 2);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineCap = 'round';

    // Ragged main blob
    g.globalAlpha = 0.5;
    g.beginPath();
    const n = 13;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const r = radius * rand(0.5, 1.25);
      const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.85;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();

    // Streaks flung out from the impact
    g.globalAlpha = 0.4;
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU);
      const len = rand(radius * 1.3, radius * 3.1);
      g.lineWidth = rand(1.6, 4.2);
      g.beginPath();
      g.moveTo(Math.cos(a) * radius * 0.4, Math.sin(a) * radius * 0.4);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      g.stroke();
    }

    // Droplets thrown well outside the blob
    g.globalAlpha = 0.35;
    for (let i = 0; i < 16; i++) {
      const a = rand(0, TAU), d = rand(radius * 0.9, radius * 3.2);
      g.beginPath();
      g.ellipse(Math.cos(a) * d, Math.sin(a) * d, rand(0.9, 3.6), rand(0.9, 3.2), 0, 0, TAU);
      g.fill();
    }

    return { canvas: c, size: S };
  }

  class Effects {
    constructor() {
      this.dpr = 1;
      this.particles = [];
      this.popups = [];
      this.splats = [];
      this.corpses = [];
      this.shake = 0;
      this.flash = null;
    }

    reset() {
      this.particles.length = 0;
      this.popups.length = 0;
      this.splats.length = 0;
      this.corpses.length = 0;
      this.shake = 0;
      this.flash = null;
    }

    /* A flattened body left behind after the squash. Pre-rendered by
       Insects.renderCorpse, so drawing one is a single blit. */
    corpse(sprite, x, y, rot) {
      this.corpses.push({
        sprite: sprite.canvas, w: sprite.w, h: sprite.h,
        x, y, rot, flip: Math.random() < 0.5 ? -1 : 1, age: 0
      });
      if (this.corpses.length > CORPSE_MAX) this.corpses.shift();
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
    /* Splat marks are baked into cached sprites - a few random variants per
       colour and size - because re-pathing a ragged blob plus droplets plus
       streaks every frame for dozens of marks is what actually costs time.
       Rotation and mirroring at blit time keep them from looking repeated. */
    _splatSprite(color, bucket) {
      const key = color + '|' + bucket + '|' + this.dpr;
      let variants = splatCache.get(key);
      if (!variants) { variants = []; splatCache.set(key, variants); }
      if (variants.length < SPLAT_VARIANTS) {
        variants.push(makeSplatSprite(color, bucket, this.dpr));
      }
      return variants[Math.floor(Math.random() * variants.length)];
    }

    splat(x, y, radius, color) {
      const bucket = Math.max(6, Math.round(radius / 4) * 4);
      const sprite = this._splatSprite(color || '#2c1c10', bucket);
      this.splats.push({
        sprite: sprite.canvas, size: sprite.size,
        x, y, rot: rand(0, TAU), flip: Math.random() < 0.5 ? -1 : 1, age: 0
      });
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

      for (let i = this.corpses.length - 1; i >= 0; i--) {
        const c = this.corpses[i];
        c.age += dt;
        if (c.age >= CORPSE_HOLD + CORPSE_FADE) this.corpses.splice(i, 1);
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
        g.globalAlpha = fade;
        g.translate(s.x, s.y);
        g.rotate(s.rot);
        if (s.flip < 0) g.scale(-1, 1);
        g.drawImage(s.sprite, -s.size / 2, -s.size / 2, s.size, s.size);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    drawCorpses(g) {
      for (let i = 0; i < this.corpses.length; i++) {
        const c = this.corpses[i];
        const fade = 1 - clamp((c.age - CORPSE_HOLD) / CORPSE_FADE, 0, 1);
        if (fade <= 0) continue;
        g.save();
        g.globalAlpha = fade;
        g.translate(c.x, c.y);
        g.rotate(c.rot);
        if (c.flip < 0) g.scale(-1, 1);
        g.drawImage(c.sprite, -c.w / 2, -c.h / 2, c.w, c.h);
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
