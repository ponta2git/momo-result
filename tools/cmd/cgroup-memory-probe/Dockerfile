# syntax=docker/dockerfile:1.25.0@sha256:0adf442eae370b6087e08edc7c50b552d80ddf261576f4ebd6421006b2461f12

# The probe image deliberately inherits the candidate runtime so the kernel-facing experiment
# exercises the same user database, filesystem layout, and OCI defaults. The caller supplies an
# immutable image reference; there is no public default that could silently test the wrong build.
ARG ANALYSIS_IMAGE
FROM ${ANALYSIS_IMAGE}

COPY --chmod=0755 \
  tools/cmd/cgroup-memory-probe/out/cgroup-memory-probe \
  /usr/local/bin/cgroup-memory-probe

# This disposable probe must create and delegate a cgroup before it launches the non-root worker
# identity. It has no network service, secrets, or deployment configuration and exits after one
# bounded allocation. Revisit the exception after the production root bootstrap is implemented.
# trivy:ignore:AVD-DS-0002:exp:2026-09-30
USER 0:0
ENTRYPOINT ["/usr/local/bin/cgroup-memory-probe"]
CMD ["--limit-bytes", "67108864", "--allocation-bytes", "134217728", "--worker-uid", "10001", "--worker-gid", "10001"]
