# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:c2d5ade763cacfb03fe9cb8e8af5d1be5041ff331921fa26a9b231ca3a4f780a
ARG JAVA_JDK_IMAGE=eclipse-temurin:25-jdk-noble@sha256:02aba7518e48cfed96403ac9634e357a40329d6ec9418feb0b32636e43b245a1
ARG JAVA_JRE_IMAGE=eclipse-temurin:25-jre-noble@sha256:f9bd8815e73632c22985ebb133ec49b9fc4ad5ffe0657594ac02748ad0431ab7
ARG GO_IMAGE=golang:1.26.5-bookworm@sha256:53eeac89074db483fdf0ab3be1df32bf6e47562263d2d0d6baa7f26acb4957dd
ARG DEBIAN_RUNTIME_IMAGE=debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

FROM ${NODE_IMAGE} AS web-deps
WORKDIR /workspace
ENV PNPM_STORE_DIR=/pnpm/store
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install --frozen-lockfile --store-dir "${PNPM_STORE_DIR}"

FROM web-deps AS web-builder
COPY apps/web/index.html apps/web/index.html
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/vite.config.ts apps/web/vite.config.ts
COPY apps/web/public apps/web/public
COPY apps/web/scripts apps/web/scripts
COPY apps/web/src apps/web/src
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
COPY apps/api/src/main src/main
COPY apps/api/src/openapi src/openapi
COPY apps/api/openapi.yaml openapi.yaml
RUN --mount=type=cache,id=sbt-boot,target=/root/.sbt,sharing=locked \
  --mount=type=cache,id=coursier-cache,target=/root/.cache/coursier,sharing=locked \
  --mount=type=cache,id=ivy-cache,target=/root/.ivy2/cache,sharing=locked \
  sbt apiOpenApiCheck stage

FROM ${GO_IMAGE} AS runtime-tool-builder
WORKDIR /workspace/tools
COPY tools/go.mod tools/go.sum ./
RUN --mount=type=cache,id=go-mod,target=/go/pkg/mod,sharing=locked \
  go mod download
COPY tools/cmd/momo-runtime-tool cmd/momo-runtime-tool
RUN --mount=type=cache,id=go-build,target=/root/.cache/go-build,sharing=locked \
  CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' \
    -o /out/momo-runtime-tool ./cmd/momo-runtime-tool

FROM ${JAVA_JRE_IMAGE} AS java-runtime

FROM ${DEBIAN_RUNTIME_IMAGE} AS runtime
ENV APP_ENV=prod
ENV HTTP_HOST=127.0.0.1
ENV HTTP_PORT=8081
ENV JAVA_HOME=/opt/java/openjdk
ENV JAVA_TOOL_OPTIONS="-Xms32m -Xmx256m -XX:MaxMetaspaceSize=160m -XX:CompressedClassSpaceSize=32m -XX:ReservedCodeCacheSize=48m -Xss512k -XX:+UseSerialGC -XX:ActiveProcessorCount=2 -XX:TieredStopAtLevel=1 -XX:+ExitOnOutOfMemoryError -XX:NativeMemoryTracking=summary -XX:+UnlockDiagnosticVMOptions -XX:+PrintNMTStatistics -Djava.security.egd=file:/dev/./urandom"
ENV MOMO_NGINX_OUTPUT_PATH=/tmp/momo-result/nginx/nginx.conf
ENV MOMO_RUNTIME_STOP_GRACE_SECONDS=30
ENV PATH="${JAVA_HOME}/bin:/opt/momo-result/bin:${PATH}"
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libstdc++6 \
    nginx \
    zlib1g \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 momo \
  && useradd --uid 10001 --gid momo --home-dir /nonexistent --shell /usr/sbin/nologin --no-create-home momo \
  && rm -f /etc/nginx/sites-enabled/default \
  && mkdir -p \
    /opt/momo-result/bin \
    /run/nginx \
    /srv/momo-result/web \
    /tmp/momo-result/nginx/client_body \
    /tmp/momo-result/nginx/fastcgi \
    /tmp/momo-result/nginx/proxy \
    /tmp/momo-result/nginx/scgi \
    /tmp/momo-result/nginx/uwsgi \
    /tmp/momo-result/uploads \
  && chown -R momo:momo /opt/momo-result /run/nginx /srv/momo-result /tmp/momo-result

COPY --from=api-builder --chown=momo:momo /workspace/apps/api/target/universal/stage /opt/momo-result/api
COPY --from=web-builder --chown=momo:momo /workspace/apps/web/dist /srv/momo-result/web
COPY --chown=momo:momo contracts/runtime-db-contract.json /opt/momo-result/contracts/runtime-db-contract.json
COPY deploy/nginx.conf /etc/nginx/nginx.conf.template
COPY --from=runtime-tool-builder --chown=momo:momo /out/momo-runtime-tool /opt/momo-result/bin/momo-runtime-tool
RUN chmod 0755 /opt/momo-result/bin/momo-runtime-tool \
  && /opt/java/openjdk/bin/java -XX:-PrintNMTStatistics -version \
  && /opt/momo-result/bin/momo-runtime-tool smoke edge invalid_host >/dev/null 2>&1; test "$?" -eq 1

EXPOSE 8080
USER momo
CMD ["/opt/momo-result/bin/momo-runtime-tool", "serve"]
