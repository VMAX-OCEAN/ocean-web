/**
 * Process geoBoundaries CGAZ ADM1 GeoJSON into a compact labels file.
 *
 * Input: 62 MB GeoJSON with ~4,600 state/province polygons
 * Output: ~150 KB JSON with {name, country, lon, lat} per state
 *
 * Centroid algorithm: bounding box center of the polygon's outer ring.
 * This gives a visually reasonable label position that's always inside
 * the polygon's extent (unlike coordinate averages which can drift to
 * dense vertex clusters). For MultiPolygon, uses the largest polygon
 * by bounding box area.
 *
 * Deduplication: one label per (shapeName, shapeGroup) pair.
 */
const fs = require('fs');

const input = 'C:\\Users\\CHITKU~1\\AppData\\Local\\Temp\\geoboundaries_adm1.geojson';
const output = 'public/labels/geoboundaries_adm1_labels.json';

console.log('Reading geoBoundaries ADM1 GeoJSON (62 MB)...');
const data = JSON.parse(fs.readFileSync(input, 'utf8'));

console.log(`Total features: ${data.features.length}`);

const seen = new Set();
const labels = [];

function bboxCenter(coords) {
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

function polygonArea(coords) {
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return (maxLon - minLon) * (maxLat - minLat);
}

let skipped = 0;
for (const feature of data.features) {
  const props = feature.properties || {};
  const name = props.shapeName;
  const country = props.shapeGroup;
  if (!name || !country) { skipped++; continue; }

  const key = `${name}|${country}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const geom = feature.geometry;
  if (!geom) { skipped++; continue; }

  let coords;
  if (geom.type === 'Polygon') {
    coords = geom.coordinates[0];
  } else if (geom.type === 'MultiPolygon') {
    // Use the largest polygon by bbox area
    let bestArea = -1;
    let bestCoords = null;
    for (const poly of geom.coordinates) {
      const area = polygonArea(poly[0]);
      if (area > bestArea) {
        bestArea = area;
        bestCoords = poly[0];
      }
    }
    coords = bestCoords;
  } else {
    skipped++;
    continue;
  }

  if (!coords || coords.length < 3) { skipped++; continue; }

  const [lon, lat] = bboxCenter(coords);
  labels.push({ name, country, lon, lat });
}

console.log(`Extracted ${labels.length} unique state/province labels`);
console.log(`Skipped ${skipped} features (no name/country or bad geometry)`);

// Sort by country then name for stable output
labels.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));

fs.writeFileSync(output, JSON.stringify(labels));
const sizeKB = Math.round(fs.statSync(output).size / 1024);
console.log(`Written to ${output} (${sizeKB} KB)`);

// Show sample
console.log('\nSample (first 10):');
for (const l of labels.slice(0, 10)) {
  console.log(`  ${l.country} → ${l.name} (${l.lon.toFixed(2)}, ${l.lat.toFixed(2)})`);
}

// Count by country
const byCountry = {};
for (const l of labels) byCountry[l.country] = (byCountry[l.country] || 0) + 1;
const top = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('\nTop countries by state count:');
for (const [c, n] of top) console.log(`  ${c}: ${n}`);
