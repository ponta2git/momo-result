import { getFormProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { useMemo } from "react";
import { defaultSetupValues, setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import {
  findGameTitle,
  fixedMembers,
  gameTitles,
  seasons,
} from "@/features/ocrCapture/localMasters";
import { Field } from "@/shared/ui/Field";

type SetupPanelProps = {
  value: SetupFormValues;
  onChange: (value: SetupFormValues) => void;
};

const selectClass = "w-full rounded-2xl border border-white/10 bg-night-950 px-4 py-3 text-white";

export function SetupPanel({ value, onChange }: SetupPanelProps) {
  const selectedGame = useMemo(() => findGameTitle(value.gameTitleId), [value.gameTitleId]);
  const [form, fields] = useForm({
    id: "ocr-setup",
    defaultValue: value,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: setupSchema });
    },
    onSubmit(event, { submission }) {
      event.preventDefault();
      if (submission?.status === "success") {
        onChange(submission.value);
      }
    },
  });

  function patchValue(patch: Partial<SetupFormValues>) {
    const next = { ...value, ...patch };
    const nextGame = findGameTitle(next.gameTitleId);
    if (!nextGame.maps.includes(next.mapName)) {
      next.mapName = nextGame.maps[0] ?? defaultSetupValues.mapName;
    }
    onChange(next);
  }

  return (
    <form {...getFormProps(form)} className="grid gap-4 lg:grid-cols-4">
      <Field label="作品" htmlFor={fields.gameTitleId.id} error={fields.gameTitleId.errors?.[0]}>
        <select
          id={fields.gameTitleId.id}
          name={fields.gameTitleId.name}
          value={value.gameTitleId}
          onChange={(event) =>
            patchValue({ gameTitleId: event.target.value as SetupFormValues["gameTitleId"] })
          }
          className={selectClass}
        >
          {gameTitles.map((gameTitle) => (
            <option key={gameTitle.id} value={gameTitle.id}>
              {gameTitle.displayName}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="シーズン"
        htmlFor={fields.seasonId.id}
        error={fields.seasonId.errors?.[0]}
        hint="OCRには送らず、後続の結果確定で使います。"
      >
        <select
          id={fields.seasonId.id}
          name={fields.seasonId.name}
          value={value.seasonId}
          onChange={(event) => patchValue({ seasonId: event.target.value })}
          className={selectClass}
        >
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.displayName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="マップ" htmlFor={fields.mapName.id} error={fields.mapName.errors?.[0]}>
        <select
          id={fields.mapName.id}
          name={fields.mapName.name}
          value={value.mapName}
          onChange={(event) => patchValue({ mapName: event.target.value })}
          className={selectClass}
        >
          {selectedGame.maps.map((mapName) => (
            <option key={mapName} value={mapName}>
              {mapName}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="オーナー"
        htmlFor={fields.ownerMemberId.id}
        error={fields.ownerMemberId.errors?.[0]}
      >
        <select
          id={fields.ownerMemberId.id}
          name={fields.ownerMemberId.name}
          value={value.ownerMemberId}
          onChange={(event) => patchValue({ ownerMemberId: event.target.value })}
          className={selectClass}
        >
          {fixedMembers.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.displayName}
            </option>
          ))}
        </select>
      </Field>
    </form>
  );
}
