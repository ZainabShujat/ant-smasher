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
      size: [28, 50], speed: [55, 88],
      wander: 1.0, sway: 0,
      splat: '#3a2411',
      colors: { body: '#17110d', shine: '#5c4a3c', limb: '#2a1a10', accent: '#7a3f14' }
    },
    fastAnt: {
      id: 'fastAnt', label: 'FAST ANT', shape: 'ant',
      target: true, points: 2, hp: 1,
      size: [22, 38], speed: [128, 172],
      wander: 1.6, sway: 0.6,
      splat: '#8a3c0e',
      colors: { body: '#8a2f0c', shine: '#e08a45', limb: '#5a1d06', accent: '#d96a1c' }
    },
    bigAnt: {
      id: 'bigAnt', label: 'SOLDIER ANT', shape: 'ant',
      target: true, points: 3, hp: 2,
      size: [58, 92], speed: [34, 52],
      wander: 0.6, sway: 0,
      splat: '#241708',
      colors: { body: '#120c08', shine: '#6b5646', limb: '#1d1108', accent: '#5c2a0c' }
    },
    beetle: {
      id: 'beetle', label: 'BEETLE', shape: 'beetle',
      target: true, points: 3, hp: 2,
      size: [36, 62], speed: [46, 72],
      wander: 0.8, sway: 0.2,
      splat: '#1e3a1c',
      colors: { body: '#16301b', shine: '#7fc07a', limb: '#0f1d10', accent: '#3f7a35' }
    },
    housefly: {
      id: 'housefly', label: 'HOUSEFLY', shape: 'fly',
      target: true, points: 2, hp: 1,
      size: [30, 50], speed: [95, 140],
      wander: 1.6, sway: 0, flight: true,
      splat: '#4a3a1e',
      colors: { body: '#2b2b30', shine: '#8d8d96', limb: '#17171a', accent: '#55555e' }
    },
    mosquito: {
      id: 'mosquito', label: 'MOSQUITO', shape: 'mosquito',
      target: true, points: 3, hp: 1,
      size: [22, 38], speed: [130, 180],
      wander: 2.2, sway: 0, flight: true,
      splat: '#7a1420',
      colors: { body: '#3b3026', shine: '#9b8b76', limb: '#241d16', accent: '#6b5540' }
    },
    cockroach: {
      id: 'cockroach', label: 'COCKROACH', shape: 'roach',
      target: true, points: 4, hp: 2,
      size: [46, 74], speed: [95, 135],
      wander: 1.1, sway: 0,
      burst: { on: [0.35, 0.7], off: [0.4, 1.1], mult: 2.3 },
      splat: '#5a3a12',
      colors: { body: '#5b3410', shine: '#c98f43', limb: '#3a1f08', accent: '#8a5417' }
    },
    spider: {
      id: 'spider', label: 'SPIDER', shape: 'spider',
      target: true, points: 6, hp: 3,
      size: [48, 78], speed: [58, 88],
      wander: 1.3, sway: 0,
      burst: { on: [0.25, 0.5], off: [0.5, 1.4], mult: 3.1 },
      splat: '#2a1030',
      colors: { body: '#1a1218', shine: '#6b5a68', limb: '#120c10', accent: '#5a2038' }
    },
    goliath: {
      // The big one. Always a target, never more than one on screen, and it
      // takes five hits - a slow siege that the smaller bugs interrupt.
      id: 'goliath', label: 'GOLIATH BEETLE', shape: 'goliath',
      target: true, points: 25, hp: 5, solo: true,
      size: [118, 152], speed: [24, 38],
      wander: 0.45, sway: 0,
      splat: '#3a1e08',
      colors: { body: '#40270a', shine: '#d3a961', limb: '#241505', accent: '#8a5514' }
    },
    lifeBubble: {
      // Not an insect: a floating green bubble worth an extra life. Appears
      // only deep into a run. Letting it drift past costs nothing.
      id: 'lifeBubble', label: '1UP', shape: 'bubble',
      target: true, bonus: 'life', points: 0, hp: 1,
      size: [58, 70], speed: [42, 62],
      wander: 0.5, sway: 0.5, upright: true,
      splat: '#2fbf22',
      colors: { body: '#3fd41f', shine: '#d6ffb0', limb: '#1c7a10', accent: '#7bff4a' }
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
      goliath: d > 2.5 ? 0.7 + d * 0.3 : 0,
      wasp: d > 0.8 ? 1.2 + d * 1.0 : 0
    };
  }

  function pickType(d, config) {
    const w = weightsFor(d);
    if (config && config.insects) {
      // Created species are available from the start - the player asked for
      // them explicitly, so they do not wait for a difficulty ramp.
      Object.keys(config.insects).forEach(function (k) {
        if (!(k in w) && TYPES[k]) w[k] = 7;
      });
      for (const k in w) {
        const c = config.insects[k];
        w[k] = !c || !c.enabled ? 0 : w[k] * c.weight;
      }
    }
    let total = 0;
    for (const k in w) total += w[k];
    if (total <= 0) {
      // Nothing has ramped in yet: fall back to the first enabled target.
      if (!config) return 'ant';
      const first = Object.keys(config.insects).find((k) =>
        config.insects[k].enabled && TYPES[k] && TYPES[k].target);
      return first || null;
    }
    let r = Math.random() * total;
    for (const k in w) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 'ant';
  }

  let nextId = 1;

  class Insect {
    constructor(typeId, x, y, difficulty, config) {
      const t = TYPES[typeId];
      this.id = nextId++;
      this.type = typeId;
      this.def = t;
      this.isTarget = t.target;

      // Per-species overrides from the run config (Classic passes none, so
      // everything falls back to this species' own defaults).
      const cfg = (config && config.insects && config.insects[typeId]) || null;
      const move = cfg && global.Config ? global.Config.MOVEMENT[cfg.movement] : null;
      this.wander = t.wander * (move ? move.wander : 1);
      this.sway = t.sway * (move ? move.sway : 1);

      this.x = x;
      this.y = y;

      this.size = rand(t.size[0], t.size[1]) * (cfg ? cfg.size : 1);   // body length px
      this.scale = 1;                                     // squash/stretch
      this.scaleX = 1;
      this.scaleY = 1;
      this.alpha = 1;

      this.speed = rand(t.speed[0], t.speed[1]) * (1 + 0.05 * difficulty) *
        (cfg ? cfg.speed : 1) * (config ? config.globalSpeed : 1);
      this.heading = Math.PI / 2 + rand(-0.45, 0.45);     // mostly downward
      this.targetHeading = this.heading;
      this.rotation = this.heading;
      this.vx = 0;
      this.vy = 0;

      this.hp = cfg ? cfg.hp : t.hp;
      this.maxHp = this.hp;
      this.points = cfg ? cfg.points : t.points;
      // The wasp is big, so its hitbox is a tight circle over the body core:
      // taps near it (aimed at an ant) must not register as a wasp hit.
      this.hitRadius = this.size * (t.shape === 'wasp' ? 0.26 : 0.42);
      this.wanderSeed = rand(0, 1000);
      this.wanderRate = rand(0.6, 1.5) * this.wander;
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

    /* An oversized individual of an ordinary species: bigger, tougher, slower
       and worth far more. Applied at spawn time, so any species can throw up
       the occasional monster. */
    makeBrute(scale) {
      this.brute = true;
      this.size *= scale;
      this.hitRadius *= scale;
      this.speed *= 0.72;
      this.hp = Math.min(6, this.hp + 2);
      this.maxHp = this.hp;
      this.points = Math.round(this.points * 3.5);
      return this;
    }

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
        this.turnTimer = rand(0.5, 2.0) / Math.max(0.1, this.wander);
        this.targetHeading = Math.PI / 2 + rand(-0.85, 0.85) * this.wander;
      }
      const n = (smoothNoise(this.stateTime * this.wanderRate, this.wanderSeed) - 0.5) * 1.6;
      const want = this.targetHeading + n * 0.55;
      this.heading = angleTowards(this.heading, want, dt * 3.2 * this.wander);

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
      if (this.sway) {
        this.swayPhase += dt * 4.5;
        this.vx += Math.cos(this.heading + Math.PI / 2) * Math.sin(this.swayPhase) * sp * this.sway * 0.5;
      }

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Most bugs face the way they travel; the bubble always stays upright.
      this.rotation = this.def.upright ? 0 : Math.atan2(this.vy, this.vx) + Math.PI / 2;
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
      this.wasSmashed = true;      // earns a corpse on the wood
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

      g.save();
      drawShape(g, this.def.shape, this.size, this.walkPhase, this.def.colors, this.def.blueprint);
      g.restore();   // drawShape leaves its own scale applied

      // Damage: cracks spread across the body as hits land, so a five-hit
      // bug visibly wears down instead of just flashing.
      if (this.maxHp > 1 && this.hp < this.maxHp) {
        const taken = this.maxHp - this.hp;
        const r = this.size * 0.34;
        g.save();
        g.globalAlpha = this.alpha * 0.85;
        g.strokeStyle = 'rgba(255,236,200,.8)';
        g.lineWidth = Math.max(1.2, this.size * 0.035);
        g.lineCap = 'round';
        for (let i = 0; i < taken; i++) {
          const a = (i / this.maxHp) * TAU + i * 1.7;
          const x0 = Math.cos(a) * r * 0.25, y0 = Math.sin(a) * r * 0.25;
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x0 + Math.cos(a + 0.5) * r * 0.55, y0 + Math.sin(a + 0.5) * r * 0.75);
          g.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 1.05);
          g.stroke();
        }
        g.restore();
      }

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

  /* Ant: glossy black, jointed reddish legs, segmented gaster with a hard
     specular highlight and a rim light so it stays readable on the wood. */
  function drawAnt(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 11, 19);

    antLegs(g, phase, c);
    elbowedAntennae(g, phase, c.limb);

    // --- Gaster (abdomen): the big glossy teardrop
    g.save();
    g.translate(0, 14);
    const gasterGrad = g.createRadialGradient(-3.2, -4.5, 1, 0, 1, 13);
    gasterGrad.addColorStop(0, c.shine);
    gasterGrad.addColorStop(0.18, c.body);
    gasterGrad.addColorStop(0.75, '#0b0806');
    gasterGrad.addColorStop(1, '#000');
    g.fillStyle = gasterGrad;
    g.beginPath();
    g.ellipse(0, 0, 8.8, 11.4, 0, 0, TAU);
    g.fill();

    // Segment creases
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 0.9;
    for (let i = 0; i < 3; i++) {
      const y = -3 + i * 4.4;
      const w = 8.4 * Math.cos(Math.asin(clamp(y / 11.4, -1, 1)));
      g.beginPath();
      g.moveTo(-w, y);
      g.quadraticCurveTo(0, y + 2.4, w, y);
      g.stroke();
    }

    // Rim light along the lower right, specular spot upper left
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = 1.3;
    g.beginPath();
    g.ellipse(0, 0, 8.4, 11, 0, -0.5, 2.1);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.62)';
    g.beginPath();
    g.ellipse(-3.4, -5.0, 1.5, 2.7, -0.35, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath();
    g.ellipse(-3.8, -6.2, 0.7, 1.1, -0.35, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.3)';
    g.beginPath();
    g.ellipse(-4.4, 2.4, 1.1, 2.6, -0.25, 0, TAU);
    g.fill();
    g.restore();

    // --- Petiole: the two little nodes joining gaster to thorax
    g.fillStyle = c.accent;
    g.beginPath(); g.ellipse(0, 5.4, 1.9, 2.1, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(0, 2.2, 1.6, 1.8, 0, 0, TAU); g.fill();

    // --- Thorax (alitrunk): two lobes, reddish like the reference ants
    segment(g, 0, -1.5, 4.6, 4.4, c.accent, c.shine);
    segment(g, 0, -5.5, 4.0, 3.6, c.accent, c.shine);
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.beginPath(); g.ellipse(-1.8, -3.6, 1.2, 2.4, -0.4, 0, TAU); g.fill();

    // --- Head: rounded square with mandibles
    g.save();
    g.translate(0, -12);
    const headGrad = g.createRadialGradient(-2.4, -2.6, 0.8, 0, 0, 8);
    headGrad.addColorStop(0, c.shine);
    headGrad.addColorStop(0.22, c.body);
    headGrad.addColorStop(0.85, '#0a0705');
    headGrad.addColorStop(1, '#000');
    g.fillStyle = headGrad;
    g.beginPath();
    g.ellipse(0, 0, 6.4, 5.8, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.beginPath();
    g.ellipse(-2.3, -2.3, 1.2, 1.8, -0.4, 0, TAU);
    g.fill();

    // Compound eyes on the sides of the head
    g.fillStyle = 'rgba(20,15,12,.95)';
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.ellipse(side * 4.6, -0.6, 1.5, 2.0, side * 0.3, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.ellipse(side * 4.4, -1.2, 0.6, 0.8, 0, 0, TAU);
      g.fill();
    }

    // Mandibles: curved pincers meeting at the front
    g.strokeStyle = c.accent;
    g.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) {
      const bite = Math.sin(phase * 0.8) * 0.6;
      g.lineWidth = 2.1;
      g.beginPath();
      g.moveTo(side * 3.6, -4.2);
      g.quadraticCurveTo(side * (6.2 + bite), -7.4, side * (1.8 + bite * 0.5), -9.2);
      g.stroke();
    }
    g.restore();
  }

  /* Three jointed legs per side: thick femur, thin tibia, tiny tarsus. */
  function antLegs(g, phase, c) {
    const rows = [
      { y: -5.5, a: -1.05, f: 10, t: 13 },
      { y: -1.0, a: -0.20, f: 11, t: 15 },
      { y: 3.5, a: 0.55, f: 10, t: 14 }
    ];
    g.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) {
      rows.forEach((leg, i) => {
        const sw = Math.sin(phase + i * 2.1 + (side > 0 ? Math.PI : 0)) * 0.24;
        const a = leg.a + sw;
        const hipX = side * 3.2, hipY = leg.y;
        const kneeX = hipX + side * Math.cos(a) * leg.f;
        const kneeY = hipY + Math.sin(a) * leg.f - 3.5;
        const footA = a + 0.85 + sw * 0.6;
        const footX = kneeX + side * Math.cos(footA) * leg.t * 0.8;
        const footY = kneeY + Math.sin(footA) * leg.t + 3;

        g.strokeStyle = c.accent;
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(hipX, hipY);
        g.lineTo(kneeX, kneeY);
        g.stroke();

        g.strokeStyle = c.limb;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(kneeX, kneeY);
        g.lineTo(footX, footY);
        g.stroke();

        g.lineWidth = 1.0;
        g.beginPath();
        g.moveTo(footX, footY);
        g.lineTo(footX + side * 2.6, footY + 2.6);
        g.stroke();
      });
    }
  }

  /* Elbowed antennae: a long scape, then a bend into the funiculus. */
  function elbowedAntennae(g, phase, color) {
    g.strokeStyle = color;
    g.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) {
      const sw = Math.sin(phase * 1.4 + side * 1.2) * 0.22;
      const elbowX = side * (6.4 + sw * 2);
      const elbowY = -19;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(side * 2.4, -14.5);
      g.lineTo(elbowX, elbowY);
      g.stroke();
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(elbowX, elbowY);
      g.quadraticCurveTo(elbowX + side * 2, elbowY - 5, side * (3.4 + sw * 4), elbowY - 8.5);
      g.stroke();
    }
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

  /* ------------------------------------------------------------- creator
     Player-made species. A blueprint (body, legs, wings, eyes, colour, photo,
     hazard) is registered as a real TYPES entry, so from the engine's point of
     view a created insect is indistinguishable from a built-in one - it
     spawns, crawls, takes hits, squashes, leaves a corpse and a splat. */

  const BODIES = ['ant', 'beetle', 'spider', 'fly', 'roach', 'blob'];
  const WINGS = ['none', 'bee', 'fly'];
  const LEG_COUNTS = [0, 2, 4, 6, 8, 12];
  const EYE_COUNTS = [1, 2, 4, 8];

  // Which built-in squish profile a created body sounds like.
  const SOUND_FOR_BODY = {
    ant: 'ant', beetle: 'beetle', spider: 'spider',
    fly: 'housefly', roach: 'cockroach', blob: 'bigAnt'
  };

  const photoCache = new Map();
  function photoFor(dataUrl) {
    if (!dataUrl) return null;
    let img = photoCache.get(dataUrl);
    if (!img) {
      img = new Image();
      img.src = dataUrl;
      photoCache.set(dataUrl, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(((n >> 16) & 255) + amount, 0, 255);
    const g2 = clamp(((n >> 8) & 255) + amount, 0, 255);
    const b = clamp((n & 255) + amount, 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g2 << 8) + b).toString(16).slice(1);
  }

  function blueprintColors(bp) {
    const base = bp.color || '#4a7a2a';
    return {
      body: base,
      shine: shade(base, 90),
      limb: shade(base, -55),
      accent: shade(base, 40)
    };
  }

  /* Turn a blueprint into a spawnable TYPES entry. Called before a run and
     whenever the creator previews, so edits show up immediately. */
  function registerCustom(id, bp) {
    TYPES[id] = {
      id: id,
      label: (bp.name || 'CREATURE').toUpperCase(),
      shape: 'custom',
      blueprint: bp,
      custom: true,
      target: bp.target !== false,
      points: 1,
      hp: 1,
      size: [38, 50],
      speed: [60, 100],
      wander: 1.2,
      sway: bp.wings && bp.wings !== 'none' ? 1 : 0,
      flight: !!(bp.wings && bp.wings !== 'none' && bp.flies),
      soundProfile: SOUND_FOR_BODY[bp.body] || 'ant',
      splat: bp.splat || '#4a2a12',
      colors: blueprintColors(bp)
    };
    return TYPES[id];
  }

  function ensureCustomTypes(config) {
    if (!config || !config.insects) return;
    Object.keys(config.insects).forEach(function (k) {
      const c = config.insects[k];
      if (c && c.custom) registerCustom(k, c.custom);
    });
  }

  function isCustom(id) { return !!(TYPES[id] && TYPES[id].custom); }
  function removeCustom(id) { if (isCustom(id)) delete TYPES[id]; }

  /* Draw a created insect from its blueprint. */
  function drawCustom(g, L, phase, colors, bp) {
    g.scale(L / 46, L / 46);
    const hazard = bp.target === false;
    shadow(g, 12, 18);

    if (hazard) {
      // Created hazards must still read as "do not touch": same glow and
      // bristle language as the wasp.
      const pulse = 0.5 + 0.5 * Math.sin(phase * 0.5);
      const halo = g.createRadialGradient(0, 2, 6, 0, 2, 30);
      halo.addColorStop(0, 'rgba(255,215,40,' + (0.18 + pulse * 0.12) + ')');
      halo.addColorStop(1, 'rgba(255,190,20,0)');
      g.fillStyle = halo;
      g.beginPath(); g.arc(0, 2, 30, 0, TAU); g.fill();
      g.strokeStyle = '#ffd21a';
      g.lineCap = 'round';
      g.lineWidth = 2.2;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * 10, 3 + Math.sin(a) * 12);
        g.lineTo(Math.cos(a) * 16, 3 + Math.sin(a) * 19);
        g.stroke();
      }
    }

    // --- wings, behind the body
    if (bp.wings && bp.wings !== 'none') {
      const bee = bp.wings === 'bee';
      g.save();
      g.globalAlpha *= bee ? 0.5 : 0.42;
      for (let side = -1; side <= 1; side += 2) {
        const flap = Math.sin(phase * (bee ? 2.2 : 1.4) + (side > 0 ? 0.8 : 0)) * 0.22;
        g.save();
        g.translate(side * 3, -2);
        g.rotate(side * ((bee ? 0.35 : 0.55) + flap));
        const wg = g.createLinearGradient(0, 0, side * 24, 0);
        wg.addColorStop(0, 'rgba(255,255,255,.85)');
        wg.addColorStop(1, 'rgba(210,230,255,.15)');
        g.fillStyle = wg;
        g.beginPath();
        g.ellipse(side * (bee ? 13 : 12), bee ? -2 : 3, bee ? 14 : 13, bee ? 5.4 : 5, side * 0.25, 0, TAU);
        g.fill();
        g.restore();
      }
      g.restore();
    }

    // --- legs, radiating from the thorax
    const legCount = LEG_COUNTS.indexOf(bp.legs) >= 0 ? bp.legs : 6;
    if (legCount > 0) {
      const perSide = Math.max(1, Math.round(legCount / 2));
      g.strokeStyle = colors.limb;
      g.lineCap = 'round';
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < perSide; i++) {
          const spread = perSide === 1 ? 0 : (i / (perSide - 1) - 0.5);
          const base = spread * 1.9;
          const sw = Math.sin(phase + i * 1.7 + (side > 0 ? Math.PI : 0)) * 0.24;
          const a = base + sw;
          const len = 20 - Math.abs(spread) * 5;
          const kneeX = side * Math.cos(a) * len * 0.6;
          const kneeY = Math.sin(a) * len * 0.5 - 5;
          const endX = side * Math.cos(a + 0.2) * len * 1.15;
          const endY = Math.sin(a + 0.2) * len * 0.9 + 5;
          g.lineWidth = 2.3;
          g.beginPath();
          g.moveTo(side * 3, 0);
          g.quadraticCurveTo(kneeX, kneeY, endX, endY);
          g.stroke();
        }
      }
    }

    // --- body, shaped by the chosen type
    const body = bp.body || 'ant';
    if (body === 'beetle' || body === 'roach') {
      segment(g, 0, -3, 9.6, 6.2, colors.accent, colors.shine);
      segment(g, 0, 9, 11, 13.5, colors.body, colors.shine);
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(0, -2); g.lineTo(0, 21); g.stroke();
    } else if (body === 'spider') {
      segment(g, 0, 10, 11.5, 12.5, colors.body, colors.shine);
      segment(g, 0, -4, 7.4, 7, colors.accent, colors.shine);
    } else if (body === 'fly') {
      segment(g, 0, 10, 8.2, 10.5, colors.body, colors.shine);
      segment(g, 0, -1, 7.2, 7, colors.accent, colors.shine);
    } else if (body === 'blob') {
      segment(g, 0, 6, 13, 14, colors.body, colors.shine);
    } else {
      segment(g, 0, 14, 8.5, 11, colors.body, colors.shine);
      segment(g, 0, 0, 5.6, 7.5, colors.accent, colors.shine);
      g.strokeStyle = colors.limb; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(0, 2); g.lineTo(0, 8); g.stroke();
    }

    // --- head: a photo if the player supplied one, otherwise a segment
    const headY = body === 'blob' ? -9 : body === 'spider' ? -13 : -11;
    const img = photoFor(bp.photo);
    if (img) {
      const r = 9 * (bp.headScale || 1);
      g.save();
      g.beginPath();
      g.arc(0, headY, r, 0, TAU);
      g.clip();
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      g.drawImage(img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        -r, headY - r, r * 2, r * 2);
      g.restore();
      g.strokeStyle = colors.limb;
      g.lineWidth = 1.6;
      g.beginPath(); g.arc(0, headY, r, 0, TAU); g.stroke();
    } else {
      segment(g, 0, headY, 6.6, 6, colors.body, colors.shine);
      const eyes = EYE_COUNTS.indexOf(bp.eyes) >= 0 ? bp.eyes : 2;
      g.fillStyle = 'rgba(255,255,255,.75)';
      if (eyes === 1) {
        g.beginPath(); g.ellipse(0, headY - 1, 2.4, 2.8, 0, 0, TAU); g.fill();
      } else {
        const rows = eyes <= 2 ? 1 : eyes <= 4 ? 2 : 4;
        const perRow = eyes / rows / 2;
        for (let r2 = 0; r2 < rows; r2++) {
          for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < perRow; i++) {
              g.beginPath();
              g.ellipse(side * (2.2 + i * 2.2), headY - 2 + r2 * 2.6, 1.3, 1.6, 0, 0, TAU);
              g.fill();
            }
          }
        }
      }
      antennae(g, phase, colors.limb, headY - 3, 14);
    }
  }

  /* Goliath: a hulking rhinoceros beetle. Heavy plates, thick jointed legs
     and a horn, so at a glance it reads as "this will take a while". */
  function drawGoliath(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 16, 20);

    // Thick legs
    g.strokeStyle = c.limb;
    g.lineCap = 'round';
    const rows = [
      { y: -7, a: -0.95, f: 13, t: 15 },
      { y: -1, a: -0.15, f: 14, t: 17 },
      { y: 6, a: 0.6, f: 13, t: 16 }
    ];
    for (let side = -1; side <= 1; side += 2) {
      rows.forEach((leg, i) => {
        const sw = Math.sin(phase + i * 2.1 + (side > 0 ? Math.PI : 0)) * 0.2;
        const a = leg.a + sw;
        const kx = side * Math.cos(a) * leg.f + side * 4;
        const ky = leg.y + Math.sin(a) * leg.f - 4;
        const ex = kx + side * Math.cos(a + 0.8) * leg.t * 0.8;
        const ey = ky + Math.sin(a + 0.8) * leg.t + 4;
        g.lineWidth = 4.2;
        g.beginPath(); g.moveTo(side * 5, leg.y); g.lineTo(kx, ky); g.stroke();
        g.lineWidth = 3.0;
        g.beginPath(); g.moveTo(kx, ky); g.lineTo(ex, ey); g.stroke();
        // spines
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex + side * 4, ey + 4); g.stroke();
      });
    }

    // Head plate and horn
    segment(g, 0, -15, 7.4, 5.4, c.body, c.shine);
    g.strokeStyle = c.accent;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, -17);
    g.quadraticCurveTo(1.5, -25, -2.5, -30);
    g.stroke();
    g.lineWidth = 2.4;
    g.beginPath();
    g.moveTo(-1.5, -22);
    g.quadraticCurveTo(4, -25, 5.5, -29);
    g.stroke();

    // Pronotum
    segment(g, 0, -6, 11.5, 7.4, c.accent, c.shine);

    // Domed elytra with a hard seam and ridges
    segment(g, 0, 10, 14.5, 15.5, c.body, c.shine);
    g.strokeStyle = 'rgba(0,0,0,.7)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -4); g.lineTo(0, 25); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.10)';
    g.lineWidth = 1.2;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 1; k <= 2; k++) {
        g.beginPath();
        g.moveTo(side * k * 4, -1);
        g.quadraticCurveTo(side * (k * 4 + 4), 10, side * k * 3.4, 22);
        g.stroke();
      }
    }
    eyes(g, 4.6, -16);
    gloss(g, -6, 3, 3.4, 7);
  }

  function drawShape(g, shape, size, phase, colors, blueprint) {
    if (shape === 'wasp') drawWasp(g, size, phase, colors);
    else if (shape === 'beetle') drawBeetle(g, size, phase, colors);
    else if (shape === 'fly') drawFly(g, size, phase, colors);
    else if (shape === 'mosquito') drawMosquito(g, size, phase, colors);
    else if (shape === 'roach') drawRoach(g, size, phase, colors);
    else if (shape === 'spider') drawSpider(g, size, phase, colors);
    else if (shape === 'goliath') drawGoliath(g, size, phase, colors);
    else if (shape === 'bubble') drawBubble(g, size, phase, colors);
    else if (shape === 'custom') drawCustom(g, size, phase, colors, blueprint || {});
    else drawAnt(g, size, phase, colors);
  }

  /* Floating 1UP bubble: glossy green orb that wobbles as it drifts. */
  function drawBubble(g, L, phase, c) {
    const s = L / 46;
    g.scale(s, s);
    const wob = 1 + Math.sin(phase * 0.5) * 0.05;
    g.scale(wob, 2 - wob);

    g.save();
    g.globalAlpha *= 0.25;
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(2, 4, 20, 19, 0, 0, TAU);
    g.fill();
    g.restore();

    // Soft glow so it reads as a pickup, not a bug
    const halo = g.createRadialGradient(0, 0, 8, 0, 0, 30);
    halo.addColorStop(0, 'rgba(120,255,90,.30)');
    halo.addColorStop(1, 'rgba(90,220,60,0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, 0, 30, 0, TAU);
    g.fill();

    const body = g.createRadialGradient(-6, -8, 2, 0, 0, 21);
    body.addColorStop(0, c.shine);
    body.addColorStop(0.35, c.accent);
    body.addColorStop(0.8, c.body);
    body.addColorStop(1, c.limb);
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 0, 20, 19, 0, 0, TAU);
    g.fill();

    g.strokeStyle = 'rgba(255,255,255,.45)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(0, 0, 20, 19, 0, 0, TAU);
    g.stroke();

    // Highlight
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath();
    g.ellipse(-7, -9, 5.5, 3.8, -0.5, 0, TAU);
    g.fill();

    // Label
    g.font = 'bold 15px "Trebuchet MS", Verdana, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3.5;
    g.strokeStyle = 'rgba(15,70,10,.9)';
    g.strokeText('1UP', 0, 1);
    g.fillStyle = '#ffffff';
    g.fillText('1UP', 0, 1);
  }

  /* Housefly: stout grey body, huge red compound eyes, two clear wings. */
  function drawFly(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 12, 16);

    g.save();
    g.globalAlpha *= 0.45;
    g.fillStyle = '#dfe8f2';
    for (let side = -1; side <= 1; side += 2) {
      const flap = Math.sin(phase + (side > 0 ? 0.9 : 0)) * 0.18;
      g.save();
      g.translate(side * 3, -1);
      g.rotate(side * (0.5 + flap));
      g.beginPath();
      g.ellipse(side * 12, 3, 13, 5, side * 0.25, 0, TAU);
      g.fill();
      g.restore();
    }
    g.restore();

    legs(g, phase * 0.25, c.limb, [
      { y: -2, len: 13, spread: 1.0, base: 0.0 },
      { y: 3, len: 14, spread: 1.2, base: 0.45 },
      { y: 8, len: 13, spread: 1.0, base: 0.95 }
    ]);

    segment(g, 0, 10, 8.0, 10.5, c.body, c.shine);   // abdomen
    segment(g, 0, -1, 7.2, 7.0, c.accent, c.shine);  // thorax
    // Thorax pinstripes
    g.strokeStyle = 'rgba(0,0,0,.45)';
    g.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(i * 2.6, -7); g.lineTo(i * 2.6, 5);
      g.stroke();
    }
    segment(g, 0, -10, 5.6, 5.0, c.body, c.shine);   // head

    // Big compound eyes
    for (let side = -1; side <= 1; side += 2) {
      const eg = g.createRadialGradient(side * 4 - 1, -12, 0.5, side * 4, -11, 4.6);
      eg.addColorStop(0, '#ff8a6a');
      eg.addColorStop(0.6, '#c02b12');
      eg.addColorStop(1, '#5e1206');
      g.fillStyle = eg;
      g.beginPath();
      g.ellipse(side * 4, -11, 4.4, 5.0, side * 0.2, 0, TAU);
      g.fill();
    }
    gloss(g, -3, 7, 2.2, 4);
  }

  /* Mosquito: tiny, spindly, long proboscis and very long legs. */
  function drawMosquito(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 8, 14);

    g.save();
    g.globalAlpha *= 0.35;
    g.fillStyle = '#e6eef7';
    for (let side = -1; side <= 1; side += 2) {
      const flap = Math.sin(phase * 1.3 + (side > 0 ? 1.2 : 0)) * 0.3;
      g.save();
      g.translate(side * 2, 0);
      g.rotate(side * (0.35 + flap));
      g.beginPath();
      g.ellipse(side * 9, 6, 11, 3.0, side * 0.3, 0, TAU);
      g.fill();
      g.restore();
    }
    g.restore();

    // Absurdly long legs, the mosquito silhouette
    g.strokeStyle = c.limb;
    g.lineCap = 'round';
    g.lineWidth = 1.3;
    for (let side = -1; side <= 1; side += 2) {
      [[-2, 26, -0.5], [3, 30, 0.25], [8, 27, 1.0]].forEach((leg, i) => {
        const sw = Math.sin(phase * 0.3 + i * 2 + (side > 0 ? Math.PI : 0)) * 0.12;
        const a = leg[2] + sw;
        g.beginPath();
        g.moveTo(side * 1.5, leg[0]);
        g.quadraticCurveTo(side * Math.cos(a) * leg[1] * 0.7, leg[0] + Math.sin(a) * leg[1] * 0.2 - 9,
          side * Math.cos(a - 0.4) * leg[1], leg[0] + Math.sin(a - 0.4) * leg[1] * 0.85 + 6);
        g.stroke();
      });
    }

    // Slender segmented abdomen angled off the body
    g.save();
    g.rotate(0.18);
    segment(g, 0, 13, 3.4, 12, c.body, c.shine);
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.lineWidth = 0.8;
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(-3.2, 5 + i * 4.6); g.lineTo(3.2, 5 + i * 4.6);
      g.stroke();
    }
    g.restore();

    segment(g, 0, -1, 3.8, 4.6, c.accent, c.shine);   // thorax
    segment(g, 0, -8, 3.4, 3.2, c.body, c.shine);     // head

    // Proboscis
    g.strokeStyle = '#1d150e';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -11); g.lineTo(0, -20);
    g.stroke();
    antennae(g, phase * 0.2, c.limb, -10, 9);
    eyes(g, 2.2, -9);
  }

  /* Cockroach: flat glossy shield, long sweeping antennae, spiny legs. */
  function drawRoach(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 13, 19);

    legs(g, phase, c.limb, [
      { y: -5, len: 18, spread: 1.25, base: -0.45 },
      { y: 1, len: 19, spread: 1.5, base: 0.15 },
      { y: 7, len: 18, spread: 1.25, base: 0.85 }
    ]);

    // Very long antennae sweeping forward
    g.strokeStyle = c.limb;
    g.lineWidth = 1.5;
    for (let side = -1; side <= 1; side += 2) {
      const sw = Math.sin(phase * 1.1 + side * 1.4) * 0.3;
      g.beginPath();
      g.moveTo(side * 2, -12);
      g.quadraticCurveTo(side * (14 + sw * 8), -24, side * (7 + sw * 14), -36);
      g.stroke();
    }

    segment(g, 0, -10, 5.4, 4.6, c.body, c.shine);    // head
    segment(g, 0, -4, 9.6, 6.2, c.accent, c.shine);   // pronotum shield

    // Flat wing case covering the abdomen
    segment(g, 0, 9, 10.4, 14, c.body, c.shine);
    g.strokeStyle = 'rgba(0,0,0,.6)';
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, -3); g.lineTo(0, 22); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.10)';
    g.lineWidth = 0.9;
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.moveTo(side * 4, -1);
      g.quadraticCurveTo(side * 9, 9, side * 4, 20);
      g.stroke();
    }
    gloss(g, -4.5, 3, 3.2, 6.5);
  }

  /* Spider: eight jointed legs, bulbous abdomen, cluster of eyes. */
  function drawSpider(g, L, phase, c) {
    g.scale(L / 46, L / 46);
    shadow(g, 12, 14);

    // Eight legs, four a side, jointed with a raised knee
    g.strokeStyle = c.limb;
    g.lineCap = 'round';
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const base = -0.85 + i * 0.62;
        const sw = Math.sin(phase + i * 1.7 + (side > 0 ? Math.PI : 0)) * 0.22;
        const a = base + sw;
        const len = 24 - Math.abs(i - 1.5) * 2.5;
        const kneeX = side * Math.cos(a) * len * 0.6;
        const kneeY = -2 + Math.sin(a) * len * 0.55 - 7;
        const endX = side * Math.cos(a + 0.15) * len * 1.15;
        const endY = -2 + Math.sin(a + 0.15) * len * 0.9 + 5;
        g.lineWidth = 2.3;
        g.beginPath();
        g.moveTo(side * 3, -2);
        g.quadraticCurveTo(kneeX, kneeY, endX, endY);
        g.stroke();
      }
    }

    segment(g, 0, 9, 11, 12.5, c.body, c.shine);     // abdomen
    segment(g, 0, -5, 7.4, 7.0, c.accent, c.shine);  // cephalothorax

    // Marking on the abdomen
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.beginPath();
    g.moveTo(0, 2); g.lineTo(4, 10); g.lineTo(0, 18); g.lineTo(-4, 10);
    g.closePath();
    g.fill();

    // Eye cluster
    g.fillStyle = 'rgba(255,255,255,.6)';
    [[-3.4, -9, 1.5], [3.4, -9, 1.5], [-1.4, -11, 1.0], [1.4, -11, 1.0]].forEach((e) => {
      g.beginPath();
      g.ellipse(e[0], e[1], e[2], e[2] * 1.1, 0, 0, TAU);
      g.fill();
    });

    // Fangs
    g.strokeStyle = '#000';
    g.lineWidth = 1.6;
    for (let side = -1; side <= 1; side += 2) {
      g.beginPath();
      g.moveTo(side * 2.5, -10);
      g.quadraticCurveTo(side * 4, -13, side * 2, -15);
      g.stroke();
    }
    gloss(g, -4, 5, 2.4, 4.6);
  }

  /* Bake a flattened corpse sprite. Corpses linger for ~10s and pile up, so
     two things matter: the canvas is cropped tight to the squashed body (a
     square canvas would be ~90% empty pixels, and blit cost is pixel area),
     and sprites are shared per species + size bucket rather than one canvas
     per kill. Variety comes from rotation and random mirroring at draw time. */
  const corpseCache = new Map();

  function renderCorpse(ins, dpr) {
    const bucket = Math.max(12, Math.round(ins.size / 8) * 8);
    const key = ins.type + '|' + bucket + '|' + dpr;
    let sprite = corpseCache.get(key);
    if (sprite) return sprite;

    const W = Math.ceil(bucket * 2.4);
    const H = Math.ceil(bucket * 0.85);
    const c = document.createElement('canvas');
    c.width = Math.ceil(W * dpr);
    c.height = Math.ceil(H * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(W / 2, H / 2);

    // Splattered outward and pressed flat into the wood.
    g.save();
    g.scale(1.7, 0.26);
    drawShape(g, ins.def.shape, bucket, ins.walkPhase, ins.def.colors, ins.def.blueprint);
    g.restore();

    // Dead tint: darker, with a wash of the species' own splat colour.
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(-W / 2, -H / 2, W, H);
    g.globalAlpha = 0.35;
    g.fillStyle = ins.def.splat;
    g.fillRect(-W / 2, -H / 2, W, H);

    sprite = { canvas: c, w: W, h: H };
    corpseCache.set(key, sprite);
    return sprite;
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

  global.Insects = {
    TYPES: TYPES, Insect: Insect, pickType: pickType, weightsFor: weightsFor,
    renderCorpse: renderCorpse, drawShape: drawShape,
    registerCustom: registerCustom, ensureCustomTypes: ensureCustomTypes,
    removeCustom: removeCustom, isCustom: isCustom, blueprintColors: blueprintColors,
    BODIES: BODIES, WINGS: WINGS, LEG_COUNTS: LEG_COUNTS, EYE_COUNTS: EYE_COUNTS
  };
})(window);
