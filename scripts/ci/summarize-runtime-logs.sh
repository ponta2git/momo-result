#!/usr/bin/env bash
set -euo pipefail

image_ref="${IMAGE_REF:?IMAGE_REF is required.}"

docker run --rm -i \
  --entrypoint /opt/momo-result/bin/momo-runtime-tool \
  "${image_ref}" summarize-logs
