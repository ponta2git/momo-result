#!/usr/bin/env node
// Generate the read-only startup contract from momo-db's owned Drizzle snapshots.
// Usage: node apps/api/scripts/generate-identity-schema-contract.mjs /path/to/momo-db/drizzle [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrations = process.argv[2];
if (!migrations) throw new Error("Pass the pinned momo-db drizzle directory.");
const output = fileURLToPath(
  new URL("../src/main/resources/momo/api/identity-schema-v1.json", import.meta.url),
);
const navigation = new Set([
  "held_events_navigation_idx",
  "matches_navigation_idx",
  "ocr_jobs_claimable_idx",
  "ocr_submissions_status_id_idx",
  "ocr_submissions_status_deadline_idx",
  "series_analysis_job_requests_pending_title_idx",
  "series_analysis_job_requests_job_idx",
  "series_analysis_jobs_title_terminal_idx",
  "series_analysis_jobs_recent_idx",
  "series_analysis_jobs_claim_idx",
  "series_radar_operations_pending_idx",
]);
const actions = {
  "no action": "a",
  restrict: "r",
  cascade: "c",
  "set null": "n",
  "set default": "d",
};
const withoutTable = (value) => value.replace(/"[^"]+"\./g, "");
const normalizeCheck = (value) => withoutTable(value).replace(/[\s()"]/g, "");
const normalizeIndex = (column) => {
  let value = withoutTable(column.expression).replaceAll('"', "").trim();
  if (!column.asc) value += " DESC";
  if ((!column.asc && column.nulls === "last") || (column.asc && column.nulls === "first"))
    value += ` NULLS ${column.nulls.toUpperCase()}`;
  return value;
};
function shape(snapshot) {
  const result = {
    columns: [],
    keys: [],
    foreignKeys: [],
    retainedChecks: [],
    navigationIndexes: [],
  };
  for (const table of Object.values(snapshot.tables).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  )) {
    for (const column of Object.values(table.columns).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      result.columns.push({
        table: table.name,
        column: column.name,
        dataType: column.type.replace("varchar", "character varying").replaceAll(/\s/g, ""),
        notNull: column.notNull,
      });
      if (column.primaryKey)
        result.keys.push({
          table: table.name,
          columns: column.name,
          primary: true,
          nullsNotDistinct: false,
        });
    }
    for (const key of Object.values(table.compositePrimaryKeys))
      result.keys.push({
        table: table.name,
        columns: key.columns.join(","),
        primary: true,
        nullsNotDistinct: false,
      });
    for (const key of Object.values(table.uniqueConstraints))
      result.keys.push({
        table: table.name,
        columns: key.columns.join(","),
        primary: false,
        nullsNotDistinct: key.nullsNotDistinct ?? false,
      });
    for (const index of Object.values(table.indexes)) {
      if (index.isUnique && !index.where && index.columns.every((column) => !column.isExpression))
        result.keys.push({
          table: table.name,
          columns: index.columns.map((column) => column.expression).join(","),
          primary: false,
          nullsNotDistinct: false,
        });
      if (navigation.has(index.name))
        result.navigationIndexes.push({
          table: table.name,
          name: index.name,
          columns: index.columns.map(normalizeIndex),
        });
    }
    for (const key of Object.values(table.foreignKeys))
      result.foreignKeys.push({
        table: table.name,
        columns: key.columnsFrom.join(","),
        targetTable: key.tableTo,
        targetColumns: key.columnsTo.join(","),
        onDelete: actions[key.onDelete],
        onUpdate: actions[key.onUpdate],
      });
    for (const check of Object.values(table.checkConstraints))
      if (check.name.endsWith("_legacy_null_check"))
        result.retainedChecks.push({
          table: table.name,
          name: check.name,
          expression: normalizeCheck(check.value),
        });
  }
  return result;
}
const sourceSnapshots = ["0082_snapshot.json", "0093_snapshot.json"];
const [legacy, canonical] = sourceSnapshots.map((name) =>
  shape(JSON.parse(readFileSync(resolve(migrations, "meta", name), "utf8"))),
);
const content =
  JSON.stringify(
    {
      formatVersion: 1,
      sourceSnapshots,
      optionalTables: ["worker_execution_slots"],
      legacy,
      canonical,
    },
    null,
    2,
  ) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== content)
    throw new Error(
      "The API identity schema contract is stale; regenerate it from the pinned snapshots.",
    );
} else writeFileSync(output, content);
