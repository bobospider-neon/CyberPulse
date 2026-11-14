// ───────────────────────── 06 · GLSL (TERRAPULSE phase-to-mesh engine) ─────────────────────────
// The physics functions below are 1:1 twins of 04b_mirror.js / 02_physics.js.
const GLSL_COMMON = /* glsl */`
#define PI 3.14159265359
#define TAU 6.28318530718
const float LAM_L = 0.2384980;
const float LAM_S = 0.0936851;

uniform highp sampler2D uStatic;   // R elevation (m) · G canopy height (m) · B spill elevation (m) · A aux (ice speed m/d | water base m | coherence)
uniform highp sampler2D uB0;       // deformation bases: E, N, U (m per unit weight) · A water-level amplitude (m)
uniform highp sampler2D uB1;
uniform highp sampler2D uB2;
uniform highp sampler2D uB3;
uniform sampler2D uCover;          // R vegetation · G open water · B urban · A ice
uniform sampler2D uEvents;         // event masks
uniform sampler2D uUnw;            // R unwrapped flag · G unwrap order · B unwrapped LoS (norm.)
uniform float uN, uNB, uMpu, uYScale, uEBase, uEMean, uKind, uLooks, uLamC;
uniform vec4 uMW, uPW, uTW;        // mesh (exaggerated), phase, true-since-first-pass weights
uniform vec3 uLos;
uniform vec2 uPulse, uCalve;       // (current, reference)
uniform vec4 uEvCur, uEvBetween, uEvKind;
uniform vec4 uRupt;                // rupture front (m), width (m), fault scene flag
uniform vec4 uFault;               // fault point (world x, z), strike direction (world x, z)
uniform float uUnwGate;
uniform vec3 uCohL[6];
uniform vec3 uCohS[6];

float ruptM(vec2 xz) {
  if (uRupt.z < 0.5) return 1.0;
  float s = dot(xz - uFault.xy, uFault.zw) * uMpu;
  return smoothstep(uRupt.x - uRupt.y, uRupt.x + uRupt.y, s);
}
vec3 basisDisp(vec2 uv, vec2 xz, vec4 w) {
  vec3 d = vec3(0.0);
  if (uNB > 0.5) d += texture(uB0, uv).xyz * w.x;
  if (uNB > 1.5) d += texture(uB1, uv).xyz * (w.y * ruptM(xz));
  if (uNB > 2.5) d += texture(uB2, uv).xyz * w.z;
  if (uNB > 3.5) d += texture(uB3, uv).xyz * w.w;
  return d;
}
float isKind(float k) { return step(abs(uKind - k), 0.5); }
float floodedAt(vec4 st, vec2 uv, float pulse, float calve) {
  // branch-free (both lookups are cheap): wetlands use the water-surface pulse, the glacier uses sea level after calving
  float wse = st.a + texture(uB1, uv).a * pulse;
  float gz = st.r + texture(uB2, uv).z * calve;
  float fw = step(st.b, wse) * (1.0 - step(wse, st.r));
  float fg = step(st.b, 0.0) * (1.0 - step(0.0, gz));
  return isKind(3.0) * fw + isKind(2.0) * fg;
}
float losPhaseDisp(vec2 uv, vec2 xz, vec4 st, float veg) {
  float d = 0.0; vec4 b;
  if (uNB > 0.5) { b = texture(uB0, uv); d += uPW.x * dot(b.xyz, uLos); }
  if (uNB > 1.5) {
    b = texture(uB1, uv);
    float w1 = uPW.y * ruptM(xz);
    d += w1 * dot(b.xyz, uLos);
    if (b.a != 0.0) {
      float fl = min(floodedAt(st, uv, uPulse.x, uCalve.x), floodedAt(st, uv, uPulse.y, uCalve.y)) * veg;
      d += w1 * b.a * uLos.z * fl;
    }
  }
  if (uNB > 2.5) { b = texture(uB2, uv); d += uPW.z * dot(b.xyz, uLos); }
  if (uNB > 3.5) { b = texture(uB3, uv); d += uPW.w * dot(b.xyz, uLos); }
  return d;
}
struct Cov { float veg; float water; float urban; float ice; float flooded; float H; };
void applyEvent(inout Cov f, float on, float kind, float m) {
  if (on < 0.5 || m <= 0.01) return;
  if (kind < 1.5) f.veg *= 1.0 - 0.95 * m;
  else if (kind < 2.5) { f.veg *= 1.0 - 0.85 * m; f.H *= 1.0 - 0.8 * m; }
  else if (kind < 3.5) { f.ice *= 1.0 - m; f.water = max(f.water, m); }
}
Cov coverAt(vec2 uv, vec4 st, vec4 em) {
  vec4 c = texture(uCover, uv);
  Cov f; f.veg = c.r; f.water = c.g; f.urban = c.b; f.ice = c.a; f.H = st.g; f.flooded = 0.0;
  applyEvent(f, uEvCur.x, uEvKind.x, em.x);
  applyEvent(f, uEvCur.y, uEvKind.y, em.y);
  applyEvent(f, uEvCur.z, uEvKind.z, em.z);
  applyEvent(f, uEvCur.w, uEvKind.w, em.w);
  float fl = floodedAt(st, uv, uPulse.x, uCalve.x);
  if (isKind(3.0) > 0.5) f.flooded = fl * (1.0 - f.water);
  else if (isKind(2.0) > 0.5) f.water = max(f.water, fl);
  return f;
}
float cohC(vec3 p, float dt) { return p.y + (p.x - p.y) * exp(-abs(dt) / p.z); }
float coherence(Cov f, float flRef, float band, float dt, float speed, vec4 em, vec4 st) {
  if (isKind(5.0) > 0.5) return clamp(st.a, 0.02, 0.99);
  float fl = f.flooded;
  if (isKind(3.0) > 0.5) fl = min(fl, flRef);
  float wv = f.veg * (1.0 - fl), wf = f.veg * fl, ww = max(f.water, fl * (1.0 - f.veg)), wu = f.urban, wi = f.ice;
  float wb = max(0.0, 1.0 - (wv + wf + ww + wu + wi));
  float s = wb + wv + wf + ww + wu + wi;
  float iceF = 1.0 / (1.0 + pow(speed * abs(dt) / 35.0, 2.0));
  float g;
  if (band < 0.5) g = wb * cohC(uCohL[0], dt) + wv * cohC(uCohL[1], dt) + wf * cohC(uCohL[2], dt) + ww * cohC(uCohL[3], dt) + wu * cohC(uCohL[4], dt) + wi * cohC(uCohL[5], dt) * iceF;
  else            g = wb * cohC(uCohS[0], dt) + wv * cohC(uCohS[1], dt) + wf * cohC(uCohS[2], dt) + ww * cohC(uCohS[3], dt) + wu * cohC(uCohS[4], dt) + wi * cohC(uCohS[5], dt) * iceF;
  g /= s;
  g *= 1.0 - 0.93 * uEvBetween.x * smoothstep(0.1, 0.45, em.x);
  g *= 1.0 - 0.93 * uEvBetween.y * smoothstep(0.1, 0.45, em.y);
  g *= 1.0 - 0.93 * uEvBetween.z * smoothstep(0.1, 0.45, em.z);
  g *= 1.0 - 0.93 * uEvBetween.w * smoothstep(0.1, 0.45, em.w);
  return clamp(g, 0.02, 0.99);
}
float phaseSigma(float g) { g = clamp(g, 0.02, 0.999); return min(sqrt(1.0 - g * g) / (g * sqrt(2.0 * uLooks)), PI / sqrt(3.0)); }
float wrapPi(float x) { return x - TAU * floor((x + PI) / TAU); }
vec3 phaseCol(float phi) { float t = (phi + PI) / TAU; return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67))); }
vec3 divCol(float x) {
  x = clamp(x, -1.0, 1.0);
  vec3 mid = vec3(0.10, 0.13, 0.18);
  vec3 c = x < 0.0 ? vec3(0.12, 0.55, 1.0) : vec3(1.0, 0.42, 0.16);
  return mix(mid, c, pow(abs(x), 0.75));
}
vec3 cohCol(float g) {
  g = clamp(g, 0.0, 1.0);
  if (g < 0.5) return mix(vec3(0.10, 0.02, 0.10), vec3(0.02, 0.45, 0.52), g / 0.5);
  return mix(vec3(0.02, 0.45, 0.52), vec3(0.82, 0.98, 1.0), (g - 0.5) / 0.5);
}
float lin10(float d) { return pow(10.0, d / 10.0); }
float hvBio(float band, float agb) { return band < 0.5 ? (-27.0 + 15.0 * (1.0 - exp(-agb / 110.0))) : (-24.0 + 11.0 * (1.0 - exp(-agb / 40.0))); }
void classPol(float band, int c, float agb, out vec3 p, out float rho, out float ph) {
  float hv = hvBio(band, agb);
  if (c == 1) { if (band < 0.5) { p = vec3(hv + 6.0, hv, hv + 5.0); rho = 0.30; ph = 15.0; } else { p = vec3(hv + 5.0, hv, hv + 4.5); rho = 0.35; ph = 10.0; } return; }
  if (c == 2) { if (band < 0.5) { p = vec3(-1.5, hv, -6.5); rho = 0.60; ph = 175.0; } else { p = vec3(hv + 5.5, hv, hv + 4.5); rho = 0.35; ph = 30.0; } return; }
  if (band < 0.5) {
    if (c == 0) { p = vec3(-11.0, -26.0, -9.5); rho = 0.75; ph = 0.0; }
    else if (c == 3) { p = vec3(-24.0, -34.0, -19.0); rho = 0.90; ph = 0.0; }
    else if (c == 4) { p = vec3(-2.0, -14.0, -5.5); rho = 0.55; ph = 165.0; }
    else { p = vec3(-12.0, -23.0, -11.0); rho = 0.60; ph = 5.0; }
  } else {
    if (c == 0) { p = vec3(-10.0, -24.0, -8.5); rho = 0.70; ph = 0.0; }
    else if (c == 3) { p = vec3(-23.0, -32.0, -18.0); rho = 0.90; ph = 0.0; }
    else if (c == 4) { p = vec3(-1.5, -13.0, -4.5); rho = 0.55; ph = 160.0; }
    else { p = vec3(-9.0, -18.0, -9.0); rho = 0.50; ph = 5.0; }
  }
}
/** Freeman–Durden: returns (Pd, Pv, Ps, span) */
vec4 polFD(Cov f, float band, float bright, float tex, float hvj) {
  float fl = f.flooded;
  float w[6];
  w[1] = f.veg * (1.0 - fl); w[2] = f.veg * fl; w[3] = max(f.water, fl * (1.0 - f.veg)); w[4] = f.urban; w[5] = f.ice;
  w[0] = max(0.0, 1.0 - (w[1] + w[2] + w[3] + w[4] + w[5]));
  float s = w[0] + w[1] + w[2] + w[3] + w[4] + w[5];
  float agb = f.veg > 0.05 ? (f.H < 6.0 ? 12.0 + 4.0 * f.H : clamp(0.4 * f.H * f.H, 0.0, 650.0)) : 0.0;
  float C11 = 0.0, C22 = 0.0, C33 = 0.0, C13r = 0.0, C13i = 0.0;
  for (int c = 0; c < 6; c++) {
    float wc = w[c] / s;
    if (wc <= 0.0) continue;
    vec3 p; float rho; float ph;
    classPol(band, c, agb, p, rho, ph);
    float hh = lin10(p.x), hv = lin10(p.y), vv = lin10(p.z);
    float mag = rho * sqrt(hh * vv);
    C11 += wc * hh; C22 += wc * hv; C33 += wc * vv;
    C13r += wc * mag * cos(radians(ph)); C13i += wc * mag * sin(radians(ph));
  }
  float k = bright * tex;
  C11 *= k; C22 *= k * hvj; C33 *= k; C13r *= k; C13i *= k;
  float span = C11 + 2.0 * C22 + C33;
  float fv = min(3.0 * C22, min(C11, C33) * 0.999);
  float a = C11 - fv, b = C33 - fv, cr = C13r - fv / 3.0, ci = C13i;
  float Ps, Pd;
  if (cr >= 0.0) {
    float Xr = cr + b, Xi = ci, den = a + b + 2.0 * cr;
    float fs = den > 0.0 ? (Xr * Xr + Xi * Xi) / den : 0.0; fs = clamp(fs, 0.0, b);
    float fd = max(0.0, b - fs);
    float br = fs > 0.0 ? Xr / fs - 1.0 : 0.0, bi = fs > 0.0 ? Xi / fs : 0.0;
    Ps = fs * (1.0 + br * br + bi * bi); Pd = 2.0 * fd;
  } else {
    float Yr = cr - b, Yi = ci, den = a + b - 2.0 * cr;
    float fd = den > 0.0 ? (Yr * Yr + Yi * Yi) / den : 0.0; fd = clamp(fd, 0.0, b);
    float fs = max(0.0, b - fd);
    float ar = fd > 0.0 ? Yr / fd + 1.0 : 0.0, ai = fd > 0.0 ? Yi / fd : 0.0;
    Pd = fd * (1.0 + ar * ar + ai * ai); Ps = 2.0 * fs;
  }
  return vec4(Pd, 8.0 * fv / 3.0, Ps, span);
}
float brightLoc(vec3 nEnu) {
  float c = dot(nEnu, uLos);
  return c < 0.04 ? 0.03 : clamp(pow(c / uLos.z, 1.3), 0.05, 5.0);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

// ── terrain ──
const TERRAIN_VS = GLSL_COMMON + /* glsl */`
uniform float uFlat;
uniform float uCell;          // world size of one grid cell
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vNrm;            // true ENU terrain normal (radar brightness)
varying float vLosD;          // phase-relevant LoS displacement (m)
varying vec3 vDispT;          // true displacement since first pass (m, ENU)
varying float vStrain;
varying float vElev;
vec3 placed(vec2 uv, vec2 xz) {
  vec4 st = texture(uStatic, uv);
  float gate = mix(1.0, texture(uUnw, uv).r, uUnwGate);
  vec3 d = basisDisp(uv, xz, uMW) * gate;
  return vec3(xz.x + d.x / uMpu, (st.r - uEBase) * uYScale + d.z * uYScale, xz.y - d.y / uMpu);
}
void main() {
  vUv = uv;
  vec2 xz = position.xz;
  vec4 st = texture(uStatic, uv);
  vec3 P = placed(uv, xz);
  float du = 1.0 / uN;
  vec3 px1 = placed(uv + vec2(du, 0.0), xz + vec2(uCell, 0.0));
  vec3 px0 = placed(uv - vec2(du, 0.0), xz - vec2(uCell, 0.0));
  vec3 pz1 = placed(uv + vec2(0.0, du), xz + vec2(0.0, uCell));
  vec3 pz0 = placed(uv - vec2(0.0, du), xz - vec2(0.0, uCell));
  vNormal = normalize(cross(pz1 - pz0, px1 - px0));
  vStrain = max(length(px1.xz - px0.xz), length(pz1.xz - pz0.xz)) / (2.0 * uCell) - 1.0;
  // true ENU normal from the undeformed DEM (metres)
  float px_m = uCell * uMpu;
  float zl = texture(uStatic, uv - vec2(du, 0.0)).r, zr = texture(uStatic, uv + vec2(du, 0.0)).r;
  float zu = texture(uStatic, uv - vec2(0.0, du)).r, zd = texture(uStatic, uv + vec2(0.0, du)).r;
  vec2 g = vec2((zr - zl) / (2.0 * px_m), (zu - zd) / (2.0 * px_m));
  vNrm = normalize(vec3(-g.x, -g.y, 1.0));
  float veg = texture(uCover, uv).r;
  vLosD = losPhaseDisp(uv, xz, st, veg);
  vDispT = basisDisp(uv, xz, uTW);
  vElev = st.r;
  if (uFlat > 0.5) { P.y = 0.0; vNormal = vec3(0.0, 1.0, 0.0); }
  vec4 wp = modelMatrix * vec4(P, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TERRAIN_FS = GLSL_COMMON + /* glsl */`
uniform sampler2D uAPS;
uniform sampler2D uNoise;
uniform sampler2D uCCD;
uniform sampler2D uReal;      // real NISAR browse image cropped to the scene (13b_nisar.js), alpha = valid data
uniform float uRealOn;
uniform float uMode;          // 0 phase · 1 deformation · 2 polarimetry · 3 coherence
uniform float uBand;          // 0 L · 1 S
uniform float uLensOn;        // dual-band X-ray lens
uniform vec3 uLens;           // lens centre (x, z), radius
uniform float uDt;
uniform vec4 uApsW;
uniform float uStrat, uTurb, uStratK, uApsOn;
uniform vec4 uNoiseW;
uniform float uCycle;
uniform float uFrameDays;     // how far the clock moved since the last frame (days, smoothed)
uniform float uCohMask;
uniform float uDefoRange, uDefoStep, uFusion;
uniform vec3 uSun;
uniform float uTime;
uniform float uFlat;
uniform float uReveal;        // materialise radius (world)
uniform float uAcq;           // acquisition front along track (world)
uniform vec4 uBeam;           // footprint centre (x, z), along-track unit (x, z)
uniform vec4 uBeam2;          // half length, half width, sweep position (−1…1), on
uniform vec4 uHover;          // x, z, radius, on
uniform vec4 uSlice;          // x0, z0, x1, z1
uniform float uSliceOn;
uniform float uCCDOn, uCCDScan;
uniform float uUnwOn, uUnwFront, uUnwRange;
uniform vec3 uFogCol;
uniform float uGrid;          // world units between grid lines (5 km)
uniform float uEMin, uEMax;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vNrm;
varying float vLosD;
varying vec3 vDispT;
varying float vStrain;
varying float vElev;

float lineAA(float d, float w) { return 1.0 - smoothstep(0.0, w, d); }
vec3 radarView(float band, Cov f, float flRef, vec4 st, vec4 em, out float gOut, out float phiW) {
  float dt = uDt;
  float speed = isKind(2.0) * st.a;
  float g = coherence(f, flRef, band, dt, speed, em, st);
  gOut = g;
  float lam = isKind(5.0) > 0.5 ? uLamC : (band < 0.5 ? LAM_L : LAM_S);
  float atm = uApsOn * ((dot(texture(uAPS, vUv), uApsW)) * uTurb + uStrat * uStratK * (st.r - uEMean));
  vec4 nz = texture(uNoise, vUv) * 8.0 - 4.0;
  float phiT = 4.0 * PI / lam * (vLosD + atm);
  float phi = phiT + phaseSigma(g) * dot(nz, uNoiseW);
  phiW = wrapPi(phi);
  vec3 col;
  if (uMode < 0.5) {
    float w = wrapPi(phi + uCycle);
    col = phaseCol(w);
    float edge = smoothstep(0.86, 1.0, abs(w) / PI);
    col = col * 0.92 + edge * 0.30 * vec3(1.0, 0.95, 0.9);
    // display anti-aliasing: fringes denser than ~1 per screen pixel cannot be resolved → neutral tone (like multilooking)
    float alias = smoothstep(1.4, 3.0, fwidth(phiT));
    // the same in time: on fast ice (Jakobshavn, ~30 m/day) playback moves the phase by tens of radians per frame and the
    // colours flash at random; a real radar only samples every 12 days. Neutral while the clock runs, fringes when paused.
    float tAlias = smoothstep(0.8, 2.4, 4.0 * PI / lam * speed * uFrameDays);
    col = mix(col, vec3(0.30, 0.32, 0.36), max(alias, tAlias));
  } else if (uMode < 1.5) {
    float x = uFusion > 0.5 ? vDispT.z : dot(vDispT, uLos);
    if (uUnwOn > 0.5) { vec4 un = texture(uUnw, vUv); x = mix(x, (un.b * 2.0 - 1.0) * uUnwRange, step(0.5, un.r)); }
    col = divCol(x / uDefoRange);
    float q = x / uDefoStep;
    float dq = abs(fract(q + 0.5) - 0.5);
    float fw = max(fwidth(q), 1e-4);
    // contour lines every uDefoStep; the zero contour is skipped (it would flood motionless ground)
    col += lineAA(dq, fw * 1.4) * smoothstep(0.35, 0.65, abs(q)) * 0.55 * vec3(1.0, 0.92, 0.75);
  }
  if (uMode < 1.5 && uCohMask > 0.0) {
    float m = smoothstep(uCohMask - 0.05, uCohMask + 0.05, g);
    col = mix(vec3(0.075, 0.09, 0.11), col, m);
  }
  if (uMode < 1.5) {
  } else if (uMode < 2.5) {
    float tex = exp(0.18 * nz.y + 0.12 * nz.w), hvj = exp(0.11 * nz.z);
    vec4 fd = polFD(f, band, brightLoc(vNrm), tex, hvj);
    float m = max(max(fd.x, fd.y), max(fd.z, 1e-9));
    float br = clamp((10.0 * log(max(fd.w, 1e-12)) / log(10.0) + 25.0) / 22.0, 0.1, 1.0);
    col = vec3(fd.x, fd.y, fd.z) / m * br * 1.15;
    if (isKind(5.0) > 0.5) col = vec3(clamp((st.g + 25.0) / 25.0, 0.0, 1.0));
  } else {
    col = cohCol(g);
    float loss = max(max(uEvBetween.x * em.x, uEvBetween.y * em.y), max(uEvBetween.z * em.z, uEvBetween.w * em.w));
    loss = smoothstep(0.15, 0.5, loss);
    float flick = 0.75 + 0.25 * sin(uTime * 7.0 + hash12(floor(vUv * uN)) * 6.28);
    col = mix(col, vec3(1.0, 0.18, 0.06) * (1.4 + 0.8 * flick), loss);
  }
  return col;
}
void main() {
  vec2 uv = vUv;
  vec4 st = texture(uStatic, uv);
  vec4 em = texture(uEvents, uv);
  Cov f = coverAt(uv, st, em);
  float flRef = floodedAt(st, uv, uPulse.y, uCalve.y);
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  float diff = max(dot(N, normalize(uSun)), 0.0);
  float shade = uFlat > 0.5 ? 1.0 : 0.30 + 0.75 * diff;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float eN = clamp((vElev - uEMin) / max(uEMax - uEMin, 1.0), 0.0, 1.0);

  // dual-band lens: L-band inside, S-band outside
  float lensD = length(vWorld.xz - uLens.xy);
  float inLens = uLensOn * (1.0 - smoothstep(uLens.z - 0.18, uLens.z + 0.02, lensD));
  float band = uLensOn > 0.5 ? (inLens > 0.5 ? 0.0 : 1.0) : uBand;
  float g, phiW;
  vec3 data = radarView(band, f, flRef, st, em, g, phiW);

  vec3 baseCol = mix(vec3(0.035, 0.055, 0.085), vec3(0.20, 0.27, 0.34), eN);
  baseCol = mix(baseCol, vec3(0.70, 0.80, 0.90), f.ice * 0.55);
  float acq = uFlat > 0.5 ? 1.0 : smoothstep(uAcq + 1.5, uAcq - 1.5, dot(vWorld.xz, uBeam.zw));
  vec3 col = mix(baseCol * shade, data * (0.20 + 0.62 * shade), acq);

  // canopy shadow outside the lens (S-band sees the canopy, not the ground)
  if (uLensOn > 0.5) {
    col *= mix(1.0 - 0.45 * smoothstep(0.3, 0.9, f.veg), 1.0, inLens);
    vec3 soil = mix(vec3(0.42, 0.30, 0.16), vec3(0.75, 0.58, 0.32), shade);
    col = mix(col, mix(col, soil * shade, 0.35 * smoothstep(0.3, 0.9, f.veg)), inLens);
    float ring = exp(-pow((lensD - uLens.z) / 0.10, 2.0));
    float scan = smoothstep(0.95, 1.0, fract(lensD / uLens.z * 4.0 - uTime * 0.8)) * inLens;
    col += ring * mix(vec3(1.0, 0.70, 0.28), vec3(0.24, 0.90, 1.0), 0.5 + 0.5 * sin(atan(vWorld.z - uLens.y, vWorld.x - uLens.x) * 3.0 + uTime * 2.0)) * 1.1;
    col += scan * vec3(1.0, 0.75, 0.35) * 0.12;
  }

  // real NISAR browse image (not a simulation: the radar product itself), shaded by the DEM so the relief still reads
  if (uRealOn > 0.0) {
    vec4 rl = texture(uReal, uv);
    // same light scale as the simulated observables (data * (0.20 + 0.62 * shade)) so the bloom pass does not wash it out
    col = mix(col, rl.rgb * (0.16 + 0.56 * shade), rl.a * uRealOn);
  }
  // crack glow where the mesh is torn apart (coseismic rupture)
  col += isKind(1.0) * smoothstep(0.6, 2.5, vStrain) * vec3(1.0, 0.42, 0.10) * (0.9 + 0.35 * sin(uTime * 9.0));

  // change-detection overlay
  if (uCCDOn > 0.5) {
    vec4 cc = texture(uCCD, uv);
    float shown = step(uv.y, uCCDScan);
    float hot = cc.g * shown;
    float flick = 0.8 + 0.2 * sin(uTime * 8.0 + hash12(floor(uv * uN)) * 6.28);
    col = mix(col, vec3(1.0, 0.16, 0.05) * (1.5 + flick), hot * 0.92);
    col += cc.b * shown * vec3(1.0, 0.5, 0.2) * 0.25;
    col += exp(-pow((uv.y - uCCDScan) * uN / 2.5, 2.0)) * vec3(1.0, 0.35, 0.2) * 1.4 * step(uCCDScan, 0.999);
  }
  // unwrapping front
  if (uUnwOn > 0.5) {
    vec4 un = texture(uUnw, uv);
    float front = un.r * exp(-pow((uUnwFront - un.g) / 0.015, 2.0));
    col += front * vec3(0.30, 1.0, 0.85) * 0.8;
    col = mix(col * 0.55, col, max(un.r, step(uUnwFront, 0.999) < 0.5 ? 1.0 : 0.0));
  }
  // SweepSAR footprint
  if (uBeam2.w > 0.5 && uFlat < 0.5) {
    vec2 rel = vWorld.xz - uBeam.xy;
    float a = dot(rel, uBeam.zw);
    float r = dot(rel, vec2(-uBeam.w, uBeam.z));
    float inA = 1.0 - smoothstep(uBeam2.x - 0.6, uBeam2.x, abs(a));
    float sweep = exp(-pow((r - uBeam2.z * uBeam2.y) / 0.9, 2.0)) * inA;
    float edge = exp(-pow((abs(a) - uBeam2.x) / 0.25, 2.0)) * step(abs(r), uBeam2.y);
    col += sweep * vec3(1.0, 0.78, 0.40) * 0.32 + edge * vec3(0.3, 0.9, 1.0) * 0.22;
  }
  // grid & hover reticle & slice
  if (uFlat < 0.5) {
    vec2 gq = vWorld.xz / uGrid;
    vec2 gd = abs(fract(gq + 0.5) - 0.5) / fwidth(gq);
    float grid = 1.0 - min(min(gd.x, gd.y), 1.0);
    col += grid * 0.05 * vec3(0.5, 0.8, 1.0);
    col += rim * 0.18 * vec3(0.3, 0.7, 1.0);
  }
  if (uHover.w > 0.5) {
    float hd = length(vWorld.xz - uHover.xy);
    col += exp(-pow((hd - uHover.z) / 0.06, 2.0)) * vec3(1.0, 0.95, 0.85) * 1.6;
    col += exp(-pow(hd / 0.09, 2.0)) * vec3(1.0) * 1.2;
  }
  if (uSliceOn > 0.5) {
    vec2 a = uSlice.xy, b = uSlice.zw, p = vWorld.xz;
    vec2 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(p - (a + t * ab));
    col += exp(-pow(d / 0.12, 2.0)) * vec3(0.4, 1.0, 0.95) * 1.8;
  }
  // materialise
  float rd = length(vWorld.xz);
  if (rd > uReveal) discard;
  col += exp(-pow((rd - uReveal) / 0.7, 2.0)) * vec3(0.4, 0.95, 1.0) * 2.5 * step(uReveal, 140.0);
  if (uFlat < 0.5) {
    float fog = smoothstep(120.0, 320.0, length(vWorld - cameraPosition));
    col = mix(col, uFogCol, fog);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── water (flood under the canopy, fjord, sea) ──
const WATER_VS = GLSL_COMMON + /* glsl */`
varying vec2 vUv; varying vec3 vWorld; varying float vDepth; varying float vVis;
void main() {
  vUv = uv;
  vec4 st = texture(uStatic, uv);
  vec3 d = basisDisp(uv, position.xz, uMW);
  float wse = isKind(3.0) > 0.5 ? st.a + texture(uB1, uv).a * uPulse.x : 0.0;
  float groundTrue = st.r + (isKind(2.0) > 0.5 ? texture(uB2, uv).z * uCalve.x : 0.0);
  float fl = floodedAt(st, uv, uPulse.x, uCalve.x);
  vVis = fl;
  vDepth = wse - groundTrue;
  float yG = (st.r - uEBase) * uYScale + d.z * uYScale;
  float yW = max((wse - uEBase) * uYScale, yG + 0.04);
  vec4 wp = modelMatrix * vec4(position.x + d.x / uMpu, yW, position.z - d.y / uMpu, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const WATER_FS = GLSL_COMMON + /* glsl */`
uniform float uTime, uLensOn, uBand, uMode, uReveal;
uniform vec3 uLens; uniform vec3 uSun; uniform vec3 uFogCol;
varying vec2 vUv; varying vec3 vWorld; varying float vDepth; varying float vVis;
void main() {
  if (vVis < 0.5 || length(vWorld.xz) > uReveal) discard;
  float veg = texture(uCover, vUv).r;
  vec4 em = texture(uEvents, vUv);
  float lensD = length(vWorld.xz - uLens.xy);
  float inLens = uLensOn * (1.0 - smoothstep(uLens.z - 0.18, uLens.z + 0.02, lensD));
  float under = smoothstep(0.35, 0.8, veg);                  // water hidden below the canopy
  float seen = uLensOn > 0.5 ? max(inLens, 1.0 - under) : (uBand < 0.5 ? 1.0 : 1.0 - under);
  if (seen < 0.02) discard;
  vec2 q = vWorld.xz * 1.7;
  float rip = sin(q.x * 1.3 + uTime * 1.6) * sin(q.y * 1.1 - uTime * 1.2) + 0.5 * sin((q.x + q.y) * 2.3 + uTime * 2.1);
  vec3 n = normalize(vec3(rip * 0.06, 1.0, rip * 0.05));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  float spec = pow(max(dot(reflect(-normalize(uSun), n), V), 0.0), 60.0);
  float depth = clamp(vDepth / 3.0, 0.0, 1.0);
  vec3 deep = mix(vec3(0.02, 0.10, 0.20), vec3(0.01, 0.04, 0.10), depth);
  vec3 col = deep + fres * vec3(0.25, 0.55, 0.85) + spec * vec3(1.0, 0.9, 0.7);
  // under-canopy water inside the lens: electric blue, double-bounce sparkle
  float db = under * inLens;
  vec2 sc = vWorld.xz * 9.0, cell = floor(sc);
  float sparkle = step(0.988, hash12(cell + floor(uTime * 5.0))) * smoothstep(0.42, 0.1, length(fract(sc) - 0.5));
  col = mix(col, vec3(0.06, 0.38, 0.85) * (0.85 + 0.25 * sin(uTime * 3.0 + vWorld.x)), db * 0.6);
  col += db * sparkle * vec3(1.0, 0.45, 0.35) * 1.6;
  // open water is opaque; water standing under vegetation is see-through, so the radar colours of the
  // flooded canopy (double bounce, water-level fringes) stay readable — with glints inside the X-ray lens
  float a = mix(mix(0.82, 0.92, depth), 0.22 + 0.55 * sparkle * inLens, under) * seen;
  col = mix(col, uFogCol, smoothstep(120.0, 320.0, length(vWorld - cameraPosition)));
  gl_FragColor = vec4(col, a);
}
`;

// ── canopy volume scatterers (point cloud) ──
const CANOPY_VS = GLSL_COMMON + /* glsl */`
attribute vec4 aPt;           // u, v, height fraction, random
uniform float uCanopyVE, uPtSize, uTime;
uniform vec3 uLens; uniform float uLensOn;
varying float vA; varying vec3 vCol; varying float vRim;
void main() {
  vec2 uv = aPt.xy;
  vec2 cell = (floor(uv * uN) + 0.5) / uN;
  vec4 st = texture(uStatic, cell);
  vec4 em = texture(uEvents, cell);
  Cov f = coverAt(cell, st, em);
  float W = ${CFG.W.toFixed(1)};
  vec2 xz = (uv - 0.5) * W;
  vec3 d = basisDisp(cell, xz, uMW);
  float ground = (st.r - uEBase) * uYScale + d.z * uYScale;
  float H = f.H * step(0.18, f.veg);
  float sway = sin(uTime * 1.3 + aPt.w * 40.0) * 0.012;
  vec3 P = vec3(xz.x + d.x / uMpu + sway, ground + (0.22 + 0.78 * aPt.z) * H * uCanopyVE * uYScale + 0.02, xz.y - d.y / uMpu);
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  gl_Position = projectionMatrix * mv;
  float lensD = length(P.xz - uLens.xy);
  float inLens = uLensOn * (1.0 - smoothstep(uLens.z - 0.12, uLens.z + 0.05, lensD));
  vRim = uLensOn * exp(-pow((lensD - uLens.z) / 0.22, 2.0));
  vA = H > 0.5 ? (1.0 - inLens) : 0.0;
  float tone = 0.55 + 0.45 * aPt.z;
  vCol = mix(vec3(0.05, 0.42, 0.26), vec3(0.35, 1.0, 0.62), tone) * (0.7 + 0.3 * aPt.w);
  if (f.flooded > 0.5) vCol = mix(vCol, vec3(0.2, 0.9, 0.85), 0.25);
  gl_PointSize = clamp(uPtSize * (0.75 + 0.6 * aPt.w) * 200.0 / -mv.z, 1.0, 5.5);
}
`;
const CANOPY_FS = /* glsl */`
uniform float uGhost;
varying float vA; varying vec3 vCol; varying float vRim;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  float a = vA * uGhost * (1.0 - r * 2.2);
  vec3 col = vCol * 0.85 + vRim * vec3(1.0, 0.75, 0.3) * 1.1;
  a = max(a, vRim * 0.75 * (1.0 - r * 3.0));
  if (a < 0.02) discard;
  gl_FragColor = vec4(col, a);
}
`;

// ── city blocks (instanced) ──
const BUILD_VS = GLSL_COMMON + /* glsl */`
attribute vec2 iUV;
attribute vec3 iSize;         // width, depth, height (world)
attribute float iRot;
attribute float iSeed;
attribute float iEvent;
uniform float uTiltGain;
varying vec3 vLocal; varying vec3 vN; varying float vRisk; varying float vSeed; varying float vCollapsed; varying vec3 vWorld;
void main() {
  float W = ${CFG.W.toFixed(1)};
  vec2 xz = (iUV - 0.5) * W;
  vec2 cell = (floor(iUV * uN) + 0.5) / uN;
  vec4 st = texture(uStatic, cell);
  float du = 1.0 / uN;
  vec3 d = basisDisp(cell, xz, uMW);
  // differential settlement → tilt (exaggerated mesh), risk from the true 10-year angular distortion
  float ux1 = basisDisp(cell + vec2(du, 0.0), xz, uMW).z, ux0 = basisDisp(cell - vec2(du, 0.0), xz, uMW).z;
  float uz1 = basisDisp(cell + vec2(0.0, du), xz, uMW).z, uz0 = basisDisp(cell - vec2(0.0, du), xz, uMW).z;
  float cellM = W / uN * uMpu;
  vec2 grad = vec2(ux1 - ux0, uz1 - uz0) / (2.0 * cellM);
  vec4 b1 = texture(uB0, cell + vec2(du, 0.0)), b0 = texture(uB0, cell - vec2(du, 0.0));
  vec4 c1 = texture(uB0, cell + vec2(0.0, du)), c0 = texture(uB0, cell - vec2(0.0, du));
  vec2 rate = vec2(b1.z - b0.z, c1.z - c0.z) / (2.0 * cellM);
  vRisk = length(rate) * 10.0 * 500.0;              // β(10 yr) / (1/500)
  float collapsed = (iEvent > -0.5 && uEvCur.x > 0.5) ? 1.0 : 0.0;
  vCollapsed = collapsed;
  vec3 p = position;
  float h = iSize.z * mix(1.0, 0.16 + 0.1 * iSeed, collapsed);
  p = vec3(p.x * iSize.x, p.y * h, p.z * iSize.y);
  float cr = cos(iRot), sr = sin(iRot);
  p.xz = mat2(cr, -sr, sr, cr) * p.xz;
  vec2 tilt = clamp(grad * uYScale * uMpu * uTiltGain, -0.35, 0.35) + collapsed * (vec2(iSeed, fract(iSeed * 7.3)) - 0.5) * 0.5;
  float ax = -tilt.y, az = tilt.x;
  p = vec3(p.x, p.y * cos(ax) - p.z * sin(ax), p.y * sin(ax) + p.z * cos(ax));
  p = vec3(p.x * cos(az) - p.y * sin(az), p.x * sin(az) + p.y * cos(az), p.z);
  float ground = (st.r - uEBase) * uYScale + d.z * uYScale;
  vec3 P = vec3(xz.x + d.x / uMpu, ground, xz.y - d.y / uMpu) + p;
  vLocal = vec3(position.x, position.y, position.z);
  vN = normal;
  vSeed = iSeed;
  vec4 wp = modelMatrix * vec4(P, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BUILD_FS = /* glsl */`
uniform float uTime; uniform vec3 uFogCol; uniform float uReveal;
varying vec3 vLocal; varying vec3 vN; varying float vRisk; varying float vSeed; varying float vCollapsed; varying vec3 vWorld;
void main() {
  if (length(vWorld.xz) > uReveal) discard;
  vec3 risk = vRisk < 0.5 ? mix(vec3(0.15, 0.95, 0.65), vec3(1.0, 0.75, 0.25), vRisk / 0.5) : mix(vec3(1.0, 0.75, 0.25), vec3(1.0, 0.18, 0.12), clamp((vRisk - 0.5) / 0.5, 0.0, 1.0));
  vec3 e = abs(vLocal - vec3(0.0, 0.5, 0.0)) * 2.0;     // 0 at centre, 1 at faces
  float second = max(min(e.x, e.y), min(max(e.x, e.y), e.z));   // two coordinates near a face → an edge
  float edge = smoothstep(0.86, 0.97, second);
  float wall = 1.0 - step(0.9, abs(vN.y));
  vec2 wuv = vec2(vLocal.x + vLocal.z, vLocal.y) * vec2(9.0, 14.0);
  float win = step(0.55, fract(wuv.x)) * step(0.45, fract(wuv.y)) * step(0.62, fract(sin(dot(floor(wuv), vec2(12.9898, 78.233)) + vSeed * 91.0) * 43758.5));
  vec3 col = vec3(0.035, 0.05, 0.075) + wall * win * vec3(1.0, 0.82, 0.55) * 0.55;
  col += edge * risk * 1.25;
  col += (1.0 - wall) * risk * 0.18;
  if (vCollapsed > 0.5) col = mix(col, vec3(1.0, 0.25, 0.08) * (1.2 + 0.4 * sin(uTime * 6.0 + vSeed * 20.0)), 0.6);
  col = mix(col, uFogCol, smoothstep(120.0, 320.0, length(vWorld - cameraPosition)));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── 3D displacement arrows (instanced) ──
const ARROW_VS = GLSL_COMMON + /* glsl */`
attribute vec2 iUV;
uniform float uArrowScale;
varying vec3 vCol; varying float vA;
void main() {
  float W = ${CFG.W.toFixed(1)};
  vec2 xz = (iUV - 0.5) * W;
  vec2 cell = (floor(iUV * uN) + 0.5) / uN;
  vec4 st = texture(uStatic, cell);
  vec3 dm = basisDisp(cell, xz, uMW);
  vec3 dt = basisDisp(cell, xz, uTW);               // true metres (E, N, U)
  vec3 v = vec3(dt.x, dt.z, -dt.y);                  // world axes
  float L = length(v) * uArrowScale;
  vA = smoothstep(0.05, 0.4, L);
  vec3 dir = L > 1e-5 ? normalize(v) : vec3(0.0, 1.0, 0.0);
  vec3 up = abs(dir.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 X = normalize(cross(up, dir)), Z = cross(X, dir);
  vec3 p = position;
  float len = max(L, 0.001);
  vec3 local = X * p.x * 0.9 + dir * p.y * len + Z * p.z * 0.9;
  float ground = (st.r - uEBase) * uYScale + dm.z * uYScale;
  vec3 P = vec3(xz.x + dm.x / uMpu, ground + 0.45, xz.y - dm.y / uMpu) + local;
  vCol = dt.z >= 0.0 ? mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.35, 0.15), clamp(dt.z / max(length(dt), 1e-6), 0.0, 1.0)) : mix(vec3(0.4, 0.9, 1.0), vec3(0.25, 0.5, 1.0), clamp(-dt.z / max(length(dt), 1e-6), 0.0, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
}
`;
const ARROW_FS = /* glsl */`
varying vec3 vCol; varying float vA;
void main() { if (vA < 0.02) discard; gl_FragColor = vec4(vCol * 1.4, vA); }
`;

// ── terrain block walls (cut-away strata) ──
const SKIRT_VS = GLSL_COMMON + /* glsl */`
attribute float aTop;          // 1 = follows the surface, 0 = base
uniform float uBaseY;
varying float vDepthM; varying vec3 vWorld; varying float vTop;
void main() {
  vec4 st = texture(uStatic, uv);
  vec3 d = basisDisp(uv, position.xz, uMW);
  float ys = (st.r - uEBase) * uYScale + d.z * uYScale;
  float y = aTop > 0.5 ? ys : uBaseY;
  vec3 P = vec3(position.x + (aTop > 0.5 ? d.x / uMpu : 0.0), y, position.z - (aTop > 0.5 ? d.y / uMpu : 0.0));
  vDepthM = (ys - y);
  vTop = aTop;
  vec4 wp = modelMatrix * vec4(P, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SKIRT_FS = /* glsl */`
uniform vec3 uStrataA; uniform vec3 uStrataB; uniform float uTime; uniform float uReveal; uniform float uBaseY;
varying float vDepthM; varying vec3 vWorld; varying float vTop;
void main() {
  if (length(vWorld.xz) > uReveal + 2.0) discard;
  // With MSAA a varying is extrapolated when the pixel centre lies outside the triangle. On a wall seen edge-on the
  // extrapolated depth can become hugely negative, and exp(-depth) then overflows the HDR buffer (a white bloom blob).
  float dm = max(vDepthM, 0.0);
  float band = sin(dm * 3.2 + sin(vWorld.x * 0.15 + vWorld.z * 0.13) * 1.4);
  vec3 col = mix(uStrataA, uStrataB, 0.5 + 0.5 * band) * (0.35 + 0.65 * smoothstep(-6.0, 0.0, -dm));
  col += exp(-dm * 6.0) * vec3(0.4, 0.9, 1.0) * 0.9;
  float sy = fract(vWorld.y * 0.4 - uTime * 0.25) - 0.5;
  float scan = exp(-sy * sy * 400.0);
  col += scan * vec3(0.3, 0.8, 1.0) * 0.12;
  float by = (vWorld.y - uBaseY) / 0.08;
  col += exp(-by * by) * vec3(0.3, 0.85, 1.0) * 0.8;
  gl_FragColor = vec4(min(col, vec3(3.0)), 0.94);
}
`;

// ── NISAR radar beam (volumetric fan) ──
const BEAM_VS = /* glsl */`
attribute float aT; attribute float aS;
varying float vT; varying float vS; varying vec3 vWorld;
void main() { vT = aT; vS = aS; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const BEAM_FS = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uSpeed;
varying float vT; varying float vS; varying vec3 vWorld;
void main() {
  // MSAA extrapolates varyings on a face seen edge-on. Unclamped, pow(|vS|, 6) reached thousands and the whole beam
  // flashed for one frame whenever the camera crossed the plane of a beam face.
  float t = clamp(vT, 0.0, 1.0), s = min(abs(vS), 1.0);
  float pulses = pow(0.5 + 0.5 * sin((t * 9.0 - uTime * uSpeed) * 3.14159), 70.0);
  float edge = pow(s, 6.0);
  float a = (0.025 + 0.32 * pulses * (0.3 + 0.7 * t) + 0.18 * edge) * uOpacity * smoothstep(0.0, 0.06, t) * (1.0 - 0.55 * smoothstep(0.8, 1.0, t));
  gl_FragColor = vec4(uColor * (0.85 + pulses * 0.9), min(a, 0.6));
}
`;

// ── holographic lens cylinder ──
const LENS_VS = /* glsl */`
varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
void main() { vUv = uv; vN = normalize(normalMatrix * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }
`;
const LENS_FS = /* glsl */`
uniform float uTime; uniform float uOpacity;
varying vec2 vUv; varying vec3 vN; varying vec3 vWorld;
void main() {
  float y = vUv.y;
  float lines = smoothstep(0.92, 1.0, fract(y * 14.0 - uTime * 0.9));
  float hexes = smoothstep(0.85, 1.0, abs(sin(vUv.x * 120.0)) * abs(sin(y * 40.0 + uTime)));
  float fade = (1.0 - y) * (1.0 - y);
  vec3 c = mix(vec3(1.0, 0.72, 0.30), vec3(0.25, 0.92, 1.0), y);
  float a = (0.03 + 0.20 * lines + 0.04 * hexes) * fade * uOpacity;
  gl_FragColor = vec4(c * 0.9, a);
}
`;

// ── sky: stars + nebula ──
const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const SKY_FS = /* glsl */`
uniform float uTime;
varying vec3 vDir;
float h13(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1,0,0)), f.x), mix(h13(i + vec3(0,1,0)), h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i + vec3(0,0,1)), h13(i + vec3(1,0,1)), f.x), mix(h13(i + vec3(0,1,1)), h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float n = fbm(d * 2.2 + vec3(0.0, 0.0, uTime * 0.004));
  float n2 = fbm(d * 4.5 - 3.0);
  vec3 neb = mix(vec3(0.015, 0.02, 0.05), vec3(0.06, 0.03, 0.10), smoothstep(0.45, 0.8, n)) + vec3(0.0, 0.04, 0.07) * smoothstep(0.55, 0.85, n2);
  neb += vec3(0.10, 0.06, 0.02) * pow(max(dot(d, normalize(vec3(0.6, 0.3, -0.7))), 0.0), 12.0);
  vec3 col = neb;
  vec3 g = d * 280.0; vec3 id = floor(g); float hs = h13(id);
  if (hs > 0.985) { vec3 c = fract(g) - 0.5; float s = exp(-dot(c, c) * 40.0); float tw = 0.6 + 0.4 * sin(uTime * (1.0 + hs * 3.0) + hs * 50.0); col += s * tw * mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.6), fract(hs * 13.0)) * 1.8; }
  vec3 g2 = d * 90.0; float h2 = h13(floor(g2));
  if (h2 > 0.993) { vec3 c = fract(g2) - 0.5; col += exp(-dot(c, c) * 60.0) * vec3(1.0) * 2.4; }
  gl_FragColor = vec4(col, 1.0);
}
`;

// ── final post pass ──
const POST_FS = /* glsl */`
uniform sampler2D tDiffuse;
uniform float uTime, uWarp, uFlash, uCA, uVig, uGrain;
uniform vec2 uRes;
varying vec2 vUv;
float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv, c = uv - 0.5;
  float r = length(c);
  vec3 col;
  if (uWarp > 0.001) {
    vec3 acc = vec3(0.0); float wsum = 0.0;
    for (int i = 0; i < 10; i++) { float t = float(i) / 9.0; float s = 1.0 - uWarp * 0.12 * t; float w = 1.0 - t * 0.6; acc += texture2D(tDiffuse, 0.5 + c * s).rgb * w; wsum += w; }
    col = acc / wsum;
  } else col = texture2D(tDiffuse, uv).rgb;
  float ca = (uCA + uWarp * 0.012) * r;
  if (ca > 0.0001) { col.r = texture2D(tDiffuse, 0.5 + c * (1.0 + ca)).r; col.b = texture2D(tDiffuse, 0.5 + c * (1.0 - ca)).b; }
  col *= 1.0 - uVig * smoothstep(0.35, 0.85, r);
  col += (rnd(uv * uRes + uTime) - 0.5) * uGrain;
  col = mix(col, vec3(0.85, 0.97, 1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
}
`;
const POST_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
