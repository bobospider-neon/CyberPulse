// ───────────────────────── 08 · TERRAIN WORLD (scene graph, textures, per-frame uniforms) ─────────────────────────
const V2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);
const KIND_CODE = { volcano: 0, fault: 1, glacier: 2, wetland: 3, urban: 4, custom: 5 };
const EVENT_CODE = { debris: 1, fire: 1, windthrow: 2, calving: 3, rupture: 4, fissure: 4, custom: 4 };

function dataTex(data, N, type, filter, fmt = THREE.RGBAFormat) {
  const t = new THREE.DataTexture(data, N, N, fmt, type);
  t.minFilter = filter; t.magFilter = filter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.flipY = false;
  t.needsUpdate = true;
  return t;
}
const ZERO_TEX = dataTex(new Float32Array(4), 1, THREE.FloatType, THREE.NearestFilter);

/** N×N grid at cell centres (shared by terrain and water) */
function gridGeometry(N) {
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const k = i * N + j;
    pos[k * 3] = (j + 0.5) / N * CFG.W - CFG.W / 2; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = (i + 0.5) / N * CFG.W - CFG.W / 2;
    uv[k * 2] = (j + 0.5) / N; uv[k * 2 + 1] = (i + 0.5) / N;
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let n = 0;
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const a = i * N + j, b = (i + 1) * N + j, c = i * N + j + 1, d = (i + 1) * N + j + 1;
    idx[n++] = a; idx[n++] = b; idx[n++] = c; idx[n++] = c; idx[n++] = b; idx[n++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(V3(0, 0, 0), 120);
  return g;
}
function skirtGeometry(N) {
  const W = CFG.W, P = [], UVs = [], T = [], I = [];
  const edges = [
    (s) => [s, 0], (s) => [N - 1, s], (s) => [N - 1 - s, N - 1], (s) => [0, N - 1 - s],   // (row, col) along N, E, S, W sides (clockwise)
  ];
  const sides = [(s) => [0, s], (s) => [s, N - 1], (s) => [N - 1, N - 1 - s], (s) => [N - 1 - s, 0]];
  void edges;
  for (const side of sides) {
    const base = P.length / 3;
    for (let s = 0; s < N; s++) {
      const [i, j] = side(s);
      const x = (j + 0.5) / N * W - W / 2, z = (i + 0.5) / N * W - W / 2, u = (j + 0.5) / N, v = (i + 0.5) / N;
      P.push(x, 0, z, x, 0, z); UVs.push(u, v, u, v); T.push(1, 0);
    }
    for (let s = 0; s < N - 1; s++) { const a = base + s * 2; I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(T, 1));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(V3(0, 0, 0), 120);
  return g;
}
function arrowGeometry() {
  const shaft = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 8).translate(0, 0.35, 0).toNonIndexed();
  const head = new THREE.ConeGeometry(0.2, 0.3, 10).translate(0, 0.85, 0).toNonIndexed();
  const g = new THREE.BufferGeometry();
  const cat = (a, b) => { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  g.setAttribute('position', new THREE.BufferAttribute(cat(shaft.attributes.position.array, head.attributes.position.array), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(cat(shaft.attributes.normal.array, head.attributes.normal.array), 3));
  return g;
}

class World {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.fog = null;
    const U = this.U = {
      uStatic: { value: ZERO_TEX }, uB0: { value: ZERO_TEX }, uB1: { value: ZERO_TEX }, uB2: { value: ZERO_TEX }, uB3: { value: ZERO_TEX },
      uCover: { value: ZERO_TEX }, uEvents: { value: ZERO_TEX }, uUnw: { value: ZERO_TEX }, uAPS: { value: ZERO_TEX }, uNoise: { value: ZERO_TEX }, uCCD: { value: ZERO_TEX }, uReal: { value: ZERO_TEX }, uRealOn: { value: 0 },
      uN: { value: CFG.N }, uNB: { value: 0 }, uMpu: { value: 400 }, uYScale: { value: 0.003 }, uEBase: { value: 0 }, uEMean: { value: 0 }, uKind: { value: 0 }, uLooks: { value: CFG.looks }, uLamC: { value: BANDS.L.lambda },
      uMW: { value: V4() }, uPW: { value: V4() }, uTW: { value: V4() }, uLos: { value: V3(0.6, 0.1, 0.78) },
      uPulse: { value: V2() }, uCalve: { value: V2() }, uEvCur: { value: V4() }, uEvBetween: { value: V4() }, uEvKind: { value: V4() },
      uRupt: { value: V4(1e9, 2500, 0, 0) }, uFault: { value: V4() }, uUnwGate: { value: 0 },
      uCohL: { value: COH_CLASSES.map((c) => V3(...COH.L[c])) }, uCohS: { value: COH_CLASSES.map((c) => V3(...COH.S[c])) },
      uFlat: { value: 0 }, uCell: { value: CFG.W / CFG.N },
      uMode: { value: 0 }, uBand: { value: 0 }, uLensOn: { value: 0 }, uLens: { value: V3(0, 0, 7) }, uDt: { value: 0 },
      uApsW: { value: V4() }, uStrat: { value: 0 }, uTurb: { value: 0 }, uStratK: { value: 0 }, uApsOn: { value: 1 }, uNoiseW: { value: V4(1, 0, 0, 0) },
      uCycle: { value: 0 }, uFrameDays: { value: 0 }, uCohMask: { value: 0.25 }, uDefoRange: { value: 0.1 }, uDefoStep: { value: 0.02 }, uFusion: { value: 0 },
      uSun: { value: V3(-0.5, 0.75, 0.35).normalize() }, uTime: { value: 0 }, uReveal: { value: 1e4 }, uAcq: { value: 1e4 },
      uBeam: { value: V4(0, 0, 0, -1) }, uBeam2: { value: V4(8, 60, 0, 0) }, uHover: { value: V4(0, 0, 0.6, 0) },
      uSlice: { value: V4() }, uSliceOn: { value: 0 }, uCCDOn: { value: 0 }, uCCDScan: { value: 0 },
      uUnwOn: { value: 0 }, uUnwFront: { value: 0 }, uUnwRange: { value: 0.1 },
      uFogCol: { value: V3(0.015, 0.025, 0.05) }, uGrid: { value: 12.5 }, uEMin: { value: 0 }, uEMax: { value: 1 },
      uCanopyVE: { value: 1 }, uPtSize: { value: 1.4 }, uGhost: { value: 1 }, uTiltGain: { value: 1 }, uArrowScale: { value: 1 },
      uBaseY: { value: -3 }, uStrataA: { value: V3(0.12, 0.09, 0.07) }, uStrataB: { value: V3(0.30, 0.22, 0.15) },
    };
    this.grid = gridGeometry(CFG.N);
    this.terrainMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS });
    this.terrain = new THREE.Mesh(this.grid, this.terrainMat);
    this.terrain.frustumCulled = false;
    this.terrain.layers.enable(1);
    this.scene.add(this.terrain);

    this.waterMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: WATER_VS, fragmentShader: WATER_FS, transparent: true, depthWrite: false });
    this.water = new THREE.Mesh(this.grid, this.waterMat);
    this.water.frustumCulled = false; this.water.renderOrder = 2; this.water.layers.enable(1);
    this.scene.add(this.water);

    this.skirtMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKIRT_VS, fragmentShader: SKIRT_FS, side: THREE.DoubleSide, transparent: true });
    this.skirt = new THREE.Mesh(skirtGeometry(CFG.N), this.skirtMat);
    this.skirt.frustumCulled = false;
    this.scene.add(this.skirt);

    // holographic table under the block
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uBaseY: U.uBaseY },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform float uTime; varying vec3 vW;
        void main(){ vec2 p = vW.xz; float r = length(p);
          vec2 g = abs(fract(p / 5.0 + 0.5) - 0.5) / fwidth(p / 5.0); float grid = 1.0 - min(min(g.x, g.y), 1.0);
          float ring = exp(-pow(fract(r / 14.0 - uTime * 0.05) - 0.5, 2.0) * 160.0);
          float fade = smoothstep(190.0, 60.0, r);
          float inBlock = step(max(abs(p.x), abs(p.y)), 50.5);
          vec3 c = vec3(0.12, 0.55, 0.85) * (grid * 0.22 + ring * 0.25) * fade + vec3(0.02, 0.05, 0.09) * inBlock;
          gl_FragColor = vec4(c, (grid * 0.5 + ring * 0.4) * fade + inBlock * 0.9); }`,
      transparent: true, depthWrite: false,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 420).rotateX(-Math.PI / 2), this.floorMat);
    this.scene.add(this.floor);
    const edgePts = [];
    const hw = CFG.W / 2;
    for (const [a, b] of [[[-hw, -hw], [hw, -hw]], [[hw, -hw], [hw, hw]], [[hw, hw], [-hw, hw]], [[-hw, hw], [-hw, -hw]]]) edgePts.push(a[0], 0, a[1], b[0], 0, b[1]);
    this.frame = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3)), new THREE.LineBasicMaterial({ color: 0x3ee6ff, transparent: true, opacity: 0.55 }));
    this.scene.add(this.frame);

    // sky
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime }, vertexShader: SKY_VS.replace('gl_Position = p.xyww;', 'gl_Position = p;'), fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }));
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // lights + environment (satellite)
    this.scene.add(new THREE.HemisphereLight(0x9cc8ff, 0x1a120a, 0.7));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.2); sun.position.set(-60, 90, 40); this.scene.add(sun);
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;

    // satellites & beams (asc / desc)
    this.sats = ['asc', 'desc'].map((kind) => {
      const model = buildNISAR(); model.scale.setScalar(0.8);
      this.scene.add(model);
      const beams = [this.makeBeam(0xffb648, 1.0), this.makeBeam(0x3ee6ff, 0.72)];
      beams.forEach((b) => this.scene.add(b.mesh));
      return { kind, model, beams, pos: V3(), visible: false };
    });
    // X-ray lens
    this.lensMat = new THREE.ShaderMaterial({ uniforms: { uTime: U.uTime, uOpacity: { value: 0 } }, vertexShader: LENS_VS, fragmentShader: LENS_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.lens = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0), this.lensMat);
    this.lens.visible = false; this.lens.renderOrder = 5;
    this.scene.add(this.lens);
    // dynamic groups
    this.dyn = new THREE.Group(); this.scene.add(this.dyn);
    this.canopy = null; this.buildings = null; this.arrows = null; this.fences = null; this.curtain = null; this.particles = null; this.bergs = null; this.chamber = null;
    this.sc = null;
  }

  makeBeam(color, widthK) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    // 4 side faces × 3 vertices: apex, corner a, corner b
    const aT = [], aS = [];
    for (let f = 0; f < 4; f++) { aT.push(0, 1, 1); aS.push(0, -1, 1); }
    g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(color) }, uTime: this.U.uTime, uOpacity: { value: 0.0 }, uSpeed: { value: widthK > 0.9 ? 1.6 : 2.4 } }, vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 6;
    return { mesh, widthK };
  }

  // ───────────── load a scene ─────────────
  load(sc) {
    const U = this.U, N = sc.N, NN = N * N;
    this.dispose();
    this.sc = sc;
    const st = new Float32Array(NN * 4);
    for (let k = 0; k < NN; k++) { st[k * 4] = sc.dem[k]; st[k * 4 + 1] = sc.kind === 'custom' ? sc.ampDb[k] : sc.canopyH[k]; st[k * 4 + 2] = Math.min(sc.spill[k], 1e6); st[k * 4 + 3] = sc.aux[k]; }
    this.texStatic = dataTex(st, N, THREE.FloatType, THREE.NearestFilter);
    this.texB = [0, 1, 2, 3].map((b) => (sc.bases[b] ? dataTex(sc.bases[b].data, N, THREE.FloatType, THREE.NearestFilter) : ZERO_TEX));
    const cov = new Uint8Array(NN * 4);
    for (let k = 0; k < NN; k++) { cov[k * 4] = Math.round(sc.cover.veg[k] * 255); cov[k * 4 + 1] = Math.round(sc.cover.water[k] * 255); cov[k * 4 + 2] = Math.round(sc.cover.urban[k] * 255); cov[k * 4 + 3] = Math.round(sc.cover.ice[k] * 255); }
    this.texCover = dataTex(cov, N, THREE.UnsignedByteType, THREE.LinearFilter);
    const ev = new Uint8Array(NN * 4);
    sc.events.slice(0, 4).forEach((e, n) => { for (let k = 0; k < NN; k++) ev[k * 4 + n] = Math.round(clamp(e.mask[k], 0, 1) * 255); });
    this.texEvents = dataTex(ev, N, THREE.UnsignedByteType, THREE.LinearFilter);
    const aps = new Uint16Array(NN * 4);
    for (let k = 0; k < NN; k++) for (let c = 0; c < 4; c++) aps[k * 4 + c] = THREE.DataUtils.toHalfFloat(sc.aps.screens[c][k]);
    this.texAPS = dataTex(aps, N, THREE.HalfFloatType, THREE.LinearFilter);
    this.texNoise = dataTex(sc.noiseBytes, N, THREE.UnsignedByteType, THREE.NearestFilter);
    this.unwData = new Uint8Array(NN * 4); this.texUnw = dataTex(this.unwData, N, THREE.UnsignedByteType, THREE.LinearFilter);
    this.ccdData = new Uint8Array(NN * 4); this.texCCD = dataTex(this.ccdData, N, THREE.UnsignedByteType, THREE.LinearFilter);
    Object.assign(U.uStatic, { value: this.texStatic }); U.uB0.value = this.texB[0]; U.uB1.value = this.texB[1]; U.uB2.value = this.texB[2]; U.uB3.value = this.texB[3];
    U.uCover.value = this.texCover; U.uEvents.value = this.texEvents; U.uAPS.value = this.texAPS; U.uNoise.value = this.texNoise; U.uUnw.value = this.texUnw; U.uCCD.value = this.texCCD;
    U.uNB.value = sc.bases.length; U.uMpu.value = sc.grid.mpu; U.uYScale.value = sc.yScale; U.uEBase.value = sc.eBase; U.uEMean.value = sc.emean;
    U.uKind.value = KIND_CODE[sc.kind]; U.uEMin.value = sc.emin; U.uEMax.value = sc.emax;
    U.uLamC.value = sc.lambda || BANDS.L.lambda;
    U.uTurb.value = sc.aps.turb; U.uStratK.value = sc.aps.stratK;
    U.uGrid.value = 5000 / sc.grid.mpu;
    U.uEvKind.value.set(...[0, 1, 2, 3].map((n) => (sc.events[n] ? EVENT_CODE[sc.events[n].kind] || 4 : 0)));
    U.uCCDOn.value = 0; U.uRealOn.value = 0; U.uUnwOn.value = 0; U.uUnwGate.value = 0;
    U.uCanopyVE.value = sc.site.canopyVE;
    const relief = (sc.emax - sc.eBase) * sc.yScale;
    U.uBaseY.value = -Math.max(2.2, relief * 0.12) - 1.0;
    this.floor.position.y = U.uBaseY.value - 0.02; this.frame.position.y = U.uBaseY.value + 0.01;
    const strata = { volcano: [[0.16, 0.07, 0.05], [0.42, 0.20, 0.10]], fault: [[0.20, 0.15, 0.10], [0.45, 0.35, 0.22]], glacier: [[0.10, 0.18, 0.26], [0.45, 0.65, 0.80]], wetland: [[0.10, 0.12, 0.08], [0.28, 0.24, 0.14]], urban: [[0.20, 0.17, 0.12], [0.42, 0.36, 0.26]], custom: [[0.12, 0.14, 0.18], [0.3, 0.34, 0.4]] }[sc.kind];
    U.uStrataA.value.set(...strata[0]); U.uStrataB.value.set(...strata[1]);
    if (sc.fault) {
      const p = sc.grid.ij2xz(sc.fault.i, sc.fault.j);
      const sx = sc.fault.se, sz = -sc.fault.sn, L = Math.hypot(sx, sz);
      U.uFault.value.set(p.x, p.z, sx / L, sz / L);
      U.uRupt.value.set(sc.rupture.front, sc.rupture.width, 1, 0);
    } else U.uRupt.value.set(1e9, 2500, 0, 0);
    this.water.visible = sc.hasWater;
    this.buildCanopy(sc); this.buildBuildings(sc); this.buildArrows(sc); this.buildGlacierFx(sc); this.buildSubsurface(sc);
  }
  dispose() {
    for (const t of [this.texStatic, ...(this.texB || []), this.texCover, this.texEvents, this.texAPS, this.texNoise, this.texUnw, this.texCCD]) if (t && t !== ZERO_TEX) t.dispose();
    while (this.dyn.children.length) { const o = this.dyn.children.pop(); o.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); }
    this.canopy = this.buildings = this.arrows = this.fences = this.curtain = this.particles = this.bergs = this.chamber = this.faultPlane = null;
  }
  buildCanopy(sc) {
    if (!sc.canopyPts || !sc.canopyPts.length) return;
    const n = sc.canopyPts.length / 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aPt', new THREE.BufferAttribute(sc.canopyPts, 4));
    const m = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: CANOPY_VS, fragmentShader: CANOPY_FS, transparent: true, depthWrite: true });
    this.canopy = new THREE.Points(g, m); this.canopy.frustumCulled = false; this.canopy.renderOrder = 3;
    this.dyn.add(this.canopy);
    this.U.uPtSize.value = sc.kind === 'wetland' ? 1.25 : 1.5;
  }
  buildBuildings(sc) {
    if (!sc.buildings) return;
    const B = sc.buildings, n = B.length, base = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.normal = base.attributes.normal;
    const iUV = new Float32Array(n * 2), iSize = new Float32Array(n * 3), iRot = new Float32Array(n), iSeed = new Float32Array(n), iEv = new Float32Array(n);
    const mpu = sc.grid.mpu, hScale = sc.yScale * 4.5;
    B.forEach((b, k) => {
      iUV[k * 2] = b.j / sc.N; iUV[k * 2 + 1] = b.i / sc.N;
      iSize[k * 3] = b.w / mpu; iSize[k * 3 + 1] = b.d / mpu; iSize[k * 3 + 2] = Math.max(0.05, b.h * hScale);
      iRot[k] = b.rot; iSeed[k] = b.seed; iEv[k] = b.event === undefined ? -1 : b.event;
    });
    g.setAttribute('iUV', new THREE.InstancedBufferAttribute(iUV, 2)); g.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 3));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(iRot, 1)); g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(iSeed, 1)); g.setAttribute('iEvent', new THREE.InstancedBufferAttribute(iEv, 1));
    g.instanceCount = n;
    const m = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: BUILD_VS, fragmentShader: BUILD_FS });
    this.buildings = new THREE.Mesh(g, m); this.buildings.frustumCulled = false;
    this.dyn.add(this.buildings);
  }
  buildArrows(sc) {
    const N = sc.N, g0 = arrowGeometry(), uvs = [];
    const step = Math.round(N / 22);
    for (let i = step / 2; i < N; i += step) for (let j = step / 2; j < N; j += step) {
      const k = (i | 0) * N + (j | 0);
      if (sc.cover.water[k] > 0.5) continue;
      uvs.push((j + 0.5) / N, (i + 0.5) / N);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.attributes.position = g0.attributes.position; g.attributes.normal = g0.attributes.normal;
    g.setAttribute('iUV', new THREE.InstancedBufferAttribute(new Float32Array(uvs), 2));
    g.instanceCount = uvs.length / 2;
    const m = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: ARROW_VS, fragmentShader: ARROW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.arrows = new THREE.Mesh(g, m); this.arrows.frustumCulled = false; this.arrows.visible = false; this.arrows.renderOrder = 4;
    this.dyn.add(this.arrows);
    // arrow scale: largest true displacement over the stack → ~6 world units
    let mx = 1e-6;
    for (let k = 0; k < N * N; k += 7) { const d = trueDispK(sc, k, CFG.tMax); mx = Math.max(mx, Math.hypot(d[0], d[1], d[2])); }
    if (sc.kind === 'fault') mx = Math.max(mx, sc.site.fault.slip / 2);
    this.U.uArrowScale.value = 6 / mx;
  }
  buildGlacierFx(sc) {
    if (sc.kind !== 'glacier') return;
    const G = sc.glacier, N = sc.N, n = 2600;
    const pos = new Float32Array(n * 2 * 3), col = new Float32Array(n * 2 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    this.particles = new THREE.LineSegments(g, m); this.particles.frustumCulled = false; this.particles.renderOrder = 4;
    this.dyn.add(this.particles);
    const rnd = mulberry32(5);
    // spawn candidates weighted by speed
    const cand = [];
    for (let k = 0; k < N * N; k += 2) if (G.speed[k] > 0.4) cand.push(k);
    this.pState = { n, i: new Float32Array(n), j: new Float32Array(n), age: new Float32Array(n), life: new Float32Array(n), cand, rnd };
    for (let p = 0; p < n; p++) this.respawn(p, true);
    // icebergs in the fjord (mélange)
    const bergGeo = new THREE.IcosahedronGeometry(1, 0);
    const bergMat = new THREE.MeshStandardMaterial({ color: 0xdff4ff, emissive: 0x2a6f9a, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.05, flatShading: true });
    const nb = 420;
    this.bergs = new THREE.InstancedMesh(bergGeo, bergMat, nb);
    this.bergs.frustumCulled = false;
    const water = [];
    for (let k = 0; k < N * N; k++) if (sc.cover.water[k] && (k % N) > G.jf - 110) water.push(k);
    this.bergState = [];
    const r2 = mulberry32(17);
    for (let b = 0; b < nb; b++) {
      const k = water[(r2() * water.length) | 0] || 0;
      this.bergState.push({ i: ((k / N) | 0) + r2(), j: (k % N) + r2(), s: 0.12 + Math.pow(r2(), 3) * 0.55, rot: r2() * TAU, spin: (r2() - 0.5) * 0.2, born: -1, calved: b >= nb - 90 });
    }
    this.dyn.add(this.bergs);
  }
  respawn(p, initial) {
    const S = this.pState, sc = this.sc, N = sc.N;
    const k = S.cand[(S.rnd() * S.cand.length) | 0];
    S.i[p] = ((k / N) | 0) + S.rnd(); S.j[p] = (k % N) + S.rnd();
    S.life[p] = 2.5 + S.rnd() * 4; S.age[p] = initial ? S.rnd() * S.life[p] : 0;
  }
  buildSubsurface(sc) {
    const U = this.U;
    if (sc.kind === 'volcano') {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uGlow: { value: 1 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz; gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform float uTime; uniform float uGlow; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6); float p = 0.75 + 0.25*sin(uTime*3.0); vec3 c = mix(vec3(1.0,0.32,0.05), vec3(1.0,0.85,0.35), f) * (1.2 + f*2.0) * p * uGlow; gl_FragColor = vec4(c, 0.35 + 0.6*f); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.chamber = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), m);
      const p = sc.grid.ij2xz(sc.mogiSrc.i, sc.mogiSrc.j);
      this.chamber.position.set(p.x, U.uBaseY.value - 7, p.z);
      this.dyn.add(this.chamber);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([V3(p.x, U.uBaseY.value - 7, p.z), V3(p.x, (sc.emax - sc.eBase) * sc.yScale + 1.5, p.z)]);
      const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0xffb648, dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.8 }));
      line.computeLineDistances();
      this.chamberLine = line; this.dyn.add(line);
    }
    if (sc.kind === 'fault') {
      const F = sc.fault, p = sc.grid.ij2xz(F.i, F.j);
      const dir = V3(F.se, 0, -F.sn).normalize();
      const L = 150, D = 14;
      const geo = new THREE.PlaneGeometry(L, D, 1, 1);
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: U.uTime, uLock: { value: 0.6 }, uRup: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform float uTime; uniform float uRup; varying vec2 vUv; void main(){ float d = 1.0 - vUv.y; float lock = smoothstep(0.0, 0.08, d) * (1.0 - smoothstep(0.85, 1.0, d)); float stripes = 0.5 + 0.5*sin(vUv.x*180.0 - uTime*2.0); vec3 c = mix(vec3(1.0,0.55,0.15), vec3(1.0,0.2,0.08), d) * (0.4 + 0.3*stripes); c = mix(c, vec3(1.0,0.95,0.8)*2.0, uRup*exp(-d*3.0)); float edge = smoothstep(0.0,0.06,vUv.x)*smoothstep(1.0,0.94,vUv.x); gl_FragColor = vec4(c, 0.28*lock*edge + 0.25*uRup*edge); }',
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const plane = new THREE.Mesh(geo, m);
      plane.position.set(p.x, U.uBaseY.value - D / 2, p.z);
      plane.lookAt(plane.position.clone().add(V3(-dir.z, 0, dir.x)));
      this.faultPlane = plane; this.dyn.add(plane);
    }
  }

  // ───────────── CPU height of the displayed surface (picking, profiles, fences) ─────────────
  surfaceY(i, j, C) {
    const sc = this.sc, N = sc.N;
    const k = clamp(Math.floor(i), 0, N - 1) * N + clamp(Math.floor(j), 0, N - 1);
    const d = dispMeshK(sc, k, C);
    const gate = this.U.uUnwGate.value > 0.5 ? this.unwData[k * 4] / 255 : 1;
    return (sampleField(sc.dem, N, j, i) - sc.eBase) * sc.yScale + d[2] * gate * sc.yScale;
  }
  /** ray–heightfield intersection (world) */
  pick(ray, C) {
    const sc = this.sc; if (!sc) return null;
    const o = ray.origin, d = ray.direction;
    let t = 0, prev = null;
    const hw = CFG.W / 2;
    // enter the block's bounding box
    const tb = [];
    for (const [axis, lo, hi] of [['x', -hw, hw], ['z', -hw, hw]]) {
      if (Math.abs(d[axis]) < 1e-9) { if (o[axis] < lo || o[axis] > hi) return null; continue; }
      const t1 = (lo - o[axis]) / d[axis], t2 = (hi - o[axis]) / d[axis];
      tb.push([Math.min(t1, t2), Math.max(t1, t2)]);
    }
    let tmin = 0, tmax = 600;
    for (const [a, b] of tb) { tmin = Math.max(tmin, a); tmax = Math.min(tmax, b); }
    if (tmin > tmax) return null;
    const step = 0.25;
    for (t = tmin; t <= tmax; t += step) {
      const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
      const g = sc.grid.xz2ij(x, z);
      const h = this.surfaceY(g.i, g.j, C);
      if (y <= h) {
        let a = prev === null ? t - step : prev, b = t;
        for (let it = 0; it < 14; it++) {
          const m = (a + b) / 2, xm = o.x + d.x * m, zm = o.z + d.z * m, ym = o.y + d.y * m;
          const gm = sc.grid.xz2ij(xm, zm);
          if (ym <= this.surfaceY(gm.i, gm.j, C)) b = m; else a = m;
        }
        const x2 = o.x + d.x * b, z2 = o.z + d.z * b;
        const g2 = sc.grid.xz2ij(x2, z2);
        return { x: x2, z: z2, y: o.y + d.y * b, i: g2.i, j: g2.j };
      }
      prev = t;
    }
    return null;
  }
}
