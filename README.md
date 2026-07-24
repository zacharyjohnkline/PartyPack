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

A candy MOBA for the living room — play it co-op against the AI horde, or
split into teams and go head to head. At the hero-select screen every player
picks a SIDE (🍬 Gummi Kingdom or 👹 Rock Candy Horde) and a hero; destroy the
other team's base to win.

The war is perfectly fair. Every 20 seconds both bases march an IDENTICAL
group of 10 down the three lanes — same classes, same stats, different
costumes (Gummy Bruisers vs Choco Chompers, Bonbon Bees vs Wafer Wasps,
Jawbreaker Brutes vs Gumdrop Golems...). Both sides own 10 towers: two per
lane plus a ring of four guarding the base, each hitting hard enough to fell
the tankiest knight in about 8 swats — so there's no sprinting past the army
to backdoor the enemy keep, and defenders chase invading heroes relentlessly
anywhere near their home base. Any side with no human players gets AI
champions (the Sour Sergeant, Licorice Sniper, and Rock Candy Colossus — or
their gummi counterparts) marching on a schedule, so solo-vs-horde still
works beautifully.

Between the lanes: rock ridges and tree thickets that block travel (never
sealing anything off), and eight neutral camps — Taffy Wolves, Brittle Bears,
and the Elder Rockjaw — that pay coins and hero XP when cleared. Heroes grow
through battle-earned LEVELS and purchasable GEAR (Lollipop Blade, Gumdrop
Plate, Zoom-Zoom Boots, Star Charm, tiers I-VIII), all from the 🎒 shop on
your phone, mid-fight, no pauses. Player-built ground artillery even lays
siege to enemy towers and bases when no creeps are in range.

Phones are full controllers: joystick, three hero powers, a snug live view of
your hero, and the shop overlay for gear, building, and tower upgrades.

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
