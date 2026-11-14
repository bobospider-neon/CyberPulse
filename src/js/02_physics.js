// ───────────────────────── 02 · RADAR PHYSICS (pure) ─────────────────────────
const C_LIGHT = 299792458;
const BANDS = {
  L: { id: 'L', name: 'L-band', f: 1.257e9, agency: 'NASA/JPL', color: '#ffb648' },
  S: { id: 'S', name: 'S-band', f: 3.20e9, agency: 'ISRO', color: '#3ee6ff' },
};
for (const b of Object.values(BANDS)) b.lambda = C_LIGHT / b.f;       // L: 0.23850 m · S: 0.09369 m

const NISAR = {
  altKm: 747, incl: 98.4, repeatDays: 12, orbitsPerCycle: 173, swathKm: 242,
  incNear: 33, incFar: 47, look: 'left', reflectorM: 12, boomM: 9,
  periodS: 12 * 86400 / 173,                                           // 5993 s ≈ 99.9 min
};
const R_EARTH = 6371.0;            // km
const OMEGA_E = 7.2921159e-5;      // rad/s

/**
 * Viewing geometry for a target at latitude `latDeg`.
 * Ground-track heading includes Earth rotation; NISAR is left-looking, so the
 * ground→satellite azimuth is heading + 90°.
 */
function viewGeometry(kind, latDeg, incDeg) {
  const i = NISAR.incl * DEG, phi = latDeg * DEG;
  const n = TAU / NISAR.periodS;
  const sinA = clamp(Math.cos(i) / Math.cos(phi), -1, 1);
  const cosA = Math.sqrt(1 - sinA * sinA) * (kind === 'desc' ? -1 : 1);
  const east = n * sinA - OMEGA_E * Math.cos(phi);
  const north = n * cosA;
  const heading = Math.atan2(east, north);                 // rad, clockwise from north
  const azSat = heading + Math.PI / 2;                     // ground → satellite (horizontal)
  const th = incDeg * DEG;
  const los = [Math.sin(th) * Math.sin(azSat), Math.sin(th) * Math.cos(azSat), Math.cos(th)];
  const along = [Math.sin(heading), Math.cos(heading), 0];
  let hdgDeg = heading / DEG; if (hdgDeg < 0) hdgDeg += 360;
  let lookDeg = (heading - Math.PI / 2) / DEG; lookDeg = ((lookDeg % 360) + 360) % 360;
  return { kind, inc: incDeg, heading, hdgDeg, lookDeg, los, along };
}
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// ── interferometric coherence model ──
// per class: [γ0, γ∞, τ (days)] — temporal decorrelation γ(Δt) = γ∞ + (γ0 − γ∞)·exp(−Δt/τ)
const COH = {
  L: { bare: [0.90, 0.55, 150], veg: [0.78, 0.22, 40], floodVeg: [0.86, 0.42, 70], water: [0.05, 0.05, 1], urban: [0.95, 0.86, 500], ice: [0.72, 0.12, 24] },
  S: { bare: [0.86, 0.38, 70], veg: [0.50, 0.07, 9], floodVeg: [0.40, 0.05, 6], water: [0.05, 0.05, 1], urban: [0.94, 0.80, 350], ice: [0.55, 0.05, 9] },
};
const COH_CLASSES = ['bare', 'veg', 'floodVeg', 'water', 'urban', 'ice'];
const cohClass = (p, dt) => p[1] + (p[0] - p[1]) * Math.exp(-Math.abs(dt) / p[2]);

/** class weights from cover fractions; fr = {veg, water, urban, ice, flooded} */
function classWeights(fr) {
  const veg = fr.veg, fl = fr.flooded;
  const w = {
    veg: veg * (1 - fl),
    floodVeg: veg * fl,
    water: Math.max(fr.water, fl * (1 - veg)),
    urban: fr.urban,
    ice: fr.ice,
  };
  w.bare = Math.max(0, 1 - (w.veg + w.floodVeg + w.water + w.urban + w.ice));
  const s = w.bare + w.veg + w.floodVeg + w.water + w.urban + w.ice;
  for (const k in w) w[k] /= s;
  return w;
}
function coherenceAt(fr, band, dt, iceSpeed = 0) {
  const w = classWeights(fr), P = COH[band];
  let g = 0;
  for (const c of COH_CLASSES) {
    let gc = cohClass(P[c], dt);
    if (c === 'ice') gc /= 1 + sq(iceSpeed * Math.abs(dt) / 35);
    g += w[c] * gc;
  }
  return g;
}
/** Cramér–Rao phase standard deviation (rad) for L looks; saturates at the uniform-distribution std. */
function phaseSigma(g, L = CFG.looks) {
  g = clamp(g, 0.02, 0.999);
  return Math.min(Math.sqrt(1 - g * g) / (g * Math.sqrt(2 * L)), Math.PI / Math.sqrt(3));
}

// ── backscatter / polarimetry ──
const dB = (x) => 10 * Math.log10(Math.max(x, 1e-12));
const lin = (d) => Math.pow(10, d / 10);
const BIOMASS = { L: { a: -27, b: 15, K: 110 }, S: { a: -24, b: 11, K: 40 } };
// t/ha: trees ~0.4·H² (simple allometry); reed beds (H < 6 m) ~10–30 t/ha
const agbFromHeight = (H) => (H < 6 ? 12 + 4 * H : clamp(0.4 * H * H, 0, 650));
function hvFromAgb(band, agb) { const m = BIOMASS[band]; return m.a + m.b * (1 - Math.exp(-agb / m.K)); }
function agbFromHv(band, hv) {
  const m = BIOMASS[band];
  const x = (hv - m.a) / m.b;
  const sat = -m.K * Math.log(0.1);                                    // 90 % of dynamic range
  if (x >= 0.9) return { agb: sat, saturated: true, sat };
  return { agb: Math.max(0, -m.K * Math.log(1 - Math.max(x, 0))), saturated: false, sat };
}
/** class covariance (linear power): [HH, HV, VV, ρ, φ(deg)] */
function classPol(band, cls, agb) {
  if (cls === 'veg') { const hv = hvFromAgb(band, agb); return band === 'L' ? [hv + 6.0, hv, hv + 5.0, 0.30, 15] : [hv + 5.0, hv, hv + 4.5, 0.35, 10]; }
  if (cls === 'floodVeg') { const hv = hvFromAgb(band, agb); return band === 'L' ? [-1.5, hv, -6.5, 0.60, 175] : [hv + 5.5, hv, hv + 4.5, 0.35, 30]; }
  const T = {
    L: { bare: [-11, -26, -9.5, 0.75, 0], water: [-24, -34, -19, 0.90, 0], urban: [-2, -14, -5.5, 0.55, 165], ice: [-12, -23, -11, 0.60, 5] },
    S: { bare: [-10, -24, -8.5, 0.70, 0], water: [-23, -32, -18, 0.90, 0], urban: [-1.5, -13, -4.5, 0.55, 160], ice: [-9, -18, -9, 0.50, 5] },
  };
  return T[band][cls];
}
/**
 * Mix class covariances (incoherent sum) and apply local-incidence brightness.
 * Returns {C11, C22, C33, C13r, C13i} in linear power.
 */
function mixCovariance(fr, band, agb, bright = 1, texture = 1, hvJitter = 1) {
  const w = classWeights(fr);
  let C11 = 0, C22 = 0, C33 = 0, C13r = 0, C13i = 0;
  for (const c of COH_CLASSES) {
    if (w[c] <= 0) continue;
    const p = classPol(band, c, agb);
    const hh = lin(p[0]), hv = lin(p[1]), vv = lin(p[2]);
    const mag = p[3] * Math.sqrt(hh * vv), ph = p[4] * DEG;
    C11 += w[c] * hh; C22 += w[c] * hv; C33 += w[c] * vv;
    C13r += w[c] * mag * Math.cos(ph); C13i += w[c] * mag * Math.sin(ph);
  }
  const k = bright * texture;
  return { C11: C11 * k, C22: C22 * k * hvJitter, C33: C33 * k, C13r: C13r * k, C13i: C13i * k };
}
/** Freeman–Durden three-component decomposition (Freeman & Durden, 1998). */
function freemanDurden(C) {
  const span = C.C11 + 2 * C.C22 + C.C33;
  let fv = 3 * C.C22;
  fv = Math.min(fv, Math.min(C.C11, C.C33) * 0.999);                  // volume cannot exceed co-pol power
  let a = C.C11 - fv, b = C.C33 - fv;
  const cr = C.C13r - fv / 3, ci = C.C13i;
  let Ps = 0, Pd = 0, branch;
  if (cr >= 0) {                                                       // surface dominant: α = −1
    branch = 'surface';
    const Xr = cr + b, Xi = ci, den = a + b + 2 * cr;
    let fs = den > 0 ? (Xr * Xr + Xi * Xi) / den : 0;
    fs = clamp(fs, 0, b);
    const fd = Math.max(0, b - fs);
    const br = fs > 0 ? Xr / fs - 1 : 0, bi = fs > 0 ? Xi / fs : 0;
    Ps = fs * (1 + br * br + bi * bi); Pd = 2 * fd;
  } else {                                                             // double-bounce dominant: β = 1
    branch = 'double';
    const Yr = cr - b, Yi = ci, den = a + b - 2 * cr;
    let fd = den > 0 ? (Yr * Yr + Yi * Yi) / den : 0;
    fd = clamp(fd, 0, b);
    const fs = Math.max(0, b - fd);
    const ar = fd > 0 ? Yr / fd + 1 : 0, ai = fd > 0 ? Yi / fd : 0;
    Pd = fd * (1 + ar * ar + ai * ai); Ps = 2 * fs;
  }
  const Pv = (8 / 3) * fv;
  const tot = Math.max(Ps + Pd + Pv, 1e-12);
  return { Ps, Pd, Pv, span, branch, fs: Ps / tot, fd: Pd / tot, fvol: Pv / tot };
}

// ── deformation sources ──
const NU = 0.25;
/** Mogi point source: displacement (m) at horizontal offset (dx east, dy north) for volume change dV (m³) at depth d (m). */
function mogi(dx, dy, d, dV) {
  const R2 = dx * dx + dy * dy + d * d, R3 = R2 * Math.sqrt(R2);
  const c = (1 - NU) * dV / Math.PI / R3;
  return [c * dx, c * dy, c * d];
}
const momentMagnitude = (M0) => (2 / 3) * (Math.log10(M0) - 9.1);

// ── 3D decomposition by weighted least squares ──
function solve3x3(M, v) {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  if (Math.abs(det) < 1e-30) return null;
  const inv = [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  return { x: [inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2], inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2], inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2]], inv };
}
/** rows: [{a:[e,n,u], d, s}] → x̂, σ */
function wls3(rows) {
  const N = new Array(9).fill(0), r = [0, 0, 0];
  for (const o of rows) {
    const w = 1 / (o.s * o.s);
    for (let p = 0; p < 3; p++) { r[p] += w * o.a[p] * o.d; for (let q = 0; q < 3; q++) N[p * 3 + q] += w * o.a[p] * o.a[q]; }
  }
  const sol = solve3x3(N, r);
  if (!sol) return null;
  return { x: sol.x, sig: [Math.sqrt(Math.max(sol.inv[0], 0)), Math.sqrt(Math.max(sol.inv[4], 0)), Math.sqrt(Math.max(sol.inv[8], 0))] };
}
