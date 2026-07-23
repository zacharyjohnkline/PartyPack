/* ============================================================
   Sweet Path — the candy board race, ported from the original
   single-file game into the party-pack module system.

   The board engine, cards, mash contest, Pong/Tron collision
   duels, Doodle Dash, and the Wheel of Fortune are the ORIGINAL
   code, extracted verbatim. Only the networking layer changed:
   the PeerJS room, QR/join flow, and host passcode are gone —
   the shell owns identity and routing now, and a small adapter
   below maps the game's old primitives (connsBySlot, safeSend,
   broadcastState…) onto ctx.sendTo / ctx.sendAll.

   Three.js loads lazily (only when a game actually starts), so
   phones and the Top Banana game never pay for it.
   ============================================================ */

let THREE = null;
let OrbitControls = null;
let enginePromise = null;

function loadEngine() {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
    ]).then(([t, oc]) => {
      THREE = t;
      OrbitControls = oc.OrbitControls;
    });
  }
  return enginePromise;
}

const HOST_HTML = `
<div id="canvas-container"></div>
  <div id="mash-screen">
    <div class="mash-card">
      <h2>Who Goes First?</h2>
      <div class="mash-sub" id="mash-sub">Everyone gets a button! When the clock starts, mash your key (or tap your pad) as fast as you can for 3 seconds. Most presses goes first, fewest goes last!</div>
      <div id="mash-countdown">Ready?</div>
      <div class="mash-pads" id="mash-pads"></div>
      <div id="mash-results"></div>
      <button class="start-btn" id="mash-action-btn">Start the Clock!</button>
    </div>
  </div>
  <div id="duel-screen">
    <div class="mash-card">
      <h2>⚡ Showdown! ⚡</h2>
      <div class="mash-sub" id="duel-sub"></div>
      <div id="duel-countdown">Ready?</div>
      <div class="mash-pads" id="duel-pads"></div>
      <div id="duel-results"></div>
      <button class="start-btn" id="duel-action-btn">Mash!</button>
    </div>
  </div>
  <div id="game-ui" style="display:none;">
    <div id="players-panel">
      <div class="players-title">PLAYERS</div>
      <div id="players-list"></div>
    </div>

    <div id="top-bar">
      <div id="current-player-token"></div>
      <div id="current-player-text"><strong id="cp-name">Player</strong>'s turn</div>
    </div>

    <div id="card-area">
      <div id="card-message"></div>
      <button id="bonus-draw-btn">🎁 Bonus Draw</button>
      <div style="display:flex; gap:24px; align-items:center;">
        <div id="deck"></div>
        <div id="drawn-card"></div>
      </div>
    </div>

    <div id="rainbow-panel">
      <div class="players-title">RAINBOW BONUS</div>
      <div id="rainbow-dots"></div>
      <div id="rainbow-note">Fill the rainbow — last new color wins a bonus draw!</div>
    </div>

    <div class="help-text">Drag to rotate • Scroll to zoom</div>
  </div>
  <div id="win-screen">
    <div class="win-card">
      <div class="crown">👑</div>
      <div class="winner-name" id="winner-name">Winner!</div>
      <div class="win-subtitle">reached the Sugar Castle first!</div>
      <button class="start-btn" id="play-again-btn">Play Again</button>
      <button class="start-btn" id="sp-menu-btn" style="margin-top:10px; background:linear-gradient(135deg,#8a5a78,#4a2545);">Back to Menu</button>
    </div>
  </div>
`;

const CTRL_HTML = `
<div id="sp-wrap">
  <div id="sp-status">Connecting…</div>
  <button id="sp-hostbtn" class="sp-action"></button>
  <div id="sp-pad">
    <button id="sp-mash" disabled>MASH!</button>
    <button id="sp-draw" class="sp-action" disabled>🃏 Draw Card</button>
    <button id="sp-bonus" class="sp-action">🎁 Bonus Draw</button>
  </div>
  <div id="sp-winctl">
    <button id="sp-again" class="sp-action">🔄 Play Again</button>
    <button id="sp-menu" class="sp-action sp-soft">⌂ Back to Menu</button>
  </div>
</div>
  <div id="mg-screen">
    <div id="mg-title"></div>
    <canvas id="mg-canvas"></canvas>
    <div id="mg-msg"></div>
    <div id="mg-tron-controls">
      <button class="mg-turn-btn" id="mg-left">⮌ TURN</button>
      <button class="mg-turn-btn" id="mg-right">TURN ⮎</button>
    </div>
  </div>

  <div id="wheel-screen">
    <div id="wheel-title">🎡 Wheel of Fortune!</div>
    <canvas id="wheel-canvas" width="300" height="300"></canvas>
    <button id="wheel-spin-btn" class="start-btn">SPIN!</button>
    <div id="wheel-result"></div>
  </div>
`;

/* ============================================================
   HOST (big screen)
   ============================================================ */
function createHost(ctx) {

  /* ============================================================
     Shell adapter — replaces the original PeerJS networking.
     The extracted game code below calls these exact names.
     ============================================================ */
  let gameStarted = false;
  let remotePressHandler = null; // set while a mash contest is running
  let activeMashKeyHandler = null;
  const connsBySlot = new Map(); // player slot -> shim "connection"
  const allConns = new Set();
  const slotByPid = new Map();   // shell playerId -> slot

  function safeSend(conn, msg) {
    if (conn && conn.open) { try { conn.send(msg); } catch (e) {} }
  }
  // The shell owns lobbies, rejoin QR codes, and host controls now:
  function broadcastHostState() {}
  function broadcastRoster() {}
  function renderLobbyRoster() {}
  function showRejoinPanel() {}
  function updatePhoneStatus() {}
  function refreshMashPadNames() {}

  function seatPlayer(p) {
    let pl = rosterPlayers.find((rp) => rp.deviceId === p.id);
    if (!pl) {
      pl = makePlayer(p.name, p.id);
      rosterPlayers.push(pl);
    }
    slotByPid.set(p.id, pl.slot);
    const conn = {
      open: p.connected !== false,
      _slot: pl.slot,
      send: (m) => ctx.sendTo(p.id, m),
    };
    connsBySlot.set(pl.slot, conn);
    allConns.add(conn);
    return pl;
  }

  function syncRosterFromShell() {
    for (const p of ctx.players()) if (p.connected) seatPlayer(p);
    rosterPlayers = rosterPlayers.filter((pl) => {
      const sp = ctx.players().find((p) => p.id === pl.deviceId);
      return sp && sp.connected;
    });
  }

  // The big screen's current action button, mirrored to the party host's
  // phone so they decide when the adventure starts.
  let pendingHostBtn = null; // { label, fire }
  function sendHostButton(label, fire) {
    pendingHostBtn = label ? { label, fire } : null;
    const pid = ctx.hostPlayerId && ctx.hostPlayerId();
    if (pid) ctx.sendTo(pid, { type: 'hostBtn', label: label || null });
  }

  function handlePhoneMsg(pid, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'hostBtnPress') {
      if (ctx.hostPlayerId && pid === ctx.hostPlayerId() && pendingHostBtn) pendingHostBtn.fire();
      return;
    }

    if (msg.type === 'winCtlAction') {
      if (ctx.hostPlayerId && pid === ctx.hostPlayerId()) {
        if (msg.action === 'again') rematch();
        else if (msg.action === 'menu') ctx.exit();
      }
      return;
    }

    const slot = slotByPid.get(pid);
    if (slot === undefined) return;

    if (msg.type === 'mgInput') {
      if (mgInputHandler) mgInputHandler(slot, msg);
      return;
    }
    if (msg.type === 'doodleProgress') {
      if (groupGame && groupGame.prog.has(slot) && typeof msg.h === 'number') {
        groupGame.prog.set(slot, Math.max(groupGame.prog.get(slot), Math.min(1, msg.h)));
      }
      return;
    }
    if (msg.type === 'doodleFinish') {
      if (groupGame) {
        const pl = groupGame.parts.find((pp) => pp.slot === slot);
        if (pl) { groupGame.prog.set(slot, 1); groupGame.end(pl); }
      }
      return;
    }
    if (msg.type === 'spin') {
      if (wheelPending && wheelPending.winner.slot === slot) doSpin(wheelPending.winner);
      return;
    }
    if (msg.type === 'press') {
      if (remotePressHandler) remotePressHandler(slot);
    } else if (msg.type === 'draw') {
      if (gameStarted && canDraw && players[currentPlayerIdx] && players[currentPlayerIdx].slot === slot && !players[currentPlayerIdx].finished) drawCard();
    } else if (msg.type === 'bonus') {
      if (gameStarted && canDraw && players[currentPlayerIdx] && players[currentPlayerIdx].slot === slot && !players[currentPlayerIdx].finished) useBonusDraw();
    }
  }

  /* ==== original game code (extracted verbatim, see header) ==== */
const COLORS = {
  red:    { hex: '#ff4d6d', three: 0xff4d6d },
  orange: { hex: '#ff9f4a', three: 0xff9f4a },
  yellow: { hex: '#ffd93d', three: 0xffd93d },
  green:  { hex: '#6bcf7f', three: 0x6bcf7f },
  blue:   { hex: '#4dabf7', three: 0x4dabf7 },
  purple: { hex: '#b380ff', three: 0xb380ff },
};

const COLOR_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

// Special locations along the path. Each has a path index they sit at.
// They are landmark spaces — drawing the matching special card jumps you there.
const SPECIAL_SPOTS = [
  { name: 'Lollipop Meadow',    icon: '🍭', pathIndex: 8,  color: '#ff85b3' },
  { name: 'Gummy Grove',        icon: '🐻', pathIndex: 18, color: '#ffb84d' },
  { name: 'Chocolate Falls',    icon: '🍫', pathIndex: 30, color: '#8b5a2b' },
  { name: 'Cupcake Hill',       icon: '🧁', pathIndex: 42, color: '#ff7eb3' },
  { name: 'Doughnut Lake',      icon: '🍩', pathIndex: 54, color: '#ffa07a' },
];

// Sticky spots — landing here makes you skip your next turn.
const STICKY_SPOTS = [22, 47];

// Rainbow Bridge shortcut — landing on or drawing this card teleports you forward.
const SHORTCUT = { from: 12, to: 38 };

const TOTAL_SPACES = 64; // including start (0) and castle (63)

let rosterPlayers = [];   // everyone who has joined; persists across rematches
let nextSlot = 0;         // ever-increasing join index
let contestGen = 0;       // invalidates stale mash/duel timers after a restart
let gameGen = 0;          // invalidates stale turn callbacks after a restart
let engineReady = false;  // three.js scene initialized once
const setupScreen = document.getElementById('setup-screen');

const HUE_BASE = Math.random() * 360; // random palette rotation per session
function colorForIndex(i) {
  const h = (HUE_BASE + i * 137.508) % 360; // golden angle → maximally spread
  const sat = 0.78, lig = 0.55;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Keyboard keys for players who want to mash on the big screen's keyboard.
// Phone pads always work; players beyond the key pool are phone-only.
const KEY_POOL = ['A', 'F', 'J', 'L', 'B', 'Q', 'E', 'U', 'O', 'P'];
const MASH_DURATION_MS = 3000;

function makePlayer(name, deviceId) {
  const slot = nextSlot++;
  const hex = colorForIndex(slot);
  return {
    name,
    deviceId: deviceId || null,
    slot,
    key: KEY_POOL[slot] || null,
    color: { hex, three: parseInt(hex.slice(1), 16) },
    position: 0,
    skipNext: false,
    finished: false,
    bonusDraws: 0,
  };
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Start (or restart) a round with everyone currently in the roster
function beginRound() {
  if (rosterPlayers.length < 2) return;
  gameGen++;
  contestGen++;
  mgSession++;
  mgInputHandler = null;
  groupGame = null;
  wheelPending = null;
  roundTurnCounter = 0;
  gameStarted = true;
  rosterPlayers.forEach(pl => {
    pl.position = 0;
    pl.skipNext = false;
    pl.finished = false;
    pl.bonusDraws = 0;
  });
  rainbowCollected.clear();
  clearTimeout(rainbowNoteTimer);
  bonusDrawPending = false;
  remotePressHandler = null;
  canDraw = false; // startGame re-enables after the opening mash
  currentPlayerIdx = 0;
  if (drawnCardEl) drawnCardEl.classList.remove('show');
  if (cardMessage) cardMessage.classList.remove('show');

  // Reset the mash screen from any previous state
  const resultsEl = document.getElementById('mash-results');
  resultsEl.classList.remove('show');
  resultsEl.innerHTML = '';
  document.getElementById('mash-pads').style.display = '';
  document.getElementById('mash-sub').textContent = 'Mash your button (phone pad or key) for 3 seconds. Most presses goes first, fewest goes last! The party host\u2019s phone starts the clock. \ud83d\udc51';
  const cd = document.getElementById('mash-countdown');
  cd.classList.remove('go');
  cd.textContent = 'Ready?';

  document.getElementById('win-screen').classList.remove('show');
  document.getElementById('duel-screen').classList.remove('show');
  document.getElementById('game-ui').style.display = 'none';
  showMashScreen([...rosterPlayers].sort((a, b) => a.slot - b.slot));
  broadcastRoster();
}


function showMashScreen(pendingPlayers) {
  const gen = ++contestGen; // a rematch invalidates this contest's timers
  const screen = document.getElementById('mash-screen');
  const padsEl = document.getElementById('mash-pads');
  const countdownEl = document.getElementById('mash-countdown');
  const resultsEl = document.getElementById('mash-results');
  const actionBtn = document.getElementById('mash-action-btn');
  const subEl = document.getElementById('mash-sub');

  const counts = new Array(pendingPlayers.length).fill(0);
  let mashing = false;
  let countdownStarted = false;
  let autoStartTimer = null;
  let countdownTimer = null;
  let endTimer = null;
  let tickTimer = null;

  // Build a pad for each player
  padsEl.innerHTML = '';
  const padEls = pendingPlayers.map((p, i) => {
    const pad = document.createElement('button');
    pad.className = 'mash-pad';
    pad.style.background = `linear-gradient(160deg, ${p.color.hex}, ${p.color.hex}cc)`;
    pad.innerHTML = `
      <div class="mp-name">${escapeHtml(p.name)}</div>
      <div class="mp-key">${p.key || '📱'}</div>
      <div class="mp-count">0</div>
    `;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      registerPress(i);
    });
    padsEl.appendChild(pad);
    return pad;
  });

  function registerPress(i) {
    if (!mashing) return;
    counts[i]++;
    const countEl = padEls[i].querySelector('.mp-count');
    countEl.textContent = counts[i];
    padEls[i].classList.add('hit');
    setTimeout(() => padEls[i].classList.remove('hit'), 60);
  }

  function onKeyDown(e) {
    if (e.repeat) return;
    const idx = pendingPlayers.findIndex(p => p.key === e.key.toUpperCase());
    if (idx !== -1) {
      e.preventDefault();
      registerPress(idx);
    }
  }
  activeMashKeyHandler = onKeyDown;
  window.addEventListener('keydown', onKeyDown);

  function startCountdown() {
    clearTimeout(autoStartTimer);
    if (countdownStarted) return;
    countdownStarted = true;
    sendHostButton(null);
    actionBtn.style.display = 'none';
    broadcastHostState();
    let n = 3;
    countdownEl.classList.remove('go');
    countdownEl.textContent = n;
    countdownTimer = setInterval(() => {
      if (gen !== contestGen) { clearInterval(countdownTimer); return; }
      n--;
      if (n > 0) {
        countdownEl.textContent = n;
      } else {
        clearInterval(countdownTimer);
        beginMash();
      }
    }, 800);
  }

  function beginMash() {
    if (gen !== contestGen) return;
    mashing = true;
    countdownEl.classList.add('go');
    const start = performance.now();
    tickTimer = setInterval(() => {
      if (gen !== contestGen) { clearInterval(tickTimer); return; }
      const remaining = Math.max(0, MASH_DURATION_MS - (performance.now() - start));
      countdownEl.textContent = `MASH! ${(remaining / 1000).toFixed(1)}s`;
    }, 50);
    endTimer = setTimeout(finishMash, MASH_DURATION_MS);
  }

  function finishMash() {
    if (gen !== contestGen) { window.removeEventListener('keydown', onKeyDown); return; }
    mashing = false;
    clearInterval(tickTimer);
    window.removeEventListener('keydown', onKeyDown);
    remotePressHandler = null;
    broadcastState();
    countdownEl.classList.remove('go');
    countdownEl.textContent = 'Time!';

    // Sort by presses, most first. Ties are shuffled fairly.
    const order = pendingPlayers
      .map((p, i) => ({ player: p, presses: counts[i], tiebreak: Math.random() }))
      .sort((a, b) => b.presses - a.presses || a.tiebreak - b.tiebreak);

    // Show results
    const ordinal = (n) => {
      const t = n % 100;
      if (t >= 11 && t <= 13) return n + 'th';
      return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    };
    resultsEl.innerHTML = '';
    order.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'mash-result-row';
      row.innerHTML = `
        <div class="mr-place">${ordinal(i + 1)}</div>
        <div class="mr-token" style="background:${entry.player.color.hex};"></div>
        <div class="mr-name">${escapeHtml(entry.player.name)}</div>
        <div class="mr-count">${entry.presses} press${entry.presses === 1 ? '' : 'es'}</div>
      `;
      resultsEl.appendChild(row);
    });
    padsEl.style.display = 'none';
    resultsEl.classList.add('show');
    subEl.textContent = `${order[0].player.name} goes first!`;

    actionBtn.textContent = 'Begin Adventure!';
    actionBtn.style.display = '';
    let advanced = false;
    const advance = () => {
      if (advanced || gen !== contestGen) return;
      advanced = true;
      sendHostButton(null);
      loadEngine().then(() => {
        if (gen !== contestGen) return;
        screen.classList.remove('show');
        document.getElementById('game-ui').style.display = 'block';
        startGame(order.map(e => e.player));
      }).catch(() => {});
    };
    actionBtn.onclick = advance;
    sendHostButton('Begin Adventure!', advance);
  }

  actionBtn.textContent = 'Start the Clock!';
  actionBtn.onclick = startCountdown;
  sendHostButton('Start the Clock!', startCountdown);
  screen.classList.add('show');

  // Route phone-controller presses into this contest
  remotePressHandler = (slot) => {
    const idx = pendingPlayers.findIndex(p => p.slot === slot);
    if (idx !== -1) registerPress(idx);
  };
  broadcastState();
}

// ===== Build path =====
// Generate a winding path of TOTAL_SPACES points in 3D space.
// All points share the same Y so tiles rest flat on the ground plane.
// Points are spaced evenly by arc length, not by parameter t — otherwise
// the inward spiral would crowd tiles together near the center.
const TILE_HEIGHT = 0.4;
const TILE_REST_Y = TILE_HEIGHT / 2; // tile center sits at half-height so its bottom touches y=0
const TILE_TOP_Y = TILE_HEIGHT;       // top surface of the tile

function buildPath() {
  // Step 1: sample the spiral curve densely
  const samples = 2000;
  const dense = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // Use a gentler radius decay so the inner loops have room
    // Outer radius 24, inner radius 4 (was 22 -> 4)
    const angle = t * Math.PI * 4.2;
    const radius = 24 - t * 20;
    const x = Math.cos(angle) * radius + Math.sin(t * Math.PI * 7) * 1.0;
    const z = Math.sin(angle) * radius + Math.cos(t * Math.PI * 7) * 1.0;
    dense.push(new THREE.Vector3(x, TILE_REST_Y, z));
  }

  // Step 2: compute cumulative arc length
  const cumLengths = [0];
  for (let i = 1; i < dense.length; i++) {
    const segLen = dense[i].distanceTo(dense[i - 1]);
    cumLengths.push(cumLengths[i - 1] + segLen);
  }
  const totalLength = cumLengths[cumLengths.length - 1];

  // Step 3: pick TOTAL_SPACES points evenly distributed by arc length
  const points = [];
  const targetSpacing = totalLength / (TOTAL_SPACES - 1);
  let denseIdx = 0;
  for (let i = 0; i < TOTAL_SPACES; i++) {
    const targetDist = i * targetSpacing;
    // Walk forward until we straddle the target distance
    while (denseIdx < cumLengths.length - 1 && cumLengths[denseIdx + 1] < targetDist) {
      denseIdx++;
    }
    // Linear interpolate between dense[denseIdx] and dense[denseIdx+1]
    if (denseIdx >= dense.length - 1) {
      points.push(dense[dense.length - 1].clone());
    } else {
      const segStart = cumLengths[denseIdx];
      const segEnd = cumLengths[denseIdx + 1];
      const segFrac = (targetDist - segStart) / (segEnd - segStart);
      const p = new THREE.Vector3().lerpVectors(dense[denseIdx], dense[denseIdx + 1], segFrac);
      points.push(p);
    }
  }
  return points;
}


// ===== Three.js scene =====
let scene, camera, renderer, controls;
let rafId = 0;
let followDist = 16;      // camera distance sized to show ~3 tiles ahead & behind
let lastUserOrbit = -99999; // when the user last dragged/zoomed manually
let pathPoints = [];
let pawns = [];
let players = [];
let currentPlayerIdx = 0;
let canDraw = true;
let cardArea, deck, drawnCardEl, cardMessage;
const shortcutMarkers = [];

function initThree() {
  const container = document.getElementById('canvas-container');

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffe4f1, 50, 120);

  // Sky gradient backdrop
  const skyGeo = new THREE.SphereGeometry(80, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0xffd6e8) },
      bottomColor: { value: new THREE.Color(0xc5e1ff) },
    },
    vertexShader: `varying vec3 vWorldPos; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWorldPos = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp;}`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; varying vec3 vWorldPos; void main(){ float h = normalize(vWorldPos).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottomColor, topColor, h), 1.0);}`
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  camera = new THREE.PerspectiveCamera(45, window.innerWidth/window.innerHeight, 0.1, 200);
  camera.position.set(0, 35, 35);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 70;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.enablePan = false; // the follow camera drives the target
  controls.addEventListener('start', () => { lastUserOrbit = performance.now(); });

  // Lighting
  const ambient = new THREE.AmbientLight(0xfff0f5, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(20, 30, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xffd6e8, 0.3);
  fill.position.set(-20, 10, -10);
  scene.add(fill);

  // Ground
  const groundGeo = new THREE.CircleGeometry(50, 64);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xc8f0d2,
    roughness: 0.85,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // Sprinkle decorations on ground
  addGroundDecorations();

  window.addEventListener('resize', onResize);
}

function addGroundDecorations() {
  // Random candy decorations in the background
  const decoColors = [0xff85b3, 0xffd93d, 0x6bcf7f, 0x4dabf7, 0xb380ff];
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 26 + Math.random() * 20;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const type = Math.floor(Math.random() * 3);
    let mesh;
    const color = decoColors[Math.floor(Math.random()*decoColors.length)];
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    if (type === 0) {
      // gumdrop
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random()*0.6, 12, 8, 0, Math.PI*2, 0, Math.PI/2), mat);
      mesh.position.set(x, 0, z);
    } else if (type === 1) {
      // lollipop
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8), new THREE.MeshStandardMaterial({color: 0xffffff}));
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), mat);
      top.position.y = 1.0;
      mesh = new THREE.Group();
      mesh.add(stick);
      mesh.add(top);
      mesh.position.set(x, 0.6, z);
    } else {
      // cone
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 8), mat);
      mesh.position.set(x, 0.4, z);
    }
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // Cloud-like puffs in distance
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Group();
    const cmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random()*0.8, 12, 8), cmat);
      puff.position.set(j*1.2 - 2, Math.random()*0.5, Math.random()*0.8);
      cloud.add(puff);
    }
    const angle = Math.random() * Math.PI * 2;
    cloud.position.set(Math.cos(angle)*45, 12 + Math.random()*5, Math.sin(angle)*45);
    cloud.scale.setScalar(0.8 + Math.random()*0.6);
    scene.add(cloud);
  }
}

function buildBoard() {
  pathPoints = buildPath();

  // Build the path tiles
  for (let i = 0; i < TOTAL_SPACES; i++) {
    const p = pathPoints[i];
    let colorKey;
    if (i === 0) {
      // Start tile (special)
      colorKey = null;
    } else if (i === TOTAL_SPACES - 1) {
      colorKey = null;
    } else {
      colorKey = COLOR_ORDER[(i - 1) % COLOR_ORDER.length];
    }

    const isSticky = STICKY_SPOTS.includes(i);
    const specialSpot = SPECIAL_SPOTS.find(s => s.pathIndex === i);

    let tileColor;
    if (i === 0) tileColor = 0xfff8f0;
    else if (i === TOTAL_SPACES - 1) tileColor = 0xffd93d;
    else if (specialSpot) tileColor = parseInt(specialSpot.color.replace('#',''), 16);
    else tileColor = COLORS[colorKey].three;

    // Tile geometry — rounded square
    const tileGeo = new THREE.BoxGeometry(2, 0.4, 2);
    const tileMat = new THREE.MeshStandardMaterial({
      color: tileColor,
      roughness: 0.4,
      metalness: 0.05,
    });
    const tile = new THREE.Mesh(tileGeo, tileMat);
    tile.position.copy(p);
    tile.castShadow = true;
    tile.receiveShadow = true;

    // Align tile rotation to the path direction (like a stroke aligned to a curve)
    // Use neighboring path points to compute the tangent, projected onto the ground plane
    const prev = pathPoints[Math.max(0, i - 1)];
    const next = pathPoints[Math.min(TOTAL_SPACES - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    tile.rotation.y = Math.atan2(dx, dz);

    scene.add(tile);

    // Decorations for special tiles
    if (specialSpot) {
      addLandmark(p, specialSpot, tile.rotation.y);
    } else if (isSticky) {
      addStickyDecoration(p);
    } else if (i === 0) {
      addStartDecoration(p);
    } else if (i === TOTAL_SPACES - 1) {
      addCastleDecoration(p);
    }

    // Tile number sprite (small)
    // skip — too cluttered
  }

  // Rainbow Bridge shortcut visualization
  addShortcutBridge();
}

function addShortcutBridge() {
  const fromPos = pathPoints[SHORTCUT.from];
  const toPos = pathPoints[SHORTCUT.to];

  // Create an arched curve from tile top to tile top
  const mid = new THREE.Vector3(
    (fromPos.x + toPos.x) / 2,
    TILE_TOP_Y + 6,
    (fromPos.z + toPos.z) / 2
  );
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(fromPos.x, TILE_TOP_Y + 0.1, fromPos.z),
    mid,
    new THREE.Vector3(toPos.x, TILE_TOP_Y + 0.1, toPos.z)
  );

  // Build the rainbow as 6 stacked colored tubes
  const rainbowColors = [0xff4d6d, 0xff9f4a, 0xffd93d, 0x6bcf7f, 0x4dabf7, 0xb380ff];
  const segments = 64;
  const points = curve.getPoints(segments);

  rainbowColors.forEach((color, i) => {
    // Offset each band slightly to the side using the curve normal
    const offsetPoints = points.map((pt, idx) => {
      const tangent = idx < points.length - 1
        ? points[idx + 1].clone().sub(pt).normalize()
        : pt.clone().sub(points[idx - 1]).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const offset = (i - (rainbowColors.length - 1) / 2) * 0.18;
      return pt.clone().add(side.multiplyScalar(offset));
    });
    const bandCurve = new THREE.CatmullRomCurve3(offsetPoints);
    const tubeGeo = new THREE.TubeGeometry(bandCurve, segments, 0.12, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      emissive: color,
      emissiveIntensity: 0.15,
    });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.castShadow = true;
    scene.add(tube);
  });

  // Cloud puffs at each end of the bridge — sitting on top of the tiles
  [fromPos, toPos].forEach(pos => {
    const cloud = new THREE.Group();
    const cmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    for (let j = 0; j < 5; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.3, 12, 8), cmat);
      puff.position.set((Math.random() - 0.5) * 1.5, Math.random() * 0.4, (Math.random() - 0.5) * 1.5);
      cloud.add(puff);
    }
    cloud.position.set(pos.x, TILE_TOP_Y + 0.6, pos.z);
    cloud.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(cloud);
  });

  // Glowing markers on the from/to tiles — floating just above the tile surface
  [SHORTCUT.from, SHORTCUT.to].forEach((idx, i) => {
    const p = pathPoints[idx];
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.35, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffd93d,
        emissive: 0xffd93d,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      })
    );
    star.position.set(p.x, TILE_TOP_Y + 0.6, p.z);
    star.userData.isShortcutMarker = true;
    star.userData.spinSpeed = 0.02;
    scene.add(star);
    shortcutMarkers.push(star);
  });

  // "RAINBOW BRIDGE" floating label at the apex
  const labelTex = createTextTexture('RAINBOW BRIDGE', '#b380ff');
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true }));
  label.position.copy(mid);
  label.position.y += 1.5;
  label.scale.set(5, 1.25, 1);
  scene.add(label);
}

function addLandmark(pos, spot, tileRotationY) {
  const color = parseInt(spot.color.replace('#',''), 16);

  // Compute "side" direction perpendicular to the path tangent at this tile.
  // Tile rotation Y was set so the tile's local Z aligns with the path; we want
  // to push the landmark perpendicular to that on the ground plane.
  const sideDir = new THREE.Vector3(Math.cos(tileRotationY), 0, -Math.sin(tileRotationY));
  // Push toward whichever side faces away from the spiral center for clarity
  const towardCenter = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
  if (sideDir.dot(towardCenter) > 0) sideDir.multiplyScalar(-1);

  const sideDistance = 4.5;
  const landmarkPos = new THREE.Vector3(
    pos.x + sideDir.x * sideDistance,
    pos.y,
    pos.z + sideDir.z * sideDistance
  );

  // === Add colored glow ring on the actual tile ===
  addTileGlow(pos, spot.color, tileRotationY);

  // === Connector line from tile top to landmark base ===
  const lineStart = new THREE.Vector3(pos.x, TILE_TOP_Y, pos.z);
  const lineEnd = new THREE.Vector3(landmarkPos.x, 0.3, landmarkPos.z);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([lineStart, lineEnd]);
  const lineMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    linewidth: 2,
  });
  const line = new THREE.Line(lineGeo, lineMat);
  scene.add(line);

  // Small dot where the line meets the landmark
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 12, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
  );
  dot.position.copy(lineEnd);
  scene.add(dot);

  // === The landmark sculpture itself, placed off to the side, planted on the ground ===
  const group = new THREE.Group();
  group.position.set(landmarkPos.x, 0, landmarkPos.z);

  if (spot.icon === '🍭') {
    // Lollipop tower
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 3, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    );
    stick.position.y = 1.5;
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 24, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.3 })
    );
    top.position.y = 3.2;
    const swirl = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.15, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
    );
    swirl.position.y = 3.2;
    swirl.rotation.x = Math.PI / 2;
    group.add(stick, top, swirl);
  } else if (spot.icon === '🐻') {
    // Gummy bear
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.2, transmission: 0.3, thickness: 0.5 })
    );
    body.position.y = 1;
    const head = body.clone();
    head.scale.setScalar(0.7);
    head.position.y = 2.3;
    const ear1 = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), body.material);
    ear1.position.set(-0.5, 2.8, 0);
    const ear2 = ear1.clone();
    ear2.position.x = 0.5;
    group.add(body, head, ear1, ear2);
  } else if (spot.icon === '🍫') {
    // Chocolate stack
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(2 - i*0.3, 0.5, 1.2 - i*0.2),
        new THREE.MeshStandardMaterial({ color: 0x6b3410 + i*0x110000, roughness: 0.5 })
      );
      bar.position.y = 0.3 + i * 0.55;
      bar.rotation.y = i * 0.2;
      group.add(bar);
    }
  } else if (spot.icon === '🧁') {
    // Cupcake
    const wrapper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.6, 1.2, 16),
      new THREE.MeshStandardMaterial({ color: 0xff85b3, roughness: 0.5 })
    );
    wrapper.position.y = 0.6;
    const frosting = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12, 0, Math.PI*2, 0, Math.PI/2),
      new THREE.MeshStandardMaterial({ color: 0xfff0f5, roughness: 0.3 })
    );
    frosting.position.y = 1.4;
    const cherry = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.2 })
    );
    cherry.position.y = 2.2;
    group.add(wrapper, frosting, cherry);
  } else if (spot.icon === '🍩') {
    // Doughnut on water
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2, 0.2, 24),
      new THREE.MeshStandardMaterial({ color: 0xff9f4a, roughness: 0.3, metalness: 0.2 })
    );
    water.position.y = 0.1;
    const donut = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.4, 12, 24),
      new THREE.MeshStandardMaterial({ color: 0xffe0c2, roughness: 0.5 })
    );
    donut.position.y = 0.8;
    donut.rotation.x = Math.PI / 2;
    const glaze = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.42, 12, 24, Math.PI*1.6),
      new THREE.MeshStandardMaterial({ color: 0xff85b3, roughness: 0.3 })
    );
    glaze.position.y = 0.95;
    glaze.rotation.x = Math.PI / 2;
    group.add(water, donut, glaze);
  }

  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(group);

  // Floating label above the landmark
  const labelTex = createTextTexture(spot.name, spot.color);
  const labelMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true });
  const label = new THREE.Sprite(labelMat);
  label.position.set(landmarkPos.x, 4.5, landmarkPos.z);
  label.scale.set(4, 1, 1);
  scene.add(label);
}

function addTileGlow(pos, hexColor, rotationY) {
  // Soft additive glow halo on the ground around the tile
  const glowTex = createSquareGlowTexture(hexColor);
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const glowGeo = new THREE.PlaneGeometry(4.5, 4.5);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.set(pos.x, 0.02, pos.z);
  glow.rotation.x = -Math.PI / 2;
  glow.rotation.z = -rotationY;
  glow.renderOrder = 0;
  scene.add(glow);
}

function createSquareGlowTexture(hexColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  // Square-ish radial gradient — strongest at the edges of the tile, fading outward
  const grad = ctx.createRadialGradient(128, 128, 50, 128, 128, 128);
  grad.addColorStop(0, hexColor + '00');
  grad.addColorStop(0.35, hexColor + '00');
  grad.addColorStop(0.55, hexColor + 'cc');
  grad.addColorStop(0.75, hexColor + '55');
  grad.addColorStop(1, hexColor + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function addStickyDecoration(pos) {
  // Sticky goo puddle resting on the ground
  const puddle = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.2, 0.15, 24),
    new THREE.MeshStandardMaterial({ color: 0x6b3410, roughness: 0.2, metalness: 0.4 })
  );
  puddle.position.set(pos.x, 0.08, pos.z);
  scene.add(puddle);

  for (let i = 0; i < 3; i++) {
    const bubbleSize = 0.2 + Math.random() * 0.15;
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(bubbleSize, 12, 8),
      puddle.material
    );
    bubble.position.set(
      pos.x + (Math.random() - 0.5) * 1.5,
      bubbleSize,
      pos.z + (Math.random() - 0.5) * 1.5
    );
    scene.add(bubble);
  }
}

function addStartDecoration(pos) {
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.3, 12, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xff85b3, roughness: 0.4 })
  );
  // Arch base sits on the ground; torus center is at the arch top
  arch.position.set(pos.x, 0, pos.z);
  scene.add(arch);

  const labelTex = createTextTexture('START', '#ff4d6d');
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true }));
  label.position.set(pos.x, 2.5, pos.z);
  label.scale.set(3, 0.75, 1);
  scene.add(label);
}

function addCastleDecoration(pos) {
  const group = new THREE.Group();
  // Plant the castle on the ground rather than at the tile's center height
  group.position.set(pos.x, 0, pos.z);

  // Castle base — sits flush on the ground (height 2, center at y=1)
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 2, 2.5),
    new THREE.MeshStandardMaterial({ color: 0xfff0f5, roughness: 0.6 })
  );
  base.position.y = 1;
  group.add(base);

  // Towers — height 3, base at ground level so center at y=1.5
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xffb3d9, roughness: 0.5 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.4 });
  const positions = [[-1.3, 0, -1.3], [1.3, 0, -1.3], [-1.3, 0, 1.3], [1.3, 0, 1.3]];
  positions.forEach(([x, y, z]) => {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 12), towerMat);
    tower.position.set(x, 1.5, z);
    group.add(tower);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.2, 12), roofMat);
    roof.position.set(x, 3.6, z);
    group.add(roof);
  });

  // Center spire — height 4, base at ground, center at y=2
  const center = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4, 12), towerMat);
  center.position.y = 2;
  group.add(center);
  const centerRoof = new THREE.Mesh(new THREE.ConeGeometry(1, 1.6, 12), roofMat);
  centerRoof.position.y = 4.8;
  group.add(centerRoof);

  // Flag pole and flag on top of the spire
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.5, 6), new THREE.MeshStandardMaterial({color: 0x6b3410}));
  pole.position.y = 6.35;
  group.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshStandardMaterial({ color: 0xffd93d, side: THREE.DoubleSide }));
  flag.position.set(0.4, 6.85, 0);
  group.add(flag);

  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(group);

  const labelTex = createTextTexture('SUGAR CASTLE', '#ff4d6d');
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true }));
  label.position.set(pos.x, 8.5, pos.z);
  label.scale.set(4.5, 1.1, 1);
  scene.add(label);
}

function createTextTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  // rounded rect
  const r = 40;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(canvas.width - r, 0);
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r);
  ctx.lineTo(canvas.width, canvas.height - r);
  ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height);
  ctx.lineTo(r, canvas.height);
  ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 56px Bowlby One SC, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

function createPawn(playerColor, idx) {
  const group = new THREE.Group();

  // Body — rounded teardrop
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 16, 12),
    new THREE.MeshStandardMaterial({
      color: playerColor.three,
      roughness: 0.35,
      metalness: 0.1,
      emissive: playerColor.three,
      emissiveIntensity: 0.25,
    })
  );
  body.position.y = 0.55;
  body.scale.y = 1.2;

  // Base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.5, 0.2, 16),
    new THREE.MeshStandardMaterial({
      color: playerColor.three,
      roughness: 0.4,
      emissive: playerColor.three,
      emissiveIntensity: 0.2,
    })
  );
  base.position.y = 0.1;

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x222244 });
  const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), eyeMat);
  eye1.position.set(-0.15, 0.7, 0.38);
  const eye2 = eye1.clone();
  eye2.position.x = 0.15;
  const pupil1 = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pupilMat);
  pupil1.position.set(-0.15, 0.7, 0.45);
  const pupil2 = pupil1.clone();
  pupil2.position.x = 0.15;

  // Glowing ring under pawn (always visible from above)
  const ringGeo = new THREE.RingGeometry(0.55, 0.85, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: playerColor.three,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.renderOrder = 1;

  // Outer halo sprite — soft colored glow that's visible from any angle
  const haloTex = createHaloTexture(playerColor.hex);
  const haloMat = new THREE.SpriteMaterial({
    map: haloTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(2.2, 2.2, 1);
  halo.position.y = 0.7;
  halo.renderOrder = 0;

  group.add(halo, ring, base, body, eye1, eye2, pupil1, pupil2);
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });

  // Stash references for animation
  group.userData.halo = halo;
  group.userData.ring = ring;
  group.userData.bodyMat = body.material;
  group.userData.baseMat = base.material;

  return group;
}

function createHaloTexture(hexColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, hexColor + 'ff');
  grad.addColorStop(0.3, hexColor + 'aa');
  grad.addColorStop(0.6, hexColor + '33');
  grad.addColorStop(1, hexColor + '00');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function spawnPawns() {
  const startPos = pathPoints[0];
  players.forEach((p, i) => {
    const pawn = createPawn(p.color, i);
    // Stagger pawns at start so they don't overlap
    const offset = pawnOffset(i, players.length);
    // Pawns rest on TOP of the tile, not inside it
    pawn.position.set(startPos.x + offset.x, TILE_TOP_Y, startPos.z + offset.z);
    pawn.userData.baseY = TILE_TOP_Y;
    pawn.userData.moving = false;
    scene.add(pawn);
    pawns.push(pawn);
  });
}

function pawnOffset(idx, total) {
  if (total === 1) return { x: 0, z: 0 };
  const angle = (idx / total) * Math.PI * 2;
  const r = Math.min(1.3, 0.35 + total * 0.09); // widen the ring for big groups
  return { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  rafId = requestAnimationFrame(animate);

  // ===== Follow camera =====
  // Glide the orbit target to the active player's pawn each frame. The user
  // can still drag to rotate and pinch/scroll to zoom; a few seconds after
  // they let go, the zoom eases back to the follow distance.
  const activePawn = pawns[currentPlayerIdx];
  if (activePawn) {
    const desired = new THREE.Vector3(activePawn.position.x, TILE_TOP_Y, activePawn.position.z);
    const offset = camera.position.clone().sub(controls.target);
    if (performance.now() - lastUserOrbit > 3000) {
      const len = offset.length();
      offset.setLength(len + (followDist - len) * 0.03);
    }
    controls.target.lerp(desired, 0.07);
    camera.position.copy(controls.target).add(offset);
  }

  controls.update();

  const t = performance.now() * 0.003;

  // Spin and bob the shortcut markers
  shortcutMarkers.forEach((marker, i) => {
    marker.rotation.y += 0.03;
    marker.position.y += Math.sin(t * 2 + i) * 0.005;
  });

  // Bob current player's pawn slightly + pulse their halo
  pawns.forEach((pawn, i) => {
    const baseY = pawn.userData.baseY ?? 0;
    if (i === currentPlayerIdx && !players[i].finished && !pawn.userData.moving) {
      pawn.position.y = baseY + Math.sin(t * 2) * 0.08 + 0.08;
      pawn.rotation.y = Math.sin(t) * 0.15;
      // Pulse the halo for the active player
      if (pawn.userData.halo) {
        const pulse = 0.7 + Math.sin(t * 3) * 0.25;
        pawn.userData.halo.material.opacity = pulse;
        pawn.userData.halo.scale.setScalar(2.2 + Math.sin(t * 3) * 0.2);
      }
    } else if (!pawn.userData.moving) {
      // Idle pawn — sit at rest, dim halo
      pawn.position.y = baseY;
      pawn.rotation.y = 0;
      if (pawn.userData.halo) {
        pawn.userData.halo.material.opacity = 0.35;
        pawn.userData.halo.scale.setScalar(1.8);
      }
    }
  });

  renderer.render(scene, camera);
}


// ===== Game logic =====
function startGame(plyrs) {
  players = plyrs;
  gameStarted = true;
  currentPlayerIdx = 0;
  canDraw = true;
  bonusDrawPending = false;
  showRejoinPanel();
  if (!engineReady) {
    initThree();
    buildBoard();
  } else {
    // Rematch: clear the old pawns off the board
    pawns.forEach(pw => scene.remove(pw));
    pawns = [];
  }
  spawnPawns();
  // Size the follow camera so roughly 3 tiles ahead and 3 behind are in view
  const tileSpacing = pathPoints[1].distanceTo(pathPoints[2]);
  followDist = tileSpacing * 5.5;
  cardArea = document.getElementById('card-area');
  deck = document.getElementById('deck');
  drawnCardEl = document.getElementById('drawn-card');
  cardMessage = document.getElementById('card-message');
  deck.classList.remove('disabled');
  drawnCardEl.classList.remove('show');
  cardMessage.classList.remove('show');

  if (!engineReady) {
    deck.addEventListener('click', drawCard);
    document.getElementById('bonus-draw-btn').addEventListener('click', useBonusDraw);
  }
  initRainbowPanel();
  updateRainbowDots();

  updatePlayerPanel();
  updateTopBar();
  updateBonusButton();
  if (!engineReady) {
    engineReady = true;
    animate();
  }
}

// ===== Rematch =====
// Back to the lobby with everyone still joined: names editable, newcomers
// can scan in, and the host presses Start Adventure when ready.
function rematch() {
  gameGen++;    // stale turn callbacks from the old game become no-ops
  contestGen++; // stale mash/duel timers become no-ops
  mgSession++;
  mgInputHandler = null;
  groupGame = null;
  wheelPending = null;
  gameStarted = false;
  remotePressHandler = null;
  bonusDrawPending = false;
  canDraw = false;
  document.getElementById('win-screen').classList.remove('show');
  document.getElementById('duel-screen').classList.remove('show');
  document.getElementById('mash-screen').classList.remove('show');
  document.getElementById('game-ui').style.display = 'none';
  if (drawnCardEl) drawnCardEl.classList.remove('show');
  if (cardMessage) cardMessage.classList.remove('show');
  syncRosterFromShell(); // seat anyone who joined the party since last game
  beginRound();
}

// ===== Rainbow bonus tracker =====
// Every color card drawn (by anyone) fills in that color on a shared rainbow.
// The player who draws the LAST missing color earns a bonus draw, and the
// rainbow resets so the chase can start again.
const rainbowCollected = new Set();
let bonusDrawPending = false; // when true, the current player keeps their turn after resolving
let rainbowNoteTimer = null;

function initRainbowPanel() {
  const dots = document.getElementById('rainbow-dots');
  dots.innerHTML = '';
  COLOR_ORDER.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'rb-dot';
    dot.id = `rb-dot-${c}`;
    dot.style.background = COLORS[c].hex;
    dots.appendChild(dot);
  });
}

function updateRainbowDots() {
  COLOR_ORDER.forEach(c => {
    document.getElementById(`rb-dot-${c}`).classList.toggle('collected', rainbowCollected.has(c));
  });
}

function setRainbowNote(text, award) {
  const note = document.getElementById('rainbow-note');
  note.textContent = text;
  note.classList.toggle('award', !!award);
  clearTimeout(rainbowNoteTimer);
  if (award) {
    const panel = document.getElementById('rainbow-panel');
    panel.classList.add('flash');
    rainbowNoteTimer = setTimeout(() => {
      panel.classList.remove('flash');
      note.classList.remove('award');
      note.textContent = 'Fill the rainbow — last new color wins a bonus draw!';
    }, 4000);
  }
}

function trackRainbowColor(color) {
  if (rainbowCollected.has(color)) return;
  rainbowCollected.add(color);
  updateRainbowDots();

  if (rainbowCollected.size === COLOR_ORDER.length) {
    // Rainbow complete — the drawer of this last unique color gets a bonus draw
    const p = players[currentPlayerIdx];
    p.bonusDraws++;
    setRainbowNote(`🌈 ${p.name} completed the rainbow — Bonus Draw! 🎁`, true);
    rainbowCollected.clear();
    // Reset dots after a moment so the full rainbow is briefly visible
    setTimeout(updateRainbowDots, 1500);
    updatePlayerPanel();
    updateBonusButton();
  }
}

function updateBonusButton() {
  const btn = document.getElementById('bonus-draw-btn');
  const p = players[currentPlayerIdx];
  const show = canDraw && p && !p.finished && p.bonusDraws > 0;
  btn.classList.toggle('show', show);
  if (show) btn.textContent = `🎁 Bonus Draw ×${p.bonusDraws}`;
  broadcastState();
}

function useBonusDraw() {
  if (!canDraw) return;
  const p = players[currentPlayerIdx];
  if (p.bonusDraws <= 0) return;
  p.bonusDraws--;
  bonusDrawPending = true; // after this card resolves, the same player draws again
  updatePlayerPanel();
  drawCard();
}

// ===== Collision mini-games (Pong & Tron) =====
// When a player's move ends on a space occupied by another player, the
// players on that space battle in a mini-game played ON THEIR PHONES:
// Pong for two players, Tron light-cycles for two or more. The winner earns
// a BONUS DRAW — the turn order continues unchanged.
let mgSession = 0;        // invalidates a running mini-game's timers
let mgInputHandler = null; // routes phone mgInput messages to the active game

function checkCollisionThenEndTurn() {
  const mover = players[currentPlayerIdx];
  const pos = mover.position;
  if (pos > 0 && pos < TOTAL_SPACES - 1) {
    const group = players.filter(pl => !pl.finished && pl.position === pos);
    if (group.length > 1) {
      startCollisionMinigame(group, pos);
      return;
    }
  }
  endTurn();
}

function connectedOf(list) {
  return list.filter(pl => {
    const c = connsBySlot.get(pl.slot);
    return c && c.open;
  });
}

// The big screen shows a spectator overlay (reusing the old duel screen)
function showMgOverlay(title, subText, statusText) {
  const screen = document.getElementById('duel-screen');
  document.querySelector('#duel-screen h2').textContent = title;
  document.getElementById('duel-sub').textContent = subText;
  const cd = document.getElementById('duel-countdown');
  cd.classList.remove('go');
  cd.textContent = statusText || '';
  document.getElementById('duel-pads').innerHTML = '';
  document.getElementById('duel-pads').style.display = 'none';
  const res = document.getElementById('duel-results');
  res.innerHTML = '';
  res.classList.remove('show');
  document.getElementById('duel-action-btn').style.display = 'none';
  screen.classList.add('show');
  broadcastHostState();
}
function updateMgStatus(text) { document.getElementById('duel-countdown').textContent = text; }
function hideMgOverlay() { document.getElementById('duel-screen').classList.remove('show'); }

function startCollisionMinigame(group, space) {
  bonusDrawPending = false;
  drawnCardEl.classList.remove('show');
  cardMessage.classList.remove('show');
  const parts = connectedOf(group);
  if (parts.length < 2) { endTurn(); return; } // need phones to play
  const kind = (parts.length === 2 && Math.random() < 0.5) ? 'pong' : 'tron';
  const names = parts.map(pl => pl.name).join(' vs ');
  showMgOverlay(
    kind === 'pong' ? '🏓 PONG!' : '🏍 TRON!',
    `Collision on space ${space}! ${names} \u2014 play on your phones! Winner gets a Bonus Draw 🎁`,
    'Get ready\u2026'
  );
  const done = (winner) => {
    if (winner) {
      winner.bonusDraws++;
      updatePlayerPanel();
      updateMgStatus(`🏆 ${winner.name} wins +1 Bonus Draw!`);
    } else {
      updateMgStatus('No contest \u2014 moving on!');
    }
    broadcastState();
    const gen = gameGen;
    setTimeout(() => { if (gen === gameGen) { hideMgOverlay(); endTurn(); } }, 2400);
  };
  if (kind === 'pong') runPong(parts.slice(0, 2), done);
  else runTron(parts, done);
}

// --- PONG: big screen simulates, phones render + send paddle position ---
function runPong(pair, done) {
  const gen = gameGen, sess = ++mgSession;
  const W = 100, H = 60, PH = 16, PX = [4, 96], WIN = 3;
  const py = [H / 2, H / 2], score = [0, 0];
  let bx = W / 2, by = H / 2;
  let bvx = (Math.random() < 0.5 ? 1 : -1) * 1.15, bvy = (Math.random() - 0.5) * 1.2;
  pair.forEach((pl, i) => safeSend(connsBySlot.get(pl.slot), {
    type: 'mgStart', kind: 'pong', side: i,
    names: pair.map(pp => pp.name), colors: pair.map(pp => pp.color.hex),
  }));
  mgInputHandler = (slot, msg) => {
    const i = pair.findIndex(pp => pp.slot === slot);
    if (i > -1 && typeof msg.y === 'number') {
      py[i] = Math.max(PH / 2, Math.min(H - PH / 2, msg.y * H));
    }
  };
  const finish = (winner) => {
    clearInterval(tick); clearTimeout(guard);
    mgInputHandler = null;
    pair.forEach(pl => safeSend(connsBySlot.get(pl.slot), { type: 'mgEnd', winner: winner.name, you: pl === winner }));
    done(winner);
  };
  const tick = setInterval(() => {
    if (gen !== gameGen || sess !== mgSession) { clearInterval(tick); mgInputHandler = null; return; }
    bx += bvx; by += bvy;
    if (by < 1) { by = 1; bvy = Math.abs(bvy); }
    if (by > H - 1) { by = H - 1; bvy = -Math.abs(bvy); }
    for (let i = 0; i < 2; i++) {
      if (Math.abs(bx - PX[i]) < 2.2 && Math.abs(by - py[i]) < PH / 2 + 1.5 &&
          ((i === 0 && bvx < 0) || (i === 1 && bvx > 0))) {
        bvx = -bvx * 1.06;
        bvy += (by - py[i]) * 0.09;
        bvy = Math.max(-2.2, Math.min(2.2, bvy));
      }
    }
    if (bx < -2 || bx > W + 2) {
      const scorer = bx < 0 ? 1 : 0;
      score[scorer]++;
      updateMgStatus(`${pair[0].name} ${score[0]} \u2014 ${score[1]} ${pair[1].name}`);
      if (score[scorer] >= WIN) { finish(pair[scorer]); return; }
      bx = W / 2; by = H / 2;
      bvx = (scorer === 0 ? 1 : -1) * 1.15;
      bvy = (Math.random() - 0.5) * 1.2;
    }
    const frame = { type: 'mgState', b: [+bx.toFixed(1), +by.toFixed(1)], p: [+py[0].toFixed(1), +py[1].toFixed(1)], s: score };
    pair.forEach(pl => safeSend(connsBySlot.get(pl.slot), frame));
  }, 33);
  const guard = setTimeout(() => {
    if (gen !== gameGen || sess !== mgSession) return;
    finish(score[0] === score[1] ? pair[Math.floor(Math.random() * 2)] : pair[score[0] > score[1] ? 0 : 1]);
  }, 90000);
}

// --- TRON: big screen simulates a grid; phones render + send L/R turns ---
function runTron(group, done) {
  const gen = gameGen, sess = ++mgSession;
  const N = 34;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up right down left
  const startDefs = [
    { x: 5, y: 5, d: 1 }, { x: N - 6, y: N - 6, d: 3 },
    { x: N - 6, y: 5, d: 2 }, { x: 5, y: N - 6, d: 0 },
    { x: Math.floor(N / 2), y: 3, d: 2 }, { x: Math.floor(N / 2), y: N - 4, d: 0 },
    { x: 3, y: Math.floor(N / 2), d: 1 }, { x: N - 4, y: Math.floor(N / 2), d: 3 },
  ];
  const parts = group.slice(0, 8);
  const heads = parts.map((_, i) => [startDefs[i].x, startDefs[i].y]);
  const dirs = parts.map((_, i) => startDefs[i].d);
  const alive = parts.map(() => true);
  const pending = parts.map(() => null);
  const trail = new Set(heads.map(h => h[0] + ',' + h[1]));
  parts.forEach((pl, i) => safeSend(connsBySlot.get(pl.slot), {
    type: 'mgStart', kind: 'tron', idx: i, grid: N,
    heads: heads.map(h => [...h]), dirs: [...dirs],
    names: parts.map(pp => pp.name), colors: parts.map(pp => pp.color.hex),
  }));
  mgInputHandler = (slot, msg) => {
    const i = parts.findIndex(pp => pp.slot === slot);
    if (i > -1 && (msg.turn === 'L' || msg.turn === 'R')) pending[i] = msg.turn;
  };
  const finish = (winner) => {
    clearInterval(tick); clearTimeout(guard);
    mgInputHandler = null;
    parts.forEach(pl => safeSend(connsBySlot.get(pl.slot), { type: 'mgEnd', winner: winner ? winner.name : null, you: pl === winner }));
    done(winner);
  };
  const tick = setInterval(() => {
    if (gen !== gameGen || sess !== mgSession) { clearInterval(tick); mgInputHandler = null; return; }
    // apply turns, compute next heads
    const next = [];
    for (let i = 0; i < parts.length; i++) {
      if (!alive[i]) { next.push(null); continue; }
      if (pending[i]) {
        dirs[i] = (dirs[i] + (pending[i] === 'R' ? 1 : 3)) % 4;
        pending[i] = null;
      }
      next.push([heads[i][0] + DIRS[dirs[i]][0], heads[i][1] + DIRS[dirs[i]][1]]);
    }
    // deaths: walls, trails, and head-on collisions (same target cell)
    for (let i = 0; i < parts.length; i++) {
      if (!alive[i]) continue;
      const [x, y] = next[i];
      let dead = x < 0 || y < 0 || x >= N || y >= N || trail.has(x + ',' + y);
      if (!dead) for (let j = 0; j < parts.length; j++) {
        if (j !== i && alive[j] && next[j] && next[j][0] === x && next[j][1] === y) dead = true;
      }
      if (dead) alive[i] = false;
      else { heads[i] = next[i]; trail.add(x + ',' + y); }
    }
    const frame = { type: 'mgState', heads: heads.map((h, i) => alive[i] ? [...h] : null), alive: [...alive] };
    parts.forEach(pl => safeSend(connsBySlot.get(pl.slot), frame));
    const living = parts.filter((_, i) => alive[i]);
    updateMgStatus(living.length > 1 ? `${living.length} riders left\u2026` : '');
    if (living.length <= 1) finish(living[0] || parts[Math.floor(Math.random() * parts.length)]);
  }, 130);
  const guard = setTimeout(() => {
    if (gen !== gameGen || sess !== mgSession) return;
    const living = parts.filter((_, i) => alive[i]);
    finish(living.length ? living[Math.floor(Math.random() * living.length)] : parts[0]);
  }, 60000);
}

// ===== Round-end group mini-game: Doodle Dash + Wheel of Fortune =====
// After every full round of turns, all connected players race a doodle-jump
// climb on their phones. First to the finish line (or highest when time's up)
// wins a spin of the wheel.
let roundTurnCounter = 0;
let groupGame = null; // { sess, prog: Map(slot->0..1), parts, end(pl) }

const WHEEL_SEGMENTS = [
  { label: '🎁 Bonus Draw', kind: 'bonus', n: 1 },
  { label: '🔀 Shuffle Everyone!', kind: 'shuffle' },
  { label: '🎁 Bonus Draw', kind: 'bonus', n: 1 },
  { label: '\u2B07\uFE0F Leaders Back 10', kind: 'leadersBack' },
  { label: '🎁 Bonus Draw', kind: 'bonus', n: 1 },
  { label: '🎁🎁 Double Bonus!', kind: 'bonus', n: 2 },
];

function startGroupMinigame(resume) {
  const parts = connectedOf(players.filter(pl => !pl.finished));
  if (parts.length < 2) { resume(); return; }
  const gen = gameGen, sess = ++mgSession;
  const seed = (Math.random() * 1e9) | 0;
  const DURATION = 45000;
  showMgOverlay('🦘 DOODLE DASH!', 'Round complete! Everyone: climb to the finish line on your phones! Winner spins the Wheel of Fortune 🎡', 'Climbing\u2026');
  const prog = new Map(parts.map(pl => [pl.slot, 0]));
  let ended = false;
  const end = (winner) => {
    if (ended || gen !== gameGen || sess !== mgSession) return;
    ended = true;
    clearTimeout(guard); clearInterval(bar);
    groupGame = null;
    parts.forEach(pl => safeSend(connsBySlot.get(pl.slot), { type: 'doodleEnd', winner: winner.name, you: pl === winner }));
    updateMgStatus(`🏆 ${winner.name} reached the top!`);
    setTimeout(() => {
      if (gen !== gameGen) return;
      hideMgOverlay();
      offerWheel(winner, resume);
    }, 2200);
  };
  groupGame = { sess, prog, parts, end };
  parts.forEach(pl => safeSend(connsBySlot.get(pl.slot), { type: 'doodleStart', seed, duration: DURATION, color: pl.color.hex }));
  const bar = setInterval(() => {
    if (gen !== gameGen || sess !== mgSession) { clearInterval(bar); return; }
    const lead = [...prog.entries()].sort((a, b) => b[1] - a[1])[0];
    if (lead) {
      const pl = parts.find(pp => pp.slot === lead[0]);
      if (pl) updateMgStatus(`${pl.name} leads \u2014 ${Math.round(lead[1] * 100)}% up!`);
    }
  }, 900);
  const guard = setTimeout(() => {
    if (gen !== gameGen || sess !== mgSession || ended) return;
    let best = parts[0], bh = -1;
    parts.forEach(pl => { const h = prog.get(pl.slot) || 0; if (h > bh) { bh = h; best = pl; } });
    end(best);
  }, DURATION + 3000);
}

let wheelPending = null; // { winner, resume }
function offerWheel(winner, resume) {
  const c = connsBySlot.get(winner.slot);
  if (!c || !c.open) { winner.bonusDraws++; updatePlayerPanel(); broadcastState(); resume(); return; }
  const gen = gameGen;
  showMgOverlay('🎡 WHEEL OF FORTUNE', `${winner.name} won the race \u2014 spin the wheel on your phone!`, 'Waiting for the spin\u2026');
  wheelPending = { winner, resume };
  safeSend(c, { type: 'wheelOffer', segments: WHEEL_SEGMENTS.map(w => w.label) });
  setTimeout(() => { // auto-spin if they wander off
    if (gen === gameGen && wheelPending && wheelPending.winner === winner) doSpin(winner);
  }, 20000);
}

function doSpin(winner) {
  if (!wheelPending || wheelPending.winner !== winner) return;
  const { resume } = wheelPending;
  wheelPending = null;
  const gen = gameGen;
  const idx = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
  const seg = WHEEL_SEGMENTS[idx];
  const c = connsBySlot.get(winner.slot);
  if (c) safeSend(c, { type: 'wheelResult', idx, segments: WHEEL_SEGMENTS.map(w => w.label) });
  updateMgStatus('Spinning\u2026');
  setTimeout(() => {
    if (gen !== gameGen) return;
    applyWheel(winner, seg);
    updateMgStatus(`${seg.label}`);
    setTimeout(() => {
      if (gen !== gameGen) return;
      hideMgOverlay();
      resume();
    }, 2600);
  }, 4400);
}

function snapAllPawns() {
  players.forEach((pl, i) => {
    const pawn = pawns[i];
    if (!pawn) return;
    const pt = pathPoints[pl.position];
    const off = pawnOffset(i, players.length);
    pawn.position.set(pt.x + off.x, TILE_TOP_Y, pt.z + off.z);
    pawn.userData.baseY = TILE_TOP_Y;
    pawn.userData.moving = false;
  });
}

function applyWheel(winner, seg) {
  if (seg.kind === 'bonus') {
    winner.bonusDraws += seg.n;
    showMessage(`${winner.name} spun ${seg.label}!`);
  } else if (seg.kind === 'shuffle') {
    // Randomly permute everyone's board positions
    const active = players.filter(pl => !pl.finished);
    const positions = active.map(pl => pl.position);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    active.forEach((pl, i) => { pl.position = positions[i]; });
    snapAllPawns();
    showMessage(`🔀 ${winner.name} spun SHUFFLE \u2014 everyone swapped places!`);
  } else if (seg.kind === 'leadersBack') {
    const leaders = [...players].filter(pl => !pl.finished && pl.position > 0)
      .sort((a, b) => b.position - a.position).slice(0, 2);
    leaders.forEach(pl => { pl.position = Math.max(0, pl.position - 10); });
    snapAllPawns();
    showMessage(`\u2B07\uFE0F ${leaders.map(pl => pl.name).join(' & ')} got knocked back 10 spaces!`);
  }
  updatePlayerPanel();
  broadcastState();
}

function updatePlayerPanel() {
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player-status' + (i === currentPlayerIdx ? ' current' : '');
    const posLabel = p.finished ? '🏰 WON!' : p.position === 0 ? 'at start' : `space ${p.position}`;
    const bonusBadge = p.bonusDraws > 0 ? `<div class="ps-bonus">🎁×${p.bonusDraws}</div>` : '';
    row.innerHTML = `
      <div class="ps-token" style="background:${p.color.hex};"></div>
      <div class="ps-name">${escapeHtml(p.name)}</div>
      ${bonusBadge}
      <div class="ps-pos">${posLabel}</div>
    `;
    list.appendChild(row);
  });
}

function updateTopBar() {
  const p = players[currentPlayerIdx];
  if (!p) return;
  const bar = document.getElementById('top-bar');
  bar.style.setProperty('--turn-color', p.color.hex);
  document.getElementById('current-player-token').style.background = p.color.hex;
  document.getElementById('cp-name').textContent = p.name;
  // Re-trigger the attention-grabbing pop each time the turn changes
  bar.classList.remove('pop');
  void bar.offsetWidth;
  bar.classList.add('pop');
}

function drawCard() {
  if (!canDraw) return;
  canDraw = false;
  deck.classList.add('disabled');
  cardMessage.classList.remove('show');

  // Determine card type
  // Probabilities: ~5% special, ~25% double, rest single
  const r = Math.random();
  let card;
  if (r < 0.07) {
    // Special card
    const spot = SPECIAL_SPOTS[Math.floor(Math.random() * SPECIAL_SPOTS.length)];
    card = { type: 'special', spot };
  } else if (r < 0.32) {
    // Double color
    const color = COLOR_ORDER[Math.floor(Math.random() * COLOR_ORDER.length)];
    card = { type: 'double', color };
  } else {
    const color = COLOR_ORDER[Math.floor(Math.random() * COLOR_ORDER.length)];
    card = { type: 'single', color };
  }

  const gen = gameGen; // a rematch makes this draw's pending steps no-ops
  renderCard(card);

  // Track colors for the rainbow bonus (special cards don't count)
  if (card.type === 'single' || card.type === 'double') {
    trackRainbowColor(card.color);
  } else if (card.type === 'special') {
    // Bonus draw ONLY if the special spot is BEHIND the player — a backward
    // jump comes with a consolation prize; a forward jump is its own reward.
    card.awardBonus = card.spot.pathIndex < players[currentPlayerIdx].position;
    if (card.awardBonus) {
      players[currentPlayerIdx].bonusDraws++;
      updatePlayerPanel();
    }
  }
  updateBonusButton();

  // Special cards linger longer so everyone can soak in the reveal
  setTimeout(() => { if (gen === gameGen) resolveCard(card); }, card.type === 'special' ? 2400 : 1100);
}

function renderCard(card) {
  drawnCardEl.classList.remove('show', 'special');
  drawnCardEl.innerHTML = '';
  if (card.type === 'single') {
    const block = document.createElement('div');
    block.className = 'card-color-block';
    block.style.background = COLORS[card.color].hex;
    drawnCardEl.appendChild(block);
  } else if (card.type === 'double') {
    for (let i = 0; i < 2; i++) {
      const block = document.createElement('div');
      block.className = 'card-color-block double';
      block.style.background = COLORS[card.color].hex;
      drawnCardEl.appendChild(block);
    }
  } else if (card.type === 'special') {
    drawnCardEl.classList.add('special');
    const banner = document.createElement('div');
    banner.className = 'card-special-banner';
    banner.textContent = '✨ SPECIAL ✨';
    const icon = document.createElement('div');
    icon.className = 'card-special-icon';
    icon.textContent = card.spot.icon;
    const text = document.createElement('div');
    text.className = 'card-special-text';
    text.textContent = card.spot.name;
    drawnCardEl.appendChild(banner);
    drawnCardEl.appendChild(icon);
    drawnCardEl.appendChild(text);
  }
  // force reflow then animate
  void drawnCardEl.offsetWidth;
  drawnCardEl.classList.add('show');
}

function resolveCard(card) {
  const gen = gameGen; // stale after a rematch
  const player = players[currentPlayerIdx];

  // Skip-turn check first
  if (player.skipNext) {
    player.skipNext = false;
    showMessage(`${player.name} is stuck and skips this turn! 🍯`);
    setTimeout(() => { if (gen === gameGen) endTurn(); }, 1500);
    return;
  }

  let target = player.position;

  if (card.type === 'special') {
    target = card.spot.pathIndex;
    // If player is already past it, they still go (per Candy Land rule, special cards always send you there)
  } else {
    // Find next tile of matching color
    const steps = card.type === 'double' ? 2 : 1;
    let stepsTaken = 0;
    let pos = player.position;
    while (stepsTaken < steps && pos < TOTAL_SPACES - 1) {
      pos++;
      if (pos >= TOTAL_SPACES - 1) break;
      const tileColor = COLOR_ORDER[(pos - 1) % COLOR_ORDER.length];
      if (tileColor === card.color) stepsTaken++;
    }
    target = pos;
  }

  // Cap at castle
  if (target >= TOTAL_SPACES - 1) {
    target = TOTAL_SPACES - 1;
  }

  movePlayer(currentPlayerIdx, target, () => {
    if (gen !== gameGen) return; // the game was restarted mid-move
    // After arrival
    if (target === TOTAL_SPACES - 1) {
      player.finished = true;
      showMessage(`${player.name} reached the Sugar Castle! 🏰`);
      updatePlayerPanel();
      setTimeout(() => showWin(player), 1200);
      return;
    }
    if (target === SHORTCUT.from) {
      // Take the rainbow bridge!
      showMessage(`${player.name} found the Rainbow Bridge! 🌈`);
      updatePlayerPanel();
      setTimeout(() => {
        movePlayerArc(currentPlayerIdx, SHORTCUT.to, () => {
          if (gen !== gameGen) return;
          player.position = SHORTCUT.to;
          updatePlayerPanel();
          if (STICKY_SPOTS.includes(SHORTCUT.to)) {
            player.skipNext = true;
            showMessage(`...and landed in goo! Skips next turn 🍯`);
          } else {
            showMessage(`${player.name} crossed the bridge to space ${SHORTCUT.to}!`);
          }
          setTimeout(() => { if (gen === gameGen) checkCollisionThenEndTurn(); }, 1600);
        });
      }, 900);
      return;
    }
    if (STICKY_SPOTS.includes(target)) {
      player.skipNext = true;
      showMessage(`${player.name} got stuck in the goo! Skips next turn 🍯`);
    } else if (card.type === 'special') {
      showMessage(`${player.name} jumped to ${card.spot.name}! ${card.spot.icon}` + (card.awardBonus ? ' +1 Bonus Draw 🎁' : ''));
    } else if (target === player.position) {
      showMessage(`No matching tile ahead. ${player.name} stays put.`);
    } else {
      showMessage(`${player.name} moves to space ${target}.`);
    }
    updatePlayerPanel();
    setTimeout(() => { if (gen === gameGen) checkCollisionThenEndTurn(); }, 1600);
  });
}

function showMessage(msg) {
  cardMessage.textContent = msg;
  cardMessage.classList.add('show');
}

function movePlayer(idx, targetIndex, onComplete) {
  const player = players[idx];
  const startIndex = player.position;
  player.position = targetIndex;

  if (startIndex === targetIndex) {
    onComplete();
    return;
  }

  // Animate hop-by-hop
  const path = [];
  if (targetIndex > startIndex) {
    for (let i = startIndex + 1; i <= targetIndex; i++) path.push(i);
  } else {
    // backward (only happens with special spot when player passed it — actually in this build we always go forward to special, even if it's behind we just go there directly)
    path.push(targetIndex);
  }

  let step = 0;
  const pawn = pawns[idx];
  const offset = pawnOffset(idx, players.length);
  pawn.userData.moving = true;

  function nextHop() {
    if (step >= path.length) {
      // Movement complete — lock in the resting Y position on top of the tile
      const finalDest = pathPoints[targetIndex];
      pawn.position.set(finalDest.x + offset.x, TILE_TOP_Y, finalDest.z + offset.z);
      pawn.userData.baseY = TILE_TOP_Y;
      pawn.userData.moving = false;
      onComplete();
      return;
    }
    const tIdx = path[step];
    const dest = pathPoints[tIdx];
    const startPos = pawn.position.clone();
    const endPos = new THREE.Vector3(dest.x + offset.x, TILE_TOP_Y, dest.z + offset.z);

    const duration = 280;
    const startTime = performance.now();

    function tick() {
      const t = Math.min(1, (performance.now() - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      pawn.position.lerpVectors(startPos, endPos, ease);
      // Hop arc — add height on top of the lerped position
      pawn.position.y = TILE_TOP_Y + Math.sin(t * Math.PI) * 0.7;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        step++;
        setTimeout(nextHop, 60);
      }
    }
    tick();
  }
  nextHop();
}

function movePlayerArc(idx, targetIndex, onComplete) {
  const pawn = pawns[idx];
  const offset = pawnOffset(idx, players.length);
  const fromPos = pathPoints[SHORTCUT.from];
  const toPos = pathPoints[targetIndex];

  pawn.userData.moving = true;

  const mid = new THREE.Vector3(
    (fromPos.x + toPos.x) / 2,
    Math.max(fromPos.y, toPos.y) + 6.5,
    (fromPos.z + toPos.z) / 2
  );
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(fromPos.x + offset.x, TILE_TOP_Y, fromPos.z + offset.z),
    mid,
    new THREE.Vector3(toPos.x + offset.x, TILE_TOP_Y, toPos.z + offset.z)
  );

  const duration = 1400;
  const startTime = performance.now();

  function tick() {
    const t = Math.min(1, (performance.now() - startTime) / duration);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const pos = curve.getPoint(ease);
    pawn.position.copy(pos);
    pawn.rotation.y += 0.08; // spin while flying

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      pawn.position.set(toPos.x + offset.x, TILE_TOP_Y, toPos.z + offset.z);
      pawn.rotation.y = 0;
      pawn.userData.baseY = TILE_TOP_Y;
      pawn.userData.moving = false;
      onComplete();
    }
  }
  tick();
}

function endTurn() {
  // Hide drawn card
  drawnCardEl.classList.remove('show');
  cardMessage.classList.remove('show');

  // If a bonus draw was used, the same player keeps their turn and draws again
  if (bonusDrawPending) {
    bonusDrawPending = false;
    if (!players[currentPlayerIdx].finished) {
      canDraw = true;
      deck.classList.remove('disabled');
      updatePlayerPanel();
      updateTopBar();
      updateBonusButton();
      return;
    }
  }

  // Advance to next player who hasn't finished
  let attempts = 0;
  do {
    currentPlayerIdx = (currentPlayerIdx + 1) % players.length;
    attempts++;
  } while (players[currentPlayerIdx].finished && attempts < players.length);

  // After every full round of turns, the whole group races Doodle Dash
  roundTurnCounter++;
  const activeCount = players.filter(pl => !pl.finished).length;
  if (roundTurnCounter >= activeCount && activeCount >= 2) {
    roundTurnCounter = 0;
    canDraw = false;
    deck.classList.add('disabled');
    updatePlayerPanel();
    updateTopBar();
    updateBonusButton();
    startGroupMinigame(() => {
      canDraw = true;
      deck.classList.remove('disabled');
      updatePlayerPanel();
      updateTopBar();
      updateBonusButton();
    });
    return;
  }

  canDraw = true;
  deck.classList.remove('disabled');
  updatePlayerPanel();
  updateTopBar();
  updateBonusButton();
}

function showWin(player) {
  document.getElementById('winner-name').textContent = player.name;
  document.getElementById('winner-name').style.background = `linear-gradient(135deg, ${player.color.hex}, ${COLORS.yellow.hex})`;
  document.getElementById('winner-name').style.webkitBackgroundClip = 'text';
  document.getElementById('winner-name').style.backgroundClip = 'text';
  document.getElementById('winner-name').style.color = 'transparent';
  document.getElementById('win-screen').classList.add('show');
  connsBySlot.forEach(c => safeSend(c, { type: 'win', name: player.name }));
  const hostPid = ctx.hostPlayerId && ctx.hostPlayerId();
  if (hostPid) ctx.sendTo(hostPid, { type: 'winCtl' });

  // Confetti
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti';
    const colors = ['#ff4d6d', '#ff9f4a', '#ffd93d', '#6bcf7f', '#4dabf7', '#b380ff'];
    piece.style.background = colors[Math.floor(Math.random()*colors.length)];
    piece.style.left = Math.random() * 100 + '%';
    piece.style.top = '-20px';
    piece.style.transform = `rotate(${Math.random()*360}deg)`;
    ctx.root.appendChild(piece);
    const dur = 2000 + Math.random() * 2000;
    const sway = (Math.random() - 0.5) * 200;
    piece.animate([
      { transform: `translate(0, 0) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${sway}px, ${window.innerHeight + 50}px) rotate(${Math.random()*720}deg)`, opacity: 0.6 }
    ], { duration: dur, easing: 'ease-in' });
    setTimeout(() => piece.remove(), dur);
  }
}

function sendStateTo(conn) {
  const slot = conn._slot;
  if (slot === undefined || slot === null) return;
  const pl = rosterPlayers.find(pp => pp.slot === slot);
  const inRound = gameStarted && players.length > 0;
  const myTurn = !!(pl && inRound && players[currentPlayerIdx] === pl);
  safeSend(conn, {
    type: 'state',
    started: gameStarted,
    mashActive: !!remotePressHandler,
    yourTurn: myTurn,
    canDraw: !!(pl && myTurn && canDraw && !pl.finished),
    bonusDraws: pl ? pl.bonusDraws : 0,
    finished: !!(pl && pl.finished),
  });
}
function broadcastState() {
  connsBySlot.forEach(c => sendStateTo(c));
  broadcastHostState();
}


  /* ============================================================
     Module interface
     ============================================================ */
  return {
    start() {
      ctx.root.innerHTML = HOST_HTML;
      document.getElementById('play-again-btn').addEventListener('click', rematch);
      document.getElementById('sp-menu-btn').addEventListener('click', () => ctx.exit());
      loadEngine().catch((err) => {
        console.error('Sweet Path: 3D engine failed to load', err);
        const sub = document.getElementById('mash-sub');
        if (sub) sub.textContent = 'Trouble loading the 3D board — check the internet connection, then head back to the menu and try again.';
      });
      syncRosterFromShell();
      beginRound();
    },

    onMessage: handlePhoneMsg,

    onPlayerJoin(p) {
      ctx.sendTo(p.id, { type: 'wait', reason: "Adventure in progress — you'll be dealt in next game!" });
    },

    onPlayerLeave(pid) {
      const slot = slotByPid.get(pid);
      const c = slot !== undefined ? connsBySlot.get(slot) : null;
      if (c) c.open = false;
      broadcastState();
      // If it was their turn, draw for them so the game never stalls.
      const cur = players[currentPlayerIdx];
      if (gameStarted && canDraw && cur && cur.deviceId === pid && !cur.finished) {
        const gen = gameGen;
        showMessage(`${cur.name}'s phone dropped — drawing automatically…`);
        setTimeout(() => {
          if (gen === gameGen && canDraw && players[currentPlayerIdx] === cur && !cur.finished) drawCard();
        }, 4000);
      }
    },

    onPlayerRejoin(p) {
      const pl = rosterPlayers.find((rp) => rp.deviceId === p.id);
      if (pl) {
        seatPlayer(p);
        sendStateTo(connsBySlot.get(pl.slot));
        if (ctx.hostPlayerId && p.id === ctx.hostPlayerId() && pendingHostBtn) {
          ctx.sendTo(p.id, { type: 'hostBtn', label: pendingHostBtn.label });
        }
      } else {
        ctx.sendTo(p.id, { type: 'wait', reason: "Adventure in progress — you'll be dealt in next game!" });
      }
    },

    destroy() {
      gameGen++; contestGen++; mgSession++;
      mgInputHandler = null; remotePressHandler = null;
      groupGame = null; wheelPending = null;
      if (activeMashKeyHandler) {
        window.removeEventListener('keydown', activeMashKeyHandler);
        activeMashKeyHandler = null;
      }
      cancelAnimationFrame(rafId);
      try { window.removeEventListener('resize', onResize); } catch (e) {}
      try { if (controls) controls.dispose(); } catch (e) {}
      try { if (renderer) renderer.dispose(); } catch (e) {}
      ctx.root.innerHTML = '';
    },
  };
}

/* ============================================================
   CONTROLLER (phone) — mash pad, draw/bonus buttons, and the
   original phone mini-games (Pong, Tron, Doodle Dash, Wheel).
   ============================================================ */
function createController(ctx) {
  let handleMsg = null;
  let ctrlCleanup = null;

  function setup() {
    const wrap = document.getElementById('sp-wrap');
    const statusEl = document.getElementById('sp-status');
    const mashBtn = document.getElementById('sp-mash');
    const drawBtn = document.getElementById('sp-draw');
    const bonusBtn = document.getElementById('sp-bonus');
    const winCtl = document.getElementById('sp-winctl');
    let wasMyTurn = false;

    const hostBtn = document.getElementById('sp-hostbtn');
    hostBtn.addEventListener('click', () => ctx.send({ type: 'hostBtnPress' }));
    mashBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); ctx.send({ type: 'press' }); });
    drawBtn.addEventListener('click', () => ctx.send({ type: 'draw' }));
    bonusBtn.addEventListener('click', () => ctx.send({ type: 'bonus' }));
    document.getElementById('sp-again').addEventListener('click', () => {
      winCtl.classList.remove('show');
      ctx.send({ type: 'winCtlAction', action: 'again' });
    });
    document.getElementById('sp-menu').addEventListener('click', () => ctx.send({ type: 'winCtlAction', action: 'menu' }));

  const mgScreen = document.getElementById('mg-screen');
  const mgCanvas = document.getElementById('mg-canvas');
  const mgCtx = mgCanvas.getContext('2d');
  const mgTitle = document.getElementById('mg-title');
  const mgMsg = document.getElementById('mg-msg');
  const tronControls = document.getElementById('mg-tron-controls');
  let mg = null; // active phone-side mini-game state

  function openMg(title, w, h, tron) {
    mgTitle.textContent = title;
    mgMsg.textContent = '';
    mgCanvas.width = w; mgCanvas.height = h;
    tronControls.classList.toggle('show', !!tron);
    mgScreen.classList.add('show');
    try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) {}
  }
  function closeMg(delay) {
    setTimeout(() => { mgScreen.classList.remove('show'); mg = null; }, delay || 0);
  }

  // --- Pong renderer + paddle input ---
  function startPongPhone(msg) {
    const W = Math.min(window.innerWidth - 30, 420);
    const H = Math.round(W * 0.6);
    openMg(`🏓 ${msg.names[0]} vs ${msg.names[1]}`, W, H, false);
    mg = { kind: 'pong', side: msg.side, colors: msg.colors, names: msg.names, W, H };
    mgMsg.textContent = msg.side === 0 ? 'You are the LEFT paddle — drag up/down!' : 'You are the RIGHT paddle — drag up/down!';
    let lastSent = 0;
    const sendY = (clientY) => {
      const r = mgCanvas.getBoundingClientRect();
      const y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      const now = Date.now();
      if (now - lastSent > 40 && true) { lastSent = now; ctx.send({ type: 'mgInput', y }); }
    };
    mg.onPointer = (e) => { e.preventDefault(); sendY(e.clientY); };
    mgScreen.addEventListener('pointermove', mg.onPointer);
    mgScreen.addEventListener('pointerdown', mg.onPointer);
  }
  function drawPong(f) {
    if (!mg || mg.kind !== 'pong') return;
    const { W, H } = mg;
    const sx = W / 100, sy = H / 60;
    mgCtx.clearRect(0, 0, W, H);
    mgCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    mgCtx.setLineDash([6, 8]);
    mgCtx.beginPath(); mgCtx.moveTo(W / 2, 0); mgCtx.lineTo(W / 2, H); mgCtx.stroke();
    mgCtx.setLineDash([]);
    const PH = 16 * sy, PW = 8;
    [0, 1].forEach(i => {
      mgCtx.fillStyle = mg.colors[i];
      const px = i === 0 ? 6 : W - 6 - PW;
      mgCtx.fillRect(px, f.p[i] * sy - PH / 2, PW, PH);
      if (i === mg.side) {
        mgCtx.strokeStyle = 'white'; mgCtx.lineWidth = 2;
        mgCtx.strokeRect(px - 2, f.p[i] * sy - PH / 2 - 2, PW + 4, PH + 4);
      }
    });
    mgCtx.fillStyle = 'white';
    mgCtx.beginPath(); mgCtx.arc(f.b[0] * sx, f.b[1] * sy, 6, 0, Math.PI * 2); mgCtx.fill();
    mgCtx.font = 'bold 22px Fredoka, sans-serif';
    mgCtx.textAlign = 'center';
    mgCtx.fillStyle = 'rgba(255,255,255,0.85)';
    mgCtx.fillText(`${f.s[0]}  —  ${f.s[1]}`, W / 2, 26);
  }

  // --- Tron renderer + turn buttons ---
  function startTronPhone(msg) {
    const size = Math.min(window.innerWidth - 30, window.innerHeight - 240, 400);
    openMg('🏍 TRON', size, size, true);
    mg = {
      kind: 'tron', idx: msg.idx, grid: msg.grid, colors: msg.colors,
      cell: size / msg.grid, trails: msg.heads.map(h => [h.slice()]), alive: msg.heads.map(() => true),
    };
    mgMsg.textContent = `You are ${msg.names[msg.idx]} — don't crash!`;
    drawTron();
  }
  function drawTron() {
    if (!mg || mg.kind !== 'tron') return;
    const size = mgCanvas.width, c = mg.cell;
    mgCtx.clearRect(0, 0, size, size);
    mg.trails.forEach((tr, i) => {
      mgCtx.fillStyle = mg.alive[i] ? mg.colors[i] : 'rgba(120,120,120,0.5)';
      tr.forEach(([x, y]) => mgCtx.fillRect(x * c, y * c, c - 0.5, c - 0.5));
      const head = tr[tr.length - 1];
      if (head && mg.alive[i]) {
        mgCtx.fillStyle = 'white';
        mgCtx.fillRect(head[0] * c + c * 0.25, head[1] * c + c * 0.25, c * 0.5, c * 0.5);
      }
    });
    mgCtx.strokeStyle = 'rgba(255,255,255,0.25)';
    mgCtx.lineWidth = 2;
    mgCtx.strokeRect(0, 0, size, size);
  }
  function tronFrame(f) {
    if (!mg || mg.kind !== 'tron') return;
    f.heads.forEach((h, i) => {
      if (h) mg.trails[i].push(h.slice());
      mg.alive[i] = f.alive[i];
    });
    if (!mg.alive[mg.idx]) mgMsg.textContent = '💥 Crashed! Watch the finish…';
    drawTron();
  }
  document.getElementById('mg-left').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (mg && mg.kind === 'tron' && true) ctx.send({ type: 'mgInput', turn: 'L' });
  });
  document.getElementById('mg-right').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (mg && mg.kind === 'tron' && true) ctx.send({ type: 'mgInput', turn: 'R' });
  });

  // --- Doodle Dash: fully local simulation, seeded platforms for fairness ---
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  async function enableTilt(m) {
    let granted = true;
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        granted = (await DeviceOrientationEvent.requestPermission()) === 'granted';
      }
    } catch (e) { granted = false; }
    if (granted && typeof DeviceOrientationEvent !== 'undefined' && 'ondeviceorientation' in window) {
      let got = false;
      m.onTilt = (e) => {
        if (e.gamma === null || e.gamma === undefined) return;
        got = true;
        // gamma = left/right tilt in portrait; swap axes if the phone rotated
        let g = e.gamma;
        const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
        if (ang === 90) g = -(e.beta ?? 0);
        else if (ang === -90 || ang === 270) g = (e.beta ?? 0);
        else if (ang === 180) g = -g;
        m.tilt = Math.max(-1, Math.min(1, g / 22));
      };
      window.addEventListener('deviceorientation', m.onTilt);
      mgMsg.textContent = 'Tilt your phone to steer \u2014 race to the finish line!';
      setTimeout(() => {
        if (!got && mg === m && m.kind === 'doodle') {
          window.removeEventListener('deviceorientation', m.onTilt);
          m.onTilt = null;
          m.tilt = null;
          mgMsg.textContent = 'No tilt sensor found \u2014 hold LEFT or RIGHT side to steer!';
        }
      }, 1500);
    } else {
      mgMsg.textContent = 'Hold LEFT or RIGHT side to steer \u2014 race to the finish line!';
    }
  }

  function startDoodlePhone(msg) {
    const W = Math.min(window.innerWidth - 30, 360);
    const H = Math.min(window.innerHeight - 200, 520);
    openMg('🦘 DOODLE DASH!', W, H, false);
    mgMsg.textContent = 'Get ready\u2026';
    const rng = mulberry32(msg.seed);
    const FINISH = 2600;
    const plats = [{ x: W / 2 - 30, y: -10, w: 60 }];
    for (let y = 60; y < FINISH + 100; y += 55 + rng() * 40) {
      plats.push({ x: rng() * (W - 62), y, w: 62 });
    }
    mg = {
      kind: 'doodle', W, H, plats, FINISH, color: msg.color,
      x: W / 2, y: 0, vy: 10, vx: 0, maxY: 0, hold: 0, doneLocal: false,
      lastReport: 0, raf: null, ended: false,
      tilt: null, onTilt: null, goBtn: null,
    };
    mg.onDown = (e) => { e.preventDefault(); const r = mgCanvas.getBoundingClientRect(); mg.hold = (e.clientX - r.left) < r.width / 2 ? -1 : 1; };
    mg.onUp = (e) => { e.preventDefault(); mg.hold = 0; };
    mgScreen.addEventListener('pointerdown', mg.onDown);
    mgScreen.addEventListener('pointerup', mg.onUp);
    mgScreen.addEventListener('pointercancel', mg.onUp);
    const G = -0.34, JUMP = 11, MOVE = 0.9, MAXVX = 6; // world-y grows upward
    function step() {
      if (!mg || mg.kind !== 'doodle' || mg.ended) return;
      mg.vx += (mg.tilt !== null ? mg.tilt * 1.7 : mg.hold) * MOVE;
      mg.vx = Math.max(-MAXVX, Math.min(MAXVX, mg.vx)) * 0.96;
      mg.x += mg.vx;
      if (mg.x < -12) mg.x = W + 12; if (mg.x > W + 12) mg.x = -12; // wrap
      const prevY = mg.y;
      mg.vy += G;
      mg.y += mg.vy;
      if (mg.vy < 0) { // falling: land when crossing a platform from above
        for (const pl of mg.plats) {
          if (mg.x > pl.x - 8 && mg.x < pl.x + pl.w + 8 &&
              prevY >= pl.y - 2 && mg.y <= pl.y + 4 && Math.abs(mg.y - pl.y) < 22) {
            mg.y = pl.y; mg.vy = JUMP;
            try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
            break;
          }
        }
      }
      if (mg.y > mg.maxY) mg.maxY = mg.y;
      // fell far below best height -> gentle respawn at best platform
      if (mg.y < mg.maxY - H * 0.9) {
        let best = mg.plats[0];
        for (const pl of mg.plats) if (pl.y <= mg.maxY && pl.y > best.y) best = pl;
        mg.x = best.x + best.w / 2; mg.y = best.y; mg.vy = JUMP;
      }
      // progress report
      const now = Date.now();
      if (now - mg.lastReport > 450 && true) {
        mg.lastReport = now;
        ctx.send({ type: 'doodleProgress', h: Math.min(1, mg.maxY / FINISH) });
      }
      if (!mg.doneLocal && mg.maxY >= FINISH) {
        mg.doneLocal = true;
        mgMsg.textContent = '🏁 FINISHED! Waiting for results…';
        if (true) ctx.send({ type: 'doodleFinish' });
      }
      drawDoodle();
      mg.raf = requestAnimationFrame(step);
    }
    function drawDoodle() {
      const cam = Math.max(0, mg.maxY - H * 0.55);
      const toScreen = (wy) => H - (wy - cam) - 40;
      mgCtx.clearRect(0, 0, W, H);
      // finish line
      const fy = toScreen(mg.FINISH);
      if (fy > -20 && fy < H + 20) {
        mgCtx.fillStyle = '#ffd93d';
        for (let x = 0; x < W; x += 20) mgCtx.fillRect(x, fy, 10, 6);
        mgCtx.font = 'bold 14px Fredoka'; mgCtx.fillStyle = '#ffd93d';
        mgCtx.textAlign = 'center';
        mgCtx.fillText('FINISH', W / 2, fy - 8);
      }
      mgCtx.fillStyle = '#6bcf7f';
      for (const pl of mg.plats) {
        const sy = toScreen(pl.y);
        if (sy > -10 && sy < H + 10) {
          mgCtx.beginPath();
          mgCtx.roundRect(pl.x, sy, pl.w, 10, 5);
          mgCtx.fill();
        }
      }
      // jumper
      const jy = toScreen(mg.y);
      mgCtx.fillStyle = mg.color;
      mgCtx.beginPath(); mgCtx.arc(mg.x, jy - 10, 11, 0, Math.PI * 2); mgCtx.fill();
      mgCtx.fillStyle = 'white';
      mgCtx.beginPath(); mgCtx.arc(mg.x - 4, jy - 13, 2.4, 0, Math.PI * 2);
      mgCtx.arc(mg.x + 4, jy - 13, 2.4, 0, Math.PI * 2); mgCtx.fill();
      // progress
      mgCtx.fillStyle = 'rgba(255,255,255,0.8)';
      mgCtx.font = 'bold 15px Fredoka'; mgCtx.textAlign = 'left';
      mgCtx.fillText(Math.round(Math.min(1, mg.maxY / mg.FINISH) * 100) + '%', 10, 22);
    }
    const goBtn = document.createElement('button');
    goBtn.id = 'sp-doodle-go';
    goBtn.textContent = '\ud83d\udcf1 Tap to start \u2014 tilt to steer!';
    mgScreen.appendChild(goBtn);
    mg.goBtn = goBtn;
    goBtn.addEventListener('click', async () => {
      goBtn.remove();
      if (mg) mg.goBtn = null;
      await enableTilt(mg);
      step();
    });
  }
  function stopDoodle() {
    if (mg && mg.kind === 'doodle') {
      mg.ended = true;
      if (mg.raf) cancelAnimationFrame(mg.raf);
      if (mg.onTilt) { window.removeEventListener('deviceorientation', mg.onTilt); mg.onTilt = null; }
      if (mg.goBtn) { mg.goBtn.remove(); mg.goBtn = null; }
      mgScreen.removeEventListener('pointerdown', mg.onDown);
      mgScreen.removeEventListener('pointerup', mg.onUp);
      mgScreen.removeEventListener('pointercancel', mg.onUp);
    }
  }
  function cleanupMg() {
    if (mg && mg.kind === 'pong' && mg.onPointer) {
      mgScreen.removeEventListener('pointermove', mg.onPointer);
      mgScreen.removeEventListener('pointerdown', mg.onPointer);
    }
    stopDoodle();
  }

  // --- Wheel of Fortune ---
  const wheelScreen = document.getElementById('wheel-screen');
  const wheelCanvas = document.getElementById('wheel-canvas');
  const wheelCtx = wheelCanvas.getContext('2d');
  const wheelSpinBtn = document.getElementById('wheel-spin-btn');
  const wheelResult = document.getElementById('wheel-result');
  let wheelSegs = [];
  function drawWheel(angle) {
    const cx = 150, cy = 150, r = 140, n = wheelSegs.length;
    const cols = ['#ff4d6d', '#4dabf7', '#ffd93d', '#b380ff', '#6bcf7f', '#ff9f4a'];
    wheelCtx.clearRect(0, 0, 300, 300);
    wheelCtx.save();
    wheelCtx.translate(cx, cy);
    wheelCtx.rotate(angle);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      wheelCtx.fillStyle = cols[i % cols.length];
      wheelCtx.beginPath(); wheelCtx.moveTo(0, 0); wheelCtx.arc(0, 0, r, a0, a1); wheelCtx.fill();
      wheelCtx.save();
      wheelCtx.rotate((a0 + a1) / 2);
      wheelCtx.fillStyle = 'white';
      wheelCtx.font = 'bold 13px Fredoka';
      wheelCtx.textAlign = 'right';
      const short = wheelSegs[i].replace(' Bonus Draw', ' Bonus').replace(' Everyone!', '!');
      wheelCtx.fillText(short.slice(0, 14), r - 10, 5);
      wheelCtx.restore();
    }
    wheelCtx.restore();
    // pointer
    wheelCtx.fillStyle = 'white';
    wheelCtx.beginPath();
    wheelCtx.moveTo(cx - 12, 4); wheelCtx.lineTo(cx + 12, 4); wheelCtx.lineTo(cx, 26);
    wheelCtx.fill();
  }
  function animateWheelTo(idx) {
    const n = wheelSegs.length;
    // pointer sits at the top (-90deg); land the middle of segment idx there
    const target = -Math.PI / 2 - ((idx + 0.5) / n) * Math.PI * 2 - Math.PI * 2 * 5;
    const start = performance.now(), DUR = 4000;
    function frame(t) {
      const k = Math.min(1, (t - start) / DUR);
      const ease = 1 - Math.pow(1 - k, 3);
      drawWheel(target * ease);
      if (k < 1) requestAnimationFrame(frame);
      else {
        wheelResult.textContent = wheelSegs[idx];
        try { if (navigator.vibrate) navigator.vibrate([80, 40, 80]); } catch (e) {}
        setTimeout(() => wheelScreen.classList.remove('show'), 2800);
      }
    }
    requestAnimationFrame(frame);
  }
  wheelSpinBtn.addEventListener('click', () => {
    if (true) {
      wheelSpinBtn.style.display = 'none';
      ctx.send({ type: 'spin' });
    }
  });

    ctrlCleanup = cleanupMg;

    handleMsg = (msg) => {
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'mgStart') {
        cleanupMg();
        if (msg.kind === 'pong') startPongPhone(msg);
        else if (msg.kind === 'tron') startTronPhone(msg);
      } else if (msg.type === 'mgState') {
        if (mg && mg.kind === 'pong') drawPong(msg);
        else if (mg && mg.kind === 'tron') tronFrame(msg);
      } else if (msg.type === 'mgEnd') {
        mgMsg.textContent = msg.you
          ? '🏆 YOU WIN! +1 Bonus Draw 🎁'
          : (msg.winner ? `${msg.winner} wins!` : 'Draw!');
        cleanupMg();
        closeMg(2300);
      } else if (msg.type === 'doodleStart') {
        cleanupMg();
        startDoodlePhone(msg);
      } else if (msg.type === 'doodleEnd') {
        stopDoodle();
        mgMsg.textContent = msg.you
          ? '🏆 YOU WIN! Get ready to spin…'
          : `🏁 ${msg.winner} reached the top first!`;
        closeMg(2200);
      } else if (msg.type === 'wheelOffer') {
        cleanupMg();
        mgScreen.classList.remove('show');
        wheelSegs = msg.segments || [];
        wheelResult.textContent = '';
        wheelSpinBtn.style.display = '';
        drawWheel(0);
        wheelScreen.classList.add('show');
        try { if (navigator.vibrate) navigator.vibrate([60, 40, 60]); } catch (e) {}
      } else if (msg.type === 'wheelResult') {
        wheelSegs = msg.segments || wheelSegs;
        if (!wheelScreen.classList.contains('show')) {
          wheelResult.textContent = '';
          wheelScreen.classList.add('show');
        }
        wheelSpinBtn.style.display = 'none';
        animateWheelTo(msg.idx);
      } else if (msg.type === 'state') {
        winCtl.classList.remove('show');
        const myTurnNow = !!(msg.yourTurn && !msg.finished && msg.started && !msg.mashActive);
        if (myTurnNow && !wasMyTurn) {
          try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
        }
        wasMyTurn = myTurnNow;
        wrap.classList.toggle('your-turn', myTurnNow);
        mashBtn.disabled = !msg.mashActive;
        drawBtn.disabled = !msg.canDraw;
        bonusBtn.classList.toggle('show', msg.canDraw && msg.bonusDraws > 0);
        if (msg.bonusDraws > 0) bonusBtn.textContent = `🎁 Bonus Draw ×${msg.bonusDraws}`;
        if (msg.finished) statusEl.textContent = '🏰 You made it to the castle!';
        else if (msg.mashActive) statusEl.textContent = '⚡ MASH MASH MASH! ⚡';
        else if (msg.canDraw) statusEl.textContent = '⭐ Your turn — draw a card!';
        else if (!msg.started) statusEl.textContent = 'Waiting for the adventure to start…';
        else statusEl.textContent = 'Waiting for your turn…';
      } else if (msg.type === 'win') {
        statusEl.textContent = `👑 ${msg.name} won the game!`;
        wrap.classList.remove('your-turn');
        mashBtn.disabled = true;
        drawBtn.disabled = true;
        bonusBtn.classList.remove('show');
      } else if (msg.type === 'winCtl') {
        winCtl.classList.add('show');
        statusEl.textContent = '👑 You have the controls!';
      } else if (msg.type === 'hostBtn') {
        if (msg.label) {
          hostBtn.textContent = '\ud83d\udc51 ' + msg.label;
          hostBtn.classList.add('show');
        } else {
          hostBtn.classList.remove('show');
        }
      } else if (msg.type === 'wait') {
        wrap.classList.remove('your-turn');
        mashBtn.disabled = true;
        drawBtn.disabled = true;
        statusEl.textContent = msg.reason || 'Hang tight…';
      }
    };
  }

  return {
    start() {
      ctx.root.innerHTML = CTRL_HTML;
      setup();
      document.getElementById('sp-status').textContent = 'Get ready…';
    },
    onMessage(data) { if (handleMsg) handleMsg(data); },
    destroy() {
      if (ctrlCleanup) { try { ctrlCleanup(); } catch (e) {} }
      handleMsg = null;
      ctx.root.innerHTML = '';
    },
  };
}

export default {
  id: 'sweetpath',
  title: 'Sweet Path',
  tagline: 'Race the candy board to the Sugar Castle',
  emoji: '🍭',
  minPlayers: 2,
  maxPlayers: 8,
  comingSoon: false,
  createHost,
  createController,
};
