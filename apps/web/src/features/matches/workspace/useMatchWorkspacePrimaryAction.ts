import { useCallback } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { prepareMatchWorkspacePrimaryAction } from "@/features/matches/workspace/matchFormValidation";

export function useMatchWorkspacePrimaryAction(input: {
  mode: WorkspaceMode;
  onValidationFailure: (path: string) => void;
  setConfirmOpen: (open: boolean) => void;
  setShowValidationErrors: (show: boolean) => void;
  setValidationMessage: (message: string) => void;
  saveChanges: (values: MatchFormValues) => void;
  readLatestValues: () => MatchFormValues;
}) {
  const {
    mode,
    onValidationFailure,
    setConfirmOpen,
    setShowValidationErrors,
    setValidationMessage,
    saveChanges,
    readLatestValues,
  } = input;

  return useCallback(() => {
    const action = prepareMatchWorkspacePrimaryAction(mode, readLatestValues());
    if (action.kind === "invalid") {
      setShowValidationErrors(true);
      setValidationMessage(action.message);
      onValidationFailure(action.path);
      return;
    }
    setShowValidationErrors(false);
    setValidationMessage("");
    if (action.kind === "update") {
      saveChanges(action.values);
      return;
    }
    setConfirmOpen(true);
  }, [
    mode,
    onValidationFailure,
    setConfirmOpen,
    setShowValidationErrors,
    setValidationMessage,
    saveChanges,
    readLatestValues,
  ]);
}
