# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS web-builder
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
COPY apps/api/openapi.yaml apps/api/openapi.yaml
RUN pnpm --filter web build

FROM eclipse-temurin:21-jdk-noble AS api-builder
WORKDIR /workspace/apps/api
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/sbt/sbt/releases/download/v1.12.10/sbt-1.12.10.tgz \
  | tar -xz -C /opt \
  && ln -s /opt/sbt/bin/sbt /usr/local/bin/sbt
COPY apps/api/project project
COPY apps/api/build.sbt build.sbt
COPY apps/api/src src
COPY apps/api/openapi.yaml openapi.yaml
RUN sbt stage

FROM eclipse-temurin:21-jre-noble AS worker-builder
ENV UV_PROJECT_ENVIRONMENT=/opt/momo-result/ocr-worker/.venv
ENV PATH="/root/.local/bin:${PATH}"
WORKDIR /workspace/apps/ocr-worker
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    libleptonica-dev \
    libtesseract-dev \
    pkg-config \
    python3.12 \
    python3.12-dev \
    python3.12-venv \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-jpn \
  && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
COPY apps/ocr-worker/pyproject.toml apps/ocr-worker/uv.lock apps/ocr-worker/README.md ./
COPY apps/ocr-worker/src src
RUN uv sync --locked --no-dev --no-editable

FROM eclipse-temurin:21-jre-noble AS runtime
ENV APP_ENV=prod
ENV HTTP_HOST=127.0.0.1
ENV HTTP_PORT=8081
ENV IMAGE_TMP_DIR=/tmp/momo-result/uploads
ENV MOMO_LOG_FORMAT=json
ENV MOMO_LOG_LEVEL=INFO
ENV DB_POOL_SIZE=2
ENV JAVA_OPTS="-XX:MaxRAMPercentage=70 -Djava.security.egd=file:/dev/./urandom"
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
ENV PATH="/opt/momo-result/ocr-worker/.venv/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    nginx \
    python3.12 \
    supervisor \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-jpn \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/nginx/sites-enabled/default \
  && mkdir -p /run/nginx /srv/momo-result/web /tmp/momo-result/uploads

COPY --from=api-builder /workspace/apps/api/target/universal/stage /opt/momo-result/api
COPY --from=worker-builder /opt/momo-result/ocr-worker/.venv /opt/momo-result/ocr-worker/.venv
COPY --from=web-builder /workspace/apps/web/dist /srv/momo-result/web
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisor/conf.d/momo-result.conf

EXPOSE 8080
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/momo-result.conf"]
