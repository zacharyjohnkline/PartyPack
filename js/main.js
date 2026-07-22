/* ============================================================
   Party Pack — main.js
   The app shell. Owns:
     • host/controller mode detection
     • PeerJS room (one room for the whole party, reused across games)
     • lobby UI, roster, QR/join flow, reconnection
     • the game registry + scene routing

   Games are self-contained modules (see js/games/*.js) that
   implement the interface documented below and never touch
   networking directly — the shell routes messages for them.
   ============================================================

   GAME MODULE INTERFACE
   ---------------------
   export default {
     id: 'topbanana',            // unique, stable string
     title: 'Top Banana',
     tagline: 'Shown on the menu card',
     emoji: '🍌',
     minPlayers: 3,
     maxPlayers: 10,
     comingSoon: false,          // true → shown but not playable

     // Called on the big screen when the host picks the game.
     createHost(ctx) -> {
       start(),                       // render + begin
       onMessage(playerId, data),     // a phone sent {type:'game', data}
       onPlayerJoin(player),          // optional: someone joined mid-game
       onPlayerLeave(playerId),       // optional: someone disconnected
       onPlayerRejoin(player),        // optional: someone reconnected
       destroy(),                     // tear down (timers, DOM)
     }
     // host ctx: {
     //   root,                DOM element to render into
     //   players(),           [{id, name, avatar, color, connected}] in join order
     //   sendTo(id, data),    message one phone
     //   sendAll(data),       message every phone
     //   exit(),              leave the game, back to the lobby
     // }

     // Called on each phone when the game starts.
     createController(ctx) -> {
       start(),
       onMessage(data),
       destroy(),
     }
     // controller ctx: { root, send(data), playerId, playerName }
   }
   ============================================================ */

import { escapeHtml } from './util.js';
import topBanana from './games/topbanana.js';
import sweetPath from './games/sweetpath.js';

const GAMES = [topBanana, sweetPath];

const AVATARS = ['🍓', '🍋', '🍇', '🫐', '🍑', '🍍', '🥝', '🍒', '🍉', '🍊'];
const COLORS  = ['#ff4d6d', '#ff9f4a', '#ffd93d', '#6bcf7f', '#4dabf7', '#b380ff',
                 '#ff7ab8', '#2fbf9b', '#f76d5e', '#7a89ff'];

const $ = (id) => document.getElementById(id);

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/* ============================================================
   Mode detection: ?join=CODE → controller, otherwise host
   ============================================================ */
const bootParams = new URLSearchParams(location.search);
const joinParam = bootParams.get('join');
const forceHost = bootParams.has('host');
let savedCtrlRoom = null;
try { savedCtrlRoom = localStorage.getItem('pp_ctrl_room'); } catch (e) {}
if (!forceHost && (joinParam || savedCtrlRoom)) {
  startController(joinParam);
} else {
  if (forceHost) {
    // This device is explicitly the big screen — forget any controller past.
    try { localStorage.removeItem('pp_ctrl_room'); localStorage.removeItem('pp_ctrl_saved'); } catch (e) {}
  }
  startHost();
}

/* ============================================================
   HOST (big screen)
   ============================================================ */
function startHost() {
  $('host-app').classList.remove('hidden');

  const players = new Map();      // playerId -> {id, name, avatar, color, conn, connected}
  let joinOrder = [];             // playerIds in the order they first joined
  let nextSeat = 0;
  let scene = 'lobby';            // 'lobby' | 'game'
  let active = null;              // { module, instance }
  let hostPeer = null;
  let partyHostId = null;         // playerId of the phone leading the party

  // Reuse the room across page reloads so phones stay paired.
  let roomCode = sessionStorage.getItem('pp_room');
  if (!roomCode) {
    roomCode = randomCode();
    sessionStorage.setItem('pp_room', roomCode);
  }

  /* ---------- helpers exposed to games via ctx ---------- */
  function publicPlayers() {
    return joinOrder
      .map((id) => players.get(id))
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, color: p.color, connected: p.connected }));
  }
  function sendTo(playerId, data) {
    const p = players.get(playerId);
    if (p && p.conn && p.conn.open) p.conn.send({ type: 'game', data });
  }
  function sendAll(data) {
    for (const p of players.values()) {
      if (p.conn && p.conn.open) p.conn.send({ type: 'game', data });
    }
  }
  function sendRaw(p, msg) {
    if (p.conn && p.conn.open) p.conn.send(msg);
  }
  function broadcastRaw(msg) {
    for (const p of players.values()) sendRaw(p, msg);
  }

  function partyState() {
    const connectedCount = publicPlayers().filter((p) => p.connected).length;
    const h = partyHostId ? players.get(partyHostId) : null;
    return {
      type: 'party',
      hostId: partyHostId,
      hostName: h ? h.name : '',
      hostConnected: !!(h && h.connected),
      players: publicPlayers().map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, connected: p.connected })),
      games: GAMES.map((g) => ({
        id: g.id, title: g.title, tagline: g.tagline, emoji: g.emoji,
        minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
        comingSoon: !!g.comingSoon,
        canStart: !g.comingSoon && connectedCount >= g.minPlayers,
        need: Math.max(0, g.minPlayers - connectedCount),
      })),
    };
  }
  function broadcastParty() { broadcastRaw(partyState()); }

  /* ---------- game lifecycle ---------- */
  function startGame(module) {
    if (active || module.comingSoon) return;
    const connected = publicPlayers().filter((p) => p.connected);
    if (connected.length < module.minPlayers) return;

    scene = 'game';
    $('lobby-screen').classList.add('hidden');
    const root = $('game-root');
    root.innerHTML = '';
    root.classList.remove('hidden');
    $('host-exit-btn').classList.remove('hidden');
    $('game-qr').classList.remove('hidden');

    const ctx = { root, players: publicPlayers, sendTo, sendAll, exit: exitGame, hostPlayerId: () => partyHostId };
    active = { module, instance: module.createHost(ctx) };
    broadcastRaw({ type: 'scene', scene: 'game', gameId: module.id });
    active.instance.start();
  }

  function exitGame() {
    if (!active) return;
    try { active.instance.destroy(); } catch (e) { console.error(e); }
    active = null;
    scene = 'lobby';
    const root = $('game-root');
    root.innerHTML = '';
    root.classList.add('hidden');
    $('host-exit-btn').classList.add('hidden');
    $('game-qr').classList.add('hidden');
    $('lobby-screen').classList.remove('hidden');
    broadcastRaw({ type: 'scene', scene: 'lobby' });
    broadcastParty();
    renderRoster();
    renderGameGrid();
  }

  $('host-exit-btn').addEventListener('click', () => {
    if (confirm('End this game for everyone and go back to the lobby?')) exitGame();
  });

  /* ---------- lobby rendering ---------- */
  function renderRoster() {
    const roster = $('roster');
    roster.innerHTML = '';
    const list = publicPlayers();
    $('roster-empty').style.display = list.length ? 'none' : '';
    for (const p of list) {
      const chip = document.createElement('span');
      chip.className = 'player-chip' + (p.connected ? '' : ' offline');
      chip.style.setProperty('--chip-color', p.color);
      const crown = p.id === partyHostId ? '👑 ' : '';
      chip.innerHTML = `<span class="chip-avatar">${p.avatar}</span>${crown}${escapeHtml(p.name)}`;
      roster.appendChild(chip);
    }
  }

  function renderGameGrid() {
    const grid = $('game-grid');
    grid.innerHTML = '';
    const connectedCount = publicPlayers().filter((p) => p.connected).length;

    for (const g of GAMES) {
      const btn = document.createElement('button');
      btn.className = 'game-card';
      const notEnough = connectedCount < g.minPlayers;
      const disabled = g.comingSoon || notEnough;
      btn.disabled = disabled;

      let need = '';
      if (!g.comingSoon && notEnough) {
        const missing = g.minPlayers - connectedCount;
        need = `Need ${missing} more player${missing === 1 ? '' : 's'}`;
      }

      btn.innerHTML = `
        ${g.comingSoon ? '<span class="game-lock">Coming soon</span>' : ''}
        <span class="game-emoji">${g.emoji}</span>
        <span class="game-name">${escapeHtml(g.title)}</span>
        <span class="game-tagline">${escapeHtml(g.tagline)}</span>
        <span class="game-players">${g.minPlayers}–${g.maxPlayers} players</span>
        <span class="game-need">${need}</span>`;

      if (!disabled) btn.addEventListener('click', () => startGame(g));
      grid.appendChild(btn);
    }
  }

  /* ---------- networking ---------- */
  function openRoom() {
    hostPeer = new Peer('partypack-' + roomCode);

    hostPeer.on('open', () => {
      $('room-code').textContent = roomCode;
      $('host-status').textContent = 'Room is open';
      const qrBox = $('qr-box');
      qrBox.innerHTML = '';
      const gameQr = $('game-qr-code');
      gameQr.innerHTML = '';
      $('game-qr-roomcode').textContent = roomCode;
      if ((location.protocol === 'http:' || location.protocol === 'https:') && typeof QRCode !== 'undefined') {
        const joinUrl = location.origin + location.pathname + '?join=' + roomCode;
        new QRCode(qrBox, { text: joinUrl, width: 128, height: 128 });
        new QRCode(gameQr, { text: joinUrl, width: 84, height: 84 });
      } else {
        qrBox.innerHTML = '<span style="font-size:12px;color:#8a5a78;padding:8px">Serve over http(s)<br>for a QR code</span>';
      }
    });

    hostPeer.on('connection', (conn) => {
      conn.on('data', (msg) => handleControllerMessage(conn, msg));
      conn.on('close', () => handleDisconnect(conn));
      conn.on('error', () => handleDisconnect(conn));
    });

    hostPeer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Stale room id (e.g. an old tab). Pick a fresh code.
        sessionStorage.removeItem('pp_room');
        roomCode = randomCode();
        sessionStorage.setItem('pp_room', roomCode);
        $('host-status').textContent = 'Re-opening the room…';
        setTimeout(openRoom, 800);
      } else {
        $('host-status').textContent = 'Connection problem (' + err.type + '). Reload to retry.';
      }
    });

    hostPeer.on('disconnected', () => {
      $('host-status').textContent = 'Reconnecting to the signaling server…';
      try { hostPeer.reconnect(); } catch (e) {}
    });
  }

  function handleControllerMessage(conn, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'hello') {
      const dev = typeof msg.deviceId === 'string' ? msg.deviceId.slice(0, 40) : null;
      let p = msg.playerId ? players.get(msg.playerId) : null;
      if (!p && dev) {
        // New tab / cleared session on a known phone — same device, same player.
        for (const cand of players.values()) {
          if (cand.deviceId && cand.deviceId === dev) { p = cand; break; }
        }
      }

      if (p) {
        // Rejoining phone — reattach, and tell any older tab to stand down
        // so the two tabs don't fight over the connection.
        if (p.conn && p.conn.open && p.conn !== conn) {
          try { p.conn.send({ type: 'superseded' }); } catch (e) {}
          try { p.conn.close(); } catch (e) {}
        }
        if (dev) p.deviceId = dev;
        p.conn = conn;
        p.connected = true;
        if (msg.name) p.name = sanitizeName(msg.name);
        conn.metadata_ppid = p.id;
        sendRaw(p, { type: 'welcome', playerId: p.id, name: p.name, avatar: p.avatar, color: p.color });
        sendRaw(p, scene === 'game' && active
          ? { type: 'scene', scene: 'game', gameId: active.module.id }
          : { type: 'scene', scene: 'lobby' });
        renderRoster(); renderGameGrid();
        broadcastParty();
        if (active && active.instance.onPlayerRejoin) {
          active.instance.onPlayerRejoin(publicPlayer(p.id));
        }
        return;
      }

      // Brand-new player.
      const id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      const seat = nextSeat++;
      p = {
        id,
        name: sanitizeName(msg.name) || 'Player ' + (seat + 1),
        avatar: AVATARS[seat % AVATARS.length],
        color: COLORS[seat % COLORS.length],
        conn,
        connected: true,
        deviceId: dev,
      };
      players.set(id, p);
      joinOrder.push(id);
      conn.metadata_ppid = id;

      sendRaw(p, { type: 'welcome', playerId: id, name: p.name, avatar: p.avatar, color: p.color });
      sendRaw(p, scene === 'game' && active
        ? { type: 'scene', scene: 'game', gameId: active.module.id }
        : { type: 'scene', scene: 'lobby' });
      renderRoster(); renderGameGrid();
      broadcastParty();
      if (active && active.instance.onPlayerJoin) {
        active.instance.onPlayerJoin(publicPlayer(id));
      }
      return;
    }

    if (msg.type === 'claim-host') {
      const pid = conn.metadata_ppid;
      if (!pid || !players.has(pid)) return;
      const current = partyHostId ? players.get(partyHostId) : null;
      // Claimable when there's no host, the host seat is offline, or it's already you.
      if (!current || !current.connected || partyHostId === pid) {
        partyHostId = pid;
        renderRoster();
        broadcastParty();
      }
      return;
    }

    if (msg.type === 'transfer-host') {
      const pid = conn.metadata_ppid;
      if (pid && pid === partyHostId && typeof msg.to === 'string') {
        const target = players.get(msg.to);
        if (target && target.connected) {
          partyHostId = msg.to;
          renderRoster();
          broadcastParty();
        }
      }
      return;
    }

    if (msg.type === 'pick-game') {
      const pid = conn.metadata_ppid;
      if (pid && pid === partyHostId && scene === 'lobby') {
        const g = GAMES.find((x) => x.id === msg.gameId);
        if (g) startGame(g);
      }
      return;
    }

    if (msg.type === 'exit-game') {
      const pid = conn.metadata_ppid;
      if (pid && pid === partyHostId && scene === 'game') exitGame();
      return;
    }

    if (msg.type === 'game') {
      const pid = conn.metadata_ppid;
      if (pid && active && active.instance.onMessage) {
        active.instance.onMessage(pid, msg.data);
      }
    }
  }

  function publicPlayer(id) {
    const p = players.get(id);
    return p ? { id: p.id, name: p.name, avatar: p.avatar, color: p.color, connected: p.connected } : null;
  }

  function handleDisconnect(conn) {
    const pid = conn.metadata_ppid;
    if (!pid) return;
    const p = players.get(pid);
    if (!p || p.conn !== conn) return; // an old, replaced connection
    p.connected = false;
    renderRoster(); renderGameGrid();
    broadcastParty();
    if (active && active.instance.onPlayerLeave) active.instance.onPlayerLeave(pid);
  }

  renderRoster();
  renderGameGrid();
  openRoom();
}

/* ============================================================
   CONTROLLER (phone)
   ============================================================ */
function startController(codeFromUrl) {
  $('controller-app').classList.remove('hidden');

  const saved = readJson('pp_ctrl_saved'); // {room, playerId, name}
  let roomPrefill = codeFromUrl || '';
  if (!roomPrefill) { try { roomPrefill = localStorage.getItem('pp_ctrl_room') || ''; } catch (e) {} }
  if (!roomPrefill && saved && saved.room) roomPrefill = saved.room;
  $('ctrl-code').value = (roomPrefill || '').toUpperCase();
  if (saved && saved.name) $('ctrl-name').value = saved.name;

  $('ctrl-open-host').addEventListener('click', () => {
    location.href = location.pathname + '?host=1';
  });

  let peer = null;
  let conn = null;
  let me = null;                  // {playerId, name, avatar, color}
  let activeCtrl = null;          // { module, instance }
  let ctrlScene = 'lobby';        // 'lobby' | 'game'
  let party = null;               // latest {type:'party'} state from the big screen
  let iAmHost = false;
  let reconnectTimer = null;
  let everConnected = false;
  let superseded = false;   // a newer tab on this device took over
  let lastJoin = null;      // { code, name } for reconnects

  const statusEl = $('ctrl-join-status');

  $('ctrl-join-btn').addEventListener('click', join);
  $('ctrl-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  // If this phone already has a name and a room (any tab, any reload),
  // rejoin automatically — kids shouldn't have to retype anything.
  if (saved && saved.name && $('ctrl-code').value.length === 4) {
    join();
  }

  function join() {
    const code = $('ctrl-code').value.trim().toUpperCase();
    const name = $('ctrl-name').value.trim();
    if (code.length !== 4) { statusEl.textContent = 'Enter the 4-letter room code.'; return; }
    if (!name) { statusEl.textContent = 'Pick a name so friends know who you are.'; return; }

    try { localStorage.setItem('pp_ctrl_room', code); } catch (e) {}
    $('ctrl-join-btn').disabled = true;
    statusEl.textContent = 'Connecting…';

    if (!peer) {
      peer = new Peer();
      peer.on('open', () => connectToHost(code, name));
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          if (everConnected) {
            statusEl.textContent = 'Waiting for the big screen…';
            scheduleReconnect(code, name);
          } else {
            statusEl.textContent = 'Room not found — check the code and the big screen.';
            $('ctrl-join-btn').disabled = false;
          }
        } else {
          statusEl.textContent = 'Connection problem (' + err.type + '). Try again.';
          $('ctrl-join-btn').disabled = false;
        }
      });
    } else if (peer.open) {
      connectToHost(code, name);
    }
  }

  function connectToHost(code, name) {
    conn = peer.connect('partypack-' + code, { reliable: true });

    conn.on('open', () => {
      everConnected = true;
      lastJoin = { code, name };
      const savedNow = readJson('pp_ctrl_saved');
      conn.send({
        type: 'hello',
        name,
        playerId: savedNow && savedNow.room === code ? savedNow.playerId : null,
        deviceId: getDeviceId(),
      });
    });

    conn.on('data', (msg) => handleHostMessage(msg, code, name));

    conn.on('close', () => {
      setConnDot(false);
      if (superseded) return;
      statusEl.textContent = 'Big screen went away — reconnecting…';
      scheduleReconnect(code, name);
    });
  }

  function scheduleReconnect(code, name) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connectToHost(code, name), 2500);
  }

  function handleHostMessage(msg, code) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'welcome') {
      me = { playerId: msg.playerId, name: msg.name, avatar: msg.avatar, color: msg.color };
      writeJson('pp_ctrl_saved', { room: code, playerId: msg.playerId, name: msg.name });
      $('ctrl-join-screen').classList.add('hidden');
      $('ctrl-main-screen').classList.remove('hidden');
      $('ctrl-avatar').textContent = msg.avatar;
      $('ctrl-player-name').textContent = msg.name;
      $('ctrl-player-name').style.color = msg.color;
      setConnDot(true);
      return;
    }

    if (msg.type === 'superseded') {
      superseded = true;
      clearTimeout(reconnectTimer);
      teardownCtrlGame();
      ctrlScene = 'lobby';
      setConnDot(false);
      const root = $('ctrl-game-root');
      root.innerHTML = `
        <div class="ctrl-wait">
          <div class="ctrl-wait-emoji">👋</div>
          <p>You joined from another tab,<br />so this one went to sleep.</p>
          <button class="ctrl-btn ctrl-btn-big ctrl-rejoin-btn">Play here instead</button>
        </div>`;
      root.querySelector('.ctrl-rejoin-btn').addEventListener('click', () => {
        superseded = false;
        if (lastJoin) connectToHost(lastJoin.code, lastJoin.name);
      });
      return;
    }

    if (msg.type === 'scene') {
      teardownCtrlGame();
      const root = $('ctrl-game-root');
      if (msg.scene === 'game') {
        const module = GAMES.find((g) => g.id === msg.gameId);
        if (!module) return;
        ctrlScene = 'game';
        root.innerHTML = '';
        const ctx = {
          root,
          send: (data) => { if (conn && conn.open) conn.send({ type: 'game', data }); },
          playerId: me ? me.playerId : null,
          playerName: me ? me.name : '',
          isHost: () => iAmHost,
        };
        activeCtrl = { module, instance: module.createController(ctx) };
        activeCtrl.instance.start();
      } else {
        ctrlScene = 'lobby';
        renderCtrlLobby();
      }
      updateHostChrome();
      return;
    }

    if (msg.type === 'party') {
      party = msg;
      iAmHost = !!(me && msg.hostId === me.playerId);
      if (ctrlScene === 'lobby') renderCtrlLobby();
      updateHostChrome();
      return;
    }

    if (msg.type === 'game') {
      if (activeCtrl && activeCtrl.instance.onMessage) activeCtrl.instance.onMessage(msg.data);
    }
  }

  function renderCtrlLobby() {
    const root = $('ctrl-game-root');

    if (iAmHost && party) {
      root.innerHTML = `
        <div class="ctrl-menu">
          <h2 class="ctrl-menu-title">👑 You're the host</h2>
          <p class="ctrl-menu-sub">Pick a game for the group:</p>
          <div class="ctrl-menu-list"></div>
        </div>`;
      const list = root.querySelector('.ctrl-menu-list');
      for (const g of party.games) {
        const btn = document.createElement('button');
        btn.className = 'ctrl-menu-game';
        btn.disabled = g.comingSoon || !g.canStart;
        const note = g.comingSoon
          ? 'Coming soon'
          : (g.canStart ? `${g.minPlayers}–${g.maxPlayers} players`
                        : `Need ${g.need} more player${g.need === 1 ? '' : 's'}`);
        btn.innerHTML = `
          <span class="ctrl-menu-emoji">${g.emoji}</span>
          <span class="ctrl-menu-text">
            <span class="ctrl-menu-name">${escapeHtml(g.title)}</span>
            <span class="ctrl-menu-tag">${escapeHtml(g.tagline)}</span>
          </span>
          <span class="ctrl-menu-note${g.canStart ? '' : ' warn'}">${note}</span>`;
        if (!btn.disabled) {
          btn.addEventListener('click', () => {
            if (conn && conn.open) conn.send({ type: 'pick-game', gameId: g.id });
          });
        }
        list.appendChild(btn);
      }

      const others = (party.players || []).filter((pp) => pp.connected && me && pp.id !== me.playerId);
      if (others.length) {
        const tr = document.createElement('div');
        tr.className = 'ctrl-transfer';
        tr.innerHTML = `
          <p class="ctrl-menu-sub">Or pass the crown to someone else:</p>
          <div class="ctrl-transfer-list"></div>`;
        const trList = tr.querySelector('.ctrl-transfer-list');
        for (const pp of others) {
          const btn = document.createElement('button');
          btn.className = 'ctrl-transfer-btn';
          btn.innerHTML = `<span>${pp.avatar}</span><span>${escapeHtml(pp.name)}</span><span class="crown-hint">Make host 👑</span>`;
          btn.addEventListener('click', () => {
            if (conn && conn.open) conn.send({ type: 'transfer-host', to: pp.id });
          });
          trList.appendChild(btn);
        }
        root.querySelector('.ctrl-menu').appendChild(tr);
      }
      return;
    }

    const hostLive = !!(party && party.hostId && party.hostConnected);
    const hostLine = hostLive
      ? `Waiting for <b>👑 ${escapeHtml(party.hostName)}</b><br />to pick a game…`
      : `You're in! Someone needs to lead<br />the party and pick the game.`;
    root.innerHTML = `
      <div class="ctrl-wait">
        <div class="ctrl-wait-emoji">🎉</div>
        <p>${hostLine}</p>
        ${hostLive ? '' : '<button class="ctrl-btn ctrl-btn-big ctrl-claim-btn">👑 Become host</button>'}
      </div>`;
    const claim = root.querySelector('.ctrl-claim-btn');
    if (claim) {
      claim.addEventListener('click', () => {
        if (conn && conn.open) conn.send({ type: 'claim-host' });
      });
    }
  }

  // The host phone gets a small "End game" button in the header during games.
  function updateHostChrome() {
    $('ctrl-host-exit').classList.toggle('hidden', !(iAmHost && ctrlScene === 'game'));
  }

  $('ctrl-host-exit').addEventListener('click', () => {
    if (confirm('End this game for everyone and go back to the menu?')) {
      if (conn && conn.open) conn.send({ type: 'exit-game' });
    }
  });

  function teardownCtrlGame() {
    if (activeCtrl) {
      try { activeCtrl.instance.destroy(); } catch (e) { console.error(e); }
      activeCtrl = null;
    }
  }

  function setConnDot(on) {
    $('ctrl-conn-dot').classList.toggle('off', !on);
  }
}

/* ============================================================
   Small utilities
   ============================================================ */
function sanitizeName(s) {
  return String(s || '').replace(/[<>]/g, '').trim().slice(0, 20);
}
function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function writeJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}

// A stable per-device identity so any tab (or a reopened browser) on the same
// phone reclaims the same player instead of adding a duplicate.
function getDeviceId() {
  try {
    let d = localStorage.getItem('pp_device');
    if (!d) {
      d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pp_device', d);
    }
    return d;
  } catch (e) { return null; }
}
