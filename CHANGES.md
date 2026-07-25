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
