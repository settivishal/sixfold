// Optimal 2×2 solver. With the DBL corner held still, every 2×2 state is one of
// 5040 permutations × 729 twists = 3,674,160. A breadth-first pass fills a distance table
// for all of them once (~0.5s); after that, walking downhill gives a shortest solution instantly.
import { cornerState, orient2 } from './state.js';

const CP = { U: [3, 0, 1, 2, 4, 5, 6, 7], R: [4, 1, 2, 0, 7, 5, 6, 3], F: [1, 5, 2, 3, 0, 4, 6, 7] };
const CO = { U: [0, 0, 0, 0, 0, 0, 0, 0], R: [2, 0, 0, 1, 1, 0, 0, 2], F: [1, 2, 0, 0, 2, 1, 0, 0] };
const FREE = [0, 1, 2, 3, 4, 5, 7]; // every position except DBL (6)
const N_CP = 5040, N_CO = 729;
export const MOVES = ['U', 'U2', "U'", 'R', 'R2', "R'", 'F', 'F2', "F'"];

// state after applying move b to state a (Kociemba cubie multiplication)
const mul = (a, b) => ({ cp: b.cp.map(i => a.cp[i]), co: b.cp.map((i, k) => (a.co[i] + b.co[k]) % 3) });
const power = (m, k) => { let s = { cp: CP[m], co: CO[m] }; for (let i = 1; i < k; i++) s = mul(s, { cp: CP[m], co: CO[m] }); return s; };
const MOVE_CUBES = MOVES.map(t => power(t[0], t[1] === '2' ? 2 : t[1] === "'" ? 3 : 1));

function rankPerm(p) { // p: the 7 free pieces as indices 0..6
  let r = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++) if (p[j] < p[i]) smaller++;
    r = r * (7 - i) + smaller;
  }
  return r;
}
function unrankPerm(r) {
  const digits = [];
  for (let i = 6; i >= 0; i--) { digits.unshift(r % (7 - i)); r = Math.floor(r / (7 - i)); }
  const pool = [0, 1, 2, 3, 4, 5, 6];
  return digits.map(d => pool.splice(d, 1)[0]);
}
const encode = ({ cp, co }) => rankPerm(FREE.map(p => FREE.indexOf(cp[p]))) * N_CO + co.slice(0, 6).reduce((a, v) => a * 3 + v, 0);
function decode(i) {
  const perm = unrankPerm(Math.floor(i / N_CO)), cp = Array(8), co = Array(8).fill(0);
  FREE.forEach((p, k) => (cp[p] = FREE[perm[k]]));
  cp[6] = 6;
  for (let c = i % N_CO, k = 5; k >= 0; k--) { co[k] = c % 3; c = Math.floor(c / 3); }
  co[7] = (3 - (co.reduce((a, b) => a + b) % 3)) % 3;
  return { cp, co };
}

let table = null, cpT = null, coT = null;
function build() {
  if (table) return;
  // permutation and twist move independently, so tabulate them separately
  cpT = MOVE_CUBES.map(mc => Int16Array.from({ length: N_CP }, (_, r) => Math.floor(encode(mul(decode(r * N_CO), mc)) / N_CO)));
  coT = MOVE_CUBES.map(mc => Int16Array.from({ length: N_CO }, (_, c) => encode(mul(decode(c), mc)) % N_CO));
  table = new Uint8Array(N_CP * N_CO).fill(255);
  let frontier = [encode({ cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] })];
  table[frontier[0]] = 0;
  for (let d = 0; frontier.length; d++) {
    const next = [];
    for (const s of frontier) {
      const p = Math.floor(s / N_CO), o = s % N_CO;
      for (let m = 0; m < 9; m++) {
        const t = cpT[m][p] * N_CO + coT[m][o];
        if (table[t] === 255) { table[t] = d + 1; next.push(t); }
      }
    }
    frontier = next;
  }
}

const step = (s, m) => cpT[m][Math.floor(s / N_CO)] * N_CO + coT[m][s % N_CO];
function walk(s) {
  const out = [];
  while (table[s]) {
    const m = MOVES.findIndex((_, k) => table[step(s, k)] === table[s] - 1);
    out.push(MOVES[m]);
    s = step(s, m);
  }
  return out;
}

// raw 2×2 facelets -> shortest solution (≤ 11 moves) using only U, R, F
export function solve2(raw) {
  build();
  const g = orient2(raw);
  if (!g) throw new Error('Impossible colour combination');
  const cs = cornerState(g, 2);
  if (cs.cp.includes(-1) || new Set(cs.cp).size < 8 || cs.co.reduce((a, b) => a + b) % 3) throw new Error('This 2×2 cannot be solved');
  return walk(encode(cs)).join(' ');
}

// Random-state scramble, the way WCA scramblers do it: pick any state, print its solution backwards.
export function scramble2(random = Math.random) {
  build();
  let s;
  do s = Math.floor(random() * N_CP) * N_CO + Math.floor(random() * N_CO); while (table[s] < 4);
  return walk(s).reverse().map(t => (t.endsWith("'") ? t[0] : t.endsWith('2') ? t : t + "'")).join(' ');
}

export { mul as _mul, encode as _encode, decode as _decode };
