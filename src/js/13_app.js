// ───────────────────────── 13 · APP CORE (state, rendering, transitions, jobs) ─────────────────────────
const S = {
  view: 'boot', siteId: null, sc: null,
  band: 'L', mode: 'phase', exag: 1000, geom: 'asc', pair: 'cum',
  t: 0, playing: false, speed: 1,
  layers: { aps: true, vectors: false, canopy: true, beam: true, subsurface: true, cycle: false, labels: true, mask: true },
  hover: null, pin: null, lens: { x: 0, z: 0, r: 7.5 },
  tool: null, slice: null, profile: null,
  unwrap: null, ccd: null,
  satS: -80, beamOpacity: 0, acquiring: false,
  split: false, defoRange: 0.05, defoStep: 0.01,
  shake: 0, busy: false, tour: false,
  deploy: 1, deploying: false, satCam: false,
};
const App = { scenes: {}, metas: {}, time: 0, frames: 0, fpsT: 0 };
const EXAG_MAX = 5000;
const exagFromSlider = (v) => Math.pow(10, (v / 1000) * Math.log10(EXAG_MAX));
const sliderFromExag = (x) => Math.round(Math.log10(clamp(x, 1, EXAG_MAX)) / Math.log10(EXAG_MAX) * 1000);

/** renders the 3D view and (in split mode) the GPU 2D radar map into one target */
class StagePass extends Pass {
  constructor() { super(); this.needsSwap = false; this.clear = true; }
  render(renderer, writeBuffer, readBuffer) {
    const target = this.renderToScreen ? null : readBuffer;
    const view = App.activeScene();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x02050a, 1);
    renderer.clear();
    if (!(S.split && S.view === 'terrain' && target)) { renderer.render(view.scene, App.camera); return; }
    const W = target.width, H = target.height, half = Math.floor(W / 2);
    const narrow = App.narrow, inset = narrow ? 0 : Math.min(Math.floor((App.splitInset || 0) * W), half - 64);
    const vp3 = narrow ? [0, 0, W, Math.floor(H / 2)] : [half, 0, W - half, H];
    const vp2 = narrow ? [0, Math.floor(H / 2), W, H - Math.floor(H / 2)] : [inset, 0, half - inset, H];
    target.scissorTest = true;
    target.viewport.set(...vp3); target.scissor.set(...vp3); renderer.setRenderTarget(target);
    renderer.render(view.scene, App.camera);
    App.world.U.uFlat.value = 1;
    target.viewport.set(...vp2); target.scissor.set(...vp2); renderer.setRenderTarget(target);
    renderer.render(view.scene, App.ortho);
    App.world.U.uFlat.value = 0;
    target.viewport.set(0, 0, W, H); target.scissor.set(0, 0, W, H); target.scissorTest = false;
    renderer.setRenderTarget(target);
  }
}

function initRenderer() {
  const canvas = $('#gl');
  const gl2 = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  if (!gl2) throw new Error('WebGL 2 is not available in this browser. Please use a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl2, antialias: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = true;
  App.dprCap = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(App.dprCap);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  App.renderer = renderer;
  App.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 4000);
  App.ortho = new THREE.OrthographicCamera(-55, 55, 55, -55, 0.1, 1000);
  App.ortho.position.set(0, 400, 0); App.ortho.up.set(0, 0, -1); App.ortho.lookAt(0, 0, 0); App.ortho.layers.set(1);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  App.stage = new StagePass();
  App.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.72, 0.5, 0.8);
  App.post = new ShaderPass({ uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uWarp: { value: 0 }, uFlash: { value: 0 }, uCA: { value: 0.0016 }, uVig: { value: 0.5 }, uGrain: { value: 0.035 }, uRes: { value: new THREE.Vector2(size.x, size.y) } }, vertexShader: POST_VS, fragmentShader: POST_FS });
  composer.addPass(App.stage); composer.addPass(App.bloom); composer.addPass(App.post);
  App.composer = composer;
  App.controls = new OrbitControls(App.camera, canvas);
  Object.assign(App.controls, { enableDamping: true, dampingFactor: 0.07, minDistance: 14, maxDistance: 260, maxPolarAngle: Math.PI * 0.495, rotateSpeed: 0.6, zoomSpeed: 0.9, panSpeed: 0.8 });
  App.controls.enabled = false;
  App.gcontrols = new OrbitControls(App.camera, canvas);
  Object.assign(App.gcontrols, { enableDamping: true, dampingFactor: 0.06, minDistance: 13.5, maxDistance: 70, enablePan: false, autoRotate: true, autoRotateSpeed: 0.35, rotateSpeed: 0.5 });
  App.gcontrols.enabled = false;
  App.activeScene = () => (S.view === 'terrain' ? App.world : App.globe);
  onResize();
}
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  App.narrow = w < 900;
  App.renderer.setSize(w, h, false);
  const size = App.renderer.getDrawingBufferSize(new THREE.Vector2());
  App.composer.setSize(w, h);
  App.post.uniforms.uRes.value.set(size.x, size.y);
  updateCameraAspect();
}
function updateCameraAspect() {
  const w = window.innerWidth, h = window.innerHeight;
  if (S.view !== 'terrain' && w > 900) App.camera.setViewOffset(w, h, -w * 0.13, h * 0.11, w, h);
  else App.camera.clearViewOffset();
  const split = S.split && S.view === 'terrain';
  // the 2D map starts right of the control dock so nothing covers it
  const dock = document.getElementById('dock-left');
  App.splitInset = split && !App.narrow && dock ? (dock.getBoundingClientRect().right + 10) / w : 0;
  let a3 = w / h, a2 = 1;
  if (split) { if (App.narrow) { a3 = w / (h / 2); a2 = w / (h / 2); } else { a3 = (w / 2) / h; a2 = (w / 2 - App.splitInset * w) / h; } }
  App.camera.aspect = a3; App.camera.updateProjectionMatrix();
  const half = 54;
  if (a2 >= 1) Object.assign(App.ortho, { left: -half * a2, right: half * a2, top: half, bottom: -half });
  else Object.assign(App.ortho, { left: -half, right: half, top: half / a2, bottom: -half / a2 });
  App.ortho.updateProjectionMatrix();
}

// ───────────── state helpers ─────────────
/** update the #site hash without reloading; tolerant of sandboxed frames */
function safeHash(id) {
  try { history.replaceState(null, '', id ? '#' + id : location.pathname + location.search); }
  catch (e) { try { App.ignoreHash = true; location.hash = id; } catch (e2) { /* not allowed here: ignore */ } }
}
function tRefOf() { return S.pair === 'seq' ? Math.max(0, S.t - CFG.repeatDays) : 0; }
function currentCtx() {
  const sc = S.sc;
  const geomObj = sc.geom[S.geom === 'desc' ? 'desc' : 'asc'];
  const C = timeCtx(sc, { tRef: tRefOf(), tCur: S.t, X: S.exag, geomObj, bandEff: S.band === 'S' ? 'S' : 'L', aps: S.layers.aps });
  // cumulative = time series (SBAS-style) built from short pairs: decorrelation of the ≤ 24-day network, not of one long pair
  if (S.pair === 'cum') C.dt = Math.min(C.dt, 24);
  C.geomFusion = S.geom === 'fusion';
  C.defoRange = S.defoRange;
  C.mask = S.layers.mask;
  return C;
}
function bandAtInspector() { return S.band === 'S' ? 'S' : 'L'; }
function markStale() {
  if (S.unwrap && S.unwrap.done) { S.unwrap = null; App.world.U.uUnwOn.value = 0; App.world.U.uUnwGate.value = 0; }
}
function setTime(t, { stopPlay = false } = {}) {
  const nt = clamp(t, 0, CFG.tMax);
  if (Math.abs(nt - S.t) > 1e-6) markStale();
  S.t = nt;
  if (stopPlay) S.playing = false;
  Bus.emit('time');
}

// ───────────── scene switching ─────────────
async function enterSite(id, { fromGlobe = false } = {}) {
  if (S.busy) return;
  if (S.satCam) leaveSatCamNow();
  S.busy = true;
  Sound.whoosh(1.2, true);
  const sc = App.scenes[id];
  if (!sc.exagMax) sc.exagMax = computeExagMax(sc);
  closeOverlay('deck');
  if (S.view === 'terrain' && S.sc) {
    const U = App.world.U;
    await Tweens.add(0.55, (e) => { U.uReveal.value = lerp(160, 0, e); }, Ease.inCubic, 'reveal');
  }
  if (fromGlobe) await diveFromGlobe(id);
  clearTools();
  S.siteId = id; S.sc = sc; S.hover = null;
  const tip = $('#cursor-tip'); if (tip) tip.style.display = 'none';
  App.world.load(sc);
  const site = sc.site;
  Object.assign(S, { exag: site.exag, band: 'L', mode: 'phase', geom: 'asc', pair: sc.kind === 'wetland' ? 'seq' : 'cum', t: sc.kind === 'wetland' ? 108 : 0, playing: true, speed: 1, pin: { ...sc.poi }, hover: null, satS: -82, acquiring: true });
  S.layers.vectors = false;
  if (sc.kind === 'wetland') S.band = 'X';
  S.lens = { x: sc.grid.ij2xz(sc.poi.i, sc.poi.j).x, z: sc.grid.ij2xz(sc.poi.i, sc.poi.j).z, r: 9 };
  computeDefoScale(true);
  App.world.U.uReveal.value = 0;
  App.world.U.uAcq.value = -1e4;
  S.view = 'terrain';
  setViewUI('terrain');
  setSiteUI(sc);
  syncControls();
  buildSiteLabels();
  // camera: start high above, fly down to the site preset
  const cam = site.cam, target = V3(...cam.target), end = V3(...cam.pos);
  const start = end.clone().multiplyScalar(1.9).add(V3(0, 90, 0));
  App.camera.position.copy(start);
  App.controls.target.copy(target);
  App.controls.enabled = false; App.gcontrols.enabled = false;
  updateCameraAspect();
  const U = App.world.U;
  Tweens.add(2.6, (e) => { U.uReveal.value = lerp(0, 165, e); }, Ease.outCubic, 'reveal');
  await Tweens.add(3.0, (e) => { App.camera.position.lerpVectors(start, end, e); App.camera.lookAt(target); }, Ease.inOutQuint, 'cam');
  App.controls.enabled = true;
  S.busy = false;
  if (location.hash.slice(1) !== id) safeHash(id);
  Bus.emit('site', id);
}
async function diveFromGlobe(id) {
  const G = App.globe;
  App.gcontrols.enabled = false; App.gcontrols.autoRotate = false;
  $('#globe-hud').classList.add('off');
  for (const it of Labels.items) if (!it.el.textContent.includes(SITES[id].name)) it.el.classList.add('dim');
  const p = G.siteWorld(id), dir = p.clone().normalize();
  const from = App.camera.position.clone();
  const mid = dir.clone().multiplyScalar(GLOBE_R * 1.55);
  G.U.uHi.value.copy(dir.clone().applyAxisAngle(V3(0, 1, 0), -G.earth.rotation.y)); G.U.uHiOn.value = 1;
  const speed0 = G.speed; G.speed = 0;
  await Tweens.add(1.5, (e) => { App.camera.position.lerpVectors(from, mid, e); App.camera.lookAt(0, 0, 0); }, Ease.inOutCubic, 'cam');
  const end = dir.clone().multiplyScalar(GLOBE_R * 1.012);
  Sound.whoosh(1.0, true);
  await Tweens.add(1.0, (e) => {
    App.camera.position.lerpVectors(mid, end, e); App.camera.lookAt(p);
    App.post.uniforms.uWarp.value = e * e * 6; App.post.uniforms.uFlash.value = smoothstep(0.75, 1, e);
  }, Ease.inCubic, 'cam');
  G.U.uHiOn.value = 0; G.speed = speed0;
  Tweens.add(0.9, (e) => { App.post.uniforms.uWarp.value = (1 - e) * 6; App.post.uniforms.uFlash.value = 1 - e; }, Ease.outCubic, 'flash');
}
async function toGlobe({ instant = false } = {}) {
  if (S.busy && !instant) return;
  S.busy = true;
  clearTools();
  if (S.satCam) leaveSatCamNow();
  S.playing = false;
  if (S.view === 'terrain' && !instant) {
    Sound.whoosh(1.0, false);
    await Tweens.add(0.6, (e) => { App.world.U.uReveal.value = lerp(165, 0, e); App.post.uniforms.uFlash.value = e * 0.8; }, Ease.inCubic, 'reveal');
  }
  S.view = 'globe'; S.siteId = null; S.split = false; document.body.classList.remove('split');
  setViewUI('globe');
  updateCameraAspect();
  App.controls.enabled = false;
  const from = V3(0, 30, 130), to = V3(-8, 12, 45);
  App.camera.position.copy(from); App.camera.lookAt(0, 0, 0);
  App.gcontrols.target.set(0, 0, 0);
  Tweens.add(0.9, (e) => { App.post.uniforms.uFlash.value = (1 - e) * 0.8; }, Ease.outCubic, 'flash');
  await Tweens.add(instant ? 3.2 : 2.2, (e) => { App.camera.position.lerpVectors(from, to, e); App.camera.lookAt(0, 0, 0); }, Ease.inOutCubic, 'cam');
  App.gcontrols.enabled = true; App.gcontrols.autoRotate = true;
  S.busy = false;
  if (location.hash) safeHash('');
  Bus.emit('site', null);
}

// ───────────── deformation colour scale ─────────────
/** largest exaggeration that keeps the displaced mesh within ~12 world units (otherwise geometry folds over) */
function computeExagMax(sc) {
  const N = sc.N, f = sc.flags, w = basisW(sc, CFG.tMax), w0 = basisW(sc, 0);
  let mH = 1e-6, mV = 1e-6;
  for (let k = 0; k < N * N; k += 3) {
    let e = 0, n = 0, u = 0;
    for (let b = 0; b < sc.bases.length; b++) {
      if (!f.mesh[b] || !f.exag[b]) continue;
      let dw = w[b] - w0[b];
      if (sc.rupture && b === 1) dw = sc.site.fault.slip;
      const d = sc.bases[b].data, o = k * 4; e += dw * d[o]; n += dw * d[o + 1]; u += dw * d[o + 2];
    }
    mH = Math.max(mH, Math.hypot(e, n)); mV = Math.max(mV, Math.abs(u));
  }
  return clamp(12 / Math.max(mH / sc.grid.mpu, mV * sc.yScale), 1, EXAG_MAX);
}
function setExag(x) { S.exag = clamp(x, 1, S.sc ? S.sc.exagMax || EXAG_MAX : EXAG_MAX); }
function computeDefoScale(force) {
  const sc = S.sc; if (!sc) return;
  const tw = App.world.trueWeights(CFG.tMax), twNow = App.world.trueWeights(S.t);
  const los = sc.geom.asc.los, N = sc.N;
  let mx = 1e-4, mxNow = 1e-4;
  for (let k = 0; k < N * N; k += 5) {
    let e = 0, n = 0, u = 0, e2 = 0, n2 = 0, u2 = 0;
    for (let b = 0; b < sc.bases.length; b++) {
      const d = sc.bases[b].data, o = k * 4;
      let m = sc.rupture && b === 1 ? ruptureMask(sc, k) : 1;
      if (tw[b]) { e += tw[b] * d[o] * m; n += tw[b] * d[o + 1] * m; u += tw[b] * d[o + 2] * m; }
      if (twNow[b]) { e2 += twNow[b] * d[o] * m; n2 += twNow[b] * d[o + 1] * m; u2 += twNow[b] * d[o + 2] * m; }
    }
    mx = Math.max(mx, Math.abs(e * los[0] + n * los[1] + u * los[2]), Math.abs(u));
    mxNow = Math.max(mxNow, Math.abs(e2 * los[0] + n2 * los[1] + u2 * los[2]), Math.abs(u2));
  }
  const target = Math.max(mxNow, mx * 0.25);
  S.defoRange = force ? target : lerp(S.defoRange, target, 0.35);
  S.defoStep = niceStep(S.defoRange / 5);
}

// ───────────── phase unwrapping job ─────────────
function startUnwrap() {
  const sc = S.sc; if (!sc || S.view !== 'terrain') return;
  if (S.unwrap && !S.unwrap.done) return;
  const band = bandAtInspector(), C = currentCtx(), N = sc.N, NN = N * N;
  const wrapped = new Float32Array(NN), q = new Float32Array(NN), valid = new Uint8Array(NN), truth = new Float32Array(NN), atm = new Float32Array(NN);
  for (let k = 0; k < NN; k++) {
    const ig = igramK(sc, k, C, band);
    wrapped[k] = ig.wrapped; q[k] = ig.gamma; truth[k] = ig.phiTrue; atm[k] = ig.atm;
    valid[k] = ig.gamma > 0.3 && sc.cover.water[k] < 0.5 ? 1 : 0;
  }
  const refK = (sc.ref.i | 0) * N + (sc.ref.j | 0); valid[refK] = 1;
  const job = new Unwrapper(N, wrapped, q, valid, refK);
  // 8-bit encoding range for the unwrapped LoS: from the data itself (deformation part), with head-room for noise
  const lam = sc.lambda || BANDS[band].lambda, k4 = lam / (4 * Math.PI);
  let mx = 0.005;
  for (let k = 0; k < NN; k++) if (valid[k]) mx = Math.max(mx, Math.abs(truth[k] * k4 - atm[k]));
  S.unwrap = { job, band, truth, atm, lam: sc.lambda || lam, done: false, t0: App.time, budget: Math.max(600, Math.ceil(job.total / 100)) };
  computeDefoScale(true);
  const U = App.world.U;
  U.uUnwOn.value = 1; U.uUnwGate.value = 1; U.uUnwFront.value = 0; U.uUnwRange.value = mx * 1.3;
  App.world.unwData.fill(0); App.world.texUnw.needsUpdate = true;
  if (S.mode !== 'defo') { S.mode = 'defo'; syncControls(); }
  $('#act-unwrap').classList.add('busy');
  Sound.arp(5);
  toast(`Unwrapping ${job.total.toLocaleString('en')} coherent pixels (γ > 0.3) in ${band}-band, starting at the reference pixel.`, 'gold');
}
function pumpUnwrap() {
  const U = S.unwrap; if (!U || U.done) return;
  const finished = U.job.step(U.budget);
  const job = U.job, data = App.world.unwData, NN = S.sc.N * S.sc.N, tot = Math.max(1, job.count);
  const range = App.world.U.uUnwRange.value, k4 = U.lam / (4 * Math.PI);
  for (let k = 0; k < NN; k++) {
    if (!job.done[k]) { data[k * 4] = 0; continue; }
    const s0 = job.regionSeeds[job.region[k]];
    const phi = job.phi[k] - job.phi[s0] + U.truth[s0];
    const d = phi * k4 - U.atm[k];
    data[k * 4] = 255; data[k * 4 + 1] = Math.round(job.order[k] / Math.max(1, job.total) * 255);
    data[k * 4 + 2] = Math.round(clamp(d / range * 0.5 + 0.5, 0, 1) * 255); data[k * 4 + 3] = 255;
  }
  App.world.texUnw.needsUpdate = true;
  App.world.U.uUnwFront.value = job.count / Math.max(1, job.total);
  $('#act-unwrap').style.setProperty('--p', Math.round(job.count / Math.max(1, job.total) * 100) + '%');
  void tot;
  if (finished) {
    U.done = true;
    let se = 0, n = 0, jumps = 0, maxc = 0;
    for (let k = 0; k < NN; k++) {
      if (!job.done[k]) continue;
      const s0 = job.regionSeeds[job.region[k]];
      const e = job.phi[k] - job.phi[s0] - (U.truth[k] - U.truth[s0]);
      se += e * e; n++; if (Math.abs(e) > Math.PI) jumps++;
      maxc = Math.max(maxc, Math.abs(job.phi[k] - job.phi[s0]) / TAU);
    }
    const rms = Math.sqrt(se / Math.max(1, n));
    U.stats = { n, total: NN, regions: job.regionSeeds.length, rms, rmsMm: rms * U.lam / (4 * Math.PI) * 1000, jumps, maxCycles: maxc };
    Tweens.add(1.2, (e) => { App.world.U.uUnwGate.value = 1 - e; App.world.U.uUnwFront.value = 1 + e * 0.5; }, Ease.inOutCubic, 'unwgate');
    $('#act-unwrap').classList.remove('busy');
    Sound.ping();
    toast(`Unwrapped ${n.toLocaleString('en')} px in ${U.stats.regions} region(s): up to ${maxc.toFixed(1)} fringes, RMS error vs truth ${rms.toFixed(2)} rad (${U.stats.rmsMm.toFixed(1)} mm), ${jumps} pixels with 2π errors.`, 'gold');
    Bus.emit('kpi');
  }
}

// ───────────── coherence change detection job ─────────────
async function startCCD() {
  const sc = S.sc; if (!sc || S.view !== 'terrain' || (S.ccd && S.ccd.running)) return;
  const ev = sc.events[0];
  let kPost = epochOf(S.t);
  if (ev && Number.isFinite(ev.t)) {
    const kE = Math.ceil(ev.t / CFG.repeatDays - 1e-9);
    if (kPost !== kE) {
      const target = kE * CFG.repeatDays;
      toast(`Moving to ${epochName(kE)} (${fmtDate(dateAt(target))}), the first pass after the event.`, '');
      S.playing = false;
      const t0 = S.t;
      await Tweens.add(1.1, (e) => setTime(lerp(t0, target, e)), Ease.inOutCubic, 'time');
      kPost = kE;
    }
  }
  if (kPost < 2) { kPost = 2; setTime(kPost * CFG.repeatDays); }
  S.playing = false;
  setTime(kPost * CFG.repeatDays);
  const tPost = kPost * CFG.repeatDays, tPre1 = tPost - CFG.repeatDays, tPre2 = tPre1 - CFG.repeatDays;
  const band = bandAtInspector();
  const geomObj = sc.geom[S.geom === 'desc' ? 'desc' : 'asc'];
  S.ccd = { job: ccdJob(sc, { band, geomObj }, tPre2, tPre1, tPost), running: true, progress: 0, result: null, band, tPost };
  const U = App.world.U;
  App.world.ccdData.fill(0); App.world.texCCD.needsUpdate = true;
  U.uCCDOn.value = 1; U.uCCDScan.value = 0;
  if (S.mode !== 'coh') { S.mode = 'coh'; syncControls(); }
  App.world.buildFences(null);
  clearCCDLabels();
  $('#act-ccd').classList.add('busy');
  Sound.scan();
}
function pumpCCD() {
  const C = S.ccd; if (!C || !C.running) return;
  const t0 = performance.now();
  let r;
  do { r = C.job.next(); if (!r.done) C.progress = r.value; } while (!r.done && performance.now() - t0 < 11);
  App.world.U.uCCDScan.value = C.progress * 0.98;
  $('#act-ccd').style.setProperty('--p', Math.round(C.progress * 100) + '%');
  if (!r.done) return;
  C.running = false; C.result = r.value;
  const res = C.result, N = S.sc.N, NN = N * N, d = App.world.ccdData;
  for (let k = 0; k < NN; k++) {
    const cm = res.compMask[k];
    d[k * 4] = Math.round(clamp(res.dG[k] / 0.8, 0, 1) * 255);
    d[k * 4 + 1] = cm ? 255 : 0;
    d[k * 4 + 2] = cm && res.comps[cm - 1].isEvent ? 255 : 0;
    d[k * 4 + 3] = 255;
  }
  App.world.texCCD.needsUpdate = true;
  const U = App.world.U;
  Tweens.add(1.3, (e) => { U.uCCDScan.value = e * 1.001; }, Ease.inOutCubic, 'ccdscan').then(() => {
    App.world.buildFences(res, currentCtx());
    if (App.world.fences) Tweens.add(1.0, (e) => { if (App.world.fences) App.world.fences.material.uniforms.uGrow.value = e; }, Ease.outCubic, 'fence');
    buildCCDLabels(res);
    $('#act-ccd').classList.remove('busy');
    if (res.comps.length) {
      Sound.alarm();
      const evc = res.comps.filter((c) => c.isEvent);
      const msg = evc.length
        ? `CHANGE DETECTED · ${res.event.name.replace(/ \(simulated\)/, '')}: ${fmtArea(res.evA)} km² · ${res.evV > 0 ? fmtVol(res.evV) : 'volume n/a'}` + (res.otherA > 0.05 ? ` · plus ${fmtArea(res.otherA)} km² of other change` : '')
        : `${res.comps.length} change area(s): ${fmtArea(res.totalA)} km². No catalogued event in this pair.`;
      toast(msg, 'alert');
    } else { Sound.ping(); toast('No significant coherence change in this pair: the surface stayed stable.', ''); }
    Bus.emit('kpi');
  });
}
// ───────────── NISAR close-up camera & deployment sequence ─────────────
function activeSat() { return App.world.sats[S.geom === 'desc' ? 1 : 0]; }
/** centre and radius of the deployed spacecraft (bus → reflector, plus the 6 m reflector radius) in world units */
function satFrame() {
  const sat = activeSat(), ud = sat.model.userData;
  ud.setDeploy(1); sat.model.updateMatrixWorld(true);
  const bus = sat.model.getWorldPosition(new THREE.Vector3()), dish = ud.beamOrigin.getWorldPosition(new THREE.Vector3());
  ud.setDeploy(S.deploy);
  const s = sat.model.getWorldScale(new THREE.Vector3()).x;
  return { center: bus.clone().lerp(dish, 0.5), radius: bus.distanceTo(dish) / 2 + 6.5 * s };
}
/** camera flight along an arc that rises above the spacecraft, so it never cuts through the reflector */
function arcFlight(p1, t1, dur, lift) {
  const p0 = App.camera.position.clone(), t0 = App.controls.target.clone();
  const c = p0.clone().lerp(p1, 0.5).add(new THREE.Vector3(0, lift, 0)), a = new THREE.Vector3(), b = new THREE.Vector3();
  return Tweens.add(dur, (e) => {
    a.copy(p0).lerp(c, e); b.copy(c).lerp(p1, e);
    App.camera.position.copy(a.lerp(b, e));
    App.controls.target.lerpVectors(t0, t1, e);
    App.camera.lookAt(App.controls.target);
  }, Ease.inOutQuint, 'cam');
}
async function enterSatCam() {
  if (S.view !== 'terrain' || S.satCam || S.busy || !App.world.sc) return;
  S.satCam = true; S.busy = true;
  if (S.acquiring) { S.acquiring = false; App.world.U.uAcq.value = 1e4; }   // freeze the spacecraft where it is
  App.satSaved = { pos: App.camera.position.clone(), tgt: App.controls.target.clone() };
  const { center, radius } = satFrame();
  const dist = radius / Math.sin(App.camera.fov * DEG / 2) * 1.08;
  // three-quarter view from beyond the spacecraft, looking down past it: the scene below fills the background
  const out = center.clone().setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  const end = center.clone().addScaledVector(out, dist * 0.9).add(new THREE.Vector3(0, dist * 0.42, 0));
  App.controls.enabled = false;
  document.body.classList.add('satcam');
  Sound.whoosh(1.6, true);
  await arcFlight(end, center, 2.6, dist * 1.3);
  if (!App.satRotHook) { App.satRotHook = true; App.controls.addEventListener('start', () => { App.controls.autoRotate = false; }); }
  Object.assign(App.controls, { minDistance: 8, maxDistance: 170, maxPolarAngle: Math.PI, autoRotate: true, autoRotateSpeed: 0.45 });
  App.controls.enabled = true; S.busy = false;
  syncControls();
  if (!App.deployedOnce) { App.deployedOnce = true; replayDeploy(); }
}
function leaveSatCamNow() {
  S.satCam = false; document.body.classList.remove('satcam');
  Object.assign(App.controls, { minDistance: 14, maxDistance: 260, maxPolarAngle: Math.PI * 0.495, autoRotate: false });
  if (S.deploying) { Tweens.kill('deploy'); S.deploy = 1; S.deploying = false; }
}
async function exitSatCam() {
  if (!S.satCam || S.busy) return;
  S.busy = true;
  const sv = App.satSaved || { pos: V3(...S.sc.site.cam.pos), tgt: V3(...S.sc.site.cam.target) };
  const { radius } = satFrame();
  App.controls.enabled = false;
  leaveSatCamNow();
  Sound.whoosh(1.2, false);
  await arcFlight(sv.pos, sv.tgt, 2.0, radius * 2.2);
  App.controls.enabled = true; S.busy = false;
  syncControls();
}
/** stowed -> deployed: boom unfolds segment by segment, then the AstroMesh ring blooms open */
async function replayDeploy() {
  if (S.deploying) return;
  S.deploying = true;
  S.deploy = 0;
  Sound.servo(3.6);
  let latched1 = false, latched2 = false;
  toast('Deployment: the 9 m boom unfolds, then the 12 m AstroMesh reflector opens its perimeter truss.', 'gold');
  const ok = await Tweens.add(7.0, (e) => {
    S.deploy = e;
    if (!latched1 && e > 0.55) { latched1 = true; Sound.latch(); Sound.servo(3.2, 0.8); }
    if (!latched2 && e > 0.985) { latched2 = true; Sound.latch(true); }
  }, Ease.linear, 'deploy');
  S.deploy = 1; S.deploying = false;
  if (ok) toast('NISAR reflector deployed and latched. Radar ready.', '');
}
function clearTools() {
  if (S.unwrap) { S.unwrap = null; }
  if (S.ccd) { S.ccd = null; }
  if (App.world && App.world.sc) {
    const U = App.world.U;
    U.uUnwOn.value = 0; U.uUnwGate.value = 0; U.uCCDOn.value = 0; U.uSliceOn.value = 0;
    App.world.buildFences(null); App.world.buildCurtain(null);
  }
  S.slice = null; S.profile = null; S.tool = null;
  clearCCDLabels();
  const pf = $('#profile'); if (pf) pf.hidden = true; document.body.classList.remove('profile-open');
  for (const id of ['#act-unwrap', '#act-ccd']) { const b = $(id); if (b) b.classList.remove('busy'); }
  const sl = $('#act-slice'); if (sl) sl.setAttribute('aria-pressed', 'false');
}

// ───────────── fault rupture ─────────────
async function triggerRupture() {
  const sc = S.sc; if (!sc || !sc.rupture || sc.rupture.active) return;
  const R = sc.rupture, ev = sc.events[0];
  const kNext = Math.min(CFG.nEpochs - 1, epochOf(S.t) + 1);
  const tq = Math.max(0.5, kNext * CFG.repeatDays - 6);
  S.playing = false;
  R.tq = tq; ev.t = tq; R.active = true; R.front = R.hypoS + 6000;
  App.world.U.uEvKind.value.x = EVENT_CODE.rupture;
  markStale();
  const t0 = S.t, x0 = S.exag;
  Tweens.add(0.6, (e) => setTime(lerp(t0, tq + 0.6, e)), Ease.inOutCubic, 'time');
  // metres of coseismic slip instead of millimetres of creep: drop the exaggeration so the tear stays readable
  Tweens.add(1.4, (e) => { setExag(Math.exp(lerp(Math.log(x0), Math.log(80), e))); syncControls(); }, Ease.inOutCubic, 'exag');
  await sleep(600);
  Sound.boom();
  S.shake = 1.2;
  App.post.uniforms.uFlash.value = 0.55;
  Tweens.add(0.8, (e) => { App.post.uniforms.uFlash.value = 0.55 * (1 - e); }, Ease.outCubic, 'flash');
  toast(`Mw 7.9 rupture: ${R.slip.toFixed(1)} m of right-lateral slip propagating south-east at ~3 km/s.`, 'alert');
  const fStart = R.hypoS + 6000, fEnd = -42000;
  await Tweens.add(2.8, (e) => { R.front = lerp(fStart, fEnd, e); }, Ease.linear, 'rupture');
  R.front = -1e9; R.active = false;
  computeDefoScale(true);
  const t1 = S.t;
  await Tweens.add(0.8, (e) => setTime(lerp(t1, kNext * CFG.repeatDays, e)), Ease.inOutCubic, 'time');
  setIntelUI(sc);
  Bus.emit('kpi');
}
function resetRupture() {
  const sc = S.sc; if (!sc || !sc.rupture) return;
  const R = sc.rupture;
  R.tq = Infinity; R.front = 1e9; R.active = false; sc.events[0].t = Infinity;
  S.exag = sc.site.exag; syncControls();
  clearTools(); markStale(); computeDefoScale(true); setIntelUI(sc); Bus.emit('kpi');
}

// ───────────── cross-section slicer ─────────────
function computeProfile() {
  const sc = S.sc, sl = S.slice; if (!sc || !sl || !sl.b) return;
  const C = currentCtx(), M = 240;
  const tRef = tRefOf(), Cref = timeCtx(sc, { tRef: 0, tCur: tRef, X: S.exag, geomObj: C.geom, bandEff: C.band, aps: false });
  const twRef = App.world.trueWeights(tRef);
  void twRef;
  const lenKm = Math.hypot(sl.b.x - sl.a.x, sl.b.z - sl.a.z) * sc.grid.mpu / 1000;
  const pts = [], curtain = [];
  for (let n = 0; n < M; n++) {
    const f = n / (M - 1), x = lerp(sl.a.x, sl.b.x, f), z = lerp(sl.a.z, sl.b.z, f);
    const g = sc.grid.xz2ij(x, z), k = sc.grid.idx(g.i, g.j);
    const e = sampleField(sc.dem, sc.N, g.j, g.i);
    const d1 = dispMeshK(sc, k, C), d0 = dispMeshK(sc, k, Cref);
    const fr = coverK(sc, k, C);
    const tru = trueDispK(sc, k, S.t), truR = trueDispK(sc, k, tRef);
    const du = [tru[0] - truR[0], tru[1] - truR[1], tru[2] - truR[2]];
    const los = C.geom.los;
    const wse = wseK(sc, k, C.pulseC);
    let bld = null;
    if (sc.buildings && sc.cover.urban[k] > 0.35) bld = e + d1[2] + 25 + 25 * fr.urban;
    pts.push({
      d: f * lenKm, g0: e + d0[2], g1: e + d1[2],
      canopy: fr.veg > 0.25 && fr.canopyH > 1 ? e + d1[2] + fr.canopyH : null,
      water: floodedK(sc, k, C.pulseC, C.calveC) ? wse : null,
      bld, u: du[2] * 1000, los: (du[0] * los[0] + du[1] * los[1] + du[2] * los[2]) * 1000,
    });
    curtain.push({ x, z, y: App.world.surfaceY(g.i, g.j, C) });
  }
  S.profile = { pts, lenKm, tRef, cursor: -1 };
  App.world.buildCurtain(curtain);
  const U = App.world.U; U.uSlice.value.set(sl.a.x, sl.a.z, sl.b.x, sl.b.z); U.uSliceOn.value = 1;
  const pf = $('#profile'); pf.hidden = false; document.body.classList.add('profile-open');
  $('#profile-info').textContent = `${lenKm.toFixed(1)} km · ${fmtDate(dateAt(tRef))} → ${fmtDate(dateAt(S.t))}`;
  drawProfile($('#profile-canvas'), S.profile, S, sc);
}

// ───────────── CSAR-PACK loader (real HyP3 / NISAR data) ─────────────
async function loadPack(files) {
  const png = [...files].find((f) => /\.png$/i.test(f.name) || f.type === 'image/png');
  const js = [...files].find((f) => /\.json$/i.test(f.name));
  if (!png) { toast('Drop a CSAR-PACK .png (optionally with its .json sidecar). Make one with tools/csar_pack.py.', 'alert'); return; }
  let meta = {};
  if (js) { try { meta = JSON.parse(await js.text()); } catch (e) { toast('The .json sidecar could not be parsed; using defaults.', 'alert'); } }
  try {
    const bmp = await createImageBitmap(png, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, bmp.width, bmp.height);
    if (bmp.width !== bmp.height * 2) throw new Error(`expected a ${bmp.height * 2}×${bmp.height} image (DEM+coherence | LoS+amplitude), got ${bmp.width}×${bmp.height}`);
    const sc = buildCustomScene(img, meta, png.name);
    App.scenes.custom = sc;
    toast(`Loaded ${png.name}: ${meta.sensor || 'SAR'} pair ${meta.date1 || '?'} → ${meta.date2 || '?'}, λ ${((meta.wavelength_m || BANDS.L.lambda) * 100).toFixed(2)} cm.`, 'gold');
    if (S.view === 'globe') await enterSite('custom', { fromGlobe: false }); else await enterSite('custom');
  } catch (e) {
    console.error(e);
    toast('Could not read this pack: ' + e.message, 'alert');
  }
}
function buildCustomScene(img, meta, name) {
  const Np = img.height, N = CFG.N, NN = N * N, W2 = img.width;
  const px = (x, y, c) => img.data[(y * W2 + x) * 4 + c];
  const dem0 = new Float32Array(Np * Np), coh0 = new Float32Array(Np * Np), los0 = new Float32Array(Np * Np), amp0 = new Float32Array(Np * Np);
  const dmin = meta.dem_min ?? 0, dmax = meta.dem_max ?? 4000, lmin = meta.los_min ?? -0.1, lmax = meta.los_max ?? 0.1;
  for (let y = 0; y < Np; y++) for (let x = 0; x < Np; x++) {
    const k = y * Np + x;
    dem0[k] = dmin + ((px(x, y, 0) * 256 + px(x, y, 1)) / 65535) * (dmax - dmin);
    coh0[k] = px(x, y, 2) / 255;
    los0[k] = lmin + ((px(x + Np, y, 0) * 256 + px(x + Np, y, 1)) / 65535) * (lmax - lmin);
    amp0[k] = -30 + px(x + Np, y, 2) / 255 * 30;
  }
  const rs = (f) => { const o = new Float32Array(NN); for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) o[i * N + j] = sampleField(f, Np, (j + 0.5) / N * Np, (i + 0.5) / N * Np); return o; };
  const dem = rs(dem0), coh = rs(coh0), losF = rs(los0), amp = rs(amp0);
  const lat = meta.lat ?? 0, lon = meta.lon ?? 0, ext = meta.extent_km ?? 40;
  const dlat = ext / 2 / KM_PER_DEG, dlon = ext / 2 / (KM_PER_DEG * Math.cos(lat * DEG));
  const gmeta = { n: N, extent_km: ext, lat, lon, lat_min: lat - dlat, lat_max: lat + dlat, lon_min: lon - dlon, lon_max: lon + dlon };
  const inc = meta.incidence_deg ?? 39, heading = meta.heading_deg ?? -12;
  const th = inc * DEG, hd = heading * DEG, az = hd + (meta.look === 'right' ? -Math.PI / 2 : Math.PI / 2);
  const geomA = { kind: 'asc', inc, heading: hd, hdgDeg: ((heading % 360) + 360) % 360, lookDeg: 0, los: [Math.sin(th) * Math.sin(az), Math.sin(th) * Math.cos(az), Math.cos(th)], along: [Math.sin(hd), Math.cos(hd), 0] };
  const site = { id: 'custom', waltz: -1, kind: 'custom', seed: 1, name: meta.title || name.replace(/\.png$/i, ''), region: meta.sensor ? `${meta.sensor} · ${meta.date1 || ''} → ${meta.date2 || ''}` : 'Real interferogram (CSAR-PACK)', tag: 'Real data', ve: meta.ve || 1.5, canopyVE: 1, exag: meta.exag || 300, inc: { asc: inc, desc: inc }, aps: { turb: 0, strat: 0 }, cam: { pos: [-40, 50, 70], target: [0, 2, 0] }, labels: [], story: { title: meta.title || 'Your interferogram', sub: `${meta.sensor || 'SAR'} · ${meta.date1 || '?'} → ${meta.date2 || '?'}`, text: 'This scene comes from a <b>real interferogram</b>. The fringes are recomputed from its unwrapped LoS displacement using the pack\'s wavelength. Coherence and amplitude come from the product. The mesh assumes vertical motion (U = d<sub>LoS</sub>/cosθ).' } };
  const g = new SiteGrid(gmeta);
  const b0 = newBasis(N);
  for (let k = 0; k < NN; k++) b0[k * 4 + 2] = losF[k] / geomA.los[2];
  let emin = Infinity, emax = -Infinity, es = 0; for (let k = 0; k < NN; k++) { emin = Math.min(emin, dem[k]); emax = Math.max(emax, dem[k]); es += dem[k]; }
  const sc = {
    site, id: 'custom', kind: 'custom', grid: g, N, meta: gmeta, dem, ampDb: amp, aux: coh, lambda: meta.wavelength_m || BANDS.L.lambda,
    cover: { veg: new Float32Array(NN), water: Float32Array.from(coh, (c, k) => (c < 0.12 && amp[k] < -20 ? 1 : 0)), urban: new Float32Array(NN), ice: new Float32Array(NN) },
    canopyH: new Float32Array(NN), agb: new Float32Array(NN), spill: new Float32Array(NN).fill(1e6),
    bases: [{ data: b0, label: 'Measured LoS (unit = full pair)' }], waterBasis: -1, events: [], labels: [], hasWater: false,
    flags: { mesh: [1, 0, 0, 0], phase: [1, 0, 0, 0], exag: [1, 0, 0, 0] },
    weights: (t) => [clamp(t / CFG.tMax, 0, 1), 0, 0, 0],
    emin, emax, emean: es / NN, eBase: emin - (emax - emin) * 0.04, yScale: (site.ve) / g.mpu,
    geom: { asc: geomA, desc: geomA },
    aps: { screens: [0, 1, 2, 3].map(() => new Float32Array(NN)), apsW: Array.from({ length: CFG.nEpochs }, () => [0, 0, 0, 0]), strat: new Array(CFG.nEpochs).fill(0), turb: 0, stratK: 0 },
    noise: new Float32Array(NN * 4), noiseBytes: new Uint8Array(NN * 4).fill(128),
    canopyPts: new Float32Array(0), poi: { i: N / 2, j: N / 2 }, ref: { i: N / 2 + 0.5, j: N / 2 + 0.5 },
    rupture: null, glacier: null, buildings: null, corridor: null,
  };
  for (let k = 0; k < NN * 4; k++) sc.noise[k] = (128 / 255 - 0.5) * 8;
  sc.nrm = terrainDerivatives(dem, N, g.pixelM); sc.slope = sc.nrm.slope;
  let best = -1; for (let k = 0; k < NN; k += 3) if (coh[k] > best) { best = coh[k]; sc.ref = { i: ((k / N) | 0) + 0.5, j: (k % N) + 0.5 }; }
  SITES.custom = site;
  App.metas.custom = gmeta;
  return sc;
}
const KM_PER_DEG = 111.32;
