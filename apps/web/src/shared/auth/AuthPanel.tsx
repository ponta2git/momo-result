import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import type { AuthMeResponse } from "@/shared/api/auth";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import { buildAuthLoginHref } from "@/shared/auth/redirectPath";
import { buttonClassName } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";

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

  if (import.meta.env.DEV) {
    return <DevUserPicker embedded={embedded} force={forceDevPicker} />;
  }

  return (
    <div
      className={cn(
        embedded
          ? "grid gap-2"
          : "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3",
      )}
    >
      {auth ? (
        <p className="text-xs font-semibold text-[var(--color-text-secondary)]">ログイン中</p>
      ) : null}
      {auth ? (
        <p className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">
          {auth.displayName}
        </p>
      ) : (
        <a
          href={buildAuthLoginHref(loginNextPath)}
          aria-busy={loginPending || undefined}
          className={buttonClassName({
            className: loginPending ? "w-fit opacity-85" : "w-fit",
            variant: "primary",
          })}
          onClick={() => setLoginPending(true)}
        >
          {loginPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          ) : null}
          <span>{loginPending ? "Discordへ移動中…" : "Discordでログインする"}</span>
        </a>
      )}
    </div>
  );
}
