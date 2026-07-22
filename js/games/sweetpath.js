/* ============================================================
   Sweet Path — placeholder module.

   This reserves Sweet Path's spot on the menu. It's marked
   comingSoon, so the card shows on the big screen but can't be
   started yet.

   HOW TO PORT THE EXISTING GAME INTO THIS MODULE
   ----------------------------------------------
   The single-file sweet_path/index.html contains three layers
   that map cleanly onto this module's interface:

   1. NETWORKING (delete it). The old file creates its own PeerJS
      room, QR code, hello/claim handshake, and reconnect logic.
      All of that is now owned by js/main.js. Replace every
      `conn.send(...)` with `ctx.sendTo(id, data)` / `ctx.sendAll(data)`
      on the host and `ctx.send(data)` on the controller, and move
      the message handlers into onMessage(). Player identity
      (id / name / avatar / color) comes from ctx.players() instead
      of the old slot-claiming flow.

   2. HOST RENDERING (keep it, re-rooted). The Three.js scene,
      board building, dice, and animations move into createHost().
      Build the scene inside ctx.root instead of document.body,
      and dispose of the renderer + cancel the animation loop in
      destroy() so returning to the lobby is clean:
         renderer.dispose(); cancelAnimationFrame(rafId);
      The Three.js import map stays in index.html (or switch the
      module to `import * as THREE from` a CDN URL directly).

   3. CONTROLLER UI (keep it, re-rooted). The phone screens
      (roll button, turn indicator, mini-game buttons) move into
      createController(), rendered into ctx.root. The shell keeps
      the phone paired across reloads, so the old rejoin QR and
      passcode screens are no longer needed.

   Styles go in a new css/sweetpath.css linked from index.html,
   prefixed (e.g. .sp-) so they can't collide with other games.
   ============================================================ */

export default {
  id: 'sweetpath',
  title: 'Sweet Path',
  tagline: 'The candy board race, coming to the pack',
  emoji: '🍭',
  minPlayers: 2,
  maxPlayers: 6,
  comingSoon: true,

  createHost() {
    return { start() {}, onMessage() {}, destroy() {} };
  },
  createController() {
    return { start() {}, onMessage() {}, destroy() {} };
  },
};
