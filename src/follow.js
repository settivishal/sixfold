// Follow-along coach: decides what a move you make yourself means for the solution you're following.
import { invertMove } from './state.js';

/**
 * @param {{ next: string|undefined, prev: string|undefined, half: string|null, detour: string[] }} c  coach state
 * @param {string} tok  the move just made
 * @returns {'advance' | 'rewind' | 'half' | 'undo-half' | 'back' | 'detour'} and mutates `c` accordingly:
 *   advance   – the move was the next step (a half turn may arrive as two quarter turns)
 *   rewind    – the previous step was undone; the lesson steps back with you
 *   half      – first quarter of a half turn; the ring stays on the same layer
 *   undo-half – that first quarter was taken back
 *   back      – a detour move was undone; you're heading back on track
 *   detour    – off the path; the ring now shows how to undo it
 */
export function follow(c, tok) {
  if (c.detour.length) {
    if (tok === invertMove(c.detour.at(-1))) { c.detour.pop(); return 'back'; }
    c.detour.push(tok);
    return 'detour';
  }
  const next = c.next ?? '';
  if (c.half) {
    if (tok === c.half) { c.half = null; return 'advance'; }
    if (tok === invertMove(c.half)) { c.half = null; return 'undo-half'; }
    c.detour.push(tok);
    return 'detour';
  }
  if (tok === next || (next.endsWith('2') && tok === next + "'")) return 'advance';
  if (c.prev && tok === invertMove(c.prev)) return 'rewind';
  if (next.endsWith('2') && (tok === next.slice(0, -1) || tok === next.slice(0, -1) + "'")) { c.half = tok; return 'half'; }
  c.detour.push(tok);
  return 'detour';
}

// Which move the hint ring should show for the coach state.
export const coachHint = c => (c.detour.length ? invertMove(c.detour.at(-1)) : c.half ?? c.next ?? null);
