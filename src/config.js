/* Game configuration layer.

   The engine no longer hard-codes Classic. A config describes the whole run -
   which species spawn, how each behaves, and the global knobs - and Classic is
   simply the default config. Custom Game edits a config; later, VS can hand
   two configs to the same engine.

       CLASSIC -> DEFAULT CONFIG -\
                                   >-- SAME ENGINE
       CUSTOM  -> CUSTOM CONFIG  -/

   Per-species size/speed/weight are multipliers on that species' own defaults,
   so a config stays meaningful even if the underlying species is retuned. */
(function (global) {
  'use strict';
  const { clamp, rand, randInt, pick } = global.U;

  const STORE_KEY = 'antsmash.customconfig';

  // Movement styles map onto the wander/sway the entity system already has.
  const MOVEMENT = {
    straight: { wander: 0.12, sway: 0 },
    wandering: { wander: 1, sway: 1 },
    erratic: { wander: 2.3, sway: 1.8 }
  };

  const LIMITS = {
    size: [0.5, 2.0],
    speed: [0.4, 2.5],
    hp: [1, 5],
    points: [1, 20],
    weight: [0.2, 3.0],
    lives: [1, 5],
    spawnRate: [0.5, 2.5],
    globalSpeed: [0.5, 2.0],
    maxInsects: [0.5, 2.0]
  };

  /* Species that can be configured: the built-ins, plus whatever the player
     has created in this config. (The 1UP bubble is a pickup, not a bug.) */
  function builtInList() {
    return Object.keys(global.Insects.TYPES)
      .filter((k) => k !== 'lifeBubble' && !global.Insects.TYPES[k].custom);
  }

  function speciesList(cfg) {
    const list = builtInList();
    if (cfg && cfg.insects) {
      Object.keys(cfg.insects).forEach((k) => {
        if (cfg.insects[k] && cfg.insects[k].custom && list.indexOf(k) < 0) list.push(k);
      });
    }
    return list;
  }

  /* A fresh creature blueprint. */
  let customSeq = 0;
  function newCustomId() {
    customSeq += 1;
    return 'custom_' + Date.now().toString(36) + '_' + customSeq;
  }

  function defaultBlueprint() {
    return {
      name: 'My Bug',
      body: 'ant',
      legs: 6,
      wings: 'none',
      eyes: 2,
      color: '#7a3fb0',
      splat: '#a02bd6',
      photo: null,
      target: true,
      flies: false
    };
  }

  function newCustomInsect() {
    return {
      enabled: true,
      size: 1,
      speed: 1,
      hp: 1,
      points: 5,
      weight: 1,
      movement: 'wandering',
      custom: defaultBlueprint()
    };
  }

  function normaliseBlueprint(bp) {
    const base = defaultBlueprint();
    if (!bp) return base;
    const I = global.Insects;
    base.name = String(bp.name || base.name).slice(0, 18);
    base.body = I.BODIES.indexOf(bp.body) >= 0 ? bp.body : base.body;
    base.legs = I.LEG_COUNTS.indexOf(bp.legs) >= 0 ? bp.legs : base.legs;
    base.wings = I.WINGS.indexOf(bp.wings) >= 0 ? bp.wings : base.wings;
    base.eyes = I.EYE_COUNTS.indexOf(bp.eyes) >= 0 ? bp.eyes : base.eyes;
    base.color = /^#[0-9a-f]{6}$/i.test(bp.color || '') ? bp.color : base.color;
    base.splat = /^#[0-9a-f]{6}$/i.test(bp.splat || '') ? bp.splat : base.splat;
    base.photo = typeof bp.photo === 'string' && bp.photo.indexOf('data:image') === 0 ? bp.photo : null;
    base.target = bp.target !== false;
    base.flies = !!bp.flies && base.wings !== 'none';
    return base;
  }

  function defaultInsectConfig(typeId) {
    const t = global.Insects.TYPES[typeId];
    const flier = !!t.flight;
    return {
      enabled: true,
      size: 1,
      speed: 1,
      hp: t.hp,
      points: t.points,
      weight: 1,
      movement: flier ? 'erratic' : (t.wander >= 1.5 ? 'erratic' : 'wandering')
    };
  }

  function defaultConfig(name) {
    const insects = {};
    builtInList().forEach((k) => { insects[k] = defaultInsectConfig(k); });
    return {
      name: name || 'Classic',
      lives: 3,
      spawnRate: 1,
      globalSpeed: 1,
      maxInsects: 1,
      bubbles: true,
      insects: insects
    };
  }

  /* Fill in anything missing / clamp anything out of range, so a config saved
     by an older build (or hand-edited) can never break a run. */
  function normalise(cfg) {
    const base = defaultConfig(cfg && cfg.name);
    if (!cfg) return base;

    base.lives = Math.round(clamp(num(cfg.lives, 3), LIMITS.lives[0], LIMITS.lives[1]));
    base.spawnRate = clamp(num(cfg.spawnRate, 1), LIMITS.spawnRate[0], LIMITS.spawnRate[1]);
    base.globalSpeed = clamp(num(cfg.globalSpeed, 1), LIMITS.globalSpeed[0], LIMITS.globalSpeed[1]);
    base.maxInsects = clamp(num(cfg.maxInsects, 1), LIMITS.maxInsects[0], LIMITS.maxInsects[1]);
    base.bubbles = cfg.bubbles !== false;

    // Carry created species across, registering them so the engine can spawn
    // them and the UI can draw them.
    if (cfg.insects) {
      Object.keys(cfg.insects).forEach((k) => {
        const src = cfg.insects[k];
        if (!src || !src.custom || base.insects[k]) return;
        const entry = newCustomInsect();
        entry.custom = normaliseBlueprint(src.custom);
        base.insects[k] = entry;
      });
    }

    speciesList(base).forEach((k) => {
      const src = (cfg.insects && cfg.insects[k]) || {};
      const dst = base.insects[k];
      dst.enabled = src.enabled !== false;
      dst.size = clamp(num(src.size, 1), LIMITS.size[0], LIMITS.size[1]);
      dst.speed = clamp(num(src.speed, 1), LIMITS.speed[0], LIMITS.speed[1]);
      dst.hp = Math.round(clamp(num(src.hp, dst.hp), LIMITS.hp[0], LIMITS.hp[1]));
      dst.points = Math.round(clamp(num(src.points, dst.points), LIMITS.points[0], LIMITS.points[1]));
      dst.weight = clamp(num(src.weight, 1), LIMITS.weight[0], LIMITS.weight[1]);
      if (MOVEMENT[src.movement]) dst.movement = src.movement;
      if (dst.custom) dst.custom = normaliseBlueprint(dst.custom);
    });

    global.Insects.ensureCustomTypes(base);

    // A run with nothing to smash is not a run.
    const anyTarget = speciesList(base).some((k) =>
      base.insects[k].enabled && global.Insects.TYPES[k] && global.Insects.TYPES[k].target);
    if (!anyTarget) base.insects.ant.enabled = true;

    return base;
  }

  function num(v, fallback) {
    const n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clone(cfg) { return JSON.parse(JSON.stringify(cfg)); }

  // ------------------------------------------------------------- persistence
  function save(cfg) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return normalise(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return defaultConfig('Custom');
    }
  }

  // ------------------------------------------------------------------ chaos
  /* Randomise within sensible bounds: strange, but always playable. */
  function chaos(existing) {
    const cfg = defaultConfig('Chaos');
    // Keep whatever the player has created; chaos randomises it too.
    if (existing && existing.insects) {
      Object.keys(existing.insects).forEach((k) => {
        if (existing.insects[k] && existing.insects[k].custom) {
          cfg.insects[k] = clone(existing.insects[k]);
        }
      });
      global.Insects.ensureCustomTypes(cfg);
    }
    cfg.lives = randInt(2, 5);
    cfg.spawnRate = rand(0.8, 2.0);
    cfg.globalSpeed = rand(0.7, 1.6);
    cfg.maxInsects = rand(0.8, 1.8);

    const all = speciesList(cfg);
    const targets = all.filter((k) => global.Insects.TYPES[k] && global.Insects.TYPES[k].target);
    // Between three and all of the species, always including some targets.
    const keep = {};
    const wanted = randInt(3, all.length);
    while (Object.keys(keep).length < wanted) keep[pick(all)] = true;
    targets.slice(0, 2).forEach((k) => { keep[k] = true; });

    all.forEach((k) => {
      const c = cfg.insects[k];
      c.enabled = !!keep[k];
      c.size = rand(0.6, 1.9);
      c.speed = rand(0.5, 2.1);
      c.weight = rand(0.4, 2.4);
      c.movement = pick(['straight', 'wandering', 'erratic', 'erratic']);
      if (global.Insects.TYPES[k] && global.Insects.TYPES[k].target) {
        // Tough bugs must be worth the effort, and tiny fast ones stay 1-hit.
        const small = c.size < 0.9, fast = c.speed > 1.5;
        c.hp = small || fast ? 1 : randInt(1, 4);
        c.points = Math.max(1, Math.round(c.hp * rand(1.5, 5) * (fast ? 1.6 : 1)));
      }
    });
    return cfg;
  }

  // ------------------------------------------------------------- difficulty
  /* Rather than guess with a formula, run the real entity simulation headless
     with a simple bot player and see how long it survives. */
  const BANDS = [
    { min: 26, label: 'CURSED', colour: '#a02bd6', level: 5 },
    { min: 14, label: 'BRUTAL', colour: '#d43c1c', level: 4 },
    { min: 7.5, label: 'HARD', colour: '#e08a20', level: 3 },
    { min: 3.5, label: 'CHALLENGING', colour: '#d8c22a', level: 2 },
    { min: 0, label: 'CASUAL', colour: '#57c93b', level: 1 }
  ];

  const SIM_WINDOW = 90;       // seconds of play sampled per run
  const SIM_RUNS = 6;
  const SIM_CAP = 180;         // survival past this reads as "indefinitely"
  const BOT_REACTION = 0.33;   // human-ish tap cadence
  const BOT_DISTRACTION = 0.28; // fraction of taps aimed at the wrong bug

  /* Run the real entity simulation headless with a simple bot player and
     count mistakes: bugs that escaped, plus hazards swatted by accident.

     Measuring mistakes rather than time-to-death matters. Time-to-death is
     bimodal - the bot either keeps up and survives forever, or collapses -
     which produced a cliff between "casual" and "cursed" with nothing in
     between. Mistake pressure is continuous, so the difficulty scale is too,
     and expected survival then falls out of the config's own life count. */
  function simulate(cfg, w, h, hud) {
    const Insects = global.Insects;
    const world = { left: 0, right: w, top: hud, bottom: h };
    const insects = [];
    let mistakes = 0;
    let exposure = 0;          // bug-seconds spent in the bottom of the screen
    let t = 0, spawnTimer = 0.6, tapTimer = BOT_REACTION, grace = 0;
    const dangerLine = hud + (h - hud) * 0.62;
    const dt = 1 / 30;

    while (t < SIM_WINDOW) {
      t += dt;
      grace = Math.max(0, grace - dt);
      const d = Math.min(10, t / 18);

      spawnTimer -= dt;
      let alive = 0;
      for (let i = 0; i < insects.length; i++) if (insects[i].alive) alive++;
      const cap = Math.max(3, Math.round((3 + d * 1.5) * cfg.maxInsects));
      if (spawnTimer <= 0 && alive < cap) {
        const typeId = Insects.pickType(d, cfg);
        if (typeId) {
          insects.push(new Insects.Insect(typeId, rand(34, w - 34), hud - rand(20, 70), d, cfg));
        }
        spawnTimer = Math.max(0.34, 1.35 - d * 0.11) / cfg.spawnRate * rand(0.75, 1.25);
      }

      for (let i = insects.length - 1; i >= 0; i--) {
        const ins = insects[i];
        ins.update(dt, world);
        // Continuous pressure signal: escapes alone are rare events and make
        // the rating jumpy, so also measure how much of the time targets are
        // loose near the bottom edge.
        if (ins.alive && ins.isTarget && !ins.def.bonus && ins.y > dangerLine) exposure += dt;
        if (ins.dead || ins.y > h + 30 || ins.y < -h * 0.5 || ins.x < -120 || ins.x > w + 120) {
          const escaped = ins.alive && ins.isTarget && !ins.def.bonus && ins.y > h;
          insects.splice(i, 1);
          if (escaped && grace <= 0) { mistakes++; grace = 0.9; }
        }
      }

      tapTimer -= dt;
      if (tapTimer <= 0) {
        // Attention splits as the board fills: a crowded screen genuinely
        // slows a player down, which is what makes high spawn rates hurt.
        tapTimer = BOT_REACTION * (1 + 0.07 * alive);

        // Usually goes for whatever is closest to escaping, but attention is
        // divided: sometimes it swats at the wrong one.
        const targets = [];
        for (let i = 0; i < insects.length; i++) {
          const ins = insects[i];
          if (!ins.alive || !ins.isTarget || ins.def.bonus) continue;
          if (ins.y < hud) continue;
          targets.push(ins);
        }
        let best = null;
        if (targets.length) {
          if (Math.random() < BOT_DISTRACTION) best = targets[Math.floor(Math.random() * targets.length)];
          else for (let i = 0; i < targets.length; i++) if (!best || targets[i].y > best.y) best = targets[i];
        }
        if (best) {
          // Small and fast bugs get missed more often.
          const missP = clamp(0.04 + (best.speed / 900) + Math.max(0, (34 - best.size) / 150), 0.02, 0.55);
          if (Math.random() > missP) {
            best.hp -= 1;
            if (best.hp <= 0) { best.state = 'dead'; best.dead = true; }
          }
          const hazard = insects.find((x) => x.alive && !x.isTarget &&
            Math.abs(x.x - best.x) < 70 && Math.abs(x.y - best.y) < 70);
          if (hazard && Math.random() < 0.10 && grace <= 0) { mistakes++; grace = 0.9; }
        }
      }
    }
    return { mistakes: mistakes, exposure: exposure };
  }

  function estimate(cfg, w, h, hud) {
    let mistakes = 0, exposure = 0;
    for (let i = 0; i < SIM_RUNS; i++) {
      const r = simulate(cfg, w || 400, h || 800, hud || 56);
      mistakes += r.mistakes;
      exposure += r.exposure;
    }
    const mistakesPerSec = (mistakes / SIM_RUNS) / SIM_WINDOW;
    const pressure = (exposure / SIM_RUNS) / SIM_WINDOW;   // avg targets in the danger zone

    // Blend: pressure is the smooth backbone, mistakes are the sharp end.
    // Pressure carries most of the weight because it is smooth; mistakes
    // are rare events and contribute most of the run-to-run variance.
    const score = pressure * 9 + mistakesPerSec * 55;

    const band = BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
    const seconds = mistakesPerSec <= 0 ? SIM_CAP : Math.min(SIM_CAP, cfg.lives / mistakesPerSec);
    return {
      seconds: Math.round(seconds),
      capped: seconds >= SIM_CAP,
      mistakesPerMinute: Math.round(mistakesPerSec * 600) / 10,
      score: Math.round(score * 10) / 10,
      label: band.label,
      colour: band.colour,
      level: band.level
    };
  }

  global.Config = {
    MOVEMENT, LIMITS, BANDS, STORE_KEY,
    speciesList, builtInList, defaultConfig, normalise, clone, save, load, chaos, estimate, simulate,
    newCustomId, newCustomInsect, defaultBlueprint, normaliseBlueprint
  };
})(window);
