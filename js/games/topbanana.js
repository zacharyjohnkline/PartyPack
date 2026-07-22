/* ============================================================
   Top Banana — an Apples-to-Apples-style judging game.

   Each round one player is the Banana Judge. The big screen
   shows a golden prompt card; everyone else secretly plays the
   answer card from their hand that matches it best (or worst,
   or funniest — the judge decides what wins!). The judge crowns
   a winner, who earns a banana. First to 5 bananas wins.

   All card text here is original content written for this game.
   ============================================================ */

import { escapeHtml, shuffle } from '../util.js';

const WIN_SCORE = 5;
const HAND_SIZE = 7;
const RESULT_MS = 5200;

/* ---------------- original card content ---------------- */

const PROMPTS = [
  'Suspiciously sticky', 'Absolutely majestic', 'Terrible at parties', 'Weirdly delicious',
  'Grandma-approved', 'Illegal in space', 'Extremely wiggly', 'Wildly overrated',
  'Secretly underrated', 'Mildly haunted', 'Surprisingly expensive', 'Great at hide-and-seek',
  'Way too loud', 'Dangerously cheesy', 'Extra fancy', 'Impossible to fold',
  'Better with sprinkles', 'Pure chaos', 'Smells like victory', 'Older than the internet',
  'Good in a sandwich', 'Too hot to handle', 'Invisible on Tuesdays', 'Aggressively sparkly',
  'The world\u2019s worst gift', 'Very ticklish', 'Faster than a toddler', 'Extra crunchy',
  'Extremely slippery', 'Mysteriously missing', 'Perfect for karaoke', 'Unreasonably bouncy',
  'Stronger than it looks', 'Full of secrets', 'Terrifying but cute', 'Deeply dramatic',
  'Allergic to Mondays', 'Champion material', 'Highly suspicious', 'Glow-in-the-dark',
  'Unbearably fluffy', 'A little too honest', 'Ninety percent glitter', 'Banned from the library',
  'Shockingly polite', 'Always late', 'Secretly a robot', 'Squeaky',
];

const ANSWERS = [
  'A sock full of pudding', 'My neighbor\u2019s lawn flamingo', 'A grumpy walrus',
  'The last slice of pizza', 'A trampoline in the kitchen', 'Grandpa\u2019s dance moves',
  'A suitcase of rubber ducks', 'The school mascot', 'A sneeze in slow motion',
  'Bubble wrap', 'A wizard\u2019s grocery list', 'The office printer',
  'A cat in a tuxedo', 'Homework', 'A haunted vending machine',
  'A llama on rollerblades', 'The moon', 'Ketchup on ice cream',
  'A very long escalator', 'Uncle Gary\u2019s karaoke night', 'A pirate\u2019s retirement party',
  'The world\u2019s smallest violin', 'A traffic cone', 'Glitter glue',
  'An aggressive pigeon', 'The five-second rule', 'A ninja librarian',
  'Soup eaten with a fork', 'My imaginary friend', 'A screaming goat',
  'The Bermuda Triangle', 'A jar of expired mayonnaise', 'Velcro shoes',
  'A dramatic hamster', 'The last donut in the box', 'A wobbly shopping cart',
  'Elevator music', 'A garden gnome uprising', 'Surprise homework on Friday',
  'A whoopee cushion orchestra', 'The dentist\u2019s waiting room', 'A potato wearing sunglasses',
  'Synchronized swimming', 'A porcupine hug', 'The end of the rainbow',
  'A malfunctioning robot butler', 'Cafeteria mystery meat', 'A yodeling contest',
  'Quicksand', 'A sloth marathon', 'The world\u2019s stickiest handshake',
  'A parade of penguins', 'Dad jokes', 'A unicycle built for two',
  'The missing TV remote', 'A sandwich with too much mustard', 'Interpretive dance',
  'My 3 a.m. thoughts', 'A T-rex trying to clap', 'The neighbor\u2019s wifi password',
  'A suspicious puddle', 'Competitive napping', 'A moose in a canoe',
  'The last day of summer', 'A vampire at the beach', 'Lukewarm bathwater',
  'A squirrel with a plan', 'The gym membership nobody uses', 'A one-man kazoo band',
  'Mismatched socks', 'A raccoon in a trench coat', 'The snooze button',
  'A very serious clown', 'Expired coupons', 'A jellyfish handshake',
  'The line at the DMV', 'A karate-chopping grandma', 'Free samples',
  'A drawbridge that\u2019s always up', 'My evil twin', 'A tap-dancing octopus',
  'The world\u2019s largest rubber band ball', 'A silent disco', 'Overdue library books',
  'A sentient tumbleweed', 'The bottom of the cereal box', 'A polite tornado',
  'Escaped zoo flamingos', 'A couch cushion fort', 'A microwave burrito',
  'Deep-sea karaoke', 'A suspiciously calm toddler', 'The office holiday party',
  'A hedgehog in a hard hat', 'Instant noodles', 'A jousting lawnmower',
  'The seventh movie sequel', 'A disco ball in the shower', 'Cold french fries',
  'A very lost tourist', 'The record for longest hiccup', 'A caffeinated chihuahua',
  'My secret snack drawer', 'A revolving door race', 'A bear on a tiny bicycle',
  'Wet socks', 'A committee of owls', 'The last parking spot',
  'A dramatic slow-motion run', 'Homemade slime', 'A politely honking goose',
  'The mystery smell in the car', 'A knight in squeaky armor', 'An air guitar solo',
  'A very ambitious ant', 'The escalator to nowhere', 'A pillow fight championship',
  'Extra pickles', 'A ghost who pays rent', 'The juice box of destiny',
];

/* ---------------- helpers ---------------- */

/* ============================================================
   HOST (big screen)
   ============================================================ */
function createHost(ctx) {
  let deck = shuffle(ANSWERS);
  let discard = [];
  let prompts = shuffle(PROMPTS);

  const hands = new Map();        // playerId -> [cards]
  const scores = new Map();       // playerId -> n
  let seats = [];                 // playerIds in join order (fixed judge rotation)
  let judgeIdx = -1;
  let phase = 'idle';             // 'submit' | 'judge' | 'result' | 'gameover' | 'paused'
  let judgeId = null;
  let prompt = null;
  let submissions = [];           // [{playerId, card, key}]
  let resultTimer = null;
  let el = {};                    // cached DOM refs

  /* ---------- deck utilities ---------- */
  function draw() {
    if (deck.length === 0) { deck = shuffle(discard); discard = []; }
    return deck.pop();
  }
  function refillHand(id) {
    const h = hands.get(id) || [];
    while (h.length < HAND_SIZE && (deck.length || discard.length)) h.push(draw());
    hands.set(id, h);
  }

  function connectedSeats() {
    const live = new Set(ctx.players().filter((p) => p.connected).map((p) => p.id));
    return seats.filter((id) => live.has(id));
  }
  function playerById(id) {
    return ctx.players().find((p) => p.id === id) || null;
  }

  /* ---------- rendering ---------- */
  function renderShell() {
    ctx.root.innerHTML = `
      <div class="tb-host">
        <aside class="tb-scoreboard">
          <h3>🍌 Bananas</h3>
          <div class="tb-scores"></div>
          <div class="tb-goal">First to ${WIN_SCORE} wins</div>
        </aside>
        <main class="tb-stage">
          <div class="tb-round-label"></div>
          <div class="tb-prompt-card"><span class="tb-prompt-text"></span></div>
          <div class="tb-stage-status"></div>
          <div class="tb-submissions"></div>
          <div class="tb-banner hidden"></div>
        </main>
      </div>`;
    el = {
      scores: ctx.root.querySelector('.tb-scores'),
      roundLabel: ctx.root.querySelector('.tb-round-label'),
      promptCard: ctx.root.querySelector('.tb-prompt-card'),
      promptText: ctx.root.querySelector('.tb-prompt-text'),
      status: ctx.root.querySelector('.tb-stage-status'),
      subs: ctx.root.querySelector('.tb-submissions'),
      banner: ctx.root.querySelector('.tb-banner'),
    };
  }

  function renderScores() {
    el.scores.innerHTML = '';
    for (const id of seats) {
      const p = playerById(id);
      if (!p) continue;
      const row = document.createElement('div');
      row.className = 'tb-score-row'
        + (id === judgeId && (phase === 'submit' || phase === 'judge') ? ' judge' : '')
        + (p.connected ? '' : ' offline');
      row.style.setProperty('--pc', p.color);
      const n = scores.get(id) || 0;
      row.innerHTML = `
        <span class="tb-score-avatar">${p.avatar}</span>
        <span class="tb-score-name">${escapeHtml(p.name)}</span>
        <span class="tb-score-bananas">${'🍌'.repeat(n) || '<span class="tb-zero">–</span>'}</span>`;
      el.scores.appendChild(row);
    }
  }

  function renderSubmissionSlots() {
    el.subs.innerHTML = '';
    const expected = connectedSeats().filter((id) => id !== judgeId);
    for (const id of expected) {
      const got = submissions.some((s) => s.playerId === id);
      const slot = document.createElement('div');
      slot.className = 'tb-card tb-card-back' + (got ? ' in' : ' waiting');
      slot.dataset.pid = id;
      slot.innerHTML = got ? '<span class="tb-card-back-mark">🍌</span>' : '';
      el.subs.appendChild(slot);
    }
  }

  function revealSubmissions() {
    el.subs.innerHTML = '';
    for (const s of submissions) {
      const card = document.createElement('div');
      card.className = 'tb-card tb-card-face';
      card.dataset.key = s.key;
      card.innerHTML = `<span>${escapeHtml(s.card)}</span>`;
      el.subs.appendChild(card);
    }
  }

  function showBanner(html, cls) {
    el.banner.className = 'tb-banner ' + (cls || '');
    el.banner.innerHTML = html;
  }
  function hideBanner() { el.banner.className = 'tb-banner hidden'; }

  /* ---------- round flow ---------- */
  function startRound() {
    clearTimeout(resultTimer);
    hideBanner();

    // Seat anyone who joined since last round.
    for (const p of ctx.players()) {
      if (!seats.includes(p.id)) {
        seats.push(p.id);
        scores.set(p.id, scores.get(p.id) || 0);
      }
      refillHand(p.id);
    }

    const live = connectedSeats();
    if (live.length < 3) { pauseGame(); return; }

    // Rotate to the next connected judge.
    do { judgeIdx = (judgeIdx + 1) % seats.length; }
    while (!live.includes(seats[judgeIdx]));
    judgeId = seats[judgeIdx];

    if (prompts.length === 0) prompts = shuffle(PROMPTS);
    prompt = prompts.pop();
    submissions = [];
    phase = 'submit';

    const judge = playerById(judgeId);
    el.roundLabel.textContent = `${judge.avatar} ${judge.name} is the Banana Judge`;
    el.promptText.textContent = prompt;
    el.promptCard.classList.add('deal');
    setTimeout(() => el.promptCard.classList.remove('deal'), 600);
    el.status.textContent = 'Everyone: play your best match from your phone!';
    renderScores();
    renderSubmissionSlots();

    // Deal views to phones.
    for (const id of live) {
      if (id === judgeId) {
        ctx.sendTo(id, { v: 'judge-wait', prompt, got: 0, total: live.length - 1 });
      } else {
        sendHand(id);
      }
    }
  }

  function sendHand(id) {
    ctx.sendTo(id, {
      v: 'hand',
      prompt,
      judgeName: (playerById(judgeId) || {}).name || '?',
      cards: hands.get(id) || [],
    });
  }

  function pauseGame() {
    phase = 'paused';
    el.status.textContent = '';
    showBanner('😴 Need at least 3 connected players.<br>Waiting for friends to (re)join…', 'pause');
    ctx.sendAll({ v: 'wait', text: 'Waiting for more players…' });
    renderScores();
  }

  function maybeStartJudging() {
    const expected = connectedSeats().filter((id) => id !== judgeId);
    const done = expected.every((id) => submissions.some((s) => s.playerId === id));
    if (!done || submissions.length === 0) return;

    phase = 'judge';
    submissions = shuffle(submissions).map((s, i) => ({ ...s, key: 'k' + i }));
    revealSubmissions();
    const judge = playerById(judgeId);
    el.status.textContent = `👀 ${judge.name} is choosing the Top Banana…`;

    ctx.sendTo(judgeId, {
      v: 'judge-pick',
      prompt,
      options: submissions.map((s) => ({ key: s.key, text: s.card })),
    });
    for (const s of submissions) {
      ctx.sendTo(s.playerId, { v: 'submitted-wait', text: 'Cards are in! The judge is deciding…' });
    }
  }

  function crownWinner(key) {
    const winning = submissions.find((s) => s.key === key);
    if (!winning) return;
    phase = 'result';

    const winner = playerById(winning.playerId);
    scores.set(winning.playerId, (scores.get(winning.playerId) || 0) + 1);

    // Highlight the winning card, dim the rest.
    for (const cardEl of el.subs.children) {
      cardEl.classList.add(cardEl.dataset.key === key ? 'winner' : 'loser');
    }
    el.status.textContent = '';
    showBanner(`🏆 <b>${escapeHtml(winner ? winner.name : '?')}</b> wins the round!<br>
                <span class="tb-banner-card">“${escapeHtml(winning.card)}”</span>`, 'win');
    renderScores();

    for (const s of submissions) discard.push(s.card);
    for (const id of connectedSeats()) {
      ctx.sendTo(id, {
        v: 'round-result',
        winnerName: winner ? winner.name : '?',
        card: winning.card,
        youWon: id === winning.playerId,
      });
    }

    const total = scores.get(winning.playerId) || 0;
    resultTimer = setTimeout(() => {
      if (total >= WIN_SCORE) endGame(winning.playerId);
      else startRound();
    }, RESULT_MS);
  }

  function endGame(winnerId) {
    phase = 'gameover';
    const w = playerById(winnerId);
    el.roundLabel.textContent = '';
    el.promptCard.classList.add('hidden');
    el.subs.innerHTML = '';
    el.status.textContent = '';
    showBanner(`
      <div class="tb-gameover-emoji">🍌👑</div>
      <div class="tb-gameover-title">${escapeHtml(w ? w.name : '?')} is the Top Banana!</div>
      <div class="tb-gameover-btns">
        <button class="tb-btn" data-act="again">Play again</button>
        <button class="tb-btn tb-btn-soft" data-act="menu">Back to menu</button>
      </div>`, 'gameover');
    renderScores();
    ctx.sendAll({ v: 'gameover', winnerName: w ? w.name : '?' });

    el.banner.querySelector('[data-act="again"]').addEventListener('click', resetGame);
    el.banner.querySelector('[data-act="menu"]').addEventListener('click', () => ctx.exit());
  }

  function resetGame() {
    deck = shuffle(ANSWERS);
    discard = [];
    prompts = shuffle(PROMPTS);
    hands.clear();
    for (const id of seats) scores.set(id, 0);
    judgeIdx = -1;
    el.promptCard.classList.remove('hidden');
    startRound();
  }

  /* ---------- per-player view resend (rejoin) ---------- */
  function resendView(id) {
    if (phase === 'paused') { ctx.sendTo(id, { v: 'wait', text: 'Waiting for more players…' }); return; }
    if (phase === 'gameover') { ctx.sendTo(id, { v: 'gameover', winnerName: '' }); return; }
    if (phase === 'submit') {
      if (id === judgeId) {
        const expected = connectedSeats().filter((x) => x !== judgeId);
        ctx.sendTo(id, { v: 'judge-wait', prompt, got: submissions.length, total: expected.length });
      } else if (submissions.some((s) => s.playerId === id)) {
        ctx.sendTo(id, { v: 'submitted-wait', text: 'Your card is in! Waiting for the others…' });
      } else if (seats.includes(id)) {
        refillHand(id);
        sendHand(id);
      }
      return;
    }
    if (phase === 'judge') {
      if (id === judgeId) {
        ctx.sendTo(id, { v: 'judge-pick', prompt, options: submissions.map((s) => ({ key: s.key, text: s.card })) });
      } else {
        ctx.sendTo(id, { v: 'submitted-wait', text: 'Cards are in! The judge is deciding…' });
      }
    }
  }

  /* ---------- module interface ---------- */
  return {
    start() {
      renderShell();
      seats = ctx.players().map((p) => p.id);
      for (const id of seats) scores.set(id, 0);
      startRound();
    },

    onMessage(playerId, data) {
      if (!data || typeof data !== 'object') return;

      if (data.a === 'pick' && phase === 'submit' && playerId !== judgeId) {
        const hand = hands.get(playerId) || [];
        const i = hand.indexOf(data.card);
        if (i === -1 || submissions.some((s) => s.playerId === playerId)) return;
        hand.splice(i, 1);
        submissions.push({ playerId, card: data.card, key: '' });
        ctx.sendTo(playerId, { v: 'submitted-wait', text: 'Your card is in! Waiting for the others…' });
        renderSubmissionSlots();
        const expected = connectedSeats().filter((id) => id !== judgeId);
        el.status.textContent = `${submissions.length} of ${expected.length} cards are in…`;
        ctx.sendTo(judgeId, { v: 'judge-wait', prompt, got: submissions.length, total: expected.length });
        maybeStartJudging();
        return;
      }

      if (data.a === 'crown' && phase === 'judge' && playerId === judgeId) {
        crownWinner(data.key);
      }
    },

    onPlayerJoin(player) {
      // Joiners are seated and dealt in at the start of the next round.
      ctx.sendTo(player.id, { v: 'wait', text: 'You\u2019re in! You\u2019ll be dealt cards next round.' });
      if (phase === 'paused') startRound();
      renderScores();
    },

    onPlayerLeave(playerId) {
      renderScores();
      if (phase === 'submit') {
        if (playerId === judgeId) {
          // Judge left mid-round: toss the round and move on.
          for (const s of submissions) discard.push(s.card);
          showBanner('🙈 The judge disappeared! Skipping this round…', 'pause');
          ctx.sendAll({ v: 'wait', text: 'The judge left — new round starting…' });
          clearTimeout(resultTimer);
          resultTimer = setTimeout(startRound, 2500);
        } else {
          renderSubmissionSlots();
          maybeStartJudging();
        }
      } else if (phase === 'judge' && playerId === judgeId) {
        for (const s of submissions) discard.push(s.card);
        showBanner('🙈 The judge disappeared! Skipping this round…', 'pause');
        ctx.sendAll({ v: 'wait', text: 'The judge left — new round starting…' });
        clearTimeout(resultTimer);
        resultTimer = setTimeout(startRound, 2500);
      }
    },

    onPlayerRejoin(player) {
      renderScores();
      if (phase === 'submit' || phase === 'judge') renderSubmissionSlots();
      resendView(player.id);
      if (phase === 'paused') startRound();
    },

    destroy() {
      clearTimeout(resultTimer);
      ctx.root.innerHTML = '';
    },
  };
}

/* ============================================================
   CONTROLLER (phone)
   ============================================================ */
function createController(ctx) {
  let picked = null;

  function waitView(emoji, text) {
    ctx.root.innerHTML = `
      <div class="ctrl-wait">
        <div class="ctrl-wait-emoji">${emoji}</div>
        <p>${text}</p>
      </div>`;
  }

  function handView(data) {
    picked = null;
    ctx.root.innerHTML = `
      <div class="tbc">
        <div class="tbc-prompt">
          <span class="tbc-prompt-label">${escapeHtml(data.judgeName)} is judging</span>
          <span class="tbc-prompt-text">${escapeHtml(data.prompt)}</span>
        </div>
        <p class="tbc-hint">Tap the card that fits best (or is the funniest):</p>
        <div class="tbc-hand"></div>
        <button class="ctrl-btn ctrl-btn-big tbc-play" disabled>Play this card</button>
      </div>`;

    const handEl = ctx.root.querySelector('.tbc-hand');
    const playBtn = ctx.root.querySelector('.tbc-play');

    for (const card of data.cards) {
      const btn = document.createElement('button');
      btn.className = 'tbc-card';
      btn.innerHTML = `<span>${escapeHtml(card)}</span>`;
      btn.addEventListener('click', () => {
        picked = card;
        for (const c of handEl.children) c.classList.remove('sel');
        btn.classList.add('sel');
        playBtn.disabled = false;
      });
      handEl.appendChild(btn);
    }

    playBtn.addEventListener('click', () => {
      if (!picked) return;
      playBtn.disabled = true;
      ctx.send({ a: 'pick', card: picked });
    });
  }

  function judgeWaitView(data) {
    ctx.root.innerHTML = `
      <div class="tbc">
        <div class="tbc-prompt judge">
          <span class="tbc-prompt-label">You are the Banana Judge 🍌⚖️</span>
          <span class="tbc-prompt-text">${escapeHtml(data.prompt)}</span>
        </div>
        <div class="ctrl-wait">
          <div class="ctrl-wait-emoji">⏳</div>
          <p>Waiting for cards…<br><b>${data.got} of ${data.total}</b> are in.</p>
        </div>
      </div>`;
  }

  function judgePickView(data) {
    ctx.root.innerHTML = `
      <div class="tbc">
        <div class="tbc-prompt judge">
          <span class="tbc-prompt-label">Crown the Top Banana 👑</span>
          <span class="tbc-prompt-text">${escapeHtml(data.prompt)}</span>
        </div>
        <p class="tbc-hint">Which card wins?</p>
        <div class="tbc-hand"></div>
      </div>`;
    const handEl = ctx.root.querySelector('.tbc-hand');
    for (const opt of data.options) {
      const btn = document.createElement('button');
      btn.className = 'tbc-card gold';
      btn.innerHTML = `<span>${escapeHtml(opt.text)}</span>`;
      btn.addEventListener('click', () => {
        for (const c of handEl.children) c.disabled = true;
        btn.classList.add('sel');
        ctx.send({ a: 'crown', key: opt.key });
      });
      handEl.appendChild(btn);
    }
  }

  function resultView(data) {
    waitView(
      data.youWon ? '🏆' : '👏',
      data.youWon
        ? `<b>You won the round!</b><br>“${escapeHtml(data.card)}”`
        : `<b>${escapeHtml(data.winnerName)}</b> won with<br>“${escapeHtml(data.card)}”`
    );
  }

  return {
    start() { waitView('🍌', 'Get ready…'); },

    onMessage(data) {
      if (!data || typeof data !== 'object') return;
      switch (data.v) {
        case 'wait':           waitView('🍌', escapeHtml(data.text || 'Hang tight…')); break;
        case 'hand':           handView(data); break;
        case 'submitted-wait': waitView('✅', escapeHtml(data.text || 'Card played!')); break;
        case 'judge-wait':     judgeWaitView(data); break;
        case 'judge-pick':     judgePickView(data); break;
        case 'round-result':   resultView(data); break;
        case 'gameover':
          waitView('🍌👑', data.winnerName
            ? `<b>${escapeHtml(data.winnerName)}</b> is the Top Banana!<br>Watch the big screen.`
            : 'Game over! Watch the big screen.');
          break;
      }
    },

    destroy() { ctx.root.innerHTML = ''; },
  };
}

export default {
  id: 'topbanana',
  title: 'Top Banana',
  tagline: 'Play your funniest card — the judge decides',
  emoji: '🍌',
  minPlayers: 3,
  maxPlayers: 10,
  comingSoon: false,
  createHost,
  createController,
};
