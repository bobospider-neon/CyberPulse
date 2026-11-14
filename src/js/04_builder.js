// ───────────────────────── 04 · SCENE BUILDER & CPU MIRROR OF THE SHADERS (pure) ─────────────────────────
class SiteGrid {
  constructor(meta) {
    this.meta = meta;
    this.N = meta.n;
    this.pixelM = meta.extent_km * 1000 / meta.n;
    this.mpu = meta.extent_km * 1000 / CFG.W;            // metres per world unit (horizontal)
  }
  /** fractional grid coords (cell k spans [k, k+1)) */
  ll2ij(lat, lon) {
    const m = this.meta;
    return { i: (m.lat_max - lat) / (m.lat_max - m.lat_min) * this.N, j: (lon - m.lon_min) / (m.lon_max - m.lon_min) * this.N };
  }
  ij2ll(i, j) {
    const m = this.meta;
    return { lat: m.lat_max - i / this.N * (m.lat_max - m.lat_min), lon: m.lon_min + j / this.N * (m.lon_max - m.lon_min) };
  }
  ij2xz(i, j) { return { x: j / this.N * CFG.W - CFG.W / 2, z: i / this.N * CFG.W - CFG.W / 2 }; }
  xz2ij(x, z) { return { i: (z + CFG.W / 2) / CFG.W * this.N, j: (x + CFG.W / 2) / CFG.W * this.N }; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.N && j < this.N; }
  idx(i, j) { return clamp(i | 0, 0, this.N - 1) * this.N + clamp(j | 0, 0, this.N - 1); }
  /** east/north metres from (i0, j0) to (i, j) */
  en(i, j, i0, j0) { return [(j - j0) * this.pixelM, (i0 - i) * this.pixelM]; }
}

const BASIS_MAX = 4;
function newBasis(N) { return new Float32Array(N * N * 4); }

/** central-difference slope (deg) and ENU unit normals */
function terrainDerivatives(dem, N, px) {
  const slope = new Float32Array(N * N), nx = new Float32Array(N * N), ny = new Float32Array(N * N), nz = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const k = i * N + j;
      const zl = dem[i * N + Math.max(j - 1, 0)], zr = dem[i * N + Math.min(j + 1, N - 1)];
      const zu = dem[Math.max(i - 1, 0) * N + j], zd = dem[Math.min(i + 1, N - 1) * N + j];
      const dzdx = (zr - zl) / (2 * px), dzdy = (zu - zd) / (2 * px);  // east, north
      const L = Math.hypot(dzdx, dzdy, 1);
      nx[k] = -dzdx / L; ny[k] = -dzdy / L; nz[k] = 1 / L;
      slope[k] = Math.atan(Math.hypot(dzdx, dzdy)) / DEG;
    }
  }
  return { slope, nx, ny, nz };
}
function minFilter(src, N, r) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    let m = Infinity; for (let d = -r; d <= r; d++) { const v = src[i * N + clamp(j + d, 0, N - 1)]; if (v < m) m = v; } tmp[i * N + j] = m;
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    let m = Infinity; for (let d = -r; d <= r; d++) { const v = tmp[clamp(i + d, 0, N - 1) * N + j]; if (v < m) m = v; } out[i * N + j] = m;
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════
function buildScene(siteId, meta, demRaw) {
  const site = SITES[siteId];
  const g = new SiteGrid(meta);
  const N = g.N, NN = N * N, px = g.pixelM;
  const rand = mulberry32(site.seed * 1013 + 7);
  const gauss = gaussian(mulberry32(site.seed * 2029 + 3));

  let dem = Float32Array.from(demRaw);
  const sc = {
    site, id: siteId, kind: site.kind, grid: g, N, meta,
    cover: { veg: new Float32Array(NN), water: new Float32Array(NN), urban: new Float32Array(NN), ice: new Float32Array(NN) },
    canopyH: new Float32Array(NN), agb: new Float32Array(NN),
    spill: new Float32Array(NN).fill(1e6), aux: new Float32Array(NN),
    bases: [], waterBasis: -1, events: [], labels: [], hasWater: false, seaLevel: null,
    flags: { mesh: [0, 0, 0, 0], phase: [0, 0, 0, 0], exag: [0, 0, 0, 0] },
    rupture: null, glacier: null, buildings: null, corridor: null,
  };

  // Danube: Copernicus is a surface model (reeds & trees included) → estimate bare ground + canopy height
  if (site.id === 'danube') {
    const env = blurField(minFilter(dem, N, 3), N, 2, 2);
    for (let k = 0; k < NN; k++) {
      const ground = Math.min(dem[k], env[k] + 0.4);
      sc.canopyH[k] = clamp(dem[k] - ground, 0, 32);
      dem[k] = ground;
    }
    dem = blurField(dem, N, 1, 1);
  } else if (site.smooth) dem = blurField(dem, N, site.smooth, 1);
  sc.dem = dem;

  let emin = Infinity, emax = -Infinity, esum = 0;
  for (let k = 0; k < NN; k++) { const e = dem[k]; if (e < emin) emin = e; if (e > emax) emax = e; esum += e; }
  sc.emin = emin; sc.emax = emax; sc.emean = esum / NN;
  sc.eBase = site.kind === 'glacier' || site.kind === 'wetland' ? Math.min(emin, 0) - 0.5 : emin - (emax - emin) * 0.04;
  sc.yScale = site.ve / g.mpu;                    // world units per metre (vertical)

  const der = terrainDerivatives(dem, N, px);
  sc.slope = der.slope; sc.nrm = der;
  const patch = fbmField(N, site.seed * 31 + 5, 5, 6, 0.55);
  const patch2 = fbmField(N, site.seed * 37 + 9, 4, 14, 0.5);
  sc.geom = { asc: viewGeometry('asc', meta.lat, site.inc.asc), desc: viewGeometry('desc', meta.lat, site.inc.desc) };

  const B = (label, mesh, phase, exag) => {
    const b = newBasis(N); const idx = sc.bases.length;
    sc.bases.push({ data: b, label }); sc.flags.mesh[idx] = mesh; sc.flags.phase[idx] = phase; sc.flags.exag[idx] = exag;
    return b;
  };
  const ij = (p) => g.ll2ij(p.lat, p.lon);

  // ─────────────── per-kind physics ───────────────
  if (site.kind === 'volcano') {
    for (let k = 0; k < NN; k++) {
      const e = dem[k], s = der.slope[k];
      const ice = smoothstep(1850, 2150, e) * (1 - smoothstep(50, 62, s));
      const rock = smoothstep(33, 45, s) * smoothstep(1300, 1700, e);
      const pot = (1 - smoothstep(1450, 1900, e)) * (1 - smoothstep(32, 44, s));
      const veg = clamp(pot * (0.8 + 0.22 * patch[k]) * (1 - ice) * (1 - 0.8 * rock), 0, 0.97);
      sc.cover.ice[k] = ice; sc.cover.veg[k] = veg;
      sc.canopyH[k] = veg > 0.05 ? clamp(lerp(55, 22, clamp((e - 450) / 1400, 0, 1)) * (0.85 + 0.12 * patch2[k]), 8, 62) : 0;
    }
    const src = ij(site.mogi);
    const b0 = B('Mogi source · per 10⁶ m³', 1, 1, 1);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const [dx, dy] = g.en(i + 0.5, j + 0.5, src.i, src.j);
      const u = mogi(dx, dy, site.mogi.depth, 1e6);
      const o = (i * N + j) * 4; b0[o] = u[0]; b0[o + 1] = u[1]; b0[o + 2] = u[2];
    }
    sc.mogiSrc = { i: src.i, j: src.j, depth: site.mogi.depth };
    sc.weights = (t) => [0.12 * t + 4.43e-4 * t * t, 0, 0, 0];      // ΔV in 10⁶ m³
    // debris flow: steepest descent from the South Tahoma Glacier snout
    const sm = blurField(dem, N, 1, 1);
    let p = ij(site.event.start); let ci = p.i | 0, cj = p.j | 0;
    const path = [[ci, cj]];
    for (let step = 0; step < 90; step++) {
      let best = sm[ci * N + cj], bi = -1, bj = -1;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue; const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const v = sm[ni * N + nj]; if (v < best - 0.01) { best = v; bi = ni; bj = nj; }
      }
      if (bi < 0) break; ci = bi; cj = bj; path.push([ci, cj]);
    }
    const mask = new Float32Array(NN), dH = new Float32Array(NN);
    path.forEach(([pi, pj], n) => {
      const f = n / Math.max(1, path.length - 1);
      const r = 1.6 + 1.4 * f;
      for (let di = -4; di <= 4; di++) for (let dj = -4; dj <= 4; dj++) {
        const ni = pi + di, nj = pj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const w = Math.exp(-(di * di + dj * dj) / (r * r));
        const k = ni * N + nj;
        if (w > mask[k]) { mask[k] = w; dH[k] = (f < 0.45 ? -4.5 : 3.2) * w; }
      }
    });
    sc.events.push(makeEvent(sc, site.event, mask, dH));
  }

  else if (site.kind === 'fault') {
    for (let k = 0; k < NN; k++) { sc.cover.veg[k] = 0; sc.canopyH[k] = 0; }
    const F = site.fault, fp = ij(F);
    const se = Math.sin(F.strike * DEG), sn = Math.cos(F.strike * DEG);   // strike unit (E, N): points NW
    const ne = Math.cos(F.strike * DEG), nn = -Math.sin(F.strike * DEG);  // normal: strike − 90° → NE side positive
    const b0 = B('Interseismic · per year', 1, 1, 1);
    const b1 = B('Coseismic · per metre of slip', 1, 1, 1);
    const xDist = new Float32Array(NN), sAlong = new Float32Array(NN);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const [dx, dy] = g.en(i + 0.5, j + 0.5, fp.i, fp.j);
      let x = dx * ne + dy * nn; const s = dx * se + dy * sn;
      const k = i * N + j; xDist[k] = x; sAlong[k] = s;
      if (Math.abs(x) < 1) x = x < 0 ? -1 : 1;
      const ui = -(F.V / Math.PI) * Math.atan(x / F.D);                   // m/yr, along strike
      const uc = -(1 / Math.PI) * Math.atan(F.D / x);                     // m per m of slip
      const o = k * 4;
      b0[o] = ui * se; b0[o + 1] = ui * sn;
      b1[o] = uc * se; b1[o + 1] = uc * sn; b1[o + 2] = 0.04 * Math.sign(x) * Math.exp(-Math.abs(x) / 2500);
    }
    sc.fault = { i: fp.i, j: fp.j, se, sn, ne, nn, xDist, sAlong };
    // rupture: hypocentre 30 km NW (towards Parkfield), propagating SE at 3 km/s
    sc.rupture = { tq: Infinity, slip: F.slip, front: 1e9, hypoS: 30000, width: 2500, active: false };
    sc.weights = (t) => [t / 365.25, (t >= sc.rupture.tq ? F.slip * smoothstep(0, 0.6, t - sc.rupture.tq) : 0), 0, 0];
    const mask = new Float32Array(NN), dH = new Float32Array(NN);
    for (let k = 0; k < NN; k++) { const a = Math.abs(xDist[k]); mask[k] = Math.exp(-sq(a / 420)) * (0.75 + 0.25 * clamp(0.5 + 0.5 * patch2[k], 0, 1)); dH[k] = mask[k] * 0.25; }
    sc.events.push(makeEvent(sc, site.event, mask, dH));
    const sd = F.V * (2026.85 - F.since);
    sc.faultStats = { slipDeficit: sd };
  }

  else if (site.kind === 'glacier') {
    // fjord & sea: priority-flood from the western boundary
    const seeds = new Uint8Array(NN);
    for (let i = 0; i < N; i++) for (let j = 0; j < 3; j++) if (dem[i * N + j] <= 2) seeds[i * N + j] = 1;
    sc.spill = priorityFlood(dem, N, seeds);
    sc.seaLevel = 0; sc.hasWater = true;
    for (let k = 0; k < NN; k++) sc.cover.water[k] = sc.spill[k] <= 1.2 && dem[k] <= 1.2 ? 1 : 0;
    // terminus = easternmost fjord cell; centre-line follows the sub-glacial trough eastward
    let jf = 0; const rows = [];
    for (let k = 0; k < NN; k++) if (sc.cover.water[k]) { const j = k % N; if (j > jf) jf = j; }
    for (let i = 0; i < N; i++) for (let j = jf - 2; j <= jf; j++) if (sc.cover.water[i * N + j]) rows.push(i);
    const rf = rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length + 0.5 : N / 2;
    const sm = blurField(dem, N, 4, 2);
    const cl = new Float32Array(N).fill(rf);
    let r = rf;
    for (let j = jf; j < N; j++) {
      let best = Infinity, br = r;
      for (let di = -3; di <= 3; di++) { const ii = clamp(Math.round(r) + di, 2, N - 3); const v = sm[ii * N + j] + Math.abs(di) * 0.8; if (v < best) { best = v; br = ii + 0.5; } }
      r = lerp(r, br, 0.5); cl[j] = r;
    }
    const cls = Float32Array.from(cl);
    for (let j = jf; j < N; j++) { let a = 0, c = 0; for (let d = -15; d <= 15; d++) { const jj = clamp(j + d, jf, N - 1); a += cl[jj]; c++; } cls[j] = a / c; }
    const sArc = new Float32Array(N);
    for (let j = jf + 1; j < N; j++) sArc[j] = sArc[j - 1] + px * Math.hypot(1, cls[j] - cls[j - 1]);
    // ice: smooth surface connected to the eastern boundary, plus the glacier trough corridor
    const smooth3 = blurField(dem, N, 3, 2), rough = new Float32Array(NN);
    for (let k = 0; k < NN; k++) rough[k] = Math.abs(dem[k] - smooth3[k]);
    const roughB = blurField(rough, N, 2, 2);
    const ice = new Uint8Array(NN), stack = [];
    const iceOK = (q) => !sc.cover.water[q] && roughB[q] < 16 && dem[q] > 12;
    for (let i = 0; i < N; i++) { const k = i * N + N - 1; if (iceOK(k)) { ice[k] = 1; stack.push(k); } }
    while (stack.length) {
      const k = stack.pop(), i = (k / N) | 0, j = k % N;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const q = ni * N + nj; if (ice[q]) continue;
        if (iceOK(q)) { ice[q] = 1; stack.push(q); }
      }
    }
    for (let i = 0; i < N; i++) for (let j = jf; j < N; j++) {
      const k = i * N + j;
      if (!sc.cover.water[k] && dem[k] > 3 && Math.abs(i + 0.5 - cls[j]) * px < 4800) ice[k] = 1;
    }
    const iceF = blurField(Float32Array.from(ice), N, 1, 1);
    for (let k = 0; k < NN; k++) sc.cover.ice[k] = sc.cover.water[k] ? 0 : (ice[k] ? clamp(0.55 + iceF[k] * 0.5, 0, 1) : clamp(iceF[k] * 0.6, 0, 0.45));
    const vFront = 28, Ldec = 21000, Wd = 3300, vUp = 1.0;
    const vx = new Float32Array(NN), vy = new Float32Array(NN), speed = new Float32Array(NN);
    const b0 = B('Dynamic thinning · per year', 1, 1, 1);
    const b1 = B('Ice flow · per day (phase only)', 0, 1, 0);
    const b2 = B('Calving · elevation change', 1, 0, 0);
    const sgx = new Float32Array(NN), sgy = new Float32Array(NN);
    for (let i = 1; i < N - 1; i++) for (let j = 1; j < N - 1; j++) { const k = i * N + j; sgx[k] = (sm[k + 1] - sm[k - 1]) / (2 * px); sgy[k] = (sm[k - N] - sm[k + N]) / (2 * px); }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const k = i * N + j;
      if (!ice[k]) continue;                     // hard mask: no flow (and no aliased phase) off the ice
      let ve = 0, vn = 0;
      if (j >= jf) {
        const d = Math.abs(i + 0.5 - cls[j]) * px, s = sArc[j];
        const lat = Math.exp(-sq(d / Wd));
        const vt = (vFront * Math.exp(-s / Ldec) + vUp) * lat;
        const slope = cls[Math.min(j + 1, N - 1)] - cls[j];
        const tl = Math.hypot(1, slope);
        ve += vt * (-1 / tl); vn += vt * (slope / tl);
        b0[k * 4 + 2] = -(14 * Math.exp(-s / 15000) * lat + 0.6);
      } else b0[k * 4 + 2] = -0.6;
      const gm = Math.hypot(sgx[k], sgy[k]) || 1;
      ve += -0.3 * sgx[k] / gm; vn += -0.3 * sgy[k] / gm;
      vx[k] = ve; vy[k] = vn; speed[k] = Math.hypot(ve, vn);
      b1[k * 4] = ve; b1[k * 4 + 1] = vn;
    }
    sc.aux = speed;
    sc.glacier = { jf, rf, cl: cls, sArc, vx, vy, speed, vFront, iceHard: ice };
    const tCalve = site.event.t;
    const seasonal = (t) => { const P = 365.25, t0 = 148.7; return t - 0.25 * (P / TAU) * (Math.cos(TAU * (t - t0) / P) - Math.cos(TAU * (-t0) / P)); };
    sc.weights = (t) => [t / 365.25, seasonal(t), smoothstep(tCalve - 0.5, tCalve + 0.5, t), 0];
    const mask = new Float32Array(NN), dH = new Float32Array(NN);
    for (let i = 0; i < N; i++) for (let j = jf; j < Math.min(N, jf + 9); j++) {
      const k = i * N + j; const d = Math.abs(i + 0.5 - cls[j]) * px;
      if (d < 2800 && sc.cover.ice[k] > 0.3) {
        const m = (1 - smoothstep(2000, 2800, d)) * (1 - smoothstep(6.5, 9, j - jf));
        if (m > 0.02) { mask[k] = m; dH[k] = -(dem[k] + 3) * m; b2[k * 4 + 2] = dH[k]; sc.spill[k] = -1; }
      }
    }
    const ev = makeEvent(sc, site.event, mask, dH);
    ev.iceThicknessM = 900;
    sc.events.push(ev);
    site.poi = site.poi || g.ij2ll(cls[Math.min(N - 1, jf + 40)], jf + 40);
    sc.labels.push({ name: 'Calving front', i: rf, j: jf + 0.5, kind: 'front' });
  }

  else if (site.kind === 'wetland') {
    const W = site.water;
    const axisU = (i, j) => (W.axis === 'ns' ? (i + 0.5) / N : (j + 0.5) / N);
    const base = new Float32Array(NN), amp = new Float32Array(NN);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const u = axisU(i, j), k = i * N + j;
      base[k] = lerp(W.up[0], W.down[0], u); amp[k] = lerp(W.up[1], W.down[1], u);
    }
    const seeds = new Uint8Array(NN);
    for (let k = 0; k < NN; k++) if (dem[k] <= base[k] - 0.15) seeds[k] = 1;
    sc.spill = priorityFlood(dem, N, seeds);
    sc.aux = base; sc.hasWater = true;
    const b0 = B('Delta subsidence · per year', 1, 1, 1);
    const b1 = B('Water-level pulse (double bounce, phase only)', 0, 1, 0);
    sc.waterBasis = 1;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const k = i * N + j, u = axisU(i, j);
      const permanent = sc.spill[k] <= base[k] && dem[k] <= base[k];
      const plain = sc.spill[k] <= base[k] + amp[k] + 0.6;
      sc.cover.water[k] = permanent ? 1 : 0;
      if (site.id === 'atchafalaya') {
        if (plain && !permanent) { sc.cover.veg[k] = clamp(0.9 + 0.1 * patch[k], 0.55, 0.98); sc.canopyH[k] = clamp(24 + 4 * patch2[k], 15, 32); }
        else if (!permanent) { sc.cover.veg[k] = clamp(0.12 + 0.25 * patch[k], 0, 0.5); sc.canopyH[k] = 14; }
      } else {
        if (!permanent) {
          if (sc.canopyH[k] > 6) { sc.cover.veg[k] = 0.92; }
          else if (plain) { sc.cover.veg[k] = clamp(0.84 + 0.12 * patch[k], 0.5, 0.97); sc.canopyH[k] = 2.6 + 0.6 * patch2[k]; }
          else { sc.cover.veg[k] = 0.12; sc.canopyH[k] = 0.6; }
        } else sc.canopyH[k] = 0;
      }
      b0[k * 4 + 2] = site.id === 'atchafalaya' ? -(0.004 + 0.007 * u) : -(0.0015 + 0.0035 * u);
      b1[k * 4 + 3] = amp[k];
    }
    const peak = W.peak;
    const pulse = (t) => 0.5 - 0.5 * Math.cos(TAU * (t - (peak - 182.625)) / 365.25);
    sc.pulse = pulse;
    sc.weights = (t) => [t / 365.25, pulse(t), 0, 0];
    // event
    const mask = new Float32Array(NN), dH = new Float32Array(NN);
    const blobs = site.id === 'atchafalaya'
      ? [[0.70, 0.40, 0.05, 0.022, -0.6], [0.78, 0.55, 0.045, 0.02, -0.6], [0.62, 0.50, 0.04, 0.018, -0.6]]
      : [[0.30, 0.30, 0.035, 0.022, 0.4], [0.36, 0.38, 0.03, 0.02, 0.4]];
    for (const [bi, bj, ra, rb, ang] of blobs) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const y = (i + 0.5) / N - bi, x = (j + 0.5) / N - bj;
        const u = (x * ca + y * sa) / ra, v = (-x * sa + y * ca) / rb;
        const k = i * N + j;
        const m = clamp(1.25 - Math.hypot(u, v) + 0.35 * patch2[k], 0, 1) * (sc.cover.veg[k] > 0.4 ? 1 : 0);
        if (m > mask[k]) { mask[k] = m; dH[k] = -sc.canopyH[k] * m; }
      }
    }
    sc.events.push(makeEvent(sc, site.event, mask, dH));
  }

  else if (site.kind === 'urban') {
    const clay = new Float32Array(NN);
    for (let k = 0; k < NN; k++) clay[k] = smoothstep(2266, 2240, dem[k]) * (1 - smoothstep(1.5, 4, der.slope[k]));
    const clayB = blurField(clay, N, 3, 2);
    const U = new Float32Array(NN);
    const bowls = site.bowls.map((b) => ({ ...ij(b), rate: b.rate, sigma: b.sigma }));
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      let u = 0;
      for (const b of bowls) { const [dx, dy] = g.en(i + 0.5, j + 0.5, b.i, b.j); u -= b.rate * Math.exp(-(dx * dx + dy * dy) / (2 * b.sigma * b.sigma)); }
      U[i * N + j] = u * clayB[i * N + j];
    }
    const b0 = B('Aquifer compaction · per year', 1, 1, 1);
    const b1 = B('Seasonal recharge', 1, 1, 1);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const k = i * N + j;
      const dUx = (U[i * N + Math.min(j + 1, N - 1)] - U[i * N + Math.max(j - 1, 0)]) / (2 * px);
      const dUy = (U[Math.max(i - 1, 0) * N + j] - U[Math.min(i + 1, N - 1) * N + j]) / (2 * px);
      b0[k * 4] = -0.25 * 4000 * dUx; b0[k * 4 + 1] = -0.25 * 4000 * dUy; b0[k * 4 + 2] = U[k];
      b1[k * 4 + 2] = 0.012 * clayB[k];
    }
    sc.weights = (t) => [t / 365.25, Math.cos(TAU * (t - 290) / 365.25) - Math.cos(TAU * (-290) / 365.25), 0, 0];
    // land cover
    const centre = ij({ lat: 19.425, lon: -99.150 });
    const santaFe = ij({ lat: 19.362, lon: -99.262 });
    const lake = ij({ lat: 19.468, lon: -98.980 });
    const chap = ij({ lat: 19.420, lon: -99.190 });
    const xoch = ij({ lat: 19.262, lon: -99.085 });
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const k = i * N + j, e = dem[k], s = der.slope[k];
      const dC = Math.hypot(...g.en(i, j, centre.i, centre.j));
      const dSF = Math.hypot(...g.en(i, j, santaFe.i, santaFe.j));
      const [lx, ly] = g.en(i, j, lake.i, lake.j);
      const lakeM = Math.hypot(lx / 1700, ly / 1050) < 1 ? 1 : 0;
      const parkM = Math.hypot(...g.en(i, j, chap.i, chap.j)) < 1300 ? 1 : 0;
      const xo = Math.hypot(...g.en(i, j, xoch.i, xoch.j));
      let urb = (1 - smoothstep(2420, 2560, e)) * (1 - smoothstep(7, 13, s));
      urb = Math.max(urb, (1 - smoothstep(1800, 3200, dSF)) * (1 - smoothstep(10, 18, s)));
      urb *= (1 - lakeM) * (1 - parkM) * (1 - 0.55 * (1 - smoothstep(1500, 3200, xo)));
      urb *= clamp(0.72 + 0.28 * Math.exp(-dC / 15000) + 0.1 * patch[k], 0, 1);
      sc.cover.urban[k] = clamp(urb, 0, 0.98);
      sc.cover.water[k] = lakeM;
      let veg = 0, H = 0;
      if (e > 2700) { veg = clamp(0.75 + 0.2 * patch[k], 0, 0.95); H = 22 + 5 * patch2[k]; }
      else if (e > 2480 && s > 6) { veg = 0.35; H = 9; }
      if (parkM) { veg = 0.9; H = 18; }
      sc.cover.veg[k] = veg * (1 - sc.cover.urban[k]); sc.canopyH[k] = veg > 0 ? H : 0;
    }
    // city blocks
    const bl = [], sp = 520 / px, rb = mulberry32(site.seed * 17 + 1);
    for (let gi = sp * 0.5; gi < N; gi += sp) for (let gj = sp * 0.5; gj < N; gj += sp) {
      const i = gi + (rb() - 0.5) * sp * 0.35, j = gj + (rb() - 0.5) * sp * 0.35;
      if (i < 1 || j < 1 || i > N - 2 || j > N - 2) continue;
      const k = (i | 0) * N + (j | 0); const u = sc.cover.urban[k];
      if (u < 0.35 || rb() > u * 1.05) continue;
      const dC = Math.hypot(...g.en(i, j, centre.i, centre.j)), dSF = Math.hypot(...g.en(i, j, santaFe.i, santaFe.j));
      let hgt = 9 + 22 * rb() * rb() + 46 * Math.exp(-dC / 4200) * rb();
      if (rb() < 0.035 + 0.25 * Math.exp(-dC / 2500) + 0.35 * Math.exp(-dSF / 1500)) hgt = 70 + 160 * rb();
      bl.push({ i, j, w: sp * px * (0.62 + 0.22 * rb()), d: sp * px * (0.62 + 0.22 * rb()), h: hgt, rot: (rb() - 0.5) * 0.5, seed: rb() });
    }
    sc.buildings = bl;
    sc.corridor = site.corridor.map(ij);
    // fissure event
    const A = ij(site.event.a), Bp = ij(site.event.b);
    const mask = new Float32Array(NN), dH = new Float32Array(NN);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const k = i * N + j;
      const ax = Bp.j - A.j, ay = Bp.i - A.i, L2 = ax * ax + ay * ay;
      const t = clamp(((j + 0.5 - A.j) * ax + (i + 0.5 - A.i) * ay) / L2, 0, 1);
      const d = Math.hypot(j + 0.5 - (A.j + t * ax), i + 0.5 - (A.i + t * ay)) * px;
      const m = Math.exp(-sq(d / (260 + 120 * patch2[k]))) * (sc.cover.urban[k] > 0.3 ? 1 : 0);
      mask[k] = m; dH[k] = -0.6 * m;
    }
    const ev = makeEvent(sc, site.event, mask, dH);
    let vol = 0, nb = 0;
    for (const b of bl) { const m = mask[g.idx(b.i, b.j)]; if (m > 0.35) { b.event = 0; vol += b.w * b.d * b.h * 0.45; nb++; } }
    ev.volume = vol; ev.buildings = nb;
    sc.events.push(ev);
  }

  // biomass from canopy height
  for (let k = 0; k < NN; k++) sc.agb[k] = sc.cover.veg[k] > 0.05 ? agbFromHeight(sc.canopyH[k]) : 0;

  // ─────────────── atmosphere & decorrelation noise ───────────────
  const screens = [0, 1, 2, 3].map((c) => fbmField(N, site.seed * 97 + c * 13 + 1, 6, 2, 0.62));
  const apsW = [], strat = [];
  for (let e = 0; e < CFG.nEpochs; e++) { apsW.push([gauss() * 0.5, gauss() * 0.5, gauss() * 0.5, gauss() * 0.5]); strat.push(gauss()); }
  sc.aps = { screens, apsW, strat, turb: site.aps.turb, stratK: site.aps.strat };
  const ng = gaussian(mulberry32(site.seed * 4441 + 11));
  sc.noise = new Float32Array(NN * 4);
  // Gaussian noise, quantised exactly as the RGBA8 texture stores it (g = (byte/255 − 0.5)·8)
  sc.noiseBytes = new Uint8Array(NN * 4);
  for (let k = 0; k < NN * 4; k++) {
    const b = clamp(Math.round((clamp(ng(), -3.95, 3.95) / 8 + 0.5) * 255), 0, 255);
    sc.noiseBytes[k] = b; sc.noise[k] = (b / 255 - 0.5) * 8;
  }

  // ─────────────── labels, POI, reference ───────────────
  for (const L of site.labels) { const p = ij(L); if (g.inside(p.i, p.j)) sc.labels.push({ name: L.name, i: p.i, j: p.j, kind: L.kind || 'feat' }); }
  const poi = ij(site.poi || { lat: meta.lat, lon: meta.lon });
  sc.poi = { i: clamp(poi.i, 1, N - 2), j: clamp(poi.j, 1, N - 2) };
  const rf = ij(site.ref);
  sc.ref = refinedReference(sc, clamp(rf.i, 3, N - 4), clamp(rf.j, 3, N - 4));

  // ─────────────── canopy point cloud ───────────────
  sc.canopyPts = sampleCanopy(sc, rand);
  return sc;
}

function makeEvent(sc, def, mask, dH) {
  const N = sc.N, px = sc.grid.pixelM;
  let area = 0, vol = 0, si = 0, sj = 0, sw = 0;
  for (let k = 0; k < N * N; k++) {
    const m = mask[k]; if (m < 0.35) continue;
    area += px * px; vol += Math.abs(dH ? dH[k] : 0) * px * px;
    const i = (k / N) | 0, j = k % N; si += i * m; sj += j * m; sw += m;
  }
  return { kind: def.kind, t: def.t, name: def.name, mask, dH, areaKm2: area / 1e6, volume: vol, ci: sw ? si / sw : N / 2, cj: sw ? sj / sw : N / 2 };
}
function refinedReference(sc, i0, j0) {
  const N = sc.N; let best = -1, bi = i0, bj = j0;
  for (let di = -12; di <= 12; di++) for (let dj = -12; dj <= 12; dj++) {
    const i = clamp(Math.round(i0 + di), 1, N - 2), j = clamp(Math.round(j0 + dj), 1, N - 2), k = i * N + j;
    const fr = { veg: sc.cover.veg[k], water: sc.cover.water[k], urban: sc.cover.urban[k], ice: sc.cover.ice[k], flooded: 0 };
    const gm = coherenceAt(fr, 'L', CFG.tMax, sc.aux && sc.kind === 'glacier' ? sc.aux[k] : 0) - 0.002 * Math.hypot(di, dj);
    if (gm > best) { best = gm; bi = i; bj = j; }
  }
  return { i: bi + 0.5, j: bj + 0.5 };
}
function sampleCanopy(sc, rand) {
  const N = sc.N, target = sc.kind === 'wetland' ? 150000 : sc.kind === 'volcano' ? 110000 : sc.kind === 'urban' ? 45000 : 0;
  if (!target) return new Float32Array(0);
  const out = new Float32Array(target * 4);
  let n = 0, tries = 0;
  while (n < target && tries < target * 12) {
    tries++;
    const u = rand(), v = rand();
    const k = Math.min(N - 1, (v * N) | 0) * N + Math.min(N - 1, (u * N) | 0);
    const veg = sc.cover.veg[k];
    if (veg < 0.2 || rand() > Math.pow(veg, 1.3)) continue;
    out[n * 4] = u; out[n * 4 + 1] = v; out[n * 4 + 2] = Math.sqrt(rand()); out[n * 4 + 3] = rand();
    n++;
  }
  return out.subarray(0, n * 4);
}

