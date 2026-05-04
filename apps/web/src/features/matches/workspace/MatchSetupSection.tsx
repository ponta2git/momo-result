import type { HeldEventResponse } from "@/features/draftReview/api";
import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import type {
  GameTitleListResponse,
  MapMasterListResponse,
  SeasonMasterListResponse,
} from "@/shared/api/masters";
import { Button } from "@/shared/ui/actions/Button";
import { Card } from "@/shared/ui/layout/Card";

const inputClass =
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

type MatchSetupSectionProps = {
  createEventPending: boolean;
  eventDraftValue: string;
  gameTitleItems: GameTitleListResponse["items"];
  heldEvents: HeldEventResponse[];
  mapItems: MapMasterListResponse["items"];
  seasonItems: SeasonMasterListResponse["items"];
  values: MatchFormValues;
  onCreateEvent: () => void;
  onEventDraftChange: (value: string) => void;
  onGameTitleChange: (gameTitleId: string) => void;
  onPatchRoot: (patch: Partial<MatchFormValues>) => void;
};

export function MatchSetupSection({
  createEventPending,
  eventDraftValue,
  gameTitleItems,
  heldEvents,
  mapItems,
  seasonItems,
  values,
  onCreateEvent,
  onEventDraftChange,
  onGameTitleChange,
  onPatchRoot,
}: MatchSetupSectionProps) {
  const selectedHeldEvent = heldEvents.find((event) => event.id === values.heldEventId);

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            記録先と試合条件
          </h2>
          <p className="mt-1 text-sm text-pretty text-[var(--color-text-secondary)]">
            この結果をどの開催履歴・作品として保存するかを先に決めます。開催履歴、シーズン、マップ、オーナーは後から変更できます。
          </p>
        </div>
        {selectedHeldEvent ? (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
            <p className="font-semibold text-[var(--color-text-primary)]">
              {new Date(selectedHeldEvent.heldAt).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              第{values.matchNoInEvent}試合として保存
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-12">
        <label className="grid gap-1 lg:col-span-5">
          <span className={labelClass}>開催履歴</span>
          <select
            className={inputClass}
            value={values.heldEventId}
            onChange={(event) => {
              const selected = heldEvents.find((candidate) => candidate.id === event.target.value);
              onPatchRoot({
                heldEventId: event.target.value,
                matchNoInEvent: (selected?.matchCount ?? 0) + 1,
                playedAt: selected?.heldAt ?? values.playedAt,
              });
            }}
          >
            <option value="">選択してください</option>
            {heldEvents.map((event) => (
              <option key={event.id} value={event.id}>
                {new Date(event.heldAt).toLocaleString()}（{event.matchCount}試合）
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 lg:col-span-2">
          <span className={labelClass}>試合番号</span>
          <input
            aria-label="試合番号"
            className={inputClass}
            inputMode="numeric"
            type="text"
            value={Number.isFinite(values.matchNoInEvent) ? String(values.matchNoInEvent) : ""}
            onChange={(event) =>
              onPatchRoot({
                matchNoInEvent: Number.parseInt(event.target.value.replace(/\D/g, ""), 10),
              })
            }
          />
        </label>

        <label className="grid gap-1 lg:col-span-5">
          <span className={labelClass}>開催日時</span>
          <input
            className={inputClass}
            type="datetime-local"
            value={toLocalDateTime(values.playedAt)}
            onChange={(event) => onPatchRoot({ playedAt: event.target.value })}
          />
        </label>

        <label className="grid gap-1 lg:col-span-3">
          <span className={labelClass}>作品</span>
          <select
            className={inputClass}
            value={values.gameTitleId}
            onChange={(event) => onGameTitleChange(event.target.value)}
          >
            <option value="">選択してください</option>
            {(gameTitleItems ?? []).map((gameTitle) => (
              <option key={gameTitle.id} value={gameTitle.id}>
                {gameTitle.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 lg:col-span-3">
          <span className={labelClass}>シーズン</span>
          <select
            className={inputClass}
            disabled={!values.gameTitleId}
            value={values.seasonMasterId}
            onChange={(event) => onPatchRoot({ seasonMasterId: event.target.value })}
          >
            <option value="">選択してください</option>
            {(seasonItems ?? []).map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 lg:col-span-3">
          <span className={labelClass}>マップ</span>
          <select
            className={inputClass}
            disabled={!values.gameTitleId}
            value={values.mapMasterId}
            onChange={(event) => onPatchRoot({ mapMasterId: event.target.value })}
          >
            <option value="">選択してください</option>
            {(mapItems ?? []).map((mapMaster) => (
              <option key={mapMaster.id} value={mapMaster.id}>
                {mapMaster.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 lg:col-span-3">
          <span className={labelClass}>オーナー</span>
          <select
            className={inputClass}
            value={values.ownerMemberId}
            onChange={(event) =>
              onPatchRoot({ ownerMemberId: event.target.value as MatchFormValues["ownerMemberId"] })
            }
          >
            {fixedMembers.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="mt-4 border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-secondary)]">
          一覧にない開催履歴を追加
        </summary>
        <div className="mt-3 grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 md:grid-cols-[1fr_auto] md:items-end">
          <input
            className={inputClass}
            type="datetime-local"
            value={eventDraftValue}
            onChange={(event) => onEventDraftChange(event.target.value)}
          />
          <Button
            disabled={!eventDraftValue || createEventPending}
            variant="secondary"
            onClick={onCreateEvent}
          >
            作成して選択
          </Button>
        </div>
      </details>
    </Card>
  );
}
