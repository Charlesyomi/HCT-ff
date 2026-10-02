# syntax=docker/dockerfile:1
#
# Production image for the FastAPI API.
#
# Migrations are deliberately NOT run on start: with more than one replica every container
# would try to migrate at boot and race each other. Run them as a one-shot job instead
# (`docker compose run --rm migrate`). See docs/RUNBOOK.md.

FROM python:3.12-slim

# curl is only here for the healthcheck below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so application edits do not invalidate the install layer.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Only what the server needs; copying the whole tree would pull in tests and .env files.
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

# Drop privileges: nothing here needs root at runtime.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

# No EXPOSE line: Render (and most PaaS platforms) assigns the listening port through $PORT
# at run time, so a fixed number here would only be misleading.

# /ready checks the database, so a container that cannot reach Postgres reports unhealthy
# instead of accepting traffic. Shell form (no JSON array) so $PORT expands.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/ready" || exit 1

# One worker by default: the outbox worker and the reference-counter row lock are both safe
# across processes, but a single worker keeps the memory footprint predictable on a small
# host. Raise it with `--workers` if /ready shows CPU saturation.
#
# Shell form, not exec form, so ${PORT} is expanded. Render assigns the port at run time and a
# hardcoded 8000 would leave the service listening where Render is not looking, which shows up
# as a failing health check and 502s. The 8000 default keeps local docker-compose working.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
