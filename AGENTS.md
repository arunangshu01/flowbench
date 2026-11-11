# AGENTS.md

## Layout
- `backend/`: FastAPI app in `app/` (`datasets/`, `registry/`, `core/` incl. `planner.py`, `store/`, `api/`, `scheduler.py`, `presets.py`), tests in `tests/`. Run commands from `backend/`.
- `frontend/`: React 18 + Vite + Jest/Testing Library. Run commands from `frontend/`.

## Verify before committing
```bash
cd backend && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest tests -q
cd frontend && npm test && npm run build
```
CI (`.github/workflows/ci.yml`) runs the same.

## Conventions
- UI consistency: both pages use `Brand`, the `--page-bg`/`--surface`/radius tokens in `styles.css`, `.btn`/`.btn-lg`, and shared copy from `src/lib/content.js`. Don't add page-specific variants of these.
- `requirements-dev.txt` (DuckDB) is for tests only; the production image installs `requirements.txt`.
- Routes: `/` is the landing page (`src/landing/`), `/app` is the workbench (`src/App.jsx`). `src/lib/router.js` is a minimal pushState router; Firebase and Vite both fall back to `index.html`. Old `/#config=` links redirect to `/app`.
- All routes are mounted under `API_COMMON_PREFIX = "/flowbench/api/v1"` (`backend/app/settings.py`); the frontend mirrors it in `src/api/client.js`, Vite proxies `/flowbench/api`, and Firebase rewrites `/flowbench/api/**`. Change all four together. Tests use `P = API_COMMON_PREFIX`.
- Datasets ending in `-faulty` carry injected defects; all others must conform to their declared schema and resolve their join keys (`tests/test_datasets.py`).
- Use plain ASCII hyphens, not em/en dashes or minus signs, in code, UI copy and docs.
- Ops are whitelisted in `app/registry`. Each op declares `ParamSpec`s; adding an op means adding its spec, planner schema effect (`core/planner.py::_apply`) if it changes the schema, a frontend default in `src/lib/params.js::defaultParams`, a summary in `src/lib/summary.js`, and a SQL mapping in `app/compiler.py` (plus a DuckDB equivalence case in `tests/test_compiler.py`).
- The planner must reject anything the engine can't run; the engine assumes a valid plan (`run_pipeline` raises `PipelineInvalid` otherwise).
- Keep claims honest: samples and error lists are capped; lineage traces report "unknown" rather than guessing.
- No UI/icon/graph libraries in the frontend: icons are in `src/components/Icon.jsx`; the DAG is SVG in `DagCanvas.jsx`.
- Creator attribution (`CreatorMark`) appears in the desktop status bar and as a card on mobile, matching the other portfolio apps.
- New dependencies: pin versions published at least 7 days ago.
- Never commit secrets; deployment uses keyless Workload Identity Federation.

## Visual checks
The responsive layout changes at 1280px, 1080px, 920px (single column + bottom nav) and 600px. Check desktop, tablet (~820px) and phone (~390px) after UI changes. On ≤920px the top bar must not use `backdrop-filter`, because it would become the containing block for the fixed bottom nav.

## Deployment
- Firebase Hosting `flowbench-app` + Cloud Run `flowbench-api` (asia-south1) in a dedicated GCP project; guide in `docs/deploy-gcp.md`.
- `.github/workflows/deploy.yml` runs after successful push CI on `main`, waits for the GitHub `production` environment approval (the user approves, never the assistant), and uses keyless WIF. Keep the guard that refuses the portfolio/mahakal/doppel project IDs.
- `backend/tests/test_deployment.py` keeps prefix, site, service names and Cloud Run flags consistent across files; update it with any deploy change.
- Ask before creating or changing cloud resources; never ask for secrets in chat.
