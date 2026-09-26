// localStorage with a schema version and migrations. Every read/write is guarded: private browsing
// or a full quota degrades to "nothing saved", never to a crash.
const PREFIX = 'sixfold.';
export const SCHEMA = 2;

export const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(PREFIX + key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* unavailable */ }
  },
};

// Each migration upgrades the stored data by one version. Never edit one that has shipped — add a new one.
const MIGRATIONS = {
  // v2: solves always carry the puzzle they were timed on (older ones were all 3×3)
  2: s => s.set('solves', s.get('solves', []).map(x => ({ puzzle: '333', ...x }))),
};

export function migrate(s = store) {
  let v = s.get('schema', 1);
  while (v < SCHEMA) {
    v++;
    MIGRATIONS[v]?.(s);
    s.set('schema', v);
  }
}
