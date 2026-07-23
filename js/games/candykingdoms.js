/* ============================================================
   Candy Kingdoms — a kid-friendly lane RTS (phase 2: economy).

   Up to six kingdoms sit at the points of a snowflake. Gummy
   Helpers harvest candy from mines and carry it home; Bakeries
   train gingerbread guards; Sugar Shacks raise your army cap;
   Candy Camps claim the richer mines down your lane and at the
   arena rim. When your Send toggle is on and enough troops have
   mustered, the squad marches down your lane into the arena,
   fights whatever it meets, then pushes toward whichever castle
   you've targeted. Last castle standing wins.

   The sim is DOM-free on purpose so it can be tested headlessly
   (see the __sim export at the bottom).
   ============================================================ */

import { escapeHtml } from '../util.js';

/* ---------------- tuning ---------------- */

const TICK_MS = 100;          // authoritative sim rate (10 Hz)
const SNAP_EVERY = 2;         // snapshot to phones every N ticks (5 Hz)

const ARENA_R = 170;
const LANE_LEN = 430;
const PLOT_R = 200;
const BASE_R = ARENA_R + LANE_LEN + PLOT_R;
const WORLD_R = BASE_R + PLOT_R * 0.6 + 90;
const LANE_STEPS = 6;

const CASTLE = { hp: 800, r: 56 };
const WORKER = { hp: 40, speed: 3.1, cost: 30, time: 40, r: 10, carry: 10, mineTicks: 18, fleeR: 110 };
const GUARD  = { hp: 60, dmg: 8, cd: 8, range: 28, aggro: 130, speed: 2.9, cost: 25, time: 30, r: 13 };

const BLD = {
  bakery: { hp: 320, cost: 120, time: 110, r: 34, label: 'Bakery' },
  shack:  { hp: 220, cost: 80,  time: 80,  r: 26, label: 'Sugar Shack' },
  camp:   { hp: 260, cost: 100, time: 90,  r: 30, label: 'Candy Camp' },
  tower:  { hp: 380, cost: 110, time: 100, r: 28, label: 'Frosting Tower', range: 160, dmg: 10, cd: 10 },
};
const TYPE_IDX = ['castle', 'bakery', 'shack', 'camp', 'tower'];

/* supply: the base barely covers your starting helpers — armies are
   built on Sugar Shacks (candy AND territory sacrificed for troops) */
const SUPPLY_BASE = 6, SUPPLY_PER_SHACK = 8, SUPPLY_MAX = 60;
const START_CANDY = 150, START_WORKERS = 3;

/* mines never run out — but only a few helpers fit at once, so
   colonizing more mines is the only way to speed up the economy */
const MINE = { r: 34, yield: { starter: 10, lane: 14, rim: 20 }, slots: 5 };
const HARVEST_LEASH = 270;    // a mine works only near its home drop-off
const CAMP_AURA = 300;        // finished camps project buildable territory
const BUILD_LEASH = 240;      // camps (only) can be founded near your troops
const QUEUE_MAX = 5;

/* towers are corridor weapons: your plot, the lanes, or the arena rim */
const TOWER_RING_IN = ARENA_R + 46, TOWER_RING_OUT = ARENA_R + 210;
const LANE_CORRIDOR = 70;     // half-width of the buildable lane strip

const SEP_R = 20;

/* ================= geometry (pure) ================= */

function armAngle(i, n) { return -Math.PI / 2 + (i * 2 * Math.PI) / n; }
function polar(a, r) { return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

/* buildWorld(n) → static geometry, including mine positions.
   Lanes are stored base→arena (index 0 nearest the castle). */
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

    /* three bottomless mines per arm: cozy starter, mid-lane, rich arena rim */
    mines.push({ x: base.x + perp.x * 145, y: base.y + perp.y * 145, kind: 'starter', arm: i });
    const mid = polar(a, (ARENA_R + BASE_R) / 2);
    mines.push({ x: mid.x + perp.x * 125, y: mid.y + perp.y * 125, kind: 'lane', arm: i });
    const rim = polar(a, ARENA_R + 115);
    mines.push({ x: rim.x + perp.x * 95, y: rim.y + perp.y * 95, kind: 'rim', arm: i });
  }
  return { n, arms, mines, arenaR: ARENA_R, plotR: PLOT_R, baseR: BASE_R, worldR: WORLD_R, castleR: CASTLE.r };
}

/* ================= simulation (pure, DOM-free) ================= */

function makeSim(n) {
  const world = buildWorld(n);
  const players = [], buildings = [], units = [];
  let uid = 1;
  for (let i = 0; i < n; i++) {
    players.push({ seat: i, candy: START_CANDY, castleHp: CASTLE.hp, elim: false, mode: 'stop', target: -1 });
    const b = world.arms[i].base;
    buildings.push({ id: 'c' + i, seat: i, type: 'castle', x: b.x, y: b.y, hp: CASTLE.hp, maxHp: CASTLE.hp, prog: 1, queue: [] });
    for (let w = 0; w < START_WORKERS; w++) {
      units.push(newUnit(uid++, i, 'worker', b.x + (Math.random() - 0.5) * 90, b.y + (Math.random() - 0.5) * 90, 'c' + i));
    }
  }
  return {
    tick: 0, world, players, buildings, units,
    fx: [], nextUid: uid, nextBid: 1,
    over: false, winner: -1,
  };
}

function newUnit(id, seat, kind, x, y, home) {
  const def = kind === 'worker' ? WORKER : GUARD;
  return {
    id, seat, kind, x, y, px: x, py: y, hp: def.hp,
    st: kind === 'worker' ? 'idle' : 'muster',
    path: null, pi: 0, cd: 0, carry: 0, mineIdx: -1, mt: 0,
    home: home || null, rx: 0, ry: 0,
  };
}

function supplyCap(sim, seat) {
  let shacks = 0;
  for (const b of sim.buildings) if (b.seat === seat && b.type === 'shack' && b.prog >= 1) shacks++;
  return Math.min(SUPPLY_MAX, SUPPLY_BASE + shacks * SUPPLY_PER_SHACK);
}
function supplyUsed(sim, seat) {
  let n = 0;
  for (const u of sim.units) if (u.seat === seat) n++;
  for (const b of sim.buildings) if (b.seat === seat) n += b.queue.length;
  return n;
}

/* queue a unit — workers at a castle or camp, guards at a bakery.
   `bldId` (optional) picks the exact building; otherwise best queue wins. */
function train(sim, seat, kind, bldId) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over) return false;
  const def = kind === 'worker' ? WORKER : kind === 'guard' ? GUARD : null;
  if (!def) return false;
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

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/* towers are corridor weapons: your home plot, any lane strip, or the arena rim */
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

/* placement rules — shared with the phone so the ghost can go green/red.
   Territory = your plot, or the aura of a FINISHED friendly Candy Camp.
   Camps alone may also be founded near your troops (the beachhead rule).
   `buildings` entries need {seat, type, x, y, prog}. */
function canPlace(world, buildings, units, seat, type, x, y) {
  const def = BLD[type];
  if (!def) return false;
  if (Math.hypot(x, y) > WORLD_R - 30) return false;              // stay on the cookie
  if (Math.hypot(x, y) < ARENA_R + 46) return false;              // the arena stays wild
  for (const b of buildings) {
    const br = b.type === 'castle' ? CASTLE.r : BLD[b.type].r;
    if (dist(x, y, b.x, b.y) < def.r + br + 14) return false;     // no stacking
  }
  for (const m of world.mines) {
    if (dist(x, y, m.x, m.y) < def.r + MINE.r + 10) return false; // don't squish the candy
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
    hp: def.hp, maxHp: def.hp, prog: 0, queue: [],
  });
  sim.fx.push({ t: 'spawn', x, y });
  return true;
}

function setMode(sim, seat, mode) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  if (mode !== 'send' && mode !== 'stop') return;
  p.mode = mode;
  if (mode === 'stop') {
    /* everyone advancing digs in right where they are (they'll still fight back) */
    for (const u of sim.units) {
      if (u.seat === seat && u.kind === 'guard' && (u.st === 'path' || u.st === 'hold')) {
        u.st = 'stand'; u.path = null;
      }
    }
  }
}

/* which snowflake arm is this unit standing in? */
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

/* put an idle/standing guard back on the road: toward the arena, or —
   if it's already deep in the target's arm — onward to their castle */
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

function setTarget(sim, seat, target) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  if (target === -1) { p.target = -1; return; }
  const t = sim.players[target];
  if (t && !t.elim && target !== seat) p.target = target;
}

function pushPath(world, targetSeat) {
  const arm = world.arms[targetSeat];
  const path = arm.lane.slice().reverse().map((pt) => ({ x: pt.x, y: pt.y }));
  path.push({ x: arm.base.x, y: arm.base.y, castle: targetSeat });
  return path;
}
function bldRadius(b) { return b.type === 'castle' ? CASTLE.r : BLD[b.type].r; }

/* nearest living enemy unit or building within `radius` of u */
function nearestEnemy(sim, u, radius) {
  let best = null, bestD = radius;
  for (const e of sim.units) {
    if (e.seat === u.seat || e.hp <= 0) continue;
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
/* Gather: drop a rally flag — every guard disengages and runs to it,
   then digs in. Doubles as the retreat button. */
function gather(sim, seat, x, y) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over) return false;
  if (!isFinite(x) || !isFinite(y) || Math.hypot(x, y) > WORLD_R) return false;
  p.mode = 'stop';
  sim.fx.push({ t: 'flag', x, y });
  for (const u of sim.units) {
    if (u.seat === seat && u.kind === 'guard' && u.hp > 0) {
      u.st = 'rally'; u.path = null; u.rx = x; u.ry = y;
    }
  }
  return true;
}

function minersAt(sim, mineIdx) {
  let n = 0;
  for (const u of sim.units) if (u.st === 'mining' && u.mineIdx === mineIdx) n++;
  return n;
}

/* helpers work the mines near their OWN home building — nearest first,
   skipping mines that already have a full digging crew */
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
  return cands[0].i;   // all crews full — join the nearest line
}

function findBuilding(sim, id) {
  for (const b of sim.buildings) if (b.id === id) return b;
  return null;
}

function moveToward(u, tx, ty, speed) {
  const d = dist(u.x, u.y, tx, ty);
  if (d < 0.001) return;
  const step = Math.min(speed, d);
  u.x += ((tx - u.x) / d) * step;
  u.y += ((ty - u.y) / d) * step;
}

function eliminate(sim, seat, bySeat) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  p.elim = true;
  p.send = false;
  const home = sim.world.arms[seat].base;
  sim.fx.push({ t: 'boom', x: home.x, y: home.y });
  for (const u of sim.units) {
    if (u.seat === seat && u.hp > 0) { u.hp = 0; sim.fx.push({ t: 'poof', x: u.x, y: u.y }); }
  }
  for (const b of sim.buildings) {
    if (b.seat === seat && b.hp > 0 && b.type !== 'castle') { b.hp = 0; sim.fx.push({ t: 'poof', x: b.x, y: b.y }); }
  }
  for (const q of sim.players) if (q.target === seat) q.target = -1;
  /* anyone marching on the fallen castle digs in for new orders */
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
      sim.fx.push({ t: 'poof', x: b.x, y: b.y });
    }
  }
}

function stepSim(sim) {
  if (sim.over) return;
  sim.tick++;
  const world = sim.world;

  /* construction + training queues */
  for (const b of sim.buildings) {
    if (b.hp <= 0) continue;
    if (b.prog < 1) {
      b.prog = Math.min(1, b.prog + 1 / BLD[b.type].time);
      if (b.prog >= 1) sim.fx.push({ t: 'spawn', x: b.x, y: b.y });
      continue;
    }
    if (b.queue.length) {
      const job = b.queue[0];
      job.t--;
      if (job.t <= 0) {
        b.queue.shift();
        const jx = (Math.random() - 0.5) * 60, jy = (Math.random() - 0.5) * 60;
        sim.units.push(newUnit(sim.nextUid++, b.seat, job.kind, b.x + jx, b.y + jy + bldRadius(b) * 0.6, b.id));
        sim.fx.push({ t: 'spawn', x: b.x + jx, y: b.y + jy });
      }
    }
    /* frosting towers splat intruders — and duel enemy buildings in range */
    if (b.type === 'tower' && b.prog >= 1) {
      b.cd = Math.max(0, (b.cd || 0) - 1);
      if (b.cd === 0) {
        let tgt = null, tgtD = BLD.tower.range;
        for (const e of sim.units) {
          if (e.seat === b.seat || e.hp <= 0) continue;
          const d = dist(b.x, b.y, e.x, e.y);
          if (d < tgtD) { tgtD = d; tgt = e; }
        }
        if (tgt) {
          tgt.hp -= BLD.tower.dmg;
          b.cd = BLD.tower.cd;
          sim.fx.push({ t: 'zap', x: b.x, y: b.y, x2: tgt.x, y2: tgt.y });
          sim.fx.push({ t: 'hit', x: tgt.x, y: tgt.y });
          if (tgt.hp <= 0) sim.fx.push({ t: 'poof', x: tgt.x, y: tgt.y });
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

  /* Send mode: everyone not already advancing hits the road — including
     troops fresh out of the oven, so the pressure is continuous */
  for (const p of sim.players) {
    if (p.elim || p.mode !== 'send') continue;
    let horn = false;
    for (const u of sim.units) {
      if (u.seat !== p.seat || u.kind !== 'guard' || u.hp <= 0) continue;
      if (u.st === 'muster' || u.st === 'stand') { assignAdvance(sim, u, p); horn = true; }
    }
    if (horn && sim.tick % 20 === 0) {
      sim.fx.push({ t: 'horn', x: world.arms[p.seat].muster.x, y: world.arms[p.seat].muster.y });
    }
  }

  /* unit brains */
  for (const u of sim.units) {
    if (u.hp <= 0) continue;
    u.px = u.x; u.py = u.y;
    if (u.cd > 0) u.cd--;

    /* ---- Gummy Helpers: loyal to their home building ---- */
    if (u.kind === 'worker') {
      let home = u.home ? findBuilding(sim, u.home) : null;
      if (!home || home.seat !== u.seat || home.prog < 1 || (home.type !== 'castle' && home.type !== 'camp')) {
        home = nearestDropoff(sim, u.seat, u.x, u.y);      // orphaned — adopt the nearest
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
        /* the digging crew is full — wait for a shovel */
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

    /* ---- Gingerbread Guards ---- */
    if (u.st === 'rally') {
      /* running to the flag — no stopping for fights (this is the retreat) */
      if (dist(u.x, u.y, u.rx, u.ry) > 55) { moveToward(u, u.rx, u.ry, GUARD.speed); continue; }
      u.st = 'stand';
    }
    const foe = nearestEnemy(sim, u, GUARD.aggro * (u.st === 'hold' ? 1.6 : 1));
    if (foe) {
      if (foe.unit) {
        const e = foe.unit;
        if (foe.d <= GUARD.range) {
          if (u.cd === 0) {
            e.hp -= GUARD.dmg; u.cd = GUARD.cd;
            sim.fx.push({ t: 'hit', x: e.x, y: e.y });
            if (e.hp <= 0) sim.fx.push({ t: 'poof', x: e.x, y: e.y });
          }
        } else moveToward(u, e.x, e.y, GUARD.speed);
        continue;
      }
      if (foe.bld) {
        if (foe.d <= GUARD.range) {
          if (u.cd === 0) {
            damageBuilding(sim, foe.bld, GUARD.dmg, u.seat); u.cd = GUARD.cd;
            sim.fx.push({ t: 'hit', x: foe.x, y: foe.y - bldRadius(foe.bld) * 0.5 });
          }
        } else moveToward(u, foe.x, foe.y, GUARD.speed);
        continue;
      }
    }

    if (u.st === 'muster') {
      const m = world.arms[u.seat].muster;
      if (dist(u.x, u.y, m.x, m.y) > 80) moveToward(u, m.x, m.y, GUARD.speed);
    } else if (u.st === 'path' && u.path) {
      const wp = u.path[u.pi];
      moveToward(u, wp.x, wp.y, GUARD.speed);
      const arrive = typeof wp.castle === 'number' ? CASTLE.r + GUARD.range - 6 : 14;
      if (dist(u.x, u.y, wp.x, wp.y) <= arrive) {
        if (wp.hold) { u.st = 'hold'; u.path = null; }
        else if (typeof wp.castle === 'number') {
          /* attack handled by aggro — but if that castle already crumbled,
             dig in so Send mode can re-route this troop */
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
    /* 'stand' troops hold their ground — the aggro check above still lets them fight */
  }

  /* gentle crowding so squads read as crowds, not a dot */
  const live = sim.units.filter((u) => u.hp > 0);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
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

  /* keep the banner mirror fresh + sweep the fallen */
  for (const b of sim.buildings) {
    if (b.type === 'castle' && b.hp > 0) sim.players[b.seat].castleHp = b.hp;
  }
  sim.units = sim.units.filter((u) => u.hp > 0);
  sim.buildings = sim.buildings.filter((b) => b.hp > 0);
}

/* compact wire format for phones */
function snapshot(sim) {
  const u = sim.units.map((x) => [x.id, x.seat, x.kind === 'worker' ? 0 : 1, Math.round(x.x), Math.round(x.y), x.hp, x.carry > 0 ? 1 : 0]);
  const b = sim.buildings.map((x) => [x.id, x.seat, TYPE_IDX.indexOf(x.type), Math.round(x.x), Math.round(x.y), x.hp, Math.round(x.prog * 100), x.queue.length]);
  const pl = sim.players.map((p) => [
    p.seat, Math.floor(p.candy), Math.round(p.castleHp), p.elim ? 1 : 0,
    p.mode === 'send' ? 1 : 0, p.target,
    supplyUsed(sim, p.seat), supplyCap(sim, p.seat),
    sim.units.filter((x) => x.seat === p.seat && x.kind === 'guard' && (x.st === 'muster' || x.st === 'stand')).length,
  ]);
  const fx = sim.fx.map((f) => [f.t, Math.round(f.x), Math.round(f.y), f.x2 !== undefined ? Math.round(f.x2) : 0, f.y2 !== undefined ? Math.round(f.y2) : 0]);
  sim.fx = [];
  const snap = { k: 'snap', n: sim.tick, u, b, pl, fx };
  if (sim.over) { snap.over = 1; snap.winner = sim.winner; }
  if (sim.lastElim) { snap.elim = sim.lastElim; sim.lastElim = null; }
  return snap;
}

/* ================= shared drawing =================
   One renderer for the TV and the phones — same world,
   different camera. */

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

function drawCastle(g, x, y, color, hp, elim, name, avatar) {
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
  const w = CASTLE.r * 1.7, frac = Math.max(0, hp / CASTLE.hp);
  g.fillStyle = 'rgba(74,37,69,.25)'; rr(g, -w / 2, CASTLE.r * 0.78, w, 12, 6); g.fill();
  g.fillStyle = frac > 0.4 ? '#6bcf7f' : (frac > 0.18 ? '#ffd93d' : '#ff4d6d');
  if (frac > 0) { rr(g, -w / 2, CASTLE.r * 0.78, Math.max(10, w * frac), 12, 6); g.fill(); }
  g.font = '600 22px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#4a2545';
  g.fillText(`${avatar || ''} ${name || ''}`.trim(), 0, CASTLE.r * 1.22);
  g.restore();
}

/* bakery / shack / camp — cute, chunky, readable at any zoom */
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
    /* a cupcake watchtower: wrapper, frosting swirl, cherry on top */
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

function drawGuard(g, x, y, color, hp, wobble) {
  const dark = shade(color, 0.7);
  g.save(); g.translate(x, y);
  g.rotate(Math.sin(wobble) * 0.08);
  g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 2.5;
  g.beginPath(); g.arc(0, 0, GUARD.r, Math.PI, 0);
  g.lineTo(GUARD.r, GUARD.r * 0.55);
  g.quadraticCurveTo(0, GUARD.r * 0.95, -GUARD.r, GUARD.r * 0.55);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#3a2038';
  g.beginPath(); g.arc(-4.5, -2, 2.1, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(4.5, -2, 2.1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a2038'; g.lineWidth = 1.8;
  g.beginPath(); g.arc(0, 2.5, 4, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  if (hp < GUARD.hp) {
    const frac = hp / GUARD.hp;
    g.fillStyle = 'rgba(74,37,69,.3)'; rr(g, -11, -GUARD.r - 8, 22, 4, 2); g.fill();
    g.fillStyle = frac > 0.4 ? '#6bcf7f' : '#ff4d6d';
    rr(g, -11, -GUARD.r - 8, Math.max(3, 22 * frac), 4, 2); g.fill();
  }
  g.restore();
}

/* little round helper with a hard hat; shows a candy when carrying */
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
  if (hp < WORKER.hp) {
    const frac = hp / WORKER.hp;
    g.fillStyle = 'rgba(74,37,69,.3)'; rr(g, -9, -WORKER.r - 16, 18, 3, 2); g.fill();
    g.fillStyle = frac > 0.4 ? '#6bcf7f' : '#ff4d6d';
    rr(g, -9, -WORKER.r - 16, Math.max(2, 18 * frac), 3, 2); g.fill();
  }
  g.restore();
}

function fxLife(t) { return t === 'flag' ? 2.6 : 0.9; }

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
    } else if (f.t === 'boom') {
      g.strokeStyle = '#ff9f4a'; g.lineWidth = 8;
      g.beginPath(); g.arc(0, 0, 20 + k * 150, 0, Math.PI * 2); g.stroke();
      g.font = '42px sans-serif'; g.textAlign = 'center';
      g.fillText('🌈', 0, -k * 40);
    } else if (f.t === 'spawn' || f.t === 'horn') {
      g.strokeStyle = '#b380ff'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 4 + k * 18, 0, Math.PI * 2); g.stroke();
    } else if (f.t === 'zap' && f.x2 !== undefined) {
      g.strokeStyle = '#ff8fb3'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, -20); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -20); g.lineTo(f.x2 - f.x, f.y2 - f.y); g.stroke();
    }
    g.restore();
  }
}

function fitZoom(w, h) { return Math.min(w, h) / (WORLD_R * 2.15); }

/* render one full frame of world state onto a prepared canvas.
   `view` = {buildings:[[id,seat,typeIdx,x,y,hp,prog,q]], mines:[stock],
             players:[[seat,candy,castleHp,elim,...]], drawUnit(cb)} */
function drawScene(g, world, seats, view, now) {
  drawTerrain(g, world, seats, now);
  for (const m of world.mines) drawMine(g, m.x, m.y, m.kind);
  for (const b of view.buildings) {
    const s = seats[b[1]];
    const type = TYPE_IDX[b[2]];
    if (type === 'castle') continue;   // castles drawn below with nameplates
    drawBuilding(g, type, b[3], b[4], s ? s.color : '#ccc', b[5], BLD[type].hp, b[6] / 100);
  }
  for (const p of view.players) {
    const s = seats[p[0]];
    const home = world.arms[p[0]].base;
    drawCastle(g, home.x, home.y, s ? s.color : '#ccc', p[2], !!p[3], s && s.name, s && s.avatar);
  }
  view.eachUnit((id, seat, kind, x, y, hp, carry) => {
    const s = seats[seat];
    if (kind === 0) drawWorker(g, x, y, s.color, hp, !!carry, now * 0.012 + id);
    else drawGuard(g, x, y, s.color, hp, now * 0.012 + id);
  });
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
        worker: WORKER.cost, guard: GUARD.cost,
        bakery: BLD.bakery.cost, shack: BLD.shack.cost, camp: BLD.camp.cost, tower: BLD.tower.cost,
      },
    });
  }

  function onMessage(playerId, data) {
    if (!sim || !data) return;
    const seat = seatByPlayer.get(playerId);
    if (seat === undefined) return;
    if (data.k === 'train') train(sim, seat, data.unit === 'worker' ? 'worker' : 'guard', typeof data.bld === 'string' ? data.bld : undefined);
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

  /* ---------- HUD ---------- */
  function renderBanners() {
    const el = ctx.root.querySelector('.ck-banners');
    el.innerHTML = seats.map((s) => `
      <div class="ck-banner" data-seat="${s.seat}" style="--bcol:${s.color}">
        <span class="ck-banner-av">${s.avatar}</span>
        <span class="ck-banner-name">${escapeHtml(s.name)}</span>
        <span class="ck-banner-candy">🍬 <b class="ck-b-candy">0</b></span>
        <span class="ck-banner-hpwrap"><span class="ck-b-hp"></span></span>
      </div>`).join('');
  }

  function updateBanners() {
    for (const p of sim.players) {
      const el = ctx.root.querySelector(`.ck-banner[data-seat="${p.seat}"]`);
      if (!el) continue;
      el.classList.toggle('ck-elim', p.elim);
      el.querySelector('.ck-b-candy').textContent = Math.floor(p.candy);
      el.querySelector('.ck-b-hp').style.width = Math.max(0, (p.castleHp / CASTLE.hp) * 100) + '%';
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
    drawScene(g, sim.world, seats, {
      buildings: sim.buildings.map((b) => [b.id, b.seat, TYPE_IDX.indexOf(b.type), b.x, b.y, b.hp, Math.round(b.prog * 100), b.queue.length]),
      players: sim.players.map((p) => [p.seat, 0, p.castleHp, p.elim ? 1 : 0]),
      eachUnit: (cb) => {
        for (const u of sim.units) {
          const x = u.px + (u.x - u.px) * alpha;
          const y = u.py + (u.y - u.py) * alpha;
          cb(u.id, u.seat, u.kind === 'worker' ? 0 : 1, x, y, u.hp, u.carry > 0 ? 1 : 0);
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
    <div class="ck-ctrl-maphint">Drag to look · pinch to zoom</div>
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
      <div class="ck-target-row"></div>
    </div>
    <div class="ck-tabpage hidden" data-page="build">
      <div class="ck-train-row">
        <button class="ck-train" data-unit="worker">🧑‍🔧 Helper <span class="ck-price ck-price-worker"></span><span class="ck-q ck-q-worker hidden"></span></button>
        <button class="ck-train" data-unit="guard">🍪 Guard <span class="ck-price ck-price-guard"></span><span class="ck-q ck-q-guard hidden"></span></button>
      </div>
      <div class="ck-build-row">
        <button class="ck-build" data-type="bakery">🍪<span>Bakery</span><span class="ck-price ck-price-bakery"></span></button>
        <button class="ck-build" data-type="shack">🍭<span>Shack</span><span class="ck-price ck-price-shack"></span></button>
        <button class="ck-build" data-type="camp">⛺<span>Camp</span><span class="ck-price ck-price-camp"></span></button>
        <button class="ck-build" data-type="tower">🧁<span>Tower</span><span class="ck-price ck-price-tower"></span></button>
      </div>
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
  let placing = null;              // building type, or '__rally', while tap-to-place is armed
  let ghost = null;                // {x, y} world coords of the ghost
  let selWorkerBld = null;         // chosen castle/camp for helpers
  let selGuardBld = null;          // chosen bakery for guards

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
      for (const key of ['worker', 'guard', 'bakery', 'shack', 'camp', 'tower']) {
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

  /* ---------- panel ---------- */
  function bindPanel() {
    const r = ctx.root;
    r.querySelectorAll('.ck-train').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bld = btn.dataset.unit === 'worker' ? selWorkerBld : selGuardBld;
        ctx.send({ k: 'train', unit: btn.dataset.unit, bld: bld || undefined });
      });
    });
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
        if (tab.dataset.tab !== 'build') stopPlacing();
        else if (placing === '__rally') stopPlacing();
      });
    });
    r.querySelector('.ck-warbtn-send').addEventListener('click', () => ctx.send({ k: 'mode', mode: 'send' }));
    r.querySelector('.ck-warbtn-stop').addEventListener('click', () => ctx.send({ k: 'mode', mode: 'stop' }));
    r.querySelector('.ck-warbtn-gather').addEventListener('click', () => {
      if (placing === '__rally') stopPlacing();
      else startPlacing('__rally');
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
    const supFull = me[6] >= me[7];
    const wSrc = selWorkerBld
      ? myBld.filter((b) => b[0] === selWorkerBld)
      : myBld.filter((b) => ['castle', 'camp'].includes(TYPE_IDX[b[2]]));
    const gSrc = selGuardBld
      ? myBld.filter((b) => b[0] === selGuardBld)
      : myBld.filter((b) => TYPE_IDX[b[2]] === 'bakery');
    const wq = wSrc.reduce((s, b) => s + b[7], 0);
    const gq = gSrc.reduce((s, b) => s + b[7], 0);
    setQ('.ck-q-worker', wq); setQ('.ck-q-guard', gq);

    r.querySelector('.ck-train[data-unit="worker"]').disabled = !!me[3] || me[1] < cfg.worker || supFull;
    const gbtn = r.querySelector('.ck-train[data-unit="guard"]');
    gbtn.disabled = !!me[3] || !hasBakery || me[1] < cfg.guard || supFull;
    gbtn.title = hasBakery ? '' : 'Build a Bakery first!';
    r.querySelectorAll('.ck-build').forEach((btn) => {
      btn.disabled = !!me[3] || me[1] < cfg[btn.dataset.type];
    });

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
    if (me[3]) { stopPlacing(); r.querySelector('.ck-ctrl-out').classList.remove('hidden'); }

    function setQ(sel, n) {
      const el = r.querySelector(sel);
      el.textContent = '×' + n;
      el.classList.toggle('hidden', n === 0);
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

  /* ---------- map ---------- */
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

  /* tap one of your castles/camps to pick where helpers spawn,
     or a bakery to pick where guards spawn */
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

    /* mouse fallback for desktop testing */
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
          cb(u[0], u[1], u[2], x, y, u[5], u[6]);
        }
      },
    }, now);

    if (placing && placing !== '__rally') {
      /* show where territory reaches: home plot ring + camp auras */
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

    /* gold rings on the buildings chosen as spawn points */
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
  supplyCap, supplyUsed, nearestArm, gather, minersAt, inTowerZone,
  WORKER, GUARD, BLD, CASTLE, MINE, SUPPLY_BASE, SUPPLY_PER_SHACK, START_CANDY, START_WORKERS, TICK_MS,
};
