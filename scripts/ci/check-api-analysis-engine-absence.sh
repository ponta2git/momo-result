#!/usr/bin/env bash
set -euo pipefail

stage_directory="${1:-apps/api/target/universal/stage}"

if [[ ! -d "${stage_directory}/lib" ]]; then
  echo "Staged API lib directory was not found: ${stage_directory}/lib" >&2
  exit 1
fi

shopt -s nullglob
application_jars=("${stage_directory}"/lib/momo.momo-result-api-*.jar)
shopt -u nullglob
if [[ "${#application_jars[@]}" -ne 1 ]]; then
  echo "Expected exactly one staged API application jar, found ${#application_jars[@]}." >&2
  exit 1
fi

entries="$(jar tf "${application_jars[0]}")"
legacy_entries="$(grep -E 'momo/api/(usecases/seriescomparison/|.*(SeriesComparison|SeriesRankAnalyzer|RegularizedBradleyTerry|RankBlockBootstrap))' <<<"${entries}" | grep -v '^momo/api/endpoints/SeriesComparisonEndpoints' || true)"
if [[ -n "${legacy_entries}" ]]; then
  echo "Staged API contains removed synchronous Scala analysis classes:" >&2
  printf '%s\n' "${legacy_entries}" >&2
  exit 1
fi

if ! grep -q '^momo/api/endpoints/SeriesComparisonEndpoints.class$' <<<"${entries}"; then
  echo "Legacy reload-required tombstone is missing from the staged API." >&2
  exit 1
fi

echo "Staged API contains only the legacy series-comparison tombstone."
