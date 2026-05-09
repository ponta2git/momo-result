import { useQueryClient } from "@tanstack/react-query";
import { useId } from "react";

import { fixedMembers } from "@/features/auth/members";
import { useDevUser } from "@/shared/auth/useDevUser";

type DevUserPickerProps = {
  force?: boolean;
};

export function DevUserPicker({ force = false }: DevUserPickerProps) {
  const id = useId();
  const queryClient = useQueryClient();
  const { devUser, setDevUser, lockedByEnv } = useDevUser();

  if (!import.meta.env.DEV && !force) {
    return null;
  }

  const devAccounts = fixedMembers.map((member) => ({
    accountId: `account_${member.memberId.replace(/^member_/, "")}`,
    displayName: member.displayName,
  }));

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-[var(--color-text-secondary)]"
      >
        Dev User
      </label>
      <select
        id={id}
        value={devUser}
        onChange={(event) => {
          const next = event.target.value;
          if (next === devUser) return;
          setDevUser(next);
          void queryClient.invalidateQueries();
        }}
        disabled={lockedByEnv}
        className="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
      >
        <option value="">未選択</option>
        {devAccounts.map((account) => (
          <option key={account.accountId} value={account.accountId}>
            {account.displayName} ({account.accountId})
          </option>
        ))}
      </select>
      {lockedByEnv ? (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          VITE_DEV_USER で固定されています。
        </p>
      ) : null}
    </div>
  );
}
