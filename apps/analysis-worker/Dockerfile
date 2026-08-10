# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12

ARG RUST_IMAGE=rust:1.97-bookworm@sha256:14bc9c5966e7b3a385794b3d5389a8765668342025fbcc7b2e3d2866ac4bd8c3
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian12:nonroot@sha256:fccdbb0a547c14e23fcf4ce8ad62ca5d43b4faae8d22cd292f490fef9946c96e
ARG DIAGNOSTICS_IMAGE=gcr.io/distroless/cc-debian12:debug-nonroot@sha256:430c9d8d7657178dc91e751ad5efd572730c57df0133b0d1856aa20d3970614c

FROM ${DIAGNOSTICS_IMAGE} AS diagnostics
USER 0:0
SHELL ["/busybox/sh", "-c"]
# Expose only the read-only incident-response applet names the runtime contract permits.
# This narrows the supported command inventory; it is not an authorization boundary.
RUN mkdir -p /momo-toolbox \
  && cp /busybox/busybox /momo-toolbox/.momo-tool \
  && for tool in \
    ps free pgrep top pmap ip netstat nc \
    df du find stat ls cat grep sed awk sort cut tr wc xargs \
    tail head date sha256sum id hostname uname env printenv \
    readlink realpath timeout uptime sleep \
  ; do ln /momo-toolbox/.momo-tool "/momo-toolbox/${tool}"; done

FROM ${RUST_IMAGE} AS builder
WORKDIR /workspace/apps/analysis-worker
COPY apps/analysis-worker/Cargo.toml apps/analysis-worker/Cargo.lock ./
COPY apps/analysis-worker/crates/core/Cargo.toml crates/core/Cargo.toml
COPY apps/analysis-worker/crates/core/src crates/core/src
COPY apps/analysis-worker/src src
RUN --mount=type=cache,id=analysis-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
  --mount=type=cache,id=analysis-cargo-git,target=/usr/local/cargo/git,sharing=locked \
  --mount=type=cache,id=analysis-target,target=/workspace/apps/analysis-worker/target,sharing=locked \
  cargo build --locked --release \
  && install -m 0755 target/release/momo-analysis /tmp/momo-analysis \
  && install -d -m 0700 /tmp/runtime-root/var/lib/momo-analysis

FROM ${RUNTIME_IMAGE} AS runtime
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/momo-toolbox"
COPY --from=diagnostics /momo-toolbox /momo-toolbox
# BusyBox `sh` can rewrite argv[0] and dispatch hidden applets. A separate POSIX shell keeps the
# supported toolbox surface enforceable while still allowing `fly ssh console` access.
COPY --from=builder --chmod=0755 /bin/dash /momo-toolbox/sh
COPY --from=builder --chown=10001:10001 --chmod=0700 \
  /tmp/runtime-root/var/lib/momo-analysis /var/lib/momo-analysis
COPY --from=builder --chmod=0755 /usr/bin/getent /usr/bin/openssl /usr/bin/
COPY --from=builder --chmod=0755 /tmp/momo-analysis /usr/local/bin/momo-analysis
USER 10001:10001
CMD ["/usr/local/bin/momo-analysis", "worker"]
