import { useQueryClient } from "@tanstack/react-query";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { parseHeldEventCreate } from "@/features/heldEvents/create/heldEventCreate";
import type { HeldEventCreateForm } from "@/features/heldEvents/create/heldEventCreate";
import { syncHeldEventCreatedCache } from "@/shared/api/heldEventCache";
import { createHeldEvent } from "@/shared/api/heldEvents";
import { runIdempotentMutation } from "@/shared/api/idempotency";
import { formatApiError } from "@/shared/api/problemDetails";
import { useIdempotencyKeyStore } from "@/shared/api/useIdempotencyKeyStore";
import { heldEventDetailHref } from "@/shared/navigation/publicIdentifiers";
import type { UnsavedChangesGuardModel } from "@/shared/navigation/UnsavedChangesGuard";
import { showToast } from "@/shared/ui/feedback/Toast";

const initialCreateState = { version: 0 };

export type HeldEventCreation = {
  readonly clearError: () => void;
  /**
   * A failure that arrives after its dialog closed, for the screen to report until another action
   * ends; while the dialog is open it reports its own failure.
   */
  readonly closedErrorMessage: string;
  readonly form: HeldEventCreateForm;
  readonly navigationGuard: UnsavedChangesGuardModel;
  readonly open: () => void;
};

/**
 * Owns the creation dialog and its write. A created held event is reconciled into the cache before
 * the screen moves to its hub, where its first match is recorded.
 */
export function useHeldEventCreation(): HeldEventCreation {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const idempotencyKeys = useIdempotencyKeyStore();
  const [errorMessage, setErrorMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
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
    const parsed = parseHeldEventCreate(String(formData.get("heldAt") ?? ""));
    if (parsed.kind === "invalid") {
      setErrorMessage(parsed.message);
      return previous;
    }
    try {
      const event = await runIdempotentMutation(
        idempotencyKeys,
        "heldEvents.createHeldEvent",
        parsed.request,
        (options) => createHeldEvent(parsed.request, options),
      );
      await syncHeldEventCreatedCache(queryClient, event);
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
  const open = useCallback(() => {
    navigationAllowedRef.current = false;
    setErrorMessage("");
    setCreateOpen(true);
  }, []);
  const close = useCallback(() => setCreateOpen(false), []);
  const clearError = useCallback(() => setErrorMessage(""), []);
  // Stable, so a guard on a page that re-renders while polling keeps its listeners in place.
  const navigationGuard = useMemo<UnsavedChangesGuardModel>(
    () => ({
      dirty: false,
      isNavigationAllowed: () => navigationAllowedRef.current,
      onDiscard: close,
    }),
    [close],
  );

  return {
    clearError,
    closedErrorMessage: createOpen ? "" : errorMessage,
    form: {
      action: createAction,
      errorMessage,
      formKey: createState.version,
      open: createOpen,
      pending: createPending,
      close,
    },
    navigationGuard,
    open,
  };
}
