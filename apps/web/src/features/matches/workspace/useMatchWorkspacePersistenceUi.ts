import { useState } from "react";

import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";

/** Save/delete dialogs and validation feedback belong to persistence, not the editable values. */
export function useMatchWorkspacePersistenceUi() {
  const [validationMessage, setValidationMessage] = useState("");
  const [operationError, setOperationError] = useState<MatchWorkspaceOperationError | null>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelDraftConfirmOpen, setCancelDraftConfirmOpen] = useState(false);
  const [validationFocusRequest, setValidationFocusRequest] = useState<{
    path: string;
    sequence: number;
  } | null>(null);

  return {
    cancelDraftConfirmOpen,
    confirmOpen,
    operationError,
    setCancelDraftConfirmOpen,
    setConfirmOpen,
    setOperationError,
    setShowValidationErrors,
    setValidationFocusRequest,
    setValidationMessage,
    showValidationErrors,
    validationFocusRequest,
    validationMessage,
  };
}
