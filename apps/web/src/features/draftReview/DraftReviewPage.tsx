import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  confirmMatch,
  createHeldEvent,
  getOcrDraftsBulk,
  listHeldEvents,
} from "@/features/draftReview/api";
import type { HeldEventResponse, OcrDraftResponse } from "@/features/draftReview/api";
import { mergeDrafts } from "@/features/draftReview/mergeDrafts";
import type { DraftByKind, ReviewPlayer } from "@/features/draftReview/mergeDrafts";
import { confirmMatchSchema, toConfirmMatchRequest } from "@/features/draftReview/schema";
import type { ConfirmMatchFormValues } from "@/features/draftReview/schema";
import { createSampleDraftMap } from "@/features/draftReview/sampleDrafts";
import {
  findGameTitle,
  fixedMembers,
  gameTitles,
  seasons,
} from "@/features/ocrCapture/localMasters";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import type { SlotKind } from "@/shared/api/enums";
import { slotKinds } from "@/shared/api/enums";
import { getAuthMe } from "@/shared/api/client";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { DevUserPicker } from "@/shared/auth/DevUserPicker";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { LiveRegion } from "@/shared/ui/LiveRegion";

const inputClass =
  "w-full rounded-2xl border border-line-soft bg-capture-black/45 px-3 py-2 text-sm text-ink-100 transition hover:border-white/18";
const memberSelectClass = `${inputClass} min-w-[11rem]`;
const numericInputClass = `${inputClass} min-w-[7rem] text-right tabular-nums`;
const shortNumericInputClass = `${inputClass} min-w-[5.5rem] text-center tabular-nums`;
const inputAttentionClass =
  "w-full rounded-2xl border border-rail-magenta/55 bg-rail-magenta/10 px-3 py-2 text-sm text-ink-100 transition hover:border-rail-magenta/70";
const inputMissingClass =
  "w-full rounded-2xl border border-rail-gold/55 bg-rail-gold/10 px-3 py-2 text-sm text-ink-100 transition hover:border-rail-gold/70";
const labelClass = "text-xs font-bold tracking-[0.22em] text-ink-300 uppercase";
const confidenceThresholdLow = 0.85;

const incidentColumns = [
  ["destination", "目的地"],
  ["plusStation", "プラス駅"],
  ["minusStation", "マイナス駅"],
  ["cardStation", "カード駅"],
  ["cardShop", "カード売り場"],
  ["suriNoGinji", "スリの銀次"],
] as const;

function memberName(memberId: string): string {
  return fixedMembers.find((member) => member.memberId === memberId)?.displayName ?? memberId;
}

function toIsoFromLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toFormPlayer(player: ReviewPlayer): ConfirmMatchFormValues["players"][number] {
  return {
    memberId: player.memberId,
    playOrder: player.playOrder,
    rank: player.rank,
    totalAssetsManYen: player.totalAssetsManYen,
    revenueManYen: player.revenueManYen,
    incidents: {
      destination: player.incidents["目的地"],
      plusStation: player.incidents["プラス駅"],
      minusStation: player.incidents["マイナス駅"],
      cardStation: player.incidents["カード駅"],
      cardShop: player.incidents["カード売り場"],
      suriNoGinji: player.incidents["スリの銀次"],
    },
  };
}

function emptyPlayers(): ConfirmMatchFormValues["players"] {
  return fixedMembers.map((member, index) => ({
    memberId: member.memberId,
    playOrder: index + 1,
    rank: index + 1,
    totalAssetsManYen: 0,
    revenueManYen: 0,
    incidents: {
      destination: 0,
      plusStation: 0,
      minusStation: 0,
      cardStation: 0,
      cardShop: 0,
      suriNoGinji: 0,
    },
  }));
}

function draftIdsFromParams(searchParams: URLSearchParams): Partial<Record<SlotKind, string>> {
  const ids: Partial<Record<SlotKind, string>> = {};
  const totalAssets = searchParams.get("totalAssets");
  const revenue = searchParams.get("revenue");
  const incidentLog = searchParams.get("incidentLog");
  if (totalAssets) ids.total_assets = totalAssets;
  if (revenue) ids.revenue = revenue;
  if (incidentLog) ids.incident_log = incidentLog;
  return ids;
}

function draftsByKind(
  ids: Partial<Record<SlotKind, string>>,
  drafts: OcrDraftResponse[] | undefined,
): DraftByKind {
  const byId = new Map((drafts ?? []).map((draft) => [draft.draftId, draft]));
  return Object.fromEntries(
    slotKinds
      .map((kind) => [kind, ids[kind] ? byId.get(ids[kind]) : undefined] as const)
      .filter(([, draft]) => draft),
  ) as DraftByKind;
}

type FieldState = {
  tone: "ocr" | "lowConfidence" | "manual";
  label: string;
};

function fieldState(
  currentValue: number,
  originalValue: number | undefined,
  confidence: number | null | undefined,
): FieldState {
  if (originalValue !== undefined && currentValue !== originalValue) {
    return { tone: "manual", label: "手修正" };
  }
  if (confidence == null) {
    return { tone: "manual", label: "手入力" };
  }
  if (confidence < confidenceThresholdLow) {
    return { tone: "lowConfidence", label: `OCR要確認 ${(confidence * 100).toFixed(0)}%` };
  }
  return { tone: "ocr", label: `OCR ${(confidence * 100).toFixed(0)}%` };
}

function stateInputClass(state: FieldState): string {
  if (state.tone === "manual") {
    return inputMissingClass;
  }
  if (state.tone === "lowConfidence") {
    return inputAttentionClass;
  }
  return inputClass;
}

function numericStateInputClass(
  state: FieldState,
  size: "short" | "standard" = "standard",
): string {
  const widthClass = size === "short" ? "min-w-[5.5rem] text-center" : "min-w-[7rem] text-right";
  return `${stateInputClass(state)} ${widthClass} tabular-nums`;
}

type NumericCellProps = {
  "aria-label": string;
  className: string;
  max?: number | undefined;
  min: number;
  onValueChange: (value: number) => void;
  title: string;
  value: number;
};

function NumericCell({
  "aria-label": ariaLabel,
  className,
  max,
  min,
  onValueChange,
  title,
  value,
}: NumericCellProps) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      inputMode="numeric"
      max={max}
      min={min}
      pattern="[0-9]*"
      title={title}
      type="text"
      value={draftValue}
      onBlur={() => {
        if (draftValue === "") {
          setDraftValue(String(min));
          onValueChange(min);
        }
      }}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "");
        if (digits === "") {
          setDraftValue("");
          return;
        }
        const normalized = digits.replace(/^0+(?=\d)/, "");
        const numericValue = Number(normalized);
        setDraftValue(normalized);
        onValueChange(numericValue);
      }}
    />
  );
}

type ConfirmDialogProps = {
  values: ConfirmMatchFormValues;
  heldEvent?: HeldEventResponse | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
};

function ConfirmDialog({ values, heldEvent, onCancel, onConfirm, pending }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-capture-black/70 p-4">
      <div className="w-full max-w-xl rounded-[2rem] border border-line-soft bg-night-900 p-6">
        <p className="text-xs font-black tracking-[0.32em] text-rail-gold uppercase">Final Check</p>
        <h2 className="mt-2 text-2xl font-black">この内容で確定しますか？</h2>
        <dl className="mt-5 grid gap-3 text-sm text-ink-200">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">開催履歴</dt>
            <dd className="font-bold text-ink-100">
              {heldEvent ? new Date(heldEvent.heldAt).toLocaleString() : values.heldEventId}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">試合番号</dt>
            <dd>第{values.matchNoInEvent}試合</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">作品 / マップ</dt>
            <dd>
              {values.gameTitleId} / {values.mapMasterId}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">順位</dt>
            <dd>
              {values.players
                .map((player) => `${player.rank}位 ${memberName(player.memberId)}`)
                .join(" / ")}
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            戻って修正
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            確定する
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DraftReviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(() => draftIdsFromParams(searchParams), [searchParams]);
  const useSampleDrafts = import.meta.env.DEV && searchParams.get("sample") === "1";
  const idList = useMemo(() => slotKinds.flatMap((kind) => (ids[kind] ? [ids[kind]] : [])), [ids]);
  const [notice, setNotice] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState({
    heldAt: toLocalDateTime(new Date().toISOString()),
  });
  const [values, setValues] = useState<ConfirmMatchFormValues>(() => {
    const gameTitle = findGameTitle(defaultSetupValues.gameTitleId);
    return {
      heldEventId: "",
      matchNoInEvent: 1,
      gameTitleId: gameTitle.id,
      seasonMasterId: defaultSetupValues.seasonId,
      ownerMemberId: defaultSetupValues.ownerMemberId,
      mapMasterId: defaultSetupValues.mapName,
      playedAt: new Date().toISOString(),
      draftIds: Object.fromEntries(
        [
          ["totalAssets", ids.total_assets],
          ["revenue", ids.revenue],
          ["incidentLog", ids.incident_log],
        ].filter(([, id]) => id),
      ),
      players: emptyPlayers(),
    };
  });

  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false,
  });
  const heldEventsQuery = useQuery({
    queryKey: ["held-events"],
    queryFn: () => listHeldEvents("", 10),
  });
  const draftsQuery = useQuery({
    queryKey: ["ocr-drafts-bulk", idList.join(",")],
    queryFn: () => getOcrDraftsBulk(idList),
    enabled: !useSampleDrafts && idList.length > 0,
    retry: false,
  });
  const createEventMutation = useMutation({
    mutationFn: createHeldEvent,
    onSuccess(event) {
      setValues((current) => ({
        ...current,
        heldEventId: event.id,
        matchNoInEvent: event.matchCount + 1,
        playedAt: event.heldAt,
      }));
      setNotice(`開催履歴（${new Date(event.heldAt).toLocaleString()}）を作成して選択しました。`);
    },
  });
  const confirmMutation = useMutation({
    mutationFn: confirmMatch,
    onSuccess(response) {
      setNotice(`第${response.matchNoInEvent}試合を確定しました。`);
      setConfirmOpen(false);
      navigate("/ocr/new");
    },
  });

  const draftMap = useMemo(
    () => (useSampleDrafts ? createSampleDraftMap() : draftsByKind(ids, draftsQuery.data?.items)),
    [draftsQuery.data?.items, ids, useSampleDrafts],
  );
  const merged = useMemo(() => mergeDrafts(draftMap), [draftMap]);
  const originalByMember = useMemo(
    () => new Map(merged.players.map((player) => [player.memberId, player])),
    [merged.players],
  );
  const selectedGame =
    gameTitles.find((gameTitle) => gameTitle.id === values.gameTitleId) ??
    findGameTitle(defaultSetupValues.gameTitleId);
  const heldEvents = heldEventsQuery.data?.items ?? [];
  const selectedHeldEvent = heldEvents.find((event) => event.id === values.heldEventId);
  const authError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;
  const draftError = draftsQuery.error ? normalizeUnknownApiError(draftsQuery.error) : undefined;
  const confirmError = confirmMutation.error
    ? normalizeUnknownApiError(confirmMutation.error)
    : undefined;

  useEffect(() => {
    if (draftsQuery.isSuccess || useSampleDrafts) {
      setValues((current) => ({ ...current, players: merged.players.map(toFormPlayer) }));
    }
  }, [draftsQuery.isSuccess, merged.players, useSampleDrafts]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const readiness = confirmMatchSchema.safeParse(values);
  const readinessIssues = readiness.success
    ? []
    : readiness.error.issues.map((issue) => issue.message);
  const nextAction = readiness.success
    ? "確定前チェックへ進めます"
    : (readinessIssues[0] ?? "入力内容を確認してください");
  const attentionCount = values.players.reduce((count, player) => {
    const original = originalByMember.get(player.memberId);
    const playOrderConfidence = draftMap.total_assets ? 1 : null;
    const states = [
      fieldState(player.playOrder, original?.playOrder, playOrderConfidence),
      fieldState(player.rank, original?.rank, original?.confidence.rank),
      fieldState(
        player.totalAssetsManYen,
        original?.totalAssetsManYen,
        original?.confidence.totalAssets,
      ),
      fieldState(player.revenueManYen, original?.revenueManYen, original?.confidence.revenue),
      ...incidentColumns.map(([key, label]) =>
        fieldState(
          player.incidents[key],
          original?.incidents[label],
          original?.confidence.incidents[label],
        ),
      ),
    ];
    return (
      count +
      states.filter((state) => state.tone !== "ocr").length +
      (original?.warnings.length ?? 0)
    );
  }, merged.warnings.length);

  function patchValue(patch: Partial<ConfirmMatchFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  function patchPlayer(index: number, patch: Partial<ConfirmMatchFormValues["players"][number]>) {
    setValues((current) => ({
      ...current,
      players: current.players.map((player, playerIndex) =>
        playerIndex === index ? { ...player, ...patch } : player,
      ),
    }));
  }

  function patchIncident(
    playerIndex: number,
    incidentKey: keyof ConfirmMatchFormValues["players"][number]["incidents"],
    value: number,
  ) {
    setValues((current) => ({
      ...current,
      players: current.players.map((player, index) =>
        index === playerIndex
          ? { ...player, incidents: { ...player.incidents, [incidentKey]: value } }
          : player,
      ),
    }));
  }

  function handleGameTitleChange(gameTitleId: string) {
    const gameTitle =
      gameTitles.find((candidate) => candidate.id === gameTitleId) ??
      findGameTitle(defaultSetupValues.gameTitleId);
    patchValue({
      gameTitleId: gameTitle.id,
      mapMasterId: gameTitle.maps[0] ?? "",
    });
  }

  function handlePreConfirm() {
    const parsed = confirmMatchSchema.safeParse(values);
    if (!parsed.success) {
      setValidationMessage(parsed.error.issues[0]?.message ?? "入力内容を確認してください。");
      return;
    }
    setValidationMessage("");
    setConfirmOpen(true);
  }

  function handleConfirm() {
    const parsed = confirmMatchSchema.parse(values);
    confirmMutation.mutate(toConfirmMatchRequest(parsed));
  }

  const matchSetupSection = (
    <Card className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={labelClass}>Match Setup</p>
          <h2 className="mt-1 text-2xl font-black">記録先と試合条件</h2>
          <p className="mt-2 text-sm text-ink-400">
            この結果をどの開催履歴・作品として保存するかだけ先に決めます。結果の確認と手修正は次の表で行います。
          </p>
        </div>
        {selectedHeldEvent ? (
          <div className="rounded-[1.25rem] border border-line-soft bg-capture-black/28 px-4 py-3 text-sm text-ink-300">
            <p className="font-bold text-ink-100">
              {new Date(selectedHeldEvent.heldAt).toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-ink-400">第{values.matchNoInEvent}試合として保存</p>
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-12">
        <label className="grid gap-2 lg:col-span-5">
          <span className={labelClass}>開催履歴</span>
          <select
            className={inputClass}
            value={values.heldEventId}
            onChange={(event) => {
              const heldEvent = heldEvents.find((candidate) => candidate.id === event.target.value);
              patchValue({
                heldEventId: event.target.value,
                matchNoInEvent: (heldEvent?.matchCount ?? 0) + 1,
                playedAt: heldEvent?.heldAt ?? values.playedAt,
              });
            }}
          >
            <option value="">選択してください</option>
            {heldEvents.map((event) => (
              <option key={event.id} value={event.id}>
                {new Date(event.heldAt).toLocaleString()}（{event.matchCount}試合）
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 lg:col-span-2">
          <span className={labelClass}>試合番号</span>
          <NumericCell
            aria-label="試合番号"
            className={inputClass}
            min={1}
            title="同じ開催履歴内の試合番号"
            value={values.matchNoInEvent}
            onValueChange={(matchNoInEvent) => patchValue({ matchNoInEvent })}
          />
        </label>

        <label className="grid gap-2 lg:col-span-5">
          <span className={labelClass}>開催日時</span>
          <input
            className={inputClass}
            type="datetime-local"
            value={toLocalDateTime(values.playedAt)}
            onChange={(event) => patchValue({ playedAt: toIsoFromLocal(event.target.value) })}
          />
        </label>

        <label className="grid gap-2 lg:col-span-3">
          <span className={labelClass}>作品</span>
          <select
            className={inputClass}
            value={values.gameTitleId}
            onChange={(event) => handleGameTitleChange(event.target.value)}
          >
            {gameTitles.map((gameTitle) => (
              <option key={gameTitle.id} value={gameTitle.id}>
                {gameTitle.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 lg:col-span-3">
          <span className={labelClass}>シーズン</span>
          <select
            className={inputClass}
            value={values.seasonMasterId}
            onChange={(event) => patchValue({ seasonMasterId: event.target.value })}
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 lg:col-span-3">
          <span className={labelClass}>マップ</span>
          <select
            className={inputClass}
            value={values.mapMasterId}
            onChange={(event) => patchValue({ mapMasterId: event.target.value })}
          >
            {selectedGame.maps.map((mapName) => (
              <option key={mapName} value={mapName}>
                {mapName}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 lg:col-span-3">
          <span className={labelClass}>オーナー</span>
          <select
            className={inputClass}
            value={values.ownerMemberId}
            onChange={(event) => patchValue({ ownerMemberId: event.target.value })}
          >
            {fixedMembers.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="mt-4 border-t border-line-soft/70 pt-3">
        <summary className="cursor-pointer text-xs font-bold tracking-[0.18em] text-ink-400 uppercase transition hover:text-ink-200">
          一覧にない開催履歴を追加
        </summary>
        <div className="mt-3 grid gap-3 rounded-[1.25rem] border border-line-soft bg-capture-black/24 p-3 md:grid-cols-[1fr_auto] md:items-end">
          <p className="text-xs leading-5 text-ink-400 md:col-span-2">
            通常はsummit側で作成済みの開催履歴を選びます。見つからない場合だけ追加してください。
          </p>
          <input
            className={inputClass}
            type="datetime-local"
            value={eventDraft.heldAt}
            onChange={(event) =>
              setEventDraft((current) => ({ ...current, heldAt: event.target.value }))
            }
          />
          <Button
            variant="secondary"
            disabled={!eventDraft.heldAt || createEventMutation.isPending}
            onClick={() =>
              createEventMutation.mutate({
                heldAt: toIsoFromLocal(eventDraft.heldAt),
              })
            }
          >
            作成して選択
          </Button>
        </div>
      </details>
    </Card>
  );

  const playerResultsSection = (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={labelClass}>Player Results</p>
          <h2 className="mt-1 text-2xl font-black">4人分の結果を確認・手修正</h2>
          <p className="mt-2 text-sm text-ink-400">
            順位・金額・事件簿をここで確認します。画面幅が足りない場合は、この表だけ横にスクロールできます。
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-line-soft bg-capture-black/28 px-4 py-3 text-sm text-ink-300">
          <p className="font-bold text-ink-100">確認セル {attentionCount}</p>
          <p className="mt-1 text-xs leading-5 text-ink-400">
            桃色=OCR要確認 / 金色=手入力・手修正
          </p>
        </div>
      </div>
      <details className="mt-5 rounded-[1.5rem] border border-line-soft bg-capture-black/28 p-4">
        <summary className="cursor-pointer text-sm font-bold text-ink-100">
          OCR読み取り状況を確認
        </summary>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {slotKinds.map((kind) => {
            const labels: Record<SlotKind, string> = {
              total_assets: "総資産・順位・順番",
              revenue: "収益",
              incident_log: "事件簿",
            };
            const draft = draftMap[kind];
            return (
              <div
                key={kind}
                className="rounded-[1.25rem] border border-line-soft bg-night-900/72 p-4"
              >
                <p className="text-sm font-black text-ink-100">{labels[kind]}</p>
                <p className="mt-2 text-xs leading-5 text-ink-400">
                  {draft ? "OCR下書きから表へ反映済み" : "OCR下書きなし。金色セルを手入力します。"}
                </p>
                {draft?.detectedImageType ? (
                  <span className="mt-3 inline-flex rounded-full border border-line-soft px-3 py-1 text-xs text-ink-300">
                    判定: {draft.detectedImageType}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {merged.warnings.length ? (
          <div className="mt-4 rounded-[1.5rem] border border-rail-magenta/30 bg-rail-magenta/10 p-4 text-sm text-pink-50">
            {merged.warnings.join(" / ")}
          </div>
        ) : null}
      </details>
      <div className="-mx-5 mt-5 overflow-x-auto px-5 pb-2">
        <table className="min-w-[1320px] table-fixed border-separate border-spacing-y-2 text-left text-sm">
          <colgroup>
            <col className="w-[12rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-[9rem]" />
            <col className="w-[9rem]" />
            {incidentColumns.map(([, label]) => (
              <col key={label} className="w-[8rem]" />
            ))}
          </colgroup>
          <thead className="text-xs tracking-[0.18em] text-ink-400 uppercase">
            <tr>
              <th className="px-2 py-2">メンバー</th>
              <th className="px-2 py-2">順</th>
              <th className="px-2 py-2">順位</th>
              <th className="px-2 py-2">総資産</th>
              <th className="px-2 py-2">収益</th>
              {incidentColumns.map(([, label]) => (
                <th key={label} className="px-2 py-2">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.players.map((player, playerIndex) => (
              <tr key={playerIndex} className="bg-capture-black/24">
                <td className="rounded-l-2xl px-2 py-3">
                  <select
                    className={memberSelectClass}
                    value={player.memberId}
                    onChange={(event) => patchPlayer(playerIndex, { memberId: event.target.value })}
                  >
                    {fixedMembers.map((member) => (
                      <option key={member.memberId} value={member.memberId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                {(["playOrder", "rank", "totalAssetsManYen", "revenueManYen"] as const).map(
                  (key) => {
                    const original = originalByMember.get(player.memberId);
                    const playOrderConfidence = draftMap.total_assets ? 1 : null;
                    const confidence =
                      key === "playOrder"
                        ? playOrderConfidence
                        : key === "rank"
                          ? original?.confidence.rank
                          : key === "totalAssetsManYen"
                            ? original?.confidence.totalAssets
                            : key === "revenueManYen"
                              ? original?.confidence.revenue
                              : 1;
                    const isShortNumber = key === "playOrder" || key === "rank";
                    const originalValue = original?.[key];
                    const state = fieldState(player[key], originalValue, confidence);
                    return (
                      <td key={key} className="px-2 py-3">
                        <NumericCell
                          aria-label={`${memberName(player.memberId)} ${key}`}
                          className={
                            state.tone === "ocr"
                              ? isShortNumber
                                ? shortNumericInputClass
                                : numericInputClass
                              : numericStateInputClass(state, isShortNumber ? "short" : "standard")
                          }
                          min={isShortNumber ? 1 : 0}
                          max={isShortNumber ? 4 : undefined}
                          title={state.label}
                          value={player[key]}
                          onValueChange={(value) => patchPlayer(playerIndex, { [key]: value })}
                        />
                        {key !== "playOrder" ? (
                          <p
                            className={`mt-1 text-[0.68rem] ${
                              state.tone === "manual"
                                ? "text-rail-gold"
                                : state.tone === "lowConfidence"
                                  ? "text-pink-100"
                                  : "text-ink-400"
                            }`}
                          >
                            {state.label}
                          </p>
                        ) : null}
                      </td>
                    );
                  },
                )}
                {incidentColumns.map(([key, label]) => (
                  <td key={key} className="px-2 py-3 last:rounded-r-2xl">
                    {(() => {
                      const original = originalByMember.get(player.memberId);
                      const state = fieldState(
                        player.incidents[key],
                        original?.incidents[label],
                        original?.confidence.incidents[label],
                      );
                      return (
                        <NumericCell
                          aria-label={`${memberName(player.memberId)} ${key}`}
                          className={numericStateInputClass(state)}
                          min={0}
                          title={state.label}
                          value={player.incidents[key]}
                          onValueChange={(value) => patchIncident(playerIndex, key, value)}
                        />
                      );
                    })()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
      <LiveRegion message={notice || validationMessage} />
      <header className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <p className="font-display text-sm tracking-[0.55em] text-rail-gold uppercase">
            Draft Review Desk
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-black tracking-tight text-ink-100 sm:text-6xl">
            OCR下書き確認
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-ink-300">
            3つの下書きを1試合分にまとめ、開催履歴・順位・金額・事件簿を同じ画面で確認して確定します。
          </p>
          {useSampleDrafts ? (
            <p className="mt-3 inline-flex rounded-full border border-rail-gold/35 bg-rail-gold/10 px-3 py-1 text-sm font-bold text-rail-gold">
              開発用サンプル下書きで表示中
            </p>
          ) : null}
        </div>
        <DevUserPicker force={authError?.status === 401} />
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          className="text-sm font-bold text-rail-gold underline-offset-4 hover:underline"
          to="/ocr/new"
        >
          ← 取り込みコンソールへ戻る
        </Link>
        {authQuery.data ? (
          <span className="rounded-full border border-line-soft bg-night-900/72 px-3 py-2 text-sm text-ink-300">
            ログイン中: {authQuery.data.displayName}
          </span>
        ) : null}
      </div>

      {[authError, draftError, confirmError].filter(Boolean).map((error) => (
        <div
          key={`${error?.status}-${error?.detail}`}
          className="mt-6 rounded-3xl border border-red-300/30 bg-red-950/40 p-4 text-red-50"
          role="alert"
        >
          <strong>{error?.title}</strong>
          <p className="mt-1">{error?.detail}</p>
        </div>
      ))}

      {notice ? (
        <div
          className="fixed top-4 right-4 left-4 z-40 rounded-[1.25rem] border border-rail-gold/30 bg-night-900/95 p-4 text-sm text-yellow-50 shadow-[0_18px_60px_rgb(0_0_0/0.28)] backdrop-blur sm:left-auto sm:w-[24rem]"
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="leading-6">{notice}</p>
            <button
              className="rounded-full border border-line-soft px-2 py-0.5 text-xs text-ink-300 transition hover:text-ink-100"
              type="button"
              onClick={() => setNotice("")}
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}

      {matchSetupSection}

      {playerResultsSection}

      {validationMessage ? (
        <div
          className="mt-6 rounded-3xl border border-rail-gold/25 bg-rail-gold/10 p-4 text-sm text-yellow-50"
          role="status"
        >
          {validationMessage}
        </div>
      ) : null}

      <div className="sticky bottom-4 mt-8 rounded-[2rem] border border-line-soft bg-night-900/92 p-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-300">
            {readiness.success ? "確定前チェックへ進めます。" : nextAction}
          </p>
          <Button
            onClick={handlePreConfirm}
            disabled={confirmMutation.isPending || !readiness.success}
          >
            確定前チェックへ進む
          </Button>
        </div>
      </div>

      {confirmOpen ? (
        <ConfirmDialog
          values={values}
          heldEvent={selectedHeldEvent}
          pending={confirmMutation.isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </main>
  );
}
