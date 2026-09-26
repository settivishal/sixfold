// Pure timing helpers. Times are ms; DNF = Infinity.
export function average(times, n) {
  if (times.length < n) return null;
  const drop = Math.ceil(n * 0.05);
  const kept = times.slice(-n).sort((a, b) => a - b).slice(drop, n - drop);
  if (kept.includes(Infinity)) return Infinity;
  return Math.round(kept.reduce((a, b) => a + b, 0) / kept.length);
}

export function fmt(ms) {
  if (ms == null) return '—';
  if (ms === Infinity) return 'DNF';
  const s = ms / 1000, m = Math.floor(s / 60);
  return m ? `${m}:${(s % 60).toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}
