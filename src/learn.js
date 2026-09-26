// A beginner (layer-by-layer) solver that thinks like a person: an optimal white cross,
// then short searches over the handful of algorithms a beginner actually knows.
// Pure logic — runs in the worker and in node tests.
import { CubeState, FACES, CORNERS, EDGES, tokens } from './state.js';

const LABELS = Array.from({ length: 54 }, (_, i) => String.fromCharCode(48 + i)).join('');
// perm[j] = i means: after `seq`, position j holds what was at position i
export function perm(seq) {
  return Uint8Array.from(new CubeState(LABELS).move(seq).facelets(), c => c.charCodeAt(0) - 48);
}
const apply = (a, p) => { const o = new Uint8Array(54); for (let j = 0; j < 54; j++) o[j] = a[p[j]]; return o; };
const center = i => ((i / 9) | 0) * 9 + 4;
const ok = (a, i) => a[i] === a[center(i)];
const allOk = (a, idx) => idx.every(i => ok(a, i));
const count = (a, pieces) => pieces.filter(p => allOk(a, p)).length;

// Pieces by facelet index (frame: white centre on D)
const U_CORNERS = CORNERS.slice(0, 4), D_CORNERS = CORNERS.slice(4);
const U_EDGES = EDGES.slice(0, 4), D_EDGES = EDGES.slice(4, 8), MID_EDGES = EDGES.slice(8);
const cross = a => count(a, D_EDGES) === 4;
const firstLayer = a => cross(a) && count(a, D_CORNERS) === 4;
const twoLayers = a => firstLayer(a) && count(a, MID_EDGES) === 4;
const yellowCross = a => twoLayers(a) && U_EDGES.every(([u]) => ok(a, u));
const yellowEdges = a => twoLayers(a) && count(a, U_EDGES) === 4;
const cornerPlaced = (a, idx) => idx.map(i => a[i]).sort().join() === idx.map(i => a[center(i)]).sort().join();
const cornersPlaced = a => yellowEdges(a) && U_CORNERS.every(c => cornerPlaced(a, c));
const solved = a => a.every((_, i) => ok(a, i));

export const STAGES = [
  { key: 'orient', title: 'Hold white down', text: 'Turn the whole cube so the white centre faces the floor. Centres never move relative to each other, so they tell you where every colour belongs.' },
  { key: 'cross', title: 'The white cross', alg: '', text: 'Bring the four white edges down around the white centre, each one matching the centre on its side. No formula here: plan a move or two ahead.' },
  { key: 'corners', title: 'First-layer corners', alg: "R U R' U'", text: 'Line a white corner up above its slot, hold that slot at front-right, then repeat R U R′ U′ until the corner drops in with white facing down.' },
  { key: 'middle', title: 'The middle layer', alg: "U R U' R' U' F' U F", text: 'Find a top edge with no yellow, match it with its centre, then send it right (U R U′ R′ U′ F′ U F) or left (U′ L′ U L U F U′ F′).' },
  { key: 'ycross', title: 'The yellow cross', alg: "F R U R' U' F'", text: 'F R U R′ U′ F′ turns a yellow dot into an L, an L held at back-left into a line, and a horizontal line into a cross.' },
  { key: 'yedges', title: 'Match the yellow edges', alg: "R U R' U R U2 R'", text: 'Spin the top until two edges match their centres, hold them at back and right, then R U R′ U R U2 R′.' },
  { key: 'ycorners', title: 'Place the yellow corners', alg: "U R U' L' U R' U' L", text: 'Find a corner that already sits in its spot (any twist), hold it at front-right, and repeat U R U′ L′ U R′ U′ L until all four are home.' },
  { key: 'twist', title: 'Twist the last corners', alg: "R' D' R D", text: 'Keep the cube still. With an unsolved corner at front-right, repeat R′ D′ R D until yellow faces up, then turn only U to bring the next one. The cube looks broken halfway through — trust it.' },
];

// Which pieces matter in a stage (by colour set; 'U' = white, 'D' = yellow) — used to dim the rest.
export function stageFocus(key) {
  return {
    orient: () => true,
    cross: c => c.length === 2 && c.includes('U'),
    corners: c => c.includes('U'),
    middle: c => c.includes('U') || (c.length === 2 && !c.includes('D')),
  }[key] ?? (() => true);
}

let MOVES;
function moves() {
  if (MOVES) return MOVES;
  const m = (label, seq, group) => ({ label, seq, group, p: perm(seq) });
  const turns = (f, group = f) => ['', "'", '2'].map(s => m(f + s, f + s, group));
  const sexy = [1, 2, 3, 4, 5].map(k => m(k > 1 ? `(R U R' U') ×${k}` : "R U R' U'", Array(k).fill("R U R' U'").join(' '), 'S'));
  MOVES = {
    face: [...FACES].flatMap(f => turns(f)),
    U: turns('U'),
    y: turns('y'),
    sexy,
    right: m('Right insert', "U R U' R' U' F' U F", null),
    left: m('Left insert', "U' L' U L U F U' F'", null),
    fruruf: m("F R U R' U' F'", "F R U R' U' F'", null),
    sune: m("R U R' U R U2 R'", "R U R' U R U2 R'", null),
    niklas: m("U R U' L' U R' U' L", "U R U' L' U R' U' L", null),
    twist: [2, 4].map(k => m(`(R' D' R D) ×${k}`, Array(k).fill("R' D' R D").join(' '), 'T')),
  };
  return MOVES;
}

// Iterative deepening over a small move set; consecutive moves from one group are pruned.
function search(a, set, goal, maxDepth = 9) {
  const path = [];
  const dfs = (s, d, last) => {
    if (d === 0) return goal(s);
    for (const mv of set) {
      if (mv.group && mv.group === last) continue;
      path.push(mv);
      if (dfs(apply(s, mv.p), d - 1, mv.group)) return true;
      path.pop();
    }
    return false;
  };
  for (let d = 0; d <= maxDepth; d++) if (dfs(a, d, null)) return path.slice();
  throw new Error('No solution found — is this a valid cube?');
}

// Optimal cross by IDA*, heuristic = worst single-edge distance.
function solveCross(a) {
  const { face } = moves();
  const where = {}; // facelet -> edge code (edge*2 + which sticker)
  EDGES.forEach(([p0, p1], e) => { where[p0] = e * 2; where[p1] = e * 2 + 1; });
  const table = face.map(mv => {
    const inv = new Uint8Array(54);
    mv.p.forEach((src, dst) => (inv[src] = dst));
    return Array.from({ length: 24 }, (_, code) => where[inv[EDGES[code >> 1][code & 1]]]);
  });
  const W = a[31];
  const pieces = D_EDGES.map(([, side]) => {
    const X = a[center(side)];
    const home = EDGES.findIndex(e => e[0] === D_EDGES.find(([, s]) => a[center(s)] === X)[0]) * 2;
    let code = -1;
    EDGES.forEach(([p0, p1], e) => {
      if (a[p0] === W && a[p1] === X) code = e * 2;
      if (a[p1] === W && a[p0] === X) code = e * 2 + 1;
    });
    const dist = new Int8Array(24).fill(-1);
    dist[home] = 0;
    for (let q = [home], d = 0; q.length; d++) {
      const next = [];
      for (const c of q) for (const t of table) if (dist[t[c]] < 0) { dist[t[c]] = d + 1; next.push(t[c]); }
      q = next;
    }
    return { code, dist };
  });
  const h = codes => Math.max(...codes.map((c, i) => pieces[i].dist[c]));
  const path = [];
  const dfs = (codes, g, bound, last) => {
    const hv = h(codes);
    if (hv === 0) return true;
    if (g + hv > bound) return false;
    for (let m = 0; m < 18; m++) {
      const f = (m / 3) | 0;
      if (f === last || (f % 3 === last % 3 && f < last)) continue; // same face / commuting opposite face
      path.push(face[m]);
      if (dfs(codes.map(c => table[m][c]), g + 1, bound, f)) return true;
      path.pop();
    }
    return false;
  };
  const start = pieces.map(p => p.code);
  for (let bound = h(start); bound <= 12; bound++) if (dfs(start, 0, bound, -9)) return path.slice();
  throw new Error('Cross search failed');
}

/**
 * raw facelets (colour letters, 'U' = white) -> [{ key, title, text, alg, steps: [{ label, seq }] }]
 * Stages with nothing to do are kept with an empty steps list so the lesson reads in full.
 */
export function beginnerSolve(raw) {
  const M = moves();
  const toCodes = f => Uint8Array.from(f, c => FACES.indexOf(c));
  let a = toCodes(raw);
  const whiteFace = [...FACES].findIndex((_, i) => raw[i * 9 + 4] === 'U');
  const turn = { U: 'x2', R: 'z', F: "x'", D: '', L: "z'", B: 'x' }[FACES[whiteFace]];
  const out = STAGES.map(s => ({ ...s, steps: [] }));
  const run = (stage, steps) => {
    for (const s of steps) { out[stage].steps.push({ label: s.label, seq: s.seq }); a = apply(a, s.p ?? perm(s.seq)); }
  };
  if (turn) run(0, [{ label: turn, seq: turn }]);
  run(1, solveCross(a));
  for (let k = 1; k <= 4; k++) run(2, search(a, [...M.U, ...M.y, ...M.sexy], s => cross(s) && count(s, D_CORNERS) >= k));
  for (let k = 1; k <= 4; k++) run(3, search(a, [...M.U, ...M.y, M.right, M.left], s => firstLayer(s) && count(s, MID_EDGES) >= k));
  run(4, search(a, [...M.U, M.fruruf], yellowCross));
  run(5, search(a, [...M.U, ...M.y, M.sune], yellowEdges));
  run(6, search(a, [...M.y, M.niklas], cornersPlaced));
  run(7, search(a, [...M.U, ...M.twist], solved, 12));
  return out;
}

// ---- CFOP split detection for reconstructions ----
const TO_D = { U: 'x2', R: 'z', F: "x'", D: '', L: "z'", B: 'x' };
const ll = a => U_CORNERS.every(([u]) => ok(a, u)) && U_EDGES.every(([u]) => ok(a, u));
// 0 nothing · 1 cross · 2 F2L · 3 OLL · 4 solved — best over all six cross colours
export function cfopStage(facelets) {
  let best = 0;
  for (const f of FACES) {
    const a = Uint8Array.from(new CubeState(facelets).move(TO_D[f]).facelets(), c => FACES.indexOf(c));
    const s = solved(a) ? 4 : !cross(a) ? 0 : !twoLayers(a) ? 1 : ll(a) ? 3 : 2;
    best = Math.max(best, s);
  }
  return best;
}

// First move index at which each CFOP stage was reached: [cross, f2l, oll, pll]
export function cfopSplits(startFacelets, moveList) {
  const st = new CubeState(startFacelets), idx = [-1, -1, -1, -1];
  moveList.forEach((m, i) => {
    st.move(m);
    const s = cfopStage(st.facelets());
    for (let k = 0; k < s; k++) if (idx[k] < 0) idx[k] = i;
  });
  return idx;
}

export const flatten = stages => stages.flatMap(s => s.steps.flatMap(st => tokens(st.seq)));
