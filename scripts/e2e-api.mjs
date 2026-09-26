// End-to-end check of the live back end: identity, verified submissions, cheating attempts,
// security boundaries and cleanup. Run with `npm run e2e` (needs network). Leaves no data behind.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../src/config.js';
import { dailyScramble, dayNumber } from '../src/shared/daily.js';
import { invert, tokens } from '../src/state.js';

const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
const req = async (path, body, method = 'POST') => {
  const r = await fetch(SUPABASE_URL + path, { method, headers: H, body: body && JSON.stringify(body) });
  return [r.status, await r.json().catch(() => null)];
};
const api = body => req('/functions/v1/api', body);
const rpc = (fn, args) => req(`/rest/v1/rpc/${fn}`, args);

const key = randomBytes(32).toString('base64url'), day = dayNumber(), scr = dailyScramble(day);
const moves = tokens(invert(scr)).map((t, i) => [t, 400 + i * 420]), ms = moves.at(-1)[1] + 150;
let status, body;

[status, body] = await api({ action: 'hello', key, name: 'e2e-bot' });
assert.equal(status, 200); assert.equal(body.name, 'e2e-bot');
const me = body.player;
try {
  assert.equal((await api({ action: 'hello' }))[0], 401, 'no key → 401');
  assert.equal((await api({ action: 'hello', key, name: 'x'.repeat(40) }))[0], 400, 'long name → 400');

  [status, body] = await api({ action: 'daily', key, day, moves, ms });
  assert.equal(status, 200); assert.equal(body.best, ms); assert.equal(body.improved, true);
  [, body] = await api({ action: 'daily', key, day, moves: moves.map(([t, x]) => [t, x * 2]), ms: ms * 2 });
  assert.equal(body.best, ms, 'a slower time never replaces the best');

  assert.equal((await api({ action: 'daily', key, day, moves: moves.slice(2), ms }))[1].error, 'moves do not solve the scramble');
  assert.equal((await api({ action: 'daily', key, day, moves: moves.map(([t], i) => [t, i]), ms: 1000 }))[1].error, 'faster than humanly possible');
  assert.equal((await api({ action: 'daily', key, day: day - 9, moves, ms }))[0], 400, 'closed days are refused');

  [, body] = await rpc('daily_leaderboard', { p_day: day, p_limit: 100 });
  assert.ok(body.some(r => r.player_id === me && r.ms === ms), 'appears on the board');
  assert.ok(body.every(r => !('key_hash' in r)), 'board never exposes key hashes');

  [status, body] = await api({ action: 'challenge', key, puzzle: 3, scramble: scr, moves, ms });
  assert.equal(status, 200); assert.match(body.id, /^[A-Za-z0-9]{8}$/);
  const [, ch] = await rpc('get_challenge', { p_id: body.id });
  assert.equal(ch[0].ms, ms); assert.equal(ch[0].name, 'e2e-bot');

  const [, rows] = await req('/rest/v1/players?select=*', undefined, 'GET');
  assert.deepEqual(rows, [], 'tables are closed to clients');
  assert.ok((await req('/rest/v1/daily_results', { day, player_id: me, ms: 1, moves: 1 }))[0] >= 400, 'direct inserts fail');
  assert.ok((await rpc('submit_daily', { p_day: day, p_player: me, p_ms: 1000, p_moves: 1 }))[0] >= 400, 'server-only functions are private');
} finally {
  [status, body] = await api({ action: 'forget', key });
  assert.equal(status, 200); assert.equal(body.forgotten, true);
}
const [, after] = await rpc('daily_leaderboard', { p_day: day, p_limit: 100 });
assert.ok(!after.some(r => r.player_id === me), 'forget removes every trace');
console.log('e2e: all good');
