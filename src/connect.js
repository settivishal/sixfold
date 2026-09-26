// Voice control (Web Speech API) and GAN smart cubes (Web Bluetooth).

const FACE_WORDS = {
  right: 'R', are: 'R', our: 'R', r: 'R', left: 'L', l: 'L', el: 'L', elle: 'L',
  up: 'U', top: 'U', upper: 'U', you: 'U', u: 'U', down: 'D', bottom: 'D', d: 'D', dee: 'D',
  front: 'F', f: 'F', eff: 'F', back: 'B', b: 'B', bee: 'B', be: 'B',
  middle: 'M', m: 'M', equator: 'E', standing: 'S', x: 'x', ex: 'x', y: 'y', why: 'y', z: 'z', zed: 'z', zee: 'z',
};
const PRIME = new Set(['prime', 'primes', 'inverse', 'inverted', 'counter', 'counterclockwise', 'anticlockwise', 'reverse', 'apostrophe', 'dash']);
const DOUBLE = new Set(['two', '2', 'double', 'twice', 'to', 'too']);
const COMMANDS = ['scramble', 'solve', 'undo', 'redo', 'reset', 'play', 'pause', 'stop', 'next'];

// "right up right prime up prime" -> [{ move: 'R' }, { move: 'U' }, { move: "R'" }, ...]; commands pass through.
export function parseSpeech(text) {
  const words = text.toLowerCase().replace(/[’']/g, ' prime ').replace(/\b([a-z])2\b/g, '$1 2').split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (COMMANDS.includes(w)) { out.push({ command: w === 'stop' ? 'pause' : w }); continue; }
    const face = FACE_WORDS[w];
    if (!face) continue;
    let mv = face;
    if (PRIME.has(words[i + 1])) { mv += "'"; i++; } else if (DOUBLE.has(words[i + 1])) { mv += '2'; i++; }
    out.push({ move: mv });
  }
  return out;
}

export function initConnect({ move, command, setCube, toast }) {
  const $ = id => document.getElementById(id);

  // ---- voice ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = $('voice-start'), heard = $('voice-heard');
  let rec = null, listening = false;
  if (!SR) {
    voiceBtn.disabled = true;
    heard.textContent = 'Speech recognition isn’t available in this browser — try Chrome, Edge or Safari.';
  }
  voiceBtn.addEventListener('click', () => {
    if (listening) { listening = false; rec?.stop(); voiceBtn.textContent = 'Start listening'; voiceBtn.classList.remove('live'); return; }
    rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      const r = e.results[e.results.length - 1], text = r[0].transcript.trim();
      heard.textContent = `“${text}”`;
      if (!r.isFinal) return;
      for (const a of parseSpeech(text)) a.move ? move(a.move) : command(a.command);
    };
    rec.onerror = e => { if (e.error === 'not-allowed') { listening = false; heard.textContent = 'Microphone permission was denied.'; } };
    rec.onend = () => { if (listening) rec.start(); }; // Chrome stops after a pause; keep going
    rec.start();
    listening = true;
    voiceBtn.textContent = 'Stop listening';
    voiceBtn.classList.add('live');
    heard.textContent = 'Listening… try “right, up, right prime”.';
  });

  // ---- GAN smart cube ----
  const ganBtn = $('gan-connect'), ganMsg = $('gan-msg'), ganReset = $('gan-reset'), mac = $('gan-mac');
  let conn = null, synced = false;
  const say = (t, cls = '') => { ganMsg.textContent = t; ganMsg.className = 'msg ' + cls; };
  ganBtn.addEventListener('click', async () => {
    if (conn) { await conn.disconnect(); return; }
    if (!navigator.bluetooth) return say('Web Bluetooth needs Chrome or Edge (desktop or Android).', 'bad');
    ganBtn.classList.add('busy');
    try {
      const { connectGanCube } = await import('gan-web-bluetooth');
      conn = await connectGanCube(async (_device, isFallback) =>
        isFallback ? mac.value.trim() || prompt('Your cube’s MAC address (shown in the GAN app), e.g. AB:12:34:56:78:9A') : null);
      synced = false;
      conn.events$.subscribe(ev => {
        if (ev.type === 'MOVE' && synced) move(ev.move);
        else if (ev.type === 'FACELETS' && !synced) { synced = true; setCube(ev.facelets); }
        else if (ev.type === 'BATTERY') say(`Connected to ${conn.deviceName} · battery ${ev.batteryLevel}%`, 'good');
        else if (ev.type === 'DISCONNECT') {
          conn = null;
          ganBtn.textContent = 'Connect cube';
          ganReset.hidden = true;
          say('Cube disconnected.');
        }
      });
      await conn.sendCubeCommand({ type: 'REQUEST_FACELETS' });
      await conn.sendCubeCommand({ type: 'REQUEST_BATTERY' });
      ganBtn.textContent = 'Disconnect';
      ganReset.hidden = false;
      say(`Connected to ${conn.deviceName}`, 'good');
      toast('Smart cube connected ✦');
    } catch (e) {
      conn = null;
      if (e.name !== 'NotFoundError') say(`Couldn’t connect: ${e.message}`, 'bad'); // NotFoundError = picker cancelled
    }
    ganBtn.classList.remove('busy');
  });
  ganReset.addEventListener('click', async () => {
    await conn?.sendCubeCommand({ type: 'REQUEST_RESET' });
    setCube();
    toast('Cube state reset to solved');
  });
}
