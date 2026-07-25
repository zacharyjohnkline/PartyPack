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

   THE CUP — like a kart-racer grand prix, the series is four
   DIFFERENT courses, each a closed loop raced for 3 LAPS:
     1. Gumdrop Meadows    a friendly bit of everything
     2. Soda Lakes         the swimmer's course
     3. Rock Candy Cliffs  two HUGE walls — the climber's course
     4. Sour Summit        one giant hill and the works
   Courses wrap seamlessly (the seam is the start/finish line) and
   are seeded fresh every series, so lengths vary a little.

   PITFALLS: sheer chasms cut across every course. Jump right at the
   edge and you clear them; mistime it and you drop in, sink for half
   a second, and respawn on the far side — slower, but never stuck.

   Between races, Super Off-Road style: placement pays candy coins
   (plus +1 for every PERFECT timing you land mid-race), spent on
   Speed / Jump / Power / Recovery upgrades that persist across the
   4-race series. Most championship points on the podium wins.

   The phone that opened the room is the party host and drives every
   menu from its own screen: starting the series, skipping results,
   cutting the shop timer short, ending a race once the winner is in,
   and replaying or exiting from the podium.

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
const HOP_MISS = 24;               // …mashing off-beat (still beats the slip)

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
const DNF_GRACE = 30;              // seconds everyone gets after the winner finishes
const LAPS = 3;                    // every race loops the course 3 times
const FALL_WAIT = 0.5;             // seconds at the bottom of a pit before respawn
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
const ST = { RUN: 0, AIR: 1, CLIMB: 2, SWIM: 3, SLIDE: 4, TRIP: 5, DONE: 6, BONK: 7, STALL: 8, FALL: 9 };

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

/* ---------- the cup: four themed courses, one per race ---------- */
const THEMES = [
  { name: 'Gumdrop Meadows',  sky: ['#ffe3f1', '#ffd1e8', '#ffeef7'], hills: ['#f7bfe0', '#f3a9d4'],
    dirt: ['#b97a4e', '#8a5433'], lip: '#7fd97f', wall: ['#e05c7a', '#c9385c'] },
  { name: 'Soda Lakes',       sky: ['#dff4ff', '#c8ecff', '#eefaff'], hills: ['#a8dcf0', '#8fd0ea'],
    dirt: ['#e0b56b', '#b98c47'], lip: '#ffe08a', wall: ['#4dabf7', '#2b8ad6'] },
  { name: 'Rock Candy Cliffs', sky: ['#efe4ff', '#e2d0ff', '#f6efff'], hills: ['#cdb3ef', '#b898e3'],
    dirt: ['#8d7b9e', '#655672'], lip: '#d9c2ff', wall: ['#9775fa', '#7048e8'] },
  { name: 'Sour Summit',      sky: ['#fff3d6', '#ffe3ad', '#fff8e8'], hills: ['#ffd27f', '#f7b955'],
    dirt: ['#7fae5a', '#5c8440'], lip: '#b2f2bb', wall: ['#94d82d', '#66a80f'] },
];

function makeSegs(trackNo = 0) {
  const R = (a, b) => a + Math.random() * (b - a);
  const RI = (a, b) => Math.round(R(a, b));
  const segs = [];
  const flat  = (a, b) => segs.push({ t: 'flat', len: RI(a, b) });
  const pit   = (a, b) => segs.push({ t: 'pit',  len: RI(a, b) });
  const wall  = (a, b) => segs.push({ t: 'wall', h: RI(a, b) });
  const water = (a, b, d0, d1) => segs.push({ t: 'water', len: RI(a, b), depth: RI(d0, d1) });
  const down  = (a, b, h0, h1) => segs.push({ t: 'down', len: RI(a, b), h: RI(h0, h1) });
  const hill = (h) => {            // an up-and-over: climb, crest, big descent
    segs.push({ t: 'up',   len: RI(420, 560), h });
    segs.push({ t: 'down', len: RI(640, 880), h: h + RI(40, 120) });
  };

  const t = ((trackNo % THEMES.length) + THEMES.length) % THEMES.length;
  if (t === 0) {          /* Gumdrop Meadows — a bit of everything, gently */
    flat(540, 640);
    hill(RI(170, 210));
    flat(320, 400); pit(125, 150); flat(250, 320);
    wall(260, 300);
    flat(440, 540);
    water(620, 760, 90, 120);
    flat(300, 360); pit(135, 160); flat(250, 300);
    hill(RI(200, 250));
    flat(460, 560);
  } else if (t === 1) {   /* Soda Lakes — the swimmer's course */
    flat(520, 600);
    water(780, 920, 100, 130);
    flat(280, 340); pit(145, 175); flat(280, 340);
    hill(RI(160, 200));
    flat(260, 320);
    wall(280, 330);
    flat(440, 520);
    water(700, 840, 100, 130);
    flat(280, 330); pit(130, 155); flat(430, 500);
  } else if (t === 2) {   /* Rock Candy Cliffs — two BIG climbs */
    flat(500, 580);
    wall(400, 460);
    down(520, 620, 330, 380);      // sweeping descent off the first cliff
    flat(300, 380);
    hill(RI(190, 230));
    flat(230, 290); pit(150, 175); flat(230, 290);
    wall(460, 520);
    down(640, 760, 380, 440);      // the grand descent
    flat(430, 500); pit(140, 165); flat(300, 360);
  } else {                /* Sour Summit — the big finale */
    flat(520, 600);
    hill(RI(330, 400));            // the summit itself
    flat(280, 340); pit(150, 180); flat(240, 300);
    wall(360, 420);
    down(460, 560, 280, 330);
    flat(430, 500);
    water(720, 860, 100, 130);
    flat(270, 330); pit(155, 185); flat(240, 300);
    hill(RI(240, 300));
    flat(500, 580);
  }
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
  const pits = [];                 // { x0, x1, y } — bottomless-looking chasms
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
    } else if (s.t === 'pit') {
      /* a sheer chasm. Interior cells drop way down; the outermost cell
         on each side stays at lip level so landings on the far edge are fair. */
      const n = Math.max(3, Math.round(s.len / CELL));
      for (let k = 1; k <= n; k++) push(k === 1 || k === n ? y : y + 540);
      pits.push({ x0: x + CELL, x1: x + (n - 1) * CELL, y });
      x += n * CELL;
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
  /* close the loop: glide the elevation back to the start height so the
     course wraps seamlessly, then a short flat through the finish line. */
  {
    const dy = 0 - y;
    const n = Math.round(Math.max(320, Math.abs(dy) * 3.2) / CELL);
    const y0 = y;
    for (let k = 1; k <= n; k++) push(y0 + dy * ease(k / n));
    y = 0; x += n * CELL;
    const fn = Math.round(220 / CELL);
    for (let k = 1; k <= fn; k++) push(0);
    x += fn * CELL;
  }
  const len = x;
  const finishX = len;             // the seam IS the start/finish line
  return { segs, H, walls, waters, crests, boxes, pits, len, finishX };
}

/* wrap any world x back onto the loop */
function wrapX(trk, x) {
  return ((x % trk.len) + trk.len) % trk.len;
}

/* ground y at world x (lerped) */
function groundY(trk, x) {
  x = wrapX(trk, x);
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
  x = wrapX(trk, x);
  for (const w of trk.waters) if (x >= w.x0 && x <= w.x1) return w;
  return null;
}
/* margin keeps edge landings fair — the outer few px of a pit count as lip */
function pitAt(trk, x, m = 8) {
  x = wrapX(trk, x);
  for (const p of trk.pits) if (x > p.x0 + m && x < p.x1 - m) return p;
  return null;
}
function nextWall(trk, x) {
  x = wrapX(trk, x);
  for (const w of trk.walls) if (w.x > x - WALL_W) return w;
  /* nothing ahead this lap — the next wall is the first one, a lap away */
  return trk.walls.length ? { ...trk.walls[0], x: trk.walls[0].x + trk.len } : null;
}
function nearestCrestBehind(trk, x) {
  x = wrapX(trk, x);
  let best = null;
  for (const c of trk.crests) if (c.x <= x + 45 && (!best || c.x > best.x)) best = c;
  if (!best && trk.crests.length) {
    const last = trk.crests[trk.crests.length - 1];
    best = { ...last, x: last.x - trk.len };
  }
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
    x: 0, y: 0, vx: 0, vy: 0, st: ST.RUN, face: 1, lap: 0, graceT: 0, lastHop: -9,
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
  const tno = ((sim.race - 1) % THEMES.length + THEMES.length) % THEMES.length;
  sim.trackNo = tno;
  sim.trk = buildTrack(makeSegs(tno));
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
    r.item = 0; r.combo = 0; r.lastStroke = -9; r.landedAt = -9; r.lastHop = -9;
    r.wallRef = null; r.startPress = null; r.stalled = false; r.lap = 0; r.graceT = 0;
    r.finished = false; r.finT = 0; r.place = 0; r.bonus = 0; r.shopDone = false;
  }
}

/* ---------- inputs (called from onMessage) ---------- */
function inJump(sim, r) {
  if (r.st === ST.FALL) return;
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
    /* one hop per press, one press per beat — no machine-gunning the window */
    if (now - r.lastHop < 0.22) return;
    r.lastHop = now;
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
  if (sim.phase !== 'race' || r.finished || r.powerCd > 0 || r.st === ST.FALL) return;
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
  if (r.st === ST.TRIP || r.st === ST.CLIMB || r.st === ST.FALL) return;
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
  if (r.graceT > 0) r.graceT -= TICK;
  if (r.boostT > 0) { r.boostT -= TICK; if (r.boostT <= 0) r.boostV = 0; }

  /* down a pit: sink, wait half a beat, respawn on the far side */
  if (r.st === ST.FALL) {
    r.stunT -= TICK;
    r.y += 150 * TICK;
    if (r.stunT <= 0) {
      const pit = r.pitRef || pitAt(trk, r.x, 0);
      r.x = pit ? pit.x1 + 26 : r.x + 60;
      r.y = groundY(trk, r.x);
      r.st = ST.RUN; r.vx = 110; r.vy = 0; r.pitRef = null; r.graceT = 0.5;
    }
    return;
  }

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
      r.st = ST.RUN; r.y = r.wallRef.baseY;
      r.x = wrapX(trk, r.wallRef.x) - WALL_W - 44;       // pushed back for a run-up
      r.vx = 0; r.graceT = 0.9; r.wallRef = null;
      pop(sim, r, 'slid off!', false);
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
    const pit = pitAt(trk, r.x);
    if (pit && r.y > pit.y + 100) {                      // dropped into the chasm
      r.st = ST.FALL; r.stunT = FALL_WAIT; r.pitRef = pit;
      r.vx = 0; r.vy = 0;
      pop(sim, r, 'fell in! 🕳️', false);
      return;
    }
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
    const pit = pitAt(trk, r.x);
    if (pit) { r.st = ST.AIR; r.vy = 0; }            // ran off the edge!
    else r.y = groundY(trk, r.x);
  }

  /* ---- walls: grab or bonk ---- */
  const nw = nextWall(trk, r.x + 1);
  if (nw && r.x >= nw.x - WALL_W - 10 && r.x <= nw.x + WALL_W && r.y > nw.topY + 8 && r.st !== ST.SWIM) {
    if (r.st === ST.AIR) {
      /* grab on! Higher if the launch distance was sweet. */
      r.wallRef = nw;
      r.st = ST.CLIMB;
      r.x = wrapX(trk, nw.x) - WALL_W;
      const bonusUp = 95 * Math.max(r.grabQual || 0, 0.3) * CHARS[r.hero].hop;
      r.y = Math.min(r.y, nw.baseY - 10) - bonusUp;
      r.grabQual = 0;
      if (r.y <= nw.topY + 4) vault(sim, r);
    } else if (r.graceT > 0) {
      /* just recovered — press against the wall without another stun */
      r.x = wrapX(trk, nw.x) - WALL_W - 1; r.vx = 0;
    } else {
      /* ran face-first into candy brick */
      r.x = wrapX(trk, nw.x) - WALL_W - 1;
      r.vx = 0; r.st = ST.BONK; r.stunT = BONK_STUN * recMul(r);
      r.graceT = r.stunT + 1.0;          // …and a moment of mercy afterwards
      pop(sim, r, 'BONK!', false);
    }
  }

  /* ---- item boxes ---- */
  for (let i = 0; i < trk.boxes.length; i++) {
    if (sim.boxT[i] > 0) continue;
    const b = trk.boxes[i];
    let bdx = Math.abs(r.x - b.x);
    bdx = Math.min(bdx, trk.len - bdx);
    if (bdx < 26 && r.y > groundY(trk, b.x) - 78 && !r.item) {
      r.item = 1; sim.boxT[i] = BOX_RESPAWN;
      pop(sim, r, '❓ jawbreaker!', true);
    }
  }

  /* ---- the seam: lap line and, on the last lap, the finish ---- */
  while (r.x >= trk.len) {
    r.x -= trk.len;
    r.lap++;
    if (r.lap >= LAPS) {
      r.finished = true; r.st = ST.DONE;
      r.finT = sim.raceT; r.place = sim.placeNext++;
      r.pts += PTS[r.place - 1] || 2;
      r.coins += PAY[r.place - 1] || 2;
      if (sim.firstFinT === null) sim.firstFinT = sim.raceT;
      pop(sim, r, ['🥇','🥈','🥉'][r.place - 1] || `#${r.place}`, true);
    } else {
      pop(sim, r, r.lap === LAPS - 1 ? 'FINAL LAP!' : `LAP ${r.lap + 1}/${LAPS}`, true);
    }
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
      if (j.x >= trk.len) j.x -= trk.len;
      if (!j.fly && pitAt(trk, j.x, 0)) j.restT = -1;    // lost down a chasm
    } else {
      j.restT -= TICK;
    }
    /* trip anyone who touches it */
    for (const r of sim.racers.values()) {
      if (!r.hero || r.finished || r.st === ST.TRIP || r.st === ST.CLIMB) continue;
      if (r.id === j.owner && sim.tick * TICK - j.ownT < 1.0) continue;
      let dx = Math.abs(r.x - j.x);
      dx = Math.min(dx, trk.len - dx);
      if (dx < JB_R + 14 && Math.abs((r.y - 26) - j.y) < 46) {
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
            r.place, r.hero, r.finished ? 1 : 0, r.lap]);
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
/* darken a #rrggbb colour for limbs */
const _shadeCache = new Map();
function shade(hex, f = 0.62) {
  const key = hex + f;
  if (_shadeCache.has(key)) return _shadeCache.get(key);
  let out = hex;
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (m) {
    const v = parseInt(m[1], 16);
    const r = Math.round(((v >> 16) & 255) * f), gg = Math.round(((v >> 8) & 255) * f), b = Math.round((v & 255) * f);
    out = `rgb(${r},${gg},${b})`;
  }
  _shadeCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------
   THE SPRITES — every racer is a jersey-coloured body with an
   emoji face plus stubby limbs, and every state is a two-frame
   animation. Run cadence comes from distance travelled (so fast
   racers' legs whirl faster); everything else ticks on a shared
   clock so both screens agree.
   ------------------------------------------------------------ */
function drawRacer(g, sx, sy, s, pr, meta, view, trackX) {
  const st = pr[3], hero = pr[8];
  const t = (view.tick || 0) * TICK;
  const tf = Math.floor(t * 5) % 2;                    // shared 2-frame clock
  const rf = Math.floor(trackX / 44) % 2;              // run cadence by distance
  const limbCol = shade(meta.color);
  const emoji = CHARS[hero] ? CHARS[hero].emoji : '🍬';

  const limb = (x0, y0, x1, y1) => {
    g.strokeStyle = limbCol; g.lineWidth = 6.5 * s; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0 * s, y0 * s); g.lineTo(x1 * s, y1 * s); g.stroke();
  };
  const body = (bx, by, rx, ry) => {
    g.fillStyle = meta.color;
    g.beginPath(); g.ellipse(bx * s, by * s, rx * s, ry * s, 0, 0, Math.PI * 2); g.fill();
  };
  const face = (fx, fy, size = 34) => {
    g.font = `${size * s}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(emoji, fx * s, fy * s);
  };

  g.save();
  g.translate(sx, sy);

  if (st === ST.SLIDE) {
    /* tucked into a spinning candy shell */
    g.rotate((t * 9) % (Math.PI * 2));
    g.fillStyle = limbCol;
    g.beginPath(); g.arc(0, -14 * s, 20 * s, 0, Math.PI * 2); g.fill();
    g.strokeStyle = meta.color; g.lineWidth = 4 * s;
    g.beginPath(); g.arc(0, -14 * s, 13 * s, 0.3, Math.PI * 1.6); g.stroke();
    g.beginPath(); g.arc(0, -14 * s, 6 * s, 2.4, Math.PI * 2.1); g.stroke();
    g.restore();
    return;
  }

  if (st === ST.SWIM) {
    /* horizontal, windmilling arms, kicking feet */
    limb(-20, -10, -27, tf ? -20 : -2);                // kick
    limb(-14, -16, -24, tf ? -6 : -24);
    body(0, -14, 26, 15);
    if (tf) limb(4, -16, 12, -36); else limb(4, -16, 17, 2);   // stroke
    face(9, -17, 30);
    g.restore();
    return;
  }

  if (st === ST.CLIMB) {
    /* hugging the wall, reaching hand over hand */
    g.translate(4 * s, 0);
    limb(4, -6, 12, -2);                                // bent legs on the brick
    limb(2, -14, 12, -12);
    body(0, -28, 17, 25);
    if (tf) { limb(6, -36, 15, -54); limb(4, -22, 14, -24); }
    else    { limb(4, -36, 14, -28); limb(6, -26, 15, -46); }
    face(0, -32, 30);
    g.restore();
    return;
  }

  if (st === ST.TRIP || st === ST.BONK) {
    g.rotate(Math.PI / 2 * 0.85);
    limb(6, -6, 15, -1); limb(-6, -6, -13, -4);         // splayed
    limb(10, -32, 19, -40); limb(-10, -32, -19, -36);
    body(0, -26, 20, 26);
    face(0, -28);
    g.restore();
    /* dizzy stars, un-rotated */
    g.save(); g.translate(sx, sy);
    g.font = `${26 * s}px sans-serif`; g.textAlign = 'center';
    g.fillText(tf ? '💫' : '✨', 0, -62 * s);
    g.restore();
    return;
  }

  if (st === ST.FALL) {
    /* flailing down the chasm */
    limb(-6, -4, tf ? -13 : -9, 4); limb(6, -4, tf ? 9 : 13, 4);
    limb(-11, -34, tf ? -17 : -21, -50); limb(11, -34, tf ? 21 : 17, -50);
    body(0, -26, 20, 26);
    face(0, -28);
    g.font = `${20 * s}px sans-serif`; g.textAlign = 'center';
    g.fillText('💨', 0, -60 * s);
    g.restore();
    return;
  }

  if (st === ST.AIR) {
    g.rotate(-0.06);
    limb(-4, -6, -11, -13); limb(5, -6, -3, -15);       // tucked legs
    limb(10, -34, tf ? 17 : 19, tf ? -48 : -44);        // arms up
    limb(-10, -34, tf ? -15 : -13, -44);
    body(0, -26, 20, 26);
    face(0, -28);
    g.restore();
    return;
  }

  if (st === ST.STALL) {
    g.translate((tf ? 2 : -2) * s, 0);                  // frustrated shake
    limb(-6, -4, -9, 1); limb(6, -4, 9, 1);
    limb(-11, -30, -15, -18); limb(11, -30, 15, -18);
    body(0, -26, 20, 26);
    face(0, -28);
    g.font = `${20 * s}px sans-serif`; g.textAlign = 'center';
    g.fillText('💦', 20 * s, -52 * s);
    g.restore();
    return;
  }

  if (st === ST.DONE) {
    g.translate(0, (tf ? -3 : 0) * s);                  // victory hop
    limb(-6, -4, -9, 1); limb(6, -4, 9, 1);
    limb(-11, -34, -18, tf ? -52 : -46);                // arms in the air
    limb(11, -34, 18, tf ? -46 : -52);
    body(0, -26, 20, 26);
    face(0, -28);
    g.restore();
    return;
  }

  /* RUN — the default: scissor legs, pumping arms, a little bob */
  g.rotate(0.09);
  g.translate(0, (rf ? -2.5 : 0) * s);
  if (rf) { limb(-3, -4, 13, 1);  limb(-2, -4, -12, -3); }
  else    { limb(-3, -4, -12, 1); limb(-2, -4, 13, -3); }
  if (rf) { limb(-10, -32, -17, -24); limb(10, -32, 16, -38); }
  else    { limb(-10, -32, -15, -40); limb(10, -32, 17, -26); }
  body(0, -26, 20, 26);
  face(0, -28);
  g.restore();
}

function w2s(cam, W, H, x, y) {
  return [(x - cam.x) * cam.z + W / 2, (y - cam.y) * cam.z + H / 2];
}

function drawScene(g, W, H, cam, trk, view, opts) {
  const z = cam.z;
  const x0 = cam.x - W / 2 / z - 60, x1 = cam.x + W / 2 / z + 60;
  const TH = THEMES[trk.theme || 0] || THEMES[0];

  /* the camera window can hang over the seam — draw wrap copies of every
     feature at these world offsets so the loop looks continuous */
  const offs = [];
  for (let k = Math.floor(x0 / trk.len); k <= Math.floor(x1 / trk.len); k++) offs.push(k * trk.len);
  if (!offs.length) offs.push(0);

  /* sky */
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, TH.sky[0]); sky.addColorStop(0.55, TH.sky[1]); sky.addColorStop(1, TH.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);

  /* parallax gumdrop hills */
  g.save();
  for (const [par, col, hh] of [[0.25, TH.hills[0], 210], [0.45, TH.hills[1], 150]]) {
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
    dirt.addColorStop(0, TH.dirt[0]); dirt.addColorStop(1, TH.dirt[1]);
    g.fillStyle = dirt; g.fill();
    /* frosting lip */
    g.strokeStyle = TH.lip; g.lineWidth = Math.max(3, 6 * z); g.stroke();
  }

  /* pit chasms — darken the depths, stripe the lips */
  for (const off of offs) for (const pt of trk.pits) {
    const px0 = pt.x0 + off, px1 = pt.x1 + off;
    if (px1 < x0 || px0 > x1) continue;
    const [ax, ay] = w2s(cam, W, H, px0, pt.y);
    const [bx2] = w2s(cam, W, H, px1, pt.y);
    const depth = g.createLinearGradient(0, ay, 0, ay + 320 * z);
    depth.addColorStop(0, 'rgba(35,10,25,0.35)');
    depth.addColorStop(1, 'rgba(20,5,15,0.95)');
    g.fillStyle = depth;
    g.fillRect(ax, ay - 2, bx2 - ax, H - ay + 2);
    /* hazard-striped lips */
    g.fillStyle = '#ffd93d';
    g.fillRect(ax - 14 * z, ay - 4 * z, 14 * z, 6 * z);
    g.fillRect(bx2, ay - 4 * z, 14 * z, 6 * z);
    g.fillStyle = '#2b2b2b';
    g.fillRect(ax - 7 * z, ay - 4 * z, 7 * z, 6 * z);
    g.fillRect(bx2 + 7 * z, ay - 4 * z, 7 * z, 6 * z);
    /* jump warning */
    g.font = `${Math.max(11, 18 * z)}px sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = '#ffffffdd';
    g.fillText('⚠️', ax - 34 * z, ay - 26 * z);
  }

  /* water pools */
  for (const off of offs) for (const w of trk.waters) {
    if (w.x1 + off < x0 || w.x0 + off > x1) continue;
    const [ax, ay] = w2s(cam, W, H, w.x0 + off, w.surf);
    const [bx2] = w2s(cam, W, H, w.x1 + off, w.surf);
    const [, fy] = w2s(cam, W, H, w.x0 + off, w.floor + 60);
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
  for (const off of offs) for (const w of trk.walls) {
    if (w.x + off < x0 - 60 || w.x + off > x1 + 60) continue;
    const [sx, ty] = w2s(cam, W, H, w.x + off, w.topY);
    const [, by] = w2s(cam, W, H, w.x + off, w.baseY);
    const ww = Math.max(8, WALL_W * 2 * z);
    g.fillStyle = TH.wall[0];
    g.fillRect(sx - ww / 2, ty, ww, by - ty + 6);
    g.fillStyle = '#ffffff55';
    for (let yy = ty; yy < by; yy += Math.max(8, 22 * z)) g.fillRect(sx - ww / 2, yy, ww, Math.max(3, 8 * z));
    g.fillStyle = TH.wall[1];
    g.fillRect(sx - ww / 2 - 2 * z, ty - 6 * z, ww + 4 * z, 8 * z);
    /* pulse ring at the grab face — same clock on every screen */
    const ph = ((view.tick || 0) * TICK % PULSE_S) / PULSE_S;
    const rr = (1 - ph) * 34 * z + 6;
    g.strokeStyle = ph < 0.14 ? '#ffd93d' : '#ffffffaa';
    g.lineWidth = ph < 0.14 ? 5 : 2.5;
    g.beginPath(); g.arc(sx - ww / 2 - 10 * z, (ty + by) / 2, rr, 0, Math.PI * 2); g.stroke();
  }

  /* crest markers — a little "drop in here!" chevron for shell timing */
  for (const off of offs) for (const c of trk.crests) {
    if (c.x + off < x0 || c.x + off > x1) continue;
    const [sx, sy] = w2s(cam, W, H, c.x + off + 30, groundY(trk, c.x + 30) - 46);
    g.font = `${Math.max(12, 22 * z)}px sans-serif`;
    g.textAlign = 'center';
    g.fillStyle = '#ffffffcc';
    g.fillText('⤵', sx, sy);
  }

  /* start/finish flag at the seam */
  for (const off of offs) {
    const fx = off;                       // x = 0 (plus wrap copies)
    if (fx > x0 && fx < x1) {
      const [sx, sy] = w2s(cam, W, H, fx, groundY(trk, 0));
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
  for (const off of offs) trk.boxes.forEach((b, i) => {
    if (b.x + off < x0 || b.x + off > x1) return;
    if (view.bx && !view.bx[i]) return;
    const [sx, sy] = w2s(cam, W, H, b.x + off, groundY(trk, b.x) - 58);
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
  if (view.jb) for (const off of offs) for (const [jx0, jy] of view.jb) {
    const jx = jx0 + off;
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

  /* racers — little two-frame sprites, animated by state */
  if (view.p) for (const pr of view.p) {
    const [seat, px0, py, st] = pr;
    const meta = opts.seatMeta[seat];
    if (!meta) continue;
    /* nearest wrap representation to the camera */
    const px = px0 + trk.len * Math.round((cam.x - px0) / trk.len);
    if (px < x0 - 80 || px > x1 + 80) continue;
    const [sx, sy] = w2s(cam, W, H, px, py);
    const scale = Math.max(0.45, z);
    drawRacer(g, sx, sy, scale, pr, meta, view, px0);
    if (pr[4]) {                     // carrying a jawbreaker
      g.font = `${18 * scale}px sans-serif`; g.textAlign = 'center';
      g.fillText('⚪', sx + 24 * scale, sy - 10 * scale);
    }
    /* name tag */
    if (opts.names) {
      g.font = `600 ${Math.max(10, 13 * Math.min(1, z * 2))}px Fredoka, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = '#00000055';
      g.fillText(meta.name, sx + 1, sy - 68 * scale + 1);
      g.fillStyle = meta.color;
      g.fillText(meta.name, sx, sy - 68 * scale);
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

/* linear interpolation between two snapshots at blend u.
   len wraps x the short way around the seam. */
function lerpSnap(a, b, u, len) {
  if (!a) return b;
  const wrapLerp = (o, n) => {
    let d = n - o;
    if (len && d > len / 2) d -= len;
    if (len && d < -len / 2) d += len;
    let v = o + d * u;
    if (len) v = ((v % len) + len) % len;
    return v;
  };
  const byId = new Map(a.p.map((e) => [e[0], e]));
  const p = b.p.map((e) => {
    const o = byId.get(e[0]);
    if (!o) return e;
    const out = e.slice();
    out[1] = wrapLerp(o[1], e[1]);
    out[2] = o[2] + (e[2] - o[2]) * u;
    return out;
  });
  const jb = b.jb.map((e, i) => {
    const o = a.jb[i];
    if (!o) return e;
    return [wrapLerp(o[0], e[0]), o[1] + (e[1] - o[1]) * u, e[2]];
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
    <div class="rr-count-track"></div>
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
                     isHost: id === ctx.hostPlayerId(),
                     chars: CHAR_IDS.map((c) => ({ id: c, ...CHARS[c] })) });
    ctx.sendTo(id, { k: 'phase', ph: sim.phase, ...(sim.trk ? { segs: sim.trk.segs, tno: sim.trackNo, race: sim.race, total: RACE_COUNT } : {}) });
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
    broadcastPhase({ segs: sim.trk.segs, tno: sim.trackNo, race: sim.race, total: RACE_COUNT });
    sim.trk.theme = sim.trackNo;
    $q('.rr-count-track').textContent = `🏁 ${THEMES[sim.trackNo].name} · ${LAPS} laps`;
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
        broadcastPhase({ segs: sim.trk.segs, tno: sim.trackNo, race: sim.race, total: RACE_COUNT });
        sim.trk.theme = sim.trackNo;
        $q('.rr-count-track').textContent = `🏁 ${THEMES[sim.trackNo].name} · ${LAPS} laps`;
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
      view = lerpSnap(prevSnapH, curSnapH, u, sim.trk.len);
    } else view = { p: [], jb: [], bx: [], tick: sim.tick };
    lastView = view;

    /* camera: the course is a loop, so find the shortest arc that holds
       every racer (they may straddle the seam) and frame that */
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    const xs = view.p.map((pr) => pr[1]).sort((a, b) => a - b);
    if (xs.length) {
      const L = sim.trk.len;
      let gi = xs.length - 1, gBest = xs[0] + L - xs[xs.length - 1];
      for (let i = 0; i < xs.length - 1; i++) {
        if (xs[i + 1] - xs[i] > gBest) { gBest = xs[i + 1] - xs[i]; gi = i; }
      }
      const arc0 = xs[(gi + 1) % xs.length];       // arc starts after the biggest gap
      for (const pr of view.p) {
        const ux = arc0 + ((pr[1] - arc0 + L) % L);
        mnx = Math.min(mnx, ux); mxx = Math.max(mxx, ux);
        mny = Math.min(mny, pr[2]); mxy = Math.max(mxy, pr[2]);
      }
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
    let leadLap = 0;
    for (const pr of view.p) leadLap = Math.max(leadLap, (pr[10] || 0) + (pr[9] ? -1 : 0));
    $q('.rr-race-no').textContent =
      `Race ${sim.race}/${RACE_COUNT} · ${THEMES[sim.trackNo || 0].name}` +
      (sim.phase === 'race' ? ` · Lap ${Math.min(LAPS, leadLap + 1)}/${LAPS}` : '');
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
    mg.fillStyle = '#1a1a1a';
    for (const pt of trk.pits) mg.fillRect(mx(pt.x0), H - 10, Math.max(3, mx(pt.x1) - mx(pt.x0)), 7);
    mg.font = '12px sans-serif';
    mg.fillText('🏁', 4, 16);
    for (const pr of view.p) {
      const meta = seatMeta[pr[0]]; if (!meta) continue;
      const sy = 8 + ((pr[2] - mnY) / Math.max(1, mxY - mnY)) * (H - 16);
      mg.fillStyle = meta.color;
      mg.beginPath(); mg.arc(mx(pr[1]), Math.min(H - 6, Math.max(6, sy)), 5, 0, Math.PI * 2); mg.fill();
    }
  }

  function drawStandings(view) {
    const L = sim.trk.len;
    const rows = view.p.slice().sort((a, b) => {
      if (a[9] !== b[9]) return b[9] - a[9];
      if (a[9]) return a[7] - b[7];
      return ((b[10] || 0) * L + b[1]) - ((a[10] || 0) * L + a[1]);
    });
    $q('.rr-standings').innerHTML = rows.map((pr, i) => {
      const meta = seatMeta[pr[0]]; if (!meta) return '';
      const label = pr[9] ? (['🥇','🥈','🥉'][pr[7] - 1] || '#' + pr[7]) : '#' + (i + 1);
      const lapTag = pr[9] ? '🏁' : `L${Math.min(LAPS, (pr[10] || 0) + 1)}`;
      return `<span class="rr-chip" style="--c:${meta.color}">${label} ${CHARS[pr[8]] ? CHARS[pr[8]].emoji : ''} ${escapeHtml(meta.name)} <i class="rr-lap">${lapTag}</i></span>`;
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
      case 'next':
        if (playerId !== ctx.hostPlayerId()) break;
        if (sim.phase === 'results' || sim.phase === 'shop') sim.phaseT = 0;
        else if (sim.phase === 'race' && sim.firstFinT !== null) {
          sim.firstFinT = sim.raceT - DNF_GRACE - 1;     // end it for the stragglers
        }
        break;
      case 'lobby':
        if (sim.phase === 'podium' && playerId === ctx.hostPlayerId()) ctx.exit();
        break;
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
    <button class="rr-hostbtn rr-cendrace hidden">⏭ End race</button>
  </div>

  <div class="rr-cshop hidden">
    <h2>🛠️ Pit stop</h2>
    <div class="rr-ccoins"></div>
    <div class="rr-cshop-rows"></div>
    <button class="rr-btn rr-cdone">Ready for the next race ✅</button>
    <button class="rr-btn rr-hostonly rr-cskipshop hidden">🏎 Start the race now</button>
  </div>

  <div class="rr-cend hidden">
    <h2 class="rr-cend-title"></h2>
    <div class="rr-cend-body"></div>
    <button class="rr-btn rr-cnext hidden">Continue ▸</button>
    <button class="rr-btn rr-cagain hidden">🔄 Play again</button>
    <button class="rr-btn rr-hostonly rr-clobby hidden">⬅ Back to game menu</button>
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
    $q('.rr-cnext').addEventListener('click', () => ctx.send({ k: 'next' }));
    $q('.rr-cskipshop').addEventListener('click', () => ctx.send({ k: 'next' }));
    $q('.rr-cendrace').addEventListener('click', () => ctx.send({ k: 'next' }));
    $q('.rr-clobby').addEventListener('click', () => ctx.send({ k: 'lobby' }));

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
      isPartyHost = !!data.isHost;
      renderPick();
    } else if (data.k === 'phase') {
      phase = data.ph;
      if (data.segs) { trk = buildTrack(data.segs); trk.theme = data.tno || 0; }
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
        $q('.rr-clobby').classList.add('hidden');
        $q('.rr-cnext').classList.toggle('hidden', !isPartyHost);
        show('cend');
      }
      if (phase === 'shop') {
        $q('.rr-cdone').textContent = 'Ready for the next race ✅';
        $q('.rr-cskipshop').classList.toggle('hidden', !isPartyHost);
        show('cshop'); renderShop();
      }
      if (phase === 'podium' && data.rows) {
        const i = data.rows.findIndex((r) => r.seat === mySeat);
        $q('.rr-cend-title').textContent = i === 0 ? '👑 CHAMPION!' : `You finished #${i + 1}`;
        $q('.rr-cend-body').innerHTML = data.rows.map((r, ix) =>
          `<div>${['👑','🥈','🥉'][ix] || '#' + (ix + 1)} ${escapeHtml(r.name)} — ${r.pts} pts</div>`).join('');
        $q('.rr-cnext').classList.add('hidden');
        $q('.rr-cagain').classList.toggle('hidden', !isPartyHost);
        $q('.rr-clobby').classList.toggle('hidden', !isPartyHost);
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
    const view = lerpSnap(prev, cur, u, trk.len);
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

    /* fell down a pit */
    if (me && me[3] === ST.FALL) {
      g.fillStyle = '#00000066'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.font = '700 26px Fredoka, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('🕳️ Whoops!', W / 2, H / 2 - 16);
      g.font = '600 15px Fredoka, sans-serif';
      g.fillText('Jump right at the edge next time', W / 2, H / 2 + 16);
    }

    /* swim rhythm meter */
    if (me && me[3] === ST.SWIM) {
      g.fillStyle = '#00000055'; g.beginPath(); g.roundRect(W / 2 - 90, H - 34, 180, 22, 11); g.fill();
      g.fillStyle = '#4dabf7';
      g.beginPath(); g.roundRect(W / 2 - 86, H - 30, 172 * Math.min(1, me[6] / 8), 14, 7); g.fill();
      g.fillStyle = '#fff'; g.font = '600 12px Fredoka, sans-serif'; g.textAlign = 'center';
      g.fillText('TAP JUMP IN RHYTHM 🌊', W / 2, H - 44);
    }
    /* progress bar — the whole 3-lap race, with lap ticks */
    if (me) {
      g.fillStyle = '#00000033'; g.fillRect(0, 0, W, 6);
      const prog = me[9] ? 1 : Math.min(1, ((me[10] || 0) + me[1] / trk.len) / LAPS);
      g.fillStyle = myColor; g.fillRect(0, 0, W * prog, 6);
      g.fillStyle = '#ffffff88';
      for (let l = 1; l < LAPS; l++) g.fillRect(W * (l / LAPS) - 1, 0, 2, 6);
    }

    /* HUD */
    if (me) {
      const done = me[9] === 1;
      const tot = (pr) => (pr[10] || 0) * trk.len + pr[1];
      const rows = view.p.slice().sort((a, b) => (b[9] - a[9]) || (a[9] ? a[7] - b[7] : tot(b) - tot(a)));
      const pos = done ? me[7] : rows.findIndex((pr) => pr[0] === mySeat) + 1;
      $q('.rr-cpos').textContent = (['🥇','🥈','🥉'][pos - 1] || '#' + pos) +
        (done ? '' : ` · Lap ${Math.min(LAPS, (me[10] || 0) + 1)}/${LAPS}`);
      $q('.rr-citem').textContent = me[4] ? '⚪ jawbreaker ready!' : '';
      $q('.rr-b-throw').classList.toggle('rr-armed', !!me[4]);
      const cd = me[5] / 10;
      const cdEl = $q('.rr-cd');
      cdEl.style.height = cd > 0 ? Math.min(100, cd / 4 * 100) + '%' : '0%';
      if (done) $q('.rr-cmsg').textContent = '🏁 Finished!';
      $q('.rr-cendrace').classList.toggle('hidden', !(isPartyHost && view.dnf !== undefined));
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
  groundY, slopeAt, waterAt, nextWall, nearestCrestBehind, pitAt, wrapX, lerpSnap,
  CHARS, ST, TICK, PULSE_S, RACE_COUNT, LAPS, COSTS, LVL_MAX, PTS, PAY, THEMES,
};
