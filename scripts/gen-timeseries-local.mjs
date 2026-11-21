import fs from 'fs';
import path from 'path';

const datasets = [
  { dir: 'sst', id: 'sst', prefix: 'sst_t', count: 72, startYear: 2019 },
  { dir: 'mhw', id: 'mhw', prefix: 'mhw_t', count: 72, startYear: 2019 },
  { dir: 'sea-level', id: 'sea_level', prefix: 'sla_t', count: 84, startYear: 2019 },
  { dir: 'ph', id: 'ph_surface', prefix: 'ph_surface_t', count: 5, startYear: 2019 },
  { dir: 'sea-ice', id: 'sea_ice_arctic', prefix: 'ice_arctic_t', count: 72, startYear: 2019 },
  { dir: 'sea-ice', id: 'sea_ice_antarctic', prefix: 'ice_antarctic_t', count: 72, startYear: 2019 },
];

function monthlyDate(idx, startYear) {
  const y = startYear + Math.floor(idx / 12);
  const m = idx % 12;
  const mm = String(m + 1).padStart(2, '0');
  const date = `${y}-${mm}-01T00:00:00Z`;
  return { date, year: y, month: m + 1 };
}

for (const ds of datasets) {
  const points = [];
  for (let t = 0; t < ds.count; t++) {
    const fname = `${ds.prefix}${String(t).padStart(4, '0')}.bin`;
    const fpath = path.join('public/data', ds.dir, fname);
    if (!fs.existsSync(fpath)) { console.log(`SKIP ${fpath}`); continue; }
    const buf = fs.readFileSync(fpath);
    const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    let sum = 0, count = 0;
    for (let i = 0; i < data.length; i++) {
      if (Number.isFinite(data[i])) { sum += data[i]; count++; }
    }
    const mean = count > 0 ? sum / count : NaN;
    const d = monthlyDate(t, ds.startYear);
    points.push({ date: d.date, year: d.year, month: d.month, value: mean });
  }
  const outFile = path.join('public/data', ds.dir, `${ds.id}-timeseries.json`);
  fs.writeFileSync(outFile, JSON.stringify({ points }, null, 2));
  console.log(`Wrote ${outFile}: ${points.length} points`);
}
