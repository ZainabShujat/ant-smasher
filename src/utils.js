/* Small math / random helpers shared by every module. */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const chance = (p) => Math.random() < p;

  /* Angle helpers: angles are radians in canvas space (y grows downward). */
  const wrapAngle = (a) => {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  };
  const angleTowards = (from, to, maxStep) => {
    const d = wrapAngle(to - from);
    return from + clamp(d, -maxStep, maxStep);
  };

  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  /* Cheap deterministic value noise, used for wandering and wood grain. */
  function noise1(x, seed) {
    const s = Math.sin((x + (seed || 0) * 37.13) * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }
  function smoothNoise(x, seed) {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(noise1(i, seed), noise1(i + 1, seed), u);
  }

  const now = () => performance.now();

  global.U = { TAU, clamp, lerp, rand, randInt, pick, chance, wrapAngle, angleTowards, dist2, noise1, smoothNoise, now };
})(window);
