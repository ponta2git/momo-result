import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Ref } from "react";

import type { PlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/playerRadarAdminModel";
import { PlayerRadarPreview } from "@/features/seriesAnalysisAdmin/PlayerRadarPreview";
import type { RadarThresholdEditor } from "@/features/seriesAnalysisAdmin/radarThresholdEditorModel";
import type { RadarThresholdError } from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import { playerRadarAxes } from "@/shared/seriesAnalysis/playerRadarPresentation";
import { actionRowClass } from "@/shared/ui/actions/actionGroup";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { AlertDialog } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { InputControl } from "@/shared/ui/forms/Control";
import { Field } from "@/shared/ui/forms/Field";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/shared/ui/forms/Tabs";
import { readableTextWidthClass } from "@/shared/ui/layout/readableText";
import { contentText } from "@/shared/ui/typography";

export function PlayerRadarThresholdEditor({
  editor,
  model,
  onApply,
  applyButtonRef,
  active = true,
}: {
  editor: RadarThresholdEditor;
  model: PlayerRadarAdminModel;
  onApply: () => Promise<RadarThresholdError | null>;
  applyButtonRef: Ref<HTMLButtonElement>;
  active?: boolean;
}) {
  const id = useId();
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const editStart = useRef(new Map<string, string>());
  const exitTriggerRef = useRef<HTMLButtonElement>(null);
  const [focusRequest, setFocusRequest] = useState<RadarThresholdError | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [blurred, setBlurred] = useState<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    if (!focusRequest) return;
    inputs.current.get(`${focusRequest.axisId}:${focusRequest.index}`)?.focus();
  }, [focusRequest]);
  if (!editor.active || !editor.drafts) return null;
  const pending = editor.preparingApply || model.communicationUnknown;
  const disabled = pending || editor.discarding || Boolean(editor.permissionReason);
  const selectedAxis =
    playerRadarAxes.find((axis) => axis.id === editor.axis) ?? playerRadarAxes[0];
  const unit = editor.axis === "averageRank" ? "位以下" : "万円以上";
  const preview = editor.preview;
  const currentValues = model.currentBasis?.axes.find(
    (axis) => axis.axisId === editor.axis,
  )?.thresholds;
  const originalValues = editor.referenceThresholds?.[editor.axis];
  const errors = editor.composing
    ? []
    : editor.errors.filter(
        (error) =>
          error.kind !== "numeric" ||
          editor.showErrors ||
          blurred.has(`${error.axisId}:${error.index}`),
      );
  const firstError = errors[0];
  const moveToError = (error: RadarThresholdError) => {
    editor.setAxis(error.axisId);
    setFocusRequest({ ...error });
  };
  const applyReason = editor.applyReason;
  const comparisonLabel =
    errors.length > 0
      ? "入力に不備があるため、比較を更新できません。各欄の案内を確認してください。表示中の比較は現在の入力を反映していません。"
      : editor.canApply
        ? "適用前の確認が完了した比較です。"
        : editor.awaitingValidation
          ? "適用前に点数の変化を確認しています。"
          : !editor.ready
            ? editor.composing || editor.errors.length > 0
              ? "入力を確認中です。表示中の比較は現在の入力を反映していません。"
              : "入力の反映待ちです。表示中の比較は前回の入力によるものです。"
            : "入力中の比較です。まだ適用されていません。";
  return (
    <section aria-label="採点境界の編集" className="grid min-w-0 grid-cols-1 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className={contentText.heading}>採点境界を調整</h3>
          <p className={contentText.supporting}>編集元: {editor.sourceLabel}</p>
        </div>
        <div className={actionRowClass}>
          <Button disabled={disabled} size="sm" variant="quiet" onClick={editor.reset}>
            編集開始時の値へ戻す
          </Button>
          {active ? (
            <AlertDialog
              title="編集内容を破棄しますか？"
              description="入力した採点境界を破棄し、編集前の画面に戻ります。適用中の基準は変わりません。"
              confirmLabel="編集内容を破棄する"
              confirmDisabled={pending}
              finalFocus={() =>
                exitTriggerRef.current?.isConnected
                  ? exitTriggerRef.current
                  : document.getElementById("radar-administration-heading")
              }
              trigger={
                <Button disabled={pending} ref={exitTriggerRef} size="sm" variant="secondary">
                  編集をやめる
                </Button>
              }
              onConfirm={editor.discard}
            />
          ) : null}
        </div>
      </div>
      {editor.contextChanged ? (
        <Notice
          tone="warning"
          title="適用中の基準または共有案が変わりました"
          action={
            <Button
              disabled={disabled || !editor.latestSourceAvailable}
              variant="secondary"
              onClick={editor.adoptCurrentSource}
            >
              入力を保持して最新の編集元に切り替える
            </Button>
          }
        >
          入力値は保持しています。編集元の参照値と置き換える共有案を確認してから適用してください。
        </Notice>
      ) : null}
      {editor.applyError && !model.communicationUnknown ? (
        <Notice tone="danger" title="適用前の確認を完了できません">
          {editor.applyError}
        </Notice>
      ) : null}
      {editor.comparisonChanged ? (
        <Notice tone="info" title="比較に使う記録が更新されました">
          比較に使う記録が変わりました。点数の変化を確認し、「変更を適用」で再確認してください。
        </Notice>
      ) : null}
      {editor.formalMismatch ? (
        <Notice tone="danger" title="入力中の比較と適用前の計算が一致しません">
          この案は適用できません。基準の状態を更新し、比較を再確認してください。
        </Notice>
      ) : null}
      {editor.showErrors && firstError ? (
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
                    <p className={cn(contentText.body, readableTextWidthClass)}>
                      {selectedAxis.description}
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
                        {showReference ? "編集元の値を隠す" : "編集元の値を参照"}
                      </Button>
                    </div>
                  </div>
                  <fieldset disabled={disabled} className="grid min-w-0 gap-4">
                    <legend className="sr-only">{selectedAxis.label}の9境界</legend>
                    {editor.drafts?.[axis.id].map((text, index) => {
                      const key = `${axis.id}:${index}`;
                      const inputId = `${id}-${axis.id}-${index}`;
                      const fieldErrors = errors.filter(
                        (item) => item.axisId === axis.id && item.index === index,
                      );
                      return (
                        <Field
                          key={key}
                          htmlFor={inputId}
                          label={`${index + 2}点の境界（${unit}）`}
                          error={
                            fieldErrors.length > 0
                              ? fieldErrors.map((error) => error.message).join(" ")
                              : undefined
                          }
                          errorId={`${inputId}-error`}
                          descriptionId={`${inputId}-reference`}
                          description={
                            <>
                              適用中:{" "}
                              {currentValues?.[index]
                                ? `${currentValues[index].rawValue}${unit}`
                                : "未適用"}
                              {showReference ? (
                                <span className="block">
                                  編集元: {originalValues?.[index]}
                                  {unit}
                                </span>
                              ) : null}
                            </>
                          }
                        >
                          <InputControl
                            id={inputId}
                            aria-label={`${selectedAxis.label} ${index + 2}点の境界（${unit}）`}
                            aria-describedby={`${inputId}-reference${fieldErrors.length > 0 ? ` ${inputId}-error` : ""}`}
                            ref={(element) => {
                              if (element) inputs.current.set(key, element);
                              else inputs.current.delete(key);
                            }}
                            type="text"
                            inputMode={axis.id === "averageRank" ? "decimal" : "text"}
                            textAlign="end"
                            value={text}
                            invalid={fieldErrors.length > 0}
                            onChange={(event) =>
                              editor.change(axis.id, index, event.currentTarget.value)
                            }
                            onFocus={() => editStart.current.set(key, text)}
                            onBlur={() => setBlurred((current) => new Set(current).add(key))}
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
                    {editor.replacesCandidate ? (
                      <p className={contentText.supporting}>
                        適用の確認に進むと、現在の変更案をこの入力で置き換えます。適用中の基準は変わりません。
                      </p>
                    ) : null}
                    <Button
                      ref={applyButtonRef}
                      disabled={disabled || Boolean(applyReason) || editor.composing}
                      pending={pending}
                      pendingLabel="適用前の確認中"
                      onClick={async () => {
                        const error = await onApply();
                        if (error) moveToError(error);
                      }}
                    >
                      変更を適用
                    </Button>
                    {applyReason ? <p className={contentText.supporting}>{applyReason}</p> : null}
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-4">
                  <p
                    className={cn(contentText.body, readableTextWidthClass)}
                    role="status"
                    aria-live="polite"
                  >
                    {comparisonLabel}
                  </p>
                  {editor.evaluationMessage ? (
                    <Notice tone="info" title={editor.evaluationMessage}>
                      {null}
                    </Notice>
                  ) : null}
                  {preview ? (
                    <PlayerRadarPreview
                      preview={preview}
                      axisId={editor.axis}
                      filter={model.previewFilter}
                      updating={editor.evaluationUpdating}
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
