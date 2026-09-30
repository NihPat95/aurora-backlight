# syntax=docker/dockerfile:1

# Node and all frontend build dependencies stay out of the runtime image.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Debian slim supports prebuilt NumPy/OpenCV wheels on both amd64 and arm64.
# Alpine would require musl-compatible wheels or a much heavier source build.
FROM python:3.12-slim-bookworm AS dependencies
ENV PIP_NO_CACHE_DIR=1 \
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=true \
    POETRY_VIRTUALENVS_OPTIONS_NO_PIP=true
WORKDIR /build/backend
RUN pip install poetry==2.4.1
COPY backend/pyproject.toml backend/poetry.lock ./
RUN poetry install --only main --no-root --no-directory

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    BACKLIGHT_DATA_DIR=/data \
    BACKLIGHT_FRONTEND_DIR=/app/frontend \
    BACKLIGHT_TEST_IMAGES_DIR=/app/test_images
WORKDIR /app/backend
COPY --from=dependencies /build/backend/.venv /opt/venv
COPY backend/backlight_tracker/ ./backlight_tracker/
COPY --from=frontend /build/frontend/dist/ /app/frontend/
COPY test_images/ /app/test_images/
RUN groupadd --gid 10001 backlight \
    && useradd --uid 10001 --gid backlight --no-create-home backlight \
    && mkdir /data && chown backlight:backlight /data
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"]
# One foreground process serves the compiled frontend and API, on the same origin.
CMD ["python", "-m", "uvicorn", "backlight_tracker.api:app", "--host", "0.0.0.0", "--port", "8000"]
