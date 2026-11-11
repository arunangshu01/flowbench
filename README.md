<p align="center">
  <img src="frontend/public/logo.svg" width="96" height="96" alt="Flowbench logo" />
</p>

<h1 align="center">flowbench</h1>

<p align="center">
  <b>Build a pipeline. Break it. Inspect every row.</b><br />
  <a href="https://flowbench-app.web.app">Live demo</a> ·
  <a href="https://flowbench-app.web.app/app?demo=strict-sensor-ingest">Run the faulty-data demo</a> ·
  <a href="docs/deploy-gcp.md">Deployment guide</a>
</p>

<p align="center">
  <a href="https://github.com/arunangshu01/flowbench/actions/workflows/ci.yml"><img src="https://github.com/arunangshu01/flowbench/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" /></a>
  <a href="https://github.com/arunangshu01/flowbench/actions/workflows/deploy.yml"><img src="https://github.com/arunangshu01/flowbench/actions/workflows/deploy.yml/badge.svg" alt="Deploy" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" />
</p>

An interactive data pipeline playground. Pick a seeded dataset, assemble a
pipeline from whitelisted validators and transforms, execute it for real, and
inspect every stage: records in and out, rejections with reasons, per-field
profiles, schema changes, and record-level lineage. A deliberately faulty
dataset demonstrates failure handling, fix-and-replay, and run comparison.

## What it does

- **Landing page** (`/`) with a live boot check: it calls the real API
  (health, limits, catalog, operations, presets), shows each result and its
  latency, then fills the page's stats, dataset and preset cards from that
  data. The workbench lives at `/app`; `/app?demo=<preset>` loads and runs a
  preset, and dataset/preset cards deep-link with `/app#config=...`.

- **Typed pipeline builder.** Every op parameter has a typed editor: field
  pickers limited to the fields that exist at that stage, multi-field chips,
  number inputs, enums, rename maps, and expression arguments. New stages
  start with schema-aware defaults.
- **Static planning before execution.** The planner walks the pipeline
  without touching data, propagating the schema through each stage (renames,
  drops, casts, derived columns, lookup joins). It reports **errors** (bad
  params, a field that does not exist at that point) and **warnings** (e.g.
  `range` on a string field). The UI re-plans while you edit, and the API
  refuses to run or schedule a pipeline that has errors.
- **Real, bounded execution.** Rows stream lazily through chained stage
  iterators in-process. Counts are exact and conserved at every stage
  (`in = out + rejected + filtered`), and per-stage time measures only that
  stage's own work.
- **Inspection.** Click any node in the SVG pipeline graph to see sampled
  input, output, and rejected records; the error list; a per-field profile
  (null %, distinct count, min/max, mixed-type detection) computed over
  **all** rows; and the schema in vs. out. Values that don't match the
  declared type are highlighted.
- **Lineage.** Every source row carries a `_rid`. Clicking one traces it
  through the stages, using only what the report recorded. If a record isn't
  in the recorded samples or errors, the trace says it can't tell, rather
  than guessing.
- **Failure → fix → replay → compare.** Run the faulty dataset, edit the
  pipeline, then use *Replay with edits*: the new run links back to the
  original. In History, pick any two runs to compare. Stages are aligned by
  operation, so an added or removed stage doesn't misalign the rest of the
  diff.
- **Compile to SQL.** The sink node's SQL tab shows the pipeline compiled to
  DuckDB SQL, one CTE per stage, plus setup SQL (typed table + `COPY` from the
  dataset CSV, lookups inlined as `VALUES`). Flowbench never executes this SQL;
  tests run it in DuckDB and check it returns the same rows as the Python
  engine for representative pipelines and presets. Where semantics differ
  (e.g. `type_check` uses `TRY_CAST`), the UI shows a note.
- **Data out.** Every dataset downloads as CSV, and pipelines export/import as
  JSON files (imports go through the same validation as share links).
- **Dead-letter export.** `rejects.csv` per run (stage, row, lineage id,
  message, record), properly CSV-escaped.
- **Presets & sharing.** Six named pipelines across domains. The current pipeline is
  always encoded in the URL, so a link reproduces it exactly.
- **Schedules.** Re-run a pipeline every 1 min to 1 h (max 5). Scheduled runs
  go through the same planner and engine and show up in History.
- **All devices.** Desktop workbench (pipeline rail + graph + inspector);
  tablet and phone get a single-column layout with bottom navigation (Build,
  Inspect, History, Schedules).

## Architecture

```
backend/  FastAPI + Pydantic, pure-Python engine, SQLite history
  app/datasets/   seeded deterministic generators + static lookup tables
  app/registry/   whitelisted ops with structured ParamSpecs + validation
  app/core/       planner.py (schema propagation), engine, rate limiting
  app/scheduler.py in-process interval scheduler
  app/store/      SQLite (WAL) runs + schedules, pruned to 500 runs
  app/api/        HTTP routes
frontend/ React 18 + Vite, no UI/icon/graph libraries (hand-rolled SVG DAG)
```

Why so few dependencies: datasets are bounded (≤ 2,000 rows each), so pandas or a
dataframe engine would add image size and cold-start time without benefit.
SQLite fits the single-instance Cloud Run target. Airflow, Kafka, or a queue
would be infrastructure without an MVP need.

### Safety bounds (public demo)

| control | value |
| --- | --- |
| ops | whitelisted functions only; no arbitrary code, SQL, or remote URLs |
| params | type-checked per op; regex length-capped, nested quantifiers rejected, match input ≤ 256 chars |
| run size | ≤ 10,000 source rows, ≤ 20 stages, ≤ 4 KB params per stage |
| time | 10 s wall-clock budget per run |
| rate | token bucket on runs/replays: 10/min per client locally; 60/min (burst 20) shared across all visitors in production |
| concurrency | ≤ 4 simultaneous runs (`FLOWBENCH_MAX_CONCURRENT_RUNS`); excess gets 503 |
| storage | 500 most recent runs kept; ≤ 5 schedules, interval 60 s-24 h |

Forwarded IP headers are never trusted for rate limiting: in production the
public Cloud Run URL can be called directly, so `X-Forwarded-For` is
client-controlled (the same stance as doppel). Locally the bucket is per
socket peer; in production (`FLOWBENCH_RATE_LIMIT_SCOPE=global`) it is one
shared budget per process. This is best-effort demo protection, not a
distributed quota, edge firewall or spending cap.

## Local setup

Requires Python 3.11+ and Node 20+.

```bash
# backend → http://localhost:8000 (OpenAPI docs at /flowbench/api/v1/docs)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # app deps + DuckDB for the SQL tests
uvicorn app.main:app --reload --port 8000

# frontend → http://localhost:5173 (proxies /flowbench/api to :8000)
cd frontend
npm install
npm run dev
```

Environment variables (all optional): `FLOWBENCH_DB` (SQLite path),
`FLOWBENCH_ORIGINS` (CORS allow-list), `FLOWBENCH_SCHEDULER` (`0` disables
the scheduler thread), `FLOWBENCH_MAX_CONCURRENT_RUNS`,
`FLOWBENCH_RATE_LIMIT_SCOPE` (`client` or `global`), `FLOWBENCH_RUNS_PER_MINUTE`,
`FLOWBENCH_RUN_BURST`. Production values are in `deploy/cloud-run.env.yaml`.

## Tests

```bash
cd backend && python -m pytest tests -q   # engine, planner, API, scheduler, datasets, SQL-vs-engine, deploy files
cd frontend && npm test                    # reducer, editors, inspector, lineage, app flows
cd frontend && npm run build
```

## Datasets & lookups

All generators are seeded and deterministic. Datasets ending in `-faulty`
contain deliberately injected defects; every other dataset conforms to its
declared schema (enforced by `tests/test_datasets.py`).

| id | domain | rows | notes |
| --- | --- | --- | --- |
| `iot-sensors` | iot | 2,000 | temperature/humidity readings from 8 devices |
| `iot-sensors-faulty` | iot | 2,000 | ~8% defects: null temps, wrong types, out-of-range humidity, missing device IDs, duplicate reading IDs |
| `transactions` | finance | 1,500 | card transactions across 8 merchants |
| `vitals` | healthcare | 1,200 | patient vitals across 4 wards |
| `orders` | retail | 1,800 | order lines over 10 products, 4 channels, 6 countries |
| `orders-faulty` | retail | 1,800 | ~10% defects: zero/negative quantities, missing and unknown SKUs, locale-formatted prices, non-ISO countries, duplicate orders |
| `web-logs` | observability | 2,000 | HTTP requests with 2xx-5xx mix, latency skew, bot traffic |
| `shipments` | logistics | 1,400 | road/air/sea/rail shipments with planned vs. actual transit days |
| `weather` | climate | 1,620 | 6-hourly observations from 6 stations in different climate zones |
| `flights` | aviation | 1,500 | departures between 7 airports with delays, distances, cancellations |
| `employees` | hr | 900 | departments, levels, salaries, tenure, ratings |

Static dimension tables for `join_lookup`: `devices`, `merchants`, `wards`,
`products`, `carriers`, `stations`, `airports`. Every join key in the clean
datasets resolves to a lookup row.

Presets: strict sensor ingestion, transaction enrichment, vitals quality check,
order quality gate (second failure demo), web error triage, flight delay report.

## Operations

- **Validators** (reject rows, with a recorded message): `not_null`,
  `type_check`, `range`, `regex`, `allowed_values`, `unique`.
- **Transforms**: `rename`, `cast` (unconvertible values are rejected),
  `filter`, `derive_column` (`add`, `subtract`, `multiply`, `divide`,
  `concat`, `abs`, `round`), `drop_columns`, `upper`, `lower`, `dedupe`,
  `join_lookup` (left/inner). `filter`, `dedupe`, and inner joins drop rows
  as *filtered*, not *rejected*.

## API

All routes share the common prefix `API_COMMON_PREFIX = /flowbench/api/v1`
(`backend/app/settings.py`, mirrored in `frontend/src/api/client.js`), the same
pattern as the other portfolio services. Paths below are relative to it.

| endpoint | purpose |
| --- | --- |
| `GET /datasets`, `/datasets/{id}/sample` | catalog + preview |
| `GET /registry` | ops with structured param specs |
| `GET /lookups`, `/presets`, `/meta` | lookup tables, presets, version + limits |
| `POST /validate` | plan a draft pipeline (no execution) |
| `POST /runs` | plan + execute (422 with the plan if invalid) |
| `GET /runs`, `/runs/{id}` | history + stored report |
| `POST /runs/{id}/replay` | re-run the stored config, or an override |
| `GET /compare?a=&b=` | operation-aligned run diff |
| `GET /runs/{id}/rejects.csv` | dead-letter export |
| `POST /compile/sql` | pipeline as DuckDB SQL + setup SQL + semantic notes |
| `GET /datasets/{id}/download.csv` | full dataset as CSV |
| `POST/GET/DELETE /schedules` | interval re-runs |

## Known limitations

- Record samples are the first 50 rows per stage bucket, and error lists keep
  the first 200 per stage. Counts and profiles always cover every row.
- History, schedules, and rate limits live in one process and one SQLite
  file. That matches a single Cloud Run instance; scaling out would need
  Cloud SQL/Firestore and Cloud Scheduler.

## Deployment

Same pattern as the portfolio, mahakal and doppel, in a dedicated GCP project:

- **Firebase Hosting** site `flowbench-app` serves `frontend/dist`; the
  `/flowbench/api/**` rewrite (before the SPA fallback) points to Cloud Run.
- **Cloud Run** `flowbench-api` (asia-south1): 1 vCPU / 512 MiB, CPU always
  allocated, exactly one instance, so the in-process scheduler keeps running
  and SQLite state stays consistent. This is billed continuously (roughly
  USD 40-50/month at list prices); see the guide for the scale-to-zero
  alternative.
- **GitHub Actions**: `CI` on every PR and push; `Deploy` runs only after a
  successful push CI on `main`, waits for approval in the `production`
  environment, authenticates with keyless Workload Identity Federation (no
  JSON keys, no secrets), deploys the API then Hosting, and smoke-tests the
  live site including one real pipeline run.
- Run history and schedules are stored in the container and **reset on every
  deploy or instance restart**.

Step-by-step manual setup: [docs/deploy-gcp.md](docs/deploy-gcp.md).

| Setting | Provisioned value |
| --- | --- |
| Dedicated GCP project | `flowbench-111126` (project number `251493600324`) |
| Firebase Hosting site | `flowbench-app` (https://flowbench-app.web.app) |
| Cloud Run service / region | `flowbench-api` / `asia-south1` |
| Runtime / deployer identities | `flowbench-run` (no roles) / `flowbench-deployer` (Cloud Run admin, Hosting admin, registry writer on `flowbench`) |
| Artifact Registry | `flowbench` Docker repository in `asia-south1` |
| WIF provider | `projects/251493600324/locations/global/workloadIdentityPools/github/providers/flowbench-repo` |
| OIDC subject | `repo:arunangshu01@22813216/flowbench@1453682436:environment:production` |
| GitHub | `production` environment (main only, reviewer `arunangshu01`, no admin bypass); `Protect main` ruleset (PR, resolved conversations, up-to-date branch, both CI checks, no force push/deletion, no bypass) |

Billing and a project-scoped budget were configured manually. No secrets or
service-account keys exist. Each deployment still waits for the production
approval in GitHub Actions.
