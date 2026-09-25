import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { matchFormInput } from "@/features/matches/workspace/matchNumericDrafts";
import { confirmMatchSchema } from "@/features/matches/workspace/review/confirmMatchFormSchema";

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
  const messages = result.error.issues.map((issue, index) =>
    values.numericDrafts?.[paths[index] ?? ""] !== undefined && issue.code === "invalid_type"
      ? "数値を入力してください"
      : issue.message,
  );

  return {
    ...(messages[0] ? { firstMessage: messages[0] } : {}),
    ...(paths[0] ? { firstPath: paths[0] } : {}),
    messages,
    pathSet,
    success: false,
  };
}
