// First-visit tour: a spotlight glides between the parts of the page that matter, with a short
// card for each. Step one demonstrates a turn with a ghost finger on the real cube.
const STEPS = [
  { target: '#stage', title: 'Grab a layer', text: 'Drag any sticker and its layer follows your finger, then snaps into place. Drag empty space to look around.', demo: true },
  { target: '#keys-btn', title: 'Or type your moves', text: 'Each face has a key: <kbd>R</kbd> turns the right face, <kbd>⇧</kbd><kbd>R</kbd> turns it back. Press <kbd>?</kbd> any time for the full map.' },
  { target: '.modes', title: 'Eight ways to play', text: 'Learn the beginner’s method on your own scramble, get any cube solved, race the clock, drill algorithms, design patterns…' },
  { target: '#puzzle', title: 'Pick a puzzle', text: 'The pocket 2×2, the classic 3×3 and the 4×4 — each with its own scrambles and times.' },
  { target: '.tools', title: 'Make it yours', text: 'Record a video, share the exact cube you’re holding, and change the colours and sounds.' },
];

export function initTour({ cube, demoTurn, store }) {
  const root = document.createElement('div');
  root.className = 'tour';
  root.hidden = true;
  root.innerHTML = `<div class="tour-spot"></div><div class="tour-finger"></div>
    <div class="tour-card" role="dialog" aria-labelledby="tour-title" aria-describedby="tour-text">
      <div class="tour-dots"></div>
      <h4 id="tour-title"></h4>
      <p id="tour-text"></p>
      <div class="tour-actions"><button class="link" data-t="skip">Skip</button><button class="btn primary" data-t="next">Next</button></div>
    </div>`;
  document.body.append(root);
  const spot = root.querySelector('.tour-spot'), card = root.querySelector('.tour-card'), finger = root.querySelector('.tour-finger');
  let steps = [], i = 0, demoTimers = [], turned = false;

  const visible = sel => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0; };

  function place() {
    const s = steps[i], r = document.querySelector(s.target).getBoundingClientRect();
    const pad = s.demo ? -40 : 8;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 18;
    let x = r.left + r.width / 2 - cw / 2, y = r.bottom + gap;
    if (s.demo) { x = r.left + 28; y = r.bottom - ch - 28; } // bottom-left corner, clear of the cube
    else if (y + ch > innerHeight - 12) y = r.top - ch - gap;
    card.style.left = `${Math.max(12, Math.min(innerWidth - cw - 12, x))}px`;
    card.style.top = `${Math.max(12, Math.min(innerHeight - ch - 12, y))}px`;
  }

  function show() {
    const s = steps[i];
    root.querySelector('#tour-title').textContent = s.title;
    root.querySelector('#tour-text').innerHTML = s.text;
    root.querySelector('.tour-dots').innerHTML = steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    root.querySelector('[data-t=next]').textContent = i === steps.length - 1 ? 'Start cubing' : 'Next';
    card.classList.remove('in');
    void card.offsetWidth; // restart the entrance animation
    card.classList.add('in');
    place();
    stopDemo();
    if (s.demo) demo();
    root.querySelector('[data-t=next]').focus({ preventScroll: true });
  }

  // ghost finger slides up the front-right column while the layer turns, then it turns back
  function demo() {
    const h = (cube.size - 1) / 2, from = cube.screenPoint([h, -h, h + 0.5]), to = cube.screenPoint([h, h, h + 0.5]);
    const run = () => {
      finger.style.transition = 'none';
      finger.style.transform = `translate(${from.x}px, ${from.y}px)`;
      finger.classList.add('on');
      demoTimers.push(setTimeout(() => {
        finger.style.transition = '';
        finger.style.transform = `translate(${to.x}px, ${to.y}px)`;
      }, 250));
      demoTimers.push(setTimeout(() => { demoTurn('R'); turned = true; }, 520));
      demoTimers.push(setTimeout(() => finger.classList.remove('on'), 1300));
      demoTimers.push(setTimeout(() => { demoTurn("R'"); turned = false; }, 2100));
      demoTimers.push(setTimeout(run, 3400));
    };
    run();
  }
  function stopDemo() {
    demoTimers.forEach(clearTimeout);
    demoTimers = [];
    finger.classList.remove('on');
    if (turned) { demoTurn("R'"); turned = false; } // never leave the demo turn behind
  }

  function end() {
    stopDemo();
    root.classList.remove('open');
    setTimeout(() => (root.hidden = true), 350);
    store.set('toured', true);
    removeEventListener('resize', place);
    removeEventListener('keydown', keys, true);
  }
  function next() {
    if (i < steps.length - 1) { i++; show(); } else end();
  }
  function keys(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); next(); }
  }
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t === 'skip') end();
    if (t === 'next') next();
  });

  function start() {
    steps = STEPS.filter(s => visible(s.target)); // e.g. no keyboard step on touch screens
    i = 0;
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('open'));
    show();
    addEventListener('resize', place);
    addEventListener('keydown', keys, true);
  }

  return { start, get seen() { return store.get('toured', false); } };
}
