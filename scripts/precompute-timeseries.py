#!/usr/bin/env python3
"""
Pre-aggregate time series for all ocean health variables.

Reads the .bin files from each dataset's output directory and computes
the global aggregation (mean, extent, percentage) for each time step.
Outputs a single JSON file per variable: <variable>-timeseries.json

These JSON files are small (~2KB each) and ship alongside the .bin files
in the GitHub Release ZIPs. The frontend reads them instead of fetching
all 72 .bin files and aggregating client-side, making chart load instant.
"""

import json
import math
import struct
import sys
from pathlib import Path

# Earth radius in km
R_KM = 6371.0
DEG_TO_RAD = math.pi / 180.0


def compute_cell_areas(south, north, height, width):
    """Compute cell area (km²) for each row of a regular lat-lon grid."""
    dlat_deg = (north - south) / height
    dlon_deg = 360.0 / width  # assume global longitude
    areas = []
    for row in range(height):
        lat1 = south + row * dlat_deg
        lat2 = lat1 + dlat_deg
        dlon_rad = dlon_deg * DEG_TO_RAD
        sin_diff = math.sin(lat2 * DEG_TO_RAD) - math.sin(lat1 * DEG_TO_RAD)
        areas.append(R_KM * R_KM * dlon_rad * sin_diff)
    return areas


def read_bin(filepath):
    """Read a .bin file as a Float32Array."""
    with open(filepath, 'rb') as f:
        data = f.read()
    count = len(data) // 4
    return struct.unpack(f'{count}f', data), count


def aggregate_mean(data, width, height, south, north, west, east, area_weighted=True):
    """Area-weighted or simple mean of finite values."""
    if area_weighted:
        areas = compute_cell_areas(south, north, height, width)
        weighted_sum = 0.0
        weight_sum = 0.0
        for row in range(height):
            w = areas[row]
            for col in range(width):
                v = data[row * width + col]
                if math.isfinite(v):
                    weighted_sum += v * w
                    weight_sum += w
        return weighted_sum / weight_sum if weight_sum > 0 else float('nan')
    else:
        total = 0.0
        count = 0
        for v in data:
            if math.isfinite(v):
                total += v
                count += 1
        return total / count if count > 0 else float('nan')


def aggregate_extent(data, width, height, south, north, west, east, threshold=0.15):
    """Sum cell areas where value > threshold (million km²)."""
    areas = compute_cell_areas(south, north, height, width)
    total_area = 0.0
    for row in range(height):
        for col in range(width):
            v = data[row * width + col]
            if math.isfinite(v) and v > threshold:
                total_area += areas[row]
    return total_area / 1e6  # km² → million km²


def aggregate_percentage(data):
    """Percentage of finite cells where value > 0."""
    hw_count = 0
    valid_count = 0
    for v in data:
        if math.isfinite(v):
            valid_count += 1
            if v > 0:
                hw_count += 1
    return (hw_count / valid_count * 100) if valid_count > 0 else 0.0


# Dataset configurations — must match src/cesium/datasets.ts
DATASETS = {
    'sst': {
        'dir': 'downloads/sst-bin',
        'prefix': 'sst',
        'variable': 'sst',
        'grid': {'width': 1440, 'height': 681},
        'bbox': {'west': -180.0, 'south': -80.0, 'east': 179.75, 'north': 90.0},
        'times': 'monthly_2019_2024',
        'aggregation': 'mean',
        'area_weighted': True,
    },
    'mhw': {
        'dir': 'downloads/mhw-bin',
        'prefix': 'mhw',
        'variable': 'mhw',
        'grid': {'width': 1440, 'height': 681},
        'bbox': {'west': -180.0, 'south': -80.0, 'east': 179.75, 'north': 90.0},
        'times': 'monthly_2019_2024',
        'aggregation': 'percentage',
    },
    'sea_level': {
        'dir': 'downloads/sea-level-bin',
        'prefix': 'sla',
        'variable': 'sla',
        'grid': {'width': 1440, 'height': 720},
        'bbox': {'west': -179.875, 'south': -89.875, 'east': 179.875, 'north': 89.875},
        'times': 'monthly_2019_2025',
        'aggregation': 'mean',
        'area_weighted': True,
    },
    'ph_surface': {
        'dir': 'downloads/ph-bin',
        'prefix': 'ph_surface',
        'variable': 'ph_surface',
        'grid': {'width': 1440, 'height': 720},
        'bbox': {'west': -179.875, 'south': -89.875, 'east': 179.875, 'north': 89.875},
        'times': 'monthly_2019_2024',
        'aggregation': 'mean',
        'area_weighted': True,
    },
    'sea_ice_arctic': {
        'dir': 'downloads/sea-ice-bin',
        'prefix': 'ice_arctic',
        'variable': 'ice_arctic',
        'grid': {'width': 1440, 'height': 121},
        'bbox': {'west': -180.0, 'south': 60.0, 'east': 179.75, 'north': 90.0},
        'times': 'monthly_2019_2024',
        'aggregation': 'extent',
        'extent_threshold': 0.15,
    },
    'sea_ice_antarctic': {
        'dir': 'downloads/sea-ice-bin',
        'prefix': 'ice_antarctic',
        'variable': 'ice_antarctic',
        'grid': {'width': 1440, 'height': 81},
        'bbox': {'west': -180.0, 'south': -80.0, 'east': 179.75, 'north': -60.0},
        'times': 'monthly_2019_2024',
        'aggregation': 'extent',
        'extent_threshold': 0.15,
    },
}


def monthly_times(start_year, start_month, end_year, end_month):
    times = []
    y, m = start_year, start_month
    while y < end_year or (y == end_year and m <= end_month):
        times.append(f"{y}-{m:02d}-01T00:00:00Z")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return times


TIME_RANGES = {
    'monthly_2019_2024': monthly_times(2019, 1, 2024, 12),
    'monthly_2019_2025': monthly_times(2019, 1, 2025, 12),
}


def process_dataset(dataset_id, config):
    """Process a dataset and output a timeseries JSON."""
    data_dir = Path(config['dir'])
    if not data_dir.exists():
        print(f"  SKIP: {data_dir} does not exist")
        return None

    times = TIME_RANGES[config['times']]
    grid = config['grid']
    bbox = config['bbox']
    prefix = config['prefix']

    points = []
    for t_idx, time_str in enumerate(times):
        bin_file = data_dir / f"{prefix}_t{t_idx:04d}.bin"
        if not bin_file.exists():
            print(f"  SKIP: {bin_file.name} not found")
            points.append({'date': time_str, 'value': None})
            continue

        data, count = read_bin(bin_file)
        if count != grid['width'] * grid['height']:
            print(f"  WARN: {bin_file.name} has {count} values, expected {grid['width'] * grid['height']}")

        agg = config['aggregation']
        if agg == 'mean':
            value = aggregate_mean(data, grid['width'], grid['height'],
                                   bbox['south'], bbox['north'],
                                   bbox['west'], bbox['east'],
                                   config.get('area_weighted', True))
        elif agg == 'extent':
            value = aggregate_extent(data, grid['width'], grid['height'],
                                     bbox['south'], bbox['north'],
                                     bbox['west'], bbox['east'],
                                     config.get('extent_threshold', 0.15))
        elif agg == 'percentage':
            value = aggregate_percentage(data)
        else:
            value = float('nan')

        from datetime import datetime
        dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
        points.append({
            'date': time_str,
            'year': dt.year,
            'month': dt.month,
            'value': round(value, 6) if math.isfinite(value) else None,
        })
        print(f"  {bin_file.name}: {value:.4f}")

    return {
        'datasetId': dataset_id,
        'variableId': config['variable'],
        'aggregation': config['aggregation'],
        'unit': 'see config',
        'points': points,
    }


def main():
    output_dir = Path('downloads/timeseries')
    output_dir.mkdir(parents=True, exist_ok=True)

    for dataset_id, config in DATASETS.items():
        print(f"\n>>> Processing {dataset_id}...")
        result = process_dataset(dataset_id, config)
        if result:
            out_file = output_dir / f"{dataset_id}-timeseries.json"
            with open(out_file, 'w') as f:
                json.dump(result, f, indent=2)
            print(f"  → {out_file} ({len(result['points'])} points)")

    print("\nDone! Copy the *-timeseries.json files into the release ZIPs.")


if __name__ == '__main__':
    main()
