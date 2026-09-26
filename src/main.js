import { Cube3D } from './cube3d.js';
import { CubeState, SOLVED, FACES, COLOR_NAMES, tokens, invert, invertMove, problem, solvedFacelets, sizeOf, faceletIndex } from './state.js';
import { STAGES, stageFocus, cfopSplits } from './learn.js';
import { initTimer } from './timer.js';
import { initTheme } from './theme.js';
import { fmt } from './stats.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sixfold.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sixfold.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- worker: Kociemba solver, beginner teacher, scrambles ----------
// Started on first use or once the page is idle, so its ~1 s of table building never competes with the first paint.
const pending = new Map();
let reqId = 0, worker = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./solver.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
  };
  return worker;
}
const ask = (type, data = {}) => new Promise((resolve, reject) => {
  pending.set(++reqId, { resolve, reject });
  getWorker().postMessage({ id: reqId, type, ...data });
});

// ---------- sound ----------
let soundOn = store.get('sound', true), audio, clickBuf, lastChime = 0;
function click() {
  if (!soundOn) return;
  audio ??= new AudioContext();
  if (!clickBuf) {
    clickBuf = audio.createBuffer(1, 2400, 44100);
    const d = clickBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 8;
  }
  const src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = clickBuf;
  f.type = 'bandpass';
  f.frequency.value = 1500 + Math.random() * 900;
  f.Q.value = 1.1;
  g.gain.value = 0.55;
  src.connect(f).connect(g).connect(audio.destination);
  src.start();
}
function chime() {
  if (!soundOn || !audio || performance.now() - lastChime < 1500) return;
  lastChime = performance.now();
  [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.09;
    o.type = 'sine';
    o.frequency.value = hz;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 1.3);
  });
}
const soundBtn = $('sound-btn');
soundBtn.setAttribute('aria-pressed', soundOn);
soundBtn.addEventListener('click', () => { soundOn = !soundOn; store.set('sound', soundOn); soundBtn.setAttribute('aria-pressed', soundOn); });

// ---------- cube core ----------
const state = new CubeState();
const cube = new Cube3D($('stage'), { onMove: (t, o) => move(t, o) });
cube.setState(state);
let hintTok = null, shownHint = null, lastPhi = 1.1, past = [], redoStack = [], solution = null, wasSolved = true, celebratePending = false, mode = 'play', replayTimers = [];

function move(tok, { record = true, fromSolution = false, animated = false } = {}) {
  if (cube.grabbing && !animated) return; // a finger is holding a layer — don't fight it
  state.move(tok);
  if (!animated) cube.turn(tok);
  click();
  if (record) { past.push(tok); redoStack.length = 0; }
  if (!fromSolution && solution) closeSolution();
  if (!fromSolution) hintTok = null;
  timer.onMove(tok);
  train?.onMove(tok);
  const solved = state.isSolved();
  if (solved && !wasSolved) celebratePending = true;
  wasSolved = solved;
  render();
}

// Replace the whole cube (reset, scramble, paint, scan) — not undoable.
function setCube(facelets = solvedFacelets(state.size), animateSeq = '') {
  cancelReplay();
  const resized = sizeOf(facelets) !== state.size;
  state.set(facelets);
  cube.setState(state);
  shownHint = hintTok = null;
  if (resized) onResize();
  for (const t of tokens(animateSeq)) { state.move(t); cube.turn(t); }
  past = [];
  redoStack = [];
  closeSolution();
  wasSolved = state.isSolved();
  render();
}

cube.onSettle = () => {
  if (celebratePending) {
    celebratePending = false;
    cube.celebrate();
    chime();
    if (mode !== 'time' && mode !== 'train') toast('Solved ✦');
  }
  const s = solution;
  if (!s?.playing) return;
  if (s.i >= s.moves.length) { s.playing = false; return render(); }
  // lessons pause between stages so there's time to read what's next
  const ended = s.learn && s.stages.find(st => st.to === s.i && st.to > st.from);
  if (ended) {
    s.playing = false;
    const nxt = s.stages.find(st => st.from >= s.i && st.to > st.from);
    toast(`${ended.title} ✓ — next: ${nxt?.title ?? 'done'}`);
    return render();
  }
  setTimeout(() => solution?.playing && !cube.busy && step(1), s.learn ? 160 : 90);
};

function undo() {
  if (!past.length) return;
  const t = past.pop();
  redoStack.push(t);
  if (solution) solution.i = Math.max(0, solution.i - 1);
  move(invertMove(t), { record: false, fromSolution: !!solution });
}
function redo() {
  if (!redoStack.length) return;
  const t = redoStack.pop();
  past.push(t);
  move(t, { record: false });
}

// ---------- solutions & lessons (shared playback) ----------
function openSolution(steps, stages, learn) {
  const moves = [];
  const st = steps.map(s => { const from = moves.length; moves.push(...tokens(s.seq)); return { ...s, from, to: moves.length }; });
  solution = { moves, i: 0, playing: false, steps: st, stages, learn };
  render();
}
function closeSolution() {
  solution = null;
  cube.setFocus(null);
  if (lastPhi !== 1.1) cube.lookFrom((lastPhi = 1.1));
}
const stageAt = s => s.stages.find(st => st.from <= s.i && s.i < st.to) ?? s.stages.findLast(st => st.to > st.from) ?? s.stages[0];

function step(dir) {
  const s = solution;
  if (!s) return;
  if (dir > 0 && s.i < s.moves.length) move(s.moves[s.i++], { fromSolution: true });
  else if (dir < 0 && s.i > 0) move(invertMove(s.moves[--s.i]), { fromSolution: true });
  render();
}
function jumpTo(i) {
  if (!solution) return;
  solution.playing = false;
  while (solution.i < i) step(1);
  while (solution.i > i) step(-1);
}
function togglePlay() {
  const s = solution;
  if (!s || s.i >= s.moves.length) return;
  s.playing = !s.playing;
  if (s.playing && !cube.busy) step(1);
  render();
}
$('pb-next').addEventListener('click', () => { if (solution) solution.playing = false; step(1); });
$('pb-back').addEventListener('click', () => { if (solution) solution.playing = false; step(-1); });
$('pb-start').addEventListener('click', () => jumpTo(solution && stageAt(solution).from < solution.i ? stageAt(solution).from : 0));
$('pb-play').addEventListener('click', togglePlay);
$('pb-close').addEventListener('click', () => { closeSolution(); render(); });

// ---------- rendering ----------
const hud = $('hud');
function render() {
  $('move-count').textContent = past.length;
  const solvedEl = $('solved-state'), solved = state.isSolved();
  solvedEl.textContent = solved ? 'Solved' : 'Scrambled';
  solvedEl.classList.toggle('solved', solved);

  const s = solution, pb = $('playback');
  const want = s ? s.moves[s.i] ?? null : hintTok;
  if (want !== shownHint) cube.setHint((shownHint = want));
  pb.hidden = !s;
  if (s) {
    const stg = stageAt(s);
    const shown = s.steps.filter(x => x.from >= stg.from && x.to <= stg.to);
    hud.innerHTML = shown.map(x => `<span class="chip${x.to <= s.i ? ' done' : x.from <= s.i && s.i < x.to ? ' now' : ''}">${x.label}</span>`).join('');
    pb.classList.toggle('playing', s.playing);
    $('pb-play').setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    $('pb-count').textContent = `${s.i} / ${s.moves.length}`;
    $('pb-stage').textContent = stg.title;
    if (s.learn) {
      cube.setFocus(s.i >= s.moves.length ? null : stageFocus(stg.key));
      // look at the bottom while building the white layer, then come back up for the last layer
      const phi = { cross: 2.05, corners: 2.05, middle: 1.45 }[stg.key] ?? 1.1;
      if (phi !== lastPhi) cube.lookFrom((lastPhi = phi));
    }
  } else if (past.length) {
    const last = past.slice(-24);
    hud.innerHTML = last.map((m, i) => `<span class="chip" style="opacity:${(0.25 + 0.75 * ((i + 1) / last.length)).toFixed(2)}">${m}</span>`).join('');
  } else hud.innerHTML = '';
  renderNet();
  renderStages();
}

// ---------- puzzle size ----------
const THREE_ONLY = ['learn', 'train', 'scan', 'patterns'];
let chosen = store.get('puzzle', 3); // the puzzle you picked; 3×3-only modes borrow a 3×3 without changing it
const parked = {}; // cube left behind per size while another size is on screen
function swapTo(n) {
  if (n === state.size) return;
  parked[state.size] = state.facelets();
  setCube(parked[n] ?? solvedFacelets(n));
}
function setPuzzle(n) {
  chosen = n;
  store.set('puzzle', n);
  if (THREE_ONLY.includes(mode) && n !== 3) return setMode('play');
  if (n !== state.size) setCube(solvedFacelets(n));
}
function onResize() {
  const n = state.size;
  document.body.dataset.puzzle = n;
  document.querySelectorAll('#puzzle button').forEach(b => b.setAttribute('aria-checked', +b.dataset.n === n));
  buildPad();
  buildNet();
  $('solve-note').textContent = n === 4 ? 'The solver covers 2×2 and 3×3 — for the 4×4, scramble, time and play.' : '';
  timer.onPuzzle();
}
document.querySelectorAll('#puzzle button').forEach(b => b.addEventListener('click', () => {
  setPuzzle(+b.dataset.n);
  toast(`${b.dataset.n}×${b.dataset.n} ${{ 2: '— the pocket cube', 3: '— the classic', 4: '— the revenge' }[b.dataset.n]}`);
}));

// ---------- modes ----------
const tabs = [...document.querySelectorAll('.modes button')];
function setMode(m) {
  const go = () => {
    if (mode === 'scan' && m !== 'scan') scan?.stop();
    if (mode === 'train' && m !== 'train') train?.deactivate();
    loadPanel(m);
    if (mode === 'patterns' && m !== 'patterns') stopDesign();
    if (THREE_ONLY.includes(m) && state.size !== 3) {
      toast(`${m[0].toUpperCase() + m.slice(1)} uses the 3×3 — your ${state.size}×${state.size} will be waiting when you leave`);
      swapTo(3);
    } else if (!THREE_ONLY.includes(m) && chosen !== state.size) swapTo(chosen);
    mode = m;
    document.body.dataset.mode = m;
    tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.mode === m));
    document.querySelectorAll('[data-panel]').forEach(p => (p.hidden = p.dataset.panel !== m));
    timer.activate(m === 'time');
    if (m !== 'time') document.body.classList.remove('focus');
    window.history.replaceState(null, '', location.search + '#' + m);
    document.querySelector('.panel').scrollTop = 0;
  };
  if (document.startViewTransition && !reduceMotion && !document.hidden && mode && m !== mode) {
    const t = document.startViewTransition(go);
    t.ready.catch(() => {}); // skipped transitions (tab hidden, rapid clicks) reject — the mode still switches
  } else go();
}
tabs.forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
// the logo goes home without a page reload
document.querySelector('.brand').addEventListener('click', e => { e.preventDefault(); setMode('play'); });
document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.goto)));

// ---------- play panel ----------
const pad = $('movepad');
const PAD_EXTRA = { 2: ['x', 'y', 'z', "x'", "y'", "z'"], 3: ['M', 'E', 'S', 'x', 'y', 'z'], 4: ['Uw', 'Rw', 'Fw', 'x', 'y', 'z'] };
function buildPad() {
  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  pad.innerHTML = [...faces, ...faces.map(f => f + "'"), ...PAD_EXTRA[state.size]].map(m => {
    const face = m.length <= 2 && !m.includes('w') && FACES.includes(m[0]) ? `data-face style="--c:var(--c${m[0]})"` : 'class="alt"';
    return `<button ${face} data-move="${m}" aria-label="Move ${m}">${m}</button>`;
  }).join('');
}
buildPad();
pad.addEventListener('click', e => { const m = e.target.closest('button')?.dataset.move; if (m) move(m); });

async function scramble() {
  const btns = [$('scramble-btn'), $('learn-scramble')];
  btns.forEach(b => b.classList.add('busy'));
  try {
    setCube(undefined, await ask('scramble', { size: state.size }));
  } catch (e) {
    toast(`Scramble failed: ${e.message}`);
  }
  btns.forEach(b => b.classList.remove('busy'));
}
$('scramble-btn').addEventListener('click', scramble);
$('reset-btn').addEventListener('click', () => setCube());
$('hint-btn').addEventListener('click', hint);
$('undo-btn').addEventListener('click', undo);
$('redo-btn').addEventListener('click', redo);
const speed = $('speed');
speed.value = cube.speed = store.get('speed', 1);
speed.addEventListener('input', () => store.set('speed', (cube.speed = +speed.value)));

// ---------- solve panel ----------
const solveBtn = $('solve-btn');
async function solve() {
  if (state.isSolved()) return toast('Already solved — scramble it first.');
  solveBtn.classList.add('busy');
  try {
    const sol = tokens(await solutionFor());
    openSolution(sol.map(m => ({ label: m, seq: m })), [{ key: 'solve', title: `${sol.length}-move solution`, from: 0, to: sol.length }], false);
    toast(`Found a ${sol.length}-move ${state.size === 2 ? 'optimal ' : ''}solution — follow the ring`);
  } catch (e) {
    toast(e.message);
  }
  solveBtn.classList.remove('busy');
}
solveBtn.addEventListener('click', solve);

// Solution for the current cube, whatever its size (the 2×2 gets an optimal one).
async function solutionFor() {
  if (state.size === 4) throw new Error('The solver covers 2×2 and 3×3 for now.');
  const err = problem(state.facelets());
  if (err) throw new Error(err);
  return state.size === 2 ? ask('solve2', { facelets: state.facelets() }) : ask('solve', { facelets: state.solverString() });
}

// "Stuck?" — ring the layer to turn next without giving the whole game away
async function hint() {
  if (state.isSolved()) return toast('Already solved ✦');
  try {
    const next = tokens(await solutionFor())[0];
    hintTok = next;
    render();
    toast(`Try ${next} — follow the ring`);
  } catch (e) {
    toast(e.message);
  }
}

// ---------- learn panel ----------
async function teach() {
  if (state.isSolved()) return toast('This cube is solved — tap “Scramble & teach”.');
  const err = problem(state.facelets());
  if (err) return toast(err);
  const btn = $('learn-go');
  btn.classList.add('busy');
  try {
    const stages = await ask('learn', { facelets: state.facelets() });
    let at = 0;
    const meta = stages.map(s => {
      const n = s.steps.reduce((a, st) => a + tokens(st.seq).length, 0);
      const out = { ...s, from: at, to: at + n };
      at += n;
      return out;
    });
    openSolution(stages.flatMap(s => s.steps), meta, true);
    toast('Press play — it pauses after every stage');
  } catch (e) {
    toast(`Couldn’t build a lesson: ${e.message}`);
  }
  btn.classList.remove('busy');
}
$('learn-go').addEventListener('click', teach);
$('learn-scramble').addEventListener('click', async () => { await scramble(); teach(); });

function renderStages() {
  const s = solution?.learn ? solution : null, cur = s && stageAt(s);
  $('stages').innerHTML = (s ? s.stages : STAGES).map((st, k) => {
    const n = s ? st.to - st.from : null;
    const status = !s ? '' : s.i >= st.to ? 'done' : st === cur ? 'now' : '';
    return `<li class="stage ${status}" data-k="${k}">
      <span class="num">${k + 1}</span>
      <div><strong>${st.title}</strong>
        <p>${st.text}</p>
        ${st.alg ? `<code>${st.alg}</code>` : ''}
        ${s ? `<span class="count">${n ? `${n} move${n > 1 ? 's' : ''}` : 'already done'}</span>` : ''}
      </div></li>`;
  }).join('');
}
$('stages').addEventListener('click', e => {
  const li = e.target.closest('.stage');
  if (li && solution?.learn) jumpTo(solution.stages[li.dataset.k].from);
});

// ---------- painter: live-edits the 3D cube ----------
let paintColor = 'U';
const palette = $('palette');
palette.innerHTML = [...FACES].map(f => `<button role="radio" data-c="${f}" style="--c:var(--c${f})" aria-label="${COLOR_NAMES[f]}"></button>`).join('');
const paintBtns = [...palette.children];
function pickColor(f) {
  paintColor = f;
  paintBtns.forEach(b => b.setAttribute('aria-checked', b.dataset.c === f));
}
paintBtns.forEach(b => b.addEventListener('click', () => pickColor(b.dataset.c)));
pickColor('U');

const net = $('net');
let cells = [];
const isCenter = (i, n = state.size) => n % 2 === 1 && i % (n * n) === (n * n - 1) / 2;
function buildNet() {
  const n = state.size;
  net.style.setProperty('--n', n);
  net.innerHTML = [...FACES].map((f, fi) => `<div class="face face-${f}">${Array.from({ length: n * n }, (_, k) => {
    const i = fi * n * n + k, c = isCenter(i);
    return `<button class="cell${c ? ' center' : ''}" data-i="${i}" aria-label="${f} face sticker ${k + 1}"${c ? ' tabindex="-1"' : ''}></button>`;
  }).join('')}</div>`).join('');
  cells = [...net.querySelectorAll('.cell')];
}
buildNet();
function renderNet() {
  const f = state.facelets();
  cells.forEach((c, i) => c.style.setProperty('--c', `var(--c${f[i] === '?' ? 'X' : f[i]})`));
  const msg = $('net-msg'), err = problem(f);
  msg.textContent = err || (state.isSolved() ? 'Solved state.' : 'Valid cube — hit Solve.');
  msg.className = 'msg ' + (err ? 'bad' : 'good');
}
function paint(el) {
  const i = +el?.dataset.i;
  if (!el?.classList.contains('cell') || isCenter(i)) return;
  const f = [...state.facelets()];
  if (f[i] === paintColor) return;
  f[i] = paintColor;
  setCube(f.join(''));
}
let painting = false;
net.addEventListener('pointerdown', e => { painting = true; paint(e.target); });
net.addEventListener('pointermove', e => painting && paint(document.elementFromPoint(e.clientX, e.clientY)));
addEventListener('pointerup', () => (painting = false));
net.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); paint(e.target); } });
$('net-clear').addEventListener('click', () => setCube([...solvedFacelets(state.size)].map((c, i) => (isCenter(i) ? c : '?')).join('')));
$('net-reset').addEventListener('click', () => setCube());

// ---------- patterns ----------
const PATTERNS = [
  ['Checkerboard', 'M2 E2 S2'],
  ['Superflip', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"],
  ['Cube in a cube', "F L F U' R U F2 L2 U' L' B D' B' L2 U"],
  ['Cube³', "U' L' U' F' R2 B' R F U B2 U B' L U' F U R F'"],
  ['Six spots', "U D' R L' F B' U D'"],
  ['Tetris', "L R F B U' D' L' R'"],
  ['Anaconda', "L U B' U' R L' B R' F B' D R D' F'"],
  ['Wire', 'R L F B R L F B R L F B R2 B2 L2 R2 B2 L2'],
  ['Plus minus', 'U2 R2 L2 U2 R2 L2'],
  ['Sexy ×3', "R U R' U' R U R' U' R U R' U'"],
];
// Isometric thumbnail of the U, R, F faces.
function iso(st) {
  const P = ([x, y, z]) => `${((x - z) * 17.3).toFixed(1)},${(((x + z) / 2 - y) * 20).toFixed(1)}`;
  const hex = [[-1.5, 1.5, -1.5], [1.5, 1.5, -1.5], [1.5, -1.5, -1.5], [1.5, -1.5, 1.5], [-1.5, -1.5, 1.5], [-1.5, 1.5, 1.5]];
  const shade = [0.78, 1, 0.9];
  let out = `<polygon points="${hex.map(P).join(' ')}" fill="#0c0c13" stroke="#0c0c13" stroke-width="3" stroke-linejoin="round"/>`;
  for (const s of st.stickers) {
    const k = s.n.indexOf(1);
    if (k < 0) continue;
    const [a, b] = [0, 1, 2].filter(i => i !== k), c = s.p.map((v, i) => v + s.n[i] * 0.5);
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const q = [...c]; q[a] += u * 0.42; q[b] += v * 0.42; return P(q); });
    out += `<polygon points="${pts.join(' ')}" style="fill:var(--c${s.c});stroke:var(--c${s.c});opacity:${shade[k]}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  return `<svg viewBox="-56 -63 112 126" aria-hidden="true">${out}</svg>`;
}
let myPatterns = store.get('myPatterns', []);
const allPatterns = () => [...myPatterns.map(p => [p.name, p.seq, true]), ...PATTERNS];
function renderPatterns() {
  $('patterns').innerHTML = allPatterns().map(([name, seq, mine], i) =>
    `<div class="pattern-wrap"><button class="pattern${mine ? ' mine' : ''}" data-i="${i}">${iso(new CubeState().move(seq))}<strong>${name}</strong><span>${tokens(seq).length} moves${mine ? ' · yours' : ''}</span></button>
    ${mine ? `<button class="pattern-del" data-del="${i}" aria-label="Delete ${name}">✕</button>` : ''}</div>`).join('');
}
renderPatterns();
$('patterns').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    myPatterns.splice(+del.dataset.del, 1);
    store.set('myPatterns', myPatterns);
    return renderPatterns();
  }
  const b = e.target.closest('.pattern');
  if (!b) return;
  stopDesign();
  const [name, seq] = allPatterns()[b.dataset.i];
  setCube(SOLVED, seq);
  toast(name);
});

// ---------- pattern designer: paint on the 3D cube, get the algorithm ----------
let designing = false, designColor = 'D', designAlg = '';
const designPal = $('design-palette');
designPal.innerHTML = [...FACES].map(f => `<button role="radio" data-c="${f}" style="--c:var(--c${f})" aria-label="${COLOR_NAMES[f]}"></button>`).join('');
const pickDesign = f => { designColor = f; [...designPal.children].forEach(b => b.setAttribute('aria-checked', b.dataset.c === f)); };
designPal.addEventListener('click', e => { const c = e.target.closest('[data-c]')?.dataset.c; if (c) pickDesign(c); });
pickDesign('D');
function designUI(stage) {
  designPal.hidden = stage !== 'paint';
  $('design-alg').hidden = stage !== 'done';
  $('design-help').textContent = {
    idle: 'Paint any design straight onto the 3D cube, and Sixfold finds the moves that make it.',
    paint: 'Pick a colour, then tap or drag across stickers on the 3D cube. Centres stay put. Every colour needs exactly nine stickers.',
    done: 'Here are the moves that build your design from a solved cube.',
  }[stage];
  $('design-actions').innerHTML = {
    idle: '<button class="btn primary" id="design-start">Start designing</button>',
    paint: '<button class="btn primary" data-d="find">Find the moves</button><button class="btn ghost" data-d="cancel">Cancel</button>',
    done: '<button class="btn primary" data-d="save">Save to gallery</button><button class="btn ghost" data-d="copy">Copy</button><button class="btn ghost" data-d="again">New</button>',
  }[stage];
}
function startDesign() {
  setCube(SOLVED);
  designing = true;
  cube.paintMode = true;
  document.body.classList.add('painting');
  designUI('paint');
  $('design-msg').textContent = '';
}
function stopDesign() {
  if (!designing && $('design-alg').hidden) return;
  designing = false;
  cube.paintMode = false;
  document.body.classList.remove('painting');
  designUI('idle');
  $('design-msg').textContent = '';
}
cube.onPaint = (normal, p) => {
  if (!designing) return;
  const i = faceletIndex(state.size, normal, p);
  if (i == null || isCenter(i)) return;
  const f = [...state.facelets()];
  if (f[i] === designColor) return;
  f[i] = designColor;
  setCube(f.join(''));
  const err = problem(state.facelets());
  $('design-msg').textContent = err || 'Looks buildable — find the moves!';
  $('design-msg').className = 'msg ' + (err ? '' : 'good');
};
$('design-actions').addEventListener('click', async e => {
  const act = e.target.closest('button')?.dataset.d ?? (e.target.closest('#design-start') ? 'start' : null);
  if (act === 'start' || act === 'again') startDesign();
  else if (act === 'cancel') { stopDesign(); setCube(SOLVED); }
  else if (act === 'copy') { await navigator.clipboard?.writeText(designAlg); toast('Algorithm copied'); }
  else if (act === 'save') {
    myPatterns.unshift({ name: `Design ${myPatterns.length + 1}`, seq: designAlg });
    store.set('myPatterns', myPatterns);
    renderPatterns();
    toast('Saved to your gallery ✦');
  } else if (act === 'find') {
    const err = problem(state.facelets());
    if (err) return toast(err);
    const sol = await ask('solve', { facelets: state.solverString() });
    if (!sol.trim()) return toast('That’s a solved cube — paint something!');
    designAlg = invert(sol);
    designing = false;
    cube.paintMode = false;
    document.body.classList.remove('painting');
    setCube(SOLVED, designAlg);
    $('design-alg').textContent = designAlg;
    $('design-msg').textContent = `${tokens(designAlg).length} moves from solved.`;
    designUI('done');
  }
});

// ---------- reconstruction replay ----------
function cancelReplay() {
  replayTimers.forEach(clearTimeout);
  replayTimers = [];
}
let replayT0 = 0;
function replay(recon, onDone) {
  if (!recon) return;
  setCube(recon.start);
  if (!onDone) toast('Replaying your solve in real time');
  replayT0 = performance.now() + 700;
  recon.moves.forEach(({ tok, t }) => replayTimers.push(setTimeout(() => move(tok, { record: false }), 700 + t)));
  if (onDone) replayTimers.push(setTimeout(onDone, 700 + (recon.moves.at(-1)?.t ?? 0) + 2200));
}

// ---------- video recording ----------
let recorder = null, saveVideo = null, recTicker = 0;
async function startRecording(opts) {
  if (!recorder) {
    const m = await import('./record.js');
    recorder = m.createRecorder(cube);
    saveVideo = m.saveVideo;
  }
  if (!recorder.supported) return toast('Video recording isn’t supported in this browser.');
  recorder.start(opts);
  const t0 = performance.now();
  $('rec-badge').hidden = false;
  $('record-btn').setAttribute('aria-pressed', true);
  recTicker = setInterval(() => {
    const s = Math.floor((performance.now() - t0) / 1000);
    $('rec-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
}
async function stopRecording(name = `sixfold-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`) {
  clearInterval(recTicker);
  $('rec-badge').hidden = true;
  $('record-btn').setAttribute('aria-pressed', false);
  const v = await recorder.stop();
  if (!v?.blob.size) return;
  await saveVideo(v, name);
  toast(`Video saved (${v.ext.toUpperCase()}) ✦`);
}
$('record-btn').addEventListener('click', () => (recorder?.recording ? stopRecording() : startRecording({ sub: `${state.size}×${state.size} · sixfold` })));
async function recordSolve(recon) {
  if (!recon || recorder?.recording) return;
  await startRecording({ caption: () => fmt(Math.min(recon.ms, Math.max(0, performance.now() - replayT0))), sub: recon.label });
  toast('Recording your replay…');
  replay(recon, () => stopRecording(`sixfold-solve-${fmt(recon.ms).replace(/[:.]/g, '-')}`));
}

// ---------- modules ----------
const timer = initTimer({
  ask, store, toast, replay,
  record: recordSolve,
  getSize: () => state.size,
  needSize: n => setPuzzle(n),
  openStats: async () => {
    statsView ??= (await import('./statsview.js')).initStatsView({ getSolves: () => timer.all(), setSolves: l => timer.replaceAll(l), getSize: () => state.size, toast });
    statsView.open();
  },
  loadScramble: seq => setCube(new CubeState(solvedFacelets(state.size)).move(seq).facelets()), // scramble the puzzle on screen, whatever its size
  isSolved: () => state.isSolved(),
  getFacelets: () => state.facelets(),
  splits: (start, moves) => (sizeOf(start) === 3 ? cfopSplits(start, moves) : [-1, -1, -1, -1]),
  celebrate: () => { cube.celebrate(); chime(); },
});
// Panels you haven't opened yet aren't downloaded yet — they load on first visit.
let train = null, scan = null, statsView = null;
const loaded = {};
function loadPanel(m) {
  if (loaded[m]) return;
  if (m === 'train') loaded[m] = import('./train.js').then(({ initTrain }) => {
    train = initTrain({
      store, toast,
      load: f => setCube(f),
      getState: () => state,
      playSeq: seq => seq.forEach(t => move(t, { record: false })),
      celebrate: () => { cube.celebrate(); chime(); },
    });
  });
  if (m === 'scan') loaded[m] = import('./scan.js').then(({ initScan }) => {
    scan = initScan({
      toast,
      onDone(raw) {
        setCube(raw);
        setMode('solve');
        const err = problem(raw);
        toast(err ? `Scanned — but check it: ${err}` : 'Scanned! Tap “Solve this cube”.');
      },
    });
  });
  if (m === 'connect') loaded[m] = Promise.all([import('./gesture.js'), import('./connect.js')]).then(([{ initGesture }, { initConnect }]) => {
    initGesture({ cube, stage: $('stage') });
    initConnect({
      move: t => move(t),
      setCube: f => setCube(f),
      toast,
      command(c) {
        if (c === 'scramble') scramble();
        else if (c === 'solve') { setMode('solve'); solve(); }
        else if (c === 'undo') undo();
        else if (c === 'redo') redo();
        else if (c === 'reset') setCube();
        else if (c === 'play') { if (solution && !solution.playing) togglePlay(); }
        else if (c === 'pause') { if (solution?.playing) togglePlay(); }
        else if (c === 'next') step(1);
      },
    });
  });
  loaded[m]?.catch(() => { delete loaded[m]; toast('Couldn’t load that panel — check your connection.'); });
}
initTheme({ cube, store });

// ---------- share this cube ----------
$('share-btn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?cube=${state.facelets()}#${mode}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Sixfold', text: 'Can you solve this cube?', url });
    else { await navigator.clipboard.writeText(url); toast('Link to this exact cube copied ✦'); }
  } catch { /* dismissed */ }
});

// ---------- keyboard ----------
const NOTATION = { u: 'U', r: 'R', f: 'F', d: 'D', l: 'L', b: 'B', m: 'M', e: 'E', s: 'S', x: 'x', y: 'y', z: 'z' };
const SPEED = {
  i: 'R', k: "R'", j: 'U', f: "U'", h: 'F', g: "F'", w: 'B', o: "B'", s: 'D', l: "D'", d: 'L', e: "L'",
  u: 'r', m: "r'", v: 'l', r: "l'", t: 'x', y: 'x', b: "x'", n: "x'", ';': 'y', a: "y'", p: 'z', q: "z'",
  5: 'M', 6: 'M', x: "M'", '.': "M'", z: 'd', '/': "d'", ',': 'u', c: "u'",
};
let scheme = store.get('scheme', 'notation');
function keyMove(e) {
  if (scheme === 'speed') return SPEED[e.key.toLowerCase()];
  // Option/Alt + face = wide turn (handy on the 4×4); read e.code since Option changes e.key on macOS
  const k = e.altKey ? e.code.replace(/^Key/, '').toLowerCase() : e.key.toLowerCase(), m = NOTATION[k];
  if (!m) return null;
  if (e.altKey && !'URFDLB'.includes(m)) return null;
  return m + (e.altKey ? 'w' : '') + (e.shiftKey ? "'" : '');
}

addEventListener('keydown', e => {
  if ($('keys-dialog').open) return;
  if (e.target.matches?.('input[type=text], input:not([type]), textarea')) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.metaKey || e.ctrlKey) return;
  if (e.key === 'h' && scheme === 'notation' && !e.altKey && !mode.startsWith('time')) { hint(); return; }
  if (e.key === '?') { openKeys(); return; }
  if (replayTimers.length && e.key === 'Escape') { cancelReplay(); return; }
  if (mode === 'time' && timer.keydown(e)) return;
  if (mode === 'train' && train?.keydown(e)) return;
  if (mode === 'scan' && e.code === 'Space') { e.preventDefault(); scan?.capture(); return; }
  if (solution && e.code === 'Space' && (mode === 'solve' || mode === 'learn' || mode === 'play')) { e.preventDefault(); togglePlay(); return; }
  if (e.key === 'Escape' && solution) { solution.playing = false; render(); return; }
  if (solution && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    solution.playing = false;
    step(e.key === 'ArrowRight' ? 1 : -1);
    return;
  }
  const m = keyMove(e);
  if (m) { e.preventDefault(); move(m); }
});
addEventListener('keyup', e => { if (mode === 'time') timer.keyup(e); });

// keyboard help dialog
const dialog = $('keys-dialog');
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'];
function renderKeys() {
  document.querySelectorAll('#scheme button').forEach(b => b.setAttribute('aria-checked', b.dataset.scheme === scheme));
  const map = scheme === 'speed' ? SPEED : NOTATION;
  $('keyboard').innerHTML = ROWS.map(r => `<div class="krow">${[...r].map(k => {
    const m = map[k], f = m?.[0].toUpperCase();
    const c = m && FACES.includes(f) ? `style="--c:var(--c${f})"` : '';
    return `<div class="key${m ? ' on' : ''}" ${c}><span>${k.toUpperCase()}</span><b>${m ?? ''}</b></div>`;
  }).join('')}</div>`).join('');
  $('scheme-help').innerHTML = scheme === 'speed'
    ? 'The layout speedcubers use on csTimer: both hands, all fingers — <kbd>I</kbd> is R, <kbd>K</kbd> is R′, <kbd>J</kbd>/<kbd>F</kbd> are U/U′.'
    : 'Press the letter of a face to turn it clockwise. Hold <kbd>⇧ Shift</kbd> for counter-clockwise.';
}
function openKeys() { renderKeys(); dialog.showModal(); }
$('keys-btn').addEventListener('click', openKeys);
$('keys-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
document.querySelectorAll('#scheme button').forEach(b => b.addEventListener('click', () => {
  scheme = b.dataset.scheme;
  store.set('scheme', scheme);
  renderKeys();
}));

// ---------- boot ----------
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
const shared = new URLSearchParams(location.search).get('cube');
if (shared && /^[URFDLB?]+$/.test(shared) && [24, 54, 96].includes(shared.length)) {
  setCube(shared);
  toast(problem(shared) ? 'Shared cube loaded' : 'Someone shared this cube with you — can you solve it?');
}
if (shared) { chosen = state.size; onResize(); } // a shared link decides the puzzle
else if ([2, 4].includes(chosen)) setCube(solvedFacelets(chosen));
else onResize();
const initial = location.hash.slice(1);
mode = null;
setMode(tabs.some(t => t.dataset.mode === initial) ? initial : 'play');
render();
if (!reduceMotion) cube.assemble();
if (import.meta.env.DEV) window.sixfold = { cube, state, get solution() { return solution; } }; // debugging handle
// ---------- first-visit tour (loaded only when needed) ----------
async function startTour() {
  const { initTour } = await import('./tour.js');
  // demo turns bypass history and solve tracking so the cube quietly returns to where it was
  const demoTurn = t => { state.move(t); cube.turn(t); click(); wasSolved = state.isSolved(); };
  initTour({ cube, demoTurn, store }).start();
}
document.querySelectorAll('[data-tour]').forEach(b => b.addEventListener('click', () => { dialog.close(); setMode('play'); startTour(); }));
if (!store.get('toured', false) && !shared && mode === 'play') setTimeout(startTour, reduceMotion ? 300 : 2200);

performance.mark('sixfold:ready');
setTimeout(() => (window.requestIdleCallback ?? setTimeout)(getWorker), 1500);
