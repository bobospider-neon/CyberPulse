// ───────────────────────── 13b · REAL NISAR DATA (NASA CMR, live · ASF browse images) ─────────────────────────
// Nothing in this module is simulated. The product lists, dates, tracks, frames and footprints come live from NASA's
// Common Metadata Repository (CMR, the catalogue behind Earthdata Search). The pictures are the NISAR QA browse
// quick-looks that ASF publishes with every product. Both are public and CORS-enabled, so no login is needed.
// tools/fetch_nisar.py ships a snapshot of the same data inside the page: the panel works at once, offline and in
// sandboxed viewers, and the live CMR answer replaces it whenever the network allows.
const REAL_CMR = 'https://cmr.earthdata.nasa.gov/search/';
const REAL_COLL = {   // validated first, then provisional, then beta (same order as tools/fetch_nisar.py)
  GUNW: ['NISAR_L2_GUNW_V1', 'NISAR_L2_GUNW_PROVISIONAL_V1', 'NISAR_L2_GUNW_BETA_V1'],
  GCOV: ['NISAR_L2_GCOV_V1', 'NISAR_L2_GCOV_PROVISIONAL_V1', 'NISAR_L2_GCOV_BETA_V1'],
  RSLC: ['NISAR_L1_RSLC_V1', 'NISAR_L1_RSLC_PROVISIONAL_V1', 'NISAR_L1_RSLC_BETA_V1'],
};
const REAL_FAMILIES = ['L1_RSLC', 'L2_GSLC', 'L1_RIFG', 'L1_RUNW', 'L2_GUNW', 'L1_ROFF', 'L2_GOFF', 'L2_GCOV', 'L3_SME2'];
// matplotlib "twilight_shifted": the colormap NISAR QA (isce-framework/nisarqa) uses for GUNW phase browse images
const TWILIGHT_SHIFTED = ['#301437', '#4e186f', '#5e45a6', '#6276ba', '#7ca2c2', '#b3c6ce', '#e2d9e2', '#d4bcac', '#c6896c', '#b25652', '#8d2b50', '#581647', '#2f1436'];
const REAL_KIND = {
  GUNW: { name: 'Interferogram', what: 'GUNW · geocoded unwrapped interferogram' },
  GCOV: { name: 'Polarimetry', what: 'GCOV · geocoded polarimetric covariance' },
};

const Real = {
  on: false, kind: 'GUNW', siteId: null, sites: {}, sel: { GUNW: null, GCOV: null }, picked: { GUNW: false, GCOV: false },
  imgs: new Map(), tex: null, token: 0, prev: null, status: '',
};

// ── catalogue records (mirror of record() / coverage() / pick() in tools/fetch_nisar.py) ──
function realInside(poly, lon, lat) {
  let c = false;
  for (let k = 0; k < poly.length - 1; k++) {
    const [y1, x1] = poly[k], [y2, x2] = poly[k + 1];
    if ((y1 > lat) !== (y2 > lat) && lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1) c = !c;
  }
  return c;
}
function realCoverage(poly, bb) {
  let n = 0;
  for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) if (realInside(poly, lerp(bb[0], bb[2], a / 8), lerp(bb[1], bb[3], b / 8))) n++;
  return n / 81;
}
function realRecord(item, bb) {
  const u = item.umm, at = {};
  for (const a of u.AdditionalAttributes || []) at[a.Name] = a.Values;
  const one = (k) => (at[k] || [null])[0];
  const pts = u.SpatialExtent.HorizontalSpatialDomain.Geometry.GPolygons[0].Boundary.Points;
  const poly = pts.map((p) => [+p.Latitude.toFixed(5), +p.Longitude.toFixed(5)]);
  const urls = (u.RelatedUrls || []).map((r) => r.URL).filter((x) => x.startsWith('https://'));
  const type = one('PRODUCT_TYPE');
  const r = {
    id: u.GranuleUR, cid: item.meta['concept-id'], coll: item.meta['collection-concept-id'], short: u.CollectionReference.ShortName,
    type, track: +(one('TRACK_NUMBER') || 0), frame: +(one('FRAME_NUMBER') || 0), dir: (one('ASCENDING_DESCENDING') || '?')[0],
    pol: (at.FREQUENCY_A_POLARIZATION || []).join('+'), freqs: (at.FREQUENCIES || []).join('+'), version: one('PRODUCT_VERSION'),
    cov: +realCoverage(poly, bb).toFixed(3), poly,
    browse: urls.find((x) => x.endsWith('_LATLON.png')) || null,
    data: urls.find((x) => x.endsWith('.h5') && x.includes('/NISAR/')) || null,
  };
  if (type === 'GUNW') { r.ref = (one('REFERENCE_ZERO_DOPPLER_START_TIME') || '').slice(0, 19); r.sec = (one('SECONDARY_ZERO_DOPPLER_START_TIME') || '').slice(0, 19); }
  else r.ref = u.TemporalExtent.RangeDateTime.BeginningDateTime.slice(0, 19);
  return r;
}
const realDays = (r) => (Date.parse(r.sec + 'Z') - Date.parse(r.ref + 'Z')) / MS_DAY;
function realPick(recs) {
  let full = recs.filter((r) => r.cov >= 0.98 && r.browse);
  if (!full.length) full = recs.filter((r) => r.browse);
  if (!full.length) return null;
  if (full[0].type === 'GUNW') { const short = full.filter((r) => realDays(r) <= 24); if (short.length) full = short; }
  return full[0];
}

// ── live CMR queries ──
async function realGet(url, ms = 15000) {
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return { json: await r.json(), hits: +(r.headers.get('CMR-Hits') || 0) };
  } finally { clearTimeout(to); }
}
const realBB = (bb) => bb.map((v) => v.toFixed(4)).join(',');
function realGranules(names, bb, n) {
  const q = new URLSearchParams();
  for (const s of names) q.append('short_name[]', s);
  q.set('bounding_box', realBB(bb)); q.set('page_size', n); q.set('sort_key', '-start_date');
  return realGet(REAL_CMR + 'granules.umm_json?' + q).then((r) => r.json.items || []);
}
async function realQueryLive(bb) {
  const fam = REAL_FAMILIES.map((f) => realGet(`${REAL_CMR}granules.json?short_name=NISAR_${f}*&options[short_name][pattern]=true&bounding_box=${realBB(bb)}&page_size=0`).then((r) => [f, r.hits]));
  const [gunw, gcov, last, inv] = await Promise.all([realGranules(REAL_COLL.GUNW, bb, 60), realGranules(REAL_COLL.GCOV, bb, 60), realGranules(REAL_COLL.RSLC, bb, 1), Promise.all(fam)]);
  const keep = (items) => items.map((it) => realRecord(it, bb)).filter((r) => r.cov > 0).slice(0, 24);
  const out = { live: true, fetched: new Date().toISOString().slice(0, 19) + 'Z', inventory: Object.fromEntries(inv), products: { GUNW: keep(gunw), GCOV: keep(gcov) } };
  if (last.length) { const r = realRecord(last[0], bb); out.lastPass = { t: r.ref, track: r.track, frame: r.frame, dir: r.dir, id: r.id }; }
  return out;
}

// ── browse image → georeferenced crop of the scene (mirror of fit_browse() / crop() in tools/fetch_nisar.py) ──
function realFitBrowse(d, W, H, poly) {
  const ok = (p) => d[p + 3] > 0 && d[p] + d[p + 1] + d[p + 2] > 0;   // 0 = no data (NISAR QA convention)
  let y0 = H, y1 = -1, x0 = W, x1 = -1, n = 0;
  for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p += 4) if (ok(p)) { n++; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  if (n < 1000) throw new Error('the browse image has no valid pixels');
  const rowMean = (y) => { let s = 0, c = 0; for (let x = 0, p = y * W * 4; x < W; x++, p += 4) if (ok(p)) { s += x; c++; } return s / c; };
  const colMean = (x) => { let s = 0, c = 0; for (let y = 0; y < H; y++) if (ok((y * W + x) * 4)) { s += y; c++; } return s / c; };
  const ext = { top: [rowMean(y0), y0], bottom: [rowMean(y1), y1], left: [x0, colMean(x0)], right: [x1, colMean(x1)] };
  const v = poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1] ? poly.slice(0, -1) : poly;
  const ext1 = (f, s) => v.reduce((a, p) => (s * (f(p) - f(a)) > 0 ? p : a));
  const ver = { top: ext1((p) => p[0], 1), bottom: ext1((p) => p[0], -1), left: ext1((p) => p[1], -1), right: ext1((p) => p[1], 1) };
  const K = ['top', 'bottom', 'left', 'right'];
  const fit = (xs, ys) => {
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    const a = sxy / sxx; return [a, my - a * mx];
  };
  const lon = K.map((k) => ver[k][1]), lat = K.map((k) => ver[k][0]), px = K.map((k) => ext[k][0] + 0.5), py = K.map((k) => ext[k][1] + 0.5);
  const [ax, bx] = fit(lon, px), [ay, by] = fit(lat, py);
  const res = Math.max(...K.map((_, i) => Math.max(Math.abs(ax * lon[i] + bx - px[i]), Math.abs(ay * lat[i] + by - py[i]))));
  return { ax, bx, ay, by, res };
}
function realCrop(img, poly, bb) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const bg = big.getContext('2d', { willReadFrequently: true }); bg.drawImage(img, 0, 0);
  const F = realFitBrowse(bg.getImageData(0, 0, W, H).data, W, H, poly);
  if (F.res > 8) throw new Error(`georeferencing residual ${F.res.toFixed(1)} px is too large`);
  const x0 = F.ax * bb[0] + F.bx, x1 = F.ax * bb[2] + F.bx, y0 = F.ay * bb[3] + F.by, y1 = F.ay * bb[1] + F.by;
  const n = Math.round(clamp(Math.max(x1 - x0, y1 - y0), 64, 384));
  const cv = document.createElement('canvas'); cv.width = n; cv.height = n;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(big, x0, y0, x1 - x0, y1 - y0, 0, 0, n, n);
  const id = g.getImageData(0, 0, n, n), d = id.data;
  for (let p = 0; p < d.length; p += 4) if (d[p] + d[p + 1] + d[p + 2] === 0) d[p + 3] = 0;
  g.putImageData(id, 0, 0);
  return { src: cv, n, res: +F.res.toFixed(2), mpp: +((bb[3] - bb[1]) * 111320 / Math.abs(y1 - y0)).toFixed(1), from: 'live' };
}
function realLoadImg(src, cors) {
  return new Promise((res, rej) => {
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    const to = setTimeout(() => rej(new Error('timed out loading the browse image')), 45000);
    im.onload = () => { clearTimeout(to); res(im); };
    im.onerror = () => { clearTimeout(to); rej(new Error('could not reach the ASF browse server')); };
    im.src = src;
  });
}
// ── real values from downloaded .h5 products (tools/nisar_h5.py → data/nisar_<scene>_<gcov|gunw>.json) ──
// One granule is one acquisition: the first 13 name fields identify it (for GUNW the reference + secondary times are
// fields 12-15, and the first 13 still single it out), whatever the processing version (CRID) of the copy in CMR.
const realAcq = (id) => id.split('_').slice(0, 13).join('_');
const REAL_STRETCH = { HHHH: [-25, 0], VVVV: [-25, 0], HVHV: [-30, -5], VHVH: [-30, -5] };
function realValuesMeta(site, type) {
  const all = window.CSAR_DATA && window.CSAR_DATA.nisarValues && window.CSAR_DATA.nisarValues[site && site.site];
  return (all && all[type]) || null;
}
const realHasValues = (rec, site) => { const v = rec && realValuesMeta(site, rec.type); return !!(v && realAcq(rec.id) === realAcq(v.id)); };
async function realValues(v) {
  if (!v.decoded) {
    v.decoded = (async () => {
      const out = {};
      for (const [k, b64] of Object.entries(v.data)) {
        const bytes = await inflate(b64ToBytes(b64));
        out[k] = v.type === 'GUNW' && (k === 'unw' || k === 'az' || k === 'rg') ? new Int16Array(bytes.buffer, bytes.byteOffset, v.n * v.n) : bytes;
      }
      if (v.type === 'GUNW') {   // derived layers, once
        const n2 = v.n * v.n, lam = v.lambda;
        out.los = new Float32Array(n2).fill(NaN);
        for (let k = 0; k < n2; k++) if (out.unw[k] !== -32768) out.los[k] = out.unw[k] / v.enc.unw * lam / (4 * Math.PI) * 1000;   // mm
        if (out.az) {
          const days = (Date.parse(v.sec + 'Z') - Date.parse(v.ref + 'Z')) / MS_DAY, si = Math.sin((v.incidence || 39) * DEG);
          out.speed = new Float32Array(n2).fill(NaN);
          for (let k = 0; k < n2; k++) if (out.az[k] !== -32768 && out.rg[k] !== -32768) out.speed[k] = Math.hypot(out.az[k] / v.enc.off, out.rg[k] / v.enc.off / si) / days;
        }
        const pct = (arr, p, abs) => { const a = []; for (const x of arr) if (Number.isFinite(x)) a.push(abs ? Math.abs(x) : x); a.sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 1; };
        out.losR = Math.max(1, pct(out.los, 0.98, true));
        if (out.speed) out.speedMax = Math.max(0.5, pct(out.speed, 0.995));
      }
      v.dec = out;   // sync access for the legend
      return out;
    })();
  }
  return v.decoded;
}
const realDb = (v, q) => (q ? q / v.enc.k - v.enc.db0 : NaN);
const realWrp = (q) => (q ? (q - 1) / 254 * TAU - Math.PI : NaN);
const realCoh = (q) => (q ? (q - 1) / 254 : NaN);
// which real layer the current observable shows (keys 1-4)
function realLayer(v, d) {
  if (v.type === 'GCOV') return 'pol';
  if (S.mode === 'coh') return 'coh';
  if (S.mode === 'defo') return d && d.speed ? 'speed' : 'los';
  return 'wrp';
}
async function realValuesImage(v, layer) {
  const d = await realValues(v), n = v.n;
  const cv = document.createElement('canvas'); cv.width = n; cv.height = n;
  const g = cv.getContext('2d'), id = g.createImageData(n, n), px = id.data;
  const put = (k, c) => { px[k * 4] = c[0] * 255; px[k * 4 + 1] = c[1] * 255; px[k * 4 + 2] = c[2] * 255; px[k * 4 + 3] = 255; };
  if (layer === 'pol') {
    const co = v.terms.find((t) => t === 'HHHH' || t === 'VVVV'), cx = v.terms.find((t) => t === 'HVHV' || t === 'VHVH') || co;
    const st = (t, q) => clamp((realDb(v, q) - REAL_STRETCH[t][0]) / (REAL_STRETCH[t][1] - REAL_STRETCH[t][0]), 0, 1);
    for (let k = 0; k < n * n; k++) { const a = d[co][k], b = d[cx][k]; if (a && b) put(k, [st(co, a), st(cx, b), st(co, a)]); }
  } else {
    const mask = S.layers.mask ? 0.25 : 0;
    for (let k = 0; k < n * n; k++) {
      const gm = realCoh(d.coh[k]);
      let c = null;
      if (layer === 'wrp') { const w = realWrp(d.wrp[k]); if (Number.isFinite(w)) c = phaseRGB(w); }
      else if (layer === 'coh') { if (Number.isFinite(gm)) c = coherenceRGB(gm); }
      else if (layer === 'los') { const x = d.los[k]; if (Number.isFinite(x)) c = divergingRGB(clamp(x / d.losR, -1, 1)); }
      else if (layer === 'speed') { const x = d.speed[k]; if (Number.isFinite(x)) c = coherenceRGB(Math.sqrt(clamp(x / d.speedMax, 0, 1))); }   // √ so slow sheet flow still shows
      if (!c) continue;
      if (layer !== 'coh' && layer !== 'speed' && mask && gm < mask) c = [0.075, 0.09, 0.11];   // same γ mask as the simulated views
      put(k, c);
    }
  }
  g.putImageData(id, 0, 0);
  return { src: cv, n, res: 0, mpp: +(typeof v.source_m === 'object' ? (layer === 'wrp' ? v.source_m.wrp : v.source_m.unw) : v.source_m).toFixed(0), from: 'h5', layer };
}
// real values under the cursor (or the pinned pixel), shown in the panel
async function realProbe() {
  const el = $('#real-probe'); if (!el) return;
  const site = realSite(), rec = realSelected(site);
  if (!Real.on || !realHasValues(rec, site)) { el.hidden = true; return; }
  const v = realValuesMeta(site, rec.type), d = await realValues(v);
  if (Real.on && Real.layer && realLayer(v, d) + ':' + S.layers.mask !== Real.layer) { Real.layer = null; realApply(); }   // keys 1-4 / γ mask switch the real layer
  const at = S.hover || S.pin;
  if (!at) { el.hidden = true; return; }
  const i = clamp(Math.floor(at.i), 0, v.n - 1), j = clamp(Math.floor(at.j), 0, v.n - 1), k = i * v.n + j;
  const where = S.hover ? 'the cursor' : 'the pinned pixel';
  el.hidden = false;
  if (v.type === 'GCOV') {
    const vals = v.terms.map((t) => [t.slice(0, 2), realDb(v, d[t][k])]);
    if (vals.some(([, x]) => !Number.isFinite(x))) { el.innerHTML = 'No valid NISAR sample at this pixel.'; return; }
    const ratio = vals.length > 1 ? vals[1][1] - vals[0][1] : null;
    el.innerHTML = `<b>Measured by NISAR</b> at ${where} · γ⁰ ` + vals.map(([p, x]) => `${p} <b>${x.toFixed(1)} dB</b>`).join(' · ') +
      (ratio !== null ? ` · HV/HH <b>${ratio.toFixed(1)} dB</b>` : '') +
      `<br><span class="real-status">mean of ≈${v.looksPerCell} samples of the ${v.source_m} m product in this ${Math.round(S.sc.meta.pixel_m || 0)} m cell</span>`;
    return;
  }
  const w = realWrp(d.wrp[k]), gm = realCoh(d.coh[k]), los = d.los[k], sp = d.speed ? d.speed[k] : NaN;
  const days = Math.round((Date.parse(v.sec + 'Z') - Date.parse(v.ref + 'Z')) / MS_DAY);
  el.innerHTML = `<b>Measured by NISAR</b> at ${where} · ${v.ref.slice(0, 10)} → ${v.sec.slice(5, 10)}<br>` +
    `phase <b>${Number.isFinite(w) ? (w >= 0 ? '+' : '') + w.toFixed(2) + ' rad' : '—'}</b> · γ <b>${Number.isFinite(gm) ? gm.toFixed(2) : '—'}</b> · ` +
    `LoS change <b>${Number.isFinite(los) ? (los >= 0 ? '+' : '') + los.toFixed(1) + ' mm' : 'not unwrapped here'}</b> in ${days} d` +
    (d.speed ? ` · offsets → <b>${Number.isFinite(sp) ? sp.toFixed(1) + ' m/day' : '—'}</b>` : '') +
    `<br><span class="real-status">LoS = λ/4π · Δφ, λ ${(v.lambda * 100).toFixed(2)} cm, relative to the scene median, sign as stored in the product</span>`;
}

function realImage(rec, site) {
  if (realHasValues(rec, site)) {
    const v = realValuesMeta(site, rec.type);
    return realValues(v).then((d) => {
      const layer = realLayer(v, d), key = 'h5:' + rec.id + ':' + layer + ':' + S.layers.mask;
      if (!Real.imgs.has(key)) Real.imgs.set(key, realValuesImage(v, layer));
      return Real.imgs.get(key);
    });
  }
  if (Real.imgs.has(rec.id)) return Real.imgs.get(rec.id);
  const snap = site.browse && site.browse[rec.type];
  const p = snap && snap.id === rec.id
    ? realLoadImg(snap.img, false).then((im) => ({ src: im, n: snap.n, res: snap.res_px, mpp: snap.m_per_px, from: 'snapshot' }))
    : realLoadImg(rec.browse, true).then((im) => realCrop(im, rec.poly, site.bbox));
  Real.imgs.set(rec.id, p);
  p.catch(() => Real.imgs.delete(rec.id));
  return p;
}

// ── state per scene ──
function realSiteOf(sc) {
  const id = sc.id || S.siteId;
  if (!Real.sites[id]) {
    const snap = window.CSAR_DATA && window.CSAR_DATA.nisar && window.CSAR_DATA.nisar[id];
    const m = sc.meta;
    Real.sites[id] = snap
      ? { ...snap, live: false, products: { GUNW: snap.products.GUNW || [], GCOV: snap.products.GCOV || [] } }
      : { bbox: [m.lon_min, m.lat_min, m.lon_max, m.lat_max], live: false, products: { GUNW: [], GCOV: [] }, inventory: null, browse: {} };
  }
  return Real.sites[id];
}
function realDefaults(site) {
  for (const k of ['GUNW', 'GCOV']) {
    const list = site.products[k];
    if (Real.picked[k] && list.some((r) => r.id === Real.sel[k])) continue;
    const snap = site.browse && site.browse[k];
    const best = realPick(list);
    Real.sel[k] = best ? best.id : null;
    // keep the embedded image while it is still the best choice: it shows at once, with no download
    if (snap && best && snap.id !== best.id && !site.live) Real.sel[k] = snap.id;
    // calibrated values from a downloaded .h5 beat any quick-look
    const withValues = list.find((r) => realHasValues(r, site));
    if (withValues) Real.sel[k] = withValues.id;
  }
}
const realSelected = (site, k = Real.kind) => (site ? site.products[k].find((r) => r.id === Real.sel[k]) : null) || null;
function realSite() { return Real.siteId && S.sc ? Real.sites[S.sc.id || S.siteId] : null; }

async function realOnSite(id) {
  realOff(true);
  Real.picked = { GUNW: false, GCOV: false };
  if (!id || !S.sc) { Real.siteId = null; realUI(); return; }
  Real.siteId = id;
  const site = realSiteOf(S.sc);
  realDefaults(site);
  realUI();
  if (site.live === true || site.live === 'pending') return;
  site.live = 'pending'; realUI();
  try {
    const live = await realQueryLive(site.bbox);
    Object.assign(site, live);
    if (live.products.GUNW.length + live.products.GCOV.length === 0 && site.browse && Object.keys(site.browse).length) site.live = 'empty';
  } catch (e) {
    site.live = 'error'; site.error = e.name === 'AbortError' ? 'NASA CMR did not answer in time' : e.message;
  }
  if (Real.siteId === id) { realDefaults(site); realUI(); if (Real.on) realApply(); }
}

// ── terrain overlay ──
async function realApply() {
  const site = realSite(), rec = realSelected(site);
  if (!rec) { Real.status = `No real NISAR ${Real.kind} product covers this scene yet.`; realUI(); return false; }
  const token = ++Real.token;
  Real.status = realHasValues(rec, site) ? 'Decoding the calibrated values…' : rec.id === (site.browse && site.browse[rec.type] || {}).id ? 'Showing the embedded copy of this browse image.' : 'Downloading the browse image from ASF (≈2 MB)…';
  realUI();
  let im;
  try { im = await realImage(rec, site); } catch (e) {
    if (token !== Real.token) return false;
    Real.status = 'Could not load the browse image: ' + e.message + '.';
    toast(Real.status); realUI(); return false;
  }
  if (token !== Real.token || !Real.on) return false;
  const t = new THREE.Texture(im.src);
  t.flipY = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  const U = App.world.U, old = Real.tex;
  Real.tex = t; U.uReal.value = t;
  if (old) old.dispose();
  Tweens.add(0.9, (e) => { U.uRealOn.value = Math.max(U.uRealOn.value, e); }, Ease.outCubic, 'real');
  Real.layer = im.layer ? im.layer + ':' + S.layers.mask : null;
  const REAL_LAYER_TXT = { pol: 'calibrated γ⁰ (HH, HV)', wrp: 'wrapped phase', los: 'line-of-sight change', coh: 'coherence', speed: 'ice speed from pixel offsets' };
  Real.status = im.from === 'h5'
    ? `Real values read from the .h5 product: ${REAL_LAYER_TXT[im.layer]} (${im.mpp} m product pixels, averaged per scene cell).` +
      (im.layer === 'pol' ? '' : ' Keys 1–4 switch phase / change / coherence.') + ' Hover the terrain for the measured values.'
    : `Georeferenced to ±${im.res} px (≈${Math.round(im.res * im.mpp)} m) · ${im.mpp} m per browse pixel · ${im.from === 'live' ? 'downloaded live from ASF' : 'embedded copy'}.`;
  realUI(); updateLegend();
  return true;
}
async function realShow(on) {
  if (S.view !== 'terrain' || !S.sc || on === Real.on) return;
  if (on) {
    if (!realSelected(realSite())) { toast(`No real NISAR ${Real.kind} product covers this scene yet.`); return; }
    Real.prev = { exag: S.exag, band: S.band };
    Real.on = true;
    S.playing = false;
    setExag(1);                               // true scale: the real image sits on the real, undeformed DEM
    if (S.band === 'X') { S.band = 'L'; markStale(); }
    syncControls();
    Sound.click();
    await realApply();
  } else realOff(false);
  realUI(); updateLegend();
}
function realOff(silent) {
  Real.token++;
  const was = Real.on;
  Real.on = false;
  const U = App.world && App.world.U;
  if (U) { Tweens.add(0.5, (e) => { U.uRealOn.value = Math.min(U.uRealOn.value, 1 - e); }, Ease.outCubic, 'real'); }
  if (was && !silent && Real.prev && S.sc) { setExag(Real.prev.exag); if (Real.prev.band === 'X') { S.band = 'X'; markStale(); } syncControls(); }
  Real.prev = null; Real.status = ''; Real.layer = null;
  if (was && hasDOM) updateLegend();
}

// ── UI ──
function realAgo(iso) {
  const d = (Date.now() - Date.parse(iso + 'Z')) / MS_DAY;
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`;
}
function realRow(r, site) {
  const sel = r.id === Real.sel[r.type];
  const when = r.type === 'GUNW'
    ? `${r.ref.slice(0, 10)} → ${r.sec.slice(5, 10)} · ${Math.round(realDays(r))} d`
    : `${r.ref.slice(0, 10)} ${r.ref.slice(11, 16)} UTC`;
  const meta = `T${r.track} ${r.dir} · F${r.frame} · ${r.pol || r.freqs} · ${Math.round(r.cov * 100)} %${/BETA/.test(r.short) ? ' · beta' : /PROVISIONAL/.test(r.short) ? ' · prov.' : ''}`;
  const cached = site.browse && site.browse[r.type] && site.browse[r.type].id === r.id;
  return h('button', {
    class: 'real-row' + (sel ? ' on' : ''), 'aria-pressed': sel ? 'true' : 'false', title: r.id,
    onclick: () => { Sound.click(); Real.sel[r.type] = r.id; Real.picked[r.type] = true; realUI(); if (Real.on) realApply(); },
  }, h('b', {}, when), h('span', {}, meta + (realHasValues(r, site) ? ' · .h5 values' : cached ? ' · ●' : '')));
}
function realUI() {
  if (!hasDOM) return;
  const P = $('#panel-real'); if (!P) return;
  const site = realSite();
  P.hidden = !site;
  document.body.classList.toggle('real-on', Real.on);
  if (!site) return;
  const badge = $('#real-badge');
  badge.textContent = site.live === true ? 'LIVE · NASA CMR' : site.live === 'pending' ? 'QUERYING NASA CMR…' : site.fetched ? 'SNAPSHOT ' + site.fetched.slice(0, 10) : 'OFFLINE';
  badge.classList.toggle('live', site.live === true);
  const lp = site.lastPass;
  $('#real-last').innerHTML = lp
    ? `Last NISAR pass over this scene: <b>${lp.t.slice(0, 10)}</b> ${lp.t.slice(11, 16)} UTC · ${realAgo(lp.t)}<br>track ${lp.track} · ${lp.dir === 'A' ? 'ascending' : 'descending'} · frame ${lp.frame}`
    : site.live === 'pending' ? 'Asking NASA which NISAR products cover this scene…' : 'No NISAR acquisition found over this scene.';
  const inv = $('#real-inv'); inv.innerHTML = '';
  if (site.inventory) {
    let total = 0;
    for (const f of REAL_FAMILIES) { const n = site.inventory[f] || 0; total += n; if (n) inv.append(h('div', { class: 'ri' }, h('span', {}, f.split('_')[1]), h('b', {}, n))); }
    $('#real-inv-h').textContent = `In NASA's archive over this scene · ${total} products`;
  }
  for (const b of $$('#seg-real button')) b.setAttribute('aria-pressed', b.dataset.v === Real.kind ? 'true' : 'false');
  const list = $('#real-list'); list.innerHTML = '';
  const recs = site.products[Real.kind];
  if (!recs.length) list.append(h('div', { class: 'hint' }, site.live === 'pending' ? 'Loading…' : 'No product of this type covers the scene.'));
  for (const r of recs) list.append(realRow(r, site));
  const btn = $('#act-real');
  btn.setAttribute('aria-pressed', Real.on ? 'true' : 'false');
  btn.firstChild.textContent = Real.on ? 'HIDE REAL NISAR IMAGE' : 'SHOW REAL NISAR ON THE TERRAIN';
  const rec = realSelected(site);
  const links = $('#real-links'); links.innerHTML = '';
  if (rec) {
    const bb = site.bbox.map((v) => v.toFixed(3)).join(',');
    links.append(
      h('a', { href: `https://search.earthdata.nasa.gov/search/granules?p=${rec.coll}&sb=${bb}`, target: '_blank', rel: 'noopener' }, 'Earthdata Search ↗'),
      h('a', { href: `${REAL_CMR}concepts/${rec.cid}.html`, target: '_blank', rel: 'noopener' }, 'Product record ↗'),
      rec.data ? h('a', { href: rec.data, target: '_blank', rel: 'noopener', title: 'HDF5 product, needs a free Earthdata Login' }, 'Data .h5 (login) ↗') : null);
  }
  const recSel = realSelected(site);
  const note = Real.kind === 'GUNW' && realHasValues(recSel, site)
    ? 'Real NISAR L-band interferogram, <b>values read from the downloaded .h5 product</b>: <b>1</b> phase (multilooked from the 20 m complex interferogram, app colours, one cycle = λ/2), <b>2</b> change along the line of sight from the unwrapped phase' +
      (realValuesMeta(site, 'GUNW').data.az ? ' (here: ice speed from the pixel offsets)' : '') + ', <b>4</b> coherence. Real signal includes the atmosphere, not only ground motion.'
    : Real.kind === 'GUNW'
    ? 'Real NISAR L-band interferogram: the phase between two passes 12 days apart, coloured with the <i>twilight_shifted</i> map of NISAR\'s own QA browse images. Bands of colour are fringes from real ground motion, atmosphere and noise; speckled areas lost coherence.'
    : realHasValues(realSelected(site), site)
    ? 'Real NISAR L-band backscatter, <b>calibrated values</b> read from the downloaded .h5 product (γ⁰, terrain-corrected). <b style="color:#e48be4">Magenta</b> = strong HH (bare ground, buildings, flooded reeds), <b style="color:#8be48b">green</b> = strong HV (vegetation volume), dark = open water.'
    : 'Real NISAR L-band backscatter: <b style="color:#e48be4">magenta</b> = strong HH (bare ground, buildings, flooded trees), <b style="color:#8be48b">green</b> = strong HV (vegetation volume), dark = smooth water. Single-pol frames show HH in grey.';
  $('#real-note').innerHTML = note + (Real.status ? `<br><span class="real-status">${Real.status}</span>` : '') +
    (site.live === 'error' ? `<br><span class="real-status">Live query failed (${site.error}). Showing the snapshot from ${(site.fetched || '').slice(0, 10)}.</span>` : '');
  const ib = $('#intel-badge');
  if (ib && S.sc) ib.textContent = Real.on ? `REAL NISAR ${Real.kind} · NASA/ASF` : (S.sc.kind === 'custom' ? 'REAL DATA' : 'SIMULATED SIGNALS · REAL DEM');
}
function realLegend() {
  const bar = $('#lg-bar'), ticks = $('#lg-ticks'), title = $('#lg-title');
  bar.className = 'lg-bar'; bar.innerHTML = ''; bar.style.background = '';
  const rec = realSelected(realSite());
  const vG = rec && Real.kind === 'GUNW' && realHasValues(rec, realSite()) ? realValuesMeta(realSite(), 'GUNW') : null;
  if (vG) {
    const d = vG.dec, layer = realLayer(vG, d), pair = `${vG.ref.slice(0, 10)} → ${vG.sec.slice(5, 10)}`;
    if (layer === 'wrp') {
      title.innerHTML = `Real NISAR phase · ${pair} · <b>1 cycle = ${(vG.lambda / 2 * 100).toFixed(2)} cm</b> LoS`;
      bar.style.background = gradientCss(phaseRGB, -Math.PI, Math.PI);
      ticks.innerHTML = '<span>−π</span><span>−π/2</span><span>0</span><span>+π/2</span><span>+π</span>';
    } else if (layer === 'los') {
      const R = d ? d.losR : 30;
      title.innerHTML = `Real NISAR LoS change · ${pair} · <b>from the unwrapped phase</b>`;
      bar.style.background = gradientCss(divergingRGB, -1, 1);
      ticks.innerHTML = `<span>−${fmtTick(R)} mm</span><span>product sign</span><span>0 = scene median</span><span></span><span>+${fmtTick(R)} mm</span>`;
    } else if (layer === 'speed') {
      const V = d ? d.speedMax : 5;
      title.innerHTML = `Real NISAR ice speed · ${pair} · <b>from pixel offsets</b>`;
      bar.style.background = gradientCss(coherenceRGB, 0, 1);
      ticks.innerHTML = `<span>0</span><span>${fmtTick(V / 16)}</span><span>${fmtTick(V / 4)}</span><span>${fmtTick(V * 9 / 16)}</span><span>${fmtTick(V)} m/day</span>`;   // √ scale
    } else {
      title.innerHTML = `Real NISAR coherence γ · ${pair}`;
      bar.style.background = gradientCss(coherenceRGB, 0, 1);
      ticks.innerHTML = '<span>0</span><span>0.25</span><span>0.5</span><span>0.75</span><span>1</span>';
    }
  } else if (Real.kind === 'GUNW') {
    title.innerHTML = `Real NISAR GUNW · ${rec ? rec.ref.slice(0, 10) + ' → ' + rec.sec.slice(0, 10) : ''} · <b>phase, one colour cycle = one fringe interval</b>`;
    bar.style.background = `linear-gradient(90deg, ${TWILIGHT_SHIFTED.map((c, i) => `${c} ${(i / (TWILIGHT_SHIFTED.length - 1) * 100).toFixed(1)}%`).join(', ')})`;
    ticks.innerHTML = '<span>0</span><span>colour cycle (NISAR QA browse)</span><span>1</span>';
  } else if (realHasValues(rec, realSite())) {
    title.innerHTML = `Real NISAR GCOV · ${rec.ref.slice(0, 10)} · <b>calibrated γ⁰ from the .h5</b>`;
    bar.className = 'lg-bar pol';
    bar.innerHTML = '<span><i style="background:#e070e0"></i>HH −25 … 0 dB</span><span><i style="background:#60e060"></i>HV −30 … −5 dB</span><span><i style="background:#f4f4f4"></i>both strong</span>';
    ticks.innerHTML = '<span>R, B = HH · G = HV · fixed dB stretch · hover for values</span>';
  } else {
    title.innerHTML = `Real NISAR GCOV · ${rec ? rec.ref.slice(0, 10) : ''} · <b>L-band backscatter</b>`;
    bar.className = 'lg-bar pol';
    bar.innerHTML = '<span><i style="background:#e070e0"></i>HH (surface, double bounce)</span><span><i style="background:#60e060"></i>HV (volume)</span><span><i style="background:#f4f4f4"></i>both</span>';
    ticks.innerHTML = '<span>R, B = HH · G = HV · NISAR QA browse scaling</span>';
  }
}
// real NISAR acquisitions over the scene, drawn on the 4D timeline (called from drawTimeline)
function realTimelineTicks(g, xs, y0) {
  const site = realSite(); if (!site) return;
  const days = new Set();
  for (const r of site.products.GCOV) days.add(r.ref.slice(0, 10));
  for (const r of site.products.GUNW) { days.add(r.ref.slice(0, 10)); days.add(r.sec.slice(0, 10)); }
  g.fillStyle = 'rgba(76,242,168,0.85)';
  for (const d of days) {
    const t = (Date.parse(d + 'T12:00:00Z') - CFG.t0) / MS_DAY;
    if (t >= 0 && t <= CFG.tMax) { g.beginPath(); g.arc(xs(t), y0 + 9, 1.8, 0, TAU); g.fill(); }
  }
  const rec = Real.kind === 'GUNW' ? realSelected(site, 'GUNW') : null;
  if (rec && Real.on) {
    const a = (Date.parse(rec.ref + 'Z') - CFG.t0) / MS_DAY, b = (Date.parse(rec.sec + 'Z') - CFG.t0) / MS_DAY;
    if (b >= 0 && a <= CFG.tMax) { g.fillStyle = '#4cf2a8'; g.fillRect(xs(clamp(a, 0, CFG.tMax)), y0 + 7, Math.max(2, xs(clamp(b, 0, CFG.tMax)) - xs(clamp(a, 0, CFG.tMax))), 4); }
  }
}
function initReal() {
  $('#act-real').addEventListener('click', () => realShow(!Real.on));
  for (const b of $$('#seg-real button')) b.addEventListener('click', () => {
    Sound.click(); Real.kind = b.dataset.v; realUI(); updateLegend();
    if (Real.on) realApply();
  });
  Bus.on('site', (id) => realOnSite(id));
}
