// Global daily leaderboard. On-screen daily solves are submitted with their full move list; the
// server replays them before they count. Offline or failing? The board says so and the timer carries on.
import { on, emit } from '../core/events.js';
import { fmt } from '../stats.js';
import { solveValue } from '../timer.js';
import { dayNumber } from '../shared/daily.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function initLeaderboard({ backend, toast }) {
  const $ = id => document.getElementById(id);
  const card = $('daily-board'), list = $('board-list'), status = $('board-status'), nameInput = $('board-name');
  let open = false, loading = null;

  async function refresh() {
    if (!open) return;
    const day = dayNumber();
    $('board-day').textContent = `#${day}`;
    status.textContent = 'Loading…';
    loading = Promise.all([backend.leaderboard(day, 10), backend.me() ? backend.rank(day, backend.me().player) : null]);
    try {
      const [rows, mine] = await loading;
      const me = backend.me()?.player;
      list.innerHTML = rows.length
        ? rows.map(r => `<li class="${r.player_id === me ? 'me' : ''}"><span class="rk">${r.rank}</span><span class="nm">${esc(r.name)}</span><span class="tm">${fmt(r.ms)}</span></li>`).join('')
        : '<li class="empty">No one has finished today’s scramble yet. Be first.</li>';
      status.textContent = mine ? `You’re #${mine.rank} of ${mine.total} today with ${fmt(mine.ms)}.` : 'Solve today’s scramble on screen to get on the board.';
    } catch (e) {
      list.innerHTML = '';
      status.textContent = e.offline ? 'Leaderboard offline — your times are still saved on this device.' : e.message;
    }
  }

  on('dailymode', ({ on: isOn }) => {
    open = isOn;
    card.hidden = !isOn;
    if (isOn) {
      nameInput.value = backend.me()?.name ?? '';
      refresh();
    }
  });

  on('solve', async s => {
    if (!s.daily || s.kind !== 'virtual' || s.pen !== 0 || !s.recording?.length) return;
    try {
      const res = await backend.submitDaily(dayNumber(), s.recording.map(m => [m.tok, m.t]), solveValue(s));
      if (!backend.me()) await backend.hello().catch(() => {});
      if (res.rank) {
        emit('daily', { rank: res.rank.rank, total: res.rank.total, ms: res.best });
        toast(res.improved ? `On the board: #${res.rank.rank} of ${res.rank.total} today ✦` : `Your best today still stands: #${res.rank.rank} with ${fmt(res.best)}`);
      }
    } catch (e) {
      toast(e.offline ? 'Saved locally — the leaderboard is offline right now.' : `Leaderboard: ${e.message}`);
    }
    refresh();
  });

  $('board-save').addEventListener('click', async () => {
    try {
      const me = await backend.hello(nameInput.value);
      toast(me.name ? `You’ll appear as “${me.name}”` : 'Name cleared');
      refresh();
    } catch (e) {
      toast(e.message);
    }
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('board-save').click(); } });
  $('board-refresh').addEventListener('click', refresh);
  $('board-forget').addEventListener('click', async () => {
    if (!confirm('Delete your name, daily results and challenges from the Sixfold server? Your local times stay on this device.')) return;
    try {
      await backend.forget();
      nameInput.value = '';
      toast('Your online data is gone.');
      refresh();
    } catch (e) {
      toast(e.message);
    }
  });
}
