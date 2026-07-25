# Party Pack 🎉

A big-screen party game hub. The host opens the app on a TV or laptop, everyone
joins from their phones by scanning a QR code (or typing the 4-letter room
code), and the host picks which game the group plays. Players stay connected in
one room across games.

## Running it

The app is plain HTML/CSS/JS, but it uses ES modules and QR-code joining, so it
needs to be served over http(s) rather than opened as a `file://`:

```bash
cd party-pack
python3 -m http.server 8000
```

Then open `http://<your-computer's-LAN-IP>:8000` on the big screen. Phones on
the same network scan the QR code that appears. (Any static host — GitHub
Pages, Netlify, etc. — works too, and lets phones join from anywhere.)

## Project layout

```
index.html              app shell (host + controller markup)
css/main.css            shared shell/lobby/controller styles
css/topbanana.css       Top Banana game styles
js/main.js              networking, lobby, roster, game registry, routing
js/util.js              shared side-effect-free helpers
js/games/topbanana.js   Apples-to-Apples-style judging game
js/games/sweetpath.js   Sweet Path candy board race
js/games/rockcandyrally.js    Rock Candy Rally 🏁 (1-6 players)

A timing-is-everything side-scrolling race. Everyone runs forward
automatically — the skill is WHEN you press your three buttons (JUMP,
POWER, THROW). Four candy racers each own one part of the track:
🐢 Shellsworth shell-slides downhills (nail the crest for a Sweet Drop),
🦎 Gummy Gecko owns the candy-brick walls (jump distance sets your grab
height, then wall-jump on the pulsing beat to climb fast), 🐟 Fizzy Finn
owns the water (tap JUMP in rhythm to build a swim combo), and 🐇 Sour
Zippy owns the flats (Sour Sprint hits 1.5x pressed the instant he lands).
Press JUMP right on GO for a rocket start — early and you stall.

❓ boxes hold the game's ONE weapon: a jawbreaker. Carry one at a time,
throw it to leave a trip hazard on the track — so attacks are earned,
not spammed. Placement pays candy coins (+1 for every PERFECT timing you
land), spent Super Off-Road-style between races on Speed / Jump / Power /
Recovery upgrades that persist across the 4-race series.

The big screen auto-frames every racer plus a full-track minimap; each
phone renders a zoomed-in camera glued to its own racer, with the
countdown, wall-pulse rings, swim-rhythm meter and cooldowns on-device.
Host-authoritative 30 Hz sim, 15 Hz snapshots, phones interpolate.

js/games/gumdropguardians.js  Gumdrop Guardians 🛡️ (1-6 players)

A candy MOBA for the living room — co-op against the AI horde, or split into
teams and go head to head. Pick a SIDE at the select screen, then a hero from
that side's OWN roster:

  🍬 Gummi Kingdom — Sir Crunch-a-Lot, Huckleberry Fin, Minty Merlin,
     Gingerbread Greta (bash, taunt, meteors, heals, decoys, overclocks)
  👹 Rock Candy Horde — Sourpuss Slasher (spins, rages, LEAPS), Licorice
     Lasher (triple whip-cracks, snares, team sprints), Rock Candy Shaman
     (shard storms, crystal decoys, life-draining feasts), Taffy Tinker
     (goo bombs, patch-ups, deployable scrap turrets)

Rival heroes genuinely fight: auto-attacks, abilities, meteors, and syrup all
work on the other team's players, and takedowns pay coins + XP by level.
The two sides are unmistakable at a glance: gummi heroes and buildings are
warm cream-and-candy, while the hard-candy horde wears the dark look —
obsidian-purple structures capped with pulsing pink crystal beacons, dusky
heroes with crystal shards on their shoulders, and barracks that train
grumpy purple Candy Imps instead of gummy guards.

The war is perfectly fair — every SIX seconds both bases march an IDENTICAL
five-strong column down EVERY lane (same classes, different costumes). Waves
muster OUTSIDE the keep wall in a two-abreast wedge, so a column never gets
sliced in half by its own base. When a lane genuinely deadlocks, that lane
holds its next column back rather than piling hundreds deep — see LANE_CAP if
you want bigger brawls or a tidier board.

Creep waves attack enemy towers along their path as first-class targets, and
every creep survives exactly 4 tower zaps no matter how big it is. Each army
owns 12 towers (two per lane, a ring of six around the base, front AND rear).
Downed LANE towers aren't destroyed, they're CAPTURED: they switch sides at
FULL health and immediately fight for their new owners. The six base-ring
guards are the exception — those are destroyed for good, and the base stays
shielded until every one of them is rubble. Each base is SHIELDED while any
ring guard still flies its flag, so the ring must be dismantled first.

Lane towers reach 195 px, not 270. A tower no longer blankets its whole
neighbourhood, which means how many creeps you let LIVE in each lane is what
decides whether that tower is busy when your hero walks in.

LAST HITS ARE THE JOB. Land the killing blow on a creep and you bank double
bounty and half again the XP; teammates who merely stood nearby split a thin
15%. Flattening a building pays half of everything its owner sank into it,
and a tower is worth 260 coins and 320 XP. Gear is priced to match: tier I
costs 120 and tier VIII costs 1828, so ONE full gear line is 6,560 coins and
all four is 26,240. Expect to max a line in a good match and the whole sheet
almost never. Dying still spills your entire purse.

TAP TO ATTACK. Poke any creep, rival hero, tower or building on your phone
and your hero swings at THAT until it dies, ignoring whatever wanders closer.
A spinning reticle in your seat colour shows the order landed; tap bare
ground to call it off.

THE BUILD MENU, rebuilt around five things that each do a job nothing else
does. Seven structures per hero, and selling returns a quarter of everything
you sank in, upgrades included:

  🍬 Gumball Turret (55) — the generalist. Hits air, ground, heroes, enemy
     buildings and towers, with a small footprint you can wedge into gaps a
     mortar will never fit. Made of sugar glass: three mortar shells kill it.
  💣 Marshmallow Mortar (120) — SIEGE ONLY. It cannot touch a creep or a
     hero any more. What it can do is out-range a lane tower (340 vs 195)
     and pound towers, walls and keeps from where they cannot answer.
  🍯 Honey Glazer (70) — slows everything nearby AND leaves it GLAZED,
     taking +35% damage from every source. A force multiplier for the team.
  🏕️ Gummy Barracks (150) — a creep pump with a fuse. Five tough gummies
     every 10 seconds, seven waves, then it is spent. They MARCH down the
     nearest lane rather than loitering, and they outlive the building.
     TWO per hero, tops, with a 30 s wait between builds. Upgrading is a
     RELOAD — allowed only once the tube runs dry, it refills all seven
     waves with tougher gummies and repairs the building.
  🧱 Gumdrop Wall (90) — see below.

The Licorice Launcher is retired; an anti-air-only building was a dead card,
so the turret inherited the sky.

THE GREAT WALL OF GUMDROP. A wall is ONE building made of many bricks — the
extra bricks never count against your seven. YOU aim it: the stub is laid
ACROSS the line from your hero to where you tap, and every upgrade adds two
bricks to whichever END you are standing nearest, continuing that axis DEAD
STRAIGHT — a blockade, never a spiral. If the line is blocked by a tree, a
mountain, a building or the edge of the board, the upgrade refuses and
charges nothing. Ground troops of BOTH
sides are stopped cold; fliers sail straight over. Lane towers and turrets
cannot SHOOT THROUGH it — line of sight is genuinely blocked, which is what
makes staging a tower fight behind one worth doing. Only creeps, heroes,
barracks gummies and siege mortars can break it. And a RANGED hero may climb
it — but only from their own side, and never down onto the far side. Archers
on the parapet. Walls may cross a lane (gun towers still may not), but never
a tree, a mountain or another building.

THE FOUNTAIN IS NOT A PANIC ROOM. Take a hit and the taps drop to 15% for two
seconds, so you cannot stagger onto the pad at 5% health and out-heal the
hero chasing you — walk away, THEN drink. No tower or turret may fire on a
hero standing on their own fountain, but rival heroes and creeps absolutely
can, so it is a breather rather than a sanctuary.

Respawn is a flat 30 seconds from the first minute to the last. The old curve
crept toward a minute-plus late on, which is an eternity when you are seven.

Player-built structures are formidable but placed within arm's reach of your
own LIVING hero, so fortifying means physically walking somewhere and holding
it. Tap any building in the 🏗️ list and the map flies to it and rings it, so
you never have to guess which of six turrets you are about to upgrade.

THE HOST SETS THE TEAM SIZE on the hero-select screen — anything from 1v1 up
to 6v6, defaulting to 3v3 — and robots fill every chair the humans don't. Set
it while people are choosing heroes, because the match starts the moment the
last player locks in. Nobody is ever turned away: if more people crowd onto
one side than the size you picked, the other side is topped up to match them.
Teams always come out EQUAL, and robot players — Robo Rollo, Auto Aggie, Circuit Cindy and friends —
fill the empty chairs the moment the match starts. Bots are real players
under identical rules: they pick a hero from their side's roster, earn coins
and XP, buy and upgrade the same gear, cast abilities on the same cooldowns,
build fortifications, push lanes, dismantle towers, retreat to heal, and
respawn like anyone else. They appear on the roster with 🤖 badges. They also
have a survival instinct: a safety check runs every tick, the panic threshold
rises when they're standing under a tower or bleeding fast, they fire their
kit's escape ability on the way out, and they retreat to whichever fountain
or spring is furthest from whatever is hurting them. They only dive a tower
with a creep wave to soak the zaps. They live under the same seven-building
cap, buy a barracks once their siege kit is down, and park mortars outside a
tower's reach to shell it down for free.

The wilds are a proper FOREST: hundreds of tree thickets and rock ridges
carve real routes between the lanes, and the entire map rim is tree-walled —
except that LANES ARE SACRED. Nothing may stand within 88 px of a road, rim
wall included, so no lane can ever be pinched shut by the terrain.
Eight neutral camps (Taffy Wolves, Brittle Bears, the Elder Rockjaw) pay
coins and hero XP, and four pink SODA SPRINGS — mirrored so neither side gets
a closer drink — heal any hero who wades in, either team. Melee heroes
regenerate anywhere but ONLY out of combat; ranged heroes have no passive
regen but recover 50% faster at fountains and springs.

Hero pace is set by one dial, `HERO_SPEED` (0.80). Melee and ranged are still
a real fork — melee is FASTER on foot (7.44 vs 7.20), so it can actually engage — and Shield Charge and Candy Leap now carry you the way
you are RUNNING, using the heading the stick was last pushed rather than
whatever creep happened to be nearest. Ranged trades that speed for reach,
air attacks, safe farming beyond creep aggro range, halved tower damage at
distance, a parapet to shoot from, and two escape tools: BACKSTEP, an
automatic burst of speed when something jumps you at knife range, and for the
mage and shaman a dash built into their nova. Heroes grow through
battle-earned LEVELS all the way to 25 and tiered GEAR from the 🎒 phone shop,
mid-fight, no pauses. Everything has a real HITBOX resolved inside the game
tick: heroes stop dead against towers and buildings, and creep packs shove
rather than hard-wall.

Every hero carries real area damage: the melee heroes slam it out around
themselves (Spin Slash, Cake Quake) while the ranged heroes THROW theirs —
candy grenades that arc 300 px over walls and trees and blast where they
land, aimed by the stick, or by the target you tapped when the stick is
idle. The pure buffs that used to sit in those slots are gone.

Phones are full controllers: joystick, three hero powers, tap-to-attack on
the live map, and the shop overlay for gear, building, and upgrades. Powers
fire on touch-down and carry the joystick's live direction with them, so you
can Shield Charge mid-run with the stick still held — and a target you tapped
will steer a charge or a leap if the stick is idle.

### Testing

Two headless suites, no browser needed:

```bash
node test-gg.mjs      # 209 rules checks: waves, economy, walls, fountain, targeting
node stress-gg.mjs    # walls thrown across live lanes, long matches, tick budget
```

## Games

**Top Banana 🍌** (3–10 players) — each round one player is the Banana Judge.
The big screen shows a golden prompt card; everyone else secretly plays the
answer card from their hand of 7 that matches it best. The judge crowns a
winner, who earns a banana. First to 5 bananas wins. All card text is original.

**Gumdrop Guardians 🛡️** (1–6 players) — cooperative tower defense! Everyone
picks a hero (each with 3 real-time powers), then defends the Gingerbread
Castle in one corner of a big widescreen (16:9) map against 20 waves marching
out of the Rock Candy Cavern in the opposite corner, down three winding lanes.
Fog of war covers everywhere the team hasn't walked — scouting reveals the map
for good, and towers can only be placed on explored ground. Waves
scale with the player count first and the wave number second, and later waves
bring fliers, building-eating sappers, golems, and a boss every 5th wave.
Between waves there's a ~20-second shop phase where the phone flips from
joystick-and-powers to an upgrade menu: level up your hero, place new towers,
and upgrade the towers *you* built — nobody can touch anyone else's, and every
tower is painted in its owner's color. Melee heroes (Sir Crunch-a-Lot and
Greta) are far tankier than the ranged ones and regenerate health even while
taking hits. Enemies
get lured off their trails by nearby heroes and buildings, so divide and
conquer! Run the headless sim tests with `node test-gg.mjs`.

**Sweet Path 🍭** (2–8 players) — the full candy board race, ported from the
original game: the 3D spiral board, the opening button-mash for turn order,
color-card draws with the rainbow bonus tracker, sticky goo spots, the Rainbow
Bridge shortcut, Pong/Tron collision duels, the round-end Doodle Dash race, and
the Wheel of Fortune. Three.js loads on demand from a CDN (via the import map
in `index.html`), so the rest of the app stays light.

## Adding a game

1. Create `js/games/yourgame.js` exporting the module interface (documented at
   the top of `js/main.js`): menu metadata plus `createHost(ctx)` and
   `createController(ctx)` factories.
2. Create `css/yourgame.css` with a unique class prefix and link it from
   `index.html`.
3. Import the module in `js/main.js` and add it to the `GAMES` array.

That's it — the menu card, player routing, and reconnect handling come for free.
