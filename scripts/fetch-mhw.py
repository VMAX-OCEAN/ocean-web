#!/usr/bin/env python3
"""
fetch-mhw.py — Derive Marine Heat Waves from Copernicus SST reanalysis.

MHW definition (Hobday et al. 2016):
  MHW intensity = SST_current - 90th_percentile(SST_baseline, per month)

Dataset: cmems_mod_glo_phy-all_my_0.25deg_P1M-m (ensemble reanalysis)
  - Variable: thetao_glor (sea surface temperature, °C)
  - Baseline: 2014-2018 (5 years monthly)
  - Current: 2019 (monthly)
  - Coverage: Indian Ocean (30-120E, 30S-30N)
  - DOI: 10.48670/moi-00024

Pipeline: download baseline → download current → compute MHW → convert to .bin
          → zip → upload to GitHub Release → cleanup.
"""

import argparse
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import xarray as xr

REPO_OWNER = "VMAX-OCEAN"
REPO_NAME = "ocean-web"
RELEASE_TAG = "data-v1"

MHW_DATASET_ID = "cmems_mod_glo_phy-all_my_0.25deg_P1M-m"
MHW_VARIABLE = "thetao_glor"
MHW_DOI = "10.48670/moi-00024"

# Global coverage
MIN_LON, MAX_LON = -180, 180
MIN_LAT, MAX_LAT = -80, 90

OUTPUT_DIR = Path("public/data/mhw")
DOWNLOAD_DIR = Path("downloads/mhw")
ZIP_DIR = Path("downloads/mhw-zip")


def log(msg):
    print(f"[fetch-mhw] {msg}", flush=True)


def download_sst(username, password, start_dt, end_dt, filename):
    import copernicusmarine

    kwargs = dict(
        dataset_id=MHW_DATASET_ID,
        variables=[MHW_VARIABLE],
        minimum_longitude=MIN_LON,
        maximum_longitude=MAX_LON,
        minimum_latitude=MIN_LAT,
        maximum_latitude=MAX_LAT,
        minimum_depth=0,
        maximum_depth=2,
        output_filename=filename,
        output_directory=str(DOWNLOAD_DIR),
        file_format="netcdf",
        overwrite=True,
    )
    if start_dt:
        kwargs["start_datetime"] = start_dt
    if end_dt:
        kwargs["end_datetime"] = end_dt
    if username:
        kwargs["username"] = username
    if password:
        kwargs["password"] = password

    log(f"Downloading SST {start_dt} to {end_dt}...")
    result = copernicusmarine.subset(**kwargs)
    log(f"Download complete: file_size={result.file_size:.1f} MB")

    filepath = DOWNLOAD_DIR / filename
    if not filepath.exists():
        candidates = list(DOWNLOAD_DIR.glob(f"*{filename}*"))
        if candidates:
            filepath = candidates[0]
        else:
            raise FileNotFoundError(f"Downloaded file not found: {filename}")

    log(f"Downloaded to: {filepath} ({filepath.stat().st_size / 1e6:.1f} MB)")
    return filepath


def compute_mhw(baseline_path, current_path):
    """Compute MHW intensity from baseline and current SST."""
    import pandas as pd

    log(f"Opening baseline: {baseline_path}")
    ds_base = xr.open_dataset(baseline_path)

    log(f"Opening current: {current_path}")
    ds_curr = xr.open_dataset(current_path)

    # Find variable
    var_name = None
    for v in ds_base.data_vars:
        if v.lower() == MHW_VARIABLE.lower():
            var_name = v
            break
    if var_name is None:
        raise ValueError(f"Variable '{MHW_VARIABLE}' not found. Available: {list(ds_base.data_vars)}")

    # Find coordinates
    lat_name = lon_name = time_name = depth_name = None
    for c in ds_base.coords:
        cl = c.lower()
        if cl in ("lat", "latitude"):
            lat_name = c
        elif cl in ("lon", "longitude"):
            lon_name = c
        elif cl in ("time", "datetime", "t"):
            time_name = c
        elif cl in ("depth", "z", "lev"):
            depth_name = c

    # Select surface depth if present
    if depth_name and depth_name in ds_base[var_name].dims:
        ds_base = ds_base.isel({depth_name: 0})
    if depth_name and depth_name in ds_curr[var_name].dims:
        ds_curr = ds_curr.isel({depth_name: 0})

    base_data = ds_base[var_name]
    curr_data = ds_curr[var_name]

    lats = base_data[lat_name].values
    lons = base_data[lon_name].values

    # Ensure south-to-north, west-to-east
    if lats[0] > lats[-1]:
        base_data = base_data.isel({lat_name: slice(None, None, -1)})
        curr_data = curr_data.isel({lat_name: slice(None, None, -1)})
        lats = base_data[lat_name].values
    if lons[0] > lons[-1]:
        base_data = base_data.isel({lon_name: slice(None, None, -1)})
        curr_data = curr_data.isel({lon_name: slice(None, None, -1)})
        lons = base_data[lon_name].values

    n_lat = len(lats)
    n_lon = len(lons)

    # Get baseline times and compute 90th percentile per month
    base_times = base_data[time_name].values
    base_months = pd.DatetimeIndex(base_times).month

    log(f"Baseline: {len(base_times)} steps, months: {sorted(set(base_months))}")

    # Group by month and compute 90th percentile
    threshold = np.zeros((12, n_lat, n_lon), dtype=np.float32)
    for m in range(1, 13):
        mask = base_months == m
        if not mask.any():
            log(f"  Month {m}: no baseline data, skipping")
            continue
        month_data = base_data.isel({time_name: np.where(mask)[0]}).values
        # 90th percentile along time axis
        with np.errstate(invalid="ignore"):
            pct90 = np.nanpercentile(month_data, 90, axis=0)
        threshold[m - 1] = pct90
        log(f"  Month {m}: 90th pct range [{np.nanmin(pct90):.2f}, {np.nanmax(pct90):.2f}] °C")

    # Get current times and compute MHW intensity
    curr_times = curr_data[time_name].values
    curr_months = pd.DatetimeIndex(curr_times).month

    log(f"Current: {len(curr_times)} steps")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    files = []
    time_strings = []
    mhw_stats = []

    for t_idx in range(len(curr_times)):
        month = curr_months[t_idx]
        sst = curr_data.isel({time_name: t_idx}).values.astype(np.float32)
        thresh = threshold[month - 1]

        # MHW intensity = SST - 90th percentile (only where positive)
        mhw = sst - thresh
        mhw = np.where(mhw > 0, mhw, 0).astype(np.float32)
        mhw = np.where(np.isfinite(sst), mhw, np.float32(np.nan))

        filename = f"mhw_t{t_idx:04d}.bin"
        filepath = OUTPUT_DIR / filename
        mhw.tofile(str(filepath))
        files.append(filename)

        ts = pd.Timestamp(curr_times[t_idx])
        time_strings.append(ts.isoformat() + "Z")

        stats = {
            "time": ts.isoformat() + "Z",
            "month": int(month),
            "min": float(np.nanmin(mhw)),
            "max": float(np.nanmax(mhw)),
            "mean": float(np.nanmean(mhw)),
            "coverage_pct": float(np.nanmean(mhw > 0) * 100),
        }
        mhw_stats.append(stats)
        log(f"  Wrote {filename}: month={month}, range=[{stats['min']:.2f}, {stats['max']:.2f}], coverage={stats['coverage_pct']:.1f}%")

    meta = {
        "dataset": MHW_DATASET_ID,
        "variable": "mhw_intensity",
        "description": "Marine Heat Wave intensity (SST - 90th percentile of 2014-2018 baseline)",
        "baseline_period": "2014-2018",
        "current_period": "2019-2024",
        "method": "Hobday et al. 2016 - 90th percentile threshold",
        "grid": {
            "lat": {"min": float(lats.min()), "max": float(lats.max()), "count": n_lat},
            "lon": {"min": float(lons.min()), "max": float(lons.max()), "count": n_lon},
        },
        "times": time_strings,
        "depths": [0],
        "units": "degrees_C",
        "format": "Float32Array, row-major",
        "fillValue": "NaN",
        "source": f"Copernicus Marine {MHW_DATASET_ID}",
        "doi": MHW_DOI,
        "files": files,
        "stats": mhw_stats,
    }

    ds_base.close()
    ds_curr.close()
    return meta


def package_and_upload(meta):
    ZIP_DIR.mkdir(parents=True, exist_ok=True)

    (OUTPUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    zip_path = ZIP_DIR / "mhw-data.zip"
    log(f"Creating zip: {zip_path}")
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(OUTPUT_DIR.iterdir()):
            if f.is_file():
                zf.write(f, f.name)
                log(f"  Added: {f.name} ({f.stat().st_size} bytes)")

    zip_size = zip_path.stat().st_size / 1e6
    log(f"Zip size: {zip_size:.1f} MB")

    # Check if release exists
    check = subprocess.run(
        ["gh", "release", "view", RELEASE_TAG, "--repo", f"{REPO_OWNER}/{REPO_NAME}"],
        capture_output=True, text=True,
    )
    if check.returncode != 0:
        subprocess.run(
            ["gh", "release", "create", RELEASE_TAG, "--repo", f"{REPO_OWNER}/{REPO_NAME}",
             "--title", "Ocean Data v1", "--notes", "Ocean datasets for SIH26067"],
            capture_output=True, text=True,
        )

    log(f"Uploading to release: {RELEASE_TAG}")
    result = subprocess.run(
        ["gh", "release", "upload", RELEASE_TAG, str(zip_path),
         "--repo", f"{REPO_OWNER}/{REPO_NAME}", "--clobber"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh release upload failed: {result.stderr}")
    log("Upload complete")


def cleanup_local():
    log("Cleaning up local files...")
    for d in [DOWNLOAD_DIR, OUTPUT_DIR, ZIP_DIR]:
        if d.exists():
            shutil.rmtree(d)
            log(f"  Deleted: {d}")
    log("Cleanup complete.")


def main():
    parser = argparse.ArgumentParser(description="Fetch Marine Heat Wave data")
    parser.add_argument("--username", default=None)
    parser.add_argument("--password", default=None)
    parser.add_argument("--no-cleanup", dest="cleanup", action="store_false", default=True)
    args = parser.parse_args()

    log("=" * 60)
    log("Marine Heat Wave Pipeline")
    log("=" * 60)

    # Step 1: Download baseline (2014-2018)
    log(">>> Step 1: Download baseline SST (2014-2018)")
    baseline_nc = download_sst(
        args.username, args.password,
        "2014-01-01T00:00:00", "2018-12-31T00:00:00",
        "mhw_baseline.nc",
    )

    # Step 2: Download current (2019-2024)
    log(">>> Step 2: Download current SST (2019-2024)")
    current_nc = download_sst(
        args.username, args.password,
        "2019-01-01T00:00:00", "2024-12-31T00:00:00",
        "mhw_current.nc",
    )

    # Step 3: Compute MHW
    log(">>> Step 3: Compute MHW intensity")
    meta = compute_mhw(baseline_nc, current_nc)

    # Step 4: Package and upload
    log(">>> Step 4: Package and upload")
    package_and_upload(meta)

    # Step 5: Cleanup
    if args.cleanup:
        log(">>> Step 5: Cleanup")
        cleanup_local()

    log("Pipeline complete!")


if __name__ == "__main__":
    main()
