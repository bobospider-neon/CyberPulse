// ───────────────────────── 03 · THE FOUR EARTH WALTZES (site catalogue) ─────────────────────────
const WALTZES = [
  {
    n: 'I', key: 'tectonic', title: 'Tectonic & Volcanic Waltz',
    blurb: 'Magma swells a volcano. A locked fault stores a century of strain and releases it in seconds.',
    sites: ['rainier', 'carrizo'],
  },
  {
    n: 'II', key: 'cryo', title: 'Cryosphere Waltz',
    blurb: 'The ice moves faster than fringes can follow, so NISAR tracks the speckle itself.',
    sites: ['jakobshavn'],
  },
  {
    n: 'III', key: 'water', title: 'Waters & Forests Waltz',
    blurb: 'L-band slips through the canopy and reaches the water underneath. S-band stops at the leaves.',
    sites: ['atchafalaya', 'danube'],
  },
  {
    n: 'IV', key: 'anthro', title: 'Anthropogenic Waltz',
    blurb: 'Pumping groundwater makes a megacity sink by tens of centimetres a year.',
    sites: ['mexico'],
  },
];

const SITES = {
  rainier: {
    id: 'rainier', waltz: 0, kind: 'volcano', seed: 11,
    name: 'Mount Rainier', region: 'Washington, USA', tag: 'Magma-recharge drill · Mogi source',
    ve: 1.35, canopyVE: 7, exag: 1500, inc: { asc: 36.5, desc: 41.5 },
    aps: { turb: 0.007, strat: 7e-6 },
    mogi: { lat: 46.8529, lon: -121.7604, depth: 6000 },
    poi: { lat: 46.8420, lon: -121.7930 },
    ref: { lat: 46.7050, lon: -121.5400 },
    cam: { pos: [-82.8, 72, 126], target: [0, 4, 2] },
    labels: [
      { name: 'Columbia Crest · 4,392 m', lat: 46.8529, lon: -121.7604, kind: 'peak' },
      { name: 'Emmons Glacier', lat: 46.875, lon: -121.715 },
      { name: 'Nisqually Glacier', lat: 46.815, lon: -121.742 },
      { name: 'Carbon Glacier', lat: 46.895, lon: -121.770 },
      { name: 'Tahoma Creek', lat: 46.795, lon: -121.850 },
      { name: 'Paradise', lat: 46.786, lon: -121.735 },
    ],
    event: { kind: 'debris', t: 228, name: 'Debris flow · Tahoma Creek', start: { lat: 46.833, lon: -121.818 } },
    story: {
      title: 'Mount Rainier', sub: 'Magma-recharge drill · simulated unrest',
      text: 'USGS rates Rainier the most hazardous volcano in the Cascades, because its glaciers can turn into lahars. In this drill a <b>Mogi source 6 km down</b> takes in up to 9×10⁷ m³ of magma in 11 months. The summit rises about 60 cm, so each new fringe ring means another <b>11.9 cm (L)</b> or <b>4.7 cm (S)</b> of uplift. On day 228 a debris flow in Tahoma Creek erases coherence: press <b>RUN CCD</b>.',
    },
  },
  carrizo: {
    id: 'carrizo', waltz: 0, kind: 'fault', seed: 23,
    name: 'San Andreas Fault', region: 'Carrizo Plain, California', tag: 'Interseismic loading · Mw 7.9 rupture',
    ve: 2.2, canopyVE: 1, exag: 1200, inc: { asc: 37.5, desc: 40.5 },
    aps: { turb: 0.006, strat: 4e-6 },
    fault: { lat: 35.2710, lon: -119.8270, strike: 319, V: 0.034, D: 15000, slip: 6.0, since: 1857, length: 350000, mu: 3.0e10 },
    poi: { lat: 35.3000, lon: -119.7900 },
    ref: { lat: 35.1200, lon: -119.9600 },
    cam: { pos: [-111.6, 79.2, -86.4], target: [0, 1, 0] },
    labels: [
      { name: 'San Andreas Fault', lat: 35.333, lon: -119.903, kind: 'fault' },
      { name: 'Wallace Creek', lat: 35.2710, lon: -119.8270 },
      { name: 'Temblor Range', lat: 35.330, lon: -119.700 },
      { name: 'Carrizo Plain', lat: 35.200, lon: -119.870 },
      { name: 'Caliente Range', lat: 35.090, lon: -119.840 },
    ],
    event: { kind: 'rupture', t: Infinity, name: 'Surface rupture · San Andreas' },
    story: {
      title: 'San Andreas Fault', sub: 'Carrizo Plain · locked since 1857',
      text: 'The Pacific Plate slides north-west past North America at about <b>34 mm/yr</b>. The fault is locked down to ~15 km, so the crust bends elastically and stores slip. That slip was last released in the 1857 Fort Tejon earthquake (Mw 7.9). Press <b>TRIGGER RUPTURE</b> to watch the mesh tear along the trace, the fringes crowd against the fault, and coherence collapse along the rupture.',
    },
  },
  jakobshavn: {
    id: 'jakobshavn', waltz: 1, kind: 'glacier', seed: 37,
    name: 'Jakobshavn Isbræ', region: 'Sermeq Kujalleq, Greenland', tag: 'Speckle tracking · calving front',
    ve: 3.2, canopyVE: 1, exag: 20, inc: { asc: 35.5, desc: 42.5 },
    aps: { turb: 0.004, strat: 3e-6 },
    poi: null,
    ref: { lat: 69.0000, lon: -50.6500 },
    cam: { pos: [-133.2, 68.4, 82.8], target: [6, 2, -2] },
    labels: [
      { name: 'Ilulissat Icefjord', lat: 69.175, lon: -50.350 },
      { name: 'Greenland Ice Sheet', lat: 69.320, lon: -49.250 },
    ],
    event: { kind: 'calving', t: 240, name: 'Calving event · terminus' },
    story: {
      title: 'Jakobshavn Isbræ', sub: 'Sermeq Kujalleq · Greenland',
      text: 'One of the fastest glaciers on Earth. It drains about <b>6.5 % of the Greenland Ice Sheet</b> and its trunk moves <b>tens of metres per day</b>. Twelve days of that motion is hundreds of metres, so InSAR fringes alias into noise. NISAR measures the flow by <b>tracking the speckle pattern</b> between passes, and the moving streaks are those tracks. On day 240 a large calving event breaks off the terminus.',
    },
  },
  atchafalaya: {
    id: 'atchafalaya', waltz: 2, kind: 'wetland', seed: 41,
    name: 'Atchafalaya Basin', region: 'Mississippi Delta, Louisiana', tag: 'NASA Delta-X region · flooded forest',
    ve: 95, canopyVE: 0.06, exag: 260, inc: { asc: 36.0, desc: 41.0 },
    aps: { turb: 0.006, strat: 0 },
    water: { up: [3.0, 3.4], down: [1.0, 1.1], peak: 150, axis: 'ns' },   // [base, amplitude] m: upstream & downstream ends
    poi: { lat: 30.2400, lon: -91.6500 },
    ref: { lat: 30.4000, lon: -91.4300 },
    cam: { pos: [-40, 80, 112], target: [0, 0, 4] },
    labels: [
      { name: 'Atchafalaya River', lat: 30.170, lon: -91.600, kind: 'water' },
      { name: 'Butte La Rose', lat: 30.282, lon: -91.686 },
      { name: 'Henderson', lat: 30.313, lon: -91.790 },
      { name: 'West Guide Levee', lat: 30.100, lon: -91.810 },
      { name: 'East Guide Levee', lat: 30.330, lon: -91.430 },
    ],
    event: { kind: 'windthrow', t: 288, name: 'Hurricane windthrow (simulated)' },
    story: {
      title: 'Atchafalaya Basin', sub: 'Largest river swamp in the USA · NASA Delta-X region',
      text: 'NASA\'s Delta-X mission studied this basin with airborne L-band radar. Every spring the cypress–tupelo forest floods. <b>S-band</b> scatters in the leaves and loses its phase within days. <b>L-band</b> reaches the water, bounces between water and trunks, and keeps coherent fringes that measure how fast the water rises under the trees. Choose <b>X-RAY LENS</b> and move the mouse over the forest.',
    },
  },
  danube: {
    id: 'danube', waltz: 2, kind: 'wetland', seed: 53, home: true,
    name: 'Danube Delta', region: 'Tulcea County, Romania', tag: 'Home waters · reed beds & dune forests',
    ve: 110, canopyVE: 0.05, exag: 400, inc: { asc: 37.0, desc: 40.0 },
    aps: { turb: 0.006, strat: 0 },
    water: { up: [1.0, 1.9], down: [0.3, 0.65], peak: 165, axis: 'we' },
    smooth: 1,
    poi: { lat: 45.1950, lon: 29.4400 },
    ref: { lat: 44.9700, lon: 29.1300 },
    cam: { pos: [-38, 82, 114], target: [0, 0, 4] },
    labels: [
      { name: 'Letea Forest', lat: 45.320, lon: 29.540, kind: 'forest' },
      { name: 'Caraorman Forest', lat: 45.060, lon: 29.380, kind: 'forest' },
      { name: 'Sulina', lat: 45.159, lon: 29.653 },
      { name: 'Crișan', lat: 45.180, lon: 29.380 },
      { name: 'Mila 23', lat: 45.220, lon: 29.240 },
      { name: 'Black Sea', lat: 45.100, lon: 29.790, kind: 'water' },
    ],
    event: { kind: 'fire', t: 120, name: 'Reed-bed fire (simulated)' },
    story: {
      title: 'Danube Delta', sub: 'Our home waters · UNESCO World Heritage since 1991',
      text: 'Europe\'s second-largest delta and one of the largest continuous reed beds on Earth. In spring the Danube flood pulse spreads under the reeds. Reed stems standing in water act as millions of corner reflectors, so <b>L-band</b> double bounce lights up in red in the polarimetry, while <b>S-band</b> sees a green wall of vegetation. Letea and Caraorman forests grow on ancient sand dunes. On day 120 a reed fire leaves a burn scar for <b>RUN CCD</b> to find.',
    },
  },
  mexico: {
    id: 'mexico', waltz: 3, kind: 'urban', seed: 67,
    name: 'Mexico City', region: 'Valley of Mexico', tag: 'Aquifer compaction · tilting city blocks',
    ve: 2.4, canopyVE: 1.6, exag: 1600, inc: { asc: 36.0, desc: 41.0 },
    aps: { turb: 0.008, strat: 8e-6 },
    bowls: [
      { lat: 19.420, lon: -99.030, rate: 0.30, sigma: 4800 },   // Nezahualcóyotl – airport
      { lat: 19.352, lon: -99.050, rate: 0.26, sigma: 4200 },   // Iztapalapa east
      { lat: 19.268, lon: -98.920, rate: 0.36, sigma: 3800 },   // Chalco
      { lat: 19.292, lon: -99.050, rate: 0.22, sigma: 4200 },   // Tláhuac – Xochimilco
      { lat: 19.432, lon: -99.133, rate: 0.08, sigma: 3200 },   // historic centre
      { lat: 19.555, lon: -99.030, rate: 0.16, sigma: 5200 },   // Ecatepec
    ],
    corridor: [{ lat: 19.4150, lon: -99.0720 }, { lat: 19.3950, lon: -99.0330 }, { lat: 19.3700, lon: -98.9950 }, { lat: 19.3500, lon: -98.9600 }],
    poi: { lat: 19.4000, lon: -99.0150 },
    ref: { lat: 19.5800, lon: -99.1350 },
    cam: { pos: [-93.6, 75.6, 118.8], target: [2, 2, 2] },
    labels: [
      { name: 'Zócalo', lat: 19.4326, lon: -99.1332 },
      { name: 'Airport (AICM)', lat: 19.4361, lon: -99.0719 },
      { name: 'Nezahualcóyotl', lat: 19.4000, lon: -99.0150 },
      { name: 'Iztapalapa', lat: 19.3570, lon: -99.0930 },
      { name: 'Chalco', lat: 19.2630, lon: -98.8970 },
      { name: 'Sierra de Guadalupe', lat: 19.5800, lon: -99.1200, kind: 'peak' },
      { name: 'Ajusco', lat: 19.2090, lon: -99.2580, kind: 'peak' },
    ],
    event: { kind: 'fissure', t: 204, name: 'Ground-fissure damage · Iztapalapa (simulated)', a: { lat: 19.3520, lon: -99.0760 }, b: { lat: 19.3360, lon: -99.0440 } },
    story: {
      title: 'Mexico City', sub: 'A megacity on an old lake bed',
      text: 'The city stands on the soft clay of former Lake Texcoco and pumps much of its water from the aquifer below. The clay compacts, and parts of the city sink by up to <b>~35 cm per year</b>, among the fastest urban subsidence anywhere. Uneven settlement tilts city blocks and opens ground fissures. Every block is checked against an angular-distortion limit of <b>β = 1/500</b>.',
    },
  },
};
const SITE_ORDER = ['rainier', 'carrizo', 'jakobshavn', 'atchafalaya', 'danube', 'mexico'];
