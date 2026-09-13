/**
 * Pre-fetch VAM ocean data from INCOIS ERDDAP and save as binary .bin files.
 *
 * Each .bin file is a raw Float32Array (60 lat × 90 lon = 5400 values).
 * The data is stored row-major: lat[0]lon[0], lat[0]lon[1], ..., lat[59]lon[89].
 *
 * Total: 24 depths × 11 times × 2 variables = 528 files
 * Size: 528 × 21.6 KB = ~11 MB
 *
 * Usage: node scripts/fetch-vam-data.cjs
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const VAM_ID = 'incois_argo_10d_VAM';
const VAM_LON = [30.5, 119.5];
const VAM_LAT = [-29.5, 29.5];

const VAM_DEPTHS_M = [
  5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500,
  600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000,
];

const VAM_TIMES = [
  '2019-01-30T00:00:00Z',
  '2019-02-10T00:00:00Z',
  '2019-02-20T00:00:00Z',
  '2019-02-28T00:00:00Z',
  '2019-03-10T00:00:00Z',
  '2019-03-20T00:00:00Z',
  '2019-03-30T00:00:00Z',
  '2019-04-10T00:00:00Z',
  '2019-04-20T00:00:00Z',
  '2019-04-30T00:00:00Z',
  '2019-05-10T00:00:00Z',
];

const VARIABLES = ['TEMP', 'SAL'];
const FILL_VALUE = -9999;

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data', 'vam');

// ZAX index mapping (depth → index)
const DEPTH_TO_INDEX = {};
VAM_DEPTHS_M.forEach((d, i) => { DEPTH_TO_INDEX[d] = i; });

function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { rejectUnauthorized: false }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCsvToFloat32(csvText) {
  const lines = csvText.trim().split('\n');
  // Skip 2 header lines (column names + units)
  const dataLines = lines.slice(2);
  const values = new Float32Array(dataLines.length);
  for (let i = 0; i < dataLines.length; i++) {
    const parts = dataLines[i].split(',');
    const raw = parts[4]; // 5th column = value
    if (raw === '' || raw === 'NaN') {
      values[i] = NaN;
    } else {
      const v = parseFloat(raw);
      values[i] = (Number.isNaN(v) || v === FILL_VALUE) ? NaN : v;
    }
  }
  return values;
}

function buildUrl(variable, time, zaxIndex) {
  const q =
    `${variable}[(${time}):1:(${time})]` +
    `[(${zaxIndex}):1:(${zaxIndex})]` +
    `[(${VAM_LAT[0]}):1:(${VAM_LAT[1]})]` +
    `[(${VAM_LON[0]}):1:(${VAM_LON[1]})]`;
  const enc = q.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  return `https://erddap.incois.gov.in/erddap/griddap/${VAM_ID}.csv?${enc}`;
}

async function fetchSlice(variable, time, zaxIndex) {
  const url = buildUrl(variable, time, zaxIndex);
  const csv = await fetchCsv(url);
  return parseCsvToFloat32(csv);
}

async function main() {
  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Write metadata file
  const meta = {
    grid: { lat: { min: VAM_LAT[0], max: VAM_LAT[1], count: 60 },
            lon: { min: VAM_LON[0], max: VAM_LON[1], count: 90 } },
    depths: VAM_DEPTHS_M,
    times: VAM_TIMES,
    variables: VARIABLES,
    fillValue: NaN,
    format: 'Float32Array, row-major (lat[0]lon[0], lat[0]lon[1], ...)',
    source: 'INCOIS ERDDAP incois_argo_10d_VAM',
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  let count = 0;
  let failed = 0;

  for (const variable of VARIABLES) {
    for (let t = 0; t < VAM_TIMES.length; t++) {
      for (let d = 0; d < VAM_DEPTHS_M.length; d++) {
        const depth = VAM_DEPTHS_M[d];
        const time = VAM_TIMES[t];
        const zaxIndex = d;
        const filename = `${variable.toLowerCase()}_d${d}_t${t}.bin`;
        const filepath = path.join(OUTPUT_DIR, filename);

        if (fs.existsSync(filepath)) {
          count++;
          continue;
        }

        try {
          const data = await fetchSlice(variable, time, zaxIndex);
          const buffer = Buffer.from(data.buffer);
          fs.writeFileSync(filepath, buffer);
          count++;
          if (count % 20 === 0) {
            console.log(`  ${count}/528 slices fetched...`);
          }
          // Small delay to avoid overwhelming the server
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          console.error(`  FAILED: ${filename} — ${err.message}`);
          failed++;
        }
      }
    }
  }

  console.log(`\nDone: ${count} slices fetched, ${failed} failed`);
  console.log(`Output: ${OUTPUT_DIR}`);

  // Check total size
  const totalSize = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.bin'))
    .reduce((sum, f) => sum + fs.statSync(path.join(OUTPUT_DIR, f)).size, 0);
  console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(console.error);
