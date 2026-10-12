import { useId, useLayoutEffect, useRef, useState } from "react";

import type { PlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { PlayerRadarPreview } from "@/features/seriesAnalysisAdmin/PlayerRadarPreview";
import type { RadarThresholdError } from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import type { RadarThresholdEditor } from "@/features/seriesAnalysisAdmin/useRadarThresholdEditor";
import { orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { UnsavedChangesGuard } from "@/shared/navigation/UnsavedChangesGuard";
import {
  playerRadarAxes,
  playerRadarScoreLabel,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Notice } from "@/shared/ui/feedback/Notice";
import { InputControl } from "@/shared/ui/forms/Control";
import { Field } from "@/shared/ui/forms/Field";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";

export function PlayerRadarThresholdEditor({
  editor,
  model,
}: {
  editor: RadarThresholdEditor;
  model: PlayerRadarAdminModel;
}) {
  const id = useId();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const editStart = useRef(new Map<string, string>());
  const [focusRequest, setFocusRequest] = useState<RadarThresholdError | null>(null);
  const [showReference, setShowReference] = useState(false);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    inputs.current.get(`${focusRequest.axisId}:${focusRequest.index}`)?.focus();
  }, [focusRequest]);
  const { session } = editor;
  if (!session || !model.editing) return null;
  const data = model.editing;
  const pending = editor.saving || model.communicationUnknown;
  const disabled = pending || Boolean(data.permissionReason);
  const selectedAxis =
    playerRadarAxes.find((axis) => axis.id === editor.axis) ?? playerRadarAxes[0];
  const unit = editor.axis === "averageRank" ? "位以下" : "万円以上";
  const preview = editor.preview;
  const currentValues = model.currentBasis?.axes.find(
    (axis) => axis.axisId === editor.axis,
  )?.thresholds;
  const originalValues = session.source.basis.axes.find(
    (axis) => axis.axisId === editor.axis,
  )?.thresholds;
  const errors = editor.showErrors ? (editor.parsed?.errors ?? []) : [];
  const firstError = errors[0];
  const moveToError = (error: RadarThresholdError) => {
    editor.setAxis(error.axisId);
    setFocusRequest({ ...error });
  };
  const saveReason =
    data.saveDisabledReason ??
    (editor.contextChanged
      ? "最新の基準・共有案を確認してください。"
      : editor.noChangeFromCurrent
        ? "適用中の境界と同じ値です。"
        : null);
  const comparisonLabel = editor.canApply
    ? "保存済みの案を正式計算した比較です。"
    : editor.session?.confirmed
      ? "案は保存済みです。「基準の状態を更新」で正式な比較の完了を確認してください。"
      : !editor.ready
        ? editor.composing || editor.parsed?.errors.length
          ? "入力を確認中です。表示中の比較は現在の入力を反映していません。"
          : "入力の反映待ちです。表示中の比較は前回の入力によるものです。"
        : "入力中の仮プレビューです。案はまだ適用されていません。";
  return (
    <section aria-label="採点境界の編集" className="grid min-w-0 grid-cols-1 gap-4">
      <UnsavedChangesGuard
        description="採点境界の変更はまだ共有案に保存されていません。このページに残れば編集を続けられます。"
        model={{
          dirty: editor.changed,
          navigationAllowedRef: editor.navigationAllowedRef,
          onDiscard: editor.finish,
        }}
        pending={pending}
        preservesInput={(current, next) =>
          current.pathname === next.pathname &&
          (new URLSearchParams(current.search).get("gameTitleId") ?? model.gameTitleId) ===
            (new URLSearchParams(next.search).get("gameTitleId") ?? model.gameTitleId)
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className={contentText.heading}>採点境界を調整</h3>
          <p className={contentText.supporting}>編集元: {session.source.label}</p>
        </div>
        <div className={actionRowClass}>
          <Button disabled={disabled} size="sm" variant="quiet" onClick={editor.reset}>
            編集開始時の値へ戻す
          </Button>
          <Button disabled={pending} size="sm" variant="secondary" onClick={editor.finish}>
            編集をやめる
          </Button>
        </div>
      </div>
      {editor.contextChanged ? (
        <Notice
          tone="warning"
          title="適用中の基準または共有案が変わりました"
          action={
            <Button
              disabled={disabled || (!data.current && !data.candidate)}
              variant="secondary"
              onClick={editor.adoptCurrentSource}
            >
              入力を保持して最新の編集元に切り替える
            </Button>
          }
        >
          入力値は保持しています。編集元の参照値と置き換える共有案を確認してから保存してください。
        </Notice>
      ) : null}
      {editor.saveError && !model.communicationUnknown ? (
        <Notice tone="danger" title="案を保存して比較できません">
          {editor.saveError}
        </Notice>
      ) : null}
      {editor.comparisonChanged ? (
        <Notice tone="info" title="正式な比較が更新されました">
          比較に使う記録が変わりました。点数の変化を確認し、「案を保存して比較」で確認を確定してください。
        </Notice>
      ) : null}
      {editor.formalMismatch ? (
        <Notice tone="danger" title="仮プレビューと正式計算が一致しません">
          この案は適用できません。基準の状態を更新し、比較を再確認してください。
        </Notice>
      ) : null}
      {firstError ? (
        <Notice
          tone="warning"
          title="採点境界の入力を確認してください"
          action={
            <Button size="sm" variant="secondary" onClick={() => moveToError(firstError)}>
              最初の不備を修正
            </Button>
          }
        >
          {playerRadarAxes.find((axis) => axis.id === firstError.axisId)?.label}・
          {firstError.index + 2}点: {firstError.message}
        </Notice>
      ) : null}
      <TabsRoot
        value={editor.axis}
        onValueChange={(value) => editor.setAxis(value as typeof editor.axis)}
      >
        <TabsList aria-label="編集する観点" variant="underline">
          {playerRadarAxes.map((axis) => (
            <TabsTab key={axis.id} value={axis.id}>
              {axis.label}
              {errors.some((error) => error.axisId === axis.id) ? "（要確認）" : ""}
            </TabsTab>
          ))}
        </TabsList>
        {playerRadarAxes.map((axis) => (
          <TabsPanel key={axis.id} value={axis.id}>
            {axis.id === editor.axis ? (
              <div className="mt-4 grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)]">
                <div className="grid min-w-0 grid-cols-1 gap-4">
                  <div className="grid gap-1">
                    <p className={contentText.body}>
                      {selectedAxis.description} 境界の単位は{unit}です。
                    </p>
                    <p className={contentText.supporting}>
                      Enterで次の欄、Shift+Enterで前の欄へ。Escでその欄の編集を戻せます。
                    </p>
                    <div>
                      <Button
                        size="sm"
                        variant="quiet"
                        aria-pressed={showReference}
                        onClick={() => setShowReference((current) => !current)}
                      >
                        {showReference ? "編集元の参照値を閉じる" : "編集元の値を参照"}
                      </Button>
                    </div>
                  </div>
                  <fieldset disabled={disabled} className="grid min-w-0 gap-3">
                    <legend className="sr-only">{selectedAxis.label}の9境界</legend>
                    {session.drafts[axis.id].map((text, index) => {
                      const key = `${axis.id}:${index}`;
                      const inputId = `${id}-${axis.id}-${index}`;
                      const error = errors.find(
                        (item) => item.axisId === axis.id && item.index === index,
                      );
                      return (
                        <Field
                          key={key}
                          htmlFor={inputId}
                          label={`${index + 2}点の境界（${unit}）`}
                          error={error?.message}
                          errorId={`${inputId}-error`}
                          descriptionId={`${inputId}-reference`}
                          description={
                            <>
                              適用中:{" "}
                              {currentValues?.[index]
                                ? `${currentValues[index].rawValue} ${unit}`
                                : "未適用"}
                              {showReference ? (
                                <span className="block">
                                  編集元: {originalValues?.[index]?.rawValue} {unit}
                                </span>
                              ) : null}
                            </>
                          }
                        >
                          <InputControl
                            id={inputId}
                            aria-label={`${selectedAxis.label} ${index + 2}点の境界（${unit}）`}
                            aria-describedby={`${inputId}-reference${error ? ` ${inputId}-error` : ""}`}
                            ref={(element) => {
                              if (element) inputs.current.set(key, element);
                              else inputs.current.delete(key);
                            }}
                            type="text"
                            inputMode={axis.id === "averageRank" ? "decimal" : "text"}
                            textAlign="end"
                            value={text}
                            invalid={Boolean(error)}
                            onChange={(event) =>
                              editor.change(axis.id, index, event.currentTarget.value)
                            }
                            onFocus={() => editStart.current.set(key, text)}
                            onCompositionStart={() => editor.setComposing(true)}
                            onCompositionEnd={() => editor.setComposing(false)}
                            onKeyDown={(event) => {
                              if (event.nativeEvent.isComposing || editor.composing) return;
                              if (event.key === "Escape") {
                                event.preventDefault();
                                editor.change(axis.id, index, editStart.current.get(key) ?? text);
                              }
                              if (event.key === "Enter") {
                                event.preventDefault();
                                inputs.current
                                  .get(`${axis.id}:${index + (event.shiftKey ? -1 : 1)}`)
                                  ?.focus();
                              }
                            }}
                          />
                        </Field>
                      );
                    })}
                  </fieldset>
                  <div className="grid justify-items-start gap-2">
                    {session.source.expectedCandidateId ? (
                      <p className={contentText.supporting}>
                        保存すると、現在共有中の変更案をこの入力で置き換えます。適用中の基準は変わりません。
                      </p>
                    ) : null}
                    <Button
                      disabled={disabled || Boolean(saveReason) || editor.composing}
                      pending={editor.saving}
                      pendingLabel="案を保存中"
                      onClick={async () => {
                        const error = await editor.save();
                        if (error) moveToError(error);
                      }}
                    >
                      案を保存して比較
                    </Button>
                    {saveReason ? <p className={contentText.supporting}>{saveReason}</p> : null}
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-4">
                  <p className={contentText.body} role="status" aria-live="polite">
                    {comparisonLabel}
                  </p>
                  {data.evaluationMessage ? (
                    <Notice tone="info" title={data.evaluationMessage}>
                      {null}
                    </Notice>
                  ) : null}
                  {preview?.after ? (
                    <section
                      aria-label={`${selectedAxis.label}の点数変化`}
                      className="grid gap-3 sm:grid-cols-2"
                    >
                      {orderFixedMembers(preview.after.players).map((player) => {
                        const before = preview.before?.players
                          .find((entry) => entry.memberId === player.memberId)
                          ?.axes.find((cell) => cell.axisId === axis.id);
                        const after = player.axes.find((cell) => cell.axisId === axis.id);
                        const delta =
                          before?.score != null && after?.score != null
                            ? after.score - before.score
                            : null;
                        return (
                          <div key={player.memberId} className="grid gap-1">
                            <MemberSequenceLabel memberId={player.memberId}>
                              {player.displayName}
                            </MemberSequenceLabel>
                            <p className={cn(contentText.body, "tabular-nums")}>
                              適用中 {playerRadarScoreLabel(before)} → 変更案{" "}
                              {playerRadarScoreLabel(after)}
                              {delta !== null ? `（${delta > 0 ? "+" : ""}${delta}）` : ""}
                            </p>
                          </div>
                        );
                      })}
                    </section>
                  ) : null}
                  {preview ? (
                    <PlayerRadarPreview
                      preview={preview}
                      filter={model.previewFilter}
                      updating={data.evaluationUpdating}
                      onSeasonChange={model.actions.selectSeason}
                      onMapChange={model.actions.selectMap}
                      onResetFilter={model.actions.resetPreviewFilter}
                    />
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField
                        label="比較するシーズン"
                        options={model.previewFilter.seasonOptions}
                        value={model.previewFilter.seasonMasterId}
                        onValueChange={model.actions.selectSeason}
                      />
                      <SelectField
                        label="比較するマップ"
                        options={model.previewFilter.mapOptions}
                        value={model.previewFilter.mapMasterId}
                        onValueChange={model.actions.selectMap}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </TabsPanel>
        ))}
      </TabsRoot>
    </section>
  );
}
