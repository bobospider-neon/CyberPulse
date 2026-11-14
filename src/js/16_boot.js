// ───────────────────────── 16 · BOOT ─────────────────────────
async function boot() {
  const logBox = $('#boot-log');
  const log = (html) => { logBox.append(h('div', { html })); while (logBox.children.length > 9) logBox.firstChild.remove(); };
  const bar = (l, s) => { $('#boot-l').style.width = (l * 100).toFixed(0) + '%'; $('#boot-s').style.width = (s * 100).toFixed(0) + '%'; };
  const frameYield = () => new Promise((r) => requestAnimationFrame(() => r()));
  try {
    log('<em>CHRONO-SAR</em> · TERRAPULSE phase-to-mesh engine · build 2026.11');
    const data = window.CSAR_DATA;
    if (!data) throw new Error('Embedded data block is missing.');
    initRenderer();
    log(`WebGL 2 context <b>OK</b> · max texture ${App.renderer.capabilities.maxTextureSize}px · vertex textures ${App.renderer.capabilities.maxVertexTextures}`);
    await frameYield();
    const mask = await decodeMask(data.globe);
    log(`Global land mask ${mask.w}×${mask.h} <b>decoded</b>`);
    bar(0.08, 0.04);
    const dems = {};
    for (const [n, id] of SITE_ORDER.entries()) {
      const meta = data.dem[id];
      dems[id] = await decodeDem(meta);
      App.metas[id] = meta;
      log(`DEM <em>${SITES[id].name}</em> · ${meta.n}×${meta.n} @ ${meta.pixel_m.toFixed(0)} m · ${meta.source.split(':')[0]} <b>OK</b>`);
      bar(0.08 + 0.32 * (n + 1) / SITE_ORDER.length, 0.04 + 0.2 * (n + 1) / SITE_ORDER.length);
      await frameYield();
    }
    for (const [n, id] of SITE_ORDER.entries()) {
      const t0 = performance.now();
      App.scenes[id] = buildScene(id, App.metas[id], dems[id]);
      const sc = App.scenes[id];
      log(`Forward model <em>${SITES[id].name}</em>: ${sc.bases.length} deformation bases, ${sc.events.length} event, ${(sc.canopyPts.length / 4 / 1000).toFixed(0)}k scatterers · ${(performance.now() - t0).toFixed(0)} ms`);
      bar(0.4 + 0.4 * (n + 1) / SITE_ORDER.length, 0.24 + 0.5 * (n + 1) / SITE_ORDER.length);
      await frameYield();
    }
    App.world = new World(App.renderer);
    App.globe = new Globe(App.renderer, mask);
    App.globe.setSites(App.metas);
    App.globe.simT = 3600 * 6;
    App.globe.prepaint(30);
    log('NISAR orbit propagator · 747 km · i = 98.4° · 173 orbits / 12 d <b>OK</b>');
    makeThumbs();
    renderDeck($('#globe-deck-grid'), true);
    renderDeck($('#deck-grid'), false);
    bar(0.9, 0.86);
    await frameYield();
    App.world.load(App.scenes.rainier);
    App.lastC = timeCtx(App.scenes.rainier, { tRef: 0, tCur: 0, X: 1, geomObj: App.scenes.rainier.geom.asc, bandEff: 'L', aps: true });
    App.renderer.compile(App.world.scene, App.camera);
    App.renderer.compile(App.globe.scene, App.camera);
    log('GLSL: phase-to-mesh, Freeman–Durden, coherence, X-ray lens <b>compiled</b>');
    initUI();
    $('#tour-next').addEventListener('click', () => Tour.next());
    $('#tour-exit').addEventListener('click', () => Tour.stop());
    syncControls();
    bar(1, 1);
    log('<b>READY</b> · dancing with the SARs');
    await sleep(450);
    S.view = 'globe';
    setViewUI('globe');
    App.camera.position.set(0, 30, 120); App.camera.lookAt(0, 0, 0);
    requestAnimationFrame(frame);
    $('#boot').classList.add('done');
    const want = location.hash.slice(1);
    await toGlobe({ instant: true });
    if (SITES[want] && App.scenes[want]) await enterSite(want, { fromGlobe: true });
  } catch (e) {
    console.error(e);
    const el = $('#boot-err'); el.hidden = false;
    el.textContent = 'CHRONO-SAR could not start: ' + (e && e.message ? e.message : e);
  }
}
window.CSAR = { exportData: { collectExport, buildWorkbook, buildCsvZip, loadExcelJS, captureSnapshot, makeZip, crc32 }, S, App, SITES, Tour, Sound, enterSite, toGlobe, startCCD, startUnwrap, triggerRupture, setTime, syncControls, computeProfile, loadPack };
boot();
