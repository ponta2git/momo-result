# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12

# The probe image deliberately inherits the candidate runtime so the kernel-facing experiment
# exercises the same user database and filesystem layout. The caller supplies an
# immutable image reference; there is no public default that could silently test the wrong build.
ARG ANALYSIS_IMAGE
FROM ${ANALYSIS_IMAGE}

COPY --chmod=0755 \
  scripts/tools/cmd/cgroup-memory-probe/out/cgroup-memory-probe \
  /usr/local/bin/cgroup-memory-probe

# Starting the coordinator requires an explicit root user override in the disposable probe runtime.
# Keep the image unprivileged by default; the coordinator fails closed without that override.
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/cgroup-memory-probe"]
CMD ["--limit-bytes", "67108864", "--allocation-bytes", "134217728", "--worker-uid", "10001", "--worker-gid", "10001"]
