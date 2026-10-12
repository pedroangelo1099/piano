'use strict';

/* =========================================================
   PIANO TILES — Be My Baby
   - A música é fixa: coloque o arquivo "musica.mp3" na pasta.
   - As teclas vêm do arquivo "notas.js", gerado a partir do próprio mp3
     (cada tecla cai no instante exato de um som da música).
   - Trechos sustentados viram teclas compridas: segure até o fim.
   ========================================================= */

// ---------- Configurações ----------
const SONG_URL = 'musica.mp3';

const LANES = 4;
const FALL_TIME = 1.7;     // segundos que a tecla leva do topo até a linha
const LEAD_IN = 2.2;       // segundos de espera antes da música começar
const WINDOW = 0.22;       // janela de acerto (segundos, para mais e para menos)
const PERFECT = 0.07;      // acerto perfeito

// Teclas compridas (segurar)
const HOLD_TOL = 0.15;     // pode soltar até 0,15 s antes do fim

// Ajuste fino (segundos). Deixe 0. Se as teclas chegarem sempre um pouco
// ANTES do som em todo o jogo, aumente (ex.: 0.03); se chegarem DEPOIS, diminua.
const AUDIO_OFFSET = 0;

const KEYS = { d: 0, f: 1, j: 2, k: 3 };
const KEY_LABELS = ['D', 'F', 'J', 'K'];

// ---------- Elementos ----------
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const c = canvas.getContext('2d');
const game = $('game');

const el = {
  score: $('score'), combo: $('combo'), judgement: $('judgement'),
  menu: $('menu'), pause: $('pause'), end: $('end'),
  status: $('status'), playBtn: $('playBtn'),
  pauseBtn: $('pauseBtn'), resumeBtn: $('resumeBtn'), quitBtn: $('quitBtn'),
  againBtn: $('againBtn'), menuBtn: $('menuBtn'),
  rScore: $('rScore'), rAcc: $('rAcc'), rCombo: $('rCombo'),
};

// ---------- Estado ----------
let audioCtx = null;
let buffer = null;
let source = null;
let songStart = 0;

let state = 'menu'; // menu | playing | paused | ended
let notes = [];
let missIdx = 0;    // primeira nota que ainda pode ser acertada
let drawIdx = 0;    // primeira nota ainda visível na tela
let effects = [];
const holding = new Map(); // dedo/tecla -> nota que está sendo segurada

// estados de uma nota: 0 = esperando, 1 = acertou, 2 = errou, 3 = segurando
let score = 0, combo = 0, maxCombo = 0, hits = 0, wrongTaps = 0;

// medidas do canvas
let W = 0, H = 0, laneW = 0, hitY = 0, tileH = 0, speed = 0;

// ---------- Áudio ----------
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

async function loadSong() {
  try {
    const res = await fetch(SONG_URL);
    if (!res.ok) throw new Error('arquivo não encontrado');
    const data = await res.arrayBuffer();
    buffer = await getCtx().decodeAudioData(data);
    el.status.textContent = 'Música pronta!';
    el.playBtn.disabled = false;
  } catch (err) {
    el.status.textContent =
      'Não achei o musica.mp3. Coloque o arquivo na mesma pasta e abra o jogo com o Live Server.';
  }
}
loadSong();

// Tempo da música que o jogador está ouvindo agora (em segundos)
function gameNow() {
  const latency = audioCtx.outputLatency || audioCtx.baseLatency || 0;
  return audioCtx.currentTime - songStart - latency - AUDIO_OFFSET;
}

// ---------- Controle do jogo ----------
function stopSource() {
  if (!source) return;
  source.onended = null;
  try { source.stop(); } catch (e) { /* já parou */ }
  source = null;
}

function showOnly(overlay) {
  [el.menu, el.pause, el.end].forEach((o) => o.classList.add('hidden'));
  if (overlay) overlay.classList.remove('hidden');
}

function startGame() {
  if (!buffer) return;
  stopHearts();
  const ctx = getCtx();
  ctx.resume();

  notes = CHART.map(([t, lane, dur]) => ({ t, lane, dur, state: 0, hitAt: 0, perfect: false }));

  stopSource();
  holding.clear();
  score = combo = maxCombo = hits = wrongTaps = 0;
  missIdx = drawIdx = 0;
  effects = [];
  updateHud();

  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  songStart = ctx.currentTime + LEAD_IN;
  source.start(songStart);

  state = 'playing';
  showOnly(null);
}

function pauseGame() {
  if (state !== 'playing') return;
  // ao pausar, teclas que estavam sendo seguradas são perdoadas
  for (const n of holding.values()) n.state = 1;
  holding.clear();
  audioCtx.suspend();
  state = 'paused';
  showOnly(el.pause);
}

function resumeGame() {
  if (state !== 'paused') return;
  audioCtx.resume();
  state = 'playing';
  showOnly(null);
}

function backToMenu() {
  stopSource();
  stopHearts();
  holding.clear();
  if (audioCtx) audioCtx.resume();
  state = 'menu';
  notes = [];
  effects = [];
  showOnly(el.menu);
}

function endGame() {
  state = 'ended';
  stopSource();
  holding.clear();
  const acc = Math.round((hits / (notes.length + wrongTaps)) * 100);
  el.rScore.textContent = score;
  el.rAcc.textContent = `${acc}%`;
  el.rCombo.textContent = maxCombo;
  showOnly(el.end);
  showLove();
}

// ---------- Final romântico ----------
const love = {
  title: $('loveTitle'), buttons: $('loveButtons'), answer: $('loveAnswer'),
  yes: $('yesBtn'), no: $('noBtn'), hearts: $('hearts'), photo: $('couplePhoto'),
};
let heartTimer = null;

function spawnHeart() {
  const h = document.createElement('span');
  h.className = 'heart';
  h.textContent = ['💗', '💖', '💕', '💘'][Math.floor(Math.random() * 4)];
  h.style.left = Math.random() * 100 + '%';
  h.style.fontSize = 16 + Math.random() * 22 + 'px';
  h.style.animationDuration = 4 + Math.random() * 4 + 's';
  love.hearts.appendChild(h);
  setTimeout(() => h.remove(), 8500);
}

function stopHearts() {
  clearInterval(heartTimer);
  heartTimer = null;
  love.hearts.innerHTML = '';
}

function showLove() {
  love.title.textContent = 'Be my baby?';        // <- troque o texto aqui
  love.buttons.classList.remove('hidden');
  love.answer.textContent = '';
  love.no.style.transform = '';
  stopHearts();
  heartTimer = setInterval(spawnHeart, 350);
}

love.yes.addEventListener('click', () => {
  love.title.textContent = 'Eu sabia 💖';          // <- e aqui
  love.answer.textContent = 'Você é a minha música favorita.'; // <- e aqui
  love.buttons.classList.add('hidden');
  for (let i = 0; i < 40; i++) setTimeout(spawnHeart, i * 40);
});

// o botão "Não" foge do dedo/mouse
function dodge(e) {
  e.preventDefault();
  const x = (Math.random() - 0.5) * 220;
  const y = (Math.random() - 0.5) * 120;
  love.no.style.transform = `translate(${x}px, ${y}px)`;
}
love.no.addEventListener('pointerenter', dodge);
love.no.addEventListener('pointerdown', dodge);
love.no.addEventListener('click', (e) => e.preventDefault());

// se a foto não carregar, esconde a moldura
love.photo.addEventListener('error', () => love.photo.parentElement.classList.add('hidden'));

// ---------- Toques ----------
function showJudgement(text, color) {
  el.judgement.textContent = text;
  el.judgement.style.color = color;
  el.judgement.classList.remove('show');
  void el.judgement.offsetWidth; // reinicia a animação
  el.judgement.classList.add('show');
}

function updateHud() {
  el.score.textContent = score;
  el.combo.textContent = combo >= 3 ? `${combo}x combo` : '';
}

// `key` identifica o dedo (ou a tecla do teclado) que está tocando
function tap(lane, x, y, key) {
  if (state !== 'playing') return;
  const now = gameNow();

  // procura a tecla mais próxima do momento atual naquela coluna
  let best = null, bestD = Infinity;
  for (let i = missIdx; i < notes.length; i++) {
    const n = notes[i];
    if (n.t - now > WINDOW) break;
    if (n.state !== 0 || n.lane !== lane) continue;
    const d = Math.abs(n.t - now);
    if (d < bestD) { best = n; bestD = d; }
  }

  if (best && bestD <= WINDOW) {
    best.hitAt = performance.now();
    best.perfect = bestD <= PERFECT;
    score += (best.perfect ? 100 : 60) + Math.min(combo, 50) * 2;
    combo++;
    hits++;
    maxCombo = Math.max(maxCombo, combo);
    effects.push({ kind: 'flash', lane, born: performance.now() });
    showJudgement(best.perfect ? 'Perfeito!' : 'Bom', best.perfect ? '#ffc2ea' : '#ffffff');

    if (best.dur > 0) {
      best.state = 3;            // segurando
      holding.set(key, best);
    } else {
      best.state = 1;
    }
  } else {
    // tocou fora de uma tecla: marca em vermelho no local do toque
    combo = 0;
    wrongTaps++;
    effects.push({ kind: 'wrong', lane, x, y, born: performance.now() });
  }
  updateHud();
}

function finishHold(n) {
  n.state = 1;
  n.hitAt = performance.now();
  score += Math.round(n.dur * 100);
  showJudgement('Segurou!', '#ffc2ea');
  updateHud();
}

function release(key) {
  const n = holding.get(key);
  if (!n) return;
  holding.delete(key);
  if (state !== 'playing') return;

  if (gameNow() >= n.t + n.dur - HOLD_TOL) {
    finishHold(n);
  } else {
    // soltou cedo demais
    n.state = 2;
    combo = 0;
    effects.push({ kind: 'wrong', lane: n.lane, x: n.lane * laneW + laneW / 2, y: hitY, born: performance.now() });
    updateHud();
  }
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
  const r = canvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const lane = Math.min(LANES - 1, Math.max(0, Math.floor(x / laneW)));
  tap(lane, x, y, 'p' + e.pointerId);
});
canvas.addEventListener('pointerup', (e) => release('p' + e.pointerId));
canvas.addEventListener('pointercancel', (e) => release('p' + e.pointerId));

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k in KEYS) {
    const lane = KEYS[k];
    tap(lane, lane * laneW + laneW / 2, hitY, 'k' + lane);
  } else if (e.code === 'Space') {
    e.preventDefault();
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in KEYS) release('k' + KEYS[k]);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

// ---------- Botões ----------
el.playBtn.addEventListener('click', startGame);
el.againBtn.addEventListener('click', startGame);
el.pauseBtn.addEventListener('click', pauseGame);
el.resumeBtn.addEventListener('click', resumeGame);
el.quitBtn.addEventListener('click', backToMenu);
el.menuBtn.addEventListener('click', backToMenu);

// ---------- Desenho ----------
function resize() {
  const box = game.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  W = box.width;
  H = box.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  laneW = W / LANES;
  hitY = H * 0.8;
  tileH = Math.min(laneW * 1.5, H * 0.22);
  speed = hitY / FALL_TIME; // pixels por segundo
}
window.addEventListener('resize', resize);

function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawBoard() {
  // divisórias das colunas
  c.strokeStyle = 'rgba(255, 150, 220, 0.25)';
  c.lineWidth = 1;
  for (let i = 1; i < LANES; i++) {
    c.beginPath();
    c.moveTo(i * laneW, 0);
    c.lineTo(i * laneW, H);
    c.stroke();
  }

  // linha de acerto
  const g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#c026d3');
  g.addColorStop(1, '#ff4fb8');
  c.save();
  c.shadowColor = '#ff4fb8';
  c.shadowBlur = 16;
  c.fillStyle = g;
  c.fillRect(0, hitY - 2, W, 4);
  c.restore();

  // letras do teclado
  c.fillStyle = 'rgba(255, 255, 255, 0.55)';
  c.font = '600 18px Fredoka, system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let i = 0; i < LANES; i++) {
    c.fillText(KEY_LABELS[i], i * laneW + laneW / 2, hitY + (H - hitY) / 2);
  }
}

function drawTiles(now) {
  const t0 = performance.now();

  for (let i = drawIdx; i < notes.length; i++) {
    const n = notes[i];
    const yHead = hitY - (n.t - now) * speed;          // posição do começo da tecla
    const bottom = yHead + tileH / 2;
    const top = yHead - n.dur * speed - tileH / 2;     // teclas longas sobem mais
    if (top > H) { if (i === drawIdx) drawIdx++; continue; }
    if (bottom < 0) break; // as próximas estão ainda mais acima

    const x = n.lane * laneW + 3;
    const w = laneW - 6;
    const h = bottom - top;

    if (n.state === 0) {
      const grad = c.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, '#2b0a52');
      grad.addColorStop(1, '#0f0221');
      c.save();
      c.shadowColor = 'rgba(255, 79, 184, 0.7)';
      c.shadowBlur = 14;
      c.fillStyle = grad;
      roundRect(x, top, w, h, 12);
      c.fill();
      c.restore();
      c.strokeStyle = '#ff4fb8';
      c.lineWidth = 2;
      roundRect(x, top, w, h, 12);
      c.stroke();
    } else if (n.state === 3) {
      // segurando: só a parte que ainda não passou da linha
      const cut = Math.min(bottom, hitY + 2);
      if (cut - top > 2) {
        const grad = c.createLinearGradient(0, top, 0, cut);
        grad.addColorStop(0, '#ff4fb8');
        grad.addColorStop(1, '#ffc2ea');
        c.save();
        c.shadowColor = '#ff4fb8';
        c.shadowBlur = 24;
        c.fillStyle = grad;
        roundRect(x, top, w, cut - top, 12);
        c.fill();
        c.restore();
      }
      const gl = c.createLinearGradient(0, hitY - tileH, 0, hitY + 20);
      gl.addColorStop(0, 'rgba(255, 79, 184, 0)');
      gl.addColorStop(1, 'rgba(255, 79, 184, 0.5)');
      c.fillStyle = gl;
      c.fillRect(n.lane * laneW, hitY - tileH, laneW, tileH + 20);
    } else if (n.state === 1) {
      const a = Math.max(0.15, 0.7 - (t0 - n.hitAt) / 900);
      c.fillStyle = `rgba(255, 194, 234, ${a})`;
      roundRect(x, top, w, h, 12);
      c.fill();
    } else {
      c.fillStyle = 'rgba(255, 45, 63, 0.85)';
      roundRect(x, top, w, h, 12);
      c.fill();
    }

    // linha no meio das teclas longas, para mostrar que é pra segurar
    if (n.dur > 0 && n.state !== 1) {
      const lineBottom = n.state === 3 ? Math.min(bottom - tileH * 0.25, hitY) : bottom - tileH * 0.25;
      const lineTop = top + tileH * 0.25;
      if (lineBottom > lineTop) {
        c.strokeStyle = n.state === 3 ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 79, 184, 0.75)';
        c.lineWidth = 4;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(n.lane * laneW + laneW / 2, lineTop);
        c.lineTo(n.lane * laneW + laneW / 2, lineBottom);
        c.stroke();
      }
    }
  }
}

function drawEffects() {
  const t0 = performance.now();
  effects = effects.filter((e) => t0 - e.born < 600);

  for (const e of effects) {
    const age = (t0 - e.born) / 600;
    const alpha = 1 - age;

    if (e.kind === 'flash') {
      const g = c.createLinearGradient(0, hitY - tileH, 0, hitY + 20);
      g.addColorStop(0, 'rgba(255, 79, 184, 0)');
      g.addColorStop(1, `rgba(255, 79, 184, ${0.55 * alpha})`);
      c.fillStyle = g;
      c.fillRect(e.lane * laneW, hitY - tileH, laneW, tileH + 20);
    } else {
      // vermelho exatamente onde você tocou
      c.fillStyle = `rgba(255, 45, 63, ${0.8 * alpha})`;
      roundRect(e.lane * laneW + 3, e.y - tileH / 2, laneW - 6, tileH, 12);
      c.fill();

      c.strokeStyle = `rgba(255, 120, 130, ${alpha})`;
      c.lineWidth = 3;
      c.beginPath();
      c.arc(e.x, e.y, 14 + age * 40, 0, Math.PI * 2);
      c.stroke();
    }
  }
}

// ---------- Loop principal ----------
function update() {
  const now = gameNow();

  // teclas que passaram da linha sem ser tocadas = erro
  while (missIdx < notes.length && notes[missIdx].t < now - WINDOW) {
    const n = notes[missIdx];
    if (n.state === 0) {
      n.state = 2;
      combo = 0;
      updateHud();
    }
    missIdx++;
  }

  // teclas longas que o jogador segurou até o fim
  for (const [key, n] of holding) {
    if (now >= n.t + n.dur - HOLD_TOL) {
      holding.delete(key);
      finishHold(n);
    }
  }

  if (buffer && now > buffer.duration + 0.8) endGame();
  return now;
}

function loop() {
  requestAnimationFrame(loop);
  c.clearRect(0, 0, W, H);
  drawBoard();

  if (state === 'playing' || state === 'paused') {
    const now = state === 'playing' ? update() : gameNow();
    drawTiles(now);
    drawEffects();
  }
}

resize();
requestAnimationFrame(loop);