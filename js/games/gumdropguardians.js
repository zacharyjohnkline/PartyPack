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

/* the real-time engine: both bases march a column down EVERY lane every 6 s */
const SPAWN_EVERY = 60;            // ticks between creep waves — 6 seconds flat
const LANE_SIZE = 5;               // creeps per lane, per side, per wave
const GROUP_SIZE = LANE_SIZE * N_PATHS;   // 15 per side per wave
const SPAWN_CLEAR = 70;            // waves form up THIS far outside the keep wall,
const SPAWN_FILE = 26;             // ...in a tidy column so nobody spawns inside it
/* CONGESTION VALVE. Five per lane every six seconds is five times the old
   rate, and when a lane stalls the two columns pile into a single heaving
   blob — hundreds deep, unreadable, and murder on the host's framerate.
   So a lane that already has this many of your creeps alive skips its next
   wave and tries again in six seconds. In a moving lane you will never see
   it fire; in a deadlocked one it is the difference between a battle and a
   traffic jam. Raise it for bigger brawls, lower it for a tidier board. */
const LANE_CAP = 20;               // per side, per lane
const TIME_SCALE = 0.08;           // enemy hp/dmg +8% per minute
const BUILD_R = 340;               // you can only build within arm's reach of your hero
const FOUNTAIN_R = 300;            // heroes heal fast near their own base
const FOUNTAIN_HEAL = 0.005;       // 5%/s at home — no more endless waits
/* the fountain is a rest stop, NOT a panic room: take a hit and the taps
   slow to a trickle for 2 s, so you cannot tank a duel standing on it */
const FOUNTAIN_FIGHT_T = 20;       // "recently attacked" window (2 s)
const FOUNTAIN_FIGHT_MUL = 0.15;   // ...healing drops to 15% inside it
const REGEN_OOC = 50;              // melee regen pauses for 5 s after taking a hit
const ARMOR_MIT = 0.65;            // shields soften a hit by 35% — never again 60%
const ARMOR_MAX_T = 140;           // ...and never last longer than 14 s (cooldown is 30)
const BUFF_MAX_T = 160;            // same ceiling for frenzy/haste: no permanent buffs
const COLLIDE_PUSH = 0.55;         // how hard overlapping bodies shove apart
const COLLIDE_PASSES = 3;          // ...resolved a few times a tick so crowds settle
const BACKSTEP_R = 95;             // "something is ON me" — ranged heroes bolt
const BACKSTEP_T = 20, BACKSTEP_CD = 80;
const DISENGAGE_T = 25;            // mage/shaman blink-step after their nova
const RANGED_REST = 1.5;           // ranged heroes drink 50% faster at fountains & springs
const N_SPRINGS = 4;               // neutral soda springs scattered over the map
const SPRING_R = 170;
const SPRING_HEAL = 0.0035;        // 3.5%/s, either team, fight over them!
const COIN_TRICKLE = 1;            // passive coins per second per player

/* lane towers. Against HEROES the zap is a flat 200 in the inner band and
   half that further out, so where you stand decides what it costs you:
     · a level-1 tank eats 4 point-blank zaps, a level-25 tank eats 12
     · squishier heroes fall proportionally faster — but at range, twice as slow
   Creeps still die in exactly 4 zaps whatever the game clock says. */
/* range trimmed from 270 to 195: a tower no longer blankets its whole
   neighbourhood, so how many creeps you let LIVE in each lane is what
   decides whether the tower is busy when your hero walks in */
const ETOWER = { hp: 2600, dmg: 200, range: 195, cd: 15, r: 34, coin: 260, xp: 320 };
const TOWER_NEAR = 110;            // point-blank band: full force
const TOWER_FAR_MUL = 0.5;         // beyond it: a glancing bolt
const towerDmgVsCreep = (u) => Math.ceil(u.maxhp * 0.25);
const towerDmgVsHero = (p, d) => (d === undefined || d <= TOWER_NEAR
  ? ETOWER.dmg
  : Math.round(ETOWER.dmg * TOWER_FAR_MUL));
const CAPTURE_HP = 1;              // a captured lane tower stands back up at FULL health
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

/* HERO PACE. The per-hero numbers below are the original sprint speeds; this
   scales all of them at once, so there is exactly ONE dial to turn.
   At 1.00 a hero crossed a lane tower's whole danger zone in about a second
   and a half and simply strolled out of trouble — which, with tower reach now
   trimmed to 195, made diving a tower nearly free. At 0.80 a dive costs you
   roughly two zaps instead of one, creeps matter more, and corner-to-corner
   is about 65 s instead of 53. Raise it if the kids find the walking dull. */
const HERO_SPEED = 0.80;

/* heroes — pick one at the start, it's yours for the match.
   Three abilities each (see ABILITIES below). */
const HEROES = [
  /* 🍬 Gummi Kingdom roster */
  { id: 'knight',  team: 0, name: 'Sir Crunch-a-Lot', emoji: '🛡️', desc: 'Melee tank — charges in, huge health, regrows out of combat.',
    hp: 700, dmg: 22, range: 40,  cd: 8, speed: 9.3, r: 20, hitAir: false, regen: 0.0011 },
  { id: 'ranger',  team: 0, name: 'Huckleberry Fin',  emoji: '🏹', desc: 'Long-range archer — Backsteps when cornered, heals fast at springs.',
    hp: 260, dmg: 14, range: 190, cd: 7, speed: 9.0, r: 18, hitAir: true },
  { id: 'mage',    team: 0, name: 'Minty Merlin',     emoji: '🧙', desc: 'Splash spells & meteors — frost-steps free, rests fast at springs.',
    hp: 240, dmg: 11, range: 170, cd: 9, speed: 9.0, r: 18, hitAir: true, splash: 45 },
  { id: 'builder', team: 0, name: 'Gingerbread Greta', emoji: '🔧', desc: 'Melee builder — towers cost 20% less, regrows out of combat.',
    hp: 600, dmg: 12, range: 60,  cd: 8, speed: 9.3, r: 19, hitAir: false, discount: 0.8, regen: 0.0011 },
  /* 👹 Rock Candy Horde roster — same roles, totally different powers */
  { id: 'slasher', team: 1, name: 'Sourpuss Slasher', emoji: '🗡️', desc: 'Twin-blade brawler — spins, rages, LEAPS. Regrows out of combat.',
    hp: 740, dmg: 24, range: 42,  cd: 8, speed: 9.3, r: 20, hitAir: false, regen: 0.0011 },
  { id: 'whip',    team: 1, name: 'Licorice Lasher',  emoji: '🪢', desc: 'Whip skirmisher — snares packs, Backsteps free, hastens the horde.',
    hp: 270, dmg: 13, range: 200, cd: 7, speed: 9.0, r: 18, hitAir: true },
  { id: 'shaman',  team: 1, name: 'Rock Candy Shaman', emoji: '🔮', desc: 'Crystal hexes & life-drain — shard-steps free, rests fast at springs.',
    hp: 240, dmg: 11, range: 170, cd: 9, speed: 9.0, r: 18, hitAir: true, splash: 40 },
  { id: 'tinker',  team: 1, name: 'Taffy Tinker',      emoji: '⚙️', desc: 'Gadget builder — cheap towers, scrap turrets, regrows out of combat.',
    hp: 580, dmg: 12, range: 60,  cd: 8, speed: 9.3, r: 19, hitAir: false, discount: 0.8, regen: 0.0011 },
];
const HERO_IDX = HEROES.map((h) => h.id);
const heroesOfTeam = (team) => HEROES.filter((h) => h.team === team);

/* abilities — [name, emoji, cooldown ticks, blurb] ; numbers live in castAbility */
const ABILITIES = {
  knight: [
    ['Shield Charge', '🐏', 180, 'CHARGE forward, then slam: damage + stun'],
    ['Battle Cry',  '📣', 250, 'Taunt — enemies nearby chase YOU'],
    ['Cake Quake', '🍰', 240, 'SLAM the ground: damage + stun everything around you'],
  ],
  ranger: [
    ['Berry Bomb', '🫐', 200, 'LOB a berry grenade — big blast where it lands'],
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
    ['Frosting Bomb', '🧁', 240, 'LOB a frosting grenade — big blast where it lands'],
    ['Candy Decoy', '🍡', 350, 'Drop a decoy enemies love to chew'],
  ],
  slasher: [
    ['Spin Slash', '🌀', 170, 'Whirl of blades: damage all around you'],
    ['Sour Frenzy', '😤', 280, 'Attack twice as fast + run faster'],
    ['Candy Leap', '🦘', 240, 'LEAP forward and slam the landing zone'],
  ],
  whip: [
    ['Triple Lash', '🪢', 190, 'Crack the whip at the 3 nearest foes'],
    ['Sticky Snare', '🕸️', 230, 'Gooey field that badly slows foes'],
    ['Sour Grenade', '🧨', 230, 'LOB a sour grenade — big blast where it lands'],
  ],
  shaman: [
    ['Shard Volley', '💎', 190, 'Crystal shards: damage + stun — and YOU dash free'],
    ['Crystal Decoy', '🍡', 350, 'Raise a rock-candy lure right here'],
    ['Dark Feast', '🦇', 260, 'Drain life from every foe near you'],
  ],
  tinker: [
    ['Goo Bomb', '🫠', 200, 'LOB a taffy grenade: blast + a big slow where it lands'],
    ['Patch-Up', '🔧', 200, 'Repair nearby buildings (and yourself a bit)'],
    ['Scrap Turret', '🤖', 340, 'Deploy a temporary auto-turret'],
  ],
};

/* GEAR — equipment you buy and then upgrade tier by tier (max VIII) */
const HUP = {
  dmg: { label: 'Lollipop Blade',  emoji: '🗡️', mul: 0.12, hint: '+12% attack damage per tier' },
  hp:  { label: 'Gumdrop Plate',   emoji: '🛡️', mul: 0.15, hint: '+15% max health per tier' },
  spd: { label: 'Zoom-Zoom Boots', emoji: '👟', mul: 0.045, hint: '+4.5% run speed per tier' },
  pow: { label: 'Star Charm',      emoji: '⭐', mul: 0.15, hint: '+15% ability strength per tier' },
};
const HUP_MAX = 8;
const TIER = ['—', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
/* Gear is a LUXURY. The curve bends upward hard, so tier VIII is something
   you brag about rather than something the clock hands you:
     tier   I    II   III   IV    V     VI    VII   VIII
     cost  120  232  388  588   832  1120  1452  1828   (6560 for ONE line)
   Maxing all four lines is 26,240 coins — reachable only by a player who
   last-hits relentlessly AND keeps knocking buildings down. */
const hupCost = (n) => 120 + 90 * n + 22 * n * n;

/* last hits are the whole game now: land the killing blow and you bank
   DOUBLE, while teammates who merely stood nearby split a thin share */
const LASTHIT_COIN = 2.0;          // killer's multiplier on a creep's bounty
const ASSIST_COIN = 0.15;          // ...everyone else on the team gets this
const LASTHIT_XP = 1.5;            // killer's multiplier on a creep's XP

/* hero LEVELS — earned through play: kills, creeps, towers. The road now
   runs all the way to 25, and each step costs more than it used to */
const LVL_MAX = 25;
const XP_LVL = (() => {                       // cumulative XP for lvl 2..25
  const arr = []; let acc = 0;
  for (let l = 2; l <= LVL_MAX; l++) { acc += Math.round(55 + 20 * Math.pow(l - 1, 1.35)); arr.push(acc); }
  return arr;
})();
const LVL_DMG = 0.08, LVL_HP = 0.10, LVL_POW = 0.05;             // per level past 1
const XP_SHARE_R = 520;                                          // nearby allies get 45%

/* the tower catalog — every entry now has a job nothing else can do.
   The old Licorice Launcher is GONE: an anti-air-only building is a dead
   card, so the Gumball Turret inherited the sky and became the generalist. */
const BLD = {
  /* Small footprint (r 18, not 26) so you can wedge turrets into gaps a
     mortar will never fit. Cheap, hits ANYTHING — air, ground, heroes,
     buildings, towers — but it is made of tissue paper: 340 HP against a
     120-damage mortar shell means THREE hits and it is confetti. */
  turret:   { label: 'Gumball Turret',   emoji: '🍬', cost: 55,  hp: 340, range: 180, dmg: 9,  cd: 7,
              r: 18, hitsAir: true, hitsStructures: true,
              desc: 'Squeeze-in popgun — hits air, ground, heroes & buildings. Very fragile.' },
  /* SIEGE ONLY. It cannot touch a creep or a hero any more — no more
     mortar spam mowing the lane. What it can do is out-range a lane tower
     (340 vs 195) and pound structures from where they cannot answer. */
  mortar:   { label: 'Marshmallow Mortar', emoji: '💣', cost: 120, hp: 700, range: 340, minRange: 130,
              dmg: 120, cd: 30, r: 28, siege: true,
              desc: 'SIEGE only — shells towers, walls & bases. Ignores creeps and heroes.' },
  /* Honey is now a force multiplier, not a speed bump: a wide field that
     slows AND leaves everything in it GLAZED, taking +35% damage from
     every source. Park one behind your line and your whole team hits harder. */
  syrup:    { label: 'Honey Glazer',     emoji: '🍯', cost: 70,  hp: 620, range: 235, cd: 5,
              r: 22, slow: 0.55, glaze: 30,
              desc: 'Slows everything nearby AND glazes it — glazed foes take +35% damage' },
  /* A creep pump with a fuse. Seven waves of five, one wave every 7 s, and
     they MARCH — they do not loiter at home. Then it is spent: sell it. */
  /* Two per hero, tops, with a 30 s wait between builds — the barracks-spam
     meta was drowning the board. Level it up AFTER it runs dry to reload all
     seven waves with tougher gummies. */
  barracks: { label: 'Gummy Barracks',   emoji: '🏕️', cost: 150, hp: 1100, r: 30,
              squad: 5, waveCd: 100, waves: 7, maxOwn: 2, buildCd: 300,
              desc: 'Sends 5 gummies down the lane every 10s, 7 waves. Upgrade when empty to reload!' },
  /* The Great Wall of Gumdrop. See the WALL block below. */
  wall:     { label: 'Gumdrop Wall',     emoji: '🧱', cost: 90,  hp: 0, r: 20,
              desc: 'Barricade — blocks ground troops AND tower fire. Upgrade to snake it longer.' },
  /* not buildable: the temporary chew-toy the Shaman and Greta conjure */
  decoy:    { label: 'Candy Decoy',      emoji: '🍡', cost: 0,   hp: 1200, r: 30, lure: 320, temp: 300,
              desc: 'Decoy — enemies rush to chew on it' },
};
const BTYPE = ['turret', 'decoy', 'mortar', 'syrup', 'barracks', 'wall'];
const BUILDABLE = ['turret', 'mortar', 'syrup', 'barracks', 'wall'];
const MAX_BLD = 7;                 // seven structures per hero — walls count as ONE
const GLAZE_MUL = 1.35;            // a honey-glazed target takes 35% more from EVERYTHING
/* per-level boosts when the OWNER upgrades a tower (levels 1..5) */
const BUP = { dmgMul: 1.3, hpMul: 1.25, rangeMul: 1.07, max: 5 };
const bupCost = (lvl) => 70 + 70 * lvl;
const SELL_BACK = 0.25;            // a quarter back, upgrades included

/* ---------------- the Gumdrop Wall ----------------
   A wall is ONE building made of many bricks. It starts as a stub, and
   every upgrade snakes two more bricks off the far tip, bending toward
   wherever the owner is standing — walk the line you want and it follows.

   Rules of the wall:
     · ground troops of BOTH sides are stopped cold; fliers sail over
     · lane towers and turrets cannot SHOOT THROUGH it — line of sight is
       genuinely blocked, which is what makes tower fights worth staging
     · only creeps, heroes, barracks gummies and siege mortars can break it
     · a RANGED hero may climb it — but only from their own side, and they
       can never step down onto the far side. Archers on the parapet. */
const WALL = {
  seg: 78,                         // brick length
  half: 39,
  thick: 26,                       // narrow, so it snakes through tight ground
  hp: 900,                         // per brick
  startSegs: 2,                    // level 1 is a short stub
  perLvl: 2,                       // +2 bricks per upgrade → 10 at level 5
  lure: 210,                       // creeps that bump it decide to chew it
};

/* gummy fighters trained by barracks — no longer chihuahuas */
const GUMMY = { hp: 190, dmg: 18, cd: 9, range: 26, spd: 2.2, aggro: 200, r: 12 };

/* the enemy bestiary — cost is its share of a wave's budget */
/* the shared creep classes — BOTH armies draw from this same stat sheet,
   so neither side's waves ever have an edge. Only the costumes differ. */
const CLASSES = {
  grunt:  { hp: 60,  dmg: 8,  spd: 1.6, range: 26, aggro: 155, coin: 4,  xp: 8,  r: 12, unlockMin: 0 },
  runner: { hp: 36,  dmg: 6,  spd: 2.7, range: 24, aggro: 120, coin: 3,  xp: 6,  r: 10, unlockMin: 0.8 },
  flyer:  { hp: 50,  dmg: 7,  spd: 2.3, range: 26, aggro: 155, coin: 5,  xp: 10, r: 11, unlockMin: 2, air: true },
  sapper: { hp: 95,  dmg: 24, spd: 1.8, range: 28, aggro: 300, coin: 6,  xp: 12, r: 12, unlockMin: 3.5, bldOnly: true },
  tank:   { hp: 320, dmg: 20, spd: 1.2, range: 30, aggro: 135, coin: 12, xp: 25, r: 17, unlockMin: 5.5 },
};
const HERO_CLASSES = {
  hknight: { hp: 950,  dmg: 42, spd: 2.2, range: 44,  aggro: 220, coin: 60, xp: 130, r: 16, hero: true, tough: 0.75 },
  harcher: { hp: 560,  dmg: 34, spd: 2.3, range: 240, aggro: 260, coin: 60, xp: 130, r: 14, hero: true },
  hboss:   { hp: 2300, dmg: 62, spd: 1.6, range: 44,  aggro: 220, coin: 90, xp: 160, r: 20, hero: true, boss: true },
};
/* ONE lane's column, five strong. Both bases march the identical column
   down all three lanes, so neither side ever has the better wave. */
function makeComp(mins) {
  const open = Object.keys(CLASSES).filter((c) => CLASSES[c].unlockMin <= mins);
  const wish = ['grunt', 'grunt', 'runner', 'flyer', 'tank'];
  return wish.slice(0, LANE_SIZE).map((c) => (open.includes(c) ? c : open[0]));
}

const ETYPES = {
  chomper:  { label: 'Choco Chomper', cls: 'grunt' },
  sprinter: { label: 'Sour Sprinter', cls: 'runner' },
  wasp:     { label: 'Wafer Wasp',    cls: 'flyer' },
  sapper:   { label: 'Jelly Sapper',  cls: 'sapper' },
  golem:    { label: 'Gumdrop Golem', cls: 'tank' },
  imp:      { label: 'Candy Imp', trained: true, ...GUMMY, coin: 5, xp: 9 },
  eknight:  { label: 'Sour Sergeant',       cls: 'hknight' },
  earcher:  { label: 'Licorice Sniper',     cls: 'harcher' },
  boss:     { label: 'Rock Candy Colossus', cls: 'hboss' },
};
/* the gummy army wears the same stats in sweeter costumes */
const ATYPES = {
  gummy:   { label: 'Gummy Bear', trained: true, ...GUMMY, coin: 5, xp: 9 },
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
const TEAM_NAME = ['Gummi Kingdom', 'Rock Candy Horde'];
const TEAM_EMOJI = ['🍬', '👹'];

/* AI teammates/opponents — real players with a robot brain: they level,
   shop, build, cast, retreat, and respawn under exactly the same rules */
/* twelve of each: a 6v6 with a single human at the table needs eleven robots,
   and two teammates called Robo Rollo helps nobody */
const BOT_NAMES = ['Robo Rollo', 'Auto Aggie', 'Circuit Cindy', 'Gear-o Greg', 'Beep-Beep Bonnie', 'Sprocket Sam',
                   'Motor Mabel', 'Widget Wally', 'Servo Sadie', 'Bolt Barney', 'Piston Pia', 'Clanky Cliff'];
const BOT_COLORS = ['#9aa5b1', '#b58fd6', '#7fc8a9', '#e0a76f', '#d98fb0', '#8fb7e0',
                    '#c9c46a', '#a08fe0', '#6fbfc9', '#d0846f', '#8fd67f', '#c98fa0'];
const TEAM_SIZE_MAX = 6;           // 6v6 is the ceiling
const TEAM_SIZE_DEFAULT = 3;

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
/* Flat 30 s, first minute to last. The old curve crept toward a minute-plus
   late on, which is an eternity when you are seven and want to play. */
const RESPAWN_T = () => 300;

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
  /* the outer roads used to bend to +/-980 and, with up to 180 px of sway on
     top, could graze the world boundary itself — a hard wall units scrape
     along. Pulled in to 930 so even a fully swayed lane keeps ~95 px of air
     between it and the edge of the map. */
  const ctrls = [
    [H, { x: 300, y: -930 }, { x: 1780, y: -845 }, { x: 1800, y: 120 }, C],     // high road
    [H, C],                                                                      // mid road
    [H, { x: -1800, y: -120 }, { x: -1780, y: 845 }, { x: -300, y: 930 }, C],   // low road
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

  /* --- neutral soda springs: 2 seeded spots, mirrored through the center
     so neither army gets a closer drink --- */
  const springs = [];
  for (const [gap, laneGap, campGap] of [[700, 230, 380], [480, 210, 320], [340, 190, 260]]) {
    for (let tries = 0; tries < 400 && springs.length < N_SPRINGS; tries++) {
      const x = (rnd() * 2 - 1) * (WORLD_W - 500), y = (rnd() * 2 - 1) * (WORLD_H - 400);
      const okAt = (px, py) =>
        paths.every((pp) => distToPath(pp, px, py) > laneGap) &&
        dist(px, py, C.x, C.y) > 750 && dist(px, py, H.x, H.y) > 750 &&
        camps.every((c) => dist(px, py, c.x, c.y) > campGap) &&
        etowers.every((t) => dist(px, py, t.x, t.y) > 320) &&
        ptowers.every((t) => dist(px, py, t.x, t.y) > 320) &&
        springs.every((sp) => dist(px, py, sp.x, sp.y) > gap);
      if (okAt(x, y) && okAt(-x, -y)) {
        springs.push({ x: Math.round(x), y: Math.round(y) });
        springs.push({ x: Math.round(-x), y: Math.round(-y) });
      }
    }
    if (springs.length >= N_SPRINGS) break;
  }

  /* --- elevation ridges + tree thickets that block off-lane travel --- */
  const cellOk = (x, y) =>
    Math.abs(x) < WORLD_W - 80 && Math.abs(y) < WORLD_H - 80 &&
    paths.every((pp) => distToPath(pp, x, y) > 118) &&
    dist(x, y, C.x, C.y) > 420 && dist(x, y, H.x, H.y) > 420 &&
    camps.every((c) => dist(x, y, c.x, c.y) > 230) &&
    etowers.every((t) => dist(x, y, t.x, t.y) > 160) &&
    ptowers.every((t) => dist(x, y, t.x, t.y) > 160) &&
    springs.every((sp) => dist(x, y, sp.x, sp.y) > 230);
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

  /* --- LANES ARE SACRED ---
     Two things were nibbling at the roads. The rim tree-wall claims the
     outermost rows outright without consulting cellOk, so where the high
     road swings up near the top of the world it ran straight into it and a
     column of creeps would jam. And cellOk only ever measured a cell's
     CENTRE — a 100 px cell whose middle sits 118 px off the lane still
     reaches to within 47 px of it, so thickets were poking into every road
     on the map.

     Fix both at once, and measure the CORNERS: any obstacle cell with any
     part of itself inside LANE_CLEAR of a lane comes out, rim wall included.
     That guarantees a genuinely walkable corridor of LANE_CLEAR either side
     of every centre line, on every seed. It notches the rim where a lane
     hugs it — exactly where units were always going to walk anyway. */
  const LANE_CLEAR = 88;
  const HALF = WALK_CELL / 2;
  const REACH = LANE_CLEAR + Math.hypot(HALF, HALF) + 2;   /* cell can't matter beyond this */
  const nearLane = (o) => {
    /* cheap reject first: one measurement rules out almost every cell */
    if (!paths.some((pp) => distToPath(pp, o.x, o.y) <= REACH)) return false;
    /* then walk the cell on a fine grid, so no corner or edge sneaks in */
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
      const px = o.x + (a / 3) * HALF, py = o.y + (b / 3) * HALF;
      if (paths.some((pp) => distToPath(pp, px, py) <= LANE_CLEAR)) return true;
    }
    return false;
  };
  for (let k = obstacles.length - 1; k >= 0; k--) if (nearLane(obstacles[k])) obstacles.splice(k, 1);

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
  return { paths, props, obstacles, block, camps, etowers, ptowers, springs,
           w: WORLD_W, h: WORLD_H, castle: { x: C.x, y: C.y, r: CASTLE.r }, horde: { ...HORDE } };
}

/* can a unit stand here? bounds + the obstacle grid */
function walkable(world, x, y) {
  if (Math.abs(x) > WORLD_W || Math.abs(y) > WORLD_H) return false;
  const i = clamp(Math.floor((x + WORLD_W) / WALK_CELL), 0, WALK_COLS - 1);
  const j = clamp(Math.floor((y + WORLD_H) / WALK_CELL), 0, WALK_ROWS - 1);
  return !world.block[j * WALK_COLS + i];
}
/* ================= wall geometry =================
   A brick is an oriented box: centre (x,y), running along angle a, WALL.seg
   long and WALL.thick wide. Everything the wall does — blocking feet,
   blocking bullets, taking hits — comes out of these four helpers. */

/* a brick is symmetric under a half turn, so π and −π describe the same slab.
   Snap a heading to whichever of the two sits closest to its neighbour, and
   the battlements all face the same way down the run. */
function alignAngle(a, ref) {
  let d = a - ref;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) > Math.PI / 2 ? a + Math.PI : a;
}

/* signed "which side of the wall are you on" — the sign is all that matters */
function wallSide(seg, x, y) {
  const dx = x - seg.x, dy = y - seg.y;
  return -dx * Math.sin(seg.a) + dy * Math.cos(seg.a) >= 0 ? 1 : -1;
}
/* is (x,y) inside this brick, grown by pad? */
function segHit(seg, x, y, pad = 0) {
  const dx = x - seg.x, dy = y - seg.y;
  const c = Math.cos(seg.a), s = Math.sin(seg.a);
  const along = dx * c + dy * s, across = -dx * s + dy * c;
  return Math.abs(along) <= WALL.half + pad && Math.abs(across) <= WALL.thick / 2 + pad;
}
/* the first brick covering this point, or null. Cheap: most ticks find nothing */
function wallAt(sim, x, y, pad = 0) {
  for (const w of sim.blds) {
    if (w.type !== 'wall' || !w.segs) continue;
    for (const seg of w.segs) if (segHit(seg, x, y, pad)) return { wall: w, seg };
  }
  return null;
}
/* nearest brick of a wall to a point — creeps walk to the bit in front of them
   rather than trudging to the centroid of a wall that snakes for 800 px */
function nearestSeg(w, x, y) {
  let best = w.segs[0], bd = Infinity;
  for (const seg of w.segs) {
    const d = dist(seg.x, seg.y, x, y);
    if (d < bd) { bd = d; best = seg; }
  }
  return best;
}
/* does a wall stand between these two points? sampled along the ray —
   the rays here are short (a tower's reach), so this stays cheap */
function wallBlocksLine(sim, x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return false;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, reach = len / 2 + WALL.half + 8;
  const steps = Math.min(28, Math.ceil(len / 16));
  for (const w of sim.blds) {
    if (w.type !== 'wall' || !w.segs) continue;
    for (const seg of w.segs) {
      if (dist(seg.x, seg.y, mx, my) > reach) continue;      /* nowhere near the ray */
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        if (segHit(seg, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0)) return true;
      }
    }
  }
  return false;
}

/* the first brick covering this point that would BLOCK a unit of `team`.
   Your own ramparts are not obstacles to you — your side files straight
   through its own gates, while the enemy has to knock them down first. */
function foeWallAt(sim, team, x, y, pad = 0) {
  for (const w of sim.blds) {
    if (w.type !== 'wall' || !w.segs || w.team === team) continue;
    for (const seg of w.segs) if (segHit(seg, x, y, pad)) return { wall: w, seg };
  }
  return null;
}

/* the same ray test, but only counting walls that would actually stop this
   team — used for pathing questions, NOT for tower sight lines (a tower is
   blinded by any wall, including its own, which is the trade-off of raising
   one in front of your own guns) */
function foeWallBlocks(sim, team, x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return false;
  const steps = Math.min(28, Math.ceil(len / 16));
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    if (foeWallAt(sim, team, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0)) return true;
  }
  return false;
}

/* Can this MOVER occupy (x,y)?
   A wall is solid only to the side that did NOT build it. Your own troops
   and heroes pass through your own wall as if it were a gate — it is there
   to stop THEM, not you. An enemy rampart stops ground troops dead, and the
   only way through is to break it.
   A ranged hero is the exception: they may climb an enemy wall from the side
   their own base is on and shoot over the top, but never step down behind it. */
function wallPasses(sim, u, x, y, pad) {
  const hit = foeWallAt(sim, u.team, x, y, pad);
  const onNow = u.__onWall || null;          /* an enemy brick we are perched on */
  if (!hit) {
    /* stepping OFF a brick: only ever back down the friendly side */
    if (onNow) {
      const home = baseOf(u.team);
      return wallSide(onNow, x, y) === wallSide(onNow, home.x, home.y);
    }
    return true;
  }
  if (!u.__climber) {
    /* An enemy wall raised on top of somebody must not entomb them. If they
       are ALREADY inside a brick, every step is legal until they are clear. */
    return !!foeWallAt(sim, u.team, u.x, u.y, 0);
  }
  if (onNow) return true;                            /* already up there — walk the top */
  /* mount only from the side your own keep is on: you may scale the enemy's
     rampart and shoot over it, but the far side stays out of reach, which is
     the whole point of them having built it */
  const home = baseOf(u.team);
  return wallSide(hit.seg, u.x, u.y) === wallSide(hit.seg, home.x, home.y);
}

/* move with wall-sliding so units skirt trees, buildings and walls
   instead of sticking to them */
function slideMove(sim, u, nx, ny, pad = 10) {
  const ok = (x, y) => walkable(sim.world, x, y) && wallPasses(sim, u, x, y, pad);
  if (ok(nx, ny)) { u.x = nx; u.y = ny; return; }
  if (ok(nx, u.y)) { u.x = nx; return; }
  if (ok(u.x, ny)) { u.y = ny; }
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

/* fog is optional so headless tests can probe pure geometry.
   `type` matters: a WALL is meant to be dragged across open ground and even
   across a lane — that is the entire point of it — so it skips the lane
   stand-off that keeps gun towers from squatting on the road. It still may
   not sit on a tree, a mountain, a camp, a spring or another building.
   `walls` is the list of wall bricks already on the field. */
function canPlace(world, blds, x, y, fog, type = 'turret', walls = null) {
  const isWall = type === 'wall';
  if (Math.abs(x) > WORLD_W * 0.95 || Math.abs(y) > WORLD_H * 0.95) return false;
  if (fog && !fog[fogIdx(x, y)]) return false;
  if (dist(x, y, CASTLE.x, CASTLE.y) < CASTLE.r + 75) return false;
  if (dist(x, y, HORDE.x, HORDE.y) < HORDE.r + 130) return false;
  if (!walkable(world, x, y)) return false;                  /* trees & rock ridges */
  for (const c of world.camps) if (dist(x, y, c.x, c.y) < 180) return false;
  for (const sp of world.springs) if (dist(x, y, sp.x, sp.y) < 210) return false;
  for (const t of world.etowers) if (dist(x, y, t.x, t.y) < 170) return false;
  for (const t of world.ptowers) if (dist(x, y, t.x, t.y) < 170) return false;
  if (!isWall) for (const p of world.paths) if (distToPath(p, x, y) < 48) return false;
  const clear = isWall ? 46 : 62;
  for (const b of blds) {
    const bx = b.x !== undefined ? b.x : b[3], by = b.y !== undefined ? b.y : b[4];
    const bt = b.type !== undefined ? b.type : BTYPE[b[2]];
    if (bt === 'wall') continue;                             /* bricks checked below */
    if (dist(x, y, bx, by) < clear) return false;
  }
  /* never lay a brick on top of an existing one */
  if (walls) for (const seg of walls) if (segHit(seg, x, y, isWall ? 8 : 24)) return false;
  return true;
}
/* Plan a wall stub: where the bricks would go, or null if they don't fit.
   The SAME function runs on the host (to build) and on the phone (to colour
   the ghost), so what you see green is exactly what will be accepted. The
   axis is ACROSS the line from the hero to the aim point — the player picks
   the direction — with home-facing as the fallback for a zero-length aim,
   and at most a 20-degree nudge either way to clear an obstruction. */
function planWallStub(world, blds, fog, heroX, heroY, x, y, homeX, homeY, walls) {
  const aimed = dist(heroX, heroY, x, y) > 20;
  const facing = aimed ? Math.atan2(y - heroY, x - heroX)
                       : Math.atan2(y - homeY, x - homeX);
  for (const off of [0, 0.35, -0.35]) {
    const a = facing + Math.PI / 2 + off;
    const trial = [];
    for (let k = 0; k < WALL.startSegs; k++) {
      const t = k - (WALL.startSegs - 1) / 2;
      const bx = x + Math.cos(a) * WALL.seg * t, by = y + Math.sin(a) * WALL.seg * t;
      let ok = true;
      for (const q of [-1, 0, 1]) {          /* both ends and the middle of the brick */
        const px = bx + Math.cos(a) * WALL.half * q * 0.92;
        const py = by + Math.sin(a) * WALL.half * q * 0.92;
        if (!canPlace(world, blds, px, py, fog, 'wall', walls)) { ok = false; break; }
      }
      if (!ok) { trial.length = 0; break; }
      trial.push({ x: Math.round(bx), y: Math.round(by), a });
    }
    if (trial.length === WALL.startSegs) return trial;
  }
  return null;
}

/* flatten every wall on the field into one brick list — the shape both the
   host sim and the phone's placement ghost want */
const allSegs = (blds) => {
  const out = [];
  for (const b of blds) if (b.type === 'wall' && b.segs) out.push(...b.segs);
  return out;
};

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
    tick: 0, phase: 'pick', pickLeft: PICK_FAILSAFE, teamSize: TEAM_SIZE_DEFAULT,
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
  for (const t of sim.world.etowers) sim.etowers.push({ id: sim.nextId++, ...t, ring: t.lane === -1, hp: ETOWER.hp, maxhp: ETOWER.hp, cd: 0 });
  for (const t of sim.world.ptowers) sim.ptowers.push({ id: sim.nextId++, ...t, ring: t.lane === -1, hp: ETOWER.hp, maxhp: ETOWER.hp, cd: 0 });
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
    slow: 0, slowT: 0, frenzy: 0, haste: 0, glaze: 0,
    focus: null, lastDir: null, onWall: 0,
  };
  sim.players.set(playerId, p);
  sim.order.push(playerId);
  return p;
}

function heroDef(p) { return HEROES[HERO_IDX.indexOf(p.hero)]; }
const powMul = (p) => (1 + HUP.pow.mul * p.up.pow) * (1 + LVL_POW * (p.lvl - 1));
const dmgOf = (p) => Math.round(heroDef(p).dmg * (1 + HUP.dmg.mul * p.up.dmg) * (1 + LVL_DMG * (p.lvl - 1)));
const maxhpOf = (p) => Math.round(heroDef(p).hp * (1 + HUP.hp.mul * p.up.hp) * (1 + LVL_HP * (p.lvl - 1)));
const speedOf = (p) => heroDef(p).speed * HERO_SPEED * (1 + HUP.spd.mul * p.up.spd);

/* XP: killer earns it all; TEAMMATES fighting nearby learn almost as much */
function addXp(sim, playerId, amount, x, y) {
  if (!Number.isFinite(amount)) return;
  const killer = sim.players.get(playerId);
  const give = (p, amt) => {
    p.xp += amt;
    while (p.lvl < LVL_MAX && p.xp >= XP_LVL[p.lvl - 1]) {
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

function addBot(sim, team) {
  const n = sim.botN = (sim.botN || 0);
  const p = addPlayer(sim, 'bot-' + (n + 1));
  sim.botN++;
  p.bot = true;
  p.botName = BOT_NAMES[n % BOT_NAMES.length];
  p.botColor = BOT_COLORS[n % BOT_COLORS.length];
  const roster = heroesOfTeam(team === 1 ? 1 : 0);
  pickHero(sim, p.id, roster[n % roster.length].id, team);
  return p;
}

/* Robots fill every empty chair up to the size the HOST asked for — 1v1 all
   the way to 6v6. Sides always come out even, and nobody is ever turned away:
   if more humans crowded onto one side than the chosen size, the other side
   is topped up to match them instead. */
function balanceTeams(sim) {
  const count = [0, 0];
  for (const p of sim.players.values()) if (p.hero) count[p.team]++;
  const want = clamp(Math.max(sim.teamSize || TEAM_SIZE_DEFAULT, count[0], count[1]), 1, TEAM_SIZE_MAX);
  for (const t of [0, 1]) while (count[t] < want) { addBot(sim, t); count[t]++; }
}
/* how many robots a given size would need right now — for the host's readout */
function botsNeeded(sim, size) {
  const count = [0, 0];
  for (const p of sim.players.values()) if (p.hero && !p.bot) count[p.team]++;
  const want = clamp(Math.max(size, count[0], count[1]), 1, TEAM_SIZE_MAX);
  return (want - count[0]) + (want - count[1]);
}

function startPlay(sim) {
  if (sim.phase === 'play') return;
  sim.phase = 'play';
  balanceTeams(sim);
  sim.spawnT = 30;
  addFx(sim, 'horn', HORDE.x, HORDE.y);
}

/* ---------------- creep factories: identical groups for both armies ---------------- */

const minutesOf = (sim) => sim.tick / 600;
const warMult = (sim) => 1 + TIME_SCALE * minutesOf(sim);

/* Where a lane's column forms up. Walk out along the lane from the keep
   until we are clear of its wall, and muster THERE — never on the keep
   itself. This is what stopped waves from being sliced in half by their own
   base: half the column used to appear INSIDE the collision radius and get
   squeezed out the back door one creep at a time. */
function laneMuster(world, pathIdx, team) {
  const path = world.paths[pathIdx];
  const base = baseOf(team);
  const step = team === 1 ? 1 : -1;
  const need = base.r + SPAWN_CLEAR;
  const start = team === 1 ? 0 : path.length - 1;
  /* walk outward along the lane until we clear the keep wall */
  let i = start;
  for (let k = 0; k < path.length; k++) {
    const j = start + step * k;
    if (j < 0 || j > path.length - 1) break;
    i = j;
    if (dist(path[j].x, path[j].y, base.x, base.y) >= need) break;
  }
  const at = path[clamp(i, 0, path.length - 1)];
  const nxt = path[clamp(i + step, 0, path.length - 1)];
  let ax = nxt.x - at.x, ay = nxt.y - at.y;
  if (!ax && !ay) { ax = at.x - base.x; ay = at.y - base.y; }   /* end of the line */
  const m = Math.hypot(ax, ay) || 1;
  ax /= m; ay /= m;                                    /* unit vector down the lane */
  return { x: at.x, y: at.y, ax, ay, wp: clamp(i + step, 0, path.length - 1) };
}

function spawnCreep(sim, team, type, pathIdx, mult, slot = 0) {
  const def = creepDef(team, type);
  const mus = laneMuster(sim.world, pathIdx, team);
  /* a wedge, two abreast, marching away from home — no overlap at birth */
  const file = ((slot % 2) ? 1 : -1) * (SPAWN_FILE * (0.5 + Math.floor(slot / 2) * 0.8));
  const rank = slot * 16;
  const u = {
    id: sim.nextId++, team, type, path: pathIdx,
    wp: mus.wp,
    x: mus.x + mus.ax * rank - mus.ay * file,
    y: mus.y + mus.ay * rank + mus.ax * file,
    hp: Math.round(def.hp * mult), maxhp: Math.round(def.hp * mult),
    dmg: Math.round(def.dmg * (1 + (mult - 1) * 0.7)),
    role: 'lane', tgt: null, cd: 0, slow: 0, slowT: 0, stun: 0, taunt: null, glaze: 0,
  };
  creepsOf(sim, team).push(u);
  return u;
}

/* every lane gets its own five-strong column, on both sides, every 6 s —
   unless that lane is already jammed, in which case it sits this one out */
function spawnGroups(sim) {
  const comp = makeComp(minutesOf(sim));      // ONE comp, marched by BOTH sides
  const mult = warMult(sim);
  let sent = [false, false];
  for (let lane = 0; lane < N_PATHS; lane++) {
    for (const team of [0, 1]) {
      const alive = creepsOf(sim, team).filter((u) => u.path === lane && u.role === 'lane').length;
      if (alive >= LANE_CAP) continue;        /* jammed — hold this column back */
      const skin = team === 1 ? E_SKIN : A_SKIN;
      comp.forEach((cls, i) => spawnCreep(sim, team, skin[cls], lane, mult, i));
      sent[team] = true;
    }
  }
  if (sent[1]) addFx(sim, 'spawn', HORDE.x, HORDE.y);
  if (sent[0]) addFx(sim, 'spawn', CASTLE.x, CASTLE.y);
}

/* ---------------- building (any time, either team) ---------------- */

/* structures a player owns, walls counted as ONE no matter how long */
const myBuildings = (sim, playerId) =>
  sim.blds.filter((b) => b.owner === playerId && b.type !== 'decoy' && !b.until);

/* every coin a building has swallowed, upgrades included — the number the
   quarter-refund is taken from */
function bldPaid(sim, b) {
  const p = sim.players.get(b.owner);
  let paid = Math.round(BLD[b.type].cost * ((p && heroDef(p) && heroDef(p).discount) || 1));
  for (let l = 1; l < b.lvl; l++) paid += bupCost(l);
  return paid;
}

/* Lay a brick if the ground will take it. Returns the brick or null.
   `skip` is the handful of bricks it is allowed to touch — the tip it grows
   out of, or the siblings laid moments ago in the same stub. */
function tryBrick(sim, x, y, a, skip = []) {
  const others = allSegs(sim.blds).filter((s) => !skip.includes(s));
  /* both ends AND the middle must be clear ground */
  for (const t of [-1, 0, 1]) {
    const px = x + Math.cos(a) * WALL.half * t * 0.92;
    const py = y + Math.sin(a) * WALL.half * t * 0.92;
    if (!canPlace(sim.world, sim.blds, px, py, sim.fog, 'wall', others)) return null;
  }
  return { x: Math.round(x), y: Math.round(y), a };
}

/* Extend the wall in a STRAIGHT line — a blockade, not a spiral. Each new
   brick continues the wall's own axis, full stop: the bend-toward-the-owner
   steering is gone, because it turned every long wall into a curl. The
   player picks WHICH end grows by standing near it (the other end is the
   fallback if that one has hit a tree or the edge of the board), and the
   direction was decided once, when the stub was laid. If the line is
   blocked, the upgrade refuses and charges nothing — it never veers. */
function growWall(sim, w, toward, n) {
  let added = 0;
  for (let k = 0; k < n; k++) {
    /* both ends, the one the hero stands nearest first */
    const ends = [];
    ends.push({ tip: w.segs[w.segs.length - 1], prev: w.segs[w.segs.length - 2] || null, head: false });
    if (w.segs.length > 1) ends.push({ tip: w.segs[0], prev: w.segs[1] || null, head: true });
    if (toward && ends.length > 1) {
      ends.sort((a, b) => dist(a.tip.x, a.tip.y, toward.x, toward.y)
                        - dist(b.tip.x, b.tip.y, toward.x, toward.y));
    }
    let placed = null, atHead = false;
    for (const e of ends) {
      /* dead straight: continue the line this end is already on */
      const run = e.prev ? Math.atan2(e.tip.y - e.prev.y, e.tip.x - e.prev.x) : e.tip.a;
      const seg = tryBrick(sim, e.tip.x + Math.cos(run) * WALL.seg,
                                e.tip.y + Math.sin(run) * WALL.seg, run, [e.tip]);
      if (seg) { placed = seg; atHead = e.head; break; }
    }
    if (!placed) break;                       /* the line is blocked at both ends */
    if (atHead) {
      placed.a = alignAngle(placed.a, w.segs[0].a);
      w.segs.unshift(placed);
    } else {
      placed.a = alignAngle(placed.a, w.segs[w.segs.length - 1].a);
      w.segs.push(placed);
    }
    added++;
  }
  if (added) {
    const gain = added * WALL.hp;
    w.maxhp += gain; w.hp += gain;
    /* the card in the list points at the middle of the run */
    w.x = Math.round(w.segs.reduce((s, q) => s + q.x, 0) / w.segs.length);
    w.y = Math.round(w.segs.reduce((s, q) => s + q.y, 0) / w.segs.length);
  }
  return added;
}

function build(sim, playerId, type, x, y) {
  const p = sim.players.get(playerId);
  if (!p || !p.hero || !BUILDABLE.includes(type)) return 'nope';
  const def = BLD[type];
  if (p.dead) return 'dead';                       /* ghosts don't lay bricks */
  if (myBuildings(sim, playerId).length >= MAX_BLD) return 'full';
  if (type === 'barracks') {
    const own = myBuildings(sim, playerId).filter((b) => b.type === 'barracks').length;
    if (own >= BLD.barracks.maxOwn) return 'bmax';
    if (p.barracksAt !== undefined && sim.tick - p.barracksAt < BLD.barracks.buildCd) return 'bcool';
  }
  const cost = Math.round(def.cost * (heroDef(p).discount || 1));
  if (p.coins < cost) return 'coins';
  if (dist(p.x, p.y, x, y) > BUILD_R) return 'far';
  if (!sim.fog[fogIdx(x, y)]) return 'fog';

  if (type === 'wall') {
    /* YOU aim the wall. It is laid ACROSS the line from your hero to the
       spot you tapped, and every later upgrade extends that axis dead
       straight — the direction you choose here is the direction of the
       whole finished blockade. The planner is shared with the phone's
       ghost, so a green preview is a promise. */
    const home = baseOf(p.team);
    const segs = planWallStub(sim.world, sim.blds, sim.fog, p.x, p.y, x, y,
                              home.x, home.y, allSegs(sim.blds));
    if (!segs) return 'spot';
    p.coins -= cost;
    const hp = WALL.startSegs * WALL.hp;
    const b = { id: sim.nextId++, owner: playerId, team: p.team, type, lvl: 1,
                x: Math.round(segs.reduce((s, q) => s + q.x, 0) / segs.length),
                y: Math.round(segs.reduce((s, q) => s + q.y, 0) / segs.length),
                hp, maxhp: hp, cd: 0, boost: 0, segs };
    sim.blds.push(b);
    sim.stats.built++;
    addFx(sim, 'built', b.x, b.y);
    return 'ok';
  }

  if (!canPlace(sim.world, sim.blds, x, y, sim.fog, type, allSegs(sim.blds))) return 'spot';
  p.coins -= cost;
  const b = { id: sim.nextId++, owner: playerId, team: p.team, type, x: Math.round(x), y: Math.round(y),
              lvl: 1, hp: def.hp, maxhp: def.hp, cd: 10, boost: 0, waveCd: 12, wavesLeft: def.waves || 0 };
  if (type === 'barracks') p.barracksAt = sim.tick;
  sim.blds.push(b);
  sim.stats.built++;
  addFx(sim, 'built', b.x, b.y);
  return 'ok';
}

/* One barracks wave: five gummies that MARCH. They are not guard dogs any
   more — they pick the nearest lane and push it like any other creep, which
   is what finally makes the barracks worth 150 coins. */
function spawnGummySquad(sim, b) {
  const type = b.team === 1 ? 'imp' : 'gummy';          /* each side trains its own */
  const def = creepDef(b.team, type);
  const scale = 1 + 0.25 * (b.lvl - 1);
  /* which lane is this barracks nearest? that's the one they'll push */
  let lane = 0, ld = Infinity;
  for (let i = 0; i < N_PATHS; i++) {
    const d = distToPath(sim.world.paths[i], b.x, b.y);
    if (d < ld) { ld = d; lane = i; }
  }
  const path = sim.world.paths[lane];
  let wp = 0, wd = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = dist(path[i].x, path[i].y, b.x, b.y);
    if (d < wd) { wd = d; wp = i; }
  }
  const hp = Math.round(def.hp * scale);
  for (let i = 0; i < (BLD.barracks.squad); i++) {
    const a = (i / BLD.barracks.squad) * Math.PI * 2;
    creepsOf(sim, b.team).push({
      id: sim.nextId++, team: b.team, role: 'lane', type, from: b.id, owner: b.owner,
      path: lane, wp: clamp(wp + (b.team === 1 ? 1 : -1), 0, path.length - 1),
      x: b.x + Math.cos(a) * 46, y: b.y + Math.sin(a) * 46,
      hp, maxhp: hp, dmg: Math.round(def.dmg * scale),
      cd: 0, tgt: null, slow: 0, slowT: 0, stun: 0, taunt: null, glaze: 0,
    });
  }
  addFx(sim, 'spawn', b.x, b.y);
}

function upgradeBld(sim, playerId, bldId) {
  const p = sim.players.get(playerId);
  const b = sim.blds.find((q) => q.id === bldId);
  if (!p || !b || b.owner !== playerId || b.type === 'decoy') return 'nope';
  if (b.lvl >= BUP.max) return 'max';
  const cost = bupCost(b.lvl);
  if (p.coins < cost) return 'coins';
  if (b.type === 'barracks') {
    /* an upgrade is a RELOAD: it refills all seven waves with tougher
       gummies, so it only makes sense — and is only allowed — once every
       gummy of the current stock has marched out the door */
    if (b.wavesLeft > 0) return 'busy';
    p.coins -= cost;
    b.lvl++;
    const hpGain = Math.round(b.maxhp * (BUP.hpMul - 1));
    b.maxhp += hpGain; b.hp = b.maxhp;              /* fresh walls with the fresh stock */
    b.wavesLeft = BLD.barracks.waves;
    b.waveCd = 20;                                  /* first new wave in 2 s */
    addFx(sim, 'level', b.x, b.y);
    return 'ok';
  }
  if (b.type === 'wall') {
    /* you have to WALK the wall out — stand near either END to extend it */
    const head = b.segs[0], tail = b.segs[b.segs.length - 1];
    const reach = Math.min(dist(p.x, p.y, head.x, head.y), dist(p.x, p.y, tail.x, tail.y));
    if (reach > BUILD_R) return 'far';
    /* an upgrade that cannot lay its full run of bricks must not take the
       player's coins or burn a level — snapshot, try, roll back if short */
    const snapSegs = b.segs.slice();
    const snapHp = b.hp, snapMax = b.maxhp, snapX = b.x, snapY = b.y;
    const grew = growWall(sim, b, { x: p.x, y: p.y }, WALL.perLvl);
    if (grew < WALL.perLvl) {
      b.segs = snapSegs;                       /* boxed in — put it all back */
      b.hp = snapHp; b.maxhp = snapMax; b.x = snapX; b.y = snapY;
      return 'spot';
    }
    p.coins -= cost;
    b.lvl++;
    addFx(sim, 'level', b.segs[b.segs.length - 1].x, b.segs[b.segs.length - 1].y);
    return 'ok';
  }
  p.coins -= cost;
  b.lvl++;
  const hpGain = Math.round(b.maxhp * (BUP.hpMul - 1));
  b.maxhp += hpGain; b.hp += hpGain;
  addFx(sim, 'level', b.x, b.y);
  return 'ok';
}

function sellBld(sim, playerId, bldId) {
  const p = sim.players.get(playerId);
  const i = sim.blds.findIndex((q) => q.id === bldId);
  if (!p || i < 0 || sim.blds[i].owner !== playerId) return;
  const b = sim.blds[i];
  p.coins += Math.round(bldPaid(sim, b) * SELL_BACK);   /* a quarter back, upgrades included */
  sim.blds.splice(i, 1);
  addFx(sim, 'sold', b.x, b.y);   /* gummies already on the march keep marching */
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
  if ((victim.glaze || 0) > 0) dmg *= GLAZE_MUL;          /* honey-glazed: +35% */
  const d = victim.armor > 0 ? Math.round(dmg * ARMOR_MIT) : Math.round(dmg);
  victim.hp -= d;
  victim.hurtAt = sim.tick;
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
  p.dead = true; p.respawn = RESPAWN_T(); p.dir = { x: 0, y: 0 }; p.moveTo = null;
  p.coins = 0;                                     /* your purse spills in the candy grass */
  p.armor = 0; p.frenzy = 0; p.haste = 0;
  addFx(sim, 'herodown', p.x, p.y);
}

/* A creep of `team` died; pay the OTHER team.
   LAST HITS ARE THE JOB. Land the killing blow and you take double bounty
   and half again the XP; teammates who were merely in the neighbourhood
   collect a token 15%. Farming the lane is now a real skill with a real
   payoff, which is exactly what makes maxing your gear an achievement. */
function awardCreepKill(sim, u, killerOwner) {
  const def = creepDef(u.team, u.type);
  const winners = 1 - u.team;
  const base = def.coin || 0;
  for (const p of sim.players.values()) {
    if (!p.hero || p.team !== winners) continue;
    if (killerOwner && p.id === killerOwner) {
      p.coins += Math.round(base * LASTHIT_COIN);
      p.kills++;
      addFx(sim, 'lasthit', u.x, u.y);
    } else p.coins += Math.round(base * ASSIST_COIN);
  }
  if (killerOwner) addXp(sim, killerOwner, Math.round((def.xp || 0) * LASTHIT_XP), u.x, u.y);
  addFx(sim, 'die', u.x, u.y);
}

function hurtCreep(sim, u, dmg, owner) {
  if (u.hp <= 0) return;
  const glazed = (u.glaze || 0) > 0 ? GLAZE_MUL : 1;      /* honey makes it stick */
  u.hp -= Math.round(dmg * (creepDef(u.team, u.type).tough || 1) * glazed);
  if (u.hp <= 0) awardCreepKill(sim, u, owner);
}
/* legacy names used by abilities/towers below */
const hurtEnemy = (sim, e, dmg, owner) => hurtCreep(sim, e, dmg, owner);

/* One door for every point of damage a BUILDING takes, so the bounty is
   paid the same way no matter who knocked it over. Flattening someone's
   tower is worth real money now — half what they sank into it, plus XP. */
function hurtBld(sim, b, dmg, owner) {
  if (!b || b.hp <= 0) return;
  b.hp -= Math.round(dmg);
  if (b.hp > 0) return;
  b.hp = 0;
  if (!b.until && b.type !== 'decoy') {             /* conjured props pay nothing */
    const worth = bldPaid(sim, b);
    const winners = 1 - b.team;
    for (const p of sim.players.values()) {
      if (!p.hero || p.team !== winners) continue;
      p.coins += p.id === owner ? Math.round(worth * 0.5) : Math.round(worth * 0.1);
    }
    if (owner) addXp(sim, owner, 45 + 35 * b.lvl, b.x, b.y);
  }
  sim.blds = sim.blds.filter((q) => q.id !== b.id);
  addFx(sim, 'crumble', b.x, b.y);
}

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

/* a lane/ring tower of `team` took damage; at zero it DEFECTS to the
   attackers — repainted, half health, and immediately fighting for them */
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
    const from = towersOf(sim, team);
    const i = from.indexOf(tw);
    if (i >= 0) from.splice(i, 1);
    if (tw.ring) {
      addFx(sim, 'crumble', tw.x, tw.y);      /* base guards are rubble — never captured */
      addFx(sim, 'towerdown', tw.x, tw.y);
    } else {
      tw.hp = Math.round(tw.maxhp * CAPTURE_HP);
      tw.cd = 25;
      towersOf(sim, winners).push(tw);        /* lane towers defect at full strength */
      addFx(sim, 'towerdown', tw.x, tw.y);
      addFx(sim, 'built', tw.x, tw.y);
    }
  }
}

/* a base is untouchable while ANY of its ring guards still fly its flag */
function baseShielded(sim, team) {
  return towersOf(sim, team).some((t) => t.ring);
}
const hurtETower = (sim, t, dmg, owner) => hurtTower(sim, t, 1, dmg, owner);

/* the base of `team` took damage; destroying it means the OTHER team wins */
function hurtBase(sim, team, dmg) {
  if (baseShielded(sim, team)) { addFx(sim, 'shield', baseOf(team).x, baseOf(team).y); return; }
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

/* Which way is this hero FACING? Leaps and charges used to read the stick
   only at the instant of the press, so a player who tapped the button a
   heartbeat after letting go of the joystick would jump at whatever happened
   to be nearest — usually backwards. We remember the last real heading. */
/* Which way is this hero FACING? In priority order:
     1. the stick vector sent WITH the button press — the truest answer, and
        immune to a movement packet arriving a frame late
     2. whatever the host last heard from the joystick
     3. the thing you TAPPED — if you marked a tower, charging at it is
        obviously what you meant
     4. the heading you were last running
     5. a walk order, then the nearest foe, then the enemy keep
   Leaps used to read the stick only at the instant of the press, so a player
   who tapped the button a heartbeat after letting go would jump at whatever
   happened to be nearest — usually backwards. */
function facingOf(sim, p, foes, hint) {
  let dx = 0, dy = 0;
  if (hint && (hint.x || hint.y)) { dx = hint.x; dy = hint.y; }
  if (!dx && !dy) { dx = p.dir.x; dy = p.dir.y; }
  if (!dx && !dy) {
    const f = resolveFocus(sim, p);
    if (f) { const at = aimPoint(f.what, p.x, p.y); dx = at.x - p.x; dy = at.y - p.y; }
  }
  if (!dx && !dy && p.lastDir) { dx = p.lastDir.x; dy = p.lastDir.y; }
  if (!dx && !dy && p.moveTo) { dx = p.moveTo.x - p.x; dy = p.moveTo.y - p.y; }
  if (!dx && !dy) {
    let near = null, nd = Infinity;
    for (const q of oppHeroes(sim, p.team)) { const d = dist(q.x, q.y, p.x, p.y); if (d < nd) { nd = d; near = q; } }
    for (const e of foes) { const d = dist(e.x, e.y, p.x, p.y); if (d < nd) { nd = d; near = e; } }
    if (near) { dx = near.x - p.x; dy = near.y - p.y; }
    else { const ob = baseOf(1 - p.team); dx = ob.x - p.x; dy = ob.y - p.y; }
  }
  const m = Math.hypot(dx, dy) || 1;
  return { x: dx / m, y: dy / m };
}

/* ---------------- candy grenades ----------------
   The ranged heroes' answer to Spin Slash: the same burst of area damage,
   thrown to where the fight actually is instead of demanding they wade in.
   Where it lands, in priority order: the thing you TAPPED if it is in throw
   range and the stick is idle; otherwise a full-range lob the way you are
   facing (stick sent with the press → live stick → tapped mark → last
   heading — the same ladder every leap uses). */
const LOB_RANGE = 300;
function lobTarget(sim, p, hint) {
  const stickLive = (hint && (hint.x || hint.y)) || p.dir.x || p.dir.y;
  if (!stickLive) {
    const foc = resolveFocus(sim, p);
    if (foc) {
      const at = aimPoint(foc.what, p.x, p.y);
      if (dist(at.x, at.y, p.x, p.y) <= LOB_RANGE + 40) return { x: at.x, y: at.y };
    }
  }
  const f = facingOf(sim, p, creepsOf(sim, 1 - p.team), hint);
  return { x: clamp(p.x + f.x * LOB_RANGE, -WORLD_W, WORLD_W),
           y: clamp(p.y + f.y * LOB_RANGE, -WORLD_H, WORLD_H) };
}
/* arcs over walls and trees — it is a grenade — and detonates 0.6 s later
   through the same impact system the mage's meteor uses */
function lobGrenade(sim, p, hint, dmg, r, slow, slowT) {
  const at = lobTarget(sim, p, hint);
  addFx(sim, 'shell', p.x, p.y, at.x, at.y);
  sim.impacts.push({ t: sim.tick + 6, kind: 'boom', team: p.team, x: at.x, y: at.y,
                     r, dmg: Math.round(dmg), owner: p.id, air: true, slow, slowT });
  return at;
}

function castAbility(sim, playerId, i, hint) {
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
      /* Shield Charge: close the gap, THEN slam — melee's answer to kiting.
         Charges the way you are RUNNING, never backwards into the lane. */
      const f = facingOf(sim, p, foes, hint);
      addFx(sim, 'shell', p.x, p.y, p.x + f.x * 210, p.y + f.y * 210);
      for (let hop = 210; hop >= 50; hop -= 40) {
        const nx = clamp(p.x + f.x * hop, -WORLD_W, WORLD_W);
        const ny = clamp(p.y + f.y * hop, -WORLD_H, WORLD_H);
        if (walkable(sim.world, nx, ny) && !foeWallAt(sim, p.team, nx, ny, 8)) { p.x = nx; p.y = ny; break; }
      }
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
      /* Cake Quake: the knight's Spin Slash. Slam the ground — everything in
         arm's reach takes a hit and staggers, which doubles as the exit no
         pure buff ever gave him when the game was on the line */
      addFx(sim, 'bash', p.x, p.y, undefined, undefined, 170);
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 170) {
        hurtCreep(sim, e, Math.round(50 * pm), p.id);
        if (!creepDef(e.team, e.type).boss) e.stun = Math.max(e.stun, 18);
      }
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 170) pvpHit(sim, q, 50 * pm, p);
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 170) hurtNeutral(sim, n, Math.round(50 * pm), p.id);
    }
  } else if (p.hero === 'ranger') {
    if (i === 0) {
      /* Berry Bomb: the old barrage burst around HERSELF, which asked a
         ranged hero to stand in melee to use it. Now it is thrown. */
      lobGrenade(sim, p, hint, 55 * pm, 130);
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
      p.haste = Math.max(p.haste || 0, DISENGAGE_T);      /* frost-step out of trouble */
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
      p.frenzy = Math.min(BUFF_MAX_T, Math.round(55 + 25 * (pm - 1)));   /* a rush, not a lifestyle */
      addFx(sim, 'overclock', p.x, p.y, undefined, undefined, 60);
    } else {
      /* Candy Leap: bound the way you are RUNNING — the direction the stick
         was last pushed, not wherever the nearest creep happens to be. */
      const f = facingOf(sim, p, foes, hint);
      addFx(sim, 'shell', p.x, p.y, p.x + f.x * 260, p.y + f.y * 260);
      for (let hop = 260; hop >= 60; hop -= 40) {   /* land on the farthest walkable spot */
        const nx = clamp(p.x + f.x * hop, -WORLD_W, WORLD_W);
        const ny = clamp(p.y + f.y * hop, -WORLD_H, WORLD_H);
        if (walkable(sim.world, nx, ny) && !foeWallAt(sim, p.team, nx, ny, 8)) { p.x = nx; p.y = ny; break; }
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
      /* Sour Grenade: the team-sprint was a nice-to-have that decided
         nothing. A thrown blast decides fights. */
      lobGrenade(sim, p, hint, 60 * pm, 130);
    }
  } else if (p.hero === 'shaman') {
    if (i === 0) {
      addFx(sim, 'nova', p.x, p.y, undefined, undefined, 170);
      p.haste = Math.max(p.haste || 0, DISENGAGE_T);      /* shard-step out of trouble */
      for (const e of foes) if (dist(e.x, e.y, p.x, p.y) <= 170) {
        hurtCreep(sim, e, Math.round(25 * pm), p.id);
        if (!creepDef(e.team, e.type).boss) e.stun = Math.max(e.stun, 12);
      }
      for (const q of oppHeroes(sim, p.team)) if (dist(q.x, q.y, p.x, p.y) <= 170) pvpHit(sim, q, 25 * pm, p);
      for (const n of sim.neutrals) if (dist(n.x, n.y, p.x, p.y) <= 170) hurtNeutral(sim, n, Math.round(25 * pm), p.id);
    } else if (i === 1) {
      const b = { id: sim.nextId++, owner: p.id, team: p.team, type: 'decoy', x: Math.round(p.x), y: Math.round(p.y),
                  lvl: 1, hp: Math.round(BLD.decoy.hp * 0.9 * pm), maxhp: Math.round(BLD.decoy.hp * 0.9 * pm),
                  cd: 0, boost: 0, until: sim.tick + BLD.decoy.temp };
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
      /* Goo Bomb: it was always CALLED a bomb — now it flies like one,
         and everything caught in the splash is slowed to a crawl */
      lobGrenade(sim, p, hint, 40 * pm, 140, 0.5, 60);
    } else if (i === 1) {
      addFx(sim, 'heal', p.x, p.y, undefined, undefined, 200);
      for (const b of myBlds) if (dist(b.x, b.y, p.x, p.y) <= 200) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.5 * pm);
      p.hp = Math.min(p.maxhp, p.hp + Math.round(p.maxhp * 0.15 * pm));
    } else {
      const b = { id: sim.nextId++, owner: p.id, team: p.team, type: 'turret', x: Math.round(p.x), y: Math.round(p.y),
                  lvl: 1, hp: Math.round(BLD.turret.hp * 0.7), maxhp: Math.round(BLD.turret.hp * 0.7),
                  cd: 5, boost: 0, until: sim.tick + 300 };
      sim.blds.push(b);
      addFx(sim, 'built', b.x, b.y);
    }
  } else if (p.hero === 'builder') {
    if (i === 0) {
      addFx(sim, 'heal', p.x, p.y, undefined, undefined, 200);
      for (const b of myBlds) if (dist(b.x, b.y, p.x, p.y) <= 200) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.5 * pm);
    } else if (i === 1) {
      /* Frosting Bomb: Greta finally hits back. Overclock was a buff to
         buildings that might not exist yet, worth nothing in an open brawl. */
      lobGrenade(sim, p, hint, 55 * pm, 130);
    } else {
      const b = { id: sim.nextId++, owner: p.id, team: p.team, type: 'decoy', x: Math.round(p.x), y: Math.round(p.y),
                  lvl: 1, hp: Math.round(BLD.decoy.hp * pm), maxhp: Math.round(BLD.decoy.hp * pm),
                  cd: 0, boost: 0, until: sim.tick + BLD.decoy.temp };
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
  for (const b of sim.blds) {
    if (b.team !== opp) continue;                       /* only ENEMY structures */
    if (b.type === 'wall') { const s2 = nearestSeg(b, u.x, u.y); consider('bld', b.id, s2.x, s2.y, WALL.lure - def.aggro); }
    else consider('bld', b.id, b.x, b.y, b.type === 'decoy' ? BLD.decoy.lure - def.aggro : 0);
  }
  for (const tw of towersOf(sim, opp)) consider('tower', tw.id, tw.x, tw.y, ETOWER.r);
  u.tgt = best;
}

function tgtPos(sim, u, tgt) {
  if (!tgt) return null;
  if (tgt.kind === 'hero') { const p = sim.players.get(tgt.id); return p && !p.dead ? p : null; }
  if (tgt.kind === 'creep') return creepsOf(sim, 1 - u.team).find((a) => a.id === tgt.id) || null;
  if (tgt.kind === 'bld') return sim.blds.find((b) => b.id === tgt.id) || null;
  if (tgt.kind === 'tower') {
    const tw = towersOf(sim, 1 - u.team).find((t) => t.id === tgt.id);
    return tw || null;                  /* null after a capture flips it to our side */
  }
  return null;
}
/* where to WALK to hit a thing: the middle of most buildings, but the
   nearest brick of a wall that snakes across half the map */
function aimPoint(t, x, y) {
  if (t && t.type === 'wall' && t.segs && t.segs.length) return nearestSeg(t, x, y);
  return t;
}

/* ---------------- tap-to-attack ----------------
   The phone sends the world point the player poked; we find the nearest
   legal enemy to that point and remember it. From then on the hero swings
   at THAT thing whenever it is in reach, instead of whatever wandered
   closest — so "kill the tower, ignore the creeps" is finally sayable. */
const FOCUS_GRAB = 150;            // how close the tap has to land
const FOCUS_T = 900;               // ...and how long the order stands (90 s)

function setFocus(sim, playerId, x, y) {
  const p = sim.players.get(playerId);
  if (!p || !p.hero) return null;
  const opp = 1 - p.team;
  let best = null, bd = FOCUS_GRAB;
  const take = (kind, id, ax, ay, pad = 0) => {
    const d = dist(x, y, ax, ay) - pad;
    if (d < bd) { bd = d; best = { kind, id }; }
  };
  for (const e of creepsOf(sim, opp)) take('creep', e.id, e.x, e.y, creepDef(e.team, e.type).r || 12);
  for (const q of oppHeroes(sim, p.team)) take('pvp', q.id, q.x, q.y, heroDef(q).r);
  for (const n of sim.neutrals) take('neutral', n.id, n.x, n.y, NTYPES[n.type].r);
  for (const tw of towersOf(sim, opp)) take('tower', tw.id, tw.x, tw.y, ETOWER.r);
  for (const b of sim.blds) {
    if (b.team !== opp) continue;
    if (b.type === 'wall' && b.segs) {
      const s2 = nearestSeg(b, x, y);
      take('bld', b.id, s2.x, s2.y, WALL.thick / 2);
    } else take('bld', b.id, b.x, b.y, BLD[b.type].r);
  }
  p.focus = best ? { ...best, until: sim.tick + FOCUS_T } : null;
  return p.focus;
}

/* turn a remembered focus back into a live object, dropping it if the
   thing died, got captured, or the order simply went stale */
function resolveFocus(sim, p) {
  const f = p.focus;
  if (!f) return null;
  if (sim.tick > f.until) { p.focus = null; return null; }
  const opp = 1 - p.team;
  let what = null;
  if (f.kind === 'creep') what = creepsOf(sim, opp).find((e) => e.id === f.id);
  else if (f.kind === 'pvp') { const q = sim.players.get(f.id); what = q && q.hero && !q.dead && q.team !== p.team ? q : null; }
  else if (f.kind === 'neutral') what = sim.neutrals.find((n) => n.id === f.id);
  else if (f.kind === 'tower') what = towersOf(sim, opp).find((t) => t.id === f.id);
  else if (f.kind === 'bld') { const b = sim.blds.find((q) => q.id === f.id); what = b && b.team === opp ? b : null; }
  if (!what) { p.focus = null; return null; }
  return { kind: f.kind, what };
}

function hitHeroFrom(sim, p, rawDmg, ignoreArmor) {
  if ((p.glaze || 0) > 0) rawDmg *= GLAZE_MUL;             /* honey-glazed: +35% */
  const dmg = p.armor > 0 && !ignoreArmor ? Math.round(rawDmg * ARMOR_MIT) : Math.round(rawDmg);
  p.hp -= dmg;
  p.hurtAt = sim.tick;
  if (p.hp <= 0) killHero(sim, p);
}

function stepCreep(sim, u) {
  const def = creepDef(u.team, u.type);
  if (u.stun > 0) { u.stun--; return; }
  if (u.slowT > 0) { u.slowT--; if (u.slowT <= 0) u.slow = 0; }
  if (u.glaze > 0) u.glaze--;                       /* honey wears off */
  if (u.taunt) { u.taunt.t--; if (u.taunt.t <= 0) u.taunt = null; }
  for (const f of sim.impacts) {
    if (f.kind === 'field' && f.team !== u.team && dist(u.x, u.y, f.x, f.y) <= f.r) applySlow(u, f.slow, 3);
  }
  if (u.cd > 0) u.cd--;
  const spd = def.spd * (1 - u.slow);

  /* lane fighters */
  if (sim.tick % 5 === (u.id % 5)) creepScan(sim, u);
  const t = tgtPos(sim, u, u.tgt);
  if (t) {
    const aim = aimPoint(t, u.x, u.y);                 /* walls: the nearest brick */
    const tr = u.tgt.kind === 'tower' ? ETOWER.r
      : (t.type === 'wall' ? WALL.thick / 2 : (t.type && BLD[t.type] ? BLD[t.type].r : 16));
    const d = dist(u.x, u.y, aim.x, aim.y);
    const lureR = u.tgt.kind === 'bld' && (t.type === 'wall' || t.type === 'decoy')
      ? (t.type === 'wall' ? WALL.lure : BLD.decoy.lure) : def.aggro;
    /* home-turf fury: while an enemy HERO prowls near our base, never give up the chase */
    const home = baseOf(u.team);
    const heroInvading = u.tgt.kind === 'hero' && dist(t.x, t.y, home.x, home.y) <= BASE_ZONE;
    if (!heroInvading && d > lureR * LEASH_MUL) { u.tgt = null; }
    else if (d > def.range + tr) {
      if (def.air) { u.x += ((aim.x - u.x) / d) * spd; u.y += ((aim.y - u.y) / d) * spd; }
      else slideMove(sim, u, u.x + ((aim.x - u.x) / d) * spd, u.y + ((aim.y - u.y) / d) * spd);
      return;
    } else {
      if (u.cd <= 0) {
        u.cd = 10;
        addFx(sim, 'hit', aim.x, aim.y);
        if (u.tgt.kind === 'hero') hitHeroFrom(sim, t, u.dmg);
        else if (u.tgt.kind === 'creep') hurtCreep(sim, t, u.dmg, u.owner);
        else if (u.tgt.kind === 'tower') hurtTower(sim, t, 1 - u.team, u.dmg, u.owner);
        else hurtBld(sim, t, u.dmg * (def.bldOnly ? 1.5 : 1), u.owner);
      }
      return;
    }
  }
  /* nothing to fight — HUNT the nearest opposing tower in sight; if the enemy
     base is still shielded and we're at its doorstep, widen the search so the
     whole wave swarms the ring guards */
  const oppBase0 = baseOf(1 - u.team);
  const sieging = baseShielded(sim, 1 - u.team) && dist(u.x, u.y, oppBase0.x, oppBase0.y) <= BASE_ZONE;
  let hunt = null, hd2 = Infinity;
  for (const tw of towersOf(sim, 1 - u.team)) {
    const d = dist(u.x, u.y, tw.x, tw.y);
    if (d <= (sieging ? BASE_ZONE : Math.max(def.aggro * 1.3, 220)) && d < hd2) { hd2 = d; hunt = tw; }
  }
  if (hunt) {
    if (hd2 > def.range + ETOWER.r) {
      if (def.air) { u.x += ((hunt.x - u.x) / hd2) * spd; u.y += ((hunt.y - u.y) / hd2) * spd; }
      else slideMove(sim, u, u.x + ((hunt.x - u.x) / hd2) * spd, u.y + ((hunt.y - u.y) / hd2) * spd);
    } else if (u.cd <= 0) { u.cd = 10; hurtTower(sim, hunt, 1 - u.team, u.dmg, u.owner); }
    return;
  }
  const oppBase = baseOf(1 - u.team);
  const db = dist(u.x, u.y, oppBase.x, oppBase.y);
  if (db <= oppBase.r + def.range + 10 && !baseShielded(sim, 1 - u.team)) {
    if (u.cd <= 0) {
      u.cd = 10;
      hurtBase(sim, 1 - u.team, Math.round(u.dmg * (def.bldOnly ? 1.4 : 1)));
      addFx(sim, u.team === 1 ? 'castlehit' : 'hit', u.x, u.y);
    }
    return;
  }
  /* march the lane toward the opposing base — fliers cut straight over any
     wall in the way, everyone else has to walk around it (or chew it down) */
  const path = sim.world.paths[u.path];
  const step = u.team === 1 ? 1 : -1;
  const wp = path[clamp(u.wp, 0, path.length - 1)];
  const d = dist(u.x, u.y, wp.x, wp.y);
  if (d < 30) u.wp = clamp(u.wp + step, 0, path.length - 1);
  if (d > 1) {
    const nx = u.x + ((wp.x - u.x) / d) * spd, ny = u.y + ((wp.y - u.y) / d) * spd;
    if (def.air) { u.x = nx; u.y = ny; }
    else slideMove(sim, u, nx, ny, def.r || 12);
  }
}

/* ---------------- the robot brain: shop, build, cast, push, retreat ----------------
   Split in two: a SAFETY layer that runs every single tick (because dying
   takes well under a second once a tower has your range), and a strategy
   layer that thinks once a second. */

/* the ability each hero reaches for when things go wrong */
/* which slot a fleeing robot slams: an escape or a heal, never a wind-up.
   Knight's slam stuns his pursuers; the whip drops her snare at her feet. */
const PANIC_ABILITY = { knight: 2, builder: 2, ranger: 1, mage: 2,
                        slasher: 2, tinker: 1, whip: 1, shaman: 2 };

/* where should a hurt bot run to? nearest healing water that isn't toward
   the thing that's hurting it */
function safeHaven(sim, p) {
  const home = baseOf(p.team);
  const spots = [{ x: home.x - Math.sign(home.x) * (home.r + 90), y: home.y - Math.sign(home.y) * (home.r + 90) }];
  for (const sp of sim.world.springs) spots.push(sp);
  let threatX = null, threatY = null, td = Infinity;
  for (const q of oppHeroes(sim, p.team)) { const d = dist(q.x, q.y, p.x, p.y); if (d < td) { td = d; threatX = q.x; threatY = q.y; } }
  for (const tw of towersOf(sim, 1 - p.team)) { const d = dist(tw.x, tw.y, p.x, p.y); if (d < td) { td = d; threatX = tw.x; threatY = tw.y; } }
  let best = spots[0], bestScore = -Infinity;
  for (const sp of spots) {
    const mine = dist(p.x, p.y, sp.x, sp.y);
    const away = threatX === null ? 0 : dist(sp.x, sp.y, threatX, threatY);
    const score = away * 0.8 - mine;              /* far from danger, near to me */
    if (score > bestScore) { bestScore = score; best = sp; }
  }
  return best;
}

/* A mortar out-ranges a lane tower (340 vs 270), so a shell lobbed from the
   ring between them grinds the tower down while the tower cannot answer.
   This finds a legal spot in that ring, on OUR side of the tower so our own
   wave screens it. */
const BOT_MAX_BLD = MAX_BLD;    // robots live under the same seven-building cap
function siegeSpot(sim, p, tw) {
  /* Search outward from where the BOT is standing relative to the tower — a
     firing position it can't walk to is no use — but lean toward our own base
     so the wave screens the mortar. */
  const home = baseOf(p.team);
  const aBot = Math.atan2(p.y - tw.y, p.x - tw.x);
  const aHome = Math.atan2(home.y - tw.y, home.x - tw.x);
  let lean = aHome - aBot;
  while (lean > Math.PI) lean -= Math.PI * 2;
  while (lean < -Math.PI) lean += Math.PI * 2;
  const bias = Math.sign(lean) * Math.min(Math.abs(lean), 0.5);   /* a nudge homeward */
  for (const spread of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1]) {
    for (const rad of [300, 315, 288, 330, 282, 336]) {
      const a = aBot + bias + spread;
      const x = tw.x + Math.cos(a) * rad, y = tw.y + Math.sin(a) * rad;
      if (dist(p.x, p.y, x, y) > BUILD_R - 10) continue;
      if (!sim.fog[fogIdx(x, y)]) continue;
      if (canPlace(sim.world, sim.blds, x, y)) return { x, y };
    }
  }
  return null;
}

/* is this spot covered by an enemy tower? */
function underEnemyGuns(sim, team, x, y, pad = 20) {
  for (const tw of towersOf(sim, 1 - team)) {
    if (dist(x, y, tw.x, tw.y) <= ETOWER.range + pad) return true;
  }
  return false;
}

function stepBot(sim, p) {
  const hdSafe = heroDef(p);
  const fracNow = p.hp / p.maxhp;

  /* ---------- SAFETY LAYER (every tick) ---------- */
  if (p.botHpLast === undefined) p.botHpLast = p.hp;
  const bleed = Math.max(0, p.botHpLast - p.hp);
  p.botHpLast = p.hp;
  p.botBleed = (p.botBleed || 0) * 0.88 + bleed;          /* rolling damage taken */
  const inGuns = underEnemyGuns(sim, p.team, p.x, p.y);
  /* the more dangerous the spot, the earlier we lose our nerve */
  const panicAt = inGuns ? 0.60 : (p.botBleed > p.maxhp * 0.05 ? 0.50 : 0.38);

  if (!p.botRetreat && fracNow < panicAt) {
    p.botRetreat = true;
    const panic = PANIC_ABILITY[p.hero];
    if (panic !== undefined) castAbility(sim, p.id, panic);   /* shield / heal / bolt */
  }
  if (p.botRetreat) {
    /* only go back to work once genuinely healthy AND out of the line of fire */
    if (fracNow > 0.85 && !inGuns) {
      p.botRetreat = false;
    } else {
      const haven = safeHaven(sim, p);
      p.moveTo = { x: haven.x, y: haven.y };
      p.dir = { x: 0, y: 0 };
      p.botWp = null;
      if (fracNow < 0.35) {                                  /* really desperate */
        const panic = PANIC_ABILITY[p.hero];
        if (panic !== undefined) castAbility(sim, p.id, panic);
      }
      return;
    }
  }

  if (sim.tick % 10 !== p.seat % 10) return;      // strategy thinks once a second
  /* Wedged against a tree — or, now, a rampart? Hop sideways to a clear spot
     and re-plan. A bot walks straight at its goal, so a wall across the route
     pins it; the escape has to check that the detour is not ALSO behind a
     wall, or it just leans on the bricks from a new angle. (It will still
     auto-attack whatever is in front of it meanwhile, so a wall that truly
     spans the lane gets chewed down rather than walked around.) */
  const wasStuck = (p.botLastX !== undefined && p.moveTo && dist(p.x, p.y, p.botLastX, p.botLastY) < 5)
    || (p.stuckT || 0) > 12;
  p.botLastX = p.x; p.botLastY = p.y;
  if (wasStuck) {
    const a0 = Math.random() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4;
      const jx = p.x + Math.cos(a) * 150, jy = p.y + Math.sin(a) * 150;
      if (!walkable(sim.world, jx, jy)) continue;
      if (foeWallAt(sim, p.team, jx, jy, 16)) continue;       /* don't aim INTO their bricks */
      if (foeWallBlocks(sim, p.team, p.x, p.y, jx, jy)) continue;  /* nor through them */
      p.moveTo = { x: jx, y: jy }; p.botWp = null; p.stuckT = 0; return;
    }
  }
  const hd = hdSafe;
  const home = baseOf(p.team), oppB = baseOf(1 - p.team);
  const frac = fracNow;

  /* ---------- ECONOMY ----------
     A bot alternates its spending: one purchase into the hero, the next into
     the war effort. That way neither the gear sheet nor the siege line ever
     starves the other, which is roughly how a person plays. */
  const myBlds = myBuildings(sim, p.id);
  const cap = BOT_MAX_BLD;
  /* walls need a hero standing at the tip to extend, which the robots do not
     plan for — so they leave wall upgrades alone and spend elsewhere */
  const myGuns = myBlds.filter((b) => b.type !== 'wall');
  const priceOf = (t) => Math.round(BLD[t].cost * (hd.discount || 1));

  const buyGear = () => {
    const order = ['dmg', 'hp', 'pow', 'spd'];
    const next = order.reduce((a, b) => (p.up[a] <= p.up[b] ? a : b));
    if (p.up[next] >= HUP_MAX) return false;
    const cost = hupCost(p.up[next]);
    if (p.coins < cost + 40) return false;
    const before = p.up[next];
    upgradeHero(sim, p.id, next);
    return p.up[next] > before;
  };

  const buyWar = () => {
    /* 1) SIEGE — a mortar parked outside a tower's reach shells it for free */
    if (myBlds.length < cap && p.coins >= priceOf('mortar') + 40) {
      let tw = null, td = Infinity;
      for (const t2 of towersOf(sim, 1 - p.team)) {
        const d = dist(t2.x, t2.y, p.x, p.y);
        if (d < 2600 && d < td) { td = d; tw = t2; }
      }
      if (tw) {
        const spot = siegeSpot(sim, p, tw);
        if (spot && build(sim, p.id, 'mortar', spot.x, spot.y) === 'ok') return true;
        if (!spot && td > BUILD_R) {
          const home = baseOf(p.team);
          const a0 = Math.atan2(home.y - tw.y, home.x - tw.x);
          p.botErrand = { x: tw.x + Math.cos(a0) * 305, y: tw.y + Math.sin(a0) * 305, until: sim.tick + 300 };
        }
      }
    }
    /* 2) DEFENCE — shore up a friendly tower that is actually under pressure */
    if (myBlds.length < cap && p.coins >= priceOf('turret') + 40) {
      for (const t2 of towersOf(sim, p.team)) {
        if (dist(t2.x, t2.y, p.x, p.y) >= BUILD_R + 120) continue;
        let pressure = 0;
        for (const e of creepsOf(sim, 1 - p.team)) if (dist(e.x, e.y, t2.x, t2.y) < 520) pressure++;
        if (pressure < 2) continue;
        const opp = baseOf(1 - p.team);
        const a0 = Math.atan2(opp.y - t2.y, opp.x - t2.x);
        for (const spread of [0, 0.5, -0.5, 1, -1]) {
          const x = t2.x + Math.cos(a0 + spread) * 150, y = t2.y + Math.sin(a0 + spread) * 150;
          if (dist(p.x, p.y, x, y) > BUILD_R - 10) continue;
          if (build(sim, p.id, 'turret', x, y) === 'ok') return true;
        }
      }
    }
    /* 3) BARRACKS — a creep pump behind our own line is worth more than a
       fourth turret, so buy one once the siege kit is down */
    if (myBlds.length < cap && !myGuns.some((b) => b.type === 'barracks')
        && p.coins >= priceOf('barracks') + 60) {
      const home = baseOf(p.team);
      const a0 = Math.atan2(p.y - home.y, p.x - home.x);
      for (const spread of [0, 0.4, -0.4, 0.8, -0.8]) {
        const x = p.x + Math.cos(a0 + spread) * 120, y = p.y + Math.sin(a0 + spread) * 120;
        if (build(sim, p.id, 'barracks', x, y) === 'ok') return true;
      }
    }
    /* 4) UPGRADE — a level-5 mortar hits far harder than three level-1s */
    const worst = myGuns.filter((b) => b.lvl < BUP.max).sort((a, b) => a.lvl - b.lvl)[0];
    if (worst && p.coins >= bupCost(worst.lvl) + 40) {
      const before = worst.lvl;
      upgradeBld(sim, p.id, worst.id);
      return worst.lvl > before;
    }
    return false;
  };

  /* alternate, and fall back to the other pocket if this one can't be spent */
  if (!p.botSpendTurn) p.botSpendTurn = 'gear';
  const wantWar = p.botSpendTurn === 'war';
  let spent = wantWar ? buyWar() : buyGear();
  if (!spent) spent = wantWar ? buyGear() : buyWar();
  if (spent) p.botSpendTurn = wantWar ? 'gear' : 'war';

  /* --- abilities on the same cooldowns humans get --- */
  const foes = creepsOf(sim, 1 - p.team);
  let nNear = 0, nearest = Infinity;
  for (const e of foes) { const d = dist(e.x, e.y, p.x, p.y); if (d < 260) { nNear++; if (d < nearest) nearest = d; } }
  for (const q of oppHeroes(sim, p.team)) { const d = dist(q.x, q.y, p.x, p.y); if (d < 260) { nNear++; if (d < nearest) nearest = d; } }
  if (nearest < 220) castAbility(sim, p.id, 0);
  if (nNear >= 3) castAbility(sim, p.id, 1);
  if (frac < 0.55 || nNear >= 2) castAbility(sim, p.id, 2);

  /* --- macro: heal up when hurt, defend home, jungle early, else push a lane --- */
  /* home under siege? peel back */
  let threat = null, td = Infinity;
  for (const e of foes) {
    const d = dist(e.x, e.y, home.x, home.y);
    if (d < 620 && d < td) { td = d; threat = e; }
  }
  if (threat) { p.moveTo = { x: threat.x, y: threat.y }; return; }

  /* young + healthy → clear a nearby camp for XP */
  if (p.lvl < 4 && frac > 0.7) {
    let camp = null, cd2 = Infinity;
    for (const n of sim.neutrals) {
      const d = dist(n.x, n.y, p.x, p.y);
      if (d < 520 && d < cd2) { cd2 = d; camp = n; }
    }
    if (camp) { p.moveTo = { x: camp.x, y: camp.y }; return; }
  }

  /* walking out to a firing position we picked earlier */
  if (p.botErrand) {
    if (sim.tick > p.botErrand.until || dist(p.x, p.y, p.botErrand.x, p.botErrand.y) < 90) p.botErrand = null;
    else { p.moveTo = { x: p.botErrand.x, y: p.botErrand.y }; return; }
  }

  /* dismantle towers — but only in good health and WITH the wave, never solo */
  if (frac > 0.75) {
    let tw = null, twd = Infinity;
    for (const t2 of towersOf(sim, 1 - p.team)) {
      const d = dist(t2.x, t2.y, p.x, p.y);
      if (d < 560 && d < twd) { twd = d; tw = t2; }
    }
    if (tw) {
      let mates = 0;
      for (const a of creepsOf(sim, p.team)) if (dist(a.x, a.y, tw.x, tw.y) < 320) mates++;
      if (mates >= 3) { p.moveTo = { x: tw.x, y: tw.y }; return; }
      /* no wave to soak the zaps — hold at the edge of its range instead */
      const a2 = Math.atan2(p.y - tw.y, p.x - tw.x);
      p.moveTo = { x: tw.x + Math.cos(a2) * (ETOWER.range + 60), y: tw.y + Math.sin(a2) * (ETOWER.range + 60) };
      return;
    }
  }

  /* push the assigned lane, waypoint by waypoint (never wedged in trees) */
  if (p.botLane === undefined) p.botLane = p.seat % N_PATHS;
  const path = sim.world.paths[p.botLane];
  if (p.botWp === undefined || p.botWp === null) {
    let bi = 0, bd2 = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = dist(p.x, p.y, path[i].x, path[i].y);
      if (d < bd2) { bd2 = d; bi = i; }
    }
    p.botWp = bi;
    p.botWpFresh = true;
  }
  const step = p.team === 0 ? -1 : 1;               // toward the enemy's end
  /* never target our own base-end waypoint — the keep clamp makes it unreachable */
  if (p.botWpFresh) {
    p.botWp = clamp(p.botWp + step, 0, path.length - 1);
    p.botWpFresh = false;
  }
  if (dist(p.x, p.y, path[p.botWp].x, path[p.botWp].y) < 110) {
    p.botWp = clamp(p.botWp + step, 0, path.length - 1);
  }
  /* at the shielded enemy base: camp the nearest ring guard instead */
  if (dist(p.x, p.y, oppB.x, oppB.y) < BASE_ZONE && baseShielded(sim, 1 - p.team)) {
    let ring = null, rd = Infinity;
    for (const tw of towersOf(sim, 1 - p.team)) {
      const d = dist(tw.x, tw.y, p.x, p.y);
      if (d < rd) { rd = d; ring = tw; }
    }
    if (ring) { p.moveTo = { x: ring.x, y: ring.y }; return; }
  }
  const goal = path[p.botWp];
  if (underEnemyGuns(sim, p.team, goal.x, goal.y, -30) && frac < 0.75) {
    let mates = 0;
    for (const a of creepsOf(sim, p.team)) if (dist(a.x, a.y, goal.x, goal.y) < 300) mates++;
    if (mates < 3) { p.moveTo = { x: p.x, y: p.y }; return; }   /* wait for the wave */
  }
  p.moveTo = { x: goal.x, y: goal.y };

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
      slideMove(sim, n, n.x + ((camp.x - n.x) / d) * def.spd, n.y + ((camp.y - n.y) / d) * def.spd);
      n.hp = Math.min(n.maxhp, n.hp + n.maxhp * 0.01);
    }
    return;
  }
  const d = dist(n.x, n.y, t.x, t.y);
  if (d > def.range + 18) slideMove(sim, n, n.x + ((t.x - n.x) / d) * def.spd, n.y + ((t.y - n.y) / d) * def.spd);
  else if (n.cd <= 0) {
    n.cd = 10;
    addFx(sim, 'hit', t.x, t.y);
    if (n.tgt.kind === 'hero') hitHeroFrom(sim, t, def.dmg);
    else hurtCreep(sim, t, def.dmg, null);
  }
}

/* ---------------- towers & buildings ---------------- */

/* a lane/ring tower belonging to `team` shoots the nearest intruder */
/* A hero parked on their own fountain is off-limits to STRUCTURES. The pad
   is a breather, not a fortress — rival heroes and creeps can still walk up
   and end you there, but no tower or turret gets to shell the spawn. */
function onOwnFountain(sim, p) {
  const home = baseOf(p.team);
  return dist(p.x, p.y, home.x, home.y) < FOUNTAIN_R;
}

function stepTower(sim, tw, team) {
  if (tw.cd > 0) { tw.cd--; return; }
  const opp = 1 - team;
  /* a wall between us and the mark means we simply cannot see it */
  const clear = (x, y) => !wallBlocksLine(sim, tw.x, tw.y, x, y);
  let best = null, bd = Infinity, kind = null;
  for (const a of creepsOf(sim, opp)) {
    if (a.hp <= 0) continue;                              /* already a goner */
    const d = dist(a.x, a.y, tw.x, tw.y);
    if (d <= ETOWER.range && d < bd && clear(a.x, a.y)) { bd = d; best = a; kind = 'creep'; }
  }
  for (const p of sim.players.values()) {
    if (!p.hero || p.dead || p.team !== opp) continue;
    if (onOwnFountain(sim, p)) continue;                  /* sanctuary from buildings */
    const d = dist(p.x, p.y, tw.x, tw.y);
    if (d <= ETOWER.range && d < bd && clear(p.x, p.y)) { bd = d; best = p; kind = 'hero'; }
  }
  for (const b of sim.blds) {
    if (b.team !== opp || b.type === 'wall') continue;    /* towers cannot chew walls */
    const d = dist(b.x, b.y, tw.x, tw.y);
    if (d <= ETOWER.range && d < bd && clear(b.x, b.y)) { bd = d; best = b; kind = 'bld'; }
  }
  if (!best) return;
  tw.cd = ETOWER.cd;
  addFx(sim, 'etzap', tw.x, tw.y, best.x, best.y);
  if (kind === 'hero') hitHeroFrom(sim, best, towerDmgVsHero(best, bd), true);   /* towers pierce armor */
  else if (kind === 'creep') hurtCreep(sim, best, towerDmgVsCreep(best), null);
  else hurtBld(sim, best, 110, null);   /* buildings are sturdy targets now */
}

function stepBld(sim, b) {
  if (b.until && sim.tick >= b.until) { b.hp = 0; return; }
  const def = BLD[b.type];
  const opp = 1 - b.team;
  if (b.type === 'wall' || b.type === 'decoy') return;    /* walls just stand there */
  if (b.boost > 0) b.boost--;

  /* ---- BARRACKS: seven waves of five, one every seven seconds ---- */
  if (b.type === 'barracks') {
    if (b.wavesLeft > 0) {
      if (b.waveCd > 1) b.waveCd--;
      else { b.waveCd = def.waveCd; b.wavesLeft--; spawnGummySquad(sim, b); }   /* exactly 10.0 s apart */
    }
    return;
  }
  if (!def.range) return;
  if (b.cd > 0) { b.cd -= b.boost > 0 ? 2 : 1; return; }
  const range = def.range * Math.pow(BUP.rangeMul, b.lvl - 1);
  const foes = creepsOf(sim, opp);
  const dmg = Math.round(def.dmg * Math.pow(BUP.dmgMul, b.lvl - 1));

  /* ---- HONEY GLAZER: slows everything AND leaves it glazed ---- */
  if (b.type === 'syrup') {
    const glaze = def.glaze + 6 * (b.lvl - 1);
    let any = false;
    for (const e of foes) if (dist(e.x, e.y, b.x, b.y) <= range) {
      applySlow(e, def.slow + 0.05 * (b.lvl - 1), 10);
      e.glaze = Math.max(e.glaze || 0, glaze);
      any = true;
    }
    for (const q of oppHeroes(sim, b.team)) if (dist(q.x, q.y, b.x, b.y) <= range) {
      applySlowHero(q, def.slow, 10);
      q.glaze = Math.max(q.glaze || 0, glaze);
      any = true;
    }
    if (any) { b.cd = def.cd; addFx(sim, 'syrup', b.x, b.y, undefined, undefined, range); }
    return;
  }

  /* ---- MORTAR: siege engine, blind to anything with legs ----
     It out-ranges a lane tower and out-ranges a wall's defenders, and that
     is ALL it does. No more mortar carpet over the lane. */
  if (def.siege) {
    let mark = null, bd = Infinity, kind = null;
    for (const tw of towersOf(sim, opp)) {
      const d = dist(tw.x, tw.y, b.x, b.y);
      if (d >= def.minRange && d <= range && d < bd) { bd = d; mark = tw; kind = 'tower'; }
    }
    for (const w of sim.blds) {                       /* enemy walls are fair game */
      if (w.team === b.team || w.type !== 'wall' || !w.segs) continue;
      const seg = nearestSeg(w, b.x, b.y);
      const d = dist(seg.x, seg.y, b.x, b.y);
      if (d >= def.minRange && d <= range && d < bd) { bd = d; mark = w; kind = 'wall'; }
    }
    const oppBase = baseOf(opp);
    const dbase = dist(oppBase.x, oppBase.y, b.x, b.y);
    if (!baseShielded(sim, opp) && dbase <= range + oppBase.r && dbase < bd) { mark = oppBase; kind = 'base'; }
    if (!mark) return;
    b.cd = def.cd;
    const at = kind === 'wall' ? nearestSeg(mark, b.x, b.y) : mark;
    addFx(sim, 'shell', b.x, b.y, at.x, at.y);
    addFx(sim, 'boom', at.x, at.y, undefined, undefined, 60);
    if (kind === 'tower') hurtTower(sim, mark, opp, dmg, b.owner);
    else if (kind === 'wall') hurtBld(sim, mark, dmg, b.owner);
    else hurtBase(sim, opp, dmg);
    return;
  }

  /* ---- TURRET: the generalist. Air, ground, heroes, buildings, towers ----
     It shoots at anything, which is why it is made of sugar glass. */
  let best = null, bd = Infinity, kind = null;
  const clear = (x, y) => !wallBlocksLine(sim, b.x, b.y, x, y);
  for (const e of foes) {
    if (e.hp <= 0) continue;                              /* already a goner */
    const air = !!creepDef(e.team, e.type).air;
    if (air && !def.hitsAir) continue;
    const d = dist(e.x, e.y, b.x, b.y);
    if (d <= range && d < bd && clear(e.x, e.y)) { bd = d; best = e; kind = 'creep'; }
  }
  for (const q of oppHeroes(sim, b.team)) {
    if (onOwnFountain(sim, q)) continue;                  /* no shelling the spawn pad */
    const d = dist(q.x, q.y, b.x, b.y);
    if (d <= range && d < bd && clear(q.x, q.y)) { bd = d; best = q; kind = 'hero'; }
  }
  if (def.hitsStructures) {
    for (const bb of sim.blds) {
      if (bb.team === b.team || bb.type === 'wall' || bb.hp <= 0) continue;   /* walls are immune */
      const d = dist(bb.x, bb.y, b.x, b.y);
      if (d <= range && d < bd && clear(bb.x, bb.y)) { bd = d; best = bb; kind = 'bld'; }
    }
    for (const tw of towersOf(sim, opp)) {
      const d = dist(tw.x, tw.y, b.x, b.y);
      if (d <= range && d < bd && clear(tw.x, tw.y)) { bd = d; best = tw; kind = 'tower'; }
    }
    const oppBase = baseOf(opp);
    const dbase = dist(oppBase.x, oppBase.y, b.x, b.y);
    if (!baseShielded(sim, opp) && dbase <= range + oppBase.r && dbase < bd) { best = oppBase; kind = 'base'; }
  }
  if (!best) return;
  b.cd = def.cd;
  addFx(sim, 'pew', b.x, b.y, best.x, best.y);
  if (kind === 'hero') pvpHit(sim, best, dmg, sim.players.get(b.owner) || null);
  else if (kind === 'creep') hurtCreep(sim, best, dmg, b.owner);
  else if (kind === 'tower') hurtTower(sim, best, opp, dmg, b.owner);
  else if (kind === 'bld') hurtBld(sim, best, dmg, b.owner);
  else hurtBase(sim, opp, dmg);
}

/* ---------------- collision: real hitboxes, no ghosting through the war ----------------
   Units (heroes, creeps, neutrals) are soft bodies: overlapping pairs push
   apart a little each tick, so crowds flow but nobody skates through anybody.
   Towers and buildings are hard: units get shoved fully outside them.
   Fliers only bump other fliers and ignore ground clutter entirely. */

function resolveCollisions(sim) {
  const movers = [];
  for (const p of sim.players.values()) {
    if (p.hero && !p.dead) movers.push({ u: p, r: heroDef(p).r, air: false, isHero: true });
  }
  for (const team of [0, 1]) for (const u of creepsOf(sim, team)) {
    const d = creepDef(team, u.type);
    movers.push({ u, r: d.r || 12, air: !!d.air });
  }
  for (const n of sim.neutrals) movers.push({ u: n, r: NTYPES[n.type].r, air: false });

  /* spatial buckets so this stays cheap with 200 bodies on the field */
  const CS = 150, buckets = new Map();
  const bkey = (x, y) => (Math.floor(x / CS) + 1000) * 100000 + (Math.floor(y / CS) + 1000);
  movers.forEach((m, i) => {
    const k = bkey(m.u.x, m.u.y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  const nudge = (m, nx, ny) => {
    if (!walkable(sim.world, nx, ny)) return;
    /* a shove must never post someone through a wall — nor knock an archer
       off the parapet onto the wrong side of it */
    if (!m.air && !wallPasses(sim, m.u, nx, ny, m.r * 0.5)) return;
    m.u.x = nx; m.u.y = ny;
  };
  for (let pass = 0; pass < COLLIDE_PASSES; pass++)
  for (let i = 0; i < movers.length; i++) {
    const a = movers[i];
    const bi = Math.floor(a.u.x / CS), bj = Math.floor(a.u.y / CS);
    /* buckets were built from pre-pass positions; a body only ever drifts a
       few px per pass, so the 3x3 neighbourhood still covers every contact */
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const cell = buckets.get((bi + di + 1000) * 100000 + (bj + dj + 1000));
      if (!cell) continue;
      for (const j of cell) {
        if (j <= i) continue;
        const b = movers[j];
        if (a.air !== b.air) continue;
        const dx = b.u.x - a.u.x, dy = b.u.y - a.u.y;
        const d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d >= min) continue;
        const push = (min - Math.max(d, 0.01)) * COLLIDE_PUSH;
        const nx = d > 0.01 ? dx / d : Math.cos(i * 2.4), ny = d > 0.01 ? dy / d : Math.sin(i * 2.4);
        nudge(a, a.u.x - nx * push, a.u.y - ny * push);
        nudge(b, b.u.x + nx * push, b.u.y + ny * push);
      }
    }
  }

  /* hard structures: towers, buildings, and both keeps. Walls are NOT in
     here — they are boxes, not discs, and wallPasses() already stops feet
     at the brick face. */
  const statics = [];
  for (const tw of sim.etowers) statics.push({ x: tw.x, y: tw.y, r: ETOWER.r });
  for (const tw of sim.ptowers) statics.push({ x: tw.x, y: tw.y, r: ETOWER.r });
  for (const b of sim.blds) if (b.type !== 'wall') statics.push({ x: b.x, y: b.y, r: BLD[b.type].r });
  for (const m of movers) {
    if (m.air) continue;
    for (const st of statics) {
      let dx = m.u.x - st.x, dy = m.u.y - st.y;
      let d = Math.hypot(dx, dy);
      const min = m.r + st.r;
      if (d >= min) continue;
      if (d < 0.01) { dx = 1; dy = 0; d = 1; }       /* dead-center? shove east */
      const ex = st.x + (dx / d) * min, ey = st.y + (dy / d) * min;
      if (walkable(sim.world, ex, ey) && wallPasses(sim, m.u, ex, ey, m.r * 0.5)) { m.u.x = ex; m.u.y = ey; continue; }
      for (let k = 1; k <= 7; k++) {                 /* wall behind us? slide around the rim */
        const a2 = Math.atan2(dy, dx) + k * (Math.PI / 4);
        const sx = st.x + Math.cos(a2) * min, sy = st.y + Math.sin(a2) * min;
        if (walkable(sim.world, sx, sy) && wallPasses(sim, m.u, sx, sy, m.r * 0.5)) { m.u.x = sx; m.u.y = sy; break; }
      }
    }
    if (!m.isHero) {                                 /* creeps & neutrals respect the keeps */
      for (const team of [0, 1]) {
        const bb = baseOf(team);
        const dx = m.u.x - bb.x, dy = m.u.y - bb.y;
        const d = Math.hypot(dx, dy);
        if (d < bb.r - 6 && d > 0.01) nudge(m, bb.x + (dx / d) * (bb.r - 6), bb.y + (dy / d) * (bb.r - 6));
      }
    }
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
    if (p.bot) stepBot(sim, p);
    if (p.armor > 0) p.armor--;
    if (p.frenzy > 0) p.frenzy--;
    if (p.haste > 0) p.haste--;
    if (p.slowT > 0) { p.slowT--; if (p.slowT <= 0) p.slow = 0; }
    for (const f of sim.impacts) {
      if (f.kind === 'field' && f.team !== p.team && dist(p.x, p.y, f.x, f.y) <= f.r) applySlowHero(p, f.slow, 3);
    }
    const hdR = heroDef(p);
    /* BACKSTEP — a ranged hero hit at knife range bolts free. It can't be
       spammed: you must actually be getting hit, and it rests 8 s after. */
    if (p.backstepCd > 0) p.backstepCd--;
    if (hdR.range > 100 && sim.tick - (p.hurtAt || -999) <= 2 && !p.backstepCd) {
      let pressed = false;
      for (const e of creepsOf(sim, 1 - p.team)) {
        if (dist(e.x, e.y, p.x, p.y) <= BACKSTEP_R) { pressed = true; break; }
      }
      if (!pressed) for (const q of oppHeroes(sim, p.team)) {
        if (dist(q.x, q.y, p.x, p.y) <= BACKSTEP_R) { pressed = true; break; }
      }
      if (pressed) {
        p.haste = Math.max(p.haste || 0, BACKSTEP_T);
        p.backstepCd = BACKSTEP_CD;
        addFx(sim, 'shield', p.x, p.y);
      }
    }
    if (p.glaze > 0) p.glaze--;                       /* honey wears off */
    const inCombat = sim.tick - (p.hurtAt || -999) <= REGEN_OOC;
    if (hdR.regen && p.hp < p.maxhp && !inCombat) p.hp = Math.min(p.maxhp, p.hp + p.maxhp * hdR.regen);
    const rest = hdR.range > 100 ? RANGED_REST : 1;   /* skirmishers recover quickest */
    /* THE FOUNTAIN IS NOT A TIMEOUT. Take a hit and the taps drop to a
       trickle for two seconds, so you can't stagger onto the pad at 5% and
       out-heal the hero chasing you. Walk away, THEN drink. */
    if (dist(p.x, p.y, myBase.x, myBase.y) < FOUNTAIN_R && p.hp < p.maxhp) {
      const harried = sim.tick - (p.hurtAt || -999) <= FOUNTAIN_FIGHT_T;
      const tap = FOUNTAIN_HEAL * rest * (harried ? FOUNTAIN_FIGHT_MUL : 1);
      p.hp = Math.min(p.maxhp, p.hp + p.maxhp * tap);
    }
    for (const sp of sim.world.springs) {
      if (p.hp < p.maxhp && dist(p.x, p.y, sp.x, sp.y) < SPRING_R) {
        p.hp = Math.min(p.maxhp, p.hp + p.maxhp * SPRING_HEAL * rest);
        if (sim.tick % 20 === 0) addFx(sim, 'heal', sp.x, sp.y, undefined, undefined, 60);
        break;
      }
    }
    for (let i = 0; i < 3; i++) if (p.cds[i] > 0) p.cds[i]--;
    const spd = speedOf(p) * (1 - (p.slow || 0)) * (p.frenzy > 0 ? 1.35 : 1) * (p.haste > 0 ? 1.4 : 1);
    /* ARCHERS ON THE PARAPET: a ranged hero may climb their own wall and
       shoot over it. Melee heroes cannot, and nobody crosses to the far
       side — wallPasses() enforces both, it just needs telling who is who. */
    p.__climber = hdR.range > 100;
    const perch = p.__climber ? foeWallAt(sim, p.team, p.x, p.y, 0) : null;
    p.__onWall = perch ? perch.seg : null;
    p.onWall = p.__onWall ? 1 : 0;
    const wasX = p.x, wasY = p.y;
    const pushing = !!(p.dir.x || p.dir.y || p.moveTo);
    if (p.dir.x || p.dir.y) {
      const m = Math.hypot(p.dir.x, p.dir.y) || 1;
      p.lastDir = { x: p.dir.x / m, y: p.dir.y / m };     /* remembered for LEAPS */
      slideMove(sim, p, p.x + (p.dir.x / m) * spd, p.y + (p.dir.y / m) * spd, hdR.r * 0.6);
      p.moveTo = null;
    } else if (p.moveTo) {
      const d = dist(p.x, p.y, p.moveTo.x, p.moveTo.y);
      if (d < spd * 1.5) p.moveTo = null;
      else {
        p.lastDir = { x: (p.moveTo.x - p.x) / d, y: (p.moveTo.y - p.y) / d };
        slideMove(sim, p, p.x + ((p.moveTo.x - p.x) / d) * spd, p.y + ((p.moveTo.y - p.y) / d) * spd, hdR.r * 0.6);
      }
    }
    /* did that actually get us anywhere? the robots read this to route around
       whatever is in their way (see stepBot) */
    if (pushing && dist(p.x, p.y, wasX, wasY) < spd * 0.3) p.stuckT = (p.stuckT || 0) + 1;
    else p.stuckT = 0;
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
    if (!Number.isFinite(p.coins)) p.coins = 0;          // self-heal any corrupted wallet
    if (!Number.isFinite(p.xp)) { p.xp = 0; }
    if (sim.tick % 10 === 0) p.coins += COIN_TRICKLE;

    /* auto-attack. A tapped FOCUS always wins if it is in reach; otherwise
       the old priority stands: creeps → rival heroes → neutrals → towers →
       buildings → their keep. */
    if (!p.atkCd || --p.atkCd <= 0) {
      const hd = heroDef(p);
      const opp = 1 - p.team;
      let best = null, bd = Infinity, kind = null;
      /* --- the thing the player actually tapped --- */
      const foc = resolveFocus(sim, p);
      if (foc) {
        const at = aimPoint(foc.what, p.x, p.y);
        const pad = foc.kind === 'tower' ? ETOWER.r
          : foc.kind === 'bld' ? (foc.what.type === 'wall' ? WALL.thick / 2 : BLD[foc.what.type].r) : 14;
        const d = dist(at.x, at.y, p.x, p.y);
        if (d <= hd.range + pad && !(foc.kind === 'creep' && creepDef(foc.what.team, foc.what.type).air && !hd.hitAir)) {
          best = foc.what; kind = foc.kind; bd = d;
        }
      }
      if (!best) {
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
          const at = aimPoint(b, p.x, p.y);
          const pad = b.type === 'wall' ? WALL.thick / 2 : BLD[b.type].r;
          const d = dist(at.x, at.y, p.x, p.y);
          if (d <= hd.range + pad && d < bd) { bd = d; best = b; kind = 'bld'; }
        }
        const oppBase = baseOf(opp);
        if (!best && !baseShielded(sim, opp) &&
            dist(p.x, p.y, oppBase.x, oppBase.y) <= hd.range + oppBase.r + 10) { best = oppBase; kind = 'base'; }
      }
      if (best) {
        const aimAt = kind === 'bld' ? aimPoint(best, p.x, p.y) : best;
        p.atkCd = Math.max(2, Math.round(hd.cd * (p.frenzy > 0 ? 0.5 : 1)));
        addFx(sim, hd.range > 100 ? 'pew' : 'slash', p.x, p.y, aimAt.x, aimAt.y);
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
          addFx(sim, 'hit', aimAt.x, aimAt.y);
          hurtBld(sim, best, dmg, p.id);
        }
        else hurtBase(sim, opp, dmg);
      }
    }
  }

  /* both bases march a column down EVERY lane, every six seconds, forever */
  if (--sim.spawnT <= 0) {
    sim.spawnT = SPAWN_EVERY;
    spawnGroups(sim);
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
        if (dist(e.x, e.y, im.x, im.y) > im.r) continue;
        hurtCreep(sim, e, im.dmg, im.owner);
        if (im.slow) applySlow(e, im.slow, im.slowT || 40);
      }
      const owner = im.owner ? sim.players.get(im.owner) : null;
      for (const q of oppHeroes(sim, im.team)) {
        if (dist(q.x, q.y, im.x, im.y) > im.r) continue;
        pvpHit(sim, q, im.dmg, owner);
        if (im.slow) applySlowHero(q, im.slow, im.slowT || 40);
      }
      for (const n of sim.neutrals) {
        if (dist(n.x, n.y, im.x, im.y) <= im.r && im.owner) hurtNeutral(sim, n, im.dmg, im.owner);
      }
      im.done = true;
    }
    if (im.kind === 'field' && sim.tick >= im.until) im.done = true;
  }
  sim.impacts = sim.impacts.filter((im) => !im.done);
  sim.enemies = sim.enemies.filter((e) => e.hp > 0);
  sim.allies = sim.allies.filter((a) => a.hp > 0);

  /* SOLID BODIES: nobody ends a tick standing inside anyone or anything */
  resolveCollisions(sim);
}

function snapshot(sim) {
  const pl = [];
  for (const id of sim.order) {
    const p = sim.players.get(id);
    const nextXp = p.lvl >= LVL_MAX ? 1 : XP_LVL[p.lvl - 1];
    const prevXp = p.lvl <= 1 ? 0 : XP_LVL[p.lvl - 2];
    pl.push([
      p.seat, p.hero ? HERO_IDX.indexOf(p.hero) : -1,
      Math.round(p.x), Math.round(p.y), Math.round(p.hp), p.maxhp,
      p.dead ? Math.max(1, p.respawn) : 0, p.coins,
      p.cds[0], p.cds[1], p.cds[2],
      p.lvl, p.kills, p.armor > 0 ? 1 : 0,
      p.up.dmg, p.up.hp, p.up.spd, p.up.pow,
      p.lvl >= LVL_MAX ? 100 : Math.round(((p.xp - prevXp) / (nextXp - prevXp)) * 100),
      p.team, p.onWall || 0,
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
  const b = sim.blds.filter((n) => n.type !== 'wall').map((n) => {
    const p = sim.players.get(n.owner);
    return [n.id, p ? p.seat : 0, BTYPE.indexOf(n.type), n.x, n.y, n.lvl,
            Math.round((n.hp / n.maxhp) * 100), n.boost > 0 ? 1 : 0, n.team,
            n.type === 'barracks' ? (n.wavesLeft || 0) : 0];
  });
  /* walls travel in their own lane of the snapshot: one row per wall, with
     every brick's centre and heading flattened onto the end */
  const w = sim.blds.filter((n) => n.type === 'wall' && n.segs).map((n) => {
    const p = sim.players.get(n.owner);
    const row = [n.id, p ? p.seat : 0, n.team, n.lvl, Math.round((n.hp / n.maxhp) * 100)];
    for (const s of n.segs) row.push(s.x, s.y, Math.round(s.a * 100) / 100);
    return row;
  });
  const eb = sim.etowers.map((t) => [t.id, t.x, t.y, Math.round((t.hp / t.maxhp) * 100)]);
  const pt = sim.ptowers.map((t) => [t.id, t.x, t.y, Math.round((t.hp / t.maxhp) * 100)]);
  const nn = sim.neutrals.map((n) => [n.id, NTYPE.indexOf(n.type), Math.round(n.x), Math.round(n.y), Math.round((n.hp / n.maxhp) * 100)]);
  const fields = sim.impacts.filter((im) => im.kind === 'field').map((im) => [im.x, im.y, im.r]);
  const snap = {
    k: 'snap', n: sim.tick, ph: sim.phase,
    pt: sim.phase === 'pick' ? sim.pickLeft : 0,
    ts: sim.teamSize, tsBots: botsNeeded(sim, sim.teamSize),
    clock: Math.floor(sim.tick / 10),
    c: [Math.round(sim.castle.hp), sim.castle.max],
    hb: [Math.round(sim.horde.hp), sim.horde.max],
    ap: [0, 1, 2],
    pl, e, a, b, w, eb, pt, nn, fields, fx: sim.fx,
  };
  /* what each hero has tapped, so both screens can ring the mark */
  snap.foc = [];
  for (const id of sim.order) {
    const q = sim.players.get(id);
    const f = q && resolveFocus(sim, q);
    if (!f) continue;
    const at = aimPoint(f.what, q.x, q.y);
    snap.foc.push([q.seat, Math.round(at.x), Math.round(at.y)]);
  }
  snap.chit = sim.tick - sim.castle.hitAt < 12 ? 1 : 0;
  snap.hhit = sim.tick - sim.horde.hitAt < 12 ? 1 : 0;
  snap.csh = baseShielded(sim, 0) ? 1 : 0;
  snap.hsh = baseShielded(sim, 1) ? 1 : 0;
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

  /* soda springs — pastel pools that mend anyone who wades in */
  for (const sp of world.springs) {
    g.save(); g.translate(sp.x, sp.y);
    g.fillStyle = '#fdeff5';
    g.beginPath(); g.ellipse(0, 0, 128, 96, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e8a7c3'; g.lineWidth = 10;
    g.beginPath(); g.ellipse(0, 0, 128, 96, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f9c8dd';
    g.beginPath(); g.ellipse(0, 0, 92, 66, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    for (const [bx, by, br] of [[-40, -18, 9], [26, 10, 12], [-6, 30, 7], [42, -28, 8]]) {
      g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#e86a9a'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('💗', 0, -2);
    g.restore();
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

/* ---------------- the Gumdrop Wall ----------------
   One row per wall, bricks flattened on the end: [id, seat, team, lvl, hp%,
   x,y,a, x,y,a, ...]. Drawn brick by brick so a snaking wall reads as one
   continuous rampart with battlements along the top. */
function drawWall(g, row, seats, z, now) {
  const [, seat, team, lvl, hpPct] = row;
  const horde = team === 1;
  const s = seats[seat];
  const color = s ? s.color : '#cccccc';
  const BRICK = horde ? '#5a4468' : '#ffe3c4';
  const MORTAR = horde ? '#39294a' : '#e0b48c';
  const ink = horde ? '#241a30' : shade(color, 0.65);
  const hurt = hpPct < 100;
  const segs = [];
  for (let i = 5; i + 2 < row.length; i += 3) segs.push({ x: row[i], y: row[i + 1], a: row[i + 2] });
  if (!segs.length) return;

  const half = WALL.half, th = WALL.thick;
  for (const seg of segs) {
    g.save(); g.translate(seg.x, seg.y); g.rotate(seg.a);
    /* shadow on the ground */
    g.fillStyle = 'rgba(40,20,50,.20)';
    rr(g, -half, -th / 2 + 7, half * 2, th, 7); g.fill();
    /* the slab */
    g.fillStyle = BRICK;
    g.strokeStyle = ink; g.lineWidth = 3;
    rr(g, -half, -th / 2, half * 2, th, 6); g.fill(); g.stroke();
    /* courses of candy brick */
    g.strokeStyle = MORTAR; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-half, 0); g.lineTo(half, 0); g.stroke();
    for (const bx of [-half / 2, 0, half / 2]) {
      g.beginPath(); g.moveTo(bx, -th / 2); g.lineTo(bx, 0); g.stroke();
    }
    for (const bx of [-half * 0.75, -half * 0.25, half * 0.25, half * 0.75]) {
      g.beginPath(); g.moveTo(bx, 0); g.lineTo(bx, th / 2); g.stroke();
    }
    /* battlements along the top edge, in the owner's colour */
    g.fillStyle = color; g.strokeStyle = ink; g.lineWidth = 2;
    for (let bx = -half + 8; bx < half - 6; bx += 18) {
      rr(g, bx, -th / 2 - 7, 10, 8, 2); g.fill(); g.stroke();
    }
    if (hurt) {                                    /* cracks as it gets chewed */
      g.strokeStyle = `rgba(60,20,40,${0.25 + (1 - hpPct / 100) * 0.5})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-half * 0.4, -th / 2); g.lineTo(-half * 0.15, 2); g.lineTo(-half * 0.3, th / 2);
      g.stroke();
    }
    g.restore();
  }
  /* one health bar and one level pip cluster, over the middle of the run */
  const mid = segs[(segs.length / 2) | 0];
  const k = upscale(z);
  g.save(); g.translate(mid.x, mid.y); g.scale(k, k);
  if (horde) {
    const pulse = 0.6 + Math.sin(now * 0.006 + mid.x) * 0.3;
    g.fillStyle = `rgba(255,92,138,${pulse})`;
    g.beginPath(); g.moveTo(0, -34); g.lineTo(4, -26); g.lineTo(0, -22); g.lineTo(-4, -26); g.closePath(); g.fill();
  }
  if (hpPct < 100) hpBar(g, 0, 26, 58, hpPct / 100);
  if (lvl > 1) {
    g.fillStyle = horde ? '#c95cff' : '#ffd93d'; g.strokeStyle = '#b98a13'; g.lineWidth = 1.5;
    for (let i = 0; i < lvl; i++) {
      g.beginPath(); g.arc(-((lvl - 1) * 5.5) + i * 11, -40, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }
  g.restore();
}

function drawBld(g, row, seats, z, now) {
  const [, seat, tIdx, x, y, lvl, hpPct, boosted] = row;
  const horde = row[8] === 1;                            /* hard-candy side builds DARK */
  const BODY = horde ? '#4b3a58' : '#fff0dd';            /* cream walls → obsidian candy */
  const PANEL = horde ? '#6b4f86' : '#fdfdfb';
  const TENT = horde ? '#3d2f4d' : '#fff8f0';
  const GOLD = horde ? '#c95cff' : '#ffd93d';            /* gilding → glowing crystal */
  const type = BTYPE[tIdx];
  const s = seats[seat];
  const color = s ? s.color : '#cccccc';
  const dark = horde ? '#241a30' : shade(color, 0.7);
  const k = upscale(z);
  g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = 'rgba(40,20,50,.18)';                      /* ground shadow */
  g.beginPath(); g.ellipse(0, 26, 34, 11, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = dark; g.lineWidth = 3;

  if (type === 'turret') {
    /* tapered candy tower with an owner-colored gumball dome */
    g.fillStyle = BODY;
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
  } else if (type === 'mortar') {
    /* marshmallow pot with a big lobber tube */
    g.fillStyle = BODY;
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
    g.fillStyle = PANEL;                               /* marshmallow ammo */
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
    g.fillStyle = TENT;                               /* door flap */
    g.beginPath(); g.moveTo(-9, 22); g.lineTo(0, 4); g.lineTo(9, 22); g.closePath(); g.fill(); g.stroke();
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -26); g.lineTo(0, -40); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, -40); g.lineTo(15, -35); g.lineTo(0, -30); g.closePath(); g.fill(); g.stroke();
  } else if (type === 'decoy') {
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

  if (horde) {                                           /* rock-candy beacon */
    const pulse = 0.6 + Math.sin(now * 0.006 + x) * 0.3;
    g.fillStyle = `rgba(255,92,138,${pulse})`;
    g.beginPath(); g.moveTo(0, -34); g.lineTo(4, -26); g.lineTo(0, -22); g.lineTo(-4, -26); g.closePath(); g.fill();
  }
  if (boosted) {
    g.strokeStyle = GOLD; g.lineWidth = 3.5; g.setLineDash([8, 6]); g.lineDashOffset = -(now * 0.05) % 14;
    g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }
  if (hpPct < 100) hpBar(g, 0, 30, 52, hpPct / 100);
  if (lvl > 1) {
    g.fillStyle = GOLD; g.strokeStyle = '#b98a13'; g.lineWidth = 1.5;
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
  } else if (type === 'imp') {
    g.rotate(Math.sin(w * 5) * 0.07);
    g.fillStyle = '#6b4f86';
    g.beginPath(); g.arc(-5.5, -7, 3, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(5.5, -7, 3, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(0, 0, 8.5, Math.PI, 0); g.lineTo(8.5, 5); g.quadraticCurveTo(0, 9.5, -8.5, 5);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#c95cff';
    g.beginPath(); g.moveTo(-6, -8); g.lineTo(-8, -13); g.lineTo(-3, -9); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(6, -8); g.lineTo(8, -13); g.lineTo(3, -9); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.3)';
    g.beginPath(); g.arc(-3, -3, 2.5, 0, Math.PI * 2); g.fill();
    face(g, 0, -1, 0.75, 'angry');
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

  /* body: color dome + skirt — the hard-candy side wears it DARK */
  const hordeSide = HEROES[heroIdx].team === 1;
  if (hordeSide) { g.strokeStyle = '#241a30'; }
  g.fillStyle = hordeSide ? shade(color, 0.55) : color;
  g.beginPath(); g.arc(0, 2, 12, Math.PI, 0); g.lineTo(12, 8); g.quadraticCurveTo(0, 13, -12, 8);
  g.closePath(); g.fill(); g.stroke();
  if (hordeSide) {                                         /* crystal shards on the shoulders */
    g.fillStyle = '#c95cff';
    g.beginPath(); g.moveTo(-12, 2); g.lineTo(-16, -6); g.lineTo(-9, -2); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(12, 2); g.lineTo(16, -6); g.lineTo(9, -2); g.closePath(); g.fill(); g.stroke();
  }
  /* head: warm gingerbread vs dusky rock-candy */
  g.fillStyle = hordeSide ? '#b9a8cc' : '#ffe1bd';
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
    } else if (f.t === 'lasthit') {
      /* the money shot: a fat coin pop so kids learn to chase the killing blow */
      g.font = `${Math.max(24, 28 / z)}px sans-serif`; g.textAlign = 'center';
      g.globalAlpha = 1 - k * 0.8;
      g.fillText('🪙', 0, -10 - k * 58);
      g.strokeStyle = '#ffd93d'; g.lineWidth = lw * 1.4;
      g.beginPath(); g.arc(0, 0, 10 + k * 42, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
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

/* the "dismantle my ring first" shield bubble around a protected base */
function drawBaseShield(g, x, y, r, color, now) {
  g.save(); g.translate(x, y);
  g.globalAlpha = 0.55 + Math.sin(now * 0.004) * 0.12;
  g.strokeStyle = color; g.lineWidth = 10;
  g.setLineDash([34, 22]); g.lineDashOffset = -(now * 0.02) % 56;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 0.1;
  g.fillStyle = color;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.restore();
}

/* one full frame from a snapshot — both screens use this */
function drawScene(g, world, snap, seats, now, z, mySeat, fogCache) {
  drawTerrain(g, world, snap.ap, now);
  drawFields(g, snap.fields || [], now);
  drawCastleAt(g, world.castle.x, world.castle.y, snap.c[0], snap.c[1], snap.chit, now);
  drawHordeBase(g, world.horde.x, world.horde.y, snap.hb[0], snap.hb[1], snap.hhit, now);
  for (const sp of world.springs) {                  /* live shimmer on the pools */
    g.save(); g.translate(sp.x, sp.y);
    g.globalAlpha = 0.35 + Math.sin(now * 0.003 + sp.x) * 0.15;
    g.strokeStyle = '#ff9fc6'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(0, 0, SPRING_R * 0.86, SPRING_R * 0.64, 0, 0, Math.PI * 2); g.stroke();
    g.restore();
    g.globalAlpha = 1;
  }
  if (snap.csh) drawBaseShield(g, world.castle.x, world.castle.y, CASTLE.r * 1.9, '#7fd8ff', now);
  if (snap.hsh) drawBaseShield(g, world.horde.x, world.horde.y, HORDE.r * 1.75, '#c95cff', now);
  for (const t of snap.eb || []) drawETower(g, t, z, now, false);
  for (const t of snap.pt || []) drawETower(g, t, z, now, true);
  for (const w of snap.w || []) drawWall(g, w, seats, z, now);
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
  /* the mark each hero tapped — a spinning reticle so you can SEE the order
     landed, and whose order it is */
  for (const f of snap.foc || []) {
    const s = seats[f[0]];
    const mine = mySeat !== undefined && f[0] === mySeat;
    g.save(); g.translate(f[1], f[2]); g.rotate((now * 0.0016) % (Math.PI * 2));
    g.strokeStyle = s ? s.color : '#ffd93d';
    g.lineWidth = mine ? 4.5 : 3;
    g.globalAlpha = mine ? 0.95 : 0.55;
    const r = mine ? 30 : 25;
    for (let q = 0; q < 4; q++) {
      g.beginPath();
      g.arc(0, 0, r, q * (Math.PI / 2) + 0.25, q * (Math.PI / 2) + Math.PI / 2 - 0.25);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();
  }
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
    <div class="gg-sizebar">
      <span class="gg-sizelabel">Team size</span>
      <div class="gg-sizebtns"></div>
      <span class="gg-sizenote"></span>
    </div>
    <div class="gg-pickgrid"></div>
  </div>
  <div class="gg-over hidden"></div>
</div>`;

function createHost(ctx) {
  let sim, timer = 0, raf = 0;
  let prev = null, cur = null;
  let fxLive = [];
  let canvas, g, cam = { x: 0, y: 0, z: 0.2, tz: 0.2 };
  let dragging = null, lastPhase = '', lastTowers = [-1, -1], lastPlayerN = 0;
  const seenEHeroes = new Set();
  const fogCache = { v: -1, cnv: null };
  let onResize;

  function seats() {
    const arr = [];
    for (const p of ctx.players()) {
      const sp = sim.players.get(p.id);
      if (sp) arr[sp.seat] = { name: p.name, avatar: p.avatar, color: p.color, connected: p.connected };
    }
    for (const sp of sim.players.values()) {
      if (sp.bot) arr[sp.seat] = { name: sp.botName, avatar: '🤖', color: sp.botColor, connected: true, bot: true };
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
      ctx.sendTo(playerId, { ...msg, mySeat: sp ? sp.seat : -1, isHost: playerId === ctx.hostPlayerId() });
    } else {
      for (const p of ctx.players()) {
        const sp = sim.players.get(p.id);
        ctx.sendTo(p.id, { ...msg, mySeat: sp ? sp.seat : -1, isHost: p.id === ctx.hostPlayerId() });
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
    if (sim.players.size !== lastPlayerN) { lastPlayerN = sim.players.size; sendInit(); }
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
    /* HOST PICKS THE TEAM SIZE. Robots fill whatever the humans don't.
       Clicked straight on the sim — the host owns it, nothing to send. */
    const sizeWrap = ctx.root.querySelector('.gg-sizebtns');
    sizeWrap.innerHTML = '';
    for (let n = 1; n <= TEAM_SIZE_MAX; n++) {
      const b = document.createElement('button');
      b.className = 'gg-sizebtn';
      b.dataset.size = String(n);
      b.textContent = `${n}v${n}`;
      b.addEventListener('click', () => {
        if (!sim || sim.phase !== 'pick') return;
        sim.teamSize = n;
        paintSizes();
      });
      sizeWrap.appendChild(b);
    }
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
    if (snap.ph === 'pick') paintSizes(snap);
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
      const hero = (r[1] >= 0 ? HEROES[r[1]].emoji : '❔') + (TEAM_EMOJI[r[19]] || '') + (s.bot ? '🤖' : '');
      const status = r[6] > 0 ? ` · 😵 ${Math.ceil(r[6] / 10)}s` : ` · Lv ${r[11]}`;
      return `<div class="gg-chip ${s.connected ? '' : 'gg-chip-off'}" style="border-color:${s.color}">
        <span class="gg-chip-hero">${hero}</span>
        <span class="gg-chip-text">
          <span class="gg-chip-name">${escapeHtml(s.name)}</span>
          <span class="gg-chip-meta">🪙${r[7]} · ⚔️${r[12]}${status}</span>
        </span>
      </div>`;
    }).join('');

    /* event banners: match start, towers falling, enemy heroes arriving */
    if (snap.ph !== lastPhase && snap.ph === 'play') {
      banner(`<b>MARCH! ⚔️</b><span>Destroy the Rock Candy Cavern before it destroys the castle!</span>`, 4000);
    }
    lastPhase = snap.ph;
    const nE = (snap.eb || []).length, nP = (snap.pt || []).length;
    if (lastTowers[1] >= 0 && nE < lastTowers[1]) banner(`<b>TOWER CAPTURED! 🍬</b><span>A horde tower now fights for the ${TEAM_NAME[0]}!</span>`);
    if (lastTowers[0] >= 0 && nP < lastTowers[0]) banner(`<b>TOWER CAPTURED! 👹</b><span>A gummi tower now fights for the ${TEAM_NAME[1]}!</span>`);
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

  /* highlight the chosen size and spell out what it means in robots */
  function paintSizes(snap) {
    const size = snap ? snap.ts : (sim ? sim.teamSize : TEAM_SIZE_DEFAULT);
    const bots = snap ? snap.tsBots : (sim ? botsNeeded(sim, sim.teamSize) : 0);
    for (const b of ctx.root.querySelectorAll('.gg-sizebtn')) {
      b.classList.toggle('gg-sizebtn-on', +b.dataset.size === size);
    }
    const note = ctx.root.querySelector('.gg-sizenote');
    if (note) {
      note.textContent = bots > 0
        ? `🤖 ${bots} robot${bots === 1 ? '' : 's'} will fill the empty chairs`
        : 'every chair taken by a person';
    }
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
      case 'size':
        if (playerId === ctx.hostPlayerId() && sim.phase === 'pick') {
          sim.teamSize = clamp(data.n | 0, 1, TEAM_SIZE_MAX);
          paintSizes();
        }
        break;
      case 'mv': p.dir = { x: +data.x || 0, y: +data.y || 0 }; break;
      case 'ab':
        castAbility(sim, playerId, clamp(data.i | 0, 0, 2),
                    { x: +data.ax || 0, y: +data.ay || 0 });
        break;
      case 'walk':
        if (sim.phase === 'play' && p.hero && !p.dead) p.moveTo = { x: +data.x || 0, y: +data.y || 0 };
        break;
      case 'build': {
        const res = build(sim, playerId, data.type, +data.x || 0, +data.y || 0);
        if (res === 'coins') ctx.sendTo(playerId, { k: 'toast', msg: 'Not enough coins! 🪙' });
        else if (res === 'fog') ctx.sendTo(playerId, { k: 'toast', msg: '🌫️ Unexplored! Walk a hero out there to scout it first' });
        else if (res === 'spot') ctx.sendTo(playerId, { k: 'toast', msg: "Can't build there — too close to a lane or building" });
        else if (res === 'far') ctx.sendTo(playerId, { k: 'toast', msg: '📏 Too far! You can only build near your hero' });
        else if (res === 'dead') ctx.sendTo(playerId, { k: 'toast', msg: "💀 You're down — no building until you respawn" });
        else if (res === 'full') ctx.sendTo(playerId, { k: 'toast', msg: `🏗️ ${MAX_BLD}-building limit — sell one first` });
        else if (res === 'bmax') ctx.sendTo(playerId, { k: 'toast', msg: `🏕️ ${BLD.barracks.maxOwn} barracks max — sell or lose one first` });
        else if (res === 'bcool') {
          const p2 = sim.players.get(playerId);
          const left = Math.ceil((BLD.barracks.buildCd - (sim.tick - (p2.barracksAt || 0))) / 10);
          ctx.sendTo(playerId, { k: 'toast', msg: `🏕️ Barracks cooling down — ${left}s until you can build another` });
        }
        break;
      }
      case 'up': upgradeHero(sim, playerId, data.what); break;
      case 'bup': {
        const res = upgradeBld(sim, playerId, data.id | 0);
        if (res === 'coins') ctx.sendTo(playerId, { k: 'toast', msg: 'Not enough coins! 🪙' });
        else if (res === 'far') ctx.sendTo(playerId, { k: 'toast', msg: '🧱 Walk to the END of the wall to extend it' });
        else if (res === 'spot') ctx.sendTo(playerId, { k: 'toast', msg: "🧱 The wall's line is blocked — nowhere straight ahead to build" });
        else if (res === 'busy') ctx.sendTo(playerId, { k: 'toast', msg: '🏕️ Still marching gummies out — upgrade reloads it once it runs empty' });
        break;
      }
      case 'sell': sellBld(sim, playerId, data.id | 0); break;
      /* the player poked something on their map: make it the hero's mark */
      case 'target': {
        const f = setFocus(sim, playerId, +data.x || 0, +data.y || 0);
        if (!f) ctx.sendTo(playerId, { k: 'toast', msg: '🎯 Target cleared' });
        break;
      }
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
    <div class="gg-csizes hidden">
      <span class="gg-csizes-lbl">Match size (you're the host):</span>
      <div class="gg-csizes-row"></div>
      <span class="gg-csizes-note"></span>
    </div>
    <div class="gg-cpick-grid"></div>
  </div>

  <!-- in-game -->
  <div class="gg-cgame hidden">
    <div class="gg-cstatus">
      <button class="gg-shopbtn">🎒</button>
      <span class="gg-cs-wave"></span>
      <span class="gg-cs-lvl"></span>
      <span class="gg-cs-coins"></span>
      <div class="gg-cs-hpwrap"><div class="gg-cs-hp"></div><div class="gg-cs-xp"></div></div>
      <button class="gg-homebtn hidden" title="End the game for everyone">⌂</button>
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
  let focusBld = null;               // building card the player tapped to FIND
  let cam = { x: 0, y: 0, z: 0.1 };
  let mapCam = null;                 // pan/zoom for prep map { x, y, z }
  let stick = null;                  // active joystick touch
  let lastMv = 0, lastSent = '0,0';
  let aim = { x: 0, y: 0 };          // live stick vector, sent with every power
  let myHero = null, myTeam = 0;
  let touch = null;                  // prep map pan/pinch state
  let onResize, ro = null;
  let fog = null, fogVSeen = -1;
  const fogCache = { v: -1, cnv: null };
  let isPartyHost = false, sizeSel = TEAM_SIZE_DEFAULT, sizeBots = -1;

  /* host-only 1v1…6v6 picker on the phone; everyone else just picks a hero */
  function renderSizes() {
    const wrap = ctx.root.querySelector('.gg-csizes');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !isPartyHost);
    if (!isPartyHost) return;
    const row = wrap.querySelector('.gg-csizes-row');
    if (!row.children.length) {
      row.innerHTML = Array.from({ length: TEAM_SIZE_MAX }, (_, i) =>
        `<button class="gg-csize" data-n="${i + 1}">${i + 1}v${i + 1}</button>`).join('');
      for (const b of row.querySelectorAll('.gg-csize')) {
        b.addEventListener('click', () => {
          sizeSel = +b.dataset.n;
          ctx.send({ k: 'size', n: sizeSel });
          renderSizes();
        });
      }
    }
    for (const b of row.querySelectorAll('.gg-csize')) {
      b.classList.toggle('gg-csize-on', +b.dataset.n === sizeSel);
    }
    wrap.querySelector('.gg-csizes-note').textContent =
      sizeBots > 0 ? `🤖 ${sizeBots} robot${sizeBots === 1 ? '' : 's'} will fill the empty chairs`
      : sizeBots === 0 ? 'every chair taken by a person' : '';
  }

  const $q = (s) => ctx.root.querySelector(s);
  const disc0 = () => (myHero && myHero.discount ? myHero.discount : 1);

  function start() {
    ctx.root.innerHTML = CTRL_HTML;
    canvas = $q('.gg-cmap');
    g = canvas.getContext('2d');

    /* the host's ⌂ in the status row clicks the shell's End-game button
       through (its confirm dialog does the asking); the header copy hides
       while the game runs so there's only one, well-placed way out */
    document.getElementById('ctrl-host-exit')?.classList.add('gg-hide-shell-exit');
    $q('.gg-homebtn').addEventListener('click', () =>
      document.getElementById('ctrl-host-exit')?.click());

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
    const move = (t, force) => {
      if (!stick) return;
      let dx = t.clientX - stick.x, dy = t.clientY - stick.y;
      const m = Math.hypot(dx, dy);
      if (m > 56) { dx = (dx / m) * 56; dy = (dy / m) * 56; }
      nub.style.transform = `translate(${dx}px,${dy}px)`;
      const nx = +(dx / 56).toFixed(2), ny = +(dy / 56).toFixed(2);
      aim = { x: nx, y: ny };                    /* powers read this, not the network */
      const key = `${nx},${ny}`;
      const now = performance.now();
      /* the FIRST push always goes out at once — a throttled opening frame is
         the difference between charging where you meant and charging nowhere */
      if (key !== lastSent && (force || now - lastMv > 80)) {
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
      move(t, true);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (stick && t.identifier === stick.id) move(t);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (stick && t.identifier === stick.id) {
        stick = null; lastSent = '0,0'; aim = { x: 0, y: 0 };
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
        stick = null; lastSent = '0,0'; aim = { x: 0, y: 0 };
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
      /* in PLAY mode a tap is an attack order, so let it through */
      if (mode === 'play') {
        const t = e.changedTouches[0];
        touch = { m: 'aim', x0: t.clientX, y0: t.clientY, moved: 0, x: t.clientX, y: t.clientY };
        return;
      }
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
      if (!touch) return;
      if (touch.m === 'aim') {
        const t = e.changedTouches[0];
        touch.moved += Math.abs(t.clientX - touch.x) + Math.abs(t.clientY - touch.y);
        touch.x = t.clientX; touch.y = t.clientY;
        return;
      }
      if (mode !== 'panel') return;
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
      if (!touch) return;
      if (touch.m === 'aim') {
        if (touch.moved < 16) aimTap(touch.x0, touch.y0);
        touch = null;
        return;
      }
      if (mode !== 'panel') return;
      if (touch.m === 'pan' && touch.moved < 14) mapTap(touch.x0, touch.y0);
      if (!e.touches.length) touch = null;
    });
    canvas.addEventListener('click', (e) => {      // desktop testing
      if (mode === 'panel') mapTap(e.clientX, e.clientY);
      else if (mode === 'play') aimTap(e.clientX, e.clientY);
    });
  }

  /* TAP TO ATTACK — poke a creep, a hero, a tower or a building on the live
     map and your hero swings at THAT until it dies. Tap bare ground to let
     them go back to hitting whatever is closest. */
  function aimTap(px, py) {
    const w = screenToWorld(px, py);
    ctx.send({ k: 'target', x: Math.round(w.x), y: Math.round(w.y) });
    fxLive.push({ t: 'trap', x: w.x, y: w.y, r: 46, t0: performance.now() });
  }

  function mapTap(px, py) {
    const w = screenToWorld(px, py);
    if (placing) { placing.x = w.x; placing.y = w.y; return; }
    if (tab === 'map') {
      ctx.send({ k: 'walk', x: Math.round(w.x), y: Math.round(w.y) });
      fxLive.push({ t: 'built', x: w.x, y: w.y, t0: performance.now() });
    } else {
      ctx.send({ k: 'target', x: Math.round(w.x), y: Math.round(w.y) });
    }
  }

  /* drop the ghost on a legal spot right next to the hero, so "Place"
     works immediately and the player can see what they're doing */
  function autoAim() {
    if (!placing || !cur || !world) return;
    const me = myRow(cur.snap);
    const hx = me ? me[2] : 0, hy = me ? me[3] : 0;
    placing.x = hx; placing.y = hy + 90;
    outer: for (let r = 90; r <= BUILD_R; r += 50) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = hx + Math.cos(a) * r, y = hy + Math.sin(a) * r;
        if (canPlace(world, cur.snap.b, x, y, fog, placing.type, snapSegs(cur.snap))) { placing.x = x; placing.y = y; break outer; }
      }
    }
    /* zoom the build map in on the ghost so it's big and tappable */
    mapCam = mapCam || { x: 0, y: 0, z: fitZoom(canvas.width, canvas.height) };
    mapCam.x = placing.x; mapCam.y = placing.y;
    mapCam.z = Math.max(mapCam.z, Math.min(canvas.width, canvas.height) / 1400);
  }

  /* every wall brick on the field, rebuilt from the snapshot, so the phone
     can run the SAME placement rules the host will run */
  function snapSegs(snap) {
    const out = [];
    for (const row of snap.w || []) {
      for (let i = 5; i + 2 < row.length; i += 3) out.push({ x: row[i], y: row[i + 1], a: row[i + 2] });
    }
    return out;
  }

  /* ---------- messages from the host ---------- */
  function onMessage(data) {
    if (data.k === 'init') {
      world = buildWorld(data.seed);
      seats = data.seats || [];
      if (data.mySeat !== undefined) mySeat = data.mySeat;
      if (data.isHost !== undefined) {
        isPartyHost = !!data.isHost;
        renderSizes();
        const hb = $q('.gg-homebtn'); if (hb) hb.classList.toggle('hidden', !isPartyHost);
        document.getElementById('ctrl-host-exit')?.classList.add('gg-hide-shell-exit');
      }
      return;
    }
    if (data.k === 'toast') { toast(data.msg); return; }
    if (data.k !== 'snap') return;
    if (data.fog && data.fogV !== fogVSeen) { fogVSeen = data.fogV; fog = unpackFog(data.fog); }
    prev = cur;
    cur = { at: performance.now(), snap: data };
    if (data.ph === 'pick' && (data.ts !== sizeSel || data.tsBots !== sizeBots)) {
      sizeSel = data.ts; sizeBots = data.tsBots; renderSizes();
    }
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
      const me0 = cur && myRow(cur.snap);
      mapCam = me0
        ? { x: me0[2], y: me0[3], z: Math.min(1.1, fitZoom(canvas.width, canvas.height) * 3) }
        : { x: 0, y: 0, z: fitZoom(canvas.width, canvas.height) };
    }
    if (mode === 'panel' && !placing) { updateHud.sig = null; renderTabs(); }
    if (mode === 'over') showOver(snap);
    requestAnimationFrame(onResize);
  }

  /* highlight the chosen size and spell out what it means in robots */
  function paintSizes(snap) {
    const size = snap ? snap.ts : (sim ? sim.teamSize : TEAM_SIZE_DEFAULT);
    const bots = snap ? snap.tsBots : (sim ? botsNeeded(sim, sim.teamSize) : 0);
    for (const b of ctx.root.querySelectorAll('.gg-sizebtn')) {
      b.classList.toggle('gg-sizebtn-on', +b.dataset.size === size);
    }
    const note = ctx.root.querySelector('.gg-sizenote');
    if (note) {
      note.textContent = bots > 0
        ? `🤖 ${bots} robot${bots === 1 ? '' : 's'} will fill the empty chairs`
        : 'every chair taken by a person';
    }
  }

  function showOver(snap) {
    const el = $q('.gg-cover');
    el.classList.remove('hidden');
    $q('.gg-wavehud').classList.add('hidden');
    $q('.gg-prep').classList.add('hidden');
    const me = myRow(snap);
    const won = me && me[19] === snap.over;
    const hint = '<p class="gg-over-hint">Party host: tap <b>⌂ End game</b> at the top to send everyone back to the menu.</p>';
    el.innerHTML = (won
      ? `<h1>🏆</h1><p>VICTORY for the ${TEAM_NAME[snap.over]}!</p>`
      : `<h1>💔</h1><p>The ${TEAM_NAME[snap.over]} won this one.<br>Watch the big screen!</p>`) + hint;
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
      const sig = tab + '|' + me[7] + '|' + me[11] + '|' + me.slice(14).join(',') + '|' + focusBld + '|' +
        snap.b.filter((r) => r[1] === mySeat).map((r) => `${r[0]}:${r[5]}:${r[6]}:${r[9] || 0}`).join(',') + '|' +
        (snap.w || []).filter((r) => r[1] === mySeat).map((r) => `${r[0]}:${r[3]}:${r[4]}:${r.length}`).join(',');
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
      /* FIRE ON TOUCH, not on click. A `click` is only synthesised after a
         clean press-and-release, and a browser will happily skip it when
         another finger is already down and the joystick is calling
         preventDefault on its own touchmove stream — which is exactly the
         situation every time you try to Shield Charge in the direction you
         are running. Binding touchstart means the power fires the instant
         your thumb lands, with the stick still held and p.dir still live. */
      for (const b of wrap.querySelectorAll('.gg-ab')) {
        const fire = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          /* carry the stick vector along so the aim can never be a frame
             behind the press — the host does not have to guess */
          ctx.send({ k: 'ab', i: +b.dataset.i, ax: aim.x, ay: aim.y });
          /* preventDefault can swallow :active, so flash the button ourselves —
             a power that fires with no feedback feels broken to a seven-year-old */
          b.classList.add('gg-ab-hit');
          clearTimeout(b.__flash);
          b.__flash = setTimeout(() => b.classList.remove('gg-ab-hit'), 140);
        };
        b.addEventListener('touchstart', fire, { passive: false });
        b.addEventListener('mousedown', fire);       /* desktop testing */
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
      /* every structure this player owns — point buildings AND walls, sorted
         so the list order is stable while you scroll it */
      const mine = [
        ...snap.b.filter((r) => r[1] === mySeat && BTYPE[r[2]] !== 'decoy')
          .map((r) => ({ id: r[0], type: BTYPE[r[2]], x: r[3], y: r[4], lvl: r[5], hp: r[6], waves: r[9] || 0 })),
        ...(snap.w || []).filter((r) => r[1] === mySeat)
          .map((r) => ({ id: r[0], type: 'wall', x: r[5], y: r[6], lvl: r[3], hp: r[4],
                         segs: (r.length - 5) / 3 })),
      ].sort((a, b) => a.id - b.id);
      const head = `<p class="gg-empty"><small>🏗️ ${mine.length}/${MAX_BLD} buildings · tap a card to FIND it on the map</small></p>`;
      body.innerHTML = mine.length ? head + mine.map((r) => {
        const def = BLD[r.type];
        const maxed = r.lvl >= BUP.max, cost = bupCost(r.lvl);
        const isWall = r.type === 'wall';
        /* what a quarter-refund actually pays back, upgrades included */
        let paid = Math.round(def.cost * disc0());
        for (let l = 1; l < r.lvl; l++) paid += bupCost(l);
        const refund = Math.round(paid * SELL_BACK);
        const sub = isWall ? `Level ${r.lvl} · ${r.segs} bricks · ${r.hp}% HP`
          : r.type === 'barracks' ? `Level ${r.lvl} · ${r.waves} waves left · ${r.hp}% HP`
          : `Level ${r.lvl} · ${r.hp}% HP`;
        const busy = r.type === 'barracks' && r.waves > 0;
        const upLabel = maxed ? 'MAX'
          : isWall ? `🧱 +${WALL.perLvl} 🪙${cost}`
          : r.type === 'barracks' ? (busy ? `⏳ ${r.waves} left` : `🔄 reload 🪙${cost}`)
          : `⬆️ 🪙${cost}`;
        return `<div class="gg-uprow gg-bldcard${focusBld === r.id ? ' gg-bldcard-on' : ''}" data-find="${r.id}" data-fx="${r.x}" data-fy="${r.y}">
          <span class="gg-up-emoji">${def.emoji}</span>
          <span class="gg-up-info"><b>${def.label}</b><small>${sub}</small></span>
          <button class="gg-buy" data-bup="${r.id}" ${maxed || busy || coins < cost ? 'disabled' : ''}>${upLabel}</button>
          <button class="gg-sell" data-sell="${r.id}" title="Sell for ${refund}">💰${refund}</button>
        </div>`;
      }).join('') : `<p class="gg-empty">No buildings yet — hit the 🔨 Build tab!<br><small>Only YOU can upgrade what you build.</small></p>`;
      /* TAP A CARD TO FIND IT: snaps the map onto that building and rings it,
         so nobody has to guess which of six turrets they are upgrading */
      for (const c of body.querySelectorAll('[data-find]')) {
        c.addEventListener('click', (ev) => {
          if (ev.target.closest('button')) return;      /* the buttons do their own job */
          focusBld = +c.dataset.find;
          mapCam = mapCam || { x: 0, y: 0, z: fitZoom(canvas.width, canvas.height) };
          mapCam.x = +c.dataset.fx; mapCam.y = +c.dataset.fy;
          mapCam.z = Math.max(mapCam.z, Math.min(canvas.width, canvas.height) / 1500);
          updateHud.sig = null; renderTabs();
        });
      }
      for (const b of body.querySelectorAll('[data-bup]')) {
        b.addEventListener('click', () => { focusBld = +b.dataset.bup; ctx.send({ k: 'bup', id: +b.dataset.bup }); });
      }
      for (const b of body.querySelectorAll('[data-sell]')) {
        b.addEventListener('click', () => { if (focusBld === +b.dataset.sell) focusBld = null; ctx.send({ k: 'sell', id: +b.dataset.sell }); });
      }
    } else if (tab === 'build') {
      const disc = disc0();
      const owned = (snap.b.filter((r) => r[1] === mySeat && BTYPE[r[2]] !== 'decoy').length)
        + ((snap.w || []).filter((r) => r[1] === mySeat).length);
      const full = owned >= MAX_BLD;
      const myBarracks = snap.b.filter((r) => r[1] === mySeat && BTYPE[r[2]] === 'barracks').length;
      body.innerHTML = `<p class="gg-empty"><small>1️⃣ Tap a building &nbsp;2️⃣ Tap the map to aim &nbsp;3️⃣ Hit 🔨 Place<br>
        🏗️ ${owned}/${MAX_BLD} used${full ? ' — sell one to build again' : ''}</small></p>` + BUILDABLE.map((t) => {
        const def = BLD[t], cost = Math.round(def.cost * disc);
        const atCap = t === 'barracks' && myBarracks >= BLD.barracks.maxOwn;
        const tag = t === 'barracks' ? ` · ${myBarracks}/${BLD.barracks.maxOwn}` : '';
        return `<button class="gg-bcard" data-build="${t}" ${full || atCap || coins < cost ? 'disabled' : ''}>
          <span class="gg-bcard-emoji">${def.emoji}</span>
          <span class="gg-bcard-info"><b>${def.label}${tag}</b><small>${def.desc}</small></span>
          <span class="gg-bcard-cost">🪙 ${cost}</span>
        </button>`;
      }).join('') + (disc < 1 ? `<p class="gg-empty"><small>🔧 Greta's discount applied!</small></p>` : '');
      for (const b of body.querySelectorAll('[data-build]')) {
        b.addEventListener('click', () => {
          const me1 = cur && myRow(cur.snap);
          if (me1 && me1[6] > 0) { toast("💀 You're down — no building until you respawn"); return; }
          placing = { type: b.dataset.build };
          autoAim();
          syncMode(true);
          toast(b.dataset.build === 'wall'
            ? 'The wall lays ACROSS your aim — point at what you want blocked, then Place!'
            : 'Tap inside your hero\'s ring to aim — Place when it turns green!');
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

    /* THE BUILDING YOU TAPPED IN THE LIST — ringed and labelled so there is
       never any doubt which turret the ⬆️ button is about to upgrade */
    if (focusBld !== null && mode === 'panel') {
      const row = snap.b.find((r) => r[0] === focusBld);
      const wrow = (snap.w || []).find((r) => r[0] === focusBld);
      const fx = row ? row[3] : wrow ? wrow[5] : null;
      const fy = row ? row[4] : wrow ? wrow[6] : null;
      if (fx === null) focusBld = null;
      else {
        const pulse = 1 + Math.sin(now * 0.006) * 0.12;
        g.save(); g.translate(fx, fy);
        g.strokeStyle = '#ffd93d'; g.lineWidth = 7 / c.z;
        g.setLineDash([16, 12]); g.lineDashOffset = -(now * 0.03) % 28;
        g.beginPath(); g.arc(0, 0, 52 * pulse, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.font = `${Math.max(26, 30 / c.z)}px sans-serif`; g.textAlign = 'center';
        g.fillText('👇', 0, -62 * pulse);
        g.restore();
        /* a wall is a long thing — outline every brick of it */
        if (wrow) {
          g.save();
          g.strokeStyle = 'rgba(255,217,61,.9)'; g.lineWidth = 5 / c.z;
          for (let i = 5; i + 2 < wrow.length; i += 3) {
            g.save(); g.translate(wrow[i], wrow[i + 1]); g.rotate(wrow[i + 2]);
            rr(g, -WALL.half - 4, -WALL.thick / 2 - 4, WALL.half * 2 + 8, WALL.thick + 8, 8);
            g.stroke(); g.restore();
          }
          g.restore();
        }
      }
    }

    /* tower ghost while placing */
    if (placing && placing.x !== undefined) {
      const def = BLD[placing.type];
      const isWall = placing.type === 'wall';
      const me0 = myRow(snap);
      const down = !me0 || me0[6] > 0;
      const inReach = !!me0 && Math.hypot(placing.x - me0[2], placing.y - me0[3]) <= BUILD_R;
      const home2 = myTeam === 1 ? { x: HORDE.x, y: HORDE.y } : { x: CASTLE.x, y: CASTLE.y };
      const wallPlan = isWall && me0
        ? planWallStub(world, snap.b, fog, me0[2], me0[3], placing.x, placing.y,
                       home2.x, home2.y, snapSegs(snap))
        : null;
      const ok = !down && inReach && (isWall
        ? !!wallPlan
        : canPlace(world, snap.b, placing.x, placing.y, fog, placing.type, snapSegs(snap)));
      if (me0) {                                        /* show the reach you're working in */
        g.save(); g.translate(me0[2], me0[3]);
        g.strokeStyle = down ? 'rgba(255,77,109,.75)' : inReach ? 'rgba(107,207,127,.8)' : 'rgba(255,217,61,.85)';
        g.lineWidth = 5;
        g.setLineDash([22, 16]); g.lineDashOffset = -(now * 0.02) % 38;
        g.beginPath(); g.arc(0, 0, BUILD_R, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.restore();
      }
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
      if (isWall && me0) {
        /* preview the EXACT bricks the planner returned — what you see is
           what the host will lay. If the plan failed, still sketch the
           intended axis so the red ghost shows what did not fit. */
        const aimed = Math.hypot(placing.x - me0[2], placing.y - me0[3]) > 20;
        const a = (aimed ? Math.atan2(placing.y - me0[3], placing.x - me0[2])
                         : Math.atan2(placing.y - home2.y, placing.x - home2.x)) + Math.PI / 2;
        const ghost = [0, mySeat, myTeam, 1, 100];
        if (wallPlan) for (const sg of wallPlan) ghost.push(sg.x, sg.y, sg.a);
        else for (let k = 0; k < WALL.startSegs; k++) {
          const t = k - (WALL.startSegs - 1) / 2;
          ghost.push(placing.x + Math.cos(a) * WALL.seg * t, placing.y + Math.sin(a) * WALL.seg * t, a);
        }
        drawWall(g, ghost, seats, c.z, now);
      } else {
        drawBld(g, [0, mySeat, BTYPE.indexOf(placing.type), placing.x, placing.y, 1, 100, 0, myTeam, 0], seats, c.z, now);
      }
      g.globalAlpha = 1;
      if (!ok) {
        g.save(); g.translate(placing.x, placing.y);
        g.font = `${Math.max(30, 34 / c.z)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('🚫', 0, 0);
        g.restore();
      }
      $q('.gg-place-ok').disabled = !ok;
      const hint = ok
        ? (isWall ? '🟢 Good spot — Place, then upgrade to grow it!' : '🟢 Good spot — hit Place!')
        : '🔴 Blocked — in fog, on rough ground, or too close to something';
      const hintEl = $q('.gg-place-hint');
      if (hintEl.textContent !== hint) hintEl.textContent = hint;
    }
    g.restore();
  }

  function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    if (ro) ro.disconnect();
    document.getElementById('ctrl-host-exit')?.classList.remove('gg-hide-shell-exit');
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
  hurtCreep, hurtNeutral, hurtTower, hurtBase, hurtETower, hurtHorde, hurtBld, addXp,
  makeComp, spawnCreep, spawnGroups, creepsOf, towersOf, baseOf, stepBld, stepCreep, stepTower, heroesOfTeam, pvpHit, oppHeroes,
  addBot, balanceTeams, botsNeeded, stepBot, baseShielded,
  TEAM_SIZE_MAX, TEAM_SIZE_DEFAULT,
  HEROES, BLD, CLASSES, ETYPES, ATYPES, NTYPES, ETOWER, CASTLE, HORDE,
  E_SKIN, A_SKIN, BASE_RING, BASE_ZONE, TEAM_NAME, WORLD_W, WORLD_H,
  WALK_COLS, WALK_ROWS, WALK_CELL, SPAWN_EVERY, GROUP_SIZE, LANE_SIZE, LANE_CAP, XP_LVL, LVL_MAX, SPRING_R, SPRING_HEAL, N_SPRINGS,
  BUILD_R, ARMOR_MIT, ARMOR_MAX_T, CAPTURE_HP, killHero, hitHeroFrom,
  TOWER_NEAR, TOWER_FAR_MUL, BACKSTEP_R, BACKSTEP_CD, speedOf, HERO_SPEED, HUP,
  resolveCollisions, towerDmgVsHero, towerDmgVsCreep,
  revealCircle, fogIdx,
  /* the new machinery: walls, focus fire, economy, caps */
  WALL, BTYPE, BUILDABLE, MAX_BLD, SELL_BACK, GLAZE_MUL, N_PATHS,
  hupCost, bupCost, HUP_MAX, RESPAWN_T, LASTHIT_COIN, ASSIST_COIN,
  FOUNTAIN_R, FOUNTAIN_HEAL, FOUNTAIN_FIGHT_T, FOUNTAIN_FIGHT_MUL,
  lobTarget, lobGrenade, LOB_RANGE, ABILITIES,
  wallAt, foeWallAt, wallSide, segHit, wallBlocksLine, foeWallBlocks, wallPasses, nearestSeg, allSegs,
  growWall, planWallStub, setFocus, resolveFocus, myBuildings, bldPaid, laneMuster,
  spawnGummySquad, GUMMY, slideMove, facingOf, onOwnFountain,
};
