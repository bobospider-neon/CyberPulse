// ───────────────────────── 12 · CANVAS CHARTS (phasor clock, time series, profile, timeline, maps) ─────────────────────────
const INK = '#dcebfa', INK_DIM = '#8ea6be', INK_FAINT = '#53697f', LINE = 'rgba(128,188,255,0.16)', GOLD = '#ffb648', CYAN = '#3ee6ff', RED = '#ff4a4a';
function fitCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w: r.width, h: r.height };
}
const MONO = (px) => `${px}px "Martian Mono", "JetBrains Mono", ui-monospace, Consolas, monospace`;

/** Complex phasor diagram: mean interferometric phasor (length γ, angle φ), single-look samples, Just–Bamler phase PDF */
const Phasor = {
  trail: [], samples: [], last: 0,
  draw(cv, phi, gamma, band, time) {
    const { g, w, h } = fitCanvas(cv);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.38;
    g.clearRect(0, 0, w, h);
    const col = band === 'S' ? CYAN : GOLD;
    // rings & axes
    g.strokeStyle = LINE; g.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75, 1]) { g.beginPath(); g.arc(cx, cy, R * f, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R * 1.12, cy); g.lineTo(cx + R * 1.12, cy); g.moveTo(cx, cy - R * 1.12); g.lineTo(cx, cy + R * 1.12); g.stroke();
    g.fillStyle = INK_FAINT; g.font = MONO(8); g.textAlign = 'left'; g.fillText('I', cx + R * 1.06, cy - 4); g.fillText('Q', cx + 4, cy - R * 1.04);
    for (let a = 0; a < 12; a++) { const t = a / 12 * TAU; g.beginPath(); g.moveTo(cx + Math.cos(t) * R, cy - Math.sin(t) * R); g.lineTo(cx + Math.cos(t) * R * 0.94, cy - Math.sin(t) * R * 0.94); g.stroke(); }
    // phase PDF petal (single-look, Just & Bamler 1994)
    g.beginPath();
    for (let n = 0; n <= 180; n++) {
      const t = n / 180 * TAU - Math.PI, b = gamma * Math.cos(t - phi);
      const pdf = ((1 - gamma * gamma) / TAU) / (1 - b * b) * (1 + b * Math.acos(-b) / Math.sqrt(1 - b * b));
      const r = R * (1 + Math.min(pdf, 3) * 0.10);
      const x = cx + Math.cos(t) * r, y = cy - Math.sin(t) * r;
      n ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fillStyle = band === 'S' ? 'rgba(62,230,255,0.10)' : 'rgba(255,182,72,0.10)'; g.fill();
    g.strokeStyle = band === 'S' ? 'rgba(62,230,255,0.55)' : 'rgba(255,182,72,0.55)'; g.stroke();
    // single-look phasor cloud: z1·z2* with correlation γ
    if (time - this.last > 0.09 || !this.samples.length) {
      this.last = time; this.samples = [];
      const r = mulberry32((time * 1000) | 0), gs = gaussian(r);
      const c = Math.sqrt(Math.max(0, 1 - gamma * gamma));
      for (let n = 0; n < 70; n++) {
        const ar = gs(), ai = gs(), br = gamma * ar + c * gs(), bi = gamma * ai + c * gs();
        let re = ar * br + ai * bi, im = ai * br - ar * bi;
        const m = Math.hypot(re, im) || 1, ang = Math.atan2(im, re) + phi;
        const mag = Math.min(1.1, m / 2);
        this.samples.push([Math.cos(ang) * mag, Math.sin(ang) * mag]);
      }
    }
    g.fillStyle = 'rgba(220,235,250,0.5)';
    for (const [x, y] of this.samples) { g.beginPath(); g.arc(cx + x * R, cy - y * R, 1.2, 0, TAU); g.fill(); }
    // trail of the mean phasor
    this.trail.push(phi); if (this.trail.length > 40) this.trail.shift();
    g.lineWidth = 2;
    for (let n = 1; n < this.trail.length; n++) {
      g.strokeStyle = band === 'S' ? `rgba(62,230,255,${n / this.trail.length * 0.5})` : `rgba(255,182,72,${n / this.trail.length * 0.5})`;
      g.beginPath(); g.arc(cx, cy, R * 1.04, -this.trail[n - 1], -this.trail[n], wrapPi(this.trail[n] - this.trail[n - 1]) > 0); g.stroke();
    }
    // angle arc & mean phasor
    g.strokeStyle = 'rgba(220,235,250,0.4)'; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R * 0.22, 0, -phi, phi > 0); g.stroke();
    const tx = cx + Math.cos(phi) * R * gamma, ty = cy - Math.sin(phi) * R * gamma;
    g.shadowColor = col; g.shadowBlur = 12; g.strokeStyle = col; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(tx, ty); g.stroke();
    g.shadowBlur = 0;
    const ah = 7, an = Math.atan2(cy - ty, tx - cx);
    g.fillStyle = col; g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - Math.cos(an - 0.4) * ah, ty + Math.sin(an - 0.4) * ah); g.lineTo(tx - Math.cos(an + 0.4) * ah, ty + Math.sin(an + 0.4) * ah); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 2, 0, TAU); g.fill();
    g.fillStyle = INK_DIM; g.font = MONO(8); g.textAlign = 'center';
    g.fillText(`|γ| ${gamma.toFixed(2)}`, cx, cy + R + 14);
  },
};

function drawTimeSeries(cv, series, tNow, events, unitLabel) {
  const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  const L = 34, Rm = 8, T = 8, B = 16;
  const xs = (t) => L + (t / CFG.tMax) * (w - L - Rm);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const p of s.pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
  if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - 0.5; hi = m + 0.5; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const ys = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
  g.strokeStyle = LINE; g.lineWidth = 1; g.font = MONO(8); g.fillStyle = INK_FAINT; g.textAlign = 'right';
  const step = niceStep((hi - lo) / 3);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { const y = ys(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - Rm, y); g.stroke(); g.fillText(fmtTick(v), L - 4, y + 3); }
  g.textAlign = 'center';
  for (let m = 0; m <= 11; m += 2) { const t = m * 30.44; const d = dateAt(t); g.fillText(d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), xs(t), h - 4); }
  for (const ev of events) { if (!Number.isFinite(ev.t) || ev.t > CFG.tMax) continue; g.strokeStyle = 'rgba(255,74,74,0.6)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(xs(ev.t), T); g.lineTo(xs(ev.t), h - B); g.stroke(); g.setLineDash([]); }
  for (const s of series) {
    if (s.kind === 'line') {
      const grd = g.createLinearGradient(0, T, 0, h - B); grd.addColorStop(0, s.fill); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.beginPath(); s.pts.forEach((p, n) => (n ? g.lineTo(xs(p[0]), ys(p[1])) : g.moveTo(xs(p[0]), ys(p[1]))));
      g.lineTo(xs(s.pts[s.pts.length - 1][0]), h - B); g.lineTo(xs(s.pts[0][0]), h - B); g.closePath(); g.fillStyle = grd; g.fill();
      g.beginPath(); s.pts.forEach((p, n) => (n ? g.lineTo(xs(p[0]), ys(p[1])) : g.moveTo(xs(p[0]), ys(p[1]))));
      g.strokeStyle = s.color; g.lineWidth = 1.6; g.stroke();
    } else {
      g.fillStyle = s.color;
      for (const p of s.pts) { g.beginPath(); g.arc(xs(p[0]), ys(p[1]), 1.8, 0, TAU); g.fill(); }
    }
  }
  const x = xs(tNow);
  g.strokeStyle = '#fff'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, h - B); g.stroke();
  const cur = series[0] && series[0].pts.length ? interpSeries(series[0].pts, tNow) : null;
  if (cur !== null) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x, ys(cur), 3, 0, TAU); g.fill(); g.shadowBlur = 0; }
  g.fillStyle = INK_FAINT; g.textAlign = 'left'; g.fillText(unitLabel, 2, 9);
}
function interpSeries(pts, t) {
  for (let n = 1; n < pts.length; n++) if (pts[n][0] >= t) { const a = pts[n - 1], b = pts[n]; return lerp(a[1], b[1], (t - a[0]) / Math.max(1e-9, b[0] - a[0])); }
  return pts[pts.length - 1][1];
}
function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9)))); const m = x / e; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e; }
function fmtTick(v) { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2); }

function drawTimeline(cv, S, sc) {
  const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  const L = 8, R = 8, y0 = 30;
  const xs = (t) => L + (t / CFG.tMax) * (w - L - R);
  // track
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(L, y0 - 2, w - L - R, 4);
  const grd = g.createLinearGradient(L, 0, xs(S.t), 0); grd.addColorStop(0, 'rgba(62,230,255,0.5)'); grd.addColorStop(1, 'rgba(255,182,72,0.9)');
  g.fillStyle = grd; g.fillRect(L, y0 - 2, xs(S.t) - L, 4);
  // epochs
  g.font = MONO(8); g.textAlign = 'center';
  for (let k = 0; k < CFG.nEpochs; k++) {
    const t = k * CFG.repeatDays, x = xs(t), past = t <= S.t + 1e-6;
    g.fillStyle = past ? 'rgba(255,182,72,0.9)' : 'rgba(142,166,190,0.45)';
    g.fillRect(x - 0.5, y0 - 8, 1, 16);
    if (k % 4 === 0) { g.fillStyle = past ? INK_DIM : INK_FAINT; g.fillText(epochName(k), x, y0 + 20); }
  }
  // months
  g.fillStyle = INK_FAINT; g.textAlign = 'left';
  let lastM = -1;
  for (let t = 0; t <= CFG.tMax; t += 1) { const d = dateAt(t); if (d.getUTCDate() === 1 && d.getUTCMonth() !== lastM) { lastM = d.getUTCMonth(); const x = xs(t); g.fillRect(x, 8, 1, 6); g.fillText(d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase() + (lastM === 0 ? ' ’' + String(d.getUTCFullYear()).slice(2) : ''), x + 3, 13); } }
  // reference pass
  const tRef = S.pair === 'seq' ? Math.max(0, S.t - 12) : 0;
  g.strokeStyle = CYAN; g.lineWidth = 1.5; g.beginPath(); g.moveTo(xs(tRef), y0 - 11); g.lineTo(xs(tRef), y0 + 11); g.stroke();
  g.fillStyle = CYAN; g.font = MONO(7.5); g.textAlign = 'center'; g.fillText('REF', xs(tRef), y0 - 14);
  // events
  if (sc) for (const ev of sc.events) {
    if (!Number.isFinite(ev.t)) continue;
    const x = xs(ev.t);
    g.fillStyle = RED; g.save(); g.translate(x, y0); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore();
    g.shadowColor = RED; g.shadowBlur = 8; g.fillRect(x - 0.5, y0 - 14, 1, 6); g.shadowBlur = 0;
  }
  // real NISAR acquisitions over this scene (13b_nisar.js)
  realTimelineTicks(g, xs, y0);
  // playhead
  const x = xs(S.t);
  g.shadowColor = GOLD; g.shadowBlur = 14; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y0, 6, 0, TAU); g.fill(); g.shadowBlur = 0;
  g.strokeStyle = GOLD; g.lineWidth = 2; g.beginPath(); g.arc(x, y0, 9, 0, TAU); g.stroke();
}

function drawProfile(cv, prof, S, sc) {
  const { g, w, h } = fitCanvas(cv);
  g.clearRect(0, 0, w, h);
  if (!prof) return;
  const L = 46, R = 46, T = 10, B = 20, split = 0.66;
  const hTop = (h - T - B) * split, yTopEnd = T + hTop, yBotStart = yTopEnd + 10;
  const xs = (d) => L + d / prof.lenKm * (w - L - R);
  let lo = Infinity, hi = -Infinity;
  for (const p of prof.pts) { lo = Math.min(lo, p.g0, p.g1, p.water ?? Infinity); hi = Math.max(hi, p.g0, p.g1, p.canopy ?? -Infinity, p.bld ?? -Infinity); }
  const pad = Math.max(2, (hi - lo) * 0.08); lo -= pad; hi += pad;
  const ys = (v) => T + (1 - (v - lo) / (hi - lo)) * hTop;
  g.font = MONO(8); g.fillStyle = INK_FAINT; g.strokeStyle = LINE; g.lineWidth = 1; g.textAlign = 'right';
  const st = niceStep((hi - lo) / 3);
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { const y = ys(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText(fmtTick(v) + ' m', L - 4, y + 3); }
  // canopy band
  const fillBetween = (getA, getB, color) => {
    g.beginPath(); let started = false;
    prof.pts.forEach((p) => { const a = getA(p); if (a === null) return; const x = xs(p.d); started ? g.lineTo(x, ys(a)) : (g.moveTo(x, ys(a)), started = true); });
    for (let n = prof.pts.length - 1; n >= 0; n--) { const p = prof.pts[n]; const b = getB(p); if (b === null) continue; g.lineTo(xs(p.d), ys(b)); }
    g.closePath(); g.fillStyle = color; g.fill();
  };
  if (prof.pts.some((p) => p.canopy !== null)) fillBetween((p) => (p.canopy !== null ? p.canopy : p.g1), (p) => p.g1, 'rgba(76,242,168,0.25)');
  if (prof.pts.some((p) => p.water !== null)) fillBetween((p) => (p.water !== null ? Math.max(p.water, p.g1) : p.g1), (p) => p.g1, 'rgba(60,150,255,0.45)');
  if (prof.pts.some((p) => p.bld !== null)) { g.fillStyle = 'rgba(255,182,72,0.35)'; prof.pts.forEach((p) => { if (p.bld !== null) { const x = xs(p.d); g.fillRect(x - 1, ys(p.bld), 2, ys(p.g1) - ys(p.bld)); } }); }
  // ground: reference pass vs current pass (exaggerated)
  const line = (key, color, dash) => { g.setLineDash(dash || []); g.beginPath(); prof.pts.forEach((p, n) => (n ? g.lineTo(xs(p.d), ys(p[key])) : g.moveTo(xs(p.d), ys(p[key])))); g.strokeStyle = color; g.lineWidth = 1.6; g.stroke(); g.setLineDash([]); };
  line('g0', 'rgba(220,235,250,0.55)', [4, 3]);
  line('g1', CYAN);
  // displacement strip (true mm)
  let dlo = Infinity, dhi = -Infinity;
  for (const p of prof.pts) { dlo = Math.min(dlo, p.u, p.los); dhi = Math.max(dhi, p.u, p.los); }
  const span = Math.max(1, dhi - dlo); dlo -= span * 0.1; dhi += span * 0.1;
  const yd = (v) => yBotStart + (1 - (v - dlo) / (dhi - dlo)) * (h - B - yBotStart);
  g.strokeStyle = LINE; g.beginPath(); g.moveTo(L, yd(0)); g.lineTo(w - R, yd(0)); g.stroke();
  const dl = (key, color) => { g.beginPath(); prof.pts.forEach((p, n) => (n ? g.lineTo(xs(p.d), yd(p[key])) : g.moveTo(xs(p.d), yd(p[key])))); g.strokeStyle = color; g.lineWidth = 1.4; g.stroke(); };
  dl('u', '#ff8f6b'); dl('los', GOLD);
  g.fillStyle = INK_FAINT; g.textAlign = 'left';
  g.fillText(`${fmtTick(dhi)} mm`, w - R + 4, yBotStart + 6); g.fillText(`${fmtTick(dlo)} mm`, w - R + 4, h - B);
  g.textAlign = 'center';
  for (let d = 0; d <= prof.lenKm + 1e-6; d += niceStep(prof.lenKm / 5)) g.fillText(`${fmtTick(d)} km`, xs(d), h - 5);
  // legend
  g.textAlign = 'left'; g.font = MONO(8);
  const leg = [['— pass ' + epochName(epochOf(prof.tRef)) + ' (ref)', 'rgba(220,235,250,0.7)'], ['— pass now ×' + Math.round(S.exag), CYAN], ['— U_z mm', '#ff8f6b'], ['— LoS mm', GOLD]];
  let lx = L + 4; for (const [t, c] of leg) { g.fillStyle = c; g.fillText(t, lx, T + 9); lx += g.measureText(t).width + 12; }
  if (prof.cursor >= 0) { const x = xs(prof.cursor); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(x, T); g.lineTo(x, h - B); g.stroke(); }
}

/** 2D radar thumbnail (CPU, downsampled) */
function renderRadarImage(sc, C, mode, band, size, out) {
  const N = sc.N, step = N / size;
  const img = out || new ImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = Math.min(N - 1, Math.floor((y + 0.5) * step)), j = Math.min(N - 1, Math.floor((x + 0.5) * step)), k = i * N + j;
    let c;
    if (mode === 'coh') c = coherenceRGB(cohK(sc, k, band, C));
    else if (mode === 'defo') { const d = trueDispK(sc, k, C.tCur); c = divergingRGB((C.geomFusion ? d[2] : d[0] * C.geom.los[0] + d[1] * C.geom.los[1] + d[2] * C.geom.los[2]) / Math.max(1e-6, C.defoRange)); }
    else if (mode === 'pol') { const p = polK(sc, k, band, C); const m = Math.max(p.fd.Pd, p.fd.Pv, p.fd.Ps, 1e-12); const br = clamp((10 * Math.log10(p.fd.span) + 25) / 22, 0.1, 1); c = [p.fd.Pd / m * br, p.fd.Pv / m * br, p.fd.Ps / m * br]; }
    else { const ig = igramK(sc, k, C, band); c = phaseRGB(ig.wrapped); if (C.mask && ig.gamma < 0.25) c = [0.075, 0.09, 0.11]; }
    const shade = 0.55 + 0.45 * clamp(sc.nrm.nz[k] - 0.3 * sc.nrm.nx[k] + 0.3 * sc.nrm.ny[k], 0, 1);
    const o = (y * size + x) * 4;
    img.data[o] = clamp(c[0] * shade, 0, 1) * 255; img.data[o + 1] = clamp(c[1] * shade, 0, 1) * 255; img.data[o + 2] = clamp(c[2] * shade, 0, 1) * 255; img.data[o + 3] = 255;
  }
  return img;
}
