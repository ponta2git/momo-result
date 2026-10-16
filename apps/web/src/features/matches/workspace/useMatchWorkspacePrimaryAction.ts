import { useCallback } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { prepareMatchWorkspacePrimaryAction } from "@/features/matches/workspace/matchFormValidation";

export function useMatchWorkspacePrimaryAction(input: {
  mode: WorkspaceMode;
  onValidationFailure: (path: string) => void;
  setConfirmOpen: (open: boolean) => void;
  setShowValidationErrors: (show: boolean) => void;
  setValidationMessage: (message: string) => void;
  update: (values: MatchFormValues) => void;
  values: MatchFormValues;
}) {
  const {
    mode,
    onValidationFailure,
    setConfirmOpen,
    setShowValidationErrors,
    setValidationMessage,
    update,
    values,
  } = input;

  return useCallback(() => {
    const action = prepareMatchWorkspacePrimaryAction(mode, values);
    if (action.kind === "invalid") {
      setShowValidationErrors(true);
      setValidationMessage(action.message);
      onValidationFailure(action.path);
      return;
    }
    setShowValidationErrors(false);
    setValidationMessage("");
    if (action.kind === "update") {
      update(action.values);
      return;
    }
    setConfirmOpen(true);
  }, [
    mode,
    onValidationFailure,
    setConfirmOpen,
    setShowValidationErrors,
    setValidationMessage,
    update,
    values,
  ]);
}
