import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { parseMove, moveName } from './state.js';

// Live palette (mutated by setPalette so every importer sees the current colours)
export const COLORS = { U: '#f6f2ea', R: '#ff3355', F: '#16d68a', D: '#ffd23a', L: '#ff8a1e', B: '#3a7bff', '?': '#34343f' };

const GAP = 1.015;
const AXES = ['x', 'y', 'z'];
const Z = new THREE.Vector3(0, 0, 1);
const HALF_PI = Math.PI / 2;
const clamp01 = v => Math.min(1, Math.max(0, v));
const ease = {
  quart: t => 1 - (1 - t) ** 4,
  // ease-out with a ~4% overshoot: the "snap" of a real cube settling into place
  snap: t => 1 + 2.1 * (t - 1) ** 3 + 1.1 * (t - 1) ** 2,
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
};

function stickerGeometry(size = 0.8, r = 0.15) {
  const h = size / 2, s = new THREE.Shape();
  s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
  return new THREE.ExtrudeGeometry(s, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 3, curveSegments: 8 });
}

function glowTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
  stops.forEach(([o, col]) => grd.addColorStop(o, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export class Cube3D {
  constructor(el, { onMove, interactive = true } = {}) {
    this.el = el;
    this.size = 3;
    this.baseScale = 1;
    this.paintMode = false;
    this.onPaint = null;
    this.onFrame = null;
    this.hint = null;
    this.onMove = onMove;
    this.onSettle = null;
    this.speed = 1;
    this.queue = [];
    this.anim = null;
    this.grab = null;
    this.intro = null;
    this.cubies = [];
    this.focus = null;
    this.bursts = [];
    this.wobble = new THREE.Vector3();
    this.wobbleV = new THREE.Vector3();

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 0.95;
    el.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.environmentIntensity = 0.35;
    const key = new THREE.DirectionalLight('#fff6ea', 1.5); key.position.set(4, 9, 6);
    const rim = new THREE.DirectionalLight('#8f73ff', 2.2); rim.position.set(-7, 3, -5);
    const low = new THREE.DirectionalLight('#ff4d8d', 0.7); low.position.set(-3, -6, 5);
    this.scene.add(key, rim, low);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(5.6, 4.6, 7.6);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.07, enablePan: false, enableZoom: false, rotateSpeed: 0.6 });
    this.controls.addEventListener('start', () => (this.camPhi = null)); // the user's hand wins
    this.controls.enabled = interactive;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.scene.add(this.root);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({
      map: glowTexture([[0, 'rgba(0,0,0,.6)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false,
    }));
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({
      map: glowTexture([[0, 'rgba(150,110,255,.55)'], [0.4, 'rgba(255,77,141,.16)'], [1, 'rgba(0,0,0,0)']]),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.floor = [shadow, this.glow];
    for (const m of this.floor) { m.rotation.x = -HALF_PI; m.position.y = -2.5; this.scene.add(m); }
    this.dot = glowTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']], 64);

    this.bodyGeo = new RoundedBoxGeometry(0.985, 0.985, 0.985, 4, 0.12);
    this.bodyMat = new THREE.MeshPhysicalMaterial({ color: '#0c0c13', roughness: 0.45, metalness: 0.1, clearcoat: 0.4, clearcoatRoughness: 0.4 });
    this.stickerGeo = stickerGeometry();
    const mat = () => new THREE.MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.12 });
    this.mats = Object.fromEntries(Object.keys(COLORS).map(k => [k, mat()]));
    this.dimMats = Object.fromEntries(Object.keys(COLORS).map(k => [k, mat()]));
    this.blindMat = new THREE.MeshPhysicalMaterial({ color: '#1d1c2b', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
    this.blind = false;
    this.setPalette(COLORS);

    this.ray = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.spin = null;
    if (interactive) this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    r.setAnimationLoop(() => this.tick());
  }

  setPalette(colors, body) {
    Object.assign(COLORS, colors);
    const dark = new THREE.Color('#15151f');
    for (const [k, c] of Object.entries(COLORS)) {
      this.mats[k].color.set(c);
      this.mats[k].emissive.set(c);
      this.mats[k].emissiveIntensity = k === '?' ? 0 : 0.12;
      this.dimMats[k].color.set(c).lerp(dark, 0.86);
    }
    if (body) this.bodyMat.color.set(body);
  }

  // Rebuild all cubies from a CubeState, dropping any animation in flight.
  setState(state) {
    this.queue.length = 0;
    this.anim = null;
    this.grab = null;
    this.intro = null;
    this.pivot.rotation.set(0, 0, 0);
    for (const c of this.cubies) c.removeFromParent();
    this.size = state.size;
    this.baseScale = 3 / state.size; // every puzzle size fills the same space
    this.root.scale.setScalar(this.baseScale);
    this.setHint(null);
    const at = {};
    for (const s of state.stickers) (at[s.p] ??= []).push(s);
    this.cubies = Object.entries(at).map(([key, stickers]) => {
      const g = new THREE.Group();
      g.position.set(...key.split(',').map(Number)).multiplyScalar(GAP);
      g.userData.colors = stickers.map(s => s.c).sort().join('');
      g.add(new THREE.Mesh(this.bodyGeo, this.bodyMat));
      for (const s of stickers) {
        const n = new THREE.Vector3(...s.n);
        const k = COLORS[s.c] ? s.c : '?';
        const m = new THREE.Mesh(this.stickerGeo, this.mats[k]);
        m.userData.c = k;
        m.quaternion.setFromUnitVectors(Z, n);
        m.position.copy(n).multiplyScalar(0.478);
        g.add(m);
      }
      this.root.add(g);
      return g;
    });
    this.setFocus(this.focus);
  }

  // Dim every piece whose colour set fails `fn` (null = everything lit).
  setFocus(fn) {
    this.focus = fn;
    for (const g of this.cubies) {
      const lit = !fn || fn(g.userData.colors);
      for (const m of g.children) if (m.userData.c) m.material = this.blind ? this.blindMat : (lit ? this.mats : this.dimMats)[m.userData.c];
    }
  }

  // Blindfold: every sticker turns to smoked glass until it's lifted.
  setBlind(on) {
    this.blind = on;
    this.setFocus(this.focus);
  }

  // Pieces fly in from a scattered cloud and settle with a springy snap.
  assemble() {
    for (const c of this.cubies) {
      c.userData.home = c.position.clone();
      c.userData.q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      c.userData.delay = (c.position.length() / GAP) * 0.09 + Math.random() * 0.12;
    }
    this.intro = { t: 0 };
  }

  turn(tok) {
    const mv = parseMove(tok, this.size);
    if (mv) this.queue.push(mv);
  }

  get busy() { return !!this.anim || this.queue.length > 0 || !!this.grab || !!this.intro; }
  get grabbing() { return !!this.grab; }

  celebrate() {
    if (this.spin) return;
    this.spin = { t: 0 };
    this.burst();
  }

  burst(n = 260) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = [];
    const palette = ['U', 'R', 'F', 'D', 'L', 'B'].map(k => new THREE.Color(COLORS[k]));
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3().randomDirection();
      d.clone().multiplyScalar(1.3).toArray(pos, i * 3);
      vel.push(d.multiplyScalar(3 + Math.random() * 5).add(new THREE.Vector3(0, 2, 0)));
      palette[i % 6].toArray(col, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.14, map: this.dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(pts);
    this.bursts.push({ pts, vel, t: 0 });
  }

  startNext() {
    const mv = this.queue.shift(), ax = AXES[mv.axis];
    this.attachLayer(mv.axis, mv.layers);
    const backlog = this.queue.length;
    const base = (Math.abs(mv.turns) === 2 ? 0.3 : 0.21) / this.speed;
    this.anim = { ax, from: 0, to: mv.turns * HALF_PI, t: 0, dur: base / (1 + backlog * 0.7), ease: backlog ? ease.quart : ease.snap };
    this.kick(mv.axis, -Math.sign(mv.turns) * (backlog ? 0.12 : 0.3));
  }

  attachLayer(axis, layers) {
    for (const c of this.cubies) {
      const v = c.position[AXES[axis]] / GAP;
      if (layers.some(l => Math.abs(v - l) < 0.25)) this.pivot.attach(c);
    }
  }

  // Tiny counter-rotation of the whole cube, like the recoil of a real turn.
  kick(axis, amount) { this.wobbleV.setComponent(axis, this.wobbleV.getComponent(axis) + amount); }

  endAnim() {
    this.pivot.updateMatrixWorld();
    const m = new THREE.Matrix4();
    for (const c of [...this.pivot.children]) {
      this.root.attach(c);
      c.position.divideScalar(GAP).multiplyScalar(2).round().multiplyScalar(GAP / 2); // snap to the half-unit grid (even sizes)
      m.makeRotationFromQuaternion(c.quaternion);
      m.elements = m.elements.map(Math.round);
      c.quaternion.setFromRotationMatrix(m);
    }
    this.pivot.rotation.set(0, 0, 0);
    this.anim = null;
    if (!this.queue.length) this.onSettle?.();
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05), time = this.clock.elapsedTime;

    if (this.intro) {
      const it = this.intro;
      it.t += dt;
      let done = true;
      const id = new THREE.Quaternion();
      for (const c of this.cubies) {
        const u = c.userData, k = clamp01((it.t - u.delay) / 0.95);
        if (k < 1) done = false;
        const e = ease.back(k);
        c.position.copy(u.home).multiplyScalar(1 + (1 - e) * 1.7);
        c.position.y += (1 - e) * 0.8;
        c.quaternion.slerpQuaternions(u.q0, id, clamp01(e));
      }
      if (done) {
        for (const c of this.cubies) { c.position.copy(c.userData.home); c.quaternion.identity(); }
        this.intro = null;
        this.kick(1, 0.5);
      }
    }

    if (!this.anim && !this.grab && !this.intro && this.queue.length) this.startNext();
    const a = this.anim;
    if (a) {
      a.t = Math.min(1, a.t + dt / a.dur);
      this.pivot.rotation[a.ax] = a.from + (a.to - a.from) * a.ease(a.t);
      if (a.t === 1) this.endAnim();
    } else if (this.grab) {
      // follow the finger with a touch of lag so it feels weighty, not jittery
      const g = this.grab;
      g.shown += (g.angle - g.shown) * Math.min(1, dt * 28);
      this.pivot.rotation[AXES[g.k]] = g.shown;
    }

    // recoil spring
    const acc = this.wobble.clone().multiplyScalar(-260).addScaledVector(this.wobbleV, -16);
    this.wobbleV.addScaledVector(acc, dt);
    this.wobble.addScaledVector(this.wobbleV, dt);

    let glow = 0.85 + Math.sin(time * 1.3) * 0.15, spinY = 0;
    if (this.spin) {
      const s = this.spin;
      s.t = Math.min(1, s.t + dt / 1.8);
      spinY = ease.inOut(s.t) * Math.PI * 2;
      this.root.scale.setScalar(this.baseScale * (1 + Math.sin(s.t * Math.PI) * 0.08));
      glow += Math.sin(s.t * Math.PI) * 1.4;
      if (s.t === 1) this.spin = null;
    }
    this.root.rotation.set(this.wobble.x, spinY + this.wobble.y, this.wobble.z);
    this.glow.material.opacity = glow;
    this.root.position.y = Math.sin(time * 0.9) * 0.07;

    for (const b of [...this.bursts]) {
      b.t += dt;
      const p = b.pts.geometry.attributes.position;
      b.vel.forEach((v, i) => {
        v.multiplyScalar(1 - 2.2 * dt);
        v.y -= 2.5 * dt;
        p.array[i * 3] += v.x * dt; p.array[i * 3 + 1] += v.y * dt; p.array[i * 3 + 2] += v.z * dt;
      });
      p.needsUpdate = true;
      b.pts.material.opacity = 1 - b.t / 1.8;
      if (b.t > 1.8) {
        b.pts.removeFromParent();
        b.pts.geometry.dispose();
        b.pts.material.dispose();
        this.bursts.splice(this.bursts.indexOf(b), 1);
      }
    }

    if (this.camPhi != null) {
      const sp = new THREE.Spherical().setFromVector3(this.camera.position);
      sp.phi += (this.camPhi - sp.phi) * Math.min(1, dt * 3);
      this.camera.position.setFromSpherical(sp);
      if (Math.abs(this.camPhi - sp.phi) < 0.002) this.camPhi = null;
    }
    for (const m of this.floor) m.visible = this.camera.position.y > -1.5; // don't look up through the floor
    if (this.hint) {
      const u = this.hint.userData;
      u.spinner.rotation.z += dt * 1.6 * u.dir;
      u.mat.opacity = 0.65 + Math.sin(time * 5) * 0.25;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (!this.drawn) {
      this.drawn = true;
      performance.mark('sixfold:first-frame');
      // the soft reflections cost ~50 ms of shader work: add them once the cube is already on screen
      (window.requestIdleCallback ?? setTimeout)(() => {
        this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
      });
    }
    this.onFrame?.();
  }

  // A glowing ring around the layer that turns next, with arrowheads streaming the way it turns.
  setHint(tok) {
    if (this.hint) { this.hint.removeFromParent(); this.hint.traverse(o => o.geometry?.dispose()); this.hint = null; }
    const mv = tok && parseMove(tok, this.size);
    if (!mv) return;
    const h = (this.size - 1) / 2, whole = mv.layers.length === this.size;
    const R = (h + 0.5) * Math.SQRT2 * GAP + (whole ? 0.45 : 0.22);
    const mat = new THREE.MeshBasicMaterial({ color: '#e2d6ff', transparent: true, opacity: 0.9, depthWrite: false });
    const halo = new THREE.MeshBasicMaterial({ color: '#b28cff', transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
    const g = new THREE.Group(), spinner = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.028, 8, 128), mat));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.11, 8, 128), halo));
    const dir = Math.sign(mv.turns), count = Math.abs(mv.turns) === 2 ? 8 : 4;
    const cone = new THREE.ConeGeometry(0.15, 0.4, 18);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2, m = new THREE.Mesh(cone, mat);
      m.position.set(R * Math.cos(a), R * Math.sin(a), 0);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-Math.sin(a) * dir, Math.cos(a) * dir, 0));
      spinner.add(m);
    }
    g.add(spinner);
    const axis = new THREE.Vector3().setComponent(mv.axis, 1);
    g.quaternion.setFromUnitVectors(Z, axis);
    g.position.copy(axis).multiplyScalar((mv.layers.reduce((a, b) => a + b, 0) / mv.layers.length) * GAP);
    g.userData = { spinner, mat, dir };
    this.root.add(g);
    this.hint = g;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.el;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.position.setLength(12.5 * Math.max(1, 1.05 / this.camera.aspect));
    this.camera.updateProjectionMatrix();
  }

  // ---- pointer: grab a layer and turn it with your finger (also driven by hand tracking) ----
  bindPointer() {
    const el = this.renderer.domElement;
    // capture phase so we run before OrbitControls and can veto the orbit
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.pointerDown(e.clientX, e.clientY)) return;
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    }, true);
    let hoverQueued = false;
    el.addEventListener('pointermove', e => {
      this.pointerMove(e.clientX, e.clientY);
      if (this.drag || hoverQueued || e.pointerType !== 'mouse') return;
      hoverQueued = true;
      requestAnimationFrame(() => { hoverQueued = false; el.style.cursor = this.raycast(e.clientX, e.clientY) ? 'grab' : ''; });
    });
    const up = () => { this.pointerUp(); this.controls.enabled = true; el.style.cursor = ''; };
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  raycast(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera);
    const [hit] = this.ray.intersectObjects(this.cubies, true);
    if (!hit) return null;
    this.root.updateMatrixWorld();
    const inv = this.root.matrixWorld.clone().invert();
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inv);
    const k = [0, 1, 2].reduce((a, b) => (Math.abs(n.getComponent(b)) > Math.abs(n.getComponent(a)) ? b : a));
    return { n: new THREE.Vector3().setComponent(k, Math.sign(n.getComponent(k))), p: this.root.worldToLocal(hit.point.clone()), obj: hit.object };
  }

  // Page coordinates of a point given in cube units (used by the tour's ghost finger).
  screenPoint(p) {
    const r = this.renderer.domElement.getBoundingClientRect(), v = this.toScreen(new THREE.Vector3(...p).multiplyScalar(GAP));
    return { x: r.left + v.x, y: r.top + v.y };
  }

  toScreen(p) {
    const v = this.root.localToWorld(p.clone()).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.el.clientWidth, y: ((1 - v.y) / 2) * this.el.clientHeight };
  }

  pointerDown(x, y) {
    if (this.intro) return false;
    const hit = this.raycast(x, y);
    if (this.paintMode) {
      this.painting = !!hit;
      if (hit) this.paintAt(hit);
      return !!hit;
    }
    this.drag = hit && { x, y, ...hit };
    return !!hit;
  }

  pointerMove(x, y) {
    if (this.painting) { const hit = this.raycast(x, y); if (hit) this.paintAt(hit); return; }
    const d = this.drag;
    if (!d) return;
    const dx = x - d.x, dy = y - d.y;
    if (this.grab) {
      const g = this.grab, now = performance.now();
      const angle = (g.sgn * ((dx * g.dir.x + dy * g.dir.y) / g.px)) / ((this.size - 1) / 2 + 0.45); // arc length / radius
      g.vel = g.vel * 0.6 + ((angle - g.angle) / Math.max(1, now - g.at)) * 0.4;
      g.angle = angle;
      g.at = now;
      return;
    }
    if (d.done || dx * dx + dy * dy < 100) return;
    d.done = true;
    // which in-face axis does the drag follow on screen?
    let best = null;
    const a = this.toScreen(d.p);
    for (let k = 0; k < 3; k++) {
      if (d.n.getComponent(k)) continue;
      const t = new THREE.Vector3().setComponent(k, 1), b = this.toScreen(d.p.clone().add(t));
      const sx = b.x - a.x, sy = b.y - a.y, len = Math.hypot(sx, sy) || 1, dot = (dx * sx + dy * sy) / len;
      if (!best || Math.abs(dot) > Math.abs(best.dot)) best = { t, dot, sx: sx / len, sy: sy / len, len };
    }
    // pushing a face's surface along +t = positive rotation about n × t
    const axis = d.n.clone().cross(best.t);
    const k = [0, 1, 2].find(i => axis.getComponent(i));
    const sgn = axis.getComponent(k);
    const h = (this.size - 1) / 2;
    const layer = Math.max(-h, Math.min(h, Math.round(d.p.getComponent(k) / GAP + h) - h));
    if (this.busy) { // something is still animating: fall back to a discrete quarter turn
      this.onMove(moveName(k, layer, sgn * Math.sign(best.dot), this.size));
      return;
    }
    this.attachLayer(k, [layer]);
    this.grab = { k, layer, sgn, dir: { x: best.sx, y: best.sy }, px: best.len, angle: 0, shown: 0, vel: 0, at: performance.now() };
    this.pointerMove(x, y);
  }

  // Report which sticker (state coordinates) is under the pointer, for the pattern designer.
  paintAt(hit) {
    if (!hit.obj.userData.c) return;
    const cubie = hit.obj.parent.position.clone().divideScalar(GAP).multiplyScalar(2).round().divideScalar(2);
    this.onPaint?.(hit.n.toArray().map(Math.round), cubie.toArray());
  }

  pointerUp() {
    this.painting = false;
    this.drag = null;
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    // a quick flick carries the layer on to the next quarter
    const flick = Math.max(-0.6, Math.min(0.6, g.vel * 110)); // at most ~⅓ of a turn of momentum
    const q = Math.max(-2, Math.min(2, Math.round((g.angle + flick) / HALF_PI)));
    const to = q * HALF_PI;
    this.anim = { ax: AXES[g.k], from: g.shown, to, t: 0, dur: (0.12 + 0.12 * Math.min(1, Math.abs(to - g.shown) / HALF_PI)) / this.speed, ease: ease.snap };
    if (!q) return;
    this.kick(g.k, -Math.sign(q) * 0.25);
    const name = moveName(g.k, g.layer, Math.sign(q), this.size);
    this.onMove(Math.abs(q) === 2 ? name.replace("'", '') + '2' : name, { animated: true });
  }

  // Glide the camera to a polar angle (0 = straight above, π/2 = level, > π/2 = from below).
  lookFrom(phi) { this.camPhi = phi; }

  orbitBy(dx, dy) {
    const s = new THREE.Spherical().setFromVector3(this.camera.position);
    s.theta -= dx * 0.008;
    s.phi = Math.min(Math.PI - 0.2, Math.max(0.2, s.phi - dy * 0.008));
    this.camera.position.setFromSpherical(s);
    this.camera.lookAt(0, 0, 0);
  }
}
