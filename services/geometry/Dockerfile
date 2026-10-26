FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONPATH=/srv/common
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libegl1 libgl1 libusb-1.0-0 libtbb12 libidn2-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY common/requirements.txt common/requirements.txt
COPY geometry/requirements.txt geometry/requirements.txt
RUN pip install -r geometry/requirements.txt && python -c "import open3d, trimesh, scipy"
COPY common/s2w_common common/s2w_common
COPY geometry/app geometry/app
RUN useradd -u 1000 -m app && mkdir -p /data && chown app /data
USER app
WORKDIR /srv/geometry
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "20"]
