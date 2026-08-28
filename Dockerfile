# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:c2d5ade763cacfb03fe9cb8e8af5d1be5041ff331921fa26a9b231ca3a4f780a
ARG JAVA_JDK_IMAGE=eclipse-temurin:25-jdk-noble@sha256:02aba7518e48cfed96403ac9634e357a40329d6ec9418feb0b32636e43b245a1
ARG JAVA_JRE_IMAGE=eclipse-temurin:25-jre-noble@sha256:f9bd8815e73632c22985ebb133ec49b9fc4ad5ffe0657594ac02748ad0431ab7
ARG GO_IMAGE=golang:1.26.6-bookworm@sha256:116d58cbd88c1297624acc6e967a060012422bacf9930927e23fb719189c6f36
ARG HTTP4S_REPOSITORY=https://github.com/ponta2git/http4s.git
ARG CADDY_VERSION=v2.11.4
ARG CADDY_X_NET_VERSION=v0.56.0
ARG CADDY_X_TEXT_VERSION=v0.39.0
ARG CADDY_GRPC_VERSION=v1.82.1
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
COPY apps/web/scripts/check-built-theme.mjs apps/web/scripts/check-built-theme.mjs
COPY apps/web/src apps/web/src
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

FROM api-deps AS http4s-builder
ARG HTTP4S_REPOSITORY
WORKDIR /workspace/http4s
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
COPY .http4s-ref /workspace/.http4s-ref
COPY scripts/ci/build-http4s-patch.sh /usr/local/bin/build-http4s-patch
RUN chmod 0755 /usr/local/bin/build-http4s-patch \
  && HTTP4S_REPOSITORY="${HTTP4S_REPOSITORY}" \
    HTTP4S_REF_FILE=/workspace/.http4s-ref \
    HTTP4S_SCALA_VERSION=3.3.6 \
    HTTP4S_PATCH_OUTPUT_DIR=/opt/http4s-patch \
    /usr/local/bin/build-http4s-patch

FROM api-deps AS api-builder
COPY --from=http4s-builder /root/.ivy2/local /root/.ivy2/local
COPY --from=http4s-builder /opt/http4s-patch /opt/http4s-patch
COPY apps/api/src/main src/main
COPY apps/api/src/openapi src/openapi
COPY apps/api/openapi.yaml openapi.yaml
RUN --mount=type=cache,id=sbt-boot,target=/root/.sbt,sharing=locked \
  --mount=type=cache,id=coursier-cache,target=/root/.cache/coursier,sharing=locked \
  --mount=type=cache,id=ivy-cache,target=/root/.ivy2/cache,sharing=locked \
  export HTTP4S_PATCH_VERSION="$(cat /opt/http4s-patch/version.txt)" \
  && sbt "-Dmomo.http4s.patched.version=${HTTP4S_PATCH_VERSION}" apiOpenApiCheck stage

FROM ${GO_IMAGE} AS runtime-tool-builder
WORKDIR /workspace/tools
COPY tools/go.mod tools/go.sum ./
RUN --mount=type=cache,id=go-mod,target=/go/pkg/mod,sharing=locked \
  go mod download
COPY tools/cmd/momo-runtime-tool cmd/momo-runtime-tool
RUN --mount=type=cache,id=go-build,target=/root/.cache/go-build,sharing=locked \
  CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' \
    -o /out/momo-runtime-tool ./cmd/momo-runtime-tool

FROM ${GO_IMAGE} AS caddy-builder
ARG CADDY_VERSION
ARG CADDY_X_NET_VERSION
ARG CADDY_X_TEXT_VERSION
ARG CADDY_GRPC_VERSION
WORKDIR /workspace/caddy
RUN --mount=type=cache,id=caddy-go-mod,target=/go/pkg/mod,sharing=locked \
  go mod download "github.com/caddyserver/caddy/v2@${CADDY_VERSION}" \
  && cp -R "$(go env GOMODCACHE)/github.com/caddyserver/caddy/v2@${CADDY_VERSION}/." . \
  && chmod -R u+w .
RUN --mount=type=cache,id=caddy-go-mod,target=/go/pkg/mod,sharing=locked \
  go get \
    "golang.org/x/net@${CADDY_X_NET_VERSION}" \
    "golang.org/x/text@${CADDY_X_TEXT_VERSION}" \
    "google.golang.org/grpc@${CADDY_GRPC_VERSION}"
RUN --mount=type=cache,id=caddy-go-mod,target=/go/pkg/mod,sharing=locked \
  go mod tidy
RUN --mount=type=cache,id=caddy-go-mod,target=/go/pkg/mod,sharing=locked \
  --mount=type=cache,id=caddy-go-build,target=/root/.cache/go-build,sharing=locked \
  CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=${CADDY_VERSION}" \
    -o /out/caddy ./cmd/caddy \
  && go version -m /out/caddy | awk -v module="golang.org/x/net" \
    -v version="${CADDY_X_NET_VERSION}" \
    '$1 == "dep" && $2 == module && $3 == version { found = 1 } END { exit !found }' \
  && go version -m /out/caddy | awk -v module="golang.org/x/text" \
    -v version="${CADDY_X_TEXT_VERSION}" \
    '$1 == "dep" && $2 == module && $3 == version { found = 1 } END { exit !found }' \
  && go version -m /out/caddy | awk -v module="google.golang.org/grpc" \
    -v version="${CADDY_GRPC_VERSION}" \
    '$1 == "dep" && $2 == module && $3 == version { found = 1 } END { exit !found }'

FROM ${JAVA_JRE_IMAGE} AS java-runtime

FROM ${DEBIAN_RUNTIME_IMAGE} AS runtime
ENV APP_ENV=prod
ENV HTTP_HOST=127.0.0.1
ENV HTTP_PORT=8081
ENV JAVA_HOME=/opt/java/openjdk
ENV JAVA_TOOL_OPTIONS="-Xms32m -Xmx256m -XX:MaxMetaspaceSize=160m -XX:CompressedClassSpaceSize=32m -XX:ReservedCodeCacheSize=48m -Xss512k -XX:+UseSerialGC -XX:ActiveProcessorCount=2 -XX:TieredStopAtLevel=1 -XX:+ExitOnOutOfMemoryError -XX:NativeMemoryTracking=summary -XX:+UnlockDiagnosticVMOptions -XX:+PrintNMTStatistics -Djava.security.egd=file:/dev/./urandom"
ENV MOMO_CADDY_OUTPUT_PATH=/tmp/momo-result/caddy/Caddyfile
ENV MOMO_RUNTIME_STOP_GRACE_SECONDS=30
ENV XDG_CONFIG_HOME=/tmp/momo-result/caddy/config
ENV XDG_DATA_HOME=/tmp/momo-result/caddy/data
ENV PATH="${JAVA_HOME}/bin:/opt/momo-result/bin:${PATH}"
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=caddy-builder /out/caddy /usr/bin/caddy
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libstdc++6 \
    zlib1g \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 momo \
  && useradd --uid 10001 --gid momo --home-dir /nonexistent --shell /usr/sbin/nologin --no-create-home momo \
  && mkdir -p \
    /opt/momo-result/bin \
    /srv/momo-result/web \
    /tmp/momo-result/caddy/config \
    /tmp/momo-result/caddy/data \
    /tmp/momo-result/uploads \
  && chown -R momo:momo /opt/momo-result /srv/momo-result /tmp/momo-result

COPY --from=api-builder --chown=momo:momo /workspace/apps/api/target/universal/stage /opt/momo-result/api
COPY --from=web-builder --chown=momo:momo /workspace/apps/web/dist /srv/momo-result/web
COPY --chown=momo:momo contracts/runtime-db-contract.json /opt/momo-result/contracts/runtime-db-contract.json
COPY --from=http4s-builder --chown=momo:momo /opt/http4s-patch /opt/momo-result/contracts/http4s-patch
COPY deploy/Caddyfile /etc/caddy/Caddyfile.template
COPY --from=runtime-tool-builder --chown=momo:momo /out/momo-runtime-tool /opt/momo-result/bin/momo-runtime-tool
RUN chmod 0755 /opt/momo-result/bin/momo-runtime-tool \
  && /usr/bin/caddy version \
  && /opt/java/openjdk/bin/java -XX:-PrintNMTStatistics -version \
  && /opt/momo-result/bin/momo-runtime-tool smoke edge invalid_host >/dev/null 2>&1; test "$?" -eq 1

EXPOSE 8080
USER momo
CMD ["/opt/momo-result/bin/momo-runtime-tool", "serve"]
