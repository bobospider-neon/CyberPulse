# CHRONO-SAR · 4D NISAR Earth-motion engine

**NASA Space Apps Challenge 2026 · _Dancing with the SARs_**

CHRONO-SAR turns the radar physics of NISAR (NASA-ISRO SAR, L-band + S-band) into living 3D ground.
The interferometric phase moves the vertices of a real elevation model. An X-ray lens compares the two bands.
Freeman–Durden polarimetry, coherence change detection and phase unwrapping all run live in the browser.

Open `dist/index.html`. It is one self-contained file: data, code and styles are inlined, and only three.js, the fonts and (on first export) ExcelJS load from CDNs.
No internet? Open `dist/offline.html` instead: the same page with those three inlined too (see "Offline version" below).

**New in this version**
- **Real NISAR data, live from NASA** (right dock **Real NISAR data**, key `R`): for every scene the app asks NASA's Common Metadata Repository which real NISAR products cover it, shows the latest pass and the archive inventory, and drapes a real NISAR interferogram (GUNW) or polarimetric image (GCOV) on the real DEM. See "Real NISAR data" below.
- **NISAR close-up** (top-bar **NISAR**, key `N`, or click the satellite label): a high-detail spacecraft with a 12 m gold-mesh AstroMesh reflector on a 9 m boom with four hinges, L- and S-band feed arrays, solar wing, Ka-band antenna, RCS thrusters, beacons and sun glints. The first visit plays the deployment: the boom unfolds hinge by hinge, then the reflector opens. **Replay deployment** runs it again.
- **Sound design**: a slowly evolving ambient chord bed with a generated convolution hall, soft tactile clicks and glass chimes tuned to the same key, cinematic whooshes, an earthquake rumble, a two-tone attention chime for CCD, and thruster, servo and latch sounds in the close-up. There are no beeps. Everything is synthesised live with Web Audio.
- **Data export** (left dock **EXPORT DATA**, top-bar **Export**, key `E`): a "data downlink" animation, then either an **Excel workbook** or a **CSV pack**. The workbook has colour-coded sheets, charts, radar images and a plain-language explanation for every dataset. The CSV pack is a `.zip` with one CSV per dataset and a README.txt.

---

## The four Earth waltzes (six sites)

| Waltz | Site | What you see | Event |
|---|---|---|---|
| I · Tectonic & volcanic | **Mount Rainier**, WA | Mogi magma source 6 km deep inflating the volcano (training drill), concentric fringes, radial 3D vectors | Debris flow in Tahoma Creek (day 228) |
| I · Tectonic & volcanic | **San Andreas Fault**, Carrizo Plain | Interseismic loading (34 mm/yr, D = 15 km); **Trigger rupture** → Mw 7.9, 6 m right-lateral, mesh tears | Surface rupture (user-triggered) |
| II · Cryosphere | **Jakobshavn Isbræ**, Greenland | Speckle-tracking streaks (~30 m/day), aliased fringes on fast ice, icebergs | Calving at the terminus (day 240) |
| III · Waters & forests | **Atchafalaya Basin**, Louisiana (NASA Delta-X region) | Spring flood under cypress–tupelo forest; **X-ray lens**: L-band inside, S-band outside | Hurricane windthrow (day 288) |
| III · Waters & forests | **Danube Delta**, Romania (home waters) | Flooded reed beds turn red (L-band double bounce) while S-band sees green volume | Reed-bed fire (day 120) |
| IV · Anthropogenic | **Mexico City** | Aquifer compaction up to ~35 cm/yr, 6,000 city blocks tilting, β = 1/500 risk check | Ground-fissure damage, Iztapalapa (day 204) |

Elevation models are **real**: USGS 3DEP, SRTM, INEGI and GMTED via AWS Terrain Tiles, and Copernicus GLO-90 for Greenland and the Danube.
The SAR signals on top of them are **simulated with physics-based forward models**: deformation sources, coherence, backscatter, atmosphere and events. Each scene is labelled that way in the app.
You can load **real interferograms** with the CSAR-PACK loader (see below).

## What is computed, and where

| Feature | Physics | Code |
|---|---|---|
| Phase → mesh | Δd = λ/4π · Δφ, LoS ê from NISAR's left-looking geometry (747 km, 98.4°, θ 33–47°) | `06_shaders.js` (TERRAIN_VS/FS), `04b_mirror.js` |
| Coherence & noise | γ(Δt) per land-cover class and band, Cramér–Rao σφ, γ-mask, display anti-aliasing of dense fringes | shaders + `02_physics.js` |
| Polarimetry | Freeman–Durden 3-component decomposition per pixel, both bands, local incidence angle | `polFD()` in GLSL, `freemanDurden()` in JS |
| Dual-band X-ray lens | Inside the lens: L-band (trunks + water → double bounce); outside: S-band canopy volume | shaders, `08_world.js` |
| 3D fusion | Weighted least squares on asc + desc LoS + azimuth offsets → (Uₑ, Uₙ, U_z) ± σ | `fusionAt()` in `14_ui.js` |
| Phase unwrapping | Quality-guided flood fill (max-heap on γ), multi-region, animated front, RMS error vs truth | `Unwrapper` in `05_algorithms.js` |
| Change detection (CCD) | 3 simulated SLCs, γ̂ by integral images, Δγ + intensity ratio, 3×3 majority filter, connected components, marching-squares polygons, area & volume | `ccdJob()` in `05_algorithms.js` |
| Hydrology | Priority-flood (Barnes 2014) spill elevations, so levees really hold the water back | `priorityFlood()` |
| Fault | Screw dislocation (interseismic & coseismic), M₀ = μLDs̄, Mw, Δσ = (2/π)μs̄/D | `04_builder.js`, KPIs |
| Volcano | Mogi point source, ν = 0.25 | `mogi()` |
| Infrastructure | 10-year angular distortion β of every city block vs Bjerrum's 1/500 limit | buildings shader + KPIs |
| Orbit | Sun-synchronous dawn–dusk orbit propagated live, 242 km swaths painted on the globe, 12-day coverage | `10_globe.js` |

All GPU physics has a CPU twin (`04b_mirror.js`). The inspector, unwrapper and CCD therefore report exactly what the shaders draw.

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| `1`–`4` | Phase / deformation / polarimetry / coherence | `L` `S` `X` | L-band / S-band / X-ray lens |
| `Space` | Play / pause | `←` `→` | Previous / next 12-day pass |
| `U` | Phase unwrapping | `D` | Coherence change detection |
| `P` | Cross-section slicer (drag on the terrain) | `V` | Split view (2D radar ⟷ 3D) |
| `O` | Cycle orbit geometry (asc / desc / 3D fusion) | `G` | Back to the globe |
| `M` | Mission deck | `T` | Jury tour (Esc ends it, → skips a step) |
| `H` | Physics codex | `F` | Fullscreen |
| `N` | NISAR close-up (Esc or `N` returns) | `E` | Export data (Excel / CSV) |
| `R` | Real NISAR image on the terrain (on / off) | | |

Mouse: drag to orbit, right-drag to pan, wheel to zoom. Hover inspects a pixel, and a click pins the inspector there (that pixel is also the one the export's Pixel and Time-series sheets describe).

## Data export

| Excel sheet | Contents |
|---|---|
| README | Scene, pair, band, geometry and provenance; 3D snapshot; how to read the workbook; clickable table of contents; colour scales; data honesty |
| Pixel | Every inspector quantity for the pinned pixel, L- and S-band side by side, each with its meaning and formula |
| Time series | The 29 passes: LoS deformation, atmosphere, measured LoS, noise, true 3D motion, 12-day coherence, wrapped phase, fringes, events; chart and column guide |
| LoS map · Phase map · Coherence map | The scene on a 48 × 48 grid, cells coloured with the app's colour maps |
| Radar images | The four observables rendered like the app |
| KPIs | The scenario's headline numbers with explanations |
| CCD alerts · Unwrapping · Cross-section | Present when those tools were run before exporting |
| Glossary | Terms and formulas |

The CSV pack holds the same data as UTF-8 CSV files (comma, dot decimal) plus a README.txt that explains every file and column.
Downloads start normally directly in the browser.
The workbooks were checked by opening them in Microsoft Excel (no repair prompt), and the ZIP files with Python's `zipfile` (CRC check).
Deep links: `index.html#rainier`, `#carrizo`, `#jakobshavn`, `#atchafalaya`, `#danube`, `#mexico`.

## Run, build, deploy

```bash
# local server: http://localhost:8080 (rebuilds and reloads the page on every save in src/ or data/)
npm run dev                      # = node tools/serve.mjs --watch   (or double-click serve.bat on Windows)

# share it with teammates or the projector laptop on the same Wi-Fi
npm run lan                      # also prints http://<your-ip>:8080/

# static server without watching, or another port
node tools/serve.mjs --port 9000 --no-open

# rebuild by hand after editing src/
node tools/build.mjs             # writes dist/index.html
```

`tools/serve.mjs` has no dependencies (Node 18+). It rebuilds `dist/` first if it is older than the sources and sends no-cache headers.
It also serves `samples/`, so the CSAR-PACK self-test can be fetched from the page.
Without Node, `serve.bat` falls back to `python -m http.server`. You can also double-click `dist/index.html`, because the page is a single file.
With `--lan`, Windows may ask whether Node.js may use private networks. Allow it so teammates can connect.

To deploy on GitHub Pages, push the repository and serve `dist/` (or copy `dist/index.html` to the root).
The page needs internet access for three.js 0.160.0 from jsDelivr and for Google Fonts. Everything else is embedded.

### Offline version

`dist/offline.html` runs with no network at all, also when double-clicked (`file://`). It is the same page as `dist/index.html`, plus three.js 0.160.0, ExcelJS 4.4.0 and the Saira / Martian Mono fonts inlined (≈5.3 MB). Use it for a demo where the Wi-Fi can't be trusted.

```bash
npm run vendor                   # once, with internet: = node tools/fetch_vendor.mjs → vendor/
npm run build                    # now also writes dist/offline.html
```

`tools/fetch_vendor.mjs` reads the versions pinned in `src/template.html` and `src/js/14b_export.js` and stores those exact files in `vendor/` (with their licences).
The build embeds them as `data:` URLs: browsers refuse ES modules from `file://` paths, but they accept `data:` modules, and the import map still resolves `three` inside them.
`dist/index.html` is not affected: it stays byte-for-byte what it was.
If `vendor/` is missing, or no longer matches the pinned versions, the build skips `offline.html` and says why.

Put your team name in `CFG.team` in `src/js/01_core.js`. It appears in the last step of the jury tour.

## Real NISAR data (live from NASA)

The challenge's resources point to NASA Earthdata Search, ASF Vertex and the NISAR Data User Guide. The app uses the public services behind them directly, with no login:

| What | Where it comes from | How |
|---|---|---|
| Which real NISAR products cover the scene (GUNW interferograms, GCOV polarimetry): dates, track, frame, orbit direction, polarisation, footprint | NASA CMR, `cmr.earthdata.nasa.gov` (the catalogue behind Earthdata Search) | queried live from the browser each time you open a scene |
| Archive inventory over the scene (RSLC, GSLC, RIFG, RUNW, GUNW, ROFF, GOFF, GCOV, SME2) and the latest NISAR pass | NASA CMR | live |
| The pictures draped on the terrain | the NISAR QA browse images (`*_LATLON.png`) that ASF DAAC publishes with every product | downloaded live (≈2 MB), georeferenced in the browser and cropped to the scene |

What you see:
- **Interferogram (GUNW):** the phase between two real passes, normally 12 days apart, in the `twilight_shifted` colours NISAR's own QA software uses. Colour bands are fringes from real ground motion, atmosphere and noise; speckle means coherence was lost (water, fast ice, vegetation).
- **Polarimetry (GCOV):** real L-band backscatter, R and B = HH, G = HV (NISAR QA convention). Magenta = surface or double bounce, green = vegetation volume, dark = smooth water. Single-pol frames are grey.
- Green dots on the timeline are real NISAR passes over the scene; the green bar is the pair on screen.
- While the real image is on, the exaggeration drops to 1× and the simulated 3D objects (buildings, canopy, icebergs, vectors) are hidden, so only real data sits on the real DEM. The inspector, unwrapping and CCD still work on the simulated signals.

How the image is placed: the browse image is a north-up lat/lon grid with no bounds in the public metadata. The valid-data region is the granule footprint, so its top/bottom/left/right-most pixels are matched to the footprint vertices from CMR and a straight-line fit gives pixel ↔ lat/lon. On the six scenes the fit is within 0.4–2.3 browse pixels (≈100–550 m). The same code exists in Python (`tools/fetch_nisar.py`) and JavaScript (`src/js/13b_nisar.js`).

Limits, stated in the app too: browse images are quick-looks, not calibrated values (the numbers are in the `.h5` product, which needs a free Earthdata Login; the panel links to it). Most products are still labelled *provisional* by the mission. Nothing in this panel is simulated.

**Real values from downloaded products (`.h5`).** Browse images are pictures; the numbers are in the HDF5 products, which need a free Earthdata Login. Download them from the panel's *Data .h5 (login)* links, then:

```bash
pip install h5py                                     # once
python tools/nisar_h5.py path/to/folder_with_h5      # finds the scene of each product by itself
npm run build
```

`tools/nisar_h5.py` projects every scene cell onto the product grid with its own WGS84 → UTM and polar-stereographic (EPSG:3413, Greenland) code, gathers 8 × 8 samples per cell and writes `data/nisar_<scene>_<gcov|gunw>.json`. Included now, all from the user's downloads:

| Scene | Product | Pair / date |
|---|---|---|
| Mount Rainier | GUNW, track 106 A, frame 25 | 2026-10-07 → 10-19 |
| San Andreas (Carrizo) | GUNW, track 114 D, frame 71 | 2026-10-08 → 10-20 |
| Jakobshavn | GUNW, track 131 A, frame 37 (+ pixel offsets) | 2026-10-09 → 10-21 |
| Atchafalaya | GUNW, track 84 D, frame 73 | 2026-10-06 → 10-18 |
| Danube Delta | GUNW, track 100 A, frame 24 · GCOV, same track and frame | 2026-10-07 → 10-19 · 2026-10-31 |
| Mexico City | GUNW, track 113 D, frame 79 | 2026-10-08 → 10-20 |

- **GUNW** (interferogram): `1` real wrapped phase (complex multilook of the 20 m interferogram, in the app's phase colours, one cycle = λ/2 with the product's own λ), `2` line-of-sight change λ/4π · Δφ from the 80 m unwrapped phase, only on the largest connected component and relative to the scene median (sign as stored in the product, which does not state toward/away), `4` coherence. At Jakobshavn `2` shows ice speed from the along-track and slant-range pixel offsets (√ colour scale). This pair resolves the ice sheet flow up to ≈3.6 m/day (p99.5); the fastest part of the trunk returns no valid offset.
- **GCOV** (polarimetry): γ⁰ HH / HV with a fixed dB stretch.
- The panel prints the measured values under the cursor or at the pinned pixel; the granule is marked *.h5 values* and selected by default; the jury tour's real-data step shows the Mexico City phase.
- Size: ≈4.6 MB of real values in the page (`dist/index.html` ≈7.3 MB).

**Offline / sandboxed viewers.** `python tools/fetch_nisar.py` stores a snapshot in `data/nisar_<scene>.json` (product lists, inventory, the newest GUNW and GCOV crops as WebP; ≈0.7 MB for all six), and the build embeds it. The page shows the snapshot at once, replaces it with the live CMR answer when the network allows, and says which one you are looking at (`LIVE · NASA CMR` or `SNAPSHOT <date>`). Re-run the script before a demo to refresh it, then `npm run build`.

## Real data: CSAR-PACK

`tools/csar_pack.py` converts real InSAR products into a pack that the app loads by drag and drop:

```bash
# ASF HyP3 Sentinel-1 product (auto-detects *_dem / *_corr / *_los_disp / *_amp)
python tools/csar_pack.py --hyp3 S1AA_..._INT80_G_ueF_1234 --title "Kilauea 2026" -o kilauea

# NISAR L-band GeoTIFFs (unwrapped phase in radians)
python tools/csar_pack.py --dem dem.tif --unw unw.tif --coh corr.tif --wavelength 0.2385 --look left \
       --lat 19.41 --lon -155.28 --extent-km 40 --sensor NISAR-L --date1 2026-01-02 --date2 2026-01-14 -o myscene
```

Drop `myscene.png` + `myscene.json` on the page, or use **LOAD REAL NISAR / HyP3 DATA**.
The fringes are then recomputed from the real unwrapped LoS displacement with the pack's own wavelength. Coherence and amplitude come from the product.
`samples/csar_pack_selftest.*` is a ready-made test pack.
The pack stores DEM and LoS as 16-bit pairs in two RGB halves, because 8-bit channels and canvas alpha pre-multiplication would corrupt them.
`rasterio` is optional. Without it, pass `--lat --lon --extent-km`.

## Regenerate the elevation models

```bash
python tools/fetch_dem.py --cache ./_tiles          # AWS Terrain Tiles + Copernicus GLO-90 → data/*.json
node tools/build.mjs
```

`tools/qa_node.mjs` runs the whole simulation headless in Node. It prints build times, unwrapping error and CCD detection area against ground truth, and writes PNG previews.

## Source layout

```
src/template.html      HUD markup            src/styles.css     HUD styles
src/js/01_core.js      utils, colour maps    02_physics.js      radar physics, Freeman–Durden, WLS
03_sites.js            the six scenes        04_builder.js      forward models per scene
04b_mirror.js          CPU twin of shaders   05_algorithms.js   priority-flood, unwrapping, CCD
06_shaders.js          all GLSL              07_satellite.js    light NISAR model (globe)
07b_satellite_hd.js    high-detail NISAR     08_world.js / 09_… 3D scene & updates
10_globe.js            orbit + swath paint   11_audio.js        sound design (Web Audio)
12_charts.js           phasor, charts        13_app.js          state, jobs, close-up, loader
13b_nisar.js           real NISAR data (CMR live, browse images, terrain overlay)
14_ui.js               HUD, inspector, loop  14b_export.js      Excel / CSV export + downlink
15_tour.js             jury tour             16_boot.js         boot sequence
```

## Credits & data attribution

- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen; sources include SRTM, USGS 3DEP, GMTED2010, ETOPO1, INEGI).
- Copernicus DEM GLO-90: produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
- NISAR mission parameters: NASA/JPL and ISRO public mission material.
- NISAR products and browse images: NASA/JPL-Caltech and ISRO, distributed by the [ASF DAAC](https://asf.alaska.edu/); catalogue metadata from [NASA CMR](https://cmr.earthdata.nasa.gov/). Browse colour conventions from the open-source NISAR QA software ([isce-framework/nisarqa](https://github.com/isce-framework/nisarqa)).
- [three.js](https://threejs.org) (MIT) · [ExcelJS](https://github.com/exceljs/exceljs) (MIT), loaded on first export.
- Physics: Mogi (1958); Savage & Burford (1973); Freeman & Durden (1998); Just & Bamler (1994); Alsdorf et al. (2000); Wdowinski et al. (2004); Barnes et al. (2014); Bjerrum (1963).

## Pe scurt (RO)

Fără internet: deschide `dist/offline.html` (merge și cu dublu-click). Se generează cu `npm run vendor` (o singură dată, cu internet), apoi `npm run build`.
Pornește serverul local cu dublu-click pe `serve.bat` (sau `npm run dev`) și deschide http://localhost:8080. Apasă **JURY TOUR** și lasă aplicația să se prezinte singură în circa 2,5–3 minute (14 pași; penultimul arată interferograma NISAR reală a orașului Mexico City). E bun și pentru înregistrarea video de la depunere.
Cu `npm run lan` îl pot deschide și colegii din aceeași rețea Wi-Fi.
Fiecare scenă are relief real. Semnalele radar sunt simulate fizic, iar butonul „Load real data” acceptă interferograme reale prin `tools/csar_pack.py`.
**Date NISAR reale, live de la NASA:** panoul „Real NISAR data” (tasta `R`) întreabă la deschiderea fiecărei scene catalogul NASA CMR ce produse NISAR reale o acoperă. Afișează ultima trecere și inventarul arhivei, și pune pe relief interferograma reală (GUNW) sau imaginea polarimetrică reală (GCOV). Fără internet se folosește copia inclusă în pagină (`python tools/fetch_nisar.py`), iar panoul spune clar dacă e „LIVE” sau „SNAPSHOT”.
Numele echipei se pune în `CFG.team`, în `src/js/01_core.js`, după care rulezi `node tools/build.mjs`.
Noutăți: butonul **NISAR** (tasta `N`) duce camera lângă satelit și redă desfășurarea reflectorului. **EXPORT DATA** (tasta `E`) generează un Excel colorat, cu explicații pentru fiecare set de date, sau un pachet CSV. Sunetul e acum ambiental și cinematic, fără bipuri; îl pornești din iconița de difuzor.
