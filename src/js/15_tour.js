// ───────────────────────── 15 · JURY TOUR (self-running presentation) ─────────────────────────
const Tour = {
  active: false, step: 0, skip: null, focusEl: null, token: 0,
  steps: [
    { title: 'Two radars, one spacecraft', text: 'NISAR flies at <b>747 km</b> in a sun-synchronous dawn–dusk orbit. Every <b>12 days</b> it maps all land and ice with a 242 km SweepSAR swath. Gold stripes are ascending passes, cyan stripes are descending passes. Each pass carries <b>L-band (23.85 cm)</b> and <b>S-band (9.37 cm)</b>.', run: async (T) => { if (S.view !== 'globe') await toGlobe(); await T.wait(8000); } },
    { title: 'Phase becomes mesh', text: 'Mount Rainier, magma-recharge drill. Each colour cycle is one fringe, <b>λ/2 = 11.9 cm</b> of motion toward the satellite. The TERRAPULSE vertex shader converts phase into displacement with <b>Δd = λ/4π · Δφ</b> and moves every vertex of a real 384×384 elevation model.', focus: '#f-mode', run: async (T) => { await enterSite('rainier', { fromGlobe: S.view === 'globe' }); S.playing = true; S.speed = 1; syncControls(); await T.wait(8500); } },
    { title: 'Meet NISAR', text: 'The observatory itself: a <b>12 m AstroMesh reflector</b> of gold-plated wire knit on a <b>9 m boom with four hinges</b>, illuminated by the NASA/JPL <b>L-band</b> and ISRO <b>S-band</b> feed arrays. Watch the deployment: the boom unfolds hinge by hinge, then the perimeter truss opens the dish. Click the satellite or press <b>N</b> any time.', focus: '#btn-satcam', run: async (T) => { S.playing = false; syncControls(); const first = !App.deployedOnce; await enterSatCam(); if (!Tour.active || !S.satCam) return; if (!first) replayDeploy(); await T.until(() => !S.deploying, 9000); await T.wait(2500); if (S.satCam) await exitSatCam(); } },
    { title: 'Millimetres, made visible', text: 'The exaggeration slider runs from 1× (true scale) to 5000×. The fringes stay physically exact while the summit swells with the injected magma. The glowing orb underneath is the <b>Mogi point source</b> at 6 km depth.', focus: '#f-exag', run: async (T) => { const x0 = S.exag; await Tweens.add(3.2, (e) => { setExag(lerp(1, 3200, e * e)); syncControls(); }, Ease.inOutCubic, 'tour'); await T.wait(3500); setExag(x0); syncControls(); } },
    { title: 'Phase unwrapping, live', text: 'A <b>quality-guided flood fill</b> integrates the wrapped phase outward from a stable reference pixel, always crossing the most coherent neighbour next. The front you see is the algorithm running in your browser right now. Its error against the true field appears in the toast and in Scenario Intel.', focus: '#act-unwrap', run: async (T) => { S.playing = false; setTime(CFG.tMax); syncControls(); startUnwrap(); await T.until(() => !S.unwrap || S.unwrap.done, 9000); await T.wait(2500); } },
    { title: 'The phasor clock', text: 'Hover any pixel to inspect it. The arrow is the interferometric phasor: angle φ, length γ. The dots are single-look samples, and the petal is the <b>Just–Bamler phase PDF</b>. Below it: line-of-sight vector, Freeman–Durden bars and the full 12-day time series.', focus: '#panel-inspector', run: async (T) => { S.mode = 'phase'; syncControls(); S.pin = { ...S.sc.poi }; updateInspector(true); await T.wait(8000); } },
    { title: 'A locked fault lets go', text: 'San Andreas at Carrizo Plain: 5.7 m of slip deficit since 1857 equals <b>Mw ≈ 7.9</b>. Watch the rupture tear the mesh, the fringes crowd against the trace, and coherence collapse along the surface rupture.', focus: '#intel-actions', run: async (T) => { await enterSite('carrizo'); S.band = 'S'; syncControls(); await T.wait(2500); if (!Tour.active) return; await triggerRupture(); await T.wait(4500); } },
    { title: 'Ice faster than fringes', text: 'Jakobshavn Isbræ moves about <b>30 m per day</b>, which is hundreds of metres between passes. The phase aliases into noise and coherence drops, so NISAR measures this flow by <b>speckle tracking</b>. On day 240 the terminus calves.', run: async (T) => { await enterSite('jakobshavn'); S.mode = 'coh'; syncControls(); await T.wait(8000); } },
    { title: 'The X-ray lens', text: 'Atchafalaya Basin in spring flood. Outside the lens, <b>S-band</b> sees only the canopy and its phase is noise. Inside, <b>L-band</b> reaches the water. Trunk and water form corner reflectors, and the coherent fringes measure the water rising under the trees.', focus: '#f-band', run: async (T) => { await enterSite('atchafalaya'); S.band = 'X'; S.mode = 'phase'; S.playing = false; setTime(132); syncControls(); const sc = S.sc; const c0 = App.camera.position.clone(), tg0 = App.controls.target.clone(); const ctr = sc.grid.ij2xz(sc.N * 0.48, sc.N * 0.42); App.controls.enabled = false; await Tweens.add(1.8, (e) => { App.camera.position.lerpVectors(c0, V3(ctr.x - 34, 40, ctr.z + 48), e); App.controls.target.lerpVectors(tg0, V3(ctr.x, 0, ctr.z), e); App.camera.lookAt(App.controls.target); }, Ease.inOutCubic, 'cam'); App.controls.enabled = true; const a = sc.grid.ij2xz(sc.N * 0.25, sc.N * 0.3), b = sc.grid.ij2xz(sc.N * 0.7, sc.N * 0.55); await Tweens.add(7, (e) => { S.lens.x = lerp(a.x, b.x, e); S.lens.z = lerp(a.z, b.z, e) + Math.sin(e * 9) * 4; }, Ease.inOutCubic, 'tour'); S.mode = 'pol'; syncControls(); await T.wait(4500); } },
    { title: 'Home waters', text: 'The <b>Danube Delta</b>: Europe\'s second-largest delta and one of the largest continuous reed beds on Earth. When the spring pulse floods the reeds, L-band double bounce turns them <b>red</b> in the Freeman–Durden map. S-band still sees a <b>green</b> wall of vegetation.', run: async (T) => { await enterSite('danube'); S.band = 'L'; S.mode = 'pol'; S.playing = false; setTime(165); syncControls(); await T.wait(7500); } },
    { title: 'A city sinking 35 cm a year', text: 'Mexico City pumps its aquifer and the old lake clay compacts. Every block tilts with the ground and is coloured by its 10-year angular distortion β. <b>RUN CCD</b> simulates three SLCs, estimates coherence with integral images and draws alert polygons with area and volume.', focus: '#act-ccd', run: async (T) => { await enterSite('mexico'); S.mode = 'defo'; S.playing = false; syncControls(); await T.wait(3500); if (!Tour.active) return; await startCCD(); await T.until(() => S.ccd && S.ccd.result, 8000); await T.wait(5000); } },
    { title: 'Cut the Earth open', text: 'The cross-section slicer compares the reference pass with the current one along any line, with canopy, water and buildings, plus the true millimetre displacement below. Every scene accepts <b>real data</b> too: drop a CSAR-PACK made from ASF HyP3 or NISAR products.', focus: '#act-slice', run: async (T) => { const sc = S.sc; S.tool = 'slice'; const a = sc.grid.ij2xz(sc.N * 0.35, sc.N * 0.18), b = sc.grid.ij2xz(sc.N * 0.62, sc.N * 0.85); S.slice = { a: { ...a }, b: { ...b }, done: true }; computeProfile(); syncControls(); await T.wait(8000); } },
    { title: 'Real NISAR, live from NASA', text: 'Until now: physics simulated on real terrain. This is the <b>real thing</b>: NISAR\'s own L-band interferogram of Mexico City, two passes 12 days apart, read value by value from the NASA product file. Keys 1, 2 and 4 show its real phase, line-of-sight change and coherence; the list of products comes live from NASA\'s catalogue. Green dots on the timeline are real NISAR passes. Press <b>R</b> on any scene.', focus: '#panel-real', run: async (T) => {
      if (S.sc && S.sc.id !== 'mexico') await enterSite('mexico');
      clearTools(); S.mode = 'phase'; S.playing = false; syncControls();
      const site = realSite();
      // the embedded copy shows at once and needs no network: the tour must not stall on a 2 MB download
      const snap = site && site.browse && site.browse.GUNW;
      if (snap && site.products.GUNW.some((r) => r.id === snap.id)) { Real.sel.GUNW = snap.id; Real.picked.GUNW = true; }
      Real.kind = 'GUNW'; realUI();
      const p = $('#panel-real'); if (p) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await realShow(true);
      const rec = realSelected(site);
      if (rec && Tour.active) $('#tour-text').insertAdjacentHTML('beforeend', `<br><small>NISAR GUNW · ${rec.ref.slice(0, 10)} → ${rec.sec.slice(0, 10)} · track ${rec.track} ${rec.dir === 'A' ? 'ascending' : 'descending'} · frame ${rec.frame}</small>`);
      await T.wait(10000);
    } },
    { title: 'CHRONO-SAR · Dancing with the SARs', text: `Real elevation models, real NISAR data and geometry, real radar physics, and algorithms that run live in the browser. Built for NASA Space Apps 2026 by <b>${CFG.team}</b>. Pick any waltz and explore.`, run: async (T) => { await toGlobe(); await T.wait(7000); } },
  ],
  async start() {
    if (this.active) return;
    closeOverlay('deck'); closeOverlay('codex');
    if (S.busy) { await sleep(800); }
    this.active = true; S.tour = true; this.token++;
    const my = this.token;
    if (!Sound.on) { const on = Sound.setOn(true); $('#btn-sound').setAttribute('aria-pressed', String(on)); }
    $('#tour-card').classList.add('open');
    document.body.classList.add('touring');
    for (this.step = 0; this.step < this.steps.length; this.step++) {
      if (!this.active || my !== this.token) break;
      const st = this.steps[this.step];
      $('#tour-step').textContent = `JURY TOUR · ${this.step + 1} / ${this.steps.length}`;
      $('#tour-title').textContent = st.title;
      $('#tour-text').innerHTML = st.text;
      $('#tour-bar').style.width = ((this.step + 1) / this.steps.length * 100) + '%';
      this.setFocus(st.focus);
      this.skipNow = false;
      Sound.step();
      try { await st.run(this); } catch (e) { console.warn('tour step', e); }
    }
    this.stop();
  },
  setFocus(sel) {
    if (this.focusEl) this.focusEl.classList.remove('tour-focus');
    this.focusEl = sel ? $(sel) : null;
    if (this.focusEl) this.focusEl.classList.add('tour-focus');
  },
  wait(ms) {
    return new Promise((res) => {
      const t = setTimeout(() => { this.skip = null; res(); }, ms);
      this.skip = () => { clearTimeout(t); this.skip = null; res(); };
    });
  },
  async until(fn, maxMs) {
    const t0 = performance.now();
    while (this.active && !fn() && !this.skipNow && performance.now() - t0 < maxMs) { await this.wait(120); }
  },
  next() { this.skipNow = true; if (this.skip) this.skip(); },
  stop() {
    if (!this.active) return;
    this.active = false; S.tour = false; this.token++;
    if (this.skip) this.skip();
    this.setFocus(null);
    Tweens.kill('tour');
    $('#tour-card').classList.remove('open');
    document.body.classList.remove('touring');
  },
};
