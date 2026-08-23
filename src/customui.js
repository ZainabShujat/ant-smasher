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

  const BODY_LABELS = { ant: 'Ant', beetle: 'Beetle', spider: 'Spider',
    fly: 'Fly', roach: 'Roach', blob: 'Blob' };
  const WING_LABELS = { none: 'None', bee: 'Bee', fly: 'Fly' };

  const COLORS = ['#7a3fb0', '#c0392b', '#1f8b4c', '#2472a4', '#d4a017',
    '#e0722d', '#111111', '#e0e0e0', '#d81b8c', '#00a39a'];
  const SPLATS = ['#a02bd6', '#c0161d', '#2fbf22', '#1f7ad4', '#e8c020',
    '#e06a12', '#141414', '#f0f0f0', '#ff3fa4', '#00c2b2'];

  const PHOTO_SIZE = 128;   // uploaded photos are downscaled to this

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  class CustomUI {
    constructor(game) {
      this.game = game;
      this.cfg = C.load();
      this.creating = null;
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
        if (!el) return;
        if (el.dataset.field === 'name') {
          const entry = this.cfg.insects[this.creating];
          entry.custom.name = el.value.slice(0, 18);
          global.Insects.registerCustom(this.creating, entry.custom);
          return;                      // do not re-render mid-typing
        }
        this.setField(el.dataset.field, el.dataset.species, el.value);
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
          this.cfg = C.chaos(this.cfg);
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
        case 'create': {
          const id = C.newCustomId();
          this.cfg.insects[id] = C.newCustomInsect();
          global.Insects.registerCustom(id, this.cfg.insects[id].custom);
          this.creating = id;
          this.editing = null;
          this.render();
          break;
        }
        case 'appearance':
          this.creating = arg;
          this.editing = null;
          this.render();
          break;
        case 'closeCreator':
          this.creating = null;
          this.render();
          this.scheduleEstimate();
          break;
        case 'delete': {
          delete this.cfg.insects[arg];
          global.Insects.removeCustom(arg);
          this.cfg = C.normalise(this.cfg);
          this.editing = null;
          this.creating = null;
          this.render();
          this.scheduleEstimate();
          break;
        }
        case 'part':
          this.setPart(arg);
          break;
        case 'photo':
          this.pickPhoto();
          break;
        case 'clearPhoto': {
          const bp = this.cfg.insects[this.creating].custom;
          bp.photo = null;
          this.refreshCreature();
          break;
        }
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
        // Size is visible in the preview, so redraw it as the slider moves.
        if (field === 'size' && this.creating === species) this.drawPreview(species);
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

    /* Blueprint edits arrive as "field:value" so one delegated handler can
       drive every part picker. */
    setPart(arg) {
      const bits = arg.split(':');
      const field = bits[0];
      let value = bits.slice(1).join(':');
      const bp = this.cfg.insects[this.creating].custom;
      if (field === 'legs' || field === 'eyes') value = Number(value);
      if (field === 'target') value = value === 'true';
      if (field === 'flies') value = value === 'true';
      bp[field] = value;
      if (field === 'wings' && value === 'none') bp.flies = false;
      this.refreshCreature();
    }

    /* Re-register so the engine, the preview and the roster all agree. */
    refreshCreature() {
      const entry = this.cfg.insects[this.creating];
      entry.custom = C.normaliseBlueprint(entry.custom);
      global.Insects.registerCustom(this.creating, entry.custom);
      this.render();
      this.scheduleEstimate();
    }

    /* Photos never leave the device: read locally, downscale on a canvas, and
       keep the result in this config. Nothing is uploaded anywhere. */
    pickPhoto() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement('canvas');
            c.width = c.height = PHOTO_SIZE;
            const g = c.getContext('2d');
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            g.drawImage(img,
              (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
              0, 0, PHOTO_SIZE, PHOTO_SIZE);
            const bp = this.cfg.insects[this.creating].custom;
            bp.photo = c.toDataURL('image/jpeg', 0.72);
            this.refreshCreature();
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      };
      input.click();
    }

    creatorHtml(key) {
      const c = this.cfg.insects[key];
      const bp = c.custom;
      const moveIdx = MOVEMENTS.findIndex((m) => m[0] === c.movement);
      const I = global.Insects;
      const chips = (field, values, labels) => values.map((v) =>
        '<button class="chip' + (bp[field] === v ? ' on' : '') + '"' +
        ' data-act="part" data-arg="' + field + ':' + v + '">' +
        (labels ? labels[v] : v) + '</button>').join('');

      const swatches = (field, list) => list.map((hex) =>
        '<button class="swatch' + (bp[field] === hex ? ' on' : '') + '"' +
        ' style="background:' + hex + '"' +
        ' data-act="part" data-arg="' + field + ':' + hex + '"></button>').join('');

      return '<div class="cuEditHead">' +
          '<button class="backBtn" data-act="closeCreator">&#8592;</button>' +
          '<h2>CREATE INSECT</h2>' +
        '</div>' +
        '<canvas id="cuPreview" class="cuPreview" width="220" height="150"></canvas>' +
        '<label class="cuName-input"><span>Name</span>' +
          '<input type="text" maxlength="18" value="' + escapeHtml(bp.name) + '" data-field="name"></label>' +
        '<h3>Body</h3><div class="chips">' + chips('body', I.BODIES, BODY_LABELS) + '</div>' +
        '<h3>Legs</h3><div class="chips">' + chips('legs', I.LEG_COUNTS) + '</div>' +
        '<h3>Wings</h3><div class="chips">' + chips('wings', I.WINGS, WING_LABELS) + '</div>' +
        (bp.wings !== 'none' ?
          '<div class="chips">' +
            '<button class="chip' + (bp.flies ? ' on' : '') + '" data-act="part" data-arg="flies:true">Flies</button>' +
            '<button class="chip' + (!bp.flies ? ' on' : '') + '" data-act="part" data-arg="flies:false">Crawls</button>' +
          '</div>' : '') +
        '<h3>Eyes</h3><div class="chips">' + chips('eyes', I.EYE_COUNTS) + '</div>' +
        '<h3>Colour</h3><div class="chips">' + swatches('color', COLORS) + '</div>' +
        '<h3>Splatter</h3><div class="chips">' + swatches('splat', SPLATS) + '</div>' +
        '<h3>Face photo</h3>' +
        '<div class="chips">' +
          '<button class="chip" data-act="photo">' + (bp.photo ? 'Change photo' : 'Upload photo') + '</button>' +
          (bp.photo ? '<button class="chip" data-act="clearPhoto">Remove</button>' : '') +
        '</div>' +
        '<p class="cuNote">Photos stay on your device - nothing is uploaded.</p>' +
        '<h3>Role</h3><div class="chips">' +
          '<button class="chip' + (bp.target ? ' on' : '') + '" data-act="part" data-arg="target:true">Smash me</button>' +
          '<button class="chip' + (!bp.target ? ' on' : '') + '" data-act="part" data-arg="target:false">Hazard</button>' +
        '</div>' +
        (!bp.target ? '<p class="cuWarn">Hazards cost a life when smashed, and get the ' +
          'warning glow so players can tell.</p>' : '') +
        '<h3>Stats</h3>' +
        this.slider('size', key, 'Size', C.LIMITS.size, 0.05, c.size) +
        this.slider('speed', key, 'Speed', C.LIMITS.speed, 0.05, c.speed) +
        (bp.target ?
          this.slider('hp', key, 'Hits to kill', C.LIMITS.hp, 1, c.hp) +
          this.slider('points', key, 'Points', C.LIMITS.points, 1, c.points) : '') +
        this.slider('weight', key, 'Spawn frequency', C.LIMITS.weight, 0.05, c.weight) +
        this.slider('movement', key, 'Movement', [0, MOVEMENTS.length - 1], 1, moveIdx, c.movement) +
        '<button class="woodBtn" data-act="closeCreator">DONE</button>';
    }

    // -------------------------------------------------------------- rendering
    render() {
      const T = global.Insects.TYPES;
      if (this.creating) {
        this.list.classList.add('hidden');
        this.editor.classList.remove('hidden');
        this.editor.innerHTML = this.creatorHtml(this.creating);
        this.drawPreview(this.creating);
        this.renderFoot();
        return;
      }
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
          C.speciesList(this.cfg).map((k) => this.rowHtml(k, T[k])).join('') +
          '<button class="ghostBtn" data-act="create">+ CREATE INSECT</button>' +
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
      if (!type) return '';
      const hazard = !type.target;
      const made = !!c.custom;
      return '<div class="cuRow' + (c.enabled ? '' : ' off') + (made ? ' made' : '') + '">' +
        '<button class="cuTick" data-act="toggle" data-arg="' + key + '">' +
          (c.enabled ? '&#10003;' : '') + '</button>' +
        '<button class="cuName" data-act="edit" data-arg="' + key + '">' +
          '<b>' + type.label + (hazard ? ' <em>hazard</em>' : '') +
            (made ? ' <i>made</i>' : '') + '</b>' +
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
      if (type.solo) bits.push('one at a time');
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

      if (c.custom) {
        html += '<button class="woodBtn small" data-act="appearance" data-arg="' + key + '">' +
                  'EDIT APPEARANCE</button>' +
                '<button class="woodBtn small danger" data-act="delete" data-arg="' + key + '">' +
                  'DELETE CREATURE</button>';
      }
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
      const fit = Math.min(1, 104 / base);

      g.save();
      g.translate(110, 75);
      g.scale(fit, fit);
      global.Insects.drawShape(g, type.shape, base, 1.2, type.colors, type.blueprint);
      g.restore();

      g.font = 'bold 11px "Trebuchet MS", Verdana, sans-serif';
      g.fillStyle = 'rgba(255,235,195,.65)';
      g.textAlign = 'center';
      g.fillText(Math.round(base) + 'px', 110, 142);
    }
  }

  global.CustomUI = CustomUI;
})(window);
