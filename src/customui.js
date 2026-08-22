/* Custom Game screen: a UI over the config layer.

   It never touches the engine directly - it edits a config object and hands it
   to game.startGame(config). The same surface will later serve VS (two configs)
   and the insect creator (new entries in config.insects). */
(function (global) {
  'use strict';
  const C = global.Config;

  const MOVEMENTS = [
    ['straight', 'Straight'],
    ['wandering', 'Wandering'],
    ['erratic', 'Erratic']
  ];

  class CustomUI {
    constructor(game) {
      this.game = game;
      this.cfg = C.load();
      this.root = document.getElementById('customOverlay');
      this.editing = null;
      this.estimateTimer = 0;
      this.build();
    }

    open() {
      this.render();
      this.root.classList.remove('hidden');
      this.scheduleEstimate(0);
    }

    close() { this.root.classList.add('hidden'); }

    // ------------------------------------------------------------- building
    build() {
      this.root.innerHTML =
        '<div class="customPanel">' +
          '<div class="customHead">' +
            '<button class="backBtn" data-act="menu">&#8592;</button>' +
            '<h1>CUSTOM GAME</h1>' +
          '</div>' +
          '<div class="customBody">' +
            '<div class="customList" id="cuList"></div>' +
            '<div class="customEditor hidden" id="cuEditor"></div>' +
          '</div>' +
          '<div class="customFoot" id="cuFoot"></div>' +
        '</div>';

      this.list = this.root.querySelector('#cuList');
      this.editor = this.root.querySelector('#cuEditor');
      this.foot = this.root.querySelector('#cuFoot');

      // One delegated handler for the whole screen.
      this.root.addEventListener('click', (e) => {
        const el = e.target.closest('[data-act]');
        if (!el) return;
        global.AudioFX.unlock();
        global.AudioFX.click();
        this.act(el.dataset.act, el.dataset.arg);
      });
      this.root.addEventListener('input', (e) => {
        const el = e.target.closest('[data-field]');
        if (el) this.setField(el.dataset.field, el.dataset.species, el.value);
      });
    }

    act(action, arg) {
      switch (action) {
        case 'menu': this.close(); this.game.showMenu(); break;
        case 'edit': this.editing = arg; this.render(); break;
        case 'closeEditor': this.editing = null; this.render(); break;
        case 'toggle': {
          const c = this.cfg.insects[arg];
          c.enabled = !c.enabled;
          this.cfg = C.normalise(this.cfg);       // keeps at least one target
          this.render();
          this.scheduleEstimate();
          break;
        }
        case 'chaos':
          this.cfg = C.chaos();
          this.editing = null;
          this.render();
          this.scheduleEstimate(0);
          break;
        case 'reset':
          this.cfg = C.defaultConfig('Custom');
          this.editing = null;
          this.render();
          this.scheduleEstimate(0);
          break;
        case 'play':
          C.save(this.cfg);
          this.close();
          this.game.startGame(this.cfg);
          break;
      }
    }

    setField(field, species, raw) {
      const v = Number(raw);
      if (species) {
        const c = this.cfg.insects[species];
        if (field === 'movement') c.movement = MOVEMENTS[v][0];
        else c[field] = field === 'hp' || field === 'points' ? Math.round(v) : v;
        const label = this.editor.querySelector('[data-label="' + field + '"]');
        if (label) label.textContent = this.valueText(field, c[field]);
      } else {
        this.cfg[field] = field === 'lives' ? Math.round(v) : v;
        const label = this.foot.querySelector('[data-label="' + field + '"]');
        if (label) label.textContent = this.valueText(field, this.cfg[field]);
      }
      this.scheduleEstimate();
    }

    valueText(field, v) {
      switch (field) {
        case 'hp': return v + (v === 1 ? ' hit' : ' hits');
        case 'points': return v + ' pts';
        case 'lives': return String(v);
        case 'movement': return MOVEMENTS.find((m) => m[0] === v)[1];
        default: return (Math.round(v * 10) / 10).toFixed(1) + 'x';
      }
    }

    // -------------------------------------------------------------- rendering
    render() {
      const T = global.Insects.TYPES;
      if (this.editing) {
        this.list.classList.add('hidden');
        this.editor.classList.remove('hidden');
        this.editor.innerHTML = this.editorHtml(this.editing, T[this.editing]);
        this.drawPreview(this.editing);
      } else {
        this.editor.classList.add('hidden');
        this.list.classList.remove('hidden');
        this.list.innerHTML =
          '<h2>YOUR INSECTS</h2>' +
          C.speciesList().map((k) => this.rowHtml(k, T[k])).join('') +
          '<button class="ghostBtn" disabled>+ CREATE INSECT &mdash; soon</button>' +
          '<h2>GAME SETTINGS</h2>' +
          this.slider('lives', null, 'Starting lives', C.LIMITS.lives, 1, this.cfg.lives) +
          this.slider('spawnRate', null, 'Spawn rate', C.LIMITS.spawnRate, 0.1, this.cfg.spawnRate) +
          this.slider('globalSpeed', null, 'Speed', C.LIMITS.globalSpeed, 0.1, this.cfg.globalSpeed) +
          this.slider('maxInsects', null, 'Max insects', C.LIMITS.maxInsects, 0.1, this.cfg.maxInsects);
      }
      this.renderFoot();
    }

    rowHtml(key, type) {
      const c = this.cfg.insects[key];
      const hazard = !type.target;
      return '<div class="cuRow' + (c.enabled ? '' : ' off') + '">' +
        '<button class="cuTick" data-act="toggle" data-arg="' + key + '">' +
          (c.enabled ? '&#10003;' : '') + '</button>' +
        '<button class="cuName" data-act="edit" data-arg="' + key + '">' +
          '<b>' + type.label + (hazard ? ' <em>hazard</em>' : '') + '</b>' +
          '<span>' + this.summary(key) + '</span>' +
        '</button>' +
        '<button class="cuGo" data-act="edit" data-arg="' + key + '">&#8250;</button>' +
      '</div>';
    }

    summary(key) {
      const c = this.cfg.insects[key];
      const type = global.Insects.TYPES[key];
      const bits = [this.valueText('size', c.size) + ' size', this.valueText('speed', c.speed) + ' speed'];
      if (type.target) bits.push(c.hp + (c.hp === 1 ? ' hit' : ' hits'), c.points + ' pts');
      return bits.join(' &middot; ');
    }

    editorHtml(key, type) {
      const c = this.cfg.insects[key];
      const moveIdx = MOVEMENTS.findIndex((m) => m[0] === c.movement);
      let html =
        '<div class="cuEditHead">' +
          '<button class="backBtn" data-act="closeEditor">&#8592;</button>' +
          '<h2>' + type.label + '</h2>' +
        '</div>' +
        '<canvas id="cuPreview" class="cuPreview" width="220" height="150"></canvas>' +
        '<div class="cuRow standalone">' +
          '<button class="cuTick" data-act="toggle" data-arg="' + key + '">' +
            (c.enabled ? '&#10003;' : '') + '</button>' +
          '<span class="cuEnabled">Enabled</span>' +
        '</div>' +
        this.slider('size', key, 'Size', C.LIMITS.size, 0.05, c.size) +
        this.slider('speed', key, 'Speed', C.LIMITS.speed, 0.05, c.speed);

      if (type.target) {
        html += this.slider('hp', key, 'Health', C.LIMITS.hp, 1, c.hp) +
                this.slider('points', key, 'Points', C.LIMITS.points, 1, c.points);
      } else {
        html += '<p class="cuWarn">This one is a hazard: smashing it costs a life. ' +
                'Health and points do not apply.</p>';
      }

      html += this.slider('weight', key, 'Spawn frequency', C.LIMITS.weight, 0.05, c.weight) +
              this.slider('movement', key, 'Movement', [0, MOVEMENTS.length - 1], 1, moveIdx, c.movement);
      return html;
    }

    slider(field, species, label, range, step, value, displayValue) {
      const shown = this.valueText(field, displayValue === undefined ? value : displayValue);
      return '<label class="cuSlider">' +
        '<span class="cuSliderTop">' + label +
          '<b data-label="' + field + '">' + shown + '</b></span>' +
        '<input type="range" min="' + range[0] + '" max="' + range[1] + '" step="' + step + '"' +
          ' value="' + value + '" data-field="' + field + '"' +
          (species ? ' data-species="' + species + '"' : '') + '>' +
      '</label>';
    }

    renderFoot() {
      const d = this.difficulty;
      const bars = d ? '&#9608;'.repeat(d.level * 2) + '&#9617;'.repeat(10 - d.level * 2) : '&#9617;'.repeat(10);
      const survival = !d ? 'estimating&hellip;'
        : d.capped ? 'survivable indefinitely' : '~' + d.seconds + 's expected survival';
      this.foot.innerHTML =
        '<div class="cuDiff" style="color:' + (d ? d.colour : '#c9b48c') + '">' +
          '<span class="cuBars">' + bars + '</span>' +
          '<b>' + (d ? d.label : '&hellip;') + '</b>' +
          '<span class="cuSurvival">' + survival + '</span>' +
        '</div>' +
        '<div class="cuButtons">' +
          '<button class="woodBtn small" data-act="chaos">&#127922; CHAOS</button>' +
          '<button class="woodBtn small" data-act="reset">RESET</button>' +
        '</div>' +
        '<button class="woodBtn" data-act="play">PLAY</button>';
    }

    /* The difficulty sim is real work, so it runs after edits settle. */
    scheduleEstimate(delay) {
      clearTimeout(this.estimateTimer);
      this.difficulty = null;
      this.renderFoot();
      this.estimateTimer = setTimeout(() => {
        const g = this.game;
        this.difficulty = C.estimate(C.normalise(this.cfg), g.w, g.h, g.hud);
        this.renderFoot();
      }, delay === undefined ? 260 : delay);
    }

    /* Live preview of the species with the current size/speed applied. */
    drawPreview(key) {
      const canvas = this.editor.querySelector('#cuPreview');
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = 220 * dpr;
      canvas.height = 150 * dpr;
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, 220, 150);

      const type = global.Insects.TYPES[key];
      const c = this.cfg.insects[key];
      const base = (type.size[0] + type.size[1]) / 2 * c.size;
      const fit = Math.min(1, 96 / base);

      g.save();
      g.translate(110, 75);
      g.scale(fit, fit);
      global.Insects.drawShape(g, type.shape, base, 1.2, type.colors);
      g.restore();

      g.font = 'bold 11px "Trebuchet MS", Verdana, sans-serif';
      g.fillStyle = 'rgba(255,235,195,.65)';
      g.textAlign = 'center';
      g.fillText(Math.round(base) + 'px', 110, 142);
    }
  }

  global.CustomUI = CustomUI;
})(window);
