import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  confirmMatch,
  createHeldEvent,
  getOcrDraftsBulk,
  listHeldEvents,
} from "@/features/draftReview/api";
import type { HeldEventResponse, OcrDraftResponse } from "@/features/draftReview/api";
import { mergeDrafts } from "@/features/draftReview/mergeDrafts";
import type { DraftByKind, ReviewPlayer } from "@/features/draftReview/mergeDrafts";
import { createSampleDraftMap } from "@/features/draftReview/sampleDrafts";
import { confirmMatchSchema, toConfirmMatchRequest } from "@/features/draftReview/schema";
import type { ConfirmMatchFormValues } from "@/features/draftReview/schema";
import {
  buildMasterRoute,
  clearHandoffIdFromSearch,
  createDraftReviewHandoffPayload,
  loadMasterHandoff,
  removeMasterHandoff,
  sanitizeReturnTo,
  saveMasterHandoff,
} from "@/features/masters/masterReturnHandoff";
import type { DraftReviewHandoffValues } from "@/features/masters/masterReturnHandoff";
import { fixedMembers } from "@/features/ocrCapture/localMasters";
import { defaultSetupValues } from "@/features/ocrCapture/schema";
import { getAuthMe } from "@/shared/api/client";
import type { SlotKind } from "@/shared/api/enums";
import { slotKinds } from "@/shared/api/enums";
import { listGameTitles, listMapMasters, listSeasonMasters } from "@/shared/api/masters";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { AuthPanel } from "@/shared/auth/AuthPanel";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { LiveRegion } from "@/shared/ui/LiveRegion";

const inputClass =
  "w-full rounded-2xl border border-line-soft bg-capture-black/45 px-3 py-2 text-sm text-ink-100 transition hover:border-white/18";
const memberSelectClass = `${inputClass} min-w-[11rem]`;
const numericInputClass = `${inputClass} min-w-[7rem] text-right tabular-nums`;
const shortNumericInputClass = `${inputClass} min-w-[5.5rem] text-center tabular-nums`;
const inputHighConfidenceClass =
  "w-full rounded-2xl border border-emerald-400/55 bg-emerald-400/10 px-3 py-2 text-sm text-ink-100 transition hover:border-emerald-400/70";
const inputMissingClass =
  "w-full rounded-2xl border border-rail-gold/55 bg-rail-gold/10 px-3 py-2 text-sm text-ink-100 transition hover:border-rail-gold/70";
const labelClass = "text-xs font-bold tracking-[0.22em] text-ink-300 uppercase";
const confidenceThresholdHigh = 0.9;

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

function toDraftReviewHandoffValues(values: ConfirmMatchFormValues): DraftReviewHandoffValues {
  return {
    draftIds: {
      incidentLog: values.draftIds.incidentLog,
      revenue: values.draftIds.revenue,
      totalAssets: values.draftIds.totalAssets,
    },
    gameTitleId: values.gameTitleId,
    heldEventId: values.heldEventId,
    mapMasterId: values.mapMasterId,
    matchNoInEvent: values.matchNoInEvent,
    ownerMemberId: values.ownerMemberId,
    playedAt: values.playedAt,
    players: values.players.map((player) => ({
      incidents: {
        cardShop: player.incidents.cardShop,
        cardStation: player.incidents.cardStation,
        destination: player.incidents.destination,
        minusStation: player.incidents.minusStation,
        plusStation: player.incidents.plusStation,
        suriNoGinji: player.incidents.suriNoGinji,
      },
      memberId: player.memberId,
      playOrder: player.playOrder,
      rank: player.rank,
      revenueManYen: player.revenueManYen,
      totalAssetsManYen: player.totalAssetsManYen,
    })),
    seasonMasterId: values.seasonMasterId,
  };
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
  tone: "ocr" | "highConfidence" | "manual";
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
  if (confidence != null && confidence >= confidenceThresholdHigh) {
    return { tone: "highConfidence", label: "OCR" };
  }
  return { tone: "ocr", label: "OCR" };
}

function stateInputClass(state: FieldState): string {
  if (state.tone === "manual") {
    return inputMissingClass;
  }
  if (state.tone === "highConfidence") {
    return inputHighConfidenceClass;
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
    <div className="bg-capture-black/70 fixed inset-0 z-50 grid place-items-center p-4">
      <div className="border-line-soft bg-night-900 w-full max-w-xl rounded-[2rem] border p-6">
        <p className="text-rail-gold text-xs font-black tracking-[0.32em] uppercase">Final Check</p>
        <h2 className="mt-2 text-2xl font-black">この内容で確定しますか？</h2>
        <dl className="text-ink-200 mt-5 grid gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">開催履歴</dt>
            <dd className="text-ink-100 font-bold">
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
  const { matchSessionId = "" } = useParams<{ matchSessionId: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ids = useMemo(() => draftIdsFromParams(searchParams), [searchParams]);
  const useSampleDrafts = import.meta.env.DEV && searchParams.get("sample") === "1";
  const idList = useMemo(() => slotKinds.flatMap((kind) => (ids[kind] ? [ids[kind]] : [])), [ids]);
  const [notice, setNotice] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [hasRestoredHandoff, setHasRestoredHandoff] = useState(false);
  const [eventDraft, setEventDraft] = useState({
    heldAt: toLocalDateTime(new Date().toISOString()),
  });
  const [values, setValues] = useState<ConfirmMatchFormValues>(() => {
    return {
      heldEventId: "",
      matchNoInEvent: 1,
      gameTitleId: "",
      seasonMasterId: "",
      ownerMemberId: defaultSetupValues.ownerMemberId,
      mapMasterId: "",
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
  const returnSearchParams = useMemo(() => clearHandoffIdFromSearch(searchParams), [searchParams]);
  const returnSearch = returnSearchParams.toString();
  const reviewReturnTo = sanitizeReturnTo(
    `${location.pathname}${returnSearch ? `?${returnSearch}` : ""}`,
  );

  const authQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: getAuthMe,
    retry: false,
  });
  const authReady = authQuery.isSuccess;
  const authMemberId = authQuery.data?.memberId ?? "anonymous";
  const heldEventsQuery = useQuery({
    queryKey: ["held-events", authMemberId],
    queryFn: () => listHeldEvents("", 10),
    enabled: authReady,
  });
  const gameTitlesQuery = useQuery({
    queryKey: ["masters", "game-titles", authMemberId],
    queryFn: listGameTitles,
    enabled: authReady,
  });
  const mapMastersQuery = useQuery({
    queryKey: ["masters", "map-masters", authMemberId, values.gameTitleId],
    queryFn: () => listMapMasters(values.gameTitleId || undefined),
    enabled: authReady && Boolean(values.gameTitleId),
  });
  const seasonMastersQuery = useQuery({
    queryKey: ["masters", "season-masters", authMemberId, values.gameTitleId],
    queryFn: () => listSeasonMasters(values.gameTitleId || undefined),
    enabled: authReady && Boolean(values.gameTitleId),
  });
  const draftsQuery = useQuery({
    queryKey: ["ocr-drafts-bulk", authMemberId, idList.join(",")],
    queryFn: () => getOcrDraftsBulk(idList),
    enabled: authReady && !useSampleDrafts && idList.length > 0,
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
  // OCR 由来の値は「行 (プレイヤー位置)」に紐付くので、メンバードロップダウン変更後でも
  // 行ごとの原本を保持できるよう、memberId ではなくインデックスで参照する。
  const originalByIndex = merged.players;
  const gameTitleItems = gameTitlesQuery.data?.items ?? [];
  const mapMasterItems = mapMastersQuery.data?.items ?? [];
  const seasonMasterItems = seasonMastersQuery.data?.items ?? [];
  const heldEvents = heldEventsQuery.data?.items ?? [];
  const selectedHeldEvent = heldEvents.find((event) => event.id === values.heldEventId);
  const authError = authQuery.error ? normalizeUnknownApiError(authQuery.error) : undefined;
  const draftError = draftsQuery.error ? normalizeUnknownApiError(draftsQuery.error) : undefined;
  const confirmError = confirmMutation.error
    ? normalizeUnknownApiError(confirmMutation.error)
    : undefined;

  useEffect(() => {
    const first = gameTitleItems[0];
    if (!values.gameTitleId && first) {
      setValues((current) => ({ ...current, gameTitleId: first.id }));
    }
  }, [gameTitleItems, values.gameTitleId]);

  useEffect(() => {
    const first = mapMasterItems[0];
    if (
      values.gameTitleId &&
      !values.mapMasterId &&
      first &&
      first.gameTitleId === values.gameTitleId
    ) {
      setValues((current) => ({ ...current, mapMasterId: first.id }));
    }
  }, [mapMasterItems, values.gameTitleId, values.mapMasterId]);

  useEffect(() => {
    const first = seasonMasterItems[0];
    if (
      values.gameTitleId &&
      !values.seasonMasterId &&
      first &&
      first.gameTitleId === values.gameTitleId
    ) {
      setValues((current) => ({ ...current, seasonMasterId: first.id }));
    }
  }, [seasonMasterItems, values.gameTitleId, values.seasonMasterId]);

  useEffect(() => {
    if ((draftsQuery.isSuccess || useSampleDrafts) && !hasRestoredHandoff) {
      setValues((current) => ({ ...current, players: merged.players.map(toFormPlayer) }));
    }
  }, [draftsQuery.isSuccess, hasRestoredHandoff, merged.players, useSampleDrafts]);

  useEffect(() => {
    const handoffId = searchParams.get("handoffId");
    if (!handoffId || !reviewReturnTo) {
      return;
    }
    const payload = loadMasterHandoff({
      expectedReturnTo: reviewReturnTo,
      handoffId,
    });
    if (payload?.source === "draftReview" && payload.matchSessionId === matchSessionId) {
      setValues((current) => ({
        ...current,
        ...payload.values,
      }));
      setHasRestoredHandoff(true);
      setNotice("マスタ管理から戻ったため、入力内容を復元しました。");
    } else {
      setNotice("マスタ管理から戻りましたが、入力内容を復元できませんでした。");
    }
    removeMasterHandoff(handoffId);
    navigate(
      {
        pathname: location.pathname,
        search: returnSearch ? `?${returnSearch}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, matchSessionId, navigate, reviewReturnTo, returnSearch, searchParams]);

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

  function handlePlayOrderChange(playerIndex: number, nextPlayOrder: number) {
    // play_order を変えたら事件簿の値も追従させる。
    // 事件簿画面は列位置 (= play_order) で並ぶため、メンバーや順位ではなく play_order で
    // 紐付けるのが唯一の正解。手修正済みの値があっても OCR の該当列に再同期させる。
    const lookup = merged.incidentByPlayOrder.get(nextPlayOrder);
    setValues((current) => ({
      ...current,
      players: current.players.map((player, index) => {
        if (index !== playerIndex) {
          return player;
        }
        const nextIncidents = lookup
          ? {
              destination: lookup.counts["目的地"],
              plusStation: lookup.counts["プラス駅"],
              minusStation: lookup.counts["マイナス駅"],
              cardStation: lookup.counts["カード駅"],
              cardShop: lookup.counts["カード売り場"],
              suriNoGinji: lookup.counts["スリの銀次"],
            }
          : {
              destination: 0,
              plusStation: 0,
              minusStation: 0,
              cardStation: 0,
              cardShop: 0,
              suriNoGinji: 0,
            };
        return { ...player, playOrder: nextPlayOrder, incidents: nextIncidents };
      }),
    }));
  }

  function handleGameTitleChange(gameTitleId: string) {
    patchValue({
      gameTitleId,
      mapMasterId: "",
      seasonMasterId: "",
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

  function handleOpenMastersFromMissingTitle() {
    if (!reviewReturnTo) {
      navigate("/admin/masters");
      return;
    }
    const payload = createDraftReviewHandoffPayload({
      matchSessionId,
      returnTo: reviewReturnTo,
      values: toDraftReviewHandoffValues(values),
    });
    const handoffId = saveMasterHandoff(payload);
    navigate(buildMasterRoute(reviewReturnTo, handoffId));
  }

  const matchSetupSection = (
    <Card className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className={labelClass}>Match Setup</p>
          <h2 className="mt-1 text-2xl font-black">記録先と試合条件</h2>
          <p className="text-ink-400 mt-2 text-sm">
            この結果をどの開催履歴・作品として保存するかだけ先に決めます。結果の確認と手修正は次の表で行います。
          </p>
        </div>
        {selectedHeldEvent ? (
          <div className="border-line-soft bg-capture-black/28 text-ink-300 rounded-[1.25rem] border px-4 py-3 text-sm">
            <p className="text-ink-100 font-bold">
              {new Date(selectedHeldEvent.heldAt).toLocaleString()}
            </p>
            <p className="text-ink-400 mt-1 text-xs">第{values.matchNoInEvent}試合として保存</p>
          </div>
        ) : null}
      </div>
      {gameTitleItems.length === 0 && gameTitlesQuery.isSuccess ? (
        <div className="border-rail-gold/55 bg-rail-gold/10 text-ink-100 mt-4 rounded-[1.25rem] border p-4 text-sm">
          作品マスタが未登録です。
          <button
            className="hover:text-rail-gold ml-2 cursor-pointer underline"
            type="button"
            onClick={handleOpenMastersFromMissingTitle}
          >
            マスタ管理画面
          </button>
          で追加してください。
        </div>
      ) : null}

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
            <option value="">選択してください</option>
            {gameTitleItems.map((gameTitle) => (
              <option key={gameTitle.id} value={gameTitle.id}>
                {gameTitle.name}
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
            disabled={!values.gameTitleId}
          >
            <option value="">選択してください</option>
            {seasonMasterItems.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
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
            disabled={!values.gameTitleId}
          >
            <option value="">選択してください</option>
            {mapMasterItems.map((mapMaster) => (
              <option key={mapMaster.id} value={mapMaster.id}>
                {mapMaster.name}
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

      <details className="border-line-soft/70 mt-4 border-t pt-3">
        <summary className="text-ink-400 hover:text-ink-200 cursor-pointer text-xs font-bold tracking-[0.18em] uppercase transition">
          一覧にない開催履歴を追加
        </summary>
        <div className="border-line-soft bg-capture-black/24 mt-3 grid gap-3 rounded-[1.25rem] border p-3 md:grid-cols-[1fr_auto] md:items-end">
          <p className="text-ink-400 text-xs leading-5 md:col-span-2">
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
          <p className="text-ink-400 mt-2 text-sm">
            順位・金額・事件簿をここで確認します。画面幅が足りない場合は、この表だけ横にスクロールできます。
          </p>
        </div>
        <div className="border-line-soft bg-capture-black/28 text-ink-300 rounded-[1.25rem] border px-4 py-3 text-sm">
          <p className="text-ink-400 text-xs leading-5">緑=高信頼OCR / 金色=OCR結果と異なる</p>
        </div>
      </div>
      <details className="border-line-soft bg-capture-black/28 mt-5 rounded-[1.5rem] border p-4">
        <summary className="text-ink-100 cursor-pointer text-sm font-bold">
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
                className="border-line-soft bg-night-900/72 rounded-[1.25rem] border p-4"
              >
                <p className="text-ink-100 text-sm font-black">{labels[kind]}</p>
                <p className="text-ink-400 mt-2 text-xs leading-5">
                  {draft ? "OCR下書きから表へ反映済み" : "OCR下書きなし。金色セルを手入力します。"}
                </p>
                {draft?.detectedImageType ? (
                  <span className="border-line-soft text-ink-300 mt-3 inline-flex rounded-full border px-3 py-1 text-xs">
                    判定: {draft.detectedImageType}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        {merged.warnings.length ? (
          <div className="border-rail-gold/30 bg-rail-gold/10 text-ink-100 mt-4 rounded-[1.5rem] border p-4 text-sm">
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
          <thead className="text-ink-400 text-xs tracking-[0.18em] uppercase">
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
                    const original = originalByIndex[playerIndex];
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
                          onValueChange={(value) =>
                            key === "playOrder"
                              ? handlePlayOrderChange(playerIndex, value)
                              : patchPlayer(playerIndex, { [key]: value })
                          }
                        />
                        {key !== "playOrder" && state.tone === "manual" ? (
                          <p className="text-rail-gold mt-1 text-[0.68rem]">{state.label}</p>
                        ) : null}
                      </td>
                    );
                  },
                )}
                {incidentColumns.map(([key, label]) => (
                  <td key={key} className="px-2 py-3 last:rounded-r-2xl">
                    {(() => {
                      // 事件簿の「原本」は player の現在の play_order に対応する列の OCR 値。
                      // ここを originalByIndex[playerIndex].incidents にしてしまうと、
                      // total_assets 側の play_order 解決が外れたときに別の列の値と比較されて
                      // 「手修正」が誤発火する。
                      const incidentLookup = merged.incidentByPlayOrder.get(player.playOrder);
                      const state = fieldState(
                        player.incidents[key],
                        incidentLookup?.counts[label],
                        incidentLookup?.confidence[label],
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
          <p className="font-display text-rail-gold text-sm tracking-[0.55em] uppercase">
            Draft Review Desk
          </p>
          <h1 className="text-ink-100 mt-4 max-w-4xl text-4xl font-black tracking-tight sm:text-6xl">
            OCR下書き確認
          </h1>
          <p className="text-ink-300 mt-4 max-w-2xl text-base leading-7">
            3つの下書きを1試合分にまとめ、開催履歴・順位・金額・事件簿を同じ画面で確認して確定します。
          </p>
          {useSampleDrafts ? (
            <p className="border-rail-gold/35 bg-rail-gold/10 text-rail-gold mt-3 inline-flex rounded-full border px-3 py-1 text-sm font-bold">
              開発用サンプル下書きで表示中
            </p>
          ) : null}
        </div>
        <AuthPanel auth={authQuery.data} forceDevPicker={authError?.status === 401} />
      </header>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          className="text-rail-gold text-sm font-bold underline-offset-4 hover:underline"
          to="/ocr/new"
        >
          ← 取り込みコンソールへ戻る
        </Link>
        {authQuery.data ? (
          <span className="border-line-soft bg-night-900/72 text-ink-300 rounded-full border px-3 py-2 text-sm">
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
          className="border-rail-gold/30 bg-night-900/95 fixed top-4 right-4 left-4 z-40 rounded-[1.25rem] border p-4 text-sm text-yellow-50 shadow-[0_18px_60px_rgb(0_0_0/0.28)] backdrop-blur sm:left-auto sm:w-[24rem]"
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="leading-6">{notice}</p>
            <button
              className="border-line-soft text-ink-300 hover:text-ink-100 rounded-full border px-2 py-0.5 text-xs transition"
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
          className="border-rail-gold/25 bg-rail-gold/10 mt-6 rounded-3xl border p-4 text-sm text-yellow-50"
          role="status"
        >
          {validationMessage}
        </div>
      ) : null}

      <div className="border-line-soft bg-night-900/92 sticky bottom-4 mt-8 rounded-[2rem] border p-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ink-300 text-sm">
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
