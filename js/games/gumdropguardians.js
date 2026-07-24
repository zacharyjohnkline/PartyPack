/* ============================================================
   Gumdrop Guardians — co-op tower defense for the whole couch.

   Up to six heroes defend the Great Gingerbread Castle in one
   corner of a big square candy wilderness. The horde pours out
   of the Rock Candy Cavern in the OPPOSITE corner and marches
   down three winding lanes — high road, middle road, low road.
   Between waves everyone gets ~20 seconds to spend their candy
   coins: upgrade YOUR hero and YOUR towers (nobody can touch a
   tower they didn't build), or plop down new defenses.

   Luring is real: enemies get pulled off their trail by nearby
   heroes and buildings, so the team can split the horde and
   fight it in pieces. Jelly Sappers only care about buildings,
   Wafer Wasps fly over everything but anti-air, and every 5th
   wave a Rock Candy Colossus comes knocking.

   Wave size scales with the player count first and the wave
   number second; wave number also unlocks nastier enemy types.

   The sim is DOM-free on purpose so it can be tested headlessly
   (see the __sim export at the bottom).
   ============================================================ */

import { escapeHtml } from '../util.js';

/* ---------------- tuning ---------------- */

const TICK_MS = 100;               // 10 sim ticks per second
const SNAP_EVERY = 2;              // snapshot to phones every 200 ms

const WORLD_W = 2140;              // half-extents of a 16:9 widescreen map
const WORLD_H = 1204;              // (4280 x 2408 — under a minute corner to corner)
const N_PATHS = 3;                 // three lanes: high road, mid road, low road

const CASTLE = { r: 95, hp: 3500, x: 1720, y: 784 };     // player base, bottom-right
const HORDE  = { r: 120, hp: 5200, x: -1720, y: -784 };  // enemy cavern — destroy it to WIN

/* the real-time engine: both bases spawn a group every 20 s, forever */
const SPAWN_EVERY = 200;           // ticks between creep groups
const GROUP_SIZE = 10;             // units per group, per side
const TIME_SCALE = 0.08;           // enemy hp/dmg +8% per minute
const FOUNTAIN_R = 300;            // heroes heal fast near their own castle
const COIN_TRICKLE = 1;            // passive coins per second per player

/* lane towers — brutal: ~8 hits fells even the tankiest hero. BOTH sides get them */
const ETOWER = { hp: 2600, dmg: 160, range: 270, cd: 15, r: 34, coin: 120, xp: 150 };
const ETOWER_AT = [0.45, 0.22];    // fractions along each lane, measured from the owner's base
const BASE_RING = [[350, 60], [60, 350], [290, 290], [150, 150],
                   [-250, -40], [-40, -250]];   // guard towers hugging each base — REAR covered too
const BASE_ZONE = 720;             // defenders chase intruders relentlessly inside this radius

/* walkability grid — trees & rock ridges block off-lane travel */
const WALK_CELL = 100;
const WALK_COLS = Math.ceil((WORLD_W * 2) / WALK_CELL);
const WALK_ROWS = Math.ceil((WORLD_H * 2) / WALK_CELL);

/* fog of war — coarse grid, revealed by hero travel, never re-fogs */
const FOG_CELL = 150;
const FOG_COLS = Math.ceil((WORLD_W * 2) / FOG_CELL);    // 29 (fits an int32 row)
const FOG_ROWS = Math.ceil((WORLD_H * 2) / FOG_CELL);    // 17
const REVEAL_R = 430;              // how far a walking hero can see

const PICK_FAILSAFE = 450;         // auto-assign heroes after 45 s
const START_COINS = 160;

/* heroes — pick one at the start, it's yours for the match.
   Three abilities each (see ABILITIES below). */
const HEROES = [
  /* 🍬 Gummi Kingdom roster */
  { id: 'knight',  team: 0, name: 'Sir Crunch-a-Lot', emoji: '🛡️', desc: 'Melee tank — huge health that regrows even mid-fight.',
    hp: 780, dmg: 22, range: 40,  cd: 8, speed: 9.0, r: 20, hitAir: false, regen: 0.0014 },
  { id: 'ranger',  team: 0, name: 'Huckleberry Fin',  emoji: '🏹', desc: 'Long-range berry archer. Shreds fliers and snipes brutes.',
    hp: 260, dmg: 14, range: 190, cd: 7, speed: 9.6, r: 18, hitAir: true },
  { id: 'mage',    team: 0, name: 'Minty Merlin',     emoji: '🧙', desc: 'Splashy spells, slows, meteors, and a team heal.',
    hp: 240, dmg: 11, range: 170, cd: 9, speed: 8.7, r: 18, hitAir: true, splash: 45 },
  { id: 'builder', team: 0, name: 'Gingerbread Greta', emoji: '🔧', desc: 'Melee bruiser & builder — towers cost 20% less, health regrows.',
    hp: 600, dmg: 12, range: 60,  cd: 8, speed: 9.3, r: 19, hitAir: false, discount: 0.8, regen: 0.0014 },
  /* 👹 Rock Candy Horde roster — same roles, totally different powers */
  { id: 'slasher', team: 1, name: 'Sourpuss Slasher', emoji: '🗡️', desc: 'Twin-blade brawler — spins, rages, and LEAPS across the field.',
    hp: 740, dmg: 24, range: 42,  cd: 8, speed: 9.2, r: 20, hitAir: false, regen: 0.0014 },
  { id: 'whip',    team: 1, name: 'Licorice Lasher',  emoji: '🪢', desc: 'Whip-cracking skirmisher. Snares packs, hastens the horde.',
    hp: 270, dmg: 13, range: 200, cd: 7, speed: 9.6, r: 18, hitAir: true },
  { id: 'shaman',  team: 1, name: 'Rock Candy Shaman', emoji: '🔮', desc: 'Crystal hexes: shard storms, walls, and life-draining feasts.',
    hp: 240, dmg: 11, range: 170, cd: 9, speed: 8.7, r: 18, hitAir: true, splash: 40 },
  { id: 'tinker',  team: 1, name: 'Taffy Tinker',      emoji: '⚙️', desc: 'Gadget goblin & builder — towers cost 20% less, drops scrap turrets.',
    hp: 580, dmg: 12, range: 60,  cd: 8, speed: 9.3, r: 19, hitAir: false, discount: 0.8, regen: 0.0014 },
];
const HERO_IDX = HEROES.map((h) => h.id);
const heroesOfTeam = (team) => HEROES.filter((h) => h.team === team);

/* abilities — [name, emoji, cooldown ticks, blurb] ; numbers live in castAbility */
const ABILITIES = {
  knight: [
    ['Shield Bash', '💥', 180, 'Slam nearby foes: damage + stun'],
    ['Battle Cry',  '📣', 250, 'Taunt — enemies nearby chase YOU'],
    ['Frosting Armor', '🧊', 300, 'Take 60% less damage for a while'],
  ],
  ranger: [
    ['Berry Barrage', '🫐', 200, 'Hit every enemy around you'],
    ['Jam Trap', '🍓', 220, 'Sticky field that slows enemies'],
    ['Piercing Shot', '🎯', 260, 'Huge damage to the biggest foe in sight'],
  ],
  mage: [
    ['Mint Nova', '❄️', 200, 'Frosty blast: damage + slow around you'],
    ['Jawbreaker', '☄️', 300, 'Meteor onto the thickest enemy cluster'],
    ['Sprinkle of Life', '✨', 320, 'Heal nearby heroes, gummies & towers'],
  ],
  builder: [
    ['Quick Fix', '🔧', 200, 'Repair every building near you'],
    ['Overclock', '⚡', 280, 'YOUR towers nearby fire twice as fast'],
    ['Gumdrop Wall', '🧱', 350, 'Drop a decoy wall enemies love to chew'],
  ],
  slasher: [
    ['Spin Slash', '🌀', 170, 'Whirl of blades: damage all around you'],
    ['Sour Frenzy', '😤', 280, 'Attack twice as fast + run faster'],
    ['Candy Leap', '🦘', 240, 'LEAP forward and slam the landing zone'],
  ],
  whip: [
    ['Triple Lash', '🪢', 190, 'Crack the whip at the 3 nearest foes'],
    ['Sticky Snare', '🕸️', 230, 'Gooey field that badly slows foes'],
    ['Sugar Rush', '🍭', 320, 'Your whole team sprints for a while'],
  ],
  shaman: [
    ['Shard Volley', '💎', 190, 'Crystal shards: damage + stun around you'],
    ['Crystal Wall', '🧱', 350, 'Raise a wall of rock candy right here'],
    ['Dark Feast', '🦇', 260, 'Drain life from every foe near you'],
  ],
  tinker: [
    ['Goo Bomb', '🫠', 200, 'Splash of taffy: damage + a big slow'],
    ['Patch-Up', '🔧', 200, 'Repair nearby buildings (and yourself a bit)'],
    ['Scrap Turret', '🤖', 340, 'Deploy a temporary auto-turret'],
  ],
};

/* GEAR — equipment you buy and then upgrade tier by tier (max VIII) */
const HUP = {
  dmg: { label: 'Lollipop Blade',  emoji: '🗡️', mul: 0.12, hint: '+12% attack damage per tier' },
  hp:  { label: 'Gumdrop Plate',   emoji: '🛡️', mul: 0.15, hint: '+15% max health per tier' },
  spd: { label: 'Zoom-Zoom Boots', emoji: '👟', mul: 0.06, hint: '+6% run speed per tier' },
  pow: { label: 'Star Charm',      emoji: '⭐', mul: 0.15, hint: '+15% ability strength per tier' },
};
const HUP_MAX = 8;
const TIER = ['—', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const hupCost = (n) => 50 + 30 * n;

/* hero LEVELS — earned through play: kills, creeps, towers */
const XP_LVL = [50, 120, 210, 330, 480, 660, 880, 1140, 1450];   // cumulative, lvl 2..10
const LVL_DMG = 0.08, LVL_HP = 0.10, LVL_POW = 0.05;             // per level past 1
const XP_SHARE_R = 520;                                          // nearby allies get 45%

/* the tower catalog — different tools for different jobs */
const BLD = {
  turret:   { label: 'Gumball Turret',   emoji: '🍬', cost: 60,  hp: 220, range: 175, dmg: 8,  cd: 8,
              r: 26, desc: 'Rapid fire vs GROUND enemies' },
  launcher: { label: 'Licorice Launcher', emoji: '🚀', cost: 70,  hp: 200, range: 230, dmg: 15, cd: 10,
              r: 26, air: true, desc: 'Shoots FLYING enemies only' },
  mortar:   { label: 'Marshmallow Mortar', emoji: '💣', cost: 90,  hp: 240, range: 340, minRange: 130,
              dmg: 18, cd: 25, splash: 75, r: 28, desc: 'Long-range splash vs GROUND — not up close' },
  syrup:    { label: 'Syrup Sprayer',    emoji: '🍯', cost: 50,  hp: 180, range: 140, cd: 5,
              r: 24, slow: 0.45, desc: 'No damage — slows every enemy nearby' },
  barracks: { label: 'Gummy Barracks',   emoji: '🏕️', cost: 110, hp: 320, r: 32, squad: 3, respawn: 60,
              desc: 'Trains 3 gummy fighters that guard it' },
  wall:     { label: 'Gumdrop Wall',     emoji: '🧱', cost: 0,   hp: 400, r: 30, lure: 320, temp: 300,
              desc: 'Decoy — enemies rush to chew on it' },
};
const BTYPE = ['turret', 'launcher', 'mortar', 'syrup', 'barracks', 'wall'];
const BUILDABLE = ['turret', 'launcher', 'mortar', 'syrup', 'barracks'];
/* per-level boosts when the OWNER upgrades a tower (levels 1..5) */
const BUP = { dmgMul: 1.3, hpMul: 1.25, rangeMul: 1.07, max: 5 };
const bupCost = (lvl) => 40 + 45 * lvl;
const SELL_BACK = 0.6;

/* gummy fighters trained by barracks */
const GUMMY = { hp: 60, dmg: 6, cd: 8, range: 26, speed: 2.6, aggro: 170, leash: 340, r: 12 };

/* the enemy bestiary — cost is its share of a wave's budget */
/* the shared creep classes — BOTH armies draw from this same stat sheet,
   so neither side's waves ever have an edge. Only the costumes differ. */
const CLASSES = {
  grunt:  { hp: 60,  dmg: 8,  spd: 1.6, range: 26, aggro: 155, coin: 4,  xp: 8,  unlockMin: 0 },
  runner: { hp: 36,  dmg: 6,  spd: 2.7, range: 24, aggro: 120, coin: 3,  xp: 6,  unlockMin: 0.8 },
  flyer:  { hp: 50,  dmg: 7,  spd: 2.3, range: 26, aggro: 155, coin: 5,  xp: 10, unlockMin: 2, air: true },
  sapper: { hp: 95,  dmg: 24, spd: 1.8, range: 28, aggro: 300, coin: 6,  xp: 12, unlockMin: 3.5, bldOnly: true },
  tank:   { hp: 320, dmg: 20, spd: 1.2, range: 30, aggro: 135, coin: 12, xp: 25, unlockMin: 5.5 },
};
const HERO_CLASSES = {
  hknight: { hp: 950,  dmg: 42, spd: 2.2, range: 44,  aggro: 220, coin: 60, xp: 130, hero: true, tough: 0.75 },
  harcher: { hp: 560,  dmg: 34, spd: 2.3, range: 240, aggro: 260, coin: 60, xp: 130, hero: true },
  hboss:   { hp: 2300, dmg: 62, spd: 1.6, range: 44,  aggro: 220, coin: 90, xp: 160, hero: true, boss: true },
};
/* build one group's composition; used verbatim by BOTH bases each cycle */
function makeComp(mins) {
  const open = Object.keys(CLASSES).filter((c) => CLASSES[c].unlockMin <= mins);
  const wish = ['grunt', 'grunt', 'runner', 'grunt', 'flyer', 'runner', 'sapper', 'grunt', 'flyer', 'tank'];
  return wish.map((c) => (open.includes(c) ? c : open[0]));
}

const ETYPES = {
  chomper:  { label: 'Choco Chomper', cls: 'grunt' },
  sprinter: { label: 'Sour Sprinter', cls: 'runner' },
  wasp:     { label: 'Wafer Wasp',    cls: 'flyer' },
  sapper:   { label: 'Jelly Sapper',  cls: 'sapper' },
  golem:    { label: 'Gumdrop Golem', cls: 'tank' },
  eknight:  { label: 'Sour Sergeant',       cls: 'hknight' },
  earcher:  { label: 'Licorice Sniper',     cls: 'harcher' },
  boss:     { label: 'Rock Candy Colossus', cls: 'hboss' },
};
/* the gummy army wears the same stats in sweeter costumes */
const ATYPES = {
  gummy:   { label: 'Gummy Guard', guard: true, hp: 60, dmg: 6, spd: 2.6, range: 26, cd: 8, aggro: 170, leash: 340 },
  bruiser: { label: 'Gummy Bruiser',    cls: 'grunt' },
  dasher:  { label: 'Sherbet Dasher',   cls: 'runner' },
  bee:     { label: 'Bonbon Bee',       cls: 'flyer' },
  breaker: { label: 'Brittle Breaker',  cls: 'sapper' },
  brute:   { label: 'Jawbreaker Brute', cls: 'tank' },
  aknight: { label: 'Sergeant Gummy',   cls: 'hknight' },
  aarcher: { label: 'Meringue Marksman', cls: 'harcher' },
  aboss:   { label: 'Great Gummi Golem', cls: 'hboss' },
};
for (const t of Object.values(ETYPES)) Object.assign(t, CLASSES[t.cls] || HERO_CLASSES[t.cls]);
for (const t of Object.values(ATYPES)) if (t.cls) Object.assign(t, CLASSES[t.cls] || HERO_CLASSES[t.cls]);
const ETYPE = Object.keys(ETYPES);
const ATYPE = Object.keys(ATYPES);
const E_SKIN = { grunt: 'chomper', runner: 'sprinter', flyer: 'wasp', sapper: 'sapper', tank: 'golem' };
const A_SKIN = { grunt: 'bruiser', runner: 'dasher', flyer: 'bee', sapper: 'breaker', tank: 'brute' };
const EHEROES = ['eknight', 'earcher', 'boss'];
const AHEROES = ['aknight', 'aarcher', 'aboss'];
const EHERO_FIRST = 900, EHERO_EVERY = 1000;  // AI heroes bolster any side with no humans on it
const KILLER_BONUS = 0.5;                     // owner of the killer earns +50% coins
const TEAM_NAME = ['Gummi Kingdom', 'Rock Candy Horde'];
const TEAM_EMOJI = ['🍬', '👹'];

/* neutral creep camps — clear them for XP and coins; they respawn */
const NTYPES = {
  wolf:  { label: 'Taffy Wolf',    hp: 150, dmg: 13, spd: 2.7, range: 26, aggro: 210, n: 3, xp: 30,  coin: 8,  r: 14 },
  bear:  { label: 'Brittle Bear',  hp: 280, dmg: 19, spd: 2.2, range: 30, aggro: 200, n: 2, xp: 48,  coin: 13, r: 17 },
  elder: { label: 'Elder Rockjaw', hp: 750, dmg: 32, spd: 1.8, range: 34, aggro: 220, n: 1, xp: 150, coin: 45, r: 22 },
};
const NTYPE = Object.keys(NTYPES);
const CAMP_RESPAWN = 900;                     // 90 s
const CAMP_LEASH = 380;

/* enemies get pulled off their trail by things near them; they give up
   the chase when the target strays too far */
const LEASH_MUL = 1.7;
const RESPAWN_T = (min) => 80 + Math.round(min * 15);   // hero respawn slows over the match

/* ================= tiny math + seeded rng ================= */

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function distToPath(path, x, y) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    best = Math.min(best, distToSeg(x, y, path[i].x, path[i].y, path[i + 1].x, path[i + 1].y));
  }
  return best;
}

/* ================= world generation ================= */

function buildWorld(seed) {
  const rnd = mulberry32(seed);
  const paths = [], props = [];
  const H = { x: HORDE.x, y: HORDE.y }, C = { x: CASTLE.x, y: CASTLE.y };

  /* subdivide a leg with a seeded perpendicular sway (zero at the ends) */
  function leg(a, b, n, amp) {
    const pts = [];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const bend = (rnd() - 0.5) * 2;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const sway = Math.sin(t * Math.PI) * amp * bend + Math.sin(t * Math.PI * 2.6) * amp * 0.3 * (rnd() - 0.5) * 2;
      pts.push({ x: Math.round(a.x + dx * t + px * sway), y: Math.round(a.y + dy * t + py * sway) });
    }
    return pts;
  }
  /* each lane is a list of corner-ish control points, joined by wiggly legs */
  const ctrls = [
    [H, { x: 300, y: -980 }, { x: 1780, y: -880 }, { x: 1800, y: 120 }, C],     // high road
    [H, C],                                                                      // mid road
    [H, { x: -1800, y: -120 }, { x: -1780, y: 880 }, { x: -300, y: 980 }, C],   // low road
  ];
  for (const c of ctrls) {
    const pts = [{ x: H.x, y: H.y }];
    for (let i = 0; i < c.length - 1; i++) {
      const segLen = dist(c[i].x, c[i].y, c[i + 1].x, c[i + 1].y);
      pts.push(...leg(c[i], c[i + 1], Math.max(2, Math.round(segLen / 380)), Math.min(180, segLen * 0.16)));
    }
    pts[pts.length - 1] = { x: C.x, y: C.y };            // lanes end at the castle
    paths.push(pts);
  }

  /* --- point at a fraction of a lane's length (for enemy towers) --- */
  function alongPath(pts, frac) {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += dist(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    let want = total * frac;
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = dist(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (want <= seg) {
        const t = seg ? want / seg : 0;
        const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: pts[i].x + dx * t, y: pts[i].y + dy * t, px: -dy / len, py: dx / len };
      }
      want -= seg;
    }
    return { ...pts.at(-1), px: 0, py: 1 };
  }

  /* --- lane towers for BOTH armies, mirrored down each path --- */
  const etowers = [], ptowers = [];
  for (let li = 0; li < paths.length; li++) {
    ETOWER_AT.forEach((frac, k) => {
      const side = (li + k) % 2 === 0 ? 1 : -1;
      const a = alongPath(paths[li], frac);                 // horde's half
      etowers.push({ x: Math.round(a.x + a.px * 78 * side), y: Math.round(a.y + a.py * 78 * side), lane: li });
      const b = alongPath(paths[li], 1 - frac);             // gummies' half, mirrored
      ptowers.push({ x: Math.round(b.x + b.px * 78 * side), y: Math.round(b.y + b.py * 78 * side), lane: li });
    });
  }
  /* --- a ring of guard towers hugging each base — no sneaky backdoors --- */
  for (const [ox, oy] of BASE_RING) {
    etowers.push({ x: H.x + ox, y: H.y + oy, lane: -1 });
    ptowers.push({ x: C.x - ox, y: C.y - oy, lane: -1 });
  }

  /* --- neutral creep camps in the wilds --- */
  const campKinds = ['wolf', 'wolf', 'wolf', 'wolf', 'bear', 'bear', 'bear', 'elder'];
  const camps = [];
  for (const kind of campKinds) {
    for (let tries = 0; tries < 200; tries++) {
      const x = (rnd() * 2 - 1) * (WORLD_W - 300), y = (rnd() * 2 - 1) * (WORLD_H - 300);
      if (paths.some((pp) => distToPath(pp, x, y) < 240)) continue;
      if (dist(x, y, C.x, C.y) < 650 || dist(x, y, H.x, H.y) < 650) continue;
      if (camps.some((c) => dist(x, y, c.x, c.y) < 520)) continue;
      if (etowers.some((t) => dist(x, y, t.x, t.y) < 350) || ptowers.some((t) => dist(x, y, t.x, t.y) < 350)) continue;
      camps.push({ x: Math.round(x), y: Math.round(y), kind });
      break;
    }
  }

  /* --- elevation ridges + tree thickets that block off-lane travel --- */
  const cellOk = (x, y) =>
    Math.abs(x) < WORLD_W - 80 && Math.abs(y) < WORLD_H - 80 &&
    paths.every((pp) => distToPath(pp, x, y) > 118) &&
    dist(x, y, C.x, C.y) > 420 && dist(x, y, H.x, H.y) > 420 &&
    camps.every((c) => dist(x, y, c.x, c.y) > 230) &&
    etowers.every((t) => dist(x, y, t.x, t.y) > 160) &&
    ptowers.every((t) => dist(x, y, t.x, t.y) > 160);
  const cellAt = (x, y) => ({
    i: clamp(Math.floor((x + WORLD_W) / WALK_CELL), 0, WALK_COLS - 1),
    j: clamp(Math.floor((y + WORLD_H) / WALK_CELL), 0, WALK_ROWS - 1),
  });
  const obstacles = [];          // [{i, j, x, y, t:'tree'|'rock', v}]
  const taken = new Set();
  function claim(x, y, t) {
    const { i, j } = cellAt(x, y);
    const key = j * WALK_COLS + i;
    if (taken.has(key) || !cellOk(-WORLD_W + (i + 0.5) * WALK_CELL, -WORLD_H + (j + 0.5) * WALK_CELL)) return false;
    taken.add(key);
    obstacles.push({ i, j, x: Math.round(-WORLD_W + (i + 0.5) * WALK_CELL), y: Math.round(-WORLD_H + (j + 0.5) * WALK_CELL), t, v: (rnd() * 3) | 0 });
    return true;
  }
  /* an unbroken tree-wall around the whole map — no sneaking along the rim.
     The grid overshoots the world, so if the outermost row/col is a sliver,
     the NEXT one in is the real wall */
  const edgeRows = [0, WALK_ROWS - 1];
  if ((WORLD_H * 2) % WALK_CELL > 0 && (WORLD_H * 2) % WALK_CELL < 60) edgeRows.push(WALK_ROWS - 2);
  const edgeCols = [0, WALK_COLS - 1];
  if ((WORLD_W * 2) % WALK_CELL > 0 && (WORLD_W * 2) % WALK_CELL < 60) edgeCols.push(WALK_COLS - 2);
  for (let i = 0; i < WALK_COLS; i++) for (const j of edgeRows) {
    const key = j * WALK_COLS + i;
    if (!taken.has(key)) {
      taken.add(key);
      obstacles.push({ i, j, x: Math.round(-WORLD_W + (i + 0.5) * WALK_CELL), y: Math.round(-WORLD_H + (j + 0.5) * WALK_CELL), t: 'tree', v: (rnd() * 3) | 0 });
    }
  }
  for (let j = 1; j < WALK_ROWS - 1; j++) for (const i of edgeCols) {
    const key = j * WALK_COLS + i;
    if (!taken.has(key)) {
      taken.add(key);
      obstacles.push({ i, j, x: Math.round(-WORLD_W + (i + 0.5) * WALK_CELL), y: Math.round(-WORLD_H + (j + 0.5) * WALK_CELL), t: 'tree', v: (rnd() * 3) | 0 });
    }
  }
  for (let r = 0; r < 14; r++) {                         // rock ridges — the "elevation"
    let x = (rnd() * 2 - 1) * (WORLD_W - 400), y = (rnd() * 2 - 1) * (WORLD_H - 400);
    let ang = rnd() * Math.PI * 2;
    const len = 4 + ((rnd() * 6) | 0);
    for (let k = 0; k < len; k++) {
      claim(x, y, 'rock');
      ang += (rnd() - 0.5) * 0.6;
      x += Math.cos(ang) * WALK_CELL; y += Math.sin(ang) * WALK_CELL;
    }
  }
  for (let t = 0; t < 105; t++) {                        // a proper FOREST of thickets
    const x = (rnd() * 2 - 1) * (WORLD_W - 150), y = (rnd() * 2 - 1) * (WORLD_H - 150);
    const n = 2 + ((rnd() * 4) | 0);
    let cx = x, cy = y;
    for (let k = 0; k < n; k++) {
      claim(cx, cy, 'tree');
      cx += (rnd() < 0.5 ? -1 : 1) * WALK_CELL * (rnd() < 0.5 ? 1 : 0);
      cy += (rnd() < 0.5 ? -1 : 1) * WALK_CELL * (cx === x ? 1 : (rnd() < 0.5 ? 1 : 0));
    }
  }
  for (let t = 0; t < 260; t++) {                        // lone pines & boulders filling the gaps
    claim((rnd() * 2 - 1) * (WORLD_W - 150), (rnd() * 2 - 1) * (WORLD_H - 150), rnd() < 0.8 ? 'tree' : 'rock');
  }

  /* walkability grid + guarantee that nothing is sealed off:
     flood-fill from the castle, then bulldoze a straight line
     from any cut-off pocket back toward home */
  function gridFrom(obs) {
    const g2 = new Uint8Array(WALK_COLS * WALK_ROWS);
    for (const o of obs) g2[o.j * WALK_COLS + o.i] = 1;
    return g2;
  }
  let block = gridFrom(obstacles);
  const cc = cellAt(C.x, C.y);
  for (let guard = 0; guard < 250; guard++) {
    const seen = new Uint8Array(block.length);
    const q = [cc.j * WALK_COLS + cc.i];
    seen[q[0]] = 1;
    while (q.length) {
      const cur = q.pop(), ci = cur % WALK_COLS, cj = (cur / WALK_COLS) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= WALK_COLS || nj >= WALK_ROWS) continue;
        const nk = nj * WALK_COLS + ni;
        if (seen[nk] || block[nk]) continue;
        seen[nk] = 1; q.push(nk);
      }
    }
    let pocket = -1;
    for (let k = 0; k < block.length; k++) if (!block[k] && !seen[k]) { pocket = k; break; }
    if (pocket < 0) break;
    let pi = pocket % WALK_COLS, pj = (pocket / WALK_COLS) | 0;
    while (!seen[pj * WALK_COLS + pi]) {                 // bulldoze toward the castle
      pi += Math.sign(cc.i - pi) || 0; pj += (pi === cc.i ? Math.sign(cc.j - pj) : 0);
      const k = pj * WALK_COLS + pi;
      const onEdge = edgeCols.includes(pi) || edgeRows.includes(pj);
      if (block[k] && !onEdge) {
        const oi = obstacles.findIndex((o) => o.j * WALK_COLS + o.i === k);
        if (oi >= 0) obstacles.splice(oi, 1);
        block[k] = 0;
      }
      if (pi === cc.i && pj === cc.j) break;
    }
    block = gridFrom(obstacles);
  }

  /* decorative candy scenery on open ground */
  const PROP_EMOJI = ['🍄', '🌸', '🌷', '🍩'];
  for (let i = 0; i < 60; i++) {
    const x = (rnd() * 2 - 1) * (WORLD_W - 120), y = (rnd() * 2 - 1) * (WORLD_H - 120);
    if (paths.some((pp) => distToPath(pp, x, y) < 100)) continue;
    if (dist(x, y, C.x, C.y) < 320 || dist(x, y, H.x, H.y) < 320) continue;
    const cl = cellAt(x, y);
    if (block[cl.j * WALK_COLS + cl.i]) continue;
    props.push({ x: Math.round(x), y: Math.round(y), e: PROP_EMOJI[(rnd() * PROP_EMOJI.length) | 0], s: 24 + rnd() * 22 });
  }
  return { paths, props, obstacles, block, camps, etowers, ptowers,
           w: WORLD_W, h: WORLD_H, castle: { x: C.x, y: C.y, r: CASTLE.r }, horde: { ...HORDE } };
}

/* can a unit stand here? bounds + the obstacle grid */
function walkable(world, x, y) {
  if (Math.abs(x) > WORLD_W || Math.abs(y) > WORLD_H) return false;
  const i = clamp(Math.floor((x + WORLD_W) / WALK_CELL), 0, WALK_COLS - 1);
  const j = clamp(Math.floor((y + WORLD_H) / WALK_CELL), 0, WALK_ROWS - 1);
  return !world.block[j * WALK_COLS + i];
}
/* move with wall-sliding so units skirt trees instead of sticking to them */
function slideMove(world, u, nx, ny) {
  if (walkable(world, nx, ny)) { u.x = nx; u.y = ny; return; }
  if (walkable(world, nx, u.y)) { u.x = nx; return; }
  if (walkable(world, u.x, ny)) { u.y = ny; }
}

/* where can a tower go? shared by host validation and the phone's ghost */
/* fog helpers — shared by the sim, placement rules, and both renderers */
function fogIdx(x, y) {
  const i = clamp(Math.floor((x + WORLD_W) / FOG_CELL), 0, FOG_COLS - 1);
  const j = clamp(Math.floor((y + WORLD_H) / FOG_CELL), 0, FOG_ROWS - 1);
  return j * FOG_COLS + i;
}
function revealCircle(sim, x, y, r) {
  const i0 = clamp(Math.floor((x - r + WORLD_W) / FOG_CELL), 0, FOG_COLS - 1);
  const i1 = clamp(Math.floor((x + r + WORLD_W) / FOG_CELL), 0, FOG_COLS - 1);
  const j0 = clamp(Math.floor((y - r + WORLD_H) / FOG_CELL), 0, FOG_ROWS - 1);
  const j1 = clamp(Math.floor((y + r + WORLD_H) / FOG_CELL), 0, FOG_ROWS - 1);
  let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const idx = j * FOG_COLS + i;
    if (sim.fog[idx]) continue;
    const cx = -WORLD_W + (i + 0.5) * FOG_CELL, cy = -WORLD_H + (j + 0.5) * FOG_CELL;
    if (dist(x, y, cx, cy) <= r) { sim.fog[idx] = 1; changed = true; }
  }
  if (changed) sim.fogV++;
}
function packFog(fog) {
  const rows = [];
  for (let j = 0; j < FOG_ROWS; j++) {
    let bits = 0;
    for (let i = 0; i < FOG_COLS; i++) if (fog[j * FOG_COLS + i]) bits |= (1 << i);
    rows.push(bits);
  }
  return rows;
}
function unpackFog(rows) {
  const fog = new Uint8Array(FOG_COLS * FOG_ROWS);
  for (let j = 0; j < FOG_ROWS; j++) for (let i = 0; i < FOG_COLS; i++) {
    if (rows[j] & (1 << i)) fog[j * FOG_COLS + i] = 1;
  }
  return fog;
}

/* fog is optional so headless tests can probe pure geometry */
function canPlace(world, blds, x, y, fog) {
  if (Math.abs(x) > WORLD_W * 0.95 || Math.abs(y) > WORLD_H * 0.95) return false;
  if (fog && !fog[fogIdx(x, y)]) return false;
  if (dist(x, y, CASTLE.x, CASTLE.y) < CASTLE.r + 75) return false;
  if (dist(x, y, HORDE.x, HORDE.y) < HORDE.r + 130) return false;
  if (!walkable(world, x, y)) return false;
  for (const c of world.camps) if (dist(x, y, c.x, c.y) < 180) return false;
  for (const t of world.etowers) if (dist(x, y, t.x, t.y) < 170) return false;
  for (const t of world.ptowers) if (dist(x, y, t.x, t.y) < 170) return false;
  for (const p of world.paths) if (distToPath(p, x, y) < 48) return false;
  for (const b of blds) {
    const bx = b.x !== undefined ? b.x : b[3], by = b.y !== undefined ? b.y : b[4];
    if (dist(x, y, bx, by) < 62) return false;
  }
  return true;
}

/* ================= sim ================= */
/* Two symmetric armies. team 0 = Gummi Kingdom (castle), team 1 = Rock Candy
   Horde (cavern). sim.allies holds team-0 creeps, sim.enemies team-1 creeps —
   same stats, different costumes. Players can fight for either side. */

const creepDef = (team, type) => (team === 0 ? ATYPES[type] : ETYPES[type]);
const creepsOf = (sim, team) => (team === 0 ? sim.allies : sim.enemies);
const towersOf = (sim, team) => (team === 0 ? sim.ptowers : sim.etowers);
const baseOf = (team) => (team === 0 ? { x: CASTLE.x, y: CASTLE.y, r: CASTLE.r } : { x: HORDE.x, y: HORDE.y, r: HORDE.r });

function makeSim(seed) {
  const sim = {
    seed,
    tick: 0, phase: 'pick', pickLeft: PICK_FAILSAFE,
    nextId: 1,
    world: buildWorld(seed),
    castle: { hp: CASTLE.hp, max: CASTLE.hp, hitAt: -999 },
    horde: { hp: HORDE.hp, max: HORDE.hp, hitAt: -999 },
    players: new Map(), order: [],
    enemies: [], allies: [], blds: [], neutrals: [], impacts: [], fx: [],
    etowers: [], ptowers: [], camps: [],
    spawnT: 40, aiHeroT: EHERO_FIRST, aiHeroN: [0, 0],
    fog: new Uint8Array(FOG_COLS * FOG_ROWS), fogV: 0,
    over: null,                        // 0 | 1 → winning team
    stats: { built: 0, towersDown: [0, 0] },
  };
  for (const t of sim.world.etowers) sim.etowers.push({ id: sim.nextId++, ...t, hp: ETOWER.hp, maxhp: ETOWER.hp, cd: 0 });
  for (const t of sim.world.ptowers) sim.ptowers.push({ id: sim.nextId++, ...t, hp: ETOWER.hp, maxhp: ETOWER.hp, cd: 0 });
  for (const c of sim.world.camps) {
    const camp = { ...c, respawnT: 0, id: sim.nextId++ };
    sim.camps.push(camp);
    fillCamp(sim, camp);
  }
  revealCircle(sim, CASTLE.x, CASTLE.y, 650);
  revealCircle(sim, HORDE.x, HORDE.y, 650);
  return sim;
}

function fillCamp(sim, camp) {
  const def = NTYPES[camp.kind];
  for (let i = 0; i < def.n; i++) {
    const a = (i / def.n) * Math.PI * 2;
    sim.neutrals.push({
      id: sim.nextId++, camp: camp.id, type: camp.kind,
      x: camp.x + Math.cos(a) * 46, y: camp.y + Math.sin(a) * 46,
      hp: def.hp, maxhp: def.hp, cd: 0, tgt: null,
    });
  }
}

function addPlayer(sim, playerId) {
  if (sim.players.has(playerId)) return sim.players.get(playerId);
  const seat = sim.order.length;
  const p = {
    id: playerId, seat, hero: null, team: 0, connected: true,
    x: CASTLE.x - CASTLE.r - 60, y: CASTLE.y - CASTLE.r - 60 - seat * 12, hp: 1, maxhp: 1,
    dead: false, respawn: 0, dir: { x: 0, y: 0 }, moveTo: null,
    coins: START_COINS + Math.round(sim.tick / 10),
    up: { dmg: 0, hp: 0, spd: 0, pow: 0 },
    xp: 0, lvl: 1,
    cds: [0, 0, 0], armor: 0, kills: 0,
    slow: 0, slowT: 0, frenzy: 0, haste: 0,
  };
  sim.players.set(playerId, p);
  sim.order.push(playerId);
  return p;
}

function heroDef(p) { return HEROES[HERO_IDX.indexOf(p.hero)]; }
const powMul = (p) => (1 + HUP.pow.mul * p.up.pow) * (1 + LVL_POW * (p.lvl - 1));
const dmgOf = (p) => Math.round(heroDef(p).dmg * (1 + HUP.dmg.mul * p.up.dmg) * (1 + LVL_DMG * (p.lvl - 1)));
const maxhpOf = (p) => Math.round(heroDef(p).hp * (1 + HUP.hp.mul * p.up.hp) * (1 + LVL_HP * (p.lvl - 1)));
const speedOf = (p) => heroDef(p).speed * (1 + HUP.spd.mul * p.up.spd);

/* XP: killer earns it all; TEAMMATES fighting nearby learn almost as much */
function addXp(sim, playerId, amount, x, y) {
  const killer = sim.players.get(playerId);
  const give = (p, amt) => {
    p.xp += amt;
    while (p.lvl < 10 && p.xp >= XP_LVL[p.lvl - 1]) {
      p.lvl++;
      const m = maxhpOf(p);
      p.hp = Math.min(m, p.hp + (m - p.maxhp) + Math.round(m * 0.25));
      p.maxhp = m;
      addFx(sim, 'level', p.x, p.y);
    }
  };
  if (killer && killer.hero) give(killer, amount);
  for (const q of sim.players.values()) {
    if (!q.hero || q.dead || q.id === playerId || (killer && q.team !== killer.team)) continue;
    if (dist(q.x, q.y, x, y) <= XP_SHARE_R) give(q, Math.round(amount * 0.45));
  }
}

function pickHero(sim, playerId, heroId, team) {
  const p = sim.players.get(playerId);
  if (!p || p.hero || !HERO_IDX.includes(heroId)) return;
  const t = team === 1 ? 1 : 0;
  if (HEROES[HERO_IDX.indexOf(heroId)].team !== t) return;   // each side has its OWN roster
  p.hero = heroId;
  p.team = t;
  p.maxhp = maxhpOf(p); p.hp = p.maxhp;
  const b = baseOf(p.team);
  const a = Math.atan2(-b.y, -b.x) + (p.seat - 2.5) * 0.3;
  p.x = b.x + Math.cos(a) * (b.r + 75);
  p.y = b.y + Math.sin(a) * (b.r + 75);
  addFx(sim, 'spawn', p.x, p.y);
  if (sim.phase === 'pick') {
    const waiting = [...sim.players.values()].filter((q) => q.connected && !q.hero);
    if (!waiting.length) startPlay(sim);
  }
}

function startPlay(sim) {
  sim.phase = 'play';
  sim.spawnT = 30;
  addFx(sim, 'horn', HORDE.x, HORDE.y);
}

/* ---------------- creep factories: identical groups for both armies ---------------- */

const minutesOf = (sim) => sim.tick / 600;
const warMult = (sim) => 1 + TIME_SCALE * minutesOf(sim);

function spawnCreep(sim, team, type, pathIdx, mult) {
  const def = creepDef(team, type);
  const path = sim.world.paths[pathIdx];
  const start = team === 1 ? path[0] : path.at(-1);
  const u = {
    id: sim.nextId++, team, type, path: pathIdx,
    wp: team === 1 ? 1 : path.length - 2,
    x: start.x + (Math.random() - 0.5) * 44, y: start.y + (Math.random() - 0.5) * 44,
    hp: Math.round(def.hp * mult), maxhp: Math.round(def.hp * mult),
    dmg: Math.round(def.dmg * (1 + (mult - 1) * 0.7)),
    role: 'lane', tgt: null, cd: 0, slow: 0, slowT: 0, stun: 0, taunt: null,
  };
  creepsOf(sim, team).push(u);
  return u;
}

function spawnGroups(sim) {
  const comp = makeComp(minutesOf(sim));      // ONE comp, marched by BOTH sides
  const mult = warMult(sim);
  comp.forEach((cls, i) => {
    spawnCreep(sim, 1, E_SKIN[cls], i % N_PATHS, mult);
    spawnCreep(sim, 0, A_SKIN[cls], i % N_PATHS, mult);
  });
  addFx(sim, 'spawn', HORDE.x, HORDE.y);
  addFx(sim, 'spawn', CASTLE.x, CASTLE.y);
}

function spawnAIHero(sim, team) {
  const roster = team === 1 ? EHEROES : AHEROES;
  const n = sim.aiHeroN[team]++;
  const type = roster[n % roster.length];
  const mult = warMult(sim) * (1 + 0.12 * Math.floor(n / roster.length));
  const u = spawnCreep(sim, team, type, (Math.random() * N_PATHS) | 0, mult);
  addFx(sim, 'horn', u.x, u.y);
  return u;
}

/* ---------------- building (any time, either team) ---------------- */

function build(sim, playerId, type, x, y) {
  const p = sim.players.get(playerId);
  if (!p || !p.hero || !BUILDABLE.includes(type)) return 'nope';
  const def = BLD[type];
  const cost = Math.round(def.cost * (heroDef(p).discount || 1));
  if (p.coins < cost) return 'coins';
  if (!sim.fog[fogIdx(x, y)]) return 'fog';
  if (!canPlace(sim.world, sim.blds, x, y)) return 'spot';
  p.coins -= cost;
  const b = { id: sim.nextId++, owner: playerId, team: p.team, type, x: Math.round(x), y: Math.round(y),
              lvl: 1, hp: def.hp, maxhp: def.hp, cd: 10, boost: 0, squadCd: 0 };
  sim.blds.push(b);
  sim.stats.built++;
  addFx(sim, 'built', b.x, b.y);
  if (type === 'barracks') for (let i = 0; i < BLD.barracks.squad; i++) spawnGummy(sim, b);
  return 'ok';
}

function spawnGummy(sim, b) {
  const a = Math.random() * Math.PI * 2;
  creepsOf(sim, b.team).push({
    id: sim.nextId++, team: b.team, role: 'guard', type: 'gummy', from: b.id, owner: b.owner,
    x: b.x + Math.cos(a) * 44, y: b.y + Math.sin(a) * 44,
    hp: ATYPES.gummy.hp * (1 + 0.2 * (b.lvl - 1)), maxhp: ATYPES.gummy.hp * (1 + 0.2 * (b.lvl - 1)),
    dmg: ATYPES.gummy.dmg, cd: 0, tgt: null, slow: 0, slowT: 0, stun: 0, taunt: null,
  });
}

function upgradeBld(sim, playerId, bldId) {
  const p = sim.players.get(playerId);
  const b = sim.blds.find((q) => q.id === bldId);
  if (!p || !b || b.owner !== playerId || b.type === 'wall') return;
  if (b.lvl >= BUP.max) return;
  const cost = bupCost(b.lvl);
  if (p.coins < cost) return;
  p.coins -= cost;
  b.lvl++;
  const hpGain = Math.round(b.maxhp * (BUP.hpMul - 1));
  b.maxhp += hpGain; b.hp += hpGain;
  addFx(sim, 'level', b.x, b.y);
}

function sellBld(sim, playerId, bldId) {
  const p = sim.players.get(playerId);
  const i = sim.blds.findIndex((q) => q.id === bldId);
  if (!p || i < 0 || sim.blds[i].owner !== playerId) return;
  const b = sim.blds[i];
  let paid = Math.round(BLD[b.type].cost * (heroDef(p).discount || 1));
  for (let l = 1; l < b.lvl; l++) paid += bupCost(l);
  p.coins += Math.round(paid * SELL_BACK);
  sim.blds.splice(i, 1);
  sim.allies = sim.allies.filter((a) => a.from !== b.id);
  sim.enemies = sim.enemies.filter((a) => a.from !== b.id);
  addFx(sim, 'sold', b.x, b.y);
}

function upgradeHero(sim, playerId, what) {
  const p = sim.players.get(playerId);
  if (!p || !p.hero || !HUP[what] || p.up[what] >= HUP_MAX) return;
  const cost = hupCost(p.up[what]);
  if (p.coins < cost) return;
  p.coins -= cost;
  p.up[what]++;
  if (what === 'hp') { const m = maxhpOf(p); p.hp += m - p.maxhp; p.maxhp = m; }
  addFx(sim, 'level', p.x, p.y);
}

function addFx(sim, t, x, y, x2, y2, r) {
  const f = { t, x: Math.round(x), y: Math.round(y) };
  if (x2 !== undefined) { f.x2 = Math.round(x2); f.y2 = Math.round(y2); }
  if (r !== undefined) f.r = Math.round(r);
  sim.fx.push(f);
  if (sim.fx.length > 60) sim.fx.shift();
}

/* ---------------- damage & bounty bookkeeping ---------------- */

function oppHeroes(sim, team) {
  return [...sim.players.values()].filter((q) => q.hero && !q.dead && q.team !== team);
}
/* hero-on-hero damage: armor applies; a takedown pays coins + XP by victim level */
function pvpHit(sim, victim, dmg, attacker) {
  const d = victim.armor > 0 ? Math.round(dmg * 0.4) : Math.round(dmg);
  victim.hp -= d;
  addFx(sim, 'hit', victim.x, victim.y);
  if (victim.hp <= 0) {
    killHero(sim, victim);
    if (attacker) {
      attacker.kills++;
      attacker.coins += 40 + 12 * victim.lvl;
      addXp(sim, attacker.id, 60 + 22 * victim.lvl, victim.x, victim.y);
    }
  }
}
function applySlowHero(p, amt, ticks) {
  if (amt >= (p.slow || 0)) { p.slow = amt; p.slowT = Math.max(p.slowT || 0, ticks); }
}

function killHero(sim, p) {
  p.dead = true; p.respawn = RESPAWN_T(minutesOf(sim)); p.dir = { x: 0, y: 0 }; p.moveTo = null;
  addFx(sim, 'herodown', p.x, p.y);
}

/* a creep of `team` died; pay the OTHER team */
function awardCreepKill(sim, u, killerOwner) {
  const def = creepDef(u.team, u.type);
  const winners = 1 - u.team;
  for (const p of sim.players.values()) {
    if (!p.hero || p.team !== winners) continue;
    let c = def.coin;
    if (killerOwner && p.id === killerOwner) { c = Math.round(c * (1 + KILLER_BONUS)); p.kills++; }
    p.coins += c;
  }
  if (killerOwner) addXp(sim, killerOwner, def.xp, u.x, u.y);
  addFx(sim, 'die', u.x, u.y);
}

function hurtCreep(sim, u, dmg, owner) {
  if (u.hp <= 0) return;
  u.hp -= Math.round(dmg * (creepDef(u.team, u.type).tough || 1));
  if (u.hp <= 0) awardCreepKill(sim, u, owner);
}
/* legacy names used by abilities/towers below */
const hurtEnemy = (sim, e, dmg, owner) => hurtCreep(sim, e, dmg, owner);

function hurtNeutral(sim, n, dmg, owner) {
  if (n.hp <= 0) return;
  n.hp -= dmg;
  if (n.hp <= 0) {
    const def = NTYPES[n.type];
    const p = owner ? sim.players.get(owner) : null;
    if (p) { p.coins += def.coin; p.kills++; addXp(sim, owner, def.xp, n.x, n.y); }
    addFx(sim, 'die', n.x, n.y);
  }
}

/* a lane/ring tower of `team` took damage */
function hurtTower(sim, tw, team, dmg, owner) {
  if (tw.hp <= 0) return;
  tw.hp -= dmg;
  addFx(sim, 'hit', tw.x, tw.y);
  if (tw.hp <= 0) {
    sim.stats.towersDown[team]++;
    const winners = 1 - team;
    for (const p of sim.players.values()) {
      if (p.hero && p.team === winners) p.coins += p.id === owner ? ETOWER.coin : Math.round(ETOWER.coin / 2);
    }
    if (owner) addXp(sim, owner, ETOWER.xp, tw.x, tw.y);
    addFx(sim, 'crumble', tw.x, tw.y);
    addFx(sim, 'towerdown', tw.x, tw.y);
  }
}
const hurtETower = (sim, t, dmg, owner) => hurtTower(sim, t, 1, dmg, owner);

/* the base of `team` took damage; destroying it means the OTHER team wins */
function hurtBase(sim, team, dmg) {
  const b = team === 0 ? sim.castle : sim.horde;
  b.hp -= dmg;
  b.hitAt = sim.tick;
  if (b.hp <= 0) {
    b.hp = 0;
    sim.over = 1 - team;
    addFx(sim, 'crumble', baseOf(team).x, baseOf(team).y);
  }
}
const hurtHorde = (sim, dmg) => hurtBase(sim, 1, dmg);

/* ---------------- abilities (team-aware) ---------------- */

function castAbility(sim, playerId, i) {
  const p = sim.players.get(playerId);
  if (!p || !p.hero || p.dead || sim.phase !== 'play') return;
  if (p.cds[i] > 0) return;
  const pm = powMul(p);
  const ab = ABILITIES[p.hero][i];
  p.cds[i] = Math.round(ab[2] * (1 - 0.02 * p.up.pow));
  const foes = creepsOf(sim, 1 - p.team);
  const mates = [...sim.players.values()].filter((q) => q.hero && !q.dead && q.team === p.team);
  const myBlds = sim.blds.filter((b) => b.team === p.team);

  if (p.hero === 'knight') {
    if (i === 0) {
      addFx(sim, 'bash', p.x, p.y, undefined, undefined, 130);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 130) {
        hurtCreep(sim, e, Math.round(40 * pm), p.id);
        if (!creepDef(e.team, e.type).boss) e.stun = Math.max(e.stun, 25);
      }
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 130) pvpHit(sim, q, 40 * pm, p);
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 130) hurtNeutral(sim, n, Math.round(40 * pm), p.id);
    } else if (i === 1) {
      addFx(sim, 'cry', p.x, p.y, undefined, undefined, 260);
      for (const e of foes) if (!creepDef(e.team, e.type).bldOnly && dist(e.x, e.y, p.x, p.y) <= 260) {
        e.taunt = { id: p.id, t: Math.round(60 * pm) };
      }
    } else {
      p.armor = Math.round(80 * pm);
      addFx(sim, 'shield', p.x, p.y);
    }
  } else if (p.hero === 'ranger') {
    if (i === 0) {
      addFx(sim, 'barrage', p.x, p.y, undefined, undefined, 240);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 240) hurtCreep(sim, e, Math.round(30 * pm), p.id);
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 240) pvpHit(sim, q, 30 * pm, p);
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 240) hurtNeutral(sim, n, Math.round(30 * pm), p.id);
    } else if (i === 1) {
      sim.impacts.push({ t: sim.tick, kind: 'field', team: p.team, x: p.x, y: p.y, r: 150, slow: 0.55, until: sim.tick + Math.round(80 * pm) });
      addFx(sim, 'trap', p.x, p.y, undefined, undefined, 150);
    } else {
      let best = null, bestIsHero = false;
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 400 && (!best || e.maxhp > best.maxhp)) best = e;
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 400 && (!best || q.maxhp > best.maxhp)) { best = q; bestIsHero = true; }
      if (best) {
        addFx(sim, 'pierce', p.x, p.y, best.x, best.y);
        if (bestIsHero) pvpHit(sim, best, 120 * pm, p);
        else hurtCreep(sim, best, Math.round(120 * pm), p.id);
      }
    }
  } else if (p.hero === 'mage') {
    if (i === 0) {
      addFx(sim, 'nova', p.x, p.y, undefined, undefined, 180);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 180) {
        hurtCreep(sim, e, Math.round(25 * pm), p.id);
        applySlow(e, 0.5, 40);
      }
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 180) { pvpHit(sim, q, 25 * pm, p); applySlowHero(q, 0.5, 40); }
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 180) hurtNeutral(sim, n, Math.round(25 * pm), p.id);
    } else if (i === 1) {
      let bx = null, by = null, bestN = -1;
      for (const e of foes) {
        if (dist(e.x, e.y, p.x, p.y) > 450) continue;
        let n = 0;
        for (const q of foes) if (dist(q.x, q.y, e.x, e.y) <= 110) n++;
        if (n > bestN) { bestN = n; bx = e.x; by = e.y; }
      }
      if (bx !== null) {
        sim.impacts.push({ t: sim.tick + 8, kind: 'boom', team: p.team, x: bx, y: by, r: 110, dmg: Math.round(80 * pm), owner: p.id, air: true });
        addFx(sim, 'meteor', bx, by);
      } else p.cds[i] = 10;
    } else {
      addFx(sim, 'heal', p.x, p.y, undefined, undefined, 260);
      const frac = 0.35 * pm;
      for (const q of mates) if (dist(q.x, q.y, p.x, p.y) <= 260) q.hp = Math.min(q.maxhp, q.hp + q.maxhp * frac);
      for (const a of creepsOf(sim, p.team)) if (dist(a.x, a.y, p.x, p.y) <= 260) a.hp = Math.min(a.maxhp, a.hp + a.maxhp * frac);
      for (const b of myBlds) if (dist(b.x, b.y, p.x, p.y) <= 260) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * frac);
    }
  } else if (p.hero === 'slasher') {
    if (i === 0) {
      addFx(sim, 'bash', p.x, p.y, undefined, undefined, 130);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 130) hurtCreep(sim, e, Math.round(45 * pm), p.id);
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 130) pvpHit(sim, q, 45 * pm, p);
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 130) hurtNeutral(sim, n, Math.round(45 * pm), p.id);
    } else if (i === 1) {
      p.frenzy = Math.round(60 * pm);              /* attack + move like a sugar rush */
      addFx(sim, 'overclock', p.x, p.y, undefined, undefined, 60);
    } else {
      /* Candy Leap: bound toward where you're headed (or the nearest foe) */
      let dx = p.dir.x, dy = p.dir.y;
      if (!dx && !dy && p.moveTo) { dx = p.moveTo.x - p.x; dy = p.moveTo.y - p.y; }
      if (!dx && !dy) {
        let near = null, nd = Infinity;
        for (const e of foes) { const d = dist(e.x, e.y, p.x, p.y); if (d < nd) { nd = d; near = e; } }
        if (near) { dx = near.x - p.x; dy = near.y - p.y; }
        else { const ob = baseOf(1 - p.team); dx = ob.x - p.x; dy = ob.y - p.y; }
      }
      const m = Math.hypot(dx, dy) || 1;
      addFx(sim, 'shell', p.x, p.y, p.x + (dx / m) * 260, p.y + (dy / m) * 260);
      for (let hop = 260; hop >= 60; hop -= 40) {   /* land on the farthest walkable spot */
        const nx = clamp(p.x + (dx / m) * hop, -WORLD_W, WORLD_W);
        const ny = clamp(p.y + (dy / m) * hop, -WORLD_H, WORLD_H);
        if (walkable(sim.world, nx, ny)) { p.x = nx; p.y = ny; break; }
      }
      addFx(sim, 'boom', p.x, p.y, undefined, undefined, 110);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 110) hurtCreep(sim, e, Math.round(30 * pm), p.id);
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 110) pvpHit(sim, q, 30 * pm, p);
    }
  } else if (p.hero === 'whip') {
    if (i === 0) {
      /* Triple Lash: the 3 nearest foes, heroes included */
      const marks = [];
      for (const e of foes) { const d = dist(e.x, e.y, p.x, p.y); if (d <= 260) marks.push({ d, e, hero: false }); }
      for (const q of oppHeroes(sim, p.team)) { const d = dist(q.x, q.y, p.x, p.y); if (d <= 260) marks.push({ d, e: q, hero: true }); }
      marks.sort((a, b) => a.d - b.d);
      for (const m of marks.slice(0, 3)) {
        addFx(sim, 'pierce', p.x, p.y, m.e.x, m.e.y);
        if (m.hero) pvpHit(sim, m.e, 60 * pm, p);
        else hurtCreep(sim, m.e, Math.round(60 * pm), p.id);
      }
      if (!marks.length) p.cds[i] = 10;
    } else if (i === 1) {
      sim.impacts.push({ t: sim.tick, kind: 'field', team: p.team, x: p.x, y: p.y, r: 130, slow: 0.7, until: sim.tick + Math.round(90 * pm) });
      addFx(sim, 'trap', p.x, p.y, undefined, undefined, 130);
    } else {
      addFx(sim, 'overclock', p.x, p.y, undefined, undefined, 400);
      for (const q of sim.players.values()) {
        if (q.hero && !q.dead && q.team === p.team && dist(q.x, q.y, p.x, p.y) <= 400) q.haste = Math.round(50 * pm);
      }
    }
  } else if (p.hero === 'shaman') {
    if (i === 0) {
      addFx(sim, 'nova', p.x, p.y, undefined, undefined, 170);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 170) {
        hurtCreep(sim, e, Math.round(25 * pm), p.id);
        if (!creepDef(e.team, e.type).boss) e.stun = Math.max(e.stun, 12);
      }
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 170) pvpHit(sim, q, 25 * pm, p);
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 170) hurtNeutral(sim, n, Math.round(25 * pm), p.id);
    } else if (i === 1) {
      const b = { id: sim.nextId++, owner: p.id, team: p.team, type: 'wall', x: Math.round(p.x), y: Math.round(p.y),
                  lvl: 1, hp: Math.round(BLD.wall.hp * 0.9 * pm), maxhp: Math.round(BLD.wall.hp * 0.9 * pm),
                  cd: 0, boost: 0, squadCd: 0, until: sim.tick + BLD.wall.temp };
      sim.blds.push(b);
      addFx(sim, 'built', b.x, b.y);
    } else {
      /* Dark Feast: drain every foe nearby, drink the damage */
      addFx(sim, 'cry', p.x, p.y, undefined, undefined, 220);
      let bites = 0;
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 220) { hurtCreep(sim, e, Math.round(30 * pm), p.id); bites++; }
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 220) { pvpHit(sim, q, 30 * pm, p); bites++; }
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 220) { hurtNeutral(sim, n, Math.round(30 * pm), p.id); bites++; }
      if (bites) { p.hp = Math.min(p.maxhp, p.hp + bites * Math.round(18 * pm)); addFx(sim, 'heal', p.x, p.y, undefined, undefined, 60); }
      else p.cds[i] = 10;
    }
  } else if (p.hero === 'tinker') {
    if (i === 0) {
      addFx(sim, 'syrup', p.x, p.y, undefined, undefined, 180);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 180) { hurtCreep(sim, e, Math.round(30 * pm), p.id); applySlow(e, 0.5, 60); }
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 180) { pvpHit(sim, q, 30 * pm, p); applySlowHero(q, 0.5, 60); }
    } else if (i === 1) {
      addFx(sim, 'heal', p.x, p.y, undefined, undefined, 200);
      for (const b of myBlds) if (dist(b.x, b.y, p.x, p.y) <= 200) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.5 * pm);
      p.hp = Math.min(p.maxhp, p.hp + Math.round(p.maxhp * 0.15 * pm));
    } else {
      const b = { id: sim.nextId++, owner: p.id, team: p.team, type: 'turret', x: Math.round(p.x), y: Math.round(p.y),
                  lvl: 1, hp: Math.round(BLD.turret.hp * 0.7), maxhp: Math.round(BLD.turret.hp * 0.7),
                  cd: 5, boost: 0, squadCd: 0, until: sim.tick + 300 };
      sim.blds.push(b);
      addFx(sim, 'built', b.x, b.y);
    }
  } else if (p.hero === 'builder') {
    if (i === 0) {
      addFx(sim, 'heal', p.x, p.y, undefined, undefined, 200);
      for (const b of myBlds) if (dist(b.x, b.y, p.x, p.y) <= 200) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.5 * pm);
    } else if (i === 1) {
      addFx(sim, 'overclock', p.x, p.y, undefined, undefined, 260);
      for (const b of myBlds) if (b.owner === p.id && dist(b.x, b.y, p.x, p.y) <= 260) b.boost = Math.round(80 * pm);
    } else {
      const b = { id: sim.nextId++, owner: p.id, team: p.team, type: 'wall', x: Math.round(p.x), y: Math.round(p.y),
                  lvl: 1, hp: Math.round(BLD.wall.hp * pm), maxhp: Math.round(BLD.wall.hp * pm),
                  cd: 0, boost: 0, squadCd: 0, until: sim.tick + BLD.wall.temp };
      sim.blds.push(b);
      addFx(sim, 'built', b.x, b.y);
    }
  }
}

function applySlow(e, amt, ticks) {
  if (creepDef(e.team, e.type).boss) amt *= 0.5;
  if (amt >= e.slow) { e.slow = amt; e.slowT = Math.max(e.slowT, ticks); }
}

/* ---------------- the one creep brain, marching either direction ---------------- */

function creepScan(sim, u) {
  const def = creepDef(u.team, u.type);
  const opp = 1 - u.team;
  /* home-turf fury: an enemy hero prowling near our base is never forgotten */
  if (u.tgt && u.tgt.kind === 'hero') {
    const cur = sim.players.get(u.tgt.id);
    const home = baseOf(u.team);
    if (cur && !cur.dead && dist(cur.x, cur.y, home.x, home.y) <= BASE_ZONE) return;
  }
  if (u.taunt && u.taunt.t > 0) {
    const p = sim.players.get(u.taunt.id);
    if (p && !p.dead) { u.tgt = { kind: 'hero', id: p.id }; return; }
    u.taunt = null;
  }
  let best = null, bestD = Infinity;
  const consider = (kind, id, x, y, extraR = 0) => {
    const d = dist(u.x, u.y, x, y);
    if (d < bestD && d <= def.aggro + extraR) { bestD = d; best = { kind, id }; }
  };
  if (!def.bldOnly) {
    for (const p of sim.players.values()) if (p.hero && !p.dead && p.team === opp) consider('hero', p.id, p.x, p.y);
    for (const a of creepsOf(sim, opp)) consider('creep', a.id, a.x, a.y);
  }
  for (const b of sim.blds) if (b.team === opp) consider('bld', b.id, b.x, b.y, b.type === 'wall' ? BLD.wall.lure - def.aggro : 0);
  u.tgt = best;
}

function tgtPos(sim, u, tgt) {
  if (!tgt) return null;
  if (tgt.kind === 'hero') { const p = sim.players.get(tgt.id); return p && !p.dead ? p : null; }
  if (tgt.kind === 'creep') return creepsOf(sim, 1 - u.team).find((a) => a.id === tgt.id) || null;
  if (tgt.kind === 'bld') return sim.blds.find((b) => b.id === tgt.id) || null;
  return null;
}

function hitHeroFrom(sim, p, rawDmg) {
  const dmg = p.armor > 0 ? Math.round(rawDmg * 0.4) : rawDmg;
  p.hp -= dmg;
  if (p.hp <= 0) killHero(sim, p);
}

function stepCreep(sim, u) {
  const def = creepDef(u.team, u.type);
  if (u.stun > 0) { u.stun--; return; }
  if (u.slowT > 0) { u.slowT--; if (u.slowT <= 0) u.slow = 0; }
  if (u.taunt) { u.taunt.t--; if (u.taunt.t <= 0) u.taunt = null; }
  for (const f of sim.impacts) {
    if (f.kind === 'field' && f.team !== u.team && dist(u.x, u.y, f.x, f.y) <= f.r) applySlow(u, f.slow, 3);
  }
  if (u.cd > 0) u.cd--;
  const spd = def.spd * (1 - u.slow);

  /* barracks guards: short leash around home, creeps only */
  if (u.role === 'guard') {
    const home = sim.blds.find((b) => b.id === u.from);
    if (!home) { u.hp = 0; return; }
    let t = u.tgt ? creepsOf(sim, 1 - u.team).find((e) => e.id === u.tgt) : null;
    if (t && (t.hp <= 0 || dist(t.x, t.y, home.x, home.y) > ATYPES.gummy.leash)) t = null;
    if (!t && sim.tick % 5 === (u.id % 5)) {
      let bd = Infinity;
      for (const e of creepsOf(sim, 1 - u.team)) {
        const d = dist(e.x, e.y, u.x, u.y);
        if (d < bd && d <= def.aggro && dist(e.x, e.y, home.x, home.y) <= ATYPES.gummy.leash) { bd = d; t = e; }
      }
    }
    u.tgt = t ? t.id : null;
    if (t) {
      const d = dist(u.x, u.y, t.x, t.y);
      if (d > def.range) slideMove(sim.world, u, u.x + ((t.x - u.x) / d) * spd, u.y + ((t.y - u.y) / d) * spd);
      else if (u.cd <= 0) {
        u.cd = def.cd;
        hurtCreep(sim, t, Math.round(def.dmg * (1 + 0.25 * (home.lvl - 1))), u.owner);
        addFx(sim, 'hit', t.x, t.y);
      }
    } else {
      const d = dist(u.x, u.y, home.x, home.y);
      if (d > 60) slideMove(sim.world, u, u.x + ((home.x - u.x) / d) * spd, u.y + ((home.y - u.y) / d) * spd);
    }
    return;
  }

  /* lane fighters */
  if (sim.tick % 5 === (u.id % 5)) creepScan(sim, u);
  const t = tgtPos(sim, u, u.tgt);
  if (t) {
    const tr = t.type && BLD[t.type] ? BLD[t.type].r : 16;
    const d = dist(u.x, u.y, t.x, t.y);
    const lureR = (u.tgt.kind === 'bld' && t.type === 'wall') ? BLD.wall.lure : def.aggro;
    /* home-turf fury: while an enemy HERO prowls near our base, never give up the chase */
    const home = baseOf(u.team);
    const heroInvading = u.tgt.kind === 'hero' && dist(t.x, t.y, home.x, home.y) <= BASE_ZONE;
    if (!heroInvading && d > lureR * LEASH_MUL) { u.tgt = null; }
    else if (d > def.range + tr) {
      if (def.air) { u.x += ((t.x - u.x) / d) * spd; u.y += ((t.y - u.y) / d) * spd; }
      else slideMove(sim.world, u, u.x + ((t.x - u.x) / d) * spd, u.y + ((t.y - u.y) / d) * spd);
      return;
    } else {
      if (u.cd <= 0) {
        u.cd = 10;
        addFx(sim, 'hit', t.x, t.y);
        if (u.tgt.kind === 'hero') hitHeroFrom(sim, t, u.dmg);
        else if (u.tgt.kind === 'creep') hurtCreep(sim, t, u.dmg, u.owner);
        else {
          t.hp -= u.dmg * (def.bldOnly ? 1.5 : 1);
          if (t.hp <= 0) {
            sim.blds = sim.blds.filter((b) => b.id !== t.id);
            sim.allies = sim.allies.filter((a) => a.from !== t.id);
            sim.enemies = sim.enemies.filter((a) => a.from !== t.id);
            addFx(sim, 'crumble', t.x, t.y);
          }
        }
      }
      return;
    }
  }
  /* nothing to fight — HUNT the nearest opposing tower in sight */
  let hunt = null, hd2 = Infinity;
  for (const tw of towersOf(sim, 1 - u.team)) {
    const d = dist(u.x, u.y, tw.x, tw.y);
    if (d <= Math.max(def.aggro * 1.3, 220) && d < hd2) { hd2 = d; hunt = tw; }
  }
  if (hunt) {
    if (hd2 > def.range + ETOWER.r) {
      if (def.air) { u.x += ((hunt.x - u.x) / hd2) * spd; u.y += ((hunt.y - u.y) / hd2) * spd; }
      else slideMove(sim.world, u, u.x + ((hunt.x - u.x) / hd2) * spd, u.y + ((hunt.y - u.y) / hd2) * spd);
    } else if (u.cd <= 0) { u.cd = 10; hurtTower(sim, hunt, 1 - u.team, u.dmg, u.owner); }
    return;
  }
  const oppBase = baseOf(1 - u.team);
  const db = dist(u.x, u.y, oppBase.x, oppBase.y);
  if (db <= oppBase.r + def.range + 10) {
    if (u.cd <= 0) {
      u.cd = 10;
      hurtBase(sim, 1 - u.team, Math.round(u.dmg * (def.bldOnly ? 1.4 : 1)));
      addFx(sim, u.team === 1 ? 'castlehit' : 'hit', u.x, u.y);
    }
    return;
  }
  /* march the lane toward the opposing base */
  const path = sim.world.paths[u.path];
  const step = u.team === 1 ? 1 : -1;
  const wp = path[clamp(u.wp, 0, path.length - 1)];
  const d = dist(u.x, u.y, wp.x, wp.y);
  if (d < 30) u.wp = clamp(u.wp + step, 0, path.length - 1);
  if (d > 1) { u.x += ((wp.x - u.x) / d) * spd; u.y += ((wp.y - u.y) / d) * spd; }
}

/* ---------------- neutral camps: cranky at everyone ---------------- */

function stepNeutral(sim, n) {
  const def = NTYPES[n.type];
  const camp = sim.camps.find((c) => c.id === n.camp);
  if (n.cd > 0) n.cd--;
  let t = null;
  if (n.tgt) {
    if (n.tgt.kind === 'hero') { const p = sim.players.get(n.tgt.id); t = p && !p.dead ? p : null; }
    else t = creepsOf(sim, n.tgt.team).find((a) => a.id === n.tgt.id) || null;
  }
  if (t && dist(t.x, t.y, camp.x, camp.y) > CAMP_LEASH) t = null;
  if (!t && sim.tick % 5 === (n.id % 5)) {
    let bd = Infinity;
    for (const p of sim.players.values()) {
      if (!p.hero || p.dead) continue;
      const d = dist(p.x, p.y, n.x, n.y);
      if (d < bd && d <= def.aggro) { bd = d; t = p; n.tgt = { kind: 'hero', id: p.id }; }
    }
    for (const team of [0, 1]) for (const a of creepsOf(sim, team)) {
      const d = dist(a.x, a.y, n.x, n.y);
      if (d < bd && d <= def.aggro) { bd = d; t = a; n.tgt = { kind: 'creep', team, id: a.id }; }
    }
  }
  if (!t) {
    n.tgt = null;
    const d = dist(n.x, n.y, camp.x, camp.y);
    if (d > 70) {
      slideMove(sim.world, n, n.x + ((camp.x - n.x) / d) * def.spd, n.y + ((camp.y - n.y) / d) * def.spd);
      n.hp = Math.min(n.maxhp, n.hp + n.maxhp * 0.01);
    }
    return;
  }
  const d = dist(n.x, n.y, t.x, t.y);
  if (d > def.range) slideMove(sim.world, n, n.x + ((t.x - n.x) / d) * def.spd, n.y + ((t.y - n.y) / d) * def.spd);
  else if (n.cd <= 0) {
    n.cd = 10;
    addFx(sim, 'hit', t.x, t.y);
    if (n.tgt.kind === 'hero') hitHeroFrom(sim, t, def.dmg);
    else hurtCreep(sim, t, def.dmg, null);
  }
}

/* ---------------- towers & buildings ---------------- */

/* a lane/ring tower belonging to `team` shoots the nearest intruder */
function stepTower(sim, tw, team) {
  if (tw.cd > 0) { tw.cd--; return; }
  const opp = 1 - team;
  let best = null, bd = Infinity, kind = null;
  for (const a of creepsOf(sim, opp)) { const d = dist(a.x, a.y, tw.x, tw.y); if (d <= ETOWER.range && d < bd) { bd = d; best = a; kind = 'creep'; } }
  for (const p of sim.players.values()) {
    if (!p.hero || p.dead || p.team !== opp) continue;
    const d = dist(p.x, p.y, tw.x, tw.y);
    if (d <= ETOWER.range && d < bd) { bd = d; best = p; kind = 'hero'; }
  }
  for (const b of sim.blds) { if (b.team !== opp) continue; const d = dist(b.x, b.y, tw.x, tw.y); if (d <= ETOWER.range && d < bd) { bd = d; best = b; kind = 'bld'; } }
  if (!best) return;
  tw.cd = ETOWER.cd;
  addFx(sim, 'etzap', tw.x, tw.y, best.x, best.y);
  if (kind === 'hero') hitHeroFrom(sim, best, ETOWER.dmg);
  else if (kind === 'creep') hurtCreep(sim, best, ETOWER.dmg, null);
  else {
    best.hp -= ETOWER.dmg;
    if (best.hp <= 0) {
      sim.blds = sim.blds.filter((b) => b.id !== best.id);
      sim.allies = sim.allies.filter((a) => a.from !== best.id);
      sim.enemies = sim.enemies.filter((a) => a.from !== best.id);
      addFx(sim, 'crumble', best.x, best.y);
    }
  }
}

function stepBld(sim, b) {
  if (b.until && sim.tick >= b.until) { b.hp = 0; return; }
  const def = BLD[b.type];
  const opp = 1 - b.team;
  if (b.boost > 0) b.boost--;
  if (b.type === 'barracks') {
    const mine = creepsOf(sim, b.team).filter((a) => a.from === b.id).length;
    const squad = def.squad + (b.lvl >= 4 ? 1 : 0);
    if (mine < squad) {
      if (b.squadCd > 0) b.squadCd--;
      else { b.squadCd = def.respawn; spawnGummy(sim, b); addFx(sim, 'spawn', b.x, b.y); }
    }
    return;
  }
  if (!def.range) return;
  if (b.cd > 0) { b.cd -= b.boost > 0 ? 2 : 1; return; }
  const range = def.range * Math.pow(BUP.rangeMul, b.lvl - 1);
  const foes = creepsOf(sim, opp);
  if (b.type === 'syrup') {
    let any = false;
    for (const e of foes) if (dist(e.x, e.y, b.x, b.y) <= range) { applySlow(e, def.slow + 0.05 * (b.lvl - 1), 8); any = true; }
    for (const q of oppHeroes(sim, b.team)) if (dist(q.x, q.y, b.x, b.y) <= range) { applySlowHero(q, def.slow, 8); any = true; }
    if (any) { b.cd = def.cd; addFx(sim, 'syrup', b.x, b.y, undefined, undefined, range); }
    return;
  }
  let best = null, bd = Infinity;
  for (const e of foes) {
    const air = !!creepDef(e.team, e.type).air;
    if (def.air ? !air : air) continue;
    const d = dist(e.x, e.y, b.x, b.y);
    if (def.minRange && d < def.minRange) continue;
    if (d <= range && d < bd) { bd = d; best = e; }
  }
  const dmg = Math.round(def.dmg * Math.pow(BUP.dmgMul, b.lvl - 1));
  if (best) {
    b.cd = def.cd;
    if (b.type === 'mortar') {
      sim.impacts.push({ t: sim.tick + 6, kind: 'boom', team: b.team, x: best.x, y: best.y, r: def.splash + 6 * (b.lvl - 1), dmg, owner: b.owner, air: false });
      addFx(sim, 'shell', b.x, b.y, best.x, best.y);
    } else {
      addFx(sim, b.type === 'launcher' ? 'zap' : 'pew', b.x, b.y, best.x, best.y);
      hurtCreep(sim, best, dmg, b.owner);
    }
    return;
  }
  /* GROUND artillery with no creeps in sight besieges enemy structures */
  if (b.type !== 'turret' && b.type !== 'mortar') return;
  let bt = null; bd = Infinity;
  for (const tw of towersOf(sim, opp)) {
    const d = dist(tw.x, tw.y, b.x, b.y);
    if (d <= range && d < bd) { bd = d; bt = { tower: tw }; }
  }
  const oppBase = baseOf(opp);
  const dbase = dist(oppBase.x, oppBase.y, b.x, b.y);
  if (dbase <= range + oppBase.r && dbase < bd) bt = { base: opp };
  if (!bt) return;
  b.cd = def.cd;
  if (bt.tower) {
    addFx(sim, b.type === 'mortar' ? 'shell' : 'pew', b.x, b.y, bt.tower.x, bt.tower.y);
    hurtTower(sim, bt.tower, opp, dmg, b.owner);
  } else {
    addFx(sim, b.type === 'mortar' ? 'shell' : 'pew', b.x, b.y, oppBase.x, oppBase.y);
    hurtBase(sim, opp, dmg);
  }
}

/* ---------------- the master tick ---------------- */

function stepSim(sim) {
  sim.tick++;
  if (sim.over !== null) return;

  if (sim.phase === 'pick') {
    if (--sim.pickLeft <= 0) {
      for (const p of sim.players.values()) if (!p.hero) {
        const roster = heroesOfTeam(p.team);
        pickHero(sim, p.id, roster[p.seat % roster.length].id, p.team);
      }
      if (sim.phase === 'pick') startPlay(sim);
    }
    return;
  }

  /* heroes */
  for (const p of sim.players.values()) {
    if (!p.hero) continue;
    const myBase = baseOf(p.team);
    if (p.dead) {
      if (--p.respawn <= 0) {
        p.dead = false; p.hp = p.maxhp;
        p.x = myBase.x - Math.sign(myBase.x) * (myBase.r + 60);
        p.y = myBase.y - Math.sign(myBase.y) * (myBase.r + 60);
        addFx(sim, 'spawn', p.x, p.y);
      }
      continue;
    }
    if (p.armor > 0) p.armor--;
    if (p.frenzy > 0) p.frenzy--;
    if (p.haste > 0) p.haste--;
    if (p.slowT > 0) { p.slowT--; if (p.slowT <= 0) p.slow = 0; }
    for (const f of sim.impacts) {
      if (f.kind === 'field' && f.team !== p.team && dist(p.x, p.y, f.x, f.y) <= f.r) applySlowHero(p, f.slow, 3);
    }
    const hdR = heroDef(p);
    if (hdR.regen && p.hp < p.maxhp) p.hp = Math.min(p.maxhp, p.hp + p.maxhp * hdR.regen);
    if (dist(p.x, p.y, myBase.x, myBase.y) < FOUNTAIN_R && p.hp < p.maxhp) {
      p.hp = Math.min(p.maxhp, p.hp + p.maxhp * 0.0025);
    }
    for (let i = 0; i < 3; i++) if (p.cds[i] > 0) p.cds[i]--;
    const spd = speedOf(p) * (1 - (p.slow || 0)) * (p.frenzy > 0 ? 1.35 : 1) * (p.haste > 0 ? 1.4 : 1);
    if (p.dir.x || p.dir.y) {
      const m = Math.hypot(p.dir.x, p.dir.y) || 1;
      slideMove(sim.world, p, p.x + (p.dir.x / m) * spd, p.y + (p.dir.y / m) * spd);
      p.moveTo = null;
    } else if (p.moveTo) {
      const d = dist(p.x, p.y, p.moveTo.x, p.moveTo.y);
      if (d < spd * 1.5) p.moveTo = null;
      else slideMove(sim.world, p, p.x + ((p.moveTo.x - p.x) / d) * spd, p.y + ((p.moveTo.y - p.y) / d) * spd);
    }
    p.x = clamp(p.x, -WORLD_W, WORLD_W);
    p.y = clamp(p.y, -WORLD_H, WORLD_H);
    for (const team of [0, 1]) {                       // nobody walks through either keep
      const bb = baseOf(team);
      const dc = dist(p.x, p.y, bb.x, bb.y);
      if (dc < bb.r + 20 && dc > 0) {
        const k = (bb.r + 20) / dc;
        p.x = bb.x + (p.x - bb.x) * k;
        p.y = bb.y + (p.y - bb.y) * k;
      }
    }
    if (p.rx === undefined || dist(p.x, p.y, p.rx, p.ry) > FOG_CELL * 0.4) {
      p.rx = p.x; p.ry = p.y;
      revealCircle(sim, p.x, p.y, REVEAL_R);
    }
    if (sim.tick % 10 === 0) p.coins += COIN_TRICKLE;

    /* auto-attack: opposing creeps → neutrals → opposing towers/blds → their base */
    if (!p.atkCd || --p.atkCd <= 0) {
      const hd = heroDef(p);
      const opp = 1 - p.team;
      let best = null, bd = Infinity, kind = null;
      for (const e of creepsOf(sim, opp)) {
        if (creepDef(e.team, e.type).air && !hd.hitAir) continue;
        const d = dist(e.x, e.y, p.x, p.y);
        if (d <= hd.range + 14 && d < bd) { bd = d; best = e; kind = 'creep'; }
      }
      for (const q of oppHeroes(sim, p.team)) {            /* rival heroes are fair game */
        const d = dist(q.x, q.y, p.x, p.y);
        if (d <= hd.range + 14 && d < bd) { bd = d; best = q; kind = 'pvp'; }
      }
      if (!best) for (const n of sim.neutrals) {
        const d = dist(n.x, n.y, p.x, p.y);
        if (d <= hd.range + 14 && d < bd) { bd = d; best = n; kind = 'neutral'; }
      }
      if (!best) for (const tw of towersOf(sim, opp)) {
        const d = dist(tw.x, tw.y, p.x, p.y);
        if (d <= hd.range + ETOWER.r && d < bd) { bd = d; best = tw; kind = 'tower'; }
      }
      if (!best) for (const b of sim.blds) {
        if (b.team !== opp) continue;
        const d = dist(b.x, b.y, p.x, p.y);
        if (d <= hd.range + BLD[b.type].r && d < bd) { bd = d; best = b; kind = 'bld'; }
      }
      const oppBase = baseOf(opp);
      if (!best && dist(p.x, p.y, oppBase.x, oppBase.y) <= hd.range + oppBase.r + 10) { best = oppBase; kind = 'base'; }
      if (best) {
        p.atkCd = Math.max(2, Math.round(hd.cd * (p.frenzy > 0 ? 0.5 : 1)));
        addFx(sim, hd.range > 100 ? 'pew' : 'slash', p.x, p.y, best.x, best.y);
        const dmg = dmgOf(p);
        if (kind === 'pvp') {
          pvpHit(sim, best, dmg, p);
          if (hd.splash) for (const q of oppHeroes(sim, p.team)) {
            if (q !== best && dist(q.x, q.y, best.x, best.y) <= hd.splash) pvpHit(sim, q, dmg, p);
          }
        } else if (kind === 'creep') {
          if (hd.splash) { for (const e of creepsOf(sim, opp)) if (dist(e.x, e.y, best.x, best.y) <= hd.splash) hurtCreep(sim, e, dmg, p.id); }
          else hurtCreep(sim, best, dmg, p.id);
        } else if (kind === 'neutral') hurtNeutral(sim, best, dmg, p.id);
        else if (kind === 'tower') hurtTower(sim, best, opp, dmg, p.id);
        else if (kind === 'bld') {
          best.hp -= dmg;
          addFx(sim, 'hit', best.x, best.y);
          if (best.hp <= 0) {
            sim.blds = sim.blds.filter((q) => q.id !== best.id);
            sim.allies = sim.allies.filter((a) => a.from !== best.id);
            sim.enemies = sim.enemies.filter((a) => a.from !== best.id);
            addFx(sim, 'crumble', best.x, best.y);
          }
        }
        else hurtBase(sim, opp, dmg);
      }
    }
  }

  /* both bases spawn IDENTICAL groups of 10, every 20 seconds, forever */
  if (--sim.spawnT <= 0) {
    sim.spawnT = SPAWN_EVERY;
    spawnGroups(sim);
  }
  /* AI heroes reinforce any side that has no human players */
  if (--sim.aiHeroT <= 0) {
    sim.aiHeroT = EHERO_EVERY;
    const humans = [0, 0];
    for (const p of sim.players.values()) if (p.hero && p.connected) humans[p.team]++;
    for (const team of [0, 1]) if (humans[team] === 0) spawnAIHero(sim, team);
  }
  for (const c of sim.camps) {
    if (c.respawnT > 0 && --c.respawnT <= 0) fillCamp(sim, c);
    else if (c.respawnT <= 0 && !sim.neutrals.some((n) => n.camp === c.id)) c.respawnT = CAMP_RESPAWN;
  }

  for (const e of sim.enemies) stepCreep(sim, e);
  sim.enemies = sim.enemies.filter((e) => e.hp > 0);
  for (const a of sim.allies) stepCreep(sim, a);
  sim.allies = sim.allies.filter((a) => a.hp > 0);
  for (const n of sim.neutrals) stepNeutral(sim, n);
  sim.neutrals = sim.neutrals.filter((n) => n.hp > 0);
  for (const tw of sim.etowers) stepTower(sim, tw, 1);
  sim.etowers = sim.etowers.filter((tw) => tw.hp > 0);
  for (const tw of sim.ptowers) stepTower(sim, tw, 0);
  sim.ptowers = sim.ptowers.filter((tw) => tw.hp > 0);
  for (const b of sim.blds) stepBld(sim, b);
  sim.blds = sim.blds.filter((b) => b.hp > 0);

  for (const im of sim.impacts) {
    if (im.kind === 'boom' && sim.tick >= im.t) {
      addFx(sim, 'boom', im.x, im.y, undefined, undefined, im.r);
      for (const e of creepsOf(sim, 1 - im.team)) {
        if (creepDef(e.team, e.type).air && !im.air) continue;
        if (dist(e.x, e.y, im.x, im.y) <= im.r) hurtCreep(sim, e, im.dmg, im.owner);
      }
      const owner = im.owner ? sim.players.get(im.owner) : null;
      for (const q of oppHeroes(sim, im.team)) {
        if (dist(q.x, q.y, im.x, im.y) <= im.r) pvpHit(sim, q, im.dmg, owner);
      }
      im.done = true;
    }
    if (im.kind === 'field' && sim.tick >= im.until) im.done = true;
  }
  sim.impacts = sim.impacts.filter((im) => !im.done);
  sim.enemies = sim.enemies.filter((e) => e.hp > 0);
  sim.allies = sim.allies.filter((a) => a.hp > 0);
}

function snapshot(sim) {
  const pl = [];
  for (const id of sim.order) {
    const p = sim.players.get(id);
    const nextXp = p.lvl >= 10 ? 1 : XP_LVL[p.lvl - 1];
    const prevXp = p.lvl <= 1 ? 0 : XP_LVL[p.lvl - 2];
    pl.push([
      p.seat, p.hero ? HERO_IDX.indexOf(p.hero) : -1,
      Math.round(p.x), Math.round(p.y), Math.round(p.hp), p.maxhp,
      p.dead ? Math.max(1, p.respawn) : 0, p.coins,
      p.cds[0], p.cds[1], p.cds[2],
      p.lvl, p.kills, p.armor > 0 ? 1 : 0,
      p.up.dmg, p.up.hp, p.up.spd, p.up.pow,
      p.lvl >= 10 ? 100 : Math.round(((p.xp - prevXp) / (nextXp - prevXp)) * 100),
      p.team,
    ]);
  }
  const e = sim.enemies.map((n) => [
    n.id, ETYPE.indexOf(n.type), Math.round(n.x), Math.round(n.y),
    Math.round((n.hp / n.maxhp) * 100), n.stun > 0 ? 1 : 0, n.slow > 0 ? 1 : 0,
  ]);
  const a = sim.allies.map((n) => {
    const p = n.owner ? sim.players.get(n.owner) : null;
    return [n.id, p ? p.seat : -1, ATYPE.indexOf(n.type), Math.round(n.x), Math.round(n.y), Math.round((n.hp / n.maxhp) * 100)];
  });
  const b = sim.blds.map((n) => {
    const p = sim.players.get(n.owner);
    return [n.id, p ? p.seat : 0, BTYPE.indexOf(n.type), n.x, n.y, n.lvl,
            Math.round((n.hp / n.maxhp) * 100), n.boost > 0 ? 1 : 0, n.team];
  });
  const eb = sim.etowers.map((t) => [t.id, t.x, t.y, Math.round((t.hp / t.maxhp) * 100)]);
  const pt = sim.ptowers.map((t) => [t.id, t.x, t.y, Math.round((t.hp / t.maxhp) * 100)]);
  const nn = sim.neutrals.map((n) => [n.id, NTYPE.indexOf(n.type), Math.round(n.x), Math.round(n.y), Math.round((n.hp / n.maxhp) * 100)]);
  const fields = sim.impacts.filter((im) => im.kind === 'field').map((im) => [im.x, im.y, im.r]);
  const snap = {
    k: 'snap', n: sim.tick, ph: sim.phase,
    pt: sim.phase === 'pick' ? sim.pickLeft : 0,
    clock: Math.floor(sim.tick / 10),
    c: [Math.round(sim.castle.hp), sim.castle.max],
    hb: [Math.round(sim.horde.hp), sim.horde.max],
    ap: [0, 1, 2],
    pl, e, a, b, eb, pt, nn, fields, fx: sim.fx,
  };
  snap.chit = sim.tick - sim.castle.hitAt < 12 ? 1 : 0;
  snap.hhit = sim.tick - sim.horde.hitAt < 12 ? 1 : 0;
  snap.fogV = sim.fogV;
  snap.fog = packFog(sim.fog);
  if (sim.over !== null) snap.over = sim.over;
  sim.fx = [];
  return snap;
}

/* ================= shared drawing ================= */

/* Candy Kingdoms-style helpers: darker shades + rounded rects */
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), gg = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${gg},${b})`;
}
function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function face(g, x, y, sc, mood) {
  const ink = '#3a2038';
  g.fillStyle = ink;
  g.beginPath(); g.arc(x - 4.5 * sc, y, 1.9 * sc, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x + 4.5 * sc, y, 1.9 * sc, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ink; g.lineWidth = 1.6 * sc; g.lineCap = 'round';
  if (mood === 'angry') {                                  /* slanted brows + frown */
    g.beginPath(); g.moveTo(x - 7 * sc, y - 5 * sc); g.lineTo(x - 2.5 * sc, y - 3 * sc); g.stroke();
    g.beginPath(); g.moveTo(x + 7 * sc, y - 5 * sc); g.lineTo(x + 2.5 * sc, y - 3 * sc); g.stroke();
    g.beginPath(); g.arc(x, y + 7 * sc, 3.4 * sc, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke();
  } else if (mood === 'ko') {
    g.beginPath(); g.moveTo(x - 3 * sc, y + 5 * sc); g.lineTo(x + 3 * sc, y + 5 * sc); g.stroke();
  } else {
    g.beginPath(); g.arc(x, y + 2.5 * sc, 3.4 * sc, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  }
}

/* the world never changes, so we paint it once into an offscreen canvas
   and blit it every frame — a phone can't repaint 300 trees at 60 fps */
const TCACHE = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function drawTerrain(g, world, activePaths, now) {
  if (TCACHE && typeof document !== 'undefined') {
    let cache = TCACHE.get(world);
    if (!cache) {
      cache = document.createElement('canvas');
      const sc = 0.5;
      cache.width = Math.round(world.w * 2 * sc);
      cache.height = Math.round(world.h * 2 * sc);
      const cg = cache.getContext('2d');
      cg.scale(sc, sc);
      cg.translate(world.w, world.h);
      drawTerrainRaw(cg, world);
      TCACHE.set(world, cache);
    }
    g.drawImage(cache, -world.w, -world.h, world.w * 2, world.h * 2);
    /* only the marching lane dashes animate, so they stay live */
    for (let i = 0; i < world.paths.length; i++) {
      const p = world.paths[i];
      if (!(activePaths && activePaths.includes(i))) continue;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(214,86,60,.55)'; g.lineWidth = 8;
      g.setLineDash([26, 40]); g.lineDashOffset = -(now * 0.04) % 66;
      g.beginPath(); g.moveTo(p[0].x, p[0].y);
      for (let k = 1; k < p.length; k++) g.lineTo(p[k].x, p[k].y);
      g.stroke(); g.setLineDash([]);
    }
    return;
  }
  drawTerrainRaw(g, world);
}

function drawTerrainRaw(g, world) {
  const W = world.w, H = world.h;
  /* widescreen meadow with a candy border */
  const grad = g.createLinearGradient(-W, -H, W, H);
  grad.addColorStop(0, '#9ed98a'); grad.addColorStop(1, '#b8e6a0');
  g.fillStyle = grad;
  rr(g, -W, -H, W * 2, H * 2, 130); g.fill();
  g.strokeStyle = '#5ea75d'; g.lineWidth = 30;
  rr(g, -W, -H, W * 2, H * 2, 130); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 8;
  rr(g, -W + 24, -H + 24, (W - 24) * 2, (H - 24) * 2, 110); g.stroke();

  /* the three sugar lanes */
  for (let i = 0; i < world.paths.length; i++) {
    const p = world.paths[i];
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#e8b06a';
    g.lineWidth = 64;
    g.beginPath(); g.moveTo(p[0].x, p[0].y);
    for (let k = 1; k < p.length; k++) g.lineTo(p[k].x, p[k].y);
    g.stroke();
    g.strokeStyle = '#fadfae';
    g.lineWidth = 44;
    g.beginPath(); g.moveTo(p[0].x, p[0].y);
    for (let k = 1; k < p.length; k++) g.lineTo(p[k].x, p[k].y);
    g.stroke();
  }

  /* neutral camp clearings */
  for (const c of world.camps) {
    g.fillStyle = '#cbb98a';
    g.beginPath(); g.arc(c.x, c.y, 120, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(122,77,33,.4)'; g.lineWidth = 6; g.setLineDash([14, 12]);
    g.beginPath(); g.arc(c.x, c.y, 120, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(122,77,33,.5)';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(c.x - 30 + i * 30, c.y + 70, 5, 0, Math.PI * 2); g.fill(); }
  }

  /* elevation ridges + tree thickets — the walls of the wilds */
  for (const o of world.obstacles) {
    g.save(); g.translate(o.x, o.y);
    if (o.t === 'rock') {
      g.fillStyle = 'rgba(40,20,50,.2)';
      g.beginPath(); g.ellipse(0, 30, 52, 14, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#4d5866'; g.lineWidth = 5;
      g.fillStyle = '#7d8a99';
      g.beginPath();
      g.moveTo(-50, 34); g.lineTo(-40, -22 - o.v * 8); g.lineTo(-12, -44 - o.v * 6);
      g.lineTo(18, -26 - o.v * 8); g.lineTo(30, -40); g.lineTo(50, 34);
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#a8b4c2';                            /* sunny top faces */
      g.beginPath(); g.moveTo(-40, -22 - o.v * 8); g.lineTo(-12, -44 - o.v * 6); g.lineTo(-6, -20); g.closePath(); g.fill();
      g.strokeStyle = '#5b6672'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-8, 30); g.lineTo(-2, 0); g.stroke();
    } else {
      g.fillStyle = 'rgba(40,20,50,.2)';
      g.beginPath(); g.ellipse(4, 34, 44, 12, 0, 0, Math.PI * 2); g.fill();
      const trees = o.v === 0 ? [[-22, 6, 0.85], [16, 12, 1]] : o.v === 1 ? [[0, 8, 1.1]] : [[-24, 12, 0.8], [4, -2, 0.9], [26, 14, 0.85]];
      for (const [tx, ty, sc] of trees) {
        g.save(); g.translate(tx, ty); g.scale(sc, sc);
        g.strokeStyle = '#1f5c33'; g.lineWidth = 3.5;
        g.fillStyle = '#7a4d21';
        rr(g, -5, 16, 10, 14, 3); g.fill(); g.stroke();
        g.fillStyle = '#2e8b4f';
        for (const [ly, lw] of [[16, 30], [2, 24], [-12, 17]]) {
          g.beginPath(); g.moveTo(-lw, ly); g.lineTo(0, ly - 26); g.lineTo(lw, ly); g.closePath(); g.fill(); g.stroke();
        }
        g.fillStyle = '#fff';                              /* snow-frosting caps */
        g.beginPath(); g.arc(0, -32, 5, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
    g.restore();
  }

  for (const pr of world.props) {
    g.font = `${pr.s}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(pr.e, pr.x, pr.y);
  }
}

/* the Rock Candy Cavern — the horde's base. Smash it to WIN */
function drawHordeBase(g, x, y, hp, max, hitRecently, now) {
  const r = HORDE.r;
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(40,20,50,.25)';
  g.beginPath(); g.ellipse(0, r * 0.75, r * 1.5, r * 0.5, 0, 0, Math.PI * 2); g.fill();
  if (hitRecently && Math.floor(now / 120) % 2 === 0) {
    g.strokeStyle = '#ffd93d'; g.lineWidth = 8;
    g.beginPath(); g.arc(0, 0, r * 1.5, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = '#4b3a58'; g.strokeStyle = '#332540'; g.lineWidth = 8;
  g.beginPath(); g.arc(0, 0, r * 1.25, Math.PI, 0); g.lineTo(r * 1.25, r * 0.7);
  g.lineTo(-r * 1.25, r * 0.7); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#6b4f86';
  for (const [cx, cy, cw, ch] of [[-90, -70, 40, 90], [-30, -110, 44, 120], [40, -85, 38, 95], [95, -45, 30, 70]]) {
    g.beginPath(); g.moveTo(cx - cw / 2, cy + ch / 2); g.lineTo(cx, cy - ch / 2); g.lineTo(cx + cw / 2, cy + ch / 2);
    g.closePath(); g.fill(); g.stroke();
  }
  const mouth = 0.55 + Math.sin(now * 0.004) * 0.08;
  g.fillStyle = '#2a0f38';
  g.beginPath(); g.ellipse(0, r * 0.45, r * mouth, r * 0.55, 0, Math.PI, 0); g.fill();
  g.strokeStyle = '#c95cff'; g.lineWidth = 7;
  g.setLineDash([16, 12]); g.lineDashOffset = -(now * 0.03) % 28;
  g.beginPath(); g.ellipse(0, r * 0.45, r * mouth + 14, r * 0.62, 0, Math.PI, 0); g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#ff5c8a';
  g.beginPath(); g.arc(-22, r * 0.28, 7, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(22, r * 0.28, 7, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#332540'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(r * 1.1, r * 0.7); g.lineTo(r * 1.1, -r * 1.1); g.stroke();
  g.fillStyle = '#5b2a63'; g.strokeStyle = '#332540'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(r * 1.1, -r * 1.1); g.lineTo(r * 1.75, -r * 0.92); g.lineTo(r * 1.1, -r * 0.74);
  g.closePath(); g.fill(); g.stroke();
  face(g, r * 1.32, -r * 0.94, 0.9, 'angry');
  /* base health */
  const frac = clamp(hp / max, 0, 1);
  g.fillStyle = 'rgba(0,0,0,.45)'; rr(g, -90, r * 0.95, 180, 16, 8); g.fill();
  g.fillStyle = '#c95cff';
  if (frac > 0.02) { rr(g, -90, r * 0.95, 180 * frac, 16, 8); g.fill(); }
  g.strokeStyle = '#fff'; g.lineWidth = 3; rr(g, -90, r * 0.95, 180, 16, 8); g.stroke();
  g.restore();
}

/* a lane tower: jagged crystal spire (horde) or frosted candy spire (gummies) */
function drawETower(g, row, z, now, friendly) {
  const [, x, y, hpPct] = row;
  const k = upscale(z);
  const pal = friendly
    ? { ink: '#7a4d21', body: '#fff0dd', crest: '#ffd9e8', eye: '107,207,127', bar: '#6bcf7f' }
    : { ink: '#332540', body: '#4b3a58', crest: '#6b4f86', eye: '255,92,138', bar: '#c95cff' };
  g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = 'rgba(40,20,50,.22)';
  g.beginPath(); g.ellipse(0, 32, 34, 11, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = pal.ink; g.lineWidth = 3.5;
  g.fillStyle = pal.body;
  g.beginPath(); g.moveTo(-24, 32); g.lineTo(-14, -18); g.lineTo(14, -18); g.lineTo(24, 32); g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = pal.crest;
  g.beginPath(); g.moveTo(-16, -16); g.lineTo(-8, -46); g.lineTo(0, -16); g.closePath(); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(-2, -16); g.lineTo(10, -52); g.lineTo(18, -16); g.closePath(); g.fill(); g.stroke();
  const pulse = 0.75 + Math.sin(now * 0.006) * 0.25;
  g.fillStyle = `rgba(${pal.eye},${pulse})`;
  g.beginPath(); g.arc(0, 2, 8, 0, Math.PI * 2); g.fill(); g.stroke();
  hpBar(g, 0, 38, 56, hpPct / 100, pal.bar);
  g.restore();
}

/* neutral creeps: wild things with faces, guarding their patch */
function drawNeutral(g, row, z, now) {
  const [id, tIdx, x, y, hpPct] = row;
  const type = NTYPE[tIdx];
  const k = upscale(z);
  const w = now * 0.01 + id;
  g.save(); g.translate(x, y); g.scale(k, k);
  const ink = '#3a2038';
  g.strokeStyle = ink; g.lineWidth = 2.6;
  g.fillStyle = 'rgba(40,20,50,.18)';
  g.beginPath(); g.ellipse(0, 12, 12, 5, 0, 0, Math.PI * 2); g.fill();
  if (type === 'wolf') {
    g.rotate(Math.sin(w * 3) * 0.06);
    g.fillStyle = '#f088a8';
    g.beginPath(); g.ellipse(0, 2, 13, 9, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-10, -6); g.lineTo(-13, -15); g.lineTo(-5, -9); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(2, -8); g.lineTo(6, -16); g.lineTo(9, -7); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#d16388'; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(12, 4); g.quadraticCurveTo(20, 0, 19, -7); g.stroke();
    g.strokeStyle = ink;
    face(g, -1, -2, 0.9, 'angry');
  } else if (type === 'bear') {
    g.rotate(Math.sin(w * 2) * 0.05);
    g.fillStyle = '#b07a45';
    g.beginPath(); g.arc(-6.5, -9, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(6.5, -9, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, 0, 12, Math.PI, 0); g.lineTo(12, 8); g.quadraticCurveTo(0, 13, -12, 8);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#8a5a2b';
    g.beginPath(); g.ellipse(0, 5, 6, 4.5, 0, 0, Math.PI * 2); g.fill();
    face(g, 0, -3, 1, 'angry');
  } else {
    /* Elder Rockjaw: mossy boulder patriarch */
    g.rotate(Math.sin(w) * 0.03);
    g.fillStyle = '#8a9484';
    g.beginPath(); g.arc(0, -2, 18, Math.PI, 0);
    g.lineTo(18, 11); g.quadraticCurveTo(0, 17, -18, 11); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#5f7a52';
    g.beginPath(); g.arc(-8, -14, 6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(7, -16, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a3ab9c';
    g.beginPath(); g.arc(-20, 6 + Math.sin(w * 1.4) * 3, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(20, 6 - Math.sin(w * 1.4) * 3, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    face(g, 0, -4, 1.25, 'angry');
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(-6, 6); g.lineTo(-3, 10); g.lineTo(0, 6); g.lineTo(3, 10); g.lineTo(6, 6); g.stroke();
  }
  if (hpPct < 100) hpBar(g, 0, 16, 28, hpPct / 100, '#e8b06a');
  g.restore();
}

/* the Great Gingerbread Castle — the team's corner base */
function drawCastleAt(g, x, y, castleHp, castleMax, hitRecently, now) {
  g.save(); g.translate(x, y);
  g.fillStyle = '#e7c9a1';                                 /* courtyard */
  g.beginPath(); g.arc(0, 0, CASTLE.r + 30, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#b98d5f'; g.lineWidth = 10;
  g.beginPath(); g.arc(0, 0, CASTLE.r + 30, 0, Math.PI * 2); g.stroke();
  if (hitRecently && Math.floor(now / 120) % 2 === 0) {
    g.strokeStyle = '#ff4d4d'; g.lineWidth = 8;
    g.beginPath(); g.arc(0, 0, CASTLE.r + 46, 0, Math.PI * 2); g.stroke();
  }
  g.strokeStyle = '#7a4d21'; g.lineWidth = 5;
  /* side towers */
  for (const tx of [-62, 62]) {
    g.fillStyle = '#f3dcae';
    rr(g, tx - 22, -34, 44, 88, 10); g.fill(); g.stroke();
    g.fillStyle = '#ff6f91';                               /* frosting cone roofs */
    g.beginPath(); g.moveTo(tx - 28, -32); g.lineTo(tx, -86); g.lineTo(tx + 28, -32); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(tx, -12, 8, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  /* main keep */
  g.fillStyle = '#f7e6c4';
  rr(g, -46, -18, 92, 76, 12); g.fill(); g.stroke();
  g.fillStyle = '#ff6f91';
  g.beginPath(); g.moveTo(-54, -16); g.lineTo(0, -66); g.lineTo(54, -16); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#fff';                                    /* icing scallops */
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(i * 26, -16, 12, 0, Math.PI); g.fill(); }
  g.fillStyle = '#8a5a2b';                                 /* big cookie door */
  rr(g, -14, 22, 28, 36, 12); g.fill(); g.stroke();
  g.fillStyle = '#ffd93d';
  g.beginPath(); g.arc(6, 42, 3.5, 0, Math.PI * 2); g.fill();
  /* flag */
  g.strokeStyle = '#7a4d21'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(0, -66); g.lineTo(0, -96); g.stroke();
  g.fillStyle = '#ffd93d';
  g.beginPath(); g.moveTo(0, -96); g.lineTo(26, -88); g.lineTo(0, -80); g.closePath(); g.fill(); g.stroke();
  /* castle health */
  const frac = clamp(castleHp / castleMax, 0, 1);
  g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, -80, 104, 160, 16, 8); g.fill();
  g.fillStyle = frac > 0.5 ? '#6bcf7f' : frac > 0.25 ? '#ffd93d' : '#ff4d6d';
  if (frac > 0.02) { rr(g, -80, 104, 160 * frac, 16, 8); g.fill(); }
  g.strokeStyle = '#fff'; g.lineWidth = 3; rr(g, -80, 104, 160, 16, 8); g.stroke();
  g.restore();
}

function hpBar(g, x, y, w, frac, col) {
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x - w / 2, y, w, 6);
  g.fillStyle = col || (frac > 0.5 ? '#6bcf7f' : frac > 0.25 ? '#ffd93d' : '#ff4d6d');
  g.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 6);
}

/* keep sprites readable when the camera is zoomed way out */
const upscale = (z) => Math.max(1, 0.5 / z);

/* ---------------- buildings: little houses in the owner's color ---------------- */

function drawBld(g, row, seats, z, now) {
  const [, seat, tIdx, x, y, lvl, hpPct, boosted] = row;
  const type = BTYPE[tIdx];
  const s = seats[seat];
  const color = s ? s.color : '#cccccc';
  const dark = shade(color, 0.7);
  const k = upscale(z);
  g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = 'rgba(40,20,50,.18)';                      /* ground shadow */
  g.beginPath(); g.ellipse(0, 26, 34, 11, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = dark; g.lineWidth = 3;

  if (type === 'turret') {
    /* tapered candy tower with an owner-colored gumball dome */
    g.fillStyle = '#fff0dd';
    g.beginPath(); g.moveTo(-20, 24); g.lineTo(-14, -10); g.lineTo(14, -10); g.lineTo(20, 24); g.closePath();
    g.fill(); g.stroke();
    g.lineWidth = 2;
    for (const lx of [-8, 0, 8]) { g.beginPath(); g.moveTo(lx * 1.35, 22); g.lineTo(lx, -8); g.stroke(); }
    g.lineWidth = 3;
    g.fillStyle = color;
    g.beginPath(); g.arc(0, -18, 15, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.beginPath(); g.arc(-5, -23, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2038';
    g.beginPath(); g.arc(12, -18, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();   /* gumball barrel */
  } else if (type === 'launcher') {
    /* rocket battery: cream bunker, two owner-colored rockets aimed at the sky */
    g.fillStyle = '#fff0dd';
    rr(g, -24, 2, 48, 22, 8); g.fill(); g.stroke();
    g.fillStyle = color;
    rr(g, -24, 16, 48, 8, 4); g.fill(); g.stroke();
    for (const [rx, tilt] of [[-10, -0.22], [10, 0.22]]) {
      g.save(); g.translate(rx, 2); g.rotate(tilt);
      g.fillStyle = '#fdfdfb';
      rr(g, -6, -22, 12, 26, 5); g.fill(); g.stroke();
      g.fillStyle = color;
      g.beginPath(); g.moveTo(-7, -20); g.lineTo(0, -34); g.lineTo(7, -20); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ff9f4a';
      g.beginPath(); g.moveTo(-4, 4); g.lineTo(0, 11); g.lineTo(4, 4); g.closePath(); g.fill();
      g.restore();
    }
  } else if (type === 'mortar') {
    /* marshmallow pot with a big lobber tube */
    g.fillStyle = '#fff0dd';
    g.beginPath(); g.arc(0, 8, 22, Math.PI, 0); g.lineTo(22, 20); g.quadraticCurveTo(0, 27, -22, 20);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = color;
    rr(g, -24, 2, 48, 9, 4); g.fill(); g.stroke();
    g.save(); g.rotate(-0.7);
    g.fillStyle = '#8b8f99';
    rr(g, -8, -34, 16, 30, 6); g.fill(); g.stroke();
    g.fillStyle = '#3a2038';
    g.beginPath(); g.ellipse(0, -33, 8, 4, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    g.fillStyle = '#fdfdfb';                               /* marshmallow ammo */
    g.beginPath(); g.arc(13, 0, 5, 0, Math.PI * 2); g.fill(); g.stroke();
  } else if (type === 'syrup') {
    /* honey jar with an owner-colored lid, mid-drip */
    g.fillStyle = '#e8a33d';
    g.beginPath(); g.moveTo(-16, -8); g.quadraticCurveTo(-22, 10, -14, 22);
    g.lineTo(14, 22); g.quadraticCurveTo(22, 10, 16, -8); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#f7c96b';
    g.beginPath(); g.ellipse(-5, 4, 6, 9, 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    rr(g, -18, -16, 36, 10, 5); g.fill(); g.stroke();
    const drip = (now * 0.003) % 1;
    g.fillStyle = '#e8a33d';
    g.beginPath(); g.arc(19, -2 + drip * 22, 4 * (1 - drip * 0.4), 0, Math.PI * 2); g.fill();
  } else if (type === 'barracks') {
    /* gummy training tent in the owner's color, flag flying */
    g.fillStyle = color;
    g.beginPath(); g.moveTo(-30, 22); g.lineTo(0, -26); g.lineTo(30, 22); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = shade(color, 0.85);
    g.beginPath(); g.moveTo(-30, 22); g.lineTo(-8, 22); g.lineTo(0, -26); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff8f0';                               /* door flap */
    g.beginPath(); g.moveTo(-9, 22); g.lineTo(0, 4); g.lineTo(9, 22); g.closePath(); g.fill(); g.stroke();
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -26); g.lineTo(0, -40); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, -40); g.lineTo(15, -35); g.lineTo(0, -30); g.closePath(); g.fill(); g.stroke();
  } else if (type === 'wall') {
    /* chewy candy-brick decoy */
    g.fillStyle = '#ff9db8';
    rr(g, -26, -18, 52, 42, 7); g.fill(); g.stroke();
    g.strokeStyle = shade(color, 0.8); g.lineWidth = 2.2;
    for (const by of [-4, 10]) { g.beginPath(); g.moveTo(-26, by); g.lineTo(26, by); g.stroke(); }
    for (const [bx, by] of [[-9, -18], [9, -4], [-9, 10]]) {
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, by + 14); g.stroke();
    }
    g.strokeStyle = dark; g.lineWidth = 3;
    face(g, 0, -2, 1.1, 'smile');                          /* it WANTS to be chewed */
  }

  if (boosted) {
    g.strokeStyle = '#ffd93d'; g.lineWidth = 3.5; g.setLineDash([8, 6]); g.lineDashOffset = -(now * 0.05) % 14;
    g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }
  if (hpPct < 100) hpBar(g, 0, 30, 52, hpPct / 100);
  if (lvl > 1) {
    g.fillStyle = '#ffd93d'; g.strokeStyle = '#b98a13'; g.lineWidth = 1.5;
    for (let i = 0; i < lvl; i++) {
      g.beginPath(); g.arc(-((lvl - 1) * 5.5) + i * 11, -42, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  g.restore();
}

/* ---------------- enemies: the Sour Horde, faces and all ---------------- */

function drawEnemy(g, row, z, now) {
  const [id, tIdx, x, y, hpPct, stun, slow] = row;
  const type = ETYPE[tIdx], def = ETYPES[type];
  const k = upscale(z) * (def.boss ? 2.1 : 1);
  const w = now * 0.01 + id;
  g.save(); g.translate(x, y); g.scale(k, k);
  const ink = '#332540';
  g.strokeStyle = ink; g.lineWidth = 2.6;
  if (!def.air) {
    g.fillStyle = 'rgba(40,20,50,.18)';
    g.beginPath(); g.ellipse(0, 13, 13, 5, 0, 0, Math.PI * 2); g.fill();
  }
  if (slow) { g.fillStyle = 'rgba(80,160,255,.3)'; g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2); g.fill(); }

  if (type === 'chomper') {
    /* cookie goblin — round, bitten, hungry */
    g.rotate(Math.sin(w * 2) * 0.08);
    g.fillStyle = '#a5713d';
    g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#8a5a2b';
    for (const [cx, cy] of [[-7, -6], [6, -8], [8, 5], [-4, 8]]) {
      g.beginPath(); g.arc(cx, cy, 2.2, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#9ed98a';                               /* bite taken out */
    g.beginPath(); g.arc(11, -8, 5, 0, Math.PI * 2); g.fill();
    face(g, 0, -1, 1, 'angry');
    g.fillStyle = '#fff';                                  /* chomping teeth */
    const jaw = Math.abs(Math.sin(w * 4)) * 3;
    g.beginPath(); g.moveTo(-4, 7 + jaw); g.lineTo(-1, 4 + jaw); g.lineTo(2, 7 + jaw); g.lineTo(5, 4 + jaw); g.stroke();
  } else if (type === 'sprinter') {
    /* lemon zoomer — leaning into the run, little legs blurring */
    g.rotate(0.18);
    g.fillStyle = '#efd94f';
    g.beginPath(); g.ellipse(0, -2, 12, 9, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#f7ea8f';
    g.beginPath(); g.ellipse(-3, -5, 4, 2.5, 0.4, 0, Math.PI * 2); g.fill();
    face(g, 1, -3, 0.9, 'angry');
    g.strokeStyle = ink; g.lineWidth = 2.4; g.lineCap = 'round';
    const st = Math.sin(w * 9) * 5;
    g.beginPath(); g.moveTo(-5, 6); g.lineTo(-8 + st, 13); g.stroke();
    g.beginPath(); g.moveTo(4, 6); g.lineTo(7 - st, 13); g.stroke();
    g.strokeStyle = 'rgba(51,37,64,.35)';                  /* speed lines */
    g.beginPath(); g.moveTo(-14, -6); g.lineTo(-22, -6); g.stroke();
    g.beginPath(); g.moveTo(-13, 1); g.lineTo(-20, 1); g.stroke();
  } else if (type === 'wasp') {
    /* wafer wasp — waffle body, buzzing wings, ground shadow */
    g.fillStyle = 'rgba(40,20,50,.15)';
    g.beginPath(); g.ellipse(0, 16, 10, 4, 0, 0, Math.PI * 2); g.fill();
    g.translate(0, -14 + Math.sin(w * 3) * 3);
    const flap = Math.sin(w * 12) * 0.6;
    g.fillStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.8;
    g.beginPath(); g.ellipse(-10, -5, 10, 4.5, -0.5 - flap, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(10, -5, 10, 4.5, 0.5 + flap, 0, Math.PI * 2); g.fill(); g.stroke();
    g.lineWidth = 2.6;
    g.fillStyle = '#d9a441';
    g.beginPath(); g.ellipse(0, 0, 9, 12, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = '#8a5a2b'; g.lineWidth = 1.6;          /* waffle grid */
    for (const gy of [-4, 1, 6]) { g.beginPath(); g.moveTo(-7, gy); g.lineTo(7, gy); g.stroke(); }
    g.beginPath(); g.moveTo(0, -9); g.lineTo(0, 10); g.stroke();
    g.strokeStyle = ink;
    face(g, 0, -4, 0.85, 'angry');
    g.beginPath(); g.moveTo(0, 12); g.lineTo(0, 16); g.stroke();  /* stinger */
  } else if (type === 'sapper') {
    /* jelly sapper — segmented worm with wrecking teeth, building-obsessed */
    const sq = Math.sin(w * 5) * 0.12;
    g.fillStyle = '#9b59d0';
    g.beginPath(); g.ellipse(-11, 4, 7 * (1 + sq), 6, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(-2, 1, 8 * (1 - sq), 7, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#b57ae0';
    g.beginPath(); g.arc(9, -2, 9, 0, Math.PI * 2); g.fill(); g.stroke();
    face(g, 9, -4, 0.9, 'angry');
    g.fillStyle = '#fff';                                  /* chompy teeth */
    g.beginPath(); g.moveTo(3, 3); g.lineTo(6, 7); g.lineTo(9, 3); g.lineTo(12, 7); g.lineTo(15, 3);
    g.closePath(); g.fill(); g.stroke();
  } else if (type === 'golem') {
    /* gumdrop golem — a walking boulder */
    g.rotate(Math.sin(w) * 0.04);
    g.fillStyle = '#7d8a99';
    g.beginPath(); g.arc(0, -2, 17, Math.PI, 0);
    g.lineTo(17, 10); g.quadraticCurveTo(0, 16, -17, 10); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#5b6672';                               /* cracked slabs */
    rr(g, -12, -8, 9, 7, 2); g.fill();
    rr(g, 4, 0, 8, 6, 2); g.fill();
    g.fillStyle = '#98a5b3';                               /* stone fists */
    g.beginPath(); g.arc(-19, 6 + Math.sin(w * 2) * 3, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(19, 6 - Math.sin(w * 2) * 3, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    face(g, 0, -4, 1.15, 'angry');
  } else if (type === 'eknight') {
    /* Sour Sergeant — armored lime brute with a cleaver */
    g.rotate(Math.sin(w * 3) * 0.05);
    g.fillStyle = '#9bc23c';
    g.beginPath(); g.arc(0, 0, 14, Math.PI, 0); g.lineTo(14, 9); g.quadraticCurveTo(0, 14, -14, 9);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#5b2a63';                               /* horde helm */
    g.beginPath(); g.arc(0, -6, 11, Math.PI, 0); g.lineTo(11, -3); g.lineTo(-11, -3); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-11, -5); g.lineTo(-16, -14); g.lineTo(-8, -8); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(11, -5); g.lineTo(16, -14); g.lineTo(8, -8); g.closePath(); g.fill(); g.stroke();
    face(g, 0, 1, 1, 'angry');
    g.fillStyle = '#8b8f99';                               /* cleaver */
    g.beginPath(); g.moveTo(14, 4); g.lineTo(26, -6); g.lineTo(26, 2); g.lineTo(17, 8); g.closePath(); g.fill(); g.stroke();
  } else if (type === 'earcher') {
    /* Licorice Sniper — hooded, long black bow */
    g.rotate(Math.sin(w * 3) * 0.06);
    g.fillStyle = '#3d3d47';
    g.beginPath(); g.arc(0, 2, 11, Math.PI, 0); g.lineTo(11, 9); g.quadraticCurveTo(0, 13, -11, 9);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#55555f';
    g.beginPath(); g.moveTo(-10, -2); g.lineTo(0, -20); g.lineTo(10, -2); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ff5c8a';                               /* glowing eyes in the hood */
    g.beginPath(); g.arc(-3.5, -1, 2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(3.5, -1, 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1c1c22'; g.lineWidth = 2.6;
    g.beginPath(); g.arc(13, 0, 11, -Math.PI * 0.45, Math.PI * 0.45); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(13 + Math.cos(-Math.PI * 0.45) * 11, Math.sin(-Math.PI * 0.45) * 11);
    g.lineTo(13 + Math.cos(Math.PI * 0.45) * 11, Math.sin(Math.PI * 0.45) * 11);
    g.stroke();
  } else {
    /* the Rock Candy Colossus — crystal crown, very cross */
    g.rotate(Math.sin(w * 0.8) * 0.03);
    g.fillStyle = '#c0455c';
    g.beginPath(); g.arc(0, -2, 20, Math.PI, 0);
    g.lineTo(20, 12); g.quadraticCurveTo(0, 19, -20, 12); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#e06a80';                               /* crystal crown */
    for (const [cx, ch] of [[-12, 12], [0, 18], [12, 12]]) {
      g.beginPath(); g.moveTo(cx - 5, -14); g.lineTo(cx, -14 - ch); g.lineTo(cx + 5, -14); g.closePath();
      g.fill(); g.stroke();
    }
    g.fillStyle = '#a03449';
    rr(g, -14, 2, 10, 8, 2); g.fill();
    g.fillStyle = '#e06a80';
    g.beginPath(); g.arc(-23, 8 + Math.sin(w * 1.5) * 3, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(23, 8 - Math.sin(w * 1.5) * 3, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    face(g, 0, -5, 1.5, 'angry');
  }

  if (stun) { g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText('💫', 0, -22); }
  if (def.hero) {
    g.fillStyle = '#ff8fb3'; g.font = 'bold 12px Fredoka, sans-serif'; g.textAlign = 'center';
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3;
    g.strokeText(def.label, 0, -26);
    g.fillText(def.label, 0, -26);
  }
  if (hpPct < 100) hpBar(g, 0, def.boss ? 24 : 17, def.boss ? 44 : 28, hpPct / 100, '#c95cff');
  g.restore();
}

/* ---------------- heroes: little people with faces and class gear ---------------- */

function drawHeroRow(g, row, seats, z, now, isMe) {
  const [seat, heroIdx, x, y, hp, maxhp, deadT, , , , , , , armored] = row;
  if (heroIdx < 0) return;
  const heroId = HERO_IDX[heroIdx];
  const s = seats[seat];
  const color = s ? s.color : '#cccccc';
  const dark = shade(color, 0.7);
  const k = upscale(z);
  const w = now * 0.012 + seat * 2;
  g.save(); g.translate(x, y);

  /* name floats above, sized for the current zoom */
  if (s && !deadT) {
    g.fillStyle = color; g.font = `bold ${Math.max(14, 15 / z)}px Fredoka, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = Math.max(3, 3.5 / z);
    g.strokeText(s.name, 0, -34 * k);
    g.fillText(s.name, 0, -34 * k);
  }

  g.scale(k, k);
  g.strokeStyle = dark; g.lineWidth = 2.6;

  if (deadT > 0) {                                         /* knocked out */
    g.globalAlpha = 0.65;
    g.fillStyle = '#cfd6dd';
    g.beginPath(); g.arc(0, 0, 12, Math.PI, 0); g.lineTo(12, 8); g.quadraticCurveTo(0, 13, -12, 8);
    g.closePath(); g.fill(); g.stroke();
    face(g, 0, -1, 1, 'ko');
    g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.font = 'bold 13px Fredoka, sans-serif'; g.textAlign = 'center';
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 3;
    g.strokeText(`${Math.ceil(deadT / 10)}s`, 0, -20);
    g.fillText(`${Math.ceil(deadT / 10)}s`, 0, -20);
    g.restore(); return;
  }

  if (isMe) {                                              /* "this one's you" ring */
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([7, 6]);
    g.lineDashOffset = -(now * 0.04) % 13;
    g.beginPath(); g.arc(0, 2, 22, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.strokeStyle = dark; g.lineWidth = 2.6;
  }
  g.fillStyle = 'rgba(40,20,50,.18)';
  g.beginPath(); g.ellipse(0, 13, 12, 4.5, 0, 0, Math.PI * 2); g.fill();
  g.rotate(Math.sin(w * 4) * 0.06);                        /* walking waddle */

  /* body: color dome + skirt, like the Candy Kingdoms guards */
  g.fillStyle = color;
  g.beginPath(); g.arc(0, 2, 12, Math.PI, 0); g.lineTo(12, 8); g.quadraticCurveTo(0, 13, -12, 8);
  g.closePath(); g.fill(); g.stroke();
  /* head */
  g.fillStyle = '#ffe1bd';
  g.beginPath(); g.arc(0, -8, 8.5, 0, Math.PI * 2); g.fill(); g.stroke();
  face(g, 0, -8, 1, 'smile');

  if (heroId === 'knight') {
    g.fillStyle = '#cfd6dd';                               /* helmet + plume */
    g.beginPath(); g.arc(0, -10, 9, Math.PI, 0); g.lineTo(9, -8); g.lineTo(-9, -8); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ff4d6d';
    g.beginPath(); g.arc(0, -19, 3, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = color;                                   /* round shield */
    g.beginPath(); g.arc(-14, 2, 6.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#ffd93d';
    g.beginPath(); g.arc(-14, 2, 2.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8b8f99'; g.lineWidth = 3; g.lineCap = 'round';   /* sword */
    g.beginPath(); g.moveTo(13, 4); g.lineTo(19, -8); g.stroke();
  } else if (heroId === 'ranger') {
    g.fillStyle = color;                                   /* pointy hood + feather */
    g.beginPath(); g.moveTo(-9, -12); g.lineTo(0, -26); g.lineTo(9, -12); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#6bcf7f'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(4, -20); g.quadraticCurveTo(11, -26, 13, -20); g.stroke();
    g.strokeStyle = '#8a5a2b'; g.lineWidth = 2.4;          /* bow */
    g.beginPath(); g.arc(14, -2, 9, -Math.PI * 0.45, Math.PI * 0.45); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(14 + Math.cos(-Math.PI * 0.45) * 9, -2 + Math.sin(-Math.PI * 0.45) * 9);
    g.lineTo(14 + Math.cos(Math.PI * 0.45) * 9, -2 + Math.sin(Math.PI * 0.45) * 9);
    g.stroke();
  } else if (heroId === 'mage') {
    g.fillStyle = color;                                   /* wizard hat */
    g.beginPath(); g.moveTo(-11, -12); g.lineTo(2, -30); g.lineTo(11, -12); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ffd93d'; g.font = '8px sans-serif'; g.textAlign = 'center';
    g.fillText('★', 0, -17);
    g.strokeStyle = '#8a5a2b'; g.lineWidth = 2.6;          /* staff with an orb */
    g.beginPath(); g.moveTo(13, 8); g.lineTo(15, -14); g.stroke();
    g.fillStyle = '#7fd8ff';
    g.beginPath(); g.arc(15, -17, 4, 0, Math.PI * 2); g.fill(); g.stroke();
  } else if (heroId === 'builder') {
    g.fillStyle = '#ffd93d';                               /* hard hat */
    g.beginPath(); g.arc(0, -10, 9, Math.PI, 0); g.lineTo(11, -8); g.lineTo(-11, -8); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#f2b41f';
    rr(g, -3, -20, 6, 5, 2); g.fill(); g.stroke();
    g.strokeStyle = '#8b8f99'; g.lineWidth = 3; g.lineCap = 'round';   /* wrench */
    g.beginPath(); g.moveTo(12, 6); g.lineTo(18, -4); g.stroke();
    g.strokeStyle = '#8b8f99'; g.lineWidth = 2.2;
    g.beginPath(); g.arc(19, -6, 3.5, Math.PI * 0.8, Math.PI * 2.1); g.stroke();
  } else if (heroId === 'slasher') {
    g.fillStyle = '#9bc23c';                               /* spiky sour mohawk */
    for (const [mx, mh] of [[-5, 8], [0, 11], [5, 8]]) {
      g.beginPath(); g.moveTo(mx - 2.5, -13); g.lineTo(mx, -13 - mh); g.lineTo(mx + 2.5, -13); g.closePath(); g.fill(); g.stroke();
    }
    g.fillStyle = '#e8e8ee';                               /* twin blades */
    g.beginPath(); g.moveTo(12, 6); g.lineTo(20, -6); g.lineTo(22, -3); g.lineTo(15, 8); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-12, 6); g.lineTo(-20, -6); g.lineTo(-22, -3); g.lineTo(-15, 8); g.closePath(); g.fill(); g.stroke();
  } else if (heroId === 'whip') {
    g.fillStyle = '#3d3d47';                               /* licorice cap */
    g.beginPath(); g.arc(0, -10, 9, Math.PI, 0); g.lineTo(11, -8); g.lineTo(-11, -8); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ff5c8a';
    g.beginPath(); g.arc(0, -17, 2.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = '#1c1c22'; g.lineWidth = 2.6; g.lineCap = 'round';   /* coiled whip */
    g.beginPath(); g.moveTo(12, 2); g.quadraticCurveTo(24, -2, 22, 8); g.quadraticCurveTo(20, 14, 15, 10); g.stroke();
  } else if (heroId === 'shaman') {
    g.fillStyle = '#6b4f86';                               /* crystal hood */
    g.beginPath(); g.moveTo(-10, -6); g.lineTo(0, -24); g.lineTo(10, -6); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#c95cff';
    g.beginPath(); g.arc(0, -13, 2.6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#7a4d21'; g.lineWidth = 2.6; g.lineCap = 'round';   /* crystal staff */
    g.beginPath(); g.moveTo(13, 8); g.lineTo(17, -12); g.stroke();
    g.fillStyle = '#ff5c8a';
    g.beginPath(); g.moveTo(17, -20); g.lineTo(21, -14); g.lineTo(17, -8); g.lineTo(13, -14); g.closePath(); g.fill(); g.stroke();
  } else if (heroId === 'tinker') {
    g.strokeStyle = '#3d3d47'; g.lineWidth = 2;            /* goggles */
    g.fillStyle = '#ffd93d';
    g.beginPath(); g.arc(-4, -11, 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(4, -11, 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(-8, -11); g.lineTo(-10, -10); g.moveTo(8, -11); g.lineTo(10, -10); g.stroke();
    g.strokeStyle = '#8b8f99'; g.lineWidth = 3; g.lineCap = 'round';   /* spanner */
    g.beginPath(); g.moveTo(-12, 6); g.lineTo(-18, -4); g.stroke();
    g.beginPath(); g.arc(-19, -6, 3.5, Math.PI * 0.9, Math.PI * 2.2); g.stroke();
  }

  if (armored) {
    g.strokeStyle = '#7fd8ff'; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, 18, 0, Math.PI * 2); g.stroke();
  }
  hpBar(g, 0, 17, 26, hp / maxhp);
  g.restore();
}

/* ---------------- gummy fighters: tiny bears in the owner's color ---------------- */

function drawAlly(g, row, seats, z, now) {
  const [id, seat, atIdx, x, y, hpPct] = row;
  const type = ATYPE[atIdx];
  const def = ATYPES[type];
  const s = seat >= 0 && seats[seat] ? seats[seat] : null;
  const color = s ? s.color : '#58c47c';                  /* team-green lane creeps */
  const k = upscale(z);
  const w = now * 0.012 + id;
  const big = def.boss ? 1.9 : def.hero ? 1.35 : type === 'brute' ? 1.6 : 1;
  const fly = type === 'bee' ? -8 + Math.sin(w * 4) * 3 : 0;
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(40,20,50,.15)';
  g.beginPath(); g.ellipse(0, 9 * k, 8 * k * big, 3 * k * big, 0, 0, Math.PI * 2); g.fill();
  g.translate(0, fly * k);
  g.scale(k * big, k * big);
  g.strokeStyle = shade(color, 0.7); g.lineWidth = 2;
  g.rotate(Math.sin(w * (type === 'dasher' ? 8 : 5)) * 0.07);
  if (type === 'bee') {                                   /* candy-wrapper wings */
    const flap = Math.sin(now * 0.05 + id) * 0.5;
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.save(); g.rotate(-0.6 - flap); g.beginPath(); g.ellipse(-9, -8, 8, 4, 0, 0, Math.PI * 2); g.fill(); g.restore();
    g.save(); g.rotate(0.6 + flap); g.beginPath(); g.ellipse(9, -8, 8, 4, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  g.fillStyle = color; g.globalAlpha = 0.92;
  g.beginPath(); g.arc(-5.5, -7, 3, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath(); g.arc(5.5, -7, 3, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath(); g.arc(0, 0, 8.5, Math.PI, 0); g.lineTo(8.5, 5); g.quadraticCurveTo(0, 9.5, -8.5, 5);
  g.closePath(); g.fill(); g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,.45)';
  g.beginPath(); g.arc(-3, -3, 2.5, 0, Math.PI * 2); g.fill();
  face(g, 0, -1, 0.75, type === 'brute' || def.hero ? 'angry' : 'smile');
  if (type === 'bruiser') {
    g.strokeStyle = '#8b8f99'; g.lineWidth = 2.6; g.lineCap = 'round';   /* candy-cane pike */
    g.beginPath(); g.moveTo(9, 3); g.lineTo(14, -9); g.stroke();
    g.strokeStyle = '#ff4d6d'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(10.5, -1); g.lineTo(12.5, -5); g.stroke();
  } else if (type === 'dasher') {
    g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 1.8; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-11, -2); g.lineTo(-17, -2); g.stroke();
    g.beginPath(); g.moveTo(-10, 3); g.lineTo(-15, 3); g.stroke();
  } else if (type === 'breaker') {
    g.strokeStyle = '#7a4d21'; g.lineWidth = 2.4; g.lineCap = 'round';   /* rock-candy hammer */
    g.beginPath(); g.moveTo(9, 4); g.lineTo(15, -7); g.stroke();
    g.fillStyle = '#8b8f99';
    rr(g, 11, -12, 9, 6, 2); g.fill(); g.stroke();
  } else if (type === 'brute') {
    g.strokeStyle = shade(color, 0.55); g.lineWidth = 2.2;               /* heavy brow */
    g.beginPath(); g.moveTo(-6, -5.5); g.lineTo(-1, -4); g.stroke();
    g.beginPath(); g.moveTo(6, -5.5); g.lineTo(1, -4); g.stroke();
  } else if (type === 'aknight') {
    g.fillStyle = '#ffd93d';                                             /* gilded helm */
    g.beginPath(); g.arc(0, -6, 9, Math.PI, 0); g.lineTo(9, -3); g.lineTo(-9, -3); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ff4d6d';
    g.beginPath(); g.moveTo(0, -14); g.lineTo(3, -20); g.lineTo(-3, -20); g.closePath(); g.fill();
    g.fillStyle = '#e8e8ee';
    g.beginPath(); g.moveTo(11, 4); g.lineTo(20, -8); g.lineTo(22, -5); g.lineTo(14, 6); g.closePath(); g.fill(); g.stroke();
  } else if (type === 'aarcher') {
    g.fillStyle = shade(color, 0.85);
    g.beginPath(); g.moveTo(-7, -8); g.lineTo(0, -17); g.lineTo(7, -8); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#7a4d21'; g.lineWidth = 2;
    g.beginPath(); g.arc(11, 0, 8, -Math.PI * 0.45, Math.PI * 0.45); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(11 + Math.cos(-Math.PI * 0.45) * 8, Math.sin(-Math.PI * 0.45) * 8);
    g.lineTo(11 + Math.cos(Math.PI * 0.45) * 8, Math.sin(Math.PI * 0.45) * 8);
    g.stroke();
  } else if (type === 'aboss') {
    g.fillStyle = '#6bcf7f';                                             /* crystal crown */
    for (const [cx, ch] of [[-6, 9], [0, 13], [6, 9]]) {
      g.beginPath(); g.moveTo(cx - 3, -8); g.lineTo(cx, -8 - ch); g.lineTo(cx + 3, -8); g.closePath(); g.fill(); g.stroke();
    }
  }
  if (def.hero) {
    g.fillStyle = '#baffd0'; g.font = 'bold 9px Fredoka, sans-serif'; g.textAlign = 'center';
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2.5;
    g.strokeText(def.label, 0, -22);
    g.fillText(def.label, 0, -22);
  }
  if (hpPct < 100) hpBar(g, 0, 12, def.hero ? 24 : 18, hpPct / 100);
  g.restore();
}

const FX_LIFE = { pew: 0.25, zap: 0.3, slash: 0.25, shell: 0.6, boom: 0.6, bash: 0.5, cry: 0.8, nova: 0.6,
  barrage: 0.6, trap: 0.8, pierce: 0.4, meteor: 0.8, heal: 0.8, overclock: 0.8, shield: 0.6, built: 0.7,
  sold: 0.5, level: 0.9, die: 0.6, hit: 0.3, spawn: 0.5, horn: 1.4, clear: 1.6, castlehit: 0.5,
  herodown: 1.2, crumble: 0.9, syrup: 0.5, etzap: 0.35, towerdown: 1.6 };

function drawFx(g, fxList, now, z) {
  for (const f of fxList) {
    const life = (FX_LIFE[f.t] || 0.5) * 1000;
    const age = now - f.t0;
    if (age > life) continue;
    const k = age / life;
    g.save(); g.translate(f.x, f.y); g.globalAlpha = 1 - k * k;
    const lw = Math.max(3, 4 / z);
    if (f.t === 'pew' && f.x2 !== undefined) {
      g.strokeStyle = '#ffde59'; g.lineWidth = lw; g.lineCap = 'round';
      const t0 = Math.min(1, k * 2.4), t1 = Math.min(1, k * 3);
      g.beginPath(); g.moveTo((f.x2 - f.x) * t0, (f.y2 - f.y) * t0);
      g.lineTo((f.x2 - f.x) * t1, (f.y2 - f.y) * t1); g.stroke();
    } else if (f.t === 'etzap' && f.x2 !== undefined) {
      g.strokeStyle = '#ff5c8a'; g.lineWidth = lw * 1.8;
      g.beginPath(); g.moveTo(0, -30); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = lw * 0.6;
      g.beginPath(); g.moveTo(0, -30); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
    } else if (f.t === 'towerdown') {
      g.font = `${Math.max(36, 42 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('🎉', -26, -k * 60); g.fillText('💰', 26, -k * 40);
    } else if (f.t === 'zap' && f.x2 !== undefined) {
      g.strokeStyle = '#ff5cf0'; g.lineWidth = lw;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = lw * 0.4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
    } else if (f.t === 'slash' && f.x2 !== undefined) {
      g.strokeStyle = '#fff'; g.lineWidth = lw * 1.4; g.lineCap = 'round';
      const dx = f.x2 - f.x, dy = f.y2 - f.y, m = Math.hypot(dx, dy) || 1;
      g.beginPath(); g.moveTo(0, 0); g.lineTo((dx / m) * 40, (dy / m) * 40); g.stroke();
    } else if (f.t === 'shell' && f.x2 !== undefined) {
      const t = Math.min(1, k * 1.6);
      const mx = (f.x2 - f.x) * t, my = (f.y2 - f.y) * t - Math.sin(t * Math.PI) * 120;
      g.font = `${Math.max(20, 22 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('⚪', mx, my);
    } else if (f.t === 'boom') {
      g.strokeStyle = '#ff9f4a'; g.lineWidth = lw * 2;
      g.beginPath(); g.arc(0, 0, 12 + k * (f.r || 90), 0, Math.PI * 2); g.stroke();
      g.font = `${Math.max(30, 34 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('💥', 0, -k * 20);
    } else if (f.t === 'bash' || f.t === 'nova' || f.t === 'barrage') {
      g.strokeStyle = f.t === 'nova' ? '#7fd8ff' : f.t === 'barrage' ? '#b380ff' : '#ffd93d';
      g.lineWidth = lw * 2;
      g.beginPath(); g.arc(0, 0, 16 + k * (f.r || 130), 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'cry') {
      g.strokeStyle = '#ff4d6d'; g.lineWidth = lw * 1.6; g.setLineDash([12, 10]);
      g.beginPath(); g.arc(0, 0, 20 + k * (f.r || 260), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.font = `${Math.max(26, 30 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('📣', 0, -12 - k * 26);
    } else if (f.t === 'trap') {
      g.strokeStyle = '#ff7ab8'; g.lineWidth = lw; g.setLineDash([8, 8]);
      g.beginPath(); g.arc(0, 0, f.r || 150, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    } else if (f.t === 'pierce' && f.x2 !== undefined) {
      g.strokeStyle = '#fff'; g.lineWidth = lw * 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
      g.strokeStyle = '#ff4d6d'; g.lineWidth = lw * 0.7;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
    } else if (f.t === 'meteor') {
      g.font = `${Math.max(34, 40 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('☄️', (1 - k) * 160, -(1 - k) * 320);
    } else if (f.t === 'heal') {
      g.strokeStyle = '#6bcf7f'; g.lineWidth = lw * 1.4;
      g.beginPath(); g.arc(0, 0, 16 + k * (f.r || 220), 0, Math.PI * 2); g.stroke();
      g.font = `${Math.max(22, 24 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('✨', 0, -10 - k * 34);
    } else if (f.t === 'overclock') {
      g.strokeStyle = '#ffd93d'; g.lineWidth = lw * 1.4; g.setLineDash([10, 8]);
      g.beginPath(); g.arc(0, 0, 16 + k * (f.r || 260), 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.font = `${Math.max(22, 24 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('⚡', 0, -10 - k * 30);
    } else if (f.t === 'shield') {
      g.strokeStyle = '#7fd8ff'; g.lineWidth = lw * 1.6;
      g.beginPath(); g.arc(0, 0, 20 + k * 60, 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'built' || f.t === 'spawn') {
      g.strokeStyle = f.t === 'built' ? '#6bcf7f' : '#b380ff'; g.lineWidth = lw;
      g.beginPath(); g.arc(0, 0, 6 + k * 30, 0, Math.PI * 2); g.stroke();
      if (f.t === 'built') { g.font = `${Math.max(20, 22 / z)}px sans-serif`; g.textAlign = 'center'; g.fillText('🔨', 0, -8 - k * 20); }
    } else if (f.t === 'sold') {
      g.font = `${Math.max(20, 24 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('💰', 0, -k * 40);
    } else if (f.t === 'level') {
      g.font = `${Math.max(22, 26 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('⭐', 0, -8 - k * 44);
      g.strokeStyle = '#ffd93d'; g.lineWidth = lw;
      g.beginPath(); g.arc(0, 0, 8 + k * 26, 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'die') {
      g.font = `${Math.max(18, 20 / z)}px sans-serif`; g.textAlign = 'center';
      g.globalAlpha = 1 - k;
      g.fillText('💨', 0, -k * 26);
      g.fillStyle = '#ffd93d';
      g.fillText('🪙', 10, -k * 44);
    } else if (f.t === 'hit') {
      g.fillStyle = '#ffd93d';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + k * 3;
        g.beginPath(); g.arc(Math.cos(a) * (4 + k * 12), Math.sin(a) * (4 + k * 12), Math.max(2, 2.5 / z), 0, Math.PI * 2); g.fill();
      }
    } else if (f.t === 'castlehit') {
      g.strokeStyle = '#ff4d4d'; g.lineWidth = lw * 1.6;
      g.beginPath(); g.arc(0, 0, 10 + k * 40, 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'herodown') {
      g.font = `${Math.max(26, 30 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('💔', 0, -k * 50);
    } else if (f.t === 'crumble') {
      g.font = `${Math.max(30, 36 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('🧱', -14 + k * -20, k * 30); g.fillText('💥', 8, -k * 20);
    } else if (f.t === 'horn') {
      g.strokeStyle = '#c95cff'; g.lineWidth = lw * 2;
      g.beginPath(); g.arc(0, 0, 30 + k * 220, 0, Math.PI * 2); g.stroke();
      g.font = `${Math.max(34, 40 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('📯', 0, -k * 30);
    } else if (f.t === 'clear') {
      g.font = `${Math.max(38, 44 / z)}px sans-serif`; g.textAlign = 'center';
      g.fillText('🎉', -30, -k * 60); g.fillText('🎊', 30, -k * 50);
    } else if (f.t === 'syrup') {
      g.strokeStyle = 'rgba(230,170,60,.7)'; g.lineWidth = lw;
      g.beginPath(); g.arc(0, 0, (f.r || 140) * (0.6 + k * 0.4), 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }
}

function drawFields(g, fields, now) {
  for (const [x, y, r] of fields) {
    g.save(); g.translate(x, y);
    g.fillStyle = 'rgba(255,110,170,.16)';
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,110,170,.5)'; g.lineWidth = 5;
    g.setLineDash([12, 10]); g.lineDashOffset = -(now * 0.02) % 22;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.restore();
  }
}

/* soft-edged fog overlay: 1 px per cell, scaled up with smoothing */
function drawFog(g, fogArr, fogV, cache) {
  if (!cache.cnv) {
    cache.cnv = document.createElement('canvas');
    cache.cnv.width = FOG_COLS; cache.cnv.height = FOG_ROWS;
  }
  if (cache.v !== fogV) {
    cache.v = fogV;
    const fg = cache.cnv.getContext('2d');
    fg.clearRect(0, 0, FOG_COLS, FOG_ROWS);
    fg.fillStyle = 'rgba(22,16,32,0.88)';
    for (let j = 0; j < FOG_ROWS; j++) for (let i = 0; i < FOG_COLS; i++) {
      if (!fogArr[j * FOG_COLS + i]) fg.fillRect(i, j, 1, 1);
    }
  }
  g.imageSmoothingEnabled = true;
  g.drawImage(cache.cnv, -WORLD_W, -WORLD_H, WORLD_W * 2, WORLD_H * 2);
}

/* one full frame from a snapshot — both screens use this */
function drawScene(g, world, snap, seats, now, z, mySeat, fogCache) {
  drawTerrain(g, world, snap.ap, now);
  drawFields(g, snap.fields || [], now);
  drawCastleAt(g, world.castle.x, world.castle.y, snap.c[0], snap.c[1], snap.chit, now);
  drawHordeBase(g, world.horde.x, world.horde.y, snap.hb[0], snap.hb[1], snap.hhit, now);
  for (const t of snap.eb || []) drawETower(g, t, z, now, false);
  for (const t of snap.pt || []) drawETower(g, t, z, now, true);
  for (const b of snap.b) drawBld(g, b, seats, z, now);
  for (const a of snap.a) drawAlly(g, a, seats, z, now);
  const seen = (e) => !snap.fogArr || snap.fogArr[fogIdx(e[2], e[3])];
  for (const n of (snap.nn || []).filter(seen)) drawNeutral(g, n, z, now);
  const ground = snap.e.filter((e) => !ETYPES[ETYPE[e[1]]].air && seen(e));
  const air = snap.e.filter((e) => ETYPES[ETYPE[e[1]]].air && seen(e));
  for (const e of ground) drawEnemy(g, e, z, now);
  for (const p of snap.pl) drawHeroRow(g, p, seats, z, now, mySeat !== undefined && p[0] === mySeat);
  for (const e of air) drawEnemy(g, e, z, now);
  if (snap.fogArr && fogCache) drawFog(g, snap.fogArr, snap.fogV, fogCache);
  drawFx(g, snap.fxLive || [], now, z);
}

/* ================= snapshot interpolation (both screens) ================= */

function lerpView(prev, cur, alpha) {
  const s = cur.snap;
  if (!prev) return s;
  const p = prev.snap;
  const a = clamp(alpha, 0, 1);
  const mix = (x0, x1) => x0 + (x1 - x0) * a;
  const prevPl = new Map(p.pl.map((r) => [r[0], r]));
  const pl = s.pl.map((r) => {
    const q = prevPl.get(r[0]);
    return q ? [r[0], r[1], mix(q[2], r[2]), mix(q[3], r[3]), ...r.slice(4)] : r;
  });
  const prevE = new Map(p.e.map((r) => [r[0], r]));
  const e = s.e.map((r) => {
    const q = prevE.get(r[0]);
    return q ? [r[0], r[1], mix(q[2], r[2]), mix(q[3], r[3]), ...r.slice(4)] : r;
  });
  const prevA = new Map(p.a.map((r) => [r[0], r]));
  const al = s.a.map((r) => {
    const q = prevA.get(r[0]);
    return q ? [r[0], r[1], r[2], mix(q[3], r[3]), mix(q[4], r[4]), r[5]] : r;
  });
  const prevN = new Map((p.nn || []).map((r) => [r[0], r]));
  const nn = (s.nn || []).map((r) => {
    const q = prevN.get(r[0]);
    return q ? [r[0], r[1], mix(q[2], r[2]), mix(q[3], r[3]), r[4]] : r;
  });
  return { ...s, pl, e, a: al, nn };
}

const fitZoom = (w, h) => Math.min(w / (WORLD_W * 2.12), h / (WORLD_H * 2.12));

/* ================= HOST (big screen) ================= */

const HOST_HTML = `
<div class="gg-host">
  <canvas class="gg-canvas"></canvas>
  <div class="gg-topbar">
    <div class="gg-pill gg-wavepill">🌊 Getting ready…</div>
    <div class="gg-castlewrap">
      <span class="gg-castle-emoji">🏰</span>
      <div class="gg-castlebar"><div class="gg-castlefill"></div><span class="gg-castletxt"></span></div>
    </div>
    <div class="gg-pill gg-timerpill hidden">⏳</div>
    <div class="gg-pill gg-hordepill hidden">👹</div>
  </div>
  <div class="gg-roster"></div>
  <div class="gg-banner hidden"></div>
  <div class="gg-pickview hidden">
    <h2>Choose your hero on your phone!</h2>
    <div class="gg-pickgrid"></div>
  </div>
  <div class="gg-over hidden"></div>
</div>`;

function createHost(ctx) {
  let sim, timer = 0, raf = 0;
  let prev = null, cur = null;
  let fxLive = [];
  let canvas, g, cam = { x: 0, y: 0, z: 0.2, tz: 0.2 };
  let dragging = null, lastPhase = '', lastTowers = [-1, -1];
  const seenEHeroes = new Set();
  const fogCache = { v: -1, cnv: null };
  let onResize;

  function seats() {
    const arr = [];
    for (const p of ctx.players()) {
      const sp = sim.players.get(p.id);
      if (sp) arr[sp.seat] = { name: p.name, avatar: p.avatar, color: p.color, connected: p.connected };
    }
    return arr;
  }

  function sendInit(playerId) {
    const msg = {
      k: 'init', seed: sim.seed,
      seats: seats().map((s, i) => s ? { seat: i, name: s.name, avatar: s.avatar, color: s.color } : null),
    };
    if (playerId) {
      const sp = sim.players.get(playerId);
      ctx.sendTo(playerId, { ...msg, mySeat: sp ? sp.seat : -1 });
    } else {
      for (const p of ctx.players()) {
        const sp = sim.players.get(p.id);
        ctx.sendTo(p.id, { ...msg, mySeat: sp ? sp.seat : -1 });
      }
    }
  }

  function start() {
    ctx.root.innerHTML = HOST_HTML;
    canvas = ctx.root.querySelector('.gg-canvas');
    g = canvas.getContext('2d');
    sim = makeSim((Date.now() % 100000) | 0);
    for (const p of ctx.players()) if (p.connected) addPlayer(sim, p.id);

    onResize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      cam.tz = fitZoom(canvas.width, canvas.height);
      if (!dragging) cam.z = cam.tz;
    };
    window.addEventListener('resize', onResize);
    onResize();

    canvas.addEventListener('mousedown', (e) => { dragging = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mousemove', hostDrag);
    window.addEventListener('mouseup', () => { dragging = null; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      cam.tz = clamp(cam.tz * f, fitZoom(canvas.width, canvas.height) * 0.85, 3);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => { cam.x = 0; cam.y = 0; cam.tz = fitZoom(canvas.width, canvas.height); });

    renderPickView();
    sendInit();
    timer = setInterval(tickLoop, TICK_MS);
    raf = requestAnimationFrame(render);
  }

  function hostDrag(e) {
    if (!dragging) return;
    cam.x -= (e.clientX - dragging.x) * devicePixelRatio / cam.z;
    cam.y -= (e.clientY - dragging.y) * devicePixelRatio / cam.z;
    dragging = { x: e.clientX, y: e.clientY };
  }

  function tickLoop() {
    stepSim(sim);
    if (sim.tick % SNAP_EVERY !== 0) return;
    const snap = snapshot(sim);
    const now = performance.now();
    for (const f of snap.fx) fxLive.push({ ...f, t0: now });
    fxLive = fxLive.filter((f) => now - f.t0 < 2000);
    prev = cur;
    cur = { at: now, snap };
    ctx.sendAll(snap);
    updateHud(snap);
  }

  function banner(html, ms = 2600) {
    const el = ctx.root.querySelector('.gg-banner');
    el.innerHTML = html;
    el.classList.remove('hidden');
    el.classList.remove('gg-banner-pop'); void el.offsetWidth;
    el.classList.add('gg-banner-pop');
    clearTimeout(banner.t);
    banner.t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  function renderPickView() {
    const grid = ctx.root.querySelector('.gg-pickgrid');
    grid.innerHTML = HEROES.map((h) => `
      <div class="gg-pickcard" data-hero="${h.id}">
        <div class="gg-pickemoji">${h.emoji}</div>
        <div class="gg-pickname">${TEAM_EMOJI[h.team]} ${h.name}</div>
        <div class="gg-pickdesc">${h.desc}</div>
        <div class="gg-picktaken"></div>
      </div>`).join('');
  }

  function updateHud(snap) {
    const $q = (s) => ctx.root.querySelector(s);
    const st = seats();

    /* pick phase overlay */
    const pickEl = $q('.gg-pickview');
    if (snap.ph === 'pick') {
      pickEl.classList.remove('hidden');
      for (const card of pickEl.querySelectorAll('.gg-pickcard')) {
        const idx = HERO_IDX.indexOf(card.dataset.hero);
        const takers = snap.pl.filter((r) => r[1] === idx).map((r) => st[r[0]]).filter(Boolean);
        card.querySelector('.gg-picktaken').innerHTML =
          takers.map((t) => `<span class="gg-taker" style="border-color:${t.color}">${t.avatar} ${escapeHtml(t.name)}</span>`).join('');
        card.classList.toggle('gg-pickcard-taken', takers.length > 0);
      }
    } else pickEl.classList.add('hidden');

    /* top bar */
    const wp = $q('.gg-wavepill');
    if (snap.ph === 'pick') wp.textContent = '🦸 Choosing heroes…';
    else {
      const m = Math.floor(snap.clock / 60), sec = String(snap.clock % 60).padStart(2, '0');
      wp.textContent = `⏱ ${m}:${sec}`;
    }

    const frac = clamp(snap.c[0] / snap.c[1], 0, 1);
    $q('.gg-castlefill').style.width = `${frac * 100}%`;
    $q('.gg-castlefill').style.background = frac > 0.5 ? '#6bcf7f' : frac > 0.25 ? '#ffd93d' : '#ff4d6d';
    $q('.gg-castletxt').textContent = `${snap.c[0]} / ${snap.c[1]}`;

    const tp = $q('.gg-timerpill');
    if (snap.ph === 'pick') { tp.classList.remove('hidden'); tp.textContent = `⏳ ${Math.ceil(snap.pt / 10)}s`; }
    else tp.classList.add('hidden');

    /* the horde base's health, mirrored up top in purple */
    const hp = $q('.gg-hordepill');
    hp.classList.remove('hidden');
    hp.textContent = `👹 ${Math.max(0, Math.round((snap.hb[0] / snap.hb[1]) * 100))}%`;

    /* roster chips */
    $q('.gg-roster').innerHTML = snap.pl.map((r) => {
      const s = st[r[0]];
      if (!s) return '';
      const hero = (r[1] >= 0 ? HEROES[r[1]].emoji : '❔') + (TEAM_EMOJI[r[19]] || '');
      const status = r[6] > 0 ? ` · 😵 ${Math.ceil(r[6] / 10)}s` : ` · Lv ${r[11]}`;
      return `<div class="gg-chip ${s.connected ? '' : 'gg-chip-off'}" style="border-color:${s.color}">
        <span class="gg-chip-hero">${hero}</span>
        <span class="gg-chip-name">${escapeHtml(s.name)}</span>
        <span class="gg-chip-meta">🪙${r[7]} · ⚔️${r[12]}${status}</span>
      </div>`;
    }).join('');

    /* event banners: match start, towers falling, enemy heroes arriving */
    if (snap.ph !== lastPhase && snap.ph === 'play') {
      banner(`<b>MARCH! ⚔️</b><span>Destroy the Rock Candy Cavern before it destroys the castle!</span>`, 4000);
    }
    lastPhase = snap.ph;
    const nE = (snap.eb || []).length, nP = (snap.pt || []).length;
    if (lastTowers[1] >= 0 && nE < lastTowers[1]) banner(`<b>HORDE TOWER DOWN! 💥</b><span>${TEAM_NAME[0]} are pushing in!</span>`);
    if (lastTowers[0] >= 0 && nP < lastTowers[0]) banner(`<b>GUMMI TOWER DOWN! 💥</b><span>${TEAM_NAME[1]} are pushing in!</span>`);
    lastTowers = [nP, nE];
    for (const [arr, defs, emoji] of [[snap.e || [], ETYPES, '👹'], [snap.a || [], ATYPES, '🍬']]) {
      const keyOf = arr === snap.e ? (r) => ETYPE[r[1]] : (r) => ATYPE[r[2]];
      for (const row of arr) {
        const def = defs[keyOf(row)];
        if (def && def.hero && !seenEHeroes.has(row[0])) {
          seenEHeroes.add(row[0]);
          if (lastPhase === 'play') banner(`<b>${def.label.toUpperCase()}! ${emoji}</b><span>A champion joins the war</span>`);
        }
      }
    }

    /* game over */
    if (snap.over !== undefined) showOver(snap);
  }

  function showOver(snap) {
    const el = ctx.root.querySelector('.gg-over');
    if (!el.classList.contains('hidden')) return;
    const st = seats();
    const rows = snap.pl.map((r) => {
      const s = st[r[0]];
      return s ? `<div class="gg-over-row" style="border-color:${s.color}">
        <span>${TEAM_EMOJI[r[19]] || ''} ${r[1] >= 0 ? HEROES[r[1]].emoji : '❔'} ${escapeHtml(s.name)} · Lv ${r[11]}</span>
        <span>⚔️ ${r[12]} kills</span>
      </div>` : '';
    }).join('');
    const winner = snap.over;
    el.innerHTML = `<div class="gg-over-card ${winner === 0 ? 'gg-over-win' : 'gg-over-lose'}">
         <h1>${TEAM_EMOJI[winner]} ${TEAM_NAME[winner].toUpperCase()} WINS!</h1>
         <p>${winner === 0
           ? 'The Rock Candy Cavern lies in ruins — the meadow is safe for dessert!'
           : 'The Gingerbread Castle has crumbled — the horde feasts tonight!'}</p>${rows}
         <p class="gg-over-hint">Press ⌂ Lobby to play again</p></div>`;
    el.classList.remove('hidden');
  }

  function render(now) {
    raf = requestAnimationFrame(render);
    cam.z += (cam.tz - cam.z) * 0.12;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#4c8f5e';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!cur) return;
    const alpha = (performance.now() - cur.at) / (TICK_MS * SNAP_EVERY);
    const view = lerpView(prev, cur, alpha);
    view.fxLive = fxLive;
    view.fogArr = sim.fog; view.fogV = sim.fogV;
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);
    drawScene(g, sim.world, view, seats(), now, cam.z, undefined, fogCache);
    g.restore();
  }

  function onMessage(playerId, data) {
    if (!sim.players.has(playerId)) { addPlayer(sim, playerId); sendInit(); }
    const p = sim.players.get(playerId);
    switch (data.k) {
      case 'pick': pickHero(sim, playerId, data.hero, data.team === 1 ? 1 : 0); sendInit(playerId); break;
      case 'mv': p.dir = { x: +data.x || 0, y: +data.y || 0 }; break;
      case 'ab': castAbility(sim, playerId, clamp(data.i | 0, 0, 2)); break;
      case 'walk':
        if (sim.phase === 'play' && p.hero && !p.dead) p.moveTo = { x: +data.x || 0, y: +data.y || 0 };
        break;
      case 'build': {
        const res = build(sim, playerId, data.type, +data.x || 0, +data.y || 0);
        if (res === 'coins') ctx.sendTo(playerId, { k: 'toast', msg: 'Not enough coins! 🪙' });
        else if (res === 'fog') ctx.sendTo(playerId, { k: 'toast', msg: '🌫️ Unexplored! Walk a hero out there to scout it first' });
        else if (res === 'spot') ctx.sendTo(playerId, { k: 'toast', msg: "Can't build there — too close to a lane or building" });
        break;
      }
      case 'up': upgradeHero(sim, playerId, data.what); break;
      case 'bup': upgradeBld(sim, playerId, data.id | 0); break;
      case 'sell': sellBld(sim, playerId, data.id | 0); break;
    }
  }

  function onPlayerJoin(player) {
    addPlayer(sim, player.id);
    sendInit();
  }
  function onPlayerLeave(playerId) {
    const p = sim.players.get(playerId);
    if (p) { p.connected = false; p.dir = { x: 0, y: 0 }; p.ready = true; }
  }
  function onPlayerRejoin(player) {
    const p = sim.players.get(player.id);
    if (p) { p.connected = true; }
    sendInit(player.id);
  }

  function destroy() {
    clearInterval(timer);
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('mousemove', hostDrag);
    ctx.root.innerHTML = '';
  }

  return { start, onMessage, onPlayerJoin, onPlayerLeave, onPlayerRejoin, destroy };
}

/* ================= CONTROLLER (phone) ================= */

const CTRL_HTML = `
<div class="gg-ctrl">
  <!-- hero select -->
  <div class="gg-cpick">
    <h2 class="gg-cpick-title">Choose your side</h2>
    <div class="gg-teamrow">
      <button class="gg-teambtn gg-teambtn-on" data-team="0">🍬 Gummi Kingdom</button>
      <button class="gg-teambtn" data-team="1">👹 Rock Candy Horde</button>
    </div>
    <div class="gg-cpick-grid"></div>
  </div>

  <!-- in-game -->
  <div class="gg-cgame hidden">
    <div class="gg-cstatus">
      <span class="gg-cs-wave"></span>
      <span class="gg-cs-lvl"></span>
      <span class="gg-cs-coins"></span>
      <div class="gg-cs-hpwrap"><div class="gg-cs-hp"></div><div class="gg-cs-xp"></div></div>
      <button class="gg-shopbtn">🎒</button>
    </div>
    <div class="gg-canvaswrap"><canvas class="gg-cmap"></canvas></div>

    <!-- WAVE controls: joystick + 3 powers -->
    <div class="gg-wavehud hidden">
      <div class="gg-stickzone"><div class="gg-stick"><div class="gg-nub"></div></div></div>
      <div class="gg-abs"></div>
    </div>

    <!-- the SHOP: gear, towers, and building — open any time, the war rages on -->
    <div class="gg-prep hidden">
      <div class="gg-prep-head">
        <span class="gg-prep-timer">🪙</span>
        <button class="gg-ready-btn">⚔️ Back to battle</button>
      </div>
      <div class="gg-tabs">
        <button class="gg-tab gg-tab-on" data-tab="gear">🎒 Gear</button>
        <button class="gg-tab" data-tab="build">🔨 Build</button>
        <button class="gg-tab" data-tab="towers">🏗️ My Towers</button>
      </div>
      <div class="gg-tabbody"></div>
    </div>

    <!-- placement bar while dropping a tower -->
    <div class="gg-placebar hidden">
      <button class="gg-place-cancel">✖ Cancel</button>
      <span class="gg-place-hint">Tap the map to aim</span>
      <button class="gg-place-ok" disabled>🔨 Place</button>
    </div>

    <div class="gg-toast hidden"></div>
    <div class="gg-cover hidden"></div>
  </div>
</div>`;

function createController(ctx) {
  let world = null, seats = [], mySeat = -1;
  let prev = null, cur = null, fxLive = [];
  let canvas, g, raf = 0;
  let mode = 'pick';                 // 'pick' | 'play' | 'panel'
  let panelOpen = false;             // the shop overlay (gear/build/towers)
  let tab = 'gear';
  let placing = null;                // { type, x, y } while dropping a tower
  let cam = { x: 0, y: 0, z: 0.1 };
  let mapCam = null;                 // pan/zoom for prep map { x, y, z }
  let stick = null;                  // active joystick touch
  let lastMv = 0, lastSent = '0,0';
  let myHero = null, myTeam = 0;
  let touch = null;                  // prep map pan/pinch state
  let onResize, ro = null;
  let fog = null, fogVSeen = -1;
  const fogCache = { v: -1, cnv: null };

  const $q = (s) => ctx.root.querySelector(s);

  function start() {
    ctx.root.innerHTML = CTRL_HTML;
    canvas = $q('.gg-cmap');
    g = canvas.getContext('2d');

    /* each side has its own hero roster — swap the cards when the team flips */
    const renderRoster = () => {
      $q('.gg-cpick-grid').innerHTML = heroesOfTeam(myTeam).map((h) => `
        <button class="gg-ccard" data-hero="${h.id}">
          <span class="gg-ccard-emoji">${h.emoji}</span>
          <span class="gg-ccard-name">${h.name}</span>
          <span class="gg-ccard-desc">${h.desc}</span>
          <span class="gg-ccard-abs">${ABILITIES[h.id].map((a) => `${a[1]} ${a[0]}`).join(' · ')}</span>
        </button>`).join('');
      for (const btn of ctx.root.querySelectorAll('.gg-ccard')) {
        btn.addEventListener('click', () => {
          ctx.send({ k: 'pick', hero: btn.dataset.hero, team: myTeam });
          btn.classList.add('gg-ccard-picked');
        });
      }
    };
    renderRoster();
    for (const btn of ctx.root.querySelectorAll('.gg-teambtn')) {
      btn.addEventListener('click', () => {
        myTeam = +btn.dataset.team;
        for (const b of ctx.root.querySelectorAll('.gg-teambtn')) b.classList.toggle('gg-teambtn-on', b === btn);
        renderRoster();
      });
    }

    onResize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
      const h = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      /* re-clamp the prep-map zoom whenever the layout reshapes the canvas */
      if (mapCam) mapCam.z = clamp(mapCam.z, fitZoom(w, h) * 0.9, 1.4);
    };
    window.addEventListener('resize', onResize);
    /* the canvas changes size when panels show/hide, with no window resize —
       a ResizeObserver keeps the pixel buffer matched so the map never stretches */
    ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    onResize();

    bindStick();
    bindMapTouch();
    $q('.gg-shopbtn').addEventListener('click', () => {
      panelOpen = !panelOpen;
      if (panelOpen) ctx.send({ k: 'mv', x: 0, y: 0 });   // stand still while shopping
      syncMode(true);
    });
    $q('.gg-ready-btn').addEventListener('click', () => { panelOpen = false; placing = null; syncMode(true); });
    for (const t of ctx.root.querySelectorAll('.gg-tab')) {
      t.addEventListener('click', () => { tab = t.dataset.tab; placing = null; updateHud.sig = null; renderTabs(); });
    }
    $q('.gg-place-cancel').addEventListener('click', () => { placing = null; syncMode(true); });
    $q('.gg-place-ok').addEventListener('click', () => {
      if (!placing || placing.x === undefined) return;
      ctx.send({ k: 'build', type: placing.type, x: Math.round(placing.x), y: Math.round(placing.y) });
      placing = null; panelOpen = false; syncMode(true);
    });

    raf = requestAnimationFrame(render);
  }

  /* ---------- joystick ---------- */
  function bindStick() {
    const zone = $q('.gg-stickzone');
    const stickEl = $q('.gg-stick'), nub = $q('.gg-nub');
    const move = (t) => {
      if (!stick) return;
      let dx = t.clientX - stick.x, dy = t.clientY - stick.y;
      const m = Math.hypot(dx, dy);
      if (m > 56) { dx = (dx / m) * 56; dy = (dy / m) * 56; }
      nub.style.transform = `translate(${dx}px,${dy}px)`;
      const nx = +(dx / 56).toFixed(2), ny = +(dy / 56).toFixed(2);
      const key = `${nx},${ny}`;
      const now = performance.now();
      if (key !== lastSent && now - lastMv > 80) {
        lastMv = now; lastSent = key;
        ctx.send({ k: 'mv', x: nx, y: ny });
      }
    };
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      stick = { id: t.identifier, x: t.clientX, y: t.clientY };
      const zr = zone.getBoundingClientRect();
      stickEl.style.left = `${t.clientX - zr.left}px`;
      stickEl.style.top = `${t.clientY - zr.top}px`;
      stickEl.classList.add('gg-stick-live');
      move(t);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (stick && t.identifier === stick.id) move(t);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (stick && t.identifier === stick.id) {
        stick = null; lastSent = '0,0';
        ctx.send({ k: 'mv', x: 0, y: 0 });
        stickEl.classList.remove('gg-stick-live');
        nub.style.transform = 'translate(0,0)';
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
    /* mouse fallback for testing on a desktop browser */
    zone.addEventListener('mousedown', (e) => {
      stick = { id: -1, x: e.clientX, y: e.clientY };
      const zr = zone.getBoundingClientRect();
      stickEl.style.left = `${e.clientX - zr.left}px`;
      stickEl.style.top = `${e.clientY - zr.top}px`;
      stickEl.classList.add('gg-stick-live');
      const mm = (ev) => move(ev);
      const mu = () => {
        stick = null; lastSent = '0,0';
        ctx.send({ k: 'mv', x: 0, y: 0 });
        stickEl.classList.remove('gg-stick-live');
        nub.style.transform = 'translate(0,0)';
        window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu);
      };
      window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    });
  }

  /* ---------- prep-map touch: tap to walk / aim towers, drag to pan, pinch to zoom ---------- */
  const tdist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);

  function screenToWorld(px, py) {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? canvas.width / rect.width : devicePixelRatio;
    const sy = rect.height ? canvas.height / rect.height : devicePixelRatio;
    const cx = (px - rect.left) * sx, cy = (py - rect.top) * sy;
    const c = mode === 'panel' && mapCam ? mapCam : cam;
    return { x: (cx - canvas.width / 2) / c.z + c.x, y: (cy - canvas.height / 2) / c.z + c.y };
  }

  function bindMapTouch() {
    canvas.addEventListener('touchstart', (e) => {
      if (mode !== 'panel') return;
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touch = { m: 'pan', x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, moved: 0 };
      } else if (e.touches.length === 2) {
        touch = { m: 'zoom', d: tdist(e), z: mapCam.z };
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (mode !== 'panel' || !touch) return;
      e.preventDefault();
      if (touch.m === 'pan' && e.touches.length === 1) {
        const t = e.touches[0];
        const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        touch.moved += Math.abs(dx) + Math.abs(dy);
        mapCam.x -= dx * devicePixelRatio / mapCam.z;
        mapCam.y -= dy * devicePixelRatio / mapCam.z;
        touch.x = t.clientX; touch.y = t.clientY;
      } else if (touch.m === 'zoom' && e.touches.length === 2) {
        mapCam.z = clamp(touch.z * (tdist(e) / touch.d), fitZoom(canvas.width, canvas.height) * 0.9, 1.4);
      }
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
      if (mode !== 'panel' || !touch) return;
      if (touch.m === 'pan' && touch.moved < 14) mapTap(touch.x0, touch.y0);
      if (!e.touches.length) touch = null;
    });
    canvas.addEventListener('click', (e) => {      // desktop testing
      if (mode === 'panel') mapTap(e.clientX, e.clientY);
    });
  }

  function mapTap(px, py) {
    const w = screenToWorld(px, py);
    if (placing) { placing.x = w.x; placing.y = w.y; return; }
    if (tab === 'map') {
      ctx.send({ k: 'walk', x: Math.round(w.x), y: Math.round(w.y) });
      fxLive.push({ t: 'built', x: w.x, y: w.y, t0: performance.now() });
    }
  }

  /* drop the ghost on a legal spot right next to the hero, so "Place"
     works immediately and the player can see what they're doing */
  function autoAim() {
    if (!placing || !cur || !world) return;
    const me = myRow(cur.snap);
    const hx = me ? me[2] : 0, hy = me ? me[3] : 0;
    placing.x = hx; placing.y = hy + 90;
    outer: for (let r = 90; r <= 600; r += 60) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = hx + Math.cos(a) * r, y = hy + Math.sin(a) * r;
        if (canPlace(world, cur.snap.b, x, y, fog)) { placing.x = x; placing.y = y; break outer; }
      }
    }
    /* zoom the build map in on the ghost so it's big and tappable */
    mapCam = mapCam || { x: 0, y: 0, z: fitZoom(canvas.width, canvas.height) };
    mapCam.x = placing.x; mapCam.y = placing.y;
    mapCam.z = Math.max(mapCam.z, Math.min(canvas.width, canvas.height) / 1400);
  }

  /* ---------- messages from the host ---------- */
  function onMessage(data) {
    if (data.k === 'init') {
      world = buildWorld(data.seed);
      seats = data.seats || [];
      if (data.mySeat !== undefined) mySeat = data.mySeat;
      return;
    }
    if (data.k === 'toast') { toast(data.msg); return; }
    if (data.k !== 'snap') return;
    if (data.fog && data.fogV !== fogVSeen) { fogVSeen = data.fogV; fog = unpackFog(data.fog); }
    prev = cur;
    cur = { at: performance.now(), snap: data };
    const now = performance.now();
    for (const f of data.fx) fxLive.push({ ...f, t0: now });
    fxLive = fxLive.filter((f) => now - f.t0 < 2000);
    syncMode();
    updateHud(data);
  }

  function myRow(snap) { return snap.pl.find((r) => r[0] === mySeat); }

  function syncMode(force) {
    if (!cur) return;
    const snap = cur.snap;
    const me = myRow(snap);
    let want;
    if (!me || me[1] < 0) want = 'pick';
    else want = (panelOpen || placing) ? 'panel' : 'play';
    if (snap.over !== undefined) want = 'over';
    if (want === mode && !force) return;
    mode = want;
    myHero = me && me[1] >= 0 ? HEROES[me[1]] : null;

    $q('.gg-cpick').classList.toggle('hidden', mode !== 'pick');
    $q('.gg-cgame').classList.toggle('hidden', mode === 'pick');
    $q('.gg-wavehud').classList.toggle('hidden', mode !== 'play');
    $q('.gg-prep').classList.toggle('hidden', mode !== 'panel' || !!placing);
    $q('.gg-placebar').classList.toggle('hidden', !placing);
    $q('.gg-cgame').classList.toggle('gg-placing', !!placing);
    $q('.gg-shopbtn').classList.toggle('gg-shopbtn-on', mode === 'panel');

    if (mode === 'panel' && !mapCam) {
      mapCam = { x: 0, y: 0, z: fitZoom(canvas.width, canvas.height) };
    }
    if (mode === 'panel' && !placing) { updateHud.sig = null; renderTabs(); }
    if (mode === 'over') showOver(snap);
    requestAnimationFrame(onResize);
  }

  function showOver(snap) {
    const el = $q('.gg-cover');
    el.classList.remove('hidden');
    $q('.gg-wavehud').classList.add('hidden');
    $q('.gg-prep').classList.add('hidden');
    const me = myRow(snap);
    const won = me && me[19] === snap.over;
    el.innerHTML = won
      ? `<h1>🏆</h1><p>VICTORY for the ${TEAM_NAME[snap.over]}!</p>`
      : `<h1>💔</h1><p>The ${TEAM_NAME[snap.over]} won this one.<br>Watch the big screen!</p>`;
  }

  function toast(msg) {
    const el = $q('.gg-toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  /* ---------- HUD + prep panel ---------- */
  function updateHud(snap) {
    const me = myRow(snap);
    if (!me) return;
    const m = Math.floor(snap.clock / 60), sec = String(snap.clock % 60).padStart(2, '0');
    $q('.gg-cs-wave').textContent = `⏱ ${m}:${sec}`;
    $q('.gg-cs-lvl').textContent = `Lv ${me[11]}`;
    $q('.gg-cs-coins').textContent = `🪙 ${me[7]}`;
    const hpFrac = me[5] ? clamp(me[4] / me[5], 0, 1) : 0;
    const bar = $q('.gg-cs-hp');
    bar.style.width = `${hpFrac * 100}%`;
    bar.style.background = hpFrac > 0.5 ? '#6bcf7f' : hpFrac > 0.25 ? '#ffd93d' : '#ff4d6d';
    $q('.gg-cs-xp').style.width = `${clamp(me[18], 0, 100)}%`;

    if (mode === 'play') updateAbs(me);
    if (mode === 'panel') {
      $q('.gg-prep-timer').textContent = `🪙 ${me[7]}`;
      /* rebuild the shop only when something it shows actually changed,
         so taps and scrolling never fight a re-render */
      const sig = tab + '|' + me[7] + '|' + me[11] + '|' + me.slice(14).join(',') + '|' +
        snap.b.filter((r) => r[1] === mySeat).map((r) => `${r[0]}:${r[5]}:${r[6]}`).join(',');
      if (sig !== updateHud.sig) { updateHud.sig = sig; renderTabs(); }
    }
  }

  function updateAbs(me) {
    const wrap = $q('.gg-abs');
    if (!myHero) return;
    const abs = ABILITIES[myHero.id];
    if (wrap.childElementCount !== 3) {
      wrap.innerHTML = abs.map((a, i) => `
        <button class="gg-ab" data-i="${i}">
          <span class="gg-ab-emoji">${a[1]}</span>
          <span class="gg-ab-name">${a[0]}</span>
          <span class="gg-ab-cd"></span>
        </button>`).join('');
      for (const b of wrap.querySelectorAll('.gg-ab')) {
        b.addEventListener('click', () => ctx.send({ k: 'ab', i: +b.dataset.i }));
      }
    }
    const dead = me[6] > 0;
    wrap.querySelectorAll('.gg-ab').forEach((b, i) => {
      const cd = me[8 + i];
      const max = Math.max(1, Math.round(abs[i][2] * (1 - 0.02 * me[17])));
      const frac = clamp(cd / max, 0, 1);
      b.classList.toggle('gg-ab-cool', cd > 0 || dead);
      b.querySelector('.gg-ab-cd').textContent = cd > 0 ? `${Math.ceil(cd / 10)}` : '';
      b.style.setProperty('--cd', `${frac * 100}%`);
    });
  }

  function renderTabs() {
    for (const t of ctx.root.querySelectorAll('.gg-tab')) {
      t.classList.toggle('gg-tab-on', t.dataset.tab === tab);
    }
    const body = $q('.gg-tabbody');
    if (!cur) { body.innerHTML = ''; return; }
    const snap = cur.snap;
    const me = myRow(snap);
    if (!me) return;
    const coins = me[7];

    if (tab === 'gear') {
      const ups = { dmg: me[14], hp: me[15], spd: me[16], pow: me[17] };
      body.innerHTML = `<p class="gg-empty"><small>Buy equipment, then upgrade it tier by tier. Levels come from battle!</small></p>` +
        Object.entries(HUP).map(([key, u]) => {
        const n = ups[key], maxed = n >= HUP_MAX, cost = hupCost(n);
        const pips = Array.from({ length: HUP_MAX }, (_, i) => `<i class="${i < n ? 'gg-pip-on' : ''}"></i>`).join('');
        const owned = n > 0 ? `Tier ${TIER[n]}` : 'Not owned';
        return `<div class="gg-uprow">
          <span class="gg-up-emoji">${u.emoji}</span>
          <span class="gg-up-info"><b>${u.label} <em class="gg-tier">${owned}</em></b><small>${u.hint}</small><span class="gg-pips">${pips}</span></span>
          <button class="gg-buy" data-up="${key}" ${maxed || coins < cost ? 'disabled' : ''}>
            ${maxed ? 'MAX' : n === 0 ? `Buy 🪙${cost}` : `⬆️ 🪙${cost}`}</button>
        </div>`;
      }).join('');
      for (const b of body.querySelectorAll('.gg-buy[data-up]')) {
        b.addEventListener('click', () => ctx.send({ k: 'up', what: b.dataset.up }));
      }
    } else if (tab === 'towers') {
      const mine = snap.b.filter((r) => r[1] === mySeat && BTYPE[r[2]] !== 'wall');
      body.innerHTML = mine.length ? mine.map((r) => {
        const def = BLD[BTYPE[r[2]]];
        const maxed = r[5] >= BUP.max, cost = bupCost(r[5]);
        return `<div class="gg-uprow">
          <span class="gg-up-emoji">${def.emoji}</span>
          <span class="gg-up-info"><b>${def.label}</b><small>Level ${r[5]} · ${r[6]}% HP</small></span>
          <button class="gg-buy" data-bup="${r[0]}" ${maxed || coins < cost ? 'disabled' : ''}>
            ${maxed ? 'MAX' : `⬆️ 🪙${cost}`}</button>
          <button class="gg-sell" data-sell="${r[0]}">💰</button>
        </div>`;
      }).join('') : `<p class="gg-empty">No towers yet — hit the 🔨 Build tab!<br><small>Only YOU can upgrade the towers you build.</small></p>`;
      for (const b of body.querySelectorAll('[data-bup]')) b.addEventListener('click', () => ctx.send({ k: 'bup', id: +b.dataset.bup }));
      for (const b of body.querySelectorAll('[data-sell]')) b.addEventListener('click', () => ctx.send({ k: 'sell', id: +b.dataset.sell }));
    } else if (tab === 'build') {
      const disc = myHero && myHero.discount ? myHero.discount : 1;
      body.innerHTML = `<p class="gg-empty"><small>1️⃣ Tap a tower &nbsp;2️⃣ Tap the map to aim &nbsp;3️⃣ Hit 🔨 Place</small></p>` + BUILDABLE.map((t) => {
        const def = BLD[t], cost = Math.round(def.cost * disc);
        return `<button class="gg-bcard" data-build="${t}" ${coins < cost ? 'disabled' : ''}>
          <span class="gg-bcard-emoji">${def.emoji}</span>
          <span class="gg-bcard-info"><b>${def.label}</b><small>${def.desc}</small></span>
          <span class="gg-bcard-cost">🪙 ${cost}</span>
        </button>`;
      }).join('') + (disc < 1 ? `<p class="gg-empty"><small>🔧 Greta's discount applied!</small></p>` : '');
      for (const b of body.querySelectorAll('[data-build]')) {
        b.addEventListener('click', () => {
          placing = { type: b.dataset.build };
          autoAim();
          syncMode(true);
          toast('Tap the map to move the ghost — Place when it turns green!');
        });
      }
    }
  }

  /* ---------- render ---------- */
  function render(now) {
    raf = requestAnimationFrame(render);
    if (!cur || !world || mode === 'pick') return;
    const snap = cur.snap;
    const alpha = (performance.now() - cur.at) / (TICK_MS * SNAP_EVERY);
    const view = lerpView(prev, cur, alpha);
    view.fxLive = fxLive;
    view.fogArr = fog; view.fogV = fogVSeen;

    let c;
    if (mode === 'play' || mode === 'over') {
      const me = view.pl.find((r) => r[0] === mySeat);
      const z = Math.min(canvas.width, canvas.height) / 680;   // snug over-the-shoulder view
      if (me) { cam.x = me[2]; cam.y = me[3]; }
      cam.z = z;
      c = cam;
    } else {
      c = mapCam || cam;
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#4c8f5e';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    g.scale(c.z, c.z);
    g.translate(-c.x, -c.y);
    drawScene(g, world, view, seats, now, c.z, mySeat, fogCache);

    /* tower ghost while placing */
    if (placing && placing.x !== undefined) {
      const def = BLD[placing.type];
      const ok = canPlace(world, snap.b, placing.x, placing.y, fog);
      g.save(); g.translate(placing.x, placing.y);
      g.globalAlpha = 0.75;
      if (def.range) {
        g.fillStyle = ok ? 'rgba(107,207,127,.15)' : 'rgba(255,77,109,.12)';
        g.beginPath(); g.arc(0, 0, def.range, 0, Math.PI * 2); g.fill();
        g.strokeStyle = ok ? '#6bcf7f' : '#ff4d6d'; g.lineWidth = 4 / c.z; g.setLineDash([10, 8]);
        g.beginPath(); g.arc(0, 0, def.range, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        if (def.minRange) { g.beginPath(); g.arc(0, 0, def.minRange, 0, Math.PI * 2); g.stroke(); }
      }
      g.strokeStyle = ok ? '#6bcf7f' : '#ff4d6d'; g.lineWidth = 6 / c.z; g.setLineDash([]);
      g.beginPath(); g.arc(0, 0, def.r + 14, 0, Math.PI * 2); g.stroke();
      g.restore();
      g.globalAlpha = 0.8;
      drawBld(g, [0, mySeat, BTYPE.indexOf(placing.type), placing.x, placing.y, 1, 100, 0], seats, c.z, now);
      g.globalAlpha = 1;
      if (!ok) {
        g.save(); g.translate(placing.x, placing.y);
        g.font = `${Math.max(30, 34 / c.z)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('🚫', 0, 0);
        g.restore();
      }
      $q('.gg-place-ok').disabled = !ok;
      const hint = ok ? '🟢 Good spot — hit Place!' : '🔴 Blocked — in fog, or too close to a lane/building';
      const hintEl = $q('.gg-place-hint');
      if (hintEl.textContent !== hint) hintEl.textContent = hint;
    }
    g.restore();
  }

  function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    if (ro) ro.disconnect();
    ctx.root.innerHTML = '';
  }

  return { start, onMessage, destroy };
}

/* ================= module export ================= */

export default {
  id: 'gumdropguardians',
  title: 'Gumdrop Guardians',
  tagline: 'Candy battle arena — co-op vs the horde, or team vs team!',
  emoji: '🛡️',
  minPlayers: 1,
  maxPlayers: 6,
  createHost,
  createController,
};

/* headless testing hooks */
export const __sim = {
  makeSim, addPlayer, pickHero, stepSim, build, canPlace, buildWorld,
  upgradeBld, upgradeHero, sellBld, castAbility, snapshot, walkable,
  hurtCreep, hurtNeutral, hurtTower, hurtBase, hurtETower, hurtHorde, addXp,
  makeComp, spawnCreep, spawnGroups, spawnAIHero, creepsOf, towersOf, baseOf, stepBld, stepCreep, heroesOfTeam, pvpHit, oppHeroes,
  HEROES, BLD, CLASSES, ETYPES, ATYPES, NTYPES, ETOWER, CASTLE, HORDE,
  E_SKIN, A_SKIN, BASE_RING, BASE_ZONE, TEAM_NAME, WORLD_W, WORLD_H,
  WALK_COLS, WALK_ROWS, WALK_CELL, SPAWN_EVERY, GROUP_SIZE, XP_LVL,
  revealCircle, fogIdx,
};
