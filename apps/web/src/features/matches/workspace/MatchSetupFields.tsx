import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type {
  MatchSetupActions,
  MatchSetupOptions,
} from "@/features/matches/workspace/MatchSetupSection";
import { fixedMembers } from "@/shared/domain/members";
import { formatDateTimeLong, toLocalDateTimeInputValue } from "@/shared/lib/dateTime";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

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
  const fieldError = (path: string) => (errorPathSet.has(path) ? "未入力です" : undefined);

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <SelectField
        data-validation-path="heldEventId"
        error={fieldError("heldEventId")}
        fieldClassName="lg:col-span-5"
        label="開催履歴（必須）"
        options={[
          { label: "未選択", value: "" },
          ...options.heldEvents.map((event) => ({
            label: `${formatDateTimeLong(event.heldAt)}（${event.matchCount}試合）`,
            value: event.id,
          })),
        ]}
        value={values.heldEventId}
        onChange={(event) => {
          const selected = options.heldEvents.find(
            (candidate) => candidate.id === event.currentTarget.value,
          );
          actions.onPatchRoot({
            heldEventId: event.currentTarget.value,
            matchNoInEvent: selected?.nextMatchNo ?? 1,
            playedAt: selected?.heldAt ?? values.playedAt,
          });
        }}
      />

      <TextField
        aria-label="試合番号"
        data-validation-path="matchNoInEvent"
        error={fieldError("matchNoInEvent")}
        fieldClassName="lg:col-span-2"
        inputMode="numeric"
        label="試合番号（必須）"
        type="text"
        value={Number.isFinite(values.matchNoInEvent) ? String(values.matchNoInEvent) : ""}
        onChange={(event) =>
          actions.onPatchRoot({
            matchNoInEvent: Math.trunc(Number(event.currentTarget.value.replaceAll(/\D/gu, ""))),
          })
        }
      />

      <TextField
        data-validation-path="playedAt"
        error={fieldError("playedAt")}
        fieldClassName="lg:col-span-5"
        label="開催日時（必須）"
        type="datetime-local"
        value={toLocalDateTimeInputValue(values.playedAt)}
        onChange={(event) => actions.onPatchRoot({ playedAt: event.currentTarget.value })}
      />

      <SelectField
        data-validation-path="gameTitleId"
        error={fieldError("gameTitleId")}
        fieldClassName="lg:col-span-3"
        label="作品（必須）"
        options={[
          { label: "未選択", value: "" },
          ...(options.gameTitleItems ?? []).map((gameTitle) => ({
            label: gameTitle.name,
            value: gameTitle.id,
          })),
        ]}
        value={values.gameTitleId}
        onChange={(event) => actions.onGameTitleChange(event.currentTarget.value)}
      />

      <SelectField
        data-validation-path="seasonMasterId"
        disabled={!values.gameTitleId}
        error={fieldError("seasonMasterId")}
        fieldClassName="lg:col-span-3"
        label="シーズン（必須）"
        options={[
          { label: "未選択", value: "" },
          ...(options.seasonItems ?? []).map((season) => ({
            label: season.name,
            value: season.id,
          })),
        ]}
        value={values.seasonMasterId}
        onChange={(event) => actions.onPatchRoot({ seasonMasterId: event.currentTarget.value })}
      />

      <SelectField
        data-validation-path="mapMasterId"
        disabled={!values.gameTitleId}
        error={fieldError("mapMasterId")}
        fieldClassName="lg:col-span-3"
        label="マップ（必須）"
        options={[
          { label: "未選択", value: "" },
          ...(options.mapItems ?? []).map((mapMaster) => ({
            label: mapMaster.name,
            value: mapMaster.id,
          })),
        ]}
        value={values.mapMasterId}
        onChange={(event) => actions.onPatchRoot({ mapMasterId: event.currentTarget.value })}
      />

      <SelectField
        data-validation-path="ownerMemberId"
        error={fieldError("ownerMemberId")}
        fieldClassName="lg:col-span-3"
        label="オーナー（必須）"
        options={fixedMembers.map((member) => ({
          label: member.displayName,
          value: member.memberId,
        }))}
        value={values.ownerMemberId}
        onChange={(event) =>
          actions.onPatchRoot({
            ownerMemberId: event.currentTarget.value as MatchFormValues["ownerMemberId"],
          })
        }
      />
    </div>
  );
}
