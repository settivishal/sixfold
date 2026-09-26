import { average, fmt } from './stats.js';
import { solveValue, puzzleId } from './timer.js';

// Stats dashboard: KPI tiles, every solve with rolling averages, a histogram, a practice calendar,
// a table view, and csTimer-compatible import / export. Series colours validated for CVD on the dark surface.
const C = { solve: '#8670e8', ao5: '#e04d7f', ao12: '#179fc8' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function initStatsView({ getSolves, setSolves, getSize, toast }) {
  const $ = id => document.getElementById(id);
  const dlg = $('stats-dialog'), tip = $('chart-tip');
  let puzzle = '333';

  const list = () => getSolves().filter(s => (s.puzzle ?? '333') === puzzle);

  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
    tip.style.top = `${y - r.height - 14 < 8 ? y + 18 : y - r.height - 14}px`;
  }
  const hideTip = () => (tip.hidden = true);

  function render() {
    document.querySelectorAll('#stats-puzzle button').forEach(b => b.setAttribute('aria-checked', b.dataset.p === puzzle));
    const L = list(), vals = L.map(solveValue), ok = vals.filter(v => v !== Infinity);
    const mean = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
    const sd = ok.length > 1 ? Math.sqrt(ok.reduce((a, v) => a + (v - mean) ** 2, 0) / (ok.length - 1)) : null;
    const kpi = [
      ['Solves', L.length], ['Best', ok.length ? fmt(Math.min(...ok)) : '—'], ['Ao5', fmt(average(vals, 5))], ['Ao12', fmt(average(vals, 12))],
      ['Ao100', fmt(average(vals, 100))], ['Mean', fmt(mean)], ['Std dev', sd ? (sd / 1000).toFixed(2) : '—'], ['DNF', L.length ? `${Math.round(((vals.length - ok.length) / vals.length) * 100)}%` : '—'],
    ];
    $('kpis').innerHTML = kpi.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const empty = L.length < 2;
    $('stats-empty').hidden = !empty;
    $('stats-charts').hidden = empty;
    if (empty) return;
    lineChart(L, vals);
    histogram(ok, mean);
    calendar(L);
    table(L, vals);
  }

  // every solve (dots) + rolling Ao5 / Ao12 (lines), one y-axis in seconds
  function lineChart(L, vals) {
    const svg = $('chart-line'), W = 760, H = 250, m = { l: 44, r: 52, t: 12, b: 26 };
    const ao5 = vals.map((_, i) => average(vals.slice(0, i + 1), 5)), ao12 = vals.map((_, i) => average(vals.slice(0, i + 1), 12));
    const finite = vals.filter(v => v !== Infinity).sort((a, b) => a - b);
    const lo = finite[0] * 0.92, hi = finite[Math.floor((finite.length - 1) * 0.98)] * 1.06; // the slowest 2% clip to the top
    const X = i => m.l + (L.length === 1 ? 0 : (i / (L.length - 1)) * (W - m.l - m.r));
    const Y = v => m.t + (1 - (Math.min(v, hi) - lo) / (hi - lo)) * (H - m.t - m.b);
    const ticks = niceTicks(lo, hi, 4);
    const path = arr => arr.map((v, i) => (v == null || v === Infinity ? null : [X(i), Y(v)])).reduce((d, p, i, a) => d + (p ? `${a[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}` : ''), '');
    const r = L.length > 150 ? 2.5 : 4;
    const lastOf = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null && arr[i] !== Infinity) return [X(i), Y(arr[i])]; return null; };
    const endLabel = (arr, name, col) => { const p = lastOf(arr); return p ? `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${col}" stroke="#12111f" stroke-width="2"/><text x="${W - m.r + 8}" y="${p[1] + 4}" class="lab">${name}</text>` : ''; };
    svg.innerHTML = `
      ${ticks.map(t => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${(t / 1000).toFixed(t < 10000 ? 1 : 0)}s</text>`).join('')}
      <text class="axis" x="${m.l}" y="${H - 6}">#1</text><text class="axis" x="${W - m.r}" y="${H - 6}" text-anchor="end">#${L.length}</text>
      ${vals.map((v, i) => (v === Infinity ? `<text class="dnf" x="${X(i)}" y="${m.t + 8}" text-anchor="middle">×</text>` : `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${r}" fill="${C.solve}" fill-opacity=".55"/>`)).join('')}
      <path d="${path(ao12)}" class="series" stroke="${C.ao12}"/>
      <path d="${path(ao5)}" class="series" stroke="${C.ao5}"/>
      ${endLabel(ao5, 'Ao5', C.ao5)}${endLabel(ao12, 'Ao12', C.ao12)}
      <line class="cross" id="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
      <circle id="cross-dot" r="6" fill="none" stroke="#fff" stroke-width="2" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}"/>`;
    const hit = svg.querySelector('.hit'), cross = svg.querySelector('#cross'), dot = svg.querySelector('#cross-dot');
    hit.onpointermove = e => {
      const box = svg.getBoundingClientRect(), x = ((e.clientX - box.left) / box.width) * W;
      const i = Math.max(0, Math.min(L.length - 1, Math.round(((x - m.l) / (W - m.l - m.r)) * (L.length - 1))));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      if (vals[i] !== Infinity) { dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(vals[i])); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden');
      showTip(`<b>Solve #${i + 1}</b><span>${new Date(L[i].at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        <p><i style="background:${C.solve}"></i>Time<em>${fmt(vals[i])}</em></p>
        <p><i style="background:${C.ao5}"></i>Ao5<em>${fmt(ao5[i])}</em></p>
        <p><i style="background:${C.ao12}"></i>Ao12<em>${fmt(ao12[i])}</em></p>`, e.clientX, box.top + (Y(vals[i] === Infinity ? hi : vals[i]) / H) * box.height);
    };
    hit.onpointerleave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); };
  }

  function histogram(ok, mean) {
    const svg = $('chart-hist'), W = 370, H = 200, m = { l: 10, r: 10, t: 22, b: 26 };
    const lo = Math.min(...ok), hi = Math.max(...ok);
    const step = [250, 500, 1000, 2000, 5000, 10000, 30000, 60000].find(s => (hi - lo) / s <= 14) ?? 120000;
    const start = Math.floor(lo / step) * step, n = Math.max(1, Math.ceil((hi + 1 - start) / step));
    const bins = Array(n).fill(0);
    ok.forEach(v => bins[Math.min(n - 1, Math.floor((v - start) / step))]++);
    const top = Math.max(...bins), bw = (W - m.l - m.r) / n;
    const X = v => m.l + ((v - start) / (n * step)) * (W - m.l - m.r), Y = c => H - m.b - (c / top) * (H - m.t - m.b);
    svg.innerHTML = `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
      ${bins.map((c, i) => {
        if (!c) return '';
        const x = m.l + i * bw + 1, w = Math.max(1, bw - 2), y = Y(c), h = H - m.b - y, rr = Math.min(4, w / 2, h);
        return `<path class="bar" data-i="${i}" fill="${C.solve}" d="M${x},${H - m.b}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${H - m.b}Z"/>`;
      }).join('')}
      <line class="mean" x1="${X(mean)}" x2="${X(mean)}" y1="${m.t - 6}" y2="${H - m.b}"/><text class="lab" x="${X(mean)}" y="${m.t - 10}" text-anchor="middle">mean ${fmt(mean)}</text>
      <text class="axis" x="${m.l}" y="${H - 8}">${fmt(start)}</text><text class="axis" x="${W - m.r}" y="${H - 8}" text-anchor="end">${fmt(start + n * step)}</text>`;
    svg.querySelectorAll('.bar').forEach(b => {
      const i = +b.dataset.i;
      b.onpointermove = e => showTip(`<b>${fmt(start + i * step)} – ${fmt(start + (i + 1) * step)}</b><p><i style="background:${C.solve}"></i>Solves<em>${bins[i]}</em></p>`, e.clientX, e.clientY);
      b.onpointerleave = hideTip;
    });
  }

  // practice calendar: the last 26 weeks, one cell per day, one hue light→dark by solve count
  function calendar(L) {
    const svg = $('chart-cal'), cell = 13, gap = 3, weeks = 26;
    const day = d => { const t = new Date(d); t.setHours(0, 0, 0, 0); return +t; };
    const counts = {};
    L.forEach(s => { const k = day(s.at); counts[k] = (counts[k] ?? 0) + 1; });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const first = new Date(today); first.setDate(first.getDate() - (weeks - 1) * 7 - today.getDay());
    const level = c => (!c ? 0 : c < 3 ? 1 : c < 6 ? 2 : c < 11 ? 3 : 4);
    const fills = ['rgba(255,255,255,.05)', 'rgba(134,112,232,.32)', 'rgba(134,112,232,.55)', 'rgba(134,112,232,.8)', '#a08cff'];
    let cells = '', months = '';
    for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
      const date = new Date(first); date.setDate(first.getDate() + w * 7 + d);
      if (date > today) continue;
      const c = counts[+date] ?? 0;
      cells += `<rect class="day" x="${30 + w * (cell + gap)}" y="${14 + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${fills[level(c)]}" data-d="${+date}" data-c="${c}"/>`;
      if (d === 0 && date.getDate() <= 7) months += `<text class="axis" x="${30 + w * (cell + gap)}" y="9">${date.toLocaleDateString(undefined, { month: 'short' })}</text>`;
    }
    svg.setAttribute('viewBox', `0 0 ${30 + weeks * (cell + gap)} ${14 + 7 * (cell + gap)}`);
    svg.innerHTML = months + ['Mon', 'Wed', 'Fri'].map((t, i) => `<text class="axis" x="0" y="${14 + (i * 2 + 1) * (cell + gap) + 10}">${t}</text>`).join('') + cells;
    svg.querySelectorAll('.day').forEach(r => {
      r.onpointermove = e => showTip(`<b>${new Date(+r.dataset.d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b><p>${r.dataset.c} solve${r.dataset.c === '1' ? '' : 's'}</p>`, e.clientX, e.clientY);
      r.onpointerleave = hideTip;
    });
  }

  function table(L, vals) {
    $('stats-table').innerHTML = `<table><thead><tr><th>#</th><th>Time</th><th>Ao5</th><th>Ao12</th><th>Date</th><th>Scramble</th></tr></thead><tbody>${
      L.map((s, i) => ({ s, i })).slice(-200).reverse().map(({ s, i }) => `<tr><td>${i + 1}</td><td>${fmt(vals[i])}${s.pen === 2 ? '+' : ''}</td>
        <td>${fmt(average(vals.slice(0, i + 1), 5))}</td><td>${fmt(average(vals.slice(0, i + 1), 12))}</td>
        <td>${new Date(s.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</td><td class="scr">${esc(s.scramble ?? '')}</td></tr>`).join('')
    }</tbody></table>`;
  }

  // ---- import / export (csTimer JSON + CSV) ----
  function download(text, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const SCR = { 222: '222so', 333: '333', 444: '444wca' };
  $('export-cstimer').addEventListener('click', () => {
    const all = getSolves(), out = { properties: {} }, meta = {};
    ['222', '333', '444'].forEach((p, k) => {
      const L = all.filter(s => (s.puzzle ?? '333') === p);
      if (!L.length) return;
      const key = `session${k + 1}`;
      out[key] = L.map(s => [[s.pen === 'dnf' ? -1 : s.pen === 2 ? 2000 : 0, s.ms], s.scramble ?? '', '', Math.round(s.at / 1000)]);
      meta[k + 1] = { name: `Sixfold ${p[0]}×${p[0]}`, opt: { scrType: SCR[p] } };
    });
    out.properties.sessionData = JSON.stringify(meta);
    download(JSON.stringify(out), `sixfold-cstimer-${new Date().toISOString().slice(0, 10)}.txt`, 'application/json');
  });
  $('export-csv').addEventListener('click', () => {
    const rows = [['puzzle', 'time_ms', 'penalty', 'scramble', 'date'], ...getSolves().map(s => [s.puzzle ?? '333', s.ms, s.pen, `"${(s.scramble ?? '').replace(/"/g, '""')}"`, new Date(s.at).toISOString()])];
    download(rows.map(r => r.join(',')).join('\n'), 'sixfold-times.csv', 'text/csv');
  });
  $('import-cstimer').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      let meta = {};
      try { meta = JSON.parse(data.properties?.sessionData ?? '{}'); } catch { /* names are optional */ }
      const seen = new Set(getSolves().map(s => `${s.at}:${s.ms}`)), added = [];
      for (const [key, rows] of Object.entries(data)) {
        const m = /^session(\d+)$/.exec(key);
        if (!m || !Array.isArray(rows)) continue;
        const scr = meta[m[1]]?.opt?.scrType ?? '333';
        const p = /222/.test(scr) ? '222' : /444/.test(scr) ? '444' : '333';
        for (const r of rows) {
          const [[pen, ms], scramble, , ts] = r;
          const s = { ms, pen: pen === -1 ? 'dnf' : pen === 2000 ? 2 : 0, scramble, at: ts * 1000, puzzle: p };
          if (typeof ms !== 'number' || seen.has(`${s.at}:${s.ms}`)) continue;
          seen.add(`${s.at}:${s.ms}`);
          added.push(s);
        }
      }
      setSolves([...getSolves(), ...added].sort((a, b) => a.at - b.at));
      toast(added.length ? `Imported ${added.length} solves ✦` : 'Nothing new to import');
      render();
    } catch {
      toast('That doesn’t look like a csTimer export.');
    }
  });

  document.querySelectorAll('#stats-puzzle button').forEach(b => b.addEventListener('click', () => { puzzle = b.dataset.p; render(); }));
  $('stats-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', hideTip);

  return {
    open() {
      puzzle = puzzleId(getSize());
      render();
      dlg.showModal();
    },
  };
}

function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

