import { useCallback, useReducer, useState } from "react";

import {
  createMatchFormReducerState,
  matchFormReducer,
} from "@/features/matches/workspace/matchFormReducer";
import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceInitialData } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceOperationError } from "@/features/matches/workspace/matchWorkspaceOperationError";
import type { SourceImageKind } from "@/features/matches/workspace/sourceImages/sourceImageTypes";
import { toLocalDateTimeInputValue } from "@/shared/lib/dateTime";

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
  const [eventDraftValue, setEventDraftValue] = useState<string>(toLocalDateTimeInputValue);
  const [workspaceData, setWorkspaceData] = useState<MatchWorkspaceInitialData | null>(null);
  const [preferredImageKind, setPreferredImageKind] = useState<SourceImageKind>("total_assets");
  const nowIsoFactory = useCallback(() => new Date().toISOString(), []);
  const emptyFormFactory = useCallback(
    () => createEmptyMatchForm(nowIsoFactory()),
    [nowIsoFactory],
  );
  const [state, dispatch] = useReducer(matchFormReducer, null, () =>
    createMatchFormReducerState(emptyFormFactory()),
  );

  return {
    cancelDraftConfirmOpen,
    confirmOpen,
    dispatch,
    emptyFormFactory,
    eventDraftValue,
    nowIsoFactory,
    operationError,
    preferredImageKind,
    setCancelDraftConfirmOpen,
    setConfirmOpen,
    setEventDraftValue,
    setOperationError,
    setPreferredImageKind,
    setShowValidationErrors,
    setValidationFocusRequest,
    setValidationMessage,
    setWorkspaceData,
    showValidationErrors,
    state,
    validationFocusRequest,
    validationMessage,
    workspaceData,
  };
}
