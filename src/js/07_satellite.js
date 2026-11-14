// ───────────────────────── 07 · NISAR SPACECRAFT — lite model (globe marker) ─────────────────────────
// Bus + radar instrument structure + 9 m boom + 12 m gold wire-mesh reflector + solar wing.
function makeMeshTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.strokeStyle = '#fff'; g.lineWidth = 1;
  for (let i = 0; i <= size; i += 8) { g.globalAlpha = 0.9; g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 10); t.anisotropy = 4;
  return t;
}
function makeFoilTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = mulberry32(99);
  g.fillStyle = '#b8862e'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = r() * size, y = r() * size, w = 6 + r() * 30, h = 3 + r() * 14;
    g.fillStyle = `rgba(${200 + r() * 55 | 0},${150 + r() * 70 | 0},${50 + r() * 50 | 0},${0.25 + r() * 0.35})`;
    g.save(); g.translate(x, y); g.rotate(r() * Math.PI); g.fillRect(-w / 2, -h / 2, w, h); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function makeSolarTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#081a3a'; g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 16) for (let y = 0; y < 128; y += 16) {
    const grd = g.createLinearGradient(x, y, x + 16, y + 16);
    grd.addColorStop(0, '#12306a'); grd.addColorStop(1, '#0a1f48');
    g.fillStyle = grd; g.fillRect(x + 1, y + 1, 14, 14);
  }
  g.strokeStyle = 'rgba(160,200,255,.35)'; g.lineWidth = 1;
  for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
  return new THREE.CanvasTexture(c);
}

function buildNISARLite() {
  const root = new THREE.Group();
  const foil = makeFoilTexture();
  const goldFoil = new THREE.MeshStandardMaterial({ map: foil, color: 0xffd38a, metalness: 0.85, roughness: 0.38, emissive: 0x2a1400, emissiveIntensity: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8edf5, metalness: 0.25, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b222c, metalness: 0.6, roughness: 0.45 });
  const truss = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, metalness: 0.7, roughness: 0.3 });

  // spacecraft bus (ISRO I-3K class) wrapped in MLI foil
  const bus = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 1.35), goldFoil);
  root.add(bus);
  // radar instrument structure (octagonal tower) with L/S feed panels
  const ris = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.45, 8), white);
  ris.rotation.z = Math.PI / 2; ris.position.set(1.25, 0, 0);
  root.add(ris);
  const feedL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.55), new THREE.MeshStandardMaterial({ color: 0x3a2a12, emissive: 0xffa53a, emissiveIntensity: 0.55, metalness: 0.4, roughness: 0.4 }));
  feedL.position.set(1.25, -0.25, 0.62); feedL.rotation.y = Math.PI / 2;
  const feedS = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.38), new THREE.MeshStandardMaterial({ color: 0x0f2a33, emissive: 0x2fdcff, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.4 }));
  feedS.position.set(1.25, 0.42, 0.62); feedS.rotation.y = Math.PI / 2;
  root.add(feedL, feedS);
  // solar wing
  const wing = new THREE.Group();
  const panelMat = new THREE.MeshStandardMaterial({ map: makeSolarTexture(), color: 0xffffff, metalness: 0.5, roughness: 0.32, emissive: 0x0a2050, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  for (let k = 0; k < 4; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.03, 1.15), panelMat);
    p.position.set(-1.2 - k * 1.3, 0, 0);
    wing.add(p);
  }
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), truss);
  yoke.rotation.z = Math.PI / 2; yoke.position.set(-0.75, 0, 0); wing.add(yoke);
  root.add(wing);
  // 9 m deployable boom (triangular truss) from the RIS to the reflector rim
  const boom = new THREE.Group();
  const boomLen = 3.6;
  const segs = 7;
  const pts = [[0, 0.11], [0.095, -0.055], [-0.095, -0.055]];
  for (const [a, b] of pts) {
    const lon = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, boomLen, 5), truss);
    lon.position.set(a, boomLen / 2, b); boom.add(lon);
  }
  for (let s = 0; s <= segs; s++) {
    const y = (s / segs) * boomLen;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 4, 3), truss);
    ring.rotation.x = Math.PI / 2; ring.position.y = y; boom.add(ring);
  }
  boom.position.set(1.9, 0.2, 0);
  boom.rotation.z = -Math.PI / 2 + 0.55;
  root.add(boom);
  // 12 m reflector: shallow paraboloid of gold-plated molybdenum wire mesh + rim truss
  const R = 2.5, f = 2.2;
  const prof = [];
  for (let i = 0; i <= 24; i++) { const r = (i / 24) * R; prof.push(new THREE.Vector2(r, (r * r) / (4 * f))); }
  const dishGeo = new THREE.LatheGeometry(prof, 96);
  const meshTex = makeMeshTexture();
  const dish = new THREE.Mesh(dishGeo, new THREE.MeshStandardMaterial({
    color: 0xffc35a, metalness: 1.0, roughness: 0.28, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
    alphaMap: meshTex, alphaTest: 0.02, emissive: 0x3a2200, emissiveIntensity: 0.5,
  }));
  const dishBack = new THREE.Mesh(dishGeo, new THREE.MeshBasicMaterial({ color: 0xffb648, wireframe: true, transparent: true, opacity: 0.18 }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.045, 6, 96), truss);
  rim.rotation.x = Math.PI / 2; rim.position.y = (R * R) / (4 * f);
  const ribs = new THREE.Group();
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * TAU;
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, R, 4), truss);
    rib.position.set(Math.cos(a) * R / 2, (R * R) / (16 * f), Math.sin(a) * R / 2);
    rib.rotation.z = Math.PI / 2; rib.rotation.y = -a;
    ribs.add(rib);
  }
  const reflector = new THREE.Group();
  reflector.add(dish, dishBack, rim, ribs);
  const boomTip = new THREE.Vector3(0, boomLen, 0).applyEuler(boom.rotation).add(boom.position);
  reflector.position.copy(boomTip).add(new THREE.Vector3(1.3, 0.9, 0));
  reflector.rotation.z = 0.95;
  root.add(reflector);
  // navigation lights
  const blink = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
  blink.position.set(-0.6, 0.62, 0.7); root.add(blink);
  const blink2 = blink.clone(); blink2.material = new THREE.MeshBasicMaterial({ color: 0x30ff90 }); blink2.position.set(-0.6, 0.62, -0.7); root.add(blink2);
  root.userData = { reflector, dish, blink, blink2, wing };
  root.traverse((o) => { o.layers.set(0); });
  return root;
}
