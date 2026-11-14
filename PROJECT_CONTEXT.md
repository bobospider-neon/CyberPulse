# CHRONO-SAR · contextul proiectului (pentru continuarea dezvoltării)

Document scris pe 13 noiembrie 2026, pe baza codului din proiect și a lucrului din sesiunile anterioare. Unde ceva nu a putut fi verificat, scrie explicit.

---

## 1. Ce este proiectul

**CHRONO-SAR · 4D NISAR Earth-motion engine** este o aplicație web făcută pentru **NASA Space Apps Challenge 2026**, provocarea **„Dancing with the SARs”**. Conform notițelor din sesiunile anterioare, evenimentul are loc pe 14–15 noiembrie 2026.

Scop: să facă vizibilă fizica radarului NISAR (misiunea NASA-ISRO, banda L de 23,85 cm și banda S de 9,37 cm). Faza interferometrică mută vârfurile unui model digital de elevație real, astfel încât mișcările milimetrice ale solului devin teren 3D animat. Juriul poate inspecta orice pixel, rula algoritmii radar în browser și exporta datele.

Principiu de onestitate, păstrat peste tot:
- **reliefurile (DEM) sunt reale**;
- **semnalele radar sunt simulate fizic**.

Fiecare scenă afișează eticheta `SIMULATED SIGNALS · REAL DEM`. Când se încarcă o interferogramă reală (CSAR-PACK), eticheta devine `REAL DATA`. Când e pornită imaginea NISAR reală (tasta R, din 14 noiembrie 2026), eticheta devine `REAL NISAR GUNW · NASA/ASF` sau `REAL NISAR GCOV · NASA/ASF`.

Pe lângă site, proiectul conține o **prezentare pentru juriu** (`presentation/CHRONO-SAR_pitch.pptx`, 9 slide-uri video) și uneltele care o generează.

## 2. Tehnologii

### Site
- JavaScript „vanilla” (module ES), fără framework și fără bundler. Fișierele `src/js/*.js` sunt **concatenate în ordinea numelui** într-un singur `<script type="module">`.
- **three.js 0.160.0**, încărcat prin `importmap` de pe jsDelivr (vezi finalul `src/template.html`). Addon-uri folosite: OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, RoomEnvironment, BufferGeometryUtils.
- GLSL scris de mână (`06_shaders.js`), WebGL 2 obligatoriu (`13_app.js` aruncă eroare fără WebGL 2).
- Web Audio (sunet sintetizat, fără fișiere audio), Canvas 2D (grafice, animația de export).
- **ExcelJS 4.4.0**, încărcat de pe jsDelivr abia la primul export Excel (`14b_export.js`, `EXCELJS_URL`).
- Fonturi Google: Saira și Martian Mono.

### Unelte (Node și Python)
- **Node.js ≥ 18**. `package.json` are doar scripturi și **nicio dependență npm**, deci nu există lockfile și nici `node_modules`.
- **Python 3** cu **numpy** și **Pillow** pentru `tools/fetch_dem.py`. Scriptul descarcă DEM-urile de pe AWS Terrain Tiles și Copernicus GLO-90.
- **Python 3** cu **numpy** pentru `tools/csar_pack.py`, plus **rasterio** opțional.

### Unelte de prezentare (doar Windows)
- PowerPoint pentru desktop, pilotat prin COM din JScript (`cscript`). Pe calculatorul original era PowerPoint 2010 (14.0.4734).
- PowerShell 5.1 cu transcoderul WinRT (MP4 → WMV).
- Chrome sau Edge headless controlat prin CDP din Node.
- Python cu Pillow pentru planșe și verificări.

### Mediul original
Windows 11 Pro, Node 24.20.0, Python 3.11.9, PowerShell 5.1.26100, Chrome.

## 3. Structura proiectului

```
README.md            documentația principală (EN + rezumat RO): funcții, taste, export, rulare, CSAR-PACK
package.json         scripturi npm: start, dev, lan, build, qa (fără dependențe)
serve.bat            dublu-click pe Windows: pornește serverul (Node sau, ca rezervă, Python)
src/
  template.html      HTML-ul HUD-ului, cu marcaje înlocuite la build: /*__CSS__*/, <!--__DATA__-->, /*__JS__*/, <!--__HEAD_END__-->
  styles.css         stilurile HUD-ului (variabile CSS, temă întunecată unică)
  js/00_imports.js   importuri three.js; ColorManagement dezactivat
  js/01_core.js      CFG (inclusiv numele echipei), utilitare, hărți de culori, PRNG determinist
  js/02_physics.js   fizica radar: benzi, coerență, Cramér–Rao, Freeman–Durden, WLS
  js/03_sites.js     catalogul celor 6 scene (4 „valsuri”)
  js/04_builder.js   modelele directe per scenă (Mogi, falie, gheață, inundații, subsidență)
  js/04b_mirror.js   geamănul CPU al shaderelor (inspectorul și exportul citesc de aici)
  js/05_algorithms.js  priority-flood, despachetarea fazei (Unwrapper), CCD
  js/06_shaders.js   tot GLSL-ul (teren, apă, fascicul, lentilă, cer, post-procesare)
  js/07_satellite.js   model NISAR simplu (glob)
  js/07b_satellite_hd.js  model NISAR detaliat + desfășurarea brațului și reflectorului
  js/08_world.js     graful scenei 3D, texturi de date
  js/09_world_update.js  actualizarea pe cadru (sateliți, fascicule, acoperire)
  js/10_globe.js     globul, orbita, pictarea fâșiilor
  js/11_audio.js     designul sonor
  js/12_charts.js    ceasul fazor, seria temporală, grafice
  js/13_app.js       starea (S, App), tranziții, joburi (unwrap, CCD, ruptură), close-up NISAR, încărcarea CSAR-PACK
  js/13b_nisar.js    date NISAR reale: interogare live NASA CMR, imagini browse ASF georeferențiate, suprapunerea pe teren (tasta R)
  js/14_ui.js        HUD, inspector, KPI, bucla principală, scurtături de tastatură
  js/14b_export.js   exportul Excel/CSV + animația „DATA DOWNLINK”
  js/15_tour.js      turul automat pentru juriu (14 pași; pasul 13 arată datele NISAR reale)
  js/16_boot.js      ecranul de pornire; expune window.CSAR (folosit de uneltele de prezentare)
data/
  dem_<scenă>.json   DEM-uri 384×384 codate (zlib + delta), generate de tools/fetch_dem.py
  dem_<scenă>_preview.png  previzualizări hillshade pentru QA
  globe_landmask.json      masca de uscat a globului
  nisar_<scenă>.json       snapshot cu date NISAR reale (liste de produse, inventar, decupaje GUNW și GCOV în WebP), generat de tools/fetch_nisar.py
  nisar_<scenă>_gunw.json  valori reale GUNW (fază, LoS, coerență; offset-uri la Jakobshavn); nisar_danube_gcov.json: γ⁰ HH/HV; generate de tools/nisar_h5.py
samples/             csar_pack_selftest.png/.json: un pachet CSAR-PACK de test (drag & drop în pagină)
tools/
  build.mjs          asamblează src/ + data/ în dist/index.html (document complet);
                     dacă există vendor/, scrie și dist/offline.html
  fetch_vendor.mjs   descarcă o singură dată three.js, ExcelJS și fonturile în vendor/ (pentru varianta offline)
  serve.mjs          server local fără dependențe; --watch reconstruiește și reîncarcă pagina
  qa_node.mjs        rulează simularea în Node pe datele reale și scrie PNG-uri în qa/
  fetch_dem.py       regenerează DEM-urile (rețea + numpy + Pillow)
  fetch_nisar.py     reîmprospătează snapshot-ul NISAR real (NASA CMR + browse ASF; rețea + numpy + Pillow, fără login)
  nisar_h5.py        citește un produs NISAR GCOV .h5 descărcat (numpy + h5py) și scrie valorile γ⁰ pe gridul scenei
  csar_pack.py       convertește un produs InSAR real în CSAR-PACK
dist/
  index.html         site-ul construit, un singur fișier (≈2,9 MB cu datele NISAR reale)
  offline.html       același site, cu three.js, ExcelJS și fonturile incluse ca data: URL (≈6,4 MB, merge fără internet)
vendor/              copii locale ale bibliotecilor de pe CDN (three@0.160.0, exceljs@4.4.0, fonturi), cu licențele; manifest.json
presentation/
  CHRONO-SAR_pitch.pptx  prezentarea finală (9 slide-uri, 19 clipuri WMV incluse, ≈86 MB)
  README.md          instrucțiuni de prezentare (RO)
  tools/             generatorul prezentării și pipeline-ul de captură (vezi secțiunea 11)
  assets/wmv, posters, stills   intrările necesare pentru reconstruirea prezentării
```

## 4. Funcționalități implementate

Le-am verificat în cod și, unde scrie, prin teste.

- **Globul** cu orbita NISAR propagată live: fâșii de 242 km pictate, acoperire în 12 zile, markere pentru scene, „Mission deck”.
- **Șase scene** pe DEM-uri reale, grupate în patru „valsuri” (detaliile sunt în tabelul din `README.md`):
  - Mount Rainier (sursă Mogi, curgere de debris);
  - falia San Andreas (ruptură Mw 7,9 la cerere);
  - ghețarul Jakobshavn (speckle tracking, desprindere de gheață);
  - bazinul Atchafalaya (lentila X-ray);
  - Delta Dunării (polarimetrie, „home waters”);
  - Mexico City (subsidență, β = 1/500).
- **Observabile:**
  - faza înfășurată;
  - deformarea 3D (cu linii de contur);
  - polarimetria Freeman–Durden;
  - coerența.
- **Benzile radar:** L, S și **lentila X-ray** (L în interiorul lentilei, S în afara ei).
- **Geometria orbitei:** ascendentă, descendentă sau fuziune 3D.
- **Exagerarea** reliefului, de la 1× la 5000×.
- **Linia timpului:** 29 de treceri, la 12 zile una de alta.
- **Inspector** de pixel: ceasul fazor, formula, valorile pe banda L și S, seria temporală. Click-ul fixează pixelul.
- **Algoritmi live:**
  - despachetarea fazei (flood fill ghidat de calitate, cu frontul animat);
  - CCD (detecția schimbărilor de coerență din 3 SLC-uri simulate, cu poligoane, arie și volum);
  - ruptura faliei;
  - secțiunea transversală;
  - split view (radar 2D ⟷ 3D).
- **Close-up NISAR** (tasta N): model detaliat, desfășurarea brațului și a reflectorului, sunete de servo și de blocare.
- **Export de date** (tasta E), cu animația „DATA DOWNLINK”:
  - un workbook Excel cu foi colorate, grafice și explicații;
  - sau un pachet CSV (.zip cu README.txt);
  - se descarcă direct în browser.
- **Turul pentru juriu** (tasta T): 14 pași.
  - Cu 13 pași, măsurat pe 11 noiembrie 2026 pe calculatorul original: 2 min 22 s.
  - Pe 14 noiembrie 2026 a fost adăugat pasul 13, „Real NISAR, live from NASA”, înaintea ultimului pas. Rămâne pe Mexico City, închide instrumentele (slicer, CCD), pune interferograma GUNW reală (copia inclusă în pagină, ca turul să nu aștepte o descărcare), afișează datele perechii și așteaptă 10 s. La întoarcerea pe glob, imaginea se stinge.
  - Măsurat pe 14 noiembrie 2026, în Chrome headless pe un alt calculator (Intel UHD): 3 min 7 s în total, din care 10,0 s pasul nou și fără nicio eroare. Pe calculatorul original n-a fost remăsurat; estimarea e de circa 2 min 32 s.
- **Încărcătorul CSAR-PACK:** drag & drop sau butonul „LOAD REAL NISAR / HyP3 DATA”.
- **Date NISAR reale, live de la NASA** (14 noiembrie 2026; panoul „Real NISAR data” din dreapta, tasta R):
  - la deschiderea fiecărei scene, interogare live a NASA CMR: produsele GUNW și GCOV reale care acoperă scena (date, track, frame, A/D, polarizare, acoperire), inventarul arhivei pe 9 tipuri de produse și ultima trecere NISAR;
  - imaginea browse reală (GUNW: fază, culori `twilight_shifted`; GCOV: R, B = HH, G = HV), descărcată de la ASF, georeferențiată în browser și pusă pe relief; la pornire, exagerarea trece la 1× și obiectele 3D simulate sunt ascunse;
  - trecerile reale apar ca puncte verzi pe linia timpului, iar perechea afișată ca bară verde;
  - linkuri spre Earthdata Search, fișa produsului din CMR și fișierul `.h5` (cere Earthdata Login);
  - fără rețea sau în vizualizatoare izolate: snapshot inclus în pagină, marcat `SNAPSHOT <dată>`.
  - **Valori calibrate din `.h5`** (Delta Dunării, 14 noiembrie 2026): produsul GCOV descărcat de utilizator cu contul lui Earthdata e citit de `tools/nisar_h5.py`. Scriptul are proiecție UTM proprie și face media puterii liniare pe 8×8 eșantioane pe celulă. Granula e marcată „.h5 values” și aleasă implicit; terenul arată HH/HV cu întindere fixă în dB (HH −25…0, HV −30…−5), iar panoul afișează γ⁰ HH, HV și HV/HH măsurate sub cursor sau la pixelul fixat. Verificat: aliniere cu apa din DEM și cu browse-ul ASF; marea deschisă ≈ −15 dB HH / −22 dB HV. Fișierul `.h5` (1,7 GB) nu e în proiect, doar rezultatul.
  - **Valori GUNW reale pe toate cele 6 scene** (14 noiembrie 2026): `tools/nisar_h5.py <folder>` recunoaște singur scena fiecărui fișier (inclusiv proiecția polară EPSG:3413 la Jakobshavn) și scrie `data/nisar_<scenă>_gunw.json`. În site, cu R pornit, tastele 1 / 2 / 4 arată faza reală, schimbarea LoS (λ/4π·Δφ, doar pe cea mai mare componentă conexă, relativ la mediana scenei, cu semnul din produs, deoarece fișierul nu precizează spre/dinspre satelit) și coerența; la Jakobshavn, 2 = viteza gheții din offset-uri (până la ≈3,6 m/zi; brațul cel mai rapid nu are offset valid în această pereche). Fișierele de valori au fost redenumite `nisar_<scenă>_<gcov|gunw>.json`. Fișierul GCOV `.h5` al Deltei nu mai există pe disc; valorile lui au fost recuperate din build-ul anterior. Turul (pasul 13) arată faza reală a orașului Mexico City; textul nu mai afirmă că „bolul” e scufundarea orașului, pentru că perechea reală de 12 zile nu arată asta clar.
- **Sunetul:** ambient, sintetizat; pornește din iconița de difuzor.
- **Linkuri directe:** `index.html#rainier`, `#carrizo`, `#jakobshavn`, `#atchafalaya`, `#danube`, `#mexico`.
- **Ecrane mici:** există reguli CSS pentru lățimi sub 900 px (tab-uri mobile). Vezi secțiunea 5 pentru ce s-a testat.

## 5. Ce funcționează (verificat)

- **Build:** `node tools/build.mjs --check && node --check dist/_bundle_check.mjs` trece. `dist/` este mai nou decât toate sursele, deci reflectă codul actual.
- **Test de funcționare** (12 noiembrie 2026, Chrome headless, fără nicio eroare de script):
  - close-up-ul NISAR cu desfășurarea reflectorului;
  - ieșirea cu Esc în mijlocul desfășurării (reflectorul se deschide complet);
  - ruptura San Andreas;
  - CCD în Mexico City;
  - despachetarea fazei pe Rainier: 146.894 px, o regiune, eroare RMS 4,34 mm, 0 cicluri greșite;
  - construirea pachetului CSV;
  - întoarcerea pe glob.
- **CCD pe Rainier** (folosit în prezentare): 6,24 km² găsiți, față de 5,62 km² în model.
- **`npm run qa` (Node)** pe 13 noiembrie 2026, scena Rainier, a dat aceleași rezultate pe original și pe copia din arhivă:
  - despachetare: 80.380 px, 387 regiuni, RMS 0,383 rad, 0 erori mai mari de π;
  - CCD: 6,24 km² (adevărul: 5,62).
  - Harness-ul QA folosește setările lui proprii, de aceea cifrele de despachetare diferă de cele din aplicație (146.894 px). **Nu e un bug**; nu le compara între ele.
- **Exportul Excel** a fost deschis în Microsoft Excel fără mesaj de reparare (sesiune anterioară).
- **Versiunea de producție:**
  - `dist/index.html` este compilat și verificat.
- **Varianta offline** (13 noiembrie 2026, Chrome):
  - servită prin http: 0 cereri în afara serverului local, fonturile Saira și Martian Mono încărcate, ExcelJS prezent; Rainier + despachetare rulate, workbook-ul Excel (10 foi, recitit cu ExcelJS) și pachetul CSV construite;
  - deschisă din `file://` în Chrome headless, cu toate DNS-urile blocate: pornire completă până la glob, nicio eroare, nicio cerere de rețea.
- **Netestat:**
  - nu am confirmare de teste în Firefox sau Safari; testele s-au făcut în Chromium;
  - nu am confirmare clară de test pe un telefon real.

## 6. Ce nu funcționează sau are limite (probleme cunoscute)

1. **`dist/index.html` are nevoie de internet.** three.js și fonturile vin de pe CDN, iar exportul Excel are nevoie de ExcelJS de pe jsDelivr. Fără internet se folosește **`dist/offline.html`** (adăugat pe 13 noiembrie 2026; vezi secțiunea 8).
2. **Fără WebGL 2, site-ul nu rulează** (mesaj de eroare la pornire).
3. **Aspect „pixelat” de aproape.**
   - Shaderele citesc datele cu `NearestFilter` și folosesc 20 de looks, deci fiecare celulă radar e un pătrat cu zgomot.
   - Utilizatorul a numit asta „Minecraft” și a cerut aspect neted **doar pentru prezentare**. Pe 12 noiembrie 2026 a decis explicit să **nu** se schimbe site-ul.
   - Varianta netedă există numai în uneltele de captură: `CAP.cine()` în `presentation/tools/scene_lib.js`.
4. **Reflexia soarelui pe reflector** (sprite-ul „sun-glint” din `07b_satellite_hd.js`) poate deveni o pată albă mare din anumite unghiuri. A fost redusă, dar nu eliminată. Capturile pentru prezentare o ascund.
5. **Rezultatul despachetării dispare** când timpul avansează: `markStale()` din `13_app.js` îl șterge la schimbarea epocii. E intenționat; turul pune pauză înainte.
6. **`enterSite()` și ieșirea din close-up sunt ignorate cât timp `S.busy` este activ** (în timpul zborului camerei). E intenționat.
7. **CSAR-PACK pe date reale:** există un pachet de test sintetic (`samples/`). **Nu am confirmare** că s-a încărcat vreodată un produs real HyP3 sau NISAR, descărcat și convertit cu `csar_pack.py`.
8. **Numele echipei** e **CyberPulse** (14 noiembrie 2026): în `CFG.team` (`src/js/01_core.js`), în `TEAM` din `presentation/tools/build_deck.src.js` și pe slide-ul 1 din `CHRONO-SAR_pitch_v7.pptx`. „CHRONO-SAR” rămâne numele aplicației.
9. **Datele NISAR reale sunt imagini browse, nu valori calibrate.** Fișierele `.h5` cu valorile propriu-zise cer Earthdata Login, deci nu sunt citite de pagină (doar link). Majoritatea produselor sunt încă „provisional”. Inspectorul, despachetarea și CCD lucrează în continuare pe semnalele simulate. Georeferențierea browse-ului e o potrivire empirică amprentă ↔ pixeli valizi, cu eroare de 0,4–2,3 px (≈100–550 m) pe cele 6 scene; corespondența dintre `poly` din CMR și marginile imaginii nu e documentată oficial.
10. **Fila ascunsă:** dacă pagina e într-o filă ascunsă, browserul încetinește `requestAnimationFrame` și pornirea pare blocată. E comportamentul normal al browserului.

## 7. Incomplet sau în dezvoltare

- Modul offline: făcut pe 13 noiembrie 2026 (`dist/offline.html`). Testat doar în Chromium; nu a fost încercat pe laptopul de concurs.
- Testarea în Firefox, Safari și pe mobil.
- Testul CSAR-PACK cu un produs real.
- Publicarea pe un hosting propriu (de exemplu GitHub Pages): nu știu să fi fost făcută. README-ul descrie doar cum s-ar face.
- Nu există teste automate în afară de `tools/qa_node.mjs` (simularea) și scripturile de test din `presentation/tools/jobs/` (`smoke.js`, `smoke_unwrap.js`).

## 8. Decizii importante

- **Un singur fișier HTML autonom.**
  - Datele sunt incluse în pagină (`window.CSAR_DATA`).
  - Nu există bundler și nici dependențe npm.
  - Ordinea fișierelor `00_…16_` contează, pentru că modulele își împart variabilele globale.
- **Varianta offline (13 noiembrie 2026).**
  - `npm run vendor` (`tools/fetch_vendor.mjs`) descarcă o dată, în `vendor/`, exact versiunile fixate în `src/template.html` și `14b_export.js`.
  - `tools/build.mjs` scrie atunci și `dist/offline.html`: fonturile ca `@font-face` cu data: URL, ExcelJS ca `<script defer src="data:…">` (deci `loadExcelJS()` găsește `window.ExcelJS` și nu mai iese pe rețea), iar three.js și addon-urile ca data: URL în importmap. Importurile relative din addon-uri sunt rescrise în `three/addons/…`, ca să treacă prin importmap.
  - De ce data: URL și nu fișiere locale: browserele nu încarcă module ES din `file://`, deci doar un singur fișier merge și cu dublu-click.
  - Codul din `src/` nu a fost atins; `dist/index.html` rămâne identic octet cu octet. Build-ul sare peste `offline.html` dacă `vendor/` lipsește sau nu mai corespunde versiunilor fixate, și dă eroare dacă rămâne vreo adresă de CDN în fișier (în afară de constanta `EXCELJS_URL`, nefolosită acolo).
- **Date NISAR reale (14 noiembrie 2026).**
  - Sursele vin din pagina de resurse a provocării (Earthdata Search, ASF Vertex, NISAR Data User Guide). Pagina folosește direct serviciile publice din spatele lor: NASA CMR (`granules.umm_json`, CORS deschis) și imaginile browse ASF (`*_LATLON.png`, publice, CORS deschis). Fără login și fără chei.
  - Semnificația culorilor vine din codul NISAR QA (`isce-framework/nisarqa`): GUNW browse = fază, colormap `twilight_shifted`, fără modulare de luminozitate; GCOV dual-pol = R HHHH, G HVHV, B HHHH; valoarea 0 = lipsă date.
  - Selecția implicită: cel mai nou produs care acoperă toată scena; la GUNW, de preferință o pereche de cel mult 24 de zile. Ordinea colecțiilor: validated, provisional, beta.
  - Suprapunerea e în `TERRAIN_FS` (`uReal`, `uRealOn`), cu aceeași scară de lumină ca observabilele simulate (altfel bloom-ul o albește). E o imagine, nu fizică, deci nu are pereche în `04b_mirror.js`.
  - Georeferențierea există de două ori, în `tools/fetch_nisar.py` (`fit_browse`) și `13b_nisar.js` (`realFitBrowse`); trebuie ținute sincron.
  - Anti-aliasing temporal al fazei (14 noiembrie 2026): pe gheața rapidă (Jakobshavn, ~30 m/zi), la redare faza se schimba cu zeci de radiani pe cadru, iar culorile pâlpâiau aleatoriu. `TERRAIN_FS` estompează spre gri neutru pixelii a căror fază s-ar schimba cu mai mult de ~1 rad pe cadru (`uFrameDays` din `09_world_update.js` × viteza gheții din `uStatic.a`); pe pauză franjele revin. Doar afișare, deci fără pereche în `04b_mirror.js`. Măsurat de aproape: diferența dintre cadre a scăzut de la 14–23 la 2,2 (pe pauză: 2,0).
  - Reparat în același timp: eticheta lentilei X-ray rămânea pe ecran după trecerea pe banda L (`Labels.update` nu reseta `it.show`).
- **Onestitatea datelor.**
  - DEM-urile sunt reale, semnalele simulate, și asta e scris în aplicație și în export.
  - Afirmații corectate în noiembrie 2026: datele NISAR L-band **sunt** publice din 2026 (ASF DAAC), iar brațul NISAR are **patru balamale**.
- **Geamănul CPU (`04b_mirror.js`)** trebuie să rămână sincronizat cu GLSL-ul. Inspectorul, despachetarea, CCD și exportul raportează exact ce desenează shaderele.
- **`THREE.ColorManagement.enabled = false`:** culorile sunt scrise direct ca valori de afișare (aspect „neon”).
- **Variabilele interpolate (varyings) sunt limitate (clamp) în shadere**, pentru că MSAA le extrapolează pe triunghiurile văzute din profil. Două buguri reparate astfel:
  - pată albă pe pereții blocului de teren (`SKIRT_FS`);
  - sclipire de un cadru a fasciculului (`BEAM_FS`).
- **Web Audio:** fiecare voce pornește cu `gain.value = 0` și folosește doar rampe. Altfel se aude un clic de un eșantion.
- **Limba:** interfața aplicației și textul slide-urilor sunt în engleză; README-ul are un rezumat în română; comunicarea cu utilizatorul se face în română.
- **Prezentarea e generată de un script.**
  - PowerPoint o scrie prin COM; nu se editează manual.
  - Clipurile sunt WMV pentru că PowerPoint 2010 nu redă MP4.
  - „Modelele 3D” din prezentare sunt clipuri randate din aplicația reală.

## 9. Convenții de cod și design

- **JavaScript:**
  - 2 spații, punct și virgulă, ghilimele simple, `const`/`let`;
  - funcții scurte, helperi DOM `$` și `$$`;
  - starea globală în `S` (scena și UI), `App` (renderer, cameră) și `CFG` (configurație);
  - fiecare fișier începe cu un banner `// ─── NN · NUME ───`.
- **Comentariile** explică „de ce”, nu „ce”.
- **Paleta** (variabile CSS în `src/styles.css`):
  - `--lband #ffb648` (auriu, banda L);
  - `--sband #3ee6ff` (cyan, banda S);
  - `--void #02050a` (fundal);
  - `--alert #ff4a4a`, `--good #4cf2a8`.
- **Temă:** o singură temă, întunecată.
- **Fonturi:** Saira (afișaj) și Martian Mono (cifre).
- **Unități afișate:** cm/mm pentru deplasare, zile pentru timp, λ în cm.
- **Textele din interfață:** engleză simplă, propoziții scurte, fără formulări pompoase.

## 10. Ce trebuie păstrat (nu se schimbă fără motiv)

- **Configurația și datele:**
  - `CFG.N = 384`, `nEpochs = 29`, `repeatDays = 12`, `t0 = 28.11.2025`: datele și cifrele din prezentare depind de ele;
  - formatul datelor din `data/*.json` (decodat în browser cu `DecompressionStream`).
- **Codul:**
  - ordinea și numerotarea fișierelor din `src/js/`;
  - perechea shader ⟷ `04b_mirror.js`;
  - marcajele din `src/template.html` folosite de `tools/build.mjs`;
  - numele fișierelor din `dist/` (`index.html`, `offline.html`);
  - versiunea three.js fixată la 0.160.0 în importmap.
- **Onestitatea:** etichetele și textele „data honesty”, precum și eticheta REAL DATA la datele încărcate.
- **`window.CSAR`** din `16_boot.js`: îl folosesc uneltele de prezentare.
- **Cifrele de pe slide-uri** vin din algoritmi: 4,3 mm, 146.894 px, 6,2 km² față de 5,6 km² în model, Mw 7,9, 35 cm/an în Mexico City. Dacă se schimbă algoritmii sau datele, trebuie actualizate și slide-urile.

## 11. Prezentarea și pipeline-ul ei

- **Generare:**
  - `presentation/tools/run_build.ps1` rulează `build_deck.src.js` prin `cscript`;
  - sursa e UTF-8 și e convertită în UTF-16 înainte de rulare;
  - PowerPoint scrie `CHRONO-SAR_pitch.pptx`, îl redeschide și exportă PNG-uri în `assets/review/slides/`.
- **Verificarea mișcării:** `run_video.ps1` redă show-ul în filme de verificare.
- **Clipurile:**
  - se randează cadru cu cadru din aplicația reală;
  - pornești `node presentation/tools/cdp_host.mjs` (Chrome headless pe portul 9333, servește `dist/` pe 5199);
  - apoi rulezi `bash presentation/tools/open_app.sh <scenă>` și `node presentation/tools/ev.mjs js presentation/tools/jobs/<job>.js '<json>'`;
  - ies MP4 în `assets/video/`;
  - `transcode_all.ps1` le face WMV în `assets/wmv/`;
  - `jobs/posters.js` extrage posterele.
- **Interfața de pe slide-ul 8:** `ui_record.mjs` (evenimente reale de mouse, capturi de ecran) și `jobs/ui_encode.js`.
- **Aspectul cinematic doar pentru capturi** (`scene_lib.js`):
  - `CAP.cine()`: filtrare biliniară și 400 de looks;
  - `CAP.beamFX()`: fascicul neon cu impulsuri și ecouri;
  - aplicația însăși **nu** este modificată de ele.
- **Verificări:**
  - `jobs/spikes.js` caută sclipiri cadru cu cadru (obligatoriu pentru fiecare clip nou);
  - `dump_deck.src.js` scoate tot textul prezentării;
  - `inspect_pptx.py` verifică pachetul.
- **Probleme întâlnite și rezolvate** (utile mai departe):
  - joburile din pagină folosesc `CAP.real.st`, pentru că `CAP.take` preia `setTimeout`;
  - `CAP.step` rulează toate callback-urile `requestAnimationFrame` din coadă;
  - predarea între două clipuri (A rulează o dată, B pornește „after previous” în buclă) merge doar dacă toate efectele din grupul lui A se termină înaintea lui A.
- **În arhivă lipsesc master-ele MP4** (422 MB). Clipurile WMV din arhivă ajung pentru reconstruirea prezentării. Pentru un clip nou sau modificat, se re-randează cu jobul lui.
- **Pe alt calculator:**
  - `cdp_host.mjs` caută Chrome în `C:/Program Files/Google/Chrome/Application/chrome.exe` sau Edge în locația standard;
  - pipeline-ul de prezentare a fost folosit doar cu PowerPoint 2010. Cu o versiune mai nouă ar trebui să meargă (aceeași interfață COM), dar **nu a fost verificat**.

## 12. Pași următori recomandați

1. Numele echipei e setat (CyberPulse). Atenție: prezentarea finală e `CHRONO-SAR_pitch_v7.pptx`, editată direct (slide-urile 4 și 8 noi, linia de echipă scoasă de pe slide-ul 8). `run_build.ps1` ar regenera versiunea veche și ar pierde aceste modificări.
2. Testează site-ul în Firefox, Safari și pe un telefon. Testează prezentarea pe laptopul de concurs (PowerPoint pe Windows, laptopul la priză).
3. Varianta offline e gata (`dist/offline.html`). Încearc-o pe laptopul de concurs cu Wi-Fi-ul oprit, cu dublu-click pe fișier.
4. Testează CSAR-PACK cu un produs real ASF HyP3 sau NISAR GUNW. Panoul „Real NISAR data” dă linkul direct spre `.h5`-ul fiecărei scene (descărcare cu cont Earthdata gratuit); `csar_pack.py` citește acum GeoTIFF-uri, nu HDF5 NISAR.
5. Înainte de prezentare: `python tools/fetch_nisar.py`, apoi `npm run build`, ca snapshot-ul NISAR să fie proaspăt. Remăsoară turul pe laptopul de concurs (`presentation/tools/jobs/tour_time.js`).
6. Opțional: elimină complet pata albă a reflexiei soarelui.
7. Pentru publicare, servește `dist/index.html` pe orice hosting static (de exemplu GitHub Pages).
