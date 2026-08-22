/* Sound system - every effect is synthesised with the Web Audio API, so the
   game ships no audio files and nothing is copied from any other game.
   The context starts suspended on mobile and is unlocked on first touch. */
(function (global) {
  'use strict';

  const SOUND_KEY = 'antsmash.sound';
  const HAPTIC_KEY = 'antsmash.haptics';

  /* Per-species squish character. Small bugs are high, thin and quick; big
     ones are low, long and gooey; armoured ones crack before they burst. */
  const SPECIES = {
    ant: {
      pitch: 1.0, dur: 0.23, gain: 1.0, cutoff: 2400, wet: 1.0, body: 1.0,
      f0: 880, f1: 185, q: 15, attack: 0.018, flutter: [24, 46],
      bubbles: 5, drops: 3, crackle: 0
    },
    fastAnt: {
      // Tiny and quick: higher, drier, over almost before you hear it.
      pitch: 1.38, dur: 0.15, gain: 0.85, cutoff: 2300, wet: 0.85, body: 0.7,
      f0: 1000, f1: 300, q: 18, attack: 0.014, flutter: [34, 62],
      bubbles: 4, drops: 2, crackle: 0
    },
    bigAnt: {
      // Soldier: low, long, thick, plenty of goo.
      pitch: 0.62, dur: 0.36, gain: 1.15, cutoff: 1900, wet: 1.35, body: 1.4,
      f0: 760, f1: 150, q: 12, attack: 0.026, flutter: [16, 32],
      bubbles: 9, drops: 5, crackle: 3
    },
    beetle: {
      // Hard shell: an audible crackle first, then a wet interior.
      pitch: 0.82, dur: 0.30, gain: 1.1, cutoff: 2600, wet: 1.15, body: 1.1,
      f0: 700, f1: 210, q: 20, attack: 0.014, flutter: [20, 40],
      bubbles: 7, drops: 4, crackle: 7, heavy: true
    }
  };
  SPECIES.housefly = {
    // Juicy for its size - a fly is mostly liquid.
    pitch: 1.15, dur: 0.20, gain: 0.95, cutoff: 2500, wet: 1.25, body: 0.9,
    f0: 950, f1: 240, q: 14, attack: 0.014, flutter: [28, 54],
    bubbles: 7, drops: 3, crackle: 0
  };
  SPECIES.mosquito = {
    // Barely anything there: a thin, high pop.
    pitch: 1.6, dur: 0.12, gain: 0.8, cutoff: 2600, wet: 0.7, body: 0.5,
    f0: 1150, f1: 420, q: 20, attack: 0.008, flutter: [40, 70],
    bubbles: 3, drops: 2, crackle: 0
  };
  SPECIES.cockroach = {
    // Hard shell, wet inside - the nastiest one.
    pitch: 0.75, dur: 0.32, gain: 1.15, cutoff: 2400, wet: 1.3, body: 1.2,
    f0: 720, f1: 175, q: 17, attack: 0.016, flutter: [18, 38],
    bubbles: 8, drops: 5, crackle: 9, heavy: true
  };
  SPECIES.spider = {
    // Low, gooey, and it takes three hits to get here.
    pitch: 0.68, dur: 0.34, gain: 1.15, cutoff: 2000, wet: 1.4, body: 1.3,
    f0: 690, f1: 160, q: 13, attack: 0.022, flutter: [15, 30],
    bubbles: 10, drops: 6, crackle: 2, heavy: true
  };
  SPECIES.bigAnt.heavy = true;

  class Audio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noise = null;
      this.enabled = localStorage.getItem(SOUND_KEY) !== '0';
      this.haptics = localStorage.getItem(HAPTIC_KEY) !== '0';
      this.gestured = false;
    }

    /* Called from the first user gesture. Safe to call repeatedly. */
    unlock() {
      // Browsers reject vibration until the page has had a real gesture, so
      // remember that one has happened rather than calling and being refused.
      this.gestured = true;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);

        // One second of white noise, reused by every percussive sound.
        const len = Math.floor(this.ctx.sampleRate * 1);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buf;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setEnabled(on) {
      this.enabled = !!on;
      localStorage.setItem(SOUND_KEY, on ? '1' : '0');
      if (on) this.unlock();
    }

    setHaptics(on) {
      this.haptics = !!on;
      localStorage.setItem(HAPTIC_KEY, on ? '1' : '0');
    }

    buzz(pattern) {
      if (this.haptics && this.gestured && navigator.vibrate) {
        try { navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
      }
    }

    get ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

    // ------------------------------------------------------------- helpers
    /* A filtered noise "voice": noise through one biquad whose frequency
       sweeps f0 -> f1 over the sound. A resonant bandpass sweeping downward
       is what makes something read as wet rather than as static. */
    _voice(opt) {
      const t = this.ctx.currentTime + (opt.delay || 0);
      const dur = opt.dur;

      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = opt.rate || (0.85 + Math.random() * 0.4);
      src.loop = true;
      src.loopEnd = 0.4;

      const filt = this.ctx.createBiquadFilter();
      filt.type = opt.type || 'bandpass';
      filt.Q.value = opt.q === undefined ? 6 : opt.q;
      filt.frequency.setValueAtTime(opt.f0, t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(60, opt.f1), t + dur);

      const g = this.ctx.createGain();
      const atk = opt.attack === undefined ? 0.004 : opt.attack;
      const sus = opt.sustain === undefined ? 0.45 : opt.sustain;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(opt.gain, t + atk);
      // Two-stage decay: a quick drop, then a longer wet tail that keeps the
      // squelch audible instead of clipping it into a click.
      g.gain.exponentialRampToValueAtTime(opt.gain * sus, t + atk + dur * 0.35);
      g.gain.exponentialRampToValueAtTime(0.0006, t + dur);

      src.connect(filt); filt.connect(g); g.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.03);
    }

    /* A bus that everything squishy is routed through. The lowpass guarantees
       no bright transient can escape - a sharp click plus a low thump is what
       makes a synthesised hit read as a gunshot instead of a squish. */
    _squishBus(cutoff, gain, wetness) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      lp.Q.value = 0.6;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      lp.connect(g);
      g.connect(this.master);

      // A very short feedback comb gives the sound a hollow, liquid ring -
      // the difference between "noise" and "something wet in a small cavity".
      const w = wetness === undefined ? 1 : wetness;
      if (w > 0) {
        const dly = this.ctx.createDelay(0.05);
        dly.delayTime.value = 0.005 + Math.random() * 0.011;
        const damp = this.ctx.createBiquadFilter();
        damp.type = 'lowpass';
        damp.frequency.value = 1400;
        const fb = this.ctx.createGain();
        fb.gain.value = Math.min(0.42, 0.28 * w);
        const wetG = this.ctx.createGain();
        wetG.gain.value = 0.34 * w;

        g.connect(dly);
        dly.connect(damp); damp.connect(fb); fb.connect(dly);   // damped feedback
        dly.connect(wetG); wetG.connect(this.master);
      }
      return lp;
    }

    /* Scattered micro-grains. Used two ways: bubbles (higher, wetter) and
       chitin crackle (lower, drier), both of which add texture that a single
       smooth envelope cannot. */
    _grains(bus, opt) {
      for (let i = 0; i < opt.count; i++) {
        this._wet(bus, {
          dur: opt.durMin + Math.random() * (opt.durMax - opt.durMin),
          f0: opt.f0 * (0.7 + Math.random() * 0.9),
          f1: opt.f1 * (0.7 + Math.random() * 0.8),
          q: opt.q === undefined ? 18 : opt.q,
          gain: opt.gain * (0.6 + Math.random() * 0.7),
          delay: opt.spread * Math.random() + (opt.delay || 0),
          attack: 0.006,
          rate: 0.4 + Math.random() * 0.4
        });
      }
    }

    /* One wet formant: narrow-band noise gliding downward, with its amplitude
       fluttering so the sound gurgles rather than sitting still. */
    _wet(bus, opt) {
      const t = this.ctx.currentTime + (opt.delay || 0);
      const dur = opt.dur;

      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = opt.rate || 0.5;
      src.loop = true;
      src.loopEnd = 0.5;

      const filt = this.ctx.createBiquadFilter();
      filt.type = opt.type || 'bandpass';
      filt.Q.value = opt.q === undefined ? 16 : opt.q;
      filt.frequency.setValueAtTime(opt.f0, t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(60, opt.f1), t + dur);

      // Wobble the resonance itself, so the pitch of the squelch slides around
      // like liquid moving rather than gliding down a clean ramp.
      if (opt.wobble) {
        const flo = this.ctx.createOscillator();
        flo.type = 'sine';
        flo.frequency.value = opt.wobble[0] + Math.random() * (opt.wobble[1] - opt.wobble[0]);
        const fdepth = this.ctx.createGain();
        fdepth.gain.value = opt.f0 * (opt.wobbleDepth || 0.22);
        flo.connect(fdepth);
        fdepth.connect(filt.frequency);
        flo.start(t);
        flo.stop(t + dur + 0.03);
      }

      // Gurgle: an LFO scales the signal between roughly 0.25 and 1.
      const mod = this.ctx.createGain();
      mod.gain.value = 0.62;
      if (opt.flutter) {
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = opt.flutter[0] + Math.random() * (opt.flutter[1] - opt.flutter[0]);
        const depth = this.ctx.createGain();
        depth.gain.value = 0.36;
        lfo.connect(depth);
        depth.connect(mod.gain);
        lfo.start(t);
        lfo.stop(t + dur + 0.03);
      }

      // Soft attack - never an instant onset, that is the click we do not want.
      const env = this.ctx.createGain();
      const atk = opt.attack === undefined ? 0.02 : opt.attack;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(opt.gain, t + atk);
      env.gain.exponentialRampToValueAtTime(opt.gain * 0.5, t + atk + dur * 0.4);
      env.gain.exponentialRampToValueAtTime(0.0006, t + dur);

      src.connect(filt); filt.connect(mod); mod.connect(env); env.connect(bus);
      src.start(t);
      src.stop(t + dur + 0.03);
    }

    _noiseBurst(dur, freq, q, gain, type) {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.5;

      const filt = this.ctx.createBiquadFilter();
      filt.type = type || 'lowpass';
      filt.frequency.setValueAtTime(freq, t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.25), t + dur);
      filt.Q.value = q;

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);

      src.connect(filt); filt.connect(g); g.connect(this.master);
      src.start(t);
      src.stop(t + dur + 0.02);
    }

    _tone(type, f0, f1, dur, gain, delay) {
      const t = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);

      osc.connect(g); g.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    // -------------------------------------------------------------- events
    /* Squish: liquid forced out of a small body. No transient click and no
       low impact boom - both of those read as a gunshot. Instead everything
       is mid-range, soft-edged and gliding downward:
         1. main formant  - narrow band gliding ~880Hz -> ~190Hz, fluttering
         2. upper formant - a second, thinner resonance for the squeak
         3. squeeze       - lowpassed air being pushed out
         4. droplets      - a few quiet, dull spatters afterwards
       All of it runs through a 2.4kHz lowpass bus so nothing can crack. */
    smash(type, combo) {
      const s = SPECIES[type] || SPECIES.ant;
      this.buzz(s.heavy ? 18 : 10);
      if (!this.ready) return;

      const step = Math.min(combo || 0, 12);
      const climb = 1 + step * 0.028;                  // combo lifts the pitch
      const p = s.pitch * climb;
      const dur = s.dur;
      const j = 0.88 + Math.random() * 0.28;           // per-hit variation

      const bus = this._squishBus(s.cutoff, 0.9 * s.gain, s.wet);

      // Chitin giving way first: dry low grains, only on armoured bugs.
      if (s.crackle) {
        this._grains(bus, { count: s.crackle, durMin: 0.007, durMax: 0.018,
          f0: 420 * p, f1: 240 * p, q: 9, gain: 0.14, spread: 0.045 });
      }

      // 1. the squelch itself - resonance glides down and wobbles as it goes
      this._wet(bus, { dur: dur, f0: s.f0 * p * j, f1: s.f1 * p, q: s.q, gain: 0.55,
        attack: s.attack, rate: 0.45 + Math.random() * 0.2,
        flutter: s.flutter, wobble: [7, 15], wobbleDepth: 0.26 });

      // 2. thinner resonance on top - the squeak of the body folding
      this._wet(bus, { dur: dur * 0.78, f0: s.f0 * 1.5 * p * j, f1: s.f1 * 1.8 * p, q: s.q + 7, gain: 0.26,
        attack: s.attack * 1.4, delay: 0.014, rate: 0.6 + Math.random() * 0.25,
        flutter: [s.flutter[0] + 6, s.flutter[1] + 18], wobble: [9, 20], wobbleDepth: 0.3 });

      // 3. air being squeezed out
      this._wet(bus, { dur: dur * 0.7, type: 'lowpass', f0: s.f0 * 0.95 * p, f1: 260 * p, q: 1, gain: 0.20 * s.body,
        attack: 0.03, rate: 0.32 + Math.random() * 0.12 });

      // 4. bubbles bursting through the wet part - the texture layer
      this._grains(bus, { count: s.bubbles, durMin: 0.012, durMax: 0.034,
        f0: 1500 * p, f1: 520 * p, q: 22, gain: 0.075 * s.wet, spread: dur * 0.8, delay: 0.02 });

      // 5. dull spatter landing after the squelch
      this._grains(bus, { count: s.drops, durMin: 0.05, durMax: 0.1,
        f0: 900 * p, f1: 330 * p, q: 15, gain: 0.10 * s.wet, spread: 0.13, delay: 0.05 });
    }

    /* First hit on an armoured bug: a dull shell knock, not a kill. Beetles
       rap harder and higher than soldier ants. */
    thud(type) {
      this.buzz(8);
      if (!this.ready) return;
      const beetle = type === 'beetle';
      const bus = this._squishBus(beetle ? 1800 : 1300, 0.85, 0.5);
      this._grains(bus, { count: beetle ? 4 : 2, durMin: 0.006, durMax: 0.014,
        f0: beetle ? 900 : 520, f1: beetle ? 480 : 260, q: 8, gain: 0.16, spread: 0.03 });
      this._wet(bus, { dur: 0.10, f0: beetle ? 560 : 400, f1: beetle ? 300 : 210, q: 7, gain: 0.40,
        attack: 0.008, rate: 0.6 });
      this._wet(bus, { dur: 0.07, type: 'lowpass', f0: 700, f1: 300, q: 1, gain: 0.22, attack: 0.01, rate: 0.4 });
    }

    /* Wasp: harsh, angry, obviously a mistake. */
    sting() {
      this.buzz([30, 40, 60]);
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(90, t + 0.45);

      const lfo = this.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 42;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 55;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.42, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.45);

      osc.connect(g); g.connect(this.master);
      osc.start(t); lfo.start(t);
      osc.stop(t + 0.47); lfo.stop(t + 0.47);
    }

    lifeLost() {
      this.buzz(70);
      if (!this.ready) return;
      this._tone('square', 400, 120, 0.28, 0.22);
    }

    /* 1UP: a bright, unmistakably good four-note rise. */
    oneUp() {
      this.buzz([15, 40, 15]);
      if (!this.ready) return;
      [523, 659, 784, 1047].forEach((f, i) => {
        this._tone('square', f, f * 1.01, 0.13, 0.16, i * 0.075);
      });
    }

    combo(level) {
      if (!this.ready) return;
      const base = 520 + level * 90;
      this._tone('square', base, base * 1.02, 0.07, 0.16);
      this._tone('square', base * 1.5, base * 1.52, 0.09, 0.14, 0.07);
    }

    gameOver() {
      this.buzz([60, 60, 120]);
      if (!this.ready) return;
      this._tone('sawtooth', 380, 300, 0.18, 0.20, 0);
      this._tone('sawtooth', 300, 220, 0.20, 0.20, 0.16);
      this._tone('sawtooth', 220, 90, 0.55, 0.22, 0.34);
    }

    countdown(last) {
      if (!this.ready) return;
      this._tone('sine', last ? 880 : 520, last ? 900 : 530, last ? 0.22 : 0.10, 0.2);
    }

    click() {
      this.buzz(6);
      if (!this.ready) return;
      this._tone('square', 660, 420, 0.05, 0.14);
    }
  }

  global.AudioFX = new Audio();
})(window);
