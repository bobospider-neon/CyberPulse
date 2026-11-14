// ───────────────────────── 14b · DATA DOWNLINK (Excel workbook + CSV pack) ─────────────────────────
// One click packages every number behind the current view: scene metadata, the inspected pixel, its 29-pass time
// series, 48 × 48 maps of LoS displacement, wrapped phase and coherence, radar images and KPIs, plus the CCD alerts,
// the unwrapping report and the cross-section when those tools were run. Every dataset carries a plain-language
// explanation. The workbook is written with ExcelJS (loaded on first use from jsDelivr); the CSV pack is a ZIP built
// here (deflate-raw through CompressionStream when available, stored otherwise, CRC-32 checked).
const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const Export = { busy: false, libP: null, dlP: null, fmt: 'xlsx' };

// ── saving: browser download via anchor ──
function anchorSave(filename, blob) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function saveFile(filename, blob) {
  try { anchorSave(filename, blob); return { ok: true, how: 'browser' }; }
  catch (e) { return { ok: false, code: 'unavailable', msg: 'Saving files is not available in this view.' }; }
}
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!Export.libP) {
    Export.libP = new Promise((res, rej) => {
      const s = document.createElement('script');
      const to = setTimeout(() => rej(new Error('timed out loading the Excel engine')), 30000);
      s.src = EXCELJS_URL; s.async = true;
      s.onload = () => { clearTimeout(to); if (window.ExcelJS) res(window.ExcelJS); else rej(new Error('the Excel engine did not initialise')); };
      s.onerror = () => { clearTimeout(to); rej(new Error('could not reach cdn.jsdelivr.net')); };
      document.head.append(s);
    });
    Export.libP.catch(() => { Export.libP = null; });
  }
  return Export.libP;
}
function fmtBytes(n) { return n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(0) + ' KB' : n + ' B'; }

// ───────────── data collection (every value comes from the same CPU mirror the HUD uses) ─────────────
const MODE_NAMES = { phase: 'Interferogram (wrapped phase)', defo: 'LoS deformation', pol: 'Freeman–Durden polarimetry', coh: 'Coherence' };
const KIND_NAMES = {
  volcano: 'Volcano · magma recharge (Mogi point source)', fault: 'Strike-slip fault · interseismic loading and rupture',
  glacier: 'Outlet glacier · fast ice flow and calving', wetland: 'Wetland · seasonal flood pulse under vegetation',
  urban: 'Megacity · subsidence from groundwater pumping', custom: 'Real interferogram (CSAR-PACK)',
};
const KPI_HELP = {
  'ΔV injected': 'Volume of magma added to the chamber since the first pass, in millions of m³. It drives the uplift through the Mogi point-source model.',
  'Recharge rate': 'Current magma supply rate. It accelerates during the drill scenario, and that acceleration is what an alert would be based on.',
  'Summit uplift': 'Vertical ground displacement above the magma source since the first pass.',
  'Uplift rate': 'Present vertical velocity above the source.',
  'Fringes L / S': 'Interferometric fringes the summit uplift produces in L- and S-band (one fringe = λ/2 of LoS motion). S-band shows 2.5 times more fringes for the same motion.',
  'Drill alert level': 'Simulated observatory alert level from the uplift rate: below 3 cm/yr NORMAL, below 15 cm/yr ADVISORY, otherwise WATCH.',
  'Debris flow': 'Debris-flow (lahar) event of the scenario: mapped area and deposit volume once it has occurred, otherwise its scheduled day.',
  'Slip rate': 'Long-term slip rate of the fault.',
  'Locking depth': 'Depth above which the fault is stuck between earthquakes; below it the fault creeps freely.',
  'Slip deficit': 'Slip accumulated on the locked fault since the last great earthquake (1857) and not released yet.',
  'Equivalent Mw': 'Moment magnitude if the whole slip deficit were released now: Mw = 2/3 · (log10 M0 − 9.1).',
  'Moment M₀': 'Seismic moment M0 = μ · A · D: rigidity × locked fault area × slip deficit, in newton-metres.',
  'Stress drop Δσ': 'Static stress drop of such a rupture: Δσ ≈ (2/π) · μ · slip / locking depth.',
  'Fault state': 'LOCKED (storing strain), RUPTURING (the rupture front is propagating) or RUPTURED (slip released).',
  'Front speed': 'Ice speed at the calving front. It varies with the seasons.',
  '12-day offset': 'Ice displacement between two passes 12 days apart: hundreds of metres, far more than one fringe.',
  'Discharge (5 km gate)': 'Ice volume flowing per year through a flux gate 5 km wide and 900 m thick.',
  'Peak thinning': 'Fastest lowering of the glacier surface (dynamic thinning), in metres per year.',
  'Fringes per 12 d (L)': 'Fringes the 12-day ice motion would produce in L-band. Far too many to resolve: the phase aliases, so NISAR measures fast ice by speckle (offset) tracking instead.',
  'Calving': 'Calving event: area of the ice front lost and its ice volume (area × 900 m of ice).',
  'Water level (upstream)': 'Water-surface elevation at the upstream end of the basin at this date (seasonal flood pulse).',
  'Open water': 'Area of open water: river channels, lakes and flooded bare ground.',
  'Flooded under canopy': 'Area where water stands beneath trees or reeds. Optical satellites cannot see it; L-band double bounce reveals it.',
  'Mean forest AGB': 'Mean above-ground biomass of tall forest, in tonnes of dry matter per hectare.',
  'Coherent L-band': 'Flooded-forest area where the L-band interferogram stays usable (γ > 0.4), so the water-level change can be measured.',
  'Coherent S-band': 'The same for S-band. It is much smaller, because the shorter wave is scattered by the canopy.',
  'Max sinking rate': 'Fastest subsidence rate in the city, caused by groundwater pumping and compaction of the old lake clays.',
  'Area > 10 cm/yr': 'Area of the city sinking faster than 10 cm per year.',
  'Sinking since E00': 'Cumulative subsidence at the fastest point since the first pass.',
  'Blocks β₁₀ > 1/500': 'City blocks whose 10-year angular distortion β exceeds 1/500, the usual threshold for structural damage.',
  'Fissure damage': 'Ground-fissure event of the scenario: damaged area and number of affected blocks.',
  'Unwrap RMS error': 'Root-mean-square difference between the unwrapped phase and the true phase, in radians and millimetres.',
  'CCD · changed area': 'Total area flagged by coherence change detection and the number of change polygons.',
  'Max |LoS| in pair': 'Largest absolute line-of-sight displacement in the loaded interferogram.',
  'Wavelength': 'Radar wavelength of the loaded product.',
};
const GLOSSARY = [
  ['SAR', 'Synthetic Aperture Radar: an active microwave imager that synthesises a long antenna from the motion of the satellite. It works day and night and through clouds.', 'NISAR resolution: 3–10 m'],
  ['NISAR', 'NASA–ISRO Synthetic Aperture Radar, launched on 30 July 2025. An L-band radar (NASA/JPL) and an S-band radar (ISRO) share a 12 m reflector and map nearly all land and ice every 12 days.', '747 km orbit · 98.4° · 242 km swath'],
  ['InSAR', 'Interferometric SAR: comparing the phase of two radar images of the same place, taken from almost the same orbit at different times, to measure ground motion.', ''],
  ['Interferogram', 'Image of the phase difference between two SAR acquisitions. Its colour cycles (fringes) are contour lines of line-of-sight motion.', 'Δφ = φ(t2) − φ(t1)'],
  ['Fringe', 'One full colour cycle of an interferogram, from −π to +π.', 'one fringe = λ/2: L 11.9 cm, S 4.7 cm'],
  ['Line of sight (LoS)', 'Direction from the ground to the satellite. InSAR measures only the component of motion along it.', 'd_LoS = U · ê'],
  ['Wrapped phase', 'Phase known only modulo 2π, between −π and +π. This is what an interferogram contains.', 'φw = φ − 2π · round(φ / 2π)'],
  ['Phase unwrapping', 'Recovering the continuous phase by adding the right multiple of 2π to each pixel, starting from a reference pixel.', 'here: quality-guided flood fill'],
  ['Coherence γ', 'Normalised correlation of two SAR images, from 0 to 1: the quality of the interferometric phase.', 'γ = |⟨s1 · s2*⟩| / √(⟨|s1|²⟩ · ⟨|s2|²⟩)'],
  ['Decorrelation', 'Loss of coherence when the scatterers change between passes: vegetation growth, wind, water, snow, construction, landslides or fast motion.', ''],
  ['Atmospheric delay', 'Extra delay from water vapour in the troposphere. Correlated in space and random from pass to pass, so it averages out in a time series.', 'typically 5–30 mm'],
  ['SBAS time series', 'Small BAseline Subset: many short-interval interferograms combined into a displacement time series.', 'pairs of 12–24 days here'],
  ['SLC', 'Single Look Complex image: the full-resolution radar image, with amplitude and phase.', ''],
  ['CCD', 'Coherence Change Detection: mapping where coherence drops between a pre-event pair and a co-event pair.', 'flag: Δγ > 0.35 or |ΔI| > 4.5 dB'],
  ['Polarimetry', 'Using the polarisation of the transmitted and received waves (HH, HV, VV) to identify how the wave scattered.', ''],
  ['σ⁰ (sigma nought)', 'Normalised radar backscatter, in decibels.', 'water ≈ −25 dB · forest ≈ −10 dB · city ≈ 0 dB'],
  ['Freeman–Durden', 'Decomposition of the polarimetric covariance into surface, double-bounce and volume scattering powers.', 'span = Ps + Pd + Pv'],
  ['Double bounce', 'Two mirror-like reflections (water or ground → trunk or wall → radar). Strong in flooded forests and cities.', 'HH ≫ VV, phase ≈ 180°'],
  ['Volume scattering', 'Multiple scattering inside a canopy of leaves and branches. It produces the cross-polarised (HV) power.', ''],
  ['Biomass (AGB)', 'Above-ground biomass in tonnes per hectare, estimated from HV backscatter until the signal saturates.', 'saturation: S ≈ 92 t/ha, L ≈ 253 t/ha'],
  ['Mogi source', 'Point pressure source in an elastic half-space: the classic model of an inflating magma chamber.', 'Uz = (1 − ν) · ΔV / π · d / R³'],
  ['Moment magnitude Mw', 'Earthquake size from the seismic moment M0 = μ · A · D.', 'Mw = 2/3 · (log10 M0 − 9.1)'],
  ['Speckle tracking', 'Measuring large displacements by cross-correlating image patches between passes (offset tracking). Used where the phase aliases.', ''],
  ['MAI', 'Multiple Aperture Interferometry: along-track motion from the phase difference of forward- and backward-looking sub-beams.', ''],
  ['Incidence angle θ', 'Angle between the radar beam and the vertical at the ground.', 'NISAR: 33°–47°'],
  ['Ascending / descending', 'Passes with the satellite moving north or south. NISAR\'s dawn–dusk orbit gives ascending passes on the dusk side and descending passes on the dawn side.', ''],
  ['Wavelength λ', 'Distance between the crests of the radar wave. It sets the motion per fringe and how deep the wave reaches into vegetation.', 'L 23.85 cm · S 9.37 cm'],
  ['Cramér–Rao bound', 'Smallest possible phase noise for a given coherence and number of looks.', 'σφ = √(1 − γ²) / (γ · √(2L))'],
  ['DEM', 'Digital elevation model. The scenes use real ones (AWS Terrain Tiles, Copernicus DEM GLO-90).', ''],
];
const pctOf = (x) => Math.round(clamp(x, 0, 1) * 100);
const stripTags = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
function exportPixel(sc) {
  const p = S.pin || sc.poi || { i: sc.N / 2, j: sc.N / 2 };
  const i = clamp(Math.floor(p.i), 0, sc.N - 1), j = clamp(Math.floor(p.j), 0, sc.N - 1);
  // the app pins the scenario's point of interest on entry; only a different pixel was chosen by a click
  const isPoi = !!sc.poi && Math.floor(sc.poi.i) === i && Math.floor(sc.poi.j) === j;
  return { i, j, pinned: !!S.pin && !isPoi };
}
/** every real ground-motion component since t0 (incl. phase-only ice flow; excl. the calving surface change and water level) */
function motionK(sc, k, t, t0) {
  const w = basisW(sc, t), w0 = basisW(sc, t0), f = sc.flags;
  let e = 0, n = 0, u = 0;
  for (let b = 0; b < sc.bases.length; b++) {
    if (!(f.phase[b] || (f.mesh[b] && f.exag[b]))) continue;
    let dw = w[b] - w0[b]; if (!dw) continue;
    if (sc.rupture && b === 1) dw *= ruptureMask(sc, k);
    const d = sc.bases[b].data, o = k * 4; e += dw * d[o]; n += dw * d[o + 1]; u += dw * d[o + 2];
  }
  return [e, n, u];
}
function robustAbs(rows, q = 0.98) {
  const v = []; for (const r of rows) for (const x of r) if (Number.isFinite(x)) v.push(Math.abs(x));
  if (!v.length) return 1;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(q * v.length))];
}

function collectExport() {
  const sc = S.sc, site = sc.site, N = sc.N, C = currentCtx(), band = bandAtInspector(), g = C.geom;
  const lam = sc.lambda || BANDS[band].lambda, custom = sc.kind === 'custom', wz = WALTZES[site.waltz];
  const now = new Date(), tRef = C.tRef, kCur = epochOf(S.t), kRef = epochOf(tRef);
  const ctr = sc.grid.ij2ll(N / 2, N / 2), extKm = N * sc.grid.pixelM / 1000;
  const geomShort = S.geom === 'fusion' ? 'asc + desc fusion (LoS of the ascending pass)' : `${g.kind === 'desc' ? 'descending' : 'ascending'} · θ ${g.inc.toFixed(1)}°`;
  const meta = {
    id: (site.id || S.siteId || 'scene').replace(/[^a-z0-9_-]/gi, ''), siteName: site.name, region: site.region || '',
    waltz: wz ? `Waltz ${wz.n} · ${wz.title}` : 'Your data · CSAR-PACK', kind: sc.kind, custom, band,
    bandShort: S.band === 'X' ? 'L-band (X-ray lens view)' : (custom ? `λ ${(lam * 100).toFixed(2)} cm` : band + '-band'),
    iso: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC', stamp: now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-'),
    lamCm: lam * 100, epochCur: epochName(kCur), dateCur: fmtDate(dateAt(S.t)), epochRef: epochName(kRef), dateRef: fmtDate(dateAt(tRef)),
    pair: `${epochName(kRef)} → ${epochName(kCur)} (${fmtDate(dateAt(tRef))} → ${fmtDate(dateAt(S.t))})`,
    geomShort, modeName: MODE_NAMES[S.mode] || S.mode, exagTxt: S.exag >= 100 ? String(Math.round(S.exag)) : S.exag.toFixed(1), extKm, N,
  };
  const metaRows = [
    ['Scene', `${site.name}${site.region ? ' · ' + site.region : ''}`, site.tag || 'The place shown in the app when you exported.'],
    ['Earth waltz', meta.waltz, wz ? wz.blurb : 'A real interferogram you loaded as a CSAR-PACK.'],
    ['Scenario', KIND_NAMES[sc.kind] || sc.kind, custom ? 'Real measurements from the loaded product.' : 'The physical process this scene demonstrates.'],
    ['Scene centre', fmtLatLon(ctr.lat, ctr.lon), 'WGS84 latitude and longitude of the middle of the scene.'],
    ['Grid', `${N} × ${N} cells · ${fmt(sc.grid.pixelM, 0)} m spacing`, 'Resolution of the simulation. The map sheets sample it every 8th cell (48 × 48).'],
    ['Area', `${fmt(extKm, 1)} km × ${fmt(extKm, 1)} km`, 'Ground footprint of the scene.'],
    ['Current pass', `${meta.epochCur} · ${meta.dateCur} · day ${fmt(S.t, 0)} of ${CFG.tMax}`, 'The acquisition shown when you exported. NISAR revisits every place every 12 days.'],
    ['Reference pass', `${meta.epochRef} · ${meta.dateRef}`, S.pair === 'seq' ? 'Sequential pairs: the pass 12 days earlier is the reference.' : 'Cumulative: everything since the first pass E00 (built from short 12–24-day pairs, SBAS-style).'],
    ['Radar band', custom ? `Pack wavelength λ ${(lam * 100).toFixed(2)} cm` : `${BANDS[band].name} · ${(BANDS[band].f / 1e9).toFixed(3)} GHz · λ ${(lam * 100).toFixed(2)} cm${S.band === 'X' ? ' (X-ray lens view: L inside the lens, S outside)' : ''}`,
      band === 'S' ? 'ISRO S-SAR: finer motion sensitivity, decorrelates faster over vegetation.' : 'NASA/JPL L-SAR: reaches the ground under vegetation and stays coherent for months.'],
    ['Viewing geometry', S.geom === 'fusion' ? '3D fusion (ascending + descending + MAI); LoS values use the ascending pass' : `${g.kind === 'desc' ? 'Descending' : 'Ascending'} · incidence ${g.inc.toFixed(1)}° · heading ${g.hdgDeg.toFixed(0)}° · looking ${compass(g.lookDeg)}`,
      'NISAR looks to the left of its track; the incidence angle varies from 33° to 47° across the 242 km swath.'],
    ['LoS unit vector ê', `E ${g.los[0].toFixed(3)} · N ${g.los[1].toFixed(3)} · U ${g.los[2].toFixed(3)}`, 'Ground-to-satellite direction: d_LoS = U_east · ê_E + U_north · ê_N + U_up · ê_U.'],
    ['Atmosphere', S.layers.aps ? 'Included (turbulent + stratified water-vapour delay)' : 'Switched off in the app', 'Tropospheric delay added to the measured phase.'],
    ['View mode at export', meta.modeName, 'Which observable the 3D view was colouring.'],
    ['3D exaggeration', `×${meta.exagTxt} (view only)`, 'Only stretches the 3D mesh. Every number exported is at true scale.'],
    ['Data provenance', custom ? 'Real interferogram (CSAR-PACK) on its own DEM' : 'Real DEM · physics-based simulated NISAR signals', custom ? 'Phase, coherence and amplitude come from the loaded product.' : 'See "Data honesty" below.'],
    ['Exported', meta.iso, `CHRONO-SAR · NASA Space Apps Challenge 2026 · ${CFG.team}`],
  ];
  // ── pixel ──
  const P = exportPixel(sc), k = P.i * N + P.j, ll = sc.grid.ij2ll(P.i + 0.5, P.j + 0.5);
  const igL = igramK(sc, k, C, 'L'), igS = igramK(sc, k, C, 'S');
  const polL = polK(sc, k, 'L', C), polS = polK(sc, k, 'S', C), fr = polL.fr;
  const mv = motionK(sc, k, C.tCur, C.tRef).map((x) => x * 1000);
  const fu = fusionAt(sc, k, C);
  const k4L = igL.lam / (4 * Math.PI) * 1000, k4S = igS.lam / (4 * Math.PI) * 1000;
  const dual = !custom;
  const R = [];
  const sec = (name) => R.push({ sec: name });
  const row = (o) => R.push(o);
  const dom = (fd) => (fd.fd >= fd.fvol && fd.fd >= fd.fs ? 'Double bounce' : fd.fvol >= fd.fs ? 'Volume' : 'Surface');
  sec('Location & surface');
  row({ p: 'Grid cell (row, column)', one: `${P.i}, ${P.j}`, meaning: `Position in the ${N} × ${N} simulation grid (row 0 = northern edge, column 0 = western edge).`, method: P.pinned ? 'Chosen with a click in the app.' : 'The scenario\'s point of interest, pinned automatically when the scene opened.' });
  row({ p: 'Latitude', one: ll.lat, fmt: '0.00000', unit: '°', meaning: 'WGS84 latitude of the cell centre.', method: 'Georeferenced DEM grid.' });
  row({ p: 'Longitude', one: ll.lon, fmt: '0.00000', unit: '°', meaning: 'WGS84 longitude of the cell centre.', method: 'Georeferenced DEM grid.' });
  row({ p: 'Elevation', one: Math.round(sc.dem[k]), fmt: '#,##0', unit: 'm', meaning: 'Ground height above sea level.', method: custom ? 'DEM of the CSAR-PACK.' : 'Real DEM (AWS Terrain Tiles; Copernicus GLO-90 for Greenland), resampled to the grid.' });
  row({ p: 'Surface', one: surfaceName(sc, fr, k), meaning: 'Dominant land cover. It decides how the radar wave scatters here.', method: 'Land-cover model of the scene.' });
  if (!custom) {
    row({ p: 'Cover: vegetation · water · urban · ice', one: `${pctOf(fr.veg)} · ${pctOf(fr.water)} · ${pctOf(fr.urban)} · ${pctOf(fr.ice)}`, unit: '%', meaning: 'Share of the cell covered by each class at the current date (debris flows, windthrow or calving change it).', method: 'Scene model, updated by the catalogued events.' });
    if (fr.veg > 0.05) row({ p: 'Canopy height', one: fr.canopyH, fmt: '0.0', unit: 'm', meaning: 'Height of trees or reeds. Tall canopies scatter volume (HV) and hide the ground from S-band.', method: 'Scene vegetation model.' });
  }
  sec(`Interferometry · pair ${meta.pair}`);
  row({ p: 'Wavelength λ', L: igL.lam * 100, S: dual ? igS.lam * 100 : null, fmt: '0.00', unit: 'cm', meaning: 'Radar wavelength. L-band (NASA/JPL) is 2.5 times longer than S-band (ISRO): it reaches the ground under vegetation and stays coherent longer.', method: 'λ = c / f with f = 1.257 GHz (L) and 3.20 GHz (S).' });
  row({ p: 'Wrapped phase φw', L: igL.wrapped, S: dual ? igS.wrapped : null, fmt: '0.000', unit: 'rad', col: 'phase', meaning: 'What the interferogram shows directly: the phase difference modulo 2π, between −π and +π. One full colour cycle is one fringe.', method: 'φw = φ − 2π · round(φ / 2π)' });
  row({ p: 'Unwrapped phase φ', L: igL.phi, S: dual ? igS.phi : null, fmt: '0.000', unit: 'rad', meaning: 'The continuous phase once the 2π ambiguities are resolved (what phase unwrapping recovers).', method: 'φ = 4π/λ · (d_LoS + d_atm) + noise' });
  row({ p: 'Fringes since the reference', L: igL.phi / TAU, S: dual ? igS.phi / TAU : null, fmt: '0.00', unit: 'cycles', meaning: 'Number of colour cycles between this pixel and zero motion.', method: 'n = φ / 2π' });
  row({ p: 'Measured LoS change', L: igL.phi * k4L, S: dual ? igS.phi * k4S : null, fmt: '0.0', unit: 'mm', col: 'los', meaning: 'Total line-of-sight change one interferogram measures: ground motion + atmosphere + phase noise. Positive = toward the satellite.', method: 'Δd = λ / 4π · φ' });
  row({ p: '   of which ground deformation', one: igL.los * 1000, fmt: '0.0', unit: 'mm', col: 'los', meaning: 'Real ground motion projected on the line of sight: the signal you are after. The same for both bands.', method: 'd_LoS = U · ê' + (sc.kind === 'wetland' ? ' (+ water-level change seen by double bounce under flooded vegetation)' : '') });
  row({ p: '   of which atmospheric delay', one: igL.atm * 1000, fmt: '0.0', unit: 'mm', col: 'los', meaning: 'Delay from tropospheric water vapour. The same in millimetres for both bands; it averages out over many passes.', method: 'Turbulent fractal screens + an elevation-dependent (stratified) term.' });
  row({ p: 'Coherence γ', L: igL.gamma, S: dual ? igS.gamma : null, fmt: '0.00', unit: '0–1', col: 'coh', meaning: 'Phase quality: 1 = identical echoes in both passes, 0 = pure noise. Vegetation, water, snow and surface change lower it.', method: custom ? 'Coherence layer of the CSAR-PACK.' : 'γ = γ∞ + (γ0 − γ∞) · exp(−Δt / τ) per land-cover class, mixed by cover fractions; events add decorrelation.' });
  row({ p: 'Phase noise σφ', L: igL.sigma, S: dual ? igS.sigma : null, fmt: '0.000', unit: 'rad', meaning: 'Expected 1σ scatter of the phase at this coherence.', method: `Cramér–Rao bound σφ = √(1 − γ²) / (γ · √(2L)), L = ${CFG.looks} looks.` });
  row({ p: 'Displacement noise σd', L: igL.sigma * k4L, S: dual ? igS.sigma * k4S : null, fmt: '0.0', unit: 'mm', meaning: 'The same noise as millimetres of LoS motion. S-band turns phase into motion 2.5 times more finely.', method: 'σd = λ / 4π · σφ' });
  sec('Viewing geometry');
  row({ p: 'Pass direction', one: g.kind === 'desc' ? 'Descending (moving south)' : 'Ascending (moving north)', meaning: 'Every place is seen from an ascending and a descending track; combining both separates vertical from east–west motion.', method: S.geom === 'fusion' ? 'Fusion mode: LoS values use the ascending track.' : 'Selected with the GEOMETRY control.' });
  row({ p: 'Incidence angle θ', one: g.inc, fmt: '0.0', unit: '°', meaning: 'Angle between the radar beam and the vertical at the ground. Steeper beams are more sensitive to vertical motion.', method: 'From the 747 km orbit and the position in the 242 km swath (33°–47°).' });
  row({ p: 'Track heading', one: g.hdgDeg, fmt: '0.0', unit: '° from N', meaning: 'Direction of flight over the ground, clockwise from north.', method: 'Orbit inclination 98.4° combined with Earth rotation at this latitude.' });
  row({ p: 'Look direction', one: `${compass(g.lookDeg)} (${g.lookDeg.toFixed(0)}°)`, meaning: 'Direction the antenna points. NISAR looks to the left of its track.', method: 'heading − 90°' });
  row({ p: 'LoS unit vector ê (E, N, U)', one: `${g.los[0].toFixed(3)}, ${g.los[1].toFixed(3)}, ${g.los[2].toFixed(3)}`, meaning: 'Unit vector from the ground to the satellite. One geometry measures only the motion along ê.', method: 'ê = (sin θ · sin α, sin θ · cos α, cos θ) with α = heading + 90°.' });
  sec('3D ground motion since the reference pass');
  row({ p: 'True displacement east', one: mv[0], fmt: '0.0', unit: 'mm', col: 'los', meaning: 'Ground-truth motion of the simulation, east component.', method: 'Sum of the scenario\'s sources (magma chamber, fault slip, aquifer compaction, ice flow).' });
  row({ p: 'True displacement north', one: mv[1], fmt: '0.0', unit: 'mm', col: 'los', meaning: 'Ground-truth motion, north component.', method: 'As above.' });
  row({ p: 'True displacement up', one: mv[2], fmt: '0.0', unit: 'mm', col: 'los', meaning: 'Ground-truth motion, vertical component (uplift positive).', method: 'As above.' });
  if (fu && fu.sol) {
    const s = fu.sol;
    row({ p: '3D fusion estimate east ± σ', one: `${fmtS(s.x[0] * 1000, 1)} ± ${fmt(s.sig[0] * 1000, 1)}`, unit: 'mm', meaning: 'East motion recovered from radar alone (ascending + descending LoS and along-track MAI offsets).', method: 'Weighted least squares x̂ = (A^T W A)^-1 A^T W d, W = 1/σ².' });
    row({ p: '3D fusion estimate north ± σ', one: `${fmtS(s.x[1] * 1000, 1)} ± ${fmt(s.sig[1] * 1000, 1)}`, unit: 'mm', meaning: 'North motion. Polar orbits are nearly blind to it, so its uncertainty is the largest.', method: 'As above.' });
    row({ p: '3D fusion estimate up ± σ', one: `${fmtS(s.x[2] * 1000, 1)} ± ${fmt(s.sig[2] * 1000, 1)}`, unit: 'mm', meaning: 'Vertical motion recovered from the two geometries.', method: 'As above.' });
  }
  sec('Polarimetry · backscatter and scattering mechanisms');
  row({ p: 'σ⁰ HH', L: dB(polL.C.C11), S: dual ? dB(polS.C.C11) : null, fmt: '0.0', unit: 'dB', meaning: 'Backscatter for horizontal transmit and receive. Bright for double bounce (flooded forest, cities).', method: custom ? 'Amplitude layer of the CSAR-PACK.' : 'Covariance model: surface + double-bounce + volume terms weighted by land cover.' });
  row({ p: 'σ⁰ HV', L: dB(polL.C.C22), S: dual ? dB(polS.C.C22) : null, fmt: '0.0', unit: 'dB', meaning: 'Cross-polarised backscatter. It grows with vegetation volume (biomass).', method: 'As above.' });
  row({ p: 'σ⁰ VV', L: dB(polL.C.C33), S: dual ? dB(polS.C.C33) : null, fmt: '0.0', unit: 'dB', meaning: 'Vertical transmit and receive. Strong for rough soil and wind-roughened water (Bragg scattering).', method: 'As above.' });
  row({ p: 'Double bounce Pd', L: polL.fd.fd * 100, S: dual ? polS.fd.fd * 100 : null, fmt: '0', unit: '%', col: 'pd', meaning: 'Share of power from dihedral reflections (water or ground + trunk or wall). High under flooded forest in L-band.', method: 'Freeman–Durden three-component decomposition.' });
  row({ p: 'Volume Pv', L: polL.fd.fvol * 100, S: dual ? polS.fd.fvol * 100 : null, fmt: '0', unit: '%', col: 'pv', meaning: 'Share of power scattered inside a canopy.', method: 'Freeman–Durden: Pv = 8/3 · fv with fv = 3 · HV.' });
  row({ p: 'Surface Ps', L: polL.fd.fs * 100, S: dual ? polS.fd.fs * 100 : null, fmt: '0', unit: '%', col: 'ps', meaning: 'Share of power from a single bounce on soil, ice or water.', method: 'Freeman–Durden decomposition.' });
  row({ p: 'Dominant mechanism', L: dom(polL.fd), S: dual ? dom(polS.fd) : null, meaning: 'Which mechanism carries most of the power.', method: 'Largest of Pd, Pv and Ps.' });
  if (fr.veg > 0.3 && !custom) {
    const aL = agbFromHv('L', dB(polL.C.C22)), aS = agbFromHv('S', dB(polS.C.C22));
    sec('Vegetation');
    row({ p: 'Biomass (AGB) from HV', L: aL.saturated ? `> ${aL.agb.toFixed(0)}` : Math.round(aL.agb), S: aS.saturated ? `> ${aS.agb.toFixed(0)}` : Math.round(aS.agb), fmt: '0', unit: 't/ha', meaning: 'Above-ground biomass estimated from HV. S-band saturates early, L-band sees further into dense forest. ">" means saturated.', method: 'HV = a + b · (1 − exp(−AGB / K)), inverted.' });
  }
  if (sc.hasWater && floodedK(sc, k, C.pulseC, C.calveC)) {
    const wse = wseK(sc, k, C.pulseC), wseR = wseK(sc, k, C.pulseR);
    sec('Water');
    row({ p: 'Water depth', one: wse - groundK(sc, k, C.calveC), fmt: '0.00', unit: 'm', meaning: 'Depth of the water standing on this cell at the current date.', method: 'Water-surface model minus ground elevation.' });
    if (sc.kind === 'wetland') row({ p: 'Water-level change since the reference', one: (wse - wseR) * 100, fmt: '0', unit: 'cm', meaning: 'Rise (+) or fall (−) of the water surface between the two passes. L-band double bounce measures it under the canopy.', method: 'Seasonal flood-pulse model of the basin.' });
  }
  const pixel = { i: P.i, j: P.j, k, latlon: fmtLatLon(ll.lat, ll.lon), surface: surfaceName(sc, fr, k), rows: R, dual };
  // ── maps (48 × 48) ──
  const G = 48, step = N / G, grid = { G, step, lat: [], lon: [], ii: [], jj: [], los: [], atm: [], phase: [], coh: [], elev: [], surf: [] };
  for (let r = 0; r < G; r++) { const i = Math.min(N - 1, Math.floor((r + 0.5) * step)); grid.ii.push(i); grid.lat.push(sc.grid.ij2ll(i + 0.5, N / 2).lat); }
  for (let c = 0; c < G; c++) { const j = Math.min(N - 1, Math.floor((c + 0.5) * step)); grid.jj.push(j); grid.lon.push(sc.grid.ij2ll(N / 2, j + 0.5).lon); }
  for (let r = 0; r < G; r++) {
    const L = [], A = [], Ph = [], Co = [], El = [], Su = [];
    for (let c = 0; c < G; c++) {
      const kk = grid.ii[r] * N + grid.jj[c], ig = igramK(sc, kk, C, band);
      L.push(ig.los * 1000); A.push(ig.atm * 1000); Ph.push(ig.wrapped); Co.push(ig.gamma); El.push(sc.dem[kk]); Su.push(surfaceName(sc, coverK(sc, kk, C), kk));
    }
    grid.los.push(L); grid.atm.push(A); grid.phase.push(Ph); grid.coh.push(Co); grid.elev.push(El); grid.surf.push(Su);
  }
  grid.losR = Math.max(robustAbs(grid.los), 0.5);
  grid.losMaxAbs = Math.max(robustAbs(grid.los, 1), 0.01);
  // ── time series (29 passes at the pixel, same formulas as the inspector chart) ──
  const gO = sc.geom[S.geom === 'desc' ? 'desc' : 'asc'], lamL = sc.lambda || BANDS.L.lambda, srows = [];
  for (let e = 0; e < CFG.nEpochs; e++) {
    const t = e * CFG.repeatDays;
    const Ce = timeCtx(sc, { tRef: 0, tCur: t, X: 1, geomObj: gO, bandEff: band, aps: S.layers.aps });
    const los = losK(sc, k, Ce) * 1000, ig = igramK(sc, k, Ce, band), kk4 = ig.lam / (4 * Math.PI) * 1000;
    const obs = los + ig.atm * 1000 + ig.sigma * noiseK(sc, k, Ce) * kk4;
    const m = motionK(sc, k, t, 0);
    let gL = null, gS = null;
    if (e > 0) {
      const Cp = timeCtx(sc, { tRef: t - CFG.repeatDays, tCur: t, X: 1, geomObj: gO, bandEff: band, aps: S.layers.aps });
      gL = cohK(sc, k, 'L', Cp); gS = dual ? cohK(sc, k, 'S', Cp) : null;
    }
    const wL = igramK(sc, k, Ce, 'L').wrapped, wS = dual ? igramK(sc, k, Ce, 'S').wrapped : null;
    const ev = e > 0 ? sc.events.filter((x) => Number.isFinite(x.t) && x.t > t - CFG.repeatDays && x.t <= t).map((x) => x.name.replace(/ \(simulated\)/, '')).join('; ') : '';
    srows.push({ epoch: epochName(e), date: fmtDate(dateAt(t)), t, los, atm: ig.atm * 1000, obs, sig: ig.sigma * kk4, E: m[0] * 1000, N: m[1] * 1000, U: m[2] * 1000, gL, gS, wL, wS, frL: los / (lamL / 2 * 1000), ev });
  }
  const series = { rows: srows, losR: Math.max(robustAbs([srows.map((r) => r.los).concat(srows.map((r) => r.obs))], 1), 0.5), atmR: Math.max(robustAbs([srows.map((r) => r.atm)], 1), 0.5) };
  series.guide = [
    ['Epoch', 'Pass number E00 … E28. NISAR revisits every place every 12 days.', '29 passes × 12 days = 336 days', ''],
    ['Date', `Acquisition date (UTC). E00 = ${fmtDate(dateAt(0))}, start of the NISAR science phase.`, '', 'YYYY-MM-DD'],
    ['Day', 'Days since E00.', 'day = 12 × epoch', 'days'],
    ['LoS deformation', 'Cumulative ground motion since E00 projected on the line of sight. Positive = toward the satellite. This is the signal you want.', 'd_LoS(t) = U(t) · ê', 'mm'],
    ['Atmosphere', 'Tropospheric delay of this pass relative to E00. Noise for deformation studies; it averages out over many passes.', 'turbulent screens + stratified term', 'mm'],
    ['Measured LoS', 'What one interferogram E00 → this pass actually measures: deformation + atmosphere + phase noise (the cyan dots of the chart).', 'Δd = λ / 4π · φ', 'mm'],
    ['Noise 1σ', 'Expected phase-noise scatter of that interferogram in millimetres. Long pairs decorrelate more, so the noise grows with time.', 'σd = λ / 4π · σφ(γ)', 'mm'],
    ['East / North / Up', 'True 3D ground motion since E00, before projection on the line of sight (the simulation\'s ground truth).', 'scenario sources', 'mm'],
    ['γ L / γ S (12-day pair)', 'Coherence of the 12-day pair that ends at this pass, for each band. Drops mark changes on the ground (events, flooding, snow).', 'γ model, Δt = 12 days', '0–1'],
    ['Phase L / S wrapped', 'Wrapped phase of the interferogram E00 → this pass in each band, as the interferogram shows it (with atmosphere and noise).', 'φw ∈ [−π, +π)', 'rad'],
    ['Fringes L-band', 'L-band fringes produced by the deformation alone since E00.', 'n = d_LoS / (λ/2)', 'cycles'],
    ['Event', 'Catalogued event that happened between the previous pass and this one.', 'scenario catalogue', ''],
  ];
  series.notes = ['Pass number (12-day repeat)', 'Acquisition date, UTC', 'Days since E00', 'Ground motion since E00 along the line of sight (+ = toward the satellite)', 'Tropospheric delay relative to E00', 'Deformation + atmosphere + phase noise: what one interferogram E00 → pass measures', 'Expected 1σ phase noise of that interferogram, in mm', 'True eastward motion since E00', 'True northward motion since E00', 'True vertical motion since E00', 'Coherence of the 12-day L-band pair ending here', 'Coherence of the 12-day S-band pair ending here', 'Wrapped L-band phase E00 → pass', 'Wrapped S-band phase E00 → pass', 'L-band fringes from deformation alone', 'Event between the previous pass and this one'];
  // ── KPIs ──
  const kpis = computeKPIs().map((q) => {
    const v = q.html ? stripTags(q.html) : String(q.v);
    const num = /^[+\-−]?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim().replace('−', '-')) : v;
    return { k: q.k, v: num, u: q.u || '', meaning: KPI_HELP[q.k] || 'Catalogued event of this scenario: affected area once it has occurred, otherwise the day it is scheduled.' };
  });
  // ── CCD ──
  let ccd = null;
  if (S.ccd && S.ccd.result) {
    const r = S.ccd.result;
    const comps = r.comps.map((c, n) => { const cl = sc.grid.ij2ll(c.ci, c.cj); return [n + 1, c.label, c.isEvent ? 'yes' : 'no', c.areaKm2, c.isEvent ? c.volume : null, c.meanDG, c.meanDI, c.overlap * 100, cl.lat, cl.lon, c.pix.length]; });
    ccd = {
      band: r.band, dates: [fmtDate(dateAt(r.tPre2)), fmtDate(dateAt(r.tPre1)), fmtDate(dateAt(r.tPost))], comps,
      summary: [
        ['SLC acquisitions', `${epochName(epochOf(r.tPre2))} · ${epochName(epochOf(r.tPre1))} · ${epochName(epochOf(r.tPost))}`, '', `Pre-event pair ${fmtDate(dateAt(r.tPre2))} → ${fmtDate(dateAt(r.tPre1))}; co-event pair ${fmtDate(dateAt(r.tPre1))} → ${fmtDate(dateAt(r.tPost))}.`],
        ['Band', `${r.band}-band`, '', 'Radar band of the three simulated SLCs.'],
        ['Catalogued event in the pair', r.event ? r.event.name.replace(/ \(simulated\)/, '') : 'none', '', 'Event of the scenario catalogue that happened between the last two acquisitions.'],
        ['Event area', r.evA, 'km²', 'Change polygons that overlap the catalogued event (at least 30 % of their pixels).'],
        ['Event volume', r.evV > 0 ? r.evV : 'n/a', r.evV > 0 ? 'm³' : '', 'Material moved or lost: deposit thickness × area (debris), ice thickness × area (calving) or the catalogue volume (fissures).'],
        ['Other change', r.otherA, 'km²', 'Change not linked to the catalogued event (flood-state changes, unclassified change).'],
        ['Total changed area', r.totalA, 'km²', `All change, in ${r.comps.length} polygon(s).`],
      ],
    };
  }
  // ── unwrapping ──
  let unwrap = null;
  if (S.unwrap && S.unwrap.stats) {
    const s = S.unwrap.stats, rl = sc.grid.ij2ll(sc.ref.i, sc.ref.j);
    unwrap = { rows: [
      ['Band', `${S.unwrap.band}-band`, '', 'Band of the interferogram that was unwrapped.'],
      ['Wavelength', rnd(S.unwrap.lam * 100, 2), 'cm', 'Converts the phase to displacement: Δd = λ / 4π · φ.'],
      ['Reference pixel', fmtLatLon(rl.lat, rl.lon), '', 'Stable, highly coherent pixel where unwrapping starts (its phase is taken as known).'],
      ['Pixels unwrapped', s.n, 'px', 'Pixels reached by the flood fill (coherence above 0.3, not open water).'],
      ['Pixels in the scene', s.total, 'px', `${N} × ${N} grid.`],
      ['Coverage', rnd(s.n / s.total * 100, 1), '%', 'Share of the scene with a usable unwrapped phase.'],
      ['Connected regions', s.regions, '', 'Coherent islands unwrapped separately, each from its own seed.'],
      ['Largest phase range', rnd(s.maxCycles, 2), 'fringes', 'Number of 2π cycles the unwrapper had to add at most.'],
      ['RMS error vs truth', rnd(s.rms, 3), 'rad', 'Root-mean-square difference between the unwrapped phase and the exact (simulated) phase.'],
      ['RMS error vs truth', rnd(s.rmsMm, 2), 'mm', 'The same error as line-of-sight displacement.'],
      ['Pixels with a 2π error', s.jumps, 'px', 'Pixels whose error exceeds π, i.e. a wrong cycle count. Zero means a perfect unwrap.'],
    ] };
  }
  // ── cross-section (recomputed at true scale) ──
  let profile = null;
  const sl = S.slice;
  if (S.profile && sl && sl.a && sl.b) {
    const M = 240, rows = [], lenKm = Math.hypot(sl.b.x - sl.a.x, sl.b.z - sl.a.z) * sc.grid.mpu / 1000, los = C.geom.los;
    for (let n = 0; n < M; n++) {
      const f = n / (M - 1), x = lerp(sl.a.x, sl.b.x, f), z = lerp(sl.a.z, sl.b.z, f);
      const gg = sc.grid.xz2ij(x, z), kk = sc.grid.idx(gg.i, gg.j), pl = sc.grid.ij2ll(gg.i, gg.j);
      const elev = sampleField(sc.dem, sc.N, gg.j, gg.i), frp = coverK(sc, kk, C), m = motionK(sc, kk, C.tCur, C.tRef);
      rows.push({ d: f * lenKm, lat: pl.lat, lon: pl.lon, elev, canopy: frp.veg > 0.25 && frp.canopyH > 1 ? elev + frp.canopyH : null, water: floodedK(sc, kk, C.pulseC, C.calveC) ? wseK(sc, kk, C.pulseC) : null, up: m[2] * 1000, los: (m[0] * los[0] + m[1] * los[1] + m[2] * los[2]) * 1000, surface: surfaceName(sc, frp, kk) });
    }
    profile = { lenKm, rows };
  }
  // ── texts ──
  const losUnit = grid.losMaxAbs >= 9999.5 ? 'm' : 'mm';
  const lay = 'LAYOUT: rows are latitude (north at the top), columns are longitude (west on the left). The first column and the header row give the coordinates of each sample.';
  const what = `${G} × ${G} values, every ${step}th cell of the ${N} × ${N} grid over ${fmt(extKm, 1)} km × ${fmt(extKm, 1)} km`;
  const mapText = {
    los: [
      `WHAT: line-of-sight ground displacement of the pair ${meta.pair} (${what}). Atmosphere and noise are removed: this is the ground-motion signal itself, in ${losUnit === 'm' ? 'metres' : 'millimetres'}.`,
      `SIGN: positive (red) = the ground moved toward the satellite (uplift, or horizontal motion toward the radar); negative (blue) = away (subsidence, or motion away). One geometry sees only the component along ê = [${g.los.map((x) => x.toFixed(3)).join(', ')}] (${geomShort}).`,
      lay,
    ].concat(sc.kind === 'glacier' ? ['GLACIER: on the fast ice the motion between passes reaches tens to hundreds of metres. Its phase aliases (thousands of fringes), which is why NISAR measures it by speckle tracking; these values are the motion the phase would have to encode.'] : []),
    phase: [
      `WHAT: the interferogram itself. Wrapped interferometric phase of the pair ${meta.pair} in radians, between −π and +π (${what}). One full colour cycle is one fringe = λ/2 = ${fmt(lam * 50, 2)} cm of line-of-sight motion.`,
      'INCLUDES: deformation + atmospheric delay + phase noise, exactly what a real interferogram contains. Grey cells have coherence below 0.25: their phase is noise and should not be used.',
      'READING: count the colour cycles between two points and multiply by λ/2 to get their relative motion; the order of the colours tells the sign.',
      lay,
    ],
    coh: [
      `WHAT: interferometric coherence γ of the pair ${meta.pair} in ${meta.bandShort}, from 0 (pure noise) to 1 (identical radar echoes) (${what}).${S.pair === 'cum' ? ' In cumulative mode this is the coherence of the 12–24-day pairs of the time-series network, as in the app.' : ''}`,
      'READING: γ > 0.7 excellent (rock, buildings), 0.3–0.7 usable, below 0.3 noise (open water, dense vegetation at S-band, fast ice, any change of the surface). Sudden drops between passes are what coherence change detection (CCD) maps.',
      lay,
    ],
  };
  const mapScale = {
    los: `Colour scale: blue −${fmtTick(grid.losR / (losUnit === 'm' ? 1000 : 1))} → slate 0 → red +${fmtTick(grid.losR / (losUnit === 'm' ? 1000 : 1))} ${losUnit} (98th percentile of |value|; larger values saturate).`,
    phase: 'Colour scale: the app\'s cyclic phase wheel from −π to +π; grey = masked (γ < 0.25).',
    coh: 'Colour scale: dark (0) → teal (0.5) → white-cyan (1), the app\'s coherence colour map.',
  };
  const howTo = [
    'Pixel: every physical quantity at the pixel you inspected, L- and S-band side by side. Click a pixel in the app before exporting to choose it.',
    'Time series: the 29 NISAR passes (12 days apart) at that pixel. In the chart the gold curve is the ground deformation and the cyan dots are what each interferogram would really measure.',
    'LoS map, Phase map, Coherence map: the whole scene on a 48 × 48 grid. North is at the top and west on the left; the first column holds latitude and the header row longitude. Cell colours use the app\'s colour maps.',
    'Radar images: the four observables of the current state as pictures.',
    'KPIs: the scenario\'s headline numbers. CCD alerts, Unwrapping and Cross-section appear when you ran those tools before exporting.',
    'Glossary: the terms and formulas used across the workbook. Numbers are true scale; positive LoS always means motion toward the satellite.',
  ];
  const honesty = custom
    ? ['This scene comes from a CSAR-PACK: its line-of-sight displacement, coherence and amplitude are real measurements. The phase is recomputed from the unwrapped LoS with the pack\'s wavelength, and the time series spreads the pair linearly over the 29 passes.', 'The vertical exaggeration only stretches the 3D view. Every number exported is at true scale.']
    : ['Real: the elevation models (AWS Terrain Tiles, Copernicus DEM GLO-90), the NISAR orbit and viewing geometry, the L- and S-band wavelengths and the physics (phase–displacement relation, coherence models, Freeman–Durden polarimetry, Mogi and dislocation sources).',
      'Simulated: the deformation scenarios, the atmospheric screens, the speckle noise and the land-cover model. The app does not download NISAR products: it models the signals, so every algorithm can be checked against a known truth. The numbers are physically consistent, but they are not measurements.',
      'True scale: the vertical exaggeration only stretches the 3D view. Every number exported is at true scale.'];
  const missing = [];
  if (!ccd) missing.push('CCD alerts (RUN CCD, key D)');
  if (!unwrap) missing.push('Phase unwrapping report (PHASE UNWRAPPING, key U)');
  if (!profile) missing.push('Cross-section (CROSS-SECTION, key P, then drag a line)');
  const events = sc.events.filter((e) => Number.isFinite(e.t) && e.t <= CFG.tMax).map((e) => ({ t: e.t, name: e.name.replace(/ \(simulated\)/, '') }));
  return { meta, metaRows, pixel, grid, series, kpis, ccd, unwrap, profile, mapText, mapScale, losUnit, howTo, honesty, missing, events };
}

// ───────────── pictures: 3D snapshot, radar images, light-theme charts ─────────────
function captureSnapshot() {
  try {
    if (!App.composer || !App.renderer) return null;
    App.composer.render();                                     // read back in the same task, before the buffer is presented
    const src = App.renderer.domElement, sw = src.width, sh = src.height;
    if (!sw || !sh) return null;
    const w = Math.min(1280, sw), h = Math.round(w * sh / sw), cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(src, 0, 0, w, h);
    return { url: cv.toDataURL('image/jpeg', 0.86), w, h };
  } catch (e) { return null; }
}
async function radarImages(D) {
  const sc = S.sc, C = currentCtx(), band = bandAtInspector(), size = 300, out = [];
  const R = S.defoRange * 1000;
  const defs = [
    ['phase', 'Interferogram · wrapped phase', `Colour cycles are fringes: each full cycle is λ/2 = ${fmt(D.meta.lamCm / 2, 2)} cm of line-of-sight motion. Grey areas have coherence below 0.25 and are masked.`],
    ['defo', S.geom === 'fusion' ? 'Vertical displacement (true signal)' : 'LoS displacement (true signal)', `Blue = away from the satellite or down, red = toward it or up, slate = no motion. The colour scale spans ±${fmtTick(R)} mm, the app's current range.`],
    ['pol', 'Freeman–Durden polarimetry', 'Red = double bounce (flooded forest, buildings), green = volume (canopy), blue = surface (bare soil, water, ice). Brightness = total backscattered power.'],
    ['coh', 'Coherence γ', 'Dark = decorrelated (noise, change, open water), teal = usable, white-cyan = excellent. Coherence change detection looks for sudden drops of this map.'],
  ];
  for (const [mode, title, text] of defs) {
    try {
      const img = renderRadarImage(sc, C, mode, band, size), cv = document.createElement('canvas');
      cv.width = size; cv.height = size; cv.getContext('2d').putImageData(img, 0, 0);
      out.push({ title, text, url: cv.toDataURL('image/jpeg', 0.92) });
    } catch (e) { console.warn('radar image', mode, e); out.push(null); }
    await sleep(0);
  }
  return out;
}
const chartTick = (v) => (Math.abs(v) < 1e-9 ? '0' : fmtTick(v));
function chartCanvas(w, h) {
  const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2;
  const g = cv.getContext('2d'); g.scale(2, 2); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  return { cv, g };
}
/** one plot panel: grid, axes, event markers, series (area / line / dots, nulls break lines), legend */
function chartPanel(g, box, o) {
  const { x, y, w, h } = box, F = 'Segoe UI, Arial, sans-serif';
  let lo = Infinity, hi = -Infinity;
  for (const s of o.series) for (const p of s.pts) if (p[1] !== null && Number.isFinite(p[1])) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const X = (v) => x + (v - o.xMin) / (o.xMax - o.xMin) * w, Y = (v) => y + (1 - (v - lo) / (hi - lo)) * h;
  g.fillStyle = '#0f172a'; g.font = `600 15px ${F}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(o.title, x, y - (o.sub ? 26 : 12));
  if (o.sub) { g.fillStyle = '#64748b'; g.font = `12px ${F}`; g.fillText(o.sub, x, y - 10); }
  const step = niceStep((hi - lo) / 5);
  g.lineWidth = 1; g.font = `11px ${F}`; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const yy = Math.round(Y(v)) + 0.5;
    g.strokeStyle = Math.abs(v) < step * 1e-6 ? '#94a3b8' : '#e2e8f0';
    g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
    g.fillStyle = '#64748b'; g.fillText(chartTick(Math.abs(v) < step * 1e-6 ? 0 : v), x - 7, yy);
  }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const [v, lab] of o.xTicks) { const xx = X(v); g.strokeStyle = '#cbd5e1'; g.beginPath(); g.moveTo(xx, y + h); g.lineTo(xx, y + h + 5); g.stroke(); g.fillStyle = '#64748b'; g.fillText(lab, xx, y + h + 8); }
  g.strokeStyle = '#94a3b8'; g.strokeRect(x + 0.5, y + 0.5, w, h);
  if (o.yLabel) { g.save(); g.translate(x - 50, y + h / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#475569'; g.font = `12px ${F}`; g.fillText(o.yLabel, 0, 0); g.restore(); }
  for (const vl of o.vlines || []) {
    const xx = X(vl.x); if (xx < x || xx > x + w) continue;
    g.save(); g.strokeStyle = 'rgba(220,38,38,0.75)'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(xx, y); g.lineTo(xx, y + h); g.stroke(); g.restore();
    g.fillStyle = '#b91c1c'; g.font = `600 11px ${F}`; g.textAlign = xx > x + w * 0.75 ? 'right' : 'left'; g.textBaseline = 'top'; g.fillText(vl.label, xx + (g.textAlign === 'right' ? -5 : 5), y + 6);
  }
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  for (const s of o.series) {
    const segs = []; let cur = [];
    for (const p of s.pts) { if (p[1] === null || !Number.isFinite(p[1])) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); }
    if (cur.length) segs.push(cur);
    if (s.kind === 'dots') { g.fillStyle = s.color; for (const seg of segs) for (const p of seg) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), s.r || 3, 0, TAU); g.fill(); } continue; }
    for (const seg of segs) {
      if (s.fill) {
        const base = s.fillTo === 'bottom' ? y + h : Y(0);
        g.beginPath(); g.moveTo(X(seg[0][0]), base); for (const p of seg) g.lineTo(X(p[0]), Y(p[1])); g.lineTo(X(seg[seg.length - 1][0]), base); g.closePath(); g.fillStyle = s.fill; g.fill();
      }
      g.beginPath(); seg.forEach((p, n) => (n ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
      g.strokeStyle = s.color; g.lineWidth = s.width || 2; g.setLineDash(s.dash || []); g.stroke(); g.setLineDash([]);
    }
  }
  g.restore();
  let lx = x + w, ly = y - (o.sub ? 26 : 12);
  g.font = `12px ${F}`; g.textBaseline = 'middle'; g.textAlign = 'right';
  for (const s of [...o.series].reverse()) {
    if (!s.label) continue;
    const tw = g.measureText(s.label).width;
    g.fillStyle = '#334155'; g.fillText(s.label, lx, ly - 4);
    g.fillStyle = s.color; g.strokeStyle = s.color;
    if (s.kind === 'dots') { g.beginPath(); g.arc(lx - tw - 12, ly - 4, 3.5, 0, TAU); g.fill(); }
    else { g.lineWidth = 3; g.setLineDash(s.dash || []); g.beginPath(); g.moveTo(lx - tw - 22, ly - 4); g.lineTo(lx - tw - 6, ly - 4); g.stroke(); g.setLineDash([]); }
    lx -= tw + 40;
  }
}
function seriesChartPng(D) {
  try {
    const T = D.series.rows, W = 1000, H = 380, { cv, g } = chartCanvas(W, H), xTicks = [];
    for (let m = 0; m < 12; m++) { const t = m * 30.44; if (t <= CFG.tMax) xTicks.push([t, dateAt(t).toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' })]); }
    chartPanel(g, { x: 78, y: 64, w: W - 104, h: H - 112 }, {
      title: 'Line-of-sight time series at the inspected pixel', sub: `${D.pixel.latlon} · ${D.meta.bandShort} · ${D.meta.geomShort}`,
      yLabel: 'mm (+ = toward the satellite)', xMin: 0, xMax: CFG.tMax, xTicks, zero: true, vlines: D.events.map((e) => ({ x: e.t, label: e.name })),
      series: [
        { kind: 'line', color: '#d97706', fill: 'rgba(245,158,11,0.15)', width: 2.8, pts: T.map((r) => [r.t, r.los]), label: 'Ground deformation (LoS)' },
        { kind: 'line', color: '#94a3b8', width: 1.5, dash: [6, 4], pts: T.map((r) => [r.t, r.atm]), label: 'Atmospheric delay' },
        { kind: 'dots', color: '#0891b2', r: 3.6, pts: T.map((r) => [r.t, r.obs]), label: 'Measured by each interferogram' },
      ],
    });
    return cv.toDataURL('image/png');
  } catch (e) { console.warn('series chart', e); return null; }
}
function profileChartPng(D) {
  try {
    const P = D.profile, W = 1000, H = 560, { cv, g } = chartCanvas(W, H), stepKm = niceStep(P.lenKm / 8), xTicks = [];
    for (let v = 0; v <= P.lenKm + 1e-9; v += stepKm) xTicks.push([v, `${chartTick(v)} km`]);
    const pts = (f) => P.rows.map((r) => [r.d, f(r)]);
    chartPanel(g, { x: 78, y: 56, w: W - 104, h: 200 }, {
      title: 'Cross-section · surface', yLabel: 'elevation (m)', xMin: 0, xMax: P.lenKm, xTicks,
      series: [
        { kind: 'line', color: '#7c5a3a', fill: 'rgba(146,104,64,0.22)', fillTo: 'bottom', width: 2, pts: pts((r) => r.elev), label: 'Ground' },
        { kind: 'line', color: '#16a34a', width: 1.6, pts: pts((r) => r.canopy), label: 'Canopy top' },
        { kind: 'line', color: '#2563eb', width: 2, pts: pts((r) => r.water), label: 'Water surface' },
      ],
    });
    chartPanel(g, { x: 78, y: 336, w: W - 104, h: 176 }, {
      title: 'True displacement along the line', sub: `pair ${D.meta.pair}`, yLabel: 'mm', xMin: 0, xMax: P.lenKm, xTicks, zero: true,
      series: [
        { kind: 'line', color: '#d97706', width: 2.4, pts: pts((r) => r.up), label: 'Vertical (up +)' },
        { kind: 'line', color: '#0891b2', width: 2.4, pts: pts((r) => r.los), label: 'Line of sight (toward +)' },
      ],
    });
    return cv.toDataURL('image/png');
  } catch (e) { console.warn('profile chart', e); return null; }
}

// ───────────── Excel workbook (ExcelJS) ─────────────
const XC = {
  navy: 'FF07111F', navy2: 'FF0E2238', navy3: 'FF1B3A5C', ink: 'FFDCEBFA', dim: 'FF8EA6BE', gold: 'FFFFB648', cyan: 'FF3EE6FF', red: 'FFFF4A4A',
  text: 'FF1B2533', text2: 'FF475569', zebra: 'FFF4F7FB', white: 'FFFFFFFF', grid: 'FFD6DEE8', link: 'FF0563C1', evBg: 'FFFFE3E3', evFg: 'FFB42318',
};
const xlFill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const xlFont = (o = {}) => Object.assign({ name: 'Calibri', size: 10, color: { argb: XC.text } }, o);
const xlBorder = (argb = XC.grid) => { const s = { style: 'thin', color: { argb } }; return { top: s, left: s, bottom: s, right: s }; };
const argbOf = (c) => 'FF' + c.map((x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const inkOn = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.5 ? 'FF0B1320' : 'FFFFFFFF');
const qz = (x, n) => Math.round(x * n) / n;                    // quantised colour inputs keep the style table small
const xlCol = (c) => ({ bg: argbOf(c), fg: inkOn(c) });
const colLos = (v, R) => xlCol(divergingRGB(qz(clamp(v / R, -1, 1), 24)));
const colPhase = (v) => xlCol(phaseRGB(qz(v, 10)));
const colCoh = (v) => xlCol(coherenceRGB(qz(clamp(v, 0, 1), 40)));
const colTint = (hex, f) => { const c = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16) / 255); const t = qz(clamp(f, 0, 1), 20) * 0.85; return xlCol(c.map((x) => 1 + (x - 1) * t)); };
function xlLines(text, width, size = 10) {
  const per = Math.max(4, width * 1.18 * 10 / size);
  return String(text === null || text === undefined ? '' : text).split('\n').reduce((s, p) => s + Math.max(1, Math.ceil(p.length / per)), 0);
}
function xlRangeStyle(ws, r, c0, c1, fill, border) { for (let c = c0; c <= c1; c++) { const cell = ws.getCell(r, c); if (fill) cell.fill = xlFill(fill); if (border) cell.border = border; } }
function xlSheet(wb, name, { tab, widths, title, sub, zoom = 100 }) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: tab } }, views: [{ showGridLines: false, zoomScale: zoom }] });
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const X = { ws, span: widths.length, row: 1, widths, width: widths.reduce((a, b) => a + b, 0) };
  xlBand(X, title, { size: 18, bold: true, color: XC.gold, fill: XC.navy, h: 34 });
  xlBand(X, sub, { size: 10, color: XC.ink, fill: XC.navy, h: Math.max(20, xlLines(sub, X.width, 10) * 14 + 6) });
  xlBand(X, '', { fill: XC.gold, h: 3 });
  X.row++;
  return X;
}
function xlBand(X, text, { size = 10, bold = false, italic = false, color = XC.text2, fill = null, h = null } = {}) {
  const ws = X.ws, r = X.row++;
  if (X.span > 1) ws.mergeCells(r, 1, r, X.span);
  const c = ws.getCell(r, 1);
  c.value = text === '' ? null : text;
  c.font = xlFont({ size, bold, italic, color: { argb: color } });
  c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left', indent: 1 };
  if (fill) xlRangeStyle(ws, r, 1, X.span, fill, null);
  ws.getRow(r).height = h || Math.min(409, Math.max(15, xlLines(text, X.width - 2, size) * size * 1.32 + 6));
  return r;
}
function xlSection(X, text, accent = XC.gold) {
  const ws = X.ws, r = X.row++;
  if (X.span > 1) ws.mergeCells(r, 1, r, X.span);
  const c = ws.getCell(r, 1);
  c.value = text.toUpperCase();
  c.font = xlFont({ size: 10.5, bold: true, color: { argb: XC.white } });
  c.alignment = { vertical: 'middle', indent: 1 };
  xlRangeStyle(ws, r, 1, X.span, XC.navy2, null);
  c.border = { left: { style: 'thick', color: { argb: accent } } };
  ws.getRow(r).height = 21;
  return r;
}
/** a styled table; color(n, i, v) may return { bg, fg, bold, u } for a cell */
function xlTable(X, headers, rows, opt = {}) {
  const ws = X.ws, hr = X.row++, { fmts = [], notes = [], color = null, wrap = [], headerH = 30 } = opt;
  headers.forEach((t, i) => {
    const c = ws.getCell(hr, i + 1);
    c.value = t; c.font = xlFont({ bold: true, size: 9.5, color: { argb: XC.white } }); c.fill = xlFill(XC.navy3);
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = xlBorder(XC.navy3);
    if (notes[i]) c.note = notes[i];
  });
  ws.getRow(hr).height = headerH;
  rows.forEach((rowv, n) => {
    const r = X.row++;
    let lines = 1;
    rowv.forEach((v0, i) => {
      const c = ws.getCell(r, i + 1), v = v0 === undefined || (typeof v0 === 'number' && !Number.isFinite(v0)) ? null : v0;
      c.value = v;
      const isNum = typeof v === 'number';
      if (isNum && fmts[i]) c.numFmt = fmts[i];
      c.border = xlBorder();
      c.alignment = { vertical: 'top', horizontal: isNum ? 'right' : 'left', wrapText: wrap.includes(i) };
      const st = color ? color(n, i, v) : null;
      if (st) { c.fill = xlFill(st.bg); c.font = xlFont({ color: { argb: st.fg || XC.text }, bold: !!st.bold, underline: !!st.u }); }
      else { c.font = xlFont(); if (n % 2) c.fill = xlFill(XC.zebra); }
      if (wrap.includes(i) && typeof v === 'string') lines = Math.max(lines, xlLines(v, X.widths[i]));
    });
    if (lines > 1) ws.getRow(r).height = Math.min(409, lines * 13.2 + 4);
  });
  return { hr, r0: hr + 1, r1: X.row - 1 };
}
/** one row of merged blocks: parts = [{ c0, c1, v, fmt, bold, color, bg, align }] */
function xlMergedRow(X, parts, { header = false, zebra = false } = {}) {
  const ws = X.ws, r = X.row++;
  let lines = 1;
  for (const p of parts) {
    if (p.c1 > p.c0) ws.mergeCells(r, p.c0, r, p.c1);
    const c = ws.getCell(r, p.c0), v = p.v === undefined || (typeof p.v === 'number' && !Number.isFinite(p.v)) ? null : p.v;
    c.value = v;
    if (typeof v === 'number' && p.fmt) c.numFmt = p.fmt;
    c.font = header ? xlFont({ bold: true, size: 9.5, color: { argb: XC.white } }) : xlFont({ bold: !!p.bold, color: { argb: p.color || XC.text } });
    c.alignment = { wrapText: true, vertical: header ? 'middle' : 'top', horizontal: header ? 'center' : p.align || (typeof v === 'number' ? 'right' : 'left') };
    xlRangeStyle(ws, r, p.c0, p.c1, header ? XC.navy3 : p.bg || (zebra ? XC.zebra : XC.white), xlBorder(header ? XC.navy3 : XC.grid));
    let w = 0; for (let k = p.c0; k <= p.c1; k++) w += X.widths[k - 1];
    if (typeof v === 'string') lines = Math.max(lines, xlLines(v, w));
  }
  ws.getRow(r).height = header ? 26 : Math.min(409, lines * 13.2 + 4);
  return r;
}
function xlImage(wb, X, url, ext, wpx, hpx, col = 0.15) {
  if (!url) return;
  const id = wb.addImage({ base64: url, extension: ext });
  const r0 = X.row, nRows = Math.ceil((hpx + 8) / 20);
  for (let r = r0; r < r0 + nRows; r++) X.ws.getRow(r).height = 15;
  X.ws.addImage(id, { tl: { col, row: r0 - 1 + 0.2 }, ext: { width: wpx, height: hpx }, editAs: 'oneCell' });
  X.row += nRows;
}

async function buildWorkbook(ExcelJS, D, snap) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CHRONO-SAR'; wb.lastModifiedBy = 'CHRONO-SAR'; wb.created = new Date(); wb.modified = new Date();
  wb.title = `CHRONO-SAR · ${D.meta.siteName}`; wb.subject = 'NISAR InSAR data export'; wb.company = CFG.team;
  const radar = await radarImages(D);
  const seriesPng = seriesChartPng(D), profilePng = D.profile ? profileChartPng(D) : null;
  const plan = [
    ['Pixel', 'Every quantity at the inspected pixel, L- and S-band side by side, with its meaning and formula.', `${D.pixel.rows.filter((r) => !r.sec).length} parameters`],
    ['Time series', 'The 29 passes at that pixel: deformation, atmosphere, measured LoS, 3D motion, coherence, phase and events, with a chart.', '29 passes × 16 columns'],
    ['LoS map', 'Line-of-sight ground displacement of the current pair over the whole scene.', '48 × 48 cells'],
    ['Phase map', 'The interferogram itself: wrapped phase of the current pair.', '48 × 48 cells'],
    ['Coherence map', 'Interferometric coherence γ of the current pair.', '48 × 48 cells'],
    ['Radar images', 'The four observables as pictures, rendered like the app.', `${radar.filter(Boolean).length} images`],
    ['KPIs', 'The scenario\'s headline numbers at the exported date.', `${D.kpis.length} indicators`],
  ];
  if (D.ccd) plan.push(['CCD alerts', 'Coherence change detection: every change polygon with area, volume and statistics.', `${D.ccd.comps.length} polygon(s)`]);
  if (D.unwrap) plan.push(['Unwrapping', 'Quality report of the phase unwrapping you ran.', `${D.unwrap.rows.length} indicators`]);
  if (D.profile) plan.push(['Cross-section', 'Elevation and true displacement along the line you drew, with a chart.', `${D.profile.rows.length} samples`]);
  plan.push(['Glossary', 'Every term and formula used in the workbook.', `${GLOSSARY.length} terms`]);
  sheetReadme(wb, D, snap, plan); await sleep(0);
  sheetPixel(wb, D); await sleep(0);
  sheetSeries(wb, D, seriesPng); await sleep(0);
  sheetMap(wb, D, 'los'); await sleep(0);
  sheetMap(wb, D, 'phase'); await sleep(0);
  sheetMap(wb, D, 'coh'); await sleep(0);
  sheetImages(wb, D, radar);
  sheetKpis(wb, D);
  if (D.ccd) sheetCcd(wb, D);
  if (D.unwrap) sheetUnwrap(wb, D);
  if (D.profile) sheetProfile(wb, D, profilePng);
  sheetGlossary(wb);
  await sleep(0);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function sheetReadme(wb, D, snap, plan) {
  const M = D.meta, X = xlSheet(wb, 'README', { tab: XC.gold, widths: [30, 46, 84], title: 'CHRONO-SAR · NISAR DATA DOWNLINK', sub: `${M.siteName}${M.region ? ' · ' + M.region : ''} · ${M.waltz} · exported ${M.iso}` });
  xlBand(X, `NASA Space Apps Challenge 2026 · "Dancing with the SARs" · ${CFG.team}. This workbook holds every number behind the view you exported. Each dataset has its own sheet that says what it is, how it was computed and how to read it.`, { size: 10.5, color: XC.text });
  X.row++;
  if (snap) {
    const wpx = 820, hpx = Math.round(wpx * snap.h / snap.w);
    xlImage(wb, X, snap.url, 'jpeg', wpx, hpx);
    xlBand(X, `3D view at export: ${M.modeName} · ${M.bandShort} · vertical exaggeration ×${M.exagTxt} (visual only; every number in this workbook is at true scale).`, { size: 9, italic: true });
    X.row++;
  }
  xlSection(X, 'Scene');
  xlTable(X, ['Field', 'Value', 'What it means'], D.metaRows, { wrap: [1, 2], color: (n, i) => (i === 0 ? { bg: n % 2 ? XC.zebra : XC.white, fg: XC.text, bold: true } : null) });
  X.row++;
  xlSection(X, 'How to read this workbook', XC.cyan);
  D.howTo.forEach((t, n) => xlBand(X, `${n + 1}.  ${t}`, { size: 10, color: XC.text }));
  X.row++;
  xlSection(X, 'Sheets in this workbook', XC.cyan);
  xlTable(X, ['Sheet (click to open)', 'Size', 'Contents'], plan.map(([name, desc, size]) => [{ formula: `HYPERLINK("#'${name}'!A1","${name}")`, result: name }, size, desc]), {
    wrap: [2], color: (n, i) => (i === 0 ? { bg: n % 2 ? XC.zebra : XC.white, fg: XC.link, u: true, bold: true } : null),
  });
  if (D.missing.length) xlBand(X, `Not in this export (run them in the app first, then export again): ${D.missing.join(' · ')}.`, { size: 9.5, italic: true });
  X.row++;
  xlSection(X, 'Colour scales', XC.cyan);
  const sw = (c, text, rgb) => ({ c0: c, c1: c, v: text, bg: argbOf(rgb), color: inkOn(rgb), bold: true });
  xlMergedRow(X, [{ c0: 1, c1: 1, v: 'LoS displacement', bold: true }, sw(2, '−  moving away from the satellite (subsidence)', divergingRGB(-1)), sw(3, '+  moving toward the satellite (uplift); slate in between = no motion', divergingRGB(1))]);
  xlMergedRow(X, [{ c0: 1, c1: 1, v: 'Wrapped phase', bold: true }, sw(2, '−π … +π: a colour wheel', phaseRGB(-1.2)), sw(3, `one full colour cycle = one fringe = λ/2 (L-band 11.9 cm, S-band 4.7 cm)`, phaseRGB(1.4))]);
  xlMergedRow(X, [{ c0: 1, c1: 1, v: 'Coherence γ', bold: true }, sw(2, '0 · noise: the surface changed or is water', coherenceRGB(0.08)), sw(3, '1 · identical echoes: phase fully usable', coherenceRGB(0.97))]);
  xlMergedRow(X, [{ c0: 1, c1: 1, v: 'Freeman–Durden', bold: true }, sw(2, 'red = double bounce   ·   green = volume', [1, 0.33, 0.4]), sw(3, 'blue = surface   ·   brightness = total backscattered power', [0.35, 0.59, 1])]);
  X.row++;
  xlSection(X, 'Data honesty', XC.red);
  D.honesty.forEach((t) => xlBand(X, t, { size: 10, color: XC.text }));
  X.row++;
  xlBand(X, `Generated in the browser by CHRONO-SAR (three.js · ExcelJS) on ${M.iso}.`, { size: 8.5, italic: true, color: XC.dim });
}
function sheetPixel(wb, D) {
  const P = D.pixel, M = D.meta, widths = [36, 17, 17, 9, 62, 52];
  const X = xlSheet(wb, 'Pixel', { tab: XC.cyan, widths, title: 'PIXEL INSPECTOR', sub: `Grid cell ${P.i}, ${P.j} · ${P.latlon} · ${P.surface} · pair ${M.pair}` });
  xlBand(X, 'Everything the live inspector shows for one pixel, with both NISAR bands side by side. Coloured cells use the app\'s colour maps: phase as a colour wheel, LoS motion from blue (away) to red (toward), coherence from dark (noise) to white-cyan (excellent), scattering powers tinted red / green / blue.', { size: 10, color: XC.text });
  X.row++;
  xlMergedRow(X, ['Parameter', P.dual ? 'L-band (NASA/JPL)' : 'Value', P.dual ? 'S-band (ISRO)' : '', 'Unit', 'What it means', 'How it is computed'].map((v, i) => ({ c0: i + 1, c1: i + 1, v })), { header: true });
  const hr = X.row - 1;
  const tint = { pd: '#ff5466', pv: '#59ff9a', ps: '#5a96ff' };
  const style = (r, v) => {
    if (typeof v !== 'number') return {};
    if (r.col === 'phase') { const s = colPhase(v); return { bg: s.bg, color: s.fg }; }
    if (r.col === 'los') { const s = colLos(v, D.grid.losR); return { bg: s.bg, color: s.fg }; }
    if (r.col === 'coh') { const s = colCoh(v); return { bg: s.bg, color: s.fg }; }
    if (tint[r.col]) { const s = colTint(tint[r.col], v / 100); return { bg: s.bg, color: s.fg }; }
    return {};
  };
  let n = 0;
  for (const r of P.rows) {
    if (r.sec) { xlSection(X, r.sec, XC.cyan); n = 0; continue; }
    const z = n++ % 2 === 1, parts = [{ c0: 1, c1: 1, v: r.p, bold: true }];
    if (r.one !== undefined) parts.push({ c0: 2, c1: 3, v: r.one, fmt: r.fmt, align: typeof r.one === 'number' ? 'right' : 'center', ...style(r, r.one) });
    else { parts.push({ c0: 2, c1: 2, v: r.L, fmt: r.fmt, ...style(r, r.L) }); parts.push({ c0: 3, c1: 3, v: r.S === null ? 'n/a' : r.S, fmt: r.fmt, align: r.S === null ? 'center' : undefined, ...style(r, r.S) }); }
    parts.push({ c0: 4, c1: 4, v: r.unit || '', align: 'center' }, { c0: 5, c1: 5, v: r.meaning, color: XC.text2 }, { c0: 6, c1: 6, v: r.method, color: XC.text2 });
    xlMergedRow(X, parts, { zebra: z });
  }
  X.ws.views = [{ state: 'frozen', xSplit: 0, ySplit: hr, showGridLines: false }];
}
function sheetSeries(wb, D, chartUrl) {
  const T = D.series, M = D.meta, widths = [7.5, 11.5, 6.5, 12.5, 11.5, 12.5, 10, 10, 10, 10, 10, 10, 11, 11, 9.5, 30];
  const X = xlSheet(wb, 'Time series', { tab: XC.gold, widths, title: 'TIME SERIES · 29 NISAR PASSES', sub: `Pixel ${D.pixel.latlon} · ${D.pixel.surface} · ${M.bandShort} · ${M.geomShort}` });
  xlBand(X, `The ${CFG.nEpochs} NISAR passes of this scenario at the inspected pixel: E00 = ${fmtDate(dateAt(0))}, then every 12 days for ${CFG.tMax} days. Each table row is one pass.`, { size: 10, color: XC.text });
  xlBand(X, 'In the chart the gold curve is the ground deformation along the line of sight, the cyan dots are what one interferogram from E00 to that pass would really measure (deformation + atmosphere + noise) and the dashed grey curve is the atmospheric delay alone. Red dashed lines mark catalogued events.', { size: 10, color: XC.text });
  xlBand(X, 'Cells are coloured with the app\'s colour maps. Every column header has a note (hover it), and the column guide under the table explains each column.', { size: 10, color: XC.text2 });
  X.row++;
  if (chartUrl) { xlImage(wb, X, chartUrl, 'png', 1000, 380); X.row++; }
  xlSection(X, 'Passes E00 → E28 (every 12 days)');
  const headers = ['Epoch', 'Date', 'Day', 'LoS deformation (mm)', 'Atmosphere (mm)', 'Measured LoS (mm)', 'Noise 1σ (mm)', 'East (mm)', 'North (mm)', 'Up (mm)', 'γ L-band 12-day pair', 'γ S-band 12-day pair', 'Phase L wrapped (rad)', 'Phase S wrapped (rad)', 'Fringes L-band', 'Event since the previous pass'];
  const rows = T.rows.map((r) => [r.epoch, r.date, r.t, r.los, r.atm, r.obs, r.sig, r.E, r.N, r.U, r.gL, r.gS, r.wL, r.wS, r.frL, r.ev || '']);
  const tb = xlTable(X, headers, rows, {
    fmts: [null, null, '0', '0.0', '0.0', '0.0', '0.0', '0.0', '0.0', '0.0', '0.00', '0.00', '0.00', '0.00', '0.00', null], notes: T.notes, wrap: [15], headerH: 44,
    color: (n, i, v) => {
      if (v === null || v === '') return null;
      if (i === 3 || i === 5) return colLos(v, T.losR);
      if (i === 4) return colLos(v, T.atmR);
      if (i === 10 || i === 11) return colCoh(v);
      if (i === 12 || i === 13) return colPhase(v);
      if (i === 15) return { bg: XC.evBg, fg: XC.evFg, bold: true };
      return null;
    },
  });
  X.ws.autoFilter = { from: { row: tb.hr, column: 1 }, to: { row: tb.r1, column: headers.length } };
  X.row++;
  xlSection(X, 'Column guide', XC.cyan);
  xlMergedRow(X, [{ c0: 1, c1: 3, v: 'Column' }, { c0: 4, c1: 10, v: 'What it means' }, { c0: 11, c1: 15, v: 'Formula / source' }, { c0: 16, c1: 16, v: 'Unit' }], { header: true });
  T.guide.forEach(([a, b, c, d], n) => xlMergedRow(X, [{ c0: 1, c1: 3, v: a, bold: true }, { c0: 4, c1: 10, v: b, color: XC.text2 }, { c0: 11, c1: 15, v: c, color: XC.text2 }, { c0: 16, c1: 16, v: d, align: 'center' }], { zebra: n % 2 === 1 }));
}
function sheetMap(wb, D, kind) {
  const G = D.grid, M = D.meta, m2 = D.losUnit === 'm', disp = G.losMaxAbs / (m2 ? 1000 : 1), losFmt = disp >= 99.95 ? '0' : disp >= 9.995 ? '0.0' : '0.00';
  const cfg = {
    los: { name: 'LoS map', tab: 'FFFF6B2C', title: `LoS DISPLACEMENT MAP (${D.losUnit})`, data: G.los, scale: m2 ? 0.001 : 1, fmt: losFmt, col: (v) => colLos(v, G.losR) },
    phase: { name: 'Phase map', tab: 'FFB28CFF', title: 'INTERFEROGRAM · WRAPPED PHASE (rad)', data: G.phase, scale: 1, fmt: '0.00', col: (v, r, c) => (G.coh[r][c] < 0.25 ? { bg: 'FF2A3038', fg: 'FF8A96A3' } : colPhase(v)) },
    coh: { name: 'Coherence map', tab: XC.cyan, title: 'COHERENCE MAP γ (0–1)', data: G.coh, scale: 1, fmt: '0.00', col: (v) => colCoh(v) },
  }[kind];
  const widths = [11].concat(new Array(G.G).fill(4.3));
  const X = xlSheet(wb, cfg.name, { tab: cfg.tab, widths, title: cfg.title, sub: `${M.siteName} · pair ${M.pair} · ${M.bandShort} · ${M.geomShort}`, zoom: 85 });
  D.mapText[kind].forEach((t) => xlBand(X, t, { size: 10, color: XC.text }));
  xlBand(X, D.mapScale[kind], { size: 9.5, italic: true });
  X.row++;
  const ws = X.ws, hr = X.row++;
  const c0 = ws.getCell(hr, 1);
  c0.value = 'lat \\ lon'; c0.font = xlFont({ size: 8, bold: true, color: { argb: XC.gold } }); c0.fill = xlFill(XC.navy); c0.alignment = { horizontal: 'center', vertical: 'middle' };
  G.lon.forEach((lon, c) => {
    const cell = ws.getCell(hr, c + 2);
    cell.value = Number(lon.toFixed(4)); cell.numFmt = '0.000';
    cell.font = xlFont({ size: 7.5, bold: true, color: { argb: XC.white } }); cell.fill = xlFill(XC.navy3);
    cell.alignment = { textRotation: 90, horizontal: 'center', vertical: 'middle' };
  });
  ws.getRow(hr).height = 46;
  for (let r = 0; r < G.G; r++) {
    const rr = X.row++, lc = ws.getCell(rr, 1);
    lc.value = Number(G.lat[r].toFixed(4)); lc.numFmt = '0.000';
    lc.font = xlFont({ size: 8, bold: true, color: { argb: XC.white } }); lc.fill = xlFill(XC.navy3); lc.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 0; c < G.G; c++) {
      const v = cfg.data[r][c], cell = ws.getCell(rr, c + 2);
      if (!Number.isFinite(v)) { cell.value = null; cell.border = xlBorder(); continue; }
      const st = cfg.col(v, r, c);
      cell.value = Number((v * cfg.scale).toFixed(kind === 'los' ? 3 : 4));
      cell.numFmt = cfg.fmt; cell.fill = xlFill(st.bg); cell.font = xlFont({ size: 7, color: { argb: st.fg } });
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    ws.getRow(rr).height = 21;
  }
}
function sheetImages(wb, D, R) {
  const M = D.meta, X = xlSheet(wb, 'Radar images', { tab: 'FF4CF2A8', widths: [2, 52, 3, 52, 2], title: 'RADAR IMAGES', sub: `${M.siteName} · pair ${M.pair} · ${M.bandShort} · ${M.geomShort}` });
  xlBand(X, 'The four observables of the current state, rendered with the same colour maps and hillshade as the app. Use them in reports; the numbers behind them are on the map sheets.', { size: 10, color: XC.text });
  X.row++;
  for (let p = 0; p < 2; p++) {
    const a = R[p * 2], b = R[p * 2 + 1], r0 = X.row, nRows = 19;
    for (let r = r0; r < r0 + nRows; r++) X.ws.getRow(r).height = 15;
    [a, b].forEach((im, s) => { if (!im) return; const id = wb.addImage({ base64: im.url, extension: 'jpeg' }); X.ws.addImage(id, { tl: { col: s ? 3.05 : 1.05, row: r0 - 1 + 0.3 }, ext: { width: 350, height: 350 }, editAs: 'oneCell' }); });
    X.row += nRows;
    const rt = X.row++, rx = X.row++;
    let mx = 1;
    [a, b].forEach((im, s) => {
      if (!im) return;
      const ct = X.ws.getCell(rt, s ? 4 : 2); ct.value = im.title; ct.font = xlFont({ bold: true, size: 11.5 });
      const cx = X.ws.getCell(rx, s ? 4 : 2); cx.value = im.text; cx.font = xlFont({ size: 9.5, color: { argb: XC.text2 } }); cx.alignment = { wrapText: true, vertical: 'top' };
      mx = Math.max(mx, xlLines(im.text, 52, 9.5));
    });
    X.ws.getRow(rt).height = 18; X.ws.getRow(rx).height = Math.min(409, mx * 12.6 + 6);
    X.row++;
  }
}
function sheetKpis(wb, D) {
  const M = D.meta, X = xlSheet(wb, 'KPIs', { tab: 'FFFFD166', widths: [34, 20, 24, 92], title: 'SCENE KPIs', sub: `${M.siteName} · ${M.epochCur} · ${M.dateCur}` });
  xlBand(X, 'The headline numbers of the scenario at the exported date, as shown in the Scenario Intel panel. They change with time in the app: press play or drag the timeline, then export again to compare dates.', { size: 10, color: XC.text });
  X.row++;
  xlTable(X, ['Indicator', 'Value', 'Unit', 'What it means'], D.kpis.map((q) => [q.k, q.v, q.u, q.meaning]), {
    wrap: [2, 3], color: (n, i) => (i === 0 || i === 1 ? { bg: n % 2 ? XC.zebra : XC.white, fg: i ? 'FF0B1320' : XC.text, bold: true } : null),
  });
}
function sheetCcd(wb, D) {
  const C = D.ccd, widths = [6, 34, 12, 11, 15, 10, 11, 12, 12, 12, 9];
  const X = xlSheet(wb, 'CCD alerts', { tab: XC.red, widths, title: 'COHERENCE CHANGE DETECTION · ALERTS', sub: `${D.meta.siteName} · ${C.band}-band · SLCs ${C.dates.join(' · ')}` });
  xlBand(X, `METHOD: three single-look complex (SLC) images are simulated at ${C.dates.join(', ')}. Coherence is estimated with a 5 × 5 window (integral images) for the pre-event pair and for the co-event pair. A pixel is flagged when coherence drops by more than 0.35 (where it was above 0.45) or when the backscatter changes by more than 4.5 dB. A 3 × 3 majority filter removes speckle; connected regions of at least 10 pixels become polygons, and polygons that overlap a catalogued event take its name, area and volume.`, { size: 10, color: XC.text });
  xlBand(X, 'READING: each row below is one change polygon, drawn as a red fence in the app. Δγ is the coherence lost between the two pairs; ΔI is the backscatter change (+ brighter, − darker).', { size: 10, color: XC.text2 });
  X.row++;
  xlSection(X, 'Summary', XC.red);
  C.summary.forEach(([k, v, u, m], n) => xlMergedRow(X, [{ c0: 1, c1: 2, v: k, bold: true }, { c0: 3, c1: 4, v, fmt: typeof v === 'number' ? (v >= 1e4 ? '#,##0' : '0.000') : undefined, bold: true }, { c0: 5, c1: 5, v: u, align: 'center' }, { c0: 6, c1: 11, v: m, color: XC.text2 }], { zebra: n % 2 === 1 }));
  X.row++;
  xlSection(X, 'Change polygons', XC.red);
  if (C.comps.length) {
    xlTable(X, ['#', 'Label', 'Catalogued event', 'Area (km²)', 'Volume (m³)', 'Mean Δγ', 'Mean ΔI (dB)', 'Overlap with event (%)', 'Centroid lat', 'Centroid lon', 'Pixels'], C.comps, {
      fmts: ['0', null, null, '0.000', '#,##0', '0.00', '0.0', '0', '0.0000', '0.0000', '#,##0'], wrap: [1], headerH: 36,
      color: (n, i, v) => (i === 2 && v === 'yes' ? { bg: XC.evBg, fg: XC.evFg, bold: true } : null),
    });
  } else xlBand(X, 'No change polygon: the surface stayed stable between the two pairs.', { size: 10, italic: true });
}
function sheetUnwrap(wb, D) {
  const X = xlSheet(wb, 'Unwrapping', { tab: XC.gold, widths: [30, 22, 10, 90], title: 'PHASE UNWRAPPING REPORT', sub: `${D.meta.siteName} · ${D.meta.pair}` });
  xlBand(X, 'METHOD: quality-guided flood fill. Starting at the reference pixel, a priority queue always grows the unwrapped area into the most coherent neighbouring pixel and adds the multiple of 2π that keeps the phase continuous. Pixels with coherence of 0.3 or less and open water are skipped; disconnected coherent islands are unwrapped from their own seeds.', { size: 10, color: XC.text });
  xlBand(X, 'CHECK: the simulation knows the true phase, so the error of the unwrapper can be measured exactly. An RMS error well below 1 rad and no 2π errors mean the unwrapped map is trustworthy.', { size: 10, color: XC.text2 });
  X.row++;
  xlTable(X, ['Indicator', 'Value', 'Unit', 'What it means'], D.unwrap.rows, { wrap: [3], color: (n, i) => (i === 1 ? { bg: n % 2 ? XC.zebra : XC.white, fg: 'FF0B1320', bold: true } : null) });
}
function sheetProfile(wb, D, chartUrl) {
  const P = D.profile, widths = [12, 12, 12, 15, 14, 14, 12, 12, 40], pr = Math.max(0.5, robustAbs([P.rows.map((q) => q.los).concat(P.rows.map((q) => q.up))], 1));
  const X = xlSheet(wb, 'Cross-section', { tab: 'FF9FD0FF', widths, title: 'CROSS-SECTION', sub: `${D.meta.siteName} · ${fmt(P.lenKm, 2)} km line · pair ${D.meta.pair}` });
  xlBand(X, `The line you drew with the CROSS-SECTION tool, sampled at ${P.rows.length} points (${fmt(P.lenKm / (P.rows.length - 1) * 1000, 0)} m apart). For each point: position, ground elevation, canopy top and water surface where present, and the true displacement since the reference pass at true scale (the app exaggerates it for display).`, { size: 10, color: XC.text });
  X.row++;
  if (chartUrl) { xlImage(wb, X, chartUrl, 'png', 1000, 560); X.row++; }
  const rows = P.rows.map((r) => [r.d, r.lat, r.lon, r.elev, r.canopy, r.water, r.up, r.los, r.surface]);
  xlTable(X, ['Distance (km)', 'Latitude', 'Longitude', 'Ground elevation (m)', 'Canopy top (m)', 'Water surface (m)', 'Up (mm)', 'LoS (mm)', 'Surface'], rows, {
    fmts: ['0.000', '0.00000', '0.00000', '0.0', '0.0', '0.00', '0.0', '0.0'], headerH: 34,
    color: (n, i, v) => ((i === 6 || i === 7) && typeof v === 'number' ? colLos(v, pr) : null),
  });
}
function sheetGlossary(wb) {
  const X = xlSheet(wb, 'Glossary', { tab: 'FF8EA6BE', widths: [26, 92, 42], title: 'GLOSSARY & FORMULAS', sub: 'The terms used across this workbook, in plain language' });
  xlTable(X, ['Term', 'Definition', 'Formula / typical value'], GLOSSARY, { wrap: [1, 2], color: (n, i) => (i === 0 ? { bg: n % 2 ? XC.zebra : XC.white, fg: XC.text, bold: true } : null) });
}

// ───────────── CSV pack (ZIP) ─────────────
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function deflateRaw(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  try { const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); }
  catch (e) { return null; }
}
async function makeZip(files) {
  const enc = new TextEncoder(), now = new Date(), parts = [], central = [];
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data);
    let comp = await deflateRaw(f.data), method = 8;
    if (!comp || comp.length >= f.data.length) { comp = f.data; method = 0; }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, comp.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, comp);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + comp.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
function csvCell(v) {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvText = (header, rows) => '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const rnd = (x, d = 4) => (typeof x === 'number' && Number.isFinite(x) ? Number(x.toFixed(d)) : x);
function wrapTxt(s, w = 96, ind = '') {
  const out = [];
  for (const para of String(s).split('\n')) {
    let line = ind;
    for (const word of para.split(/\s+/)) { if (!word) continue; if ((line + word).length > w && line.trim()) { out.push(line.replace(/\s+$/, '')); line = ind; } line += word + ' '; }
    out.push(line.replace(/\s+$/, ''));
  }
  return out.join('\r\n');
}
function csvReadme(D) {
  const M = D.meta, L = [], P = (s = '') => L.push(s), W = (s, ind = '  ') => L.push(wrapTxt(s, 98, ind));
  const H = (s) => { P(); P(s); P('-'.repeat(s.length)); };
  const cols = (list) => { const w = Math.max(...list.map((c) => c[0].length)) + 2; for (const [c, m] of list) L.push(wrapTxt(`${c.padEnd(w, '.')} ${m}`, 98, '    ').replace(/^ {4}/, '    ')); };
  P('CHRONO-SAR · NISAR DATA DOWNLINK · CSV PACK'); P('='.repeat(43));
  P(`Scene ......... ${M.siteName}${M.region ? ' (' + M.region + ')' : ''}`);
  P(`Waltz ......... ${M.waltz}`);
  P(`Pair .......... ${M.pair}`);
  P(`Band .......... ${M.bandShort} · geometry: ${M.geomShort}`);
  P(`Pixel ......... ${D.pixel.latlon} (grid cell ${D.pixel.i}, ${D.pixel.j}) · ${D.pixel.surface}`);
  P(`Exported ...... ${M.iso} · NASA Space Apps Challenge 2026 · "Dancing with the SARs" · ${CFG.team}`);
  H('FORMAT');
  W('All files are UTF-8 (with BOM), comma-separated, with a dot as decimal separator and one header row. An empty cell means "not applicable". Units are part of the column names (mm, m, rad, deg, km2, m3). Positive line-of-sight (LoS) values always mean motion toward the satellite. Coordinates are WGS84 degrees.');
  W('Excel with a semicolon list separator (e.g. Romanian or German settings): use Data > From Text/CSV and pick "Comma", or simply open the .xlsx export, which has the same data with colours and explanations.');
  H('FILES');
  P('01_scene_metadata.csv'); W('Where, when and how: scene, pair of passes, radar band, viewing geometry, data provenance.'); cols([['field', 'name of the setting'], ['value', 'its value'], ['meaning', 'what it means']]);
  P(); P('02_pixel_inspector.csv'); W('Everything the live inspector shows for the inspected pixel (the one you clicked, or the scenario\'s point of interest), with both bands. Band-independent quantities repeat the same value in both value columns.');
  cols([['section', 'group: location, interferometry, geometry, 3D motion, polarimetry, vegetation, water'], ['parameter', 'name of the quantity'], ['value_L_band / value_S_band', 'its value for L-band (NASA/JPL, 23.85 cm) and S-band (ISRO, 9.37 cm)'], ['unit', 'unit of the value'], ['meaning', 'plain-language explanation'], ['method', 'formula or model used']]);
  P(); P('03_time_series.csv'); W(`The ${CFG.nEpochs} NISAR passes (E00 = ${fmtDate(dateAt(0))}, every 12 days) at the inspected pixel.`);
  cols(D.series.guide.map(([c, m, f, u]) => [c, `${m}${f ? ' [' + f + ']' : ''}${u ? ' (' + u + ')' : ''}`]));
  W('Column names in the file: epoch, date, day, los_deformation_mm, atmosphere_mm, observed_los_mm, noise_1sigma_mm, east_mm, north_mm, up_mm, coherence_L_12day, coherence_S_12day, wrapped_phase_L_rad, wrapped_phase_S_rad, fringes_L, event.', '    ');
  P(); P('04_grid_48x48.csv'); W(`The whole scene on a 48 x 48 grid (every 8th cell of the ${M.N} x ${M.N} simulation, ${fmt(M.extKm, 1)} km across), one row per sample ("long" format). Row 0 is the northern edge, column 0 the western edge.`);
  cols([['row, col', 'position in the 48 x 48 grid'], ['grid_i, grid_j', 'cell in the full simulation grid'], ['lat, lon', 'WGS84 coordinates of the sample'], ['elevation_m', 'ground height from the real DEM'], ['surface', 'dominant land cover'], ['los_deformation_mm', 'line-of-sight ground displacement of the pair, atmosphere removed (+ = toward the satellite)'], ['atmosphere_mm', 'tropospheric delay of the pair'], ['wrapped_phase_rad', 'interferogram phase in [-pi, +pi): deformation + atmosphere + noise; one cycle = lambda/2'], ['coherence', 'interferometric coherence 0-1; below 0.25 the phase is noise']]);
  P(); P('05_scene_kpis.csv'); W('The headline numbers of the scenario at the exported date (Scenario Intel panel).'); cols([['indicator', 'name'], ['value', 'value as shown in the app'], ['unit', 'unit'], ['meaning', 'what it means']]);
  if (D.ccd) {
    P(); P('06_ccd_alerts.csv'); W(`Coherence change detection with three SLCs (${D.ccd.dates.join(', ')}, ${D.ccd.band}-band): coherence estimated in 5 x 5 windows for the pre-event and co-event pairs; a pixel is flagged when coherence drops by more than 0.35 (where it was above 0.45) or the backscatter changes by more than 4.5 dB; a 3 x 3 majority filter removes speckle and connected regions of 10+ pixels become polygons.`);
    cols([['id', 'polygon number'], ['label', 'catalogued event name or type of change'], ['catalogued_event', 'yes if the polygon overlaps the catalogued event'], ['area_km2', 'area'], ['volume_m3', 'volume moved or lost (event polygons only)'], ['mean_delta_coherence', 'coherence lost between the two pairs'], ['mean_delta_intensity_db', 'backscatter change (+ brighter)'], ['overlap_with_event_pct', 'share of pixels inside the event footprint'], ['centroid_lat, centroid_lon', 'centre of the polygon'], ['pixels', 'size in grid cells']]);
    W('Summary: ' + D.ccd.summary.map(([k, v, u]) => `${k}: ${typeof v === 'number' ? rnd(v, 3) : v}${u ? ' ' + u : ''}`).join(' | '), '    ');
  }
  if (D.unwrap) { P(); P('07_unwrapping.csv'); W('Quality report of the quality-guided flood-fill phase unwrapping: coverage, regions, and the error against the exact simulated phase.'); cols([['indicator', 'name'], ['value', 'value'], ['unit', 'unit'], ['meaning', 'what it means']]); }
  if (D.profile) { P(); P('08_cross_section.csv'); W(`The line drawn with the CROSS-SECTION tool (${fmt(D.profile.lenKm, 2)} km, ${D.profile.rows.length} samples) at true scale.`); cols([['distance_km', 'distance from the start of the line'], ['lat, lon', 'coordinates'], ['ground_elevation_m', 'DEM elevation'], ['canopy_top_m', 'top of trees or reeds where present'], ['water_surface_m', 'water-surface elevation where flooded'], ['up_mm', 'true vertical displacement since the reference pass'], ['los_mm', 'true line-of-sight displacement (+ toward the satellite)'], ['surface', 'land cover']]); }
  if (D.missing.length) { P(); W('Not included (run them in the app, then export again): ' + D.missing.join('; ') + '.', ''); }
  H('DATA HONESTY'); D.honesty.forEach((t) => { W(t); P(); });
  H('QUICK START');
  P('  Python:  import pandas as pd');
  P('           ts = pd.read_csv("03_time_series.csv")');
  P('           ts.plot(x="day", y=["los_deformation_mm", "observed_los_mm"])');
  P('           grid = pd.read_csv("04_grid_48x48.csv")');
  P('           los = grid.pivot(index="row", columns="col", values="los_deformation_mm")');
  P('  R:       ts <- read.csv("03_time_series.csv", fileEncoding = "UTF-8-BOM")');
  H('GLOSSARY'); for (const [t, d, f] of GLOSSARY) { L.push(wrapTxt(`${t}: ${d}${f ? ' [' + f + ']' : ''}`, 98, '  ')); }
  P(); P('Generated in the browser by CHRONO-SAR.');
  return '﻿' + L.join('\r\n') + '\r\n';
}
async function buildCsvZip(D) {
  const enc = new TextEncoder(), files = [], add = (name, text) => files.push({ name, data: enc.encode(text) });
  add('README.txt', csvReadme(D));
  add('01_scene_metadata.csv', csvText(['field', 'value', 'meaning'], D.metaRows));
  let secName = '';
  const prow = [];
  for (const r of D.pixel.rows) {
    if (r.sec) { secName = r.sec; continue; }
    const vL = r.one !== undefined ? r.one : r.L, vS = r.one !== undefined ? r.one : r.S;
    prow.push([secName, r.p.trim(), rnd(vL, 6), rnd(vS, 6), r.unit || '', r.meaning, r.method]);
  }
  add('02_pixel_inspector.csv', csvText(['section', 'parameter', 'value_L_band', 'value_S_band', 'unit', 'meaning', 'method'], prow));
  add('03_time_series.csv', csvText(['epoch', 'date', 'day', 'los_deformation_mm', 'atmosphere_mm', 'observed_los_mm', 'noise_1sigma_mm', 'east_mm', 'north_mm', 'up_mm', 'coherence_L_12day', 'coherence_S_12day', 'wrapped_phase_L_rad', 'wrapped_phase_S_rad', 'fringes_L', 'event'],
    D.series.rows.map((r) => [r.epoch, r.date, r.t, rnd(r.los), rnd(r.atm), rnd(r.obs), rnd(r.sig), rnd(r.E), rnd(r.N), rnd(r.U), rnd(r.gL), rnd(r.gS), rnd(r.wL), rnd(r.wS), rnd(r.frL), r.ev])));
  const G = D.grid, grows = [];
  for (let r = 0; r < G.G; r++) for (let c = 0; c < G.G; c++) grows.push([r, c, G.ii[r], G.jj[c], rnd(G.lat[r], 6), rnd(G.lon[c], 6), rnd(G.elev[r][c], 1), G.surf[r][c], rnd(G.los[r][c]), rnd(G.atm[r][c]), rnd(G.phase[r][c]), rnd(G.coh[r][c])]);
  add('04_grid_48x48.csv', csvText(['row', 'col', 'grid_i', 'grid_j', 'lat', 'lon', 'elevation_m', 'surface', 'los_deformation_mm', 'atmosphere_mm', 'wrapped_phase_rad', 'coherence'], grows));
  add('05_scene_kpis.csv', csvText(['indicator', 'value', 'unit', 'meaning'], D.kpis.map((q) => [q.k, q.v, q.u, q.meaning])));
  if (D.ccd) add('06_ccd_alerts.csv', csvText(['id', 'label', 'catalogued_event', 'area_km2', 'volume_m3', 'mean_delta_coherence', 'mean_delta_intensity_db', 'overlap_with_event_pct', 'centroid_lat', 'centroid_lon', 'pixels'], D.ccd.comps.map((c) => c.map((v, i) => (i >= 3 ? rnd(v, i >= 8 ? 6 : 4) : v)))));
  if (D.unwrap) add('07_unwrapping.csv', csvText(['indicator', 'value', 'unit', 'meaning'], D.unwrap.rows.map(([a, b, c, d]) => [a, rnd(b, 4), c, d])));
  if (D.profile) add('08_cross_section.csv', csvText(['distance_km', 'lat', 'lon', 'ground_elevation_m', 'canopy_top_m', 'water_surface_m', 'up_mm', 'los_mm', 'surface'], D.profile.rows.map((r) => [rnd(r.d), rnd(r.lat, 6), rnd(r.lon, 6), rnd(r.elev, 2), rnd(r.canopy, 2), rnd(r.water, 3), rnd(r.up), rnd(r.los), r.surface])));
  return makeZip(files);
}

// ───────────── the DATA DOWNLINK overlay: satellite → ground-station animation ─────────────
const DL = { cv: null, raf: 0, last: 0, t: 0, phase: 'idle', phaseT: 0, items: [], color: '#ffb648', pk: [], rings: [], sparks: [], spawn: 0, hits: 0, stars: [], w: 0, h: 0, t0: 0 };
function exportItems(fmt) {
  const x = fmt === 'xlsx', it = [], A = (name, sub, color) => it.push({ name, sub, color, p: 0, state: 'queued' });
  A(x ? 'Mission briefing + 3D snapshot' : 'README.txt · explanations', x ? 'README sheet' : 'every file, every column, glossary', '#ffb648');
  A('Scene metadata', x ? 'README sheet' : '01_scene_metadata.csv', '#9fd0ff');
  A('Pixel inspector', x ? 'Pixel sheet · L and S side by side' : '02_pixel_inspector.csv', '#3ee6ff');
  A('Time series · 29 passes', x ? 'Time series sheet + chart' : '03_time_series.csv', '#ffd166');
  if (x) {
    A('LoS displacement map', '48 × 48 colour-coded cells', '#ff6b2c');
    A('Interferogram · wrapped phase', '48 × 48 colour-coded cells', '#b28cff');
    A('Coherence map', '48 × 48 colour-coded cells', '#3ee6ff');
    A('Radar images', '4 rendered observables', '#4cf2a8');
  } else A('Map grid 48 × 48', '04_grid_48x48.csv · LoS, phase, coherence', '#ff6b2c');
  A('Scene KPIs', x ? 'KPIs sheet' : '05_scene_kpis.csv', '#ffd166');
  if (S.ccd && S.ccd.result) A('CCD change alerts', x ? 'CCD alerts sheet' : '06_ccd_alerts.csv', '#ff4a4a');
  if (S.unwrap && S.unwrap.stats) A('Phase unwrapping report', x ? 'Unwrapping sheet' : '07_unwrapping.csv', '#ffb648');
  if (S.profile && S.slice && S.slice.b) A('Cross-section profile', x ? 'Cross-section sheet + chart' : '08_cross_section.csv', '#9fd0ff');
  if (x) A('Glossary & formulas', 'Glossary sheet', '#8ea6be');
  return it;
}
function renderDlList() {
  const box = $('#dl-list'); if (!box) return;
  box.innerHTML = '';
  for (const it of DL.items) {
    it.el = h('div', { class: 'dl-item', 'data-state': it.state, style: `--c:${it.color}` }, h('i'), h('span', { class: 'nm' }, it.name, h('small', {}, it.sub)), h('span', { class: 'pc' }, it.state === 'done' ? '✓' : '—'), h('b', { class: 'bar' }));
    box.append(it.el);
  }
}
function dlStatus(main, sub = '') { const el = $('#dl-status'); if (!el) return; el.innerHTML = ''; el.append(h('b', {}, main), h('small', {}, sub)); }
function dlFoot(text, kind = '') { const el = $('#dl-foot'); if (el) { el.textContent = text; el.className = 'dl-foot ' + kind; } }
function dlButtons(on) { for (const id of ['#dl-xlsx', '#dl-csv']) { const b = $(id); if (b) b.disabled = !on; } }
function dlStart() { if (!DL.raf && DL.cv) { DL.last = 0; DL.raf = requestAnimationFrame(dlLoop); } }
function dlLoop(now) {
  const ov = $('#export');
  if (!ov || !ov.classList.contains('open')) { DL.raf = 0; return; }
  DL.raf = requestAnimationFrame(dlLoop);
  const dt = DL.last ? Math.min(0.05, (now - DL.last) / 1000) : 0.016; DL.last = now;
  DL.t += dt; DL.phaseT += dt;
  for (const it of DL.items) if (it.state === 'active' && it.el) {
    it.p = clamp((performance.now() - it.t0) / it.dur, 0, 1);
    it.el.querySelector('.bar').style.width = (it.p * 100).toFixed(0) + '%';
    it.el.querySelector('.pc').textContent = Math.round(it.p * 100) + '%';
  }
  dlStep(dt); dlDraw();
}
function dlGeom() {
  const W = DL.w, H = DL.h, R = W * 1.05, cx = W * 0.42, cy = H * 0.78 + R;
  const dx = W * 0.74, dy = cy - Math.sqrt(Math.max(0, R * R - (dx - cx) * (dx - cx)));
  const Ro = R + H * 0.5, a = -0.13 + 0.07 * Math.sin(DL.t * 0.07);
  const sx = cx + Ro * Math.sin(a), sy = cy - Ro * Math.cos(a);
  return { W, H, R, cx, cy, dx, dy: dy - 12, sx, sy, a, Ro, mx: (sx + dx) / 2 + H * 0.05, my: (sy + dy) / 2 - H * 0.1 };
}
const bez = (G, u) => { const v = 1 - u; return [v * v * G.sx + 2 * v * u * G.mx + u * u * G.dx, v * v * G.sy + 2 * v * u * G.my + u * u * G.dy]; };
function dlStep(dt) {
  if (DL.phase === 'down') {
    DL.spawn += dt * 48;
    while (DL.spawn >= 1) { DL.spawn -= 1; DL.pk.push({ u: 0, v: 0.75 + Math.random() * 0.6, c: DL.color, s: 1.6 + Math.random() * 1.8, o: (Math.random() - 0.5) * 7 }); }
  }
  for (const p of DL.pk) p.u += dt * p.v;
  DL.pk = DL.pk.filter((p) => { if (p.u < 1) return true; DL.hits++; if (Math.random() < 0.3) DL.rings.push({ r: 5, a: 0.9, c: p.c }); return false; });
  for (const r of DL.rings) { r.r += dt * 55; r.a -= dt * 1.5; }
  DL.rings = DL.rings.filter((r) => r.a > 0);
  for (const s of DL.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 40 * dt; s.a -= dt * 0.8; }
  DL.sparks = DL.sparks.filter((s) => s.a > 0);
}
function dlDraw() {
  const cv = DL.cv; if (!cv) return;
  const rect = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(10, Math.round(rect.width)), H = Math.max(10, Math.round(rect.height));
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  DL.w = W; DL.h = H;
  const t = DL.t, G = dlGeom(), ph = DL.phase, mono = '10px "Martian Mono", "JetBrains Mono", ui-monospace, Consolas, monospace';
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#01040a'); sky.addColorStop(1, '#06142a');
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  for (const [x, y, s, p] of DL.stars) { g.fillStyle = `rgba(200,225,255,${(0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.4 + p * 9))).toFixed(3)})`; g.fillRect(x * W, y * H, s, s); }
  // orbit track
  g.save(); g.strokeStyle = 'rgba(128,188,255,0.16)'; g.setLineDash([3, 6]); g.beginPath(); g.arc(G.cx, G.cy, G.Ro, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.3); g.stroke(); g.restore();
  // Earth with atmosphere limb
  const eg = g.createRadialGradient(G.cx, G.cy - G.R * 0.4, G.R * 0.25, G.cx, G.cy, G.R);
  eg.addColorStop(0, '#103d6b'); eg.addColorStop(0.9, '#0a2747'); eg.addColorStop(1, '#0f4c86');
  g.fillStyle = eg; g.beginPath(); g.arc(G.cx, G.cy, G.R, 0, TAU); g.fill();
  g.save(); g.shadowColor = 'rgba(70,170,255,0.95)'; g.shadowBlur = 22; g.strokeStyle = 'rgba(110,200,255,0.8)'; g.lineWidth = 2;
  g.beginPath(); g.arc(G.cx, G.cy, G.R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); g.stroke(); g.restore();
  for (let n = 0; n < 34; n++) { const an = -Math.PI / 2 - 0.5 + n * 0.031, rr = G.R - 6 - ((n * 37) % 11); g.fillStyle = `rgba(255,${190 + (n * 13) % 50},120,${0.25 + ((n * 7) % 5) / 12})`; g.fillRect(G.cx + rr * Math.cos(an), G.cy + rr * Math.sin(an), 1.4, 1.4); }
  // link beam
  const linkOn = ph === 'down' || ph === 'pack' || ph === 'done';
  if (ph === 'lock') {
    const ang = Math.atan2(G.sy - G.dy, G.sx - G.dx), off = (1 - smoothstep(0, 0.75, DL.phaseT)) * 0.55 * Math.sin(DL.phaseT * 10), L = Math.hypot(G.sx - G.dx, G.sy - G.dy);
    const cone = g.createRadialGradient(G.dx, G.dy, 4, G.dx, G.dy, L);
    cone.addColorStop(0, 'rgba(62,230,255,0.35)'); cone.addColorStop(1, 'rgba(62,230,255,0)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(G.dx, G.dy); g.arc(G.dx, G.dy, L, ang + off - 0.07, ang + off + 0.07); g.closePath(); g.fill();
  }
  if (linkOn) {
    g.save(); g.lineCap = 'round';
    g.strokeStyle = 'rgba(62,230,255,0.07)'; g.lineWidth = 9; g.beginPath(); g.moveTo(G.sx, G.sy); g.quadraticCurveTo(G.mx, G.my, G.dx, G.dy); g.stroke();
    g.strokeStyle = ph === 'down' ? DL.color : 'rgba(62,230,255,0.55)'; g.globalAlpha = 0.55; g.lineWidth = 1.2; g.setLineDash([2, 5]); g.lineDashOffset = -t * 40;
    g.beginPath(); g.moveTo(G.sx, G.sy); g.quadraticCurveTo(G.mx, G.my, G.dx, G.dy); g.stroke(); g.restore();
  }
  // packets
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const p of DL.pk) {
    const [x, y] = bez(G, p.u), [x0, y0] = bez(G, Math.max(0, p.u - 0.05)), nx = -(y - y0), ny = x - x0, nl = Math.hypot(nx, ny) || 1, ox = nx / nl * p.o, oy = ny / nl * p.o;
    g.strokeStyle = p.c; g.globalAlpha = 0.35; g.lineWidth = p.s * 0.8; g.beginPath(); g.moveTo(x0 + ox, y0 + oy); g.lineTo(x + ox, y + oy); g.stroke();
    g.globalAlpha = 1; g.fillStyle = p.c; g.shadowColor = p.c; g.shadowBlur = 8; g.fillRect(x + ox - p.s / 2, y + oy - p.s / 2, p.s, p.s); g.shadowBlur = 0;
  }
  for (const r of DL.rings) { g.globalAlpha = r.a * 0.7; g.strokeStyle = r.c; g.lineWidth = 1.2; g.beginPath(); g.arc(G.dx, G.dy, r.r, 0, TAU); g.stroke(); }
  for (const s of DL.sparks) { g.globalAlpha = Math.max(0, s.a); g.fillStyle = s.c; g.fillRect(s.x - 1.2, s.y - 1.2, 2.4, 2.4); }
  g.restore(); g.globalAlpha = 1;
  // ground station
  const ga = Math.atan2(G.sy - G.dy, G.sx - G.dx);
  g.save(); g.translate(G.dx, G.dy + 12);
  g.fillStyle = '#c9d6e4'; g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.lineTo(2, -11); g.lineTo(-2, -11); g.closePath(); g.fill();
  g.translate(0, -12); g.rotate(ga + Math.PI / 2);
  g.strokeStyle = '#eef4fb'; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 6, 11, Math.PI + 0.55, TAU - 0.55); g.stroke();
  g.lineWidth = 1; g.beginPath(); g.moveTo(0, -3); g.lineTo(0, -11); g.stroke();
  g.fillStyle = linkOn ? '#3ee6ff' : '#8ea6be'; g.beginPath(); g.arc(0, -11, 1.8, 0, TAU); g.fill();
  g.restore();
  // NISAR icon
  g.save(); g.translate(G.sx, G.sy); g.rotate(G.a);
  g.strokeStyle = 'rgba(220,230,240,0.85)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(-15, 12); g.stroke();
  g.save(); g.translate(-19, 15); g.rotate(-0.5);
  const rg = g.createLinearGradient(-14, 0, 14, 0); rg.addColorStop(0, '#8a5a12'); rg.addColorStop(0.5, '#ffd27a'); rg.addColorStop(1, '#a8701c');
  g.fillStyle = rg; g.beginPath(); g.ellipse(0, 0, 14, 4.6, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,240,200,0.5)'; g.lineWidth = 0.6; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * 5, -4.2 + Math.abs(k) * 0.8); g.lineTo(k * 5, 4.2 - Math.abs(k) * 0.8); g.stroke(); }
  g.restore();
  g.fillStyle = '#1b3a66'; g.fillRect(5, -3, 20, 6); g.strokeStyle = 'rgba(160,200,255,0.55)'; g.lineWidth = 0.5; for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(5 + k * 4, -3); g.lineTo(5 + k * 4, 3); g.stroke(); }
  g.fillStyle = '#e8c06a'; g.fillRect(-4, -4, 8, 8); g.fillStyle = '#fff6dc'; g.fillRect(-1.5, -1.5, 3, 3);
  g.restore();
  if (ph === 'lock' || ph === 'down') {
    const lk = ph === 'down' ? 1 : smoothstep(0.35, 0.75, DL.phaseT), rr = 16 + 5 * Math.sin(t * 6) * (1 - lk);
    g.save(); g.strokeStyle = `rgba(62,230,255,${0.4 + 0.4 * lk})`; g.lineWidth = 1; g.beginPath(); g.arc(G.sx, G.sy, rr, 0, TAU); g.stroke();
    for (let k = 0; k < 4; k++) { const an = k * Math.PI / 2 + t * 0.6; g.beginPath(); g.moveTo(G.sx + Math.cos(an) * (rr + 2), G.sy + Math.sin(an) * (rr + 2)); g.lineTo(G.sx + Math.cos(an) * (rr + 7), G.sy + Math.sin(an) * (rr + 7)); g.stroke(); }
    if (lk > 0.95) { g.fillStyle = '#3ee6ff'; g.font = mono; g.textAlign = 'left'; g.fillText('LOCK', G.sx + rr + 8, G.sy + 3); }
    g.restore();
  }
  if (ph === 'pack') {
    g.save(); g.strokeStyle = '#4cf2a8'; g.lineWidth = 2; g.lineCap = 'round';
    for (let k = 0; k < 3; k++) { const a0 = t * (3 + k) + k * 2.1; g.globalAlpha = 0.85 - k * 0.22; g.beginPath(); g.arc(G.dx, G.dy, 20 + k * 6, a0, a0 + 1.4); g.stroke(); }
    g.restore();
  }
  if (ph === 'done' || ph === 'error') {
    const ok = ph === 'done', e = smoothstep(0, 0.6, DL.phaseT), cx = W * 0.5, cy = H * 0.42, r = 30;
    g.save(); g.fillStyle = ok ? 'rgba(10,40,30,0.55)' : 'rgba(50,10,12,0.55)'; g.beginPath(); g.arc(cx, cy, r + 10, 0, TAU); g.fill();
    g.strokeStyle = ok ? '#4cf2a8' : '#ff4a4a'; g.shadowColor = g.strokeStyle; g.shadowBlur = 16; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * e); g.stroke();
    const e2 = smoothstep(0.35, 0.9, DL.phaseT);
    if (ok) { g.beginPath(); g.moveTo(cx - 12, cy + 1); const k1 = Math.min(1, e2 * 2); g.lineTo(cx - 12 + 8 * k1, cy + 1 + 9 * k1); if (e2 > 0.5) { const k2 = (e2 - 0.5) * 2; g.lineTo(cx - 4 + 17 * k2, cy + 10 - 21 * k2); } g.stroke(); }
    else if (e2 > 0) { g.beginPath(); g.moveTo(cx - 10, cy - 10); g.lineTo(cx - 10 + 20 * e2, cy - 10 + 20 * e2); g.moveTo(cx + 10, cy - 10); g.lineTo(cx + 10 - 20 * e2, cy - 10 + 20 * e2); g.stroke(); }
    g.restore();
  }
  // HUD text
  g.font = mono; g.textBaseline = 'alphabetic'; g.fillStyle = 'rgba(142,166,190,0.9)';
  const right = { idle: 'LINK IDLE', lock: 'ACQUIRING', down: 'DOWNLINKING', pack: 'PACKAGING', done: 'COMPLETE', error: 'LINK LOST' }[ph] || '';
  let left = 'NISAR  →  GROUND STATION · KA-BAND DOWNLINK';
  if (g.measureText(left).width + g.measureText(right).width + 40 > W) left = 'NISAR → GROUND · KA-BAND';
  g.textAlign = 'left'; g.fillText(left, 12, 18);
  g.textAlign = 'right'; g.fillText(right, W - 12, 18);
  if (ph !== 'idle') {
    const done = DL.items.filter((i) => i.state === 'done').length;
    g.textAlign = 'left'; g.fillText(W < 420 ? `PKT ${DL.hits.toLocaleString('en')} · ${done}/${DL.items.length}` : `PACKETS ${DL.hits.toLocaleString('en')} · DATASETS ${done}/${DL.items.length}`, 12, H - 34);
    g.textAlign = 'right'; g.fillText(`T+${((performance.now() - DL.t0) / 1000).toFixed(1)} s`, W - 12, H - 34);
  }
}
function dlBurst() {
  const G = dlGeom(), cols = ['#4cf2a8', '#3ee6ff', '#ffb648', '#ffffff'];
  for (let n = 0; n < 70; n++) { const a = Math.random() * TAU, v = 30 + Math.random() * 120; DL.sparks.push({ x: G.dx, y: G.dy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, a: 0.8 + Math.random() * 0.5, c: cols[n % cols.length] }); }
}
function openExport() {
  if (S.view !== 'terrain' || !S.sc) { toast('Open a scene first: the export packages the data behind the current view.'); return; }
  if (!Export.busy) {
    DL.items = exportItems(Export.fmt); renderDlList();
    DL.phase = 'idle'; DL.phaseT = 0; DL.pk = []; DL.rings = []; DL.sparks = []; DL.hits = 0;
    dlStatus('LINK IDLE', `${S.sc.site.name} · ${epochName(epochOf(S.t))} · ${fmtDate(dateAt(S.t))} · ${S.sc.kind === 'custom' ? 'pack' : bandAtInspector() + '-band'}`);
    dlFoot(exportPixel(S.sc).pinned ? 'The Pixel and Time-series sheets use the pixel you clicked.' : 'The Pixel and Time-series sheets use the scenario\'s point of interest. Click another spot on the terrain first to export that pixel instead.');
  }
  openOverlay('export');
  dlStart();
}
async function dlItem(n, ms) {
  const it = DL.items[n]; if (!it) return;
  it.state = 'active'; it.t0 = performance.now(); it.dur = ms; it.p = 0;
  if (it.el) it.el.setAttribute('data-state', 'active');
  await sleep(ms);
  it.state = 'done'; it.p = 1;
  if (it.el) { it.el.setAttribute('data-state', 'done'); it.el.querySelector('.pc').textContent = '✓'; it.el.querySelector('.bar').style.width = '100%'; }
  Sound.packet();
}
function exportName(D, fmt) { return `CHRONO-SAR_${D.meta.id}_${D.meta.epochCur}_${D.meta.custom ? 'pack' : D.meta.band + '-band'}_${D.meta.stamp}.${fmt === 'xlsx' ? 'xlsx' : 'zip'}`; }
async function runExport(fmt) {
  if (Export.busy || !S.sc || S.view !== 'terrain') return;
  Export.busy = true; Export.fmt = fmt; dlButtons(false);
  const snap = fmt === 'xlsx' ? captureSnapshot() : null;
  const libP = fmt === 'xlsx' ? loadExcelJS() : null;
  if (libP) libP.catch(() => {});
  DL.items = exportItems(fmt); renderDlList();
  DL.pk = []; DL.rings = []; DL.sparks = []; DL.hits = 0; DL.t0 = performance.now();
  DL.phase = 'lock'; DL.phaseT = 0;
  dlStatus('ACQUIRING SIGNAL', 'pointing the ground antenna at NISAR'); dlFoot('');
  const stopStream = Sound.stream();
  const fail = (msg) => {
    stopStream(); DL.phase = 'error'; DL.phaseT = 0; DL.pk = [];
    dlStatus('LINK LOST', msg); dlFoot(msg, 'err'); toast(msg, ''); Sound.blip(294, 0.2, 'sine', 0.06);
    Export.busy = false; dlButtons(true);
  };
  await sleep(800);
  let D;
  try { D = collectExport(); } catch (e) { console.error(e); return fail('Could not read the scene data: ' + e.message); }
  DL.phase = 'down'; DL.phaseT = 0; Sound.step();
  for (let n = 0; n < DL.items.length; n++) { DL.color = DL.items[n].color; dlStatus('DOWNLINKING', DL.items[n].name); await dlItem(n, 210); }
  DL.phase = 'pack'; DL.phaseT = 0;
  dlStatus(fmt === 'xlsx' ? 'ASSEMBLING WORKBOOK' : 'PACKING CSV ARCHIVE', fmt === 'xlsx' ? 'colour-coding cells, embedding images and explanations' : 'one CSV per dataset + README.txt');
  let blob;
  try {
    if (fmt === 'xlsx') {
      let XL;
      try { XL = await libP; } catch (e) { return fail(`The Excel engine could not be loaded (${e.message}). The CSV pack works offline.`); }
      blob = await buildWorkbook(XL, D, snap);
    } else blob = await buildCsvZip(D);
  } catch (e) { console.error(e); return fail('Packaging failed: ' + e.message); }
  stopStream();
  DL.phase = 'done'; DL.phaseT = 0; dlBurst(); Sound.success();
  const fname = exportName(D, fmt);
  dlStatus('DOWNLINK COMPLETE', `${fname} · ${fmtBytes(blob.size)}`);
  await sleep(600);
  const res = await saveFile(fname, blob);
  if (res.ok) {
    const msg = res.how === 'viewer' ? `Saved ${fname} (${fmtBytes(blob.size)}).` : `Downloaded ${fname} (${fmtBytes(blob.size)}): check your Downloads folder.`;
    dlFoot(msg, 'ok'); toast(`Data downlinked · ${fname} · ${fmtBytes(blob.size)}`, 'gold');
  } else { dlFoot(res.msg, 'err'); toast(res.msg, ''); }
  Export.lastBlob = blob; Export.lastName = fname;
  Export.busy = false; dlButtons(true);
}
function initExport() {
  DL.cv = $('#dl-canvas');
  const r = mulberry32(2026);
  DL.stars = Array.from({ length: 150 }, () => [r(), r() * 0.82, 0.6 + r() * 1.1, r()]);
  const go = () => { Sound.click(); openExport(); };
  $('#act-export').addEventListener('click', go);
  $('#btn-export').addEventListener('click', go);
  $('#dl-xlsx').addEventListener('click', () => { Sound.click(); runExport('xlsx'); });
  $('#dl-csv').addEventListener('click', () => { Sound.click(); runExport('csv'); });
}
