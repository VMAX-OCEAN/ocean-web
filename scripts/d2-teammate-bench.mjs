#!/usr/bin/env node
// d2-teammate-bench.mjs — D2 env probe + parse control, stdlib only.
// ponytail: synthetic seed-42 fixtures ceiling now; upgrade to argo.md index parse before N_LOCK lock.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const NS = [100, 500, 1000, 2000, 5000];
const RUNS = 10; // measured runs after 1 warmup discard

// mulberry32(42) — deterministic across OS, no Math.random
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPool() {
  const r = rng(42);
  const pool = [];
  for (let i = 0; i < 5000; i++) {
    const wmo = String(1900000 + i);
    const cycle = 1 + Math.floor(r() * 300);
    const lat = +((r() * 60 - 30).toFixed(4));
    const lon = +((r() * 90 + 30).toFixed(4));
    const day = String(1 + Math.floor(r() * 28)).padStart(2, '0');
    pool.push([wmo, cycle, lat, lon, `2026-05-${day}T00:00:00Z`]);
  }
  return pool;
}

function q(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }

function benchParse(raw, N) {
  JSON.parse(raw); // warmup discard
  const t = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const o = JSON.parse(raw);
    const dt = performance.now() - t0;
    if (o.features.length !== N) throw new Error(`count mismatch N=${N}`);
    t.push(dt);
  }
  t.sort((a, b) => a - b);
  const r2 = (x) => +x.toFixed(2);
  return { p50_ms: r2(q(t, 0.5)), p95_ms: r2(q(t, 0.95)), max_ms: r2(t[t.length - 1]), iqr_ms: r2(q(t, 0.75) - q(t, 0.25)) };
}

function cmd(s) {
  try { return execSync(s, { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; }
  catch { return null; }
}

function chromeVersion() {
  return cmd('google-chrome --version') || cmd('chromium --version') || cmd('chromium-browser --version')
    || cmd('powershell -c "(Get-Item \\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\\").VersionInfo.ProductVersion"')
    || null;
}

function gpuGuess() {
  // headless node cannot query WebGL renderer; record null, never invent
  return { unmasked_renderer: null, note: 'run browser probe in reference-laptop.md §5 for WebGL2 renderer' };
}

// selftest: non-trivial stats path
{
  const s = [16, 16, 16, 16, 50, 100].sort((a, b) => a - b);
  if (q(s, 0.5) !== 16 || s[s.length - 1] !== 100) throw new Error('stats selftest FAILED');
}

const pool = buildPool();
const parse = NS.map((N) => {
  const feats = pool.slice(0, N).map(([w, c, lat, lon, d]) => ({
    type: 'Feature', properties: { wmo: w, cycle: c, date: d, vars: 'TEMP,PSAL' },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  }));
  const raw = JSON.stringify({ type: 'FeatureCollection', features: feats });
  const gz = zlib.gzipSync(Buffer.from(raw)).length;
  return { N, raw_bytes: Buffer.byteLength(raw), gzip_bytes: gz, ...benchParse(raw, N) };
});

const cpus = os.cpus();
const result = {
  session: 'd2-parse-control',
  date_iso: new Date().toISOString(),
  host: os.hostname(),
  env: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu_model: cpus[0]?.model ?? null,
    logical_cores: cpus.length,
    ram_total_gb: +(os.totalmem() / 1e9).toFixed(2),
    ram_free_gb: +(os.freemem() / 1e9).toFixed(2),
    node: process.version,
    chrome: chromeVersion(),
    gpu: gpuGuess(),
    power_plugged: null, // record manually: plugged/battery
    panel_hz: null,      // record manually: 60/144 (60Hz caps FPS)
  },
  parse,
  budget: { parse_p95_le_50ms_through_5000: parse.every((r) => r.p95_ms <= 50) },
  note: 'synthetic control only; wire/prep/frame/FPS/chunk gates still open',
};

const top = cmd('git rev-parse --show-toplevel') || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(top, 'd2-results');
fs.mkdirSync(dir, { recursive: true });
const safe = os.hostname().replace(/[^a-zA-Z0-9-_]+/g, '_');
const file = path.join(dir, `${safe}-${result.date_iso.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(file, JSON.stringify(result, null, 2));

console.log(`wrote ${file}`);
console.log('| N | raw | gzip | p50 | p95 | max | iqr |');
for (const r of parse) console.log(`| ${r.N} | ${r.raw_bytes} | ${r.gzip_bytes} | ${r.p50_ms} | ${r.p95_ms} | ${r.max_ms} | ${r.iqr_ms} |`);
console.log(`budget_p95_le_50ms: ${result.budget.parse_p95_le_50ms_through_5000}`);
console.log(`env: ${result.env.os} | ${result.env.cpu_model} | ${result.env.logical_cores}c | ${result.env.ram_total_gb}GB | node ${result.env.node} | chrome ${result.env.chrome ?? 'null'}`);
