import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { MatchWorkspaceSetupFieldsModel } from "@/features/matches/workspace/matchWorkspacePageModelTypes";
import { canonicalResultMembers } from "@/shared/domain/members";
import { HeldEventPickerField } from "@/shared/heldEvents/HeldEventPickerField";
import { toLocalDateTimeInputValue } from "@/shared/lib/dateTime";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

export function MatchSetupFields({ model }: { model: MatchWorkspaceSetupFieldsModel }) {
  const { actions, options, values } = model;
  const fieldError = (path: string) =>
    model.validation.errorPathSet.has(path) ? "未入力です" : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <HeldEventPickerField
        data-validation-path="heldEventId"
        emptyChoiceDescription="試合結果を保存するには開催の選択が必要です。"
        emptyChoiceLabel="未選択"
        error={fieldError("heldEventId") ?? options.heldEventPicker?.error}
        heldEvents={options.heldEventPicker?.heldEvents ?? options.heldEvents}
        className="lg:col-span-5"
        label="開催履歴（必須）"
        name="match-workspace-held-event"
        pagination={options.heldEventPicker?.pagination}
        pending={options.heldEventPicker?.pending}
        required
        selectedHeldEvent={options.heldEventPicker?.selectedHeldEvent}
        unavailableLabel="未選択"
        value={values.heldEventId}
        onPageChange={options.heldEventPicker?.onPageChange}
        onValueChange={(heldEventId, pickerSelection) => {
          const selected =
            pickerSelection ?? options.heldEvents.find((candidate) => candidate.id === heldEventId);
          actions.onPatchRoot({
            heldEventId,
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
        options={canonicalResultMembers.map((member) => ({
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
