import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import type { Location } from "react-router-dom";

import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";

export type UnsavedChangesGuardModel = {
  dirty: boolean;
  navigationAllowedRef: { current: boolean };
  onDiscard: () => void | Promise<void>;
  /** Return true only after the current input has been saved for recovery. */
  saveBeforeLeave?: () => boolean;
};

type UnsavedChangesGuardProps = {
  /** The owner may exempt context changes that preserve this editor and all of its input. */
  preservesInput?: (currentLocation: Location, nextLocation: Location) => boolean;
  model: UnsavedChangesGuardModel;
  pending?: boolean;
  showPendingDialog?: boolean;
  description?: string;
  pendingDescription?: string;
};

function UnsavedChangesRouterGuard({
  preservesInput,
  model,
  pending = false,
  showPendingDialog = true,
  description = "入力内容とOCRの確認状況はまだ保存されていません。このページに残れば作業を続けられます。",
  pendingDescription = "送信した操作の結果が分かるまで、このページでお待ちください。",
}: UnsavedChangesGuardProps) {
  const { dirty, navigationAllowedRef, onDiscard, saveBeforeLeave } = model;
  const blockedWhilePending = useRef(false);
  const discarding = useRef(false);
  const discardAttempt = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      discardAttempt.current = null;
    },
    [],
  );
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const shouldBlock =
      (pending || dirty) &&
      !navigationAllowedRef.current &&
      !preservesInput?.(currentLocation, nextLocation) &&
      `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}` !==
        `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}` &&
      (pending || !saveBeforeLeave?.());
    // Capture the decision before an Action can delay the router's blocked render.
    if (shouldBlock && pending) blockedWhilePending.current = true;
    return shouldBlock;
  });

  useLayoutEffect(() => {
    if (blocker.state !== "blocked") {
      return;
    }
    if (pending) {
      blockedWhilePending.current = true;
    } else if (!discarding.current && (blockedWhilePending.current || !dirty)) {
      // A blocked click is not a command to leave after a save finishes or fails.
      blocker.reset();
      blockedWhilePending.current = false;
    }
  }, [blocker, dirty, pending]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && blocker.state === "blocked") {
        blockedWhilePending.current = false;
        blocker.reset();
      }
    },
    [blocker],
  );
  const handleDiscard = async () => {
    if (pending || blocker.state !== "blocked") {
      return;
    }
    discarding.current = true;
    const attempt = Symbol("discard");
    discardAttempt.current = attempt;
    try {
      await onDiscard();
      if (discardAttempt.current !== attempt) return;
      navigationAllowedRef.current = true;
      blocker.proceed();
    } finally {
      discarding.current = false;
    }
  };

  if (pending) {
    if (!showPendingDialog) return null;
    return (
      <Dialog
        description={pendingDescription}
        open={blocker.state === "blocked"}
        title="処理結果を確認しています"
        onOpenChange={handleOpenChange}
      >
        <Button onClick={() => handleOpenChange(false)} variant="secondary">
          このページで待つ
        </Button>
      </Dialog>
    );
  }

  return (
    <AlertDialog
      closeOnSuccess={false}
      confirmLabel="破棄して移動"
      description={description}
      open={blocker.state === "blocked" && dirty}
      title="未保存の変更を破棄しますか？"
      onConfirm={handleDiscard}
      onOpenChange={handleOpenChange}
    />
  );
}

export function UnsavedChangesGuard(props: UnsavedChangesGuardProps) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const { dirty, navigationAllowedRef, saveBeforeLeave } = props.model;
  const { pending } = props;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (navigationAllowedRef.current || (!pending && !dirty)) {
        return;
      }
      if (!pending && saveBeforeLeave?.()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty, navigationAllowedRef, pending, saveBeforeLeave]);

  return dataRouter ? <UnsavedChangesRouterGuard {...props} /> : null;
}
