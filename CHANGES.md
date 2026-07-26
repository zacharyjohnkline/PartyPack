# Round 11 — big screen back to true world scale

Changed: `js/games/rockcandyrally.js`, plus version bumps in `index.html`
(main.js?v=13) and `js/main.js` (rally import ?v=9). **Replace all three
files.**

The 1.45× big-screen character boost from round 10 turned out to be an
overcorrection once the mobile scale settled — the big screen rendered
racers larger than their surroundings warranted. It's removed: both
screens now draw characters at identical world-proportional scale
(SPRITE_ART_H = 99 relative to walls, water and track everywhere); only
the camera zoom differs between the two. The drawScene charScale hook
remains in the code should a between-scale nudge ever be wanted.

Verified: host character footprint measures exactly the pre-boost value,
no other rendering changes, full suite green.

---

# Round 10 — shirt-tint hardening, big-screen scale, 2.5D walls & gate

Changed: `js/games/rockcandyrally.js`, plus version bumps in `index.html`
(main.js?v=12) and `js/main.js` (rally import ?v=8). **Replace all three
files.**

**Mobile shirt colour — three real defects fixed.** The round-9 fix was
correct but incomplete; each of these could produce untinted shirts on
phones:
1. *Illustrator's export formats.* The tint matcher only recognised
   `#FF00FF` / `#CC00CC` literally, but Illustrator (especially with
   Internal-CSS styling) writes shorthand `#f0f` / `#c0c`, and sometimes
   `rgb(255,0,255)` or keyword `magenta`. All forms now match. (This is
   the most likely culprit — if your shirts were showing raw magenta,
   this was it.)
2. *Safari's blob bug.* The raster pipeline revoked each SVG's blob URL
   in onload; Safari (iPhones) can silently drop such images from later
   drawImage calls. Sprites now load via data: URLs — no blobs at all.
3. *Lost messages.* Seat colours rode on a single phase message; if a
   phone missed it, every rival wore ghost-white forever. The colour list
   now also rides along on a snapshot every 2 seconds, so phones
   self-heal.

**Big-screen character scale.** The host camera zooms out to keep the
whole field in frame, which kept racers small no matter the art size.
The big screen now draws characters at 1.45× world scale (a standard
racing-game cheat — the sim is untouched). Phones were already right.

**2.5D walls.** Climbing walls are extruded slabs: a lit top surface
reaching back across all the lanes, with lane separator lines and the
front brick face below.

**2.5D start/finish.** A checkered line is painted across the full track
surface, lane by lane, straddling the seam — plus the flag post on the
near edge and a matching pennant post up on the far edge.

Verified: Illustrator-style `#f0f` internal-CSS test file tints
correctly on the phone portrait (zero magenta), blue rival shirt renders
on a red player's phone camera via the data-URL path, host characters
measure ~2.1× the previous pixel footprint, wall slab tops and both
checker colours of the gate present in screenshots, sim suite unchanged.

---

# Round 9 — 2.5D lanes, custom-art tuning, phone shirt-colour fix

Changed: `js/games/rockcandyrally.js`, plus version bumps in `index.html`
(main.js?v=11) and `js/main.js` (rally import ?v=7). **Replace all three
files.** New art file to add: `assets/rally/shelly_idle_0.svg`.

**2.5D depth lanes.** The track is now a surface ribbon rising behind the
front edge, with faint lane separators, and every seat races in its own
depth lane: back lanes sit higher on screen, render slightly smaller, and
are painted back-to-front, with a soft contact shadow under each racer.
With a full party nobody can hide inside anyone else. This is entirely
visual — the sim is unchanged and perfectly fair; lanes come from seat
number, water pools reach back across the ribbon, and the phone's leap
zone and marker arrow sit in YOUR lane.

**Custom art tuning.** Characters render 1.5× larger (SPRITE_ART_H
66 → 99). New `idle` state wired: name it `<hero>_idle_0.svg` (add _1 for
a slow breathing loop — it ping-pongs at a gentle rate). Idle shows while
standing at the start line during the countdown and after crossing the
finish (DONE prefers `done` art, then `idle`, then a held run frame).

**Phone shirt colours fixed.** The controller never received the other
players' colours — every racer on the phone camera wore a ghost-white
placeholder shirt (the big screen had the real map, which is why it
worked there). Phase messages now carry the seat list (name + colour), so
phones tint every racer correctly, custom art and vector alike.

Verified in-browser: red tinted shirt present on the phone camera, idle
art at the line mid-countdown, 1.5× sprite footprint, surface ribbon
rendered, zero magenta leakage, and the full sim/bot suite unchanged.

---

# Round 8 — custom SVG character art (Rock Candy Rally)

Changed: `js/games/rockcandyrally.js`, plus version bumps in `index.html`
(main.js?v=10) and `js/main.js` (rally import ?v=6). **Replace all three
files**, then add your art:

**WHERE THE ART GOES: create a folder `assets/rally/` next to
`index.html` and drop the svg files straight in** — for the turtle:
`shelly_run_0/1/2.svg`, `shelly_swim_0/1/2.svg`, `shelly_climb_0/1/2.svg`,
`shelly_air_0.svg`, `shelly_slide_0.svg`, `shelly_dizzy_0.svg`.

How it works:
- The loader probes for files per hero, per state, and counts consecutive
  frames from `_0`. Whatever exists overrides the built-in vector art for
  exactly that hero+state; everything else (gecko, finn, zippy, and any
  missing state) stays vector. Delete a file and the vectors return.
- Missing states fall back sensibly: DONE → run contact frame,
  STALL → dizzy, FALL → air.
- Shirt tinting: `#FF00FF` → the player's colour, `#CC00CC` → its darker
  trim shade, replaced in the svg text before rasterising, cached per
  player colour. Case-insensitive, works with attribute or style fills.
- 3-frame cycles play ping-pong (0-1-2-1-…); run cadence is
  distance-driven so all heroes stride at the same rate.
- Sprite slides don't spin — the frame settles onto the hill's slope, so
  the turtle's butt-slide leans with the terrain.
- The run bob now lives in the art (the engine's procedural bob is off for
  sprite frames); swim/dizzy rotations are still applied by the engine, so
  frames stay drawn upright as discussed.
- The pick-card portraits use run frame 1 and repaint themselves when the
  art finishes loading.
- `SPRITE_V` (top of rockcandyrally.js) is the cache-buster for the art
  itself: bump it whenever you REPLACE an svg phones have already seen.
- `SPRITE_ART_H` (same spot) sets how tall the artboard renders in the
  world (66px). If your characters come out too small or too large next
  to the vector heroes, nudge this one number.

Verified end-to-end with stand-in svgs built to the same spec (120×168
artboard, sentinel magentas, feet-line anchoring): sprite drawn in-race,
zero magenta leakage, shirts tinted per player, portraits repaint on both
screens after async load, vector heroes coexist, and the sim/bot suite is
unchanged. The stand-ins are not shipped — your art is the only art.

---

# UI round 7 — glass character cards in Rock Candy Rally

Changed: `css/rockcandyrally.css`, plus the version bump in `index.html`
(rally css?v=6). **Replace both files** — no JS changed this round.

The character-select cards (phone and big screen) are now frosted glass —
translucent white with a backdrop blur and a soft white border — instead
of opaque white. The player-colour tint glows through them, card text is
white with a soft shadow, and the selected card brightens slightly under
its gold ring. The point of it all: Zippy is white, and on an opaque white
card he simply vanished; against the tinted glass every character reads
clearly, and the cards no longer fight the colour background at full
contrast.

Pixel-verified: opaque white inside the phone's card area dropped from
~132k pixels to ~800 (Zippy's fur and text highlights), replaced by the
tint-through-glass blend.

---

# UI round 6 — Gumdrop Guardians gets the ⌂ home button

Changed: `js/games/gumdropguardians.js`, `css/gumdropguardians.css`, plus
version bumps in `index.html` (main.js?v=9, gumdrop css?v=7) and
`js/main.js` (gumdrop import ?v=3). **Replace all four files.**

The host's ⌂ End-game button from Rock Candy Rally, now in Gumdrop
Guardians: same dark pill styling, sitting in the status row just to the
right of the health/XP meter, in normal layout flow. Host phone only —
other players never see it — and it routes through the shell's confirm
dialog ("End this game for everyone…?"). The shell header's own End-game
button hides while Gumdrop runs (and comes back on exit), so there's
exactly one way out and it's nowhere near the backpack.

Verified in-browser: visible for the host, hidden for guests, click
reaches the shell's exit handler, header copy suppressed during play and
restored on teardown — plus the full Rally suite still green.

---

# UI round 5 — Rock Candy Rally full screen + Gumdrop Guardians host fixes

Changed: `js/games/rockcandyrally.js`, `css/rockcandyrally.css`,
`js/games/gumdropguardians.js`, `css/gumdropguardians.css`, plus version
bumps in `index.html` (main.js?v=8, rally css?v=5, gumdrop css?v=6) and
`js/main.js` (rally import ?v=5, gumdrop import ?v=2).
**Replace all six files.**

**Rock Candy Rally goes full screen.** The shell's name bar hides while
the game runs (it comes back the moment the game exits) — your racer and
the phone's colour tint are the identity. The game pads itself below the
phone notch. Since the shell's End-game button lived in that bar, the
party host now has a ⌂ button inside the game instead: in the HUD row
during a race (sitting in normal flow next to ⏭ End-race, so neither can
ever cover game information — the old End-race button was absolutely
positioned and could land on top of the item text), and a quiet
"⌂ End game for everyone" link on the character-select screen. Both go
through the shell's own confirm dialog.

**Gumdrop Guardians: the host phone picks the match size.** The 1v1…6v6
buttons used to exist only on the big screen. The host's phone now shows a
"Match size" row on the hero-select screen (host only — other phones never
see it), with the robot-fill note, kept in sync both ways: tap on the
phone or click on the big screen and both update.

**Gumdrop Guardians: backpack moved away from End game.** The 🎒 shop
button sat at the top-right of the status row, directly under the shell's
End-game button — a mis-tap magnet. It now sits at the top-LEFT, the full
width of the screen away.

All verified in-browser: header hidden + game at y=0 full height, ⌂
click reaches the shell's exit handler, size picker host-only with all six
options sending the right message, and every Rally timing cue and sim test
still green.

---

# Rock Candy Rally — round 4

Changed: `js/games/rockcandyrally.js`, `css/rockcandyrally.css`, plus version
bumps in `index.html` (main.js?v=7, rally css?v=4) and `js/main.js`
(game import ?v=4). **Replace all four files.**

**The timing coach.** Every timing window in the game now has a visual cue
on the phone, so nothing is guesswork:

- **Rocket start** — a red ring pulses on the JUMP button during the
  countdown ("Hold it… jump right on GO!"), then flashes green exactly on
  GO, with a vibration buzz on phones that support it.
- **Wall leap** — as you approach a wall, the sweet launch zone is painted
  right on the track in gold (bright pulsing core = perfect leap), with a
  bouncing "⤴ JUMP" marker at the ideal spot (120px out — the same number
  the sim scores against).
- **Wall climb** — while climbing, an approach ring on the JUMP button
  closes onto a target circle exactly on the beat (driven by the same sim
  clock the scoring uses, synced via snapshots). The target flashes gold
  and the phone buzzes softly when the perfect window is open — wider for
  Grip the gecko, matching his forgiving beat window.
- **Swimming** — a one-second stroke dial around the JUMP button: a green
  arc marks the keep-your-combo window (0.34–0.85s between strokes), and a
  needle sweeps from your last tap. Tap while the needle is in the green.
  The in-water bar now shows your combo level (×1–×8).
- **Zippy's momentum press** — the POWER button glows gold while Zippy is
  airborne with power ready ("Press POWER as you land!"), and the phone
  buzzes at touchdown — the cue to press for the 1.5× landing boost.

The hint line under the position chip narrates whichever cue is active.
All cues verified in-browser (ring, dial and zone pixels probed on the
actual canvases, hint text asserted per state).

---

# Rock Candy Rally — round 3

Changed: `js/games/rockcandyrally.js`, `css/rockcandyrally.css`, plus version
bumps in `index.html` (main.js?v=6, rally css?v=3) and `js/main.js`
(game import ?v=3). **Replace all four files.**

**Real characters.** The emoji-in-a-circle racers are gone — Shellsworth,
Grip, Finn and Zippy are now fully drawn vector animals (Gumdrop-style
path art): turtle with a shell backpack, gecko with bulgy eyes and a curly
tail, a fish with lips, fins and little legs, a rabbit with ears, whiskers
and buck teeth. Every racer wears a racing shirt in their PLAYER colour
(white stripe, collar, hem), with per-state poses, two-frame animation,
and expressions (X-eyes when dizzy, ^^ on the finish line). Portraits of
your own character — in your colour — appear on the pick cards, both on
the big screen and your phone. To supply your own art later, the two hooks
are `drawRacer()` and `paintPortrait()` in rockcandyrally.js.

**Three cups, twelve courses.** Mario-Kart-style cup select: Sugar Cup
(★☆☆ — Gumdrop Meadows, Lollipop Loop, Soda Lakes, Marshmallow Marsh),
Fizzy Cup (★★☆ — Rock Candy Cliffs, Sherbet Shores, Cola Canyon, Taffy
Twists), Sour Cup (★★★ — Sour Summit, Jawbreaker Gorge, Licorice Ladder,
Gobstopper Gauntlet). Each course has its own palette and layout;
difficulty (wall heights, chasm widths, water lengths) climbs cup by cup.
The party host picks the cup on their phone from the character-select
screen; the big screen shows all three cups with the selection highlighted.

**Ledge flicker fixed.** The big-screen terrain silhouette was clamped to
[0, track-length], so on a looping course any ledge past the seam vanished
until the camera window moved — and samples weren't grid-aligned, so edges
shimmered while the view zoomed. It now samples the full camera window
(ground height wraps) on a fixed grid.

**Characters persist.** "Play again" keeps everyone's character (coins,
upgrades and points still reset for a fresh championship). Everything only
fully clears when the host exits to the game menu.

**Phone UI overhaul.** Each phone is tinted with a gradient of that
player's colour; the game never overlaps the name bar at the top (this was
a real bug — the game root was absolutely positioned over the whole
screen); character cards show your portrait with a gold selected tick; the
pit stop is a proper 2×2 card grid with level pips, priced buy buttons,
a coin chip and a draining timer bar. Big-screen pit stop shows styled
per-player cards flipping to "Ready", and results/podium/countdown got
matching polish.

---

# Gumdrop Guardians — what changed

Every item from your notes, and where it lives. All changes are inside
`js/games/gumdropguardians.js` unless noted; `css/gumdropguardians.css` picked
up styling for the new building list. No other game was touched.

Run `node test-gg.mjs` (127 checks) and `node stress-gg.mjs` to verify.

---

## Creep waves

**Five per lane, and no more getting stuck behind the base.**

The stuck creeps were not a collision-detection problem — your collision code
is untouched, exactly as you asked. The bug was that waves spawned *at the
lane's first waypoint, which is the centre of the base*. Half the column
appeared inside the keep's collision radius and got squeezed out the back one
creep at a time.

Waves now muster at `laneMuster()`: walk out along the lane until clear of the
keep wall, then form up there in a two-abreast wedge. Nothing is ever born
inside the base. Tested directly — 0 creeps inside either keep, on every lane.

**Six seconds between waves** (`SPAWN_EVERY = 60`), five per lane
(`LANE_SIZE = 5`), on all three lanes for both sides — 15 per side per wave.

### One judgement call you should know about

Six seconds with five per lane is **five times** the old spawn rate (was 10
units per 20 s; now 15 per 6 s). I built it as asked and then measured: the
board settled at **~600 units** and stayed there. That is a solid wall of
creeps roughly one unit every 20 px of lane — which cuts against your actual
goal of the board not being overrun.

So there is a valve: `LANE_CAP = 20`. A lane already holding that many of your
creeps skips its next column and tries again in six seconds. In a moving lane
you will never see it fire. In a deadlocked one it is the difference between a
battle and a traffic jam. Density now sits at **~140, peaking at 183**, and the
tick cost dropped 4× as a side effect.

**If you want the bigger brawl, raise or delete `LANE_CAP`** — it is one
constant near the top of the file with a comment explaining it. Nothing else
depends on it.

---

## Economy

| | Before | After |
|---|---|---|
| Gear tier I | 50 | **120** |
| Gear tier VIII | 260 | **1,828** |
| One full gear line | 1,140 | **6,560** |
| All four lines | 4,560 | **26,240** |
| Tower bounty | 120 coins / 150 XP | **260 / 320** |
| Creep last hit | +50% coins | **×2 coins, ×1.5 XP** |
| Creep, no last hit | full coins | **15%** |
| Killing a building | nothing | **half its total cost + XP** |

Last-hitting is now the job. A bot playing a full 15-minute match reaches
**level 19 and 9 of 32 gear tiers** — a strong human who farms well will get
meaningfully further, but maxing the whole sheet takes an exceptional game.
That is the "hard unless they're doing an incredible job" you asked for.

---

## Buildings

**7 per hero** (`MAX_BLD`). A wall counts as one however long it grows.
**Selling returns 25%** of everything sunk in, upgrades included.

- **🍬 Gumball Turret** (55) — now the generalist: air, ground, heroes, enemy
  buildings *and* towers. Small footprint (r 18 vs the mortar's 28) so you can
  wedge them into gaps. Deliberately fragile at 340 HP: **exactly three mortar
  shells** (120 each) kill one, as you specified.
- **💣 Marshmallow Mortar** (120) — **siege only**. It cannot touch a creep or
  a hero any more; the mortar spam is gone. It shells towers, walls and keeps
  from 340 px, outside a lane tower's 195. Tested both ways: a creep and a
  hero parked next to one take zero damage over 60 ticks.
- **🍯 Honey Glazer** (70) — was nearly useless as a pure slow. Now it slows
  *and* **glazes**: anything in the field takes **+35% damage from every
  source**, for your whole team. A force multiplier rather than a speed bump.
- **🏕️ Gummy Barracks** (150) — **5 gummies per wave, one wave every 7 s,
  7 waves then spent**, exactly as specified. Gummies went from 60 HP / 6 dmg
  to **190 HP / 18 dmg**, and they now **march down the nearest lane** instead
  of loitering at home — that is what makes the building worth buying. They
  also survive the barracks being destroyed.
- **🚀 Licorice Launcher** — **removed**. An anti-air-only building was a dead
  card; the turret inherited the sky.

**Lane tower range cut 270 → 195**, so how many creeps you let live in each
lane decides whether that tower is busy when you walk in.

---

## The Gumdrop Wall

One building, many bricks; the extra bricks never count against your seven.

- Starts as a **2-brick stub**, **+2 per upgrade**, up to 10 at level 5.
- Grows from **whichever end you are standing nearest**, bending up to 45° per
  brick — walk the line you want and it follows, like the Great Wall. Narrow
  (26 px) so it snakes through tight ground.
- **Blocks ground troops of both sides. Fliers sail over.**
- **Blocks tower and turret line of sight** — genuinely, by ray test. This is
  the bit that makes staging a tower fight behind one worth doing.
- **Only creeps, heroes, barracks gummies and siege mortars can break it.**
  Lane towers and turrets cannot touch it.
- **Ranged heroes can climb it** — but only from their own side, and they can
  never step down onto the far side. Melee cannot climb at all.
- Cannot be built on a tree, a mountain, or another building. *Can* cross a
  lane (gun towers still cannot) — otherwise it could not do its job.
- An upgrade that cannot fit its full two bricks rolls back and charges
  nothing, rather than taking your coins for half a wall.
- If a wall is raised on top of somebody, they can walk out. Nobody is
  entombed. Stress-tested with walls thrown across all three live lanes for
  six minutes across three map seeds.

---

## Everything else

- **Tap to attack.** Poke any creep, hero, tower or building on your phone and
  your hero swings at *that*, ignoring whatever wanders closer. A spinning
  reticle in your seat colour confirms it; tap bare ground to call it off.
- **Leaps go where you're running.** The old code read the joystick only at
  the instant of the press, so tapping the button just after releasing the
  stick made you jump at the nearest creep — usually backwards. Shield Charge
  and Candy Leap now use your last real heading.
- **Fountain is no longer a timeout.** Take a hit and healing drops to **15%
  for 2 seconds**. No tower or turret can fire on a hero standing on their own
  fountain — but rival heroes and creeps absolutely can.
- **Flat 30-second respawn**, first minute to last.
- **Building list is navigable.** Tap any card in 🏗️ and the map flies to that
  building and rings it with a pulsing marker (walls get every brick
  outlined), so nobody guesses which of six turrets they are upgrading. Each
  card shows its level, HP, waves left for a barracks, brick count for a wall,
  and the exact refund on the sell button.

---

## Testing

`test-gg.mjs` — 127 checks across waves, spawn positions, the economy, every
building, all the wall rules, the fountain, respawn, targeting, leaps, and a
four-minute full-sim soak.

`stress-gg.mjs` — walls across live lanes on three seeds, a wall dropped on a
crowd, ten-minute economy runs, and a tick-budget check (currently ~1.3 ms
against a 100 ms budget).

Two real bugs surfaced this way and were fixed: the muster walk never advanced
for the horde side (all 15 still spawned inside the cavern — your original
complaint, which would have shipped silently), and a terrain-blocked wall
upgrade charged full price for partial growth.

---

# Follow-up round

## The wall trap

You got pinned between a rock and your own wall. The no-crossing rule was
doing exactly what it was told — a hero on the parapet may only step down on
the side their own base is on — but nothing checked whether that side was
actually *reachable*. Climb where the friendly side happens to back onto a
rock ridge and there is nowhere legal left to stand.

Fix is an escape hatch rather than a loosened rule, so the wall still does its
job. A hero who shoves against something and gets nowhere for **0.8 seconds**
may squeeze through **their own** brickwork. Never the enemy's — that is a
problem you solve with a hammer — and never through a mountain, so there is no
walking through terrain.

While testing this I found a second, worse bug: perch tracking only recognised
*friendly* walls, so a ranged hero standing on an **enemy** wall was treated as
not being on a wall at all — and could stroll straight across it. That defeated
the entire point of an enemy rampart. Now the climb rules apply to any wall:
you may scale the enemy's from your own side and shoot over it, but the far
side stays out of reach.

Bots also got wall-aware. Their existing unstick routine picked a random
walkable spot, which could easily be on the far side of a wall — so they would
lean on the bricks from a fresh angle. It now rejects detours that are inside
or behind a wall. Worst-case bot freeze across seven seeds dropped from 331 s
to 52 s.

**Note:** bots occasionally standing still is not new and not wall-related. I
measured the untouched original game at a 234 s worst case versus 110 s for
this build, and most of it is bots deliberately holding position waiting for a
wave. Left alone.

## Hero pace

Heroes are **20% slower**. There is now one dial, `HERO_SPEED = 0.80`, near
the top of the file — the per-hero numbers underneath are untouched, so the
melee/ranged fork is preserved.

Zoom-Zoom Boots also went from +6% to +4.5% per tier. At tier VIII the old
value handed back +48%, which stacked on top of Frenzy and Haste and put a
geared hero right back where they started.

What that buys you against a tower:

| | Before | Now |
|---|---|---|
| Melee sprint | 9.30 px/tick | **7.44** |
| Ranged sprint | 9.00 | **7.20** |
| Zaps taken escaping a tower | ~1.40 | **~1.75** |
| ...with Boots VIII | ~0.95 | **~1.28** |
| Corner to corner | 53 s | **66 s** |

Heroes still comfortably outrun creeps (7.4 vs a runner's 2.7), so farming
still works. If it feels like a slog on the walk back from a respawn, raise
`HERO_SPEED` — 0.85 gives you back about half the change. If they still slip
away from towers too easily, 0.72 costs roughly two full zaps per escape.

Test count is now **146**, adding coverage for the escape hatch arming and
disarming, the enemy-wall climb rules, and the tower-escape maths.

---

# Follow-up: powers while moving

## What was wrong

Two separate things, and the first one was the real culprit.

**The buttons listened for `click`.** A `click` is only synthesised after a
clean press-and-release on the same element, and mobile browsers routinely
skip it when another finger is already down — especially when that finger is
driving a joystick that calls `preventDefault` on its own `touchmove` stream.
Which is precisely the Shield Charge situation: thumb on the stick, thumb on
the power. The press was being swallowed before the game ever saw it.

Powers now fire on **`touchstart`**, so they go off the instant your thumb
lands, with the stick still held. As a bonus they feel snappier — no waiting
for the release.

**The aim could be a frame stale.** Even once the press registered, the host
was reading `p.dir`, which arrives in a separate throttled `mv` packet (every
80 ms). Press the button in the wrong 80 ms window and you charged using the
*previous* heading, or none at all. The phone now sends its live stick vector
**with** the button press, so aim and press can never disagree. The very first
push of the stick also bypasses the throttle now, so opening a charge from
standstill goes where you point.

## While I was in there

Aiming a leap or charge now resolves in this order:

1. the stick vector that came with the press
2. the joystick as the host last heard it
3. **the target you tapped** — if you marked a tower, charging at it is
   obviously what you meant
4. the heading you were last running
5. a walk order, the nearest foe, then the enemy keep

Number 3 is new and worth knowing about: tap a tower or a hero, then charge,
and you go at it — a second way to aim that does not need the stick at all.
An explicitly held stick always wins over a tapped mark.

Buttons also flash yellow on press. `preventDefault` on `touchstart` can
swallow the CSS `:active` state, and a power that fires with no visible
feedback feels broken.

Tests are at **152**, adding the press-carries-its-own-aim case, the stale
`lastDir` case that used to fire backwards, tapped-target steering, and the
precedence between them.

---

# Follow-up: lanes, friendly walls, team size

## 1. The top road ran through the trees

Two things were eating the roads, and the second one had been there all along.

The rim tree-wall — the unbroken ring of trees that stops anyone sneaking
around the edge of the map — claims the outermost grid rows outright, without
consulting the rule that keeps obstacles clear of lanes. Where the high road
swung up near the top of the world it ran straight into that wall.

Underneath that, the clearance rule only ever measured a cell's **centre**. A
100 px cell whose middle sits 118 px off a lane still reaches to within 47 px
of it, so thickets had been poking into *every* road on the map since the
beginning.

Both fixed: obstacle cells are now measured on a fine grid across the whole
cell, and anything with any part of itself inside 88 px of a lane is removed —
rim wall included. The outer lanes were also pulled in from ±980 to ±930 so a
fully swayed lane keeps ~95 px of air between it and the hard edge of the map.

Measured over 100 seeds: **zero obstacles anywhere in a ±80 px corridor along
any lane**, down from up to 155 blocked samples. In live matches, creeps that
stall near spawn went from **25 / 11 / 0** per lane to **0 / 0 / 0**, and
average lane progress rose on all three roads.

## 2. Walls are your gate and their barricade

A wall is now solid **only to the side that did not build it**. Your creeps,
your gummies and your heroes file straight through your own brickwork; the
enemy has to break it down. Their wall still stops your ground troops cold,
and a ranged hero can still scale an enemy wall from the side facing their own
keep and shoot over it — but never step down behind it.

This retires the escape hatch from the last round. It existed for exactly one
situation, being wedged between a rock and your own wall, which can no longer
happen. Worth removing on its own merits too: while it was in, a hero who got
deliberately stuck could squeeze through the **enemy's** wall, which is the one
thing it must never allow.

One deliberate asymmetry kept: **sight lines are still blocked for everybody**,
including your own towers. Raising a wall in front of your own guns blinds
them. That was in your original spec and it is what stops a wall from being a
free upgrade.

## 3. The host sets the table

A **team size picker** now sits on the hero-select screen: 1v1 through 6v6.
Robots fill whatever the humans don't, and the readout underneath says how
many will be joining before you commit.

- Default is **3v3**, so two kids at the table get a full-feeling match.
- Nobody is ever turned away. If more people crowd onto one side than the size
  you picked, the other side is topped up to match them instead of anyone
  being dropped.
- Set it **during hero select** — the match starts the moment the last player
  locks in a hero.
- The robot roster grew from 8 names to 12, because a 6v6 with a single human
  needs eleven of them and two teammates called Robo Rollo helps nobody.

A full 6v6 runs clean: twelve players, 3.9 ms per tick against a 100 ms budget,
11 KB snapshots. The roster column on the host screen now wraps into a second
column rather than running off the bottom.

Tests are at **172**.

---

# Follow-up: barracks discipline, grenades for everyone, straight walls

## Barracks

The spam is over. **Two barracks per hero**, with a **30-second cooldown**
between builds, and waves now come **10 seconds apart** instead of 7. All
three numbers live on `BLD.barracks` (`maxOwn`, `buildCd`, `waveCd`) if you
want to tune them.

**Upgrading is now a reload.** It refills all seven waves with tougher
gummies (+25% HP and damage per level), repairs the building to full — and it
is only allowed once the current stock has fully marched out. Try it early
and it refuses, charges nothing, burns no level, and the phone explains why.
The building card shows the state at a glance: `⏳ 4 left` while it is still
training, `🔄 reload 🪙140` once it runs dry. The build tab shows your
`1/2` count and greys the card out at the cap.

## Every hero has real area damage now

The audit you asked for, kit by kit: the three pure buffs that decided
nothing are gone, and every ranged hero's AoE is now **thrown**, not
centred on themselves.

| Hero | Out | In |
|---|---|---|
| Gumdrop Knight | Frosting Armor (buff) | **Cake Quake** 🍰 — slam: damage + stun all around |
| Berry Ranger | Berry Barrage (around self) | **Berry Bomb** 🫐 — thrown, blast at the landing spot |
| Gingerbread Greta | Overclock (buff) | **Frosting Bomb** 🧁 — thrown blast |
| Licorice Whip | Sugar Rush (team sprint) | **Sour Grenade** 🧨 — thrown blast |
| Taffy Tinker | Goo Bomb (around self) | **Goo Bomb** 🫠 — now actually thrown; blast + big slow |

Slasher (Spin Slash), Mage (Jawbreaker meteor + Mint Nova) and Shaman (Shard
Volley + Dark Feast) already had theirs and are untouched.

Grenades fly **300 px** and use the same aiming ladder as leaps: the stick
sent with the press, then the live stick, then — with the stick idle — **the
target you tapped** catches the throw dead-on, then your last heading. They
arc over walls and trees and detonate 0.6 s after landing through the same
impact system as the mage's meteor, and explosions can now carry a slow
(which is how the Goo Bomb works). Blasts also hit fliers.

Robot notes: the whip's panic button moved from the departed Sugar Rush to
her snare — she drops the goo at her feet and runs. The knight keeps slot 2
as his panic: the slam's stun is a better escape than the armor ever was.
Fixed while testing: barracks waves fired every 10.1 s, not 10.0 — a classic
decrement-then-check off-by-one.

## Walls: straight blockades, and YOU aim them

The spiral is gone. Growth used to bend each new brick toward wherever the
owner stood, which turned every long wall into a curl. Now every upgrade
continues the wall's own axis **dead straight** — it never veers, and if the
line is blocked (board edge, tree, mountain, building) the upgrade refuses
and charges nothing. You still choose WHICH end grows by standing near it,
and the other end is the fallback if yours is blocked.

The direction itself is now yours too. The stub is laid **across the line
from your hero to where you tap** — stand where you like, point at the thing
you want blocked, and the blockade goes down crosswise to your aim (at most a
20° nudge to clear an obstruction; tapping at your own feet falls back to
facing the enemy). The phone ghost previews the exact bricks.

One deeper fix underneath: the ghost used to validate only the centre point
while the host laid two full bricks, so a green ghost could still fail on
Place. Host and phone now share one planner (`planWallStub`), and a test
sweeps the map verifying the planner's verdict always matches `build()` —
**a green ghost is a promise.**

Tests are at **209**.
