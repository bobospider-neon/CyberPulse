// ───────────────────────── 10 · GLOBE (NISAR orbit, live swath painting) ─────────────────────────
const GLOBE_R = 10;
const ORBIT_R = GLOBE_R * (R_EARTH + NISAR.altKm) / R_EARTH;
/** ECEF unit vector → three.js axes (x, z, −y) */
const ecef2three = (x, y, z) => V3(x, z, -y);
function llToThree(lat, lon, r = GLOBE_R) {
  const la = lat * DEG, lo = lon * DEG;
  return ecef2three(Math.cos(la) * Math.cos(lo) * r, Math.cos(la) * Math.sin(lo) * r, Math.sin(la) * r);
}

class Globe {
  constructor(renderer, mask) {
    this.scene = new THREE.Scene();
    this.mask = mask;
    const U = this.U = { uTime: { value: 0 }, uSun: { value: V3(1, 0, 0) }, uLand: { value: null }, uSwath: { value: null }, uHi: { value: V3(0, 0, 0) }, uHiOn: { value: 0 } };
    // land mask texture (equirectangular, 0 = ocean, 1..255 = land elevation)
    const lm = new Uint8Array(mask.w * mask.h * 4);
    for (let k = 0; k < mask.w * mask.h; k++) { const v = mask.data[k]; lm[k * 4] = v; lm[k * 4 + 1] = v; lm[k * 4 + 2] = v; lm[k * 4 + 3] = 255; }
    const landTex = new THREE.DataTexture(lm, mask.w, mask.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    landTex.magFilter = landTex.minFilter = THREE.LinearFilter; landTex.wrapS = THREE.RepeatWrapping; landTex.needsUpdate = true;
    U.uLand.value = landTex;
    // swath coverage canvas
    this.cw = 2048; this.ch = 1024;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.cw; this.canvas.height = this.ch;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.cw, this.ch);
    this.swathTex = new THREE.CanvasTexture(this.canvas);
    this.swathTex.wrapS = THREE.RepeatWrapping; this.swathTex.minFilter = THREE.LinearFilter;
    U.uSwath.value = this.swathTex;
    // coverage bookkeeping (1° cells, land only, |lat| ≤ 87°)
    this.covW = 360; this.covH = 180; this.cov = new Uint8Array(this.covW * this.covH); this.landCells = 0; this.coveredCells = 0;
    this.isLand = new Uint8Array(this.covW * this.covH);
    for (let i = 0; i < this.covH; i++) for (let j = 0; j < this.covW; j++) {
      const mi = Math.min(mask.h - 1, Math.floor((i + 0.5) / this.covH * mask.h)), mj = Math.min(mask.w - 1, Math.floor((j + 0.5) / this.covW * mask.w));
      const lat = 90 - (i + 0.5);
      if (mask.data[mi * mask.w + mj] > 0 && Math.abs(lat) < 87) { this.isLand[i * this.covW + j] = 1; this.landCells++; }
    }

    this.earth = new THREE.Group();
    this.scene.add(this.earth);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: 'varying vec3 vN; varying vec3 vObjN; varying vec3 vW; void main(){ vObjN = normalize(position); vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform sampler2D uLand; uniform sampler2D uSwath; uniform vec3 uSun; uniform float uTime; uniform vec3 uHi; uniform float uHiOn;
        varying vec3 vN; varying vec3 vObjN; varying vec3 vW;
        void main(){
          vec3 n = normalize(vObjN);
          float lat = asin(clamp(n.y, -1.0, 1.0));
          float lon = atan(-n.z, n.x);
          vec2 uv = vec2((lon + 3.14159265) / 6.2831853, (1.5707963 - lat) / 3.14159265);
          float land = texture2D(uLand, uv).r;
          float isL = smoothstep(0.0, 0.02, land);
          vec3 sw = texture2D(uSwath, uv).rgb;
          float day = smoothstep(-0.12, 0.25, dot(normalize(vN), normalize(uSun)));
          vec3 ocean = mix(vec3(0.004, 0.012, 0.03), vec3(0.01, 0.05, 0.11), day);
          vec3 lc = mix(vec3(0.03, 0.09, 0.12), vec3(0.10, 0.30, 0.34), clamp(land * 3.0, 0.0, 1.0));
          vec3 col = mix(ocean, lc * (0.35 + 0.75 * day), isL);
          vec2 g = abs(fract(vec2(lon, lat) / 0.2617994 + 0.5) - 0.5) / fwidth(vec2(lon, lat) / 0.2617994);
          col += (1.0 - min(min(g.x, g.y), 1.0)) * vec3(0.10, 0.35, 0.55) * 0.35;
          col += sw * (0.85 + 0.6 * isL);
          float coast = smoothstep(0.0, 0.015, land) * (1.0 - smoothstep(0.015, 0.06, land));
          col += coast * vec3(0.2, 0.75, 0.95) * 0.45;
          vec3 V = normalize(cameraPosition - vW);
          float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
          col += rim * vec3(0.25, 0.65, 1.0) * 0.7;
          if (uHiOn > 0.5) { float d = distance(n, uHi); col += exp(-pow(d / 0.012, 2.0)) * vec3(1.0, 0.8, 0.4) * 2.0; }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R, 128, 96), earthMat);
    this.earth.add(this.earthMesh);
    // dot-matrix continents (Fibonacci lattice)
    const pts = [], cols = [];
    const M = 64000, ga = Math.PI * (3 - Math.sqrt(5));
    for (let n = 0; n < M; n++) {
      const y = 1 - (n + 0.5) / M * 2, r = Math.sqrt(1 - y * y), th = ga * n;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      const lat = Math.asin(y), lon = Math.atan2(-z, x);
      const mi = Math.min(mask.h - 1, Math.floor((Math.PI / 2 - lat) / Math.PI * mask.h)), mj = Math.min(mask.w - 1, Math.floor((lon + Math.PI) / TAU * mask.w));
      const v = mask.data[mi * mask.w + mj];
      if (!v) continue;
      pts.push(x * GLOBE_R * 1.004, y * GLOBE_R * 1.004, z * GLOBE_R * 1.004);
      const e = Math.min(1, v / 120);
      cols.push(0.25 + 0.75 * e, 0.75 + 0.2 * e, 0.95 - 0.35 * e);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); dg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.dots = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.055, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false }));
    this.earth.add(this.dots);
    // atmosphere
    const atm = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 1.085, 96, 64), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - abs(dot(normalize(vN), V)), 2.4); gl_FragColor = vec4(vec3(0.25,0.6,1.0)*f*1.6, f); }',
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(atm);
    // sky
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime }, vertexShader: SKY_VS.replace('gl_Position = p.xyww;', 'gl_Position = p;'), fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }));
    this.scene.add(this.sky);
    // orbit (inertial frame)
    this.incl = NISAR.incl * DEG; this.raan = 1.2;
    const op = [];
    for (let k = 0; k <= 256; k++) op.push(this.eciToThree(this.orbitECI((k / 256) * TAU)));
    this.orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(op), new THREE.LineBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.55 }));
    this.scene.add(this.orbitLine);
    const h = V3(Math.sin(this.raan) * Math.sin(this.incl), -Math.cos(this.raan) * Math.sin(this.incl), Math.cos(this.incl));   // orbit normal (ECI)
    U.uSun.value.copy(this.eciToThree([h.x, h.y, h.z]).normalize());
    // satellite marker + beam
    this.sat = buildNISARLite(); this.sat.scale.setScalar(0.085);
    this.scene.add(this.sat);
    this.satGlow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
    this.scene.add(this.satGlow);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    bg.setAttribute('aT', new THREE.Float32BufferAttribute([0, 1, 1], 1)); bg.setAttribute('aS', new THREE.Float32BufferAttribute([0, -1, 1], 1));
    this.beam = new THREE.Mesh(bg, new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0xffc870) }, uTime: U.uTime, uOpacity: { value: 0.8 }, uSpeed: { value: 3 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.beam.frustumCulled = false;
    this.scene.add(this.beam);
    // trail
    this.trailN = 90; this.trail = [];
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.trailN * 3), 3));
    const ta = new Float32Array(this.trailN); for (let k = 0; k < this.trailN; k++) ta[k] = k / (this.trailN - 1);
    tg.setAttribute('aA', new THREE.BufferAttribute(ta, 1));
    this.trailLine = new THREE.Line(tg, new THREE.ShaderMaterial({ vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }', fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0,0.82,0.5)*1.8, vA*vA); }', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);
    // site markers
    this.markers = SITE_ORDER.map((id) => {
      const m = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: SITES[id].home ? 0xffb648 : 0x3ee6ff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6).translate(0, 0.6, 0), new THREE.MeshBasicMaterial({ color: SITES[id].home ? 0xffb648 : 0x3ee6ff, transparent: true, opacity: 0.85 }));
      m.add(ring, pillar);
      this.earth.add(m);
      return { id, m, ring, pillar, lat: 0, lon: 0 };
    });
    this.simT = 0;          // seconds since epoch of the simulation
    this.speed = 500;       // sim seconds per real second
    this.lastPaint = null; this.orbitCount = 0;
    this.theta0 = 0.3;
  }
  setSites(metaById) {
    for (const mk of this.markers) {
      const meta = metaById[mk.id]; mk.lat = meta.lat; mk.lon = meta.lon;
      const p = llToThree(meta.lat, meta.lon, GLOBE_R * 1.002);
      mk.m.position.copy(p);
      mk.m.quaternion.setFromUnitVectors(V3(0, 1, 0), p.clone().normalize());
      mk.ring.rotation.x = -Math.PI / 2;
    }
  }
  orbitECI(u) {
    const i = this.incl, O = this.raan;
    return [Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(i), Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(i), Math.sin(u) * Math.sin(i)].map((v) => v * ORBIT_R);
  }
  eciToThree(r) { return V3(r[0], r[2], -r[1]); }
  thetaG(t) { return this.theta0 + OMEGA_E * t; }
  /** sub-satellite point + ground-track velocity (ECEF unit vectors) */
  ecefState(t) {
    const u = TAU * t / NISAR.periodS;
    const r = this.orbitECI(u), th = this.thetaG(t), c = Math.cos(th), s = Math.sin(th);
    const e = [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
    const L = Math.hypot(e[0], e[1], e[2]);
    return [e[0] / L, e[1] / L, e[2] / L];
  }
  paintStep(t0, t1) {
    const a = this.ecefState(t0), b = this.ecefState(t1);
    const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], vl = Math.hypot(...v) || 1;
    const f = [v[0] / vl, v[1] / vl, v[2] / vl];
    const left = (u) => [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]];
    const edge = (u, beta) => { const l = left(u); const p = [Math.cos(beta) * u[0] + Math.sin(beta) * l[0], Math.cos(beta) * u[1] + Math.sin(beta) * l[1], Math.cos(beta) * u[2] + Math.sin(beta) * l[2]]; const lat = Math.asin(clamp(p[2], -1, 1)), lon = Math.atan2(p[1], p[0]); return [(lon + Math.PI) / TAU * this.cw, (Math.PI / 2 - lat) / Math.PI * this.ch, lat, lon]; };
    const bN = 0.0664, bF = 0.1064;
    const q = [edge(a, bN), edge(a, bF), edge(b, bF), edge(b, bN)];
    const xs = q.map((p) => p[0]);
    if (Math.max(...xs) - Math.min(...xs) > this.cw / 2) return;
    const asc = b[2] > a[2];
    const g = this.ctx;
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = asc ? 'rgba(255,170,60,0.10)' : 'rgba(50,210,255,0.10)';
    g.beginPath(); g.moveTo(q[0][0], q[0][1]); for (let n = 1; n < 4; n++) g.lineTo(q[n][0], q[n][1]); g.closePath(); g.fill();
    g.globalCompositeOperation = 'source-over';
    // coverage bookkeeping at the swath centre
    const mid = edge(a, (bN + bF) / 2);
    for (const p of [mid, q[0], q[1]]) {
      const ci = clamp(Math.floor((90 - p[2] / DEG)), 0, this.covH - 1), cj = clamp(Math.floor((p[3] / DEG + 180)), 0, this.covW - 1);
      const k = ci * this.covW + cj;
      if (this.isLand[k] && !this.cov[k]) { this.cov[k] = 1; this.coveredCells++; }
    }
  }
  /** pre-paint the last `hours` of passes so the globe opens with history */
  prepaint(hours) {
    const t1 = this.simT, t0 = t1 - hours * 3600;
    for (let t = t0; t < t1; t += 20) this.paintStep(t, t + 20);
    this.swathTex.needsUpdate = true;
  }
  update(dt, time) {
    this.U.uTime.value = time;
    const t0 = this.simT;
    this.simT += dt * this.speed;
    const steps = Math.ceil((this.simT - t0) / 20);
    for (let s = 0; s < steps; s++) { const a = t0 + (s / steps) * (this.simT - t0), b = t0 + ((s + 1) / steps) * (this.simT - t0); this.paintStep(a, b); }
    if (steps) this.swathTex.needsUpdate = true;
    this.earth.rotation.y = this.thetaG(this.simT);
    const u = TAU * this.simT / NISAR.periodS;
    const p = this.eciToThree(this.orbitECI(u));
    this.sat.position.copy(p); this.satGlow.position.copy(p);
    this.sat.lookAt(0, 0, 0);
    // beam: from the satellite to the swath centre (left of track)
    const sub = p.clone().normalize().multiplyScalar(GLOBE_R);
    const vdir = this.eciToThree(this.orbitECI(u + 0.01)).sub(p).normalize();
    const left = p.clone().normalize().cross(vdir).normalize();
    const near = sub.clone().applyAxisAngle(vdir, 0).add(left.clone().multiplyScalar(GLOBE_R * 0.0664)).normalize().multiplyScalar(GLOBE_R);
    const far = sub.clone().add(left.clone().multiplyScalar(GLOBE_R * 0.1064)).normalize().multiplyScalar(GLOBE_R);
    const ba = this.beam.geometry.attributes.position.array;
    ba.set([p.x, p.y, p.z, near.x, near.y, near.z, far.x, far.y, far.z]);
    this.beam.geometry.attributes.position.needsUpdate = true;
    // trail
    this.trail.push(p.clone()); if (this.trail.length > this.trailN) this.trail.shift();
    const ta = this.trailLine.geometry.attributes.position.array;
    for (let k = 0; k < this.trailN; k++) { const q = this.trail[Math.max(0, this.trail.length - this.trailN + k)] || p; ta[k * 3] = q.x; ta[k * 3 + 1] = q.y; ta[k * 3 + 2] = q.z; }
    this.trailLine.geometry.attributes.position.needsUpdate = true;
    for (const mk of this.markers) { const s = 1 + 0.35 * Math.sin(time * 3 + mk.lat); mk.ring.scale.setScalar(s); mk.ring.material.opacity = 0.9 - 0.4 * (s - 1) / 0.35; }
    this.orbitCount = Math.floor(this.simT / NISAR.periodS);
  }
  telemetry() {
    const e = this.ecefState(this.simT), e2 = this.ecefState(this.simT + 10);
    return { lat: Math.asin(e[2]) / DEG, lon: Math.atan2(e[1], e[0]) / DEG, asc: e2[2] > e[2], orbit: this.orbitCount, cov: this.coveredCells / this.landCells };
  }
  siteWorld(id) { const mk = this.markers.find((m) => m.id === id); const p = new THREE.Vector3(); mk.m.getWorldPosition(p); return p; }
}
