# Ant Smash

A browser recreation of the classic tap-the-bugs arcade game. Plain HTML, CSS,
JavaScript and Canvas — no frameworks, no build step, no backend.

All artwork is generated procedurally at runtime (wood planks, HUD strip and the
insects themselves are drawn with Canvas paths), so the repo ships no third-party
assets.

## Run it

https://zainabshujat.github.io/ant-smasher/

## Status

**Phases 1 and 2 complete, plus the main menu.**

- Wooden plank play surface + wooden HUD strip (score, combo, pause, 3 lives)
- Main menu with leaf buttons (play / scores / how to play) over a live
  background of crawling ants
- Five species, each with its own speed, points, toughness and splat colour:

  | Bug | Points | Hits | Notes |
  |---|---|---|---|
  | Ant | 1 | 1 | the staple target |
  | Fast ant | 2 | 1 | small, quick, weaves |
  | Soldier ant | 3 | 2 | large and slow |
  | Beetle | 3 | 2 | armoured, green splat |
  | **Wasp** | — | — | **never smash it — costs a life** |

- The wasp is built for instant recognition on a small screen: ~1.7x-2.2x the
  size of a normal ant, hazard glow, radiating yellow bristles, four spread
  wings, banded abdomen and a stinger, plus erratic darting flight (fast darts
  in near-arbitrary directions, twitchy hovers, sudden reversals) that looks
  nothing like an ant crawl. It leaves on its own after ~7 s
- Wasp uses a strict hitbox while targets get a forgiving one, so a tap aimed
  at an ant beside a wasp can never be misread as a wasp hit
- Squash animation (~200 ms), debris particles, score popups, screen shake,
  red screen flash and a spin-away reaction when the wasp is hit
- Splat marks hold for ~3 s then fade out over ~4 s (max 44 on screen), so the
  plank never fills up with stains
- Combo counter: every 3 consecutive kills raises the multiplier, up to x5.
  A miss, a wasp hit or an escaped ant breaks it
- Lives lost when an ant escapes off the bottom or the wasp is smashed;
  game over at zero lives, with restart and main-menu buttons
- Difficulty ramps: spawn rate, speed, simultaneous bugs and the odds of the
  nastier species all grow over time

- Synthesised audio (Web Audio, no sound files): angry wasp sting, life lost,
  combo blips, game over, UI clicks. Sound and vibration toggles live behind
  the menu gear and persist
- The squish deliberately has **no sharp transient and no low boom** - a click
  plus a thump is what makes a synthesised hit read as a gunshot. Instead it is
  all mid-range and soft-edged: a narrow resonance gliding 880 Hz down to
  ~185 Hz with its amplitude fluttering (the gurgle), a thinner squeak on top,
  lowpassed air being squeezed out, and a few dull spatters afterwards - the
  whole thing routed through a 2.4 kHz lowpass so nothing can crack. Measured
  high-frequency energy ratio 0.01 vs 0.35 for a click-and-thump hit
- Every species squishes differently - fast ants are high, thin and quick;
  soldier ants are low, long and gooey; beetles crackle before they burst:

  | Bug | length | avg pitch | texture peaks |
  |---|---|---|---|
  | Fast ant | 203 ms | 1106 Hz | 8 |
  | Ant | 208 ms | 752 Hz | 11 |
  | Beetle | 262 ms | 584 Hz | 12 |
  | Soldier ant | 290 ms | 412 Hz | 12 |

- Wetness comes from four texture layers on top of the main squelch: a damped
  feedback comb (the hollow, liquid ring of a small cavity), an LFO wobbling
  the resonant frequency so the pitch slides like moving liquid, scattered
  bubble grains bursting through the body of the sound, and dull spatter
  landing afterwards. Armoured bugs add dry chitin grains before the burst
- Phone feel: 3-2-1 countdown before the first bug, score that pops on every
  hit, red danger glow along the bottom edge when a bug is about to escape or
  you are on your last life, haptic buzz per event, bigger tap forgiveness on
  touch devices (22px vs 14px), HUD that scales with screen height, safe-area
  insets, `100dvh` and locked scrolling / zoom / rubber-banding

Classic mode is feature-complete. Not yet built: custom photo mode.

## Performance

Body gradients are cached per sprite (they live in fixed local space), so a
frame with 30 mixed insects costs ~3.9 ms on a 375x812 viewport - roughly a
quarter of the 60fps budget. Splats are capped at 44 and expire; particles are
short-lived; nothing per-insect touches the DOM.

## Structure

```text
ant-smash/
├── index.html        markup + overlays (game over, pause)
├── style.css         overlay / button styling, full-viewport canvas
├── src/
│   ├── utils.js      math, RNG and noise helpers
│   ├── wood.js       procedural plank + HUD strip textures
│   ├── audio.js      Web Audio synthesis, mute + haptics settings
│   ├── insects.js    insect type registry, entity class, ant rendering
│   ├── effects.js    particles, splat layer, score popups, screen shake
│   ├── input.js      mouse/touch normalisation into canvas coordinates
│   └── game.js       game state, spawning, collision, scoring, HUD, loop
└── assets/           reserved for optional future art/audio
```

Adding an insect type means adding one entry to `TYPES` in `src/insects.js`
(points, hp, size, speed, colours, and whether it is a valid target).

## Notes

- Splat marks are baked into a dedicated offscreen canvas, so old marks cost one
  blit per frame rather than growing the draw list.
- Rendering is DPR-aware and re-generates textures on resize/orientation change.
- The page disables scrolling/zoom gestures so mobile taps never scroll the page.
