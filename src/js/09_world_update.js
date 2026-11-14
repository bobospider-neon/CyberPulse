// ───────────────────────── 09 · WORLD · per-frame update ─────────────────────────
const MODE_CODE = { phase: 0, defo: 1, pol: 2, coh: 3 };
const _q = new THREE.Quaternion(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

World.prototype.trueWeights = function (t) {
  const sc = this.sc, w = basisW(sc, t), w0 = basisW(sc, 0), f = sc.flags;
  return [0, 1, 2, 3].map((b) => (f.mesh[b] && f.exag[b] ? w[b] - w0[b] : 0));
};

/** S: app state, C: time context (timeCtx) */
World.prototype.update = function (S, C, time, dt) {
  const sc = this.sc, U = this.U;
  if (!sc) return;
  U.uTime.value = time;
  U.uMW.value.set(...C.mw); U.uPW.value.set(...C.pw); U.uTW.value.set(...this.trueWeights(S.t));
  U.uLos.value.set(...C.geom.los);
  U.uPulse.value.set(C.pulseC, C.pulseR); U.uCalve.value.set(C.calveC, C.calveR);
  U.uEvCur.value.set(...C.evCur); U.uEvBetween.value.set(...C.evBetween);
  U.uApsW.value.set(...C.apsW); U.uStrat.value = C.strat; U.uApsOn.value = S.layers.aps ? 1 : 0;
  U.uNoiseW.value.set(...C.noiseW); U.uDt.value = C.dt;
  U.uMode.value = MODE_CODE[S.mode]; U.uBand.value = S.band === 'S' ? 1 : 0; U.uLensOn.value = S.band === 'X' ? 1 : 0;
  U.uFusion.value = S.geom === 'fusion' ? 1 : 0;
  U.uCycle.value = S.layers.cycle ? time * 1.4 : 0;
  // clock speed for the temporal anti-aliasing of the phase (a loop back to day 0 is not motion)
  const dDays = this._lastT === undefined ? 0 : Math.abs(S.t - this._lastT);
  this._lastT = S.t;
  U.uFrameDays.value = dDays > 30 ? 0 : lerp(U.uFrameDays.value, dDays, 0.3);
  U.uCohMask.value = S.layers.mask ? 0.25 : 0;
  U.uDefoRange.value = S.defoRange; U.uDefoStep.value = S.defoStep;
  if (sc.rupture) U.uRupt.value.x = sc.rupture.front;
  U.uGhost.value = S.band === 'L' ? 0.13 : 1.0;
  // with the real NISAR image on (13b_nisar.js) the simulated 3D objects step aside, so only real data is on the ground
  const sim = !Real.on;
  if (this.canopy) this.canopy.visible = S.layers.canopy && sim;
  if (this.arrows) this.arrows.visible = S.layers.vectors && sim;
  for (const o of [this.buildings, this.bergs, this.particles, this.fences]) if (o) o.visible = sim;
  // lens
  const lensOn = S.band === 'X';
  U.uLens.value.set(S.lens.x, S.lens.z, S.lens.r);
  this.lens.visible = lensOn;
  if (lensOn) {
    const g = sc.grid.xz2ij(S.lens.x, S.lens.z);
    const y0 = this.surfaceY(g.i, g.j, C);
    this.lens.position.set(S.lens.x, y0 - 0.6, S.lens.z);
    this.lens.scale.set(S.lens.r, 7.5, S.lens.r);
    this.lensMat.uniforms.uOpacity.value = lerp(this.lensMat.uniforms.uOpacity.value, 1, 0.1);
  }
  // subsurface
  const sub = S.layers.subsurface;
  if (this.chamber) {
    const dV = Math.max(0, basisW(sc, S.t)[0]);
    const r = 1.2 + 1.6 * Math.cbrt(dV / 90);
    this.chamber.scale.setScalar(r * (1 + 0.04 * Math.sin(time * 3)));
    this.chamber.visible = sub; this.chamberLine.visible = sub;
  }
  if (this.faultPlane) {
    this.faultPlane.visible = sub;
    const R = sc.rupture;
    this.faultPlane.material.uniforms.uRup.value = R.active ? 1 : Math.max(0, this.faultPlane.material.uniforms.uRup.value - dt * 0.6);
  }
  this.updateSats(S, C, time);
  if (this.particles) this.updateParticles(S, C, dt);
  if (this.bergs) this.updateBergs(S, C, time, dt);
};

World.prototype.updateSats = function (S, C, time) {
  const sc = this.sc, U = this.U;
  const active = S.geom === 'fusion' ? ['asc', 'desc'] : [S.geom];
  const groundY = (sc.emean - sc.eBase) * sc.yScale;
  let footprintSet = false;
  for (const sat of this.sats) {
    const on = active.includes(sat.kind) && S.view === 'terrain';
    sat.model.visible = on;
    for (const b of sat.beams) b.mesh.visible = on && S.layers.beam;
    if (!on) continue;
    const g = sc.geom[sat.kind];
    const los = V3(g.los[0], g.los[2], -g.los[1]).normalize();
    const along = V3(Math.sin(g.heading), 0, -Math.cos(g.heading)).normalize();
    const range = V3(-los.x, 0, -los.z).normalize();
    const H = 64, D = H / los.y;
    const s = S.satS * (sat.kind === 'desc' && S.geom === 'fusion' ? -1 : 1);
    const foot = V3(0, groundY, 0).addScaledVector(along, s);
    const pos = foot.clone().addScaledVector(los, D);
    sat.model.position.copy(pos);
    // orient: dish axis → footprint, body +Z → along track
    const A = foot.clone().sub(pos).normalize();
    const B = along.clone().addScaledVector(A, -along.dot(A)).normalize();
    const a = sat.model.userData.dishAxis, b = V3(0, 0, 1);
    _m1.makeBasis(a, b, a.clone().cross(b));
    _m2.makeBasis(A, B, A.clone().cross(B));
    _m2.multiply(_m1.transpose());
    sat.model.quaternion.setFromRotationMatrix(_m2);
    const ud = sat.model.userData;
    ud.setDeploy(S.deploy);
    ud.update(time, App.dt || 0.016, { camera: App.camera, sunDir: U.uSun.value, beam: S.layers.beam, onRcs: S.satCam ? () => Sound.rcs() : null });
    const apex = new THREE.Vector3(); ud.beamOrigin.getWorldPosition(apex);
    sat.pos.copy(apex);
    const halfLen = 8.5, halfW = 58;
    for (const bm of sat.beams) {
      const hl = halfLen * bm.widthK, hw = halfW * (0.94 + 0.06 * bm.widthK);
      const c = [
        foot.clone().addScaledVector(along, -hl).addScaledVector(range, -hw),
        foot.clone().addScaledVector(along, hl).addScaledVector(range, -hw),
        foot.clone().addScaledVector(along, hl).addScaledVector(range, hw),
        foot.clone().addScaledVector(along, -hl).addScaledVector(range, hw),
      ];
      const p = bm.mesh.geometry.attributes.position.array;
      for (let f = 0; f < 4; f++) {
        const c0 = c[f], c1 = c[(f + 1) % 4], o = f * 9;
        p[o] = apex.x; p[o + 1] = apex.y; p[o + 2] = apex.z;
        p[o + 3] = c0.x; p[o + 4] = c0.y; p[o + 5] = c0.z;
        p[o + 6] = c1.x; p[o + 7] = c1.y; p[o + 8] = c1.z;
      }
      bm.mesh.geometry.attributes.position.needsUpdate = true;
      bm.mesh.material.uniforms.uOpacity.value = S.beamOpacity * smoothstep(0.97, 1, S.deploy) * (bm.widthK > 0.9 ? 0.5 : 0.42);
    }
    if (!footprintSet) {
      U.uBeam.value.set(foot.x, foot.z, along.x, along.z);
      U.uBeam2.value.set(halfLen, halfW, -1 + 2 * fract(time * 0.55), S.layers.beam ? 1 : 0);
      footprintSet = true;
    }
  }
};

World.prototype.updateParticles = function (S, C, dt) {
  const sc = this.sc, G = sc.glacier, N = sc.N, P = this.pState, px = sc.grid.pixelM;
  const daysPerSec = S.playing ? 12 * S.speed : 3;
  const dd = Math.min(dt, 0.05) * daysPerSec;
  const pos = this.particles.geometry.attributes.position.array, col = this.particles.geometry.attributes.color.array;
  const trail = 18;                                  // days of motion drawn as a streak
  for (let p = 0; p < P.n; p++) {
    let i = P.i[p], j = P.j[p];
    const k = clamp(i | 0, 0, N - 1) * N + clamp(j | 0, 0, N - 1);
    const ve = G.vx[k], vn = G.vy[k], sp = G.speed[k];
    P.age[p] += dt;
    if (sp < 0.15 || P.age[p] > P.life[p] || sc.cover.water[k] > 0.5 || i < 1 || j < 1 || i > N - 2 || j > N - 2) { this.respawn(p, false); continue; }
    i -= vn * dd / px; j += ve * dd / px;
    P.i[p] = i; P.j[p] = j;
    const head = sc.grid.ij2xz(i, j);
    const ti = i + vn * trail / px, tj = j - ve * trail / px;
    const tail = sc.grid.ij2xz(ti, tj);
    const y = this.surfaceY(i, j, C) + 0.12, yt = this.surfaceY(ti, tj, C) + 0.12;
    const o = p * 6;
    pos[o] = head.x; pos[o + 1] = y; pos[o + 2] = head.z; pos[o + 3] = tail.x; pos[o + 4] = yt; pos[o + 5] = tail.z;
    const a = Math.min(1, P.age[p] / 0.6) * Math.min(1, (P.life[p] - P.age[p]) / 0.8);
    const f = clamp(Math.log10(1 + sp) / Math.log10(1 + G.vFront), 0, 1);
    const r = lerp(0.25, 1.0, f), g = lerp(0.85, 0.92, f), b = lerp(1.0, 0.55, f);
    col[o] = r * a * 0.85; col[o + 1] = g * a * 0.85; col[o + 2] = b * a * 0.85;
    col[o + 3] = r * a * 0.05; col[o + 4] = g * a * 0.05; col[o + 5] = b * a * 0.05;
  }
  this.particles.geometry.attributes.position.needsUpdate = true;
  this.particles.geometry.attributes.color.needsUpdate = true;
};

World.prototype.updateBergs = function (S, C, time, dt) {
  const sc = this.sc, N = sc.N, G = sc.glacier;
  const tCalve = sc.events[0] ? sc.events[0].t : Infinity;
  const calved = S.t >= tCalve;
  const m = _m1, q = _q, scl = V3(), pos = V3();
  const sizeK = 1.0 / sc.grid.mpu * 260;
  this.bergState.forEach((b, n) => {
    if (b.calved) {
      if (!calved) { m.makeScale(0, 0, 0); this.bergs.setMatrixAt(n, m); return; }
      if (b.born < 0) { b.born = time; b.i = G.cl[Math.min(N - 1, G.jf + 4)] + (Math.random() - 0.5) * 14; b.j = G.jf + 1 + Math.random() * 7; b.s = 0.35 + Math.random() * 0.7; }
    } else if (b.born >= 0) b.born = -1;
    b.j -= dt * (S.playing ? 0.35 * S.speed : 0.08);
    if (b.j < 2) b.j = G.jf - 2 - Math.random() * 6;
    const k = clamp(b.i | 0, 0, N - 1) * N + clamp(b.j | 0, 0, N - 1);
    if (sc.cover.water[k] < 0.5 && !(b.calved && calved)) { b.j = G.jf - 2 - Math.random() * 10; }
    const p = sc.grid.ij2xz(b.i, b.j);
    const grow = b.calved ? clamp((time - b.born) / 1.2, 0, 1) : 1;
    const s = b.s * sizeK * grow;
    pos.set(p.x, (0 - sc.eBase) * sc.yScale + 0.05 + Math.sin(time * 1.3 + n) * 0.03, p.z);
    q.setFromEuler(new THREE.Euler(0.2 * Math.sin(n), b.rot + time * b.spin * 0.1, 0.15 * Math.cos(n)));
    scl.set(s * 1.4, s * 0.7, s);
    m.compose(pos, q, scl);
    this.bergs.setMatrixAt(n, m);
  });
  this.bergs.instanceMatrix.needsUpdate = true;
};

// ── CCD alert fences (marching-squares outlines extruded as glowing walls) ──
World.prototype.buildFences = function (res, C) {
  if (this.fences) { this.dyn.remove(this.fences); this.fences.geometry.dispose(); this.fences = null; }
  if (!res || !res.comps.length) return;
  const sc = this.sc, P = [], A = [], I = [];
  const Hh = 1.6;
  for (const c of res.comps) {
    const s = c.segments;
    for (let q = 0; q < s.length; q += 4) {
      const a = sc.grid.ij2xz(s[q], s[q + 1]), b = sc.grid.ij2xz(s[q + 2], s[q + 3]);
      const ya = this.surfaceY(s[q], s[q + 1], C) + 0.05, yb = this.surfaceY(s[q + 2], s[q + 3], C) + 0.05;
      const n0 = P.length / 3;
      P.push(a.x, ya, a.z, b.x, yb, b.z, a.x, ya + Hh, a.z, b.x, yb + Hh, b.z);
      A.push(0, 0, 1, 1);
      I.push(n0, n0 + 1, n0 + 2, n0 + 2, n0 + 1, n0 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(A, 1));
  g.setIndex(I);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: this.U.uTime, uGrow: { value: 0 } },
    vertexShader: 'attribute float aH; varying float vH; void main(){ vH = aH; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uTime; uniform float uGrow; varying float vH; void main(){ if (vH > uGrow) discard; float a = (1.0 - vH) * (0.55 + 0.45*sin(uTime*7.0 - vH*8.0)); float top = exp(-pow((vH - uGrow*0.999)/0.04, 2.0)); gl_FragColor = vec4(vec3(1.0,0.22,0.08)*(1.6 + top*2.5), a*0.8 + top*0.8); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  this.fences = new THREE.Mesh(g, m); this.fences.frustumCulled = false; this.fences.renderOrder = 7;
  this.dyn.add(this.fences);
};

// ── cross-section curtain ──
World.prototype.buildCurtain = function (pts) {
  if (this.curtain) { this.dyn.remove(this.curtain); this.curtain.geometry.dispose(); this.curtain = null; }
  if (!pts) return;
  const P = [], T = [], I = [], base = this.U.uBaseY.value;
  pts.forEach((p, n) => { P.push(p.x, p.y + 0.03, p.z, p.x, base, p.z); T.push(n / (pts.length - 1), 1, n / (pts.length - 1), 0); });
  for (let n = 0; n < pts.length - 1; n++) { const a = n * 2; I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(T, 2));
  g.setIndex(I);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: this.U.uTime, uCursor: { value: -1 } },
    vertexShader: 'attribute vec2 aT; varying vec2 vT; void main(){ vT = aT; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float uTime; uniform float uCursor; varying vec2 vT; void main(){ float top = exp(-pow((1.0 - vT.y)/0.02, 2.0)); float scan = exp(-pow(fract(vT.y*3.0 + uTime*0.4) - 0.5, 2.0)*300.0); float cur = exp(-pow((vT.x - uCursor)/0.004, 2.0)); vec3 c = vec3(0.25,0.95,0.9); float a = 0.10 + 0.12*vT.y + top*0.9 + scan*0.15 + cur*0.9; gl_FragColor = vec4(c*(1.0 + top*1.5 + cur*2.0), a); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  this.curtain = new THREE.Mesh(g, m); this.curtain.frustumCulled = false; this.curtain.renderOrder = 8;
  this.dyn.add(this.curtain);
};
