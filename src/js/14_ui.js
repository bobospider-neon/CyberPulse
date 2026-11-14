// ───────────────────────── 14 · HUD (panels, inspector, KPIs, labels, input, loop) ─────────────────────────
function toast(msg, kind = '') {
  const box = $('#toasts'); if (!box) return;
  const el = h('div', { class: 'toast ' + kind }, msg);
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'alert' ? 7500 : 5500);
}
function openOverlay(id) { const o = $('#' + id); if (!o) return; o.classList.add('open'); Sound.open(); }
function closeOverlay(id) { const o = $('#' + id); if (o) o.classList.remove('open'); }
function setSeg(id, v) { $$(`#${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v)))); }
function syncControls() {
  setSeg('seg-band', S.band); setSeg('seg-mode', S.mode); setSeg('seg-geom', S.geom); setSeg('seg-pair', S.pair); setSeg('tl-speed', S.speed);
  $('#exag').value = sliderFromExag(S.exag);
  $('#exag-out').textContent = '×' + (S.exag >= 100 ? Math.round(S.exag) : S.exag.toFixed(S.exag < 10 ? 1 : 0)) + (S.sc && S.sc.exagMax && S.exag >= S.sc.exagMax - 0.5 ? ' · max' : '');
  for (const [k, id] of Object.entries({ mask: 'tg-mask', aps: 'tg-aps', vectors: 'tg-vectors', canopy: 'tg-canopy', beam: 'tg-beam', subsurface: 'tg-subsurface', cycle: 'tg-cycle', labels: 'tg-labels' })) $('#' + id).setAttribute('aria-pressed', String(S.layers[k]));
  const lam = S.band === 'S' ? BANDS.S.lambda : BANDS.L.lambda;
  $('#band-lambda').textContent = S.band === 'X' ? 'λ 23.85 | 9.37 cm' : `λ ${(lam * 100).toFixed(2)} cm`;
  if (S.sc) {
    const g = S.sc.geom[S.geom === 'desc' ? 'desc' : 'asc'];
    $('#geom-info').textContent = S.geom === 'fusion' ? 'asc + desc + MAI' : `θ ${g.inc.toFixed(1)}° · hdg ${g.hdgDeg.toFixed(0)}° · looks ${compass(g.lookDeg)}`;
  }
  $('#act-split').setAttribute('aria-pressed', String(S.split));
  $('#btn-satcam').setAttribute('aria-pressed', String(S.satCam));
  $('#act-slice').setAttribute('aria-pressed', String(S.tool === 'slice'));
  $('#tl-play-ico').innerHTML = S.playing ? '<path d="M4 3h3v10H4zM9 3h3v10H9z"/>' : '<path d="M4 2.5v11l9-5.5z"/>';
  document.body.classList.toggle('split', S.split && S.view === 'terrain');
  updateLegend();
  $('#split-cap').innerHTML = `RADAR GEOMETRY · <b>2D ${({ phase: 'INTERFEROGRAM', defo: 'DEFORMATION MAP', pol: 'FREEMAN–DURDEN RGB', coh: 'COHERENCE MAP' })[S.mode]}</b> · ${S.band === 'X' ? 'L inside lens / S outside' : S.band + '-band'}`;
}
function gradientCss(fn, from, to, n = 16) {
  const st = [];
  for (let q = 0; q <= n; q++) { const v = lerp(from, to, q / n); st.push(`${rgbCss(fn(v))} ${(q / n * 100).toFixed(1)}%`); }
  return `linear-gradient(90deg, ${st.join(', ')})`;
}
function updateLegend() {
  const L = $('#legend'); if (!L) return;
  L.classList.toggle('off', S.view !== 'terrain' || !S.sc);
  if (S.view !== 'terrain' || !S.sc) return;
  if (Real.on) return realLegend();
  const band = S.band === 'S' ? 'S' : 'L', lam = S.sc.lambda || BANDS[band].lambda, bar = $('#lg-bar'), ticks = $('#lg-ticks'), title = $('#lg-title');
  bar.className = 'lg-bar'; bar.innerHTML = ''; bar.style.background = '';
  const bandTxt = S.sc.kind === 'custom' ? `λ ${(lam * 100).toFixed(2)} cm (pack)` : S.band === 'X' ? 'L inside lens · S outside' : band + '-band';
  if (S.mode === 'phase') {
    title.innerHTML = `Wrapped phase · ${bandTxt} · <b>1 cycle = ${(lam / 2 * 100).toFixed(2)} cm</b> LoS`;
    bar.style.background = gradientCss(phaseRGB, -Math.PI, Math.PI);
    ticks.innerHTML = '<span>−π</span><span>−π/2</span><span>0</span><span>+π/2</span><span>+π</span>';
  } else if (S.mode === 'defo') {
    const R = S.defoRange * 1000, what = S.geom === 'fusion' ? 'Vertical U_z' : 'LoS displacement';
    title.innerHTML = `${what} since ${epochName(0)} · <b>contours every ${fmtTick(S.defoStep * 1000)} mm</b>`;
    bar.style.background = gradientCss(divergingRGB, -1, 1);
    ticks.innerHTML = `<span>${fmtTick(-R)} mm</span><span>away / down</span><span>0</span><span>toward / up</span><span>+${fmtTick(R)} mm</span>`;
  } else if (S.mode === 'pol') {
    title.innerHTML = `Freeman–Durden decomposition · ${bandTxt}`;
    bar.className = 'lg-bar pol';
    bar.innerHTML = '<span><i style="background:var(--pol-r)"></i>Double bounce</span><span><i style="background:var(--pol-g)"></i>Volume</span><span><i style="background:var(--pol-b)"></i>Surface</span>';
    ticks.innerHTML = '<span>brightness = total power (span)</span>';
  } else {
    title.innerHTML = `Interferometric coherence γ · ${bandTxt} · <b>red = change between passes</b>`;
    bar.style.background = gradientCss(coherenceRGB, 0, 1);
    ticks.innerHTML = '<span>0</span><span>0.25</span><span>0.5</span><span>0.75</span><span>1</span>';
  }
}
function setViewUI(view) {
  const terr = view === 'terrain';
  document.body.classList.toggle('view-terrain', terr);
  $('#topbar').classList.remove('hidden-ui');
  $('#dock-left').classList.toggle('off-left', !terr);
  $('#dock-right').classList.toggle('off-right', !terr);
  $('#dock-bottom').classList.toggle('off', !terr);
  $('#globe-hud').classList.toggle('off', terr);
  updateLegend();
  $('#btn-globe').style.display = terr ? '' : 'none';
  if (!terr) {
    $('#crumb-waltz').textContent = 'NISAR · GLOBAL COVERAGE';
    $('#crumb-site').innerHTML = 'Planet Earth<small>12-day repeat orbit</small>';
  }
  Labels.clearAll();
  if (!terr) buildGlobeLabels();
}
function setSiteUI(sc) {
  const site = sc.site, w = WALTZES[site.waltz];
  $('#crumb-waltz').textContent = w ? `WALTZ ${w.n} · ${w.title.toUpperCase()}` : 'YOUR DATA · CSAR-PACK';
  $('#crumb-site').innerHTML = '';
  $('#crumb-site').append(site.name, h('small', {}, site.region));
  setIntelUI(sc);
}
function setIntelUI(sc) {
  const st = sc.site.story;
  $('#intel-title').innerHTML = '';
  $('#intel-title').append(st.title, h('small', {}, st.sub));
  $('#intel-text').innerHTML = st.text;
  $('#intel-badge').textContent = sc.kind === 'custom' ? 'REAL DATA' : 'SIMULATED SIGNALS · REAL DEM';
  const acts = $('#intel-actions'); acts.innerHTML = '';
  const add = (label, sub, cls, fn) => acts.append(h('button', { class: 'act ' + cls, onclick: () => { Sound.click(); fn(); } }, label, h('small', {}, sub)));
  const ev = sc.events[0];
  const jump = (t, msg) => { S.playing = false; const t0 = S.t; Tweens.add(1.0, (e) => setTime(lerp(t0, t, e)), Ease.inOutCubic, 'time'); toast(msg); };
  if (sc.kind === 'fault') {
    if (!Number.isFinite(ev.t)) add('TRIGGER Mw 7.9 RUPTURE', '6 m right-lateral slip', 'red', triggerRupture);
    else add('RESET THE FAULT', 'back to interseismic loading', '', resetRupture);
    add('3D VECTORS', 'show horizontal motion', 'gold', () => { S.layers.vectors = !S.layers.vectors; syncControls(); });
  } else if (ev && Number.isFinite(ev.t)) {
    const kE = Math.ceil(ev.t / CFG.repeatDays);
    add('JUMP TO EVENT', `${epochName(kE)} · ${fmtDate(dateAt(kE * CFG.repeatDays))}`, 'red', () => jump(kE * CFG.repeatDays, `${ev.name}: between ${epochName(kE - 1)} and ${epochName(kE)}.`));
    if (sc.kind === 'wetland') add('FLOOD PEAK', `day ${sc.site.water.peak} · ${fmtDate(dateAt(sc.site.water.peak))}`, 'gold', () => jump(sc.site.water.peak, 'Spring flood pulse at its peak: look under the canopy with the X-ray lens.'));
    else if (sc.kind === 'urban') add('3D VECTORS', 'subsidence pulls blocks inward', 'gold', () => { S.layers.vectors = !S.layers.vectors; syncControls(); });
    else if (sc.kind === 'volcano') add('3D VECTORS', 'radial inflation field', 'gold', () => { S.layers.vectors = !S.layers.vectors; syncControls(); });
    else if (sc.kind === 'glacier') add('SPECKLE TRACKS', 'offset tracking, m/day', 'gold', () => { S.mode = 'coh'; syncControls(); toast('Coherence collapses on fast ice. The streaks show speckle-tracking velocity instead.'); });
  }
  Bus.emit('kpi');
}

// ───────────── KPIs ─────────────
function computeKPIs() {
  const sc = S.sc; if (!sc) return [];
  const C = currentCtx(), N = sc.N, px = sc.grid.pixelM, out = [];
  const K = (k, v, u = '', cls = '') => out.push({ k, v, u, cls });
  const ev = sc.events[0];
  const evState = ev && Number.isFinite(ev.t) ? (S.t >= ev.t ? 'occurred' : 'pending') : 'none';
  if (sc.kind === 'volcano') {
    const w = basisW(sc, S.t)[0], rate = (0.12 + 2 * 4.43e-4 * S.t) * 365.25;
    const k = sc.grid.idx(sc.mogiSrc.i, sc.mogiSrc.j), b = sc.bases[0].data;
    const up = b[k * 4 + 2] * w, upRate = b[k * 4 + 2] * rate;
    const los = (b[k * 4] * C.geom.los[0] + b[k * 4 + 1] * C.geom.los[1] + b[k * 4 + 2] * C.geom.los[2]) * w;
    K('ΔV injected', fmt(w, 1), '×10⁶ m³', 'gold'); K('Recharge rate', fmt(rate, 0), '×10⁶ m³/yr');
    K('Summit uplift', fmtS(up * 100, 1), 'cm', 'cyan'); K('Uplift rate', fmt(upRate * 100, 1), 'cm/yr');
    K('Fringes L / S', `${fmt(Math.abs(los) / (BANDS.L.lambda / 2), 1)} / ${fmt(Math.abs(los) / (BANDS.S.lambda / 2), 1)}`, '');
    const lvl = upRate * 100 < 3 ? ['NORMAL', 'green'] : upRate * 100 < 15 ? ['ADVISORY', 'amber'] : ['WATCH', 'red'];
    out.push({ k: 'Drill alert level', html: `<span class="pill ${lvl[1]}">${lvl[0]}</span>`, cls: '' });
    K('Debris flow', evState === 'occurred' ? `${fmtArea(ev.areaKm2)} km²` : 'day 228', evState === 'occurred' ? fmtVol(ev.volume) : '', evState === 'occurred' ? 'alert wide' : 'wide');
  } else if (sc.kind === 'fault') {
    const F = sc.site.fault, yearNow = 2025 + (CFG.t0 - Date.UTC(2025, 0, 1)) / (365.25 * MS_DAY) + S.t / 365.25;
    const ruptured = Number.isFinite(ev.t) && S.t >= ev.t;
    const deficit = F.V * (yearNow - F.since) - (ruptured ? F.slip : 0);
    const M0 = F.mu * F.length * F.D * Math.max(deficit, 0);
    K('Slip rate', (F.V * 1000).toFixed(0), 'mm/yr', 'gold'); K('Locking depth', (F.D / 1000).toFixed(0), 'km');
    K('Slip deficit', fmt(deficit, 2), 'm', ruptured ? 'cyan' : 'gold');
    K('Equivalent Mw', deficit > 0.01 ? fmt(momentMagnitude(M0), 2) : '—', '', ruptured ? '' : 'alert');
    K('Moment M₀', deficit > 0.01 ? fmtSci(M0, 2) : '0', 'N·m'); K('Stress drop Δσ', fmt((2 / Math.PI) * F.mu * Math.max(deficit, 0) / F.D / 1e6, 1), 'MPa');
    out.push({ k: 'Fault state', html: ruptured ? '<span class="pill red">RUPTURED · 6.0 m</span>' : sc.rupture.active ? '<span class="pill red">RUPTURING…</span>' : '<span class="pill amber">LOCKED since 1857</span>', cls: 'wide' });
  } else if (sc.kind === 'glacier') {
    const G = sc.glacier, seas = 1 + 0.25 * Math.sin(TAU * (S.t - 148.7) / 365.25);
    const v = G.vFront * seas;
    K('Front speed', fmt(v, 1), 'm/day', 'gold'); K('12-day offset', fmt(v * 12, 0), 'm');
    K('Discharge (5 km gate)', fmt(v * 365.25 * 900 * 5000 / 1e9, 1), 'km³/yr', 'cyan'); K('Peak thinning', fmt(14.6, 1), 'm/yr');
    K('Fringes per 12 d (L)', fmt(v * 12 * Math.abs(C.geom.los[0]) / (BANDS.L.lambda / 2), 0), '→ aliased');
    K('Calving', evState === 'occurred' ? `${fmtArea(ev.areaKm2)} km²` : 'day 240', evState === 'occurred' ? '≈ ' + fmtVol(ev.areaKm2 * 1e6 * 900) : '', evState === 'occurred' ? 'alert' : '');
  } else if (sc.kind === 'wetland') {
    const W = sc.site.water, lev = W.up[0] + W.up[1] * C.pulseC;
    let under = 0, open = 0, cohL = 0, cohS = 0, agbS = 0, agbN = 0;
    const st = 3;
    for (let i = 1; i < N; i += st) for (let j = 1; j < N; j += st) {
      const k = i * N + j;
      const fl = floodedK(sc, k, C.pulseC, C.calveC);
      if (fl && sc.cover.veg[k] > 0.5) { under++; if (cohK(sc, k, 'L', C) > 0.4) cohL++; if (cohK(sc, k, 'S', C) > 0.4) cohS++; }
      else if (fl || sc.cover.water[k] > 0.5) open++;
      if (sc.cover.veg[k] > 0.5 && sc.canopyH[k] > 6) { agbS += sc.agb[k]; agbN++; }
    }
    const a = px * px * st * st / 1e6;
    K('Water level (upstream)', fmt(lev, 2), 'm', 'cyan'); K('Open water', fmt(open * a, 0), 'km²');
    K('Flooded under canopy', fmt(under * a, 0), 'km²', 'gold'); K('Mean forest AGB', agbN ? fmt(agbS / agbN, 0) : '—', 't/ha');
    K('Coherent L-band', fmt(cohL * a, 0), 'km²', 'gold'); K('Coherent S-band', fmt(cohS * a, 0), 'km²', 'cyan');
    K(ev.name.replace(/ \(simulated\)/, ''), evState === 'occurred' ? `${fmtArea(ev.areaKm2)} km²` : 'day ' + ev.t, evState === 'occurred' ? 'canopy lost' : '', evState === 'occurred' ? 'alert wide' : 'wide');
  } else if (sc.kind === 'urban') {
    if (!sc.urbanStats) {
      const b = sc.bases[0].data; let mn = 0, area = 0;
      for (let k = 0; k < N * N; k++) { const u = b[k * 4 + 2]; if (u < mn) mn = u; if (u < -0.10) area += px * px; }
      let risk = 0;
      for (const B of sc.buildings) {
        const i = clamp(B.i | 0, 1, N - 2), j = clamp(B.j | 0, 1, N - 2);
        const gx = (b[(i * N + j + 1) * 4 + 2] - b[(i * N + j - 1) * 4 + 2]) / (2 * px), gy = (b[((i - 1) * N + j) * 4 + 2] - b[((i + 1) * N + j) * 4 + 2]) / (2 * px);
        if (Math.hypot(gx, gy) * 10 > 1 / 500) risk++;
      }
      sc.urbanStats = { maxRate: -mn, area: area / 1e6, risk };
    }
    const U = sc.urbanStats, w = basisW(sc, S.t)[0];
    K('Max sinking rate', fmt(U.maxRate * 100, 1), 'cm/yr', 'gold'); K('Area > 10 cm/yr', fmt(U.area, 0), 'km²');
    K('Sinking since E00', fmt(U.maxRate * w * 100, 1), 'cm', 'cyan'); K('Blocks β₁₀ > 1/500', `${U.risk.toLocaleString('en')}`, `of ${sc.buildings.length.toLocaleString('en')}`, U.risk ? 'alert' : '');
    K('Fissure damage', evState === 'occurred' ? `${fmtArea(ev.areaKm2)} km²` : 'day ' + ev.t, evState === 'occurred' ? `${ev.buildings} blocks` : '', evState === 'occurred' ? 'alert wide' : 'wide');
  } else {
    let mx = 0; for (let k = 0; k < N * N; k += 4) mx = Math.max(mx, Math.abs(sc.bases[0].data[k * 4 + 2] * sc.geom.asc.los[2]));
    K('Max |LoS| in pair', fmt(mx * 1000, 1), 'mm', 'gold'); K('Wavelength', fmt((sc.lambda || BANDS.L.lambda) * 100, 2), 'cm');
  }
  if (S.unwrap && S.unwrap.stats) { const s = S.unwrap.stats; K('Unwrap RMS error', `${fmt(s.rms, 2)} rad`, `${fmt(s.rmsMm, 1)} mm`, 'wide'); }
  if (S.ccd && S.ccd.result) { const r = S.ccd.result; K('CCD · changed area', fmtArea(r.totalA), `km² · ${r.comps.length} polygon(s)`, r.comps.length ? 'alert wide' : 'wide'); }
  return out;
}
function renderKPIs() {
  const box = $('#intel-kpis'); if (!box || !S.sc) return;
  const list = computeKPIs();
  box.innerHTML = '';
  for (const q of list) {
    const el = h('div', { class: 'kpi ' + (q.cls || '') }, h('div', { class: 'k' }, q.k));
    const v = h('div', { class: 'v' });
    if (q.html) v.innerHTML = q.html; else { v.append(q.v); if (q.u) v.append(h('small', {}, ' ' + q.u)); }
    el.append(v); box.append(el);
  }
}

// ───────────── inspector ─────────────
function surfaceName(sc, fr, k) {
  if (sc.kind === 'custom') return 'Real pixel (CSAR-PACK)';
  if (fr.water > 0.5) return sc.kind === 'glacier' ? 'Fjord / ice mélange' : 'Open water';
  if (fr.ice > 0.5) return sc.kind === 'glacier' ? (sc.aux[k] > 5 ? 'Fast glacier trunk' : 'Ice sheet') : 'Glacier ice & firn';
  if (fr.urban > 0.4) return 'Dense urban block';
  if (fr.veg > 0.3) {
    const tall = fr.canopyH > 6;
    const what = sc.kind === 'volcano' ? 'Old-growth conifer forest' : sc.kind === 'wetland' ? (tall ? (sc.id === 'danube' ? 'Willow–poplar forest' : 'Cypress–tupelo swamp forest') : 'Reed bed (Phragmites)') : 'Forest';
    return `${what}${fr.flooded ? ' · flooded' : ''} (H ${fr.canopyH.toFixed(0)} m)`;
  }
  if (sc.kind === 'volcano' && sc.slope[k] > 33) return 'Bare rock & talus';
  if (sc.kind === 'fault') return 'Grassland / bare soil';
  return 'Bare soil / grass';
}
function fusionAt(sc, k, C) {
  const t = trueDispK(sc, k, C.tCur), r = trueDispK(sc, k, C.tRef), d = [t[0] - r[0], t[1] - r[1], t[2] - r[2]];
  const gA = sc.geom.asc, gD = sc.geom.desc, gamma = cohK(sc, k, 'L', C);
  const sLos = Math.hypot(BANDS.L.lambda / (4 * Math.PI) * phaseSigma(gamma), 0.004);
  const sAz = 0.04 / Math.max(gamma, 0.2);
  const n = sc.noise, o = k * 4, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sol = wls3([
    { a: gA.los, d: dot(gA.los, d) + sLos * n[o], s: sLos }, { a: gD.los, d: dot(gD.los, d) + sLos * n[o + 1], s: sLos },
    { a: gA.along, d: dot(gA.along, d) + sAz * n[o + 2], s: sAz }, { a: gD.along, d: dot(gD.along, d) + sAz * n[o + 3], s: sAz },
  ]);
  return { truth: d, sol };
}
const Insp = { k: -1, live: false, last: 0, phi: 0, gamma: 0.5, band: 'L', tsKey: '' };
function inspectorTarget() {
  const sc = S.sc; if (!sc) return null;
  const p = S.hover || S.pin; if (!p) return null;
  return { k: sc.grid.idx(p.i, p.j), live: !!S.hover, i: p.i, j: p.j };
}
function updateInspector(force) {
  const sc = S.sc, tg = inspectorTarget(); if (!sc || !tg) return;
  const now = App.time;
  if (!force && now - Insp.last < 0.08) return;
  Insp.last = now;
  const k = tg.k, C = currentCtx(), band = bandAtInspector();
  const ig = igramK(sc, k, C, band), igL = band === 'L' ? ig : igramK(sc, k, C, 'L'), igS = band === 'S' ? ig : igramK(sc, k, C, 'S');
  Insp.phi = ig.wrapped; Insp.gamma = ig.gamma; Insp.band = band;
  $('#insp-state').textContent = tg.live ? 'LIVE · HOVER' : 'PINNED · CLICK TO MOVE';
  const deg = ig.wrapped / DEG;
  $('#ph-phi').innerHTML = `${fmtS(ig.wrapped, 2)}<small>rad · ${fmtS(deg, 0)}°</small>`;
  const dcm = (ig.phi * ig.lam / (4 * Math.PI)) * 100;
  const pd = $('#ph-disp'); pd.className = 'v ' + (dcm >= 0 ? 'up' : 'down');
  pd.innerHTML = `${fmtS(dcm * 10, 1)}<small>mm ${dcm >= 0 ? 'toward sat.' : 'away'}</small>`;
  $('#ph-coh').innerHTML = `${ig.gamma.toFixed(2)}<small>σφ ${ig.sigma.toFixed(2)} rad</small>`;
  const lamCm = (ig.lam * 100).toFixed(2);
  $('#insp-formula').innerHTML = `Δd = <b>λ</b>/4π · Δφ = ${lamCm} cm / 4π × <i>${fmt(ig.phi, 2)} rad</i> = <b>${fmtS(dcm, 2)} cm</b><br>Δφ = ${fmt(ig.phi / TAU, 2)} cycles · deformation ${fmtS(ig.los * 1000, 1)} mm + atmosphere ${fmtS(ig.atm * 1000, 1)} mm`;
  const ll = sc.grid.ij2ll(tg.i, tg.j);
  const pol = polK(sc, k, band, C), fr = pol.fr;
  const td = trueDispK(sc, k, S.t), tr = trueDispK(sc, k, C.tRef);
  const g = C.geom, fu = S.geom === 'fusion' ? fusionAt(sc, k, C) : null;
  const rows = [
    ['Location', fmtLatLon(ll.lat, ll.lon)],
    ['Elevation', `${Math.round(sc.dem[k]).toLocaleString('en')} m`],
    ['Surface', surfaceName(sc, fr, k)],
    ['LoS vector ê', `[${g.los.map((x) => x.toFixed(2)).join(', ')}]`],
    ['Geometry', `${g.kind === 'desc' ? 'DESC' : 'ASC'} · θ ${g.inc.toFixed(1)}° · hdg ${g.hdgDeg.toFixed(0)}°`],
    ['Uₑ · Uₙ · U_z (true)', `${fmtS((td[0] - tr[0]) * 1000, 1)} · ${fmtS((td[1] - tr[1]) * 1000, 1)} · ${fmtS((td[2] - tr[2]) * 1000, 1)} mm`],
  ];
  if (fu && fu.sol) rows.push(['3D fusion x̂ ± σ', `${fmtS(fu.sol.x[0] * 1000, 1)}±${fmt(fu.sol.sig[0] * 1000, 1)} · ${fmtS(fu.sol.x[1] * 1000, 0)}±${fmt(fu.sol.sig[1] * 1000, 0)} · ${fmtS(fu.sol.x[2] * 1000, 1)}±${fmt(fu.sol.sig[2] * 1000, 1)} mm`, 'l']);
  rows.push(['γ L-band / S-band', `${igL.gamma.toFixed(2)} / ${igS.gamma.toFixed(2)}`, igL.gamma > igS.gamma + 0.15 ? 'l' : '']);
  rows.push(['σ⁰ HH / HV / VV', `${fmt(dB(pol.C.C11), 1)} / ${fmt(dB(pol.C.C22), 1)} / ${fmt(dB(pol.C.C33), 1)} dB`]);
  if (fr.veg > 0.3 && sc.kind !== 'custom') {
    const hvL = dB(polK(sc, k, 'L', C).C.C22), hvS = dB(polK(sc, k, 'S', C).C.C22);
    const aL = agbFromHv('L', hvL), aS = agbFromHv('S', hvS);
    rows.push(['Biomass L / S', `${aL.saturated ? '>' : ''}${aL.agb.toFixed(0)} / ${aS.saturated ? '>' : ''}${aS.agb.toFixed(0)} t/ha`, aS.saturated && !aL.saturated ? 'warn' : '']);
  }
  if (fr.flooded || (sc.hasWater && floodedK(sc, k, C.pulseC, C.calveC))) {
    const wse = wseK(sc, k, C.pulseC), wseR = wseK(sc, k, C.pulseR);
    rows.push(['Water depth', `${fmt(wse - groundK(sc, k, C.calveC), 2)} m · level Δ ${fmtS((wse - wseR) * 100, 0)} cm`, 's']);
  }
  const dl = $('#insp-rows'); dl.innerHTML = '';
  for (const [a, b, cls] of rows) dl.append(h('dt', {}, a), h('dd', { class: cls || '' }, b));
  // Freeman–Durden bars
  const fd = pol.fd;
  $('#fd-band').textContent = band;
  for (const [id, v] of [['pd', fd.fd], ['pv', fd.fvol], ['ps', fd.fs]]) { $('#fd-' + id).style.width = (v * 100).toFixed(0) + '%'; $('#fd-' + id + 'v').textContent = (v * 100).toFixed(0) + '%'; }
  const dom = fd.fd >= fd.fvol && fd.fd >= fd.fs ? 'd' : fd.fvol >= fd.fs ? 'v' : 's';
  $('#fd-mech').innerHTML = dom === 'd' ? '<b>Double bounce.</b> Water or ground and a vertical trunk or wall form a dihedral corner reflector (HH ≫ VV, phase ≈ 180°).'
    : dom === 'v' ? '<b>Volume scattering.</b> Randomly oriented leaves and branches depolarise the wave, so cross-pol HV is strong.'
      : '<b>Surface scattering.</b> A single Bragg bounce from soil, ice or water (VV ≥ HH, in phase).';
  // time series (cheap: 29 epochs)
  const key = `${S.siteId}|${k}|${S.geom}|${band}|${S.layers.aps}|${sc.rupture ? sc.rupture.tq : ''}`;
  if (key !== Insp.tsKey || force) {
    Insp.tsKey = key;
    const line = [], dots = [];
    const gO = sc.geom[S.geom === 'desc' ? 'desc' : 'asc'];
    for (let e = 0; e < CFG.nEpochs; e++) {
      const t = e * CFG.repeatDays;
      const Ce = timeCtx(sc, { tRef: 0, tCur: t, X: 1, geomObj: gO, bandEff: band, aps: S.layers.aps });
      const v = losK(sc, k, Ce) * 1000;
      line.push([t, v]);
      const ige = igramK(sc, k, Ce, band);
      dots.push([t, v + ige.atm * 1000 + ige.sigma * noiseK(sc, k, Ce) * ige.lam / (4 * Math.PI) * 1000]);
    }
    Insp.series = [{ kind: 'line', pts: line, color: GOLD, fill: 'rgba(255,182,72,0.25)' }, { kind: 'dots', pts: dots, color: 'rgba(62,230,255,0.85)' }];
  }
  drawTimeSeries($('#tschart'), Insp.series, S.t, sc.events, 'mm');
}

// ───────────── HTML labels projected from 3D ─────────────
const Labels = {
  items: [], box: null,
  init() { this.box = $('#labels'); },
  add(text, posFn, cls = 'feat', onClick = null) {
    const el = h('div', { class: 'lbl ' + cls }, h('span', { class: 'tag' }, text));
    if (onClick) el.addEventListener('click', onClick);
    this.box.append(el);
    const it = { el, posFn, cls, w: 0, h: 0 };
    this.items.push(it);
    return it;
  },
  remove(it) { it.el.remove(); this.items = this.items.filter((x) => x !== it); },
  clearAll() { for (const it of this.items) it.el.remove(); this.items = []; },
  update(camera) {
    const w = window.innerWidth, hh = window.innerHeight;
    const split = S.split && S.view === 'terrain';
    const v = new THREE.Vector3();
    for (const it of this.items) {
      const p = it.posFn(); if (!p) { it.el.style.opacity = 0; it.show = false; continue; }
      v.copy(p).project(camera);
      let x = (v.x * 0.5 + 0.5), y = (-v.y * 0.5 + 0.5);
      if (split) { if (App.narrow) { y = y * 0.5 + 0.5; } else { x = 0.5 + x * 0.5; } }
      const vis = v.z < 1 && v.z > -1 && x > -0.05 && x < 1.05 && y > -0.05 && y < 1.05 && (S.layers.labels || it.cls.includes('alertlbl') || it.cls.includes('site'));
      const occl = it.occl ? it.occl() : false;
      it.show = vis && !occl && !it.el.classList.contains('dim'); it.sx = x * w; it.sy = y * hh; it.depth = v.z;
    }
    // greedy de-cluttering: nearer labels keep their place, others slide up until they no longer overlap
    const shown = this.items.filter((it) => it.show).sort((a, b) => a.depth - b.depth);
    const placed = [];
    for (const it of shown) {
      if (!it.w) { it.w = it.el.offsetWidth || 120; it.h = it.el.offsetHeight || 20; }
      let y = it.sy;
      for (let pass = 0; pass < 6; pass++) {
        const hit = placed.find((p) => Math.abs(p.x - it.sx) < (p.w + it.w) / 2 + 4 && Math.abs(p.y - y) < (p.h + it.h) / 2 + 2);
        if (!hit) break;
        y = hit.y - (hit.h + it.h) / 2 - 3;
      }
      placed.push({ x: it.sx, y, w: it.w, h: it.h });
      it.el.style.opacity = 1;
      it.el.style.transform = `translate(${it.sx.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -130%)`;
    }
    for (const it of this.items) if (!it.show) it.el.style.opacity = 0;
  },
};
function surfacePoint(i, j, lift = 0.6) {
  return () => { if (!S.sc || !App.world.sc) return null; const p = S.sc.grid.ij2xz(i, j); return V3(p.x, App.world.surfaceY(i, j, App.lastC) + lift, p.z); };
}
function buildSiteLabels() {
  Labels.clearAll();
  const sc = S.sc;
  for (const L of sc.labels) Labels.add(L.name, surfacePoint(L.i, L.j, L.kind === 'peak' ? 1.4 : 0.8), 'feat');
  const satLbl = Labels.add('NISAR · click for close-up', () => (!S.satCam && App.world.sats[S.geom === 'desc' ? 1 : 0].model.visible ? App.world.sats[S.geom === 'desc' ? 1 : 0].model.position.clone().add(V3(0, 9, 0)) : null), 'sat click', () => { Sound.click(); enterSatCam(); });
  void satLbl;
  if (sc.kind === 'volcano') Labels.add('Mogi source · 6.0 km deep', () => (App.world.chamber && App.world.chamber.visible ? App.world.chamber.position.clone().add(V3(0, 3.4, 0)) : null), 'sat');
  if (sc.kind === 'fault') Labels.add('Locked to 15 km (depth not to scale)', () => (App.world.faultPlane && App.world.faultPlane.visible ? App.world.faultPlane.position.clone().add(V3(0, -8, 0)) : null), 'sat');
  Labels.add('L-BAND INSIDE · S-BAND OUTSIDE', () => (S.band === 'X' && App.world.lens.visible ? App.world.lens.position.clone().add(V3(0, 8.4, 0)) : null), 'sat');
}
function buildGlobeLabels() {
  for (const id of SITE_ORDER) {
    const s = SITES[id];
    const it = Labels.add('', () => App.globe.siteWorld(id).clone().multiplyScalar(1.12), 'site', () => { Sound.click(); enterSite(id, { fromGlobe: true }); });
    it.el.querySelector('.tag').innerHTML = `${s.name}<small>${WALTZES[s.waltz].n}</small>`;
    it.occl = () => { const p = App.globe.siteWorld(id); return p.clone().normalize().dot(App.camera.position.clone().normalize()) < 0.18; };
  }
}
const ccdLabels = [];
function clearCCDLabels() { while (ccdLabels.length) Labels.remove(ccdLabels.pop()); }
function buildCCDLabels(res) {
  clearCCDLabels();
  res.comps.slice(0, 5).forEach((c) => {
    const it = Labels.add('', surfacePoint(c.ci, c.cj, 2.4), 'alertlbl');
    it.el.querySelector('.tag').innerHTML = `<b>⚠ ${c.label.toUpperCase()}</b><span>${fmtArea(c.areaKm2)} km² · Δγ ${c.meanDG.toFixed(2)}${c.isEvent && res.evV > 0 && c === res.comps.find((q) => q.isEvent) ? ' · ' + fmtVol(res.evV) : ''}</span>`;
    ccdLabels.push(it);
  });
}

// ───────────── mission deck ─────────────
function renderDeck(container, compact) {
  container.innerHTML = '';
  WALTZES.forEach((w) => {
    const thumb = h('div', { class: 'thumb' });
    const cv = h('canvas', { width: 256, height: compact ? 112 : 160 });
    if (App.thumbs && App.thumbs[w.sites[0]]) cv.getContext('2d').drawImage(App.thumbs[w.sites[0]], 0, 0, cv.width, cv.height);
    thumb.append(cv, h('div', { class: 'num' }, w.n));
    const sites = h('div', { class: 'sites' });
    for (const id of w.sites) {
      const s = SITES[id];
      sites.append(h('button', { class: 'site-btn' + (s.home ? ' home' : ''), onclick: () => { Sound.click(); enterSite(id, { fromGlobe: S.view !== 'terrain' }); } }, h('span', {}, s.name, h('small', {}, s.tag))));
    }
    container.append(h('article', { class: 'waltz' }, thumb, h('div', { class: 'body' }, h('h3', {}, w.title), h('p', {}, w.blurb), sites)));
  });
}
function makeThumbs() {
  App.thumbs = {};
  for (const id of SITE_ORDER) {
    const sc = App.scenes[id];
    const fault = sc.rupture;
    if (fault) { fault.tq = 100; fault.front = -1e9; }
    const tCur = sc.kind === 'wetland' ? 132 : sc.kind === 'fault' ? 120 : CFG.tMax;
    const tRef = sc.kind === 'wetland' ? 120 : sc.kind === 'fault' ? 84 : 0;
    const C = timeCtx(sc, { tRef, tCur, X: 1, geomObj: sc.geom.asc, bandEff: 'L', aps: true });
    C.defoRange = 0.1;
    const img = renderRadarImage(sc, C, sc.kind === 'glacier' ? 'coh' : 'phase', sc.kind === 'fault' ? 'S' : 'L', 160);
    if (fault) { fault.tq = Infinity; fault.front = 1e9; }
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 160;
    cv.getContext('2d').putImageData(img, 0, 0);
    const out = document.createElement('canvas'); out.width = 256; out.height = 160;
    const g = out.getContext('2d'); g.drawImage(cv, 0, 30, 160, 100, 0, 0, 256, 160);
    App.thumbs[id] = out;
  }
}

// ───────────── input ─────────────
const ptr = { down: null, ndc: new THREE.Vector2(), ray: new THREE.Raycaster(), lastMove: 0 };
function pointerToView(ev) {
  const w = window.innerWidth, hh = window.innerHeight;
  const split = S.split && S.view === 'terrain';
  let x = ev.clientX / w, y = ev.clientY / hh, view = '3d';
  if (split) {
    if (App.narrow) { if (y < 0.5) { view = '2d'; y = y * 2; } else y = (y - 0.5) * 2; }
    else { const s0 = App.splitInset || 0; if (x < 0.5) { view = '2d'; x = (x - s0) / (0.5 - s0); } else x = (x - 0.5) * 2; }
  }
  return { view, nx: x * 2 - 1, ny: -(y * 2 - 1) };
}
function pickAt(ev) {
  if (S.view !== 'terrain' || !S.sc) return null;
  const pv = pointerToView(ev), sc = S.sc;
  if (pv.view === '2d') {
    const o = App.ortho;
    const x = lerp(o.left, o.right, (pv.nx + 1) / 2), z = -lerp(o.bottom, o.top, (pv.ny + 1) / 2);
    if (Math.abs(x) > CFG.W / 2 || Math.abs(z) > CFG.W / 2) return null;
    const g = sc.grid.xz2ij(x, z);
    return { x, z, y: 0, i: g.i, j: g.j, view: '2d' };
  }
  ptr.ndc.set(pv.nx, pv.ny);
  ptr.ray.setFromCamera(ptr.ndc, App.camera);
  const hit = App.world.pick(ptr.ray.ray, App.lastC);
  if (hit) hit.view = '3d';
  return hit;
}
function onPointerMove(ev) {
  if (S.view !== 'terrain') return;
  const now = performance.now();
  if (now - ptr.lastMove < 24 && !(S.tool === 'slice' && S.slice && !S.slice.done)) return;
  ptr.lastMove = now;
  const hit = pickAt(ev);
  const tip = $('#cursor-tip');
  if (S.tool === 'slice' && S.slice && !S.slice.done && hit) { S.slice.b = hit; App.world.U.uSlice.value.set(S.slice.a.x, S.slice.a.z, hit.x, hit.z); App.world.U.uSliceOn.value = 1; }
  if (hit && !ptr.down) {
    S.hover = { i: hit.i, j: hit.j, x: hit.x, z: hit.z };
    if (S.band === 'X') { S.lens.x = hit.x; S.lens.z = hit.z; }
    const ll = S.sc.grid.ij2ll(hit.i, hit.j);
    const k = S.sc.grid.idx(hit.i, hit.j);
    tip.style.display = 'block'; tip.style.left = ev.clientX + 'px'; tip.style.top = ev.clientY + 'px';
    tip.innerHTML = `${fmtLatLon(ll.lat, ll.lon)} · <b>${Math.round(S.sc.dem[k])} m</b>`;
    App.world.U.uHover.value.set(hit.x, hit.z, 0.55, hit.view === '3d' ? 1 : 0);
    const xh = $('#split-xhair');
    if (S.split) { const o = App.ortho, fx = (hit.x - o.left) / (o.right - o.left), fz = (-hit.z - o.bottom) / (o.top - o.bottom), s0 = App.splitInset || 0; xh.style.display = 'block'; xh.style.left = (App.narrow ? fx * 100 : (s0 + fx * (0.5 - s0)) * 100) + 'vw'; xh.style.top = (App.narrow ? (1 - fz) * 50 : (1 - fz) * 100) + 'vh'; }
  } else if (!hit) {
    S.hover = null; tip.style.display = 'none'; App.world.U.uHover.value.w = 0; $('#split-xhair').style.display = 'none';
  }
}
function onPointerDown(ev) {
  if (S.view !== 'terrain') return;
  ptr.down = { x: ev.clientX, y: ev.clientY, b: ev.button };
  const pv = pointerToView(ev);
  if (pv.view === '2d') App.controls.enabled = false;
  if (S.tool === 'slice' && ev.button === 0) {
    const hit = pickAt(ev);
    if (hit) { App.controls.enabled = false; S.slice = { a: hit, b: null, done: false }; App.world.buildCurtain(null); Sound.mark(); }
  }
}
function onPointerUp(ev) {
  const d = ptr.down; ptr.down = null;
  if (S.view !== 'terrain') return;
  if (S.tool === 'slice' && S.slice && !S.slice.done) {
    const hit = pickAt(ev) || S.slice.b;
    if (hit && Math.hypot(hit.x - S.slice.a.x, hit.z - S.slice.a.z) > 2) { S.slice.b = hit; S.slice.done = true; computeProfile(); Sound.ping(); }
    else { S.slice = null; App.world.U.uSliceOn.value = 0; }
  } else if (d && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 5 && d.b === 0) {
    const hit = pickAt(ev);
    if (hit) { S.pin = { i: hit.i, j: hit.j }; Sound.mark(); updateInspector(true); }
  }
  if (!S.busy) App.controls.enabled = true;
}

// ───────────── UI wiring ─────────────
function initUI() {
  Labels.init();
  const canvas = $('#gl');
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', () => { S.hover = null; $('#cursor-tip').style.display = 'none'; if (App.world) App.world.U.uHover.value.w = 0; });
  window.addEventListener('resize', onResize);
  const seg = (id, fn) => $$(`#${id} button`).forEach((b) => b.addEventListener('click', () => { Sound.click(); fn(b.dataset.v); syncControls(); updateInspector(true); }));
  seg('seg-band', (v) => { S.band = v; markStale(); if (v === 'X' && !S.layers.canopy) S.layers.canopy = true; });
  seg('seg-mode', (v) => { S.mode = v; });
  seg('seg-geom', (v) => { S.geom = v; markStale(); if (v === 'fusion') toast('3D fusion: ascending + descending LoS + azimuth offsets → (Uₑ, Uₙ, U_z) by weighted least squares. Colours now show vertical motion.'); });
  seg('seg-pair', (v) => { S.pair = v; markStale(); });
  seg('tl-speed', (v) => { S.speed = parseFloat(v); });
  $('#exag').addEventListener('input', (e) => { setExag(exagFromSlider(+e.target.value)); markStale(); syncControls(); });
  const chip = (id, key, fn) => $('#' + id).addEventListener('click', () => { S.layers[key] = !S.layers[key]; Sound.click(); if (fn) fn(); syncControls(); updateInspector(true); });
  chip('tg-mask', 'mask'); chip('tg-aps', 'aps', markStale); chip('tg-vectors', 'vectors'); chip('tg-canopy', 'canopy'); chip('tg-beam', 'beam'); chip('tg-subsurface', 'subsurface'); chip('tg-cycle', 'cycle'); chip('tg-labels', 'labels');
  $('#act-unwrap').addEventListener('click', () => { Sound.click(); startUnwrap(); });
  $('#act-ccd').addEventListener('click', () => { Sound.click(); startCCD(); });
  $('#act-slice').addEventListener('click', () => {
    Sound.click();
    if (S.tool === 'slice') { S.tool = null; S.slice = null; S.profile = null; $('#profile').hidden = true; document.body.classList.remove('profile-open'); App.world.buildCurtain(null); App.world.U.uSliceOn.value = 0; }
    else { S.tool = 'slice'; toast('Cross-section: press and drag across the terrain.'); }
    syncControls();
  });
  $('#profile-close').addEventListener('click', () => { S.tool = null; S.slice = null; S.profile = null; $('#profile').hidden = true; document.body.classList.remove('profile-open'); App.world.buildCurtain(null); App.world.U.uSliceOn.value = 0; syncControls(); });
  const toggleSplit = () => { S.split = !S.split; Sound.click(); updateCameraAspect(); syncControls(); };
  $('#act-split').addEventListener('click', toggleSplit);
  $('#minimap').addEventListener('click', () => { if (!S.split) toggleSplit(); });
  $('#act-load').addEventListener('click', () => $('#file-in').click());
  $('#file-in').addEventListener('change', (e) => { if (e.target.files.length) loadPack(e.target.files); e.target.value = ''; });
  let dragN = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragN++; $('#drop').classList.add('on'); } });
  window.addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#drop').classList.remove('on'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('#drop').classList.remove('on'); if (e.dataTransfer.files.length) loadPack(e.dataTransfer.files); });
  $('#tl-play').addEventListener('click', () => { S.playing = !S.playing; Sound.click(); syncControls(); });
  // timeline scrubbing
  const track = $('#tl-track');
  const scrub = (ev) => { const r = track.getBoundingClientRect(); const f = clamp((ev.clientX - r.left - 8) / (r.width - 16), 0, 1); let t = f * CFG.tMax; const k = Math.round(t / CFG.repeatDays); if (Math.abs(k * CFG.repeatDays - t) < 2.2) t = k * CFG.repeatDays; setTime(t, { stopPlay: true }); syncControls(); };
  track.addEventListener('pointerdown', (ev) => { track.setPointerCapture(ev.pointerId); scrub(ev); track._drag = true; });
  track.addEventListener('pointermove', (ev) => { if (track._drag) scrub(ev); });
  track.addEventListener('pointerup', () => { track._drag = false; Sound.tick(); });
  // top bar
  $('#btn-deck').addEventListener('click', () => { renderDeck($('#deck-grid'), false); openOverlay('deck'); });
  $('#btn-globe').addEventListener('click', () => { Sound.click(); toGlobe(); });
  $('#btn-codex').addEventListener('click', () => openOverlay('codex'));
  $('#hero-codex').addEventListener('click', () => openOverlay('codex'));
  $('#btn-tour').addEventListener('click', () => Tour.start());
  $('#hero-tour').addEventListener('click', () => Tour.start());
  $('#btn-sound').addEventListener('click', () => { const on = Sound.setOn(!Sound.on); $('#btn-sound').setAttribute('aria-pressed', String(on)); if (on) Sound.powerUp(); });
  $('#btn-satcam').addEventListener('click', () => { Sound.click(); S.satCam ? exitSatCam() : enterSatCam(); });
  $('#satcam-deploy').addEventListener('click', () => { Sound.click(); replayDeploy(); });
  $('#satcam-exit').addEventListener('click', () => { Sound.click(); exitSatCam(); });
  $('#btn-full').addEventListener('click', () => {
    const fail = () => toast('Fullscreen is not available here.');
    try { const p = !document.fullscreenElement ? document.documentElement.requestFullscreen() : document.exitFullscreen(); if (p && p.catch) p.catch(fail); } catch (e) { fail(); }
  });
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeOverlay(b.dataset.close)));
  $$('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) o.classList.remove('open'); }));
  $('#mtab-left').addEventListener('click', () => { document.body.classList.toggle('panel-left'); document.body.classList.remove('panel-right'); });
  $('#mtab-right').addEventListener('click', () => { document.body.classList.toggle('panel-right'); document.body.classList.remove('panel-left'); });
  $$('button').forEach((b) => b.addEventListener('pointerenter', () => Sound.tick()));
  window.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', () => { if (App.ignoreHash) { App.ignoreHash = false; return; } const id = location.hash.slice(1); if (SITES[id] && App.scenes[id] && id !== S.siteId && S.view !== 'boot') enterSite(id, { fromGlobe: S.view === 'globe' }); });
  Bus.on('kpi', () => renderKPIs());
  initExport();
  initReal();
}
function onKey(e) {
  if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;      // leave browser shortcuts (Ctrl+C, Ctrl+D ...) alone
  const k = e.key;
  if (k === 'Escape') { if (Tour.active) Tour.stop(); closeOverlay('deck'); closeOverlay('codex'); closeOverlay('export'); if (S.satCam) { exitSatCam(); return; } if (S.tool) { $('#act-slice').click(); } return; }
  if (Tour.active) { if (k === 'ArrowRight') Tour.next(); return; }
  const terr = S.view === 'terrain';
  const map = { 1: 'phase', 2: 'defo', 3: 'pol', 4: 'coh' };
  if (terr && map[k]) { S.mode = map[k]; syncControls(); updateInspector(true); return; }
  const low = k.toLowerCase();
  if (terr && (low === 'l' || low === 's' || low === 'x')) { S.band = low.toUpperCase(); markStale(); syncControls(); updateInspector(true); return; }
  if (terr && k === ' ') { e.preventDefault(); S.playing = !S.playing; syncControls(); return; }
  if (terr && (k === 'ArrowRight' || k === 'ArrowLeft')) { e.preventDefault(); const kk = epochOf(S.t) + (k === 'ArrowRight' ? 1 : -1); setTime(kk * CFG.repeatDays, { stopPlay: true }); syncControls(); return; }
  if (terr && low === 'u') return startUnwrap();
  if (terr && low === 'd') return startCCD();
  if (terr && low === 'p') return $('#act-slice').click();
  if (terr && low === 'v') return $('#act-split').click();
  if (terr && low === 'o') { S.geom = { asc: 'desc', desc: 'fusion', fusion: 'asc' }[S.geom]; markStale(); syncControls(); updateInspector(true); return; }
  if (low === 'g' && terr) return toGlobe();
  if (low === 'm') return $('#btn-deck').click();
  if (low === 'h' || k === '?') return openOverlay('codex');
  if (low === 't') return Tour.start();
  if (low === 'f') return $('#btn-full').click();
  if (low === 'n' && terr) return S.satCam ? exitSatCam() : enterSatCam();
  if (low === 'e' && terr) return openExport();
  if (low === 'r' && terr) return realShow(!Real.on);
}

// ───────────── main loop ─────────────
let lastNow = 0, slowT = 0, kpiT = 0, miniT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
  App.time += dt; App.dt = dt;
  Sound.update();
  const time = App.time;
  Tweens.update(dt);
  App.post.uniforms.uTime.value = time;
  if (S.view !== 'terrain') {
    App.globe.update(dt, time);
    if (App.gcontrols.enabled) App.gcontrols.update();
    slowT += dt;
    if (slowT > 0.25) { slowT = 0; const t = App.globe.telemetry(); $('#tele-ll').textContent = fmtLatLon(t.lat, t.lon); $('#tele-pass').textContent = t.asc ? 'ASCENDING (dusk side)' : 'DESCENDING (dawn side)'; $('#tele-orbit').textContent = '#' + (t.orbit + 1); $('#tele-cov').textContent = (t.cov * 100).toFixed(1) + ' %'; $('#tele-covbar').style.width = (t.cov * 100).toFixed(1) + '%'; }
  } else if (S.sc) {
    if (S.playing && !S.busy && !(S.ccd && S.ccd.running)) {
      let t = S.t + dt * 12 * S.speed;
      if (t > CFG.tMax) t = 0;
      setTime(t);
    }
    // satellite pass & acquisition sweep
    if (S.acquiring && !S.satCam) { S.satS += dt * 34; App.world.U.uAcq.value = S.satS + 4; if (S.satS > 78) { S.acquiring = false; App.world.U.uAcq.value = 1e4; S.satS = -82; Sound.ping(); } }
    else if (!S.satCam) { S.satS += dt * 4.5; if (S.satS > 82) S.satS = -82; }
    S.beamOpacity = smoothstep(84, 62, Math.abs(S.satS));
    const C = currentCtx();
    App.lastC = C;
    App.world.update(S, C, time, dt);
    // close-up camera follows the spacecraft (e.g. after switching ascending ↔ descending)
    if (S.satCam && !S.busy) {
      const b = activeSat().model.position;
      if (App.satFollow) { const d = b.clone().sub(App.satFollow); if (d.lengthSq() > 1e-8) { App.camera.position.add(d); App.controls.target.add(d); } App.satFollow.copy(b); }
      else App.satFollow = b.clone();
    } else App.satFollow = null;
    pumpUnwrap(); pumpCCD();
    if (App.gcontrols.enabled) App.gcontrols.enabled = false;
    if (App.controls.enabled) App.controls.update();
    updateInspector(false);
    if (S.view === 'terrain') Phasor.draw($('#phasor'), Insp.phi, Insp.gamma, Insp.band, time);
    kpiT += dt; if (kpiT > 0.3) { kpiT = 0; computeDefoScale(false); renderKPIs(); if (Real.on) realProbe(); if (S.mode === 'defo') updateLegend(); drawTimeline($('#tl-canvas'), S, S.sc); const d = dateAt(S.t); $('#tl-date-main').textContent = fmtDate(d); $('#tl-date-sub').textContent = `${epochName(epochOf(S.t))} · ${S.pair === 'seq' ? '12-day pair' : 'since ' + fmtDate(dateAt(0))}`; if (S.profile && S.slice && S.slice.done && App.profileT !== S.t) { App.profileT = S.t; computeProfile(); } }
    miniT += dt; if (miniT > 0.6) { miniT = 0; drawMini(C); }
  }
  // camera shake (rupture)
  let shakeOff = null;
  if (S.shake > 0.001 && S.view === 'terrain') { shakeOff = V3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(S.shake * 1.4); App.camera.position.add(shakeOff); S.shake *= Math.pow(0.08, dt); }
  if (S.view === 'terrain' && App.world.sky) App.world.sky.position.copy(App.camera.position);
  Labels.update(App.camera);
  App.composer.render();
  if (shakeOff) App.camera.position.sub(shakeOff);
  // fps & adaptive resolution
  App.frames++; App.fpsT += dt;
  if (App.fpsT > 1) {
    const fps = App.frames / App.fpsT; $('#fps').textContent = fps.toFixed(0) + ' FPS';
    if (fps < 34 && App.renderer.getPixelRatio() > 0.8) { App.renderer.setPixelRatio(Math.max(0.8, App.renderer.getPixelRatio() - 0.2)); onResize(); }
    else if (fps > 57 && App.renderer.getPixelRatio() < App.dprCap - 0.01) { App.renderer.setPixelRatio(Math.min(App.dprCap, App.renderer.getPixelRatio() + 0.1)); onResize(); }
    App.frames = 0; App.fpsT = 0;
    const d = new Date(); $('#utc').textContent = 'UTC ' + d.toISOString().slice(11, 19);
  }
}
function drawMini(C) {
  const cv = $('#mini2d'); if (!cv || cv.offsetParent === null) return;
  const band = S.band === 'S' ? 'S' : 'L';
  const img = renderRadarImage(S.sc, C, S.mode, band, 64);
  const tmp = App._miniTmp || (App._miniTmp = document.createElement('canvas')); tmp.width = 64; tmp.height = 64;
  tmp.getContext('2d').putImageData(img, 0, 0);
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(tmp, 0, 0, cv.width, cv.height);
}
