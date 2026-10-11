#!/usr/bin/env bash
set -euo pipefail

# Keep only allowlisted identifiers; raw messages and malformed lines never leave
# the collector. Memory follows distinct records, not the number of log lines.
jq -Rn '
  def safe($fallback):
    if type == "string" then
      if test("^[A-Za-z0-9_.-]{1,80}\\z") then . else $fallback end
    else $fallback end;
  reduce inputs as $line (
    {records: {}, exceptionClasses: {}, unstructuredLineCount: 0};
    ($line | try fromjson catch null) as $entry |
    if ($entry | type) != "object" then .unstructuredLineCount += 1
    else
      ($entry | {app: (.app | safe("unknown")),
                 component: (.component | safe("unknown")),
                 level: (.level | safe("unknown")),
                 event: (.event | safe("none"))}) as $record |
      ($record | tojson) as $key |
      .records[$key] = (($record + {count: 0}) + .records[$key] | .count += 1) |
      reduce ($entry.exception_classes | if type == "array" then .[] else empty end) as $class
        (.; .exceptionClasses[($class | safe("UnknownError"))] += 1)
    end
  ) |
  .schemaVersion = 1 |
  .records = ([.records[]] | sort_by(.app, .component, .level, .event))
'
