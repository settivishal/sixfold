// Command palette (⌘K / Ctrl+K): every action in the app, one fuzzy search away.
// Actions are plain { title, group, hint?, run } objects supplied by the caller.

// Subsequence match, tried from every word start; rewards word starts and runs, penalises gaps and
// matches that sprawl across several words. Returns -1 when there is no match.
export function score(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, ''), t = text.toLowerCase();
  if (!q) return 0;
  const from = start => {
    let s = 0, ti = start, run = 0, first = -1, last = -1;
    for (const ch of q) {
      const i = t.indexOf(ch, ti);
      if (i < 0) return null;
      if (first < 0) first = i;
      last = i;
      run = i === ti ? run + 1 : 0;
      s += 1 + run * 2 + (i === 0 || t[i - 1] === ' ' ? 3 : 0) - (i - ti) * 0.05;
      ti = i + 1;
    }
    return s - (t.slice(first, last).split(' ').length - 1) * 2.5 - first * 0.03; // sprawl + position
  };
  const starts = [0];
  for (let i = t.indexOf(' '); i >= 0; i = t.indexOf(' ', i + 1)) starts.push(i + 1);
  const scores = starts.map(from).filter(v => v !== null);
  if (!scores.length) return -1;
  return Math.max(0.01, Math.max(...scores) + (t.includes(q) ? 8 : 0)); // any match stays ≥ 0
}

export function initPalette(getActions) {
  const dlg = document.createElement('dialog');
  dlg.className = 'palette-dialog';
  dlg.setAttribute('aria-label', 'Command palette');
  dlg.innerHTML = `<input class="palette-input" type="text" placeholder="Search actions, modes, patterns, themes…" aria-label="Search actions" autocomplete="off" spellcheck="false" />
    <ul class="palette-list" role="listbox"></ul><p class="palette-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> run · <kbd>Esc</kbd> close</p>`;
  document.body.append(dlg);
  const input = dlg.querySelector('input'), list = dlg.querySelector('ul');
  let items = [], sel = 0;

  function render() {
    const q = input.value.trim();
    items = getActions()
      .map(a => ({ a, s: score(q, `${a.title} ${a.group}`) }))
      .filter(x => x.s >= 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 12)
      .map(x => x.a);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items.map((a, i) => `<li role="option" aria-selected="${i === sel}" data-i="${i}"><span>${a.title}</span><em>${a.group}${a.hint ? ` · ${a.hint}` : ''}</em></li>`).join('')
      : '<li class="none">Nothing matches.</li>';
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }
  function run(i) {
    const a = items[i];
    if (!a) return;
    dlg.close();
    a.run();
  }

  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) run(+li.dataset.i); });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  return {
    open() {
      input.value = '';
      sel = 0;
      render();
      dlg.showModal();
      input.focus();
    },
    get isOpen() { return dlg.open; },
  };
}
