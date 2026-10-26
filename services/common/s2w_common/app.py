"""FastAPI app factory shared by all Python services: token auth, JSON logs, structured errors."""

import hmac
import json
import logging
import os
import sys
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ServiceError(Exception):
    """Expected failure with a stable code that is safe to show to users."""

    def __init__(self, code: str, message: str, status: int = 400, advice: list[str] | None = None):
        super().__init__(message)
        self.code, self.message, self.status, self.advice = code, message, status, advice or []


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"ts": round(record.created, 3), "level": record.levelname, "service": record.name, "msg": record.getMessage()}
        out.update(getattr(record, "extra_fields", {}))
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out)


def get_logger(service: str) -> logging.Logger:
    log = logging.getLogger(service)
    if not log.handlers:
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(_JsonFormatter())
        log.addHandler(h)
        log.setLevel(os.environ.get("LOG_LEVEL", "INFO"))
        log.propagate = False
    return log


def error_body(code: str, message: str, **extra) -> dict:
    return {"error": {"code": code, "message": message, **extra}}


def create_app(service: str) -> FastAPI:
    app = FastAPI(title=f"scan2world-{service}", docs_url=None, redoc_url=None)
    log = get_logger(service)

    @app.middleware("http")
    async def auth_and_log(request: Request, call_next):
        start = time.monotonic()
        if request.url.path != "/health":
            token = os.environ.get("SERVICE_TOKEN", "")
            given = request.headers.get("x-service-token", "")
            if not token or not hmac.compare_digest(token, given):
                return JSONResponse(error_body("unauthorized", "Missing or invalid service token"), status_code=401)
        response = await call_next(request)
        if request.url.path != "/health":
            log.info("request", extra={"extra_fields": {
                "method": request.method, "path": request.url.path, "status": response.status_code,
                "ms": round((time.monotonic() - start) * 1000), "request_id": request.headers.get("x-request-id"),
            }})
        return response

    @app.exception_handler(ServiceError)
    async def service_error(_: Request, exc: ServiceError):
        return JSONResponse(error_body(exc.code, exc.message, advice=exc.advice), status_code=exc.status)

    @app.exception_handler(ValueError)
    async def value_error(_: Request, exc: ValueError):
        return JSONResponse(error_body("invalid_input", str(exc)), status_code=400)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        return JSONResponse(error_body("invalid_input", "Request validation failed", details=exc.errors()), status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        return JSONResponse(error_body("internal_error", "Internal processing error"), status_code=500)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": service}

    return app
