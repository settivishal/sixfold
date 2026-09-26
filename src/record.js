// Records the live 3D view as a video. Every rendered frame, the WebGL canvas is composited onto a
// square 1080×1080 canvas with the site's backdrop, the wordmark and a caption; MediaRecorder encodes it.
const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

export function createRecorder(cube) {
  const out = document.createElement('canvas');
  out.width = out.height = 1080;
  const ctx = out.getContext('2d');
  let rec = null, chunks = [], type = '';
  const state = { caption: '', sub: '' };

  function draw() {
    ctx.fillStyle = '#06060c';
    ctx.fillRect(0, 0, 1080, 1080);
    for (const [x, y, r, c] of [[760, 80, 700, 'rgba(79,51,255,.35)'], [900, 900, 600, 'rgba(255,61,127,.18)'], [120, 980, 520, 'rgba(0,184,160,.12)']]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1080, 1080);
    }
    const src = cube.renderer.domElement, s = Math.min(src.width, src.height);
    ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 20, 1080, 1080); // edge to edge, so no seam
    ctx.fillStyle = '#efebf9';
    ctx.font = '400 54px "Instrument Serif", Georgia, serif';
    ctx.fillText('six', 64, 96);
    const w = ctx.measureText('six').width;
    const grad = ctx.createLinearGradient(64 + w, 0, 64 + w + 110, 0);
    grad.addColorStop(0, '#ffb36b'); grad.addColorStop(0.4, '#ff5c8a'); grad.addColorStop(1, '#9b7bff');
    ctx.fillStyle = grad;
    ctx.font = 'italic 400 54px "Instrument Serif", Georgia, serif';
    ctx.fillText('fold', 64 + w, 96);
    const caption = typeof state.caption === 'function' ? state.caption() : state.caption;
    if (caption) {
      ctx.fillStyle = '#efebf9';
      ctx.font = '300 92px "Geist Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(caption, 1016, 1010);
      ctx.textAlign = 'left';
    }
    if (state.sub) {
      ctx.fillStyle = '#9391ad';
      ctx.font = '500 26px "Geist Mono", ui-monospace, monospace';
      ctx.fillText(state.sub.toUpperCase(), 64, 1004);
    }
  }

  return {
    canvas: out,
    get recording() { return !!rec; },
    supported: typeof MediaRecorder !== 'undefined' && !!out.captureStream,
    start({ caption = '', sub = '' } = {}) {
      Object.assign(state, { caption, sub });
      type = TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
      chunks = [];
      cube.onFrame = draw;
      draw();
      rec = new MediaRecorder(out.captureStream(60), { mimeType: type, videoBitsPerSecond: 10e6 });
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.start(250);
    },
    set caption(v) { state.caption = v; },
    stop() {
      return new Promise(resolve => {
        if (!rec) return resolve(null);
        rec.onstop = () => {
          cube.onFrame = null;
          resolve({ blob: new Blob(chunks, { type: type || 'video/webm' }), ext: type.includes('mp4') ? 'mp4' : 'webm' });
        };
        rec.stop();
        rec = null;
      });
    },
  };
}

export async function saveVideo({ blob, ext }, name = 'sixfold') {
  const file = new File([blob], `${name}.${ext}`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: 'Sixfold' }); return; } catch { /* fall through to download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
