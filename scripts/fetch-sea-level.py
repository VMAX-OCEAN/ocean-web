#!/usr/bin/env python3
"""
fetch-sea-level.py — Download sea level data from Copernicus Marine, convert to
raw Float32 binary (.bin), package, upload to GitHub Releases, delete local.

Dataset: c3s_obs-sl_glo_phy-ssh_my_twosat-l4-duacs-0.25deg_P1M-m
  - Variables: sla (sea level anomaly, meters)
  - Resolution: 0.25 deg x 0.25 deg (global)
  - Time: monthly, 1993 to 2022
  - DOI: 10.48670/moi-00145

Pipeline:
  1. Download NetCDF from Copernicus via copernicusmarine.subset()
  2. Convert each time slice to raw Float32 .bin files
  3. Write meta.json with grid, times, units, source DOI
  4. Zip all .bin + meta.json
  5. Upload to GitHub Release via gh CLI
  6. Delete local NetCDF and .bin files

Usage:
  python scripts/fetch-sea-level.py --username USER --password PASS
"""

import argparse
import json
import shutil
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import xarray as xr

# --- Config ---

REPO_OWNER = "VMAX-OCEAN"
REPO_NAME = "ocean-web"
RELEASE_TAG = "data-v1"

SL_DATASET_ID = "c3s_obs-sl_glo_phy-ssh_my_twosat-l4-duacs-0.25deg_P1M-m"
SL_VARIABLES = ["sla"]
SL_DOI = "10.48670/moi-00145"

OUTPUT_DIR = Path("public/data/sea-level")
DOWNLOAD_DIR = Path("downloads/sea-level")
ZIP_DIR = Path("downloads/sea-level-zip")

# --- Helpers ---

def log(msg):
    print(f"[fetch-sea-level] {msg}", flush=True)


def download_dataset(dataset_id, variables, output_filename, username, password,
                      min_lon=-180, max_lon=180, min_lat=-90, max_lat=90,
                      start_dt=None, end_dt=None, dry_run=False):
    """Download a dataset from Copernicus Marine as NetCDF."""
    import copernicusmarine

    kwargs = dict(
        dataset_id=dataset_id,
        variables=variables,
        minimum_longitude=min_lon,
        maximum_longitude=max_lon,
        minimum_latitude=min_lat,
        maximum_latitude=max_lat,
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

    if dry_run:
        kwargs["dry_run"] = True
        log(f"DRY RUN: subset(dataset_id={dataset_id}, vars={variables})")
        result = copernicusmarine.subset(**kwargs)
        log(f"DRY RUN result: {result}")
        return None

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
    """Convert a NetCDF variable to raw Float32 .bin files, one per time slice."""
    import pandas as pd

    log(f"Opening NetCDF: {nc_path}")
    ds = xr.open_dataset(nc_path)

    log(f"Variables: {list(ds.data_vars)}")
    log(f"Coordinates: {list(ds.coords)}")

    # Find the variable (case-insensitive)
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

    # Find lat/lon/time coordinates
    lat_name = lon_name = time_name = None
    for c in da.coords:
        cl = c.lower()
        if cl in ("lat", "latitude"):
            lat_name = c
        elif cl in ("lon", "longitude"):
            lon_name = c
        elif cl in ("time", "datetime", "t"):
            time_name = c

    if lat_name is None or lon_name is None:
        log(f"ERROR: Could not find lat/lon. Available: {list(da.coords)}")
        return None

    lats = da[lat_name].values
    lons = da[lon_name].values
    log(f"  Lat: {lats.min():.2f} to {lats.max():.2f}, count={len(lats)}")
    log(f"  Lon: {lons.min():.2f} to {lons.max():.2f}, count={len(lons)}")

    # Ensure lat south-to-north
    if lats[0] > lats[-1]:
        log("  Flipping lat to south-to-north")
        da = da.isel({lat_name: slice(None, None, -1)})
        lats = da[lat_name].values
    # Ensure lon west-to-east
    if lons[0] > lons[-1]:
        log("  Flipping lon to west-to-east")
        da = da.isel({lon_name: slice(None, None, -1)})
        lons = da[lon_name].values

    n_lat = len(lats)
    n_lon = len(lons)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Handle datasets with no time dimension (static maps)
    if time_name is None:
        log("  No time dimension — treating as single static slice")
        arr = da.values.astype(np.float32)
        arr = np.where(np.isfinite(arr), arr, np.float32(np.nan))

        filename = f"{output_prefix}_t0000.bin"
        filepath = OUTPUT_DIR / filename
        arr.tofile(str(filepath))

        log(f"  Wrote {filename}: shape={arr.shape}, "
            f"min={np.nanmin(arr):.6f}, max={np.nanmax(arr):.6f}, "
            f"size={filepath.stat().st_size} bytes")

        meta = {
            "dataset": dataset_label,
            "variable": var_name,
            "grid": {
                "lat": {"min": float(lats.min()), "max": float(lats.max()), "count": n_lat},
                "lon": {"min": float(lons.min()), "max": float(lons.max()), "count": n_lon},
            },
            "times": ["static"],
            "depths": [0],
            "format": "Float32Array, row-major (lat[0]lon[0], lat[0]lon[1], ...)",
            "fillValue": "NaN",
            "source": f"Copernicus Marine {dataset_label}",
            "doi": doi,
            "files": [filename],
        }
        ds.close()
        return meta

    # Normal case: has time dimension
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
            log(f"  Wrote {filename}: shape={arr.shape}, "
                f"min={np.nanmin(arr):.6f}, max={np.nanmax(arr):.6f}, "
                f"size={filepath.stat().st_size} bytes")

    # Build metadata
    time_strings = []
    for t in times:
        try:
            ts = pd.Timestamp(t)
            time_strings.append(ts.isoformat() + "Z")
        except Exception:
            time_strings.append(str(t))

    meta = {
        "dataset": dataset_label,
        "variable": var_name,
        "grid": {
            "lat": {"min": float(lats.min()), "max": float(lats.max()), "count": n_lat},
            "lon": {"min": float(lons.min()), "max": float(lons.max()), "count": n_lon},
        },
        "times": time_strings,
        "depths": [0],
        "format": "Float32Array, row-major (lat[0]lon[0], lat[0]lon[1], ...)",
        "fillValue": "NaN",
        "source": f"Copernicus Marine {dataset_label}",
        "doi": doi,
        "files": files,
    }

    ds.close()
    return meta


def package_and_upload(meta):
    """Zip all .bin files + meta.json, upload to GitHub Release."""
    ZIP_DIR.mkdir(parents=True, exist_ok=True)

    # Write meta.json
    (OUTPUT_DIR / "meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8")

    # Create zip
    zip_path = ZIP_DIR / "sea-level-data.zip"
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

    # Check if release exists, create if not
    log(f"Checking for GitHub Release: {RELEASE_TAG}")
    check = subprocess.run(
        ["gh", "release", "view", RELEASE_TAG,
         "--repo", f"{REPO_OWNER}/{REPO_NAME}"],
        capture_output=True, text=True
    )
    if check.returncode != 0:
        log(f"Release not found, creating: {RELEASE_TAG}")
        result = subprocess.run(
            ["gh", "release", "create", RELEASE_TAG,
             "--repo", f"{REPO_OWNER}/{REPO_NAME}",
             "--title", "Ocean Data v1",
             "--notes", "Ocean datasets for SIH26067 visualization platform"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            log(f"Release create: {result.stdout} {result.stderr}")
    else:
        log(f"Release already exists: {RELEASE_TAG}")

    # Upload asset
    log(f"Uploading to release: {RELEASE_TAG}")
    result = subprocess.run(
        ["gh", "release", "upload", RELEASE_TAG, str(zip_path),
         "--repo", f"{REPO_OWNER}/{REPO_NAME}",
         "--clobber"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        log(f"Upload error: {result.stderr}")
        raise RuntimeError(f"gh release upload failed: {result.stderr}")
    log(f"Upload complete: {result.stdout}")


def cleanup_local():
    """Delete downloaded NetCDF and local .bin files."""
    log("Cleaning up local files...")
    for d in [DOWNLOAD_DIR, OUTPUT_DIR, ZIP_DIR]:
        if d.exists():
            shutil.rmtree(d)
            log(f"  Deleted: {d}")
    log("Cleanup complete.")


# --- Main ---

def main():
    parser = argparse.ArgumentParser(description="Fetch sea level data from Copernicus Marine")
    parser.add_argument("--username", default=None, help="Copernicus Marine username")
    parser.add_argument("--password", default=None, help="Copernicus Marine password")
    parser.add_argument("--dry-run", action="store_true", help="Don't download or upload")
    parser.add_argument("--cleanup", action="store_true", default=True)
    parser.add_argument("--no-cleanup", dest="cleanup", action="store_false")
    parser.add_argument("--start", default="2019-01-01T00:00:00", help="Start datetime")
    parser.add_argument("--end", default="2019-12-31T00:00:00", help="End datetime")
    args = parser.parse_args()

    log("=" * 60)
    log("Sea Level Data Pipeline")
    log("=" * 60)

    log("")
    log(">>> Step 1: Download sea level dataset (global, monthly)")
    nc = download_dataset(
        dataset_id=SL_DATASET_ID,
        variables=SL_VARIABLES,
        output_filename="sea_level.nc",
        username=args.username, password=args.password,
        start_dt=args.start,
        end_dt=args.end,
        dry_run=args.dry_run,
    )

    meta = None
    if nc and not args.dry_run:
        log("")
        log(">>> Step 2: Convert sea level to .bin")
        meta = convert_netcdf_to_bin(
            nc_path=nc, variable_name="sla",
            output_prefix="sla",
            dataset_label=SL_DATASET_ID, doi=SL_DOI,
        )

    if not args.dry_run and meta:
        log("")
        log(">>> Step 3: Package and upload to GitHub Releases")
        package_and_upload(meta)

    if args.cleanup and not args.dry_run:
        log("")
        log(">>> Step 4: Cleanup local files")
        cleanup_local()

    log("")
    log("=" * 60)
    log("Pipeline complete!")
    log("=" * 60)


if __name__ == "__main__":
    main()
