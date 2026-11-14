#!/usr/bin/env python3
"""
CHRONO-SAR · real NISAR values from downloaded .h5 products, resampled onto the scene grids.

    python tools/nisar_h5.py path/to/folder_or_file.h5 [...]          # finds the scene of each product by itself
    python tools/nisar_h5.py path/to/file.h5 --scene danube           # or name it
    python tools/nisar_h5.py path/to/folder --preview qa/             # also write PNG previews

Download the products from the "Data .h5 (login)" links in the site's Real NISAR panel (free Earthdata Login).
For every product the script writes data/nisar_<scene>_<gcov|gunw>.json; `npm run build` embeds them and the site
shows the real values on the terrain and under the cursor.

L2 GCOV (geocoded polarimetric covariance): the diagonal terms (HHHH, HVHV, ...) as γ⁰ (terrain-corrected) in dB.
L2 GUNW (geocoded unwrapped interferogram), frequency A:
  · wrp  wrapped phase, multilooked from the 20 m complex interferogram (sum of complex samples per cell)
  · unw  unwrapped phase (80 m) on the largest connected component in the scene, relative to its median
  · coh  coherence magnitude (80 m)
  · az, rg  along-track and slant-range pixel offsets (80 m, metres): kept for fast ice (jakobshavn) or with --offsets
Each scene cell (384 × 384) gathers sub × sub samples (default 8 × 8) of the product grid.

Needs: Python 3, numpy, h5py, Pillow (for --preview). No projection library: UTM and polar stereographic are computed below.
"""
import argparse, base64, json, math, re, zlib
from pathlib import Path

import numpy as np
import h5py

ROOT = Path(__file__).resolve().parent.parent
SCENES = ['rainier', 'carrizo', 'jakobshavn', 'atchafalaya', 'danube', 'mexico']
C_LIGHT = 299792458.0
DB0, DBK = 40.0, 6.0     # γ⁰ dB → byte: q = round((dB + DB0) * DBK), 1 … 255; 0 = no data


def utm_forward(lat, lon, zone, north=True):
    """WGS84 geographic → UTM easting/northing (m), Krüger series (sub-mm inside the zone)."""
    a, f = 6378137.0, 1 / 298.257223563
    k0 = 0.9996
    e2 = f * (2 - f); ep2 = e2 / (1 - e2)
    lat = np.radians(lat); lon = np.radians(lon)
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    N = a / np.sqrt(1 - e2 * np.sin(lat) ** 2)
    T = np.tan(lat) ** 2; C = ep2 * np.cos(lat) ** 2; A = np.cos(lat) * (lon - lon0)
    M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * lat
             - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * np.sin(2 * lat)
             + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * np.sin(4 * lat)
             - (35 * e2 ** 3 / 3072) * np.sin(6 * lat))
    x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000.0
    y = k0 * (M + N * np.tan(lat) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
                                       + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720))
    return x, (y if north else y + 10000000.0)


def b64z(arr):
    return base64.b64encode(zlib.compress(np.ascontiguousarray(arr).tobytes(), 9)).decode('ascii')


def s(v):
    v = v[()] if hasattr(v, 'shape') else v
    return v.decode() if isinstance(v, bytes) else (v.item() if hasattr(v, 'item') else v)


def polar_stereo(lat, lon, lat_ts, lon0, south=False):
    """WGS84 → polar stereographic with a standard parallel (Snyder 1987, eq. 21-33/21-34; EPSG:3413 / 3031)."""
    a, f = 6378137.0, 1 / 298.257223563
    e = math.sqrt(f * (2 - f))
    sg = -1.0 if south else 1.0
    phi, lam, phic = np.radians(lat) * sg, np.radians(lon) * sg, math.radians(lat_ts) * sg
    t = lambda p: np.tan(np.pi / 4 - p / 2) / ((1 - e * np.sin(p)) / (1 + e * np.sin(p))) ** (e / 2)
    mc = math.cos(phic) / math.sqrt(1 - e * e * math.sin(phic) ** 2)
    rho = a * mc * t(phi) / t(phic)
    dl = lam - math.radians(lon0) * sg
    return sg * rho * np.sin(dl), -sg * rho * np.cos(dl)


def project(lat, lon, epsg):
    if 32601 <= epsg <= 32660 or 32701 <= epsg <= 32760:
        return utm_forward(lat, lon, epsg % 100, epsg < 32700)
    if epsg == 3413:   # NSIDC sea-ice polar stereographic north (NISAR over Greenland)
        return polar_stereo(lat, lon, 70.0, -45.0)
    if epsg == 3031:   # Antarctic polar stereographic
        return polar_stereo(lat, lon, -71.0, 0.0, south=True)
    raise ValueError(f'projection EPSG:{epsg} is not supported (UTM, 3413, 3031)')


class Grid:
    """Scene cells → indices into one product raster (UTM or polar stereographic, pixel-centre coordinates)."""
    def __init__(self, meta, g, sub):
        epsg = int(g['projection'][()])
        project(np.array([0.0]), np.array([0.0]), epsg) if epsg != 3413 else None   # raises for unsupported projections
        xs, ys = g['xCoordinates'][()], g['yCoordinates'][()]
        dx, dy = float(g['xCoordinateSpacing'][()]), float(g['yCoordinateSpacing'][()])
        n = meta['n']; u = (np.arange(n * sub) + 0.5) / sub
        lat = meta['lat_max'] - u / n * (meta['lat_max'] - meta['lat_min'])
        lon = meta['lon_min'] + u / n * (meta['lon_max'] - meta['lon_min'])
        LON, LAT = np.meshgrid(lon, lat)
        X, Y = project(LAT, LON, epsg)
        col = np.floor((X - (xs[0] - dx / 2)) / dx).astype(np.int64)
        row = np.floor((Y - (ys[0] - dy / 2)) / dy).astype(np.int64)
        self.inside = (col >= 0) & (col < len(xs)) & (row >= 0) & (row < len(ys))
        self.cover = float(self.inside.mean())
        if not self.inside.any():
            return
        self.r0, self.r1 = int(row[self.inside].min()), int(row[self.inside].max()) + 1
        self.c0, self.c1 = int(col[self.inside].min()), int(col[self.inside].max()) + 1
        self.rr = np.clip(row - self.r0, 0, self.r1 - self.r0 - 1)
        self.cc = np.clip(col - self.c0, 0, self.c1 - self.c0 - 1)
        self.n, self.sub, self.dx, self.epsg = n, sub, abs(dx), epsg

    def read(self, ds):
        return ds[self.r0:self.r1, self.c0:self.c1]

    def sample(self, arr):
        return arr[self.rr, self.cc]

    def cells(self, v, ok, min_frac=0.25):
        """mean of the samples in each cell where ok; NaN where fewer than min_frac of the samples are ok"""
        n, k = self.n, self.sub
        ok = ok & self.inside
        sv = np.where(ok, v, 0).reshape(n, k, n, k).sum((1, 3)); sk = ok.reshape(n, k, n, k).sum((1, 3))
        with np.errstate(divide='ignore', invalid='ignore'):
            return np.where(sk >= k * k * min_frac, sv / np.maximum(sk, 1), np.nan)


def scene_meta(name):
    return json.loads((ROOT / 'data' / f'dem_{name}.json').read_text())


def guess_scene(f, ptype):
    g = f[f'science/LSAR/{ptype}/grids/frequencyA' + ('/unwrappedInterferogram' if ptype == 'GUNW' else '')]
    best = (0, None)
    for sc in SCENES:
        try: cov = Grid(scene_meta(sc), g, 2).cover
        except ValueError: continue
        if cov > best[0]: best = (cov, sc)
    return best[1] if best[0] > 0.5 else None


def ident(f):
    i = f['science/LSAR/identification']
    get = lambda k: s(i[k]) if k in i else None
    return {'time': (get('zeroDopplerStartTime') or '')[:19], 'track': get('trackNumber'), 'frame': get('frameNumber'),
            'dir': (get('orbitPassDirection') or '?')[:1].upper()}


def do_gcov(f, meta, sub):
    g = f['science/LSAR/GCOV/grids/frequencyA']
    G = Grid(meta, g, sub)
    terms = [t.decode() for t in g['listOfCovarianceTerms'][()]]
    diag = [t for t in terms if t[:2] == t[2:]]
    mask = G.sample(G.read(g['mask']))
    out, layers = {}, {}
    for t in diag:
        p = G.sample(G.read(g[t]).astype(np.float64))
        ok = np.isfinite(p) & (p > 0) & (mask > 0) & (mask < 255)
        with np.errstate(divide='ignore', invalid='ignore'):
            db = 10 * np.log10(G.cells(p, ok))
        out[t] = db
        layers[t] = b64z(np.where(np.isfinite(db), np.clip(np.round((db + DB0) * DBK), 1, 255), 0).astype(np.uint8))
        fin = db[np.isfinite(db)]
        print(f'    {t}: valid {np.isfinite(db).mean() * 100:.0f} % · median {np.median(fin):.1f} dB')
    return {'type': 'GCOV', 'terms': diag, 'enc': {'db0': DB0, 'k': DBK}, 'source_m': G.dx, 'looksPerCell': sub * sub,
            'quantity': 'gamma0 (RTC), linear power averaged per cell, in dB', 'data': layers}, out


def do_gunw(f, meta, sub, offsets=False):
    base = 'science/LSAR/GUNW/grids/frequencyA/'
    gu, gw = f[base + 'unwrappedInterferogram'], f[base + 'wrappedInterferogram']
    pol = [p.decode() for p in f[base + 'listOfPolarizations'][()]][0]
    lam = C_LIGHT / float(f[base + 'centerFrequency'][()])
    U = Grid(meta, gu, sub); Wg = Grid(meta, gw, sub)
    n = U.n
    # unwrapped phase: only the largest connected component in the scene (other components carry an unknown 2π offset)
    phi = U.sample(U.read(gu[pol]['unwrappedPhase']).astype(np.float64))
    comp = U.sample(U.read(gu[pol]['connectedComponents']))
    good = np.isfinite(phi) & (comp > 0) & (comp < 65535) & U.inside
    ids, counts = np.unique(comp[good], return_counts=True)
    main = int(ids[np.argmax(counts)]) if len(ids) else -1
    unw = U.cells(phi, good & (comp == main), 0.5)
    ref = float(np.nanmedian(unw)) if np.isfinite(unw).any() else 0.0
    unw = unw - ref
    coh = U.cells(U.sample(U.read(gu[pol]['coherenceMagnitude']).astype(np.float64)), U.inside & np.isfinite(U.sample(U.read(gu[pol]['coherenceMagnitude']))))
    # wrapped phase: complex multilook of the 20 m interferogram
    z = Wg.sample(Wg.read(gw[pol]['wrappedInterferogram']))
    okz = np.isfinite(z.real) & np.isfinite(z.imag) & Wg.inside
    zr = Wg.cells(np.where(okz, z.real, 0), okz); zi = Wg.cells(np.where(okz, z.imag, 0), okz)
    wrp = np.arctan2(zi, zr)
    # pixel offsets (fast motion: ice)
    go = f[base + 'pixelOffsets']
    O = Grid(meta, go, sub)
    az = O.cells(O.sample(O.read(go[pol]['alongTrackOffset']).astype(np.float64)), np.isfinite(O.sample(O.read(go[pol]['alongTrackOffset']))))
    rg = O.cells(O.sample(O.read(go[pol]['slantRangeOffset']).astype(np.float64)), np.isfinite(O.sample(O.read(go[pol]['slantRangeOffset']))))
    # incidence angle at the scene centre (metadata cube, middle height layer)
    inc = None
    try:
        rgd = f['science/LSAR/GUNW/metadata/radarGrid']
        cube = rgd['incidenceAngle']; xs, ys = rgd['xCoordinates'][()], rgd['yCoordinates'][()]
        epsg = int(rgd['projection'][()]) if 'projection' in rgd else U.epsg
        cx, cy = project(np.array([(meta['lat_min'] + meta['lat_max']) / 2]), np.array([(meta['lon_min'] + meta['lon_max']) / 2]), epsg)
        j = int(np.argmin(np.abs(xs - cx[0]))); i = int(np.argmin(np.abs(ys - cy[0])))
        inc = float(cube[cube.shape[0] // 2, i, j])
    except Exception as e:
        print('    incidence angle not read:', e)
    # times
    gid = f['science/LSAR/identification']
    rt = s(gid['referenceZeroDopplerStartTime'])[:19] if 'referenceZeroDopplerStartTime' in gid else None
    st = s(gid['secondaryZeroDopplerStartTime'])[:19] if 'secondaryZeroDopplerStartTime' in gid else None
    # encode
    kmax = float(np.nanmax(np.abs(unw))) if np.isfinite(unw).any() else 1.0
    uk = 32000.0 / max(kmax, 1e-6)
    enc_unw = np.where(np.isfinite(unw), np.round(unw * uk), -32768).astype('<i2')
    enc_wrp = np.where(np.isfinite(wrp), 1 + np.round((wrp + np.pi) / (2 * np.pi) * 254), 0).astype(np.uint8)
    enc_coh = np.where(np.isfinite(coh), 1 + np.round(np.clip(coh, 0, 1) * 254), 0).astype(np.uint8)
    om = max(float(np.nanmax(np.abs(az))) if np.isfinite(az).any() else 1, float(np.nanmax(np.abs(rg))) if np.isfinite(rg).any() else 1)
    ok_ = 32000.0 / max(om, 1e-6)
    enc_az = np.where(np.isfinite(az), np.round(az * ok_), -32768).astype('<i2')
    enc_rg = np.where(np.isfinite(rg), np.round(rg * ok_), -32768).astype('<i2')
    los_mm = unw * lam / (4 * np.pi) * 1000
    fin = los_mm[np.isfinite(los_mm)]
    print(f'    λ {lam * 100:.2f} cm · unwrapped valid {np.isfinite(unw).mean() * 100:.0f} % (component {main}) · LoS p2…p98 {np.percentile(fin, 2):.1f} … {np.percentile(fin, 98):.1f} mm'
          f' · γ median {np.nanmedian(coh):.2f} · wrapped valid {np.isfinite(wrp).mean() * 100:.0f} % · offsets |az| p95 {np.nanpercentile(np.abs(az), 95):.1f} m · θ {inc}')
    res = {'type': 'GUNW', 'pol': pol, 'lambda': lam, 'ref': rt, 'sec': st, 'incidence': inc, 'source_m': {'unw': U.dx, 'wrp': Wg.dx, 'off': O.dx},
           'looksPerCell': sub * sub, 'enc': {'unw': uk, 'off': ok_}, 'component': main,
           'quantity': 'unwrapped phase (largest connected component, relative to the scene median), complex-multilooked wrapped phase, coherence, pixel offsets',
           'data': {'unw': b64z(enc_unw), 'wrp': b64z(enc_wrp), 'coh': b64z(enc_coh), **({'az': b64z(enc_az), 'rg': b64z(enc_rg)} if offsets else {})}}
    return res, {'wrp': wrp, 'unw': unw, 'coh': coh, 'az': az, 'rg': rg}


def preview(kind, out, path):
    from PIL import Image
    st = lambda d, lo, hi: np.nan_to_num(np.clip((d - lo) / (hi - lo), 0, 1))
    if kind == 'GCOV':
        hh, hv = out.get('HHHH'), out.get('HVHV', out.get('HHHH'))
        rgb = np.dstack([st(hh, -25, 0), st(hv, -30, -5), st(hh, -25, 0)])
    else:
        w = out['wrp']; hue = (np.nan_to_num(w) + np.pi) / (2 * np.pi)
        rgb = np.dstack([0.5 + 0.5 * np.cos(2 * np.pi * (hue + k / 3)) for k in range(3)]) * np.isfinite(w)[..., None]
    Image.fromarray((rgb * 255).astype(np.uint8)).save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('paths', nargs='+')
    ap.add_argument('--scene', choices=SCENES)
    ap.add_argument('--sub', type=int, default=8, help='samples per cell side (default 8)')
    ap.add_argument('--preview', help='folder for PNG previews')
    ap.add_argument('--offsets', action='store_true', help='keep the pixel offsets for every scene (default: only fast ice, jakobshavn)')
    args = ap.parse_args()
    files = []
    for p in map(Path, args.paths):
        files += sorted(p.glob('*.h5')) if p.is_dir() else [p]
    for p in files:
        f = h5py.File(p, 'r')
        ptype = s(f['science/LSAR/identification/productType'])
        if ptype not in ('GCOV', 'GUNW'):
            print(f'{p.name}: product type {ptype} is not supported (GCOV, GUNW)'); continue
        scene = args.scene or guess_scene(f, ptype)
        if not scene:
            print(f'{p.name}: covers none of the six scenes'); continue
        print(f'{p.name}\n  → {scene} · {ptype}')
        meta = scene_meta(scene)
        res, out = do_gcov(f, meta, args.sub) if ptype == 'GCOV' else do_gunw(f, meta, args.sub, args.offsets or scene == 'jakobshavn')
        res.update({'id': re.sub(r'\.h5$', '', p.name), 'scene': scene, 'n': meta['n'], **ident(f)})
        dst = ROOT / 'data' / f'nisar_{scene}_{ptype.lower()}.json'
        dst.write_text(json.dumps(res, separators=(',', ':')))
        print(f'  -> {dst.relative_to(ROOT)} ({dst.stat().st_size / 1024:.0f} kB)')
        if args.preview:
            Path(args.preview).mkdir(parents=True, exist_ok=True)
            preview(ptype, out, Path(args.preview) / f'{scene}_{ptype.lower()}.png')


if __name__ == '__main__':
    main()
