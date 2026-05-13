import { useCallback } from "react";

import type { MatchFormValues, WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import { validateMatchForm } from "@/features/matches/workspace/matchFormValidation";

export function useMatchWorkspacePrimaryAction(input: {
  mode: WorkspaceMode;
  setConfirmOpen: (open: boolean) => void;
  setShowValidationErrors: (show: boolean) => void;
  setValidationMessage: (message: string) => void;
  update: (values: MatchFormValues) => void;
  values: MatchFormValues;
}) {
  const { mode, setConfirmOpen, setShowValidationErrors, setValidationMessage, update, values } =
    input;

  return useCallback(() => {
    const nextValidation = validateMatchForm(values);
    if (!nextValidation.success) {
      setShowValidationErrors(true);
      setValidationMessage(nextValidation.firstMessage ?? "入力内容を確認してください");
      return;
    }
    setShowValidationErrors(false);
    setValidationMessage("");
    if (mode === "edit") {
      update(values);
      return;
    }
    setConfirmOpen(true);
  }, [mode, setConfirmOpen, setShowValidationErrors, setValidationMessage, update, values]);
}
