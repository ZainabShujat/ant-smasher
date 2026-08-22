/* Insect entity system.
   Types live in a registry so new bugs can be added without touching the
   simulation. Every insect carries: position, velocity, speed, heading,
   scale, rotation, type, hitbox, animation state and spawn time.

   CRITICAL RULE: `target: true` means "smash it for points".
   `target: false` means the player must NOT smash it (wasp). */
(function (global) {
  'use strict';
  const { TAU, clamp, lerp, rand, angleTowards, smoothNoise } = global.U;

  const TYPES = {
    ant: {
      id: 'ant', label: 'ANT', shape: 'ant',
      target: true, points: 1, hp: 1,
      size: [32, 44], speed: [55, 88],
      wander: 1.0, sway: 0,
      splat: '#3a2411',
      colors: { body: '#17110d', shine: '#5c4a3c', limb: '#2a1a10', accent: '#7a3f14' }
    },
    fastAnt: {
      id: 'fastAnt', label: 'FAST ANT', shape: 'ant',
      target: true, points: 2, hp: 1,
      size: [26, 34], speed: [128, 172],
      wander: 1.6, sway: 0.6,
      splat: '#8a3c0e',
      colors: { body: '#8a2f0c', shine: '#e08a45', limb: '#5a1d06', accent: '#d96a1c' }
    },
    bigAnt: {
      id: 'bigAnt', label: 'SOLDIER ANT', shape: 'ant',
      target: true, points: 3, hp: 2,
      size: [62, 80], speed: [34, 52],
      wander: 0.6, sway: 0,
      splat: '#241708',
      colors: { body: '#120c08', shine: '#6b5646', limb: '#1d1108', accent: '#5c2a0c' }
    },
    beetle: {
      id: 'beetle', label: 'BEETLE', shape: 'beetle',
      target: true, points: 3, hp: 2,
      size: [40, 54], speed: [46, 72],
      wander: 0.8, sway: 0.2,
      splat: '#1e3a1c',
      colors: { body: '#16301b', shine: '#7fc07a', limb: '#0f1d10', accent: '#3f7a35' }
    },
    housefly: {
      id: 'housefly', label: 'HOUSEFLY', shape: 'fly',
      target: true, points: 2, hp: 1,
      size: [34, 44], speed: [95, 140],
      wander: 1.6, sway: 0, flight: true,
      splat: '#4a3a1e',
      colors: { body: '#2b2b30', shine: '#8d8d96', limb: '#17171a', accent: '#55555e' }
    },
    mosquito: {
      id: 'mosquito', label: 'MOSQUITO', shape: 'mosquito',
      target: true, points: 3, hp: 1,
      size: [26, 34], speed: [130, 180],
      wander: 2.2, sway: 0, flight: true,
      splat: '#7a1420',
      colors: { body: '#3b3026', shine: '#9b8b76', limb: '#241d16', accent: '#6b5540' }
    },
    cockroach: {
      id: 'cockroach', label: 'COCKROACH', shape: 'roach',
      target: true, points: 4, hp: 2,
      size: [52, 66], speed: [95, 135],
      wander: 1.1, sway: 0,
      burst: { on: [0.35, 0.7], off: [0.4, 1.1], mult: 2.3 },
      splat: '#5a3a12',
      colors: { body: '#5b3410', shine: '#c98f43', limb: '#3a1f08', accent: '#8a5417' }
    },
    spider: {
      id: 'spider', label: 'SPIDER', shape: 'spider',
      target: true, points: 6, hp: 3,
      size: [54, 68], speed: [58, 88],
      wander: 1.3, sway: 0,
      burst: { on: [0.25, 0.5], off: [0.5, 1.4], mult: 3.1 },
      splat: '#2a1030',
      colors: { body: '#1a1218', shine: '#6b5a68', limb: '#120c10', accent: '#5a2038' }
    },
    wasp: {
      // NOT a target. Smashing this costs a life.
      // Deliberately the biggest thing on screen (~1.9x a normal ant), with a
      // spread-wing silhouette, hazard stripes and erratic darting flight, so
      // it can never be mistaken for an ant on a small display.
      id: 'wasp', label: 'WASP', shape: 'wasp',
      target: false, points: 0, hp: 1,
      // 66-84 against a nominal 38px ant = 1.7x - 2.2x.
      size: [66, 84], speed: [120, 168],
      wander: 2.0, sway: 0, flight: true,
      splat: '#a8861c',
      colors: { body: '#1a1408', shine: '#6a5a2a', limb: '#241a08', accent: '#f5c81a' }
    }
  };

  /* Spawn weights ramp with difficulty, so the early game is mostly plain
     ants and the late game turns chaotic. */
  function weightsFor(d) {
    return {
      ant: 10,
      fastAnt: d > 1.0 ? 1.5 + d * 0.9 : 0,
      housefly: d > 1.5 ? 1.2 + d * 0.7 : 0,
      bigAnt: d > 1.8 ? 1.0 + d * 0.7 : 0,
      mosquito: d > 2.2 ? 1.0 + d * 0.8 : 0,
      beetle: d > 3.0 ? 0.8 + d * 0.6 : 0,
      cockroach: d > 3.6 ? 0.8 + d * 0.55 : 0,
      spider: d > 4.5 ? 0.6 + d * 0.5 : 0,
      wasp: d > 0.8 ? 1.2 + d * 1.0 : 0
    };
  }

  function pickType(d) {
    const w = weightsFor(d);
    let total = 0;
    for (const k in w) total += w[k];
    let r = Math.random() * total;
    for (const k in w) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 'ant';
  }

  let nextId = 1;

  class Insect {
    constructor(typeId, x, y, difficulty) {
      const t = TYPES[typeId];
      this.id = nextId++;
      this.type = typeId;
      this.def = t;
      this.isTarget = t.target;

      this.x = x;
      this.y = y;

      this.size = rand(t.size[0], t.size[1]);            // body length px
      this.scale = 1;                                     // squash/stretch
      this.scaleX = 1;
      this.scaleY = 1;
      this.alpha = 1;

      this.speed = rand(t.speed[0], t.speed[1]) * (1 + 0.05 * difficulty);
      this.heading = Math.PI / 2 + rand(-0.45, 0.45);     // mostly downward
      this.targetHeading = this.heading;
      this.rotation = this.heading;
      this.vx = 0;
      this.vy = 0;

      this.hp = t.hp;
      this.maxHp = t.hp;
      this.points = t.points;
      // The wasp is big, so its hitbox is a tight circle over the body core:
      // taps near it (aimed at an ant) must not register as a wasp hit.
      this.hitRadius = this.size * (t.shape === 'wasp' ? 0.26 : 0.42);
      this.wanderSeed = rand(0, 1000);
      this.wanderRate = rand(0.6, 1.5) * t.wander;
      this.swayPhase = rand(0, TAU);
      this.turnTimer = rand(0.4, 1.6);
      this.walkPhase = rand(0, TAU);

      // Scuttle state (roach, spider): dash, freeze, dash again.
      this.burstOn = false;
      this.burstTimer = rand(0.2, 0.8);

      // Flight state (wasp, fly, mosquito): darts, hovers and sudden reversals.
      this.flightMode = 'cruise';
      this.modeTimer = rand(0.15, 0.4);
      this.tvx = 0;
      this.tvy = this.speed * 0.6;
      this.accel = 10;
      this.flash = 0;                                     // white hit flash
      this.state = 'alive';                               // alive | dying | angry | dead
      this.stateTime = 0;
      this.spawnTime = performance.now();
      this.dead = false;
    }

    get alive() { return this.state === 'alive'; }

    update(dt, world) {
      this.stateTime += dt;
      this.flash = Math.max(0, this.flash - dt * 6);

      if (this.state === 'dying') {
        // Fast squash: compress + flatten + fade, all inside ~300ms.
        const d = clamp(this.stateTime / 0.20, 0, 1);
        const pop = Math.sin(Math.min(d, 1) * Math.PI) * 0.35;
        this.scaleY = lerp(1, 0.18, d);
        this.scaleX = lerp(1, 1.55, d) + pop * 0.1;
        this.alpha = 1 - clamp((d - 0.6) / 0.4, 0, 1);
        if (this.stateTime > 0.30) { this.state = 'dead'; this.dead = true; }
        return;
      }

      if (this.state === 'angry') {
        // Wasp reaction: it rears up, spins and rockets off the screen.
        const d = this.stateTime;
        this.rotation += dt * 16;
        this.scale = 1 + Math.sin(clamp(d / 0.18, 0, 1) * Math.PI) * 0.45;
        this.speed = lerp(this.speed, 900, clamp(d * 1.6, 0, 1));
        this.x += Math.cos(this.escapeAngle) * this.speed * dt;
        this.y += Math.sin(this.escapeAngle) * this.speed * dt;
        this.alpha = 1 - clamp((d - 0.35) / 0.35, 0, 1);
        if (d > 0.7) { this.state = 'dead'; this.dead = true; }
        return;
      }

      if (this.def.flight) { this.flyUpdate(dt, world); return; }

      // --- Wandering: smooth noise nudges the heading, plus occasional
      // deliberate direction changes, so no two bugs trace the same path.
      this.turnTimer -= dt;
      if (this.turnTimer <= 0) {
        this.turnTimer = rand(0.5, 2.0) / this.def.wander;
        this.targetHeading = Math.PI / 2 + rand(-0.85, 0.85) * this.def.wander;
      }
      const n = (smoothNoise(this.stateTime * this.wanderRate, this.wanderSeed) - 0.5) * 1.6;
      const want = this.targetHeading + n * 0.55;
      this.heading = angleTowards(this.heading, want, dt * 3.2 * this.def.wander);

      // Keep them inside the play area: steer away from side walls.
      const margin = 26;
      if (this.x < world.left + margin) this.heading = angleTowards(this.heading, 0.6, dt * 6);
      if (this.x > world.right - margin) this.heading = angleTowards(this.heading, Math.PI - 0.6, dt * 6);

      // Scuttlers dash in bursts and freeze between them.
      let burst = 1;
      if (this.def.burst) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0) {
          this.burstOn = !this.burstOn;
          const range = this.burstOn ? this.def.burst.on : this.def.burst.off;
          this.burstTimer = rand(range[0], range[1]);
        }
        burst = this.burstOn ? this.def.burst.mult : 0.12;
      }

      // Slight speed pulsing gives the crawl an organic stop-start feel.
      const pulse = 0.82 + 0.32 * (0.5 + 0.5 * Math.sin(this.stateTime * 6 + this.wanderSeed));
      const sp = this.speed * pulse * burst;
      this.vx = Math.cos(this.heading) * sp;
      this.vy = Math.sin(this.heading) * sp;

      // Fliers weave sideways on top of their heading.
      if (this.def.sway) {
        this.swayPhase += dt * 4.5;
        this.vx += Math.cos(this.heading + Math.PI / 2) * Math.sin(this.swayPhase) * sp * this.def.sway * 0.5;
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      this.rotation = Math.atan2(this.vy, this.vx) + Math.PI / 2; // sprite is drawn nose-up
      this.walkPhase += dt * (6 + sp * 0.09);
    }

    /* Erratic flight, used by the wasp. It cycles between fast darts in
       near-arbitrary directions, twitchy hovers and short cruises, with
       per-frame jitter on top. Nothing about it reads like an ant crawl. */
    flyUpdate(dt, world) {
      const age = this.stateTime;
      this.modeTimer -= dt;

      if (this.modeTimer <= 0) {
        const roll = Math.random();
        // The longer it has been around, the more it commits to leaving.
        const leaving = age > 7;
        if (leaving) {
          this.flightMode = 'dart';
          this.modeTimer = rand(0.5, 0.9);
          const a = Math.PI / 2 + rand(-0.5, 0.5);
          const sp = this.speed * rand(1.4, 2.0);
          this.tvx = Math.cos(a) * sp;
          this.tvy = Math.sin(a) * sp;
          this.accel = 9;
        } else if (roll < 0.58) {
          // Dart: any direction at all, biased just enough downward that it
          // still works its way across the board.
          this.flightMode = 'dart';
          this.modeTimer = rand(0.16, 0.42);
          const a = Math.random() < 0.3 ? rand(-Math.PI, Math.PI) : Math.PI / 2 + rand(-2.2, 2.2);
          const sp = this.speed * rand(1.3, 2.1);
          this.tvx = Math.cos(a) * sp;
          this.tvy = Math.sin(a) * sp;
          this.accel = 16;
        } else if (roll < 0.85) {
          // Hover: hangs in place, twitching.
          this.flightMode = 'hover';
          this.modeTimer = rand(0.22, 0.6);
          const a = rand(-Math.PI, Math.PI);
          this.tvx = Math.cos(a) * this.speed * 0.18;
          this.tvy = Math.sin(a) * this.speed * 0.18;
          this.accel = 11;
        } else {
          // Cruise: a brief, almost readable glide.
          this.flightMode = 'cruise';
          this.modeTimer = rand(0.3, 0.7);
          const a = Math.PI / 2 + rand(-1.1, 1.1);
          this.tvx = Math.cos(a) * this.speed * 0.75;
          this.tvy = Math.sin(a) * this.speed * 0.75;
          this.accel = 7;
        }
      }

      // Steer toward the target velocity, then add high-frequency jitter.
      const k = Math.min(1, dt * this.accel);
      this.vx += (this.tvx - this.vx) * k;
      this.vy += (this.tvy - this.vy) * k;

      const jitter = this.speed * (this.flightMode === 'hover' ? 2.6 : 1.6);
      this.vx += rand(-1, 1) * jitter * dt;
      this.vy += rand(-1, 1) * jitter * dt;

      // Buzzing wobble perpendicular to travel.
      this.swayPhase += dt * 22;
      const perp = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      const wob = Math.sin(this.swayPhase) * this.speed * 0.22;

      // Push back inside the play area rather than clinging to the edges.
      const m = 44;
      if (this.x < world.left + m) this.vx += (world.left + m - this.x) * 6 * dt;
      if (this.x > world.right - m) this.vx -= (this.x - (world.right - m)) * 6 * dt;
      if (this.y < world.top + m && age < 7) this.vy += (world.top + m - this.y) * 6 * dt;

      this.x += (this.vx + Math.cos(perp) * wob) * dt;
      this.y += (this.vy + Math.sin(perp) * wob) * dt;

      // Face travel, but smoothed so the sprite does not strobe.
      const want = Math.atan2(this.vy, this.vx) + Math.PI / 2;
      this.rotation = angleTowards(this.rotation, want, dt * 14);
      this.walkPhase += dt * 26;   // fast wingbeat
    }

    hitTest(px, py, forgiveness) {
      const r = this.hitRadius + (forgiveness || 0);
      const dx = px - this.x, dy = py - this.y;
      return dx * dx + dy * dy <= r * r;
    }

    kill() {
      if (this.state !== 'alive') return false;
      this.state = 'dying';
      this.stateTime = 0;
      this.alpha = 1;
      return true;
    }

    enrage() {
      if (this.state !== 'alive') return false;
      this.state = 'angry';
      this.stateTime = 0;
      this.escapeAngle = rand(-Math.PI * 0.85, -Math.PI * 0.15); // upward-ish
      return true;
    }

    draw(g) {
      g.save();
      g.translate(this.x, this.y);
      g.rotate(this.rotation);
      g.scale(this.scaleX * this.scale, this.scaleY * this.scale);
      g.globalAlpha = this.alpha;

      drawShape(g, this.def.shape, this.size, this.walkPhase, this.def.colors);

      // Damage flash for multi-hit bugs.
      if (this.flash > 0) {
        g.globalAlpha = this.flash * 0.5;
        g.fillStyle = '#fff';
        g.beginPath();
        g.ellipse(0, 0, this.size * 0.34, this.size * 0.46, 0, 0, TAU);
        g.fill();
      }

      g.restore();
      g.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------------------- shapes
     All bugs are authored nose-up (facing -y) at a reference length of 46px. */

  function shadow(g, rx, ry) {
    g.save();
    g.globalAlpha *= 0.28;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(2.5, 3.5, rx, ry, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  /* Body gradients are identical every frame (they live in the sprite's own
     local space), so they are built once and reused - that removes three
     gradient allocations per insect per frame on phones. */
  function segment(g, cx, cy, rx, ry, fill, shine) {
    const cache = g.__gradCache || (g.__gradCache = new Map());
    const key = cx + ',' + cy + ',' + rx + ',' + ry + ',' + fill + ',' + shine;
    let grad = cache.get(key);
    if (!grad) {
      grad = g.createRadialGradient(cx - rx * 0.35, cy - ry * 0.4, ry * 0.1, cx, cy, ry * 1.25);
      grad.addColorStop(0, shine);
      grad.addColorStop(0.35, fill);
      grad.addColorStop(1, '#000');
      cache.set(key, grad);
    }
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    g.fill();
  }

  function legs(g, phase, color, rows) {
    g.strokeStyle = color;
    g.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) {
      rows.forEach((leg, i) => {
        const sw = Math.sin(phase + i * 2.1 + (side > 0 ? Math.PI : 0)) * 0.28;
        const a = leg.base + sw;
        const kx = side * Math.cos(a) * leg.len * 0.55;
        const ky = leg.y + Math.sin(a) * leg.len * 0.35;
        const ex = side * Math.cos(a - 0.5) * leg.len * leg.spread;
        const ey = leg.y + Math.sin(a - 0.5) * leg.len * 0.9 + 4;
        g.lineWidth = 2.1;
        g.beginPath();
        g.moveTo(side * 2, leg.y);
        g.quadraticCurveTo(kx, ky - 6, ex, ey);
        g.stroke();
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(ex, ey);
        g.lineTo(ex + side * 3, ey + 4);
        g.stroke();
      });
    }
  }

  function antennae(g, phase, color, y0, len) {
    g.strokeStyle = color;
    g.lineWidth = 1.6;
    for (let side = -1; side <= 1; side += 2) {
      const sw = Math.sin(phase * 1.6 + side) * 0.16;
      g.beginPath();
      g.moveTo(side * 2, y0);
      g.quadraticCurveTo(side * (8 + sw * 6), y0 - len * 0.55, side * (6 + sw * 8), y0 - len);
      g.stroke();
    }
  }

  function drawAnt(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 12, 20);

    legs(g, phase, c.limb, [
      { y: -4, len: 20, spread: 1.15, base: -0.35 },
      { y: 1, len: 22, spread: 1.45, base: 0.15 },
      { y: 6, len: 21, spread: 1.15, base: 0.75 }
    ]);
    antennae(g, phase, c.limb, -13, 17);

    g.strokeStyle = c.limb; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(0, 2); g.lineTo(0, 8); g.stroke();   // petiole

    segment(g, 0, 14, 8.5, 11, c.body, c.shine);   // gaster
    segment(g, 0, 0, 5.6, 7.5, c.accent, c.shine); // thorax
    segment(g, 0, -11, 6.6, 6, c.body, c.shine);   // head

    // Mandibles
    g.strokeStyle = c.accent; g.lineWidth = 1.8;
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.moveTo(side * 3, -15);
      g.quadraticCurveTo(side * 6, -19, side * 2, -21);
      g.stroke();
    }

    eyes(g, 3.4, -12.5);
    gloss(g, -2.6, 10, 2.4, 4.6);
  }

  function drawBeetle(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 14, 18);

    legs(g, phase, c.limb, [
      { y: -6, len: 16, spread: 1.1, base: -0.5 },
      { y: 0, len: 17, spread: 1.35, base: 0.1 },
      { y: 6, len: 16, spread: 1.1, base: 0.8 }
    ]);
    antennae(g, phase, c.limb, -12, 11);

    segment(g, 0, -11, 6.2, 5.2, c.body, c.shine);  // head
    segment(g, 0, -4, 8.4, 5.4, c.accent, c.shine); // pronotum

    // Domed elytra (wing cases) with a central seam
    segment(g, 0, 7, 11.5, 13, c.body, c.shine);
    g.strokeStyle = 'rgba(0,0,0,.75)';
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(0, -5); g.lineTo(0, 19); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 1;
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.moveTo(side * 5, -3);
      g.quadraticCurveTo(side * 8, 8, side * 4, 17);
      g.stroke();
    }

    eyes(g, 3.6, -12);
    gloss(g, -4.5, 2, 3, 6);
  }

  /* The wasp is drawn to be unmistakable at a glance on a phone: hazard glow,
     radiating yellow bristles, four spread wings, a fat banded abdomen and a
     visible stinger. Nothing else in the game has this silhouette. */
  function drawWasp(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 13, 20);

    // Warning aura, pulsing with the wingbeat
    const pulse = 0.5 + 0.5 * Math.sin(phase * 0.5);
    g.save();
    const halo = g.createRadialGradient(0, 4, 6, 0, 4, 30);
    halo.addColorStop(0, 'rgba(255,215,40,' + (0.20 + pulse * 0.12) + ')');
    halo.addColorStop(1, 'rgba(255,190,20,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 4, 30, 0, TAU);
    g.fill();
    g.restore();

    // Spiky yellow bristles radiating from the body
    g.save();
    g.strokeStyle = '#ffd21a';
    g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + phase * 0.05;
      const r0 = 9, r1 = 15 + Math.sin(i * 2.3) * 4;
      g.globalAlpha *= 1;
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, 4 + Math.sin(a) * r0 * 1.25);
      g.lineTo(Math.cos(a) * r1, 4 + Math.sin(a) * r1 * 1.25);
      g.stroke();
    }
    g.restore();

    // Four spread wings, blurred by the beat
    g.save();
    g.globalAlpha *= 0.5;
    for (let side = -1; side <= 1; side += 2) {
      const flap = Math.sin(phase + (side > 0 ? 0.7 : 0)) * 0.22;
      [[16, -4, 15, 6, 0.30], [12, 4, 11, 4.4, 0.75]].forEach((wgt, k) => {
        g.save();
        g.translate(side * 4, -2);
        g.rotate(side * (wgt[4] + flap));
        const wg = g.createLinearGradient(0, 0, side * wgt[2] * 2, 0);
        wg.addColorStop(0, 'rgba(255,255,255,.85)');
        wg.addColorStop(1, 'rgba(200,225,255,.15)');
        g.fillStyle = wg;
        g.beginPath();
        g.ellipse(side * wgt[0], wgt[1], wgt[2], wgt[3], side * 0.2, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,.5)';
        g.lineWidth = 0.8;
        g.stroke();
        g.restore();
      });
    }
    g.restore();

    // Long dangling legs
    legs(g, phase * 0.2, c.limb, [
      { y: -3, len: 17, spread: 1.1, base: 0.1 },
      { y: 2, len: 19, spread: 1.3, base: 0.5 },
      { y: 7, len: 18, spread: 1.1, base: 1.0 }
    ]);
    antennae(g, phase * 0.2, '#12100a', -13, 15);

    // Head: black with big pale eyes and jaws
    segment(g, 0, -12, 6.6, 6.0, '#141008', '#6d6244');
    g.fillStyle = '#f7e08a';
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.ellipse(side * 3.6, -13, 2.3, 3.0, side * 0.25, 0, TAU);
      g.fill();
    }

    // Thorax: yellow with a black collar
    segment(g, 0, -2, 7.0, 6.8, c.accent, '#fff0a8');
    g.fillStyle = '#140f06';
    g.beginPath();
    g.ellipse(0, -6.5, 6.6, 2.0, 0, 0, TAU);
    g.fill();

    // Waist
    g.strokeStyle = '#140f06'; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(0, 3); g.lineTo(0, 6); g.stroke();

    // Fat banded abdomen — the hazard signal that says DO NOT SMASH
    g.save();
    g.beginPath();
    g.ellipse(0, 15, 8.6, 12.5, 0, 0, TAU);
    g.clip();
    const grad = g.createLinearGradient(-8, 0, 8, 0);
    grad.addColorStop(0, '#c79a10');
    grad.addColorStop(0.35, '#ffd41f');
    grad.addColorStop(1, '#a87d08');
    g.fillStyle = grad;
    g.fillRect(-10, 0, 20, 32);
    g.fillStyle = '#100c05';
    for (let i = 0; i < 4; i++) g.fillRect(-10, 3.5 + i * 6.0, 20, 3.4);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,.7)';
    g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(0, 15, 8.6, 12.5, 0, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.beginPath(); g.ellipse(-3.4, 11, 2.2, 4.4, -0.3, 0, TAU); g.fill();

    // Stinger
    g.fillStyle = '#100c05';
    g.beginPath();
    g.moveTo(-2, 26); g.lineTo(2, 26); g.lineTo(0, 33);
    g.closePath();
    g.fill();
  }

  function eyes(g, dx, y) {
    g.fillStyle = 'rgba(255,255,255,.55)';
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.ellipse(side * dx, y, 1.3, 1.6, 0, 0, TAU);
      g.fill();
    }
  }

  function gloss(g, x, y, rx, ry) {
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.beginPath();
    g.ellipse(x, y, rx, ry, -0.3, 0, TAU);
    g.fill();
  }

  global.Insects = { TYPES, Insect, pickType, weightsFor };
})(window);
