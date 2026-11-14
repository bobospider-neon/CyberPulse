// QA harness: runs the pure simulation modules in Node on the real data and writes PNG previews.
import fs from 'fs'; import path from 'path'; import zlib from 'zlib'; import vm from 'vm';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const files = ['01_core.js', '02_physics.js', '03_sites.js', '04_builder.js', '04b_mirror.js', '05_algorithms.js'];
let code = files.map((f) => fs.readFileSync(path.join(root, 'src/js', f), 'utf8')).join('\n');
code += '\n;globalThis.__api = { CFG, SITES, SITE_ORDER, buildScene, decodeDem, timeCtx, igramK, cohK, coverK, polK, floodedK, dispMeshK, ccdJob, Unwrapper, phaseRGB, coherenceRGB, divergingRGB, viewGeometry, wrapPi, trueDispK };';
vm.runInThisContext(code, { filename: 'bundle.js' });
const A = globalThis.__api;
const OUT = process.argv[2] || path.join(root, 'qa');
fs.mkdirSync(OUT, { recursive: true });
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(file, w, h, rgb) {
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x]; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const only = process.argv.slice(3);
for (const id of A.SITE_ORDER) {
  if (only.length && !only.includes(id)) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'data', `dem_${id}.json`), 'utf8'));
  const t0 = performance.now();
  const dem = await A.decodeDem(meta);
  const sc = A.buildScene(id, meta, dem);
  const tb = performance.now() - t0;
  const N = sc.N, NN = N * N;
  const S = { tRef: 0, tCur: A.CFG.tMax, X: 1, geomObj: sc.geom.asc, bandEff: 'L', aps: true };
  const C = A.timeCtx(sc, S);
  const t1 = performance.now();
  const cov = new Uint8Array(NN * 3), ph = new Uint8Array(NN * 3), co = new Uint8Array(NN * 3), phS = new Uint8Array(NN * 3), fd = new Uint8Array(NN * 3);
  let fl = 0, maxU = 0, sumG = 0;
  const Cp = A.timeCtx(sc, { ...S, tCur: sc.site.water ? sc.site.water.peak : A.CFG.tMax });
  for (let k = 0; k < NN; k++) {
    const fr = A.coverK(sc, k, Cp);
    cov[k * 3] = Math.round(255 * Math.min(1, fr.urban + fr.ice)); cov[k * 3 + 1] = Math.round(255 * fr.veg * (fr.flooded ? 0.5 : 1)); cov[k * 3 + 2] = Math.round(255 * Math.min(1, fr.water + fr.flooded + fr.ice * 0.8));
    if (fr.flooded) fl++;
    const ig = A.igramK(sc, k, C);
    const c = A.phaseRGB(ig.wrapped); for (let q = 0; q < 3; q++) ph[k * 3 + q] = Math.round(255 * c[q]);
    const igS = A.igramK(sc, k, C, 'S'); const cs = A.phaseRGB(igS.wrapped); for (let q = 0; q < 3; q++) phS[k * 3 + q] = Math.round(255 * cs[q]);
    const cc = A.coherenceRGB(ig.gamma); for (let q = 0; q < 3; q++) co[k * 3 + q] = Math.round(255 * cc[q]);
    sumG += ig.gamma;
    const d = A.trueDispK(sc, k, A.CFG.tMax); maxU = Math.max(maxU, Math.abs(d[2]));
    if (k % 3 === 0) { const p = A.polK(sc, k, 'L', Cp); const m = Math.max(p.fd.Pd, p.fd.Pv, p.fd.Ps, 1e-9); const b = Math.min(1, Math.max(0.1, (10 * Math.log10(p.fd.span) + 25) / 22)); fd[k * 3] = 255 * b * p.fd.Pd / m; fd[k * 3 + 1] = 255 * b * p.fd.Pv / m; fd[k * 3 + 2] = 255 * b * p.fd.Ps / m; }
  }
  const tp = performance.now() - t1;
  png(path.join(OUT, `${id}_cover.png`), N, N, cov); png(path.join(OUT, `${id}_phaseL.png`), N, N, ph); png(path.join(OUT, `${id}_phaseS.png`), N, N, phS);
  png(path.join(OUT, `${id}_coh.png`), N, N, co); png(path.join(OUT, `${id}_polL.png`), N, N, fd);
  const ev = sc.events.map((e) => `${e.kind} t=${e.t} area=${e.areaKm2.toFixed(2)}km2 vol=${e.volume.toExponential(2)}`).join('; ');
  console.log(`${id.padEnd(12)} build ${tb.toFixed(0)}ms  pixels ${tp.toFixed(0)}ms  maxUz ${(maxU * 100).toFixed(1)}cm  flooded@peak ${fl}  meanγL ${(sumG / NN).toFixed(2)}  canopyPts ${sc.canopyPts.length / 4}  bases ${sc.bases.length}  ${ev}`);
  if (sc.glacier) console.log('   glacier front col', sc.glacier.jf, 'row', sc.glacier.rf.toFixed(1), 'vmax', sc.glacier.speed.reduce((a, b) => Math.max(a, b), 0).toFixed(1), 'ice@front', [0,2,4,8].map((d) => sc.cover.ice[Math.round(sc.glacier.rf) * N + sc.glacier.jf + d].toFixed(2)).join(','), 'dem@front', [0,2,4,8,16].map((d) => sc.dem[Math.round(sc.glacier.rf) * N + sc.glacier.jf + d].toFixed(0)).join(','));
  if (sc.buildings) console.log('   buildings', sc.buildings.length);
  // unwrapping test
  const wrapped = new Float32Array(NN), q = new Float32Array(NN), valid = new Uint8Array(NN), truth = new Float32Array(NN);
  for (let k = 0; k < NN; k++) { const ig = A.igramK(sc, k, C); wrapped[k] = ig.wrapped; q[k] = ig.gamma; valid[k] = ig.gamma > 0.3 ? 1 : 0; truth[k] = ig.phiTrue; }
  const refK = (sc.ref.i | 0) * N + (sc.ref.j | 0); valid[refK] = 1;
  const t2 = performance.now(); const U = new A.Unwrapper(N, wrapped, q, valid, refK); while (!U.step(50000)); const tu = performance.now() - t2;
  let se = 0, n = 0, jumps = 0; for (let k = 0; k < NN; k++) { if (!U.done[k]) continue; const s0 = U.regionSeeds[U.region[k]]; const e = U.phi[k] - U.phi[s0] - (truth[k] - truth[s0]); se += e * e; n++; if (Math.abs(e) > Math.PI) jumps++; }
  console.log(`   unwrap ${tu.toFixed(0)}ms  pixels ${n}/${NN}  regions ${U.regionSeeds.length}  rms ${(Math.sqrt(se / n)).toFixed(3)} rad  >π errors ${jumps}`);
  const ev0 = sc.events[0];
  if (ev0) {
    if (!Number.isFinite(ev0.t)) { sc.rupture.tq = 150; sc.rupture.front = -1e9; ev0.t = 150; }
    const kE = Math.ceil(ev0.t / 12); const tPost = kE * 12, tPre1 = (kE - 1) * 12, tPre2 = (kE - 2) * 12;
    const t3 = performance.now(); const it = A.ccdJob(sc, { band: 'L', geomObj: sc.geom.asc }, tPre2, tPre1, tPost); let r; do { r = it.next(); } while (!r.done); const res = r.value;
    console.log(`   CCD ${(performance.now() - t3).toFixed(0)}ms  comps ${res.comps.length}  eventA ${res.evA.toFixed(2)} km2 (truth ${ev0.areaKm2.toFixed(2)})  eventV ${res.evV.toExponential(2)}  other ${res.otherA.toFixed(2)} km2  labels ${[...new Set(res.comps.map((c) => c.label))].join(" | ")}`);
  }
}
