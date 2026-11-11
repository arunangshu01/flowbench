# Deploying Flowbench to Google Cloud

Flowbench follows the same pattern as the portfolio, mahakal and doppel, in
its **own GCP project**:

- **Firebase Hosting** (site `flowbench-app`) serves `frontend/dist`. The
  `/flowbench/api/**` rewrite comes before the SPA fallback and points to
  Cloud Run.
- **Cloud Run** service `flowbench-api` in `asia-south1` runs the FastAPI
  image from **Artifact Registry** repository `flowbench`.
- **GitHub Actions** deploys with keyless **Workload Identity Federation**.
  The provider only trusts this repository, `main`, the exact deploy workflow
  file, and the `production` environment. No service-account JSON key exists.
- **Deploy** runs only after a successful **push CI on main**, waits for a
  manual approval in the GitHub `production` environment, re-runs
  tests/build, rejects stale commits, then deploys in order: API, API health,
  Hosting, smoke tests (including one real pipeline run).

## Runtime design and cost

| Setting | Value | Why |
| --- | --- | --- |
| CPU / memory | 1 vCPU / 512 MiB | small, bounded datasets |
| CPU allocation | always on (`--no-cpu-throttling`) | the in-process scheduler must run between requests |
| Instances | min 1, max 1 (service and revision) | scheduler needs a warm instance; one instance keeps SQLite history, schedules and rate limits consistent |
| Concurrency / timeout | 20 / 60 s | runs finish in milliseconds; the engine's own budget is 10 s |
| Rate limit | 60 runs/min, burst 20, **shared** | forwarded IPs are not trusted (callers can reach the public Cloud Run URL directly), same stance as doppel |
| Execution slots | 4 concurrent runs | excess requests get 503 |
| Secrets | none | Flowbench has no credentials to protect |

**Cost warning.** An always-on instance is billed for every second it exists,
whether or not anyone uses the app. At current Cloud Run list prices for
`asia-south1` (Tier 1), 1 vCPU + 512 MiB running 24/7 is roughly
**USD 40-50/month** after the monthly free tier. Check the
[Cloud Run pricing calculator](https://cloud.google.com/products/calculator)
before deploying; prices and free tiers change. Registry storage, Hosting
bandwidth and logs add small amounts.

If that is too much, you can switch to scale-to-zero: in
`.github/workflows/deploy.yml` replace `--no-cpu-throttling --min-instances 1`
with `--cpu-throttling --min-instances 0`, and set `FLOWBENCH_SCHEDULER: "0"`
in `deploy/cloud-run.env.yaml`. This typically costs close to nothing at demo
traffic, but scheduled runs stop working and history resets after idle
periods.

Either way, **run history and schedules live in the container's SQLite file
and are lost on every deploy or instance restart.** That is acceptable for a
demo and is called out in the README.

## Manual setup, in order

Do one step at a time and confirm it before continuing. Console steps (billing,
Firebase) are manual. Commands are references, **not an idempotent script**:
stop on errors and check existing resources before retrying. Never paste
tokens or keys into chat.

### 1. Create a separate project, link billing, set a budget

In Google Cloud Console:

1. Create a project named **flowbench** with a unique project ID, for example
   `flowbench-<ddmmyy>`. Do **not** reuse `ap-portfolio-241026`,
   `mahakal-ai-230925` or `doppel-101126`; the deploy workflow refuses them.
2. Link the intended billing account.
3. In **Billing > Budgets & alerts**, create a budget scoped **only to the
   flowbench project**. With the always-on instance, an INR 500 budget will
   alert within days; pick an amount that matches the cost estimate above
   (for example INR 4,500/month), with alerts at 50%, 90% and 100%.
4. Budgets are notifications, **not a spending cap**.

Report the project ID (not billing details) before Step 2.

### 2. Add Firebase and create the Hosting site

In Firebase Console choose **Add Firebase to an existing Google Cloud
project** and pick the flowbench project. Analytics is not needed.

In **Hosting**, create the site **`flowbench-app`** if available. If it is
taken, choose another ID and report it so `firebase.json` and the deploy
workflow URL can be updated before merging. No web SDK registration,
Firestore or service-account key is needed. Do not run `firebase init` over
the checked-in config.

### 3. Authenticate the terminal and set identifiers

From the repository root:

```bash
gcloud auth login           # if not already logged in
gh auth status              # already logged in as arunangshu01
export PROJECT_ID='YOUR_NEW_FLOWBENCH_PROJECT_ID'
export REGION='asia-south1'
export GITHUB_REPO='arunangshu01/flowbench'
export RUN_SA="flowbench-run@${PROJECT_ID}.iam.gserviceaccount.com"
export DEPLOY_SA="flowbench-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
case "$PROJECT_ID" in
  ''|YOUR_*|ap-portfolio-241026|mahakal-ai-230925|doppel-101126) echo 'STOP: select the new flowbench project' ;;
  *) gcloud config set project "$PROJECT_ID" ;;
esac
gcloud projects describe "$PROJECT_ID" --format='table(projectId,name,projectNumber)'
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export REPO_ID=$(gh api "repos/$GITHUB_REPO" --jq '.id')         # 1453682436
export OWNER_ID=$(gh api "repos/$GITHUB_REPO" --jq '.owner.id')  # 22813216
```

Your gcloud default project is currently the doppel project; the `case`
guard switches it. Keep this terminal open so the exports survive.

### 4. Enable APIs and create Artifact Registry

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  firebase.googleapis.com firebasehosting.googleapis.com \
  cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
  --project="$PROJECT_ID"

gcloud artifacts repositories create flowbench --project="$PROJECT_ID" \
  --repository-format=docker --location="$REGION" \
  --description='Flowbench API images'
```

### 5. Service accounts and IAM

```bash
gcloud iam service-accounts create flowbench-run --project="$PROJECT_ID" \
  --display-name='Flowbench Cloud Run runtime'
gcloud iam service-accounts create flowbench-deployer --project="$PROJECT_ID" \
  --display-name='Flowbench GitHub deployer'

for role in roles/run.admin roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$DEPLOY_SA" --role="$role"
done

gcloud artifacts repositories add-iam-policy-binding flowbench \
  --project="$PROJECT_ID" --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer

gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --project="$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" \
  --role=roles/iam.serviceAccountUser
```

The deployer gets deployment roles in this project only (not Owner/Editor),
and registry write only on the `flowbench` repository. The runtime account
needs no roles: the app calls no Google APIs.

### 6. Keyless Workload Identity Federation

Check the repository's OIDC subject prefix (non-secret):

```bash
gh api "repos/$GITHUB_REPO/actions/oidc/customization/sub" \
  --jq '{use_default, use_immutable_subject, sub_claim_prefix}'
export OIDC_SUB_PREFIX=$(gh api "repos/$GITHUB_REPO/actions/oidc/customization/sub" \
  --jq '.sub_claim_prefix // empty')
test -n "$OIDC_SUB_PREFIX" && echo "$OIDC_SUB_PREFIX"
```

Expected: `repo:arunangshu01@22813216/flowbench@1453682436` (immutable
subjects, as in doppel). If it is empty or different, stop and check before
continuing.

```bash
gcloud iam workload-identity-pools create github --project="$PROJECT_ID" \
  --location=global --display-name='Flowbench GitHub Actions'

gcloud iam workload-identity-pools providers create-oidc flowbench-repo \
  --project="$PROJECT_ID" --location=global --workload-identity-pool=github \
  --display-name='Flowbench production workflow' \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id' \
  --attribute-condition="assertion.repository_id=='${REPO_ID}' && assertion.repository_owner_id=='${OWNER_ID}' && assertion.ref=='refs/heads/main' && assertion.workflow_ref=='${GITHUB_REPO}/.github/workflows/deploy.yml@refs/heads/main' && assertion.sub=='${OIDC_SUB_PREFIX:?Check the OIDC subject prefix first}:environment:production'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --project="$PROJECT_ID" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository_id/${REPO_ID}"

export WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/flowbench-repo"
printf 'GCP_PROJECT_ID=%s\nGCP_DEPLOY_SA=%s\nGCP_WIF_PROVIDER=%s\n' "$PROJECT_ID" "$DEPLOY_SA" "$WIF_PROVIDER"
```

Allow a few minutes for IAM propagation before diagnosing auth failures; do
not loosen the condition as a workaround.

### 7. GitHub Actions Variables (not Secrets)

```bash
gh variable set GCP_PROJECT_ID --repo "$GITHUB_REPO" --body "$PROJECT_ID"
gh variable set GCP_DEPLOY_SA --repo "$GITHUB_REPO" --body "$DEPLOY_SA"
gh variable set GCP_WIF_PROVIDER --repo "$GITHUB_REPO" --body "$WIF_PROVIDER"
```

These identifiers are not secrets.

### 8. Protect production and main

In **Settings > Environments**, create **production**:

- Deployment branches: selected branches, **main** only, no tag rules.
- **Required reviewers**: `arunangshu01`. Leave *Prevent self-review*
  unchecked (solo maintainer).
- Disable *Allow administrators to bypass configured protection rules*.

In **Settings > Rules > Rulesets**, create a `Protect main` ruleset like
doppel's: target `main`, require a pull request (0 approvals for a solo
maintainer), require conversation resolution, require branches to be up to
date, require the status checks **Backend tests** and **Frontend tests and
build**, block force pushes and deletion, no bypass actors. Enable secret
scanning, push protection and Dependabot alerts.

### 9. Merge, approve, deploy

1. Merge the PR once both CI checks pass.
2. CI runs on `main`; when it succeeds, **Deploy** starts and waits for
   `production` approval. Open **Actions > Deploy > Review deployments**,
   select **production**, **Approve and deploy**. Only you can approve.
3. Watch: WIF auth, image build/push, Cloud Run deploy, API health, Firebase
   deploy, smoke tests.
4. For setup failures, fix the configuration and re-run the CI run that was
   triggered by the latest push to main. There is deliberately no manual
   Deploy trigger that skips CI.

Verify from the terminal:

```bash
gh run list --repo "$GITHUB_REPO" --workflow deploy.yml --limit 5
curl --fail "https://flowbench-app.web.app/flowbench/api/v1/health"
curl --fail -o /dev/null "https://flowbench-app.web.app/"
curl --fail -o /dev/null "https://flowbench-app.web.app/flowbench/api/v1/docs"
gcloud run services describe flowbench-api --region "$REGION" \
  --format='value(spec.template.metadata.annotations)'
```

Then check the site in a browser on desktop and a real phone: landing boot
check, the faulty-data demo, History compare, and creating/deleting a
schedule.

## Operations and rollback

- Logs: Cloud Run > flowbench-api > Logs. Budget emails arrive with a delay.
- Normal rollback: revert via PR, pass CI, merge, approve Deploy.
- Emergency rollback: restore a known-good Cloud Run revision and Firebase
  Hosting release in their consoles. The next deployment supersedes it.
- Monitoring (configured): uptime check + email alert on
  `https://flowbench-app.web.app/flowbench/api/v1/health` and a `flowbench operations` dashboard, mirroring doppel. See the README table.
- Image cleanup policy (configured in dry-run): keep 10 most recent, delete older than 30 days.
