import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { AuthMeResponse } from "@/shared/api/client";
import { logout } from "@/shared/api/client";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";

type AuthPanelProps = {
  auth: AuthMeResponse | undefined;
  forceDevPicker?: boolean;
};

export function AuthPanel({ auth, forceDevPicker = false }: AuthPanelProps) {
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
    <div className="border-line-soft bg-night-900/72 rounded-2xl border px-4 py-3 backdrop-blur">
      <p className="text-ink-300 text-xs font-bold tracking-[0.24em] uppercase">Account</p>
      {auth ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-ink-100 text-sm font-bold">{auth.displayName}</p>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="border-line-soft text-ink-100 hover:border-rail-gold rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-60"
          >
            ログアウト
          </button>
        </div>
      ) : (
        <a
          href="/api/auth/login"
          className="bg-rail-gold text-night-950 hover:bg-rail-gold/90 mt-2 inline-flex rounded-xl px-4 py-2 text-sm font-black"
        >
          Discordでログイン
        </a>
      )}
    </div>
  );
}
