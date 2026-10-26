# COLMAP 4.2.1 with CUDA (Ubuntu 24.04). Runs CPU-only (sparse) when no GPU is attached.
FROM colmap/colmap:20260929.8466
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONPATH=/srv/common \
    QT_QPA_PLATFORM=offscreen PATH=/opt/venv/bin:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv
WORKDIR /srv
COPY common/requirements.txt common/requirements.txt
COPY recon/requirements.txt recon/requirements.txt
RUN pip install -r recon/requirements.txt
COPY common/s2w_common common/s2w_common
COPY recon/app recon/app
RUN (id -u 1000 >/dev/null 2>&1 && userdel -r $(id -nu 1000) || true) && useradd -u 1000 -m app && mkdir -p /data && chown app /data
USER app
WORKDIR /srv/recon
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "20"]
