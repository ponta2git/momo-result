import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";

import { Button } from "@/shared/ui/actions/Button";
import { AlertDialog, Dialog } from "@/shared/ui/feedback/Dialog";

export type UnsavedChangesGuardModel = {
  dirty: boolean;
  navigationAllowedRef: { current: boolean };
  onDiscard: () => void;
};

type UnsavedChangesGuardProps = {
  allowSamePathChanges?: boolean;
  model: UnsavedChangesGuardModel;
  pending?: boolean;
  showPendingDialog?: boolean;
  description?: string;
  pendingDescription?: string;
};

function UnsavedChangesRouterGuard({
  allowSamePathChanges = false,
  model,
  pending = false,
  showPendingDialog = true,
  description = "入力内容とOCRの確認状況はまだ保存されていません。このページに残れば作業を続けられます。",
  pendingDescription = "送信した操作の結果が分かるまで、このページでお待ちください。",
}: UnsavedChangesGuardProps) {
  const { dirty, navigationAllowedRef, onDiscard } = model;
  const blockedWhilePending = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => {
      const shouldBlock =
        (pending || dirty) &&
        !navigationAllowedRef.current &&
        (!allowSamePathChanges || currentLocation.pathname !== nextLocation.pathname) &&
        `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}` !==
          `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`;
      // Capture the decision before an Action can delay the router's blocked render.
      if (shouldBlock && pending) blockedWhilePending.current = true;
      return shouldBlock;
    },
  );

  useLayoutEffect(() => {
    if (blocker.state !== "blocked") {
      return;
    }
    if (pending) {
      blockedWhilePending.current = true;
    } else if (blockedWhilePending.current || !dirty) {
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
  const handleDiscard = useCallback(() => {
    if (pending || blocker.state !== "blocked") {
      return;
    }
    onDiscard();
    navigationAllowedRef.current = true;
    blocker.proceed();
  }, [blocker, navigationAllowedRef, onDiscard, pending]);

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

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (props.model.navigationAllowedRef.current || (!props.pending && !props.model.dirty)) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [props.model.dirty, props.model.navigationAllowedRef, props.pending]);

  return dataRouter ? <UnsavedChangesRouterGuard {...props} /> : null;
}
