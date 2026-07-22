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
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam || sessionStorage.getItem('pp_ctrl_room')) {
  startController(joinParam);
} else {
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

    const ctx = { root, players: publicPlayers, sendTo, sendAll, exit: exitGame };
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
    $('lobby-screen').classList.remove('hidden');
    broadcastRaw({ type: 'scene', scene: 'lobby' });
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
      chip.innerHTML = `<span class="chip-avatar">${p.avatar}</span>${escapeHtml(p.name)}`;
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
      if ((location.protocol === 'http:' || location.protocol === 'https:') && typeof QRCode !== 'undefined') {
        const joinUrl = location.origin + location.pathname + '?join=' + roomCode;
        new QRCode(qrBox, { text: joinUrl, width: 128, height: 128 });
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
      let p = msg.playerId ? players.get(msg.playerId) : null;

      if (p) {
        // Rejoining phone — reattach.
        if (p.conn && p.conn.open && p.conn !== conn) { try { p.conn.close(); } catch (e) {} }
        p.conn = conn;
        p.connected = true;
        if (msg.name) p.name = sanitizeName(msg.name);
        conn.metadata_ppid = p.id;
        sendRaw(p, { type: 'welcome', playerId: p.id, name: p.name, avatar: p.avatar, color: p.color });
        sendRaw(p, scene === 'game' && active
          ? { type: 'scene', scene: 'game', gameId: active.module.id }
          : { type: 'scene', scene: 'lobby' });
        renderRoster(); renderGameGrid();
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
      };
      players.set(id, p);
      joinOrder.push(id);
      conn.metadata_ppid = id;

      sendRaw(p, { type: 'welcome', playerId: id, name: p.name, avatar: p.avatar, color: p.color });
      sendRaw(p, scene === 'game' && active
        ? { type: 'scene', scene: 'game', gameId: active.module.id }
        : { type: 'scene', scene: 'lobby' });
      renderRoster(); renderGameGrid();
      if (active && active.instance.onPlayerJoin) {
        active.instance.onPlayerJoin(publicPlayer(id));
      }
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
  const roomPrefill = codeFromUrl || sessionStorage.getItem('pp_ctrl_room') || '';
  $('ctrl-code').value = (roomPrefill || '').toUpperCase();
  if (saved && saved.name) $('ctrl-name').value = saved.name;

  let peer = null;
  let conn = null;
  let me = null;                  // {playerId, name, avatar, color}
  let activeCtrl = null;          // { module, instance }
  let reconnectTimer = null;
  let everConnected = false;

  const statusEl = $('ctrl-join-status');

  $('ctrl-join-btn').addEventListener('click', join);
  $('ctrl-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  // If this phone was already in a room (page reload), rejoin automatically.
  if (saved && saved.room && (!codeFromUrl || codeFromUrl.toUpperCase() === saved.room)) {
    $('ctrl-code').value = saved.room;
    join();
  }

  function join() {
    const code = $('ctrl-code').value.trim().toUpperCase();
    const name = $('ctrl-name').value.trim();
    if (code.length !== 4) { statusEl.textContent = 'Enter the 4-letter room code.'; return; }
    if (!name) { statusEl.textContent = 'Pick a name so friends know who you are.'; return; }

    sessionStorage.setItem('pp_ctrl_room', code);
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
      const savedNow = readJson('pp_ctrl_saved');
      conn.send({
        type: 'hello',
        name,
        playerId: savedNow && savedNow.room === code ? savedNow.playerId : null,
      });
    });

    conn.on('data', (msg) => handleHostMessage(msg, code, name));

    conn.on('close', () => {
      setConnDot(false);
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

    if (msg.type === 'scene') {
      teardownCtrlGame();
      const root = $('ctrl-game-root');
      if (msg.scene === 'game') {
        const module = GAMES.find((g) => g.id === msg.gameId);
        if (!module) return;
        root.innerHTML = '';
        const ctx = {
          root,
          send: (data) => { if (conn && conn.open) conn.send({ type: 'game', data }); },
          playerId: me ? me.playerId : null,
          playerName: me ? me.name : '',
        };
        activeCtrl = { module, instance: module.createController(ctx) };
        activeCtrl.instance.start();
      } else {
        root.innerHTML = `
          <div class="ctrl-wait">
            <div class="ctrl-wait-emoji">🎉</div>
            <p>You're in! Watch the big screen —<br />the host is picking a game.</p>
          </div>`;
      }
      return;
    }

    if (msg.type === 'game') {
      if (activeCtrl && activeCtrl.instance.onMessage) activeCtrl.instance.onMessage(msg.data);
    }
  }

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
  return String(s || '').replace(/[<>]/g, '').trim().slice(0, 12);
}
function readJson(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch (e) { return null; }
}
function writeJson(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
}
