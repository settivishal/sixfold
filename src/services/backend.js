// Client for the Sixfold back end: reads go to read-only RPCs, writes to the verified `api` function.
// Every call has a timeout and fails with a typed error, so features can degrade gracefully offline.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // 0 = network / offline
  }
  get offline() { return this.status === 0; }
}

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function post(path, body) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SUPABASE_URL + path, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || data.message || `request failed (${res.status})`, res.status);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('You look offline — try again when you’re connected.', 0);
  } finally {
    clearTimeout(timer);
  }
}

export function createBackend(store) {
  // Guest identity: a random 256-bit key that never leaves this device except to prove who you are.
  function key() {
    let k = store.get('playerKey');
    if (!/^[A-Za-z0-9_-]{43}$/.test(k ?? '')) {
      k = base64url(crypto.getRandomValues(new Uint8Array(32)));
      store.set('playerKey', k);
    }
    return k;
  }
  const call = (action, extra = {}) => post('/functions/v1/api', { action, key: key(), ...extra });
  const rpc = (fn, args) => post(`/rest/v1/rpc/${fn}`, args);

  return {
    async hello(name) {
      const me = await call('hello', name === undefined ? {} : { name });
      store.set('player', me);
      return me;
    },
    me: () => store.get('player', null),
    submitDaily: (day, moves, ms) => call('daily', { day, moves, ms }),
    createChallenge: ({ puzzle, scramble, moves, ms }) => call('challenge', { puzzle, scramble, moves, ms }),
    async forget() {
      await call('forget');
      store.remove('player');
      store.remove('playerKey');
    },
    leaderboard: (day, limit = 10) => rpc('daily_leaderboard', { p_day: day, p_limit: limit }),
    rank: (day, player) => rpc('daily_rank', { p_day: day, p_player: player }).then(r => r[0] ?? null),
    challenge: id => rpc('get_challenge', { p_id: id }).then(r => r[0] ?? null),
  };
}
