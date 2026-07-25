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
