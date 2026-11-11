"""Keep the deployment files consistent with the app (prefix, names, guards)."""

import json
import pathlib
import re

from app.settings import API_COMMON_PREFIX

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEPLOY = (ROOT / ".github/workflows/deploy.yml").read_text()
CI = (ROOT / ".github/workflows/ci.yml").read_text()
FIREBASE = json.loads((ROOT / "firebase.json").read_text())["hosting"]
ENV = dict(
    line.split(": ", 1) for line in (ROOT / "deploy/cloud-run.env.yaml").read_text().splitlines() if line.strip()
)
CLIENT = (ROOT / "frontend/src/api/client.js").read_text()
VITE = (ROOT / "frontend/vite.config.js").read_text()


def test_prefix_is_consistent_everywhere():
    base = API_COMMON_PREFIX.rsplit("/", 1)[0]  # /flowbench/api
    assert f'API_COMMON_PREFIX = "{API_COMMON_PREFIX}"' in CLIENT
    assert f'"{base}"' in VITE
    assert f"API_PREFIX: {API_COMMON_PREFIX}" in DEPLOY
    api_rewrite = FIREBASE["rewrites"][0]
    assert api_rewrite["source"] == f"{base}/**"
    assert api_rewrite["run"] == {"serviceId": "flowbench-api", "region": "asia-south1"}
    # API rewrite must come before the SPA fallback
    assert FIREBASE["rewrites"][-1] == {"source": "**", "destination": "/index.html"}


def test_hosting_and_service_names():
    assert re.fullmatch(r"[a-z0-9][a-z0-9-]+", FIREBASE["site"])
    assert f"https://{FIREBASE['site']}.web.app" in DEPLOY
    assert "SERVICE: flowbench-api" in DEPLOY
    assert "flowbench-run@${PROJECT_ID}.iam.gserviceaccount.com" in DEPLOY
    assert '"flowbench-deployer@${PROJECT_ID}.iam.gserviceaccount.com"' in DEPLOY
    assert "docker.pkg.dev/${PROJECT_ID}/flowbench/api:${COMMIT}" in DEPLOY


def test_deploy_is_gated_keyless_and_isolated():
    for guard in ("ap-portfolio-241026", "mahakal-ai-230925", "doppel-101126"):
        assert guard in DEPLOY
    assert "workflows: [CI]" in DEPLOY and "github.event.workflow_run.conclusion == 'success'" in DEPLOY
    assert "name: production" in DEPLOY
    assert "workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}" in DEPLOY
    assert "credentials_json" not in DEPLOY and "secrets." not in DEPLOY
    assert DEPLOY.count("id-token: write") == 1
    assert "workflow_dispatch" not in DEPLOY


def test_cloud_run_matches_runtime_design():
    # in-process scheduler needs an always-on single instance
    for flag in ("--no-cpu-throttling", "--min-instances 1", "--max-instances 1", "--max 1"):
        assert flag in DEPLOY
    assert ENV["FLOWBENCH_SCHEDULER"] == '"1"'
    # forwarded IPs are not trusted in production: one shared budget
    assert ENV["FLOWBENCH_RATE_LIMIT_SCOPE"] == '"global"'


def test_ci_job_names_match_required_checks():
    assert "name: Backend tests" in CI and "name: Frontend tests and build" in CI
