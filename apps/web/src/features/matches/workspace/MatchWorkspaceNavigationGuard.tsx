import { useCallback, useContext, useEffect } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";

import type { MatchWorkspaceControllerModel } from "@/features/matches/workspace/matchWorkspaceControllerModel";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";

type MatchWorkspaceNavigationGuardProps = {
  model: MatchWorkspaceControllerModel["navigation"]["guard"];
};

function MatchWorkspaceRouterGuard({ model }: MatchWorkspaceNavigationGuardProps) {
  const { dirty, navigationAllowedRef, onDiscard } = model;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !navigationAllowedRef.current &&
      `${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}` !==
        `${nextLocation.pathname}${nextLocation.search}${nextLocation.hash}`,
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && blocker.state === "blocked") {
        blocker.reset();
      }
    },
    [blocker],
  );
  const handleDiscard = useCallback(() => {
    if (blocker.state !== "blocked") {
      return;
    }
    onDiscard();
    navigationAllowedRef.current = true;
    blocker.proceed();
  }, [blocker, navigationAllowedRef, onDiscard]);

  return (
    <AlertDialog
      closeOnSuccess={false}
      confirmLabel="破棄して移動"
      description="入力内容とOCRの確認状況はまだ保存されていません。このページに残れば作業を続けられます。"
      open={blocker.state === "blocked"}
      title="未保存の変更を破棄しますか？"
      onConfirm={handleDiscard}
      onOpenChange={handleOpenChange}
    />
  );
}

export function MatchWorkspaceNavigationGuard(props: MatchWorkspaceNavigationGuardProps) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!props.model.dirty || props.model.navigationAllowedRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [props.model.dirty, props.model.navigationAllowedRef]);

  return dataRouter ? <MatchWorkspaceRouterGuard model={props.model} /> : null;
}
