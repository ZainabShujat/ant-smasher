/* Ant Smash - game state, loop and rendering.

   States: menu -> countdown -> playing <-> paused -> gameover -> (menu | countdown)
   The menu runs the same simulation as a live background, minus scoring. */
(function (global) {
  'use strict';
  const { clamp, rand, lerp, TAU } = global.U;
  const { Insect, pickType } = global.Insects;
  const A = global.AudioFX;

  const STORAGE_KEY = 'antsmash.highscore';
  const ESCAPE_MARGIN = 30;
  const COUNTDOWN = 2.4;
  const MAX_LIVES = 5;
  const BUBBLE_SCORE = 400;       // 1UP bubbles only start appearing here
  const BUBBLE_GAP = [22, 40];    // seconds between bubbles
  const GRACE = 0.9;              // seconds of safety after losing a life

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.effects = new global.Effects();
      this.insects = [];
      this.dpr = 1;
      this.w = 0; this.h = 0;
      this.touch = window.matchMedia('(pointer: coarse)').matches;

      this.highScore = Number(localStorage.getItem(STORAGE_KEY) || 0) || 0;
      this.state = 'menu';
      // Classic is simply the default configuration. Custom Game hands the
      // same engine a different one.
      this.config = global.Config.defaultConfig('Classic');
      this.scorePop = 0;
      this.danger = 0;

      this.ui = {
        menu: document.getElementById('menu'),
        play: document.getElementById('btnPlay'),
        scores: document.getElementById('btnScores'),
        how: document.getElementById('btnHow'),
        custom: document.getElementById('btnCustom'),
        gear: document.getElementById('btnOptions'),
        menuBest: document.getElementById('menuBest'),
        info: document.getElementById('infoOverlay'),
        infoTitle: document.getElementById('infoTitle'),
        infoBody: document.getElementById('infoBody'),
        infoClose: document.getElementById('infoClose'),
        options: document.getElementById('optionsOverlay'),
        optSound: document.getElementById('optSound'),
        optHaptics: document.getElementById('optHaptics'),
        optReset: document.getElementById('optReset'),
        optClose: document.getElementById('optClose'),
        overlay: document.getElementById('overlay'),
        score: document.getElementById('ovScore'),
        best: document.getElementById('ovBest'),
        newBest: document.getElementById('ovNewBest'),
        btn: document.getElementById('ovBtn'),
        ovMenu: document.getElementById('ovMenu'),
        pauseOverlay: document.getElementById('pauseOverlay'),
        resume: document.getElementById('resumeBtn'),
        restart: document.getElementById('restartBtn'),
        pauseMenu: document.getElementById('pauseMenuBtn')
      };

      // Every UI button clicks, and any of them can unlock audio on mobile.
      const wire = (el, fn) => el.addEventListener('click', () => { A.unlock(); A.click(); fn(); });
      wire(this.ui.play, () => this.startGame());
      wire(this.ui.scores, () => this.showInfo('SCORES',
        '<p class="row"><span>BEST</span><b>' + this.highScore + '</b></p>' +
        '<p class="hint">Beat it. Combos multiply everything.</p>'));
      wire(this.ui.how, () => this.showInfo('HOW TO PLAY', HOW_TO_HTML));
      wire(this.ui.custom, () => this.showCustom());
      wire(this.ui.gear, () => this.showOptions());
      wire(this.ui.infoClose, () => this.ui.info.classList.add('hidden'));
      wire(this.ui.optClose, () => this.ui.options.classList.add('hidden'));
      wire(this.ui.optSound, () => { A.setEnabled(!A.enabled); this.syncOptions(); });
      wire(this.ui.optHaptics, () => { A.setHaptics(!A.haptics); this.syncOptions(); });
      wire(this.ui.optReset, () => {
        this.highScore = 0;
        try { localStorage.setItem(STORAGE_KEY, '0'); } catch (e) { /* storage blocked */ }
        this.ui.menuBest.textContent = '0';
        this.syncOptions();
      });
      wire(this.ui.btn, () => this.startGame());
      wire(this.ui.ovMenu, () => this.showMenu());
      wire(this.ui.resume, () => this.setPaused(false));
      wire(this.ui.restart, () => { this.setPaused(false); this.startGame(); });
      wire(this.ui.pauseMenu, () => { this.setPaused(false); this.showMenu(); });

      this.input = new global.Input(canvas, (x, y) => { A.unlock(); this.handleTap(x, y); });

      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onResize);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && (this.state === 'playing' || this.state === 'countdown')) this.setPaused(true);
      });

      this.resize();
      this.resetRun();
      this.showMenu();

      this.lastTime = performance.now();
      this._frame = (t) => this.frame(t);
      requestAnimationFrame(this._frame);
    }

    // ---------------------------------------------------------------- setup
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.dpr = dpr;
      this.w = w;
      this.h = h;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.__gradCache = null;   // gradients live in the old device space

      // HUD grows with the screen so it stays readable on a phone without
      // eating the play area on a desktop.
      this.hud = Math.round(clamp(h * 0.075, 46, 68));
      this.hudFont = Math.round(this.hud * 0.55);

      this.effects.dpr = dpr;
      this.plank = global.Wood.makePlankTexture(w * dpr, h * dpr);
      this.hudTex = global.Wood.makeHudTexture(w * dpr, this.hud * dpr);

      // Insects are authored for a phone-sized screen; scale them up a
      // little on big viewports so they stay comfortably tappable.
      this.uiScale = clamp(Math.min(w, h) / 620, 0.9, 1.8);

      // Fingers are blunter than a mouse pointer.
      this.forgiveness = (this.touch ? 22 : 14) * this.uiScale;

      this.world = { left: 0, right: w, top: this.hud, bottom: h };
      const pw = this.touch ? 74 : 56;
      this.pauseRect = { x: w / 2 - pw / 2, y: 0, w: pw, h: this.hud };
      this.dangerBand = Math.min(96, h * 0.14);
    }

    resetRun() {
      this.insects.length = 0;
      this.effects.reset();
      this.score = 0;
      this.lives = this.config.lives;
      this.elapsed = 0;
      this.combo = 0;
      this.bestCombo = 0;
      this.multiplier = 1;
      this.spawnTimer = 0.6;
      this.bubbleTimer = rand(BUBBLE_GAP[0], BUBBLE_GAP[1]);
      this.scorePop = 0;
      this.danger = 0;
      this.grace = 0;
    }

    showMenu() {
      // The menu background always runs plain Classic ants.
      this.config = global.Config.defaultConfig('Classic');
      this.resetRun();
      this.state = 'menu';
      this.ui.menu.classList.remove('hidden');
      this.ui.overlay.classList.add('hidden');
      this.ui.pauseOverlay.classList.add('hidden');
      this.ui.info.classList.add('hidden');
      this.ui.options.classList.add('hidden');
      if (this.customUI) this.customUI.close();
      this.ui.menuBest.textContent = this.highScore;
    }

    startGame(config) {
      if (config) this.config = global.Config.normalise(config);
      // Created species must exist in the registry before anything spawns.
      global.Insects.ensureCustomTypes(this.config);
      this.resetRun();
      this.state = 'countdown';
      this.countdown = COUNTDOWN;
      this.countStep = -1;
      this.ui.menu.classList.add('hidden');
      this.ui.overlay.classList.add('hidden');
      this.ui.pauseOverlay.classList.add('hidden');
      this.ui.info.classList.add('hidden');
      this.ui.options.classList.add('hidden');
    }

    showInfo(title, html) {
      this.ui.infoTitle.textContent = title;
      this.ui.infoBody.innerHTML = html;
      this.ui.info.classList.remove('hidden');
    }

    /* Custom Game is built lazily: the menu should not pay for it. */
    showCustom() {
      if (!this.customUI) this.customUI = new global.CustomUI(this);
      this.ui.menu.classList.add('hidden');
      this.customUI.open();
    }

    showOptions() {
      this.syncOptions();
      this.ui.options.classList.remove('hidden');
    }

    syncOptions() {
      this.ui.optSound.textContent = 'SOUND: ' + (A.enabled ? 'ON' : 'OFF');
      this.ui.optSound.classList.toggle('off', !A.enabled);
      this.ui.optHaptics.textContent = 'VIBRATION: ' + (A.haptics ? 'ON' : 'OFF');
      this.ui.optHaptics.classList.toggle('off', !A.haptics);
      this.ui.optReset.textContent = 'RESET BEST (' + this.highScore + ')';
    }

    setPaused(paused) {
      if (paused && this.state !== 'playing' && this.state !== 'countdown') return;
      if (!paused && this.state !== 'paused') return;
      if (paused) this.resumeState = this.state;
      this.state = paused ? 'paused' : (this.resumeState || 'playing');
      this.ui.pauseOverlay.classList.toggle('hidden', !paused);
    }

    gameOver() {
      this.state = 'gameover';
      const isBest = this.score > this.highScore;
      if (isBest) {
        this.highScore = this.score;
        try { localStorage.setItem(STORAGE_KEY, String(this.highScore)); } catch (e) { /* storage blocked */ }
      }
      this.ui.score.textContent = this.score;
      this.ui.best.textContent = this.highScore;
      this.ui.newBest.classList.toggle('hidden', !isBest);
      this.ui.overlay.classList.remove('hidden');
      A.gameOver();
    }

    // ------------------------------------------------------------ difficulty
    get difficulty() { return this.state === 'menu' ? 0.6 : Math.min(10, this.elapsed / 18); }

    spawnInterval() {
      if (this.state === 'menu') return rand(1.1, 2.2);
      const d = this.difficulty;
      return Math.max(0.34, 1.35 - d * 0.11) / this.config.spawnRate * rand(0.75, 1.25);
    }

    maxAlive() {
      if (this.state === 'menu') return 3;
      // Narrow phone screens get slightly fewer bugs at once so the board
      // never turns into an unreadable pile.
      const room = clamp(this.w / 460, 0.75, 1.35);
      return Math.max(3, Math.round((3 + this.difficulty * 1.5) * room * this.config.maxInsects));
    }

    /* Solo species (the goliath) may only have one alive at a time. */
    soloBlocked(typeId) {
      const def = global.Insects.TYPES[typeId];
      if (!def || !def.solo) return false;
      return this.insects.some((i) => i.type === typeId && i.alive);
    }

    hasSolo() {
      return this.insects.some((i) => i.alive && i.def.solo);
    }

    spawn(forcedType) {
      const d = this.difficulty;
      let typeId = forcedType || (this.state === 'menu' ? 'ant' : pickType(d, this.config));

      // Re-roll if the pick is a solo species that is already out there.
      for (let tries = 0; typeId && !forcedType && this.soloBlocked(typeId) && tries < 6; tries++) {
        typeId = pickType(d, this.config);
      }
      if (!typeId || this.soloBlocked(typeId)) return;

      const x = rand(this.world.left + 34, this.world.right - 34);
      const y = this.world.top - rand(20, 70);
      const ins = new Insect(typeId, x, y, d, forcedType ? null : this.config);
      ins.size *= this.uiScale;
      ins.hitRadius *= this.uiScale;
      ins.speed *= (0.85 + 0.15 * this.uiScale);

      // Now and then an ordinary species throws up an oversized individual:
      // slower, several hits, worth a lot. Gets likelier as things heat up.
      const def = global.Insects.TYPES[typeId];
      if (!forcedType && def.target && !def.solo && !def.bonus && d > 1.2) {
        const chance = Math.min(0.22, 0.05 + d * 0.02);
        if (Math.random() < chance) ins.makeBrute(rand(1.45, 1.85));
      }

      this.insects.push(ins);
    }

    // ----------------------------------------------------------------- input
    handleTap(x, y) {
      if (this.state === 'menu') return;   // menu buttons are DOM elements

      // HUD strip: only the pause button is interactive.
      if (y < this.hud) {
        const r = this.pauseRect;
        if (x >= r.x && x <= r.x + r.w) {
          A.click();
          this.setPaused(this.state !== 'paused');
        }
        return;
      }
      if (this.state !== 'playing') return;

      // Targets get a generous hitbox; the wasp gets a strict one, so a tap
      // aimed at an ant next to a wasp can never be misread as a wasp hit.
      let target = null, targetD = Infinity;
      let wasp = null, waspD = Infinity;
      for (let i = 0; i < this.insects.length; i++) {
        const ins = this.insects[i];
        if (!ins.alive) continue;
        const d = (ins.x - x) * (ins.x - x) + (ins.y - y) * (ins.y - y);
        if (ins.isTarget) {
          if (ins.hitTest(x, y, this.forgiveness) && d < targetD) { targetD = d; target = ins; }
        } else if (ins.hitTest(x, y, 0) && d < waspD) { waspD = d; wasp = ins; }
      }

      if (target) this.smash(target);
      else if (wasp) this.stung(wasp);
      else this.miss(x, y);
    }

    smash(ins) {
      // The 1UP bubble is popped, not killed: it grants a life and leaves no
      // corpse, and it neither builds nor breaks the combo.
      if (ins.def.bonus === 'life') {
        ins.kill();
        ins.wasSmashed = false;
        this.lives = Math.min(MAX_LIVES, this.lives + 1);
        this.effects.burst(ins.x, ins.y, 26, '#7bff4a');
        this.effects.popup(ins.x, ins.y - 20, '1UP!', '#b6ff7a', true);
        this.effects.screenFlash('#2fbf22', 0.3);
        this.effects.kick(6);
        A.oneUp();
        return;
      }

      ins.hp -= 1;
      if (ins.hp > 0) {
        // Tougher bugs take a hit and stagger instead of dying.
        ins.flash = 1;
        ins.speed *= 0.75;
        this.effects.burst(ins.x, ins.y, 7, ins.def.splat);
        this.effects.kick(3);
        A.thud(ins.def.soundProfile || ins.type);
        return;
      }

      ins.kill();
      this.combo += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const before = this.multiplier;
      this.multiplier = clamp(1 + Math.floor(this.combo / 3), 1, 5);
      const gained = ins.points * this.multiplier;
      this.score += gained;
      this.scorePop = 1;

      const big = ins.maxHp > 1;
      this.effects.burst(ins.x, ins.y, big ? 30 : 22, ins.def.splat);
      this.effects.splat(ins.x, ins.y, ins.hitRadius * (big ? 2.1 : 1.75), ins.def.splat);
      this.effects.popup(ins.x, ins.y - 14, '+' + gained);
      this.effects.kick(big ? 7 : 4);
      A.smash(ins.def.soundProfile || ins.type, this.combo);

      if (this.multiplier > before) {
        this.effects.popup(ins.x, ins.y - 44, 'COMBO x' + this.multiplier, '#9dff7a', true);
        A.combo(this.multiplier);
      }
    }

    /* Player smashed the wasp: no points, lose a life, dramatic reaction. */
    stung(wasp) {
      wasp.enrage();
      this.breakCombo();
      this.effects.burst(wasp.x, wasp.y, 18, wasp.def.splat);
      this.effects.popup(wasp.x, wasp.y - 20, 'OUCH!', '#ff7b5c', true);
      this.effects.screenFlash('#c2200f', 0.4);
      this.effects.kick(16);
      A.sting();
      this.loseLife(true);
    }

    miss(x, y) {
      this.breakCombo();
      this.effects.burst(x, y, 4, 'rgba(90,60,30,.7)');   // dust puff
    }

    breakCombo() { this.combo = 0; this.multiplier = 1; }

    /* One life at a time: after any loss there is a short grace window, so a
       panicked double-tap on two wasps - or a bug slipping out the moment you
       get stung - cannot take two lives in the same breath. */
    loseLife(silent) {
      if (this.grace > 0) return;

      this.lives -= 1;
      this.effects.kick(9);
      if (!silent) {
        this.effects.screenFlash('#8a1608', 0.3);
        A.lifeLost();
      }
      if (this.lives <= 0) { this.lives = 0; this.gameOver(); return; }
      this.grace = GRACE;
    }

    // ---------------------------------------------------------------- update
    update(dt) {
      if (this.state === 'paused' || this.state === 'gameover') { this.effects.update(dt); return; }

      if (this.state === 'countdown') {
        this.countdown -= dt;
        const step = Math.ceil(this.countdown / 0.6);
        if (step !== this.countStep) {
          this.countStep = step;
          if (step >= 1 && step <= 4) A.countdown(step === 1);
        }
        if (this.countdown <= 0) this.state = 'playing';
        this.effects.update(dt);
        return;
      }

      const live = this.state === 'playing';
      if (live) this.elapsed += dt;
      this.scorePop = Math.max(0, this.scorePop - dt * 3.5);
      this.grace = Math.max(0, this.grace - dt);

      this.spawnTimer -= dt;
      let aliveCount = 0;
      for (let i = 0; i < this.insects.length; i++) if (this.insects[i].alive) aliveCount++;
      if (this.spawnTimer <= 0 && aliveCount < this.maxAlive()) {
        this.spawn();
        // A goliath is a siege: the rest keep coming, but at a slower drip so
        // the player can actually work it down.
        this.spawnTimer = this.spawnInterval() * (this.hasSolo() ? 1.9 : 1);
      }

      // 1UP bubble: a late-game reward, and only if a life is missing.
      if (live && this.config.bubbles && this.score >= BUBBLE_SCORE) {
        this.bubbleTimer -= dt;
        const bubbleOut = this.insects.some((i) => i.type === 'lifeBubble' && i.alive);
        if (this.bubbleTimer <= 0 && !bubbleOut && this.lives < MAX_LIVES) {
          this.spawn('lifeBubble');
          this.bubbleTimer = rand(BUBBLE_GAP[0], BUBBLE_GAP[1]);
        }
      }

      let nearEdge = false;
      for (let i = this.insects.length - 1; i >= 0; i--) {
        const ins = this.insects[i];
        ins.update(dt, this.world);

        if (ins.dead) {
          // A smashed bug leaves a flattened body on the wood for ~10s.
          if (ins.state === 'dead' && ins.wasSmashed) {
            this.effects.corpse(global.Insects.renderCorpse(ins, this.dpr), ins.x, ins.y, ins.rotation);
          }
          this.insects.splice(i, 1);
          continue;
        }
        if (ins.alive && ins.isTarget && !ins.def.bonus && ins.y > this.h - this.dangerBand) nearEdge = true;

        const gone = ins.y > this.h + ESCAPE_MARGIN ||
                     ins.y < -this.h * 0.5 ||
                     ins.x < -120 || ins.x > this.w + 120;
        if (!gone) continue;

        this.insects.splice(i, 1);
        // Only an escaping *target* costs a life; a wasp leaving is fine.
        // A missed bubble simply floats away - no penalty.
        if (live && ins.alive && ins.isTarget && !ins.def.bonus && ins.y > this.h) {
          this.effects.popup(clamp(ins.x, 40, this.w - 40), this.h - 40, '-1 LIFE', '#ff9a6b');
          this.breakCombo();
          this.loseLife();
        }
      }

      // Warning glow along the bottom edge, stronger on the last life.
      const want = (nearEdge ? 0.65 : 0) + (live && this.lives === 1 ? 0.35 : 0);
      this.danger = lerp(this.danger, Math.min(1, want), Math.min(1, dt * 6));

      this.effects.update(dt);
    }

    // ---------------------------------------------------------------- render
    frame(t) {
      const dt = Math.min(0.05, (t - this.lastTime) / 1000) || 0;
      this.lastTime = t;
      this.update(dt);
      this.draw();
      requestAnimationFrame(this._frame);
    }

    draw() {
      const g = this.ctx;
      const { w, h } = this;

      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const s = this.effects.shake;
      if (s > 0) g.translate(rand(-s, s) * 0.35, rand(-s, s) * 0.35);

      g.drawImage(this.plank, 0, 0, w, h);
      this.effects.drawSplats(g);
      this.effects.drawCorpses(g);

      for (let i = 0; i < this.insects.length; i++) this.insects[i].draw(g);
      this.effects.draw(g);

      if (this.state !== 'menu') this.drawDanger(g);
      this.effects.drawFlash(g, w, h);

      if (this.state !== 'menu') this.drawHud(g);
      if (this.state === 'countdown') this.drawCountdown(g);
    }

    /* Red glow creeping up from the bottom edge: the "you are about to lose a
       life" signal, readable in peripheral vision on a phone. */
    drawDanger(g) {
      if (this.danger <= 0.01) return;
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 140);
      const a = this.danger * pulse;
      const band = this.dangerBand;
      const grad = g.createLinearGradient(0, this.h - band, 0, this.h);
      grad.addColorStop(0, 'rgba(190,30,10,0)');
      grad.addColorStop(1, 'rgba(190,30,10,' + (0.5 * a).toFixed(3) + ')');
      g.fillStyle = grad;
      g.fillRect(0, this.h - band, this.w, band);

      g.fillStyle = 'rgba(255,90,50,' + (0.8 * a).toFixed(3) + ')';
      g.fillRect(0, this.h - 3, this.w, 3);
    }

    drawCountdown(g) {
      const step = Math.ceil(this.countdown / 0.6);
      const label = step >= 4 ? 'GET READY' : step >= 1 ? String(step) : 'GO!';
      const frac = 1 - ((this.countdown / 0.6) % 1);
      const scale = step >= 4 ? 1 : lerp(1.5, 0.95, Math.min(1, frac * 1.6));

      g.save();
      g.translate(this.w / 2, this.h * 0.42);
      g.scale(scale, scale);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'bold ' + (step >= 4 ? 46 : 108) + 'px "Trebuchet MS", Verdana, sans-serif';
      g.lineWidth = 9;
      g.strokeStyle = 'rgba(35,20,7,.8)';
      g.strokeText(label, 0, 0);
      g.fillStyle = '#ffe9bd';
      g.fillText(label, 0, 0);
      g.restore();
    }

    drawHud(g) {
      const w = this.w, hud = this.hud;
      g.drawImage(this.hudTex, 0, 0, w, hud);

      // Score, left - pops when it changes
      const pop = 1 + this.scorePop * 0.28;
      g.save();
      g.translate(14, hud / 2);
      g.scale(pop, pop);
      g.font = 'bold ' + this.hudFont + 'px "Trebuchet MS", Verdana, sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(60,35,12,.35)';
      g.fillText(String(this.score), 1, 2);
      g.fillStyle = this.scorePop > 0.4 ? '#1f5c0c' : '#3a2109';
      g.fillText(String(this.score), 0, 0);
      g.restore();

      // Combo, just under the score
      if (this.combo >= 3) {
        g.font = 'bold ' + Math.round(this.hud * 0.3) + 'px "Trebuchet MS", Verdana, sans-serif';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(20,40,10,.55)';
        g.strokeText('COMBO x' + this.multiplier, 16, hud + this.hud * 0.28);
        g.fillStyle = '#b6ff7a';
        g.fillText('COMBO x' + this.multiplier, 16, hud + this.hud * 0.28);
      }

      // Pause bars, centre
      g.fillStyle = 'rgba(58,33,9,.85)';
      const bh = Math.round(hud * 0.38), bw = Math.round(bh * 0.3), gap = Math.round(bh * 0.35);
      const cx = w / 2, cy = hud / 2;
      roundRect(g, cx - gap / 2 - bw, cy - bh / 2, bw, bh, 2); g.fill();
      roundRect(g, cx + gap / 2, cy - bh / 2, bw, bh, 2); g.fill();

      // Lives, right - glossy green dots. Extra lives from 1UP bubbles add
      // slots rather than overflowing the three the run starts with.
      const rad = Math.round(hud * 0.2);
      const slots = Math.max(this.config.lives, this.lives);
      for (let i = 0; i < slots; i++) {
        const x = w - (rad + 8) - i * (rad * 2 + 6);
        const y = hud / 2;
        const on = this.lives > i;
        const cache = g.__gradCache || (g.__gradCache = new Map());
        const key = 'life' + i + on + rad + w + slots;
        let grad = cache.get(key);
        if (!grad) {
          grad = g.createRadialGradient(x - 3, y - 4, 1, x, y, rad);
          grad.addColorStop(0, on ? '#b6ff7a' : '#6f6f5c');
          grad.addColorStop(0.5, on ? '#3fbf22' : '#4d4d3f');
          grad.addColorStop(1, on ? '#166b07' : '#33332a');
          cache.set(key, grad);
        }
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(x, y, rad, rad * 0.92, 0, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,.5)';
        g.beginPath();
        g.ellipse(x - rad * 0.32, y - rad * 0.4, rad * 0.3, rad * 0.22, -0.5, 0, TAU);
        g.fill();
      }
    }
  }

  const HOW_TO_HTML = [
    '<p class="hint">Tap every crawling bug before it reaches the bottom.</p>',
    '<p class="row"><span>Ant</span><b>+1</b></p>',
    '<p class="row"><span>Fast ant</span><b>+2</b></p>',
    '<p class="row"><span>Housefly</span><b>+2</b></p>',
    '<p class="row"><span>Mosquito</span><b>+3</b></p>',
    '<p class="row"><span>Soldier ant</span><b>+3 &middot; 2 hits</b></p>',
    '<p class="row"><span>Beetle</span><b>+3 &middot; 2 hits</b></p>',
    '<p class="row"><span>Cockroach</span><b>+4 &middot; 2 hits</b></p>',
    '<p class="row"><span>Spider</span><b>+6 &middot; 3 hits</b></p>',
    '<p class="row"><span>Goliath beetle</span><b>+25 &middot; 5 hits</b></p>',
    '<p class="hint">Only one goliath is ever on screen, and the rest slow down while it is. Any bug can also turn up oversized: bigger, tougher, worth far more.</p>',
    '<p class="warn">NEVER smash the big striped wasp &mdash; it costs a life.</p>',
    '<p class="hint">Past 400 points a green <b>1UP</b> bubble drifts in now and then. Pop it for an extra life, up to five.</p>',
    '<p class="hint">An ant escaping off the bottom also costs a life. Chain hits to build a combo multiplier, up to x5.</p>'
  ].join('');

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  window.addEventListener('load', () => {
    global.game = new Game(document.getElementById('game'));
  });
})(window);
