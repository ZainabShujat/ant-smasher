/* Procedural wooden plank texture. Generated once into an offscreen canvas
   and blitted each frame, so the per-frame cost stays trivial. */
(function (global) {
  'use strict';
  const { rand, lerp, clamp, smoothNoise, TAU } = global.U;

  function makePlankTexture(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.floor(w));
    c.height = Math.max(2, Math.floor(h));
    const g = c.getContext('2d');

    // Base tone
    const base = g.createLinearGradient(0, 0, 0, c.height);
    base.addColorStop(0, '#b1793f');
    base.addColorStop(0.45, '#a06d38');
    base.addColorStop(1, '#8d5c2d');
    g.fillStyle = base;
    g.fillRect(0, 0, c.width, c.height);

    // Vertical planks
    const plankW = clamp(c.width / 2.4, 120, 420);
    const seams = [];
    for (let x = plankW * rand(0.5, 0.9); x < c.width; x += plankW * rand(0.85, 1.2)) seams.push(x);

    // Grain: long vertical wavy strokes
    const seed = rand(0, 1000);
    g.save();
    for (let i = 0; i < Math.floor(c.width * 0.9); i++) {
      const x0 = rand(-20, c.width + 20);
      const amp = rand(2, 16);
      const freq = rand(0.002, 0.008);
      const phase = rand(0, TAU);
      const dark = rand(0, 1) < 0.55;
      g.globalAlpha = rand(0.03, 0.13);
      g.strokeStyle = dark ? '#4d2f14' : '#d8a463';
      g.lineWidth = rand(0.6, 2.6);
      g.beginPath();
      for (let y = -10; y <= c.height + 10; y += 12) {
        const n = smoothNoise(y * 0.02 + i, seed) - 0.5;
        const x = x0 + Math.sin(y * freq + phase) * amp + n * 10;
        if (y === -10) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.restore();

    // Knots
    const knotCount = Math.max(1, Math.round((c.width * c.height) / 420000));
    for (let k = 0; k < knotCount; k++) {
      const kx = rand(c.width * 0.1, c.width * 0.9);
      const ky = rand(c.height * 0.08, c.height * 0.92);
      const kr = rand(14, 40);
      g.save();
      g.translate(kx, ky);
      g.scale(1, rand(1.6, 2.6));
      for (let r = kr; r > 1.5; r -= rand(2.2, 4.5)) {
        g.globalAlpha = lerp(0.05, 0.22, 1 - r / kr);
        g.strokeStyle = '#4a2c12';
        g.lineWidth = rand(0.8, 2);
        g.beginPath();
        g.ellipse(0, 0, r, r * 0.8, rand(-0.3, 0.3), 0, TAU);
        g.stroke();
      }
      g.globalAlpha = 0.25;
      g.fillStyle = '#3c2410';
      g.beginPath();
      g.ellipse(0, 0, kr * 0.16, kr * 0.13, 0, 0, TAU);
      g.fill();
      g.restore();
    }

    // Plank seams with soft shadow on one side
    seams.forEach((x) => {
      const grad = g.createLinearGradient(x - 10, 0, x + 10, 0);
      grad.addColorStop(0, 'rgba(60,35,14,0)');
      grad.addColorStop(0.5, 'rgba(50,28,10,0.55)');
      grad.addColorStop(1, 'rgba(60,35,14,0)');
      g.fillStyle = grad;
      g.fillRect(x - 10, 0, 20, c.height);
      g.strokeStyle = 'rgba(35,20,7,0.65)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x, c.height);
      g.stroke();
    });

    // Vignette so the play area reads as a physical surface
    const vig = g.createRadialGradient(
      c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.25,
      c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(30,15,4,0.42)');
    g.fillStyle = vig;
    g.fillRect(0, 0, c.width, c.height);

    return c;
  }

  /* Horizontal wooden strip used behind the HUD. */
  function makeHudTexture(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.floor(w));
    c.height = Math.max(2, Math.floor(h));
    const g = c.getContext('2d');

    const base = g.createLinearGradient(0, 0, 0, c.height);
    base.addColorStop(0, '#e6c489');
    base.addColorStop(0.5, '#d9b174');
    base.addColorStop(1, '#bf9358');
    g.fillStyle = base;
    g.fillRect(0, 0, c.width, c.height);

    const seed = rand(0, 500);
    for (let i = 0; i < Math.floor(c.height * 2.2); i++) {
      const y0 = rand(0, c.height);
      g.globalAlpha = rand(0.04, 0.14);
      g.strokeStyle = Math.random() < 0.6 ? '#8a6330' : '#f4dcae';
      g.lineWidth = rand(0.5, 1.8);
      g.beginPath();
      for (let x = 0; x <= c.width; x += 18) {
        const y = y0 + Math.sin(x * 0.006 + i) * 2 + (smoothNoise(x * 0.03 + i, seed) - 0.5) * 3;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // Bottom edge shadow so the strip looks attached on top of the planks
    const sh = g.createLinearGradient(0, c.height - 8, 0, c.height);
    sh.addColorStop(0, 'rgba(60,35,12,0)');
    sh.addColorStop(1, 'rgba(50,28,9,0.6)');
    g.fillStyle = sh;
    g.fillRect(0, c.height - 8, c.width, 8);

    return c;
  }

  global.Wood = { makePlankTexture, makeHudTexture };
})(window);
