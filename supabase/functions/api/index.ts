// Sixfold API — the only write path into the database.
// Every request carries the device's guest key; solves are replayed with the shared cube model
// before anything is stored.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifySolve } from './_shared/verify.js';
import { dailyScramble, dayNumber } from './_shared/daily.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BODY = 100_000;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Guest identity: a random 256-bit key held by the device; we only ever see its hash.
async function player(key: unknown) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new HttpError(401, 'missing or malformed player key');
  const { data, error } = await db.rpc('ensure_player', { p_key_hash: await sha256(key) }).single();
  if (error) throw error;
  return data as { id: string; name: string | null };
}

async function limit(playerId: string, kind: string, max: number) {
  const { data, error } = await db.rpc('rate_hit', { p_player: playerId, p_kind: kind, p_max: max, p_window: '1 hour' });
  if (error) throw error;
  if (!data) throw new HttpError(429, 'slow down — try again later');
}

function cleanName(raw: unknown) {
  const name = String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (name.length > 24 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new HttpError(400, 'names are 1–24 visible characters');
  return name;
}

const moveList = (moves: unknown) => (Array.isArray(moves) ? moves : []).map(m => (Array.isArray(m) ? m : [m?.tok, m?.t]));

function randomId(length = 8) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789ABCDEFGH'; // 64 symbols, no look-alikes
  return [...crypto.getRandomValues(new Uint8Array(length))].map(b => abc[b & 63]).join('');
}

async function handle(body: Record<string, unknown>) {
  const me = await player(body.key);
  switch (body.action) {
    case 'hello': {
      let name = me.name;
      if ('name' in body) {
        await limit(me.id, 'rename', 20);
        name = cleanName(body.name);
        const { error } = await db.from('players').update({ name }).eq('id', me.id);
        if (error) throw error;
      }
      return { player: me.id, name };
    }
    case 'daily': {
      const today = dayNumber(), day = Number(body.day);
      if (day !== today && day !== today - 1) throw new HttpError(400, 'that daily challenge has closed');
      // the scramble comes from the day number, never from the client
      const v = verifySolve({ puzzle: 3, scramble: dailyScramble(day), moves: moveList(body.moves), ms: body.ms as number });
      if (!v.ok) throw new HttpError(422, v.error);
      await limit(me.id, 'daily', 60);
      const { data, error } = await db.rpc('submit_daily', { p_day: day, p_player: me.id, p_ms: body.ms, p_moves: v.turns }).single();
      if (error) throw error;
      const { data: rank } = await db.rpc('daily_rank', { p_day: day, p_player: me.id }).single();
      return { ...(data as object), rank };
    }
    case 'challenge': {
      const puzzle = Number(body.puzzle), moves = moveList(body.moves);
      const v = verifySolve({ puzzle, scramble: body.scramble as string, moves, ms: body.ms as number });
      if (!v.ok) throw new HttpError(422, v.error);
      await limit(me.id, 'challenge', 30);
      for (let attempt = 0; attempt < 3; attempt++) {
        const id = randomId();
        const { error } = await db.from('challenges').insert({
          id, player_id: me.id, puzzle, scramble: body.scramble, start: v.start, moves, ms: body.ms,
        });
        if (!error) return { id };
        if (error.code !== '23505') throw error; // anything but an id collision is a real failure
      }
      throw new Error('could not allocate a challenge id');
    }
    case 'forget': {
      // everything tied to this key (daily results, challenges, rate events) cascades away
      const { error } = await db.from('players').delete().eq('id', me.id);
      if (error) throw error;
      return { forgotten: true };
    }
    default:
      throw new HttpError(400, 'unknown action');
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new HttpError(413, 'request too large');
    let body;
    try { body = JSON.parse(text); } catch { throw new HttpError(400, 'invalid JSON'); }
    if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid body');
    return json(await handle(body));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'server error' }, 500);
  }
});
