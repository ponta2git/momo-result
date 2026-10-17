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
import type { UnsavedChangesGuardModel } from "@/shared/navigation/UnsavedChangesGuard";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateState = { version: 0 };
type DeleteTarget = Readonly<Pick<HeldEventResponse, "id" | "heldAt">>;

/** Owns create/delete dialogs and writes; committed cache changes outlive this screen. */
export function useHeldEventCommands(): {
  readonly create: HeldEventCreateFormModel;
  readonly deleteDialog: HeldEventDeleteDialogModel;
  readonly errorMessage: string;
  readonly navigationGuard: UnsavedChangesGuardModel;
  readonly openCreate: () => void;
  readonly requestDelete: (event: DeleteTarget) => void;
} {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [errorMessage, setErrorMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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
    mutationFn: (event: DeleteTarget) =>
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
  const confirmDelete = useCallback(async () => {
    if (deleteTarget) await deleteEventAsync(deleteTarget);
  }, [deleteEventAsync, deleteTarget]);

  return {
    create: {
      action: createAction,
      errorMessage,
      formKey: createState.version,
      open: createOpen,
      pending: createPending,
      close: () => updateCreateOpen(false),
    },
    deleteDialog: {
      cancel: cancelDelete,
      confirm: confirmDelete,
      pending: deletePending,
      target: deleteTarget ? { heldAt: deleteTarget.heldAt } : null,
    },
    errorMessage,
    navigationGuard: {
      dirty: false,
      isNavigationAllowed: () => navigationAllowedRef.current,
      onDiscard: () => setCreateOpen(false),
    },
    openCreate,
    requestDelete: (event) => setDeleteTarget({ id: event.id, heldAt: event.heldAt }),
  };
}
