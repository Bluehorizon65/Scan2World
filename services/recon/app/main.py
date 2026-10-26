import re
import shutil
import subprocess
from contextlib import asynccontextmanager
from functools import cache

from fastapi.responses import JSONResponse

from s2w_common.app import ServiceError, create_app

from .jobs import JobManager, JobSpec, to_json

manager: JobManager | None = None
JOB_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def has_gpu() -> bool:
    if not shutil.which("nvidia-smi"):
        return False
    return subprocess.run(["nvidia-smi", "-L"], capture_output=True, timeout=10).returncode == 0


@cache
def colmap_version() -> str:
    try:
        out = subprocess.run(["colmap", "-h"], capture_output=True, text=True, timeout=10).stdout
        return out.splitlines()[0].strip() if out else "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unavailable"


def get_manager() -> JobManager:
    global manager
    if manager is None:
        manager = JobManager(gpu=has_gpu())
    return manager


@asynccontextmanager
async def lifespan(_app):
    get_manager()
    yield
    if manager:
        manager.shutdown()


app = create_app("recon")
app.router.lifespan_context = lifespan


def check_id(job_id: str) -> None:
    if not JOB_ID.match(job_id):
        raise ServiceError("invalid_input", "invalid job id")


@app.get("/info")
def info():
    return {"gpu": get_manager().gpu, "colmap": colmap_version()}


@app.post("/jobs/{job_id}", status_code=202)
def submit(job_id: str, spec: JobSpec):
    check_id(job_id)
    return to_json(get_manager().submit(job_id, spec))


@app.get("/jobs/{job_id}")
def status(job_id: str):
    check_id(job_id)
    st = get_manager().get(job_id)
    if not st:
        return JSONResponse({"error": {"code": "not_found", "message": "unknown job"}}, status_code=404)
    return to_json(st)


@app.delete("/jobs/{job_id}")
def cancel(job_id: str):
    check_id(job_id)
    st = get_manager().cancel(job_id)
    if not st:
        return JSONResponse({"error": {"code": "not_found", "message": "unknown job"}}, status_code=404)
    return to_json(st)
