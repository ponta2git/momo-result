import { useId } from "react";

import type { SetupFormValues } from "@/features/ocrCapture/schema";
import { useOcrSetupOptions } from "@/features/ocrCapture/useOcrSetupOptions";
import { fixedMembers } from "@/shared/domain/members";
import { Field } from "@/shared/ui/forms/Field";

type SetupPanelProps = {
  value: SetupFormValues;
  onChange: (value: SetupFormValues) => void;
  enabled?: boolean;
  authAccountId?: string | undefined;
};

const selectClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60";

export function SetupPanel({ value, onChange, enabled = true, authAccountId }: SetupPanelProps) {
  const fieldIdPrefix = useId();
  const {
    gameTitles,
    gameTitlesError,
    gameTitlesPlaceholder,
    mapMasters,
    mapMastersError,
    mapMastersPlaceholder,
    seasonMasters,
    seasonMastersError,
    seasonMastersPlaceholder,
  } = useOcrSetupOptions({
    authAccountId,
    enabled,
    onChange,
    value,
  });

  const gameTitleId = `${fieldIdPrefix}-game-title`;
  const seasonMasterId = `${fieldIdPrefix}-season-master`;
  const mapMasterId = `${fieldIdPrefix}-map-master`;
  const ownerMemberId = `${fieldIdPrefix}-owner-member`;

  function patchValue(patch: Partial<SetupFormValues>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <Field label="作品（必須）" htmlFor={gameTitleId}>
        <select
          id={gameTitleId}
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
        label="シーズン（必須）"
        htmlFor={seasonMasterId}
        description="読み取り結果の確認と確定に使います。"
      >
        <select
          id={seasonMasterId}
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

      <Field label="マップ（必須）" htmlFor={mapMasterId}>
        <select
          id={mapMasterId}
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

      <Field label="オーナー（必須）" htmlFor={ownerMemberId}>
        <select
          id={ownerMemberId}
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
    </div>
  );
}
