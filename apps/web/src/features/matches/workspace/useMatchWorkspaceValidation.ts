import { useDeferredValue, useMemo } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";

export function useMatchWorkspaceValidation({
  mode,
  showValidationErrors,
  values,
}: {
  mode: WorkspaceMode;
  showValidationErrors: boolean;
  values: MatchFormValues;
}) {
  const deferredValues = useDeferredValue(values);
  const validation = useMemo(() => validateMatchForm(deferredValues), [deferredValues]);
  const emptyErrorPathSet = useMemo(() => new Set<string>(), []);
  const visibleErrorPathSet =
    showValidationErrors || mode !== "create" ? validation.pathSet : emptyErrorPathSet;

  return { validation, visibleErrorPathSet };
}
