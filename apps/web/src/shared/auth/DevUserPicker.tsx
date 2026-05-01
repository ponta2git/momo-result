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
    <div className="border-line-soft bg-night-900/72 rounded-2xl border px-4 py-3 backdrop-blur">
      <label
        htmlFor={id}
        className="text-ink-300 block text-xs font-bold tracking-[0.24em] uppercase"
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
        className="border-line-soft bg-capture-black/45 text-ink-100 mt-2 w-full rounded-xl border px-3 py-2 text-sm"
      >
        <option value="">未選択</option>
        {fixedMembers.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.displayName} ({member.memberId})
          </option>
        ))}
      </select>
      {lockedByEnv ? (
        <p className="text-ink-300 mt-2 text-xs">VITE_DEV_USER で固定されています。</p>
      ) : null}
    </div>
  );
}
