import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { parseHeldEventCreate } from "@/features/heldEvents/list/heldEventActions";
import type {
  HeldEventCreateForm,
  HeldEventDeleteConfirmation,
} from "@/features/heldEvents/list/heldEventActions";
import { useHeldEventWrites } from "@/features/heldEvents/list/useHeldEventWrites";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatApiError } from "@/shared/api/problemDetails";
import { heldEventDetailHref } from "@/shared/navigation/publicIdentifiers";
import type { UnsavedChangesGuardModel } from "@/shared/navigation/UnsavedChangesGuard";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateState = { version: 0 };
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
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const mountedRef = useRef(false);
  const navigationAllowedRef = useRef(false);
  const onRemoved = useCallback(() => {
    if (!mountedRef.current) return;
    setDeleteTarget(null);
    setErrorMessage("");
    showToast({ title: "開催を削除しました。", tone: "success" });
  }, []);
  const writes = useHeldEventWrites(onRemoved);
  const { removing: deletePending, remove: deleteEvent } = writes;
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
    const parsed = parseHeldEventCreate(String(formData.get("heldAt") ?? ""));
    if (parsed.kind === "invalid") {
      setErrorMessage(parsed.message);
      return previous;
    }
    try {
      const event = await writes.create(parsed.request);
      if (!mountedRef.current) return { version: previous.version + 1 };
      setErrorMessage("");
      setCreateOpen(false);
      showToast({ title: "開催を作成しました。", tone: "success" });
      navigationAllowedRef.current = true;
      navigate(heldEventDetailHref(event.id, event.publicId));
      return { version: previous.version + 1 };
    } catch (error) {
      if (mountedRef.current) setErrorMessage(formatApiError(error, "開催の作成に失敗しました"));
      return previous;
    }
  }, initialCreateState);
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
    if (deleteTarget) await deleteEvent(deleteTarget.id);
  }, [deleteEvent, deleteTarget]);

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
