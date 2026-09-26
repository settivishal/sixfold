import { SETS, caseState, reached, diagram, moveCount } from './algs.js';
import { fmt } from './stats.js';
import { tokens, invertMove } from './state.js';
import { emit } from './core/events.js';

// Algorithm trainer: timed drills (solve the case on screen) and a recognition quiz.
export function initTrain({ store, load, getState, playSeq, toast, celebrate }) {
  const $ = id => document.getElementById(id);
  let set = store.get('trainSet', 'oll');
  let mode = null; // 'drill' | 'quiz' | null
  let current = null, t0 = 0, running = false, raf = 0, streak = 0, auto = 0;
  const stats = () => store.get(`train.${set}`, {});
  const skipped = () => new Set(store.get(`trainSkip.${set}`, []));

  function renderCases() {
    const st = stats(), skip = skipped();
    $('train-blurb').textContent = SETS[set].blurb;
    document.querySelectorAll('#train-set button').forEach(b => b.setAttribute('aria-checked', b.dataset.set === set));
    $('cases').innerHTML = SETS[set].cases.map(([name, alg]) => `
      <button class="case" data-name="${name}" aria-pressed="${!skip.has(name)}" title="${alg}">
        ${diagram(alg, set)}<strong>${name}</strong><span>${st[name]?.best ? fmt(st[name].best) : `${moveCount(alg)} moves`}</span>
      </button>`).join('');
  }

  $('cases').addEventListener('click', e => {
    const b = e.target.closest('.case');
    if (!b) return;
    const skip = skipped(), n = b.dataset.name;
    skip.has(n) ? skip.delete(n) : skip.add(n);
    if (skip.size === SETS[set].cases.length) return toast('Keep at least one case.');
    store.set(`trainSkip.${set}`, [...skip]);
    b.setAttribute('aria-pressed', !skip.has(n));
  });
  document.querySelectorAll('#train-set button').forEach(b => b.addEventListener('click', () => {
    set = b.dataset.set;
    store.set('trainSet', set);
    stop();
    renderCases();
  }));

  function pick() {
    const skip = skipped();
    const pool = SETS[set].cases.filter(([n]) => !skip.has(n) && n !== current?.name);
    const [name, alg, kind] = pool[(Math.random() * pool.length) | 0] ?? SETS[set].cases[0];
    return { name, alg, kind, auf: ['', 'U', 'U2', "U'"][(Math.random() * 4) | 0] };
  }

  function next() {
    clearTimeout(auto);
    current = pick();
    running = false;
    load(caseState(current.alg, current.auf).facelets());
    $('drill').hidden = false;
    $('drill-alg').textContent = '';
    $('drill-alg').classList.remove('on');
    $('drill-diagram').innerHTML = '';
    $('drill-name').textContent = mode === 'quiz' ? `Streak ${streak}` : 'Solve it';
    $('drill-time').textContent = mode === 'drill' ? '0.00' : '';
    $('drill-show').hidden = mode === 'quiz';
    const quiz = $('quiz');
    quiz.innerHTML = '';
    if (mode === 'quiz') {
      const others = SETS[set].cases.map(c => c[0]).filter(n => n !== current.name).sort(() => Math.random() - 0.5).slice(0, 3);
      quiz.innerHTML = [current.name, ...others].sort(() => Math.random() - 0.5).map(n => `<button class="btn" data-n="${n}">${n}</button>`).join('');
    }
  }

  $('quiz').addEventListener('click', e => {
    const b = e.target.closest('[data-n]');
    if (!b || !current || $('quiz').classList.contains('answered')) return;
    const right = b.dataset.n === current.name;
    b.classList.add(right ? 'right' : 'wrong');
    $('quiz').querySelector(`[data-n="${CSS.escape(current.name)}"]`).classList.add('right');
    streak = right ? streak + 1 : 0;
    emit('quiz', { streak });
    $('drill-name').textContent = right ? `Streak ${streak}` : `It was ${current.name}`;
    if (right && streak % 5 === 0) celebrate();
    reveal();
    $('quiz').classList.add('answered');
    auto = setTimeout(() => { $('quiz').classList.remove('answered'); next(); }, right ? 1100 : 2600);
  });

  function reveal() {
    $('drill-alg').textContent = current.alg;
    $('drill-alg').classList.add('on');
    $('drill-diagram').innerHTML = diagram(current.alg, set);
    if (mode === 'drill') $('drill-name').textContent = current.name;
  }

  function start(m) {
    mode = m;
    streak = 0;
    next();
  }
  function stop() {
    mode = null;
    current = null;
    running = false;
    clearTimeout(auto);
    $('drill').hidden = true;
  }

  function frame() {
    if (running) $('drill-time').textContent = fmt(performance.now() - t0);
    raf = requestAnimationFrame(frame);
  }

  function onMove(tok) {
    if (mode !== 'drill' || !current) return;
    if (!running && !/^[xyz]/.test(tok) && !reached(set, getState(), current.kind)) { running = true; t0 = performance.now(); }
    if (running && reached(set, getState(), current.kind)) {
      running = false;
      const ms = performance.now() - t0, all = stats(), s = (all[current.name] ??= { best: 0, n: 0, total: 0 });
      const pb = !s.best || ms < s.best;
      s.n++;
      s.total += ms;
      if (pb) s.best = ms;
      store.set(`train.${set}`, all);
      $('drill-time').textContent = fmt(ms);
      reveal();
      toast(`${current.name} · ${fmt(ms)}${pb && s.n > 1 ? ' — new best ✦' : ''} · avg ${fmt(s.total / s.n)}`);
      renderCases();
      auto = setTimeout(next, 1400);
    }
  }

  $('train-drill').addEventListener('click', () => start('drill'));
  $('train-quiz').addEventListener('click', () => start('quiz'));
  $('drill-next').addEventListener('click', next);
  $('drill-stop').addEventListener('click', stop);
  $('drill-reveal').addEventListener('click', () => current && reveal());
  $('drill-show').addEventListener('click', () => {
    if (!current) return;
    reveal();
    running = false;
    playSeq([...(current.auf ? [invertMove(current.auf)] : []), ...tokens(current.alg)]);
  });

  renderCases();
  frame();
  return {
    onMove,
    keydown(e) {
      if (e.key === 'Enter' && mode) { e.preventDefault(); next(); return true; }
      return false;
    },
    deactivate: stop,
  };
}
