import { useId } from "react";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { useDevUser } from "@/shared/auth/useDevUser";

type DevUserPickerProps = {
  force?: boolean;
};

export function DevUserPicker({ force = false }: DevUserPickerProps) {
  const id = useId();
  const { devUser, setDevUser, lockedByEnv } = useDevUser();

  if (!import.meta.env.DEV && !force) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-line-soft bg-night-900/72 px-4 py-3 backdrop-blur">
      <label
        htmlFor={id}
        className="block text-xs font-bold tracking-[0.24em] text-ink-300 uppercase"
      >
        Dev User
      </label>
      <select
        id={id}
        value={devUser}
        onChange={(event) => setDevUser(event.target.value)}
        disabled={lockedByEnv}
        className="mt-2 w-full rounded-xl border border-line-soft bg-capture-black/45 px-3 py-2 text-sm text-ink-100"
      >
        <option value="">未選択</option>
        {fixedMembers.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.displayName} ({member.memberId})
          </option>
        ))}
      </select>
      {lockedByEnv ? (
        <p className="mt-2 text-xs text-ink-300">VITE_DEV_USER で固定されています。</p>
      ) : null}
    </div>
  );
}
