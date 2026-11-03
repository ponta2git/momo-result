import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { matchFormInput } from "@/features/matches/workspace/matchNumericDrafts";
import { confirmMatchSchema } from "@/features/matches/workspace/review/confirmMatchFormSchema";
import { incidentDefinitions } from "@/shared/domain/incidents";
import { memberDisplayName } from "@/shared/domain/members";

const playerValueLabels: Readonly<Record<string, string>> = {
  rank: "順位",
  revenueManYen: "収益",
  totalAssetsManYen: "総資産",
  ...Object.fromEntries(
    incidentDefinitions.map((definition) => [`incidents.${definition.key}`, definition.label]),
  ),
};

/** Names the empty input, so the message points at one cell among the four players' values. */
function emptyValueMessage(values: MatchFormValues, path: string): string {
  const match = /^players\.(\d+)\.(.+)$/u.exec(path);
  const player = match ? values.players[Number(match[1])] : undefined;
  const label = match?.[2] ? playerValueLabels[match[2]] : undefined;
  return player && label
    ? `${memberDisplayName(player.memberId)}の${label}を入力してください`
    : "値を入力してください";
}

type ValidationResult = {
  firstMessage?: string;
  firstPath?: string;
  messages: string[];
  pathSet: Set<string>;
  success: boolean;
};

function pathToKey(path: Array<string | number>): string {
  if (path.length === 0) {
    return "form";
  }
  return path.join(".");
}

export function validateMatchForm(values: MatchFormValues): ValidationResult {
  const result = confirmMatchSchema.safeParse(matchFormInput(values));
  if (result.success) {
    return {
      messages: [],
      pathSet: new Set(),
      success: true,
    };
  }

  const paths = result.error.issues.map((issue) =>
    pathToKey(
      issue.path.filter(
        (segment): segment is string | number =>
          typeof segment === "string" || typeof segment === "number",
      ),
    ),
  );
  const pathSet = new Set(paths);
  const messages = result.error.issues.map((issue, index) => {
    const draft = values.numericDrafts?.[paths[index] ?? ""];
    if (draft === undefined || issue.code !== "invalid_type") return issue.message;
    return draft === "" ? emptyValueMessage(values, paths[index] ?? "") : "数値を入力してください";
  });

  return {
    ...(messages[0] ? { firstMessage: messages[0] } : {}),
    ...(paths[0] ? { firstPath: paths[0] } : {}),
    messages,
    pathSet,
    success: false,
  };
}

/** Validation and mode jointly determine whether this intent saves or opens confirmation. */
export function prepareMatchWorkspacePrimaryAction(
  mode: WorkspaceMode,
  values: MatchFormValues,
):
  | { kind: "invalid"; message: string; path: string }
  | { kind: "update"; values: MatchFormValues }
  | { kind: "confirm" } {
  const validation = validateMatchForm(values);
  if (!validation.success) {
    return {
      kind: "invalid",
      message: validation.firstMessage ?? "入力内容に不足があります",
      path: validation.firstPath ?? "form",
    };
  }
  return mode === "edit" ? { kind: "update", values } : { kind: "confirm" };
}
