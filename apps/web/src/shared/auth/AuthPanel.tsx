import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { AuthMeResponse } from "@/shared/api/client";
import { logout } from "@/shared/api/client";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import { buildAuthLoginHref } from "@/shared/auth/redirectPath";

type AuthPanelProps = {
  auth: AuthMeResponse | undefined;
  forceDevPicker?: boolean;
  loginNextPath?: string | undefined;
};

export function AuthPanel({ auth, forceDevPicker = false, loginNextPath }: AuthPanelProps) {
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  if (import.meta.env.DEV) {
    return <DevUserPicker force={forceDevPicker} />;
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <p className="text-xs font-semibold text-[var(--color-text-secondary)]">ログイン中</p>
      {auth ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {auth.displayName}
          </p>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] disabled:opacity-60"
          >
            ログアウト
          </button>
        </div>
      ) : (
        <a
          href={buildAuthLoginHref(loginNextPath)}
          className="mt-2 inline-flex rounded-[var(--radius-sm)] bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 active:opacity-95"
        >
          Discordでログインする
        </a>
      )}
    </div>
  );
}
