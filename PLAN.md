# Sixfold: a 3×3 cube studio

Run it with `npm install`, then `npm run dev` (opens at http://localhost:5173). Other scripts: `npm test` runs the logic checks and `npm run build` produces a static site in `dist/` you can deploy to any static host.

## Art direction
- **Mood:** a nocturne. The background is deep ink with slowly drifting aurora light (indigo, rose, teal), a faint dot grid and film grain.
- **Type:** *Instrument Serif* for display headlines, with italic accents in a prism gradient. *Geist* for the interface and *Geist Mono* for notation and times.
- **Surfaces:** frosted-glass panels with hairline borders, pill buttons, and keycaps that look like real keys.
- **Cube:** rounded, clear-coated cubies with softly beveled stickers, lit by a warm key light and violet and rose rims. A glow pool sits under the cube, it floats gently when idle, and it does a celebratory spin when solved.

## Built (v1)
| Area | What it does | Where |
|---|---|---|
| 3D cube | Three.js scene with animated turns (face, slice, wide and rotation moves) and orbit | `src/cube3d.js` |
| Cube model | Sticker-level state, notation parser, inverse, and a solvability check that explains what is wrong (twisted corner, flipped edge, swapped pieces) | `src/state.js` |
| Keyboard | Two schemes: *Notation* (letter = clockwise, Shift = prime) and *Speedcuber* (the csTimer layout). ⌘/Ctrl‑Z undoes, ⇧ redoes, `?` opens a visual keyboard map | `src/main.js` |
| Mouse / touch | Drag a sticker to turn its layer; drag empty space to orbit | `src/cube3d.js` |
| Solver | Kociemba two-phase (cubejs) in a Web Worker. Plays back step by step with play, pause, step and rewind, and ←/→ keys | `src/solver.worker.js` |
| Paint-in | A 2D net editor for copying a real cube. Painting live-updates the 3D cube and validates as you go | `src/main.js` |
| Camera scan | Walks you through all 6 faces and samples a 3×3 grid. Each sticker is classified against the centres in Lab colour space, with exactly 9 of each colour | `src/scan.js` |
| Hand tracking | MediaPipe HandLandmarker. The pinch point becomes a cursor, and a pinch-drag acts like a mouse drag (turns a face, or orbits on empty space). It works in every mode | `src/gesture.js` |
| Timer | WCA-style hold-to-start with optional 15 s inspection (+2 / DNF). *Real cube* and *on-screen* modes, random-state scrambles, best / Ao5 / Ao12 / Ao100 / mean, a trend sparkline, +2 / DNF / delete, and localStorage history | `src/timer.js`, `src/stats.js` |
| Patterns | 10 classic patterns with isometric thumbnails. Each one animates from solved | `src/main.js` |
| Polish | Plastic click sound and solve chime (both can be muted), toasts, reduced-motion support, and a mobile layout (stage on top, panel as a bottom sheet) | |

## Built (v2)
| Area | What it does | Where |
|---|---|---|
| Motion | Drag-to-follow: the layer tracks your finger, snaps into place with a spring, and a quick flick carries it to the next quarter. Turns snap with a ~4% overshoot and the whole cube recoils slightly. On load the pieces fly in and assemble. A solve triggers a sparkle burst and a spin. Mode switches use View Transitions, and the 3D stage never freezes during them | `src/cube3d.js`, `src/style.css` |
| Learn | A real beginner (layer-by-layer) solver, computed for the cube in front of you. It builds an optimal white cross with IDA*, then runs short searches over only the algorithms a beginner knows (R U R′ U′, the edge inserts, F R U R′ U′ F′, Sune, Niklas, R′ D′ R D). Pieces that don't matter in the current stage are dimmed. The camera glides underneath for the first layer, and playback pauses between stages. Tested on 200 random scrambles, average 9 ms | `src/learn.js` |
| Trainer | 21 PLLs plus 2-look OLL (10 cases), every algorithm machine-checked. Top-view diagrams with PLL arrows, timed drills with random AUF and per-case bests, a recognition quiz with streaks, "Show me" | `src/algs.js`, `src/train.js` |
| Reconstruction | Every on-screen timed solve is recorded. You get auto-detected CFOP splits (cross / F2L / OLL / PLL) with times and move counts, TPS, and a replay in real time | `src/timer.js`, `src/learn.js` |
| Daily challenge | The same seeded random-state scramble for everyone each day, with a Wordle-style result card to share | `src/timer.js`, `src/solver.worker.js` |
| Connect | Hand tracking, voice control ("right, up, right prime", "scramble", "solve"…), and GAN Bluetooth smart cubes (live state sync, drives the timer and trainer) | `src/gesture.js`, `src/connect.js` |
| Themes | 5 sticker palettes (including a colour-blind-safe one) and 3 body finishes, applied to the 3D cube and every 2D view | `src/theme.js` |
| Share | A link to the exact current cube (`?cube=…`), with the Web Share sheet on phones | `src/main.js` |
| PWA | Installable and works offline (stale-while-revalidate service worker) | `public/` |

## Built (v3)
| Area | What it does | Where |
|---|---|---|
| 2×2 and 4×4 | One sticker model for any N×N (coordinates ±h, half-units on even sizes). The 3×3 behaves byte-identically, verified against cubejs. 4×4 notation: `Rw`, `r`, `2R`, `3Rw`. A puzzle switcher sits in the top bar. Modes that are 3×3-only switch the puzzle automatically | `src/state.js`, `src/cube3d.js` |
| 2×2 solver | An optimal solver built on a complete distance table: 5040 × 729 states computed in about 0.2 s, with solutions of 11 moves or fewer. Random-state 2×2 scrambles, and WCA-style random-move scrambles for the 4×4 | `src/pocket.js`, `src/solver.worker.js` |
| Move arrows | A glowing ring around the next layer, with arrowheads streaming in the turn direction (and double arrowheads for half turns). Used in solve playback, lessons and the Hint button | `src/cube3d.js` (`setHint`) |
| Pattern designer | Paint directly onto the 3D cube (tap or drag). The solver then finds the algorithm that builds your design from solved, and you can save it to your own gallery | `src/main.js` |
| Video export | A 1080×1080 MP4 or WebM composite: the live 3D view plus the backdrop, wordmark and a running clock. Record anything from the top bar, or export a solve replay from the timer | `src/record.js` |
| Stats dashboard | KPI tiles, every solve with rolling Ao5/Ao12 (colours validated for colour blindness), a histogram with the mean, a 26-week practice calendar, a table view, and csTimer JSON import/export plus CSV | `src/statsview.js` |
| Ghost race | Your best on-screen solve (or today's daily best) replays in a picture-in-picture cube that starts with you, and you're told who won and by how much | `src/timer.js` |

## Roadmap (next)
1. Full OLL (57) and F2L case sets in the trainer. The validation harness in `test/` already covers new algorithms.
2. A 4×4 solver (reduction: centres, then edge pairing, then 3×3 with parity).
3. Other smart cubes (GoCube, Giiker, MoYu) and GAN smart timers.
4. Multiplayer race over WebRTC, sharing the same daily scramble.
5. Self-host the MediaPipe wasm and model for fully offline hand tracking.
