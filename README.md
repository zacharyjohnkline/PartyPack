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

The war is perfectly fair — every 20 seconds both bases march an IDENTICAL
group of 10 (same classes, different costumes), and creep waves actively hunt
the other side's towers. Each army owns 12 towers: two per lane plus a ring
of six around the base covering front AND rear — and they hit hard enough to
fell the tankiest melee hero in about 5 zaps, so nobody tanks a tower dive
for free. Defenders chase invading heroes relentlessly near their home base.
Sides with no human players get AI champions on a schedule.

The wilds are now a proper FOREST: hundreds of tree thickets and rock ridges
carve real routes between the lanes, and the entire map rim is tree-walled —
there is no strolling around the outside. Eight neutral camps (Taffy Wolves,
Brittle Bears, the Elder Rockjaw) pay coins and hero XP. Heroes grow through
battle-earned LEVELS and tiered GEAR from the 🎒 phone shop, mid-fight, no
pauses; idle ground artillery besieges enemy structures.

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
