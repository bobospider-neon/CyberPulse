// ───────────────────────── 04b · CPU MIRROR OF THE GPU SHADERS (pure) ─────────────────────────
// Every function here has a GLSL twin in 06_shaders.js. The inspector, the phase
// unwrapper and the change detector use these, so numbers and colours always agree.
function basisW(sc, t) { return sc.weights(clamp(t, 0, CFG.tMax)); }

/** All pixel-independent quantities for one (tRef, tCur, X, band, geometry) state. Uploaded as uniforms. */
function timeCtx(sc, S) {
  const tRef = S.tRef, tCur = S.tCur;
  const wC = basisW(sc, tCur), wR = basisW(sc, tRef), w0 = basisW(sc, 0), f = sc.flags;
  const pw = [0, 1, 2, 3].map((b) => (wC[b] - wR[b]) * f.phase[b]);
  const mw = [0, 1, 2, 3].map((b) => (wC[b] - w0[b]) * f.mesh[b] * (f.exag[b] ? S.X : 1));
  const lo = Math.min(tRef, tCur), hi = Math.max(tRef, tCur);
  const evCur = [0, 0, 0, 0], evBetween = [0, 0, 0, 0];
  sc.events.forEach((e, n) => {
    if (n > 3 || !Number.isFinite(e.t)) return;
    evCur[n] = hi >= e.t ? 1 : 0;
    evBetween[n] = lo < e.t && e.t <= hi ? 1 : 0;
  });
  const A = apsWeightsAt(sc, tCur), R = apsWeightsAt(sc, tRef);
  const glac = sc.kind === 'glacier';
  return {
    tRef, tCur, X: S.X, pw, mw, wC, evCur, evBetween,
    pulseC: sc.pulse ? sc.pulse(clamp(tCur, 0, CFG.tMax)) : 0, pulseR: sc.pulse ? sc.pulse(clamp(tRef, 0, CFG.tMax)) : 0,
    calveC: glac ? wC[2] : 0, calveR: glac ? wR[2] : 0,
    apsW: [A.w[0] - R.w[0], A.w[1] - R.w[1], A.w[2] - R.w[2], A.w[3] - R.w[3]], strat: A.s - R.s,
    noiseW: noiseWeights(epochOf(tCur), epochOf(tRef)), dt: tCur - tRef,
    geom: S.geomObj, band: S.bandEff || 'L', aps: S.aps !== false,
  };
}
function apsWeightsAt(sc, t) {
  const e = clamp(t / CFG.repeatDays, 0, CFG.nEpochs - 1), k0 = Math.floor(e), k1 = Math.min(k0 + 1, CFG.nEpochs - 1), f = smoothstep(0, 1, e - k0);
  const a = sc.aps.apsW[k0], b = sc.aps.apsW[k1];
  return { w: [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f), lerp(a[3], b[3], f)], s: lerp(sc.aps.strat[k0], sc.aps.strat[k1], f) };
}
function noiseWeights(kCur, kRef) {
  const r = gaussian(mulberry32(kCur * 977 + kRef * 131 + 7));
  const w = [r(), r(), r(), r()]; const L = Math.hypot(w[0], w[1], w[2], w[3]) || 1;
  return w.map((x) => x / L);
}
/** rupture propagation mask (fault scenes) */
function ruptureMask(sc, k) {
  if (!sc.rupture) return 1;
  return smoothstep(sc.rupture.front - sc.rupture.width, sc.rupture.front + sc.rupture.width, sc.fault.sAlong[k]);
}
function dispMeshK(sc, k, C) {
  let e = 0, n = 0, u = 0;
  for (let b = 0; b < sc.bases.length; b++) {
    let w = C.mw[b]; if (!w) continue;
    if (sc.rupture && b === 1) w *= ruptureMask(sc, k);
    const d = sc.bases[b].data, o = k * 4; e += w * d[o]; n += w * d[o + 1]; u += w * d[o + 2];
  }
  return [e, n, u];
}
function wseK(sc, k, pulse) {
  if (sc.kind === 'glacier') return 0;
  if (sc.kind !== 'wetland') return -1e6;
  return sc.aux[k] + sc.bases[sc.waterBasis].data[k * 4 + 3] * pulse;
}
function groundK(sc, k, calve) {
  return sc.kind === 'glacier' ? sc.dem[k] + sc.bases[2].data[k * 4 + 2] * calve : sc.dem[k];
}
function floodedK(sc, k, pulse, calve) {
  if (!sc.hasWater) return 0;
  const w = wseK(sc, k, pulse);
  return sc.spill[k] <= w && groundK(sc, k, calve) < w ? 1 : 0;
}
/** land-cover fractions at tCur (events applied) */
function coverK(sc, k, C) {
  const c = sc.cover;
  const fr = { veg: c.veg[k], water: c.water[k], urban: c.urban[k], ice: c.ice[k], flooded: 0, canopyH: sc.canopyH[k] };
  for (let n = 0; n < sc.events.length && n < 4; n++) {
    if (!C.evCur[n]) continue;
    const ev = sc.events[n], m = ev.mask[k]; if (m <= 0.01) continue;
    if (ev.kind === 'debris' || ev.kind === 'fire') fr.veg *= 1 - 0.95 * m;
    else if (ev.kind === 'windthrow') { fr.veg *= 1 - 0.85 * m; fr.canopyH *= 1 - 0.8 * m; }
    else if (ev.kind === 'calving') { fr.ice *= 1 - m; fr.water = Math.max(fr.water, m); }
  }
  const fl = floodedK(sc, k, C.pulseC, C.calveC);
  if (sc.kind === 'wetland') fr.flooded = fl * (1 - fr.water);
  else if (sc.kind === 'glacier') fr.water = Math.max(fr.water, fl);
  return fr;
}
function cohK(sc, k, band, C) {
  if (sc.kind === 'custom') return clamp(sc.aux[k], 0.02, 0.99);
  const fr = coverK(sc, k, C);
  if (sc.kind === 'wetland') fr.flooded = Math.min(fr.flooded, floodedK(sc, k, C.pulseR, C.calveR));
  let g = coherenceAt(fr, band, C.dt, sc.kind === 'glacier' ? sc.aux[k] : 0);
  for (let n = 0; n < sc.events.length && n < 4; n++) if (C.evBetween[n]) g *= 1 - 0.93 * smoothstep(0.1, 0.45, sc.events[n].mask[k]);
  return clamp(g, 0.02, 0.99);
}
function apsK(sc, k, C) {
  if (!C.aps) return 0;
  const S = sc.aps.screens, w = C.apsW;
  return (w[0] * S[0][k] + w[1] * S[1][k] + w[2] * S[2][k] + w[3] * S[3][k]) * sc.aps.turb + C.strat * sc.aps.stratK * (sc.dem[k] - sc.emean);
}
function noiseK(sc, k, C) { const o = k * 4, n = sc.noise, w = C.noiseW; return n[o] * w[0] + n[o + 1] * w[1] + n[o + 2] * w[2] + n[o + 3] * w[3]; }
/** phase-relevant LoS displacement (m): deformation + double-bounce water level; no atmosphere */
function losK(sc, k, C, los) {
  los = los || C.geom.los;
  let d = 0;
  for (let b = 0; b < sc.bases.length; b++) {
    let w = C.pw[b]; if (!w) continue;
    if (sc.rupture && b === 1) w *= ruptureMask(sc, k);
    const v = sc.bases[b].data, o = k * 4;
    d += w * (v[o] * los[0] + v[o + 1] * los[1] + v[o + 2] * los[2]);
    if (v[o + 3]) {
      const fl = Math.min(floodedK(sc, k, C.pulseC, C.calveC), floodedK(sc, k, C.pulseR, C.calveR)) * sc.cover.veg[k];
      d += w * v[o + 3] * los[2] * fl;
    }
  }
  return d;
}
/** cumulative true displacement since the first pass (m, ENU), real scale (no exaggeration) */
function trueDispK(sc, k, t) {
  const w = basisW(sc, t), w0 = basisW(sc, 0), f = sc.flags;
  let e = 0, n = 0, u = 0;
  for (let b = 0; b < sc.bases.length; b++) {
    if (!f.mesh[b] || !f.exag[b]) continue;
    let dw = w[b] - w0[b]; if (!dw) continue;
    if (sc.rupture && b === 1) dw *= ruptureMask(sc, k);
    const d = sc.bases[b].data, o = k * 4; e += dw * d[o]; n += dw * d[o + 1]; u += dw * d[o + 2];
  }
  return [e, n, u];
}
/** one interferogram sample — exactly what the fragment shader paints at this cell */
function igramK(sc, k, C, band) {
  band = band || C.band;
  const lam = sc.lambda || BANDS[band].lambda;
  const dl = losK(sc, k, C);
  const atm = apsK(sc, k, C);
  const gamma = cohK(sc, k, band, C);
  const sig = phaseSigma(gamma);
  const phiTrue = (4 * Math.PI / lam) * (dl + atm);
  const phi = phiTrue + sig * noiseK(sc, k, C);
  return { los: dl, atm, phiTrue, phi, wrapped: wrapPi(phi), gamma, sigma: sig, lam };
}
/** brightness factor from the local incidence angle (foreshortening / shadow) */
function brightK(sc, k, los) {
  const n = sc.nrm, c = n.nx[k] * los[0] + n.ny[k] * los[1] + n.nz[k] * los[2];
  return c < 0.04 ? 0.03 : clamp(Math.pow(c / los[2], 1.3), 0.05, 5);
}
function texK(sc, k) { return Math.exp(0.18 * sc.noise[k * 4 + 1] + 0.12 * sc.noise[k * 4 + 3]); }
function hvjK(sc, k) { return Math.exp(0.11 * sc.noise[k * 4 + 2]); }
/** polarimetric covariance + Freeman–Durden at cell k */
function polK(sc, k, band, C) {
  if (sc.kind === 'custom') {
    const p = lin(sc.ampDb[k]);
    const Cv = { C11: p, C22: p * 0.05, C33: p, C13r: p * 0.6, C13i: 0 };
    return { C: Cv, fd: freemanDurden(Cv), fr: coverK(sc, k, C), agb: 0 };
  }
  const fr = coverK(sc, k, C);
  const agb = fr.veg > 0.05 ? agbFromHeight(fr.canopyH) : 0;
  const Cv = mixCovariance(fr, band, agb, brightK(sc, k, C.geom.los), texK(sc, k), hvjK(sc, k));
  return { C: Cv, fd: freemanDurden(Cv), fr, agb };
}
