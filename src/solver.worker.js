// Kociemba two-phase solver + the beginner-method teacher, off the main thread.
import cubeSrc from 'cubejs/lib/cube.js?raw';
import solveSrc from 'cubejs/lib/solve.js?raw';
import { beginnerSolve } from './learn.js';
import { solve2, scramble2 } from './pocket.js';

// cubejs is old CommonJS that falls back to `this.Cube`, which bundlers break in a module
// worker. Run its two files as plain scripts with this = self instead.
for (const src of [cubeSrc, solveSrc]) new Function('module', src).call(self);
const { Cube } = self;

Cube.initSolver();

// mulberry32 — a tiny seeded PRNG so the daily scramble is the same for everyone
const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 4×4: random moves over outer and wide turns, never the same axis twice in a row (WCA style)
function scramble4(random, n = 40) {
  const axes = [['U', 'D', 'Uw'], ['R', 'L', 'Rw'], ['F', 'B', 'Fw']], out = [];
  let last = -1;
  while (out.length < n) {
    const a = Math.floor(random() * 3);
    if (a === last) continue;
    last = a;
    const faces = axes[a].filter(() => random() < 0.6);
    for (const f of faces.length ? faces : [axes[a][0]]) out.push(f + ['', "'", '2'][Math.floor(random() * 3)]);
  }
  return out.slice(0, n).join(' ');
}

function scramble(seed, size = 3) {
  const random = seed != null ? seeded(seed) : Math.random;
  if (size === 2) return scramble2(random);
  if (size === 4) return scramble4(random);
  const saved = Math.random;
  Math.random = random;
  try {
    return Cube.inverse(Cube.random().solve()); // random-state scramble, like the WCA uses
  } finally {
    Math.random = saved;
  }
}

self.onmessage = ({ data: { id, type, facelets, seed, size } }) => {
  try {
    const result = type === 'solve' ? Cube.fromString(facelets).solve()
      : type === 'solve2' ? solve2(facelets)
      : type === 'learn' ? beginnerSolve(facelets)
      : scramble(seed, size);
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: String(e.message || e) });
  }
};
