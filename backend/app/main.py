"""Flowbench API entrypoint."""

from __future__ import annotations

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api import router
from app.scheduler import scheduler_loop
from app.settings import API_COMMON_PREFIX, CORS_ORIGINS

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop = threading.Event()
    if os.environ.get("FLOWBENCH_SCHEDULER", "1") == "1":
        threading.Thread(target=scheduler_loop, args=(stop,), daemon=True,
                         name="flowbench-scheduler").start()
    yield
    stop.set()


app = FastAPI(
    title="Flowbench API",
    description="Interactive data pipeline playground: plan, run and inspect bounded pipelines.",
    version=__version__,
    docs_url=f"{API_COMMON_PREFIX}/docs",
    redoc_url=f"{API_COMMON_PREFIX}/redoc",
    openapi_url=f"{API_COMMON_PREFIX}/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
    max_age=600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if request.url.path.startswith(API_COMMON_PREFIX) and "cache-control" not in response.headers:
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = []
    for e in exc.errors():
        loc = ".".join(str(p) for p in e.get("loc", []) if p != "body")
        errors.append({"loc": loc, "message": e.get("msg", "invalid value")})
    return JSONResponse(status_code=422,
                        content={"detail": {"message": "invalid request", "errors": errors}})


app.include_router(router, prefix=API_COMMON_PREFIX)
