# Ant Smash

A browser recreation of the classic tap-the-bugs arcade game. Plain HTML, CSS,
JavaScript and Canvas — no frameworks, no build step, no backend.

All artwork is generated procedurally at runtime (wood planks, HUD strip and the
insects themselves are drawn with Canvas paths) and every sound is synthesised
with the Web Audio API, so the repo ships no third-party assets.

## Run it

https://zainabshujat.github.io/ant-smasher/

Locally, any static server works — for example `python -m http.server 5173`,
then open <http://localhost:5173>.

## Architecture

The engine does not hard-code Classic. A **config** describes a whole run - which
species spawn, how each one behaves, and the global knobs - and Classic is simply
the default config:

```text
CLASSIC  ->  DEFAULT CONFIG  -                               >--  SAME ENGINE
CUSTOM   ->  CUSTOM CONFIG   -/
```

`src/config.js` owns the config shape, validation, persistence, the chaos
randomiser and the difficulty rating. `src/customui.js` is a UI over that config
and never touches the engine - it edits an object and calls `game.startGame(cfg)`.
VS mode later means handing the same engine two configs. The insect creator was
built exactly this way - a created species is just another entry in
`config.insects` carrying a blueprint, registered into the type registry before
a run - so it needed no engine changes at all.

Per-species size/speed/spawn-weight are *multipliers* on that species' own
defaults, so configs stay meaningful if a species is retuned later.

## Status

Classic, Custom Game and the insect creator are complete. Not yet built: VS,
saved/shareable swarms.

### Custom Game

Every species can be toggled, and each opens an editor with a live preview:
size (0.5x-2x), speed (0.4x-2.5x), health (1-5 hits), points (1-20), spawn
frequency, and movement (straight / wandering / erratic). Global settings cover
starting lives, spawn rate, speed and max insects. Configs persist to
`localStorage`, and **CHAOS** rolls a random-but-playable one.

Guard rails stop an impossible game: everything is clamped to sane ranges, at
least one target species is always enabled, and chaos keeps tiny or fast bugs
to one hit.

### Insect creator

**+ CREATE INSECT** builds a new species from parts, and a created insect is a
first-class citizen: it is registered as a real entry in the type registry, so
the engine cannot tell it apart from a built-in one. It spawns on the ramp,
crawls or flies, takes hits, squashes, leaves a corpse and a splat in its own
colour, and counts toward the difficulty rating.

| Choice | Options |
|---|---|
| Body | ant, beetle, spider, fly, roach, blob |
| Legs | 0, 2, 4, 6, 8, 12 |
| Wings | none, bee, fly (+ flies or crawls) |
| Eyes | 1, 2, 4, 8 |
| Colour / splatter | 10 swatches each |
| Face photo | any local image |
| Role | smash me, or **hazard** |
| Stats | size (0.5x-2x), speed, hits to kill (1-6), points, spawn frequency, movement |

All of that lives on the one creator screen - appearance and stats together -
with a preview that rescales as you drag the size slider.

A created **hazard** costs a life exactly like the wasp, and inherits the same
warning language - the pulsing glow and radiating bristles - so a player can
still tell at a glance what not to touch.

Photos are read with the File API, downscaled to 128px on a canvas and stored
as a data URL in the config. **Nothing is uploaded** - the picture never leaves
the device. A whole config with a photo is about 5 KB in `localStorage`, and
anything that is not a real `data:image` URL is rejected on load.

### Difficulty rating

Rather than guess with a formula, the rating **runs the real entity simulation
headless** with a bot player (human-ish 0.33 s tap cadence, divided attention,
misses more on small and fast bugs, and slows down as the board fills up).

It measures *mistake pressure* rather than time-to-death: time-to-death turned
out bimodal - the bot either keeps up forever or collapses - which produced a
cliff between "casual" and "cursed" with nothing in between. The score blends
how much of the time targets are loose near the bottom edge (smooth) with
escapes and hazard hits (sharp), and expected survival falls out of the
config's own life count. Six runs of 90 s cost about 25 ms, so it updates live
as sliders move. Sample ratings:

| Config | Score | Rating |
|---|---|---|
| Classic | 0.2 | CASUAL |
| Spawn rate 2x | 1.7 | CASUAL |
| Everything 2x | 10.8 | HARD |
| 2x + small + fast | 27.3 | CURSED |
| 1 life, 5 hits, max everything | 50.2 | CURSED |

### Bugs

| Bug | Points | Hits | Behaviour |
|---|---|---|---|
| Ant | 1 | 1 | the staple target, wandering crawl |
| Fast ant | 2 | 1 | small, quick, weaves |
| Housefly | 2 | 1 | darts and hovers, red compound eyes |
| Mosquito | 3 | 1 | tiny, spindly, very fast |
| Soldier ant | 3 | 2 | large and slow |
| Beetle | 3 | 2 | armoured, green splat |
| Cockroach | 4 | 2 | scuttles in bursts, then freezes |
| Spider | 6 | 3 | eight legs, dashes and stops |
| **Goliath beetle** | 25 | **5** | huge, slow, **only one at a time** |
| **Wasp** | — | — | **never smash it — costs a life** |
| 1UP bubble | — | 1 | green floating bonus, see below |

Species ramp in with difficulty: pure ants for the first ~15 s, then fast ants,
flies and wasps, then soldiers, mosquitoes and beetles, goliaths from about
45 s, and finally roaches and spiders once things are properly chaotic.

**Size varies a lot.** Each species spawns across a wide size range (an ant is
anywhere from 28 to 50 px), and from difficulty 1.2 onward any ordinary species
can throw up a **brute**: 1.45x-1.85x the size, two extra hits, noticeably
slower, and worth 3.5x the points. The chance climbs from 5% to 22% as things
heat up, so late runs regularly contain 4- and 5-hit monsters.

The **goliath beetle** is the set piece - about 3.5x an ant, five hits, 25
points, and never more than one on screen. While it is out the rest of the
spawns slow to a drip (interval x1.9), so it plays as a siege you chip down
while smaller bugs keep trickling past. Multi-hit bugs now show **cracks that
spread across the body** as they take damage, so you can see what is nearly
dead.

### Rules

- Lives start at 3 and cap at 5. You lose one when a bug escapes off the bottom
  or when you smash the wasp; you gain one by popping a 1UP bubble
- **1UP bubble**: past 400 points a glowing green bubble drifts in every 22–40 s,
  but only while you are below 5 lives and only one at a time. Popping it grants
  a life; letting it float past costs nothing and it never breaks your combo
- Combo: every 3 consecutive kills raises the multiplier, up to x5. A miss, a
  wasp hit or an escaped bug breaks it
- One life at a time: after any loss there is a 0.9 s grace window, so a
  panicked double-tap on two wasps cannot take two lives in the same breath.
  The wasp always costs exactly one life - it only ends a run if it was the last
- Difficulty ramps: spawn rate, speed, simultaneous bugs and the odds of the
  nastier species all grow over time

### The wasp

Built for instant recognition on a small screen: ~1.7x–2.2x the size of a normal
ant, hazard glow, radiating yellow bristles, four spread wings, banded abdomen
and a stinger, plus erratic darting flight (fast darts in near-arbitrary
directions, twitchy hovers, sudden reversals) that looks nothing like a crawl.
It leaves on its own after ~7 s. Targets get a forgiving hitbox while the wasp
gets a strict one, so a tap aimed at an ant beside a wasp can never be misread.

### Feedback

- Squash animation (~200 ms), then the flattened body **stays on the wood for
  ~10 s** (full opacity for 7.5 s, then a 3 s fade) and piles up with everything
  else you have killed
- Big splatter: a ragged blob, five tapering streaks and sixteen thrown
  droplets, in each species' own colour, on the same ~10 s life
- Score pops, combo readout, screen shake, red screen flash on damage, and a red
  danger glow along the bottom edge when a bug is about to escape

### Audio

Everything is synthesised — no sound files. The squish deliberately has **no
sharp transient and no low boom**; a click plus a thump is what makes a
synthesised hit read as a gunshot. Instead it is mid-range and soft-edged: a
narrow resonance gliding downward with its amplitude fluttering (the gurgle), a
thinner squeak on top, lowpassed air being squeezed out, and dull spatters
afterwards — all routed through a lowpass bus so nothing can crack. Measured
high-frequency energy ratio 0.01, versus 0.35 for a click-and-thump hit.

Wetness comes from four texture layers: a damped feedback comb (the hollow ring
of a small cavity), an LFO wobbling the resonant frequency so the pitch slides
like moving liquid, bubble grains bursting through the body of the sound, and
spatter landing afterwards. Armoured bugs add dry chitin grains before the burst.

Every species squishes differently:

| Bug | length | avg pitch |
|---|---|---|
| Mosquito | ~120 ms | highest, thinnest |
| Fast ant | 203 ms | 1106 Hz |
| Ant | 208 ms | 752 Hz |
| Beetle | 262 ms | 584 Hz |
| Soldier ant | 290 ms | 412 Hz |

Plus a wasp sting, life lost, combo blips, a four-note 1UP rise, game over and
UI clicks. Sound and vibration toggles live behind the menu gear and persist.

Levels are set so the smash dominates. The master bus runs into a compressor
(-25 dB threshold, 14:1) so the output can be pushed hard without clipping, but
that same compression drags quiet sounds back up - so the combo chime, countdown,
game over and UI clicks sit on a separate bus **after** the compressor, where
their levels actually hold. Measured against a smash:

| Sound | relative level |
|---|---|
| Wasp sting / life lost / 1UP | about equal (these are events that matter) |
| UI click | -11.5 dB |
| Countdown | -14.9 dB |
| Game over | -15.9 dB |
| Combo chime | -18.4 dB |

Six kills landing at once still peak below 1.0 with zero clipped samples.

### Phone feel

3-2-1 countdown before the first bug, haptic buzz per event, bigger tap
forgiveness on touch devices (22px vs 14px), HUD that scales with screen height,
safe-area insets, `100dvh`, and locked scrolling / zoom / rubber-banding.

## Performance

Everything that lingers is pre-baked into a cached sprite and blitted, rather
than re-pathed every frame:

- **Corpses** share one sprite per species + size bucket, cropped tight to the
  flattened body (a square canvas would be ~90% empty pixels, and blit cost is
  pixel area). Variety comes from rotation and random mirroring
- **Splats** use five random baked variants per colour and size bucket
- **Body gradients** are cached per sprite, since they live in fixed local space

Measured draw time per frame at a 375x812 viewport:

| Scene | Before baking | Now |
|---|---|---|
| 12 live bugs + 40 stains (busy late game) | 4.88 ms | **1.43 ms** |
| 16 live bugs + 80 stains (both caps) | 41.6 ms | **2.93 ms** |

## Structure

```text
ant-smash/
├── index.html        markup + overlays (menu, options, game over, pause)
├── style.css         overlay / button styling, full-viewport canvas
├── src/
│   ├── utils.js      math, RNG and noise helpers
│   ├── wood.js       procedural plank + HUD strip textures
│   ├── audio.js      Web Audio synthesis, per-species squish, settings
│   ├── config.js     run configs, chaos, difficulty simulation
│   ├── customui.js   Custom Game screen (edits a config, not the engine)
│   ├── insects.js    type registry, entity class, sprite + corpse rendering
│   ├── effects.js    particles, splats, corpses, popups, shake, flash
│   ├── input.js      mouse/touch normalisation into canvas coordinates
│   └── game.js       game state, spawning, collision, scoring, HUD, loop
└── assets/           reserved for optional future art/audio
```

Adding an insect means one entry in `TYPES` in `src/insects.js` (points, hp,
size, speed, colours, splat colour, movement style, and whether it is a valid
target), one draw function, one weight in `weightsFor`, and one sound profile in
`SPECIES` in `src/audio.js`.
