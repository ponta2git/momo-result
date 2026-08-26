import type { SetupFormValues } from "@/features/ocrCapture/schema";
import type { OcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import { canonicalResultMembers } from "@/shared/domain/members";
import { HeldEventPickerField } from "@/shared/heldEvents/HeldEventPickerField";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

type SetupPanelProps = {
  value: SetupFormValues;
  onChange: (value: SetupFormValues) => void;
  enabled: boolean;
  options: OcrSetupOptions;
};

export function SetupPanel({ value, onChange, enabled, options }: SetupPanelProps) {
  const {
    gameTitles,
    gameTitlesError,
    gameTitlesPlaceholder,
    heldEventsError,
    heldEventPicker,
    heldEventsPlaceholder,
    mapMasters,
    mapMastersError,
    mapMastersPlaceholder,
    seasonMasters,
    seasonMastersError,
    seasonMastersPlaceholder,
  } = options;

  function patchValue(patch: Partial<SetupFormValues>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <HeldEventPickerField
        disabled={!enabled}
        emptyChoiceDescription="あとで確認画面から開催を設定できます。"
        emptyChoiceLabel="開催を選ばず取り込む"
        error={heldEventPicker.error ?? heldEventsError}
        heldEvents={heldEventPicker.heldEvents}
        className="xl:col-span-3"
        label="開催（任意）"
        name="ocr-held-event"
        pagination={heldEventPicker.pagination}
        pending={heldEventPicker.pending}
        selectedHeldEvent={heldEventPicker.selectedHeldEvent ?? options.selectedHeldEvent}
        unavailableLabel={heldEventsPlaceholder}
        value={value.heldEventId ?? ""}
        onPageChange={heldEventPicker.onPageChange}
        onValueChange={(heldEventId, selected) => {
          patchValue({
            heldEventId,
            matchNoInEvent: selected?.nextMatchNo,
          });
        }}
      />

      <TextField
        disabled={!enabled || !value.heldEventId}
        fieldClassName="xl:col-span-1"
        inputMode="numeric"
        label="試合番号"
        min={1}
        type="number"
        value={value.matchNoInEvent ?? ""}
        onChange={(event) =>
          patchValue({
            matchNoInEvent: event.currentTarget.value
              ? Math.trunc(Number(event.currentTarget.value))
              : undefined,
          })
        }
      />

      <SelectField
        disabled={!enabled || gameTitles.length === 0}
        error={gameTitlesError}
        fieldClassName="xl:col-span-2"
        label="作品"
        options={
          gameTitles.length === 0
            ? [{ label: gameTitlesPlaceholder, value: "" }]
            : gameTitles.map((gameTitle) => ({ label: gameTitle.name, value: gameTitle.id }))
        }
        value={value.gameTitleId}
        onChange={(event) =>
          patchValue({
            gameTitleId: event.currentTarget.value,
            mapMasterId: "",
            seasonMasterId: "",
          })
        }
      />

      <SelectField
        disabled={!enabled || seasonMasters.length === 0}
        error={seasonMastersError}
        fieldClassName="xl:col-span-2"
        label="シーズン"
        options={
          seasonMasters.length === 0
            ? [{ label: seasonMastersPlaceholder, value: "" }]
            : seasonMasters.map((season) => ({ label: season.name, value: season.id }))
        }
        value={value.seasonMasterId}
        onChange={(event) => patchValue({ seasonMasterId: event.currentTarget.value })}
      />

      <SelectField
        disabled={!enabled || mapMasters.length === 0}
        error={mapMastersError}
        fieldClassName="xl:col-span-2"
        label="マップ"
        options={
          mapMasters.length === 0
            ? [{ label: mapMastersPlaceholder, value: "" }]
            : mapMasters.map((mapMaster) => ({ label: mapMaster.name, value: mapMaster.id }))
        }
        value={value.mapMasterId}
        onChange={(event) => patchValue({ mapMasterId: event.currentTarget.value })}
      />

      <SelectField
        fieldClassName="xl:col-span-2"
        label="オーナー"
        options={canonicalResultMembers.map((member) => ({
          label: member.displayName,
          value: member.memberId,
        }))}
        value={value.ownerMemberId}
        onChange={(event) => patchValue({ ownerMemberId: event.currentTarget.value })}
      />
    </div>
  );
}
