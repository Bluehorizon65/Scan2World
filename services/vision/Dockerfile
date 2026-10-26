FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONPATH=/srv/common

WORKDIR /srv
COPY common/requirements.txt common/requirements.txt
COPY vision/requirements.txt vision/requirements.txt
RUN pip install -r vision/requirements.txt
COPY common/s2w_common common/s2w_common
COPY vision/app vision/app
RUN useradd -u 1000 -m app && mkdir -p /data && chown app /data
USER app
WORKDIR /srv/vision
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "20"]
