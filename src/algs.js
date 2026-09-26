// Last-layer algorithm sets for the trainer, plus top-view case diagrams.
// Cases are shown yellow-up (z2 from the default white-up, green-front hold).
import { CubeState, invert, tokens } from './state.js';

export const SETS = {
  pll: {
    name: 'PLL',
    blurb: 'Permute the last layer: 21 cases that finish the solve.',
    goal: 'solved',
    cases: [
      ['Aa', "x R' U R' D2 R U' R' D2 R2 x'"],
      ['Ab', "x R2 D2 R U R' D2 R U' R x'"],
      ['E', "x' R U' R' D R U R' D' R U R' D R U' R' D' x"],
      ['F', "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R"],
      ['Ga', "R2 U R' U R' U' R U' R2 U' D R' U R D'"],
      ['Gb', "R' U' R U D' R2 U R' U R U' R U' R2 D"],
      ['Gc', "R2 U' R U' R U R' U R2 U D' R U' R' D"],
      ['Gd', "R U R' U' D R2 U' R U' R' U R' U R2 D'"],
      ['H', 'M2 U M2 U2 M2 U M2'],
      ['Ja', "x R2 F R F' R U2 r' U r U2 x'"],
      ['Jb', "R U R' F' R U R' U' R' F R2 U' R'"],
      ['Na', "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'"],
      ['Nb', "R' U R U' R' F' U' F R U R' F R' F' R U' R"],
      ['Ra', "R U' R' U' R U R D R' U' R D' R' U2 R'"],
      ['Rb', "R2 F R U R U' R' F' R U2 R' U2 R"],
      ['T', "R U R' U' R' F R2 U' R' U' R U R' F'"],
      ['Ua', "M2 U M U2 M' U M2"],
      ['Ub', "M2 U' M U2 M' U' M2"],
      ['V', "R' U R' U' y R' F' R2 U' R' U R' F R F y'"],
      ['Y', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
      ['Z', "M' U M2 U M2 U M' U2 M2"],
    ],
  },
  oll: {
    name: '2-look OLL',
    blurb: 'Orient the last layer in two steps: 3 edge cases, then 7 corner cases.',
    goal: 'oll',
    cases: [
      ['Dot', "F R U R' U' F' f R U R' U' f'", 'edges'],
      ['L-shape', "f R U R' U' f'", 'edges'],
      ['Line', "F R U R' U' F'", 'edges'],
      ['Sune', "R U R' U R U2 R'"],
      ['Antisune', "R U2 R' U' R U' R'"],
      ['H', "R U R' U R U' R' U R U2 R'"],
      ['Pi', "R U2 R2 U' R2 U' R2 U2 R"],
      ['Headlights', "R2 D R' U2 R D' R' U2 R'"],
      ['Chameleon', "r U R' U' r' F R F'"],
      ['Bowtie', "F' r U R' U' r' F R"],
    ],
  },
};

// Case state: yellow up, then the inverse algorithm, then an optional AUF.
export const caseState = (alg, auf = '') => new CubeState().move(`z2 ${invert(alg)} ${auf}`);

// Is this case finished? PLL: solved. OLL: yellow top (edge cases: just the yellow cross).
export function reached(set, st, kind) {
  const f = st.facelets();
  if (set === 'pll') return st.isSolved();
  return (kind === 'edges' ? [1, 3, 5, 7] : [0, 1, 2, 3, 5, 6, 7, 8]).every(i => f[i] === f[4]);
}

const LABELS = Array.from({ length: 54 }, (_, i) => String.fromCharCode(48 + i)).join('');

// PLL arrows: where each top-layer piece has to travel.
function arrows(alg) {
  const st = new CubeState(LABELS).move(invert(alg));
  // undo any net whole-cube rotation so labels line up with positions again
  for (const r of ['', 'y', 'y2', "y'", 'x2', 'x', "x'", 'z', "z'"]) {
    const t = st.clone().move(r).facelets();
    if ([4, 13, 22, 31, 40, 49].every(i => t.charCodeAt(i) - 48 === i)) {
      return [...t.slice(0, 9)].map((c, i) => [i, c.charCodeAt(0) - 48]).filter(([i, h]) => i !== 4 && i !== h && h < 9);
    }
  }
  return [];
}

// Top view: U face plus the top row of each side, as an SVG string. `mode` 'oll' greys non-yellow.
const CELL = { 0: [0, 0], 1: [1, 0], 2: [2, 0], 3: [0, 1], 5: [2, 1], 6: [0, 2], 7: [1, 2], 8: [2, 2], 4: [1, 1] };
export function diagram(alg, mode) {
  const f = caseState(alg).facelets();
  const col = c => (mode === 'oll' ? (c === f[4] ? 'var(--cD)' : 'var(--grey)') : `var(--c${c})`);
  const s = 20, g = 2, o = 14;
  let out = '';
  for (let i = 0; i < 9; i++) {
    const [x, y] = CELL[i];
    out += `<rect x="${o + x * s + g}" y="${o + y * s + g}" width="${s - 2 * g}" height="${s - 2 * g}" rx="3" style="fill:${col(f[i])}"/>`;
  }
  const strip = (idx, place) => idx.forEach((i, k) => {
    const [x, y, w, h] = place(k);
    out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" style="fill:${col(f[i])}"/>`;
  });
  strip([47, 46, 45], k => [o + k * s + g, 3, s - 2 * g, 8]); // B top row, seen from above
  strip([18, 19, 20], k => [o + k * s + g, o + 3 * s + 3, s - 2 * g, 8]); // F
  strip([36, 37, 38], k => [3, o + k * s + g, 8, s - 2 * g]); // L
  strip([11, 10, 9], k => [o + 3 * s + 3, o + k * s + g, 8, s - 2 * g]); // R
  if (mode !== 'oll') {
    for (const [from, to] of arrows(alg)) {
      const c = i => CELL[i].map(v => o + v * s + s / 2);
      const [x1, y1] = c(from), [x2, y2] = c(to), d = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / d, uy = (y2 - y1) / d;
      out += `<line x1="${x1 + ux * 5}" y1="${y1 + uy * 5}" x2="${x2 - ux * 7}" y2="${y2 - uy * 7}" class="arrow"/>`;
    }
  }
  return `<svg viewBox="0 0 ${2 * o + 3 * s} ${2 * o + 3 * s}" aria-hidden="true">
    <defs><marker id="ah" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L6 3L0 6z" fill="#0c0a16"/></marker></defs>
    <rect x="${o}" y="${o}" width="${3 * s}" height="${3 * s}" rx="5" fill="#0c0c13"/>${out}</svg>`;
}

export const moveCount = alg => tokens(alg).filter(t => !/^[xyz]/.test(t)).length;
