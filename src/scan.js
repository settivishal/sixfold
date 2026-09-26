import { FACES, COLOR_NAMES } from './state.js';
import { COLORS } from './cube3d.js';

// Face order + how to hold the cube so the camera sees Kociemba reading order.
const STEPS = [['U', 'B'], ['R', 'U'], ['F', 'U'], ['D', 'F'], ['L', 'U'], ['B', 'U']];

function lab([r, g, b]) {
  const lin = v => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [r, g, b].map(lin);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), Y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), Z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

// 54 RGB samples -> facelet colours. Each sticker goes to the nearest centre (in Lab,
// lightness down-weighted for uneven light), greedily, with at most 9 per colour.
export function classify(samples) {
  const L = samples.map(lab), centers = [0, 1, 2, 3, 4, 5].map(i => L[i * 9 + 4]);
  const pairs = [];
  L.forEach((c, i) => centers.forEach((z, j) => pairs.push([Math.hypot((c[0] - z[0]) * 0.5, c[1] - z[1], c[2] - z[2]), i, j])));
  pairs.sort((a, b) => a[0] - b[0]);
  const out = Array(54).fill(null), count = Array(6).fill(0);
  for (const [, i, j] of pairs) if (!out[i] && count[j] < 9) { out[i] = FACES[j]; count[j]++; }
  return out.join('');
}

export function initScan({ onDone, toast }) {
  const $ = id => document.getElementById(id);
  const video = $('scan-video'), overlay = $('scan-overlay'), octx = overlay.getContext('2d');
  const startBtn = $('scan-start'), capBtn = $('scan-capture'), stepEl = $('scan-step'), facesEl = $('scan-faces');
  const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
  let stream = null, raf = 0, step = 0, live = [];
  const faces = Array(6).fill(null);

  facesEl.innerHTML = STEPS.map((_, i) => `<button aria-label="Rescan ${COLOR_NAMES[FACES[i]]} face">${'<i></i>'.repeat(9)}</button>`).join('');
  const faceBtns = [...facesEl.children];
  faceBtns.forEach((b, i) => b.addEventListener('click', () => { step = i; renderStep(); }));

  function renderStep() {
    const [f, top] = STEPS[step];
    stepEl.innerHTML = `<span class="dot" style="--c:${COLORS[f]}"></span><span>Face ${step + 1} of 6 — <b>${COLOR_NAMES[f]}</b> centre toward the camera, <b>${COLOR_NAMES[top]}</b> centre on top.</span>`;
    faceBtns.forEach((b, i) => {
      b.classList.toggle('now', i === step);
      [...b.children].forEach((c, k) => c.style.setProperty('--c', faces[i] ? `rgb(${faces[i][k].map(Math.round)})` : ''));
    });
  }

  function sample() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w) return [];
    if (work.width !== w) { work.width = overlay.width = w; work.height = overlay.height = h; }
    wctx.drawImage(video, 0, 0);
    const side = Math.min(w, h) * 0.62, x0 = (w - side) / 2, y0 = (h - side) / 2, cell = side / 3, out = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const { data } = wctx.getImageData(x0 + (c + 0.3) * cell, y0 + (r + 0.3) * cell, cell * 0.4, cell * 0.4);
      const sum = [0, 0, 0];
      for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
      out.push(sum.map(v => v / (data.length / 4)));
    }
    // overlay: soft grid + live swatches (canvas is mirrored with the video, so raw coords line up)
    octx.clearRect(0, 0, w, h);
    octx.lineWidth = 2;
    octx.strokeStyle = 'rgba(255,255,255,.55)';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      octx.beginPath();
      octx.roundRect(x0 + c * cell + 4, y0 + r * cell + 4, cell - 8, cell - 8, 10);
      octx.stroke();
      octx.beginPath();
      octx.arc(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell, cell * 0.12, 0, Math.PI * 2);
      octx.fillStyle = `rgb(${out[r * 3 + c].map(Math.round)})`;
      octx.fill();
      octx.stroke();
    }
    return out;
  }

  function loop() {
    live = sample();
    raf = requestAnimationFrame(loop);
  }

  async function start() {
    if (stream) return stop();
    startBtn.classList.add('busy');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
      video.srcObject = stream;
      await video.play();
      $('scan-empty').hidden = true;
      capBtn.disabled = false;
      startBtn.textContent = 'Stop camera';
      renderStep();
      loop();
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Camera permission was denied.' : 'No camera available.');
      stop();
    }
    startBtn.classList.remove('busy');
  }

  function stop() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    $('scan-empty').hidden = false;
    capBtn.disabled = true;
    startBtn.textContent = 'Start camera';
  }

  function capture() {
    if (!stream || live.length !== 9) return;
    faces[step] = live;
    const next = faces.findIndex(f => !f);
    if (next < 0) {
      renderStep();
      stop();
      onDone(classify(faces.flat()));
      return;
    }
    step = next;
    renderStep();
  }

  startBtn.addEventListener('click', start);
  capBtn.addEventListener('click', capture);
  renderStep();
  return { capture, stop };
}
