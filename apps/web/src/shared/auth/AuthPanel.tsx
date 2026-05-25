import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import type { AuthMeResponse } from "@/shared/api/auth";
import { logout } from "@/shared/api/auth";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import { buildAuthLoginHref } from "@/shared/auth/redirectPath";
import { Button, buttonClassName } from "@/shared/ui/actions/Button";
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
  const queryClient = useQueryClient();
  const [loginPending, setLoginPending] = useState(false);
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

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
      <p className="text-xs font-semibold text-[var(--color-text-secondary)]">
        {auth ? "ログイン中" : "Discordログイン"}
      </p>
      {auth ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {auth.displayName}
          </p>
          <Button
            disabled={logoutMutation.isPending}
            pending={logoutMutation.isPending}
            pendingLabel="ログアウト中"
            size="sm"
            variant="secondary"
            onClick={() => logoutMutation.mutate()}
          >
            ログアウト
          </Button>
        </div>
      ) : (
        <a
          href={buildAuthLoginHref(loginNextPath)}
          aria-busy={loginPending || undefined}
          className={buttonClassName({
            className: loginPending ? "mt-1 w-fit opacity-85" : "mt-1 w-fit",
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
