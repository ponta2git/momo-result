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
    <div className="rounded-2xl border border-line-soft bg-night-900/72 px-4 py-3 backdrop-blur">
      <p className="text-xs font-bold tracking-[0.24em] text-ink-300 uppercase">Account</p>
      {auth ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-ink-100">{auth.displayName}</p>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="rounded-xl border border-line-soft px-3 py-2 text-sm font-bold text-ink-100 hover:border-rail-gold disabled:opacity-60"
          >
            ログアウト
          </button>
        </div>
      ) : (
        <a
          href="/api/auth/login"
          className="mt-2 inline-flex rounded-xl bg-rail-gold px-4 py-2 text-sm font-black text-night-950 hover:bg-rail-gold/90"
        >
          Discordでログイン
        </a>
      )}
    </div>
  );
}
