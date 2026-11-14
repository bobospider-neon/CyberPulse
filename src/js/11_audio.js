// ───────────────────────── 11 · SOUND DESIGN (Web Audio, synthesised in real time, no audio files) ─────────────────────────
// A cinematic mission-control palette:
//  · ambient bed: a filtered analogue-style pad that slowly blooms through four voicings of D major pentatonic,
//    a drifting band of pink-noise "solar wind", a sub-bass floor, and a reaction-wheel hum in the NISAR close-up
//  · a stereo convolution hall whose impulse response is generated in code (3.4 s, the tail darkens like a real room)
//  · tactile UI clicks (noise transient + low "thock") and glass chimes snapped to the same key, so everything is consonant
//  · cinematic whooshes, an earthquake rumble, a two-tone attention chime, thruster puffs, deployment servos and latches
//  · a limiter on the master bus, so nothing ever clips. No square-wave or sawtooth beeps anywhere.
const Sound = {
  ctx: null, on: false, amb: null, last: {}, noise: {}, sleepT: 0,
  PENTA: [2, 4, 6, 9, 11],                                                     // pitch classes D E F# A B
  CHORDS: [[38, 45, 52, 54, 57], [35, 42, 50, 52, 57], [40, 47, 50, 54, 57], [33, 45, 50, 52, 54]],  // Dadd9 · Bm11 · E9sus4 · A6sus4 (MIDI)
  mf(m) { return 440 * Math.pow(2, (m - 69) / 12); },
  init(ctxOverride = null) {
    if (this.ctx) return true;
    let c = ctxOverride;
    if (!c) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { c = new AC({ latencyHint: 'interactive' }); } catch (e) { try { c = new AC(); } catch (e2) { return false; } }
    }
    this.ctx = c;
    this.out = c.createGain(); this.out.gain.value = 0;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -9; lim.knee.value = 4; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.18;
    this.out.connect(lim); lim.connect(c.destination);
    this.bus = c.createGain(); this.bus.connect(this.out);
    this.send = c.createGain();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;   // keep the low end dry and tight
    const verb = c.createConvolver(); verb.buffer = this.makeIR(3.4, 0.022);
    const ret = c.createGain(); ret.gain.value = 0.6;
    this.send.connect(hp); hp.connect(verb); verb.connect(ret); ret.connect(this.out);
    return true;
  },
  /** stereo hall impulse response: decorrelated noise, exponential decay (-60 dB at `sec`), one-pole low-pass that closes over time */
  makeIR(sec, pre) {
    const c = this.ctx, sr = c.sampleRate, p0 = Math.floor(sr * pre), n = p0 + Math.floor(sr * sec), b = c.createBuffer(2, n, sr);
    let seed = 20260;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr, x = t / sec, k = 0.35 + 0.6 * Math.min(1, x * 1.4);
        lp = lp * k + rnd() * (1 - k);
        d[i] = lp / Math.sqrt((1 - k) / (1 + k)) * Math.exp(-6.9 * x) * (1 - Math.exp(-t * 300));
      }
    }
    return b;
  },
  /** 4 s mono noise buffers (white / pink / brown) with a crossfaded seam, so they loop without clicks */
  noiseBuf(kind = 'white') {
    if (this.noise[kind]) return this.noise[kind];
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * 4), F = Math.floor(sr * 0.05), g = new Float32Array(n + F);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < n + F; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; g[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926; }
      else if (kind === 'brown') { br = (br + 0.02 * w) / 1.02; g[i] = br * 3.5; }
      else g[i] = w;
    }
    const b = c.createBuffer(1, n, sr), d = b.getChannelData(0);
    d.set(g.subarray(0, n));
    for (let i = 0; i < F; i++) { const a = i / F; d[i] = g[i] * Math.sqrt(a) + g[n + i] * Math.sqrt(1 - a); }
    return (this.noise[kind] = b);
  },
  gate(name, ms) { const n = performance.now(); if (n - (this.last[name] || -1e9) < ms) return false; this.last[name] = n; return true; },
  live() { return this.on && !!this.ctx; },
  /** route a voice to the dry bus (optionally panned) and to the hall */
  dest(node, wet = 0, pan = 0) {
    const c = this.ctx; let n = node;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); n.connect(p); n = p; }
    n.connect(this.bus);
    if (wet > 0) { const s = c.createGain(); s.gain.value = wet; n.connect(s); s.connect(this.send); }
    return n;
  },
  /** linear attack, optional hold, exponential release to −60 dB in d; returns the stop time.
   *  Only ramps are used: a setTargetAtTime that starts where a ramp ends on a 128-sample render-quantum boundary
   *  makes Chrome output one sample at the param's default value (a loud click). */
  shape(gp, t0, a, hold, d, peak) {
    const p = Math.max(peak, 1e-5), dd = Math.max(d, 0.004);
    gp.setValueAtTime(0, t0);
    gp.linearRampToValueAtTime(p, t0 + a);
    if (hold > 0) gp.linearRampToValueAtTime(p, t0 + a + hold);
    gp.exponentialRampToValueAtTime(p * 1e-3, t0 + a + hold + dd);
    gp.linearRampToValueAtTime(0, t0 + a + hold + dd + 0.02);
    return t0 + a + hold + dd + 0.06;
  },
  /** glide an AudioParam from wherever it is now to v over dur seconds (ramps only, see shape) */
  glide(param, v, dur) {
    const t = this.ctx.currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
    param.linearRampToValueAtTime(v, t + Math.max(0.02, dur));
  },
  tone({ f, f2 = 0, glide = 0, type = 'sine', t = 0, a = 0.004, hold = 0, d = 0.5, peak = 0.05, wet = 0.2, pan = 0 }) {
    const c = this.ctx, t0 = c.currentTime + t, o = c.createOscillator(), g = c.createGain();
    g.gain.value = 0;   // silent before the first event: a voice starting on a render-quantum boundary must not leak one sample at gain 1
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + (glide || a + hold + d));
    o.connect(g); this.dest(g, wet, pan);
    const end = this.shape(g.gain, t0, a, hold, d, peak);
    o.start(t0); o.stop(end);
  },
  burst({ kind = 'white', t = 0, a = 0.002, hold = 0, d = 0.05, peak = 0.05, wet = 0.1, pan = 0, hp = 0, lp = 0, bp = 0, q = 0.8, sweep = 0 }) {
    const c = this.ctx, t0 = c.currentTime + t, s = c.createBufferSource();
    s.buffer = this.noiseBuf(kind); s.loop = true;
    let n = s;
    const filt = (type, f, qq) => { const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = qq; n.connect(fl); n = fl; return fl; };
    if (hp) filt('highpass', hp, 0.7);
    if (lp) filt('lowpass', lp, 0.7);
    if (bp) { const fl = filt('bandpass', bp, q); if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t0 + a + hold + d * 0.7); }
    const g = c.createGain(); g.gain.value = 0; n.connect(g); this.dest(g, wet, pan);
    const end = this.shape(g.gain, t0, a, hold, d, peak);
    s.start(t0, Math.random() * 3.5); s.stop(end);
  },
  /** glass / celesta strike: harmonic partials with a slightly stretched 4th, a soft mallet transient, long hall tail */
  chime(f, peak = 0.04, t = 0, pan = 0, wet = 0.5, len = 1.5) {
    for (const [r, amp, df, a] of [[1, 1, 1, 0.006], [2, 0.3, 0.55, 0.003], [3, 0.09, 0.32, 0.002], [4.18, 0.045, 0.2, 0.002]])
      if (f * r < 15000) this.tone({ f: f * r, t, a, d: len * df, peak: peak * amp, wet, pan });
    this.burst({ kind: 'white', t, hp: 3500, a: 0.0005, d: 0.012, peak: peak * 0.22, wet: wet * 0.5, pan });
  },
  /** nearest note of D major pentatonic, so legacy pitches stay in key */
  snap(f) {
    const m = 69 + 12 * Math.log2(Math.max(20, f) / 440); let best = Math.round(m), bd = 99;
    for (let k = Math.floor(m) - 2; k <= Math.ceil(m) + 2; k++) { const pc = ((k % 12) + 12) % 12; if (this.PENTA.includes(pc) && Math.abs(k - m) < bd) { bd = Math.abs(k - m); best = k; } }
    return this.mf(best);
  },

  // ── ambient bed ──
  startAmbience() {
    const c = this.ctx, t = c.currentTime, A = (this.amb = { voices: [], chord: 0, key: null });
    const lfo = (rate, depth, param) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g); g.connect(param); o.start(t); return o; };
    // pad: 5 voices × 2 detuned saws → fade (chord changes) → breath (slow swell) → pan → shared low-pass
    A.pad = c.createGain(); A.pad.gain.value = 0;
    A.lp = c.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.frequency.value = 620; A.lp.Q.value = 0.6;
    A.lp.connect(A.pad); this.dest(A.pad, 0.75);
    lfo(0.041, 240, A.lp.frequency);
    const pans = [0, -0.45, 0.42, -0.25, 0.3];
    this.CHORDS[0].forEach((m, k) => {
      const fade = c.createGain(), breath = c.createGain();
      fade.gain.value = 0.16; breath.gain.value = 0.75;
      fade.connect(breath);
      let nb = breath; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pans[k]; breath.connect(p); nb = p; }
      nb.connect(A.lp);
      lfo(0.027 + k * 0.011, 0.25, breath.gain);
      const os = [-6, 6].map((ct) => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mf(m); o.detune.value = ct + (Math.random() * 3 - 1.5); o.connect(fade); o.start(t); return o; });
      A.voices.push({ os, fade, m });
    });
    // solar wind: pink noise through a wandering band-pass, drifting across the stereo field
    const air = c.createBufferSource(); air.buffer = this.noiseBuf('pink'); air.loop = true;
    const abp = c.createBiquadFilter(); abp.type = 'bandpass'; abp.frequency.value = 1000; abp.Q.value = 0.7;
    lfo(0.019, 520, abp.frequency);
    A.air = c.createGain(); A.air.gain.value = 0;
    air.connect(abp); abp.connect(A.air);
    let an = A.air; if (c.createStereoPanner) { const p = c.createStereoPanner(); lfo(0.013, 0.75, p.pan); A.air.connect(p); an = p; }
    this.dest(an, 0.55);
    air.start(t);
    // sub-bass floor (D1)
    const sub = c.createOscillator(); sub.frequency.value = this.mf(26);
    A.sub = c.createGain(); A.sub.gain.value = 0; sub.connect(A.sub); this.dest(A.sub, 0); sub.start(t);
    // reaction-wheel hum, heard only in the NISAR close-up
    A.rw = c.createGain(); A.rw.gain.value = 0;
    const rbp = c.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = 170; rbp.Q.value = 0.8; rbp.connect(A.rw); this.dest(A.rw, 0.3);
    [[66.5, 1], [133.2, 0.55], [199.4, 0.3], [398.9, 0.08]].forEach(([f, a]) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.value = a; o.connect(g); g.connect(rbp); lfo(0.17 + Math.random() * 0.1, f * 0.003, o.frequency); o.start(t); });
    A.timer = setInterval(() => this.nextChord(), 21000);
    this.update();
  },
  /** voices change one after another while faded down: the chord blooms into the next one, nothing slides */
  nextChord() {
    const A = this.amb; if (!A || !this.live()) return;
    A.chord = (A.chord + 1) % this.CHORDS.length;
    const t = this.ctx.currentTime;
    this.CHORDS[A.chord].forEach((m, k) => {
      const v = A.voices[k]; if (v.m === m) return;
      const t1 = t + 0.05 + k * 1.3, fg = v.fade.gain;
      fg.cancelScheduledValues(t1);
      fg.setValueAtTime(0.16, t1);
      fg.linearRampToValueAtTime(0, t1 + 2.6);
      for (const o of v.os) o.frequency.setValueAtTime(this.mf(m), t1 + 2.75);
      fg.setValueAtTime(0, t1 + 2.9);
      fg.linearRampToValueAtTime(0.16, t1 + 6.0);
      v.m = m;
    });
  },
  /** called every frame: follows the view (globe / terrain / NISAR close-up) with slow crossfades */
  update() {
    const A = this.amb; if (!A || !this.on) return;
    const key = S.view + (S.satCam ? '|sat' : '');
    if (key === A.key) return; A.key = key;
    const wide = S.view !== 'terrain';
    this.glide(A.pad.gain, wide ? 0.03 : S.satCam ? 0.02 : 0.022, 3);
    this.glide(A.lp.frequency, wide ? 820 : 620, 4);
    this.glide(A.air.gain, wide ? 0.022 : 0.016, 3);
    this.glide(A.sub.gain, wide ? 0.009 : 0.012, 3);
    this.glide(A.rw.gain, S.satCam ? 0.035 : 0, 2);
  },
  setOn(on) {
    on = !!on;
    if (on && !this.init()) return false;
    if (!this.ctx) return false;
    this.on = on;
    const c = this.ctx;
    clearTimeout(this.sleepT);
    if (on && c.state === 'suspended' && c.resume) { const p = c.resume(); if (p && p.catch) p.catch(() => {}); }
    this.glide(this.out.gain, on ? 0.9 : 0, on ? 1.0 : 0.35);
    if (on && !this.amb) this.startAmbience();
    if (this.amb) this.amb.key = null;
    if (!on && c.suspend) this.sleepT = setTimeout(() => { if (!this.on) { const p = c.suspend(); if (p && p.catch) p.catch(() => {}); } }, 900);
    return on;
  },

  // ── interface ──
  click() { if (!this.live() || !this.gate('click', 35)) return; this.burst({ bp: 2600, q: 0.9, a: 0.0008, d: 0.03, peak: 0.17, wet: 0.06 }); this.tone({ f: 220, f2: 110, glide: 0.05, a: 0.0015, d: 0.07, peak: 0.15, wet: 0.08 }); },
  tick() { if (!this.live() || !this.gate('tick', 60)) return; this.burst({ hp: 5000, a: 0.0006, d: 0.012, peak: 0.03, wet: 0.03 }); },
  mark() { if (!this.live()) return; this.click(); this.chime(this.mf(83), 0.022, 0.012, 0, 0.4, 0.9); },
  blip(freq = 880, dur = 0.1, type = 'sine', vol = 0.06) { if (!this.live() || !this.gate('blip', 60)) return; this.chime(this.snap(freq), clamp(vol * 0.5, 0.015, 0.04), 0, 0, 0.45, 1.2); },
  open() { if (!this.live() || !this.gate('open', 120)) return; this.burst({ kind: 'pink', bp: 900, sweep: 2600, q: 0.7, a: 0.09, d: 0.25, peak: 0.07, wet: 0.35 }); this.chime(this.mf(76), 0.022, 0.06, 0, 0.5, 1.0); },
  step() { if (!this.live()) return; this.chime(this.mf(81), 0.028, 0, -0.12, 0.55, 1.6); this.chime(this.mf(88), 0.018, 0.09, 0.15, 0.55, 1.8); },
  ping() { if (!this.live() || !this.gate('ping', 120)) return; this.chime(this.mf(81), 0.04, 0, -0.15); this.chime(this.mf(88), 0.032, 0.11, 0.15); this.tone({ f: this.mf(62), a: 0.01, d: 1.2, peak: 0.025, wet: 0.5 }); },
  powerUp() {
    if (!this.live()) return;
    this.burst({ kind: 'pink', bp: 500, sweep: 1800, q: 0.6, a: 0.7, d: 1.4, peak: 0.05, wet: 0.5 });
    this.tone({ f: this.mf(50), a: 0.4, hold: 0.2, d: 2.4, peak: 0.04, wet: 0.6 });
    this.chime(this.mf(81), 0.03, 0.35, -0.2, 0.6, 2.0); this.chime(this.mf(86), 0.025, 0.5, 0.2, 0.6, 2.2);
  },
  success() {
    if (!this.live()) return;
    [74, 78, 81, 86].forEach((m, i) => this.chime(this.mf(m), 0.032, i * 0.085, (i - 1.5) * 0.25, 0.6, 1.9));
    this.tone({ f: this.mf(50), a: 0.05, d: 2.2, peak: 0.03, wet: 0.6 });
  },

  // ── cinematic ──
  whoosh(dur = 1.4, up = true) {
    if (!this.live() || !this.gate('whoosh', 250)) return;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource();
    s.buffer = this.noiseBuf('pink'); s.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(up ? 220 : 3800, t); lp.frequency.exponentialRampToValueAtTime(up ? 3800 : 200, t + dur);
    const g = c.createGain(), N = 64, cv = new Float32Array(N);
    g.gain.value = 0;
    for (let i = 0; i < N; i++) { const x = i / (N - 1); cv[i] = 0.2 * Math.pow(Math.sin(Math.PI * Math.pow(x, up ? 0.75 : 1.3)), 2); }
    g.gain.setValueCurveAtTime(cv, t, dur);
    s.connect(hp); hp.connect(lp); lp.connect(g);
    let n = g; if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.setValueAtTime(up ? -0.55 : 0.55, t); p.pan.linearRampToValueAtTime(up ? 0.55 : -0.55, t + dur); g.connect(p); n = p; }
    this.dest(n, 0.35);
    s.start(t, Math.random() * 3); s.stop(t + dur + 0.05);
    this.tone({ f: up ? 52 : 44, f2: up ? 38 : 30, glide: dur, a: dur * 0.45, d: dur * 0.9, peak: 0.08, wet: 0.1 });
  },
  scan() {
    if (!this.live()) return;
    this.tone({ f: 110, f2: 82.4, glide: 1.2, a: 0.02, d: 1.6, peak: 0.08, wet: 0.45 });
    this.burst({ kind: 'pink', bp: 500, sweep: 3000, q: 1.1, a: 0.35, hold: 0.2, d: 0.9, peak: 0.07, wet: 0.5, pan: -0.3 });
    this.chime(this.mf(62), 0.03, 0.05, 0, 0.6, 2.2);
  },
  /** unwrapping starts: a shimmering pentatonic cascade over a rising air swell */
  arp(n = 6) {
    if (!this.live()) return;
    const notes = [74, 76, 78, 81, 83, 86, 88, 90];
    for (let k = 0; k < n; k++) this.chime(this.mf(notes[k % notes.length]), 0.03 * (1 - k / (n * 1.6)), k * 0.075, k % 2 ? 0.35 : -0.35, 0.55, 1.4);
    this.burst({ kind: 'pink', bp: 1200, sweep: 5200, q: 0.5, a: 0.5, d: 0.9, peak: 0.04, wet: 0.5 });
  },
  /** change detected: a two-tone attention chime (B5 → F#5) over a soft low tone, not a siren */
  alarm() {
    if (!this.live() || !this.gate('alarm', 600)) return;
    this.chime(this.mf(83), 0.05, 0, -0.2, 0.5, 1.5);
    this.chime(this.mf(78), 0.05, 0.22, 0.2, 0.5, 1.8);
    this.tone({ f: this.mf(50), a: 0.05, hold: 0.4, d: 1.4, peak: 0.04, wet: 0.4 });
  },
  /** Mw 7.9 rupture: fault crack, sub drop, rolling rumble with ground-shake flutter, debris crackle */
  boom() {
    if (!this.live()) return;
    const c = this.ctx, t = c.currentTime;
    this.burst({ bp: 700, q: 0.6, a: 0.003, hold: 0.04, d: 0.5, peak: 0.3, wet: 0.4 });
    this.tone({ f: 58, f2: 24, glide: 2.6, a: 0.04, hold: 0.3, d: 3.2, peak: 0.42, wet: 0.15 });
    const s = c.createBufferSource(); s.buffer = this.noiseBuf('brown'); s.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(90, t + 3.5);
    const g = c.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.25); g.gain.linearRampToValueAtTime(0.42, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 5.2); g.gain.linearRampToValueAtTime(0, t + 5.4);
    const am = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.setValueAtTime(7, t); lfo.frequency.linearRampToValueAtTime(2.5, t + 3.5); lg.gain.value = 0.35;
    lfo.connect(lg); lg.connect(am.gain);
    s.connect(lp); lp.connect(g); g.connect(am); this.dest(am, 0.3);
    s.start(t, Math.random() * 2); s.stop(t + 6); lfo.start(t); lfo.stop(t + 6);
    for (let k = 0; k < 26; k++) { const tk = 0.15 + Math.pow(Math.random(), 1.7) * 2.6; this.burst({ t: tk, bp: 1400 + Math.random() * 2600, q: 1.4, a: 0.001, d: 0.04 + Math.random() * 0.08, peak: (0.03 + Math.random() * 0.05) * (1 - tk / 3), wet: 0.25, pan: Math.random() * 1.6 - 0.8 }); }
  },

  // ── spacecraft ──
  /** RCS thruster puff (cinematic: space is silent, the film convention is not) */
  rcs() {
    if (!this.live() || !this.gate('rcs', 140)) return;
    const pan = Math.random() * 1.4 - 0.7;
    this.burst({ hp: 600, bp: 2200, q: 0.5, a: 0.006, hold: 0.05, d: 0.16, peak: 0.06, wet: 0.12, pan });
    this.burst({ hp: 4000, a: 0.0005, d: 0.006, peak: 0.025, wet: 0.02, pan });
  },
  /** deployment motor: a smooth geared hum that spins up, holds and winds down */
  servo(dur = 3, delay = 0) {
    if (!this.live()) return;
    const c = this.ctx, t = c.currentTime + delay, end = t + dur;
    const g = c.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.35); g.gain.setValueAtTime(1, Math.max(t + 0.4, end - 0.5)); g.gain.linearRampToValueAtTime(0, end);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.1; bp.connect(g);
    const mk = (type, mult, gain, toBp) => {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; og.gain.value = gain;
      o.frequency.setValueAtTime(70 * mult, t); o.frequency.exponentialRampToValueAtTime(105 * mult, t + 0.6); o.frequency.linearRampToValueAtTime(118 * mult, end);
      o.connect(og); og.connect(toBp ? bp : g); o.start(t); o.stop(end + 0.05);
    };
    mk('sawtooth', 1, 0.07, true);
    mk('triangle', 4.02, 0.012, false);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf('white'); s.loop = true;
    const nb = c.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 2500; nb.Q.value = 2;
    const am = c.createGain(); am.gain.value = 0.5;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 31; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    const ng = c.createGain(); ng.gain.value = 0.02;
    s.connect(nb); nb.connect(am); am.connect(ng); ng.connect(g);
    s.start(t, Math.random() * 3); s.stop(end + 0.05); lfo.start(t); lfo.stop(end + 0.05);
    this.dest(g, 0.25, -0.2);
  },
  /** hinge latch: low thump, metal transient and an inharmonic metallic ring; the final latch adds a resolved chord */
  latch(final = false) {
    if (!this.live()) return;
    const k = final ? 1.35 : 1;
    this.tone({ f: 140, f2: 48, glide: 0.12, a: 0.002, d: 0.25, peak: 0.2 * k, wet: 0.2 });
    this.burst({ bp: 3200, q: 1.6, a: 0.0007, d: 0.03, peak: 0.12 * k, wet: 0.2 });
    for (const [r, a, d] of [[1, 0.026, 0.6], [2.76, 0.016, 0.38], [5.4, 0.01, 0.22], [8.93, 0.005, 0.12]]) this.tone({ f: 560 * r, t: 0.002, a: 0.001, d, peak: a * k, wet: 0.35 });
    if (final) [74, 78, 81, 86].forEach((m, i) => this.chime(this.mf(m), 0.03, 0.28 + i * 0.09, (i - 1.5) * 0.25, 0.6, 1.8));
  },

  // ── data downlink (export) ──
  /** soft gated data hiss over an open fifth; returns a stop function */
  stream() {
    if (!this.live()) return () => {};
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.6);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf('pink'); s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    const am = c.createGain(); am.gain.value = 0.5;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 9; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    const ng = c.createGain(); ng.gain.value = 0.05;
    s.connect(bp); bp.connect(am); am.connect(ng); ng.connect(g);
    const os = [this.mf(62), this.mf(69)].map((f, i) => { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = f; og.gain.value = 0.018 - i * 0.004; o.connect(og); og.connect(g); o.start(t); return o; });
    this.dest(g, 0.45);
    s.start(t, Math.random() * 3); lfo.start(t);
    let stopped = false;
    return () => {
      if (stopped) return; stopped = true;
      this.glide(g.gain, 0, 0.5);
      setTimeout(() => { try { s.stop(); lfo.stop(); os.forEach((o) => o.stop()); } catch (e) { /* already stopped */ } }, 1500);
    };
  },
  packet() { if (!this.live() || !this.gate('packet', 45)) return; this.burst({ bp: 3500 + Math.random() * 2000, q: 2, a: 0.0005, d: 0.02, peak: 0.08, wet: 0.15, pan: Math.random() * 1.2 - 0.6 }); },
};
