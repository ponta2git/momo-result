import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchSetupActions,
  MatchSetupOptions,
} from "@/features/matches/workspace/MatchSetupSection";
import { fixedMembers } from "@/shared/domain/members";
import { cn } from "@/shared/ui/cn";

export const matchSetupInputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-xs font-semibold text-[var(--color-text-secondary)]";

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function FieldError({ errorPathSet, path }: { errorPathSet: Set<string>; path: string }) {
  return errorPathSet.has(path) ? (
    <span className="text-xs font-semibold text-[var(--color-danger)]">未入力です</span>
  ) : null;
}

export function MatchSetupFields({
  actions,
  errorPathSet,
  options,
  values,
}: {
  actions: MatchSetupActions;
  errorPathSet: Set<string>;
  options: MatchSetupOptions;
  values: MatchFormValues;
}) {
  const errorClass = "border-[var(--color-danger)]/70 bg-[var(--color-danger)]/10";
  const inputStateClass = (path: string) =>
    cn(matchSetupInputClass, errorPathSet.has(path) ? errorClass : "");

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <label className="grid gap-1 lg:col-span-5">
        <span className={labelClass}>開催履歴（必須）</span>
        <select
          aria-invalid={errorPathSet.has("heldEventId")}
          className={inputStateClass("heldEventId")}
          data-validation-path="heldEventId"
          value={values.heldEventId}
          onChange={(event) => {
            const selected = options.heldEvents.find(
              (candidate) => candidate.id === event.target.value,
            );
            actions.onPatchRoot({
              heldEventId: event.target.value,
              matchNoInEvent: (selected?.matchCount ?? 0) + 1,
              playedAt: selected?.heldAt ?? values.playedAt,
            });
          }}
        >
          <option value="">未選択</option>
          {options.heldEvents.map((event) => (
            <option key={event.id} value={event.id}>
              {new Date(event.heldAt).toLocaleString()}（{event.matchCount}試合）
            </option>
          ))}
        </select>
        <FieldError errorPathSet={errorPathSet} path="heldEventId" />
      </label>

      <label className="grid gap-1 lg:col-span-2">
        <span className={labelClass}>試合番号（必須）</span>
        <input
          aria-label="試合番号"
          aria-invalid={errorPathSet.has("matchNoInEvent")}
          className={inputStateClass("matchNoInEvent")}
          data-validation-path="matchNoInEvent"
          inputMode="numeric"
          type="text"
          value={Number.isFinite(values.matchNoInEvent) ? String(values.matchNoInEvent) : ""}
          onChange={(event) =>
            actions.onPatchRoot({
              matchNoInEvent: Number.parseInt(event.target.value.replaceAll(/\D/gu, ""), 10),
            })
          }
        />
        <FieldError errorPathSet={errorPathSet} path="matchNoInEvent" />
      </label>

      <label className="grid gap-1 lg:col-span-5">
        <span className={labelClass}>開催日時（必須）</span>
        <input
          aria-invalid={errorPathSet.has("playedAt")}
          className={inputStateClass("playedAt")}
          data-validation-path="playedAt"
          type="datetime-local"
          value={toLocalDateTime(values.playedAt)}
          onChange={(event) => actions.onPatchRoot({ playedAt: event.target.value })}
        />
        <FieldError errorPathSet={errorPathSet} path="playedAt" />
      </label>

      <label className="grid gap-1 lg:col-span-3">
        <span className={labelClass}>作品（必須）</span>
        <select
          aria-invalid={errorPathSet.has("gameTitleId")}
          className={inputStateClass("gameTitleId")}
          data-validation-path="gameTitleId"
          value={values.gameTitleId}
          onChange={(event) => actions.onGameTitleChange(event.target.value)}
        >
          <option value="">未選択</option>
          {(options.gameTitleItems ?? []).map((gameTitle) => (
            <option key={gameTitle.id} value={gameTitle.id}>
              {gameTitle.name}
            </option>
          ))}
        </select>
        <FieldError errorPathSet={errorPathSet} path="gameTitleId" />
      </label>

      <label className="grid gap-1 lg:col-span-3">
        <span className={labelClass}>シーズン（必須）</span>
        <select
          aria-invalid={errorPathSet.has("seasonMasterId")}
          className={inputStateClass("seasonMasterId")}
          data-validation-path="seasonMasterId"
          disabled={!values.gameTitleId}
          value={values.seasonMasterId}
          onChange={(event) => actions.onPatchRoot({ seasonMasterId: event.target.value })}
        >
          <option value="">未選択</option>
          {(options.seasonItems ?? []).map((season) => (
            <option key={season.id} value={season.id}>
              {season.name}
            </option>
          ))}
        </select>
        <FieldError errorPathSet={errorPathSet} path="seasonMasterId" />
      </label>

      <label className="grid gap-1 lg:col-span-3">
        <span className={labelClass}>マップ（必須）</span>
        <select
          aria-invalid={errorPathSet.has("mapMasterId")}
          className={inputStateClass("mapMasterId")}
          data-validation-path="mapMasterId"
          disabled={!values.gameTitleId}
          value={values.mapMasterId}
          onChange={(event) => actions.onPatchRoot({ mapMasterId: event.target.value })}
        >
          <option value="">未選択</option>
          {(options.mapItems ?? []).map((mapMaster) => (
            <option key={mapMaster.id} value={mapMaster.id}>
              {mapMaster.name}
            </option>
          ))}
        </select>
        <FieldError errorPathSet={errorPathSet} path="mapMasterId" />
      </label>

      <label className="grid gap-1 lg:col-span-3">
        <span className={labelClass}>オーナー（必須）</span>
        <select
          aria-invalid={errorPathSet.has("ownerMemberId")}
          className={inputStateClass("ownerMemberId")}
          data-validation-path="ownerMemberId"
          value={values.ownerMemberId}
          onChange={(event) =>
            actions.onPatchRoot({
              ownerMemberId: event.target.value as MatchFormValues["ownerMemberId"],
            })
          }
        >
          {fixedMembers.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.displayName}
            </option>
          ))}
        </select>
        <FieldError errorPathSet={errorPathSet} path="ownerMemberId" />
      </label>
    </div>
  );
}
