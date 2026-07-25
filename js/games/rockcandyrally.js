/* ============================================================
   Rock Candy Rally 🏁 — a side-scrolling timing race (1–6 players)

   Everyone runs FORWARD automatically. The skill is entirely in
   WHEN you press your three buttons:

     JUMP  — leave the ground. Near a candy wall, the DISTANCE you
             jump from decides how high you grab on. While climbing,
             a pulsing ring times your wall-jumps: press on the beat
             to rocket up, mash blindly and you slip. In water, JUMP
             is your paddle stroke — tap a steady rhythm to build a
             combo and surge.
     POWER — your character's signature move (see roster below).
     THROW — hurl your jawbreaker, if you're holding one. ❓ boxes on
             the track hold exactly one jawbreaker each and you can
             only carry one, so attacks can't be spammed — every
             throw has to be earned and aimed. A thrown jawbreaker
             arcs, lands, and squats on the track as a trip hazard.
             Run over one and you eat dirt for a second.

   THE ROSTER — four candies, four specialities:
     🐢 Shellsworth   downhill. POWER tucks him into his candy shell:
                      pressed right at the CREST of a hill it's a
                      "Sweet Drop!" mega-boost, on any downhill it's
                      a fast slide, on flat ground it's a sad fizzle.
     🦎 Gummy Gecko   walls. Climbs faster, slips slower, wider
                      timing windows, and POWER is a huge sticky leap
                      that only really sings on (or right before) a wall.
     🐟 Fizzy Finn    water. Swims twice as fast as anyone and POWER
                      is a fizzy torpedo dash — in the water.
     🐇 Sour Zippy    flat ground. Highest top speed; POWER is a sour
                      sprint that hits 1.5x if pressed the instant he
                      lands from a jump ("Momentum!").

   Between races, Super Off-Road style: placement pays candy coins
   (plus +1 for every PERFECT timing you land mid-race), spent on
   Speed / Jump / Power / Recovery upgrades that persist across the
   4-race series. Most championship points on the podium wins.

   Host screen = zoomed-out camera that always frames every racer,
   plus a full-track minimap. Each phone = a camera glued to its own
   racer, with the three buttons and all the timing indicators.

   Host is authoritative: 30 Hz sim, snapshots to phones at 15 Hz,
   phones interpolate between the last two snapshots. The track is
   sent once as a compact segment list and rebuilt identically on
   both ends by buildTrack().
   ============================================================ */

import { escapeHtml } from '../util.js';

/* ---------- sim timing ---------- */
const TICK = 1 / 30;               // 30 sim steps per second
const TICK_MS = 1000 / 30;
const SNAP_EVERY = 2;              // snapshot to phones every 2 ticks (15 Hz)

/* ---------- physics ---------- */
const GRAV = 2300;                 // px/s²  (y grows DOWNWARD)
const ACC = 3.2;                   // ground accel — vx eases to target at this rate
const AIR_DRAG = 0.35;
const MAX_OVER = 2.3;              // vx hard cap = top speed × this (downhills)
const BONK_STUN = 0.55;            // seconds frozen after face-planting a wall

/* ---------- walls ---------- */
const WALL_W = 26;                 // drawn thickness
const CLIMB_SLIP = 30;             // px/s you slide down while clinging
const PULSE_S = 0.9;               // wall-jump pulse period (seconds)
const HOP_PERFECT = 108;           // px gained on a perfect beat hop
const HOP_GOOD = 60;               // …on an okay hop
const HOP_MISS = 16;               // …mashing off-beat (barely beats the slip)

/* ---------- water ---------- */
const SWIM_BASE = 120;             // everyone's crawl speed
const PADDLE = 86;                 // impulse per stroke
const RHYTHM_LO = 0.34, RHYTHM_HI = 0.85;  // stroke interval that keeps a combo

/* ---------- items ---------- */
const JB_LIFE = 10;                // seconds a landed jawbreaker stays armed
const JB_R = 15;
const BOX_RESPAWN = 6;
const TRIP_T = 1.25;               // base face-plant duration

/* ---------- series ---------- */
const RACE_COUNT = 4;
const DNF_GRACE = 25;              // seconds everyone gets after the winner finishes
const PTS = [10, 8, 6, 5, 4, 3];   // championship points by place
const PAY = [8, 7, 6, 5, 4, 3];    // coins by place
const SHOP_T = 25;                 // seconds in the upgrade shop
const RESULTS_T = 7;
const COUNT_T = 3.2;               // countdown length; GO at t=0
const LVL_MAX = 5;
const COSTS = [3, 5, 8, 12, 16];   // coin cost of level 1..5 (same for every stat)

const STATS = [
  ['spd', '👟 Speed',    'Higher top speed everywhere'],
  ['jmp', '🦘 Jump',     'Jump higher — grab walls higher too'],
  ['pow', '✨ Power',    'Stronger signature move, shorter cooldown'],
  ['rec', '🩹 Recovery', 'Shake off trips and wall-bonks faster'],
];

/* ---------- the roster ----------
   top     base top speed (px/s)
   jump    base jump velocity
   swim    extra swim speed on top of SWIM_BASE
   dh      downhill acceleration multiplier while SLIDING (turtle's shtick)
   upPen   how much uphills hurt (lower = better climber on slopes too)
   hop     wall-hop height multiplier
   win     timing-window width multiplier (gecko is forgiving on walls)
   slip    cling slip multiplier
------------------------------------------------------------------ */
const CHARS = {
  shelly: { emoji: '🐢', name: 'Shellsworth', blurb: 'Downhill demon',
            desc: 'Shell-slides down hills for huge speed. Nail the crest for a Sweet Drop!',
            top: 338, jump: 745, swim: 0,  dh: 3.8, upPen: 1.0,  hop: 1.0,  win: 1.0, slip: 1.0 },
  gecko:  { emoji: '🦎', name: 'Gummy Gecko', blurb: 'Wall wizard',
            desc: 'Climbs faster, slips slower, forgiving wall timing, sticky mega-leap.',
            top: 336, jump: 765, swim: 0,  dh: 1.0, upPen: 0.45,  hop: 1.5,  win: 1.45, slip: 0.4 },
  finn:   { emoji: '🐟', name: 'Fizzy Finn', blurb: 'Aqua ace',
            desc: 'Swims twice as fast and torpedo-dashes through the pools.',
            top: 332, jump: 745, swim: 132, dh: 1.0, upPen: 1.0,  hop: 1.0,  win: 1.0, slip: 1.0 },
  zippy:  { emoji: '🐇', name: 'Sour Zippy', blurb: 'Flat-out fastest',
            desc: 'Top speed king. Sour Sprint hits 1.5x pressed the instant he lands.',
            top: 346, jump: 752, swim: 0,  dh: 1.0, upPen: 1.45, hop: 1.0,  win: 1.0, slip: 1.0 },
};
const CHAR_IDS = Object.keys(CHARS);

/* racer state codes (compact for snapshots) */
const ST = { RUN: 0, AIR: 1, CLIMB: 2, SWIM: 3, SLIDE: 4, TRIP: 5, DONE: 6, BONK: 7, STALL: 8 };

/* ============================================================
   TRACK
   ------------------------------------------------------------
   A track is a list of segments; buildTrack() turns it into a
   sampled heightfield plus wall / water / box / crest records.
   The HOST invents the segment list (makeSegs) and sends it to
   the phones, and both sides call buildTrack(segs) so they end
   up with byte-identical geometry — no heightfield on the wire.

   World y grows DOWNWARD (canvas convention). "Up a hill" means
   the ground y DECREASES.
   ============================================================ */
const CELL = 8;                    // heightfield sample spacing

function makeSegs() {
  const R = (a, b) => a + Math.random() * (b - a);
  const RI = (a, b) => Math.round(R(a, b));
  const segs = [];
  const flat = (a, b) => segs.push({ t: 'flat', len: RI(a, b) });
  const hill = (h) => {           // an up-and-over: climb, crest, big descent
    segs.push({ t: 'up',   len: RI(420, 560), h });
    segs.push({ t: 'down', len: RI(640, 880), h: h + RI(40, 120) });
  };

  flat(700, 900);                                    // starting straight
  hill(RI(170, 230));
  flat(560, 740);
  segs.push({ t: 'wall', h: RI(210, 260) });         // first blockade
  flat(480, 640);
  segs.push({ t: 'water', len: RI(700, 920), depth: RI(90, 120) });
  flat(560, 740);
  hill(RI(210, 270));
  flat(440, 600);
  segs.push({ t: 'wall', h: RI(240, 300) });
  flat(420, 560);
  segs.push({ t: 'water', len: RI(820, 1060), depth: RI(100, 130) });
  flat(480, 640);
  hill(RI(240, 300));                                // final big descent
  flat(680, 880);                                    // run to the flag
  return segs;
}

/* smooth cosine ramp 0→1 */
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

function buildTrack(segs) {
  const H = [];                    // heightfield, y per CELL
  const walls = [];                // { x, baseY, topY }
  const waters = [];               // { x0, x1, surf, floor }
  const crests = [];               // { x } — tops of hills (up→down joints)
  const boxes = [];                // { x } — ❓ item boxes
  let x = 0, y = 0;                // running elevation (y-down)
  const push = (yy) => H.push(yy);
  push(y);

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.t === 'flat') {
      const n = Math.round(s.len / CELL);
      for (let k = 1; k <= n; k++) push(y);
      if (s.len >= 420) boxes.push({ x: x + s.len / 2 });
      x += n * CELL;
    } else if (s.t === 'up' || s.t === 'down') {
      const n = Math.round(s.len / CELL);
      const y0 = y, y1 = y + (s.t === 'up' ? -s.h : s.h);
      for (let k = 1; k <= n; k++) push(y0 + (y1 - y0) * ease(k / n));
      y = y1; x += n * CELL;
      if (s.t === 'up' && segs[i + 1] && segs[i + 1].t === 'down') crests.push({ x });
    } else if (s.t === 'wall') {
      /* the ground steps UP by s.h across one cell — a sheer face */
      walls.push({ x: x + CELL / 2, baseY: y, topY: y - s.h });
      y -= s.h;
      push(y); x += CELL;
    } else if (s.t === 'water') {
      /* dig a basin: ramp down, pool floor, ramp back up. The water
         surface sits a little below the entry lip so you plunge in. */
      const rampN = Math.round(120 / CELL);
      const n = Math.round(s.len / CELL);
      const floorY = y + s.depth;
      const surf = y + 26;
      for (let k = 1; k <= n; k++) {
        let yy;
        if (k <= rampN) yy = y + (floorY - y) * ease(k / rampN);
        else if (k >= n - rampN) yy = floorY + (y - floorY) * ease((k - (n - rampN)) / rampN);
        else yy = floorY;
        push(yy);
      }
      waters.push({ x0: x + 8, x1: x + n * CELL - rampN * CELL * 0.35, surf, floor: floorY });
      x += n * CELL;
    }
  }
  const len = x;
  const finishX = len - 160;
  return { segs, H, walls, waters, crests, boxes, len, finishX };
}

/* ground y at world x (lerped) */
function groundY(trk, x) {
  const f = Math.min(Math.max(x / CELL, 0), trk.H.length - 1.001);
  const i = Math.floor(f), u = f - i;
  return trk.H[i] * (1 - u) + trk.H[i + 1] * u;
}
/* slope, sampled wide enough to smooth the cells. >0 means DOWNHILL
   (ground y increasing as you run right) */
function slopeAt(trk, x) {
  const d = 26;
  return (groundY(trk, x + d) - groundY(trk, x - d)) / (2 * d);
}
function waterAt(trk, x) {
  for (const w of trk.waters) if (x >= w.x0 && x <= w.x1) return w;
  return null;
}
function nextWall(trk, x) {
  for (const w of trk.walls) if (w.x > x - WALL_W) return w;
  return null;
}
function nearestCrestBehind(trk, x) {
  let best = null;
  for (const c of trk.crests) if (c.x <= x + 45 && (!best || c.x > best.x)) best = c;
  return best;
}

/* ============================================================
   SIMULATION (host-side, authoritative)
   ============================================================ */
function makeSim() {
  return {
    tick: 0,
    phase: 'pick',                 // pick | count | race | results | shop | podium
    phaseT: 0,                     // seconds left in timed phases
    race: 0,                       // 1-based race number once racing
    trk: null,
    racers: new Map(),             // playerId -> racer
    order: [],                     // playerIds, seat order
    jbs: [],                       // jawbreakers {x,y,vx,vy,fly,restT,owner,ownT}
    boxT: [],                      // per-box respawn timers (0 = alive)
    ev: [],                        // floater events drained into each snapshot
    goAt: 0,                       // tick of GO during countdown
    firstFinT: null,               // seconds since GO when the winner crossed
    raceT: 0,                      // seconds since GO
    placeNext: 1,
  };
}

function addRacer(sim, p, seat) {
  sim.racers.set(p.id, {
    id: p.id, seat, name: p.name, color: p.color, avatar: p.avatar,
    hero: null, picked: false,
    x: 0, y: 0, vx: 0, vy: 0, st: ST.RUN, face: 1,
    stunT: 0, slideT: 0, boostV: 0, boostT: 0, powerCd: 0,
    item: 0, lastStroke: -9, combo: 0, landedAt: -9,
    wallRef: null, grabQual: 0,
    startPress: null, stalled: false,
    coins: 0, bonus: 0, pts: 0, lvl: { spd: 0, jmp: 0, pow: 0, rec: 0 },
    finished: false, finT: 0, place: 0, shopDone: false,
    connected: true,
  });
  sim.order.push(p.id);
}

/* ---------- derived stats ---------- */
const topOf   = (r) => CHARS[r.hero].top  * (1 + 0.05 * r.lvl.spd);
const jumpOf  = (r) => CHARS[r.hero].jump * (1 + 0.05 * r.lvl.jmp);
const powMul  = (r) => 1 + 0.10 * r.lvl.pow;
const powCdOf = (r) => 4.0 * (1 - 0.06 * r.lvl.pow);
const recMul  = (r) => 1 - 0.12 * r.lvl.rec;

function pop(sim, r, txt, good) {
  sim.ev.push({ s: r.seat, x: Math.round(r.x), y: Math.round(r.y - 70), t: txt, c: good ? 1 : 0 });
}
function perfect(sim, r, txt) {
  r.bonus += 1; r.coins += 1;
  pop(sim, r, txt + ' +1🪙', true);
}

/* ---------- race setup ---------- */
function startCountdown(sim) {
  sim.trk = buildTrack(makeSegs());
  sim.boxT = sim.trk.boxes.map(() => 0);
  sim.jbs = [];
  sim.phase = 'count';
  sim.phaseT = COUNT_T;
  sim.goAt = sim.tick + Math.round(COUNT_T / TICK);
  sim.firstFinT = null; sim.raceT = 0; sim.placeNext = 1;
  let lane = 0;
  for (const id of sim.order) {
    const r = sim.racers.get(id);
    if (!r.hero) continue;
    r.x = 60 + lane * 34; lane++;
    r.y = groundY(sim.trk, r.x);
    r.vx = 0; r.vy = 0; r.st = ST.RUN; r.face = 1;
    r.stunT = 0; r.slideT = 0; r.boostV = 0; r.boostT = 0; r.powerCd = 0;
    r.item = 0; r.combo = 0; r.lastStroke = -9; r.landedAt = -9;
    r.wallRef = null; r.startPress = null; r.stalled = false;
    r.finished = false; r.finT = 0; r.place = 0; r.bonus = 0; r.shopDone = false;
  }
}

/* ---------- inputs (called from onMessage) ---------- */
function inJump(sim, r) {
  const now = sim.tick * TICK;
  if (sim.phase === 'count') { r.startPress = now - sim.goAt * TICK; return; }
  if (sim.phase !== 'race' || r.finished) return;

  /* pressing just AFTER the flag still counts as a rocket start */
  if (sim.raceT < 0.28 && r.st === ST.RUN && r.vx < 60 && !r.stalled) {
    r.vx = 330; perfect(sim, r, 'ROCKET START!'); return;
  }

  if (r.st === ST.RUN || r.st === ST.SLIDE) {
    /* near a wall? A jump from the sweet band is a HIGH grab. */
    r.st = ST.AIR;
    r.vy = -jumpOf(r);
    r.vx = Math.max(r.vx, 70);            // even from a standstill you drift into the wall
    const w = nextWall(sim.trk, r.x);
    if (w && w.x - r.x > 30 && w.x - r.x < 210) {
      const mid = 120;                       // ideal launch distance
      const q = Math.max(0, 1 - Math.abs((w.x - r.x) - mid) / 95);
      r.grabQual = q;                        // cashed in on contact
      if (q > 0.8) perfect(sim, r, 'PERFECT LEAP!');
    } else r.grabQual = 0;
  } else if (r.st === ST.CLIMB) {
    /* the pulse: press as the ring closes. phase 0 = the beat. */
    const ph = ((sim.tick * TICK) % PULSE_S) / PULSE_S;       // 0..1
    const err = Math.min(ph, 1 - ph);                          // distance to beat
    const win = CHARS[r.hero].win;
    const hop = CHARS[r.hero].hop * (1 + 0.04 * r.lvl.jmp);
    if (err < 0.11 * win)      { r.y -= HOP_PERFECT * hop; perfect(sim, r, 'ON BEAT!'); }
    else if (err < 0.26 * win) { r.y -= HOP_GOOD * hop; }
    else                       { r.y -= HOP_MISS; pop(sim, r, 'slip!', false); }
    if (r.y <= r.wallRef.topY + 4) vault(sim, r);
  } else if (r.st === ST.SWIM) {
    /* paddle stroke — rhythm builds a combo */
    const dt = now - r.lastStroke;
    r.lastStroke = now;
    if (dt >= RHYTHM_LO && dt <= RHYTHM_HI) {
      r.combo = Math.min(8, r.combo + 1);
      if (r.combo === 4) perfect(sim, r, 'IN RHYTHM!');
    } else r.combo = 1;
    const finny = r.hero === 'finn' ? 1.3 : 1;
    r.vx += PADDLE * (1 + 0.13 * r.combo) * finny;
  }
}

function vault(sim, r) {
  r.st = ST.AIR;
  r.y = r.wallRef.topY - 6;
  r.x = r.wallRef.x + WALL_W;
  r.vy = -320;
  r.vx = Math.max(r.vx, 140) + 130;
  r.wallRef = null;
  pop(sim, r, 'OVER!', true);
}

function inPower(sim, r) {
  if (sim.phase !== 'race' || r.finished || r.powerCd > 0) return;
  const trk = sim.trk, now = sim.tick * TICK, pm = powMul(r);
  const fire = () => { r.powerCd = powCdOf(r); };

  if (r.hero === 'shelly') {
    const s = slopeAt(trk, r.x);
    if (r.st === ST.RUN || r.st === ST.AIR || r.st === ST.SLIDE) {
      const crest = nearestCrestBehind(trk, r.x);
      if (crest && r.x - crest.x < 120 && s > 0.04) {
        r.st = ST.SLIDE; r.slideT = 0; r.vx += 350 * pm;
        perfect(sim, r, 'SWEET DROP!'); fire();
      } else if (s > 0.05) {
        r.st = ST.SLIDE; r.slideT = 0; r.vx += 70 * pm;
        pop(sim, r, 'shell slide!', true); fire();
      } else {
        r.vx *= 0.82; pop(sim, r, 'fizzle…', false); r.powerCd = 1.3;
      }
    }
  } else if (r.hero === 'gecko') {
    if (r.st === ST.CLIMB) {
      r.y -= HOP_PERFECT * 1.9 * pm;
      pop(sim, r, 'STICKY LEAP!', true); fire();
      if (r.y <= r.wallRef.topY + 4) vault(sim, r);
    } else {
      const w = nextWall(trk, r.x);
      if (w && w.x - r.x > 0 && w.x - r.x < 260 && (r.st === ST.RUN || r.st === ST.AIR)) {
        r.st = ST.AIR; r.vy = -jumpOf(r) * 0.9; r.vx += 120;
        r.grabQual = 1.15 * pm;              // guaranteed high grab
        pop(sim, r, 'STICKY LEAP!', true); fire();
      } else { r.vy = Math.min(r.vy, -260); r.st = ST.AIR; r.powerCd = 1.3; pop(sim, r, 'hop', false); }
    }
  } else if (r.hero === 'finn') {
    if (r.st === ST.SWIM) {
      r.vx += 360 * pm; r.combo = Math.max(r.combo, 3);
      pop(sim, r, 'TORPEDO!', true); fire();
    } else { r.vx += 55; r.powerCd = 1.3; pop(sim, r, 'fizz…', false); }
  } else if (r.hero === 'zippy') {
    const s = slopeAt(trk, r.x);
    if (r.st === ST.RUN && s > -0.06) {
      const moment = now - r.landedAt < 0.16;
      r.boostV = 250 * pm * (moment ? 1.5 : 1);
      r.boostT = 1.5;
      if (moment) perfect(sim, r, 'MOMENTUM!');
      else pop(sim, r, 'SOUR SPRINT!', true);
      fire();
    } else { r.powerCd = 1.0; pop(sim, r, 'no footing…', false); }
  }
}

function inThrow(sim, r) {
  if (sim.phase !== 'race' || r.finished || !r.item) return;
  if (r.st === ST.TRIP || r.st === ST.CLIMB) return;
  r.item = 0;
  sim.jbs.push({
    x: r.x + 24, y: r.y - 46,
    vx: r.vx + 400, vy: -330,
    fly: true, restT: 0, owner: r.id, ownT: sim.tick * TICK,
  });
  pop(sim, r, 'JAWBREAKER!', true);
}

/* ---------- per-tick physics ---------- */
function stepRacer(sim, r) {
  const trk = sim.trk, now = sim.tick * TICK;
  if (!r.hero || r.finished) return;
  if (r.powerCd > 0) r.powerCd -= TICK;
  if (r.boostT > 0) { r.boostT -= TICK; if (r.boostT <= 0) r.boostV = 0; }

  /* stunned states just tick down */
  if (r.st === ST.TRIP || r.st === ST.BONK || r.st === ST.STALL) {
    r.stunT -= TICK;
    r.vx *= Math.pow(0.02, TICK);
    if (r.stunT <= 0) r.st = ST.RUN;
    r.y = groundY(trk, r.x);
    return;
  }

  if (r.st === ST.CLIMB) {
    r.y += CLIMB_SLIP * CHARS[r.hero].slip * TICK;      // constant slither down
    if (r.y > r.wallRef.baseY - 8) {                     // slid off the bottom
      r.st = ST.RUN; r.y = r.wallRef.baseY; r.x = r.wallRef.x - WALL_W - 2; r.wallRef = null;
    }
    return;
  }

  const w = waterAt(trk, r.x);
  const gY = groundY(trk, r.x);

  /* enter water */
  if (w && r.st !== ST.SWIM && r.y >= w.surf - 8 && gY > w.surf + 10) {
    r.st = ST.SWIM; r.vy = 0; r.combo = 0; r.lastStroke = -9;
    r.vx = Math.min(r.vx, SWIM_BASE + CHARS[r.hero].swim + 60);
    pop(sim, r, 'splash!', true);
  }

  if (r.st === ST.SWIM) {
    const target = SWIM_BASE + CHARS[r.hero].swim + 13 * r.combo;
    r.vx += (target - r.vx) * Math.min(1, TICK * 1.6);
    r.x += r.vx * TICK;
    const ww = waterAt(trk, r.x);
    const surf = ww ? ww.surf : (w ? w.surf : gY);
    r.y += (surf + Math.sin(now * 5 + r.seat) * 4 - r.y) * Math.min(1, TICK * 8);
    if (r.combo > 0 && now - r.lastStroke > RHYTHM_HI + 0.15) r.combo = 0;
    if (!ww || groundY(trk, r.x) <= surf + 6) {          // waded out
      r.st = ST.RUN; r.y = groundY(trk, r.x); r.combo = 0;
    }
  } else if (r.st === ST.AIR) {
    r.vy += GRAV * TICK;
    r.vx += (0 - Math.max(0, r.vx - topOf(r) * 1.4)) * AIR_DRAG * TICK;
    r.x += r.vx * TICK; r.y += r.vy * TICK;
    if (r.y >= groundY(trk, r.x)) {                      // touchdown
      r.y = groundY(trk, r.x);
      r.st = ST.RUN; r.landedAt = now;
      if (r.vy > 1250) { r.vx *= 0.7; }                  // heavy landing scrubs speed
      r.vy = 0;
    }
  } else {                                               // RUN or SLIDE on the ground
    const s = slopeAt(trk, r.x);
    const ch = CHARS[r.hero];
    let target = topOf(r) * (1 + Math.min(0, s) * 1.5 * ch.upPen);
    target = Math.max(target, topOf(r) * 0.32) + r.boostV;

    if (r.st === ST.SLIDE) {
      r.slideT += TICK;
      if (s > 0.02) r.vx += s * 1500 * ch.dh * powMul(r) * TICK;   // gravity assist
      else r.vx += (target - r.vx) * Math.min(1, TICK * 0.35);      // coast, keep speed
      if (r.slideT > 0.45 && s < 0.02) { r.st = ST.RUN; pop(sim, r, 'pop!', true); }
    } else {
      if (r.vx > target) r.vx += (target - r.vx) * Math.min(1, TICK * 1.15);
      else r.vx += (target - r.vx) * Math.min(1, TICK * ACC);
      if (s > 0.03) r.vx += s * 1500 * 0.45 * TICK;                 // everyone rolls downhill a bit
    }
    r.vx = Math.min(r.vx, topOf(r) * MAX_OVER);
    r.x += r.vx * TICK;
    r.y = groundY(trk, r.x);
  }

  /* ---- walls: grab or bonk ---- */
  const nw = nextWall(trk, r.x + 1);
  if (nw && r.x >= nw.x - WALL_W - 10 && r.x <= nw.x + WALL_W && r.y > nw.topY + 8 && r.st !== ST.SWIM) {
    if (r.st === ST.AIR) {
      /* grab on! Higher if the launch distance was sweet. */
      r.wallRef = nw;
      r.st = ST.CLIMB;
      r.x = nw.x - WALL_W;
      const bonusUp = 95 * (r.grabQual || 0) * CHARS[r.hero].hop;
      r.y = Math.min(r.y, nw.baseY - 10) - bonusUp;
      r.grabQual = 0;
      if (r.y <= nw.topY + 4) vault(sim, r);
    } else {
      /* ran face-first into candy brick */
      r.x = nw.x - WALL_W - 1;
      r.vx = 0; r.st = ST.BONK; r.stunT = BONK_STUN * recMul(r);
      pop(sim, r, 'BONK!', false);
    }
  }

  /* ---- item boxes ---- */
  for (let i = 0; i < trk.boxes.length; i++) {
    if (sim.boxT[i] > 0) continue;
    const b = trk.boxes[i];
    if (Math.abs(r.x - b.x) < 26 && r.y > groundY(trk, b.x) - 78 && !r.item) {
      r.item = 1; sim.boxT[i] = BOX_RESPAWN;
      pop(sim, r, '❓ jawbreaker!', true);
    }
  }

  /* ---- finish line ---- */
  if (r.x >= trk.finishX) {
    r.finished = true; r.st = ST.DONE;
    r.finT = sim.raceT; r.place = sim.placeNext++;
    r.pts += PTS[r.place - 1] || 2;
    r.coins += PAY[r.place - 1] || 2;
    if (sim.firstFinT === null) sim.firstFinT = sim.raceT;
    pop(sim, r, ['🥇','🥈','🥉'][r.place - 1] || `#${r.place}`, true);
  }
}

function stepJbs(sim) {
  const trk = sim.trk;
  for (const j of sim.jbs) {
    if (j.fly) {
      j.vy += GRAV * TICK;
      j.x += j.vx * TICK; j.y += j.vy * TICK;
      const w = nextWall(trk, j.x - WALL_W);
      if (w && j.x >= w.x - WALL_W && j.y > w.topY) { j.x = w.x - WALL_W - 2; j.vx *= -0.3; }
      const g = groundY(trk, j.x);
      if (j.y >= g - JB_R) {
        j.y = g - JB_R;
        if (Math.abs(j.vy) > 140) { j.vy *= -0.35; j.vx *= 0.7; }   // bounce
        else { j.fly = false; j.restT = JB_LIFE; }                   // settle → armed
      }
    } else {
      j.restT -= TICK;
    }
    /* trip anyone who touches it */
    for (const r of sim.racers.values()) {
      if (!r.hero || r.finished || r.st === ST.TRIP || r.st === ST.CLIMB) continue;
      if (r.id === j.owner && sim.tick * TICK - j.ownT < 1.0) continue;
      if (Math.abs(r.x - j.x) < JB_R + 14 && Math.abs((r.y - 26) - j.y) < 46) {
        r.st = ST.TRIP; r.stunT = TRIP_T * recMul(r); r.vx *= 0.15; r.slideT = 0;
        j.restT = -1; j.fly = false;
        pop(sim, r, 'TRIPPED!', false);
        const owner = sim.racers.get(j.owner);
        if (owner && owner.id !== r.id) pop(sim, owner, 'gottem!', true);
        break;
      }
    }
  }
  sim.jbs = sim.jbs.filter((j) => j.fly || j.restT > 0);
}

function stepSim(sim) {
  sim.tick++;
  if (sim.phase === 'count') {
    sim.phaseT -= TICK;
    if (sim.phaseT <= 0) {
      sim.phase = 'race';
      /* settle start presses: early = stall, on-GO = boost */
      for (const r of sim.racers.values()) {
        if (!r.hero) continue;
        if (r.startPress !== null) {
          if (r.startPress < -0.09) { r.st = ST.STALL; r.stunT = 0.8; r.stalled = true; pop(sim, r, 'too soon!', false); }
          else if (r.startPress <= 0.30) { r.vx = 330; perfect(sim, r, 'ROCKET START!'); }
        }
      }
    }
  } else if (sim.phase === 'race') {
    sim.raceT += TICK;
    for (const id of sim.order) stepRacer(sim, sim.racers.get(id));
    stepJbs(sim);
    for (let i = 0; i < sim.boxT.length; i++) if (sim.boxT[i] > 0) sim.boxT[i] -= TICK;

    const live = [...sim.racers.values()].filter((r) => r.hero && r.connected);
    const allDone = live.length > 0 && live.every((r) => r.finished);
    const timedOut = sim.firstFinT !== null && sim.raceT - sim.firstFinT > DNF_GRACE;
    if (allDone || timedOut) {
      /* rank the stragglers by distance */
      const dnf = live.filter((r) => !r.finished).sort((a, b) => b.x - a.x);
      for (const r of dnf) {
        r.finished = true; r.st = ST.DONE; r.finT = -1;
        r.place = sim.placeNext++;
        r.pts += PTS[r.place - 1] || 2;
        r.coins += PAY[r.place - 1] || 2;
      }
      sim.phase = 'results'; sim.phaseT = RESULTS_T;
    }
  } else if (sim.phase === 'results') {
    sim.phaseT -= TICK;
    if (sim.phaseT <= 0) {
      if (sim.race >= RACE_COUNT) sim.phase = 'podium';
      else { sim.phase = 'shop'; sim.phaseT = SHOP_T; }
    }
  } else if (sim.phase === 'shop') {
    sim.phaseT -= TICK;
    const live = [...sim.racers.values()].filter((r) => r.hero && r.connected);
    if (sim.phaseT <= 0 || (live.length && live.every((r) => r.shopDone))) {
      sim.race++;
      startCountdown(sim);
    }
  }
}

/* ---------- snapshot for the wire ---------- */
function snapshot(sim) {
  const p = [];
  for (const id of sim.order) {
    const r = sim.racers.get(id);
    if (!r.hero) continue;
    p.push([r.seat, Math.round(r.x), Math.round(r.y), r.st,
            r.item, Math.max(0, Math.ceil(r.powerCd * 10)), r.combo,
            r.place, r.hero, r.finished ? 1 : 0]);
  }
  const jb = sim.jbs.map((j) => [Math.round(j.x), Math.round(j.y), j.fly ? 1 : 0]);
  const bx = sim.boxT.map((t) => (t <= 0 ? 1 : 0));
  const snap = { k: 'snap', t: sim.tick, ph: sim.phase, p, jb, bx, ev: sim.ev, rt: Math.round(sim.raceT * 10) / 10 };
  if (sim.phase === 'count') snap.cd = Math.max(0, Math.round(sim.phaseT * 10) / 10);
  if (sim.firstFinT !== null && sim.phase === 'race') {
    snap.dnf = Math.max(0, Math.round((DNF_GRACE - (sim.raceT - sim.firstFinT)) * 10) / 10);
  }
  sim.ev = [];
  return snap;
}

/* ============================================================
   SHARED RENDERER — one scene painter for both screens.
   cam = { x, y, z }  (world point at canvas centre, zoom)
   snap = latest interpolated state: { p:[...], jb, bx, tick }
   ============================================================ */
const STATE_EMOJI_SPIN = new Set([ST.SLIDE]);

function w2s(cam, W, H, x, y) {
  return [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2];
}

function drawScene(g, W, H, cam, trk, view, opts) {
  const z = cam.z;
  const x0 = cam.x - W / 2 / z - 60, x1 = cam.x + W / 2 / z + 60;

  /* sky */
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#ffe3f1'); sky.addColorStop(0.55, '#ffd1e8'); sky.addColorStop(1, '#ffeef7');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  /* parallax gumdrop hills */
  g.save();
  for (const [par, col, hh] of [[0.25, '#f7bfe0', 210], [0.45, '#f3a9d4', 150]]) {
    g.fillStyle = col;
    const off = cam.x * par;
    for (let i = -1; i < 8; i++) {
      const hx = ((i * 560 - off) % (560 * 8) + 560 * 8) % (560 * 8) - 560;
      const base = H * 0.78;
      g.beginPath();
      g.ellipse(hx, base, 300, hh * (0.7 + (i % 3) * 0.2), 0, Math.PI, 0);
      g.fill();
    }
  }
  g.restore();

  /* terrain silhouette */
  g.beginPath();
  let started = false;
  for (let x = Math.max(0, x0); x <= Math.min(trk.len, x1); x += CELL) {
    const [sx, sy] = w2s(cam, W, H, x, groundY(trk, x));
    if (!started) { g.moveTo(sx, sy); started = true; } else g.lineTo(sx, sy);
  }
  if (started) {
    g.lineTo(w2s(cam, W, H, Math.min(trk.len, x1), 0)[0], H + 40);
    g.lineTo(w2s(cam, W, H, Math.max(0, x0), 0)[0], H + 40);
    g.closePath();
    const dirt = g.createLinearGradient(0, H * 0.3, 0, H);
    dirt.addColorStop(0, '#b97a4e'); dirt.addColorStop(1, '#8a5433');
    g.fillStyle = dirt; g.fill();
    /* frosting lip */
    g.strokeStyle = '#7fd97f'; g.lineWidth = Math.max(3, 6 * z); g.stroke();
  }

  /* water pools */
  for (const w of trk.waters) {
    if (w.x1 < x0 || w.x0 > x1) continue;
    const [ax, ay] = w2s(cam, W, H, w.x0, w.surf);
    const [bx2] = w2s(cam, W, H, w.x1, w.surf);
    const [, fy] = w2s(cam, W, H, w.x0, w.floor + 60);
    g.fillStyle = 'rgba(80,170,255,0.55)';
    g.fillRect(ax, ay, bx2 - ax, Math.max(4, fy - ay));
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = Math.max(2, 3 * z);
    g.beginPath();
    const t = (view.tick || 0) * TICK;
    for (let sx = ax; sx <= bx2; sx += 8) {
      const wy = ay + Math.sin(sx * 0.05 + t * 4) * 3 * z;
      sx === ax ? g.moveTo(sx, wy) : g.lineTo(sx, wy);
    }
    g.stroke();
  }

  /* walls — striped candy brick columns */
  for (const w of trk.walls) {
    if (w.x < x0 - 60 || w.x > x1 + 60) continue;
    const [sx, ty] = w2s(cam, W, H, w.x, w.topY);
    const [, by] = w2s(cam, W, H, w.x, w.baseY);
    const ww = Math.max(8, WALL_W * 2 * z);
    g.fillStyle = '#e05c7a';
    g.fillRect(sx - ww / 2, ty, ww, by - ty + 6);
    g.fillStyle = '#ffffff55';
    for (let yy = ty; yy < by; yy += Math.max(8, 22 * z)) g.fillRect(sx - ww / 2, yy, ww, Math.max(3, 8 * z));
    g.fillStyle = '#c9385c';
    g.fillRect(sx - ww / 2 - 2 * z, ty - 6 * z, ww + 4 * z, 8 * z);
    /* pulse ring at the grab face — same clock on every screen */
    const ph = ((view.tick || 0) * TICK % PULSE_S) / PULSE_S;
    const rr = (1 - ph) * 34 * z + 6;
    g.strokeStyle = ph < 0.14 ? '#ffd93d' : '#ffffffaa';
    g.lineWidth = ph < 0.14 ? 5 : 2.5;
    g.beginPath(); g.arc(sx - ww / 2 - 10 * z, (ty + by) / 2, rr, 0, Math.PI * 2); g.stroke();
  }

  /* crest markers — a little "drop in here!" chevron for shell timing */
  for (const c of trk.crests) {
    if (c.x < x0 || c.x > x1) continue;
    const [sx, sy] = w2s(cam, W, H, c.x + 30, groundY(trk, c.x + 30) - 46);
    g.font = `${Math.max(12, 22 * z)}px sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = '#ffffffcc';
    g.fillText('⤵', sx, sy);
  }

  /* finish flag */
  {
    const fx = trk.finishX;
    if (fx > x0 && fx < x1) {
      const [sx, sy] = w2s(cam, W, H, fx, groundY(trk, fx));
      g.strokeStyle = '#5a3a28'; g.lineWidth = Math.max(3, 5 * z);
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 120 * z); g.stroke();
      const fw = 46 * z, fh = 30 * z, fy0 = sy - 120 * z;
      for (let i = 0; i < 4; i++) for (let jj = 0; jj < 3; jj++) {
        g.fillStyle = (i + jj) % 2 ? '#222' : '#fff';
        g.fillRect(sx + i * fw / 4, fy0 + jj * fh / 3, fw / 4, fh / 3);
      }
    }
  }

  /* item boxes */
  const spin = ((view.tick || 0) * TICK * 2) % (Math.PI * 2);
  trk.boxes.forEach((b, i) => {
    if (b.x < x0 || b.x > x1) return;
    if (view.bx && !view.bx[i]) return;
    const [sx, sy] = w2s(cam, W, H, b.x, groundY(trk, b.x) - 58);
    const s = 22 * z;
    g.save(); g.translate(sx, sy + Math.sin(spin + i) * 5 * z); g.rotate(Math.sin(spin) * 0.15);
    g.fillStyle = '#ffb84d'; g.strokeStyle = '#b3751f'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(-s, -s, s * 2, s * 2, 6 * z); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = `bold ${Math.max(10, 26 * z)}px Fredoka, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('?', 0, 2);
    g.restore();
  });

  /* jawbreakers */
  if (view.jb) for (const [jx, jy] of view.jb) {
    if (jx < x0 || jx > x1) continue;
    const [sx, sy] = w2s(cam, W, H, jx, jy);
    const rr = JB_R * z;
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(sx, sy, rr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#e05c7a'; g.lineWidth = Math.max(1.5, 3 * z);
    g.beginPath(); g.arc(sx, sy, rr * 0.62, 0.4, Math.PI * 1.5); g.stroke();
    g.strokeStyle = '#4dabf7';
    g.beginPath(); g.arc(sx, sy, rr * 0.35, 2.5, Math.PI * 2.2); g.stroke();
  }

  /* racers */
  if (view.p) for (const pr of view.p) {
    const [seat, px, py, st] = pr;
    const meta = opts.seatMeta[seat];
    if (!meta) continue;
    const [sx, sy] = w2s(cam, W, H, px, py);
    const scale = Math.max(0.45, z);
    g.save();
    g.translate(sx, sy);
    if (st === ST.TRIP || st === ST.BONK) g.rotate(Math.PI / 2 * 0.85);
    if (st === ST.SLIDE) g.rotate(((view.tick || 0) * 0.5) % (Math.PI * 2));
    /* body capsule in seat colour */
    g.fillStyle = meta.color;
    g.beginPath(); g.ellipse(0, -26 * scale, 20 * scale, 26 * scale, 0, 0, Math.PI * 2); g.fill();
    g.font = `${34 * scale}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(CHARS[pr[8]] ? CHARS[pr[8]].emoji : '🍬', 0, -28 * scale);
    if (st === ST.TRIP) g.fillText('💫', 0, -62 * scale);
    if (st === ST.CLIMB) g.fillText('🧗', 22 * scale, -52 * scale);
    if (pr[4]) { g.font = `${20 * scale}px sans-serif`; g.fillText('⚪', 24 * scale, -8 * scale); }
    g.restore();
    /* name tag */
    if (opts.names) {
      g.font = `600 ${Math.max(10, 13 * Math.min(1, z * 2))}px Fredoka, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = '#00000055';
      g.fillText(meta.name, sx + 1, sy - 62 * scale + 1);
      g.fillStyle = meta.color;
      g.fillText(meta.name, sx, sy - 62 * scale);
    }
  }

  /* floaters */
  for (const f of opts.floaters) {
    const age = (opts.now - f.at) / 1000;
    if (age > 1.2) continue;
    const [sx, sy] = w2s(cam, W, H, f.x, f.y);
    g.globalAlpha = Math.max(0, 1 - age / 1.2);
    g.font = `700 ${Math.max(12, 18 * Math.min(1.2, z * 2))}px Fredoka, sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = f.c ? '#2fbf5f' : '#e0455c';
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.strokeText(f.t, sx, sy - age * 44);
    g.fillText(f.t, sx, sy - age * 44);
    g.globalAlpha = 1;
  }
}

/* linear interpolation between two snapshots at blend u */
function lerpSnap(a, b, u) {
  if (!a) return b;
  const byId = new Map(a.p.map((e) => [e[0], e]));
  const p = b.p.map((e) => {
    const o = byId.get(e[0]);
    if (!o) return e;
    const out = e.slice();
    out[1] = o[1] + (e[1] - o[1]) * u;
    out[2] = o[2] + (e[2] - o[2]) * u;
    return out;
  });
  const jb = b.jb.map((e, i) => {
    const o = a.jb[i];
    if (!o) return e;
    return [o[0] + (e[0] - o[0]) * u, o[1] + (e[1] - o[1]) * u, e[2]];
  });
  return { ...b, p, jb, tick: a.t + (b.t - a.t) * u };
}

/* ============================================================
   HOST (big screen)
   ============================================================ */
const HOST_HTML = `
<div class="rr-host">
  <canvas class="rr-stage"></canvas>

  <div class="rr-topbar">
    <span class="rr-race-no"></span>
    <canvas class="rr-minimap" width="900" height="46"></canvas>
    <span class="rr-clock"></span>
  </div>

  <div class="rr-standings"></div>

  <div class="rr-overlay rr-pick-ov">
    <h1>🏁 Rock Candy Rally</h1>
    <p class="rr-sub">Pick your racer on your phone — the skill is all in the timing!</p>
    <div class="rr-pick-grid"></div>
    <button class="rr-btn rr-forcestart hidden">Start the race!</button>
  </div>

  <div class="rr-overlay rr-count-ov hidden">
    <div class="rr-count-num">3</div>
    <p class="rr-sub">Press JUMP right on GO for a rocket start — jump early and you stall!</p>
  </div>

  <div class="rr-overlay rr-results-ov hidden">
    <h2 class="rr-res-title">Race results</h2>
    <div class="rr-res-rows"></div>
  </div>

  <div class="rr-overlay rr-shop-ov hidden">
    <h2>🛠️ Pit stop — spend your candy coins!</h2>
    <p class="rr-sub">Upgrade on your phones: Speed · Jump · Power · Recovery</p>
    <div class="rr-shop-status"></div>
    <div class="rr-shop-clock"></div>
  </div>

  <div class="rr-overlay rr-podium-ov hidden">
    <h1>🏆 Championship podium</h1>
    <div class="rr-podium-rows"></div>
    <button class="rr-btn rr-again">Play again</button>
  </div>
</div>`;

function createHost(ctx) {
  const sim = makeSim();
  let raf = 0, tickTimer = 0, snapCount = 0;
  let canvas, g, mini, mg;
  let floaters = [];
  const seatMeta = {};                 // seat -> {name, color, avatar}
  let lastView = null, prevSnapH = null, curSnapH = null, snapAtH = 0;

  const $q = (s) => ctx.root.querySelector(s);
  const seatOf = (id) => { const r = sim.racers.get(id); return r ? r.seat : -1; };

  function syncSeats() {
    for (const r of sim.racers.values()) {
      seatMeta[r.seat] = { name: r.name, color: r.color, avatar: r.avatar };
    }
  }

  function start() {
    ctx.root.innerHTML = HOST_HTML;
    canvas = $q('.rr-stage'); g = canvas.getContext('2d');
    mini = $q('.rr-minimap'); mg = mini.getContext('2d');
    const fit = () => { canvas.width = ctx.root.clientWidth; canvas.height = ctx.root.clientHeight; };
    fit(); window.addEventListener('resize', fit);

    let seat = 0;
    for (const p of ctx.players()) { addRacer(sim, p, seat++); }
    syncSeats();
    for (const p of ctx.players()) sendSeat(p.id);

    $q('.rr-forcestart').addEventListener('click', beginSeries);
    $q('.rr-again').addEventListener('click', resetSeries);

    renderPicks();
    tickTimer = setInterval(hostTick, TICK_MS);
    raf = requestAnimationFrame(render);
  }

  function sendSeat(id) {
    const r = sim.racers.get(id);
    if (!r) return;
    ctx.sendTo(id, { k: 'seat', seat: r.seat, color: r.color, name: r.name,
                     chars: CHAR_IDS.map((c) => ({ id: c, ...CHARS[c] })) });
    ctx.sendTo(id, { k: 'phase', ph: sim.phase, ...(sim.trk ? { segs: sim.trk.segs, race: sim.race, total: RACE_COUNT } : {}) });
    if (sim.phase === 'shop') sendWallet(id);
  }

  function sendWallet(id) {
    const r = sim.racers.get(id);
    if (!r || !r.hero) return;
    ctx.sendTo(id, { k: 'wallet', coins: r.coins, lvl: r.lvl, costs: COSTS, max: LVL_MAX });
  }

  function broadcastPhase(extra) {
    ctx.sendAll({ k: 'phase', ph: sim.phase, ...extra });
  }

  function beginSeries() {
    if (sim.phase !== 'pick') return;
    const picked = [...sim.racers.values()].filter((r) => r.hero && r.connected);
    if (!picked.length) return;
    sim.race = 1;
    startCountdown(sim);
    syncSeats();
    broadcastPhase({ segs: sim.trk.segs, race: sim.race, total: RACE_COUNT });
    showOverlay('count');
  }

  function resetSeries() {
    for (const r of sim.racers.values()) {
      r.hero = null; r.picked = false; r.coins = 0; r.pts = 0;
      r.lvl = { spd: 0, jmp: 0, pow: 0, rec: 0 };
    }
    sim.phase = 'pick'; sim.race = 0; sim.trk = null;
    broadcastPhase({});
    showOverlay('pick'); renderPicks();
  }

  function showOverlay(which) {
    for (const n of ['pick', 'count', 'results', 'shop', 'podium']) {
      $q(`.rr-${n}-ov`).classList.toggle('hidden', n !== which);
    }
  }

  function renderPicks() {
    const grid = $q('.rr-pick-grid');
    grid.innerHTML = CHAR_IDS.map((cid) => {
      const c = CHARS[cid];
      const takers = [...sim.racers.values()].filter((r) => r.hero === cid);
      return `<div class="rr-pick-card">
        <span class="rr-pick-emoji">${c.emoji}</span>
        <span class="rr-pick-name">${c.name}</span>
        <span class="rr-pick-blurb">${c.blurb}</span>
        <span class="rr-pick-takers">${takers.map((r) => `<i style="background:${r.color}">${escapeHtml(r.name)}</i>`).join('') || '&nbsp;'}</span>
      </div>`;
    }).join('');
    const anyPicked = [...sim.racers.values()].some((r) => r.hero && r.connected);
    $q('.rr-forcestart').classList.toggle('hidden', !anyPicked);
  }

  function hostTick() {
    const before = sim.phase;
    if (sim.phase !== 'pick' && sim.phase !== 'podium') stepSim(sim);

    if (sim.phase !== before) {
      /* phase transitions the sim decided on its own */
      if (sim.phase === 'race') { showOverlay(null); }
      if (sim.phase === 'results') {
        broadcastPhase({ rows: resultRows(), race: sim.race, total: RACE_COUNT });
        renderResults(); showOverlay('results');
      }
      if (sim.phase === 'shop') {
        broadcastPhase({});
        for (const id of sim.order) sendWallet(id);
        showOverlay('shop');
      }
      if (sim.phase === 'count') {   // shop rolled into the next race
        broadcastPhase({ segs: sim.trk.segs, race: sim.race, total: RACE_COUNT });
        showOverlay('count');
      }
      if (sim.phase === 'podium') {
        broadcastPhase({ rows: podiumRows() });
        renderPodium(); showOverlay('podium');
      }
    }

    if (sim.phase === 'count' || sim.phase === 'race') {
      if (++snapCount >= SNAP_EVERY) {
        snapCount = 0;
        const s = snapshot(sim);
        ctx.sendAll(s);
        prevSnapH = curSnapH; curSnapH = s; snapAtH = performance.now();
        for (const e of s.ev) floaters.push({ ...e, at: performance.now() });
      }
    }
    if (sim.phase === 'shop') renderShopStatus();
  }

  function resultRows() {
    return [...sim.racers.values()].filter((r) => r.hero)
      .sort((a, b) => (a.place || 99) - (b.place || 99))
      .map((r) => ({ seat: r.seat, name: r.name, color: r.color, hero: r.hero,
                     place: r.place, finT: r.finT, pay: PAY[r.place - 1] || 2,
                     bonus: r.bonus, pts: r.pts }));
  }
  function podiumRows() {
    return [...sim.racers.values()].filter((r) => r.hero)
      .sort((a, b) => b.pts - a.pts)
      .map((r) => ({ seat: r.seat, name: r.name, color: r.color, hero: r.hero, pts: r.pts }));
  }

  function renderResults() {
    $q('.rr-res-title').textContent = `Race ${sim.race} of ${RACE_COUNT} — results`;
    $q('.rr-res-rows').innerHTML = resultRows().map((row) => `
      <div class="rr-res-row" style="--c:${row.color}">
        <span class="rr-res-place">${['🥇','🥈','🥉'][row.place - 1] || '#' + row.place}</span>
        <span class="rr-res-emoji">${CHARS[row.hero].emoji}</span>
        <span class="rr-res-name">${escapeHtml(row.name)}</span>
        <span class="rr-res-time">${row.finT >= 0 ? row.finT.toFixed(1) + 's' : 'DNF'}</span>
        <span class="rr-res-pay">+${row.pay}🪙 ${row.bonus ? `(+${row.bonus} timing)` : ''}</span>
        <span class="rr-res-pts">${row.pts} pts</span>
      </div>`).join('');
  }

  function renderPodium() {
    $q('.rr-podium-rows').innerHTML = podiumRows().map((row, i) => `
      <div class="rr-res-row rr-pod-${i}" style="--c:${row.color}">
        <span class="rr-res-place">${['👑','🥈','🥉'][i] || '#' + (i + 1)}</span>
        <span class="rr-res-emoji">${CHARS[row.hero].emoji}</span>
        <span class="rr-res-name">${escapeHtml(row.name)}</span>
        <span class="rr-res-pts">${row.pts} pts</span>
      </div>`).join('');
  }

  function renderShopStatus() {
    const live = [...sim.racers.values()].filter((r) => r.hero && r.connected);
    $q('.rr-shop-status').innerHTML = live.map((r) =>
      `<span class="rr-chip" style="--c:${r.color}">${r.shopDone ? '✅' : '🛒'} ${escapeHtml(r.name)} · ${r.coins}🪙</span>`).join('');
    $q('.rr-shop-clock').textContent = `Next race in ${Math.ceil(sim.phaseT)}s`;
  }

  /* ---------- big-screen render loop ---------- */
  function render(now) {
    raf = requestAnimationFrame(render);
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    if (!sim.trk || (sim.phase !== 'race' && sim.phase !== 'count' && sim.phase !== 'results')) {
      /* idle candy backdrop behind overlays */
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#ffe3f1'); sky.addColorStop(1, '#ffd1e8');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      $q('.rr-topbar').classList.add('hidden');
      $q('.rr-standings').classList.add('hidden');
      return;
    }
    $q('.rr-topbar').classList.remove('hidden');
    $q('.rr-standings').classList.remove('hidden');

    /* interpolated view straight from the host's own snapshots */
    let view;
    if (curSnapH) {
      const u = prevSnapH ? Math.min(1, (performance.now() - snapAtH) / (TICK_MS * SNAP_EVERY)) : 1;
      view = lerpSnap(prevSnapH, curSnapH, u);
    } else view = { p: [], jb: [], bx: [], tick: sim.tick };
    lastView = view;

    /* camera: frame every racer */
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    for (const pr of view.p) {
      mnx = Math.min(mnx, pr[1]); mxx = Math.max(mxx, pr[1]);
      mny = Math.min(mny, pr[2]); mxy = Math.max(mxy, pr[2]);
    }
    if (mnx > mxx) { mnx = 0; mxx = 800; mny = -100; mxy = 100; }
    const pad = 260;
    const bw = (mxx - mnx) + pad * 2, bh = (mxy - mny) + pad * 2;
    const z = Math.min(1.1, Math.max(0.14, Math.min(W / bw, H / bh)));
    const cam = { x: (mnx + mxx) / 2, y: (mny + mxy) / 2 - 40, z };

    drawScene(g, W, H, cam, sim.trk, view, { seatMeta, names: true, floaters, now: performance.now() });
    floaters = floaters.filter((f) => performance.now() - f.at < 1300);

    /* countdown number */
    if (sim.phase === 'count') {
      const n = Math.ceil(sim.phaseT);
      $q('.rr-count-num').textContent = sim.phaseT > 0.15 ? n : 'GO!';
    }

    /* top bar */
    $q('.rr-race-no').textContent = `Race ${sim.race}/${RACE_COUNT}`;
    $q('.rr-clock').textContent = sim.phase === 'race'
      ? (view.dnf !== undefined ? `⏱ ${sim.raceT.toFixed(1)}s · DNF in ${curSnapH.dnf}s` : `⏱ ${sim.raceT.toFixed(1)}s`)
      : '';

    drawMinimap(view);
    drawStandings(view);
  }

  function drawMinimap(view) {
    const W = mini.width, H = mini.height;
    mg.clearRect(0, 0, W, H);
    mg.fillStyle = '#00000022'; mg.beginPath(); mg.roundRect(0, 0, W, H, 12); mg.fill();
    const trk = sim.trk;
    const mx = (x) => 10 + (x / trk.len) * (W - 20);
    /* elevation ribbon */
    let mnY = 1e9, mxY = -1e9;
    for (const h of trk.H) { mnY = Math.min(mnY, h); mxY = Math.max(mxY, h); }
    mg.strokeStyle = '#ffffff88'; mg.lineWidth = 2; mg.beginPath();
    for (let i = 0; i < trk.H.length; i += 6) {
      const sx = mx(i * CELL);
      const sy = 8 + ((trk.H[i] - mnY) / Math.max(1, mxY - mnY)) * (H - 16);
      i === 0 ? mg.moveTo(sx, sy) : mg.lineTo(sx, sy);
    }
    mg.stroke();
    mg.fillStyle = '#4dabf7';
    for (const w of trk.waters) mg.fillRect(mx(w.x0), H - 8, mx(w.x1) - mx(w.x0), 5);
    mg.fillStyle = '#e05c7a';
    for (const w of trk.walls) mg.fillRect(mx(w.x) - 2, 4, 4, H - 8);
    mg.font = '12px sans-serif';
    mg.fillText('🏁', mx(trk.finishX) - 6, 16);
    for (const pr of view.p) {
      const meta = seatMeta[pr[0]]; if (!meta) continue;
      const sy = 8 + ((pr[2] - mnY) / Math.max(1, mxY - mnY)) * (H - 16);
      mg.fillStyle = meta.color;
      mg.beginPath(); mg.arc(mx(pr[1]), Math.min(H - 6, Math.max(6, sy)), 5, 0, Math.PI * 2); mg.fill();
    }
  }

  function drawStandings(view) {
    const rows = view.p.slice().sort((a, b) => {
      if (a[9] !== b[9]) return b[9] - a[9];
      if (a[9]) return a[7] - b[7];
      return b[1] - a[1];
    });
    $q('.rr-standings').innerHTML = rows.map((pr, i) => {
      const meta = seatMeta[pr[0]]; if (!meta) return '';
      const label = pr[9] ? (['🥇','🥈','🥉'][pr[7] - 1] || '#' + pr[7]) : '#' + (i + 1);
      return `<span class="rr-chip" style="--c:${meta.color}">${label} ${CHARS[pr[8]] ? CHARS[pr[8]].emoji : ''} ${escapeHtml(meta.name)}</span>`;
    }).join('');
  }

  /* ---------- shell hooks ---------- */
  function onMessage(playerId, data) {
    const r = sim.racers.get(playerId);
    if (!r || !data) return;
    switch (data.k) {
      case 'pick':
        if (sim.phase === 'pick' && CHARS[data.hero]) { r.hero = data.hero; r.picked = true; renderPicks(); }
        break;
      case 'start':
        if (playerId === ctx.hostPlayerId()) beginSeries();
        break;
      case 'jump':  inJump(sim, r);  break;
      case 'power': inPower(sim, r); break;
      case 'throw': inThrow(sim, r); break;
      case 'buy': {
        if (sim.phase !== 'shop') break;
        const st = data.stat;
        if (!r.lvl[st] && r.lvl[st] !== 0) break;
        const cost = COSTS[r.lvl[st]];
        if (r.lvl[st] < LVL_MAX && cost !== undefined && r.coins >= cost) {
          r.coins -= cost; r.lvl[st]++;
        }
        sendWallet(playerId);
        break;
      }
      case 'shopdone': if (sim.phase === 'shop') { r.shopDone = true; } break;
      case 'again': if (sim.phase === 'podium' && playerId === ctx.hostPlayerId()) resetSeries(); break;
    }
  }

  function onPlayerJoin(p) {
    let seat = 0;
    for (const r of sim.racers.values()) seat = Math.max(seat, r.seat + 1);
    addRacer(sim, p, seat);
    syncSeats();
    sendSeat(p.id);
  }
  function onPlayerLeave(playerId) {
    const r = sim.racers.get(playerId);
    if (r) r.connected = false;
  }
  function onPlayerRejoin(p) {
    const r = sim.racers.get(p.id);
    if (r) { r.connected = true; sendSeat(p.id); }
    else onPlayerJoin(p);
  }
  function destroy() {
    clearInterval(tickTimer);
    cancelAnimationFrame(raf);
  }

  return { start, onMessage, onPlayerJoin, onPlayerLeave, onPlayerRejoin, destroy };
}

/* ============================================================
   CONTROLLER (phone)
   ============================================================ */
const CTRL_HTML = `
<div class="rr-ctrl">
  <div class="rr-cpick">
    <h2>Pick your racer</h2>
    <div class="rr-cpick-grid"></div>
    <p class="rr-cpick-note">Everyone's speciality shines on a different part of the track.</p>
    <button class="rr-btn rr-cstart hidden">🏁 Start the race!</button>
  </div>

  <div class="rr-cplay hidden">
    <div class="rr-chud">
      <span class="rr-cpos"></span>
      <span class="rr-cmsg"></span>
      <span class="rr-citem"></span>
    </div>
    <canvas class="rr-ccam"></canvas>
    <div class="rr-cbtns">
      <button class="rr-cbtn rr-b-throw">⚪<small>THROW</small></button>
      <button class="rr-cbtn rr-b-jump">🦘<small>JUMP</small></button>
      <button class="rr-cbtn rr-b-power"><span class="rr-pw-ico">✨</span><small>POWER</small><i class="rr-cd"></i></button>
    </div>
  </div>

  <div class="rr-cshop hidden">
    <h2>🛠️ Pit stop</h2>
    <div class="rr-ccoins"></div>
    <div class="rr-cshop-rows"></div>
    <button class="rr-btn rr-cdone">Ready for the next race ✅</button>
  </div>

  <div class="rr-cend hidden">
    <h2 class="rr-cend-title"></h2>
    <div class="rr-cend-body"></div>
    <button class="rr-btn rr-cagain hidden">🔄 Play again</button>
  </div>
</div>`;

function createController(ctx) {
  let canvas, g, raf = 0;
  let mySeat = -1, myColor = '#fff', chars = null, myHero = null;
  let trk = null;
  let prev = null, cur = null, snapAt = 0;
  let floaters = [];
  const seatMeta = {};
  let wallet = null;
  let phase = 'pick';
  let isPartyHost = false;

  const $q = (s) => ctx.root.querySelector(s);

  function start() {
    ctx.root.innerHTML = CTRL_HTML;
    canvas = $q('.rr-ccam'); g = canvas.getContext('2d');

    const press = (sel, k) => {
      const el = $q(sel);
      const fire = (e) => { e.preventDefault(); ctx.send({ k }); flash(el); };
      el.addEventListener('touchstart', fire, { passive: false });
      el.addEventListener('mousedown', fire);
    };
    press('.rr-b-jump', 'jump');
    press('.rr-b-power', 'power');
    press('.rr-b-throw', 'throw');

    $q('.rr-cstart').addEventListener('click', () => ctx.send({ k: 'start' }));
    $q('.rr-cdone').addEventListener('click', () => { ctx.send({ k: 'shopdone' }); $q('.rr-cdone').textContent = 'Waiting for the others…'; });
    $q('.rr-cagain').addEventListener('click', () => ctx.send({ k: 'again' }));

    raf = requestAnimationFrame(render);
  }

  function flash(el) { el.classList.add('rr-hit'); setTimeout(() => el.classList.remove('rr-hit'), 120); }

  function show(which) {
    for (const n of ['cpick', 'cplay', 'cshop', 'cend']) {
      $q(`.rr-${n}`).classList.toggle('hidden', n !== which);
    }
    if (which === 'cplay') fitCanvas();
  }

  function fitCanvas() {
    requestAnimationFrame(() => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(200, Math.round(r.width));
      canvas.height = Math.max(160, Math.round(r.height));
    });
  }

  function renderPick() {
    if (!chars) return;
    $q('.rr-cpick-grid').innerHTML = chars.map((c) => `
      <button class="rr-ccard ${myHero === c.id ? 'rr-ccard-on' : ''}" data-hero="${c.id}">
        <span class="rr-ccard-emoji">${c.emoji}</span>
        <span class="rr-ccard-name">${c.name}</span>
        <span class="rr-ccard-blurb">${c.blurb}</span>
        <span class="rr-ccard-desc">${c.desc}</span>
      </button>`).join('');
    for (const btn of ctx.root.querySelectorAll('.rr-ccard')) {
      btn.addEventListener('click', () => {
        myHero = btn.dataset.hero;
        ctx.send({ k: 'pick', hero: myHero });
        renderPick();
        const ico = { shelly: '🐚', gecko: '🧗', finn: '💨', zippy: '⚡' }[myHero] || '✨';
        $q('.rr-pw-ico').textContent = ico;
      });
    }
    $q('.rr-cstart').classList.toggle('hidden', !(isPartyHost && myHero));
  }

  function renderShop() {
    if (!wallet) return;
    $q('.rr-ccoins').innerHTML = `You have <b>${wallet.coins} 🪙</b>`;
    $q('.rr-cshop-rows').innerHTML = STATS.map(([id, label, blurb]) => {
      const lvl = wallet.lvl[id], maxed = lvl >= wallet.max;
      const cost = maxed ? null : wallet.costs[lvl];
      const dots = '●'.repeat(lvl) + '○'.repeat(wallet.max - lvl);
      return `<div class="rr-shop-row">
        <div class="rr-shop-info"><b>${label}</b><span class="rr-shop-dots">${dots}</span><small>${blurb}</small></div>
        <button class="rr-shop-buy" data-stat="${id}" ${maxed || wallet.coins < cost ? 'disabled' : ''}>
          ${maxed ? 'MAX' : cost + '🪙'}
        </button>
      </div>`;
    }).join('');
    for (const btn of ctx.root.querySelectorAll('.rr-shop-buy')) {
      btn.addEventListener('click', () => ctx.send({ k: 'buy', stat: btn.dataset.stat }));
    }
  }

  function onMessage(data) {
    if (!data) return;
    if (data.k === 'seat') {
      mySeat = data.seat; myColor = data.color; chars = data.chars;
      seatMeta[mySeat] = { name: data.name, color: data.color };
      isPartyHost = false;   // refreshed below via phase msgs; start btn is host-screen anyway
      renderPick();
    } else if (data.k === 'phase') {
      phase = data.ph;
      if (data.segs) trk = buildTrack(data.segs);
      if (phase === 'pick') { myHero = null; show('cpick'); renderPick(); }
      if (phase === 'count' || phase === 'race') {
        prev = null; cur = null;
        $q('.rr-cmsg').textContent = phase === 'count' ? 'JUMP right on GO! 🚀' : '';
        show('cplay');
      }
      if (phase === 'results' && data.rows) {
        const me = data.rows.find((r) => r.seat === mySeat);
        $q('.rr-cend-title').textContent = me
          ? (['🥇 You won!','🥈 2nd place!','🥉 3rd place!'][me.place - 1] || `#${me.place} — next time!`)
          : `Race ${data.race} done`;
        $q('.rr-cend-body').innerHTML = me
          ? `+${me.pay}🪙 for place ${me.bonus ? `· +${me.bonus}🪙 timing bonus` : ''}<br>${me.pts} championship pts`
          : 'You joined mid-race — you race from the next one!';
        $q('.rr-cagain').classList.add('hidden');
        show('cend');
      }
      if (phase === 'shop') {
        $q('.rr-cdone').textContent = 'Ready for the next race ✅';
        show('cshop'); renderShop();
      }
      if (phase === 'podium' && data.rows) {
        const i = data.rows.findIndex((r) => r.seat === mySeat);
        $q('.rr-cend-title').textContent = i === 0 ? '👑 CHAMPION!' : `You finished #${i + 1}`;
        $q('.rr-cend-body').innerHTML = data.rows.map((r, ix) =>
          `<div>${['👑','🥈','🥉'][ix] || '#' + (ix + 1)} ${escapeHtml(r.name)} — ${r.pts} pts</div>`).join('');
        $q('.rr-cagain').classList.remove('hidden');
        show('cend');
      }
    } else if (data.k === 'snap') {
      prev = cur; cur = data; snapAt = performance.now();
      for (const e of data.ev) floaters.push({ ...e, at: performance.now() });
      if (data.ph === 'race' && phase === 'count') { phase = 'race'; $q('.rr-cmsg').textContent = ''; }
    } else if (data.k === 'wallet') {
      wallet = data; renderShop();
    }
  }

  /* ---------- phone render loop ---------- */
  function render() {
    raf = requestAnimationFrame(render);
    if (!canvas.width || $q('.rr-cplay').classList.contains('hidden')) return;
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    if (!trk || !cur) return;

    const u = prev ? Math.min(1, (performance.now() - snapAt) / (TICK_MS * SNAP_EVERY)) : 1;
    const view = lerpSnap(prev, cur, u);
    const me = view.p.find((pr) => pr[0] === mySeat);

    const cam = me
      ? { x: me[1] + 90, y: me[2] - 60, z: Math.min(1.15, W / 640) }
      : { x: 300, y: 0, z: 0.6 };

    /* collect names for nearby rivals */
    for (const pr of view.p) if (!seatMeta[pr[0]]) seatMeta[pr[0]] = { name: '', color: '#ffffff88' };
    drawScene(g, W, H, cam, trk, view, { seatMeta, names: false, floaters, now: performance.now() });
    floaters = floaters.filter((f) => performance.now() - f.at < 1300);

    /* my marker arrow */
    if (me) {
      const [sx, sy] = w2s(cam, W, H, me[1], me[2]);
      g.fillStyle = myColor;
      g.beginPath(); g.moveTo(sx, sy - 92); g.lineTo(sx - 9, sy - 106); g.lineTo(sx + 9, sy - 106); g.closePath(); g.fill();
    }

    /* countdown overlay */
    if (view.cd !== undefined) {
      g.fillStyle = '#00000044'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.font = '800 84px Fredoka, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(view.cd > 0.15 ? Math.ceil(view.cd) : 'GO!', W / 2, H / 2);
    }

    /* swim rhythm meter */
    if (me && me[3] === ST.SWIM) {
      g.fillStyle = '#00000055'; g.beginPath(); g.roundRect(W / 2 - 90, H - 34, 180, 22, 11); g.fill();
      g.fillStyle = '#4dabf7';
      g.beginPath(); g.roundRect(W / 2 - 86, H - 30, 172 * Math.min(1, me[6] / 8), 14, 7); g.fill();
      g.fillStyle = '#fff'; g.font = '600 12px Fredoka, sans-serif'; g.textAlign = 'center';
      g.fillText('TAP JUMP IN RHYTHM 🌊', W / 2, H - 44);
    }
    /* progress bar */
    if (me) {
      g.fillStyle = '#00000033'; g.fillRect(0, 0, W, 6);
      g.fillStyle = myColor; g.fillRect(0, 0, W * Math.min(1, me[1] / trk.finishX), 6);
    }

    /* HUD */
    if (me) {
      const done = me[9] === 1;
      const rows = view.p.slice().sort((a, b) => (b[9] - a[9]) || (a[9] ? a[7] - b[7] : b[1] - a[1]));
      const pos = done ? me[7] : rows.findIndex((pr) => pr[0] === mySeat) + 1;
      $q('.rr-cpos').textContent = (['🥇','🥈','🥉'][pos - 1] || '#' + pos);
      $q('.rr-citem').textContent = me[4] ? '⚪ jawbreaker ready!' : '';
      $q('.rr-b-throw').classList.toggle('rr-armed', !!me[4]);
      const cd = me[5] / 10;
      const cdEl = $q('.rr-cd');
      cdEl.style.height = cd > 0 ? Math.min(100, cd / 4 * 100) + '%' : '0%';
      if (done) $q('.rr-cmsg').textContent = '🏁 Finished!';
    }
  }

  function destroy() { cancelAnimationFrame(raf); }

  return { start, onMessage, destroy };
}

/* ============================================================ */
export default {
  id: 'rockcandyrally',
  title: 'Rock Candy Rally',
  tagline: 'Timing-is-everything side-scroll race',
  emoji: '🏁',
  minPlayers: 1,
  maxPlayers: 6,
  createHost,
  createController,
};

/* headless testing hooks */
export const __sim = {
  makeSim, addRacer, startCountdown, stepSim, snapshot,
  inJump, inPower, inThrow, makeSegs, buildTrack,
  groundY, slopeAt, waterAt, nextWall, nearestCrestBehind, lerpSnap,
  CHARS, ST, TICK, PULSE_S, RACE_COUNT, COSTS, LVL_MAX, PTS, PAY,
};
