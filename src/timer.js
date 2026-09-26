import { average, fmt } from './stats.js';
import { Cube3D } from './cube3d.js';
import { CubeState } from './state.js';

// Speedcubing timer. "physical": hold Space → green → release to start, any key stops.
// "virtual": Space loads the scramble on screen; the first turn starts, solving stops.
export const DAILY_NO = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 864e5) + 1;
const SPLIT_NAMES = ['Cross', 'F2L', 'OLL', 'PLL'];
const BLOCKS = { Cross: '🟪', F2L: '🟦', OLL: '🟨', PLL: '🟩' };
const isRot = t => /^[xyz]/.test(t);
export const puzzleId = n => `${n}${n}${n}`;
export const solveValue = s => (s.pen === 'dnf' ? Infinity : s.ms + (s.pen === 2 ? 2000 : 0));

export function initTimer({ ask, loadScramble, isSolved, getFacelets, getSize, needSize, splits, replay, record, openStats, store, toast, celebrate }) {
  const $ = id => document.getElementById(id);
  const display = $('timer-display'), scrambleEl = $('scramble-text'), help = $('timer-help');
  let kind = store.get('timerKind', 'physical');
  let inspectOn = store.get('inspection', false);
  let solves = store.get('solves', []); // { ms, pen: 0 | 2 | 'dnf', scramble, at, puzzle }
  let daily = false, recording = [], startFacelets = '', lastRecon = null;
  let scramble = '', scrambleSize = 0, phase = 'idle', prior = 'idle', t0 = 0, inspectAt = 0, penalty = 0, holdTimer = 0, active = false;

  const value = solveValue;
  const save = () => store.set('solves', solves);
  const pid = () => puzzleId(getSize());
  const mine = () => solves.filter(s => (s.puzzle ?? '333') === pid());

  async function newScramble() {
    scrambleEl.textContent = 'Shuffling…';
    const size = getSize();
    try {
      scramble = await ask('scramble', { size, seed: daily ? (DAILY_NO * 2654435761) >>> 0 : undefined });
    } catch {
      scramble = randomMoves(); // solver failed to load — fall back to random moves
    }
    scrambleSize = size;
    scrambleEl.textContent = scramble;
    if (active && phase === 'idle' && kind === 'physical') loadScramble(scramble);
  }

  function paint() {
    display.className = 'timer-display ' + ({ holding: 'holding', ready: 'ready', inspect: 'inspect', armed: 'inspect' }[phase] ?? '');
    document.body.classList.toggle('focus', phase === 'running' || phase === 'ready' || phase === 'inspect');
    if (phase === 'ready') display.textContent = '0.00';
    if (phase === 'armed') display.textContent = 'Go';
  }

  function frame() {
    const now = performance.now();
    if (phase === 'running') display.textContent = fmt(now - t0);
    if (phase === 'inspect' || (phase === 'holding' && prior === 'inspect') || (phase === 'ready' && inspectAt)) {
      const left = 15 - (now - inspectAt) / 1000;
      penalty = left > 0 ? 0 : left > -2 ? 2 : 'dnf';
      if (phase === 'inspect') display.textContent = left > 0 ? Math.ceil(left) : penalty === 2 ? '+2' : 'DNF';
      display.classList.toggle('warn', left < 4);
    }
    if (race?.running) $('ghost-time').textContent = race.done ? `${fmt(race.data.ms)} ✓` : fmt(now - t0);
    requestAnimationFrame(frame);
  }

  function startInspect() { inspectAt = performance.now(); return 'inspect'; }

  function start() {
    phase = 'running';
    t0 = performance.now();
    paint();
    startRace();
  }

  function stop() {
    const ms = Math.round(performance.now() - t0);
    const s = { ms, pen: penalty, scramble, at: Date.now(), puzzle: pid() };
    const prev = mine().map(value), prevBest = Math.min(...prev);
    solves.push(s);
    save();
    phase = 'idle';
    inspectAt = 0;
    penalty = 0;
    paint();
    display.textContent = fmt(value(s));
    if (value(s) < prevBest && prev.length) {
      display.classList.add('pb');
      toast(`New personal best — ${fmt(value(s))} ✦`);
      celebrate();
    }
    render();
    showResult(s);
    finishRace(s);
    if (!daily) newScramble();
  }

  // ---- ghost race: a second cube replays your best solve, move for move, in real time ----
  let ghostCube = null, race = null, ghostOn = store.get('ghostOn', false);
  const ghostKey = () => (daily ? `ghost.daily.${DAILY_NO}` : `ghost.${pid()}`);
  const ghostBtn = $('ghost-btn');
  function setGhostBtn() {
    ghostBtn.setAttribute('aria-pressed', ghostOn);
    ghostBtn.hidden = kind !== 'virtual';
    $('ghost').hidden = !(ghostOn && kind === 'virtual' && active);
    const data = store.get(ghostKey());
    $('ghost-label').textContent = data ? `Ghost · ${fmt(data.ms)}` : 'Ghost';
    if (ghostOn && !data) $('ghost-time').textContent = 'finish a solve to create one';
  }
  ghostBtn.addEventListener('click', () => {
    ghostOn = !ghostOn;
    store.set('ghostOn', ghostOn);
    setGhostBtn();
    if (ghostOn) toast(store.get(ghostKey()) ? 'Race your best solve — it starts when you do' : 'Your next on-screen solve becomes your ghost');
  });
  function prepareRace() {
    race?.timers.forEach(clearTimeout);
    race = null;
    const data = ghostOn && kind === 'virtual' && store.get(ghostKey());
    setGhostBtn();
    if (!data) return;
    ghostCube ??= new Cube3D($('ghost-stage'), { interactive: false });
    ghostCube.speed = 1.6;
    ghostCube.setState(new CubeState(data.start));
    $('ghost-time').textContent = 'ready';
    race = { data, timers: [], running: false, done: false };
  }
  function startRace() {
    if (!race) return;
    race.running = true;
    race.timers = race.data.moves.map(m => setTimeout(() => ghostCube.turn(m.tok), m.t));
    race.timers.push(setTimeout(() => { race.done = true; $('ghost').classList.add('finished'); }, race.data.ms));
  }
  function finishRace(s) {
    const mineMs = value(s);
    if (kind === 'virtual' && recording.length && mineMs !== Infinity) {
      const cur = store.get(ghostKey());
      if (!cur || mineMs < cur.ms) store.set(ghostKey(), { ms: mineMs, start: startFacelets, moves: recording });
    }
    if (!race?.running) return setGhostBtn();
    const diff = mineMs - race.data.ms;
    toast(diff < 0 ? `You beat your ghost by ${fmt(-diff)} ✦` : `Ghost wins by ${fmt(diff)} — go again`);
    if (diff >= 0) race.timers.forEach(clearTimeout);
    setTimeout(() => $('ghost').classList.remove('finished'), 2500);
    race.running = false;
    setGhostBtn();
  }

  // ---- result card: splits, TPS, replay, video, share ----
  function showResult(s) {
    const res = $('result'), total = value(s), virtual = kind === 'virtual' && recording.length;
    let segs = [];
    if (virtual) {
      const idx = splits(startFacelets, recording.map(m => m.tok));
      let prevT = 0, prevI = -1;
      idx.forEach((i, k) => {
        if (i < 0 || i <= prevI) return;
        const t = recording[i].t;
        segs.push({ name: SPLIT_NAMES[k], ms: t - prevT, moves: recording.slice(prevI + 1, i + 1).filter(m => !isRot(m.tok)).length });
        prevT = t;
        prevI = i;
      });
      lastRecon = { start: startFacelets, moves: recording.slice(), ms: total, label: daily ? `Daily #${DAILY_NO}` : `${getSize()}×${getSize()}` };
    }
    const turns = recording.filter(m => !isRot(m.tok)).length;
    if (daily) {
      const best = store.get(`daily.${DAILY_NO}`);
      if (total !== Infinity && (!best || total < best)) store.set(`daily.${DAILY_NO}`, total);
    }
    res.hidden = false;
    res.innerHTML = `
      <div class="res-head"><span>${daily ? `Daily #${DAILY_NO}` : 'Last solve'}</span><b>${fmt(total)}</b></div>
      ${segs.length ? `<div class="split-bar">${segs.map(g => `<i class="sp-${g.name}" style="flex:${Math.max(g.ms, 60)}" title="${g.name}"></i>`).join('')}</div>
      <ul class="split-list">${segs.map(g => `<li><i class="sp-${g.name}"></i>${g.name}<span>${fmt(g.ms)}</span><em>${g.moves} mv</em></li>`).join('')}</ul>` : ''}
      ${virtual ? `<p class="res-meta">${turns} moves · ${(turns / (s.ms / 1000)).toFixed(2)} turns/sec</p>` : ''}
      <div class="row">
        ${virtual ? '<button class="btn ghost" data-act="replay">Replay</button><button class="btn ghost" data-act="video">Video</button>' : ''}
        <button class="btn ghost" data-act="share">Share</button>
      </div>`;
    res.querySelector('[data-act=replay]')?.addEventListener('click', () => replay(lastRecon));
    res.querySelector('[data-act=video]')?.addEventListener('click', () => record(lastRecon));
    res.querySelector('[data-act=share]').addEventListener('click', () => share(total, segs, turns));
  }

  async function share(total, segs, turns) {
    const sum = segs.reduce((a, g) => a + g.ms, 0) || 1;
    const bar = segs.map(g => BLOCKS[g.name].repeat(Math.max(1, Math.round((g.ms / sum) * 10)))).join('');
    const text = [
      daily ? `Sixfold Daily #${DAILY_NO} ✦` : `Sixfold ${getSize()}×${getSize()} ✦`,
      `⏱ ${fmt(total)}${turns ? ` · ${turns} moves` : ''}`,
      bar,
      segs.map(g => `${g.name.toLowerCase()} ${fmt(g.ms)}`).join(' · '),
      location.origin + location.pathname,
    ].filter(Boolean).join('\n');
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Result copied — paste it anywhere ✦'); }
    } catch { /* share sheet dismissed */ }
  }

  const dailyBtn = $('daily-btn');
  dailyBtn.textContent = `✦ Daily #${DAILY_NO}`;
  dailyBtn.addEventListener('click', () => {
    daily = !daily;
    dailyBtn.setAttribute('aria-pressed', daily);
    abort();
    if (daily && getSize() !== 3) needSize(3); // the daily is a 3×3 challenge; needSize re-scrambles
    else newScramble();
    setGhostBtn();
    if (daily) toast(`Daily #${DAILY_NO}: everyone gets this scramble today`);
  });

  function abort() {
    clearTimeout(holdTimer);
    phase = 'idle';
    inspectAt = 0;
    penalty = 0;
    display.textContent = '0.00';
    race?.timers.forEach(clearTimeout);
    if (race) race.running = false;
    paint();
  }

  function beginVirtual() {
    if (scrambleSize !== getSize()) return newScramble();
    loadScramble(scramble);
    startFacelets = getFacelets();
    recording = [];
    prepareRace();
    phase = inspectOn ? startInspect() : 'armed';
    paint();
  }

  // ---- input ----
  function keydown(e) {
    if (e.key === 'Escape' && phase !== 'idle') { abort(); return true; }
    if (kind === 'physical' && phase === 'running') { e.preventDefault(); stop(); return true; }
    if (e.code !== 'Space') return false;
    e.preventDefault();
    if (e.repeat) return true;
    press();
    return true;
  }
  function keyup(e) {
    if (e.code !== 'Space') return false;
    e.preventDefault();
    release();
    return true;
  }
  function press() {
    if (kind === 'virtual') { if (phase === 'idle') beginVirtual(); return; }
    if (phase === 'running') return stop();
    if (phase !== 'idle' && phase !== 'inspect') return;
    prior = phase;
    phase = 'holding';
    holdTimer = setTimeout(() => { if (phase === 'holding') { phase = 'ready'; paint(); } }, 300);
    paint();
  }
  function release() {
    if (kind !== 'physical') return;
    clearTimeout(holdTimer);
    if (phase === 'ready') start();
    else if (phase === 'holding') phase = prior === 'idle' && inspectOn ? startInspect() : prior;
    paint();
  }
  display.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
  display.addEventListener('pointerup', release);

  function onMove(tok) {
    if (!active || kind !== 'virtual' || phase === 'idle') return;
    if ((phase === 'armed' || phase === 'inspect') && !isRot(tok)) start();
    recording.push({ tok, t: phase === 'running' ? Math.round(performance.now() - t0) : 0 });
    if (phase === 'running' && isSolved()) stop();
  }

  // ---- panel ----
  const kindBtns = [...document.querySelectorAll('#timer-kind button')];
  function setKind(k) {
    kind = k;
    store.set('timerKind', k);
    kindBtns.forEach(b => b.setAttribute('aria-checked', b.dataset.kind === k));
    help.innerHTML = k === 'physical'
      ? 'Scramble your real cube as shown. Hold <kbd>Space</kbd> (or press the clock) until it turns green, release to start, press any key to stop.'
      : 'Press <kbd>Space</kbd> to load the scramble. Your first turn starts the clock; solving stops it. Cube rotations are free.';
    abort();
    setGhostBtn();
  }
  kindBtns.forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
  const insp = $('inspection');
  insp.checked = inspectOn;
  insp.addEventListener('change', () => store.set('inspection', (inspectOn = insp.checked)));
  $('new-scramble').addEventListener('click', () => { abort(); newScramble(); });
  $('stats-open').addEventListener('click', () => openStats());
  $('clear-times').addEventListener('click', () => {
    const list = mine();
    if (!list.length || !confirm(`Delete all ${list.length} ${getSize()}×${getSize()} times?`)) return;
    solves = solves.filter(s => !list.includes(s));
    save();
    render();
  });

  function render() {
    const list = mine(), vals = list.map(value);
    const done = vals.filter(v => v !== Infinity);
    const best = done.length ? Math.min(...done) : null;
    const stats = [
      ['Best', best], ['Ao5', average(vals, 5)], ['Ao12', average(vals, 12)],
      ['Ao100', average(vals, 100)], ['Mean', done.length ? done.reduce((a, b) => a + b, 0) / done.length : null], ['Solves', list.length],
    ];
    $('stats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${k === 'Solves' ? v : fmt(v)}</dd></div>`).join('');

    const ol = $('times');
    ol.innerHTML = '';
    list.slice(-200).reverse().forEach((s, ri) => {
      const li = document.createElement('li');
      li.className = value(s) === best ? 'best' : '';
      li.title = s.scramble;
      li.innerHTML = `<span class="n">${list.length - ri}</span><span class="t">${fmt(value(s))}</span><span class="acts">
        <button data-a="2" aria-pressed="${s.pen === 2}" aria-label="Plus two">+2</button>
        <button data-a="dnf" aria-pressed="${s.pen === 'dnf'}" aria-label="Did not finish">DNF</button>
        <button data-a="del" aria-label="Delete">✕</button></span>`;
      li.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const a = b.dataset.a;
        if (a === 'del') solves.splice(solves.indexOf(s), 1);
        else s.pen = String(s.pen) === a ? 0 : a === '2' ? 2 : 'dnf';
        save();
        render();
      }));
      ol.append(li);
    });
    spark(vals.slice(-50));
  }

  function spark(vals) {
    const svg = $('spark'), ok = vals.filter(v => v !== Infinity);
    if (ok.length < 2) { svg.innerHTML = ''; return; }
    const lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
    const X = i => (i / (vals.length - 1)) * 300, Y = v => 8 + (1 - (v - lo) / span) * 56;
    const pts = vals.map((v, i) => (v === Infinity ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean);
    svg.innerHTML = `<defs>
      <linearGradient id="spark-stroke"><stop offset="0" stop-color="#ffb36b"/><stop offset=".4" stop-color="#ff5c8a"/><stop offset="1" stop-color="#9b7bff"/></linearGradient>
      <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b7bff" stop-opacity=".28"/><stop offset="1" stop-color="#9b7bff" stop-opacity="0"/></linearGradient></defs>
      <polygon class="area" points="${pts[0].split(',')[0]},70 ${pts.join(' ')} ${pts.at(-1).split(',')[0]},70"/>
      <polyline class="line" points="${pts.join(' ')}"/>
      <line class="best" x1="0" x2="300" y1="${Y(lo)}" y2="${Y(lo)}"/>`;
  }

  setKind(kind);
  render();
  frame();

  return {
    keydown,
    keyup,
    onMove,
    activate(on) {
      active = on;
      setGhostBtn();
      if (!on) return abort();
      if (scramble && scrambleSize === getSize()) { if (kind === 'physical') loadScramble(scramble); }
      else newScramble();
    },
    // the puzzle size changed: fresh stats and a scramble for the new puzzle
    onPuzzle() {
      abort();
      if (daily && getSize() !== 3) { daily = false; dailyBtn.setAttribute('aria-pressed', false); }
      $('result').hidden = true;
      render();
      setGhostBtn();
      if (active) newScramble();
      else scrambleSize = 0;
    },
    all: () => solves,
    replaceAll(list) { solves = list; save(); render(); },
    get busy() { return phase !== 'idle'; },
  };
}

function randomMoves(n = 22) {
  const faces = 'URFDLB', out = [];
  while (out.length < n) {
    const f = faces[(Math.random() * 6) | 0];
    if (out.length && out.at(-1)[0] === f) continue;
    out.push(f + ['', "'", '2'][(Math.random() * 3) | 0]);
  }
  return out.join(' ');
}
