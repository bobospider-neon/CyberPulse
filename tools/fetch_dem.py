#!/usr/bin/env python3
"""
CHRONO-SAR · DEM pre-processor
==============================

Downloads real elevation data (AWS Terrain Tiles, "Terrarium" encoding; sources:
SRTM, USGS 3DEP/NED, GMTED2010, ETOPO1, ArcticDEM where available) and resamples it
onto a regular N x N latitude/longitude grid centred on each study site.

Output (in ../data):
  dem_<site>.json      metadata + base64( zlib( row-delta int16 ) ) of the grid
  dem_<site>_preview.png  hillshade preview with a 0.1-degree graticule (for QA)
  globe_landmask.json  0.5-degree global land/elevation mask for the 3D globe

Encoding of each grid cell:  u16 = round((elevation_m + 1000) * scale), scale in the JSON
(20 for flat deltas -> 5 cm steps, 4 for mountains -> 25 cm steps), stored as a row-wise
delta modulo 2^16. The browser decodes with DecompressionStream('deflate') + prefix sums.

Usage:  python tools/fetch_dem.py [--n 384] [--cache DIR] [site ...]
"""
import argparse
import base64
import io
import json
import math
import os
import sys
import time
import urllib.request
import zlib

import numpy as np
from PIL import Image

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# centre latitude / longitude (deg), square extent (km), tile zoom used for sampling
SITES = {
    "rainier":     dict(lat=46.8529,  lon=-121.7604, extent_km=40.0, zoom=11),
    "carrizo":     dict(lat=35.2400,  lon=-119.8000, extent_km=40.0, zoom=11),
    "jakobshavn":  dict(lat=69.1700,  lon=-49.9000,  extent_km=72.0, zoom=10, source="cop90"),
    # ridge=True: sample a finer zoom and keep levee crests (max) where they stand above the cell mean
    "atchafalaya": dict(lat=30.2000,  lon=-91.6500,  extent_km=50.0, zoom=13, ridge=True),
    # 'fix' = grid boxes (row0, row1, col0, col1) holding source artefacts, re-filled by Laplace inpainting
    "mexico":      dict(lat=19.3700,  lon=-99.0600,  extent_km=56.0, zoom=11, fix=[(312, 327, 230, 244)]),
    "danube":      dict(lat=45.1600,  lon=29.4500,   extent_km=60.0, zoom=11, source="cop90"),
}

KM_PER_DEG_LAT = 111.32


def lonlat_to_global_px(lon, lat, z):
    """Web-Mercator global pixel coordinates (256 px tiles)."""
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n * 256.0
    lat_r = np.radians(lat)
    y = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / math.pi) / 2.0 * n * 256.0
    return x, y


def fetch_tile(z, x, y, cache):
    n = 2 ** z
    x %= n
    path = os.path.join(cache, f"{z}_{x}_{y}.png")
    if not os.path.exists(path):
        url = TILE_URL.format(z=z, x=x, y=y)
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "chrono-sar-dem/1.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
                with open(path, "wb") as f:
                    f.write(data)
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
    img = Image.open(path).convert("RGB")
    a = np.asarray(img, dtype=np.float64)
    return (a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0) - 32768.0


def mosaic(z, x0, x1, y0, y1, cache):
    h = (y1 - y0 + 1) * 256
    w = (x1 - x0 + 1) * 256
    out = np.zeros((h, w), dtype=np.float64)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            out[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = fetch_tile(z, tx, ty, cache)
    return out


def bilinear(img, x, y):
    h, w = img.shape
    x = np.clip(x, 0, w - 1.000001)
    y = np.clip(y, 0, h - 1.000001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = x - x0
    fy = y - y0
    a = img[y0, x0]
    b = img[y0, x0 + 1]
    c = img[y0 + 1, x0]
    d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def site_grid(site, n, cache, ss=3):
    lat0, lon0, ext, z = site["lat"], site["lon"], site["extent_km"], site["zoom"]
    ridge = site.get("ridge", False)
    if ridge:
        ss = 6
    half = ext / 2.0
    dlat = half / KM_PER_DEG_LAT
    dlon = half / (KM_PER_DEG_LAT * math.cos(math.radians(lat0)))
    lat_max, lat_min = lat0 + dlat, lat0 - dlat
    lon_min, lon_max = lon0 - dlon, lon0 + dlon

    gx0, gy0 = lonlat_to_global_px(lon_min, lat_max, z)
    gx1, gy1 = lonlat_to_global_px(lon_max, lat_min, z)
    tx0, tx1 = int(gx0 // 256) - 1, int(gx1 // 256) + 1
    ty0, ty1 = int(gy0 // 256) - 1, int(gy1 // 256) + 1
    mos = mosaic(z, tx0, tx1, ty0, ty1, cache)

    # sub-pixel supersampling (ss x ss) for anti-aliased area averaging
    step_lat = (lat_max - lat_min) / n
    step_lon = (lon_max - lon_min) / n
    acc = np.zeros((n, n))
    mx = np.full((n, n), -1e9)
    for si in range(ss):
        for sj in range(ss):
            fi = (np.arange(n) + (si + 0.5) / ss)
            fj = (np.arange(n) + (sj + 0.5) / ss)
            lat = lat_max - fi * step_lat
            lon = lon_min + fj * step_lon
            LON, LAT = np.meshgrid(lon, lat)
            px, py = lonlat_to_global_px(LON, LAT, z)
            v = bilinear(mos, px - tx0 * 256, py - ty0 * 256)
            acc += v
            mx = np.maximum(mx, v)
    grid = acc / (ss * ss)
    if ridge:
        # levees are narrower than one output cell: keep their crest so hydrological connectivity is right
        grid = np.where(mx - grid > 1.2, mx, grid)
    meta = dict(lat=lat0, lon=lon0, extent_km=ext, n=n, lat_min=lat_min, lat_max=lat_max,
                lon_min=lon_min, lon_max=lon_max, zoom=z,
                pixel_m=ext * 1000.0 / n)
    return grid, meta


COP90_URL = "https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif"


def _geotiff_georef(path):
    """Read ModelPixelScale (33550) / ModelTiepoint (33922) / raster type from a GeoTIFF."""
    import struct
    with open(path, "rb") as f:
        data = f.read()
    bo = "<" if data[:2] == b"II" else ">"
    off = struct.unpack(bo + "I", data[4:8])[0]
    n = struct.unpack(bo + "H", data[off:off + 2])[0]
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack(bo + "HHII", data[off + 2 + i * 12: off + 14 + i * 12])
        tags[tag] = (typ, cnt, val)
    def doubles(tag):
        typ, cnt, val = tags[tag]
        return struct.unpack(bo + "d" * cnt, data[val: val + 8 * cnt])
    scale = doubles(33550)
    tie = doubles(33922)
    # GeoKeyDirectory: look for GTRasterTypeGeoKey (1025): 1 = PixelIsArea, 2 = PixelIsPoint
    raster_type = 1
    if 34735 in tags:
        typ, cnt, val = tags[34735]
        keys = struct.unpack(bo + "H" * cnt, data[val: val + 2 * cnt]) if cnt > 4 else ()
        for k in range(4, len(keys), 4):
            if keys[k] == 1025:
                raster_type = keys[k + 3]
    return scale, tie, raster_type


def site_grid_cop90(site, n, cache, ss=3):
    """Copernicus GLO-90 DSM (public AWS bucket) - used where Terrarium is too coarse (Arctic)."""
    lat0, lon0, ext = site["lat"], site["lon"], site["extent_km"]
    half = ext / 2.0
    dlat = half / KM_PER_DEG_LAT
    dlon = half / (KM_PER_DEG_LAT * math.cos(math.radians(lat0)))
    lat_max, lat_min = lat0 + dlat, lat0 - dlat
    lon_min, lon_max = lon0 - dlon, lon0 + dlon
    tiles = []
    for la in range(int(math.floor(lat_min)), int(math.floor(lat_max)) + 1):
        for lo in range(int(math.floor(lon_min)), int(math.floor(lon_max)) + 1):
            ns = f"N{la:02d}" if la >= 0 else f"S{-la:02d}"
            ew = f"E{lo:03d}" if lo >= 0 else f"W{-lo:03d}"
            name = f"Copernicus_DSM_COG_30_{ns}_00_{ew}_00_DEM"
            path = os.path.join(cache, name + ".tif")
            if not os.path.exists(path):
                req = urllib.request.Request(COP90_URL.format(name=name), headers={"User-Agent": "chrono-sar-dem/1.0"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    open(path, "wb").write(r.read())
            arr = np.asarray(Image.open(path), dtype=np.float64)
            sc, tie, rtype = _geotiff_georef(path)
            # pixel (i, j) centre in degrees
            x0 = tie[3] - tie[0] * sc[0] + (0.5 * sc[0] if rtype == 1 else 0.0)
            y0 = tie[4] + tie[1] * sc[1] - (0.5 * sc[1] if rtype == 1 else 0.0)
            tiles.append((arr, x0, y0, sc[0], sc[1]))
    acc = np.zeros((n, n))
    wsum = np.zeros((n, n))
    step_lat = (lat_max - lat_min) / n
    step_lon = (lon_max - lon_min) / n
    for si in range(ss):
        for sj in range(ss):
            lat = lat_max - (np.arange(n) + (si + 0.5) / ss) * step_lat
            lon = lon_min + (np.arange(n) + (sj + 0.5) / ss) * step_lon
            LON, LAT = np.meshgrid(lon, lat)
            for arr, x0, y0, sx, sy in tiles:
                h, w = arr.shape
                px = (LON - x0) / sx
                py = (y0 - LAT) / sy
                inside = (px >= -0.5) & (px <= w - 0.5) & (py >= -0.5) & (py <= h - 0.5)
                if not inside.any():
                    continue
                v = bilinear(arr, px, py)
                acc[inside] += v[inside]
                wsum[inside] += 1.0
    grid = acc / np.maximum(wsum, 1e-9)
    meta = dict(lat=lat0, lon=lon0, extent_km=ext, n=n, lat_min=lat_min, lat_max=lat_max,
                lon_min=lon_min, lon_max=lon_max, zoom=-1, source="Copernicus GLO-90 DSM",
                pixel_m=ext * 1000.0 / n)
    return grid, meta


def despike(grid, thresh=250.0, iters=3):
    """Replace isolated DEM artefacts (|z - median5x5| > thresh) by the 5x5 median."""
    g = grid.copy()
    total = 0
    for _ in range(iters):
        p = np.pad(g, 2, mode="edge")
        stack = np.stack([p[i:i + g.shape[0], j:j + g.shape[1]] for i in range(5) for j in range(5)], 0)
        med = np.median(stack, axis=0)
        bad = np.abs(g - med) > thresh
        n = int(bad.sum())
        if n == 0:
            break
        g[bad] = med[bad]
        total += n
    return g, total


def inpaint_box(grid, r0, r1, c0, c1, iters=600):
    """Fill grid[r0:r1, c0:c1] by Jacobi relaxation of Laplace's equation (boundary = surrounding data)."""
    g = grid.copy()
    sub = g[r0 - 1:r1 + 1, c0 - 1:c1 + 1].copy()
    inner = np.zeros_like(sub, dtype=bool)
    inner[1:-1, 1:-1] = True
    # initial guess: mean of the boundary ring
    sub[inner] = sub[~inner].mean()
    for _ in range(iters):
        avg = 0.25 * (np.roll(sub, 1, 0) + np.roll(sub, -1, 0) + np.roll(sub, 1, 1) + np.roll(sub, -1, 1))
        sub[inner] = avg[inner]
    g[r0:r1, c0:c1] = sub[1:-1, 1:-1]
    return g


def encode_grid(grid):
    """u16 = round((m + 1000) * scale); row-wise delta modulo 2^16 (lossless wrap-around)."""
    relief = float(grid.max() - grid.min())
    scale = 20.0 if relief < 200.0 else 4.0      # 5 cm steps for flat deltas, 25 cm for mountains
    u = np.clip(np.round((grid + 1000.0) * scale), 0, 65535).astype(np.int64)
    d = u.copy()
    d[:, 1:] = (u[:, 1:] - u[:, :-1]) % 65536
    raw = d.astype("<u2").tobytes()
    comp = zlib.compress(raw, 9)
    return base64.b64encode(comp).decode("ascii"), len(raw), len(comp), scale


def hillshade_preview(grid, meta, path):
    n = grid.shape[0]
    px = meta["pixel_m"]
    gy, gx = np.gradient(grid, px)
    az, alt = math.radians(315), math.radians(40)
    slope = np.arctan(np.hypot(gx, gy) * 1.5)
    aspect = np.arctan2(-gx, gy)
    hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    hs = np.clip(hs, 0, 1)
    e = (grid - grid.min()) / max(1e-6, grid.max() - grid.min())
    rgb = np.stack([hs * (0.35 + 0.65 * e), hs * (0.55 + 0.35 * e), hs * (0.75 - 0.25 * e)], -1)
    water = grid <= 0.5
    rgb[water] = [0.05, 0.15, 0.35]
    img = (np.clip(rgb, 0, 1) * 255).astype(np.uint8)
    # graticule every 0.1 deg
    for k in range(-50, 51):
        la = round(meta["lat"] + k * 0.1, 1)
        if meta["lat_min"] < la < meta["lat_max"]:
            i = int((meta["lat_max"] - la) / (meta["lat_max"] - meta["lat_min"]) * n)
            img[i, ::2] = [255, 60, 60] if abs(la * 10 % 5) < 1e-6 else [255, 200, 0]
        lo = round(meta["lon"] + k * 0.1, 1)
        if meta["lon_min"] < lo < meta["lon_max"]:
            j = int((lo - meta["lon_min"]) / (meta["lon_max"] - meta["lon_min"]) * n)
            img[::2, j] = [255, 60, 60] if abs(lo * 10 % 5) < 1e-6 else [255, 200, 0]
    Image.fromarray(img).resize((n * 2, n * 2), Image.NEAREST).save(path)


def globe_mask(cache, out_w=720, out_h=360):
    z = 2
    mos = mosaic(z, 0, 3, 0, 3, cache)  # 1024 x 1024 web mercator
    lat = 90.0 - (np.arange(out_h) + 0.5) * (180.0 / out_h)
    lon = -180.0 + (np.arange(out_w) + 0.5) * (360.0 / out_w)
    LON, LAT = np.meshgrid(lon, lat)
    LATc = np.clip(LAT, -85.0, 85.0)
    px, py = lonlat_to_global_px(LON, LATc, z)
    e = bilinear(mos, px, py)
    e[LAT > 85.0] = -100.0
    e[LAT < -85.0] = 2500.0  # Antarctic plateau
    u8 = np.where(e > 0.0, np.clip(1 + e / 25.0, 1, 255), 0).astype(np.uint8)
    comp = zlib.compress(u8.tobytes(), 9)
    return dict(w=out_w, h=out_h, scale_m=25.0, data=base64.b64encode(comp).decode("ascii")), u8


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=384)
    ap.add_argument("--cache", default=None)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data"))
    ap.add_argument("--no-globe", action="store_true")
    ap.add_argument("sites", nargs="*")
    a = ap.parse_args()
    cache = a.cache or os.path.join(a.out, "_tiles")
    os.makedirs(cache, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    names = a.sites or list(SITES)
    for name in names:
        site = SITES[name]
        if site.get("source") == "cop90":
            grid, meta = site_grid_cop90(site, a.n, cache)
        else:
            grid, meta = site_grid(site, a.n, cache)
            meta["source"] = "AWS Terrain Tiles (Terrarium): SRTM / USGS 3DEP / GMTED2010 / INEGI"
        grid, nfix = despike(grid)
        if nfix:
            print(f"  {name}: replaced {nfix} spike cells with the local median")
        for box in site.get("fix", []):
            grid = inpaint_box(grid, *box)
            print(f"  {name}: inpainted artefact box {box}")
        b64, nraw, ncomp, scale = encode_grid(grid)
        meta.update(name=name, emin=float(grid.min()), emax=float(grid.max()), data=b64, scale=scale,
                    encoding="u16=(m+1000)*scale, row-delta mod 65536 uint16 LE, zlib, base64")
        with open(os.path.join(a.out, f"dem_{name}.json"), "w") as f:
            json.dump(meta, f)
        hillshade_preview(grid, meta, os.path.join(a.out, f"dem_{name}_preview.png"))
        print(f"{name:12s} elev {grid.min():8.1f} .. {grid.max():8.1f} m   px {meta['pixel_m']:.1f} m   "
              f"raw {nraw/1024:.0f} KB -> zlib {ncomp/1024:.0f} KB")
    if not a.no_globe:
        g, u8 = globe_mask(cache)
        with open(os.path.join(a.out, "globe_landmask.json"), "w") as f:
            json.dump(g, f)
        Image.fromarray((u8 > 0).astype(np.uint8) * 255).save(os.path.join(a.out, "globe_landmask_preview.png"))
        print("globe mask", g["w"], "x", g["h"], "b64", len(g["data"]) // 1024, "KB")


if __name__ == "__main__":
    sys.exit(main())
