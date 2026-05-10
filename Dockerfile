# syntax=docker/dockerfile:1.7

ARG JAVA_JDK_IMAGE=eclipse-temurin:25-jdk-noble
ARG JAVA_JRE_IMAGE=eclipse-temurin:25-jre-noble
ARG PYTHON_IMAGE=python:3.14-slim-bookworm

FROM node:24-bookworm-slim AS web-deps
WORKDIR /workspace
ENV PNPM_STORE_DIR=/pnpm/store
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install --frozen-lockfile --store-dir "${PNPM_STORE_DIR}"

FROM web-deps AS web-builder
COPY apps/web apps/web
COPY apps/api/openapi.yaml apps/api/openapi.yaml
RUN pnpm --filter web build

FROM ${JAVA_JDK_IMAGE} AS api-deps
WORKDIR /workspace/apps/api
ENV SBT_OPTS="--enable-native-access=ALL-UNNAMED --sun-misc-unsafe-memory-access=allow"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY apps/api/project/build.properties project/build.properties
RUN SBT_VERSION="$(sed -n 's/^sbt.version=//p' project/build.properties)" \
  && test -n "${SBT_VERSION}" \
  && curl -fsSL "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" \
  | tar -xz -C /opt \
  && ln -s /opt/sbt/bin/sbt /usr/local/bin/sbt
COPY apps/api/project/plugins.sbt project/plugins.sbt
COPY apps/api/build.sbt build.sbt

FROM api-deps AS api-builder
COPY apps/api/src src
COPY apps/api/openapi.yaml openapi.yaml
RUN --mount=type=cache,id=sbt-boot,target=/root/.sbt,sharing=locked \
  --mount=type=cache,id=coursier-cache,target=/root/.cache/coursier,sharing=locked \
  --mount=type=cache,id=ivy-cache,target=/root/.ivy2/cache,sharing=locked \
  sbt stage

FROM ${PYTHON_IMAGE} AS tesseract-builder
ARG TESSERACT_VERSION=5.5.2
ENV LD_LIBRARY_PATH="/opt/tesseract/lib:${LD_LIBRARY_PATH}"
ENV PATH="/opt/tesseract/bin:${PATH}"
ENV PKG_CONFIG_PATH="/opt/tesseract/lib/pkgconfig:${PKG_CONFIG_PATH}"
WORKDIR /tmp/tesseract-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    libarchive-dev \
    libcairo2-dev \
    libcurl4-openssl-dev \
    libicu-dev \
    libleptonica-dev \
    libpango1.0-dev \
    ninja-build \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/tesseract-ocr/tesseract/archive/refs/tags/${TESSERACT_VERSION}.tar.gz" \
  | tar -xz --strip-components=1 -C /tmp/tesseract-build \
  && cmake -S /tmp/tesseract-build -B /tmp/tesseract-cmake \
    -G Ninja \
    -DBUILD_SHARED_LIBS=ON \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    -DCMAKE_INSTALL_PREFIX=/opt/tesseract \
    -DBUILD_TRAINING_TOOLS=OFF \
    -DBUILD_TESTS=OFF \
  && cmake --build /tmp/tesseract-cmake --parallel \
  && cmake --install /tmp/tesseract-cmake \
  && ldconfig \
  && tesseract --version | grep "tesseract ${TESSERACT_VERSION}"

FROM tesseract-builder AS worker-deps
ENV UV_PROJECT_ENVIRONMENT=/opt/momo-result/ocr-worker/.venv
ENV UV_LINK_MODE=copy
ENV LD_LIBRARY_PATH="/opt/tesseract/lib:${LD_LIBRARY_PATH}"
ENV PATH="/root/.local/bin:/opt/tesseract/bin:${PATH}"
ENV PKG_CONFIG_PATH="/opt/tesseract/lib/pkgconfig:${PKG_CONFIG_PATH}"
WORKDIR /workspace/apps/ocr-worker
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

FROM worker-deps AS worker-builder
ARG TESSERACT_VERSION=5.5.2
COPY apps/ocr-worker/pyproject.toml apps/ocr-worker/uv.lock apps/ocr-worker/README.md ./
COPY apps/ocr-worker/src src
RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv,sharing=locked \
  uv sync --locked --no-dev --no-editable --no-binary-package tesserocr \
  && tesseract --version | grep "tesseract ${TESSERACT_VERSION}" \
  && "${UV_PROJECT_ENVIRONMENT}/bin/python" -c "import tesserocr; print(tesserocr.tesseract_version())" \
    | grep "tesseract ${TESSERACT_VERSION}"

FROM ubuntu:noble AS tessdata
ARG TESSDATA_REF=main
ARG TESSDATA_LANGS="eng jpn"
WORKDIR /tessdata
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && for lang in ${TESSDATA_LANGS}; do \
    curl -fsSL "https://github.com/tesseract-ocr/tessdata_fast/raw/${TESSDATA_REF}/${lang}.traineddata" \
      -o "${lang}.traineddata"; \
  done

FROM ${JAVA_JRE_IMAGE} AS java-runtime

FROM ${PYTHON_IMAGE} AS runtime-base
ENV APP_ENV=prod
ENV HTTP_HOST=127.0.0.1
ENV HTTP_PORT=8081
ENV IMAGE_TMP_DIR=/tmp/momo-result/uploads
ENV MOMO_LOG_FORMAT=json
ENV MOMO_LOG_LEVEL=INFO
ENV DB_POOL_SIZE=2
ENV JAVA_OPTS="-XX:MaxRAMPercentage=70 -Djava.security.egd=file:/dev/./urandom"
ENV JAVA_HOME=/opt/java/openjdk
ENV LD_LIBRARY_PATH="/opt/tesseract/lib:${LD_LIBRARY_PATH}"
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
ENV PATH="${JAVA_HOME}/bin:/opt/tesseract/bin:/opt/momo-result/ocr-worker/.venv/bin:${PATH}"
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libarchive13 \
    libcurl4 \
    liblept5 \
    nginx \
    supervisor \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p "${TESSDATA_PREFIX}" \
  && rm -f /etc/nginx/sites-enabled/default \
  && mkdir -p /run/nginx /srv/momo-result/web /tmp/momo-result/uploads

FROM runtime-base AS runtime
ARG TESSERACT_VERSION=5.5.2
ENV TESSERACT_VERSION=${TESSERACT_VERSION}
COPY --from=tesseract-builder /opt/tesseract /opt/tesseract
COPY --from=tessdata /tessdata/ ${TESSDATA_PREFIX}/
RUN tesseract --version | grep "tesseract ${TESSERACT_VERSION}"
COPY --from=api-builder /workspace/apps/api/target/universal/stage /opt/momo-result/api
COPY --from=worker-builder /opt/momo-result/ocr-worker/.venv /opt/momo-result/ocr-worker/.venv
COPY --from=web-builder /workspace/apps/web/dist /srv/momo-result/web
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisor/conf.d/momo-result.conf

EXPOSE 8080
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/momo-result.conf"]
