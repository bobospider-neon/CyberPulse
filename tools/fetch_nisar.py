#!/usr/bin/env python3
"""
CHRONO-SAR · real NISAR products over the six scenes (NASA CMR + ASF browse images).

    python tools/fetch_nisar.py                 # all scenes → data/nisar_<scene>.json
    python tools/fetch_nisar.py rainier danube  # only these
    python tools/fetch_nisar.py --preview qa/   # also write the crops as PNG files for checking

What it stores, per scene (a snapshot the page shows instantly and falls back to when it is offline;
the page then refreshes the list live from NASA CMR whenever it has internet):
  · the real NISAR granules that cover the scene: GUNW interferograms and GCOV polarimetry
    (dates, track, frame, orbit direction, polarisation, footprint, download / browse links),
  · the archive inventory: how many NISAR products of each type exist over the scene, and the latest pass,
  · the newest GUNW and GCOV browse images (NISAR QA quick-looks from ASF), georeferenced and
    cropped to the scene, as WebP data URLs.

Needs: Python 3, numpy, Pillow. No login: CMR metadata and NISAR browse images are public.
The georeferencing below is mirrored in src/js/13b_nisar.js (fitBrowse); keep the two in sync.
"""
import argparse, base64, datetime as dt, io, json, sys, urllib.parse, urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CMR = 'https://cmr.earthdata.nasa.gov/search/'
UA = {'User-Agent': 'CHRONO-SAR/1.0 (NASA Space Apps 2026; fetch_nisar.py)'}
SITES = ['rainier', 'carrizo', 'jakobshavn', 'atchafalaya', 'danube', 'mexico']
# validated first, then provisional, then beta: the same order the page uses
GUNW = ['NISAR_L2_GUNW_V1', 'NISAR_L2_GUNW_PROVISIONAL_V1', 'NISAR_L2_GUNW_BETA_V1']
GCOV = ['NISAR_L2_GCOV_V1', 'NISAR_L2_GCOV_PROVISIONAL_V1', 'NISAR_L2_GCOV_BETA_V1']
FAMILIES = ['L1_RSLC', 'L2_GSLC', 'L1_RIFG', 'L1_RUNW', 'L2_GUNW', 'L1_ROFF', 'L2_GOFF', 'L2_GCOV', 'L3_SME2']


def get(url, raw=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return (r.read(), r.headers) if raw else json.loads(r.read())


def bbox_of(meta):
    return [meta['lon_min'], meta['lat_min'], meta['lon_max'], meta['lat_max']]


def granules(short_names, bb, n=60):
    q = [('short_name[]', s) for s in short_names] + [
        ('bounding_box', ','.join(f'{v:.4f}' for v in bb)), ('page_size', str(n)), ('sort_key', '-start_date')]
    return get(CMR + 'granules.umm_json?' + urllib.parse.urlencode(q))['items']


def inside(poly, lon, lat):
    c = False
    for k in range(len(poly) - 1):
        (y1, x1), (y2, x2) = poly[k], poly[k + 1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            c = not c
    return c


def coverage(poly, bb):
    """fraction of a 9 × 9 lattice over the scene that lies inside the granule footprint"""
    xs, ys = np.linspace(bb[0], bb[2], 9), np.linspace(bb[1], bb[3], 9)
    return float(np.mean([inside(poly, x, y) for x in xs for y in ys]))


def record(item, bb):
    u, cid = item['umm'], item['meta']['collection-concept-id']
    at = {a['Name']: a['Values'] for a in u.get('AdditionalAttributes', [])}
    one = lambda k: (at.get(k) or [None])[0]
    pts = u['SpatialExtent']['HorizontalSpatialDomain']['Geometry']['GPolygons'][0]['Boundary']['Points']
    poly = [[round(p['Latitude'], 5), round(p['Longitude'], 5)] for p in pts]
    urls = [r['URL'] for r in u.get('RelatedUrls', []) if r['URL'].startswith('https://')]
    ptype = one('PRODUCT_TYPE')
    rec = {
        'id': u['GranuleUR'], 'cid': item['meta']['concept-id'], 'coll': cid, 'short': u['CollectionReference']['ShortName'],
        'type': ptype, 'track': int(one('TRACK_NUMBER') or 0), 'frame': int(one('FRAME_NUMBER') or 0),
        'dir': (one('ASCENDING_DESCENDING') or '?')[0], 'pol': '+'.join(at.get('FREQUENCY_A_POLARIZATION', [])),
        'freqs': '+'.join(at.get('FREQUENCIES', [])), 'version': one('PRODUCT_VERSION'),
        'cov': round(coverage(poly, bb), 3), 'poly': poly,
        'browse': next((x for x in urls if x.endswith('_LATLON.png')), None),
        'data': next((x for x in urls if x.endswith('.h5') and '/NISAR/' in x), None),
    }
    if ptype == 'GUNW':
        rec['ref'] = (one('REFERENCE_ZERO_DOPPLER_START_TIME') or '')[:19]
        rec['sec'] = (one('SECONDARY_ZERO_DOPPLER_START_TIME') or '')[:19]
    else:
        rec['ref'] = u['TemporalExtent']['RangeDateTime']['BeginningDateTime'][:19]
    return rec


def pick(recs):
    """newest product that covers the whole scene (GUNW: prefer short temporal baselines, they stay coherent)"""
    full = [r for r in recs if r['cov'] >= 0.98 and r['browse']] or [r for r in recs if r['browse']]
    if not full:
        return None
    if full[0]['type'] == 'GUNW':
        days = lambda r: (dt.datetime.fromisoformat(r['sec']) - dt.datetime.fromisoformat(r['ref'])).days
        short = [r for r in full if days(r) <= 24]
        full = short or full
    return full[0]


def fit_browse(rgba, poly):
    """Georeference an ASF *_LATLON.png browse image (north-up lat/lon grid, unknown bounds).
    The valid-data region is the granule footprint: its top-, bottom-, left- and right-most pixels are
    the footprint vertices with the largest / smallest latitude and longitude. A straight line through
    those four pairs gives x(lon) and y(lat). Returns (ax, bx, ay, by, residual_px)."""
    valid = (rgba[..., 3] > 0) & (rgba[..., :3].astype(np.int32).sum(-1) > 0)
    ys, xs = np.nonzero(valid)
    if len(xs) < 1000:
        raise ValueError('browse image has no valid pixels')
    ext = {
        'top': (xs[ys == ys.min()].mean(), ys.min()), 'bottom': (xs[ys == ys.max()].mean(), ys.max()),
        'left': (xs.min(), ys[xs == xs.min()].mean()), 'right': (xs.max(), ys[xs == xs.max()].mean()),
    }
    v = poly[:-1] if poly[0] == poly[-1] else poly
    ver = {'top': max(v, key=lambda p: p[0]), 'bottom': min(v, key=lambda p: p[0]),
           'left': min(v, key=lambda p: p[1]), 'right': max(v, key=lambda p: p[1])}
    lon = np.array([ver[k][1] for k in ext]); lat = np.array([ver[k][0] for k in ext])
    px = np.array([ext[k][0] for k in ext]) + 0.5; py = np.array([ext[k][1] for k in ext]) + 0.5
    ax, bx = np.polyfit(lon, px, 1)
    ay, by = np.polyfit(lat, py, 1)
    res = float(max(np.abs(ax * lon + bx - px).max(), np.abs(ay * lat + by - py).max()))
    return ax, bx, ay, by, res


def crop(url, poly, bb):
    raw, _ = get(url, raw=True)
    im = Image.open(io.BytesIO(raw)).convert('RGBA')
    a = np.asarray(im).copy()
    ax, bx, ay, by, res = fit_browse(a, poly)
    if res > 8:
        raise ValueError(f'georeferencing residual {res:.1f} px is too large')
    a[(a[..., :3].astype(np.int32).sum(-1) == 0), 3] = 0          # value 0 = no data (NISAR QA convention)
    x0, x1 = ax * bb[0] + bx, ax * bb[2] + bx                       # west, east
    y0, y1 = ay * bb[3] + by, ay * bb[1] + by                       # north, south
    n = int(min(384, max(64, round(max(x1 - x0, y1 - y0)))))        # keep the native browse resolution
    out = Image.fromarray(a).transform((n, n), Image.Transform.EXTENT, (x0, y0, x1, y1), Image.Resampling.BILINEAR)
    o = np.asarray(out)
    # WebP keeps the alpha (no-data) lossless and the colours near-lossless at a fraction of the PNG size
    buf = io.BytesIO(); out.save(buf, 'WEBP', quality=90, method=6)
    return {
        'img': 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode('ascii'), 'n': n, 'res_px': round(res, 2),
        'm_per_px': round(abs(bb[3] - bb[1]) * 111320 / abs(y1 - y0), 1),
        'valid': round(float((o[..., 3] > 0).mean()), 3),
    }, out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sites', nargs='*', default=SITES)
    ap.add_argument('--preview', help='folder for PNG previews of the crops')
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    for sid in args.sites:
        meta = json.loads((ROOT / 'data' / f'dem_{sid}.json').read_text())
        bb = bbox_of(meta)
        out = {'site': sid, 'fetched': now, 'bbox': bb, 'source': 'NASA CMR (cmr.earthdata.nasa.gov) · ASF DAAC browse images',
               'inventory': {}, 'products': {}, 'browse': {}}
        q = urllib.parse.urlencode({'bounding_box': ','.join(f'{v:.4f}' for v in bb), 'page_size': 0})
        for fam in FAMILIES:
            _, h = get(CMR + f'granules.json?short_name=NISAR_{fam}*&options[short_name][pattern]=true&' + q, raw=True)
            out['inventory'][fam] = int(h.get('CMR-Hits', 0))
        last = granules(['NISAR_L1_RSLC_V1', 'NISAR_L1_RSLC_PROVISIONAL_V1', 'NISAR_L1_RSLC_BETA_V1'], bb, 1)
        if last:
            r = record(last[0], bb)
            out['lastPass'] = {'t': r['ref'], 'track': r['track'], 'frame': r['frame'], 'dir': r['dir'], 'id': r['id']}
        for key, names in (('GUNW', GUNW), ('GCOV', GCOV)):
            recs = [record(it, bb) for it in granules(names, bb)]
            recs = [r for r in recs if r['cov'] > 0]
            out['products'][key] = recs[:24]
            best = pick(recs)
            if best:
                try:
                    img, pil = crop(best['browse'], best['poly'], bb)
                    out['browse'][key] = {'id': best['id'], **img}
                    if args.preview:
                        Path(args.preview).mkdir(parents=True, exist_ok=True)
                        pil.save(Path(args.preview) / f'nisar_{sid}_{key}.png')
                    print(f'  {sid:12s} {key}  {best["id"][:60]}…  cov {best["cov"]:.2f}  fit ±{img["res_px"]} px  {img["n"]} px @ {img["m_per_px"]} m  valid {img["valid"]:.2f}')
                except Exception as e:  # keep the list even if one image fails
                    print(f'  {sid:12s} {key}  browse failed: {e}', file=sys.stderr)
        (ROOT / 'data' / f'nisar_{sid}.json').write_text(json.dumps(out, separators=(',', ':')))
        inv = ' '.join(f'{k.split("_")[1]} {v}' for k, v in out['inventory'].items())
        print(f'{sid:12s} {len(out["products"]["GUNW"])} GUNW · {len(out["products"]["GCOV"])} GCOV listed · archive: {inv} · last pass {out.get("lastPass", {}).get("t")}')


if __name__ == '__main__':
    main()
