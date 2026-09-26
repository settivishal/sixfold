// Trophies + a daily practice streak. Purely event-driven: nothing else needs to know this exists.
import { on } from '../core/events.js';
import { average } from '../stats.js';
import { solveValue } from '../timer.js';

export const TROPHIES = [
  ['first', '🧊', 'First light', 'Solve a cube with your own hands.'],
  ['pocket', '🎲', 'Pocket rocket', 'Solve a 2×2 yourself.'],
  ['revenge', '👑', 'Revenge', 'Solve a 4×4 yourself.'],
  ['sub60', '⏱️', 'Under a minute', 'Time a 3×3 solve under 60 seconds.'],
  ['sub30', '⚡', 'Sub-30', 'Time a 3×3 solve under 30 seconds.'],
  ['sub20', '🔥', 'Sub-20', 'Time a 3×3 solve under 20 seconds.'],
  ['sub10', '🚀', 'Sub-10', 'Time a 3×3 solve under 10 seconds.'],
  ['ao5', '📈', 'Consistent', 'Average under 30 seconds over five 3×3 solves.'],
  ['century', '💯', 'Centurion', 'Time 100 solves.'],
  ['graduate', '🎓', 'Graduate', 'Follow a Learn lesson to the very end.'],
  ['eye', '👁️', 'Trained eye', 'Name 10 cases in a row in the recognition quiz.'],
  ['artist', '🎨', 'Artist', 'Save a pattern you designed.'],
  ['ghost', '👻', 'Ghostbuster', 'Beat your own ghost.'],
  ['daily', '📅', 'Daily ritual', 'Finish the daily challenge on screen.'],
  ['podium', '🏆', 'Podium', 'Finish top 3 on a daily leaderboard.'],
  ['duel', '⚔️', 'Duelist', 'Win a challenge-link race.'],
  ['blind', '🕶️', 'In the dark', 'Complete a blindfolded solve.'],
  ['streak3', '✨', 'Warming up', 'Practise three days in a row.'],
  ['streak7', '🌙', 'A week of cubes', 'Practise seven days in a row.'],
  ['streak30', '🌟', 'Devotion', 'Practise thirty days in a row.'],
];
const BY_ID = Object.fromEntries(TROPHIES.map(t => [t[0], t]));

// local calendar day, so a streak follows the player's own midnight
export const localDay = (now = Date.now()) => Math.floor((now - new Date(now).getTimezoneOffset() * 60000) / 864e5);

// Pure streak arithmetic (tested): returns the new streak after practising on `today`.
export function nextStreak(prev, today) {
  if (prev?.last === today) return prev;
  const count = prev?.last === today - 1 ? prev.count + 1 : 1;
  return { last: today, count, best: Math.max(count, prev?.best ?? 0) };
}

export function initAchievements({ store, chime }) {
  const $ = id => document.getElementById(id);
  let got = store.get('trophies', {});

  const pop = document.createElement('div');
  pop.className = 'trophy-pop';
  pop.setAttribute('role', 'status');
  document.body.append(pop);
  let popTimer = 0, queue = [];

  function show() {
    if (pop.classList.contains('show') || !queue.length) return;
    const [, icon, name, desc] = BY_ID[queue.shift()];
    pop.innerHTML = `<span class="medal">${icon}</span><span><small>Trophy unlocked</small><b>${name}</b><em>${desc}</em></span>`;
    pop.classList.add('show');
    chime();
    clearTimeout(popTimer);
    popTimer = setTimeout(() => { pop.classList.remove('show'); setTimeout(show, 450); }, 3600);
  }

  function award(id) {
    if (got[id] || !BY_ID[id]) return;
    got[id] = Date.now();
    store.set('trophies', got);
    queue.push(id);
    show();
    badge();
  }

  function practise() {
    const s = nextStreak(store.get('streak'), localDay());
    store.set('streak', s);
    if (s.count >= 3) award('streak3');
    if (s.count >= 7) award('streak7');
    if (s.count >= 30) award('streak30');
    badge();
  }

  function badge() {
    const s = store.get('streak'), live = s && s.last >= localDay() - 1 ? s.count : 0;
    $('trophy-streak').textContent = live >= 2 ? `🔥${live}` : '';
    $('trophy-btn').setAttribute('aria-label', `Trophies — ${Object.keys(got).length} of ${TROPHIES.length}${live >= 2 ? `, ${live}-day streak` : ''}`);
  }

  on('solved', ({ size, byUser }) => {
    if (!byUser) return;
    award('first');
    if (size === 2) award('pocket');
    if (size === 4) award('revenge');
    practise();
  });
  on('solve', s => {
    practise();
    const v = solveValue(s);
    if (s.blind && v !== Infinity) award('blind');
    if (s.daily && s.kind === 'virtual' && v !== Infinity) award('daily');
    if (s.puzzle === '333' && !s.blind) {
      if (v < 60000) award('sub60');
      if (v < 30000) award('sub30');
      if (v < 20000) award('sub20');
      if (v < 10000) award('sub10');
      const all = store.get('solves', []).filter(x => (x.puzzle ?? '333') === '333').map(solveValue);
      if ((average(all, 5) ?? Infinity) < 30000) award('ao5');
    }
    if (store.get('solves', []).length >= 100) award('century');
  });
  on('lesson', () => award('graduate'));
  on('quiz', ({ streak }) => streak >= 10 && award('eye'));
  on('pattern', () => award('artist'));
  on('ghost', ({ won }) => won && award('ghost'));
  on('daily', ({ rank }) => rank && rank <= 3 && award('podium'));
  on('challenge', ({ won }) => won && award('duel'));

  // ---- trophy cabinet ----
  const dlg = $('trophies-dialog');
  function render() {
    const s = store.get('streak');
    $('trophy-count').textContent = `${Object.keys(got).length} of ${TROPHIES.length}`;
    $('streak-line').textContent = s ? `Current streak ${s.last >= localDay() - 1 ? s.count : 0} day(s) · best ${s.best}` : 'Solve something today to start a streak.';
    $('trophy-grid').innerHTML = TROPHIES.map(([id, icon, name, desc]) => `
      <li class="trophy${got[id] ? ' got' : ''}"><span class="medal">${got[id] ? icon : '🔒'}</span>
        <b>${name}</b><em>${desc}</em>${got[id] ? `<small>${new Date(got[id]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small>` : ''}</li>`).join('');
  }
  $('trophy-btn').addEventListener('click', () => { render(); dlg.showModal(); });
  $('trophies-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  badge();
  return { award };
}
