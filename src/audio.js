// Sound engine. Everything flows through one master bus, which feeds both the speakers and a
// recordable stream (so exported videos carry the sound). Modes: 'off' | 'click' | 'music'.
//
// Musical turns: every face owns a note of a C-major pentatonic scale, so any solve plays a
// melody that can never clash. A prime turn drops a fourth; a half turn plays the note twice.
const NOTE = { U: 523.25, R: 587.33, F: 659.25, D: 392.0, L: 440.0, B: 783.99 }; // C5 D5 E5 G4 A4 G5

export function noteFor(tok) {
  const face = tok.replace(/^\d/, '')[0].toUpperCase();
  if (!NOTE[face]) return null; // slices and rotations get a soft chord instead
  return { hz: tok.includes("'") ? NOTE[face] * 0.75 : NOTE[face], twice: tok.includes('2') };
}

export function createAudio(store) {
  let mode = store.get('soundMode', store.get('sound', true) === false ? 'off' : 'click');
  let ctx = null, master = null, tape = null, clickBuf = null, reverb = null, lastChime = 0;

  function boot() {
    if (ctx) return ctx;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    tape = ctx.createMediaStreamDestination();
    master.connect(tape);
    // a short synthetic room: exponentially decaying noise as the impulse response
    const len = ctx.sampleRate * 1.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    reverb = ctx.createConvolver();
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    reverb.connect(wet).connect(master);
    clickBuf = ctx.createBuffer(1, 2400, 44100);
    const d = clickBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 8;
    return ctx;
  }

  function click(gain = 0.55) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = clickBuf;
    f.type = 'bandpass';
    f.frequency.value = 1500 + Math.random() * 900;
    f.Q.value = 1.1;
    g.gain.value = gain;
    src.connect(f).connect(g).connect(master);
    src.start();
  }

  // a soft FM bell: sine carrier, sine modulator, fast attack, long tail into the room
  function bell(hz, at = ctx.currentTime, level = 0.16, length = 1.1) {
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), modGain = ctx.createGain(), env = ctx.createGain();
    car.frequency.value = hz;
    mod.frequency.value = hz * 2.01;
    modGain.gain.setValueAtTime(hz * 1.2, at);
    modGain.gain.exponentialRampToValueAtTime(hz * 0.05, at + length);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    mod.connect(modGain).connect(car.frequency);
    car.connect(env);
    env.connect(master);
    env.connect(reverb);
    car.start(at);
    mod.start(at);
    car.stop(at + length + 0.05);
    mod.stop(at + length + 0.05);
  }

  return {
    get mode() { return mode; },
    setMode(m) { mode = m; store.set('soundMode', m); },
    turn(tok) {
      if (mode === 'off') return;
      boot();
      if (mode === 'click') return click();
      click(0.18);
      const n = noteFor(tok);
      if (!n) return [392, 523.25].forEach(hz => bell(hz, ctx.currentTime, 0.07, 0.8));
      bell(n.hz);
      if (n.twice) bell(n.hz, ctx.currentTime + 0.11, 0.12);
    },
    chime() {
      if (mode === 'off' || !ctx || performance.now() - lastChime < 1500) return;
      lastChime = performance.now();
      [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => bell(hz, ctx.currentTime + i * 0.09, 0.13, 1.6));
    },
    // live audio track for the video recorder (null until the first sound has played)
    stream: () => (ctx ? tape.stream : null),
  };
}
