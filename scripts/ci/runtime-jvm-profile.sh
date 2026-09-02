#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:?Usage: runtime-jvm-profile.sh <image-ref>}"

jvm_flags="$(
  docker run --rm \
    --entrypoint /opt/java/openjdk/bin/java \
    "${image_ref}" \
    -XX:+PrintFlagsFinal \
    -version 2>&1
)"

require_flag() {
  local flag_name="$1"
  local expected_value="$2"
  local actual_value

  actual_value="$(
    awk -v flag_name="${flag_name}" '$2 == flag_name { print $4; exit }' <<<"${jvm_flags}"
  )"
  if [[ "${actual_value}" != "${expected_value}" ]]; then
    echo "Unexpected effective JVM flag: ${flag_name}." >&2
    exit 1
  fi
}

require_flag ActiveProcessorCount 2
require_flag CompressedClassSpaceSize 33554432
require_flag ExitOnOutOfMemoryError true
require_flag InitialHeapSize 33554432
require_flag MaxHeapSize 201326592
require_flag MaxMetaspaceSize 167772160
require_flag NativeMemoryTracking summary
require_flag PrintNMTStatistics true
require_flag ReservedCodeCacheSize 50331648
require_flag ThreadStackSize 512
require_flag TieredStopAtLevel 1
require_flag UseCompactObjectHeaders true
require_flag UseG1GC true
require_flag UseSerialGC false

echo "Effective JVM profile validation passed."
