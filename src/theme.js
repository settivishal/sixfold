// Sticker palettes + body finishes. Colours flow to the 3D materials and to CSS vars (--cU … --cB)
// so every 2D view (net, move pad, diagrams, thumbnails) repaints for free.
export const PALETTES = {
  classic: { name: 'Classic', colors: { U: '#f6f2ea', R: '#ff3355', F: '#16d68a', D: '#ffd23a', L: '#ff8a1e', B: '#3a7bff' } },
  pastel: { name: 'Pastel', colors: { U: '#fbf7f0', R: '#ff8fa3', F: '#8fe3b8', D: '#ffe08a', L: '#ffb77a', B: '#8fb6ff' } },
  neon: { name: 'Neon', colors: { U: '#ffffff', R: '#ff1f5a', F: '#00ff9c', D: '#fff200', L: '#ff7a00', B: '#00b3ff' } },
  jewel: { name: 'Jewel', colors: { U: '#e8e4ff', R: '#e0457b', F: '#3ccfa0', D: '#f2c14e', L: '#f28d4e', B: '#5b7cfa' } },
  safe: { name: 'Colour-blind safe', colors: { U: '#f5f5f5', R: '#d55e00', F: '#009e73', D: '#f0e442', L: '#cc79a7', B: '#0072b2' } },
};
export const BODIES = {
  obsidian: { name: 'Obsidian', color: '#0c0c13' },
  graphite: { name: 'Graphite', color: '#34343f' },
  pearl: { name: 'Pearl', color: '#dcd8e6' },
};

export function initTheme({ cube, store }) {
  let pal = PALETTES[store.get('palette')] ? store.get('palette') : 'classic';
  let body = BODIES[store.get('body')] ? store.get('body') : 'obsidian';
  const palEl = document.getElementById('palettes'), bodyEl = document.getElementById('bodies');

  function apply() {
    const { colors } = PALETTES[pal];
    cube.setPalette(colors, BODIES[body].color);
    for (const [k, v] of Object.entries(colors)) document.documentElement.style.setProperty(`--c${k}`, v);
    palEl.innerHTML = Object.entries(PALETTES).map(([k, p]) => `<button class="pal" data-k="${k}" aria-pressed="${k === pal}">
      <span class="dots">${Object.values(p.colors).map(c => `<i style="background:${c}"></i>`).join('')}</span>${p.name}</button>`).join('');
    bodyEl.innerHTML = Object.entries(BODIES).map(([k, b]) => `<button class="body" data-k="${k}" aria-pressed="${k === body}">
      <i style="background:${b.color}"></i>${b.name}</button>`).join('');
  }
  palEl.addEventListener('click', e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k) { pal = k; store.set('palette', k); apply(); }
  });
  bodyEl.addEventListener('click', e => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (k) { body = k; store.set('body', k); apply(); }
  });
  apply();
}
