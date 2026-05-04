import { getFormProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { setupSchema } from "@/features/ocrCapture/schema";
import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import type {
  GameTitleResponse,
  MapMasterResponse,
  SeasonMasterResponse,
} from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { shouldShowQueryError } from "@/shared/api/queryErrorState";
import { Field } from "@/shared/ui/forms/Field";

type SetupPanelProps = {
  value: SetupFormValues;
  onChange: (value: SetupFormValues) => void;
  enabled?: boolean;
  authMemberId?: string | undefined;
};

const selectClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60";

const emptyGameTitles: GameTitleResponse[] = [];
const emptyMapMasters: MapMasterResponse[] = [];
const emptySeasonMasters: SeasonMasterResponse[] = [];

function queryErrorMessage(error: unknown): string | undefined {
  if (!error) {
    return undefined;
  }
  const normalized = normalizeUnknownApiError(error);
  return normalized.status === 401
    ? "ログイン後にマスタを読み込めます。"
    : normalized.detail || normalized.title;
}

export function SetupPanel({ value, onChange, enabled = true, authMemberId }: SetupPanelProps) {
  const authScope = authMemberId ?? "anonymous";
  const gameTitlesQuery = useQuery({
    queryKey: ["masters", "game-titles", authScope],
    queryFn: listGameTitles,
    enabled,
  });
  const mapMastersQuery = useQuery({
    queryKey: ["masters", "map-masters", authScope, value.gameTitleId],
    queryFn: () => listMapMasters(value.gameTitleId || undefined),
    enabled: enabled && Boolean(value.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    queryKey: ["masters", "season-masters", authScope, value.gameTitleId],
    queryFn: () => listSeasonMasters(value.gameTitleId || undefined),
    enabled: enabled && Boolean(value.gameTitleId),
  });

  const gameTitles = gameTitlesQuery.data?.items ?? emptyGameTitles;
  const mapMasters = mapMastersQuery.data?.items ?? emptyMapMasters;
  const seasonMasters = seasonMastersQuery.data?.items ?? emptySeasonMasters;
  const gameTitlesLoadFailed = shouldShowQueryError(gameTitlesQuery);
  const mapMastersLoadFailed = shouldShowQueryError(mapMastersQuery);
  const seasonMastersLoadFailed = shouldShowQueryError(seasonMastersQuery);
  const gameTitlesError = gameTitlesLoadFailed
    ? queryErrorMessage(gameTitlesQuery.error)
    : undefined;
  const mapMastersError = mapMastersLoadFailed
    ? queryErrorMessage(mapMastersQuery.error)
    : undefined;
  const seasonMastersError = seasonMastersLoadFailed
    ? queryErrorMessage(seasonMastersQuery.error)
    : undefined;
  const gameTitlesPlaceholder = !enabled
    ? "ログイン後に読み込みます"
    : gameTitlesLoadFailed
      ? "読み込みに失敗"
      : gameTitlesQuery.isLoading
        ? "読み込み中…"
        : "未登録";
  const seasonMastersPlaceholder = !enabled
    ? "ログイン後に読み込みます"
    : !value.gameTitleId
      ? "作品を選択してください"
      : seasonMastersLoadFailed
        ? "読み込みに失敗"
        : seasonMastersQuery.isLoading
          ? "読み込み中…"
          : "未登録";
  const mapMastersPlaceholder = !enabled
    ? "ログイン後に読み込みます"
    : !value.gameTitleId
      ? "作品を選択してください"
      : mapMastersLoadFailed
        ? "読み込みに失敗"
        : mapMastersQuery.isLoading
          ? "読み込み中…"
          : "未登録";

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
      const first = gameTitles[0];
      if (!stillValid && first) {
        onChange({ ...value, gameTitleId: first.id, mapMasterId: "", seasonMasterId: "" });
      }
      return;
    }
    const fallback = gameTitles[0];
    if (fallback) {
      onChange({ ...value, gameTitleId: fallback.id });
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
          disabled={!enabled || gameTitles.length === 0}
        >
          {gameTitles.length === 0 ? (
            <option value="">{gameTitlesPlaceholder}</option>
          ) : (
            gameTitles.map((gameTitle) => (
              <option key={gameTitle.id} value={gameTitle.id}>
                {gameTitle.name}
              </option>
            ))
          )}
        </select>
        {gameTitlesError ? (
          <p className="mt-1 text-sm text-[var(--color-danger)]" role="alert">
            {gameTitlesError}
          </p>
        ) : null}
      </Field>

      <Field
        label="シーズン"
        htmlFor={fields.seasonMasterId.id}
        error={fields.seasonMasterId.errors?.[0]}
        description="OCRには送らず、後続の結果確定で使います。"
      >
        <select
          id={fields.seasonMasterId.id}
          name={fields.seasonMasterId.name}
          value={value.seasonMasterId}
          onChange={(event) => patchValue({ seasonMasterId: event.target.value })}
          className={selectClass}
          disabled={!enabled || seasonMasters.length === 0}
        >
          {seasonMasters.length === 0 ? (
            <option value="">{seasonMastersPlaceholder}</option>
          ) : (
            seasonMasters.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))
          )}
        </select>
        {seasonMastersError ? (
          <p className="mt-1 text-sm text-[var(--color-danger)]" role="alert">
            {seasonMastersError}
          </p>
        ) : null}
      </Field>

      <Field label="マップ" htmlFor={fields.mapMasterId.id} error={fields.mapMasterId.errors?.[0]}>
        <select
          id={fields.mapMasterId.id}
          name={fields.mapMasterId.name}
          value={value.mapMasterId}
          onChange={(event) => patchValue({ mapMasterId: event.target.value })}
          className={selectClass}
          disabled={!enabled || mapMasters.length === 0}
        >
          {mapMasters.length === 0 ? (
            <option value="">{mapMastersPlaceholder}</option>
          ) : (
            mapMasters.map((mapMaster) => (
              <option key={mapMaster.id} value={mapMaster.id}>
                {mapMaster.name}
              </option>
            ))
          )}
        </select>
        {mapMastersError ? (
          <p className="mt-1 text-sm text-[var(--color-danger)]" role="alert">
            {mapMastersError}
          </p>
        ) : null}
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
