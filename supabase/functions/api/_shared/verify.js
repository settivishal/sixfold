// Server-side truth for submitted solves: replay the moves on the scramble and check the physics.
import { CubeState, solvedFacelets, parseMove } from './state.js';

export const LIMITS = { maxTps: 20, minMs: 1000, maxMs: 3_600_000, maxMoves: 2000, maxScramble: 1000 };

/**
 * @param {{ puzzle: number, scramble: string, moves: [string, number][], ms: number }} s
 *   moves: every turn with the clock reading (ms) when it was made; rotations allowed.
 * @returns {{ ok: true, start: string, turns: number } | { ok: false, error: string }}
 */
export function verifySolve({ puzzle, scramble, moves, ms }) {
  const fail = error => ({ ok: false, error });
  if (![2, 3, 4].includes(puzzle)) return fail('unknown puzzle');
  if (typeof scramble !== 'string' || !scramble.trim() || scramble.length > LIMITS.maxScramble) return fail('bad scramble');
  if (!Array.isArray(moves) || !moves.length || moves.length > LIMITS.maxMoves) return fail('bad move list');
  if (!Number.isInteger(ms) || ms < LIMITS.minMs || ms > LIMITS.maxMs) return fail('time out of range');
  let st;
  try { st = new CubeState(solvedFacelets(puzzle)).move(scramble); } catch { return fail('bad scramble'); }
  if (st.isSolved()) return fail('scramble is already solved');
  const start = st.facelets();
  let prev = 0, turns = 0;
  for (const m of moves) {
    if (!Array.isArray(m) || m.length !== 2) return fail('bad move');
    const [tok, t] = m;
    if (typeof tok !== 'string' || !parseMove(tok, puzzle)) return fail(`bad move "${String(tok).slice(0, 8)}"`);
    if (!Number.isFinite(t) || t < prev || t > ms + 50) return fail('timestamps out of order');
    prev = t;
    st.move(tok);
    if (!/^[xyz]/.test(tok)) turns++;
  }
  if (!st.isSolved()) return fail('moves do not solve the scramble');
  if (turns / (ms / 1000) > LIMITS.maxTps) return fail('faster than humanly possible');
  return { ok: true, start, turns };
}
