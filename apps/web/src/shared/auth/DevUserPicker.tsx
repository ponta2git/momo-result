import { useQueryClient } from "@tanstack/react-query";
import { useId } from "react";

import { fixedMembers } from "@/features/ocrCapture/localMasters";
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
          setDevUser(event.target.value);
          void queryClient.invalidateQueries();
        }}
        disabled={lockedByEnv}
        className="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
      >
        <option value="">未選択</option>
        {fixedMembers.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.displayName} ({member.memberId})
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
