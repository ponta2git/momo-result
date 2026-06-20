# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:c2d5ade763cacfb03fe9cb8e8af5d1be5041ff331921fa26a9b231ca3a4f780a
ARG JAVA_JDK_IMAGE=eclipse-temurin:25-jdk-noble@sha256:02aba7518e48cfed96403ac9634e357a40329d6ec9418feb0b32636e43b245a1
ARG JAVA_JRE_IMAGE=eclipse-temurin:25-jre-noble@sha256:f9bd8815e73632c22985ebb133ec49b9fc4ad5ffe0657594ac02748ad0431ab7
ARG PYTHON_IMAGE=python:3.14-slim-bookworm@sha256:a70519002c49552ea0a853de47599cf40479b001bd7a624f1112eaf44dcaccc7
ARG UBUNTU_IMAGE=ubuntu:noble@sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54

FROM ${NODE_IMAGE} AS web-deps
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
ARG SBT_SHA256=84c6dd93c094577ce857d3b7ae450ef7ff88fceec099c8feb1cefac3e4b18a32
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY apps/api/project/build.properties project/build.properties
RUN SBT_VERSION="$(sed -n 's/^sbt.version=//p' project/build.properties)" \
  && test -n "${SBT_VERSION}" \
  && curl -fsSL -o /tmp/sbt.tgz "https://github.com/sbt/sbt/releases/download/v${SBT_VERSION}/sbt-${SBT_VERSION}.tgz" \
  && echo "${SBT_SHA256}  /tmp/sbt.tgz" | sha256sum -c - \
  && tar -xzf /tmp/sbt.tgz -C /opt \
  && rm -f /tmp/sbt.tgz \
  && ln -s /opt/sbt/bin/sbt /usr/local/bin/sbt
COPY apps/api/project/plugins.sbt project/plugins.sbt
COPY apps/api/build.sbt build.sbt

FROM api-deps AS api-builder
COPY apps/api/src src
COPY apps/api/openapi.yaml openapi.yaml
RUN --mount=type=cache,id=sbt-boot,target=/root/.sbt,sharing=locked \
  --mount=type=cache,id=coursier-cache,target=/root/.cache/coursier,sharing=locked \
  --mount=type=cache,id=ivy-cache,target=/root/.ivy2/cache,sharing=locked \
  sbt apiOpenApiCheck stage

FROM ${PYTHON_IMAGE} AS tesseract-builder
ARG TESSERACT_VERSION=5.5.2
ARG TESSERACT_SHA256=6235ea0dae45ea137f59c09320406f5888383741924d98855bd2ce0d16b54f21
ENV LD_LIBRARY_PATH="/opt/tesseract/lib"
ENV PATH="/opt/tesseract/bin:${PATH}"
ENV PKG_CONFIG_PATH="/opt/tesseract/lib/pkgconfig"
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
    libpq5 \
    ninja-build \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /tmp/tesseract.tar.gz "https://github.com/tesseract-ocr/tesseract/archive/refs/tags/${TESSERACT_VERSION}.tar.gz" \
  && echo "${TESSERACT_SHA256}  /tmp/tesseract.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/tesseract.tar.gz --strip-components=1 -C /tmp/tesseract-build \
  && rm -f /tmp/tesseract.tar.gz \
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
ENV LD_LIBRARY_PATH="/opt/tesseract/lib"
ENV PATH="/opt/tesseract/bin:${PATH}"
ENV PKG_CONFIG_PATH="/opt/tesseract/lib/pkgconfig:${PKG_CONFIG_PATH}"
WORKDIR /workspace/apps/ocr-worker
ARG UV_VERSION=0.11.23
ARG TARGETARCH
ARG UV_AMD64_SHA256=e12c4cda2fe8c305510a78380a88f2c32a27e90cdcd123cefd2873388f0ebb5f
ARG UV_ARM64_SHA256=1873a77350f6621279ae1a0d2227f2bd8b67131598f14a7eb0ba2215d3da2c98
RUN case "${TARGETARCH}" in \
    amd64) UV_TARGET="x86_64-unknown-linux-gnu"; UV_SHA256="${UV_AMD64_SHA256}" ;; \
    arm64) UV_TARGET="aarch64-unknown-linux-gnu"; UV_SHA256="${UV_ARM64_SHA256}" ;; \
    *) echo "unsupported TARGETARCH for uv: ${TARGETARCH}" >&2; exit 1 ;; \
  esac \
  && curl -fsSL -o /tmp/uv.tar.gz "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_TARGET}.tar.gz" \
  && echo "${UV_SHA256}  /tmp/uv.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/uv.tar.gz -C /tmp \
  && install -m 0755 "/tmp/uv-${UV_TARGET}/uv" /usr/local/bin/uv \
  && install -m 0755 "/tmp/uv-${UV_TARGET}/uvx" /usr/local/bin/uvx \
  && rm -rf /tmp/uv.tar.gz "/tmp/uv-${UV_TARGET}"

FROM worker-deps AS worker-builder
ARG TESSERACT_VERSION=5.5.2
COPY apps/ocr-worker/pyproject.toml apps/ocr-worker/uv.lock apps/ocr-worker/README.md ./
COPY apps/ocr-worker/src src
RUN --mount=type=cache,id=uv-cache,target=/root/.cache/uv,sharing=locked \
  uv sync --locked --no-dev --no-editable --no-binary-package tesserocr \
  && tesseract --version | grep "tesseract ${TESSERACT_VERSION}" \
  && "${UV_PROJECT_ENVIRONMENT}/bin/python" -c "import psycopg" \
  && "${UV_PROJECT_ENVIRONMENT}/bin/python" -c "import tesserocr; print(tesserocr.tesseract_version())" \
    | grep "tesseract ${TESSERACT_VERSION}"

FROM ${UBUNTU_IMAGE} AS tessdata
ARG TESSDATA_REF=87416418657359cb625c412a48b6e1d6d41c29bd
ARG TESSDATA_LANGS="eng jpn"
ARG TESSDATA_ENG_SHA256=7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
ARG TESSDATA_JPN_SHA256=1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d
WORKDIR /tessdata
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && for lang in ${TESSDATA_LANGS}; do \
    curl -fsSL "https://github.com/tesseract-ocr/tessdata_fast/raw/${TESSDATA_REF}/${lang}.traineddata" \
      -o "${lang}.traineddata"; \
    case "${lang}" in \
      eng) expected="${TESSDATA_ENG_SHA256}" ;; \
      jpn) expected="${TESSDATA_JPN_SHA256}" ;; \
      *) echo "missing checksum for tessdata language: ${lang}" >&2; exit 1 ;; \
    esac; \
    echo "${expected}  ${lang}.traineddata" | sha256sum -c -; \
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
ENV LD_LIBRARY_PATH="/opt/tesseract/lib"
ENV MOMO_OCR_SCHEMA_DIR=/opt/momo-result/docs/schemas
ENV TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
ENV PATH="${JAVA_HOME}/bin:/opt/tesseract/bin:/opt/momo-result/ocr-worker/.venv/bin:${PATH}"
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libarchive13 \
    libcurl4 \
    liblept5 \
    libpq5 \
    nginx \
    supervisor \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p "${TESSDATA_PREFIX}" \
  && rm -f /etc/nginx/sites-enabled/default \
  && mkdir -p /opt/momo-result/bin /run/nginx /srv/momo-result/web /tmp/momo-result/uploads

FROM runtime-base AS runtime
ARG TESSERACT_VERSION=5.5.2
ENV TESSERACT_VERSION=${TESSERACT_VERSION}
COPY --from=tesseract-builder /opt/tesseract /opt/tesseract
COPY --from=tessdata /tessdata/ ${TESSDATA_PREFIX}/
RUN tesseract --version | grep "tesseract ${TESSERACT_VERSION}"
COPY --from=api-builder /workspace/apps/api/target/universal/stage /opt/momo-result/api
COPY --from=worker-builder /opt/momo-result/ocr-worker/.venv /opt/momo-result/ocr-worker/.venv
COPY --from=web-builder /workspace/apps/web/dist /srv/momo-result/web
COPY docs/schemas /opt/momo-result/docs/schemas
COPY deploy/nginx.conf /etc/nginx/nginx.conf.template
COPY deploy/render-nginx-conf.py /opt/momo-result/bin/render-nginx-conf
COPY deploy/start-runtime.sh /opt/momo-result/bin/start-runtime
COPY deploy/supervisord.conf /etc/supervisor/conf.d/momo-result.conf
RUN chmod +x /opt/momo-result/bin/render-nginx-conf /opt/momo-result/bin/start-runtime

EXPOSE 8080
CMD ["/opt/momo-result/bin/start-runtime"]
