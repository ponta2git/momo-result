# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12

ARG RUST_IMAGE=rust:1.97-bookworm@sha256:14bc9c5966e7b3a385794b3d5389a8765668342025fbcc7b2e3d2866ac4bd8c3
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian12:latest@sha256:6e1871c34683dc9ee996d13084497783fd98ac0200213d0826625f4e9d4be1d0
ARG DIAGNOSTICS_IMAGE=gcr.io/distroless/cc-debian12:debug-nonroot@sha256:503933e1c6aa9bcb0e1e007c5d14c7595006dc8ea87d94afcd12f8862ea5a20e

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
  ; do ln /momo-toolbox/.momo-tool "/momo-toolbox/${tool}"; done \
  && ! /busybox/grep -Eq '(^momo:|^[^:]*:[^:]*:10001:)' /etc/passwd \
  && ! /busybox/grep -Eq '(^momo:|^[^:]*:[^:]*:10001:)' /etc/group \
  && printf '%s\n' 'momo:x:10001:10001::/nonexistent:/sbin/nologin' >> /etc/passwd \
  && printf '%s\n' 'momo:x:10001:' >> /etc/group

FROM ${RUST_IMAGE} AS native-builder
ARG TESSERACT_VERSION=5.5.2
ARG TESSERACT_SHA256=6235ea0dae45ea137f59c09320406f5888383741924d98855bd2ce0d16b54f21
ENV LD_LIBRARY_PATH="/opt/tesseract/lib"
ENV PATH="/opt/tesseract/bin:${PATH}"
ENV PKG_CONFIG_PATH="/opt/tesseract/lib/pkgconfig"
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    clang \
    cmake \
    curl \
    libarchive-dev \
    libcairo2-dev \
    libclang-dev \
    libcurl4-openssl-dev \
    libicu-dev \
    libleptonica-dev \
    libpango1.0-dev \
    libssl-dev \
    ninja-build \
    openssl \
    pax-utils \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/tesseract-build
RUN curl -fsSL -o /tmp/tesseract.tar.gz \
    "https://github.com/tesseract-ocr/tesseract/archive/refs/tags/${TESSERACT_VERSION}.tar.gz" \
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
  && tesseract --version | grep "tesseract ${TESSERACT_VERSION}"

FROM native-builder AS tessdata
ARG TESSDATA_REF=87416418657359cb625c412a48b6e1d6d41c29bd
ARG TESSDATA_ENG_SHA256=7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
ARG TESSDATA_JPN_SHA256=1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d
WORKDIR /tessdata
RUN for lang in eng jpn; do \
    curl -fsSL \
      "https://github.com/tesseract-ocr/tessdata_fast/raw/${TESSDATA_REF}/${lang}.traineddata" \
      -o "${lang}.traineddata"; \
    case "${lang}" in \
      eng) expected="${TESSDATA_ENG_SHA256}" ;; \
      jpn) expected="${TESSDATA_JPN_SHA256}" ;; \
      *) exit 1 ;; \
    esac; \
    echo "${expected}  ${lang}.traineddata" | sha256sum -c -; \
  done

FROM native-builder AS builder
WORKDIR /workspace/apps/processing-worker
COPY apps/processing-worker/Cargo.toml apps/processing-worker/Cargo.lock ./
COPY apps/processing-worker/crates/analysis-core/Cargo.toml crates/analysis-core/Cargo.toml
COPY apps/processing-worker/crates/analysis-core/src crates/analysis-core/src
COPY apps/processing-worker/crates/ocr/Cargo.toml crates/ocr/Cargo.toml
COPY apps/processing-worker/crates/ocr/src crates/ocr/src
COPY apps/processing-worker/src src
RUN --mount=type=cache,id=analysis-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
  --mount=type=cache,id=analysis-cargo-git,target=/usr/local/cargo/git,sharing=locked \
  --mount=type=cache,id=analysis-target,target=/workspace/apps/processing-worker/target,sharing=locked \
  cargo build --locked --release \
  && install -m 0755 target/release/momo-analysis /tmp/momo-analysis \
  && install -d -m 0700 /tmp/runtime-root/var/lib/momo-analysis \
  && for executable in /tmp/momo-analysis /bin/dash /usr/bin/getent /usr/bin/openssl; do \
    lddtree -l "${executable}"; \
  done \
    | grep -E '^/(lib|usr/lib|opt/tesseract/lib)/' \
    | sort -u \
    > /tmp/runtime-libraries \
  && while IFS= read -r library; do \
    cp -L --parents "${library}" /tmp/runtime-root; \
  done < /tmp/runtime-libraries

FROM ${RUNTIME_IMAGE} AS runtime
ENV PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/momo-toolbox"
ENV LD_LIBRARY_PATH="/opt/tesseract/lib"
ENV TESSDATA_PREFIX="/usr/share/tesseract-ocr/5/tessdata"
COPY --from=diagnostics /momo-toolbox /momo-toolbox
# Keep the service identity resolvable by runtimes that launch the OCI user by name.
COPY --from=diagnostics /etc/passwd /etc/passwd
COPY --from=diagnostics /etc/group /etc/group
# BusyBox `sh` can rewrite argv[0] and dispatch hidden applets. A separate POSIX shell keeps the
# supported toolbox surface enforceable while still allowing `fly ssh console` access.
COPY --from=builder --chmod=0755 /bin/dash /momo-toolbox/sh
COPY --from=builder /tmp/runtime-root/ /
# Copy the parent last so the prepared child directory remains an archive entry whose 0700 mode and
# service ownership cannot be replaced by the root-owned dynamic-library closure above. Copying the
# empty directory's contents directly produced builder-dependent destination permissions because the
# destination directory itself had to be created during the copy.
COPY --from=builder --chown=momo:momo /tmp/runtime-root/var/lib /var/lib
COPY --from=tessdata /tessdata/ /usr/share/tesseract-ocr/5/tessdata/
COPY --from=builder --chmod=0755 /usr/bin/getent /usr/bin/openssl /usr/bin/
COPY --from=builder --chmod=0755 /tmp/momo-analysis /usr/local/bin/momo-analysis
WORKDIR /var/lib/momo-analysis
# Root exists only to prepare the fixed cgroup and delegate cgroup.procs. The bootstrap permanently
# drops supplementary groups and all real/effective/saved IDs before re-execing the worker.
# trivy:ignore:AVD-DS-0002:exp:2026-10-31
USER 0:0
CMD ["/usr/local/bin/momo-analysis", "bootstrap", "--", "worker"]
