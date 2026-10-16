import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createHeldEventRequest } from "@/features/heldEvents/heldEventViewModel";
import type {
  HeldEventCreateFormModel,
  HeldEventDeleteDialogModel,
} from "@/features/heldEvents/heldEventViewModel";
import { syncHeldEventCreatedCache, syncHeldEventDeletedCache } from "@/shared/api/heldEventCache";
import { createHeldEvent, deleteHeldEvent } from "@/shared/api/heldEvents";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { toLocalDateTimeInputValue } from "@/shared/lib/dateTime";
import type { UnsavedChangesGuardModel } from "@/shared/navigation/UnsavedChangesGuard";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateState = { version: 0 };

/** Owns create/delete dialogs and writes; committed cache changes outlive this screen. */
export function useHeldEventCommands(): {
  create: HeldEventCreateFormModel;
  deleteDialog: HeldEventDeleteDialogModel;
  errorMessage: string;
  navigationGuard: UnsavedChangesGuardModel;
  openCreate: () => void;
  requestDelete: (event: HeldEventResponse) => void;
} {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [heldAtDraft, setHeldAtDraft] = useState(toLocalDateTimeInputValue);
  const [errorMessage, setErrorMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HeldEventResponse | null>(null);
  const mountedRef = useRef(false);
  const navigationAllowedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [createState, createAction, createPending] = useActionState<
    typeof initialCreateState,
    FormData
  >(async (previous, formData) => {
    const creation = createHeldEventRequest(String(formData.get("heldAt") ?? ""));
    if (creation.kind === "invalid") {
      setErrorMessage(creation.message);
      return previous;
    }
    try {
      const event = await runIdempotentMutation(
        idempotencyKeys,
        "heldEvents.createHeldEvent",
        creation.request,
        (options) => createHeldEvent(creation.request, options),
      );
      await syncHeldEventCreatedCache(queryClient, event);
      if (!mountedRef.current) return { version: previous.version + 1 };
      setHeldAtDraft(toLocalDateTimeInputValue());
      setErrorMessage("");
      setCreateOpen(false);
      showToast({ title: "開催を作成しました。", tone: "success" });
      navigationAllowedRef.current = true;
      navigate(`/held-events/${encodeURIComponent(event.id)}`);
      return { version: previous.version + 1 };
    } catch (error) {
      if (mountedRef.current) setErrorMessage(formatApiError(error, "開催の作成に失敗しました"));
      return previous;
    }
  }, initialCreateState);
  const { isPending: deletePending, mutateAsync: deleteEventAsync } = useMutation({
    mutationFn: (event: HeldEventResponse) =>
      runIdempotentMutation(
        idempotencyKeys,
        "heldEvents.deleteHeldEvent",
        { heldEventId: event.id },
        (options) => deleteHeldEvent(event.id, options),
      ),
    onSuccess: async (_response, event) => {
      await syncHeldEventDeletedCache(queryClient, event.id);
      if (!mountedRef.current) return;
      setDeleteTarget(null);
      setErrorMessage("");
      showToast({ title: "開催を削除しました。", tone: "success" });
    },
  });
  const updateCreateOpen = useCallback((open: boolean) => {
    setCreateOpen(open);
    if (open) {
      navigationAllowedRef.current = false;
      setErrorMessage("");
    }
  }, []);
  const openCreate = useCallback(() => updateCreateOpen(true), [updateCreateOpen]);
  const cancelDelete = useCallback(() => setDeleteTarget(null), []);
  const confirmDelete = useCallback(
    async (event: HeldEventResponse) => {
      await deleteEventAsync(event);
    },
    [deleteEventAsync],
  );

  return {
    create: {
      action: createAction,
      canSubmit: createHeldEventRequest(heldAtDraft).kind === "ready",
      errorMessage,
      formKey: createState.version,
      heldAtDraft,
      open: createOpen,
      pending: createPending,
      setHeldAtDraft,
      setOpen: updateCreateOpen,
    },
    deleteDialog: {
      cancel: cancelDelete,
      confirm: confirmDelete,
      pending: deletePending,
      target: deleteTarget,
    },
    errorMessage,
    navigationGuard: {
      dirty: false,
      navigationAllowedRef,
      onDiscard: () => setCreateOpen(false),
    },
    openCreate,
    requestDelete: setDeleteTarget,
  };
}
