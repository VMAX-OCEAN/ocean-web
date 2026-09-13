#!/usr/bin/env python3
"""
fetch-sst.py — Download Sea Surface Temperature from Copernicus Marine.
Dataset: cmems_mod_glo_phy_my_0.083deg_P1D-m (monthly mean)
  - Variable: thetao (temperature, °C) at surface (depth 0)
  - Coverage: Global
  - Time: monthly, 2019
  - DOI: 10.48670/moi-00021

Pipeline: download → convert to .bin → zip → upload to GitHub Release → cleanup.
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

SST_DATASET_ID = "cmems_mod_glo_phy-all_my_0.25deg_P1M-m"
SST_VARIABLES = ["thetao_glor"]
SST_DOI = "10.48670/moi-00024"

OUTPUT_DIR = Path("public/data/sst")
DOWNLOAD_DIR = Path("downloads/sst")
ZIP_DIR = Path("downloads/sst-zip")


def log(msg):
    print(f"[fetch-sst] {msg}", flush=True)


def download_dataset(dataset_id, variables, output_filename, username, password,
                      min_lon=-180, max_lon=180, min_lat=-80, max_lat=90,
                      start_dt=None, end_dt=None):
    import copernicusmarine

    kwargs = dict(
        dataset_id=dataset_id,
        variables=variables,
        minimum_longitude=min_lon,
        maximum_longitude=max_lon,
        minimum_latitude=min_lat,
        maximum_latitude=max_lat,
        minimum_depth=0,
        maximum_depth=2,
        output_filename=output_filename,
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

    log(f"Downloading {dataset_id} variables={variables}...")
    result = copernicusmarine.subset(**kwargs)
    log(f"Download complete: {result}")

    filepath = DOWNLOAD_DIR / output_filename
    if not filepath.exists():
        filepath = DOWNLOAD_DIR / (output_filename + ".nc")
    if not filepath.exists():
        candidates = list(DOWNLOAD_DIR.glob(f"*{output_filename}*"))
        if candidates:
            filepath = candidates[0]
        else:
            raise FileNotFoundError(f"Downloaded file not found: {output_filename}")

    log(f"Downloaded to: {filepath} ({filepath.stat().st_size / 1e6:.1f} MB)")
    return filepath


def convert_netcdf_to_bin(nc_path, variable_name, output_prefix, dataset_label, doi):
    import pandas as pd

    log(f"Opening NetCDF: {nc_path}")
    ds = xr.open_dataset(nc_path)

    log(f"Variables: {list(ds.data_vars)}")
    log(f"Coordinates: {list(ds.coords)}")

    var_name = None
    for v in ds.data_vars:
        if v.lower() == variable_name.lower():
            var_name = v
            break
    if var_name is None:
        log(f"ERROR: Variable '{variable_name}' not found. Available: {list(ds.data_vars)}")
        return None

    da = ds[var_name]
    log(f"Variable: {var_name}, shape: {da.shape}, dims: {da.dims}")

    lat_name = lon_name = time_name = depth_name = None
    for c in da.coords:
        cl = c.lower()
        if cl in ("lat", "latitude"):
            lat_name = c
        elif cl in ("lon", "longitude"):
            lon_name = c
        elif cl in ("time", "datetime", "t"):
            time_name = c
        elif cl in ("depth", "z", "lev"):
            depth_name = c

    if lat_name is None or lon_name is None:
        log(f"ERROR: Could not find lat/lon. Available: {list(da.coords)}")
        return None

    lats = da[lat_name].values
    lons = da[lon_name].values
    log(f"  Lat: {lats.min():.2f} to {lats.max():.2f}, count={len(lats)}")
    log(f"  Lon: {lons.min():.2f} to {lons.max():.2f}, count={len(lons)}")

    # If depth dimension exists, select surface
    if depth_name and depth_name in da.dims:
        log(f"  Selecting surface depth (index 0)")
        da = da.isel({depth_name: 0})

    # Ensure lat south-to-north
    if lats[0] > lats[-1]:
        log("  Flipping lat to south-to-north")
        da = da.isel({lat_name: slice(None, None, -1)})
        lats = da[lat_name].values
    if lons[0] > lons[-1]:
        log("  Flipping lon to west-to-east")
        da = da.isel({lon_name: slice(None, None, -1)})
        lons = da[lon_name].values

    n_lat = len(lats)
    n_lon = len(lons)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if time_name is None:
        log("  No time dimension — treating as single static slice")
        arr = da.values.astype(np.float32)
        arr = np.where(np.isfinite(arr), arr, np.float32(np.nan))
        filename = f"{output_prefix}_t0000.bin"
        filepath = OUTPUT_DIR / filename
        arr.tofile(str(filepath))
        log(f"  Wrote {filename}: min={np.nanmin(arr):.4f}, max={np.nanmax(arr):.4f}")
        meta = {
            "dataset": dataset_label, "variable": var_name,
            "grid": {"lat": {"min": float(lats.min()), "max": float(lats.max()), "count": n_lat},
                     "lon": {"min": float(lons.min()), "max": float(lons.max()), "count": n_lon}},
            "times": ["static"], "depths": [0],
            "format": "Float32Array, row-major", "fillValue": "NaN",
            "source": f"Copernicus Marine {dataset_label}", "doi": doi,
            "files": [filename],
        }
        ds.close()
        return meta

    times = da[time_name].values
    log(f"  Time: {len(times)} steps, first={times[0]}, last={times[-1]}")
    n_time = len(times)

    files = []
    for t in range(n_time):
        slice_data = da.isel({time_name: t}).values
        arr = slice_data.astype(np.float32)
        arr = np.where(np.isfinite(arr), arr, np.float32(np.nan))
        filename = f"{output_prefix}_t{t:04d}.bin"
        filepath = OUTPUT_DIR / filename
        arr.tofile(str(filepath))
        files.append(filename)
        if t == 0 or t == n_time - 1 or (t + 1) % 20 == 0:
            log(f"  Wrote {filename}: min={np.nanmin(arr):.4f}, max={np.nanmax(arr):.4f}")

    time_strings = []
    for t in times:
        try:
            ts = pd.Timestamp(t)
            time_strings.append(ts.isoformat() + "Z")
        except Exception:
            time_strings.append(str(t))

    meta = {
        "dataset": dataset_label, "variable": var_name,
        "grid": {"lat": {"min": float(lats.min()), "max": float(lats.max()), "count": n_lat},
                 "lon": {"min": float(lons.min()), "max": float(lons.max()), "count": n_lon}},
        "times": time_strings, "depths": [0],
        "format": "Float32Array, row-major", "fillValue": "NaN",
        "source": f"Copernicus Marine {dataset_label}", "doi": doi,
        "files": files,
    }
    ds.close()
    return meta


def package_and_upload(meta):
    ZIP_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    zip_path = ZIP_DIR / "sst-data.zip"
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
        capture_output=True, text=True
    )
    if check.returncode != 0:
        subprocess.run(
            ["gh", "release", "create", RELEASE_TAG, "--repo", f"{REPO_OWNER}/{REPO_NAME}",
             "--title", "Ocean Data v1", "--notes", "Ocean datasets for SIH26067"],
            capture_output=True, text=True
        )

    log(f"Uploading to release: {RELEASE_TAG}")
    result = subprocess.run(
        ["gh", "release", "upload", RELEASE_TAG, str(zip_path),
         "--repo", f"{REPO_OWNER}/{REPO_NAME}", "--clobber"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh release upload failed: {result.stderr}")
    log(f"Upload complete")


def cleanup_local():
    log("Cleaning up local files...")
    for d in [DOWNLOAD_DIR, OUTPUT_DIR, ZIP_DIR]:
        if d.exists():
            shutil.rmtree(d)
            log(f"  Deleted: {d}")
    log("Cleanup complete.")


def main():
    parser = argparse.ArgumentParser(description="Fetch SST data from Copernicus Marine")
    parser.add_argument("--username", default=None)
    parser.add_argument("--password", default=None)
    parser.add_argument("--start", default="2019-01-01T00:00:00")
    parser.add_argument("--end", default="2019-12-31T00:00:00")
    parser.add_argument("--no-cleanup", dest="cleanup", action="store_false", default=True)
    args = parser.parse_args()

    log("=" * 60)
    log("SST Data Pipeline")
    log("=" * 60)

    log(">>> Step 1: Download SST (global, monthly, surface)")
    nc = download_dataset(
        dataset_id=SST_DATASET_ID,
        variables=SST_VARIABLES,
        output_filename="sst.nc",
        username=args.username, password=args.password,
        start_dt=args.start, end_dt=args.end,
        min_lon=-180, max_lon=180,
        min_lat=-80, max_lat=90,
    )

    meta = None
    if nc:
        log(">>> Step 2: Convert SST to .bin")
        meta = convert_netcdf_to_bin(
            nc_path=nc, variable_name="thetao_glor",
            output_prefix="sst",
            dataset_label=SST_DATASET_ID, doi=SST_DOI,
        )

    if meta:
        log(">>> Step 3: Package and upload")
        package_and_upload(meta)

    if args.cleanup:
        log(">>> Step 4: Cleanup")
        cleanup_local()

    log("Pipeline complete!")


if __name__ == "__main__":
    main()
