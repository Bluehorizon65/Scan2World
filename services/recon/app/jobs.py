"""Single-worker COLMAP job runner with persisted status, cancellation and per-stage timeouts."""

import json
import os
import queue
import shlex
import signal
import subprocess
import threading
import time
from typing import Literal

from pydantic import BaseModel, Field

from s2w_common.app import get_logger
from s2w_common.storage import data_dir, resolve_key

from .pipeline import (
    ADVICE,
    Matcher,
    Paths,
    Quality,
    build_steps,
    finalize,
    link_images,
    parse_progress,
    select_best_model,
)

log = get_logger("recon")
STAGE_TIMEOUT_S = int(os.environ.get("STAGE_TIMEOUT_S", 4 * 3600))
KILL_GRACE_S = 10


class JobError(BaseModel):
    code: str
    message: str
    advice: list[str] = []


class JobSpec(BaseModel):
    imageKeys: list[str] = Field(min_length=3, max_length=2000)
    outputPrefix: str
    quality: Quality = "balanced"
    matcher: Matcher = "exhaustive"
    dense: bool = True
    singleCamera: bool = True


class JobStatus(BaseModel):
    id: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    stage: str | None = None
    stages: list[str]
    progress: dict | None = None
    gpu: bool
    dense: bool
    error: JobError | None = None
    outputs: dict[str, str] | None = None
    stats: dict | None = None
    created_at: float
    updated_at: float
    spec: JobSpec


class JobManager:
    def __init__(self, gpu: bool, threads: int | None = None):
        self.gpu = gpu
        self.threads = threads or int(os.environ.get("RECON_THREADS", os.cpu_count() or 4))
        self._lock = threading.RLock()
        self._jobs: dict[str, JobStatus] = {}
        self._procs: dict[str, subprocess.Popen] = {}
        self._cancel: set[str] = set()
        self._timed_out: set[str] = set()
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._stopping = False
        self._dir = data_dir() / "recon-jobs"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._recover()
        self._thread = threading.Thread(target=self._loop, name="recon-worker", daemon=True)
        self._thread.start()

    # ---- public API -------------------------------------------------------------------------
    def submit(self, job_id: str, spec: JobSpec) -> JobStatus:
        with self._lock:
            if job_id in self._jobs:  # idempotent: re-attach to existing job
                return self._jobs[job_id]
            for key in spec.imageKeys:
                if not resolve_key(key).is_file():
                    raise ValueError(f"image not found: {key}")
            Paths.for_prefix(spec.outputPrefix)  # validates the prefix
            dense = spec.dense and self.gpu
            stages = [
                s.stage
                for s in build_steps(
                    Paths.for_prefix(spec.outputPrefix),
                    quality=spec.quality,
                    matcher=spec.matcher,
                    dense=dense,
                    gpu=self.gpu,
                    threads=1,
                )
            ]
            now = time.time()
            st = JobStatus(
                id=job_id,
                status="queued",
                stages=stages,
                gpu=self.gpu,
                dense=dense,
                created_at=now,
                updated_at=now,
                spec=spec,
            )
            self._jobs[job_id] = st
            self._persist(st)
        self._queue.put(job_id)
        log.info("job queued", extra={"extra_fields": {"job_id": job_id, "images": len(spec.imageKeys)}})
        return st

    def get(self, job_id: str) -> JobStatus | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> JobStatus | None:
        with self._lock:
            st = self._jobs.get(job_id)
            if not st or st.status in ("completed", "failed", "cancelled"):
                return st
            self._cancel.add(job_id)
            if st.status == "queued":
                self._update(st, status="cancelled")
            elif proc := self._procs.get(job_id):
                self._kill(proc)
            return st

    def shutdown(self) -> None:
        """Stop without touching job status (like a container dying); running jobs are failed on next start."""
        self._stopping = True
        self._queue.put(None)
        with self._lock:
            for proc in self._procs.values():
                self._killpg(proc, signal.SIGKILL)

    # ---- internals ----------------------------------------------------------------------------
    def _recover(self) -> None:
        for f in self._dir.glob("*.json"):
            try:
                st = JobStatus.model_validate_json(f.read_text())
            except ValueError:
                log.warning("unreadable status file", extra={"extra_fields": {"file": f.name}})
                continue
            if st.status in ("queued", "running"):
                self._update(
                    st,
                    status="failed",
                    error=JobError(
                        code="service_restarted",
                        message="The reconstruction service restarted during this job.",
                        advice=["Retry the job."],
                    ),
                )
            self._jobs[st.id] = st

    def _persist(self, st: JobStatus) -> None:
        tmp = self._dir / f".{st.id}.tmp"
        tmp.write_text(st.model_dump_json())
        tmp.replace(self._dir / f"{st.id}.json")

    def _update(self, st: JobStatus, **changes) -> None:
        if self._stopping:
            return
        with self._lock:
            for k, v in changes.items():
                setattr(st, k, v)
            st.updated_at = time.time()
            self._persist(st)

    def _loop(self) -> None:
        while (job_id := self._queue.get()) is not None:
            st = self.get(job_id)
            if not st or st.status != "queued":
                continue
            try:
                self._run(st)
            except Exception:
                log.exception("job crashed", extra={"extra_fields": {"job_id": job_id}})
                self._update(
                    st,
                    status="failed",
                    error=JobError(code="internal_error", message="Unexpected reconstruction error."),
                )
            finally:
                with self._lock:
                    self._procs.pop(job_id, None)

    def _fail(self, st: JobStatus, stage: str) -> None:
        if st.id in self._timed_out:
            self._update(
                st,
                status="failed",
                error=JobError(
                    code="timeout",
                    message=f"The {stage.replace('_', ' ')} stage exceeded its time limit.",
                    advice=["Use draft quality or fewer photos."],
                ),
            )
            return
        message, advice = ADVICE.get(stage, ("Reconstruction failed.", ["Retry the job."]))
        self._update(st, status="failed", error=JobError(code=f"{stage}_failed", message=message, advice=advice))

    def _run(self, st: JobStatus) -> None:
        spec = st.spec
        p = Paths.for_prefix(spec.outputPrefix)
        for d in (p.work, p.sparse, p.dense):  # COLMAP requires output directories to exist
            d.mkdir(parents=True, exist_ok=True)
        link_images(p, spec.imageKeys)
        steps = build_steps(
            p,
            quality=spec.quality,
            matcher=spec.matcher,
            dense=st.dense,
            gpu=self.gpu,
            threads=self.threads,
            single_camera=spec.singleCamera,
        )
        self._update(st, status="running", stage=steps[0].stage if steps else None)
        started = time.monotonic()
        with p.log.open("a") as logf:
            for step in steps:
                if st.id in self._cancel:
                    break
                self._update(st, stage=step.stage, progress=None)
                logf.write(f"\n$ {shlex.join(step.argv)}\n")
                logf.flush()
                rc = self._exec(st, step.stage, step.argv, logf, p)
                if st.id in self._cancel:
                    break
                if rc != 0:
                    log.warning(
                        "stage failed", extra={"extra_fields": {"job_id": st.id, "stage": step.stage, "rc": rc}}
                    )
                    return self._fail(st, step.stage)
                if step.stage == "sparse_reconstruction":
                    try:
                        select_best_model(p)
                    except (RuntimeError, OSError, subprocess.SubprocessError) as e:
                        logf.write(f"model selection failed: {e}\n")
                        return self._fail(st, "sparse_reconstruction")
        if st.id in self._cancel:
            self._update(st, status="cancelled")
            return
        try:
            outputs, stats = finalize(p, len(spec.imageKeys))
        except (RuntimeError, OSError, subprocess.SubprocessError) as e:
            log.warning("finalize failed", extra={"extra_fields": {"job_id": st.id, "error": str(e)}})
            return self._fail(st, "sparse_reconstruction")
        stats["seconds"] = round(time.monotonic() - started)
        self._update(st, status="completed", outputs=outputs, stats=stats, progress=None)
        log.info("job completed", extra={"extra_fields": {"job_id": st.id, **stats}})

    def _exec(self, st: JobStatus, stage: str, argv: list[str], logf, p: Paths) -> int:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            start_new_session=True,
            cwd=p.work,
        )
        with self._lock:
            self._procs[st.id] = proc
        timer = threading.Timer(STAGE_TIMEOUT_S, lambda: (self._timed_out.add(st.id), self._kill(proc)))
        timer.start()
        last_push = 0.0
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                logf.write(line)
                prog = parse_progress(stage, line, len(st.spec.imageKeys))
                if prog and time.monotonic() - last_push > 1:
                    last_push = time.monotonic()
                    self._update(st, progress=prog)
            return proc.wait()
        finally:
            timer.cancel()
            logf.flush()

    @staticmethod
    def _killpg(proc: subprocess.Popen, sig: int) -> None:
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            pass

    def _kill(self, proc: subprocess.Popen) -> None:
        self._killpg(proc, signal.SIGTERM)

        def escalate():
            try:
                proc.wait(KILL_GRACE_S)
            except subprocess.TimeoutExpired:
                self._killpg(proc, signal.SIGKILL)

        threading.Thread(target=escalate, daemon=True).start()


def to_json(st: JobStatus) -> dict:
    return json.loads(st.model_dump_json(exclude={"spec"}))
