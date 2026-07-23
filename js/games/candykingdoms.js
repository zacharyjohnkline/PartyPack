/* ============================================================
   Candy Kingdoms — a kid-friendly lane RTS (phase 1: engine core).

   Up to six kingdoms sit at the points of a snowflake. Each
   player builds an army at their base; when their Send toggle
   is on and enough troops have mustered, the squad marches down
   their lane into the central arena, where all armies collide
   Clash-style. Survivors push up the lane of whichever player
   you've targeted and attack their castle. Last castle standing
   wins.

   Phase 1 scope: world geometry, the 10Hz authoritative sim
   (muster → send → march → fight → castle damage → elimination),
   the big-screen renderer with a free host camera, and a phone
   controller with recruit / send-threshold / target controls
   plus a passive candy trickle. Workers, buildings, the full
   unit roster, heroes and conquest arrive in later phases.

   The sim is DOM-free on purpose so it can be tested headlessly
   (see the __sim export at the bottom).
   ============================================================ */

import { escapeHtml } from '../util.js';

/* ---------------- tuning ---------------- */

const TICK_MS = 100;          // authoritative sim rate (10 Hz)
const SNAP_EVERY = 2;         // snapshot to phones every N ticks (5 Hz)

const ARENA_R = 170;          // battle arena radius (world units)
const LANE_LEN = 430;         // arena rim → base plot rim
const PLOT_R = 200;           // each kingdom's buildable plot
const BASE_R = ARENA_R + LANE_LEN + PLOT_R;   // castle distance from center
const WORLD_R = BASE_R + PLOT_R * 0.6 + 90;   // edge of the cookie
const LANE_STEPS = 6;         // waypoints per lane

const CASTLE_HP = 800;
const CASTLE_R = 56;

const GUARD = { hp: 60, dmg: 8, cd: 8, range: 28, aggro: 130, speed: 2.9, cost: 20, r: 13 };

const START_CANDY = 120;
const TRICKLE = 0.25;         // candy per tick (2.5/s) — placeholder until workers (phase 2)
const THR_MIN = 1, THR_MAX = 30;
const SEP_R = 20;             // unit separation radius

/* ================= geometry (pure) ================= */

function armAngle(i, n) { return -Math.PI / 2 + (i * 2 * Math.PI) / n; }
function polar(a, r) { return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }
function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }

/* buildWorld(n) → static geometry for an n-armed snowflake.
   Lanes are stored base→arena (index 0 nearest the castle). */
function buildWorld(n) {
  const arms = [];
  for (let i = 0; i < n; i++) {
    const a = armAngle(i, n);
    const base = polar(a, BASE_R);
    const muster = polar(a, BASE_R - CASTLE_R - 78);
    const lane = [];
    const r0 = BASE_R - PLOT_R * 0.55;      // lane starts inside the plot
    const r1 = ARENA_R + 14;                // and ends at the arena rim
    for (let k = 0; k <= LANE_STEPS; k++) {
      lane.push(polar(a, r0 + (r1 - r0) * (k / LANE_STEPS)));
    }
    const hold = polar(a, ARENA_R * 0.38);  // where a squad waits inside the arena
    arms.push({ seat: i, angle: a, base, muster, lane, hold });
  }
  return { n, arms, arenaR: ARENA_R, plotR: PLOT_R, baseR: BASE_R, worldR: WORLD_R, castleR: CASTLE_R };
}

/* ================= simulation (pure, DOM-free) ================= */

function makeSim(n) {
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push({
      seat: i, candy: START_CANDY, castleHp: CASTLE_HP,
      elim: false, send: false, thr: 8, target: -1,
    });
  }
  return {
    tick: 0, world: buildWorld(n), players,
    units: [], fx: [], nextUid: 1,
    over: false, winner: -1,
  };
}

function recruitGuard(sim, seat) {
  const p = sim.players[seat];
  if (!p || p.elim || sim.over) return false;
  if (p.candy < GUARD.cost) return false;
  p.candy -= GUARD.cost;
  const arm = sim.world.arms[seat];
  const jx = (Math.random() - 0.5) * 70, jy = (Math.random() - 0.5) * 70;
  sim.units.push({
    id: sim.nextUid++, seat, type: 'guard',
    x: arm.muster.x + jx, y: arm.muster.y + jy,
    px: arm.muster.x + jx, py: arm.muster.y + jy,
    hp: GUARD.hp, st: 'muster', path: null, pi: 0, cd: 0, tgt: null,
  });
  sim.fx.push({ t: 'spawn', x: arm.muster.x + jx, y: arm.muster.y + jy });
  return true;
}

function setSend(sim, seat, on, thr) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  p.send = !!on;
  if (typeof thr === 'number' && isFinite(thr)) {
    p.thr = Math.max(THR_MIN, Math.min(THR_MAX, Math.round(thr)));
  }
}

function setTarget(sim, seat, target) {
  const p = sim.players[seat];
  if (!p || p.elim) return;
  if (target === -1) { p.target = -1; return; }
  const t = sim.players[target];
  if (t && !t.elim && target !== seat) p.target = target;
}

/* path a squad walks from the arena to an enemy castle */
function pushPath(world, targetSeat) {
  const arm = world.arms[targetSeat];
  const path = arm.lane.slice().reverse().map((pt) => ({ x: pt.x, y: pt.y }));
  path.push({ x: arm.base.x, y: arm.base.y, castle: targetSeat });
  return path;
}

/* path a squad walks from its base down into the arena */
function marchPath(world, seat) {
  const arm = world.arms[seat];
  const path = arm.lane.map((pt) => ({ x: pt.x, y: pt.y }));
  path.push({ x: arm.hold.x, y: arm.hold.y, hold: true });
  return path;
}

function findUnit(sim, id) {
  for (const u of sim.units) if (u.id === id) return u;
  return null;
}

/* nearest living enemy unit or castle within `radius` of u */
function nearestEnemy(sim, u, radius) {
  let best = null, bestD = radius;
  for (const e of sim.units) {
    if (e.seat === u.seat || e.hp <= 0) continue;
    const d = dist(u.x, u.y, e.x, e.y);
    if (d < bestD) { bestD = d; best = { unit: e, d }; }
  }
  for (const p of sim.players) {
    if (p.seat === u.seat || p.elim) continue;
    const b = sim.world.arms[p.seat].base;
    const d = dist(u.x, u.y, b.x, b.y) - CASTLE_R;   // to the castle's wall
    if (d < bestD) { bestD = d; best = { castle: p.seat, d, x: b.x, y: b.y }; }
  }
  return best;
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
  const b = sim.world.arms[seat].base;
  sim.fx.push({ t: 'boom', x: b.x, y: b.y });
  // their troops pop like balloons — nothing dark here
  for (const u of sim.units) {
    if (u.seat === seat && u.hp > 0) { u.hp = 0; sim.fx.push({ t: 'poof', x: u.x, y: u.y }); }
  }
  // anyone aiming at them needs a new plan
  for (const q of sim.players) if (q.target === seat) q.target = -1;
  sim.lastElim = { seat, bySeat: typeof bySeat === 'number' ? bySeat : -1 };

  const alive = sim.players.filter((q) => !q.elim);
  if (alive.length <= 1) {
    sim.over = true;
    sim.winner = alive.length ? alive[0].seat : -1;
  }
}

function stepSim(sim) {
  if (sim.over) return;
  sim.tick++;
  const world = sim.world;

  /* income (placeholder trickle until workers arrive in phase 2) */
  for (const p of sim.players) if (!p.elim) p.candy += TRICKLE;

  /* send: when the toggle is on and enough troops have mustered,
     the whole mustered group marches as one squad */
  for (const p of sim.players) {
    if (p.elim || !p.send) continue;
    const mustered = sim.units.filter((u) => u.seat === p.seat && u.st === 'muster' && u.hp > 0);
    if (mustered.length >= p.thr) {
      const path = marchPath(world, p.seat);
      for (const u of mustered) { u.st = 'path'; u.path = path.map((q) => ({ ...q })); u.pi = 0; }
      sim.fx.push({ t: 'horn', x: world.arms[p.seat].muster.x, y: world.arms[p.seat].muster.y });
    }
  }

  /* unit brains */
  for (const u of sim.units) {
    if (u.hp <= 0) continue;
    u.px = u.x; u.py = u.y;
    if (u.cd > 0) u.cd--;

    /* mustered troops stand guard at home (they'll still defend — aggro below) */
    const foe = u.st === 'muster'
      ? nearestEnemy(sim, u, GUARD.aggro)
      : nearestEnemy(sim, u, GUARD.aggro * (u.st === 'hold' ? 1.6 : 1));

    if (foe) {
      if (foe.unit) {
        const e = foe.unit;
        if (foe.d <= GUARD.range) {
          if (u.cd === 0) {
            e.hp -= GUARD.dmg; u.cd = GUARD.cd;
            sim.fx.push({ t: 'hit', x: e.x, y: e.y });
            if (e.hp <= 0) sim.fx.push({ t: 'poof', x: e.x, y: e.y });
          }
        } else {
          moveToward(u, e.x, e.y, GUARD.speed);
        }
        continue;
      }
      if (typeof foe.castle === 'number') {
        if (foe.d <= GUARD.range) {
          if (u.cd === 0) {
            const tp = sim.players[foe.castle];
            tp.castleHp -= GUARD.dmg; u.cd = GUARD.cd;
            sim.fx.push({ t: 'hit', x: foe.x, y: foe.y - CASTLE_R * 0.5 });
            if (tp.castleHp <= 0) { tp.castleHp = 0; eliminate(sim, foe.castle, u.seat); }
          }
        } else {
          moveToward(u, foe.x, foe.y, GUARD.speed);
        }
        continue;
      }
    }

    /* no fight nearby — walk the plan */
    if (u.st === 'path' && u.path) {
      const wp = u.path[u.pi];
      moveToward(u, wp.x, wp.y, GUARD.speed);
      const arrive = typeof wp.castle === 'number' ? CASTLE_R + GUARD.range - 6 : 14;
      if (dist(u.x, u.y, wp.x, wp.y) <= arrive) {
        if (wp.hold) { u.st = 'hold'; u.path = null; }
        else if (typeof wp.castle === 'number') { /* castle handled by aggro above */ }
        else if (u.pi < u.path.length - 1) u.pi++;
      }
    } else if (u.st === 'hold') {
      /* waiting in the arena — if my player has picked a target, push! */
      const p = sim.players[u.seat];
      if (p.target >= 0 && !sim.players[p.target].elim) {
        u.st = 'path'; u.path = pushPath(world, p.target); u.pi = 0;
      }
    }
  }

  /* gentle separation so squads look like crowds, not a single dot */
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

  /* sweep the fallen */
  sim.units = sim.units.filter((u) => u.hp > 0);
}

/* compact wire format for phones */
function snapshot(sim) {
  const u = sim.units.map((x) => [x.id, x.seat, Math.round(x.x), Math.round(x.y), x.hp]);
  const pl = sim.players.map((p) => [
    p.seat, Math.floor(p.candy), Math.round(p.castleHp), p.elim ? 1 : 0,
    p.send ? 1 : 0, p.thr, p.target,
  ]);
  const fx = sim.fx.map((f) => [f.t, Math.round(f.x), Math.round(f.y)]);
  sim.fx = [];
  const snap = { k: 'snap', n: sim.tick, u, pl, fx };
  if (sim.over) { snap.over = 1; snap.winner = sim.winner; }
  if (sim.lastElim) { snap.elim = sim.lastElim; sim.lastElim = null; }
  return snap;
}

/* ================= shared drawing =================
   One renderer for the TV and the phones — same world,
   different camera. `view` is {units, players} in sim-like
   shape; `seats` maps seat → {name, avatar, color}. */

function laneWidth() { return 46; }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `rgb(${r},${g},${b})`;
}

/* deterministic sprinkle field so the cookie looks the same every frame */
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

function drawTerrain(g, world, seats, t) {
  /* the cookie */
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

  /* kingdom plots */
  for (const arm of world.arms) {
    const col = seats[arm.seat] ? seats[arm.seat].color : '#cccccc';
    g.fillStyle = col; g.globalAlpha = 0.14;
    g.beginPath(); g.arc(arm.base.x, arm.base.y, world.plotR, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.5; g.lineWidth = 5; g.strokeStyle = col;
    g.setLineDash([2, 16]); g.lineCap = 'round'; g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
  }

  /* candy-road lanes */
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

  /* the arena — a lollipop swirl */
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

function drawCastle(g, x, y, color, hp, elim, name, avatar) {
  g.save(); g.translate(x, y);
  if (elim) {
    /* crumbled into sprinkles — friendly ruins */
    g.fillStyle = '#e8d9c4';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.beginPath(); g.arc(Math.cos(a) * 26, Math.sin(a) * 20 + 8, 12 - i, 0, Math.PI * 2); g.fill();
    }
    g.font = '28px sans-serif'; g.textAlign = 'center'; g.fillText('🍬', 0, 4);
    g.restore(); return;
  }
  const dark = shade(color, 0.72);
  /* body */
  g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 4;
  rr(g, -CASTLE_R * 0.78, -CASTLE_R * 0.55, CASTLE_R * 1.56, CASTLE_R * 1.15, 12);
  g.fill(); g.stroke();
  /* towers */
  for (const tx of [-CASTLE_R * 0.62, 0, CASTLE_R * 0.62]) {
    g.fillStyle = color;
    rr(g, tx - 13, -CASTLE_R * 0.95, 26, CASTLE_R * 0.55, 8); g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(tx, -CASTLE_R * 0.95, 10, Math.PI, 0); g.fill(); g.stroke();
  }
  /* frosting door + flag */
  g.fillStyle = '#fff8f0';
  rr(g, -14, CASTLE_R * 0.05, 28, CASTLE_R * 0.55, 10); g.fill();
  g.strokeStyle = dark; g.stroke();
  g.strokeStyle = dark; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -CASTLE_R * 1.05); g.lineTo(0, -CASTLE_R * 1.45); g.stroke();
  g.fillStyle = color;
  g.beginPath(); g.moveTo(0, -CASTLE_R * 1.45); g.lineTo(30, -CASTLE_R * 1.33); g.lineTo(0, -CASTLE_R * 1.21);
  g.closePath(); g.fill(); g.stroke();
  /* hp bar */
  const w = CASTLE_R * 1.7, frac = Math.max(0, hp / CASTLE_HP);
  g.fillStyle = 'rgba(74,37,69,.25)'; rr(g, -w / 2, CASTLE_R * 0.78, w, 12, 6); g.fill();
  g.fillStyle = frac > 0.4 ? '#6bcf7f' : (frac > 0.18 ? '#ffd93d' : '#ff4d6d');
  if (frac > 0) { rr(g, -w / 2, CASTLE_R * 0.78, Math.max(10, w * frac), 12, 6); g.fill(); }
  /* nameplate */
  g.font = '600 22px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#4a2545';
  g.fillText(`${avatar || ''} ${name || ''}`.trim(), 0, CASTLE_R * 1.22);
  g.restore();
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (typeof g.roundRect === 'function') { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawGuard(g, x, y, color, hp, wobble) {
  const dark = shade(color, 0.7);
  g.save(); g.translate(x, y);
  g.rotate(Math.sin(wobble) * 0.08);
  /* gumdrop body */
  g.fillStyle = color; g.strokeStyle = dark; g.lineWidth = 2.5;
  g.beginPath(); g.arc(0, 0, GUARD.r, Math.PI, 0);
  g.lineTo(GUARD.r, GUARD.r * 0.55);
  g.quadraticCurveTo(0, GUARD.r * 0.95, -GUARD.r, GUARD.r * 0.55);
  g.closePath(); g.fill(); g.stroke();
  /* face */
  g.fillStyle = '#3a2038';
  g.beginPath(); g.arc(-4.5, -2, 2.1, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(4.5, -2, 2.1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a2038'; g.lineWidth = 1.8;
  g.beginPath(); g.arc(0, 2.5, 4, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  /* hp pip when hurt */
  if (hp < GUARD.hp) {
    const frac = hp / GUARD.hp;
    g.fillStyle = 'rgba(74,37,69,.3)'; rr(g, -11, -GUARD.r - 8, 22, 4, 2); g.fill();
    g.fillStyle = frac > 0.4 ? '#6bcf7f' : '#ff4d6d';
    rr(g, -11, -GUARD.r - 8, Math.max(3, 22 * frac), 4, 2); g.fill();
  }
  g.restore();
}

function drawFx(g, fx, now) {
  for (const f of fx) {
    const age = (now - f.t0) / 1000;
    if (age > 0.9) continue;
    const k = age / 0.9;
    g.save(); g.translate(f.x, f.y); g.globalAlpha = 1 - k;
    if (f.t === 'poof') {
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
    }
    g.restore();
  }
}

/* fit-the-whole-world zoom for a given canvas */
function fitZoom(w, h) { return Math.min(w, h) / (WORLD_R * 2.15); }

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
  let seats = [];               // seat → {id, name, avatar, color}
  let seatByPlayer = new Map(); // playerId → seat
  let tickTimer = null;
  let raf = 0;
  let lastTickAt = 0;
  let fxLive = [];              // {t,x,y,t0}
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
      if (!lastTickAt) { cam.z = cam.tz; }
    };
    window.addEventListener('resize', resizeHandler);
    resizeHandler();

    /* camera input */
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

    /* the heartbeat */
    lastTickAt = performance.now();
    tickTimer = setInterval(onTick, TICK_MS);
    raf = requestAnimationFrame(render);
  }

  function onTick() {
    stepSim(sim);
    lastTickAt = performance.now();
    for (const f of sim.fx) fxLive.push({ ...f, t0: lastTickAt });
    if (sim.tick % SNAP_EVERY === 0 || sim.over) {
      const snap = snapshot(sim);   // drains sim.fx
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
      cfg: { cost: GUARD.cost, thrMin: THR_MIN, thrMax: THR_MAX, castleHp: CASTLE_HP },
    });
  }

  function onMessage(playerId, data) {
    if (!sim || !data) return;
    const seat = seatByPlayer.get(playerId);
    if (seat === undefined) return;
    if (data.k === 'recruit') recruitGuard(sim, seat);
    else if (data.k === 'send') setSend(sim, seat, data.on, data.thr);
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
      el.querySelector('.ck-b-hp').style.width = Math.max(0, (p.castleHp / CASTLE_HP) * 100) + '%';
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

  /* ---------- render loop ---------- */
  function clampCam() {
    const m = WORLD_R * 1.1;
    cam.tx = Math.max(-m, Math.min(m, cam.tx));
    cam.ty = Math.max(-m, Math.min(m, cam.ty));
  }

  function render(now) {
    raf = requestAnimationFrame(render);
    if (!g) return;
    cam.x += (cam.tx - cam.x) * 0.12;
    cam.y += (cam.ty - cam.y) * 0.12;
    cam.z += (cam.tz - cam.z) * 0.12;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.translate(canvas.width / 2, canvas.height / 2);
    g.scale(cam.z, cam.z);
    g.translate(-cam.x, -cam.y);

    drawTerrain(g, sim.world, seats, now);
    for (const s of seats) {
      const p = sim.players[s.seat];
      const b = sim.world.arms[s.seat].base;
      drawCastle(g, b.x, b.y, s.color, p.castleHp, p.elim, s.name, s.avatar);
    }
    const alpha = Math.max(0, Math.min(1, (now - lastTickAt) / TICK_MS));
    for (const u of sim.units) {
      const x = u.px + (u.x - u.px) * alpha;
      const y = u.py + (u.y - u.py) * alpha;
      drawGuard(g, x, y, seats[u.seat].color, u.hp, now * 0.012 + u.id);
    }
    fxLive = fxLive.filter((f) => now - f.t0 < 950);
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
  </div>
  <div class="ck-panel">
    <div class="ck-row ck-row-top">
      <div class="ck-candy">🍬 <b class="ck-candy-n">0</b></div>
      <div class="ck-armysize">⚔️ <b class="ck-army-n">0</b> mustered</div>
    </div>
    <button class="ck-recruit">Recruit gingerbread guard <span class="ck-cost"></span></button>
    <div class="ck-sendbox">
      <label class="ck-sendrow">
        <span class="ck-sendlabel">Send armies</span>
        <span class="ck-switch"><input type="checkbox" class="ck-send-toggle"><span class="ck-knob"></span></span>
      </label>
      <div class="ck-thr-row">
        <span class="ck-thr-cap">march at <b class="ck-thr-n">8</b> troops</span>
        <input type="range" class="ck-thr" min="1" max="30" value="8">
      </div>
    </div>
    <div class="ck-targets">
      <div class="ck-targets-cap">Attack who?</div>
      <div class="ck-target-row"></div>
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
  let prev = null, cur = null;        // last two snapshots + arrival times
  let fxLive = [];
  let cam = { x: 0, y: 0, z: 0.5 };
  let canvas, g, raf = 0;
  let me = null;                       // my row from the latest snapshot
  let syncTimer = null;
  let touch = null;

  function start() {
    ctx.root.innerHTML = CTRL_HTML;
    canvas = ctx.root.querySelector('.ck-ctrl-canvas');
    g = canvas.getContext('2d');
    bindPanel();
    bindTouch();
    ctx.send({ k: 'need-init' });
    // if init hasn't landed in a couple seconds, nudge again (reconnects)
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
      ctx.root.querySelector('.ck-cost').textContent = `(${cfg.cost} 🍬)`;
      const b = world.arms[mySeat].base;
      cam.x = b.x * 0.82; cam.y = b.y * 0.82;
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
      for (const f of data.fx) fxLive.push({ t: f[0], x: f[1], y: f[2], t0: cur.at });
      me = data.pl.find((r) => r[0] === mySeat) || null;
      updatePanel(data);
      if (data.over) showOver(data.winner);
      return;
    }
  }

  /* ---------- panel ---------- */
  function bindPanel() {
    const r = ctx.root;
    r.querySelector('.ck-recruit').addEventListener('click', () => ctx.send({ k: 'recruit' }));
    const toggle = r.querySelector('.ck-send-toggle');
    const thr = r.querySelector('.ck-thr');
    const pushSend = () => ctx.send({ k: 'send', on: toggle.checked, thr: parseInt(thr.value, 10) });
    toggle.addEventListener('change', pushSend);
    thr.addEventListener('input', () => {
      r.querySelector('.ck-thr-n').textContent = thr.value;
    });
    thr.addEventListener('change', pushSend);
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
    const mustered = snap.u.filter((u) => u[1] === mySeat).length; // all my troops (phase 1: close enough for the counter)
    r.querySelector('.ck-army-n').textContent = mustered;
    r.querySelector('.ck-recruit').disabled = !!me[3] || (cfg && me[1] < cfg.cost);
    const toggle = r.querySelector('.ck-send-toggle');
    if (toggle !== document.activeElement) toggle.checked = !!me[4];
    /* reflect the authoritative target */
    r.querySelectorAll('.ck-target').forEach((btn) => {
      btn.classList.toggle('is-on', parseInt(btn.dataset.seat, 10) === me[6]);
    });
    /* eliminated seats can't be targeted */
    for (const p of snap.pl) {
      if (p[3]) {
        const btn = r.querySelector(`.ck-target[data-seat="${p[0]}"]`);
        if (btn) btn.disabled = true;
      }
    }
    if (me[3]) r.querySelector('.ck-ctrl-out').classList.remove('hidden');
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

  function bindTouch() {
    const el = canvas;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touch = { mode: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else if (e.touches.length === 2) {
        touch = { mode: 'zoom', d: tdist(e), z: cam.z };
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!touch) return;
      if (touch.mode === 'pan' && e.touches.length === 1) {
        const dx = (e.touches[0].clientX - touch.x) * devicePixelRatio;
        const dy = (e.touches[0].clientY - touch.y) * devicePixelRatio;
        touch.x = e.touches[0].clientX; touch.y = e.touches[0].clientY;
        cam.x -= dx / cam.z; cam.y -= dy / cam.z;
        const m = WORLD_R * 1.1;
        cam.x = Math.max(-m, Math.min(m, cam.x));
        cam.y = Math.max(-m, Math.min(m, cam.y));
      } else if (touch.mode === 'zoom' && e.touches.length === 2) {
        const d = tdist(e);
        cam.z = Math.max(cam.min || 0.1, Math.min(3, touch.z * (d / touch.d)));
      }
    }, { passive: true });
    el.addEventListener('touchend', () => { touch = null; }, { passive: true });
    /* mouse fallback for testing in a desktop browser */
    let mdrag = null;
    el.addEventListener('mousedown', (e) => { mdrag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mouseup', () => { mdrag = null; });
    window.addEventListener('mousemove', (e) => {
      if (!mdrag) return;
      cam.x -= ((e.clientX - mdrag.x) * devicePixelRatio) / cam.z;
      cam.y -= ((e.clientY - mdrag.y) * devicePixelRatio) / cam.z;
      mdrag = { x: e.clientX, y: e.clientY };
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

    drawTerrain(g, world, seats, now);
    for (const p of cur.snap.pl) {
      const s = seats.find((q) => q.seat === p[0]);
      const b = world.arms[p[0]].base;
      drawCastle(g, b.x, b.y, s.color, p[2], !!p[3], s.name, s.avatar);
    }

    /* interpolate units between the last two snapshots */
    let alpha = 1;
    if (prev) alpha = Math.max(0, Math.min(1, (now - cur.at) / (cur.at - prev.at || TICK_MS * SNAP_EVERY)));
    const prevById = new Map(prev ? prev.snap.u.map((u) => [u[0], u]) : []);
    for (const u of cur.snap.u) {
      const p0 = prevById.get(u[0]);
      const x = p0 ? p0[2] + (u[2] - p0[2]) * alpha : u[2];
      const y = p0 ? p0[3] + (u[3] - p0[3]) * alpha : u[3];
      const s = seats.find((q) => q.seat === u[1]);
      drawGuard(g, x, y, s.color, u[4], now * 0.012 + u[0]);
    }
    fxLive = fxLive.filter((f) => now - f.t0 < 950);
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
  tagline: 'Build an army, storm the arena, crumble their castles',
  emoji: '🏰',
  minPlayers: 2,
  maxPlayers: 6,
  comingSoon: false,
  createHost,
  createController,
};

/* headless testing hooks — not used by the app itself */
export const __sim = { buildWorld, makeSim, stepSim, recruitGuard, setSend, setTarget, snapshot, GUARD, CASTLE_HP, TICK_MS };
