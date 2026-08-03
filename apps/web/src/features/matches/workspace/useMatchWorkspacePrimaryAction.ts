import { useCallback } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";

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
    const nextValidation = validateMatchForm(values);
    if (!nextValidation.success) {
      setShowValidationErrors(true);
      setValidationMessage(nextValidation.firstMessage ?? "入力内容に不足があります");
      onValidationFailure(nextValidation.firstPath ?? "form");
      return;
    }
    setShowValidationErrors(false);
    setValidationMessage("");
    if (mode === "edit") {
      update(values);
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
