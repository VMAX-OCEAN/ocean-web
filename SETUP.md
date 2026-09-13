# Setup Guide

## Quick Start

```bash
git clone https://github.com/VMAX-OCEAN/ocean-web.git
cd ocean-web
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## How Data Works

This project uses **GitHub Releases** for ocean data distribution — not
committed files. This keeps the repo small (~2MB) while serving 1.3GB of
binary ocean data.

### Data flow

```
User clicks a layer (e.g. SST)
      ↓
App requests /release-data/sst/sst_t0000.bin
      ↓
release-data.ts maps dataset ID → ZIP on GitHub Releases
      ↓
Downloads sst-data.zip (~56MB) from GitHub Releases
      ↓
Extracts .bin files client-side using fflate
      ↓
Caches in browser memory (subsequent loads are instant)
      ↓
Renders on globe + analytics chart
```

### What's in the repo vs. what's on Releases

| What | Location | Size |
|------|----------|------|
| Source code | Git repo | ~2MB |
| Borders/labels GeoJSON | Git repo (`public/borders/`, `public/labels/`) | ~41MB |
| Land mask GeoJSON | Git repo (`public/masks/`) | ~136KB |
| Argo floats CSV | Git repo (`public/data/floats.csv`) | ~536KB |
| Ocean binary data (.bin) | GitHub Releases (ZIPs) | ~1.3GB |

### Available datasets on Releases

| Dataset | ZIP | Size |
|---------|-----|------|
| SST | `sst-data.zip` | ~56MB |
| Marine Heat Waves | `mhw-data.zip` | ~56MB |
| Surface pH + pH Trend | `ph-data.zip` | ~114MB |
| Sea Level | `sea-level-data.zip` | ~112MB |
| Sea Ice (Arctic + Antarctic) | `sea-ice-data.zip` | ~35MB |

### First load behavior

On first load, the app downloads the ZIP for the selected dataset
(~35–114MB depending on dataset). This takes a few seconds. The ZIP is
extracted in memory and cached — switching between time steps within
the same dataset is instant after the first load.

Switching to a different dataset downloads that dataset's ZIP (also
cached after first download).

## Deployment (Vercel)

The app is configured for Vercel deployment:

1. Push to GitHub
2. Import the repo on Vercel
3. Deploy — no environment variables needed

`vercel.json` contains a rewrite that proxies `/release-data/*` to
GitHub Releases for production. The release-data loader fetches ZIPs
directly from GitHub Releases (CORS-enabled).

## Local Development

```bash
npm install
npm run dev
```

The dev server proxies `/release-data/` to GitHub Releases (configured
in `vite.config.ts`). Data is fetched from the same GitHub Releases
ZIPs as production.

### Optional: Local data for offline dev

If you want to work offline (no GitHub Releases dependency):

1. Download the release ZIPs:
   ```bash
   gh release download data-v1 -D public/data/
   ```

2. Unzip each into `public/data/`:
   ```bash
   cd public/data
   unzip sst-data.zip -d sst/
   unzip mhw-data.zip -d mhw/
   unzip ph-data.zip -d ph/
   unzip sea-level-data.zip -d sea-level/
   unzip sea-ice-data.zip -d sea-ice/
   ```

3. Change `dataPath` in `src/cesium/datasets.ts` from `/release-data/`
   back to `/data/` for local development.

## Build

```bash
npm run build      # Production build → dist/
npm run preview    # Preview production build locally
```
