#!/usr/bin/env node
/**
 * CHRONO-SAR · local server (no dependencies, Node ≥ 18)
 *
 *   node tools/serve.mjs              serve dist/ on http://localhost:8080 and open the browser
 *   node tools/serve.mjs --watch      + rebuild when src/ or data/ change, and reload the page live
 *   node tools/serve.mjs --lan        also reachable from other devices on your Wi-Fi (teammates, projector laptop)
 *   options: --port 9000 · --no-open
 *
 * dist/index.html is rebuilt first if it is missing or older than the sources.
 * /samples/… is also served, so the CSAR-PACK self-test can be fetched from the page.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SAMPLES = path.join(ROOT, 'samples');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const WATCH = has('--watch'), LAN = has('--lan'), OPEN = !has('--no-open');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
let port = parseInt(opt('--port', process.env.PORT || '8080'), 10);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.tif': 'image/tiff',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.wasm': 'application/wasm',
};
const C = { dim: '\x1b[2m', gold: '\x1b[33m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', off: '\x1b[0m' };
const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (msg) => console.log(`${C.dim}${stamp()}${C.off}  ${msg}`);

// ───────────── build ─────────────
function newestMtime(dir) {
  let t = 0;
  if (!fs.existsSync(dir)) return t;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_tiles') t = Math.max(t, newestMtime(p)); }
    else t = Math.max(t, fs.statSync(p).mtimeMs);
  }
  return t;
}
function needsBuild() {
  const out = path.join(DIST, 'index.html');
  if (!fs.existsSync(out)) return true;
  const built = fs.statSync(out).mtimeMs;
  return Math.max(newestMtime(path.join(ROOT, 'src')), newestMtime(path.join(ROOT, 'data'))) > built;
}
function buildSync() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) { console.error(`${C.red}build failed${C.off}\n${r.stderr || r.stdout}`); return false; }
  log(`${C.green}built${C.off} ${(r.stdout || '').trim()}`);
  return true;
}
let building = false, again = false;
function buildAsync(reason) {
  if (building) { again = true; return; }
  building = true;
  const t0 = Date.now();
  const p = spawn(process.execPath, [path.join(ROOT, 'tools', 'build.mjs')], { cwd: ROOT });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => {
    building = false;
    if (code === 0) { log(`${C.green}rebuilt${C.off} in ${Date.now() - t0} ms ${C.dim}(${reason})${C.off} · reloading ${clients.size} tab(s)`); broadcast(); }
    else console.error(`${C.red}build failed${C.off} (${reason})\n${err}`);
    if (again) { again = false; buildAsync('queued change'); }
  });
}

// ───────────── live reload (server-sent events) ─────────────
const clients = new Set();
const RELOAD = '<script>(()=>{try{const es=new EventSource("/__reload");es.onmessage=()=>location.reload();}catch(e){}})();</script>';
function broadcast() { for (const res of clients) res.write('data: reload\n\n'); }

// ───────────── HTTP ─────────────
function notFound(res, rel) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><title>404</title><body style="background:#02050a;color:#dcebfa;font:14px system-ui;padding:40px"><h1>404</h1><p>${rel.replace(/</g, '&lt;')} is not in dist/.</p><p><a style="color:#3ee6ff" href="/">Open CHRONO-SAR</a></p>`);
}
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
  if (url.pathname === '/__reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const base = rel.startsWith('/samples/') ? ROOT : DIST;
  const file = path.normalize(path.join(base, rel));
  if (!(file + path.sep).startsWith(base === ROOT ? SAMPLES + path.sep : DIST + path.sep) && file !== path.join(DIST, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { notFound(res, rel); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (ext === '.html' && WATCH) {
      fs.readFile(file, 'utf8', (e, html) => {
        if (e) { notFound(res, rel); return; }
        const body = html.includes('</body>') ? html.replace('</body>', RELOAD + '</body>') : html + RELOAD;
        res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(body) });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref(); } catch { /* no browser available */ }
}

// ───────────── start ─────────────
if (needsBuild()) { log('dist/ is missing or older than src/ · building…'); if (!buildSync()) process.exit(1); }
let tries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tries < 15) { tries++; port++; server.listen(port, HOST); return; }
  console.error(`${C.red}cannot start the server:${C.off} ${e.message}`); process.exit(1);
});
server.listen(port, HOST, () => {
  const local = `http://localhost:${port}/`;
  console.log(`\n  ${C.bold}CHRONO${C.gold}·${C.off}${C.bold}SAR${C.off}  local server\n`);
  console.log(`  ${C.cyan}➜  Local:${C.off}   ${C.bold}${local}${C.off}`);
  if (LAN) for (const ip of lanAddresses()) console.log(`  ${C.cyan}➜  Network:${C.off} http://${ip}:${port}/   ${C.dim}(same Wi-Fi)${C.off}`);
  else console.log(`  ${C.dim}➜  Network: add --lan to share it on your Wi-Fi${C.off}`);
  console.log(`  ${C.dim}➜  Scenes:  ${local}#rainier  #carrizo  #jakobshavn  #atchafalaya  #danube  #mexico${C.off}`);
  console.log(`  ${C.dim}➜  Mode:    ${WATCH ? 'watch · rebuild + live reload on every save in src/ or data/' : 'static (add --watch to rebuild on save)'}${C.off}`);
  console.log(`  ${C.dim}➜  Stop:    Ctrl+C${C.off}\n`);
  if (OPEN) openBrowser(local);
});

if (WATCH) {
  let timer = null, lastReason = '';
  const onChange = (dir) => (ev, name) => {
    if (!name || /(^|[\\/])(_tiles|\.git)([\\/]|$)/.test(name) || /~$|\.swp$/.test(name)) return;
    lastReason = `${dir}/${String(name).replace(/\\/g, '/')}`;
    clearTimeout(timer);
    timer = setTimeout(() => buildAsync(lastReason), 220);
  };
  for (const dir of ['src', 'data']) {
    const p = path.join(ROOT, dir);
    if (fs.existsSync(p)) fs.watch(p, { recursive: true }, onChange(dir));
  }
}
process.on('SIGINT', () => { console.log(`\n${C.dim}server stopped${C.off}`); process.exit(0); });
