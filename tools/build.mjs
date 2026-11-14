// Assembles src/ + data/ into dist/index.html (full document).
import fs from 'fs'; import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const js = fs.readdirSync(path.join(root, 'src/js')).filter((f) => f.endsWith('.js')).sort().map((f) => rd('src/js/' + f)).join('\n');
const data = { globe: JSON.parse(rd('data/globe_landmask.json')), dem: {}, nisar: {}, nisarValues: {} };
for (const f of fs.readdirSync(path.join(root, 'data'))) {
  const m = f.match(/^dem_(\w+)\.json$/); if (m) data.dem[m[1]] = JSON.parse(rd('data/' + f));
  const r = f.match(/^nisar_([a-z]+)\.json$/); if (r) data.nisar[r[1]] = JSON.parse(rd('data/' + f));            // real NISAR snapshot (tools/fetch_nisar.py)
  const v = f.match(/^nisar_([a-z]+)_(gcov|gunw)\.json$/);                                                     // real values from a .h5 (tools/nisar_h5.py)
  if (v) (data.nisarValues[v[1]] = data.nisarValues[v[1]] || {})[v[2].toUpperCase()] = JSON.parse(rd('data/' + f));
}
const tpl = rd('src/template.html');
const body = tpl.replace('/*__CSS__*/', () => rd('src/styles.css'))
  .replace('<!--__DATA__-->', () => '<script>window.CSAR_DATA=' + JSON.stringify(data) + ';</script>')
  .replace('/*__JS__*/', () => js);
const [head, rest] = body.split('<!--__HEAD_END__-->');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const fullHtml = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}</head>\n<body>\n${rest}</body>\n</html>\n`;
fs.writeFileSync(path.join(root, 'dist/index.html'), fullHtml);
fs.writeFileSync(path.join(root, 'index.html'), fullHtml);
if (process.argv.includes('--check')) fs.writeFileSync(path.join(root, 'dist/_bundle_check.mjs'), js);
console.log('dist/index.html', (fs.statSync(path.join(root, 'dist/index.html')).size / 1e6).toFixed(2), 'MB');

// ── dist/offline.html: the same page with three.js, ExcelJS and the fonts inlined (needs vendor/, see tools/fetch_vendor.mjs) ──
// One file that runs with no network, also when double-clicked (file://), so the CDN copies are embedded as data: URLs:
// ES modules can't be loaded from file:// paths, but a data: module can, and the import map still resolves 'three' inside it.
const vendor = (p) => path.join(root, 'vendor', p);
const manifest = fs.existsSync(vendor('manifest.json')) ? JSON.parse(fs.readFileSync(vendor('manifest.json'), 'utf8')) : null;
const onlineMap = JSON.parse(tpl.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
const excelUrl = js.match(/const EXCELJS_URL = '([^']+)'/)[1];
if (!manifest) console.log('dist/offline.html skipped: run `npm run vendor` once to download three.js, ExcelJS and the fonts');
else if (onlineMap.three !== manifest.three + 'build/three.module.js' || excelUrl !== manifest.exceljs) console.log('dist/offline.html skipped: vendor/ does not match the versions pinned in src/ — run `npm run vendor` again');
else {
  const b64 = (buf) => buf.toString('base64');
  const swap = (s, from, to) => { if (!s.includes(from)) throw new Error('offline build: marker not found: ' + from.slice(0, 80)); return s.replace(from, () => to); };
  // import map: one data: URL per module; relative imports become bare 'three/addons/…' specifiers so they resolve through the map
  const imports = {};
  for (const rel of manifest.threeFiles) {
    let src = fs.readFileSync(vendor('three/' + rel), 'utf8');
    src = src.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.[^'"]+)\2/g, (_, kw, q, spec) =>
      kw + q + 'three/addons/' + path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)).replace(/^examples\/jsm\//, '') + q);
    const key = rel === 'build/three.module.js' ? 'three' : 'three/addons/' + rel.replace(/^examples\/jsm\//, '');
    imports[key] = 'data:text/javascript;base64,' + b64(Buffer.from(src, 'utf8'));
  }
  // fonts: the Google Fonts stylesheets with every woff2 inlined
  const fontCss = fs.readFileSync(vendor('fonts/fonts.css'), 'utf8')
    .replace(/\/\* https:\/\/fonts\.googleapis\.com\/css2\?family=([^:&]+)[^*]*\*\//g, (_, fam) => `/* ${fam.replace(/\+/g, ' ')} (Google Fonts, SIL OFL 1.1) */`)
    .replace(/url\((f\d+_[^)]+\.woff2)\)/g, (_, f) => `url(data:font/woff2;base64,${b64(fs.readFileSync(vendor('fonts/' + f)))})`);
  const offHead = swap(head, tpl.match(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">[\s\S]*?Martian\+Mono[^\n]*\n/)[0], `<style>\n${fontCss}</style>\n`);
  const offRest = swap(rest, tpl.match(/<script type="importmap">.*?<\/script>/s)[0],
    // ExcelJS runs before the app module (defer keeps document order), so loadExcelJS() finds window.ExcelJS and never goes online
    `<script defer src="data:text/javascript;base64,${b64(fs.readFileSync(vendor('exceljs/exceljs.min.js')))}"></script>\n` +
    `<script type="importmap">${JSON.stringify({ imports })}</script>`);
  if (/https:\/\/(fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr)/.test((offHead + offRest).replace(/const EXCELJS_URL = '[^']+'/, ''))) throw new Error('offline build: a CDN reference is left');
  fs.writeFileSync(path.join(root, 'dist/offline.html'), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${offHead}</head>\n<body>\n${offRest}</body>\n</html>\n`);
  console.log('dist/offline.html', (fs.statSync(path.join(root, 'dist/offline.html')).size / 1e6).toFixed(2), 'MB (no internet needed)');
}
