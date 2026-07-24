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

A co-op candy MOBA, fully real time. The team's Gingerbread Castle sits in one
corner of a big widescreen map; the horde's Rock Candy Cavern glowers from the
other. Every 20 seconds BOTH bases send a group of 10 fighters marching down
the three lanes — they meet in the middle and brawl. Destroy the cavern to win
before the horde flattens the castle.

Standing in your way: two enemy towers per lane (huge health, and hits hard
enough to fell the tankiest knight in about 8 swats), enemy heroes like the
Sour Sergeant and Licorice Sniper who arrive on a schedule, and an endless
tide of creeps that grows meaner every minute.

The wilds between the lanes are shaped by rock ridges and tree thickets that
block travel (never sealing anything off — there's always a way around), and
dotted with neutral creep camps. Taffy Wolves, Brittle Bears, and the Elder
Rockjaw guard their clearings fiercely; clearing a camp pays coins and levels
your hero up. Heroes grow two ways: LEVELS earned through kills and battle
performance, and GEAR bought from the 🎒 shop on your phone — the Lollipop
Blade, Gumdrop Plate, Zoom-Zoom Boots, and Star Charm, each upgradeable
through eight tiers. Towers can still be built anywhere the team has scouted
(fog of war hides the unexplored map), any time, mid-fight.

Phones are full controllers: joystick + three hero powers, a live mini-view of
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
