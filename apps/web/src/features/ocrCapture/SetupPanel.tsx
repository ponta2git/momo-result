import type { OcrSetupPanelModel } from "@/features/ocrCapture/ocrSetupPanelModel";
import { HeldEventPickerField } from "@/shared/heldEvents/HeldEventPickerField";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TextField } from "@/shared/ui/forms/TextField";

type SetupPanelProps = {
  model: OcrSetupPanelModel;
};

export function SetupPanel({ model }: SetupPanelProps) {
  const { fields, intents } = model;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <HeldEventPickerField
        disabled={fields.heldEvent.disabled}
        emptyChoiceDescription="あとで確認画面から開催を設定できます。"
        emptyChoiceLabel="開催を選ばず取り込む"
        error={fields.heldEvent.error}
        heldEvents={fields.heldEvent.heldEvents}
        className="xl:col-span-3"
        label="開催（任意）"
        name="ocr-held-event"
        pagination={fields.heldEvent.pagination}
        pending={fields.heldEvent.pending}
        selectedHeldEvent={fields.heldEvent.selectedHeldEvent}
        unavailableLabel={fields.heldEvent.unavailableLabel}
        value={fields.heldEvent.value}
        onPageChange={intents.changeHeldEventPage}
        onValueChange={intents.changeHeldEvent}
      />

      <TextField
        disabled={fields.matchNo.disabled}
        fieldClassName="xl:col-span-1"
        inputMode="numeric"
        label="試合番号"
        min={1}
        type="number"
        value={fields.matchNo.value}
        onChange={(event) => intents.changeMatchNo(event.currentTarget.value)}
      />

      <SelectField
        disabled={fields.gameTitle.disabled}
        error={fields.gameTitle.error}
        fieldClassName="xl:col-span-2"
        label="作品"
        options={fields.gameTitle.options}
        value={fields.gameTitle.value}
        onChange={(event) => intents.changeGameTitle(event.currentTarget.value)}
      />

      <SelectField
        disabled={fields.season.disabled}
        error={fields.season.error}
        fieldClassName="xl:col-span-2"
        label="シーズン"
        options={fields.season.options}
        value={fields.season.value}
        onChange={(event) => intents.changeSeason(event.currentTarget.value)}
      />

      <SelectField
        disabled={fields.map.disabled}
        error={fields.map.error}
        fieldClassName="xl:col-span-2"
        label="マップ"
        options={fields.map.options}
        value={fields.map.value}
        onChange={(event) => intents.changeMap(event.currentTarget.value)}
      />

      <SelectField
        fieldClassName="xl:col-span-2"
        label="オーナー"
        options={fields.owner.options}
        value={fields.owner.value}
        onChange={(event) => intents.changeOwner(event.currentTarget.value)}
      />
    </div>
  );
}
