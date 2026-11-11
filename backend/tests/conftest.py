import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["FLOWBENCH_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["FLOWBENCH_SCHEDULER"] = "0"

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client():
    from app.api import limiter
    limiter.reset()
    return TestClient(app)


def stage(kind, op_name, **params):
    return {"kind": kind, "op": op_name, "params": params}


def run_body(dataset_id, stages, output_format="records"):
    return {"config": {"dataset_id": dataset_id, "stages": stages,
                       "output_format": output_format}}
