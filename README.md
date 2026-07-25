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
js/games/gumdropguardians.js  Gumdrop Guardians 🛡️ (1-6 players)

A candy MOBA for the living room — co-op against the AI horde, or split into
teams and go head to head. Pick a SIDE at the select screen, then a hero from
that side's OWN roster:

  🍬 Gummi Kingdom — Sir Crunch-a-Lot, Huckleberry Fin, Minty Merlin,
     Gingerbread Greta (bash, taunt, meteors, heals, walls, overclocks)
  👹 Rock Candy Horde — Sourpuss Slasher (spins, rages, LEAPS), Licorice
     Lasher (triple whip-cracks, snares, team sprints), Rock Candy Shaman
     (shard storms, crystal walls, life-draining feasts), Taffy Tinker
     (goo bombs, patch-ups, deployable scrap turrets)

Rival heroes genuinely fight: auto-attacks, abilities, meteors, and syrup all
work on the other team's players, and takedowns pay coins + XP by level.
The two sides are unmistakable at a glance: gummi heroes and buildings are
warm cream-and-candy, while the hard-candy horde wears the dark look —
obsidian-purple structures capped with pulsing pink crystal beacons, dusky
heroes with crystal shards on their shoulders, and barracks that train
grumpy purple Candy Imps instead of gummy guards.

The war is perfectly fair — every 20 seconds both bases march an IDENTICAL
group of 10 (same classes, different costumes). Creep waves attack enemy
towers along their path as first-class targets, and every creep survives
exactly 4 tower zaps no matter how big it is. Each army owns 12 towers (two
per lane, a ring of six around the base, front AND rear). Downed LANE towers
aren't destroyed, they're CAPTURED: they switch sides at FULL health and
immediately fight for their new owners. The six base-ring guards are the
exception — those are destroyed for good, and the base stays shielded until
every one of them is rubble. Towers fell a fresh level-1 hero in
4 zaps, stretching to 10 zaps at level 10. And each base is SHIELDED while
any of its six ring guards still fly its flag — no bum-rushing the enemy
keep; the ring must be dismantled (captured!) first. Player-built structures
are formidable too: triple health, and turrets & mortars open fire on rival
heroes — but you can only place them within arm's reach of your own living
hero, so fortifying means physically walking somewhere and holding it. And
dying hurts: a fallen hero drops every coin they were carrying, so diving a
tower with a full purse is a genuine gamble.

Teams always come out EQUAL: if the sides are uneven (3v1, or a lone player
vs nobody), robot players — Robo Rollo, Auto Aggie, Circuit Cindy and friends —
fill the empty chairs the moment the match starts. Bots are real players
under identical rules: they pick a hero from their side's roster, earn coins
and XP, buy and upgrade the same gear, cast abilities on the same cooldowns,
build fortifications (the builder types especially), push lanes, dismantle
towers, retreat to heal, and respawn like anyone else. They appear on the
roster with 🤖 badges. They also have a survival instinct: a safety check runs
every tick (not just once a second), the panic threshold rises when they're
standing under a tower or bleeding fast, they fire their kit's escape or heal
ability on the way out, and they retreat to whichever fountain or spring is
furthest from whatever is hurting them. They only dive a tower with a creep
wave to soak the zaps.

Their economy is a real one, too. Bots alternate spending — one purchase into
the hero, the next into the war effort — so gear and fortifications both keep
growing instead of starving each other. EVERY hero builds, not just the
builder classes, they upgrade what they own rather than spamming level 1s,
and their placement is deliberate: a mortar out-ranges a lane tower (340 vs
270), so bots park one in the ring just outside the tower's reach, on their
own side where the wave screens it, and shell the tower down while it cannot
shoot back. If they're too far from a good firing position, they walk to one
first.

The wilds are now a proper FOREST: hundreds of tree thickets and rock ridges
carve real routes between the lanes, and the entire map rim is tree-walled —
there is no strolling around the outside. Eight neutral camps (Taffy Wolves,
Brittle Bears, the Elder Rockjaw) pay coins and hero XP, and four pink SODA
SPRINGS — mirrored across the map so neither side gets a closer drink — heal
any hero who wades in, either team. Sustain is a real choice now: melee
heroes regenerate anywhere but ONLY out of combat (taking a hit pauses it
for 5 s), while ranged heroes have no passive regen but recover 50% faster
at fountains and springs.

Melee and ranged are a real fork. Melee is FASTER on foot (9.3 vs 9.0), so
it can actually engage — and Sir Crunch-a-Lot now opens with Shield Charge,
a 210 px dash that ends in a stunning slam. Ranged trades that speed for
reach, air attacks (2 of every 10 creeps fly, and melee can't auto-attack
them at all), safe farming beyond creep aggro range, halved tower damage at
distance, and two escape tools: BACKSTEP, an automatic burst of speed the
moment something jumps you at knife range (8 s cooldown, so it can't be
spammed), and for the mage and shaman, a dash built right into their nova. Heroes grow through battle-earned LEVELS (now a long road all the way
to 25) and tiered GEAR from the 🎒 phone shop, mid-fight, no pauses; idle
ground artillery besieges enemy structures. And everything has a real HITBOX,
resolved inside the game tick itself: heroes stop dead against towers and
buildings, heroes stop against each other, and creep packs shove rather than
hard-wall — you can wade through a crowd, but it costs you real time.

Phones are full controllers: joystick, three hero powers, a live view of your
hero, and the shop overlay for gear, building, and tower upgrades.

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
