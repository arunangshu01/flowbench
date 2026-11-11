"""Runtime settings for the Flowbench API."""

import os

API_COMMON_PREFIX = "/flowbench/api/v1"

CORS_ORIGINS = [o for o in os.environ.get(
    "FLOWBENCH_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173",
).split(",") if o]

# Rate limiting for run/replay requests.
#   client: one bucket per client IP (local dev; the socket peer is the client)
#   global: one shared bucket per process. Used in production, where requests
#           arrive through Firebase Hosting and the public Cloud Run URL, so
#           forwarded IP headers are not trustworthy (same stance as doppel).
RATE_LIMIT_SCOPE = os.environ.get("FLOWBENCH_RATE_LIMIT_SCOPE", "client")
RUNS_PER_MINUTE = int(os.environ.get("FLOWBENCH_RUNS_PER_MINUTE", "10"))
RUN_BURST = int(os.environ.get("FLOWBENCH_RUN_BURST", str(RUNS_PER_MINUTE)))

if RATE_LIMIT_SCOPE not in ("client", "global"):
    raise ValueError("FLOWBENCH_RATE_LIMIT_SCOPE must be 'client' or 'global'")
