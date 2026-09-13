/**
 * Pre-fetch Argo float data from INCOIS ERDDAP and save as local CSV.
 *
 * The floats data is point data (lat, lon, time, temp, sal, pres, qc) —
 * not grid data like VAM. CSV is the natural format for point data.
 * This is metadata for markers, not visualization data.
 *
 * Usage: node scripts/fetch-floats-data.cjs
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const FLOATS_ID = 'Indian_ARGO_Floats';

// Fani window: March 2019, Bay of Bengal
const BBOX = { west: 60, south: 0, east: 104, north: 25 };
const START = '2019-03-01T00:00:00Z';
const END = '2019-04-01T00:00:00Z';

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'floats.csv');

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

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const q =
    `${FLOATS_ID}.csv?PLATFORM_NUMBER,latitude,longitude,time,TEMP,PSAL,PRES,TEMP_QC` +
    `&time%3E=${START}&time%3C=${END}` +
    `&latitude%3E=${BBOX.south}&latitude%3C=${BBOX.north}` +
    `&longitude%3E=${BBOX.west}&longitude%3C=${BBOX.east}` +
    `&PRES%3C=6.0&orderBy(%22time%22)`;

  const url = `https://erddap.incois.gov.in/erddap/tabledap/${q}`;
  console.log('Fetching floats data...');
  console.log(`URL: ${url.substring(0, 80)}...`);

  try {
    const csv = await fetchCsv(url);
    const lines = csv.trim().split('\n');
    console.log(`Got ${lines.length - 2} float profiles`);

    fs.writeFileSync(OUTPUT_FILE, csv);
    console.log(`Saved to: ${OUTPUT_FILE}`);
    console.log(`Size: ${(csv.length / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
}

main();
