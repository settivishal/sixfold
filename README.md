# Sixfold

**Live:** https://settivishal.github.io/sixfold/

A 3×3 cube studio for the browser (it also does 2×2 and 4×4). You can solve, learn, time, train and play, using the keyboard, mouse or touch, a camera, your hands, your voice, or a Bluetooth smart cube.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # logic checks (cube model, solvers, algorithms, voice parser)
npm run build    # static site in dist/
```

## What's inside
- **Play:** a Three.js cube in 2×2, 3×3 and 4×4.
  - You can drag a layer so it follows your finger, flick it, or type moves in two keyboard layouts.
  - Turns snap into place with a spring. A ring shows the next move, and there's a hint button.
- **Solve:**
  - The 3×3 uses Kociemba's two-phase algorithm in a Web Worker.
  - The 2×2 uses an optimal solver built on a full table of all 3.67 million states.
  - You can paint in your real cube or scan it with the camera.
- **Learn:** a beginner layer-by-layer lesson computed for your own scramble. Pieces that don't matter right now are dimmed, and the camera moves to show the layer you're working on.
- **Timer:**
  - WCA-style inspection, with real-cube and on-screen modes.
  - After an on-screen solve: CFOP splits, turns per second, a replay, and video export.
  - Race a ghost replay of your best solve.
  - A daily scramble that's the same for everyone.
  - A stats dashboard, plus csTimer import and export.
- **Train:** PLL and 2-look OLL drills and a recognition quiz. Every algorithm is machine-checked.
- **Patterns:** a gallery of classic patterns. The designer lets you paint on the 3D cube and get the moves that produce your design.
- **Connect:** MediaPipe hand tracking, Web Speech voice control, and GAN smart cubes over Web Bluetooth.
- **Extras:** themes, share links, and an offline-capable PWA.

See [PLAN.md](PLAN.md) for the design notes and roadmap.
