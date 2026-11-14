#!/usr/bin/env node
// Downloads, once, everything the page otherwise takes from CDNs, so tools/build.mjs can also write
// dist/offline.html (no internet needed at run time). No dependencies (Node ≥ 18, built-in fetch).
//
//   node tools/fetch_vendor.mjs          → vendor/three/…, vendor/exceljs/…, vendor/fonts/…
//
// The versions are the ones pinned in src/template.html and src/js/14b_export.js; the script refuses
// to run if those pins change, so online and offline builds always use the same libraries.
import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(root, 'vendor');
const rd = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// ── the pins, read from the sources (single source of truth) ──
const tpl = rd('src/template.html');
const map = JSON.parse(tpl.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;
const THREE_BASE = map['three'].replace(/build\/three\.module\.js$/, '');
if (!/three@0\.160\.0\/$/.test(THREE_BASE) || map['three/addons/'] !== THREE_BASE + 'examples/jsm/') throw new Error('unexpected three.js import map in src/template.html');
const EXCELJS_URL = rd('src/js/14b_export.js').match(/const EXCELJS_URL = '([^']+)'/)[1];
const FONT_CSS = [...tpl.matchAll(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com\/[^"]+)">/g)].map((m) => m[1].replace(/&amp;/g, '&'));
if (FONT_CSS.length !== 2) throw new Error('expected two Google Fonts stylesheets in src/template.html');

// A current desktop Chrome user agent: Google Fonts then serves woff2 split into unicode-range subsets,
// exactly what the online page gets.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
async function get(url, { text = false, ua = false } = {}) {
  const r = await fetch(url, ua ? { headers: { 'user-agent': UA } } : {});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return text ? r.text() : Buffer.from(await r.arrayBuffer());
}
function save(rel, data) {
  const p = path.join(VENDOR, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  console.log(`  ${rel.padEnd(58)} ${(data.length / 1024).toFixed(0).padStart(6)} kB`);
}

// ── three.js: build/three.module.js + the addons 00_imports.js uses, with their relative imports followed ──
const entry = [...rd('src/js/00_imports.js').matchAll(/from '(three(?:\/addons\/[^']+)?)'/g)].map((m) => m[1]);
const toRel = (spec) => (spec === 'three' ? 'build/three.module.js' : 'examples/jsm/' + spec.slice('three/addons/'.length));
console.log(`three.js  ${THREE_BASE}`);
const seen = new Set(), queue = entry.map(toRel);
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const src = await get(THREE_BASE + rel, { text: true });
  save('three/' + rel, src);
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)) {
    const s = m[1];
    if (s === 'three') continue;
    if (s.startsWith('.')) queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), s)));
    else throw new Error(`unexpected import '${s}' in ${rel}`);
  }
}
save('three/LICENSE', await get(THREE_BASE + 'LICENSE'));

// ── ExcelJS ──
console.log(`ExcelJS   ${EXCELJS_URL}`);
save('exceljs/exceljs.min.js', await get(EXCELJS_URL));
save('exceljs/LICENSE', await get(EXCELJS_URL.replace(/dist\/exceljs\.min\.js$/, 'LICENSE')));

// ── fonts: the two stylesheets, every woff2 they reference stored locally ──
let css = '';
let n = 0;
for (const url of FONT_CSS) {
  console.log(`fonts     ${url}`);
  css += `/* ${url} */\n` + await get(url, { text: true, ua: true }) + '\n';
}
const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
for (const u of urls) {
  const name = `f${String(n++).padStart(2, '0')}_` + path.posix.basename(new URL(u).pathname);
  save('fonts/' + name, await get(u));
  css = css.split(u).join(name);
}
save('fonts/fonts.css', Buffer.from(css));

fs.writeFileSync(path.join(VENDOR, 'manifest.json'), JSON.stringify({
  fetched: new Date().toISOString(), three: THREE_BASE, threeFiles: [...seen], exceljs: EXCELJS_URL, fonts: FONT_CSS,
}, null, 2) + '\n');
console.log(`done: ${seen.size} three.js modules, ExcelJS, ${urls.length} font files → vendor/`);
