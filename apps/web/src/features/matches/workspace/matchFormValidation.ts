import { confirmMatchSchema } from "@/features/draftReview/schema";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";

type ValidationResult = {
  firstMessage?: string;
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
  const result = confirmMatchSchema.safeParse(values);
  if (result.success) {
    return {
      messages: [],
      pathSet: new Set(),
      success: true,
    };
  }

  const pathSet = new Set(
    result.error.issues.map((issue) =>
      pathToKey(
        issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        ),
      ),
    ),
  );
  const messages = result.error.issues.map((issue) => issue.message);

  return {
    ...(messages[0] ? { firstMessage: messages[0] } : {}),
    messages,
    pathSet,
    success: false,
  };
}
