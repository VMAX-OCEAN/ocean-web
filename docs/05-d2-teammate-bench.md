# D2 teammate bench — one-click run

Measures the D2 parse control on your laptop and saves the result as JSON.
Takes ~10 seconds. Node only, no install, no network, no secrets.

## Why this helps

SIH-OCEAN claim gates (slice ≤750 ms, cold ≤10 s, 30 FPS @5000 markers) need
measured numbers on real machines — estimates don't pass. This script is step 1:
it records your machine fingerprint (OS, CPU, RAM, node, Chrome) plus a
deterministic `JSON.parse` control at N = 100/500/1000/2000/5000 markers
(seed-42 synthetic fixtures). Later runs (slice/chunk/FPS harnesses) cite the
same env table, so numbers stay apples-to-apples across teammates.

Scope: parse control only. Wire bytes, prep, frames, FPS, chunk A/B, cold load
stay open until the `__VIEWER__` patch + R2 + Supabase exist.

## Run (copy-paste one line, from `ocean-web/` root)

Linux / macOS:

```bash
node scripts/d2-teammate-bench.mjs && git add d2-results && git commit -m "d2: $(hostname) bench" && git push
```

Windows PowerShell:

```powershell
node scripts/d2-teammate-bench.mjs; git add d2-results; git commit -m "d2: $env:COMPUTERNAME bench"; git push
```

## After running

1. Open your new file in `d2-results/<your-host>-<date>.json`.
2. Fill two fields by hand (a script can't know these):
   - `power_plugged`: `true` if plugged in, `false` on battery
   - `panel_hz`: `60` or `144` (a 60 Hz panel caps FPS at 60)
3. Amend + push:
   ```bash
   git add d2-results && git commit --amend --no-edit && git push --force-with-lease
   ```

## Check everyone's results

```bash
git pull && ls d2-results
```

Compare the `| N | raw | gzip | p50 | p95 |` table printed per run, or diff
the JSON files. Budget line to watch: `budget_p95_le_50ms_through_5000`.
