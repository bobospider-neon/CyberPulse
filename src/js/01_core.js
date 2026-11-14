// ───────────────────────── 01 · CORE UTILITIES (pure, no THREE) ─────────────────────────
const CFG = {
  team: 'Team CyberPulse',            // ← put your team name here
  N: 384,                             // simulation / mesh grid (N × N)
  W: 100,                             // terrain width in world units
  nEpochs: 29,                        // E00 … E28
  repeatDays: 12,                     // NISAR exact-repeat cycle
  t0: Date.UTC(2025, 10, 28),         // 28 Nov 2025: start of the NISAR science phase
  looks: 20,                          // effective number of looks of the simulated interferograms
};
CFG.tMax = (CFG.nEpochs - 1) * CFG.repeatDays;   // 336 days

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const wrapPi = (x) => x - TAU * Math.floor((x + Math.PI) / TAU);   // → [-π, π)
const sq = (x) => x * x;

// ── deterministic randomness ──
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand) {
  let spare = null;
  return function () {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * m;
    return u * m;
  };
}
function hash3(a, b, c) {           // integer hash → [0,1)
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── scalar fields on the N×N grid ──
function normalizeField(f) {
  let m = 0; for (let k = 0; k < f.length; k++) m += f[k];
  m /= f.length;
  let v = 0; for (let k = 0; k < f.length; k++) { f[k] -= m; v += f[k] * f[k]; }
  const s = Math.sqrt(v / f.length) || 1;
  for (let k = 0; k < f.length; k++) f[k] /= s;
  return f;
}
/** Fractal value noise, zero mean / unit std. baseCells = features across the grid at octave 0. */
function fbmField(N, seed, octaves = 6, baseCells = 3, persistence = 0.55) {
  const out = new Float32Array(N * N);
  const rand = mulberry32(seed);
  let amp = 1, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const G = cells + 2;
    const grid = new Float32Array(G * G);
    for (let k = 0; k < G * G; k++) grid[k] = rand() * 2 - 1;
    const ox = rand(), oy = rand();
    for (let i = 0; i < N; i++) {
      const fy = (i + 0.5) / N * cells + oy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let j = 0; j < N; j++) {
        const fx = (j + 0.5) / N * cells + ox, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * G + x0], b = grid[y0 * G + x0 + 1], c = grid[(y0 + 1) * G + x0], d = grid[(y0 + 1) * G + x0 + 1];
        out[i * N + j] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
      }
    }
    amp *= persistence; cells *= 2;
  }
  return normalizeField(out);
}
/** Separable box blur (radius r, repeated `passes` times ≈ Gaussian). */
function blurField(src, N, r, passes = 2) {
  let a = Float32Array.from(src), b = new Float32Array(N * N);
  const w = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < N; i++) {           // horizontal
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += a[i * N + clamp(j, 0, N - 1)];
      for (let j = 0; j < N; j++) {
        b[i * N + j] = acc / w;
        acc += a[i * N + clamp(j + r + 1, 0, N - 1)] - a[i * N + clamp(j - r, 0, N - 1)];
      }
    }
    for (let j = 0; j < N; j++) {           // vertical
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += b[clamp(i, 0, N - 1) * N + j];
      for (let i = 0; i < N; i++) {
        a[i * N + j] = acc / w;
        acc += b[clamp(i + r + 1, 0, N - 1) * N + j] - b[clamp(i - r, 0, N - 1) * N + j];
      }
    }
  }
  return a;
}
/** bilinear sample of an N×N field at fractional grid coords (col x, row y) */
function sampleField(f, N, x, y) {
  x = clamp(x - 0.5, 0, N - 1.0001); y = clamp(y - 0.5, 0, N - 1.0001);
  const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
  const k = y0 * N + x0;
  return (f[k] * (1 - tx) + f[k + 1] * tx) * (1 - ty) + (f[k + N] * (1 - tx) + f[k + N + 1] * tx) * ty;
}

// ── colour maps (mirrored 1:1 in GLSL) ──
function phaseRGB(phi) {                           // cyclic, neon rainbow (cosine palette)
  const t = (phi + Math.PI) / TAU;
  return [0.5 + 0.5 * Math.cos(TAU * (t + 0.00)), 0.5 + 0.5 * Math.cos(TAU * (t + 0.33)), 0.5 + 0.5 * Math.cos(TAU * (t + 0.67))];
}
function divergingRGB(x) {                         // x ∈ [-1, 1]: blue → slate → amber/red
  x = clamp(x, -1, 1);
  const neg = [0.12, 0.55, 1.0], mid = [0.10, 0.13, 0.18], pos = [1.0, 0.42, 0.16];
  const a = Math.abs(x), t = Math.pow(a, 0.75), c = x < 0 ? neg : pos;
  return [mid[0] + (c[0] - mid[0]) * t, mid[1] + (c[1] - mid[1]) * t, mid[2] + (c[2] - mid[2]) * t];
}
function coherenceRGB(g) {                         // 0 → black-magenta, 0.5 → teal, 1 → white-cyan
  g = clamp(g, 0, 1);
  if (g < 0.5) { const t = g / 0.5; return [0.10 * (1 - t) + 0.02 * t, 0.02 * (1 - t) + 0.45 * t, 0.10 * (1 - t) + 0.52 * t]; }
  const t = (g - 0.5) / 0.5; return [0.02 + 0.80 * t, 0.45 + 0.53 * t, 0.52 + 0.48 * t];
}
const rgbCss = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

// ── dates & formatting ──
const MS_DAY = 86400000;
function dateAt(tDays) { return new Date(CFG.t0 + tDays * MS_DAY); }
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function epochOf(t) { return clamp(Math.round(t / CFG.repeatDays), 0, CFG.nEpochs - 1); }
const pad2 = (n) => String(n).padStart(2, '0');
const epochName = (k) => 'E' + pad2(k);
function fmt(x, d = 1) { return Number.isFinite(x) ? x.toFixed(d) : '--'; }
function fmtS(x, d = 1) { return Number.isFinite(x) ? (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) : '--'; }
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function fmtSci(x, d = 2) {
  if (!Number.isFinite(x) || x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  const m = x / Math.pow(10, e);
  return m.toFixed(d) + '×10' + String(e).split('').map((ch) => SUP[ch]).join('');
}
function fmtArea(km2) { return km2 >= 100 ? km2.toFixed(0) : km2 >= 10 ? km2.toFixed(1) : km2.toFixed(2); }
function fmtVol(m3) {
  if (m3 >= 1e9) return (m3 / 1e9).toFixed(2) + ' km³';
  if (m3 >= 1e6) return (m3 / 1e6).toFixed(2) + '×10⁶ m³';
  if (m3 >= 1e3) return (m3 / 1e3).toFixed(1) + '×10³ m³';
  return m3.toFixed(0) + ' m³';
}
function fmtLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}

// ── easing & tweens ──
const Ease = {
  linear: (t) => t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};
const Tweens = {
  list: [],
  /** returns a Promise<boolean>: true when completed, false when killed */
  add(dur, onUpdate, ease = Ease.inOutCubic, tag = null) {
    if (tag) this.kill(tag);
    return new Promise((resolve) => this.list.push({ t: 0, dur: Math.max(dur, 1e-4), onUpdate, ease, resolve, tag, done: false }));
  },
  kill(tag) {
    for (const tw of this.list) if (tw.tag === tag && !tw.done) { tw.done = true; tw.resolve(false); }
  },
  update(dt) {
    if (!this.list.length) return;
    const snapshot = this.list.slice();          // tweens added during this frame start next frame
    for (const tw of snapshot) {
      if (tw.done) continue;
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.dur);
      tw.onUpdate(tw.ease(p), p);
      if (p >= 1 && !tw.done) { tw.done = true; tw.resolve(true); }
    }
    this.list = this.list.filter((tw) => !tw.done);
  },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── tiny event bus ──
const Bus = {
  map: new Map(),
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, new Set()); this.map.get(ev).add(fn); return () => this.map.get(ev).delete(fn); },
  emit(ev, data) { const s = this.map.get(ev); if (s) for (const fn of [...s]) fn(data); },
};

// ── binary helpers ──
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser has no DecompressionStream. Please use a current Chrome, Edge, Firefox or Safari.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** DEM grid → Float32Array (m). Encoding: u16 = (m + 1000)·scale, row-delta mod 2^16, zlib, base64. */
async function decodeDem(meta) {
  const bytes = await inflate(b64ToBytes(meta.data));
  const N = meta.n;
  const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, N * N);
  const out = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let j = 0; j < N; j++) {
      acc = (acc + u16[i * N + j]) & 0xFFFF;
      out[i * N + j] = acc / meta.scale - 1000;
    }
  }
  return out;
}
async function decodeMask(meta) {
  const bytes = await inflate(b64ToBytes(meta.data));
  return { w: meta.w, h: meta.h, data: bytes };
}

// ── DOM helpers (guarded for headless tests) ──
const hasDOM = typeof document !== 'undefined';
const $ = (sel, root) => (hasDOM ? (root || document).querySelector(sel) : null);
const $$ = (sel, root) => (hasDOM ? [...(root || document).querySelectorAll(sel)] : []);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
