// Challenge links: race a friend's recorded solve on the exact same scramble.
// Online: the server verifies the solve and hands back a short id (…?race=AbC123xy).
// Offline: the whole race is deflated into the link itself (…?raceData=…), so sharing never fails.
import { tokens } from '../state.js';

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export const pack = async obj => b64url(await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')));
export const unpack = async s => JSON.parse(new TextDecoder().decode(await pipe(unb64url(s), new DecompressionStream('deflate-raw'))));

const base = () => `${location.origin}${location.pathname}`;

// recon: { puzzle, scramble, start, moves: [{ tok, t }], ms }
export async function challengeLink(backend, recon) {
  const moves = recon.moves.map(m => [m.tok, m.t]);
  try {
    const { id } = await backend.createChallenge({ puzzle: recon.puzzle, scramble: recon.scramble, moves, ms: recon.ms });
    return `${base()}?race=${id}#time`;
  } catch (e) {
    if (!e.offline) throw e;
    const data = await pack({ p: recon.puzzle, s: recon.scramble, m: moves, t: recon.ms, n: backend.me()?.name ?? '' });
    return `${base()}?raceData=${data}#time`;
  }
}

// -> { puzzle, scramble, start, moves: [{ tok, t }], ms, name } | null
export async function challengeFromUrl(backend, params, startOf) {
  if (params.get('race')) {
    const c = await backend.challenge(params.get('race'));
    if (!c) throw new Error('That challenge link has expired or never existed.');
    return { puzzle: c.puzzle, scramble: c.scramble, start: c.start, moves: c.moves.map(([tok, t]) => ({ tok, t })), ms: c.ms, name: c.name };
  }
  if (params.get('raceData')) {
    const d = await unpack(params.get('raceData'));
    if (![2, 3, 4].includes(d.p) || !tokens(d.s).length) throw new Error('That challenge link is damaged.');
    return { puzzle: d.p, scramble: d.s, start: startOf(d.p, d.s), moves: d.m.map(([tok, t]) => ({ tok, t })), ms: d.t, name: d.n || 'A friend' };
  }
  return null;
}
