import { lazy, Suspense, useEffect, useState } from "react";

import { buildAuthLoginHref } from "@/shared/auth/redirectPath";
import { loadLazyModule } from "@/shared/lib/moduleLoadError";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
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

type LoginActionProps = { loginNextPath?: string | undefined };

function DiscordLogin({ loginNextPath }: LoginActionProps) {
  const [loginPending, setLoginPending] = useState(false);

  useEffect(() => {
    const restoreNavigation = (event: PageTransitionEvent) => {
      if (event.persisted) setLoginPending(false);
    };
    window.addEventListener("pageshow", restoreNavigation);
    return () => window.removeEventListener("pageshow", restoreNavigation);
  }, []);

  return (
    <>
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
      <p className={contentText.supporting}>
        別のDiscordアカウントを使う場合は、Discord側でログアウトするか、シークレットウィンドウで開きます。
      </p>
    </>
  );
}

export function AuthPanel({ loginNextPath }: LoginActionProps) {
  if (!DevUserPicker) return <DiscordLogin loginNextPath={loginNextPath} />;
  return (
    <Suspense
      fallback={
        <div className="grid gap-2" role="status">
          <span className={fieldText.label}>操作用アカウントを読み込み中…</span>
          <Skeleton className={controlSkeletonHeightClass} />
        </div>
      }
    >
      <DevUserPicker />
    </Suspense>
  );
}
