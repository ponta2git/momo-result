import { lazy, Suspense, useEffect, useState } from "react";

import type { AuthMeResponse } from "@/shared/api/auth";
import { buildAuthLoginHref } from "@/shared/auth/redirectPath";
import { loadLazyModule } from "@/shared/lib/moduleLoadError";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Skeleton } from "@/shared/ui/feedback/Skeleton";
import { controlSkeletonHeightClass } from "@/shared/ui/forms/controlPresentation";
import { contentText, fieldText } from "@/shared/ui/typography";

const DevUserPicker = import.meta.env.DEV
  ? lazy(() =>
      loadLazyModule(() =>
        import("@/shared/auth/DevUserPicker").then((module) => ({ default: module.DevUserPicker })),
      ),
    )
  : null;

type AuthPanelProps = {
  auth: AuthMeResponse | undefined;
  embedded?: boolean;
  forceDevPicker?: boolean;
  loginNextPath?: string | undefined;
};

export function AuthPanel({
  auth,
  embedded = false,
  forceDevPicker = false,
  loginNextPath,
}: AuthPanelProps) {
  const [loginPending, setLoginPending] = useState(false);

  useEffect(() => {
    const restoreNavigation = (event: PageTransitionEvent) => {
      if (event.persisted) setLoginPending(false);
    };
    window.addEventListener("pageshow", restoreNavigation);
    return () => window.removeEventListener("pageshow", restoreNavigation);
  }, []);

  if (import.meta.env.DEV && DevUserPicker) {
    return (
      <Suspense
        fallback={
          <div className="grid gap-2" role="status">
            <span className={fieldText.label}>操作用アカウントを読み込み中…</span>
            <Skeleton className={controlSkeletonHeightClass} />
          </div>
        }
      >
        <DevUserPicker embedded={embedded} force={forceDevPicker} />
      </Suspense>
    );
  }

  return (
    <div
      className={cn(
        embedded
          ? "grid gap-0.5"
          : "rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3",
      )}
    >
      {auth ? <p className={contentText.supporting}>ログイン中</p> : null}
      {auth ? (
        <p className={cn(contentText.body, !embedded && "mt-0.5")}>{auth.displayName}</p>
      ) : (
        <div className="w-fit">
          <LinkButton
            href={buildAuthLoginHref(loginNextPath)}
            pending={loginPending}
            pendingLabel="Discordへ移動中…"
            onClick={(event) => {
              if (
                !event.defaultPrevented &&
                event.button === 0 &&
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey
              ) {
                setLoginPending(true);
              }
            }}
          >
            Discordでログインする
          </LinkButton>
        </div>
      )}
    </div>
  );
}
