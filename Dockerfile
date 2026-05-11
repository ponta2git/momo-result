# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:24dc26ef1e3c3690f27ebc4136c9c186c3133b25563ae4d7f0692e4d1fe5db0e
ARG JAVA_JDK_IMAGE=eclipse-temurin:25-jdk-noble@sha256:29d2d8af5d12f9ee7aec18f4fb2cd8bc8e6501b748ac62631acd31c867cfa262
ARG JAVA_JRE_IMAGE=eclipse-temurin:25-jre-noble@sha256:b27ca47660a8fa837e47a8533b9b1a3a430295cf29ca28d91af4fd121572dc29
ARG PYTHON_IMAGE=python:3.14-slim-bookworm@sha256:cba2eed20b946f0fcf51f2e736f00b71921884b0704b4301febf8d01032b1792
ARG UBUNTU_IMAGE=ubuntu:noble@sha256:c4a8d5503dfb2a3eb8ab5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b

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
ARG SBT_SHA256=cb23868a34fe2f4ce83c1ded7b0ab5efeba7de9a52f1e739b10b3ff8da844239
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
  sbt stage

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
ARG UV_VERSION=0.9.11
ARG TARGETARCH
ARG UV_AMD64_SHA256=817c0722b437b4b45b9a7e0231616a09db76bab1b8d178ba7a9680c690db19f0
ARG UV_ARM64_SHA256=b695e1796449ea85f967b749f87283678ce284e2c042b4b6fa51fa36ec06f47c
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
