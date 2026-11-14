// ───────────────────────── 05 · ALGORITHMS (pure) ─────────────────────────
/** binary min-heap: Int32 payload, Float64 key (lazy deletion friendly) */
function Heap(cap = 4096) {
  this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.size = 0;
}
Heap.prototype.push = function (v, key) {
  if (this.size >= this.k.length) {
    const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2;
    const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
  }
  let i = this.size++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (this.k[p] <= key) break;
    this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
  }
  this.k[i] = key; this.v[i] = v;
};
Heap.prototype.pop = function () {
  const top = this.v[0];
  const n = --this.size;
  const lk = this.k[n], lv = this.v[n];
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= n) break;
    if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
    if (this.k[c] >= lk) break;
    this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
  }
  if (n > 0) { this.k[i] = lk; this.v[i] = lv; }
  return top;
};

/**
 * Priority-flood (Barnes et al., 2014): the lowest water level that can reach each
 * cell from the seeds, i.e. the minimax elevation over all 4-connected paths.
 */
function priorityFlood(elev, N, seeds) {
  const NN = N * N, spill = new Float32Array(NN).fill(1e6), done = new Uint8Array(NN), heap = new Heap(NN);
  for (let k = 0; k < NN; k++) if (seeds[k]) { spill[k] = elev[k]; heap.push(k, elev[k]); }
  while (heap.size) {
    const k = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    const i = (k / N) | 0, j = k - i * N, s = spill[k];
    if (j > 0) relax(k - 1); if (j < N - 1) relax(k + 1); if (i > 0) relax(k - N); if (i < N - 1) relax(k + N);
    function relax(q) { if (done[q]) return; const v = Math.max(elev[q], s); if (v < spill[q]) { spill[q] = v; heap.push(q, v); } }
  }
  return spill;
}

/**
 * Quality-guided phase unwrapping (flood fill on a max-heap of coherence).
 * Stepped so the UI can animate the unwrapping front.
 */
class Unwrapper {
  constructor(N, wrapped, quality, valid, refK) {
    this.N = N; this.psi = wrapped; this.q = quality; this.valid = valid;
    const NN = N * N;
    this.phi = new Float32Array(NN).fill(NaN);
    this.order = new Int32Array(NN).fill(-1);
    this.region = new Int32Array(NN).fill(-1);
    this.done = new Uint8Array(NN);
    this.heap = new Heap(NN);
    this.count = 0; this.total = 0;
    const list = [];
    for (let k = 0; k < NN; k++) if (valid[k]) { this.total++; list.push(k); }
    // disconnected coherent islands each get their own seed (highest coherence first)
    this.seeds = Int32Array.from(list).sort((a, b) => quality[b] - quality[a]);
    this.seedPtr = 0;
    this.regionSeeds = [];
    this.ref = refK;
    this._startRegion(refK);
  }
  _startRegion(k) {
    const r = this.regionSeeds.length;
    this.regionSeeds.push(k);
    this.done[k] = 1; this.phi[k] = this.psi[k]; this.order[k] = this.count++; this.region[k] = r;
    this._pushNbrs(k);
  }
  _pushNbrs(k) {
    const N = this.N, i = (k / N) | 0, j = k - i * N;
    const tryq = (q) => { if (!this.done[q] && this.valid[q]) this.heap.push(q, -this.q[q]); };
    if (j > 0) tryq(k - 1); if (j < N - 1) tryq(k + 1); if (i > 0) tryq(k - N); if (i < N - 1) tryq(k + N);
  }
  /** unwrap up to `budget` pixels; returns true when every coherent pixel is done */
  step(budget) {
    const N = this.N;
    while (budget > 0) {
      if (!this.heap.size) {
        while (this.seedPtr < this.seeds.length && this.done[this.seeds[this.seedPtr]]) this.seedPtr++;
        if (this.seedPtr >= this.seeds.length) return true;
        this._startRegion(this.seeds[this.seedPtr]);
        budget--;
        continue;
      }
      const k = this.heap.pop();
      if (this.done[k]) continue;
      const i = (k / N) | 0, j = k - i * N;
      let best = -1, bq = -1;
      const cand = (q) => { if (this.done[q] && this.q[q] > bq) { bq = this.q[q]; best = q; } };
      if (j > 0) cand(k - 1); if (j < N - 1) cand(k + 1); if (i > 0) cand(k - N); if (i < N - 1) cand(k + N);
      if (best < 0) continue;
      this.phi[k] = this.phi[best] + wrapPi(this.psi[k] - this.psi[best]);
      this.done[k] = 1; this.order[k] = this.count++; this.region[k] = this.region[best];
      this._pushNbrs(k);
      budget--;
    }
    return false;
  }
}

// ── integral images for boxcar coherence estimation ──
function integral(src, N) {
  const S = new Float64Array((N + 1) * (N + 1));
  for (let i = 0; i < N; i++) {
    let row = 0;
    for (let j = 0; j < N; j++) { row += src[i * N + j]; S[(i + 1) * (N + 1) + j + 1] = S[i * (N + 1) + j + 1] + row; }
  }
  return S;
}
function boxSum(S, N, i, j, r) {
  const i0 = Math.max(0, i - r), i1 = Math.min(N, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(N, j + r + 1), W = N + 1;
  return S[i1 * W + j1] - S[i0 * W + j1] - S[i1 * W + j0] + S[i0 * W + j0];
}
function estimateCoherence(N, aRe, aIm, bRe, bIm, r = 2) {
  const NN = N * N, xr = new Float32Array(NN), xi = new Float32Array(NN), pa = new Float32Array(NN), pb = new Float32Array(NN);
  for (let k = 0; k < NN; k++) {
    xr[k] = aRe[k] * bRe[k] + aIm[k] * bIm[k];          // a · b*
    xi[k] = aIm[k] * bRe[k] - aRe[k] * bIm[k];
    pa[k] = aRe[k] * aRe[k] + aIm[k] * aIm[k];
    pb[k] = bRe[k] * bRe[k] + bIm[k] * bIm[k];
  }
  const Sxr = integral(xr, N), Sxi = integral(xi, N), Spa = integral(pa, N), Spb = integral(pb, N);
  const g = new Float32Array(NN);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const r1 = boxSum(Sxr, N, i, j, r), r2 = boxSum(Sxi, N, i, j, r);
    const d = Math.sqrt(boxSum(Spa, N, i, j, r) * boxSum(Spb, N, i, j, r));
    g[i * N + j] = d > 0 ? Math.hypot(r1, r2) / d : 0;
  }
  return g;
}

/**
 * Coherence Change Detection on three simulated SLCs: S0 (pre-2), S1 (pre-1), S2 (post).
 * Returns per-pixel γ̂_pre, γ̂_co, Δγ, detections and labelled alert polygons.
 */
function* ccdJob(sc, S, tPre2, tPre1, tPost) {
  const N = sc.N, NN = N * N, band = S.band === 'S' ? 'S' : 'L', lam = BANDS[band].lambda;
  const base = { X: 1, geomObj: S.geomObj, bandEff: band, aps: false };
  const Cpre = timeCtx(sc, { ...base, tRef: tPre2, tCur: tPre1 });
  const Cco = timeCtx(sc, { ...base, tRef: tPre1, tCur: tPost });
  const C0 = timeCtx(sc, { ...base, tRef: tPre2, tCur: tPre2 });
  const fl1 = new Uint8Array(NN), fl2 = new Uint8Array(NN);
  const gs = gaussian(mulberry32(sc.site.seed * 31337 + Math.round(tPost))), h = Math.SQRT1_2;
  const a0r = new Float32Array(NN), a0i = new Float32Array(NN), a1r = new Float32Array(NN), a1i = new Float32Array(NN), a2r = new Float32Array(NN), a2i = new Float32Array(NN);
  const k4 = 4 * Math.PI / lam;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const k = i * N + j;
      const A0 = Math.sqrt(Math.max(polK(sc, k, band, C0).C.C11, 1e-6));
      const p1 = polK(sc, k, band, Cpre), p2 = polK(sc, k, band, Cco);
      const A = Math.sqrt(Math.max(p1.C.C11, 1e-6)), A2 = Math.sqrt(Math.max(p2.C.C11, 1e-6));
      fl1[k] = p1.fr.flooded > 0.5 ? 1 : 0; fl2[k] = p2.fr.flooded > 0.5 ? 1 : 0;
      const gp = cohK(sc, k, band, Cpre);
      const gc = cohK(sc, k, band, Cco);
      const z0r = gs() * h, z0i = gs() * h;
      const c1 = Math.sqrt(Math.max(0, 1 - gp * gp)), c2 = Math.sqrt(Math.max(0, 1 - gc * gc));
      const z1r = gp * z0r + c1 * gs() * h, z1i = gp * z0i + c1 * gs() * h;
      const z2r = gc * z1r + c2 * gs() * h, z2i = gc * z1i + c2 * gs() * h;
      const ph1 = k4 * losK(sc, k, Cpre);
      const ph2 = ph1 + k4 * losK(sc, k, Cco);
      a0r[k] = A0 * z0r; a0i[k] = A0 * z0i;
      const c = Math.cos(ph1), s = Math.sin(ph1);
      a1r[k] = A * (z1r * c - z1i * s); a1i[k] = A * (z1r * s + z1i * c);
      const c3 = Math.cos(ph2), s3 = Math.sin(ph2);
      a2r[k] = A2 * (z2r * c3 - z2i * s3); a2i[k] = A2 * (z2r * s3 + z2i * c3);
    }
    if (i % 16 === 15) yield (i + 1) / N * 0.86;
  }
  yield 0.9;
  const gPre = estimateCoherence(N, a0r, a0i, a1r, a1i, 2);
  const gCo = estimateCoherence(N, a1r, a1i, a2r, a2i, 2);
  // intensity change (boxcar mean |S|², post vs pre) catches changes where coherence was already low (ice, water)
  const I1 = new Float32Array(NN), I2 = new Float32Array(NN);
  for (let k = 0; k < NN; k++) { I1[k] = a1r[k] * a1r[k] + a1i[k] * a1i[k]; I2[k] = a2r[k] * a2r[k] + a2i[k] * a2i[k]; }
  const SI1 = integral(I1, N), SI2 = integral(I2, N);
  const det0 = new Uint8Array(NN), dG = new Float32Array(NN), dI = new Float32Array(NN);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j;
    dG[k] = gPre[k] - gCo[k];
    dI[k] = 10 * Math.log10(Math.max(boxSum(SI2, N, i, j, 2), 1e-12) / Math.max(boxSum(SI1, N, i, j, 2), 1e-12));
    det0[k] = (dG[k] > 0.35 && gPre[k] > 0.45) || Math.abs(dI[k]) > 4.5 ? 1 : 0;
  }
  // 3×3 majority filter removes speckle false alarms
  const det = new Uint8Array(NN);
  for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) {
    let c = 0; for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) c += det0[(i + di) * N + j + dj];
    det[i * N + j] = c >= 5 ? 1 : 0;
  }
  yield 0.96;
  const comps = labelComponents(det, N, 8);
  const px = sc.grid.pixelM;
  const ev = sc.events.find((e) => Number.isFinite(e.t) && tPre1 < e.t && e.t <= tPost);
  const keep = [];
  for (const c of comps) {
    if (c.pix.length < 10) continue;
    let vol = 0, dg = 0, di = 0, ov = 0, flc = 0;
    for (const k of c.pix) {
      dg += dG[k]; di += dI[k]; if (fl1[k] !== fl2[k]) flc++;
      if (ev && ev.mask[k] > 0.3) { ov++; vol += Math.abs(ev.dH ? ev.dH[k] : 0) * px * px; }
    }
    const n = c.pix.length;
    c.areaKm2 = n * px * px / 1e6; c.meanDG = dg / n; c.meanDI = di / n; c.overlap = ov / n;
    c.isEvent = !!ev && c.overlap >= 0.3;
    c.volume = c.isEvent ? vol : 0;
    c.label = c.isEvent ? ev.name.replace(/ \(simulated\)/, '') : flc / n > 0.3 ? 'Flood-state change under canopy' : 'Unclassified change';
    c.segments = contourSegments(c, N);
    keep.push(c);
  }
  keep.sort((a, b) => (b.isEvent - a.isEvent) || (b.pix.length - a.pix.length));
  const final = keep.slice(0, 12);
  const compMask = new Uint8Array(NN);
  final.forEach((c, n) => { for (const k of c.pix) compMask[k] = n + 1; });
  let evA = 0, evV = 0, otherA = 0;
  for (const c of final) { if (c.isEvent) { evA += c.areaKm2; evV += c.volume; } else otherA += c.areaKm2; }
  if (ev && ev.kind === 'calving') evV = evA * 1e6 * (ev.iceThicknessM || 900);
  if (ev && ev.kind === 'fissure') evV = ev.volume;
  return { gPre, gCo, dG, dI, det, compMask, comps: final, band, tPre2, tPre1, tPost, event: ev || null, evA, evV, otherA, totalA: evA + otherA };
}

/** connected components (4- or 8-connectivity) of a binary mask */
function labelComponents(mask, N, conn = 8) {
  const NN = N * N, lab = new Int32Array(NN).fill(-1), out = [];
  const nb = conn === 8 ? [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let s = 0; s < NN; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = out.length, pix = [s], stack = [s];
    lab[s] = id;
    let si = 0, sj = 0, i0 = N, i1 = 0, j0 = N, j1 = 0;
    while (stack.length) {
      const k = stack.pop(), i = (k / N) | 0, j = k - i * N;
      si += i; sj += j; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
      for (const [di, dj] of nb) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const q = ni * N + nj;
        if (mask[q] && lab[q] < 0) { lab[q] = id; pix.push(q); stack.push(q); }
      }
    }
    out.push({ id, pix, ci: si / pix.length + 0.5, cj: sj / pix.length + 0.5, i0, i1, j0, j1, lab });
  }
  return out;
}

/** marching squares on one component → boundary segments in fractional grid coords [i, j, i, j] */
function contourSegments(c, N) {
  const lab = c.lab, id = c.id;
  const inside = (i, j) => (i >= 0 && j >= 0 && i < N && j < N && lab[i * N + j] === id ? 1 : 0);
  const segs = [];
  const E = {
    t: (i, j) => [i + 0.5, j + 1.0], r: (i, j) => [i + 1.0, j + 1.5], b: (i, j) => [i + 1.5, j + 1.0], l: (i, j) => [i + 1.0, j + 0.5],
  };
  const T = { 1: ['l', 'b'], 2: ['b', 'r'], 3: ['l', 'r'], 4: ['t', 'r'], 6: ['t', 'b'], 7: ['t', 'l'], 8: ['t', 'l'], 9: ['t', 'b'], 11: ['t', 'r'], 12: ['l', 'r'], 13: ['r', 'b'], 14: ['l', 'b'] };
  for (let i = c.i0 - 1; i <= c.i1; i++) for (let j = c.j0 - 1; j <= c.j1; j++) {
    const tl = inside(i, j), tr = inside(i, j + 1), br = inside(i + 1, j + 1), bl = inside(i + 1, j);
    const cs = tl * 8 + tr * 4 + br * 2 + bl;
    if (cs === 0 || cs === 15) continue;
    const add = (a, b) => { const p = E[a](i, j), q = E[b](i, j); segs.push(p[0], p[1], q[0], q[1]); };
    if (cs === 5) { add('t', 'r'); add('l', 'b'); }
    else if (cs === 10) { add('t', 'l'); add('r', 'b'); }
    else add(T[cs][0], T[cs][1]);
  }
  return segs;
}
