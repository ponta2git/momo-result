import { useCallback, useEffect, useRef, useState } from "react";

import type { HeldEventCreateForm } from "@/features/heldEvents/create/heldEventCreate";
import { useHeldEventCreation } from "@/features/heldEvents/create/useHeldEventCreation";
import type { HeldEventDeleteConfirmation } from "@/features/heldEvents/list/heldEventActions";
import { useHeldEventWrites } from "@/features/heldEvents/list/useHeldEventWrites";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import type { UnsavedChangesGuardModel } from "@/shared/navigation/UnsavedChangesGuard";
import { showToast } from "@/shared/ui/feedback/Toast";

type DeleteTarget = Readonly<Pick<HeldEventResponse, "id" | "heldAt">>;

/** Owns create/delete dialogs and writes; committed cache changes outlive this screen. */
export function useHeldEventActions(): {
  readonly create: HeldEventCreateForm;
  readonly deleteDialog: HeldEventDeleteConfirmation;
  readonly errorMessage: string;
  readonly navigationGuard: UnsavedChangesGuardModel;
  readonly openCreate: () => void;
  readonly requestDelete: (event: DeleteTarget) => void;
} {
  const creation = useHeldEventCreation();
  const { clearError } = creation;
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const mountedRef = useRef(false);
  const onRemoved = useCallback(() => {
    if (!mountedRef.current) return;
    setDeleteTarget(null);
    clearError();
    showToast({ title: "開催を削除しました。", tone: "success" });
  }, [clearError]);
  const { removing: deletePending, remove: deleteEvent } = useHeldEventWrites(onRemoved);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);
  const confirmDelete = useCallback(async () => {
    if (deleteTarget) await deleteEvent(deleteTarget.id);
  }, [deleteEvent, deleteTarget]);

  return {
    create: creation.form,
    deleteDialog: {
      cancel: cancelDelete,
      confirm: confirmDelete,
      pending: deletePending,
      target: deleteTarget ? { heldAt: deleteTarget.heldAt } : null,
    },
    errorMessage: creation.closedErrorMessage,
    navigationGuard: creation.navigationGuard,
    openCreate: creation.open,
    requestDelete: (event) => setDeleteTarget({ id: event.id, heldAt: event.heldAt }),
  };
}
