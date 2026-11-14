#!/usr/bin/env python3
"""
CHRONO-SAR · CSAR-PACK builder
==============================

Turns a real interferogram into a CSAR-PACK that the web app loads by drag & drop
("LOAD REAL NISAR / HyP3 DATA"). The pack is two files:

  <name>.png   RGB, width = 2N, height = N (no alpha, 8 bit per channel)
                 left half : R,G = DEM (16 bit, dem_min..dem_max)   B = coherence × 255
                 right half: R,G = LoS displacement (16 bit, los_min..los_max)
                             B = amplitude, −30…0 dB → 0…255
  <name>.json  metadata (ranges, location, wavelength, geometry, dates)

Why not one RGBA channel per layer? 8 bits are not enough for a DEM (4 km / 255 = 16 m
terraces) and a browser canvas pre-multiplies alpha, which destroys RGB wherever alpha≈0.
Splitting into two 16-bit halves avoids both problems.

Inputs
------
* An ASF HyP3 InSAR product folder (INSAR_GAMMA / INSAR_ISCE), auto-detected by suffix:
    *_dem.tif, *_corr.tif, *_los_disp.tif (or *_unw_phase.tif), *_amp.tif
* or explicit GeoTIFFs: --dem --los (metres, + toward the satellite) | --unw (radians) --coh --amp

GeoTIFFs are read with rasterio when it is installed (keeps georeferencing, any CRS);
otherwise with Pillow/tifffile, in which case pass --lat --lon --extent-km yourself.

Examples
--------
  python tools/csar_pack.py --hyp3 S1AA_20250103T..._INT80_G_ueF_1234 --title "Kilauea 2025" -o kilauea
  python tools/csar_pack.py --dem dem.tif --unw unw.tif --coh corr.tif --wavelength 0.2385 \\
         --lat 19.41 --lon -155.28 --extent-km 40 --sensor NISAR-L --date1 2026-01-02 --date2 2026-01-14 -o myscene
"""
import argparse
import glob
import json
import math
import os
import sys

import numpy as np

KM_PER_DEG = 111.32


# ───────────────────────── reading ─────────────────────────
def read_raster(path):
    """Return (array float64 with NaN for nodata, georef dict or None)."""
    try:
        import rasterio  # type: ignore
        from rasterio.warp import transform as warp_transform  # type: ignore
        with rasterio.open(path) as ds:
            a = ds.read(1).astype(np.float64)
            if ds.nodata is not None:
                a[a == ds.nodata] = np.nan
            b = ds.bounds
            cx, cy = (b.left + b.right) / 2, (b.bottom + b.top) / 2
            lon, lat = warp_transform(ds.crs, "EPSG:4326", [cx], [cy])
            width_m = abs(b.right - b.left) if ds.crs and ds.crs.is_projected else abs(b.right - b.left) * KM_PER_DEG * 1000 * math.cos(math.radians(lat[0]))
            height_m = abs(b.top - b.bottom) if ds.crs and ds.crs.is_projected else abs(b.top - b.bottom) * KM_PER_DEG * 1000
            return a, dict(lat=lat[0], lon=lon[0], width_km=width_m / 1000, height_km=height_m / 1000)
    except ImportError:
        pass
    try:
        import tifffile  # type: ignore
        return tifffile.imread(path).astype(np.float64), None
    except ImportError:
        pass
    from PIL import Image
    return np.asarray(Image.open(path), dtype=np.float64), None


def find_hyp3(folder):
    def one(*patterns):
        for p in patterns:
            hits = sorted(glob.glob(os.path.join(folder, p)))
            if hits:
                return hits[0]
        return None
    return dict(dem=one("*_dem.tif"), coh=one("*_corr.tif"), los=one("*_los_disp.tif"),
                unw=one("*_unw_phase.tif"), amp=one("*_amp.tif"))


# ───────────────────────── processing ─────────────────────────
def center_square(a):
    h, w = a.shape
    s = min(h, w)
    i0, j0 = (h - s) // 2, (w - s) // 2
    return a[i0:i0 + s, j0:j0 + s]


def resample(a, n):
    """Area-average (or bilinear when upsampling) a square array to n × n, NaN-aware."""
    s = a.shape[0]
    if s == n:
        return a.copy()
    if s > n:
        edges = np.linspace(0, s, n + 1).astype(int)
        out = np.full((n, n), np.nan)
        for i in range(n):
            rows = a[edges[i]:max(edges[i + 1], edges[i] + 1)]
            for j in range(n):
                blk = rows[:, edges[j]:max(edges[j + 1], edges[j] + 1)]
                v = blk[np.isfinite(blk)]
                if v.size:
                    out[i, j] = v.mean()
        return out
    x = (np.arange(n) + 0.5) / n * s - 0.5
    x = np.clip(x, 0, s - 1.000001)
    i0 = np.floor(x).astype(int)
    f = x - i0
    rows = a[i0] * (1 - f)[:, None] + a[i0 + 1] * f[:, None]
    return rows[:, i0] * (1 - f)[None, :] + rows[:, i0 + 1] * f[None, :]


def fill_nan(a, fallback=0.0):
    a = a.copy()
    bad = ~np.isfinite(a)
    if bad.all():
        a[:] = fallback
        return a
    if bad.any():
        # iterative neighbour averaging (a few passes are enough for small holes), then the mean
        for _ in range(50):
            if not bad.any():
                break
            p = np.pad(np.where(bad, 0, a), 1)
            m = np.pad((~bad).astype(float), 1)
            s = p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]
            c = m[:-2, 1:-1] + m[2:, 1:-1] + m[1:-1, :-2] + m[1:-1, 2:]
            grow = bad & (c > 0)
            a[grow] = s[grow] / c[grow]
            bad = bad & ~grow
        a[bad] = np.nanmean(a[~bad]) if (~bad).any() else fallback
    return a


def to16(a, lo, hi):
    v = np.clip(np.round((a - lo) / max(hi - lo, 1e-12) * 65535), 0, 65535).astype(np.uint32)
    return (v >> 8).astype(np.uint8), (v & 255).astype(np.uint8)


def pack(dem, los, coh, amp_db, meta, out_base):
    """dem (m), los (m, + toward satellite), coh (0..1), amp_db (dB) — all n × n."""
    from PIL import Image
    n = dem.shape[0]
    dem = fill_nan(dem, 0.0)
    valid = np.isfinite(los) & np.isfinite(coh)
    los = np.where(valid, los, 0.0)
    coh = np.where(valid, np.clip(coh, 0, 1), 0.0)
    amp_db = fill_nan(np.where(np.isfinite(amp_db), amp_db, np.nan), -20.0)
    dmin, dmax = float(np.min(dem)), float(np.max(dem))
    if dmax - dmin < 1:
        dmax = dmin + 1
    lim = float(np.percentile(np.abs(los[valid]), 99.9)) if valid.any() else 0.01
    lim = max(lim * 1.05, 1e-4)
    los = np.clip(los, -lim, lim)
    img = np.zeros((n, 2 * n, 3), np.uint8)
    img[:, :n, 0], img[:, :n, 1] = to16(dem, dmin, dmax)
    img[:, :n, 2] = np.round(coh * 255).astype(np.uint8)
    img[:, n:, 0], img[:, n:, 1] = to16(los, -lim, lim)
    img[:, n:, 2] = np.round(np.clip((amp_db + 30) / 30, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(img, "RGB").save(out_base + ".png", optimize=True)
    meta = dict(meta)
    meta.update(format="CSAR-PACK/1", n=n, dem_min=dmin, dem_max=dmax, los_min=-lim, los_max=lim)
    with open(out_base + ".json", "w") as f:
        json.dump(meta, f, indent=2)
    return out_base + ".png", out_base + ".json"


# ───────────────────────── CLI ─────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a CHRONO-SAR CSAR-PACK from real InSAR GeoTIFFs.")
    ap.add_argument("--hyp3", help="ASF HyP3 InSAR product folder")
    ap.add_argument("--dem"); ap.add_argument("--los", help="LoS displacement GeoTIFF in metres (+ toward the satellite)")
    ap.add_argument("--unw", help="unwrapped phase GeoTIFF in radians (used when --los is missing)")
    ap.add_argument("--coh"); ap.add_argument("--amp", help="amplitude GeoTIFF (linear); converted to dB")
    ap.add_argument("--phase-sign", type=float, default=-1.0,
                    help="d_LoS = sign · λ/4π · φ. HyP3/GAMMA phase grows with range, so the default −1 gives + toward the satellite")
    ap.add_argument("--wavelength", type=float, default=0.05546, help="m (Sentinel-1 C 0.05546, NISAR L 0.2385, NISAR S 0.0937)")
    ap.add_argument("--incidence", type=float, default=39.0); ap.add_argument("--heading", type=float, default=-12.0)
    ap.add_argument("--look", choices=["left", "right"], default="right", help="Sentinel-1 is right-looking, NISAR left-looking")
    ap.add_argument("--lat", type=float); ap.add_argument("--lon", type=float); ap.add_argument("--extent-km", type=float)
    ap.add_argument("--sensor", default="Sentinel-1 (HyP3)"); ap.add_argument("--date1", default=""); ap.add_argument("--date2", default="")
    ap.add_argument("--title", default="My interferogram"); ap.add_argument("--n", type=int, default=384)
    ap.add_argument("-o", "--out", default="csar_pack")
    a = ap.parse_args(argv)

    files = find_hyp3(a.hyp3) if a.hyp3 else {}
    for k in ("dem", "coh", "los", "unw", "amp"):
        if getattr(a, k):
            files[k] = getattr(a, k)
    if not files.get("dem") or not (files.get("los") or files.get("unw")):
        ap.error("need a DEM and either LoS displacement or unwrapped phase")
    dem, geo = read_raster(files["dem"])
    if files.get("los"):
        los, _ = read_raster(files["los"])
    else:
        unw, _ = read_raster(files["unw"])
        los = a.phase_sign * a.wavelength / (4 * math.pi) * unw
    coh = read_raster(files["coh"])[0] if files.get("coh") else np.where(np.isfinite(los), 0.8, 0.0)
    if files.get("amp"):
        amp = read_raster(files["amp"])[0]
        amp_db = 10 * np.log10(np.maximum(amp, 1e-6) ** 2) if np.nanmax(amp) < 50 else amp
    else:
        amp_db = np.full(dem.shape, -12.0)
    shapes = {dem.shape, los.shape, coh.shape, amp_db.shape}
    if len(shapes) != 1:
        ap.error(f"rasters must share one grid, got shapes {shapes} (HyP3 products already do)")
    side = min(dem.shape)
    lat = a.lat if a.lat is not None else (geo["lat"] if geo else None)
    lon = a.lon if a.lon is not None else (geo["lon"] if geo else None)
    ext = a.extent_km if a.extent_km is not None else (min(geo["width_km"], geo["height_km"]) if geo else None)
    if lat is None or lon is None or ext is None:
        ap.error("no georeferencing available (install rasterio) — pass --lat --lon --extent-km")
    sq = [resample(center_square(x), a.n) for x in (dem, los, coh, amp_db)]
    meta = dict(title=a.title, sensor=a.sensor, date1=a.date1, date2=a.date2, lat=lat, lon=lon, extent_km=ext,
                wavelength_m=a.wavelength, incidence_deg=a.incidence, heading_deg=a.heading, look=a.look,
                source_pixels=side)
    png, js = pack(*sq, meta, a.out)
    print(f"wrote {png} and {js}  ({a.n}×{a.n}, LoS ±{max(abs(json.load(open(js))['los_min']), 0) * 1000:.1f} mm)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
