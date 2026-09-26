// The daily challenge scramble, derived from the day number alone — so the server can recompute it
// and nobody can submit a result for an easier scramble.
export const DAY0 = Date.UTC(2026, 0, 1);
export const dayNumber = (now = Date.now()) => Math.floor((now - DAY0) / 864e5) + 1;

// mulberry32: tiny, fast, deterministic
export const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 25 random face turns, never two on the same axis in a row.
export function dailyScramble(day, length = 25) {
  const rand = seeded(Math.imul(day, 2654435761) >>> 0), axes = ['UD', 'RL', 'FB'], out = [];
  let last = -1;
  while (out.length < length) {
    const a = Math.floor(rand() * 3);
    if (a === last) continue;
    last = a;
    out.push(axes[a][Math.floor(rand() * 2)] + ['', "'", '2'][Math.floor(rand() * 3)]);
  }
  return out.join(' ');
}
