import type { ExportFormat, ExportScope, ExportScopeIds } from "./exportTypes";

const scopeKeys = ["seasonMasterId", "heldEventId", "matchId"] as const;

export type ExportUrlState = ExportScopeIds & {
  errors: string[];
  format: ExportFormat;
  scope: ExportScope;
};

function formatFromParam(value: string | null): ExportFormat {
  return value === "tsv" ? "tsv" : "csv";
}

function scopeFromKeys(searchParams: URLSearchParams): ExportScope {
  if (searchParams.has("matchId")) return "match";
  if (searchParams.has("heldEventId")) return "heldEvent";
  if (searchParams.has("seasonMasterId")) return "season";
  return "all";
}

export function parseExportSearchParams(searchParams: URLSearchParams): ExportUrlState {
  const ids = {
    heldEventId: searchParams.has("heldEventId")
      ? (searchParams.get("heldEventId") ?? "")
      : undefined,
    matchId: searchParams.has("matchId") ? (searchParams.get("matchId") ?? "") : undefined,
    seasonMasterId: searchParams.has("seasonMasterId")
      ? (searchParams.get("seasonMasterId") ?? "")
      : undefined,
  };
  const activeScopeCount = scopeKeys.filter((key) => searchParams.has(key)).length;
  const errors: string[] = [];
  const rawFormat = searchParams.get("format");

  if (rawFormat && rawFormat !== "csv" && rawFormat !== "tsv") {
    errors.push("format は csv または tsv を指定してください。");
  }
  if (activeScopeCount > 1) {
    errors.push("出力範囲は1つだけ指定してください。");
  }

  return {
    ...ids,
    errors,
    format: formatFromParam(rawFormat),
    scope: scopeFromKeys(searchParams),
  };
}

export function buildExportSearchParams(input: {
  format: ExportFormat;
  scope: ExportScope;
  selectedId?: string | undefined;
}): URLSearchParams {
  const params = new URLSearchParams({ format: input.format });
  const selectedId = input.selectedId?.trim();

  if (input.scope === "season") {
    params.set("seasonMasterId", selectedId ?? "");
  }
  if (input.scope === "heldEvent") {
    params.set("heldEventId", selectedId ?? "");
  }
  if (input.scope === "match") {
    params.set("matchId", selectedId ?? "");
  }

  return params;
}

export function selectedIdForScope(state: ExportScopeIds, scope: ExportScope): string {
  if (scope === "season") return state.seasonMasterId ?? "";
  if (scope === "heldEvent") return state.heldEventId ?? "";
  if (scope === "match") return state.matchId ?? "";
  return "";
}
