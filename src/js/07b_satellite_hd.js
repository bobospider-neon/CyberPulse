// ───────────────────────── 07b · NISAR SPACECRAFT — high-detail model ─────────────────────────
// Offset-fed 12 m AstroMesh reflector (perimeter truss, front & rear geodesic nets, gold-plated
// molybdenum knit), 9 m four-segment carbon boom, radar instrument structure with L- and S-band
// feed arrays, I-3K class bus in crinkled MLI, sun-tracking solar wing, gimballed Ka-band antenna,
// RCS thrusters, beacons and a sun-glint flare. Model units are metres; procedural PBR textures.

const SatKit = {
  cache: new Map(),
  get(key, make) { if (!this.cache.has(key)) this.cache.set(key, make()); return this.cache.get(key); },
};
function satCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function satTexture(c, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8;
  return t;
}
/** height canvas → tangent-space normal map (Sobel, tileable) */
function satNormalMap(src, strength = 2.2) {
  const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = satCanvas(w, h), out = g.createImageData(w, h);
  const H = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1);
    const dy = H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1);
    const nx = -dx * strength, ny = dy * strength, L = Math.hypot(nx, ny, 1), o = (y * w + x) * 4;
    out.data[o] = (nx / L * 0.5 + 0.5) * 255; out.data[o + 1] = (ny / L * 0.5 + 0.5) * 255; out.data[o + 2] = (1 / L * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return c;
}
/** draw with wrap-around so textures tile seamlessly */
function satWrapDraw(size, fn) { for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy); }

function satTextures() {
  return SatKit.get('textures', () => {
    const T = {};
    // crinkled multi-layer insulation (height → colour + normal)
    {
      const N = 512, [h, g] = satCanvas(N, N), r = mulberry32(7);
      g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
      for (let i = 0; i < 70; i++) {
        const x = r() * N, y = r() * N, rad = 30 + r() * 110, v = r() > 0.5 ? 255 : 0;
        satWrapDraw(N, (dx, dy) => { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); gr.addColorStop(0, `rgba(${v},${v},${v},0.12)`); gr.addColorStop(1, 'rgba(128,128,128,0)'); g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2); });
      }
      g.lineCap = 'round';
      for (let i = 0; i < 1100; i++) {
        const pts = []; let x = r() * N, y = r() * N, a = r() * TAU; const len = 8 + r() * 46;
        pts.push([x, y]); for (let s = 0; s < 4; s++) { a += (r() - 0.5) * 1.0; x += Math.cos(a) * len / 4; y += Math.sin(a) * len / 4; pts.push([x, y]); }
        const light = r() > 0.5, al = 0.12 + r() * 0.38, lw = 0.6 + r() * 1.8;
        satWrapDraw(N, (dx, dy) => { g.strokeStyle = light ? `rgba(255,255,255,${al})` : `rgba(0,0,0,${al})`; g.lineWidth = lw; g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.stroke(); });
      }
      T.mliNormal = satTexture(satNormalMap(h, 3.0), 2, 2);
      const [c, gc] = satCanvas(N, N), hd = g.getImageData(0, 0, N, N).data, img = gc.createImageData(N, N);
      for (let k = 0; k < N * N; k++) { const v = hd[k * 4] / 255; img.data[k * 4] = 196 + 55 * (v - 0.5) * 2; img.data[k * 4 + 1] = 142 + 45 * (v - 0.5) * 2; img.data[k * 4 + 2] = 52 + 30 * (v - 0.5); img.data[k * 4 + 3] = 255; }
      gc.putImageData(img, 0, 0);
      T.mliColor = satTexture(c, 2, 2);
      const [cr, gr2] = satCanvas(N, N), img2 = gr2.createImageData(N, N);
      for (let k = 0; k < N * N; k++) { const v = hd[k * 4] / 255; const rv = 70 + 90 * Math.abs(v - 0.5) * 2; img2.data[k * 4] = rv; img2.data[k * 4 + 1] = rv; img2.data[k * 4 + 2] = rv; img2.data[k * 4 + 3] = 255; }
      gr2.putImageData(img2, 0, 0);
      T.mliRough = satTexture(cr, 2, 2);
    }
    // beta-cloth quilting (white blankets on the instrument structure)
    {
      const N = 256, [h, g] = satCanvas(N, N);
      g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, N, N);
      for (let y = 0; y < N; y += 64) for (let x = 0; x < N; x += 64) { const gr = g.createRadialGradient(x + 32, y + 32, 4, x + 32, y + 32, 46); gr.addColorStop(0, '#a8a8a8'); gr.addColorStop(1, '#6a6a6a'); g.fillStyle = gr; g.fillRect(x, y, 64, 64); }
      g.strokeStyle = '#303030'; g.lineWidth = 2; g.setLineDash([5, 4]);
      for (let k = 0; k <= N; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, N); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(N, k); g.stroke(); }
      T.clothNormal = satTexture(satNormalMap(h, 1.6), 3, 2);
    }
    // carbon-fibre 2×2 twill
    {
      const N = 256, [c, g] = satCanvas(N, N), [h, gh] = satCanvas(N, N), cell = 16;
      for (let y = 0; y < N; y += cell) for (let x = 0; x < N; x += cell) {
        const k = ((x / cell) + (y / cell)) % 4, horiz = k < 2;
        const gr = horiz ? g.createLinearGradient(x, y, x, y + cell) : g.createLinearGradient(x, y, x + cell, y);
        gr.addColorStop(0, '#1b1e22'); gr.addColorStop(0.5, horiz ? '#3a3f46' : '#2c3036'); gr.addColorStop(1, '#16191c');
        g.fillStyle = gr; g.fillRect(x, y, cell, cell);
        const gh2 = horiz ? gh.createLinearGradient(x, y, x, y + cell) : gh.createLinearGradient(x, y, x + cell, y);
        gh2.addColorStop(0, '#404040'); gh2.addColorStop(0.5, '#c0c0c0'); gh2.addColorStop(1, '#404040');
        gh.fillStyle = gh2; gh.fillRect(x, y, cell, cell);
      }
      T.carbon = satTexture(c, 4, 1); T.carbonNormal = satTexture(satNormalMap(h, 1.4), 4, 1);
    }
    // solar cells
    {
      const W = 1024, Hh = 512, [c, g] = satCanvas(W, Hh), [h, gh] = satCanvas(W, Hh);
      g.fillStyle = '#d9dde3'; g.fillRect(0, 0, W, Hh); gh.fillStyle = '#808080'; gh.fillRect(0, 0, W, Hh);
      const cx = 12, cy = 6, cw = W / cx, ch = Hh / cy, gap = 5;
      for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
        const x = i * cw + gap, y = j * ch + gap, w = cw - 2 * gap, hh = ch - 2 * gap;
        const gr = g.createLinearGradient(x, y, x + w, y + hh); gr.addColorStop(0, '#0b1d48'); gr.addColorStop(0.55, '#123a86'); gr.addColorStop(1, '#0a1838');
        g.fillStyle = gr; g.fillRect(x, y, w, hh);
        g.strokeStyle = 'rgba(200,215,235,0.55)'; g.lineWidth = 1;
        for (let fy = y + 6; fy < y + hh; fy += 7) { g.beginPath(); g.moveTo(x, fy); g.lineTo(x + w, fy); g.stroke(); }
        g.fillStyle = 'rgba(225,232,240,0.9)'; g.fillRect(x + w * 0.3, y, 3, hh); g.fillRect(x + w * 0.7, y, 3, hh);
        gh.fillStyle = '#909090'; gh.fillRect(x, y, w, hh);
        gh.fillStyle = '#d0d0d0'; gh.fillRect(x + w * 0.3, y, 3, hh); gh.fillRect(x + w * 0.7, y, 3, hh);
      }
      T.solar = satTexture(c, 1, 1); T.solarNormal = satTexture(satNormalMap(h, 2.0), 1, 1);
    }
    // optical solar reflector tiles (radiator)
    {
      const N = 256, [c, g] = satCanvas(N, N), r = mulberry32(21), t = 16;
      g.fillStyle = '#5c6066'; g.fillRect(0, 0, N, N);
      for (let y = 0; y < N; y += t) for (let x = 0; x < N; x += t) { const v = 200 + r() * 40; g.fillStyle = `rgb(${v},${v + 4},${v + 10})`; g.fillRect(x + 1, y + 1, t - 2, t - 2); }
      T.osr = satTexture(c, 3, 4);
    }
    // gold-plated molybdenum knit (reflector) — alpha pattern
    {
      const N = 128, [c, g] = satCanvas(N, N);
      g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
      g.strokeStyle = '#fff'; g.lineWidth = 3.2;
      for (let k = -N; k < 2 * N; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + N, N); g.stroke(); g.beginPath(); g.moveTo(k, N); g.lineTo(k + N, 0); g.stroke(); }
      T.knit = satTexture(c, 70, 70);
    }
    // NISAR plate
    {
      const [c, g] = satCanvas(512, 128);
      g.fillStyle = '#e9ecf0'; g.fillRect(0, 0, 512, 128);
      g.fillStyle = '#0b1220'; g.font = '700 72px "Saira", "Bahnschrift", sans-serif'; g.textBaseline = 'middle'; g.fillText('NISAR', 22, 60);
      g.font = '500 22px "Martian Mono", monospace'; g.fillStyle = '#3a4656'; g.fillText('L-SAR · S-SAR · SweepSAR', 250, 46); g.fillText('12 m · 747 km · 98.4°', 250, 82);
      g.fillStyle = '#ffb648'; g.fillRect(0, 118, 512, 10);
      const t = new THREE.CanvasTexture(c); t.anisotropy = 8; T.plate = t;
    }
    // soft glow & flare sprites
    {
      const [c, g] = satCanvas(128, 128), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); T.glow = new THREE.CanvasTexture(c);
    }
    {
      const N = 512, [c, g] = satCanvas(N, N), m = N / 2;
      const gr = g.createRadialGradient(m, m, 0, m, m, m); gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.06, 'rgba(255,230,170,0.9)'); gr.addColorStop(0.25, 'rgba(255,190,90,0.18)'); gr.addColorStop(1, 'rgba(255,180,80,0)');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 6; k++) { g.save(); g.translate(m, m); g.rotate(k * Math.PI / 6 + 0.2); const lg = g.createLinearGradient(-m, 0, m, 0); lg.addColorStop(0, 'rgba(255,220,160,0)'); lg.addColorStop(0.5, `rgba(255,235,200,${k % 2 ? 0.35 : 0.6})`); lg.addColorStop(1, 'rgba(255,220,160,0)'); g.fillStyle = lg; g.fillRect(-m, -1.5, N, 3); g.restore(); }
      g.strokeStyle = 'rgba(120,200,255,0.18)'; g.lineWidth = 3; g.beginPath(); g.arc(m, m, m * 0.42, 0, TAU); g.stroke();
      T.flare = new THREE.CanvasTexture(c);
    }
    return T;
  });
}

function satMaterials() {
  return SatKit.get('materials', () => {
    const T = satTextures();
    // Mirror-like surfaces (OSR, cover glass, clear-coats) reflect the sun with HDR peaks hundreds of times above
    // the bloom threshold. A soft knee above 1.2 keeps the highlights white-hot but stops them blooming into a blob.
    const knee = (sh) => {
      const tag = sh.fragmentShader.includes('#include <opaque_fragment>') ? '#include <opaque_fragment>' : '#include <output_fragment>';
      sh.fragmentShader = sh.fragmentShader.replace(tag, `${tag}\n  gl_FragColor.rgb = gl_FragColor.rgb / (1.0 + max(vec3(0.0), gl_FragColor.rgb - 1.2) * 0.6);`);
    };
    const P = (o) => { const m = new THREE.MeshPhysicalMaterial(o); m.onBeforeCompile = knee; return m; };
    return {
      gold: P({ map: T.mliColor, normalMap: T.mliNormal, normalScale: new THREE.Vector2(1.1, 1.1), roughnessMap: T.mliRough, color: 0xffffff, metalness: 1.0, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 1.35, emissive: 0x2a1500, emissiveIntensity: 0.35 }),
      kapton: P({ color: 0x15171b, normalMap: T.mliNormal, normalScale: new THREE.Vector2(0.6, 0.6), metalness: 0.4, roughness: 0.38, clearcoat: 0.5, envMapIntensity: 1.1 }),
      cloth: P({ color: 0xe6e8ec, normalMap: T.clothNormal, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.0, roughness: 0.82, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6 }),
      alu: P({ color: 0xc3c9d1, metalness: 1.0, roughness: 0.3, envMapIntensity: 1.2 }),
      darkAlu: P({ color: 0x4a5058, metalness: 0.9, roughness: 0.4 }),
      osr: P({ map: T.osr, color: 0xffffff, metalness: 0.65, roughness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.5 }),
      carbon: P({ map: T.carbon, normalMap: T.carbonNormal, color: 0xffffff, metalness: 0.25, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.18 }),
      solar: P({ map: T.solar, normalMap: T.solarNormal, color: 0xffffff, metalness: 0.4, roughness: 0.16, clearcoat: 1.0, clearcoatRoughness: 0.04, iridescence: 0.75, iridescenceIOR: 1.55, iridescenceThicknessRange: [180, 520], emissive: 0x04112e, emissiveIntensity: 0.6, envMapIntensity: 1.4 }),
      panelBack: P({ color: 0x2b2f35, metalness: 0.3, roughness: 0.6 }),
      copperL: P({ color: 0xd88d4c, metalness: 1.0, roughness: 0.25, emissive: 0xff9a2a, emissiveIntensity: 0.2 }),
      copperS: P({ color: 0x9ccfe0, metalness: 1.0, roughness: 0.22, emissive: 0x2fd6ff, emissiveIntensity: 0.2 }),
      feedBase: P({ color: 0x1b2129, metalness: 0.5, roughness: 0.5 }),
      dish: P({ color: 0xffcf73, metalness: 1.0, roughness: 0.24, alphaMap: T.knit, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, sheen: 1.0, sheenColor: new THREE.Color(0xffd98a), sheenRoughness: 0.35, emissive: 0x3a2400, emissiveIntensity: 0.55, envMapIntensity: 1.6, depthWrite: true }),
      tube: P({ map: T.carbon, color: 0xc8ccd2, metalness: 0.55, roughness: 0.35, clearcoat: 0.6 }),
      joint: P({ color: 0xe3b65a, metalness: 1.0, roughness: 0.3 }),
      harness: P({ color: 0xf2f2ee, metalness: 0.0, roughness: 0.7 }),
      white: P({ color: 0xf1f3f6, metalness: 0.05, roughness: 0.5, clearcoat: 0.3 }),
      black: P({ color: 0x07080a, metalness: 0.2, roughness: 0.3, clearcoat: 1.0 }),
      lens: P({ color: 0x0a1630, metalness: 0.0, roughness: 0.02, transmission: 0.0, clearcoat: 1.0, iridescence: 1.0, iridescenceIOR: 1.8, emissive: 0x0a2c55, emissiveIntensity: 0.6 }),
      plate: P({ map: T.plate, metalness: 0.2, roughness: 0.4, clearcoat: 0.6 }),
      netFront: new THREE.LineBasicMaterial({ color: 0xffe9b8, transparent: true, opacity: 0.55 }),
      netRear: new THREE.LineBasicMaterial({ color: 0xcfd6e0, transparent: true, opacity: 0.32 }),
      ties: new THREE.LineBasicMaterial({ color: 0xfff6dd, transparent: true, opacity: 0.22 }),
    };
  });
}

const _tm = new THREE.Matrix4(), _tq = new THREE.Quaternion(), _tv = new THREE.Vector3(), _ts = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** matrix placing a unit cylinder (height 1 along Y, centred) between a and b */
function tubeMatrix(a, b, r) {
  _tv.subVectors(b, a); const len = _tv.length();
  _tq.setFromUnitVectors(_up, _tv.clone().normalize());
  _ts.set(r, len, r);
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), _tq, _ts);
}
function instancedTubes(pairs, radius, material, segs = 6) {
  const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, segs, 1, false), material, pairs.length);
  pairs.forEach(([a, b, r], k) => m.setMatrixAt(k, tubeMatrix(a, b, r || radius)));
  m.instanceMatrix.needsUpdate = true;
  return m;
}
function mergedTubes(pairs, radius, segs = 6) {
  const geos = pairs.map(([a, b, r]) => new THREE.CylinderGeometry(1, 1, 1, segs, 1, false).applyMatrix4(tubeMatrix(a, b, r || radius)));
  const g = BufferGeometryUtils.mergeGeometries(geos, false);
  geos.forEach((x) => x.dispose());
  return g;
}

function buildNISAR() {
  const M = satMaterials(), T = satTextures();
  const root = new THREE.Group(); root.name = 'NISAR';
  const anim = { plumes: [], beacons: [], fireAt: 2 + Math.random() * 3, fireEnd: -1, firing: -1, deploy: 1 };

  // ════════ bus (I-3K class): 1.9 × 2.5 × 1.9 m ════════
  const BX = 1.9, BY = 2.5, BZ = 1.9;
  const bus = new THREE.Group(); root.add(bus);
  bus.add(new THREE.Mesh(new THREE.BoxGeometry(BX, BY, BZ), [M.osr, M.kapton, M.alu, M.darkAlu, M.gold, M.gold]));
  // edge rails
  const corners = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([new THREE.Vector3(sx * BX / 2, -BY / 2, sz * BZ / 2), new THREE.Vector3(sx * BX / 2, BY / 2, sz * BZ / 2), 0.035]);
  for (const sy of [-1, 1]) for (const s of [-1, 1]) {
    corners.push([new THREE.Vector3(-BX / 2, sy * BY / 2, s * BZ / 2), new THREE.Vector3(BX / 2, sy * BY / 2, s * BZ / 2), 0.03]);
    corners.push([new THREE.Vector3(s * BX / 2, sy * BY / 2, -BZ / 2), new THREE.Vector3(s * BX / 2, sy * BY / 2, BZ / 2), 0.03]);
  }
  bus.add(instancedTubes(corners, 0.03, M.alu, 8));
  // access panels, plate, sun sensors, star trackers, GPS & TT&C antennas
  const panelGeo = new THREE.BoxGeometry(0.55, 0.42, 0.03);
  for (const [x, y, sz] of [[-0.42, 0.55, 1], [0.38, -0.4, 1], [-0.3, -0.62, -1], [0.45, 0.6, -1]]) {
    const p = new THREE.Mesh(panelGeo, M.gold); p.position.set(x, y, sz * (BZ / 2 + 0.016)); bus.add(p);
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.225), M.plate); plate.position.set(0.0, 0.05, BZ / 2 + 0.034); bus.add(plate);
  for (const z of [-0.55, 0.55]) {
    const st = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 20), M.black); st.add(body);
    const baffle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.22, 20, 1, true), M.black); baffle.position.y = 0.22; st.add(baffle);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), M.lens); lens.rotation.x = -Math.PI / 2; lens.position.y = 0.121; st.add(lens);
    st.position.set(-BX / 2 + 0.25, BY / 2 + 0.12, z); st.rotation.set(0, 0, 0.55); bus.add(st);
  }
  const gps = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 24), M.white); gps.position.set(BX / 2 - 0.3, BY / 2 + 0.013, -BZ / 2 + 0.3); bus.add(gps);
  const ttc = new THREE.Group();
  ttc.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.35, 8), M.alu));
  const helix = new THREE.Mesh(new THREE.TorusKnotGeometry(0.05, 0.008, 64, 6, 1, 6), M.joint); helix.position.y = 0.25; helix.scale.set(1, 2.2, 1); ttc.add(helix);
  ttc.position.set(BX / 2 - 0.25, -BY / 2 - 0.18, BZ / 2 - 0.25); bus.add(ttc);
  for (const [x, y, z] of [[BX / 2 + 0.03, 0.9, 0.6], [-BX / 2 - 0.03, 0.9, -0.6]]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.08), M.black); s.position.set(x, y, z); bus.add(s); }

  // ════════ RCS thrusters (8) + plumes ════════
  const nozzleGeo = new THREE.CylinderGeometry(0.035, 0.075, 0.14, 16, 1, true);
  const plumeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uI: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uTime; uniform float uI; varying vec2 vUv; void main(){ float t = clamp(vUv.y, 0.0, 1.0); float n = fract(sin(dot(vUv*vec2(12.0,40.0)+uTime*30.0, vec2(12.9898,78.233)))*43758.5453); float a = pow(t, 1.8) * (0.7 + 0.3*n) * uI; vec3 c = mix(vec3(0.35,0.55,1.0), vec3(1.0,0.97,0.9), t*t); gl_FragColor = vec4(c*1.8, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const plumeGeo = new THREE.ConeGeometry(0.22, 1.1, 18, 1, true).translate(0, -0.55, 0);
  let n = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const dir of [0, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * (BX / 2 - 0.12), -BY / 2 + 0.12 + dir * (BY - 0.24), sz * (BZ / 2 - 0.12));
    const out = new THREE.Vector3(sx * 0.6, dir ? 0.5 : -0.5, sz * 0.6).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), out);
    const noz = new THREE.Mesh(nozzleGeo, M.darkAlu); noz.position.y = -0.07; g.add(noz);
    const plume = new THREE.Mesh(plumeGeo, plumeMat); plume.position.y = -0.14; plume.visible = false; g.add(plume);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0x9cc8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.position.y = -0.2; glow.scale.setScalar(0.9); g.add(glow);
    bus.add(g);
    anim.plumes.push({ plume, glow });
    n++;
  }
  anim.plumeMat = plumeMat;

  // ════════ gimballed Ka-band downlink antenna ════════
  const hga = new THREE.Group(); hga.position.set(-0.35, -BY / 2, 0.35); bus.add(hga);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.45, 12), M.alu); mast.position.y = -0.22; hga.add(mast);
  const az = new THREE.Group(); az.position.y = -0.46; hga.add(az);
  az.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 16), M.darkAlu));
  const el = new THREE.Group(); el.position.y = -0.08; az.add(el);
  for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.04), M.alu); arm.position.set(s * 0.18, -0.08, 0); az.add(arm); }
  const hgaProf = []; for (let i = 0; i <= 16; i++) { const r = (i / 16) * 0.36; hgaProf.push(new THREE.Vector2(r, r * r / (4 * 0.22))); }
  const hgaDish = new THREE.Mesh(new THREE.LatheGeometry(hgaProf, 48), M.white); hgaDish.rotation.x = Math.PI; hgaDish.position.y = -0.1; el.add(hgaDish);
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 12), M.joint); horn.position.y = -0.33; horn.rotation.x = Math.PI; el.add(horn);
  for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; el.add(Object.assign(new THREE.Mesh(mergedTubes([[new THREE.Vector3(Math.cos(a) * 0.3, -0.13, Math.sin(a) * 0.3), new THREE.Vector3(0, -0.3, 0)]], 0.006, 5), M.alu))); }
  anim.hga = { az, el };

  // ════════ radar instrument structure (octagonal) + L/S feed arrays ════════
  const RIS_H = 1.5, risY = BY / 2 + RIS_H / 2;
  const ris = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.18, RIS_H, 8, 1), M.cloth); ris.position.y = risY; ris.rotation.y = Math.PI / 8; root.add(ris);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.07, 8), M.alu); deck.position.y = BY / 2 + RIS_H + 0.035; deck.rotation.y = Math.PI / 8; root.add(deck);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.025, 8, 8), M.joint); ring.rotation.x = Math.PI / 2; ring.rotation.z = Math.PI / 8; ring.position.y = BY / 2 + 0.04; root.add(ring);
  const feedTop = BY / 2 + RIS_H + 0.07;
  const feeds = new THREE.Group(); feeds.position.set(0.15, feedTop + 0.12, 0); feeds.rotation.z = -0.66; root.add(feeds);
  const fbase = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 2.35), M.feedBase); feeds.add(fbase);
  const patch = new THREE.BoxGeometry(0.15, 0.02, 0.15);
  const pl = new THREE.InstancedMesh(patch, M.copperL, 36), ps = new THREE.InstancedMesh(patch, M.copperS, 20);
  let a1 = 0, a2 = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) pl.setMatrixAt(a1++, new THREE.Matrix4().makeTranslation(-0.38 + j * 0.19, 0.05, -1.05 + i * 0.19));
  for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) { const m = new THREE.Matrix4().makeTranslation(0.36 + j * 0.13, 0.05, -0.9 + i * 0.2); m.scale(new THREE.Vector3(0.62, 1, 0.62)); ps.setMatrixAt(a2++, m); }
  feeds.add(pl, ps);
  for (const [x, z] of [[-0.5, -1.1], [-0.5, 1.1], [0.55, -1.1], [0.55, 1.1]]) feeds.add(Object.assign(new THREE.Mesh(mergedTubes([[new THREE.Vector3(x, -0.04, z), new THREE.Vector3(x * 0.6, -0.42, z * 0.7)]], 0.025, 6), M.alu)));
  anim.feedL = M.copperL; anim.feedS = M.copperS;

  // ════════ solar wing (5 panels, sun-tracking) ════════
  const wing = new THREE.Group(); wing.position.set(-BX / 2, 0.25, 0); root.add(wing);
  wing.add(Object.assign(new THREE.Mesh(mergedTubes([[new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1.1, 0, 0), 0.05], [new THREE.Vector3(-0.2, 0, -0.35), new THREE.Vector3(-1.1, 0, -0.75), 0.025], [new THREE.Vector3(-0.2, 0, 0.35), new THREE.Vector3(-1.1, 0, 0.75), 0.025]], 0.04, 10), M.alu)));
  const drive = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 20), M.darkAlu); drive.rotation.z = Math.PI / 2; drive.position.x = -0.12; wing.add(drive);
  const wingRot = new THREE.Group(); wingRot.position.x = -1.1; wing.add(wingRot);
  const PW = 2.35, PZ = 1.95, gapP = 0.08;
  const panelMats = [M.alu, M.alu, M.solar, M.panelBack, M.alu, M.alu];
  for (let k = 0; k < 5; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(PW, 0.045, PZ), panelMats);
    p.position.x = -(k * (PW + gapP) + PW / 2 + 0.05); wingRot.add(p);
    if (k < 4) for (const z of [-0.6, 0.6]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 10), M.joint); h.rotation.x = Math.PI / 2; h.position.set(-((k + 1) * (PW + gapP) + 0.01), 0, z); wingRot.add(h); }
  }
  const tipX = -(5 * (PW + gapP) + 0.05);
  anim.wing = wingRot;

  // ════════ reflector: 12 m offset AstroMesh (parent paraboloid f = 7.5 m) ════════
  const F = 7.5, RAD = 6.0, XC = 7.0, VY = 10.2;
  const surf = (x, z) => (x * x + z * z) / (4 * F);
  const YC = surf(XC, 0);
  const refl = new THREE.Group();            // origin = paraboloid vertex
  const dishG = new THREE.Group(); dishG.position.set(XC, YC, 0); refl.add(dishG);   // deploys about the aperture centre
  {
    const NR = 40, NT = 120, pos = [], uv = [], idx = [];
    for (let i = 0; i <= NR; i++) for (let j = 0; j <= NT; j++) {
      const r = (i / NR) * RAD, t = (j / NT) * TAU, x = XC + r * Math.cos(t), z = r * Math.sin(t);
      pos.push(x - XC, surf(x, z) - YC, z); uv.push((x - XC) / (2 * RAD) + 0.5, z / (2 * RAD) + 0.5);
    }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NT; j++) { const a = i * (NT + 1) + j, b = a + NT + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    dishG.add(new THREE.Mesh(g, M.dish));
  }
  // geodesic front / rear nets + tension ties
  {
    const sp = 0.72, nodes = [], key = new Map(), front = [], rear = [], ties = [];
    for (let row = -12; row <= 12; row++) for (let col = -12; col <= 12; col++) {
      const lx = (col + (row & 1 ? 0.5 : 0)) * sp, lz = row * sp * 0.866;
      if (lx * lx + lz * lz > (RAD - 0.08) ** 2) continue;
      key.set(row + ',' + col, nodes.length); nodes.push([lx, lz]);
    }
    const P = (lx, lz, off, k) => { const x = XC + lx * k, z = lz * k; return [x - XC, surf(x, z) - YC + off, z]; };
    for (let row = -12; row <= 12; row++) for (let col = -12; col <= 12; col++) {
      const a = key.get(row + ',' + col); if (a === undefined) continue;
      const nb = [[row, col + 1], [row + 1, col + (row & 1 ? 1 : 0)], [row + 1, col - (row & 1 ? 0 : 1)]];
      for (const [r2, c2] of nb) { const b = key.get(r2 + ',' + c2); if (b === undefined) continue; front.push(...P(...nodes[a], -0.03, 1), ...P(...nodes[b], -0.03, 1)); rear.push(...P(...nodes[a], 0.58, 0.9), ...P(...nodes[b], 0.58, 0.9)); }
      ties.push(...P(...nodes[a], -0.03, 1), ...P(...nodes[a], 0.58, 0.9));
    }
    const L = (arr, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return new THREE.LineSegments(g, mat); };
    dishG.add(L(front, M.netFront), L(rear, M.netRear), L(ties, M.ties));
  }
  // perimeter truss (36 bays) + joints
  {
    const K = 36, depth = 0.95, fr = [], rr = [], pairs = [], joints = [];
    for (let k = 0; k < K; k++) {
      const t = (k / K) * TAU, x = XC + RAD * Math.cos(t), z = RAD * Math.sin(t), y = surf(x, z) - YC;
      fr.push(new THREE.Vector3(x - XC, y, z)); rr.push(new THREE.Vector3(x - XC, y + depth, z));
    }
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      pairs.push([fr[k], rr[k], 0.04], [fr[k], fr[k2], 0.03], [rr[k], rr[k2], 0.03], [fr[k], rr[k2], 0.018]);
      joints.push(fr[k], rr[k]);
    }
    dishG.add(instancedTubes(pairs, 0.03, M.tube, 8));
    const jm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), M.joint, joints.length);
    joints.forEach((p, k) => jm.setMatrixAt(k, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    jm.instanceMatrix.needsUpdate = true;
    dishG.add(jm);
    anim.rimRear = rr;
  }
  const beamOrigin = new THREE.Object3D(); dishG.add(beamOrigin);
  // strobe on the far rim
  const strobeP = new THREE.Vector3(RAD, surf(XC + RAD, 0) - YC + 0.95, 0);

  // ════════ boom: four 2.08 m carbon segments with hinges & harness ════════
  const base = new THREE.Vector3(-0.15, BY / 2 + RIS_H + 0.1, 0);
  const attachRefl = new THREE.Vector3(XC - RAD, surf(XC - RAD, 0) + 0.95, 0);       // rear ring, near rim (paraboloid frame)
  const attach = attachRefl.clone().add(new THREE.Vector3(0, VY, 0));                  // model frame
  const D = attach.clone().sub(base), SEG = D.length() / 4;
  const boomRoot = new THREE.Group(); boomRoot.position.copy(base); boomRoot.quaternion.setFromUnitVectors(_up, D.clone().normalize()); root.add(boomRoot);
  const segGeo = (() => {
    const r = 0.12, tri = [0, 1, 2].map((k) => new THREE.Vector3(Math.cos(k / 3 * TAU) * r, 0, Math.sin(k / 3 * TAU) * r)), pairs = [];
    for (let k = 0; k < 3; k++) pairs.push([tri[k].clone(), tri[k].clone().setY(SEG), 0.022]);
    const bays = 6;
    for (let b = 0; b <= bays; b++) { const y = (b / bays) * SEG; for (let k = 0; k < 3; k++) pairs.push([tri[k].clone().setY(y), tri[(k + 1) % 3].clone().setY(y), 0.012]); }
    for (let b = 0; b < bays; b++) { const y0 = (b / bays) * SEG, y1 = ((b + 1) / bays) * SEG; for (let k = 0; k < 3; k++) pairs.push([tri[k].clone().setY(y0), tri[(k + 1) % 3].clone().setY(y1), 0.009]); }
    return mergedTubes(pairs, 0.01, 6);
  })();
  const hingeGeo = (() => {
    const parts = [new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16).translate(0, 0.0, 0), new THREE.BoxGeometry(0.12, 0.22, 0.34).translate(0, 0.02, 0)];
    const cab = mergedTubes([[new THREE.Vector3(0.14, 0.05, 0), new THREE.Vector3(0.14, SEG - 0.05, 0), 0.014], [new THREE.Vector3(0.1, 0.05, 0.1), new THREE.Vector3(0.1, SEG - 0.05, 0.1), 0.01]], 0.012, 5);
    return { hinge: BufferGeometryUtils.mergeGeometries(parts, false), cable: cab };
  })();
  const segs = [];
  let parent = boomRoot;
  for (let k = 0; k < 4; k++) {
    const sg = new THREE.Group(); if (k) sg.position.y = SEG; parent.add(sg);
    sg.add(new THREE.Mesh(segGeo, M.carbon));
    sg.add(new THREE.Mesh(hingeGeo.hinge, M.joint));
    sg.add(new THREE.Mesh(hingeGeo.cable, M.harness));
    segs.push(sg); parent = sg;
  }
  const tip = new THREE.Group(); tip.position.y = SEG; parent.add(tip);
  tip.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), M.joint)));
  // place the reflector rigidly on the boom tip (deployed configuration)
  root.updateMatrixWorld(true);
  const tipM = tip.matrixWorld.clone(), rootInv = root.matrixWorld.clone().invert();
  const tipModel = rootInv.multiply(tipM);
  const reflModel = new THREE.Matrix4().makeTranslation(0, VY, 0);
  const rel = tipModel.clone().invert().multiply(reflModel);
  rel.decompose(refl.position, refl.quaternion, refl.scale);
  tip.add(refl);
  anim.segs = segs; anim.dishG = dishG;

  // ════════ feed → reflector illumination cone (radar pulse) ════════
  const feedPos = new THREE.Vector3(0.15, feedTop + 0.12, 0);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uPulse: { value: 0 }, uColor: { value: new THREE.Color(0xffb648) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    // s = 0 at the feed (cone apex) → 1 at the reflector: the pulse travels feed → reflector
    // faint volumetric sheath + one travelling ring, faded at both ends so it never blooms into a blob at the reflector
    fragmentShader: 'uniform float uPulse; uniform vec3 uColor; varying vec2 vUv; void main(){ float s = 1.0 - vUv.y; float band = exp(-pow((s - uPulse)/0.06, 2.0)); float ends = smoothstep(0.0, 0.15, s) * (1.0 - smoothstep(0.72, 1.0, s)); float a = (0.012 + 0.12*band) * ends; gl_FragColor = vec4(uColor*(0.55 + 0.6*band), a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  {
    const tgt = new THREE.Vector3(XC, VY + YC, 0), dir = tgt.clone().sub(feedPos), len = dir.length();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(RAD * 0.92, len, 48, 1, true).rotateX(Math.PI).translate(0, len / 2, 0), coneMat);
    cone.position.copy(feedPos); cone.quaternion.setFromUnitVectors(_up, dir.normalize());
    root.add(cone); anim.cone = cone; anim.coneMat = coneMat;
  }

  // ════════ beacons & glint ════════
  const mkBeacon = (color, pos, parentObj, size = 0.9) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color }));
    s.position.copy(pos); parentObj.add(s);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    gl.position.copy(pos); gl.scale.setScalar(size); parentObj.add(gl);
    return { s, gl };
  };
  anim.red = mkBeacon(0xff2a2a, new THREE.Vector3(tipX, 0.05, -PZ / 2 - 0.05), wingRot);
  anim.green = mkBeacon(0x2aff8a, new THREE.Vector3(tipX, 0.05, PZ / 2 + 0.05), wingRot);
  anim.strobe = mkBeacon(0xffffff, strobeP, dishG, 1.8);
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flare, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  flare.renderOrder = 20; beamOrigin.add(flare); anim.flare = flare;

  // ════════ animation ════════
  const _n = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion();
  function setDeploy(p) {
    anim.deploy = p;
    const pb = smoothstep(0.0, 0.55, p), pd = smoothstep(0.5, 1.0, p);
    const fold = 1 - Ease.inOutCubic(pb);
    segs[0].rotation.z = -0.35 * fold;
    segs[1].rotation.z = 2.75 * fold;
    segs[2].rotation.z = -2.75 * fold;
    segs[3].rotation.z = 2.75 * fold;
    const s = lerp(0.07, 1, Ease.outBack(pd)), sy = lerp(0.3, 1, Ease.outCubic(pd));
    dishG.scale.set(Math.max(0.05, s), sy, Math.max(0.05, s));
    M.dish.opacity = lerp(0.0, 1.0, smoothstep(0.55, 0.9, p));
    M.dish.alphaTest = Math.max(0.004, 0.3 * M.dish.opacity);     // the cut-off follows the fade, so the knit fades in instead of popping in at 30 %
    M.netFront.opacity = 0.55 * smoothstep(0.6, 1.0, p); M.netRear.opacity = 0.32 * smoothstep(0.6, 1.0, p); M.ties.opacity = 0.22 * smoothstep(0.7, 1.0, p);
    anim.cone.visible = p > 0.98;
  }
  function update(t, dt, o = {}) {
    // radar pulses: feed arrays flash, an energy ring travels from the feed to the reflector
    const ph = fract(t * 1.6), pS = fract(t * 2.4 + 0.3);
    M.copperL.emissiveIntensity = 0.15 + 2.2 * Math.pow(Math.max(0, 1 - ph * 5), 2);
    M.copperS.emissiveIntensity = 0.15 + 2.2 * Math.pow(Math.max(0, 1 - pS * 5), 2);
    coneMat.uniforms.uPulse.value = ph * 1.15;
    coneMat.uniforms.uColor.value.setHex(Math.floor(t * 1.6) % 2 ? 0x3ee6ff : 0xffb648);
    anim.cone.visible = (o.beam !== false) && anim.deploy > 0.98;
    // sun-tracking wing & Ka-band gimbal
    anim.wing.rotation.x = 0.35 * Math.sin(t * 0.07) - 0.15;
    anim.hga.az.rotation.y = t * 0.18;
    anim.hga.el.rotation.x = 0.55 + 0.25 * Math.sin(t * 0.33);
    // beacons: red/green 1 Hz flash, double-flash strobe every 1.7 s
    const blink = fract(t) < 0.12 ? 1 : 0, sb = fract(t / 1.7), strobe = (sb < 0.04 || (sb > 0.09 && sb < 0.13)) ? 1 : 0;
    anim.red.gl.material.opacity = 0.15 + 0.85 * blink;
    anim.green.gl.material.opacity = fract(t + 0.5) < 0.12 ? 1 : 0.15;
    anim.strobe.gl.material.opacity = strobe; anim.strobe.s.visible = strobe > 0;
    // RCS: short random pulses
    anim.plumeMat.uniforms.uTime.value = t;
    if (anim.firing < 0 && t > anim.fireAt) { anim.firing = (Math.random() * anim.plumes.length) | 0; anim.fireEnd = t + 0.16 + Math.random() * 0.22; if (o.onRcs) o.onRcs(); }
    if (anim.firing >= 0) {
      const P = anim.plumes[anim.firing], life = clamp((anim.fireEnd - t) / 0.3, 0, 1);
      P.plume.visible = true; P.plume.scale.set(1, 0.6 + 0.8 * Math.random(), 1); anim.plumeMat.uniforms.uI.value = 0.6 + 0.6 * life;
      P.glow.material.opacity = 0.9 * life;
      if (t > anim.fireEnd) { P.plume.visible = false; P.glow.material.opacity = 0; anim.firing = -1; anim.fireAt = t + 2.5 + Math.random() * 5; }
    }
    // sun glint on the reflector (mirror reflection of the sun toward the camera)
    if (o.camera && o.sunDir) {
      root.updateMatrixWorld();
      _q.setFromRotationMatrix(root.matrixWorld);
      _n.set(0, -1, 0).applyQuaternion(_q).normalize();
      beamOrigin.getWorldPosition(_c);
      _s.copy(o.sunDir).normalize();
      const ns = _n.dot(_s);
      let g = 0;
      if (ns > 0 && anim.deploy > 0.9) {
        _v.copy(o.camera.position).sub(_c).normalize();
        const r = _n.clone().multiplyScalar(2 * ns).sub(_s);
        g = Math.pow(Math.max(0, r.dot(_v)), 28);
      }
      flare.material.opacity = Math.min(0.8, g * 1.1);
      const ws = root.getWorldScale(_v).x || 1;
      flare.scale.setScalar((4 + 12 * g) / ws);
    }
  }
  root.userData = { dishAxis: new THREE.Vector3(0, -1, 0), beamOrigin, update, setDeploy, reflector: beamOrigin, anim };
  setDeploy(1);
  return root;
}
