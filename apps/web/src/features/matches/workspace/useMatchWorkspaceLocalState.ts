import { useState } from "react";

import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";

export function useMatchWorkspaceLocalState() {
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
