/* ============================================================
   Gumdrop Guardians — co-op tower defense for the whole couch.

   Up to six heroes defend the Great Gingerbread Castle at the
   center of a big candy wilderness. Enemy hordes pour in from
   portals at the edge of the world along winding sugar trails.
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

const WORLD_R = 2700;              // world radius — ~3 min end to end on foot
const PORTAL_R = 2520;             // enemy portals sit on this ring
const N_PATHS = 5;                 // winding trails to the castle
const PATH_PTS = 9;                // waypoints per trail

const CASTLE = { r: 95, hp: 3000 };

const PREP_FIRST = 450;            // 45 s before wave 1 (learn + build)
const PREP_T = 200;                // 20 s between later waves
const PICK_FAILSAFE = 450;         // auto-assign heroes after 45 s
const LAST_WAVE = 20;              // survive all 20 → victory
const START_COINS = 140;

/* heroes — pick one at the start, it's yours for the match.
   Three abilities each (see ABILITIES below). */
const HEROES = [
  { id: 'knight',  name: 'Sir Crunch-a-Lot', emoji: '🛡️', desc: 'Tough as toffee. Stuns, taunts, and soaks damage up close.',
    hp: 420, dmg: 22, range: 40,  cd: 8, speed: 3.0, r: 20, hitAir: false },
  { id: 'ranger',  name: 'Huckleberry Fin',  emoji: '🏹', desc: 'Long-range berry archer. Shreds fliers and snipes brutes.',
    hp: 260, dmg: 14, range: 190, cd: 7, speed: 3.2, r: 18, hitAir: true },
  { id: 'mage',    name: 'Minty Merlin',     emoji: '🧙', desc: 'Splashy spells, slows, meteors, and a team heal.',
    hp: 240, dmg: 11, range: 170, cd: 9, speed: 2.9, r: 18, hitAir: true, splash: 45 },
  { id: 'builder', name: 'Gingerbread Greta', emoji: '🔧', desc: 'Her towers cost 20% less. Repairs, overclocks, decoy walls.',
    hp: 320, dmg: 12, range: 60,  cd: 8, speed: 3.1, r: 19, hitAir: false, discount: 0.8 },
];
const HERO_IDX = HEROES.map((h) => h.id);

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
};

/* hero upgrade tracks — cost grows with each level bought (max 8 each) */
const HUP = {
  dmg: { label: 'Attack',  emoji: '⚔️', mul: 0.12, hint: '+12% attack damage' },
  hp:  { label: 'Health',  emoji: '❤️', mul: 0.15, hint: '+15% max health' },
  spd: { label: 'Speed',   emoji: '👟', mul: 0.06, hint: '+6% run speed' },
  pow: { label: 'Powers',  emoji: '🌟', mul: 0.15, hint: '+15% ability strength' },
};
const HUP_MAX = 8;
const hupCost = (n) => 50 + 30 * n;

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
const ETYPES = {
  chomper:  { label: 'Choco Chomper', emoji: '🍪', hp: 55,  dmg: 7,  spd: 1.5, range: 26, aggro: 155,
              coin: 4, cost: 1, unlock: 1 },
  sprinter: { label: 'Sour Sprinter', emoji: '🍋', hp: 32,  dmg: 5,  spd: 2.6, range: 24, aggro: 120,
              coin: 3, cost: 1, unlock: 2 },
  wasp:     { label: 'Wafer Wasp',    emoji: '🐝', hp: 45,  dmg: 6,  spd: 2.2, range: 26, aggro: 155,
              coin: 5, cost: 2, unlock: 3, air: true },
  sapper:   { label: 'Jelly Sapper',  emoji: '🐛', hp: 85,  dmg: 22, spd: 1.7, range: 28, aggro: 300,
              coin: 6, cost: 2, unlock: 4, bldOnly: true },
  golem:    { label: 'Gumdrop Golem', emoji: '🗿', hp: 300, dmg: 18, spd: 1.1, range: 30, aggro: 135,
              coin: 12, cost: 5, unlock: 6 },
  boss:     { label: 'Rock Candy Colossus', emoji: '👹', hp: 1600, dmg: 45, spd: 0.9, range: 40, aggro: 210,
              coin: 60, cost: 0, unlock: 99, boss: true },
};
const ETYPE = Object.keys(ETYPES);
const HP_SCALE = 0.10, DMG_SCALE = 0.06;      // per wave past the first
const WAVE_BONUS = (w) => 15 + 5 * w;
const KILLER_BONUS = 0.5;                     // owner of the killer earns +50%

/* enemies get pulled off their trail by things near them; they give up
   the chase when the target strays too far */
const LEASH_MUL = 1.7;
const RESPAWN_T = (wave) => 80 + 10 * wave;   // hero respawn at the castle

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
  const paths = [], portals = [], props = [];
  for (let i = 0; i < N_PATHS; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N_PATHS + (rnd() - 0.5) * 0.35;
    const px = Math.cos(a) * PORTAL_R, py = Math.sin(a) * PORTAL_R;
    portals.push({ x: Math.round(px), y: Math.round(py), angle: a });
    const perp = { x: -Math.sin(a), y: Math.cos(a) };
    const wiggle = (rnd() - 0.5) * 2;                     // each trail bends its own way
    const pts = [];
    for (let k = 0; k <= PATH_PTS; k++) {
      const t = k / PATH_PTS;
      const r = PORTAL_R + (CASTLE.r + 55 - PORTAL_R) * t;
      const sway = Math.sin(t * Math.PI) * 330 * wiggle + Math.sin(t * Math.PI * 2.7 + i) * 120;
      pts.push({
        x: Math.round(Math.cos(a) * r + perp.x * sway),
        y: Math.round(Math.sin(a) * r + perp.y * sway),
      });
    }
    pts.push({ x: 0, y: 0 });                            // trails end at the castle
    paths.push(pts);
  }
  /* decorative candy scenery, deterministic so every screen matches */
  const PROP_EMOJI = ['🌲', '🍄', '🌸', '🪨', '🌷', '🎄', '🍩'];
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, r = 260 + rnd() * (WORLD_R - 320);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (paths.some((p) => distToPath(p, x, y) < 90)) continue;
    props.push({ x: Math.round(x), y: Math.round(y), e: PROP_EMOJI[(rnd() * PROP_EMOJI.length) | 0], s: 26 + rnd() * 26 });
  }
  return { paths, portals, props, r: WORLD_R, castle: { x: 0, y: 0, r: CASTLE.r } };
}

/* where can a tower go? shared by host validation and the phone's ghost */
function canPlace(world, blds, x, y) {
  if (dist(x, y, 0, 0) > world.r * 0.97) return false;
  if (dist(x, y, 0, 0) < CASTLE.r + 75) return false;
  for (const p of world.portals) if (dist(x, y, p.x, p.y) < 130) return false;
  for (const p of world.paths) if (distToPath(p, x, y) < 48) return false;
  for (const b of blds) {
    const bx = b.x !== undefined ? b.x : b[3], by = b.y !== undefined ? b.y : b[4];
    if (dist(x, y, bx, by) < 62) return false;
  }
  return true;
}

/* ================= sim ================= */

function makeSim(seed) {
  return {
    seed,
    tick: 0, phase: 'pick', pickLeft: PICK_FAILSAFE,
    wave: 0, prepLeft: 0, nextId: 1,
    world: buildWorld(seed),
    castle: { hp: CASTLE.hp, max: CASTLE.hp, hitAt: -999 },
    players: new Map(),      // playerId -> hero state (see addPlayer)
    order: [],               // playerIds in seat order
    enemies: [], allies: [], blds: [], impacts: [], fx: [],
    spawnQueue: [], activePaths: [],
    over: null,              // 'win' | 'lose'
    stats: { built: 0, waveReached: 0 },
  };
}

function addPlayer(sim, playerId) {
  if (sim.players.has(playerId)) return sim.players.get(playerId);
  const seat = sim.order.length;
  const p = {
    id: playerId, seat, hero: null, connected: true,
    x: 0, y: CASTLE.r + 60 + seat * 8, hp: 1, maxhp: 1,
    dead: false, respawn: 0, dir: { x: 0, y: 0 }, moveTo: null,
    coins: START_COINS + sim.wave * 10,
    up: { dmg: 0, hp: 0, spd: 0, pow: 0 },
    cds: [0, 0, 0], armor: 0, kills: 0, ready: false,
  };
  sim.players.set(playerId, p);
  sim.order.push(playerId);
  return p;
}

function heroDef(p) { return HEROES[HERO_IDX.indexOf(p.hero)]; }
const powMul = (p) => 1 + HUP.pow.mul * p.up.pow;
const dmgOf = (p) => Math.round(heroDef(p).dmg * (1 + HUP.dmg.mul * p.up.dmg));
const maxhpOf = (p) => Math.round(heroDef(p).hp * (1 + HUP.hp.mul * p.up.hp));
const speedOf = (p) => heroDef(p).speed * (1 + HUP.spd.mul * p.up.spd);

function pickHero(sim, playerId, heroId) {
  const p = sim.players.get(playerId);
  if (!p || p.hero || !HERO_IDX.includes(heroId)) return;
  p.hero = heroId;
  p.maxhp = maxhpOf(p); p.hp = p.maxhp;
  /* spawn heroes fanned out just south of the castle */
  const a = Math.PI / 2 + (p.seat - 2.5) * 0.35;
  p.x = Math.cos(a) * (CASTLE.r + 70); p.y = Math.sin(a) * (CASTLE.r + 70);
  addFx(sim, 'spawn', p.x, p.y);
  /* everyone picked? on to the first build phase */
  if (sim.phase === 'pick') {
    const waiting = [...sim.players.values()].filter((q) => q.connected && !q.hero);
    if (!waiting.length) startPrep(sim, PREP_FIRST);
  }
}

function startPrep(sim, ticks) {
  sim.phase = 'prep';
  sim.prepLeft = ticks;
  for (const p of sim.players.values()) { p.ready = false; p.dir = { x: 0, y: 0 }; }
}

/* ---------------- wave construction ----------------
   Budget scales with PLAYER COUNT first, then the wave number.
   The wave number also unlocks scarier enemy types.            */
function buildWave(sim, wave) {
  const rnd = mulberry32(1000 + wave * 7);
  const P = Math.max(1, [...sim.players.values()].filter((q) => q.hero).length);
  let budget = Math.round((8 + wave * 5) * (0.7 + 0.33 * P));
  const isBoss = wave % 5 === 0;
  if (isBoss) budget = Math.round(budget * 0.7);

  const pool = ETYPE.filter((t) => ETYPES[t].unlock <= wave && !ETYPES[t].boss);
  /* later types get picked more often once unlocked */
  const weights = pool.map((t) => 1 + (wave - ETYPES[t].unlock) * 0.15);

  const nActive = Math.min(1 + Math.floor((wave - 1) / 3), N_PATHS);
  const pathIds = [];
  const all = [...Array(N_PATHS).keys()];
  for (let i = 0; i < nActive; i++) pathIds.push(all.splice((rnd() * all.length) | 0, 1)[0]);
  sim.activePaths = pathIds;

  const q = [];
  let spent = 0, i = 0;
  while (spent < budget) {
    let r = rnd() * weights.reduce((a, b) => a + b, 0), pick = pool[0];
    for (let k = 0; k < pool.length; k++) { r -= weights[k]; if (r <= 0) { pick = pool[k]; break; } }
    if (ETYPES[pick].cost > budget - spent && pool.includes('chomper')) pick = 'chomper';
    spent += ETYPES[pick].cost;
    q.push({ delay: Math.floor(i / pathIds.length) * 9 + ((rnd() * 5) | 0), type: pick, path: pathIds[i % pathIds.length] });
    i++;
  }
  if (isBoss) {
    q.push({ delay: 30, type: 'boss', path: pathIds[0] });
    addFx(sim, 'horn', 0, -WORLD_R * 0.5);
  }
  q.sort((a, b) => a.delay - b.delay);
  sim.spawnQueue = q;
  sim.bossN = Math.floor(wave / 5);
}

function spawnEnemy(sim, type, pathIdx) {
  const def = ETYPES[type];
  const path = sim.world.paths[pathIdx];
  const w = sim.wave;
  const hpMul = (1 + HP_SCALE * (w - 1)) * (def.boss ? 1 + 0.25 * (sim.bossN - 1) : 1);
  const e = {
    id: sim.nextId++, type, path: pathIdx, wp: 1,
    x: path[0].x + (Math.random() - 0.5) * 40, y: path[0].y + (Math.random() - 0.5) * 40,
    hp: Math.round(def.hp * hpMul), maxhp: Math.round(def.hp * hpMul),
    dmg: Math.round(def.dmg * (1 + DMG_SCALE * (w - 1))),
    state: 'walk', tgt: null, cd: 0, slow: 0, slowT: 0, stun: 0, taunt: null,
  };
  sim.enemies.push(e);
  addFx(sim, 'spawn', e.x, e.y);
}

function build(sim, playerId, type, x, y) {
  const p = sim.players.get(playerId);
  if (!p || !p.hero || !BUILDABLE.includes(type)) return 'nope';
  const def = BLD[type];
  const cost = Math.round(def.cost * (heroDef(p).discount || 1));
  if (p.coins < cost) return 'coins';
  if (!canPlace(sim.world, sim.blds, x, y)) return 'spot';
  p.coins -= cost;
  const b = { id: sim.nextId++, owner: playerId, type, x: Math.round(x), y: Math.round(y),
              lvl: 1, hp: def.hp, maxhp: def.hp, cd: 10, boost: 0, squadCd: 0 };
  sim.blds.push(b);
  sim.stats.built++;
  addFx(sim, 'built', b.x, b.y);
  if (type === 'barracks') for (let i = 0; i < BLD.barracks.squad; i++) spawnGummy(sim, b);
  return 'ok';
}

function spawnGummy(sim, b) {
  const a = Math.random() * Math.PI * 2;
  sim.allies.push({
    id: sim.nextId++, from: b.id, owner: b.owner,
    x: b.x + Math.cos(a) * 44, y: b.y + Math.sin(a) * 44,
    hp: GUMMY.hp * (1 + 0.2 * (b.lvl - 1)), maxhp: GUMMY.hp * (1 + 0.2 * (b.lvl - 1)),
    cd: 0, tgt: null,
  });
}

/* owner-only tower upgrades — this is the whole point! */
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
  if (!p || i < 0 || sim.blds[i].owner !== playerId || sim.phase !== 'prep') return;
  const b = sim.blds[i];
  let paid = Math.round(BLD[b.type].cost * (heroDef(p).discount || 1));
  for (let l = 1; l < b.lvl; l++) paid += bupCost(l);
  p.coins += Math.round(paid * SELL_BACK);
  sim.blds.splice(i, 1);
  sim.allies = sim.allies.filter((a) => a.from !== b.id);
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

/* coins for everyone on a kill; the killer's owner gets a tip on top */
function awardKill(sim, e, killerOwner) {
  const def = ETYPES[e.type];
  for (const p of sim.players.values()) {
    if (!p.hero) continue;
    let c = def.coin;
    if (killerOwner && p.id === killerOwner) { c = Math.round(c * (1 + KILLER_BONUS)); p.kills++; }
    p.coins += c;
  }
  addFx(sim, 'die', e.x, e.y);
}

function hurtEnemy(sim, e, dmg, owner) {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  if (e.hp <= 0) awardKill(sim, e, owner);
}

/* ---------------- abilities ---------------- */

function castAbility(sim, playerId, i) {
  const p = sim.players.get(playerId);
  if (!p || !p.hero || p.dead || sim.phase !== 'wave') return;
  if (p.cds[i] > 0) return;
  const pm = powMul(p);
  const ab = ABILITIES[p.hero][i];
  p.cds[i] = Math.round(ab[2] * (1 - 0.02 * p.up.pow));

  if (p.hero === 'knight') {
    if (i === 0) {                                       // Shield Bash
      addFx(sim, 'bash', p.x, p.y, undefined, undefined, 130);
      for (const e of sim.enemies) if (dist(e.x, e.y, p.x, p.y) <= 130) {
        hurtEnemy(sim, e, Math.round(40 * pm), p.id);
        if (!ETYPES[e.type].boss) e.stun = Math.max(e.stun, 25);
      }
    } else if (i === 1) {                                // Battle Cry
      addFx(sim, 'cry', p.x, p.y, undefined, undefined, 260);
      for (const e of sim.enemies) if (!ETYPES[e.type].bldOnly && dist(e.x, e.y, p.x, p.y) <= 260) {
        e.taunt = { id: p.id, t: Math.round(60 * pm) };
      }
    } else {                                             // Frosting Armor
      p.armor = Math.round(80 * pm);
      addFx(sim, 'shield', p.x, p.y);
    }
  } else if (p.hero === 'ranger') {
    if (i === 0) {                                       // Berry Barrage
      addFx(sim, 'barrage', p.x, p.y, undefined, undefined, 240);
      for (const e of sim.enemies) if (dist(e.x, e.y, p.x, p.y) <= 240) hurtEnemy(sim, e, Math.round(30 * pm), p.id);
    } else if (i === 1) {                                // Jam Trap
      sim.impacts.push({ t: sim.tick, kind: 'field', x: p.x, y: p.y, r: 150, slow: 0.55, until: sim.tick + Math.round(80 * pm) });
      addFx(sim, 'trap', p.x, p.y, undefined, undefined, 150);
    } else {                                             // Piercing Shot
      let best = null;
      for (const e of sim.enemies) if (dist(e.x, e.y, p.x, p.y) <= 400 && (!best || e.maxhp > best.maxhp)) best = e;
      if (best) { addFx(sim, 'pierce', p.x, p.y, best.x, best.y); hurtEnemy(sim, best, Math.round(120 * pm), p.id); }
    }
  } else if (p.hero === 'mage') {
    if (i === 0) {                                       // Mint Nova
      addFx(sim, 'nova', p.x, p.y, undefined, undefined, 180);
      for (const e of sim.enemies) if (dist(e.x, e.y, p.x, p.y) <= 180) {
        hurtEnemy(sim, e, Math.round(25 * pm), p.id);
        applySlow(e, 0.5, 40);
      }
    } else if (i === 1) {                                // Jawbreaker — seek the biggest cluster
      let bx = null, by = null, bestN = -1;
      for (const e of sim.enemies) {
        if (dist(e.x, e.y, p.x, p.y) > 450) continue;
        let n = 0;
        for (const q of sim.enemies) if (dist(q.x, q.y, e.x, e.y) <= 110) n++;
        if (n > bestN) { bestN = n; bx = e.x; by = e.y; }
      }
      if (bx !== null) {
        sim.impacts.push({ t: sim.tick + 8, kind: 'boom', x: bx, y: by, r: 110, dmg: Math.round(80 * pm), owner: p.id, air: true });
        addFx(sim, 'meteor', bx, by);
      } else p.cds[i] = 10;                              // nothing in range — quick refund
    } else {                                             // Sprinkle of Life
      addFx(sim, 'heal', p.x, p.y, undefined, undefined, 260);
      const frac = 0.35 * pm;
      for (const q of sim.players.values()) if (q.hero && !q.dead && dist(q.x, q.y, p.x, p.y) <= 260) q.hp = Math.min(q.maxhp, q.hp + q.maxhp * frac);
      for (const a of sim.allies) if (dist(a.x, a.y, p.x, p.y) <= 260) a.hp = Math.min(a.maxhp, a.hp + a.maxhp * frac);
      for (const b of sim.blds) if (dist(b.x, b.y, p.x, p.y) <= 260) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * frac);
    }
  } else if (p.hero === 'builder') {
    if (i === 0) {                                       // Quick Fix
      addFx(sim, 'heal', p.x, p.y, undefined, undefined, 200);
      for (const b of sim.blds) if (dist(b.x, b.y, p.x, p.y) <= 200) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.5 * pm);
    } else if (i === 1) {                                // Overclock (her towers only)
      addFx(sim, 'overclock', p.x, p.y, undefined, undefined, 260);
      for (const b of sim.blds) if (b.owner === p.id && dist(b.x, b.y, p.x, p.y) <= 260) b.boost = Math.round(80 * pm);
    } else {                                             // Gumdrop Wall
      const b = { id: sim.nextId++, owner: p.id, type: 'wall', x: Math.round(p.x), y: Math.round(p.y),
                  lvl: 1, hp: Math.round(BLD.wall.hp * pm), maxhp: Math.round(BLD.wall.hp * pm),
                  cd: 0, boost: 0, squadCd: 0, until: sim.tick + BLD.wall.temp };
      sim.blds.push(b);
      addFx(sim, 'built', b.x, b.y);
    }
  }
}

function applySlow(e, amt, ticks) {
  if (ETYPES[e.type].boss) amt *= 0.5;
  if (amt >= e.slow) { e.slow = amt; e.slowT = Math.max(e.slowT, ticks); }
}

/* ---------------- enemy brain ----------------
   Walk the trail → but anything juicy nearby pulls you off it.
   Sappers only have eyes for buildings. Lost your mark? Trot
   back to the trail and keep marching on the castle. */

function enemyScan(sim, e) {
  const def = ETYPES[e.type];
  /* taunted? locked on */
  if (e.taunt && e.taunt.t > 0) {
    const p = sim.players.get(e.taunt.id);
    if (p && !p.dead) { e.tgt = { kind: 'hero', id: p.id }; return; }
    e.taunt = null;
  }
  let best = null, bestD = Infinity;
  const consider = (kind, id, x, y, extraR = 0) => {
    const d = dist(e.x, e.y, x, y);
    if (d < bestD && d <= def.aggro + extraR) { bestD = d; best = { kind, id }; }
  };
  if (!def.bldOnly) {
    for (const p of sim.players.values()) if (p.hero && !p.dead) consider('hero', p.id, p.x, p.y);
    for (const a of sim.allies) consider('ally', a.id, a.x, a.y);
  }
  for (const b of sim.blds) consider('bld', b.id, b.x, b.y, b.type === 'wall' ? BLD.wall.lure - def.aggro : 0);
  e.tgt = best;
}

function tgtPos(sim, tgt) {
  if (!tgt) return null;
  if (tgt.kind === 'hero') { const p = sim.players.get(tgt.id); return p && !p.dead ? p : null; }
  if (tgt.kind === 'ally') return sim.allies.find((a) => a.id === tgt.id) || null;
  if (tgt.kind === 'bld') return sim.blds.find((b) => b.id === tgt.id) || null;
  return null;
}

function stepEnemy(sim, e) {
  const def = ETYPES[e.type];
  if (e.stun > 0) { e.stun--; return; }
  if (e.slowT > 0) { e.slowT--; if (e.slowT <= 0) e.slow = 0; }
  if (e.taunt) { e.taunt.t--; if (e.taunt.t <= 0) e.taunt = null; }
  /* sticky fields */
  for (const f of sim.impacts) if (f.kind === 'field' && dist(e.x, e.y, f.x, f.y) <= f.r) applySlow(e, f.slow, 3);
  if (e.cd > 0) e.cd--;

  if (sim.tick % 5 === (e.id % 5)) enemyScan(sim, e);    // stagger the scans

  const spd = def.spd * (1 - e.slow);
  const t = tgtPos(sim, e.tgt);

  if (t) {
    const tr = t.maxhp && t.type ? BLD[t.type].r : 16;   // building bulk vs critter
    const d = dist(e.x, e.y, t.x, t.y);
    const lureR = (e.tgt.kind === 'bld' && t.type === 'wall') ? BLD.wall.lure : def.aggro;
    if (d > lureR * LEASH_MUL) { e.tgt = null; }         // gave up — back to the trail
    else if (d > def.range + tr) {
      e.x += ((t.x - e.x) / d) * spd; e.y += ((t.y - e.y) / d) * spd;
      return;
    } else {
      if (e.cd <= 0) { e.cd = 10; dealEnemyHit(sim, e, t); }
      return;
    }
  }

  /* march the trail */
  const path = sim.world.paths[e.path];
  const wp = path[Math.min(e.wp, path.length - 1)];
  const d = dist(e.x, e.y, wp.x, wp.y);
  if (d < 30) {
    if (e.wp < path.length - 1) e.wp++;
  }
  const dc = dist(e.x, e.y, 0, 0);
  if (dc <= CASTLE.r + def.range + 10) {                 // at the gates
    if (e.cd <= 0) {
      e.cd = 10;
      sim.castle.hp -= e.dmg * (def.bldOnly ? 1.4 : 1);
      sim.castle.hitAt = sim.tick;
      addFx(sim, 'castlehit', e.x, e.y);
    }
    return;
  }
  if (d > 1) { e.x += ((wp.x - e.x) / d) * spd; e.y += ((wp.y - e.y) / d) * spd; }
}

function dealEnemyHit(sim, e, t) {
  addFx(sim, 'hit', t.x, t.y);
  if (e.tgt.kind === 'hero') {
    const p = t;
    const dmg = p.armor > 0 ? Math.round(e.dmg * 0.4) : e.dmg;
    p.hp -= dmg;
    if (p.hp <= 0) {
      p.dead = true; p.respawn = RESPAWN_T(sim.wave); p.dir = { x: 0, y: 0 };
      addFx(sim, 'herodown', p.x, p.y);
    }
  } else if (e.tgt.kind === 'ally') {
    t.hp -= e.dmg;
    if (t.hp <= 0) sim.allies = sim.allies.filter((a) => a.id !== t.id);
  } else if (e.tgt.kind === 'bld') {
    t.hp -= e.dmg * (ETYPES[e.type].bldOnly ? 1.5 : 1);
    if (t.hp <= 0) {
      sim.blds = sim.blds.filter((b) => b.id !== t.id);
      sim.allies = sim.allies.filter((a) => a.from !== t.id);
      addFx(sim, 'crumble', t.x, t.y);
    }
  }
}

/* ---------------- gummies ---------------- */

function stepAlly(sim, a) {
  const home = sim.blds.find((b) => b.id === a.from);
  if (!home) { a.hp = 0; return; }
  if (a.cd > 0) a.cd--;
  let t = a.tgt ? sim.enemies.find((e) => e.id === a.tgt) : null;
  if (t && (t.hp <= 0 || dist(t.x, t.y, home.x, home.y) > GUMMY.leash)) t = null;
  if (!t && sim.tick % 5 === (a.id % 5)) {
    let bd = Infinity;
    for (const e of sim.enemies) {
      if (ETYPES[e.type].air) continue;                  // gummies can't reach wasps
      const d = dist(e.x, e.y, a.x, a.y);
      if (d < bd && d <= GUMMY.aggro && dist(e.x, e.y, home.x, home.y) <= GUMMY.leash) { bd = d; t = e; }
    }
  }
  a.tgt = t ? t.id : null;
  if (t) {
    const d = dist(a.x, a.y, t.x, t.y);
    if (d > GUMMY.range) { a.x += ((t.x - a.x) / d) * GUMMY.speed; a.y += ((t.y - a.y) / d) * GUMMY.speed; }
    else if (a.cd <= 0) {
      a.cd = GUMMY.cd;
      hurtEnemy(sim, t, Math.round(GUMMY.dmg * (1 + 0.25 * (home.lvl - 1))), a.owner);
      addFx(sim, 'hit', t.x, t.y);
    }
  } else {
    const d = dist(a.x, a.y, home.x, home.y);
    if (d > 60) { a.x += ((home.x - a.x) / d) * GUMMY.speed; a.y += ((home.y - a.y) / d) * GUMMY.speed; }
  }
}

/* ---------------- towers ---------------- */

function stepBld(sim, b) {
  if (b.until && sim.tick >= b.until) { b.hp = 0; return; }        // walls melt away
  const def = BLD[b.type];
  if (b.boost > 0) b.boost--;
  if (b.type === 'barracks') {
    const alive = sim.allies.filter((a) => a.from === b.id).length;
    const squad = def.squad + (b.lvl >= 4 ? 1 : 0);
    if (alive < squad) {
      if (b.squadCd > 0) b.squadCd--;
      else { b.squadCd = def.respawn; spawnGummy(sim, b); addFx(sim, 'spawn', b.x, b.y); }
    }
    return;
  }
  if (!def.range) return;
  if (b.cd > 0) { b.cd -= b.boost > 0 ? 2 : 1; return; }
  const range = def.range * Math.pow(BUP.rangeMul, b.lvl - 1);
  if (b.type === 'syrup') {
    let any = false;
    for (const e of sim.enemies) if (dist(e.x, e.y, b.x, b.y) <= range) { applySlow(e, def.slow + 0.05 * (b.lvl - 1), 8); any = true; }
    if (any) { b.cd = def.cd; addFx(sim, 'syrup', b.x, b.y, undefined, undefined, range); }
    return;
  }
  let best = null, bd = Infinity;
  for (const e of sim.enemies) {
    const air = !!ETYPES[e.type].air;
    if (def.air ? !air : air) continue;                  // AA hits fliers, others hit ground
    const d = dist(e.x, e.y, b.x, b.y);
    if (def.minRange && d < def.minRange) continue;
    if (d <= range && d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  b.cd = def.cd;
  const dmg = Math.round(def.dmg * Math.pow(BUP.dmgMul, b.lvl - 1));
  if (b.type === 'mortar') {
    sim.impacts.push({ t: sim.tick + 6, kind: 'boom', x: best.x, y: best.y, r: def.splash + 6 * (b.lvl - 1), dmg, owner: b.owner, air: false });
    addFx(sim, 'shell', b.x, b.y, best.x, best.y);
  } else {
    addFx(sim, b.type === 'launcher' ? 'zap' : 'pew', b.x, b.y, best.x, best.y);
    hurtEnemy(sim, best, dmg, b.owner);
  }
}

/* ---------------- the master tick ---------------- */

function stepSim(sim) {
  sim.tick++;
  if (sim.over) return;

  if (sim.phase === 'pick') {
    if (--sim.pickLeft <= 0) {                           // failsafe: auto-assign stragglers
      for (const p of sim.players.values()) if (!p.hero) pickHero(sim, p.id, HERO_IDX[p.seat % HERO_IDX.length]);
      if (sim.phase === 'pick') startPrep(sim, PREP_FIRST);
    }
    return;
  }

  /* heroes move in both phases (joystick in waves, tap-to-walk in prep) */
  for (const p of sim.players.values()) {
    if (!p.hero) continue;
    if (p.dead) {
      if (--p.respawn <= 0) {
        p.dead = false; p.hp = p.maxhp;
        p.x = 0; p.y = CASTLE.r + 60;
        addFx(sim, 'spawn', p.x, p.y);
      }
      continue;
    }
    if (p.armor > 0) p.armor--;
    for (let i = 0; i < 3; i++) if (p.cds[i] > 0) p.cds[i]--;
    const spd = speedOf(p);
    if (sim.phase === 'wave' && (p.dir.x || p.dir.y)) {
      const m = Math.hypot(p.dir.x, p.dir.y) || 1;
      p.x += (p.dir.x / m) * spd; p.y += (p.dir.y / m) * spd;
      p.moveTo = null;
    } else if (p.moveTo) {
      const d = dist(p.x, p.y, p.moveTo.x, p.moveTo.y);
      if (d < spd * 1.5) p.moveTo = null;
      else { p.x += ((p.moveTo.x - p.x) / d) * spd; p.y += ((p.moveTo.y - p.y) / d) * spd; }
    }
    const dc = dist(p.x, p.y, 0, 0);
    if (dc > WORLD_R) { p.x *= WORLD_R / dc; p.y *= WORLD_R / dc; }
    if (dc < CASTLE.r + 20 && dc > 0) { const k = (CASTLE.r + 20) / dc; p.x *= k; p.y *= k; }
    /* hero auto-attack during waves */
    if (sim.phase === 'wave' && (!p.atkCd || --p.atkCd <= 0)) {
      const hd = heroDef(p);
      let best = null, bd = Infinity;
      for (const e of sim.enemies) {
        if (ETYPES[e.type].air && !hd.hitAir) continue;
        const d = dist(e.x, e.y, p.x, p.y);
        if (d <= hd.range + 14 && d < bd) { bd = d; best = e; }
      }
      if (best) {
        p.atkCd = hd.cd;
        addFx(sim, hd.range > 100 ? 'pew' : 'slash', p.x, p.y, best.x, best.y);
        if (hd.splash) {
          for (const e of sim.enemies) if (dist(e.x, e.y, best.x, best.y) <= hd.splash) hurtEnemy(sim, e, dmgOf(p), p.id);
        } else hurtEnemy(sim, best, dmgOf(p), p.id);
      }
    }
  }

  if (sim.phase === 'prep') {
    const anyone = [...sim.players.values()].some((p) => p.hero && p.connected);
    const allReady = anyone && [...sim.players.values()].every((p) => !p.hero || !p.connected || p.ready);
    if (--sim.prepLeft <= 0 || allReady) {
      sim.phase = 'wave';
      sim.wave++;
      sim.stats.waveReached = sim.wave;
      buildWave(sim, sim.wave);
      addFx(sim, 'horn', 0, 0);
    }
    return;
  }

  /* ---- wave phase ---- */
  for (const s of sim.spawnQueue) s.delay--;
  while (sim.spawnQueue.length && sim.spawnQueue[0].delay <= 0) {
    const s = sim.spawnQueue.shift();
    spawnEnemy(sim, s.type, s.path);
  }

  for (const e of sim.enemies) stepEnemy(sim, e);
  sim.enemies = sim.enemies.filter((e) => e.hp > 0);
  for (const a of sim.allies) stepAlly(sim, a);
  sim.allies = sim.allies.filter((a) => a.hp > 0);
  for (const b of sim.blds) stepBld(sim, b);
  sim.blds = sim.blds.filter((b) => b.hp > 0);

  /* scheduled explosions + expiring fields */
  for (const im of sim.impacts) {
    if (im.kind === 'boom' && sim.tick >= im.t) {
      addFx(sim, 'boom', im.x, im.y, undefined, undefined, im.r);
      for (const e of sim.enemies) {
        if (ETYPES[e.type].air && !im.air) continue;
        if (dist(e.x, e.y, im.x, im.y) <= im.r) hurtEnemy(sim, e, im.dmg, im.owner);
      }
      im.done = true;
    }
    if (im.kind === 'field' && sim.tick >= im.until) im.done = true;
  }
  sim.impacts = sim.impacts.filter((im) => !im.done);
  sim.enemies = sim.enemies.filter((e) => e.hp > 0);

  if (sim.castle.hp <= 0) { sim.castle.hp = 0; sim.over = 'lose'; addFx(sim, 'crumble', 0, 0); return; }

  /* wave cleared? */
  if (!sim.spawnQueue.length && !sim.enemies.length) {
    for (const p of sim.players.values()) if (p.hero) {
      p.coins += WAVE_BONUS(sim.wave);
      if (p.dead) { p.dead = false; p.respawn = 0; }
      p.hp = p.maxhp;                                    // heroes patch up between waves
    }
    for (const b of sim.blds) b.hp = b.maxhp;            // towers too — the castle doesn't
    addFx(sim, 'clear', 0, 0);
    if (sim.wave >= LAST_WAVE) { sim.over = 'win'; return; }
    startPrep(sim, PREP_T);
  }
}

/* ================= snapshot (host → phones) ================= */

function snapshot(sim) {
  const pl = [];
  for (const id of sim.order) {
    const p = sim.players.get(id);
    pl.push([
      p.seat, p.hero ? HERO_IDX.indexOf(p.hero) : -1,
      Math.round(p.x), Math.round(p.y), Math.round(p.hp), p.maxhp,
      p.dead ? Math.max(1, p.respawn) : 0, p.coins,
      p.cds[0], p.cds[1], p.cds[2],
      p.ready ? 1 : 0, p.kills, p.armor > 0 ? 1 : 0,
      p.up.dmg, p.up.hp, p.up.spd, p.up.pow,
    ]);
  }
  const e = sim.enemies.map((n) => [
    n.id, ETYPE.indexOf(n.type), Math.round(n.x), Math.round(n.y),
    Math.round((n.hp / n.maxhp) * 100), n.stun > 0 ? 1 : 0, n.slow > 0 ? 1 : 0,
  ]);
  const a = sim.allies.map((n) => {
    const p = sim.players.get(n.owner);
    return [n.id, p ? p.seat : 0, Math.round(n.x), Math.round(n.y), Math.round((n.hp / n.maxhp) * 100)];
  });
  const b = sim.blds.map((n) => {
    const p = sim.players.get(n.owner);
    return [n.id, p ? p.seat : 0, BTYPE.indexOf(n.type), n.x, n.y, n.lvl,
            Math.round((n.hp / n.maxhp) * 100), n.boost > 0 ? 1 : 0];
  });
  const fields = sim.impacts.filter((im) => im.kind === 'field').map((im) => [im.x, im.y, im.r]);
  const snap = {
    k: 'snap', n: sim.tick, ph: sim.phase, w: sim.wave,
    pt: sim.phase === 'prep' ? sim.prepLeft : (sim.phase === 'pick' ? sim.pickLeft : 0),
    c: [Math.round(sim.castle.hp), sim.castle.max],
    left: sim.spawnQueue.length + sim.enemies.length,
    ap: sim.activePaths,
    pl, e, a, b, fields, fx: sim.fx,
  };
  snap.chit = sim.tick - sim.castle.hitAt < 12 ? 1 : 0;
  if (sim.over) snap.over = sim.over;
  sim.fx = [];
  return snap;
}

/* ================= shared drawing ================= */

function drawTerrain(g, world, activePaths, now) {
  /* meadow */
  const grad = g.createRadialGradient(0, 0, 200, 0, 0, world.r);
  grad.addColorStop(0, '#b8e6a0'); grad.addColorStop(0.7, '#9ed98a'); grad.addColorStop(1, '#7cc274');
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, world.r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#5ea75d'; g.lineWidth = 26;
  g.beginPath(); g.arc(0, 0, world.r, 0, Math.PI * 2); g.stroke();

  /* sugar trails */
  for (let i = 0; i < world.paths.length; i++) {
    const p = world.paths[i];
    const hot = activePaths && activePaths.includes(i);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = hot ? '#e8b06a' : '#dfc79b';
    g.lineWidth = 64;
    g.beginPath(); g.moveTo(p[0].x, p[0].y);
    for (let k = 1; k < p.length; k++) g.lineTo(p[k].x, p[k].y);
    g.stroke();
    g.strokeStyle = hot ? '#fadfae' : '#efe3c4';
    g.lineWidth = 44;
    g.beginPath(); g.moveTo(p[0].x, p[0].y);
    for (let k = 1; k < p.length; k++) g.lineTo(p[k].x, p[k].y);
    g.stroke();
    if (hot) {                                            // marching dashes on live trails
      g.strokeStyle = 'rgba(214,86,60,.55)'; g.lineWidth = 8;
      g.setLineDash([26, 40]); g.lineDashOffset = -(now * 0.04) % 66;
      g.beginPath(); g.moveTo(p[0].x, p[0].y);
      for (let k = 1; k < p.length; k++) g.lineTo(p[k].x, p[k].y);
      g.stroke(); g.setLineDash([]);
    }
  }

  /* portals */
  for (let i = 0; i < world.portals.length; i++) {
    const pt = world.portals[i];
    const hot = activePaths && activePaths.includes(i);
    g.save(); g.translate(pt.x, pt.y);
    g.fillStyle = hot ? '#5b2a63' : '#7a6a80';
    g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.fill();
    g.strokeStyle = hot ? '#c95cff' : '#a894b3'; g.lineWidth = 8;
    if (hot) { g.setLineDash([14, 10]); g.lineDashOffset = -(now * 0.03) % 24; }
    g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.font = '52px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🌀', 0, 2);
    g.restore();
  }

  for (const pr of world.props) {
    g.font = `${pr.s}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(pr.e, pr.x, pr.y);
  }
}

function drawCastleAt(g, castleHp, castleMax, hitRecently, now) {
  g.save();
  g.fillStyle = '#e7c9a1';
  g.beginPath(); g.arc(0, 0, CASTLE.r + 26, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#b98d5f'; g.lineWidth = 10;
  g.beginPath(); g.arc(0, 0, CASTLE.r + 26, 0, Math.PI * 2); g.stroke();
  if (hitRecently && Math.floor(now / 120) % 2 === 0) {
    g.strokeStyle = '#ff4d4d'; g.lineWidth = 6;
    g.beginPath(); g.arc(0, 0, CASTLE.r + 40, 0, Math.PI * 2); g.stroke();
  }
  g.font = '120px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('🏰', 0, -6);
  const frac = clamp(castleHp / castleMax, 0, 1);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(-80, 96, 160, 16);
  g.fillStyle = frac > 0.5 ? '#6bcf7f' : frac > 0.25 ? '#ffd93d' : '#ff4d6d';
  g.fillRect(-80, 96, 160 * frac, 16);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(-80, 96, 160, 16);
  g.restore();
}

function hpBar(g, x, y, w, frac, col) {
  g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(x - w / 2, y, w, 6);
  g.fillStyle = col || (frac > 0.5 ? '#6bcf7f' : frac > 0.25 ? '#ffd93d' : '#ff4d6d');
  g.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 6);
}

function drawBld(g, row, seats, z, now) {
  const [, seat, tIdx, x, y, lvl, hpPct, boosted] = row;
  const type = BTYPE[tIdx], def = BLD[type];
  const s = seats[seat];
  const em = Math.max(def.r * 1.7, 20 / z);
  g.save(); g.translate(x, y);
  g.strokeStyle = s ? s.color : '#ccc'; g.lineWidth = Math.max(4, 5 / z);
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.beginPath(); g.arc(0, 0, def.r + 8, 0, Math.PI * 2); g.fill(); g.stroke();
  if (boosted) {
    g.strokeStyle = '#ffd93d'; g.setLineDash([8, 6]); g.lineDashOffset = -(now * 0.05) % 14;
    g.beginPath(); g.arc(0, 0, def.r + 16, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }
  g.font = `${em}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(def.emoji, 0, 0);
  if (hpPct < 100) hpBar(g, 0, def.r + 12, def.r * 2, hpPct / 100);
  if (lvl > 1) {                                          // level pips
    g.fillStyle = '#ffd93d';
    for (let i = 0; i < lvl; i++) {
      g.beginPath(); g.arc(-((lvl - 1) * 5) + i * 10, -def.r - 12, 3.6, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

function drawEnemy(g, row, z, now) {
  const [id, tIdx, x, y, hpPct, stun, slow] = row;
  const type = ETYPE[tIdx], def = ETYPES[type];
  const r = def.boss ? 42 : 16;
  const em = Math.max(r * 1.9, 18 / z);
  g.save(); g.translate(x, y);
  const bob = def.air ? Math.sin(now * 0.008 + id) * 5 : 0;
  if (def.air) {                                          // little shadow under fliers
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.beginPath(); g.ellipse(0, 12, em * 0.35, em * 0.14, 0, 0, Math.PI * 2); g.fill();
  }
  if (slow) { g.fillStyle = 'rgba(80,160,255,.3)'; g.beginPath(); g.arc(0, bob, em * 0.62, 0, Math.PI * 2); g.fill(); }
  g.font = `${em}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(def.emoji, 0, bob - (def.air ? 10 : 0));
  if (stun) { g.font = `${em * 0.55}px sans-serif`; g.fillText('💫', 0, bob - em * 0.75); }
  if (hpPct < 100) hpBar(g, 0, r + 6, Math.max(r * 2, 26 / z), hpPct / 100, '#c95cff');
  g.restore();
}

function drawHeroRow(g, row, seats, z, now, isMe) {
  const [seat, heroIdx, x, y, hp, maxhp, deadT, , , , , , , armored] = row;
  if (heroIdx < 0) return;
  const hd = HEROES[heroIdx];
  const s = seats[seat];
  const em = Math.max(hd.r * 2.1, 26 / z);
  g.save(); g.translate(x, y);
  if (deadT > 0) {
    g.globalAlpha = 0.55;
    g.font = `${em}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('😵', 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.font = `bold ${Math.max(15, 15 / z)}px Fredoka, sans-serif`;
    g.fillText(`${Math.ceil(deadT / 10)}s`, 0, -em * 0.8);
    g.restore(); return;
  }
  g.strokeStyle = s ? s.color : '#fff'; g.lineWidth = Math.max(4, 5 / z);
  g.fillStyle = 'rgba(255,255,255,.7)';
  g.beginPath(); g.arc(0, 2, em * 0.6, 0, Math.PI * 2); g.fill(); g.stroke();
  if (isMe) {
    g.strokeStyle = '#fff'; g.setLineDash([6, 5]); g.lineDashOffset = -(now * 0.04) % 11;
    g.beginPath(); g.arc(0, 2, em * 0.74, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  }
  if (armored) {
    g.strokeStyle = '#7fd8ff'; g.lineWidth = Math.max(3, 4 / z);
    g.beginPath(); g.arc(0, 2, em * 0.68, 0, Math.PI * 2); g.stroke();
  }
  g.font = `${em}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(hd.emoji, 0, 0);
  hpBar(g, 0, em * 0.72, em * 1.1, hp / maxhp);
  if (s) {
    g.fillStyle = s.color; g.font = `bold ${Math.max(13, 14 / z)}px Fredoka, sans-serif`;
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 3;
    g.strokeText(s.name, 0, -em * 0.78);
    g.fillText(s.name, 0, -em * 0.78);
  }
  g.restore();
}

function drawGummy(g, row, seats, z) {
  const [, seat, x, y, hpPct] = row;
  const s = seats[seat];
  const em = Math.max(GUMMY.r * 2, 14 / z);
  g.save(); g.translate(x, y);
  g.font = `${em}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('🧸', 0, 0);
  if (s) { g.strokeStyle = s.color; g.lineWidth = Math.max(2, 2.5 / z); g.beginPath(); g.arc(0, 2, em * 0.55, 0, Math.PI * 2); g.stroke(); }
  if (hpPct < 100) hpBar(g, 0, em * 0.65, em, hpPct / 100);
  g.restore();
}

const FX_LIFE = { pew: 0.25, zap: 0.3, slash: 0.25, shell: 0.6, boom: 0.6, bash: 0.5, cry: 0.8, nova: 0.6,
  barrage: 0.6, trap: 0.8, pierce: 0.4, meteor: 0.8, heal: 0.8, overclock: 0.8, shield: 0.6, built: 0.7,
  sold: 0.5, level: 0.9, die: 0.6, hit: 0.3, spawn: 0.5, horn: 1.4, clear: 1.6, castlehit: 0.5,
  herodown: 1.2, crumble: 0.9, syrup: 0.5 };

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

/* one full frame from a snapshot — both screens use this */
function drawScene(g, world, snap, seats, now, z, mySeat) {
  drawTerrain(g, world, snap.ap, now);
  drawFields(g, snap.fields || [], now);
  drawCastleAt(g, snap.c[0], snap.c[1], snap.chit, now);
  for (const b of snap.b) drawBld(g, b, seats, z, now);
  for (const a of snap.a) drawGummy(g, a, seats, z);
  const ground = snap.e.filter((e) => !ETYPES[ETYPE[e[1]]].air);
  const air = snap.e.filter((e) => ETYPES[ETYPE[e[1]]].air);
  for (const e of ground) drawEnemy(g, e, z, now);
  for (const p of snap.pl) drawHeroRow(g, p, seats, z, now, mySeat !== undefined && p[0] === mySeat);
  for (const e of air) drawEnemy(g, e, z, now);
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
    return q ? [r[0], r[1], mix(q[2], r[2]), mix(q[3], r[3]), r[4]] : r;
  });
  return { ...s, pl, e, a: al };
}

const fitZoom = (w, h) => Math.min(w, h) / (WORLD_R * 2.12);

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
  let dragging = null, lastPhase = '', lastWave = 0;
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
        <div class="gg-pickname">${h.name}</div>
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
    else if (snap.ph === 'prep') wp.textContent = snap.w === 0 ? '🔨 Build your defenses!' : `🌊 Wave ${snap.w} cleared!`;
    else wp.textContent = `🌊 Wave ${snap.w} of ${LAST_WAVE}`;

    const frac = clamp(snap.c[0] / snap.c[1], 0, 1);
    $q('.gg-castlefill').style.width = `${frac * 100}%`;
    $q('.gg-castlefill').style.background = frac > 0.5 ? '#6bcf7f' : frac > 0.25 ? '#ffd93d' : '#ff4d6d';
    $q('.gg-castletxt').textContent = `${snap.c[0]} / ${snap.c[1]}`;

    const tp = $q('.gg-timerpill');
    if (snap.ph === 'prep') { tp.classList.remove('hidden'); tp.textContent = `⏳ Wave ${snap.w + 1} in ${Math.ceil(snap.pt / 10)}s`; }
    else tp.classList.add('hidden');

    const hp = $q('.gg-hordepill');
    if (snap.ph === 'wave') { hp.classList.remove('hidden'); hp.textContent = `👹 ${snap.left} left`; }
    else hp.classList.add('hidden');

    /* roster chips */
    $q('.gg-roster').innerHTML = snap.pl.map((r) => {
      const s = st[r[0]];
      if (!s) return '';
      const hero = r[1] >= 0 ? HEROES[r[1]].emoji : '❔';
      const status = r[6] > 0 ? ` · 😵 ${Math.ceil(r[6] / 10)}s` : (snap.ph === 'prep' && r[11] ? ' · ✅ ready' : '');
      return `<div class="gg-chip ${s.connected ? '' : 'gg-chip-off'}" style="border-color:${s.color}">
        <span class="gg-chip-hero">${hero}</span>
        <span class="gg-chip-name">${escapeHtml(s.name)}</span>
        <span class="gg-chip-meta">🪙${r[7]} · ⚔️${r[12]}${status}</span>
      </div>`;
    }).join('');

    /* phase transitions → banners */
    if (snap.ph !== lastPhase || snap.w !== lastWave) {
      if (snap.ph === 'wave' && (lastPhase !== 'wave' || snap.w !== lastWave)) {
        banner(snap.w % 5 === 0
          ? `<b>WAVE ${snap.w}</b><span>👹 The Rock Candy Colossus approaches!</span>`
          : `<b>WAVE ${snap.w}</b><span>Here they come — hold the line!</span>`);
      } else if (snap.ph === 'prep' && lastPhase === 'wave') {
        banner(`<b>WAVE ${snap.w} CLEARED! 🎉</b><span>Grab your phone — upgrade time!</span>`);
      } else if (snap.ph === 'prep' && lastPhase === 'pick') {
        banner(`<b>BUILD PHASE 🔨</b><span>Place towers from your phones before wave 1!</span>`, 4000);
      }
      lastPhase = snap.ph; lastWave = snap.w;
    }

    /* game over */
    if (snap.over) showOver(snap);
  }

  function showOver(snap) {
    const el = ctx.root.querySelector('.gg-over');
    if (!el.classList.contains('hidden')) return;
    const st = seats();
    const rows = snap.pl.map((r) => {
      const s = st[r[0]];
      return s ? `<div class="gg-over-row" style="border-color:${s.color}">
        <span>${r[1] >= 0 ? HEROES[r[1]].emoji : '❔'} ${escapeHtml(s.name)}</span><span>⚔️ ${r[12]} kills</span>
      </div>` : '';
    }).join('');
    el.innerHTML = snap.over === 'win'
      ? `<div class="gg-over-card gg-over-win"><h1>🏆 VICTORY!</h1>
         <p>All ${LAST_WAVE} waves defeated — the Gingerbread Castle stands!</p>${rows}
         <p class="gg-over-hint">Press ⌂ Lobby to play something else</p></div>`
      : `<div class="gg-over-card gg-over-lose"><h1>💔 The castle has crumbled…</h1>
         <p>You held out until wave ${sim.stats.waveReached}. Great teamwork — try a new tower plan!</p>${rows}
         <p class="gg-over-hint">Press ⌂ Lobby to try again</p></div>`;
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
    g.save();
    g.translate(canvas.width / 2, canvas.height / 2);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);
    drawScene(g, sim.world, view, seats(), now, cam.z);
    g.restore();
  }

  function onMessage(playerId, data) {
    if (!sim.players.has(playerId)) { addPlayer(sim, playerId); sendInit(); }
    const p = sim.players.get(playerId);
    switch (data.k) {
      case 'pick': pickHero(sim, playerId, data.hero); sendInit(playerId); break;
      case 'mv': p.dir = { x: +data.x || 0, y: +data.y || 0 }; break;
      case 'ab': castAbility(sim, playerId, clamp(data.i | 0, 0, 2)); break;
      case 'walk':
        if (sim.phase === 'prep' && p.hero && !p.dead) p.moveTo = { x: +data.x || 0, y: +data.y || 0 };
        break;
      case 'build': {
        const res = build(sim, playerId, data.type, +data.x || 0, +data.y || 0);
        if (res === 'coins') ctx.sendTo(playerId, { k: 'toast', msg: 'Not enough coins! 🪙' });
        else if (res === 'spot') ctx.sendTo(playerId, { k: 'toast', msg: "Can't build there — too close to a trail or building" });
        break;
      }
      case 'up': upgradeHero(sim, playerId, data.what); break;
      case 'bup': upgradeBld(sim, playerId, data.id | 0); break;
      case 'sell': sellBld(sim, playerId, data.id | 0); break;
      case 'ready': p.ready = !!data.v; break;
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
    if (p) { p.connected = true; p.ready = false; }
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
    <h2 class="gg-cpick-title">Choose your hero</h2>
    <div class="gg-cpick-grid"></div>
  </div>

  <!-- in-game -->
  <div class="gg-cgame hidden">
    <div class="gg-cstatus">
      <span class="gg-cs-wave"></span>
      <span class="gg-cs-coins"></span>
      <div class="gg-cs-hpwrap"><div class="gg-cs-hp"></div></div>
    </div>
    <div class="gg-canvaswrap"><canvas class="gg-cmap"></canvas></div>

    <!-- WAVE controls: joystick + 3 powers -->
    <div class="gg-wavehud hidden">
      <div class="gg-stickzone"><div class="gg-stick"><div class="gg-nub"></div></div></div>
      <div class="gg-abs"></div>
    </div>

    <!-- PREP controls: the upgrade shop -->
    <div class="gg-prep hidden">
      <div class="gg-prep-head">
        <span class="gg-prep-timer">⏳</span>
        <button class="gg-ready-btn">✅ Ready!</button>
      </div>
      <div class="gg-tabs">
        <button class="gg-tab gg-tab-on" data-tab="hero">🦸 Hero</button>
        <button class="gg-tab" data-tab="towers">🏗️ My Towers</button>
        <button class="gg-tab" data-tab="build">🔨 Build</button>
        <button class="gg-tab" data-tab="map">🗺️ Walk</button>
      </div>
      <div class="gg-tabbody"></div>
    </div>

    <!-- placement bar while dropping a tower -->
    <div class="gg-placebar hidden">
      <button class="gg-place-cancel">✖ Cancel</button>
      <span class="gg-place-hint">Tap the map to aim</span>
      <button class="gg-place-ok">🔨 Place</button>
    </div>

    <div class="gg-toast hidden"></div>
    <div class="gg-cover hidden"></div>
  </div>
</div>`;

function createController(ctx) {
  let world = null, seats = [], mySeat = -1;
  let prev = null, cur = null, fxLive = [];
  let canvas, g, raf = 0;
  let mode = 'pick';                 // 'pick' | 'wave' | 'prep'
  let tab = 'hero';
  let placing = null;                // { type, x, y } while dropping a tower
  let cam = { x: 0, y: 0, z: 0.1 };
  let mapCam = null;                 // pan/zoom for prep map { x, y, z }
  let stick = null;                  // active joystick touch
  let lastMv = 0, lastSent = '0,0';
  let ready = false, myHero = null;
  let touch = null;                  // prep map pan/pinch state
  let onResize;

  const $q = (s) => ctx.root.querySelector(s);

  function start() {
    ctx.root.innerHTML = CTRL_HTML;
    canvas = $q('.gg-cmap');
    g = canvas.getContext('2d');

    /* hero cards */
    $q('.gg-cpick-grid').innerHTML = HEROES.map((h) => `
      <button class="gg-ccard" data-hero="${h.id}">
        <span class="gg-ccard-emoji">${h.emoji}</span>
        <span class="gg-ccard-name">${h.name}</span>
        <span class="gg-ccard-desc">${h.desc}</span>
        <span class="gg-ccard-abs">${ABILITIES[h.id].map((a) => `${a[1]} ${a[0]}`).join(' · ')}</span>
      </button>`).join('');
    for (const btn of ctx.root.querySelectorAll('.gg-ccard')) {
      btn.addEventListener('click', () => {
        ctx.send({ k: 'pick', hero: btn.dataset.hero });
        btn.classList.add('gg-ccard-picked');
      });
    }

    onResize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    };
    window.addEventListener('resize', onResize);
    onResize();

    bindStick();
    bindMapTouch();
    $q('.gg-ready-btn').addEventListener('click', () => {
      ready = !ready;
      ctx.send({ k: 'ready', v: ready });
      $q('.gg-ready-btn').classList.toggle('gg-ready-on', ready);
      $q('.gg-ready-btn').textContent = ready ? '⏸ Wait, not yet!' : '✅ Ready!';
    });
    for (const t of ctx.root.querySelectorAll('.gg-tab')) {
      t.addEventListener('click', () => { tab = t.dataset.tab; placing = null; updateHud.sig = null; renderTabs(); });
    }
    $q('.gg-place-cancel').addEventListener('click', () => { placing = null; syncMode(true); });
    $q('.gg-place-ok').addEventListener('click', () => {
      if (!placing || placing.x === undefined) return;
      ctx.send({ k: 'build', type: placing.type, x: Math.round(placing.x), y: Math.round(placing.y) });
      placing = null; syncMode(true);
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
    const c = mode === 'prep' && mapCam ? mapCam : cam;
    return { x: (cx - canvas.width / 2) / c.z + c.x, y: (cy - canvas.height / 2) / c.z + c.y };
  }

  function bindMapTouch() {
    canvas.addEventListener('touchstart', (e) => {
      if (mode !== 'prep') return;
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touch = { m: 'pan', x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, moved: 0 };
      } else if (e.touches.length === 2) {
        touch = { m: 'zoom', d: tdist(e), z: mapCam.z };
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      if (mode !== 'prep' || !touch) return;
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
      if (mode !== 'prep' || !touch) return;
      if (touch.m === 'pan' && touch.moved < 14) mapTap(touch.x0, touch.y0);
      if (!e.touches.length) touch = null;
    });
    canvas.addEventListener('click', (e) => {      // desktop testing
      if (mode === 'prep') mapTap(e.clientX, e.clientY);
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
    else if (snap.ph === 'prep') want = 'prep';
    else want = 'wave';
    if (snap.over) want = 'over';
    if (want === mode && !force) return;
    mode = want;
    myHero = me && me[1] >= 0 ? HEROES[me[1]] : null;

    $q('.gg-cpick').classList.toggle('hidden', mode !== 'pick');
    $q('.gg-cgame').classList.toggle('hidden', mode === 'pick');
    $q('.gg-wavehud').classList.toggle('hidden', mode !== 'wave');
    $q('.gg-prep').classList.toggle('hidden', mode !== 'prep' || !!placing);
    $q('.gg-placebar').classList.toggle('hidden', !placing);
    $q('.gg-cgame').classList.toggle('gg-placing', !!placing);

    if (mode === 'prep' && !mapCam) {
      mapCam = { x: 0, y: 0, z: fitZoom(canvas.width, canvas.height) };
    }
    if (mode === 'wave') { placing = null; ready = false; }
    if (mode === 'prep' && !placing) renderTabs();
    if (mode === 'over') showOver(snap);
    requestAnimationFrame(onResize);
  }

  function showOver(snap) {
    const el = $q('.gg-cover');
    el.classList.remove('hidden');
    $q('.gg-wavehud').classList.add('hidden');
    $q('.gg-prep').classList.add('hidden');
    el.innerHTML = snap.over === 'win'
      ? `<h1>🏆</h1><p>VICTORY! The castle stands!</p>`
      : `<h1>💔</h1><p>The castle fell on wave ${snap.w}.<br>Watch the big screen!</p>`;
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
    $q('.gg-cs-wave').textContent = snap.ph === 'wave' ? `🌊 ${snap.w} · 👹 ${snap.left}` :
      snap.ph === 'prep' ? `🌊 Wave ${snap.w + 1} soon` : '🦸';
    $q('.gg-cs-coins').textContent = `🪙 ${me[7]}`;
    const hpFrac = me[5] ? clamp(me[4] / me[5], 0, 1) : 0;
    const bar = $q('.gg-cs-hp');
    bar.style.width = `${hpFrac * 100}%`;
    bar.style.background = hpFrac > 0.5 ? '#6bcf7f' : hpFrac > 0.25 ? '#ffd93d' : '#ff4d6d';

    if (mode === 'wave') updateAbs(me);
    if (mode === 'prep') {
      $q('.gg-prep-timer').textContent = `⏳ ${Math.ceil(snap.pt / 10)}s`;
      /* rebuild the shop only when something it shows actually changed,
         so taps and scrolling never fight a re-render */
      const sig = tab + '|' + me[7] + '|' + me.slice(14).join(',') + '|' +
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

    if (tab === 'hero') {
      const ups = { dmg: me[14], hp: me[15], spd: me[16], pow: me[17] };
      body.innerHTML = Object.entries(HUP).map(([key, u]) => {
        const n = ups[key], maxed = n >= HUP_MAX, cost = hupCost(n);
        const pips = Array.from({ length: HUP_MAX }, (_, i) => `<i class="${i < n ? 'gg-pip-on' : ''}"></i>`).join('');
        return `<div class="gg-uprow">
          <span class="gg-up-emoji">${u.emoji}</span>
          <span class="gg-up-info"><b>${u.label}</b><small>${u.hint}</small><span class="gg-pips">${pips}</span></span>
          <button class="gg-buy" data-up="${key}" ${maxed || coins < cost ? 'disabled' : ''}>
            ${maxed ? 'MAX' : `🪙 ${cost}`}</button>
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
      body.innerHTML = BUILDABLE.map((t) => {
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
          syncMode(true);
          toast('Tap the map to aim, then hit Place!');
        });
      }
    } else if (tab === 'map') {
      body.innerHTML = `<p class="gg-empty">Tap anywhere on the map to walk there.<br><small>Drag to pan · pinch to zoom</small></p>`;
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

    let c;
    if (mode === 'wave' || mode === 'over') {
      const me = view.pl.find((r) => r[0] === mySeat);
      const z = Math.min(canvas.width, canvas.height) / 950;
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
    drawScene(g, world, view, seats, now, c.z, mySeat);

    /* tower ghost while placing */
    if (placing && placing.x !== undefined) {
      const def = BLD[placing.type];
      const ok = canPlace(world, snap.b, placing.x, placing.y);
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
      g.beginPath(); g.arc(0, 0, def.r + 10, 0, Math.PI * 2); g.stroke();
      g.font = `${def.r * 1.8}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(ok ? def.emoji : '🚫', 0, 0);
      g.restore();
      $q('.gg-place-ok').disabled = !ok;
    }
    g.restore();
  }

  function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    ctx.root.innerHTML = '';
  }

  return { start, onMessage, destroy };
}

/* ================= module export ================= */

export default {
  id: 'gumdropguardians',
  title: 'Gumdrop Guardians',
  tagline: 'Co-op tower defense — hold the castle together!',
  emoji: '🛡️',
  minPlayers: 1,
  maxPlayers: 6,
  createHost,
  createController,
};

/* headless testing hooks */
export const __sim = {
  buildWorld, canPlace, makeSim, addPlayer, pickHero, stepSim, build,
  upgradeBld, upgradeHero, sellBld, castAbility, snapshot, buildWave,
  HEROES, BLD, ETYPES, CASTLE, LAST_WAVE, WORLD_R,
};
