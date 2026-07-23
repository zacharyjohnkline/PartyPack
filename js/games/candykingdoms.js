/* ============================================================
   Candy Kingdoms — a kid-friendly lane RTS (phase 4: heroes & war).

   Up to six kingdoms at the points of a snowflake. Gummy Helpers
   harvest bottomless mines (5 shovels max per mine); Bakeries
   train an army of guards, slingers, knights and dragonflies;
   Sugar Shacks raise the army cap; Candy Camps project buildable
   territory; Frosting Towers guard the corridors; the Wizard's
   Bakery summons one of three levelable heroes with ultimates.

   Roads matter: ground troops crawl at 1/3 speed off the lanes,
   plots and arena, funneling every war through the middle.
   Castles are ringed by a solid wall with limited siege slots,
   so armies surround them instead of stacking on top.

   The sim is DOM-free on purpose so it can be tested headlessly
   (see the __sim export at the bottom).
   ============================================================ */

import { escapeHtml } from '../util.js';

/* ---------------- tuning ---------------- */

const TICK_MS = 100;
const SNAP_EVERY = 2;

const ARENA_R = 170;
const LANE_LEN = 430;
const PLOT_R = 200;
const BASE_R = ARENA_R + LANE_LEN + PLOT_R;
const WORLD_R = BASE_R + PLOT_R * 0.6 + 90;
const LANE_STEPS = 6;

const CASTLE = { hp: 1000, r: 56 };
const ROYAL = { cost: 500, time: 1800, hpBonus: 600 };   // ~3 minutes

const WORKER = { hp: 40, speed: 3.1, cost: 30, time: 40, r: 10, mineTicks: 18, fleeR: 110 };
const ENLIST_COST = 10;

/* the roster — tier 2 needs a Royal Castle */
const UNITS = {
  guard:  { hp: 60,  dmg: 8,  cd: 8,  range: 28,  aggro: 130, speed: 2.9, cost: 25, time: 30, r: 13, air: false, hitAir: false, tier: 1 },
  archer: { hp: 45,  dmg: 7,  cd: 9,  range: 110, aggro: 150, speed: 2.7, cost: 35, time: 34, r: 12, air: false, hitAir: true, airBonus: 2, tier: 1 },
  knight: { hp: 170, dmg: 14, cd: 10, range: 30,  aggro: 130, speed: 2.4, cost: 70, time: 60, r: 16, air: false, hitAir: false, tier: 2 },
  flyer:  { hp: 70,  dmg: 10, cd: 8,  range: 30,  aggro: 150, speed: 3.6, cost: 60, time: 50, r: 13, air: true,  hitAir: true, tier: 2 },
};
const KIND_IDX = ['worker', 'guard', 'archer', 'knight', 'flyer', 'hero'];
const COMBAT = ['guard', 'archer', 'knight', 'flyer', 'hero'];

/* heroes: pick once at the Wizard's Bakery, yours for the match */
const HEROES = [
  { id: 'cupcake', name: 'Captain Cupcake', emoji: '🍰', hp: 380, hpLvl: 60, dmg: 20, dmgLvl: 4, range: 34, speed: 2.9, r: 20, hitAir: false, ult: 'Sprinkle Slam' },
  { id: 'wizard',  name: 'Licorice Wizard', emoji: '🧙', hp: 300, hpLvl: 45, dmg: 16, dmgLvl: 3, range: 130, speed: 2.7, r: 19, hitAir: true, splash: 55, ult: 'Sugar Storm' },
  { id: 'jelly',   name: 'Jellybean Knight', emoji: '🛡️', hp: 340, hpLvl: 55, dmg: 12, dmgLvl: 2, range: 30, speed: 2.8, r: 20, hitAir: false, aura: 160, ult: 'Gumdrop Shield' },
];
const HERO_SUMMON = { cost: 120, time: 150 };
const heroRevive = (lvl) => ({ cost: 50 + lvl * 25, time: 100 + lvl * 20 });
const ULT_CD = 450;
const XPV = { worker: 5, guard: 8, archer: 10, knight: 20, flyer: 15, hero: 50 };
const XP_LVL = [30, 75, 135, 210, 300];   // cumulative xp → levels 2..6
const SLAM = { r: 150, dmg: 60, stun: 30 };
const STORM = { r: 170, dmg: 8, every: 5, dur: 40 };
const SHIELD = { r: 180, dur: 50 };
const JELLY_MUL = 0.75;

const BLD = {
  bakery: { hp: 320, cost: 120, time: 110, r: 34, label: 'Bakery' },
  shack:  { hp: 220, cost: 80,  time: 80,  r: 26, label: 'Sugar Shack' },
  camp:   { hp: 260, cost: 100, time: 90,  r: 30, label: 'Candy Camp' },
  tower:  { hp: 380, cost: 110, time: 100, r: 28, label: 'Frosting Tower', range: 160, dmg: 10, cd: 10 },
  wizard: { hp: 300, cost: 150, time: 120, r: 32, label: "Wizard's Bakery" },
};
const TYPE_IDX = ['castle', 'bakery', 'shack', 'camp', 'tower', 'wizard'];

const SUPPLY_BASE = 6, SUPPLY_PER_SHACK = 8, SUPPLY_MAX = 60;
const START_CANDY = 150, START_WORKERS = 3;

const MINE = { r: 34, yield: { starter: 10, lane: 14, rim: 20 }, slots: 5 };
const HARVEST_LEASH = 270;
const CAMP_AURA = 300;
const BUILD_LEASH = 240;
const QUEUE_MAX = 5;

const TOWER_RING_IN = ARENA_R + 46, TOWER_RING_OUT = ARENA_R + 210;
const LANE_CORRIDOR = 70;
const OFFROAD_MUL = 1 / 3;          // ground troops crawl off the roads

const SIEGE_MELEE = 8;              // shovels… er, swords at the castle wall
const SIEGE_AIR = 6;                // dragonflies hovering over it

const SEP_R = 20;

/* ================= geometry (pure) ================= */

function armAngle(i, n) { return -Math.PI / 2 + (i * 2 * Math.PI) / n; }
function polar(a, r) { return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function buildWorld(n) {
  const arms = [], mines = [];
  for (let i = 0; i < n; i++) {
    const a = armAngle(i, n);
    const base = polar(a, BASE_R);
    const perp = { x: -Math.sin(a), y: Math.cos(a) };
    const muster = polar(a, BASE_R - CASTLE.r - 78);
    const lane = [];
    const r0 = BASE_R - PLOT_R * 0.55, r1 = ARENA_R + 14;
    for (let k = 0; k <= LANE_STEPS; k++) lane.push(polar(a, r0 + (r1 - r0) * (k / LANE_STEPS)));
    const hold = polar(a, ARENA_R * 0.38);
    arms.push({ seat: i, angle: a, base, muster, lane, hold });
    mines.push({ x: base.x + perp.x * 145, y: base.y + perp.y * 145, kind: 'starter', arm: i });
    const mid = polar(a, (ARENA_R + BASE_R) / 2);
    mines.push({ x: mid.x + perp.x * 125, y: mid.y + perp.y * 125, kind: 'lane', arm: i });
    const rim = polar(a, ARENA_R + 115);
    mines.push({ x: rim.x + perp.x * 95, y: rim.y + perp.y * 95, kind: 'rim', arm: i });
  }
  return { n, arms, mines, arenaR: ARENA_R, plotR: PLOT_R, baseR: BASE_R, worldR: WORLD_R, castleR: CASTLE.r };
}

/* roads: the arena, every lane corridor, and every kingdom plot */
function onRoad(world, x, y) {
  if (Math.hypot(x, y) <= ARENA_R + 20) return true;
  for (const arm of world.arms) {
    if (dist(x, y, arm.base.x, arm.base.y) <= PLOT_R) return true;
    const a = arm.lane[0], b = arm.lane[arm.lane.length - 1];
    if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= LANE_CORRIDOR) return true;
  }
  return false;
}

/* workers know the candy paths; flyers simply fly */
function speedMul(world, u) {
  if (u.kind === 'worker' || u.kind === 'flyer') return 1;
  return onRoad(world, u.x, u.y) ? 1 : OFFROAD_MUL;
}

function inTowerZone(world, seat, x, y) {
  const home = world.arms[seat];
  if (home && dist(x, y, home.base.x, home.base.y) <= PLOT_R) return true;
  const r = Math.hypot(x, y);
  if (r >= TOWER_RING_IN && r <= TOWER_RING_OUT) return true;
  for (const arm of world.arms) {
    const a = arm.lane[0], b = arm.lane[arm.lane.length - 1];
    if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= LANE_CORRIDOR) return true;
  }
  return false;
}

/* ================= simulation (pure, DOM-free) ================= */

function makeSim(n) {
  const world = buildWorld(n);
  const players = [], buildings = [], units = [];
  let uid = 1;
  for (let i = 0; i < n; i++) {
    players.push({
      seat: i, candy: START_CANDY, castleHp: CASTLE.hp, castleMax: CASTLE.hp, tier: 1,
      elim: false, mode: 'stop', target: -1,
      heroPick: -1, heroSt: 'none', heroLvl: 0, heroXp: 0,
    });
    const b = world.arms[i].base;
    buildings.push({ id: 'c' + i, seat: i, type: 'castle', x: b.x, y: b.y, hp: CASTLE.hp, maxHp: CASTLE.hp, prog: 1, queue: [], up: 0 });
    for (let w = 0; w < START_WORKERS; w++) {
      units.push(newUnit(uid++, i, 'worker', b.x + (Math.random() - 0.5) * 90, b.y + (Math.random() - 0.5) * 90, 'c' + i));
    }
  }
  return {
    tick: 0, world, players, buildings, units, storms: [],
    fx: [], nextUid: uid, nextBid: 1,
    over: false, winner: -1,
  };
}

function heroDef(pick, lvl) {
  const h = HEROES[pick];
  return {
    ...h,
    hp: h.hp + h.hpLvl * (lvl - 1),
    dmg: h.dmg + h.dmgLvl * (lvl - 1),
    cd: 9, aggro: 170, air: false,
  };
}

function unitDef(sim, u) {
  if (u.kind === 'worker') return WORKER;
  if (u.kind === 'hero') return heroDef(u.heroPick, u.lvl);
  return UNITS[u.kind];
}

function newUnit(id, seat, kind, x, y, home) {
  const def = kind === 'worker' ? WORKER : UNITS[kind];
  return {
    id, seat, kind, x, y, px: x, py: y, hp: def.hp, maxHp: def.hp,
    st: kind === 'worker' ? 'idle' : 'muster',
    path: null, pi: 0, cd: 0, carry: 0, mineIdx: -1, mt: 0,
    home: home || null, rx: 0, ry: 0, stun: 0, shield: 0,
  };
}

function newHero(id, seat, pick, lvl, xp, x, y) {
  const def = heroDef(pick, lvl);
  return {
    id, seat, kind: 'hero', heroPick: pick, lvl, xp, x, y, px: x, py: y,
    hp: def.hp, maxHp: def.hp, st: 'muster',
    path: null, pi: 0, cd: 0, carry: 0, mineIdx: -1, mt: 0,
    home: null, rx: 0, ry: 0, stun: 0, shield: 0, ultCd: 0,
  };
}

function supplyCap(sim, seat) {
  let shacks = 0;
  for (const b of sim.buildings) if (b.seat === seat && b.type === 'shack' && b.prog >= 1) shacks++;
  return Math.min(SUPPLY_MAX, SUPPLY_BASE + shacks * SUPPLY_PER_SHACK);
}
function supplyUsed(sim, seat) {
  let n = 0;
  for (const u of sim.units) if (u.seat === seat && u.kind !== 'hero') n++;
  for (const b of sim.buildings) if (b.seat === seat) n += b.queue.filter((j) => j.kind !== 'hero').length;
  return n;
}

/* queue a unit — workers at castle/camp, troops at a bakery */
function train(sim, seat, kind, bldId) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over) return false;
  const def = kind === 'worker' ? WORKER : UNITS[kind];
  if (!def) return false;
  if (def.tier === 2 && p.tier < 2) return false;
  const okTypes = kind === 'worker' ? ['castle', 'camp'] : ['bakery'];
  let best = null;
  for (const b of sim.buildings) {
    if (b.seat !== seat || !okTypes.includes(b.type) || b.prog < 1 || b.queue.length >= QUEUE_MAX) continue;
    if (bldId) { if (b.id === bldId) { best = b; break; } continue; }
    if (!best || b.queue.length < best.queue.length) best = b;
  }
  if (!best) return false;
  if (p.candy < def.cost) return false;
  if (supplyUsed(sim, seat) + 1 > supplyCap(sim, seat)) return false;
  p.candy -= def.cost;
  best.queue.push({ kind, t: def.time });
  return true;
}

/* trade the hard hat for a shield: one idle helper becomes a guard */
function enlist(sim, seat, bldId) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over || p.candy < ENLIST_COST) return false;
  let pickU = null, bestD = Infinity;
  const anchor = bldId ? sim.buildings.find((b) => b.id === bldId && b.seat === seat) : null;
  const ax = anchor ? anchor.x : sim.world.arms[seat].base.x;
  const ay = anchor ? anchor.y : sim.world.arms[seat].base.y;
  for (const u of sim.units) {
    if (u.seat !== seat || u.kind !== 'worker' || u.hp <= 0) continue;
    if (!['idle', 'lineup', 'toMine'].includes(u.st)) continue;
    const d = dist(u.x, u.y, ax, ay);
    if (d < bestD) { bestD = d; pickU = u; }
  }
  if (!pickU) return false;
  p.candy -= ENLIST_COST;
  pickU.kind = 'guard';
  pickU.hp = UNITS.guard.hp; pickU.maxHp = UNITS.guard.hp;
  pickU.st = 'muster'; pickU.home = null; pickU.carry = 0; pickU.mineIdx = -1;
  sim.fx.push({ t: 'spawn', x: pickU.x, y: pickU.y });
  return true;
}

/* Royal Castle: pricey, slow, unlocks knights + dragonflies */
function upgradeCastle(sim, seat) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over || p.tier >= 2) return false;
  const castle = sim.buildings.find((b) => b.seat === seat && b.type === 'castle');
  if (!castle || castle.up > 0 || p.candy < ROYAL.cost) return false;
  p.candy -= ROYAL.cost;
  castle.up = ROYAL.time;
  return true;
}

/* summon (first time: pick 0-2) or revive your hero at a Wizard's Bakery */
function heroCommand(sim, seat, pick) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over) return false;
  if (p.heroSt === 'alive' || p.heroSt === 'queued') return false;
  const wiz = sim.buildings.find((b) => b.seat === seat && b.type === 'wizard' && b.prog >= 1 && !b.queue.some((j) => j.kind === 'hero'));
  if (!wiz) return false;
  if (p.heroSt === 'none') {
    if (!(pick >= 0 && pick <= 2)) return false;
    if (p.candy < HERO_SUMMON.cost) return false;
    p.candy -= HERO_SUMMON.cost;
    p.heroPick = pick; p.heroLvl = 1; p.heroXp = 0;
    wiz.queue.push({ kind: 'hero', t: HERO_SUMMON.time });
  } else {   // down → revive (same hero, same level)
    const rv = heroRevive(p.heroLvl);
    if (p.candy < rv.cost) return false;
    p.candy -= rv.cost;
    wiz.queue.push({ kind: 'hero', t: rv.time });
  }
  p.heroSt = 'queued';
  return true;
}

function heroUnit(sim, seat) {
  for (const u of sim.units) if (u.seat === seat && u.kind === 'hero' && u.hp > 0) return u;
  return null;
}

/* the big glowing button */
function castUlt(sim, seat) {
  const p = sim.players[seat];
  const h = heroUnit(sim, seat);
  if (!p || p.elim || sim.over || !h || h.lvl < 6 || h.ultCd > 0) return false;
  h.ultCd = ULT_CD;
  const hd = HEROES[h.heroPick];
  if (hd.id === 'cupcake') {
    sim.fx.push({ t: 'slam', x: h.x, y: h.y });
    for (const e of sim.units) {
      if (e.seat === seat || e.hp <= 0) continue;
      if (dist(h.x, h.y, e.x, e.y) <= SLAM.r) { e.stun = SLAM.stun; dmgUnit(sim, e, SLAM.dmg, seat); }
    }
  } else if (hd.id === 'wizard') {
    sim.storms.push({ seat, x: h.x, y: h.y, t: STORM.dur });
    sim.fx.push({ t: 'storm', x: h.x, y: h.y });
  } else {
    sim.fx.push({ t: 'shieldcast', x: h.x, y: h.y });
    for (const a of sim.units) {
      if (a.seat !== seat || a.hp <= 0) continue;
      if (dist(h.x, h.y, a.x, a.y) <= SHIELD.r) a.shield = SHIELD.dur;
    }
  }
  return true;
}

function setMode(sim, seat, mode) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  if (mode !== 'send' && mode !== 'stop') return;
  p.mode = mode;
  if (mode === 'stop') {
    for (const u of sim.units) {
      if (u.seat === seat && COMBAT.includes(u.kind) && (u.st === 'path' || u.st === 'hold')) {
        u.st = 'stand'; u.path = null;
      }
    }
  }
}

function setTarget(sim, seat, target) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  if (target === -1) { p.target = -1; return; }
  const t = sim.players[target];
  if (t && !t.elim && target !== seat) p.target = target;
}

function gather(sim, seat, x, y) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over) return false;
  if (!isFinite(x) || !isFinite(y) || Math.hypot(x, y) > WORLD_R) return false;
  p.mode = 'stop';
  sim.fx.push({ t: 'flag', x, y });
  for (const u of sim.units) {
    if (u.seat === seat && COMBAT.includes(u.kind) && u.hp > 0) {
      u.st = 'rally'; u.path = null; u.rx = x; u.ry = y;
    }
  }
  return true;
}

function nearestArm(world, x, y) {
  const a = Math.atan2(y, x);
  let best = 0, bestD = Infinity;
  for (const arm of world.arms) {
    let d = Math.abs(a - arm.angle);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (d < bestD) { bestD = d; best = arm.seat; }
  }
  return best;
}

function pushPath(world, targetSeat) {
  const arm = world.arms[targetSeat];
  const path = arm.lane.slice().reverse().map((pt) => ({ x: pt.x, y: pt.y }));
  path.push({ x: arm.base.x, y: arm.base.y, castle: targetSeat });
  return path;
}

function assignAdvance(sim, u, p) {
  const world = sim.world;
  if (Math.hypot(u.x, u.y) < ARENA_R + 40) { u.st = 'hold'; u.path = null; return; }
  const armIdx = nearestArm(world, u.x, u.y);
  const arm = world.arms[armIdx];
  let ni = 0, bestD = Infinity;
  for (let i = 0; i < arm.lane.length; i++) {
    const d = dist(u.x, u.y, arm.lane[i].x, arm.lane[i].y);
    if (d < bestD) { bestD = d; ni = i; }
  }
  let path;
  if (p.target >= 0 && armIdx === p.target && !sim.players[p.target].elim) {
    path = arm.lane.slice(0, ni + 1).reverse().map((q) => ({ x: q.x, y: q.y }));
    path.push({ x: arm.base.x, y: arm.base.y, castle: p.target });
  } else {
    path = arm.lane.slice(ni).map((q) => ({ x: q.x, y: q.y }));
    path.push({ x: arm.hold.x, y: arm.hold.y, hold: true });
  }
  u.st = 'path'; u.path = path; u.pi = 0;
}

function bldRadius(b) { return b.type === 'castle' ? CASTLE.r : BLD[b.type].r; }

/* nearest attackable enemy — respects air rules */
function nearestEnemy(sim, u, radius) {
  const def = unitDef(sim, u);
  const canAir = !!def.hitAir;
  let best = null, bestD = radius;
  for (const e of sim.units) {
    if (e.seat === u.seat || e.hp <= 0) continue;
    if (e.kind === 'flyer' && !canAir) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d < bestD) { bestD = d; best = { unit: e, d }; }
  }
  for (const b of sim.buildings) {
    if (b.seat === u.seat || b.hp <= 0) continue;
    const d = dist(u.x, u.y, b.x, b.y) - bldRadius(b);
    if (d < bestD) { bestD = d; best = { bld: b, d, x: b.x, y: b.y }; }
  }
  return best;
}

function dropoffs(sim, seat) {
  return sim.buildings.filter((b) => b.seat === seat && b.prog >= 1 && (b.type === 'castle' || b.type === 'camp'));
}
function nearestDropoff(sim, seat, x, y) {
  let best = null, bestD = Infinity;
  for (const b of dropoffs(sim, seat)) {
    const d = dist(x, y, b.x, b.y);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function minersAt(sim, mineIdx) {
  let n = 0;
  for (const u of sim.units) if (u.st === 'mining' && u.mineIdx === mineIdx) n++;
  return n;
}
function pickMineForHome(sim, homeBld) {
  const cands = [];
  for (let i = 0; i < sim.world.mines.length; i++) {
    const m = sim.world.mines[i];
    const d = dist(homeBld.x, homeBld.y, m.x, m.y);
    if (d <= HARVEST_LEASH) cands.push({ i, d });
  }
  if (!cands.length) return -1;
  cands.sort((a, b) => a.d - b.d);
  for (const c of cands) if (minersAt(sim, c.i) < MINE.slots) return c.i;
  return cands[0].i;
}
function findBuilding(sim, id) {
  for (const b of sim.buildings) if (b.id === id) return b;
  return null;
}

function canPlace(world, buildings, units, seat, type, x, y) {
  const def = BLD[type];
  if (!def) return false;
  if (Math.hypot(x, y) > WORLD_R - 30) return false;
  if (Math.hypot(x, y) < ARENA_R + 46) return false;
  for (const b of buildings) {
    const br = b.type === 'castle' ? CASTLE.r : BLD[b.type].r;
    if (dist(x, y, b.x, b.y) < def.r + br + 14) return false;
  }
  for (const m of world.mines) {
    if (dist(x, y, m.x, m.y) < def.r + MINE.r + 10) return false;
  }
  if (type === 'tower' && !inTowerZone(world, seat, x, y)) return false;
  const home = world.arms[seat] ? world.arms[seat].base : null;
  if (home && dist(x, y, home.x, home.y) <= PLOT_R) return true;
  for (const b of buildings) {
    if (b.seat === seat && b.type === 'camp' && b.prog >= 1 && dist(x, y, b.x, b.y) <= CAMP_AURA) return true;
  }
  if (type === 'camp') {
    for (const u of units) {
      if (u.seat === seat && dist(x, y, u.x, u.y) <= BUILD_LEASH) return true;
    }
  }
  return false;
}

function build(sim, seat, type, x, y) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over) return false;
  const def = BLD[type];
  if (!def || p.candy < def.cost) return false;
  if (!canPlace(sim.world, sim.buildings, sim.units, seat, type, x, y)) return false;
  p.candy -= def.cost;
  sim.buildings.push({
    id: 'b' + sim.nextBid++, seat, type, x, y,
    hp: def.hp, maxHp: def.hp, prog: 0, queue: [], up: 0,
  });
  sim.fx.push({ t: 'spawn', x, y });
  return true;
}

function moveToward(u, tx, ty, speed) {
  const d = dist(u.x, u.y, tx, ty);
  if (d < 0.001) return;
  const step = Math.min(speed, d);
  u.x += ((tx - u.x) / d) * step;
  u.y += ((ty - u.y) / d) * step;
}

/* jelly heroes toughen nearby friends */
function jellyGuarded(sim, tgt) {
  for (const u of sim.units) {
    if (u.kind === 'hero' && u.seat === tgt.seat && u.hp > 0 && HEROES[u.heroPick].id === 'jelly') {
      if (dist(u.x, u.y, tgt.x, tgt.y) <= HEROES[2].aura) return true;
    }
  }
  return false;
}

/* every point of unit damage flows through here: shields, auras, xp, hero falls */
function dmgUnit(sim, tgt, amount, srcSeat) {
  if (tgt.hp <= 0) return;
  if (tgt.shield > 0) { sim.fx.push({ t: 'ding', x: tgt.x, y: tgt.y }); return; }
  let amt = amount;
  if (tgt !== null && jellyGuarded(sim, tgt)) amt = Math.ceil(amt * JELLY_MUL);
  tgt.hp -= amt;
  sim.fx.push({ t: 'hit', x: tgt.x, y: tgt.y });
  if (tgt.hp <= 0) {
    tgt.hp = 0;
    sim.fx.push({ t: 'poof', x: tgt.x, y: tgt.y });
    if (tgt.kind === 'hero') {
      const p = sim.players[tgt.seat];
      p.heroSt = 'down'; p.heroLvl = tgt.lvl; p.heroXp = tgt.xp;
    }
    grantXp(sim, srcSeat, tgt);
  }
}

function grantXp(sim, srcSeat, victim) {
  if (srcSeat === undefined || srcSeat < 0 || !sim.players[srcSeat]) return;
  const h = heroUnit(sim, srcSeat);
  if (!h || dist(h.x, h.y, victim.x, victim.y) > 350) return;
  h.xp += XPV[victim.kind] || 5;
  let lvl = 1;
  for (const th of XP_LVL) if (h.xp >= th) lvl++;
  lvl = Math.min(6, lvl);
  if (lvl > h.lvl) {
    h.lvl = lvl;
    const def = heroDef(h.heroPick, lvl);
    h.maxHp = def.hp;
    h.hp = Math.min(def.hp, h.hp + Math.round(def.hp * 0.25));
    sim.fx.push({ t: 'level', x: h.x, y: h.y });
  }
  const p = sim.players[srcSeat];
  p.heroLvl = h.lvl; p.heroXp = h.xp;
}

function eliminate(sim, seat, bySeat) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  p.elim = true;
  p.mode = 'stop';
  const home = sim.world.arms[seat].base;
  sim.fx.push({ t: 'boom', x: home.x, y: home.y });
  for (const u of sim.units) {
    if (u.seat === seat && u.hp > 0) { u.hp = 0; sim.fx.push({ t: 'poof', x: u.x, y: u.y }); }
  }
  for (const b of sim.buildings) {
    if (b.seat === seat && b.hp > 0 && b.type !== 'castle') { b.hp = 0; sim.fx.push({ t: 'poof', x: b.x, y: b.y }); }
  }
  for (const q of sim.players) if (q.target === seat) q.target = -1;
  for (const u of sim.units) {
    if (u.hp > 0 && u.path && u.path.some((wp) => wp.castle === seat)) { u.st = 'stand'; u.path = null; }
  }
  sim.lastElim = { seat, bySeat: typeof bySeat === 'number' ? bySeat : -1 };
  const alive = sim.players.filter((q) => !q.elim);
  if (alive.length <= 1) {
    sim.over = true;
    sim.winner = alive.length ? alive[0].seat : -1;
  }
}

function damageBuilding(sim, b, dmg, bySeat) {
  b.hp -= dmg;
  if (b.hp <= 0) {
    b.hp = 0;
    if (b.type === 'castle') {
      sim.players[b.seat].castleHp = 0;
      eliminate(sim, b.seat, bySeat);
    } else {
      if (b.type === 'wizard' && b.queue.some((j) => j.kind === 'hero')) {
        const p = sim.players[b.seat];
        p.heroSt = p.heroLvl > 0 ? 'down' : 'none';
      }
      sim.fx.push({ t: 'poof', x: b.x, y: b.y });
    }
  }
}

function stepSim(sim) {
  if (sim.over) return;
  sim.tick++;
  const world = sim.world;

  /* construction, royal upgrades, training queues, tower fire */
  for (const b of sim.buildings) {
    if (b.hp <= 0) continue;
    if (b.prog < 1) {
      b.prog = Math.min(1, b.prog + 1 / BLD[b.type].time);
      if (b.prog >= 1) sim.fx.push({ t: 'spawn', x: b.x, y: b.y });
      continue;
    }
    if (b.type === 'castle' && b.up > 0) {
      b.up--;
      if (b.up <= 0) {
        const p = sim.players[b.seat];
        p.tier = 2;
        b.maxHp += ROYAL.hpBonus; b.hp += ROYAL.hpBonus;
        p.castleMax = b.maxHp;
        sim.fx.push({ t: 'level', x: b.x, y: b.y });
        sim.fx.push({ t: 'boomsoft', x: b.x, y: b.y });
      }
    }
    if (b.queue.length) {
      const job = b.queue[0];
      job.t--;
      if (job.t <= 0) {
        b.queue.shift();
        const jx = (Math.random() - 0.5) * 60, jy = (Math.random() - 0.5) * 60;
        if (job.kind === 'hero') {
          const p = sim.players[b.seat];
          sim.units.push(newHero(sim.nextUid++, b.seat, p.heroPick, Math.max(1, p.heroLvl), p.heroXp, b.x + jx, b.y + jy + 40));
          p.heroSt = 'alive';
          sim.fx.push({ t: 'level', x: b.x + jx, y: b.y + jy });
        } else {
          sim.units.push(newUnit(sim.nextUid++, b.seat, job.kind, b.x + jx, b.y + jy + bldRadius(b) * 0.6, b.id));
        }
        sim.fx.push({ t: 'spawn', x: b.x + jx, y: b.y + jy });
      }
    }
    if (b.type === 'tower') {
      b.cd = Math.max(0, (b.cd || 0) - 1);
      if (b.cd === 0) {
        let tgt = null, tgtD = BLD.tower.range;
        for (const e of sim.units) {
          if (e.seat === b.seat || e.hp <= 0) continue;
          const d = dist(b.x, b.y, e.x, e.y);
          if (d < tgtD) { tgtD = d; tgt = e; }
        }
        if (tgt) {
          b.cd = BLD.tower.cd;
          sim.fx.push({ t: 'zap', x: b.x, y: b.y, x2: tgt.x, y2: tgt.y });
          dmgUnit(sim, tgt, BLD.tower.dmg, b.seat);
        } else {
          let bt = null, btD = BLD.tower.range;
          for (const e of sim.buildings) {
            if (e.seat === b.seat || e.hp <= 0) continue;
            const d = dist(b.x, b.y, e.x, e.y) - bldRadius(e);
            if (d < btD) { btD = d; bt = e; }
          }
          if (bt) {
            damageBuilding(sim, bt, BLD.tower.dmg, b.seat);
            b.cd = BLD.tower.cd;
            sim.fx.push({ t: 'zap', x: b.x, y: b.y, x2: bt.x, y2: bt.y });
            sim.fx.push({ t: 'hit', x: bt.x, y: bt.y });
          }
        }
      }
    }
  }

  /* sugar storms rage on */
  for (const s of sim.storms) {
    s.t--;
    if (s.t % STORM.every === 0) {
      sim.fx.push({ t: 'storm', x: s.x, y: s.y });
      for (const e of sim.units) {
        if (e.seat === s.seat || e.hp <= 0) continue;
        if (dist(s.x, s.y, e.x, e.y) <= STORM.r) dmgUnit(sim, e, STORM.dmg, s.seat);
      }
    }
  }
  sim.storms = sim.storms.filter((s) => s.t > 0);

  /* Send mode: continuous pressure */
  for (const p of sim.players) {
    if (p.elim || p.mode !== 'send') continue;
    let horn = false;
    for (const u of sim.units) {
      if (u.seat !== p.seat || !COMBAT.includes(u.kind) || u.hp <= 0) continue;
      if (u.st === 'muster' || u.st === 'stand') { assignAdvance(sim, u, p); horn = true; }
    }
    if (horn && sim.tick % 20 === 0) {
      sim.fx.push({ t: 'horn', x: world.arms[p.seat].muster.x, y: world.arms[p.seat].muster.y });
    }
  }

  /* castle siege slots this tick */
  const siege = new Map();   // castleSeat → {melee, air}

  /* unit brains */
  for (const u of sim.units) {
    if (u.hp <= 0) continue;
    u.px = u.x; u.py = u.y;
    if (u.cd > 0) u.cd--;
    if (u.shield > 0) u.shield--;
    if (u.ultCd > 0) u.ultCd--;
    if (u.stun > 0) { u.stun--; continue; }
    const def = unitDef(sim, u);
    const spd = def.speed * speedMul(world, u);

    /* ---- Gummy Helpers ---- */
    if (u.kind === 'worker') {
      let home = u.home ? findBuilding(sim, u.home) : null;
      if (!home || home.seat !== u.seat || home.prog < 1 || (home.type !== 'castle' && home.type !== 'camp')) {
        home = nearestDropoff(sim, u.seat, u.x, u.y);
        u.home = home ? home.id : null;
        if (!home) continue;
      }
      const scary = nearestEnemy(sim, u, WORKER.fleeR);
      if (scary && scary.unit) {
        moveToward(u, home.x, home.y, WORKER.speed * 1.25);
        continue;
      }
      if (u.st === 'idle') {
        const mi = pickMineForHome(sim, home);
        if (mi >= 0) { u.mineIdx = mi; u.st = 'toMine'; }
        else if (dist(u.x, u.y, home.x, home.y) > 140) moveToward(u, home.x, home.y, WORKER.speed);
      } else if (u.st === 'toMine') {
        if (u.mineIdx < 0) { u.st = 'idle'; continue; }
        const m = world.mines[u.mineIdx];
        moveToward(u, m.x, m.y, WORKER.speed);
        if (dist(u.x, u.y, m.x, m.y) <= MINE.r + 16) {
          u.st = minersAt(sim, u.mineIdx) < MINE.slots ? 'mining' : 'lineup';
          if (u.st === 'mining') u.mt = WORKER.mineTicks;
        }
      } else if (u.st === 'lineup') {
        if (minersAt(sim, u.mineIdx) < MINE.slots) { u.st = 'mining'; u.mt = WORKER.mineTicks; }
      } else if (u.st === 'mining') {
        u.mt--;
        if (u.mt <= 0) {
          const m = world.mines[u.mineIdx];
          if (m) { u.carry = MINE.yield[m.kind]; u.st = 'toDrop'; }
          else u.st = 'idle';
        }
      } else if (u.st === 'toDrop') {
        moveToward(u, home.x, home.y, WORKER.speed);
        if (dist(u.x, u.y, home.x, home.y) <= bldRadius(home) + 14) {
          sim.players[u.seat].candy += u.carry;
          u.carry = 0; u.st = 'idle';
        }
      }
      continue;
    }

    /* ---- troops & heroes ---- */
    if (u.st === 'rally') {
      if (dist(u.x, u.y, u.rx, u.ry) > 55) { moveToward(u, u.rx, u.ry, spd); continue; }
      u.st = 'stand';
    }

    const foe = nearestEnemy(sim, u, def.aggro * (u.st === 'hold' ? 1.6 : 1));
    if (foe) {
      if (foe.unit) {
        const e = foe.unit;
        if (foe.d <= def.range) {
          if (u.cd === 0) {
            u.cd = def.cd;
            let amt = def.dmg;
            if (e.kind === 'flyer' && def.airBonus) amt *= def.airBonus;
            if (def.range > 60) sim.fx.push({ t: 'pew', x: u.x, y: u.y, x2: e.x, y2: e.y });
            dmgUnit(sim, e, amt, u.seat);
            if (def.splash) {
              for (const e2 of sim.units) {
                if (e2 === e || e2.seat === u.seat || e2.hp <= 0) continue;
                if (e2.kind === 'flyer' && !def.hitAir) continue;
                if (dist(e.x, e.y, e2.x, e2.y) <= def.splash) dmgUnit(sim, e2, Math.ceil(amt / 2), u.seat);
              }
            }
          }
        } else moveToward(u, e.x, e.y, spd);
        continue;
      }
      if (foe.bld) {
        const b = foe.bld;
        /* the castle wall only fits so many attackers */
        if (b.type === 'castle') {
          const key = b.seat;
          const slots = siege.get(key) || { melee: 0, air: 0 };
          const isAir = u.kind === 'flyer';
          const isMelee = def.range <= 60;
          if (isAir ? slots.air >= SIEGE_AIR : (isMelee && slots.melee >= SIEGE_MELEE)) {
            continue;   // crowd behind — wait for a spot at the wall
          }
          if (isAir) slots.air++; else if (isMelee) slots.melee++;
          siege.set(key, slots);
        }
        if (foe.d <= def.range) {
          if (u.cd === 0) {
            u.cd = def.cd;
            if (def.range > 60) sim.fx.push({ t: 'pew', x: u.x, y: u.y, x2: b.x, y2: b.y });
            damageBuilding(sim, b, def.dmg, u.seat);
            sim.fx.push({ t: 'hit', x: foe.x, y: foe.y - bldRadius(b) * 0.5 });
          }
        } else moveToward(u, foe.x, foe.y, spd);
        continue;
      }
    }

    if (u.st === 'muster') {
      const m = world.arms[u.seat].muster;
      if (dist(u.x, u.y, m.x, m.y) > 80) moveToward(u, m.x, m.y, spd);
    } else if (u.st === 'path' && u.path) {
      const wp = u.path[u.pi];
      moveToward(u, wp.x, wp.y, spd);
      const arrive = typeof wp.castle === 'number' ? CASTLE.r + def.range - 6 : 14;
      if (dist(u.x, u.y, wp.x, wp.y) <= arrive) {
        if (wp.hold) { u.st = 'hold'; u.path = null; }
        else if (typeof wp.castle === 'number') {
          if (sim.players[wp.castle].elim) { u.st = 'stand'; u.path = null; }
        }
        else if (u.pi < u.path.length - 1) u.pi++;
      }
    } else if (u.st === 'hold') {
      const p = sim.players[u.seat];
      if (p.mode === 'send' && p.target >= 0 && !sim.players[p.target].elim) {
        u.st = 'path'; u.path = pushPath(world, p.target); u.pi = 0;
      }
    }
  }

  /* crowd shuffling */
  const live = sim.units.filter((u) => u.hp > 0);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if ((a.kind === 'flyer') !== (b.kind === 'flyer')) continue;   // air over ground
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.001 && d < SEP_R) {
        const push = (SEP_R - d) * 0.35;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      } else if (d <= 0.001) {
        a.x += (Math.random() - 0.5); a.y += (Math.random() - 0.5);
      }
    }
  }

  /* the castle wall: ground units cannot stand on the castle */
  for (const b of sim.buildings) {
    if (b.type !== 'castle' || b.hp <= 0) continue;
    for (const u of live) {
      if (u.kind === 'flyer') continue;
      const ur = unitDef(sim, u).r;
      const minD = CASTLE.r + ur - 4;
      const d = dist(u.x, u.y, b.x, b.y);
      if (d < minD && d > 0.001) {
        const nx = (u.x - b.x) / d, ny = (u.y - b.y) / d;
        u.x = b.x + nx * minD; u.y = b.y + ny * minD;
      }
    }
  }

  for (const b of sim.buildings) {
    if (b.type === 'castle' && b.hp > 0) {
      sim.players[b.seat].castleHp = b.hp;
      sim.players[b.seat].castleMax = b.maxHp;
    }
  }
  sim.units = sim.units.filter((u) => u.hp > 0);
  sim.buildings = sim.buildings.filter((b) => b.hp > 0);
}

/* compact wire format for phones
   u:  [id, seat, kindIdx, x, y, hp, aux, shield]  aux = carry | heroPick*100+lvl
   b:  [id, seat, typeIdx, x, y, hp, prog%, queueLen, upgrade%]
   pl: [seat, candy, castleHp, elim, mode, target, supUsed, supCap, ready,
        castleMax, tier, heroPick, heroSt, heroLvl, ultSt, reviveCost] */
function snapshot(sim) {
  const u = sim.units.map((x) => [
    x.id, x.seat, KIND_IDX.indexOf(x.kind), Math.round(x.x), Math.round(x.y), x.hp,
    x.kind === 'hero' ? x.heroPick * 100 + x.lvl : (x.carry > 0 ? 1 : 0),
    x.shield > 0 ? 1 : 0,
  ]);
  const b = sim.buildings.map((x) => [
    x.id, x.seat, TYPE_IDX.indexOf(x.type), Math.round(x.x), Math.round(x.y), x.hp,
    Math.round(x.prog * 100), x.queue.length,
    x.type === 'castle' && x.up > 0 ? Math.round(100 * (1 - x.up / ROYAL.time)) : 0,
  ]);
  const heroSt = { none: 0, queued: 1, alive: 2, down: 3 };
  const pl = sim.players.map((p) => {
    const h = heroUnit(sim, p.seat);
    let ultSt = 0;
    if (h && h.lvl >= 6) ultSt = h.ultCd > 0 ? 1 : 2;
    return [
      p.seat, Math.floor(p.candy), Math.round(p.castleHp), p.elim ? 1 : 0,
      p.mode === 'send' ? 1 : 0, p.target,
      supplyUsed(sim, p.seat), supplyCap(sim, p.seat),
      sim.units.filter((x) => x.seat === p.seat && COMBAT.includes(x.kind) && (x.st === 'muster' || x.st === 'stand')).length,
      p.castleMax, p.tier, p.heroPick, heroSt[p.heroSt], p.heroLvl,
      ultSt, heroRevive(p.heroLvl).cost,
    ];
  });
  const fx = sim.fx.map((f) => [f.t, Math.round(f.x), Math.round(f.y), f.x2 !== undefined ? Math.round(f.x2) : 0, f.y2 !== undefined ? Math.round(f.y2) : 0]);
  sim.fx = [];
  const snap = { k: 'snap', n: sim.tick, u, b, pl, fx };
  if (sim.over) { snap.over = 1; snap.winner = sim.winner; }
  if (sim.lastElim) { snap.elim = sim.lastElim; sim.lastElim = null; }
  return snap;
}

/* ================= shared drawing ================= */

function laneWidth() { return 46; }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

const SPRINKLES = (() => {
  const out = []; let s = 42;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const cols = ['#ff8fb3', '#7fd4ff', '#ffe08a', '#a5e8b0', '#d3b3ff'];
  for (let i = 0; i < 130; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (WORLD_R - 40);
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, rot: rnd() * Math.PI, c: cols[i % cols.length] });
  }
  return out;
})();

function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (typeof g.roundRect === 'function') { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hpBar(g, x, y, w, frac) {
  g.fillStyle = 'rgba(74,37,69,.28)'; rr(g, x, y, w, 5, 3); g.fill();
  g.fillStyle = frac > 0.4 ? '#6bcf7f' : (frac > 0.18 ? '#ffd93d' : '#ff4d6d');
  rr(g, x, y, Math.max(3, w * frac), 5, 3); g.fill();
}

function drawTerrain(g, world, seats, t) {
  g.fillStyle = '#ffedd2';
  g.beginPath(); g.arc(0, 0, world.worldR, 0, Math.PI * 2); g.fill();
  g.lineWidth = 14; g.strokeStyle = '#f3c98b'; g.stroke();
  g.save();
  for (const s of SPRINKLES) {
    g.save(); g.translate(s.x, s.y); g.rotate(s.rot);
    g.fillStyle = s.c; g.globalAlpha = 0.55;
    g.beginPath();
    if (typeof g.roundRect === 'function') g.roundRect(-6, -2, 12, 4, 2); else g.rect(-6, -2, 12, 4);
    g.fill(); g.restore();
  }
  g.restore();
  for (const arm of world.arms) {
    const col = seats[arm.seat] ? seats[arm.seat].color : '#cccccc';
    g.fillStyle = col; g.globalAlpha = 0.14;
    g.beginPath(); g.arc(arm.base.x, arm.base.y, world.plotR, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.5; g.lineWidth = 5; g.strokeStyle = col;
    g.setLineDash([2, 16]); g.lineCap = 'round'; g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
  }
  for (const arm of world.arms) {
    const col = seats[arm.seat] ? seats[arm.seat].color : '#cccccc';
    const a = arm.lane[0], b = arm.lane[arm.lane.length - 1];
    g.lineCap = 'round';
    g.lineWidth = laneWidth(); g.strokeStyle = '#fff7ea';
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.lineWidth = laneWidth() - 10; g.strokeStyle = '#ffe3ef';
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.lineWidth = 6; g.strokeStyle = col; g.globalAlpha = 0.65;
    g.setLineDash([16, 22]); g.lineDashOffset = -(t * 0.02) % 38;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
  }
  g.beginPath(); g.arc(0, 0, world.arenaR, 0, Math.PI * 2);
  g.fillStyle = '#fff3f8'; g.fill();
  g.lineWidth = 10; g.strokeStyle = '#ffb3d1'; g.stroke();
  g.save(); g.beginPath(); g.arc(0, 0, world.arenaR - 8, 0, Math.PI * 2); g.clip();
  g.lineWidth = 12; g.strokeStyle = '#ffd9e8';
  g.beginPath();
  const swirlT = t * 0.00012;
  for (let a2 = 0; a2 < Math.PI * 7; a2 += 0.12) {
    const r = 6 + (a2 / (Math.PI * 7)) * (world.arenaR - 16);
    const x = Math.cos(a2 + swirlT) * r, y = Math.sin(a2 + swirlT) * r;
    if (a2 === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke(); g.restore();
}

function drawMine(g, x, y, kind) {
  g.save(); g.translate(x, y);
  const mounds = [
    { dx: -14, dy: 6, r: 14, c: '#ff8fb3' },
    { dx: 13, dy: 7, r: 12, c: '#7fd4ff' },
    { dx: 0, dy: -6, r: 16, c: '#ffd93d' },
  ];
  const scale = kind === 'rim' ? 1.25 : kind === 'lane' ? 1.1 : 1;
  for (const m of mounds) {
    const r = m.r * scale;
    g.fillStyle = m.c; g.strokeStyle = shade(m.c === '#ffd93d' ? '#d9a800' : m.c, 0.75); g.lineWidth = 2.5;
    g.beginPath(); g.arc(m.dx * scale, m.dy, r, Math.PI, 0);
    g.quadraticCurveTo(m.dx * scale, m.dy + r * 0.8, m.dx * scale - r, m.dy);
    g.closePath(); g.fill(); g.stroke();
  }
  g.font = '13px sans-serif'; g.textAlign = 'center';
  g.fillText('✨', 14 * scale, -16 * scale);
  if (kind === 'rim') g.fillText('✨', -16, -20);
  g.restore();
}

function drawCastle(g, x, y, color, hp, maxHp, elim, tier, upPct, name, avatar) {
  g.save(); g.translate(x, y);
  if (elim) {
    g.fillStyle = '#e8d9c4';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * 26, Math.sin(a) * 20 + 8, 12 - i, 0, Math.PI * 2); g.fill();
    }
    g.font = '28px sans-serif'; g.textAlign = 'center'; g.fillText('🍬', 0, 4);
    g.restore(); return;
  }
  const dark = shade(color, 0.72);
  g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 4;
  rr(g, -CASTLE.r * 0.78, -CASTLE.r * 0.55, CASTLE.r * 1.56, CASTLE.r * 1.15, 12);
  g.fill(); g.stroke();
  for (const tx of [-CASTLE.r * 0.62, 0, CASTLE.r * 0.62]) {
    g.fillStyle = color;
    rr(g, tx - 13, -CASTLE.r * 0.95, 26, CASTLE.r * 0.55, 8); g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(tx, -CASTLE.r * 0.95, 10, Math.PI, 0); g.fill(); g.stroke();
  }
  g.fillStyle = '#fff8f0';
  rr(g, -14, CASTLE.r * 0.05, 28, CASTLE.r * 0.55, 10); g.fill();
  g.strokeStyle = dark; g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -CASTLE.r * 1.05); g.lineTo(0, -CASTLE.r * 1.45); g.stroke();
  g.fillStyle = color;
  g.beginPath(); g.moveTo(0, -CASTLE.r * 1.45); g.lineTo(30, -CASTLE.r * 1.33); g.lineTo(0, -CASTLE.r * 1.21);
  g.closePath(); g.fill(); g.stroke();
  if (tier >= 2) {
    /* the royal crown */
    g.fillStyle = '#ffd93d'; g.strokeStyle = '#d9a800'; g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-18, -CASTLE.r * 1.02);
    g.lineTo(-18, -CASTLE.r * 1.02 - 16); g.lineTo(-9, -CASTLE.r * 1.02 - 8);
    g.lineTo(0, -CASTLE.r * 1.02 - 20); g.lineTo(9, -CASTLE.r * 1.02 - 8);
    g.lineTo(18, -CASTLE.r * 1.02 - 16); g.lineTo(18, -CASTLE.r * 1.02);
    g.closePath(); g.fill(); g.stroke();
  }
  const w = CASTLE.r * 1.7;
  g.fillStyle = 'rgba(74,37,69,.25)'; rr(g, -w / 2, CASTLE.r * 0.78, w, 12, 6); g.fill();
  const frac = Math.max(0, hp / (maxHp || CASTLE.hp));
  g.fillStyle = frac > 0.4 ? '#6bcf7f' : (frac > 0.18 ? '#ffd93d' : '#ff4d6d');
  if (frac > 0) { rr(g, -w / 2, CASTLE.r * 0.78, Math.max(10, w * frac), 12, 6); g.fill(); }
  if (upPct > 0) {
    g.font = '16px sans-serif'; g.textAlign = 'center'; g.fillText('🔨👑', 0, -CASTLE.r * 1.55);
    g.fillStyle = 'rgba(74,37,69,.25)'; rr(g, -w / 2, CASTLE.r * 1.02, w, 8, 4); g.fill();
    g.fillStyle = '#4dabf7'; rr(g, -w / 2, CASTLE.r * 1.02, Math.max(4, w * upPct / 100), 8, 4); g.fill();
  }
  g.font = '600 22px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#4a2545';
  g.fillText(`${avatar || ''} ${name || ''}`.trim(), 0, CASTLE.r * 1.34);
  g.restore();
}

function drawBuilding(g, type, x, y, color, hp, maxHp, prog) {
  g.save(); g.translate(x, y);
  const dark = shade(color, 0.72);
  const building = prog < 1;
  if (building) g.globalAlpha = 0.6;
  g.strokeStyle = dark; g.lineWidth = 3;
  if (type === 'bakery') {
    g.fillStyle = '#fff0dd';
    rr(g, -30, -16, 60, 36, 8); g.fill(); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(-36, -14); g.lineTo(0, -40); g.lineTo(36, -14); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff';
    rr(g, 14, -36, 10, 16, 3); g.fill(); g.stroke();
    g.fillStyle = dark;
    rr(g, -8, 2, 16, 18, 5); g.fill();
    g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText('🍪', -16, 10);
  } else if (type === 'shack') {
    g.fillStyle = '#fff0dd';
    rr(g, -22, -10, 44, 28, 7); g.fill(); g.stroke();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(-27, -8); g.lineTo(0, -28); g.lineTo(27, -8); g.closePath(); g.fill(); g.stroke();
    g.font = '15px sans-serif'; g.textAlign = 'center'; g.fillText('🍭', 0, 8);
  } else if (type === 'camp') {
    g.fillStyle = color;
    g.beginPath(); g.moveTo(-28, 16); g.lineTo(0, -26); g.lineTo(28, 16); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff8f0';
    g.beginPath(); g.moveTo(-9, 16); g.lineTo(0, 0); g.lineTo(9, 16); g.closePath(); g.fill(); g.stroke();
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -26); g.lineTo(0, -38); g.stroke();
    g.fillStyle = '#ffd93d';
    g.beginPath(); g.moveTo(0, -38); g.lineTo(14, -33); g.lineTo(0, -28); g.closePath(); g.fill(); g.stroke();
  } else if (type === 'tower') {
    g.fillStyle = '#fff0dd';
    g.beginPath(); g.moveTo(-18, 20); g.lineTo(-13, -8); g.lineTo(13, -8); g.lineTo(18, 20); g.closePath();
    g.fill(); g.stroke();
    g.lineWidth = 2;
    for (const lx of [-8, 0, 8]) { g.beginPath(); g.moveTo(lx * 1.3, 18); g.lineTo(lx, -6); g.stroke(); }
    g.lineWidth = 3;
    g.fillStyle = color;
    g.beginPath(); g.arc(0, -14, 16, Math.PI, 0);
    g.arc(7, -22, 9, Math.PI * 0.9, Math.PI * 1.9);
    g.arc(-6, -28, 8, 0.2, Math.PI * 1.2, true);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ff4d6d';
    g.beginPath(); g.arc(0, -36, 5, 0, Math.PI * 2); g.fill(); g.stroke();
  } else if (type === 'wizard') {
    /* a starry wizard-hat cottage */
    g.fillStyle = '#fff0dd';
    rr(g, -24, -8, 48, 30, 8); g.fill(); g.stroke();
    g.fillStyle = '#7d4cd1';
    g.beginPath(); g.moveTo(-30, -6); g.lineTo(6, -46); g.lineTo(30, -6); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ffd93d';
    g.font = '12px sans-serif'; g.textAlign = 'center';
    g.fillText('⭐', -8, -18); g.fillText('✨', 12, -26);
    g.font = '14px sans-serif'; g.fillText('🔮', 0, 12);
  }
  g.globalAlpha = 1;
  if (building) {
    g.fillStyle = 'rgba(74,37,69,.25)'; rr(g, -24, 22, 48, 7, 4); g.fill();
    g.fillStyle = '#4dabf7'; rr(g, -24, 22, Math.max(4, 48 * prog), 7, 4); g.fill();
    g.font = '12px sans-serif'; g.textAlign = 'center'; g.fillText('🔨', 0, -44);
  } else if (hp < maxHp) {
    const frac = hp / maxHp;
    g.fillStyle = 'rgba(74,37,69,.25)'; rr(g, -24, 22, 48, 7, 4); g.fill();
    g.fillStyle = frac > 0.4 ? '#6bcf7f' : '#ff4d6d';
    rr(g, -24, 22, Math.max(4, 48 * frac), 7, 4); g.fill();
  }
  g.restore();
}

/* every troop type, one function */
function drawTroop(g, kind, x, y, color, hp, aux, shield, wobble) {
  const dark = shade(color, 0.7);
  g.save(); g.translate(x, y);
  if (kind === 4) {
    /* dragonfly: shadow on the ground, body in the air */
    g.fillStyle = 'rgba(74,37,69,.15)';
    g.beginPath(); g.ellipse(0, 6, 10, 4, 0, 0, Math.PI * 2); g.fill();
    g.translate(0, -16);
    const flap = Math.sin(wobble * 6) * 0.5;
    g.fillStyle = 'rgba(255,255,255,.75)'; g.strokeStyle = dark; g.lineWidth = 1.6;
    g.beginPath(); g.ellipse(-11, -3, 10, 4.5, -0.5 - flap, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.ellipse(11, -3, 10, 4.5, 0.5 + flap, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = color; g.lineWidth = 2.2;
    g.beginPath(); g.ellipse(0, 0, 8, 11, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#3a2038';
    g.beginPath(); g.arc(-3, -4, 1.8, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(3, -4, 1.8, 0, Math.PI * 2); g.fill();
    if (hp < UNITS.flyer.hp) hpBar(g, -10, -20, 20, hp / UNITS.flyer.hp);
  } else if (kind === 3) {
    /* marshmallow knight: big, squishy, armored */
    g.rotate(Math.sin(wobble) * 0.05);
    g.fillStyle = '#fdfdfb'; g.strokeStyle = dark; g.lineWidth = 3;
    rr(g, -14, -16, 28, 30, 10); g.fill(); g.stroke();
    g.fillStyle = color;
    rr(g, -14, -16, 28, 12, { tl: 10, tr: 10, bl: 0, br: 0 } instanceof Object ? 10 : 10); g.fill(); g.stroke();
    g.fillStyle = '#3a2038';
    rr(g, -9, -8, 18, 3.5, 2); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.moveTo(0, -16); g.lineTo(0, -24); g.lineTo(7, -21); g.closePath(); g.fill(); g.stroke();
    if (hp < UNITS.knight.hp) hpBar(g, -12, -30, 24, hp / UNITS.knight.hp);
  } else if (kind === 2) {
    /* gumdrop slinger: pointy hood + bow */
    g.rotate(Math.sin(wobble) * 0.08);
    g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 2.3;
    g.beginPath(); g.arc(0, 2, 10, Math.PI, 0);
    g.lineTo(10, 8); g.quadraticCurveTo(0, 12, -10, 8); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = shade(color, 0.85);
    g.beginPath(); g.moveTo(-9, -2); g.lineTo(0, -18); g.lineTo(9, -2); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#8a5a2b'; g.lineWidth = 2;
    g.beginPath(); g.arc(12, 0, 9, -Math.PI * 0.45, Math.PI * 0.45); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(12 + Math.cos(-Math.PI * 0.45) * 9, Math.sin(-Math.PI * 0.45) * 9);
    g.lineTo(12 + Math.cos(Math.PI * 0.45) * 9, Math.sin(Math.PI * 0.45) * 9); g.stroke();
    g.fillStyle = '#3a2038';
    g.beginPath(); g.arc(-3.5, 0, 1.9, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(3.5, 0, 1.9, 0, Math.PI * 2); g.fill();
    if (hp < UNITS.archer.hp) hpBar(g, -10, -24, 20, hp / UNITS.archer.hp);
  } else {
    /* gingerbread guard */
    g.rotate(Math.sin(wobble) * 0.08);
    g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, 13, Math.PI, 0);
    g.lineTo(13, 7);
    g.quadraticCurveTo(0, 12.5, -13, 7);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#3a2038';
    g.beginPath(); g.arc(-4.5, -2, 2.1, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(4.5, -2, 2.1, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#3a2038'; g.lineWidth = 1.8;
    g.beginPath(); g.arc(0, 2.5, 4, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    if (hp < UNITS.guard.hp) hpBar(g, -11, -21, 22, hp / UNITS.guard.hp);
  }
  if (shield) {
    g.strokeStyle = '#4dd7ff'; g.lineWidth = 3; g.globalAlpha = 0.8;
    g.beginPath(); g.arc(0, kind === 4 ? 0 : -2, 20, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  g.restore();
}

function drawWorker(g, x, y, color, hp, carrying, wobble) {
  const dark = shade(color, 0.7);
  g.save(); g.translate(x, y);
  g.rotate(Math.sin(wobble) * 0.1);
  g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 2.2;
  g.beginPath(); g.arc(0, 0, WORKER.r, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#ffd93d';
  g.beginPath(); g.arc(0, -WORKER.r * 0.45, WORKER.r * 0.85, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#3a2038';
  g.beginPath(); g.arc(-3.4, 1, 1.8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(3.4, 1, 1.8, 0, Math.PI * 2); g.fill();
  if (carrying) {
    g.font = '12px sans-serif'; g.textAlign = 'center';
    g.fillText('🍬', 0, -WORKER.r - 6);
  }
  if (hp < WORKER.hp) hpBar(g, -9, -WORKER.r - 16, 18, hp / WORKER.hp);
  g.restore();
}

function drawHero(g, x, y, color, hp, heroCode, shield, wobble) {
  const pick = Math.floor(heroCode / 100), lvl = heroCode % 100;
  const hd = HEROES[pick] || HEROES[0];
  const def = heroDef(pick, lvl);
  const R = hd.r + Math.min(4, lvl - 1);
  const dark = shade(color, 0.65);
  g.save(); g.translate(x, y);
  g.rotate(Math.sin(wobble) * 0.05);
  /* cape */
  g.fillStyle = dark;
  g.beginPath(); g.moveTo(-R * 0.8, -R * 0.2);
  g.quadraticCurveTo(0, R * 1.4 + Math.sin(wobble * 2) * 3, R * 0.8, -R * 0.2);
  g.closePath(); g.fill();
  /* big gumdrop body */
  g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 3.2;
  g.beginPath(); g.arc(0, 0, R, Math.PI, 0);
  g.lineTo(R, R * 0.55);
  g.quadraticCurveTo(0, R * 0.95, -R, R * 0.55);
  g.closePath(); g.fill(); g.stroke();
  g.font = `${Math.round(R * 1.1)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(hd.emoji, 0, -2);
  /* level badge */
  g.fillStyle = '#ffd93d'; g.strokeStyle = '#d9a800'; g.lineWidth = 2;
  g.beginPath(); g.arc(R * 0.85, -R * 0.85, 9, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#4a2545'; g.font = '700 11px Fredoka, sans-serif';
  g.fillText(String(lvl), R * 0.85, -R * 0.85 + 0.5);
  if (lvl >= 6) { g.font = '13px sans-serif'; g.fillText('⭐', -R * 0.85, -R * 0.9); }
  hpBar(g, -R, -R - 12, R * 2, hp / def.hp);
  if (shield) {
    g.strokeStyle = '#4dd7ff'; g.lineWidth = 3.5; g.globalAlpha = 0.8;
    g.beginPath(); g.arc(0, 0, R + 8, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  g.restore();
}

function fxLife(t) {
  if (t === 'flag') return 2.6;
  if (t === 'storm') return 1.3;
  if (t === 'slam' || t === 'shieldcast' || t === 'level') return 1.2;
  return 0.9;
}

function drawFx(g, fx, now) {
  for (const f of fx) {
    const life = fxLife(f.t);
    const age = (now - f.t0) / 1000;
    if (age > life) continue;
    const k = age / life;
    g.save(); g.translate(f.x, f.y); g.globalAlpha = 1 - k;
    if (f.t === 'flag') {
      g.globalAlpha = k < 0.8 ? 1 : (1 - k) * 5;
      g.font = '36px sans-serif'; g.textAlign = 'center';
      g.fillText('🚩', 0, Math.sin(now * 0.006) * 3);
      g.strokeStyle = '#ffd93d'; g.lineWidth = 3; g.setLineDash([8, 8]);
      g.beginPath(); g.arc(0, 6, 30 + Math.sin(now * 0.004) * 4, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    } else if (f.t === 'poof') {
      g.strokeStyle = '#fff'; g.lineWidth = 4;
      g.beginPath(); g.arc(0, 0, 8 + k * 34, 0, Math.PI * 2); g.stroke();
      g.font = '18px sans-serif'; g.textAlign = 'center';
      g.fillText('✨', 0, -6 - k * 22);
    } else if (f.t === 'hit') {
      g.fillStyle = '#ffd93d';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + k * 2;
        g.beginPath(); g.arc(Math.cos(a) * (6 + k * 16), Math.sin(a) * (6 + k * 16), 3, 0, Math.PI * 2); g.fill();
      }
    } else if (f.t === 'ding') {
      g.strokeStyle = '#4dd7ff'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 14 + k * 8, 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'boom' || f.t === 'boomsoft') {
      g.strokeStyle = f.t === 'boom' ? '#ff9f4a' : '#ffd93d'; g.lineWidth = 8;
      g.beginPath(); g.arc(0, 0, 20 + k * (f.t === 'boom' ? 150 : 90), 0, Math.PI * 2); g.stroke();
      g.font = '42px sans-serif'; g.textAlign = 'center';
      g.fillText(f.t === 'boom' ? '🌈' : '👑', 0, -k * 40);
    } else if (f.t === 'spawn' || f.t === 'horn') {
      g.strokeStyle = '#b380ff'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 4 + k * 18, 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'zap' && f.x2 !== undefined) {
      g.strokeStyle = '#ff8fb3'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, -20); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -20); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
    } else if (f.t === 'pew' && f.x2 !== undefined) {
      g.strokeStyle = '#ffde59'; g.lineWidth = 2.5; g.lineCap = 'round';
      const px = (f.x2 - f.x) * Math.min(1, k * 3), py = (f.y2 - f.y) * Math.min(1, k * 3);
      g.beginPath(); g.moveTo(px * 0.7, py * 0.7 - 6); g.lineTo(px, py - 6); g.stroke();
    } else if (f.t === 'slam') {
      g.strokeStyle = '#ff9f4a'; g.lineWidth = 10;
      g.beginPath(); g.arc(0, 0, 20 + k * SLAM.r, 0, Math.PI * 2); g.stroke();
      g.font = '30px sans-serif'; g.textAlign = 'center';
      g.fillText('💥', 0, -k * 30);
    } else if (f.t === 'storm') {
      g.strokeStyle = '#b380ff'; g.lineWidth = 5; g.setLineDash([10, 10]);
      g.beginPath(); g.arc(0, 0, STORM.r * (0.7 + k * 0.3), 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      g.font = '20px sans-serif'; g.textAlign = 'center';
      for (let i = 0; i < 5; i++) {
        const a = i * 1.256 + k * 3;
        g.fillText('🍬', Math.cos(a) * STORM.r * 0.6, Math.sin(a) * STORM.r * 0.6 - 20 + k * 40);
      }
    } else if (f.t === 'shieldcast') {
      g.strokeStyle = '#4dd7ff'; g.lineWidth = 6;
      g.beginPath(); g.arc(0, 0, 20 + k * SHIELD.r, 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'level') {
      g.font = '26px sans-serif'; g.textAlign = 'center';
      g.fillText('⭐', 0, -10 - k * 40);
      g.strokeStyle = '#ffd93d'; g.lineWidth = 4;
      g.beginPath(); g.arc(0, 0, 10 + k * 30, 0, Math.PI * 2); g.stroke();
    }
    g.restore();
  }
}

function fitZoom(w, h) { return Math.min(w, h) / (WORLD_R * 2.15); }

/* one full frame — flyers layered above ground troops */
function drawScene(g, world, seats, view, now) {
  drawTerrain(g, world, seats, now);
  for (const m of world.mines) drawMine(g, m.x, m.y, m.kind);
  for (const b of view.buildings) {
    const s = seats[b[1]];
    const type = TYPE_IDX[b[2]];
    if (type === 'castle') continue;
    drawBuilding(g, type, b[3], b[4], s ? s.color : '#ccc', b[5], BLD[type].hp, b[6] / 100);
  }
  for (const p of view.players) {
    const s = seats[p[0]];
    const home = world.arms[p[0]].base;
    const cb = view.buildings.find((q) => q[1] === p[0] && TYPE_IDX[q[2]] === 'castle');
    drawCastle(g, home.x, home.y, s ? s.color : '#ccc', p[2], p[9], !!p[3], p[10], cb ? cb[8] : 0, s && s.name, s && s.avatar);
  }
  const rows = [];
  view.eachUnit((...args) => rows.push(args));
  rows.sort((a, b) => (a[2] === 4 ? 1 : 0) - (b[2] === 4 ? 1 : 0));   // ground first, air on top
  for (const [id, seat, kind, x, y, hp, aux, shield] of rows) {
    const s = seats[seat];
    if (!s) continue;
    const w = now * 0.012 + id;
    if (kind === 0) drawWorker(g, x, y, s.color, hp, !!aux, w);
    else if (kind === 5) drawHero(g, x, y, s.color, hp, aux, shield, w);
    else drawTroop(g, kind, x, y, s.color, hp, aux, shield, w);
  }
}

/* ================= HOST (big screen) ================= */

const HOST_HTML = `
<div class="ck-host">
  <canvas class="ck-canvas"></canvas>
  <div class="ck-hud">
    <div class="ck-banners"></div>
  </div>
  <div class="ck-camhint">Drag to look around · scroll to zoom · <b>1–6</b> jump to a kingdom · <b>A</b> arena · <b>W</b> whole map</div>
  <div class="ck-toast-lane"></div>
  <div class="ck-over hidden">
    <div class="ck-over-card">
      <div class="ck-over-emoji">👑</div>
      <h2 class="ck-over-title"></h2>
      <p class="ck-over-sub">Use the ⌂ Lobby button to head back and play again.</p>
    </div>
  </div>
</div>`;

function createHost(ctx) {
  let sim = null;
  let seats = [];
  let seatByPlayer = new Map();
  let tickTimer = null;
  let raf = 0;
  let lastTickAt = 0;
  let fxLive = [];
  let cam = { x: 0, y: 0, z: 0.4, tx: 0, ty: 0, tz: 0.4 };
  let canvas, g;
  let dragging = null;
  let keyHandler = null, resizeHandler = null;

  function start() {
    ctx.root.innerHTML = HOST_HTML;
    canvas = ctx.root.querySelector('.ck-canvas');
    g = canvas.getContext('2d');

    const connected = ctx.players().filter((p) => p.connected).slice(0, 6);
    seats = connected.map((p, i) => ({ seat: i, id: p.id, name: p.name, avatar: p.avatar, color: p.color }));
    seatByPlayer = new Map(seats.map((s) => [s.id, s.seat]));
    sim = makeSim(seats.length);

    renderBanners();
    sendInitAll();

    resizeHandler = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      cam.tz = fitZoom(canvas.width, canvas.height);
      if (!lastTickAt) cam.z = cam.tz;
    };
    window.addEventListener('resize', resizeHandler);
    resizeHandler();

    canvas.addEventListener('mousedown', (e) => { dragging = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mouseup', () => { dragging = null; });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = (e.clientX - dragging.x) * devicePixelRatio;
      const dy = (e.clientY - dragging.y) * devicePixelRatio;
      dragging = { x: e.clientX, y: e.clientY };
      cam.tx -= dx / cam.z; cam.ty -= dy / cam.z;
      cam.x = cam.tx; cam.y = cam.ty;
      clampCam();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      cam.tz = Math.max(fitZoom(canvas.width, canvas.height) * 0.8, Math.min(3, cam.tz * f));
    }, { passive: false });

    keyHandler = (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= sim.world.n) {
        const b = sim.world.arms[n - 1].base;
        cam.tx = b.x; cam.ty = b.y; cam.tz = 1.1;
      } else if (e.key === 'a' || e.key === 'A') {
        cam.tx = 0; cam.ty = 0; cam.tz = 1.0;
      } else if (e.key === 'w' || e.key === 'W') {
        cam.tx = 0; cam.ty = 0; cam.tz = fitZoom(canvas.width, canvas.height);
      }
    };
    window.addEventListener('keydown', keyHandler);

    lastTickAt = performance.now();
    tickTimer = setInterval(onTick, TICK_MS);
    raf = requestAnimationFrame(render);
  }

  function onTick() {
    stepSim(sim);
    lastTickAt = performance.now();
    for (const f of sim.fx) fxLive.push({ ...f, t0: lastTickAt });
    if (sim.tick % SNAP_EVERY === 0 || sim.over) {
      const snap = snapshot(sim);
      for (const s of seats) ctx.sendTo(s.id, snap);
      if (snap.elim) toastElim(snap.elim);
      updateBanners();
      if (snap.over) showOver();
    }
  }

  function sendInitAll() { for (const s of seats) sendInit(s.id); }
  function sendInit(playerId) {
    const seat = seatByPlayer.get(playerId);
    if (seat === undefined) { ctx.sendTo(playerId, { k: 'spectate' }); return; }
    ctx.sendTo(playerId, {
      k: 'init', seat, n: sim.world.n,
      seats: seats.map((s) => ({ seat: s.seat, name: s.name, avatar: s.avatar, color: s.color })),
      cfg: {
        worker: WORKER.cost, guard: UNITS.guard.cost, archer: UNITS.archer.cost,
        knight: UNITS.knight.cost, flyer: UNITS.flyer.cost,
        bakery: BLD.bakery.cost, shack: BLD.shack.cost, camp: BLD.camp.cost,
        tower: BLD.tower.cost, wizard: BLD.wizard.cost,
        enlist: ENLIST_COST, royal: ROYAL.cost, summon: HERO_SUMMON.cost,
      },
    });
  }

  function onMessage(playerId, data) {
    if (!sim || !data) return;
    const seat = seatByPlayer.get(playerId);
    if (seat === undefined) return;
    if (data.k === 'train') {
      const kind = ['worker', 'guard', 'archer', 'knight', 'flyer'].includes(data.unit) ? data.unit : null;
      if (kind) train(sim, seat, kind, typeof data.bld === 'string' ? data.bld : undefined);
    }
    else if (data.k === 'enlist') enlist(sim, seat, typeof data.bld === 'string' ? data.bld : undefined);
    else if (data.k === 'upgrade') upgradeCastle(sim, seat);
    else if (data.k === 'hero') heroCommand(sim, seat, typeof data.pick === 'number' ? data.pick : -1);
    else if (data.k === 'ult') castUlt(sim, seat);
    else if (data.k === 'gather') {
      if (typeof data.x === 'number' && typeof data.y === 'number') gather(sim, seat, data.x, data.y);
    }
    else if (data.k === 'build') {
      if (typeof data.x === 'number' && typeof data.y === 'number' && BLD[data.type]) {
        build(sim, seat, data.type, data.x, data.y);
      }
    }
    else if (data.k === 'mode') setMode(sim, seat, data.mode);
    else if (data.k === 'target') setTarget(sim, seat, typeof data.seat === 'number' ? data.seat : -1);
    else if (data.k === 'need-init') sendInit(playerId);
  }

  function renderBanners() {
    const el = ctx.root.querySelector('.ck-banners');
    el.innerHTML = seats.map((s) => `
      <div class="ck-banner" data-seat="${s.seat}" style="--bcol:${s.color}">
        <span class="ck-banner-av">${s.avatar}</span>
        <span class="ck-banner-name">${escapeHtml(s.name)}</span>
        <span class="ck-banner-crown hidden">👑</span>
        <span class="ck-banner-candy">🍬 <b class="ck-b-candy">0</b></span>
        <span class="ck-banner-hpwrap"><span class="ck-b-hp"></span></span>
      </div>`).join('');
  }

  function updateBanners() {
    for (const p of sim.players) {
      const el = ctx.root.querySelector(`.ck-banner[data-seat="${p.seat}"]`);
      if (!el) continue;
      el.classList.toggle('ck-elim', p.elim);
      el.querySelector('.ck-banner-crown').classList.toggle('hidden', p.tier < 2);
      el.querySelector('.ck-b-candy').textContent = Math.floor(p.candy);
      el.querySelector('.ck-b-hp').style.width = Math.max(0, (p.castleHp / (p.castleMax || CASTLE.hp)) * 100) + '%';
    }
  }

  function toastElim(elim) {
    const s = seats[elim.seat]; if (!s) return;
    const by = elim.bySeat >= 0 ? seats[elim.bySeat] : null;
    const lane = ctx.root.querySelector('.ck-toast-lane');
    const div = document.createElement('div');
    div.className = 'ck-toast';
    div.innerHTML = by
      ? `💥 ${escapeHtml(by.name)} crumbled <b>${escapeHtml(s.name)}</b>'s castle!`
      : `💥 <b>${escapeHtml(s.name)}</b>'s castle crumbled!`;
    lane.appendChild(div);
    setTimeout(() => div.remove(), 5200);
  }

  function showOver() {
    const el = ctx.root.querySelector('.ck-over');
    const w = sim.winner >= 0 ? seats[sim.winner] : null;
    el.querySelector('.ck-over-title').textContent = w
      ? `${w.avatar} ${w.name} rules the candy lands!` : 'Everyone crumbled!';
    el.classList.remove('hidden');
  }

  function clampCam() {
    const m = WORLD_R * 1.1;
    cam.tx = Math.max(-m, Math.min(m, cam.tx));
    cam.ty = Math.max(-m, Math.min(m, cam.ty));
  }

  function render(now) {
    raf = requestAnimationFrame(render);
    if (!g || !sim) return;
    cam.x += (cam.tx - cam.x) * 0.12;
    cam.y += (cam.ty - cam.y) * 0.12;
    cam.z += (cam.tz - cam.z) * 0.12;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.translate(canvas.width / 2, canvas.height / 2);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);

    const alpha = Math.max(0, Math.min(1, (now - lastTickAt) / TICK_MS));
    const plRows = sim.players.map((p) => [p.seat, 0, p.castleHp, p.elim ? 1 : 0, 0, 0, 0, 0, 0, p.castleMax, p.tier]);
    drawScene(g, sim.world, seats, {
      buildings: sim.buildings.map((b) => [b.id, b.seat, TYPE_IDX.indexOf(b.type), b.x, b.y, b.hp, Math.round(b.prog * 100), b.queue.length, b.type === 'castle' && b.up > 0 ? Math.round(100 * (1 - b.up / ROYAL.time)) : 0]),
      players: plRows,
      eachUnit: (cb) => {
        for (const u of sim.units) {
          const x = u.px + (u.x - u.px) * alpha;
          const y = u.py + (u.y - u.py) * alpha;
          cb(u.id, u.seat, KIND_IDX.indexOf(u.kind), x, y, u.hp,
            u.kind === 'hero' ? u.heroPick * 100 + u.lvl : (u.carry > 0 ? 1 : 0),
            u.shield > 0 ? 1 : 0);
        }
      },
    }, now);
    fxLive = fxLive.filter((f) => now - f.t0 < fxLife(f.t) * 1000 + 60);
    drawFx(g, fxLive, now);
  }

  function onPlayerRejoin(player) { sendInit(player.id); }
  function onPlayerJoin(player) { ctx.sendTo(player.id, { k: 'spectate' }); }

  function destroy() {
    clearInterval(tickTimer);
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', keyHandler);
    window.removeEventListener('resize', resizeHandler);
    ctx.root.innerHTML = '';
  }

  return { start, onMessage, onPlayerJoin, onPlayerRejoin, destroy };
}

/* ================= CONTROLLER (phone) ================= */

const CTRL_HTML = `
<div class="ck-ctrl">
  <div class="ck-ctrl-map">
    <canvas class="ck-ctrl-canvas"></canvas>
    <div class="ck-ctrl-maphint">Drag to look · pinch to zoom · tap your buildings to pick spawn</div>
    <div class="ck-place-hint hidden">Tap the map to place <b class="ck-place-what"></b> · <button class="ck-place-cancel">Cancel</button></div>
  </div>
  <div class="ck-panel">
    <div class="ck-row ck-row-top">
      <div class="ck-candy">🍬 <b class="ck-candy-n">0</b></div>
      <div class="ck-supply">🏠 <b class="ck-sup-n">0/6</b></div>
      <div class="ck-armysize">⚔️ <b class="ck-army-n">0</b> ready</div>
    </div>
    <div class="ck-tabs">
      <button class="ck-tab is-on" data-tab="attack">⚔️ Attack</button>
      <button class="ck-tab" data-tab="build">🔨 Build</button>
    </div>
    <div class="ck-tabpage" data-page="attack">
      <div class="ck-warbtns">
        <button class="ck-warbtn ck-warbtn-send">🚩 SEND!</button>
        <button class="ck-warbtn ck-warbtn-gather">📣 GATHER</button>
        <button class="ck-warbtn ck-warbtn-stop">✋ STOP</button>
      </div>
      <div class="ck-hero"></div>
      <div class="ck-target-row"></div>
    </div>
    <div class="ck-tabpage hidden" data-page="build">
      <div class="ck-train-row">
        <button class="ck-train" data-unit="worker">🧑‍🔧 Helper <span class="ck-price ck-price-worker"></span><span class="ck-q ck-q-worker hidden"></span></button>
        <button class="ck-train" data-unit="guard">🍪 Guard <span class="ck-price ck-price-guard"></span><span class="ck-q ck-q-guard hidden"></span></button>
        <button class="ck-train" data-unit="archer">🏹 Slinger <span class="ck-price ck-price-archer"></span></button>
      </div>
      <div class="ck-train-row">
        <button class="ck-train" data-unit="knight">🛡️ Knight <span class="ck-price ck-price-knight"></span></button>
        <button class="ck-train" data-unit="flyer">🐝 Dragonfly <span class="ck-price ck-price-flyer"></span></button>
        <button class="ck-train ck-enlist">⚔️ Enlist helper <span class="ck-price ck-price-enlist"></span></button>
      </div>
      <div class="ck-build-row">
        <button class="ck-build" data-type="bakery">🍪<span>Bakery</span><span class="ck-price ck-price-bakery"></span></button>
        <button class="ck-build" data-type="shack">🍭<span>Shack</span><span class="ck-price ck-price-shack"></span></button>
        <button class="ck-build" data-type="camp">⛺<span>Camp</span><span class="ck-price ck-price-camp"></span></button>
        <button class="ck-build" data-type="tower">🧁<span>Tower</span><span class="ck-price ck-price-tower"></span></button>
        <button class="ck-build" data-type="wizard">🔮<span>Wizard</span><span class="ck-price ck-price-wizard"></span></button>
      </div>
      <button class="ck-royal">👑 Royal Castle upgrade <span class="ck-price ck-price-royal"></span></button>
    </div>
  </div>
  <div class="ck-ctrl-out hidden">
    <div class="ck-ctrl-out-emoji">💥</div>
    <p>Your castle crumbled into sprinkles!<br>Watch the big screen — the war rages on.</p>
  </div>
  <div class="ck-ctrl-over hidden"><div class="ck-ctrl-over-msg"></div></div>
  <div class="ck-ctrl-wait">
    <div class="ck-ctrl-wait-emoji">🏰</div>
    <p>Setting up your kingdom…</p>
  </div>
</div>`;

function createController(ctx) {
  let world = null, mySeat = -1, seats = [], cfg = null;
  let prev = null, cur = null;
  let fxLive = [];
  let cam = { x: 0, y: 0, z: 0.5, min: 0.1 };
  let canvas, g, raf = 0;
  let me = null;
  let syncTimer = null;
  let touch = null;
  let placing = null;
  let ghost = null;
  let selWorkerBld = null;
  let selGuardBld = null;
  let heroSig = '';

  function start() {
    ctx.root.innerHTML = CTRL_HTML;
    canvas = ctx.root.querySelector('.ck-ctrl-canvas');
    g = canvas.getContext('2d');
    bindPanel();
    bindTouch();
    ctx.send({ k: 'need-init' });
    syncTimer = setInterval(() => { if (!world) ctx.send({ k: 'need-init' }); }, 2000);
    raf = requestAnimationFrame(render);
  }

  function onMessage(data) {
    if (!data) return;
    if (data.k === 'init') {
      world = buildWorld(data.n);
      mySeat = data.seat;
      seats = data.seats;
      cfg = data.cfg;
      ctx.root.querySelector('.ck-ctrl-wait').classList.add('hidden');
      for (const key of ['worker', 'guard', 'archer', 'knight', 'flyer', 'bakery', 'shack', 'camp', 'tower', 'wizard', 'enlist', 'royal']) {
        const el = ctx.root.querySelector('.ck-price-' + key);
        if (el) el.textContent = cfg[key] + '🍬';
      }
      const b = world.arms[mySeat].base;
      cam.x = b.x * 0.86; cam.y = b.y * 0.86;
      sizeCanvas();
      renderTargets();
      return;
    }
    if (data.k === 'spectate') {
      ctx.root.querySelector('.ck-ctrl-wait').innerHTML =
        '<div class="ck-ctrl-wait-emoji">🍿</div><p>This battle already started —<br>watch the big screen! You\'re in the next one.</p>';
      return;
    }
    if (data.k === 'snap') {
      prev = cur;
      cur = { at: performance.now(), snap: data };
      for (const f of data.fx) fxLive.push({ t: f[0], x: f[1], y: f[2], x2: f[3], y2: f[4], t0: cur.at });
      me = data.pl.find((r) => r[0] === mySeat) || null;
      updatePanel(data);
      if (data.over) showOver(data.winner);
      return;
    }
  }

  function bindPanel() {
    const r = ctx.root;
    r.querySelectorAll('.ck-train:not(.ck-enlist)').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bld = btn.dataset.unit === 'worker' ? selWorkerBld : selGuardBld;
        ctx.send({ k: 'train', unit: btn.dataset.unit, bld: bld || undefined });
      });
    });
    r.querySelector('.ck-enlist').addEventListener('click', () => {
      ctx.send({ k: 'enlist', bld: selWorkerBld || undefined });
    });
    r.querySelector('.ck-royal').addEventListener('click', () => ctx.send({ k: 'upgrade' }));
    r.querySelectorAll('.ck-build').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (placing === btn.dataset.type) stopPlacing();
        else startPlacing(btn.dataset.type);
      });
    });
    r.querySelector('.ck-place-cancel').addEventListener('click', stopPlacing);
    r.querySelectorAll('.ck-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        r.querySelectorAll('.ck-tab').forEach((t) => t.classList.toggle('is-on', t === tab));
        r.querySelectorAll('.ck-tabpage').forEach((pg) => {
          pg.classList.toggle('hidden', pg.dataset.page !== tab.dataset.tab);
        });
        stopPlacing();
      });
    });
    r.querySelector('.ck-warbtn-send').addEventListener('click', () => ctx.send({ k: 'mode', mode: 'send' }));
    r.querySelector('.ck-warbtn-stop').addEventListener('click', () => ctx.send({ k: 'mode', mode: 'stop' }));
    r.querySelector('.ck-warbtn-gather').addEventListener('click', () => {
      if (placing === '__rally') stopPlacing();
      else startPlacing('__rally');
    });
    /* hero controls are re-rendered per state — delegate */
    r.querySelector('.ck-hero').addEventListener('click', (e) => {
      const pickBtn = e.target.closest('[data-hero]');
      if (pickBtn) { ctx.send({ k: 'hero', pick: parseInt(pickBtn.dataset.hero, 10) }); return; }
      if (e.target.closest('.ck-revive')) { ctx.send({ k: 'hero', pick: -1 }); return; }
      if (e.target.closest('.ck-ult')) { ctx.send({ k: 'ult' }); }
    });
  }

  function startPlacing(type) {
    placing = type; ghost = null;
    const r = ctx.root;
    r.querySelectorAll('.ck-build').forEach((b) => b.classList.toggle('is-on', b.dataset.type === type));
    r.querySelector('.ck-warbtn-gather').classList.toggle('is-arming', type === '__rally');
    r.querySelector('.ck-place-what').textContent = type === '__rally' ? 'your rally flag 🚩' : BLD[type].label;
    r.querySelector('.ck-place-hint').classList.remove('hidden');
  }
  function stopPlacing() {
    placing = null; ghost = null;
    ctx.root.querySelectorAll('.ck-build').forEach((b) => b.classList.remove('is-on'));
    ctx.root.querySelector('.ck-warbtn-gather').classList.remove('is-arming');
    ctx.root.querySelector('.ck-place-hint').classList.add('hidden');
  }

  function renderTargets() {
    const row = ctx.root.querySelector('.ck-target-row');
    const opts = seats.filter((s) => s.seat !== mySeat);
    row.innerHTML = `<button class="ck-target ck-target-none is-on" data-seat="-1">🕊️<span>Hold</span></button>` +
      opts.map((s) => `
        <button class="ck-target" data-seat="${s.seat}" style="--tcol:${s.color}">
          ${s.avatar}<span>${escapeHtml(s.name)}</span>
        </button>`).join('');
    row.querySelectorAll('.ck-target').forEach((btn) => {
      btn.addEventListener('click', () => {
        ctx.send({ k: 'target', seat: parseInt(btn.dataset.seat, 10) });
      });
    });
  }

  /* pl: [seat,candy,castleHp,elim,mode,target,sup,cap,ready,
          castleMax,tier,heroPick,heroSt,heroLvl,ultSt,reviveCost] */
  function updatePanel(snap) {
    if (!me) return;
    const r = ctx.root;
    r.querySelector('.ck-candy-n').textContent = me[1];
    r.querySelector('.ck-sup-n').textContent = me[6] + '/' + me[7];
    r.querySelector('.ck-army-n').textContent = me[8];

    const myBld = snap.b.filter((b) => b[1] === mySeat);
    if (selWorkerBld && !myBld.some((b) => b[0] === selWorkerBld)) selWorkerBld = null;
    if (selGuardBld && !myBld.some((b) => b[0] === selGuardBld)) selGuardBld = null;
    const hasBakery = myBld.some((b) => TYPE_IDX[b[2]] === 'bakery' && b[6] >= 100);
    const hasWizard = myBld.some((b) => TYPE_IDX[b[2]] === 'wizard' && b[6] >= 100);
    const supFull = me[6] >= me[7];
    const tier = me[10];
    const wSrc = selWorkerBld
      ? myBld.filter((b) => b[0] === selWorkerBld)
      : myBld.filter((b) => ['castle', 'camp'].includes(TYPE_IDX[b[2]]));
    const gSrc = selGuardBld
      ? myBld.filter((b) => b[0] === selGuardBld)
      : myBld.filter((b) => TYPE_IDX[b[2]] === 'bakery');
    setQ('.ck-q-worker', wSrc.reduce((s, b) => s + b[7], 0));
    setQ('.ck-q-guard', gSrc.reduce((s, b) => s + b[7], 0));

    const out = !!me[3];
    r.querySelector('.ck-train[data-unit="worker"]').disabled = out || me[1] < cfg.worker || supFull;
    for (const unit of ['guard', 'archer', 'knight', 'flyer']) {
      const btn = r.querySelector(`.ck-train[data-unit="${unit}"]`);
      const needsRoyal = UNITS[unit].tier === 2 && tier < 2;
      btn.disabled = out || !hasBakery || needsRoyal || me[1] < cfg[unit] || supFull;
      btn.title = !hasBakery ? 'Build a Bakery first!' : needsRoyal ? 'Upgrade to a Royal Castle!' : '';
      btn.classList.toggle('ck-locked', needsRoyal);
    }
    r.querySelector('.ck-enlist').disabled = out || me[1] < cfg.enlist;
    r.querySelectorAll('.ck-build').forEach((btn) => {
      btn.disabled = out || me[1] < cfg[btn.dataset.type];
    });
    const royal = r.querySelector('.ck-royal');
    const upPct = (myBld.find((b) => TYPE_IDX[b[2]] === 'castle') || [])[8] || 0;
    if (tier >= 2) { royal.disabled = true; royal.innerHTML = '👑 Royal Castle — complete!'; }
    else if (upPct > 0) { royal.disabled = true; royal.innerHTML = `👑 Upgrading… ${upPct}%`; }
    else { royal.disabled = out || me[1] < cfg.royal; }

    const sending = !!me[4];
    r.querySelector('.ck-warbtn-send').classList.toggle('is-on', sending);
    r.querySelector('.ck-warbtn-stop').classList.toggle('is-on', !sending);
    r.querySelectorAll('.ck-target').forEach((btn) => {
      btn.classList.toggle('is-on', parseInt(btn.dataset.seat, 10) === me[5]);
    });
    for (const p of snap.pl) {
      if (p[3]) {
        const btn = r.querySelector(`.ck-target[data-seat="${p[0]}"]`);
        if (btn) btn.disabled = true;
      }
    }

    renderHero(hasWizard, out);
    if (out) { stopPlacing(); r.querySelector('.ck-ctrl-out').classList.remove('hidden'); }

    function setQ(sel, n) {
      const el = r.querySelector(sel);
      el.textContent = '×' + n;
      el.classList.toggle('hidden', n === 0);
    }
  }

  function renderHero(hasWizard, out) {
    const r = ctx.root;
    const st = me[12], pick = me[11], lvl = me[13], ultSt = me[14], revCost = me[15];
    const sig = [hasWizard, out, st, pick, lvl, ultSt, revCost, me[1] >= (cfg ? cfg.summon : 0)].join('|');
    if (sig === heroSig) return;
    heroSig = sig;
    const el = r.querySelector('.ck-hero');
    if (out) { el.innerHTML = ''; return; }
    if (!hasWizard && st === 0) {
      el.innerHTML = `<div class="ck-hero-hint">🔮 Build a Wizard's Bakery to summon a hero</div>`;
      return;
    }
    if (st === 0) {
      el.innerHTML = `<div class="ck-hero-hint">Choose your hero (${cfg.summon}🍬):</div>
        <div class="ck-hero-picks">` +
        HEROES.map((h, i) => `<button class="ck-hero-pick" data-hero="${i}" ${me[1] < cfg.summon ? 'disabled' : ''}>${h.emoji}<span>${h.name.split(' ')[1]}</span></button>`).join('') +
        `</div>`;
      return;
    }
    const h = HEROES[pick] || HEROES[0];
    if (st === 1) {
      el.innerHTML = `<div class="ck-hero-hint">${h.emoji} ${h.name} is on the way…</div>`;
    } else if (st === 3) {
      el.innerHTML = `<div class="ck-hero-row"><span class="ck-hero-chip">${h.emoji} Lv${lvl}</span>
        <button class="ck-revive" ${me[1] < revCost ? 'disabled' : ''}>💫 Revive (${revCost}🍬)</button></div>`;
    } else {
      const ult = ultSt === 2
        ? `<button class="ck-ult ck-ult-ready">✨ ${h.ult}!</button>`
        : ultSt === 1
          ? `<button class="ck-ult" disabled>⏳ ${h.ult}</button>`
          : `<button class="ck-ult" disabled>🔒 ${h.ult} at Lv6</button>`;
      el.innerHTML = `<div class="ck-hero-row"><span class="ck-hero-chip">${h.emoji} Lv${lvl}</span>${ult}</div>`;
    }
  }

  function showOver(winner) {
    const el = ctx.root.querySelector('.ck-ctrl-over');
    const w = winner >= 0 ? seats.find((s) => s.seat === winner) : null;
    el.querySelector('.ck-ctrl-over-msg').innerHTML = w
      ? (winner === mySeat ? `👑<br>You rule the candy lands, ${escapeHtml(w.name)}!`
                           : `👑<br>${escapeHtml(w.name)} rules the candy lands!`)
      : '💥<br>Everyone crumbled!';
    el.classList.remove('hidden');
  }

  function sizeCanvas() {
    const box = ctx.root.querySelector('.ck-ctrl-map');
    canvas.width = box.clientWidth * devicePixelRatio;
    canvas.height = box.clientHeight * devicePixelRatio;
    if (world) {
      const zFit = fitZoom(canvas.width, canvas.height);
      cam.z = Math.max(cam.z, zFit);
      cam.min = zFit * 0.9;
    }
  }

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * devicePixelRatio;
    const py = (clientY - rect.top) * devicePixelRatio;
    return {
      x: (px - canvas.width / 2) / cam.z + cam.x,
      y: (py - canvas.height / 2) / cam.z + cam.y,
    };
  }

  function tryPlace(clientX, clientY) {
    if (!cur) return;
    const pt = screenToWorld(clientX, clientY);
    if (placing === '__rally') {
      ctx.send({ k: 'gather', x: Math.round(pt.x), y: Math.round(pt.y) });
      stopPlacing();
      return;
    }
    if (!placing) { trySelect(pt); return; }
    ghost = pt;
    if (ghostValid()) {
      ctx.send({ k: 'build', type: placing, x: Math.round(pt.x), y: Math.round(pt.y) });
      stopPlacing();
    } else {
      const hint = ctx.root.querySelector('.ck-place-hint');
      hint.classList.add('ck-shake');
      setTimeout(() => hint.classList.remove('ck-shake'), 400);
    }
  }

  function trySelect(pt) {
    if (!cur) return;
    let hit = null, hitD = Infinity;
    for (const b of cur.snap.b) {
      if (b[1] !== mySeat || b[6] < 100) continue;
      const type = TYPE_IDX[b[2]];
      if (type !== 'castle' && type !== 'camp' && type !== 'bakery') continue;
      const r = (type === 'castle' ? CASTLE.r : BLD[type].r) + 26;
      const d = dist(pt.x, pt.y, b[3], b[4]);
      if (d <= r && d < hitD) { hitD = d; hit = b; }
    }
    if (!hit) return;
    const type = TYPE_IDX[hit[2]];
    if (type === 'bakery') selGuardBld = (selGuardBld === hit[0]) ? null : hit[0];
    else selWorkerBld = (selWorkerBld === hit[0]) ? null : hit[0];
  }

  function ghostValid() {
    if (!ghost || !placing || placing === '__rally' || !cur) return false;
    const snap = cur.snap;
    const buildings = snap.b.map((b) => ({ seat: b[1], type: TYPE_IDX[b[2]], x: b[3], y: b[4], prog: b[6] / 100 }));
    const units = snap.u.map((u) => ({ seat: u[1], x: u[3], y: u[4] }));
    return canPlace(world, buildings, units, mySeat, placing, ghost.x, ghost.y);
  }

  function bindTouch() {
    const el = canvas;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touch = { mode: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY,
                  x0: e.touches[0].clientX, y0: e.touches[0].clientY, moved: 0 };
        if (placing) ghost = screenToWorld(touch.x, touch.y);
      } else if (e.touches.length === 2) {
        touch = { mode: 'zoom', d: tdist(e), z: cam.z };
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!touch) return;
      if (touch.mode === 'pan' && e.touches.length === 1) {
        const dx = (e.touches[0].clientX - touch.x) * devicePixelRatio;
        const dy = (e.touches[0].clientY - touch.y) * devicePixelRatio;
        touch.moved += Math.abs(dx) + Math.abs(dy);
        touch.x = e.touches[0].clientX; touch.y = e.touches[0].clientY;
        cam.x -= dx / cam.z; cam.y -= dy / cam.z;
        const m = WORLD_R * 1.1;
        cam.x = Math.max(-m, Math.min(m, cam.x));
        cam.y = Math.max(-m, Math.min(m, cam.y));
        if (placing) ghost = screenToWorld(touch.x, touch.y);
      } else if (touch.mode === 'zoom' && e.touches.length === 2) {
        const d = tdist(e);
        cam.z = Math.max(cam.min || 0.1, Math.min(3, touch.z * (d / touch.d)));
      }
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (touch && touch.mode === 'pan' && touch.moved < 14) {
        tryPlace(touch.x, touch.y);
      }
      touch = null;
    }, { passive: true });
    let mdrag = null;
    el.addEventListener('mousedown', (e) => { mdrag = { x: e.clientX, y: e.clientY, moved: 0 }; });
    el.addEventListener('mousemove', (e) => {
      if (placing) ghost = screenToWorld(e.clientX, e.clientY);
      if (!mdrag) return;
      mdrag.moved += Math.abs(e.clientX - mdrag.x) + Math.abs(e.clientY - mdrag.y);
      cam.x -= ((e.clientX - mdrag.x) * devicePixelRatio) / cam.z;
      cam.y -= ((e.clientY - mdrag.y) * devicePixelRatio) / cam.z;
      mdrag.x = e.clientX; mdrag.y = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (mdrag && mdrag.moved < 10) tryPlace(e.clientX, e.clientY);
      mdrag = null;
    });
    window.addEventListener('resize', sizeCanvas);
  }
  function tdist(e) {
    const a = e.touches[0], b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function render(now) {
    raf = requestAnimationFrame(render);
    if (!g || !world || !cur) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.translate(canvas.width / 2, canvas.height / 2);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);

    let alpha = 1;
    if (prev) alpha = Math.max(0, Math.min(1, (now - cur.at) / (cur.at - prev.at || TICK_MS * SNAP_EVERY)));
    const prevById = new Map(prev ? prev.snap.u.map((u) => [u[0], u]) : []);
    drawScene(g, world, seats, {
      buildings: cur.snap.b,
      players: cur.snap.pl,
      eachUnit: (cb) => {
        for (const u of cur.snap.u) {
          const p0 = prevById.get(u[0]);
          const x = p0 ? p0[3] + (u[3] - p0[3]) * alpha : u[3];
          const y = p0 ? p0[4] + (u[4] - p0[4]) * alpha : u[4];
          cb(u[0], u[1], u[2], x, y, u[5], u[6], u[7]);
        }
      },
    }, now);

    if (placing && placing !== '__rally') {
      const s = seats[mySeat];
      g.lineWidth = 4; g.strokeStyle = s.color; g.globalAlpha = 0.5; g.setLineDash([6, 12]);
      for (const b of cur.snap.b) {
        if (b[1] === mySeat && TYPE_IDX[b[2]] === 'camp' && b[6] >= 100) {
          g.beginPath(); g.arc(b[3], b[4], CAMP_AURA, 0, Math.PI * 2); g.stroke();
        }
      }
      g.setLineDash([]); g.globalAlpha = 1;
      if (ghost) {
        const ok = ghostValid();
        g.globalAlpha = 0.65;
        drawBuilding(g, placing, ghost.x, ghost.y, s.color, BLD[placing].hp, BLD[placing].hp, 1);
        g.globalAlpha = 1;
        g.lineWidth = 4; g.strokeStyle = ok ? '#6bcf7f' : '#ff4d6d';
        g.setLineDash([10, 8]);
        g.beginPath(); g.arc(ghost.x, ghost.y, BLD[placing].r + 16, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
    } else if (placing === '__rally' && ghost) {
      g.font = '34px sans-serif'; g.textAlign = 'center';
      g.fillText('🚩', ghost.x, ghost.y);
    }

    for (const id of [selWorkerBld, selGuardBld]) {
      if (!id) continue;
      const b = cur.snap.b.find((q) => q[0] === id);
      if (!b) continue;
      const r2 = (TYPE_IDX[b[2]] === 'castle' ? CASTLE.r : BLD[TYPE_IDX[b[2]]].r) + 18;
      g.lineWidth = 5; g.strokeStyle = '#ffd93d'; g.setLineDash([12, 9]);
      g.lineDashOffset = -(now * 0.02) % 21;
      g.beginPath(); g.arc(b[3], b[4], r2, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }

    fxLive = fxLive.filter((f) => now - f.t0 < fxLife(f.t) * 1000 + 60);
    drawFx(g, fxLive, now);
  }

  function destroy() {
    cancelAnimationFrame(raf);
    clearInterval(syncTimer);
    ctx.root.innerHTML = '';
  }

  return { start, onMessage, destroy };
}

/* ================= module export ================= */

export default {
  id: 'candykingdoms',
  title: 'Candy Kingdoms',
  tagline: 'Harvest candy, raise an army, crumble their castles',
  emoji: '🏰',
  minPlayers: 2,
  maxPlayers: 6,
  comingSoon: false,
  createHost,
  createController,
};

/* headless testing hooks — not used by the app itself */
export const __sim = {
  buildWorld, makeSim, stepSim, train, build, canPlace, setMode, setTarget, snapshot,
  gather, minersAt, inTowerZone, onRoad, speedMul, enlist, upgradeCastle, heroCommand,
  castUlt, heroUnit, heroDef, dmgUnit, supplyCap, supplyUsed, nearestArm, nearestEnemy,
  WORKER, GUARD: UNITS.guard, UNITS, HEROES, BLD, CASTLE, ROYAL, MINE, HERO_SUMMON,
  SUPPLY_BASE, SUPPLY_PER_SHACK, START_CANDY, START_WORKERS, TICK_MS, XP_LVL,
  SLAM, STORM, SHIELD, SIEGE_MELEE, ULT_CD, ENLIST_COST,
};
