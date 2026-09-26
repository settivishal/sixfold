// Hand tracking: MediaPipe finds 21 hand landmarks per frame; the thumb–index midpoint
// becomes a cursor over the stage and a pinch acts as a mouse button on the cube.
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const clamp = v => Math.min(1, Math.max(0, v));

export function initGesture({ cube, stage }) {
  const $ = id => document.getElementById(id);
  const video = $('hand-video'), canvas = $('hand-overlay'), ctx = canvas.getContext('2d');
  const btn = $('hand-start'), msg = $('hand-msg'), cursor = $('hand-cursor');
  let landmarker = null, stream = null, raf = 0, lastT = -1, pinched = false, orbit = null, cur = null;

  const say = (text, cls = '') => { msg.textContent = text; msg.className = 'msg ' + cls; };

  async function start() {
    if (stream) return stop();
    btn.classList.add('busy');
    say('Loading the hand model (about 8 MB, once)…');
    try {
      if (!landmarker) {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const files = await FilesetResolver.forVisionTasks(WASM);
        landmarker = await HandLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
      video.srcObject = stream;
      await video.play();
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      $('hand-empty').hidden = true;
      btn.textContent = 'Stop hand tracking';
      say('Show your hand to the camera ✋');
      loop();
    } catch (e) {
      say(e.name === 'NotAllowedError' ? 'Camera permission was denied.' : `Couldn’t start tracking: ${e.message}`, 'bad');
      stop();
    }
    btn.classList.remove('busy');
  }

  function stop() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;
    release();
    cursor.classList.remove('on');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    $('hand-empty').hidden = false;
    btn.textContent = 'Enable hand tracking';
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (video.currentTime === lastT) return;
    lastT = video.currentTime;
    track(landmarker.detectForVideo(video, performance.now()).landmarks?.[0]);
  }

  function release() {
    if (!pinched) return;
    pinched = false;
    orbit = null;
    cube.pointerUp();
  }

  function track(lm) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!lm) {
      cursor.classList.remove('on');
      release();
      cur = null;
      return;
    }
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const ratio = d(lm[4], lm[8]) / d(lm[0], lm[9]); // pinch distance relative to palm size
    const pinch = pinched ? ratio < 0.45 : ratio < 0.28; // hysteresis so it doesn't flicker

    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = pinch ? '#ff5c8a' : 'rgba(185,164,255,.9)';
    for (const [a, b] of BONES) {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 3.5, 0, Math.PI * 2); ctx.fill(); }

    // mirror x (the preview is a mirror) and map the comfortable middle of the frame onto the stage
    const r = stage.getBoundingClientRect();
    const px = 1 - (lm[4].x + lm[8].x) / 2, py = (lm[4].y + lm[8].y) / 2;
    const tx = r.left + clamp((px - 0.2) / 0.6) * r.width, ty = r.top + clamp((py - 0.15) / 0.6) * r.height;
    cur = cur ? { x: cur.x + (tx - cur.x) * 0.45, y: cur.y + (ty - cur.y) * 0.45 } : { x: tx, y: ty };
    cursor.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
    cursor.classList.add('on');
    cursor.classList.toggle('pinch', pinch);

    if (pinch && !pinched) {
      pinched = true;
      orbit = cube.pointerDown(cur.x, cur.y) ? null : { ...cur };
    } else if (pinch && orbit) {
      cube.orbitBy(cur.x - orbit.x, cur.y - orbit.y);
      orbit = { ...cur };
    } else if (pinch) {
      cube.pointerMove(cur.x, cur.y);
    } else release();
  }

  btn.addEventListener('click', start);
}
