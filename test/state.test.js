// Run: npm test — checks the sticker model against the cubejs reference implementation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CubeState, SOLVED, problem, invert, moveName, parseMove } from '../src/state.js';
import { average } from '../src/stats.js';
import { classify } from '../src/scan.js';

const Cube = createRequire(import.meta.url)('cubejs');
const ref = seq => { const c = new Cube(); c.move(seq); return c.asString(); };

for (const m of ['U', 'R', 'F', 'D', 'L', 'B', 'M', 'E', 'S', 'x', 'y', 'z', "R'", 'U2', "M'", "x'"]) {
  assert.equal(new CubeState().move(m).facelets(), ref(m), `move ${m}`);
}
const face = 'URFDLB';
const rnd = Array.from({ length: 60 }, () => face[(Math.random() * 6) | 0] + ['', "'", '2'][(Math.random() * 3) | 0]).join(' ');
assert.equal(new CubeState().move(rnd).facelets(), ref(rnd), 'random sequence');
assert.equal(new CubeState().move(Array(6).fill("R U R' U'").join(' ')).facelets(), SOLVED, 'sexy move x6');
assert.equal(new CubeState().move(rnd).move(invert(rnd)).facelets(), SOLVED, 'invert');
assert.ok(new CubeState().move('x y2 z').isSolved(), 'rotations keep solved');
assert.equal(new CubeState().move('r').facelets(), new CubeState().move("L x").facelets(), 'r = L x');

// solver string after rotations + slices is solvable and solves the cube
Cube.initSolver();
const scrambled = new CubeState().move(`${rnd} M E S x y`);
const sol = Cube.fromString(scrambled.solverString()).solve();
assert.ok(scrambled.move(sol).isSolved(), 'solve after rotations');

// validation
assert.equal(problem(new CubeState().move(rnd).facelets()), '');
const flipped = [...SOLVED]; [flipped[7], flipped[19]] = [flipped[19], flipped[7]]; // flip UF
assert.match(problem(flipped.join('')), /flipped/);
const twisted = [...SOLVED]; [twisted[8], twisted[9], twisted[20]] = [twisted[9], twisted[20], twisted[8]]; // twist URF
assert.match(problem(twisted.join('')), /twisted/);
const swapped = new CubeState().move(rnd).facelets().split('');
const swapEdge = (a, b) => [[a[0], b[0]], [a[1], b[1]]].forEach(([i, j]) => ([swapped[i], swapped[j]] = [swapped[j], swapped[i]]));
swapEdge([7, 19], [5, 10]); // swap the UF and UR pieces
assert.match(problem(swapped.join('')), /swapped|impossible/);
assert.match(problem('?' + SOLVED.slice(1)), /unpainted/);

// drag mapping: +90° about +x through layer 1 is R'
assert.equal(moveName(0, 1, 1), "R'");
assert.equal(moveName(1, -1, 1), 'D');
assert.equal(parseMove('Rw').axis, 0);

// WCA averages
assert.equal(average([1, 2, 3, 4, 5], 5), 3);
assert.equal(average([1, Infinity, 3, 4, 5], 5), 4);
assert.equal(average([Infinity, Infinity, 3, 4, 5], 5), Infinity);
assert.equal(average([1, 2], 5), null);

// camera colour classification: noisy, dimmed samples of a scrambled cube come back exact
const RGB = { U: [235, 235, 225], R: [200, 30, 40], F: [20, 170, 90], D: [240, 210, 40], L: [245, 120, 20], B: [30, 80, 210] };
const truth = new CubeState().move(rnd).facelets();
const samples = [...truth].map(c => RGB[c].map(v => Math.max(0, Math.min(255, v * (0.75 + Math.random() * 0.25) + (Math.random() - 0.5) * 20))));
assert.equal(classify(samples), truth, 'classify');

console.log('all good');

// ---- beginner solver, CFOP splits, trainer algorithms ----
{
  const { beginnerSolve, flatten, cfopSplits, cfopStage } = await import('../src/learn.js');
  const { SETS, caseState, reached } = await import('../src/algs.js');
  for (let n = 0; n < 25; n++) {
    const st = new CubeState().move(Array.from({ length: 25 }, () => face[(Math.random() * 6) | 0] + ['', "'", '2'][(Math.random() * 3) | 0]).join(' ') + ' x y');
    assert.ok(st.clone().move(flatten(beginnerSolve(st.facelets())).join(' ')).isSolved(), 'beginner solve');
  }
  assert.equal(cfopStage(SOLVED), 4);
  assert.equal(cfopStage(new CubeState().move("R U R' U'").facelets()), 1, 'cross intact (U cross) after sexy move');
  assert.deepEqual(cfopSplits(new CubeState().move("R'").facelets(), ['R']), [0, 0, 0, 0]);

  const f2l = f => [...Array(54).keys()].filter(i => (i < 9 ? false : i >= 27 && i < 36 ? true : i % 9 >= 3)).every(i => f[i] === f[((i / 9) | 0) * 9 + 4]);
  for (const [key, set] of Object.entries(SETS)) {
    for (const [name, alg, kind] of set.cases) {
      const st = caseState(alg);
      const f = st.facelets();
      assert.ok(f2l(f), `${key} ${name}: only touches the last layer`);
      assert.ok(!reached(key, st, kind), `${key} ${name}: is not already done`);
      assert.ok(reached(key, st.clone().move(alg), kind), `${key} ${name}: algorithm solves its case`);
      if (key === 'pll') assert.ok([0, 1, 2, 3, 5, 6, 7, 8].every(i => f[i] === f[4]), `pll ${name}: top is oriented`);
    }
  }
}
// voice: spoken phrases -> moves / commands
{
  const { parseSpeech } = await import('../src/connect.js');
  assert.deepEqual(parseSpeech("right up right prime up prime").map(a => a.move), ['R', 'U', "R'", "U'"]);
  assert.deepEqual(parseSpeech('front two then scramble'), [{ move: 'F2' }, { command: 'scramble' }]);
  assert.deepEqual(parseSpeech("R' U2").map(a => a.move), ["R'", 'U2']);
}
// ---- N×N: 2×2 and 4×4 ----
{
  const { solvedFacelets, parseMove: pm, moveName: mn, cornerState, problem: prob, tokens } = await import('../src/state.js');
  const { solve2, scramble2, _mul, MOVES: M2 } = await import('../src/pocket.js');
  const S4 = solvedFacelets(4), S2 = solvedFacelets(2);
  assert.ok(new CubeState(S4).move('R R R R Uw Uw Uw Uw 2R 2R 2R 2R').isSolved(), '4x4 quarter turns cycle');
  assert.equal(new CubeState(S4).move('Rw').facelets(), new CubeState(S4).move('R 2R').facelets(), 'Rw = R 2R');
  assert.equal(new CubeState(S4).move('r').facelets(), new CubeState(S4).move('Rw').facelets(), 'r = Rw');
  assert.ok(new CubeState(S4).move('x y z').isSolved(), '4x4 rotations keep solved');
  const faces4 = ['U', 'R', 'F', 'D', 'L', 'B', 'Uw', 'Rw', 'Fw', '2R', '2U', '2F', 'M', 'x'];
  const seq4 = Array.from({ length: 50 }, () => faces4[(Math.random() * faces4.length) | 0] + ['', "'", '2'][(Math.random() * 3) | 0]).join(' ');
  assert.ok(new CubeState(S4).move(seq4).move(invert(seq4)).isSolved(), '4x4 invert');
  assert.ok(new CubeState(S2).move(Array(6).fill("R U R' U'").join(' ')).isSolved(), '2x2 sexy x6');
  // every single-layer drag maps to a name that parses back to the same turn
  for (const n of [2, 3, 4]) {
    const h = (n - 1) / 2;
    for (let axis = 0; axis < 3; axis++) for (let i = 0; i < n; i++) for (const sign of [1, -1]) {
      const layer = i - h, name = mn(axis, layer, sign, n), mv = pm(name, n);
      assert.deepEqual([mv.axis, mv.layers, mv.turns], [axis, [layer], sign], `moveName ${n} ${axis} ${layer} ${sign} -> ${name}`);
    }
  }
  // the cubie model used by the 2×2 solver agrees with the sticker model
  let cubieSt = { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] };
  const st2 = new CubeState(S2);
  const MC = Object.fromEntries(['U', 'R', 'F'].map(f => { const c = cornerState(new CubeState(S2).move(f).facelets(), 2); return [f, c]; }));
  for (let i = 0; i < 40; i++) {
    const f = 'URF'[(Math.random() * 3) | 0];
    st2.move(f);
    cubieSt = _mul(cubieSt, MC[f]);
  }
  assert.deepEqual(cornerState(st2.facelets(), 2), cubieSt, '2x2 cubie model');
  const t0 = performance.now();
  for (let k = 0; k < 30; k++) {
    const scr = Array.from({ length: 20 }, () => 'URFDLB'[(Math.random() * 6) | 0] + ['', "'", '2'][(Math.random() * 3) | 0]).join(' ') + ' x y2';
    const c = new CubeState(S2).move(scr), sol = solve2(c.facelets());
    assert.ok(c.move(sol).isSolved(), '2x2 solve');
    assert.ok(tokens(sol).length <= 11, '2x2 optimal <= 11');
  }
  const scr2 = scramble2();
  assert.ok(!new CubeState(S2).move(scr2).isSolved() && tokens(scr2).every(t => M2.includes(t)), '2x2 scramble');
  const tw = [...S2]; [tw[3], tw[8], tw[17]] = [tw[8], tw[17], tw[3]];
  assert.match(prob(tw.join('')), /twisted|impossible/);
  assert.equal(prob(new CubeState(S2).move('R U x').facelets()), '');
  console.log(`2x2 table + 30 solves in ${(performance.now() - t0).toFixed(0)} ms`);
}
console.log('all good (incl. learn + algs + voice + NxN)');
