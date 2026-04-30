import { getFormProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import {
  listGameTitles,
  listMapMasters,
  listSeasonMasters,
} from "@/shared/api/masters";
import { Field } from "@/shared/ui/Field";

type SetupPanelProps = {
  value: SetupFormValues;
  onChange: (value: SetupFormValues) => void;
};

const selectClass =
  "w-full rounded-2xl border border-line-soft bg-capture-black/45 px-4 py-3 text-ink-100 transition hover:border-white/18";

export function SetupPanel({ value, onChange }: SetupPanelProps) {
  const gameTitlesQuery = useQuery({
    queryKey: ["masters", "game-titles"],
    queryFn: listGameTitles,
  });
  const mapMastersQuery = useQuery({
    queryKey: ["masters", "map-masters", value.gameTitleId],
    queryFn: () => listMapMasters(value.gameTitleId || undefined),
    enabled: Boolean(value.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    queryKey: ["masters", "season-masters", value.gameTitleId],
    queryFn: () => listSeasonMasters(value.gameTitleId || undefined),
    enabled: Boolean(value.gameTitleId),
  });

  const gameTitles = gameTitlesQuery.data?.items ?? [];
  const mapMasters = mapMastersQuery.data?.items ?? [];
  const seasonMasters = seasonMastersQuery.data?.items ?? [];

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

  useEffect(() => {
    if (value.gameTitleId) {
      const stillValid = gameTitles.some((gt) => gt.id === value.gameTitleId);
      if (!stillValid && gameTitles.length > 0) {
        onChange({ ...value, gameTitleId: gameTitles[0]!.id, mapMasterId: "", seasonMasterId: "" });
      }
      return;
    }
    if (gameTitles.length > 0) {
      onChange({ ...value, gameTitleId: gameTitles[0]!.id });
    }
  }, [gameTitles, onChange, value]);

  useEffect(() => {
    if (!value.gameTitleId) return;
    const first = mapMasters[0];
    const stillValid = mapMasters.some((item) => item.id === value.mapMasterId);
    if (!stillValid && first && first.gameTitleId === value.gameTitleId) {
      onChange({ ...value, mapMasterId: first.id });
    }
  }, [mapMasters, onChange, value]);

  useEffect(() => {
    if (!value.gameTitleId) return;
    const first = seasonMasters[0];
    const stillValid = seasonMasters.some((item) => item.id === value.seasonMasterId);
    if (!stillValid && first && first.gameTitleId === value.gameTitleId) {
      onChange({ ...value, seasonMasterId: first.id });
    }
  }, [seasonMasters, onChange, value]);

  function patchValue(patch: Partial<SetupFormValues>) {
    onChange({ ...value, ...patch });
  }

  return (
    <form {...getFormProps(form)} className="grid gap-4 lg:grid-cols-4">
      <Field label="作品" htmlFor={fields.gameTitleId.id} error={fields.gameTitleId.errors?.[0]}>
        <select
          id={fields.gameTitleId.id}
          name={fields.gameTitleId.name}
          value={value.gameTitleId}
          onChange={(event) =>
            patchValue({
              gameTitleId: event.target.value,
              mapMasterId: "",
              seasonMasterId: "",
            })
          }
          className={selectClass}
          disabled={gameTitles.length === 0}
        >
          {gameTitles.length === 0 ? (
            <option value="">読み込み中…</option>
          ) : (
            gameTitles.map((gameTitle) => (
              <option key={gameTitle.id} value={gameTitle.id}>
                {gameTitle.name}
              </option>
            ))
          )}
        </select>
      </Field>

      <Field
        label="シーズン"
        htmlFor={fields.seasonMasterId.id}
        error={fields.seasonMasterId.errors?.[0]}
        hint="OCRには送らず、後続の結果確定で使います。"
      >
        <select
          id={fields.seasonMasterId.id}
          name={fields.seasonMasterId.name}
          value={value.seasonMasterId}
          onChange={(event) => patchValue({ seasonMasterId: event.target.value })}
          className={selectClass}
          disabled={seasonMasters.length === 0}
        >
          {seasonMasters.length === 0 ? (
            <option value="">未登録</option>
          ) : (
            seasonMasters.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))
          )}
        </select>
      </Field>

      <Field
        label="マップ"
        htmlFor={fields.mapMasterId.id}
        error={fields.mapMasterId.errors?.[0]}
      >
        <select
          id={fields.mapMasterId.id}
          name={fields.mapMasterId.name}
          value={value.mapMasterId}
          onChange={(event) => patchValue({ mapMasterId: event.target.value })}
          className={selectClass}
          disabled={mapMasters.length === 0}
        >
          {mapMasters.length === 0 ? (
            <option value="">未登録</option>
          ) : (
            mapMasters.map((mapMaster) => (
              <option key={mapMaster.id} value={mapMaster.id}>
                {mapMaster.name}
              </option>
            ))
          )}
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
