// Sticker-level cube model for any N×N×N. Axes: x→R, y→U, z→F. Coordinates run from -h to h
// (h = (N-1)/2, so a 4×4 uses ±0.5 and ±1.5 — exact in binary floating point). Every sticker has a
// cubie position and an outward normal, so any move (faces, slices, wide, rotations) is just
// "rotate the stickers in these layers". Facelet strings use Kociemba order URFDLB, N² per face.
export const FACES = 'URFDLB';
export const solvedFacelets = (n = 3) => [...FACES].map(f => f.repeat(n * n)).join('');
export const SOLVED = solvedFacelets(3);
export const COLOR_NAMES = { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
export const sizeOf = facelets => Math.round(Math.sqrt(facelets.length / 6));

const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
// +90° about each axis
const ROT = [([x, y, z]) => [x, -z, y], ([x, y, z]) => [z, y, -x], ([x, y, z]) => [-y, x, z]];
// face letter -> [axis, sign of a clockwise quarter turn about +axis, which side]
const FACE_AXIS = { U: [1, -1, 1], D: [1, 1, -1], R: [0, -1, 1], L: [0, 1, -1], F: [2, -1, 1], B: [2, 1, -1] };
const SLICE = { M: ['L', 0], E: ['D', 1], S: ['F', 2] };

const GEOMETRY = {};
function geometry(n) {
  if (GEOMETRY[n]) return GEOMETRY[n];
  const h = (n - 1) / 2;
  const POS = {
    U: (r, c) => [c - h, h, r - h],
    R: (r, c) => [h, h - r, h - c],
    F: (r, c) => [c - h, h - r, h],
    D: (r, c) => [c - h, -h, h - r],
    L: (r, c) => [-h, h - r, c - h],
    B: (r, c) => [h - c, h - r, -h],
  };
  const INDEX = {}; // "U-1,1,-1" -> facelet index
  const per = n * n;
  for (let i = 0; i < 6 * per; i++) {
    const f = FACES[(i / per) | 0], k = i % per;
    INDEX[f + POS[f]((k / n) | 0, k % n)] = i;
  }
  const all = Array.from({ length: n }, (_, i) => i - h);
  return (GEOMETRY[n] = { n, h, POS, INDEX, all, per });
}
const faceOf = n => [...FACES].find(f => NORMAL[f].every((v, i) => v === n[i]));
export const faceletIndex = (n, normal, p) => geometry(n).INDEX[faceOf(normal) + p];

// "R", "R'", "R2", "Rw", "r", "2R" (inner slice), "3Rw", "M", "x2" -> { axis, layers, turns }
export function parseMove(tok, n = 3) {
  const m = /^(\d?)([URFDLBMESxyzurfdlb])(w?)(2?)('?)$/.exec(tok);
  if (!m) return null;
  const { h, all } = geometry(n);
  const [, pre, letter, w, dbl, prime] = m;
  let axis, sign, layers;
  if ('xyz'.includes(letter)) {
    if (pre || w) return null;
    [axis, sign, layers] = ['xyz'.indexOf(letter), -1, all];
  } else if (SLICE[letter]) {
    if (pre || w) return null;
    const [face] = SLICE[letter];
    [axis, sign] = FACE_AXIS[face]; // M follows L, E follows D, S follows F
    layers = all.filter(v => Math.abs(v) < h);
  } else {
    const face = letter.toUpperCase(), wide = !!w || letter !== face;
    const [ax, s, side] = FACE_AXIS[face];
    const k = +(pre || (wide ? 2 : 1));
    if (k < 1 || k > n) return null;
    [axis, sign] = [ax, s];
    const depth = i => side * (h - i); // coordinate of the i-th layer from this face (0 = outer)
    layers = wide ? Array.from({ length: k }, (_, i) => depth(i)) : [depth(k - 1)];
  }
  if (!layers.length) return null;
  return { axis, layers, turns: dbl ? 2 * sign : prime ? -sign : sign };
}

export const tokens = seq => seq.trim().split(/\s+/).filter(Boolean);
export const invertMove = t => (t.endsWith("'") ? t.slice(0, -1) : t.endsWith('2') ? t : t + "'");
export const invert = seq => tokens(seq).reverse().map(invertMove).join(' ');

// Single-layer quarter turn about +axis through coordinate `layer`, `sign` = ±1 -> notation.
export function moveName(axis, layer, sign, n = 3) {
  const { h } = geometry(n);
  const pos = ['R', 'U', 'F'][axis], neg = ['L', 'D', 'B'][axis];
  let name, s;
  if (n === 3 && layer === 0) {
    name = ['M', 'E', 'S'][axis];
    s = name === 'S' ? -1 : 1;
  } else if (layer > 0) {
    name = (layer === h ? '' : h - layer + 1) + pos;
    s = -1;
  } else {
    name = (layer === -h ? '' : h + layer + 1) + neg;
    s = 1;
  }
  return s === sign ? name : name + "'";
}

export class CubeState {
  constructor(facelets = SOLVED) { this.set(facelets); }

  set(facelets) {
    const g = geometry(sizeOf(facelets));
    this.size = g.n;
    this.stickers = [...facelets].map((c, i) => {
      const f = FACES[(i / g.per) | 0], k = i % g.per;
      return { p: g.POS[f]((k / g.n) | 0, k % g.n), n: NORMAL[f], c };
    });
    return this;
  }

  move(seq) {
    for (const tok of tokens(seq)) {
      const mv = parseMove(tok, this.size);
      if (!mv) throw new Error(`Unknown move "${tok}"`);
      const rot = ROT[mv.axis], q = ((mv.turns % 4) + 4) % 4;
      for (const s of this.stickers) {
        if (!mv.layers.includes(s.p[mv.axis])) continue;
        for (let i = 0; i < q; i++) { s.p = rot(s.p); s.n = rot(s.n); }
      }
    }
    return this;
  }

  // Raw colours in facelet order (colour letters = the face each colour belongs to when solved).
  facelets() {
    const { INDEX, per } = geometry(this.size), out = Array(6 * per);
    for (const s of this.stickers) out[INDEX[faceOf(s.n) + s.p]] = s.c;
    return out.join('');
  }

  // Colours renamed after the face their centre currently sits on — what a 3×3 solver wants.
  solverString() { return relabel(this.facelets()); }

  isSolved() {
    const f = this.facelets(), per = this.size ** 2;
    return [...FACES].every((_, i) => { const s = f.slice(i * per, (i + 1) * per); return s === s[0].repeat(per); });
  }

  clone() { return new CubeState(this.facelets()); }
}

export function relabel(f) {
  const map = {};
  for (let i = 0; i < 6; i++) map[f[i * 9 + 4]] = FACES[i];
  return [...f].map(c => map[c] ?? '?').join('');
}

// Facelet indices of a corner / edge on an N-cube, derived from its name (e.g. 'URF').
export const cubieFacelets = (name, n = 3) => {
  const { h, INDEX } = geometry(n), p = [0, 0, 0];
  for (const f of name) NORMAL[f].forEach((v, i) => (p[i] += v * h));
  return [...name].map(f => INDEX[f + p]);
};
export const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
export const CORNERS = CORNER_NAMES.map(c => cubieFacelets(c)), EDGES = EDGE_NAMES.map(e => cubieFacelets(e));
const parity = p => { let s = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) s += p[i] > p[j]; return s % 2; };

// Corner permutation + orientation of any cube (Kociemba conventions; colours must be home-face letters).
export function cornerState(f, n) {
  const cp = [], co = [];
  for (const idx of CORNER_NAMES.map(c => cubieFacelets(c, n))) {
    const o = idx.findIndex(k => f[k] === 'U' || f[k] === 'D');
    const a = f[idx[(o + 1) % 3]], b = f[idx[(o + 2) % 3]];
    cp.push(o < 0 ? -1 : CORNER_NAMES.findIndex(c => c[1] === a && c[2] === b));
    co.push(o);
  }
  return { cp, co };
}

// 2×2 has no centres: rename colours so the DBL corner is home (a whole-cube rotation). null if impossible.
const OPP = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };
export function orient2(f) {
  const [d, b, l] = cubieFacelets('DBL', 2).map(i => f[i]);
  const map = { [d]: 'D', [OPP[d]]: 'U', [b]: 'B', [OPP[b]]: 'F', [l]: 'L', [OPP[l]]: 'R' };
  if (Object.keys(map).length !== 6) return null;
  return [...f].map(c => map[c]).join('');
}

// Returns '' when the raw facelets describe a solvable cube, otherwise a human explanation.
export function problem(raw) {
  const n = sizeOf(raw), per = n * n;
  const missing = raw.split('?').length - 1;
  if (missing) return `${missing} sticker${missing > 1 ? 's' : ''} still unpainted.`;
  for (const c of FACES) {
    const k = raw.split(c).length - 1;
    if (k !== per) return `There are ${k} ${COLOR_NAMES[c]} stickers — every colour needs exactly ${per}.`;
  }
  if (n === 2) {
    const g = orient2(raw);
    if (!g) return 'Some corner has an impossible colour combination.';
    const { cp, co } = cornerState(g, 2);
    if (cp.includes(-1) || new Set(cp).size < 8) return 'Some corner has an impossible colour combination.';
    if (co.reduce((a, b) => a + b) % 3) return 'One corner is twisted — no real cube can be in this state.';
    return '';
  }
  if (n !== 3) return '';
  const centers = [0, 1, 2, 3, 4, 5].map(i => raw[i * 9 + 4]);
  if (new Set(centers).size < 6) return 'All six centres must be different colours.';
  const f = relabel(raw);
  const { cp, co } = cornerState(f, 3), ep = [], eo = [];
  for (const [i, j] of EDGES) {
    const k = EDGE_NAMES.indexOf(f[i] + f[j]);
    ep.push(k >= 0 ? k : EDGE_NAMES.indexOf(f[j] + f[i]));
    eo.push(k >= 0 ? 0 : 1);
  }
  if (cp.includes(-1) || new Set(cp).size < 8) return 'Some corner has an impossible colour combination.';
  if (ep.includes(-1) || new Set(ep).size < 12) return 'Some edge has an impossible colour combination.';
  if (co.reduce((a, b) => a + b) % 3) return 'One corner is twisted — no real cube can be in this state.';
  if (eo.reduce((a, b) => a + b) % 2) return 'One edge is flipped — no real cube can be in this state.';
  if (parity(cp) !== parity(ep)) return 'Two pieces are swapped — no real cube can be in this state.';
  return '';
}
