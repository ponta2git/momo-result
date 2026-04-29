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

function confidenceInputClass(confidence: number | null | undefined): string {
  if (confidence == null) {
    return inputMissingClass;
  }
  if (confidence < confidenceThresholdLow) {
    return inputAttentionClass;
  }
  return inputClass;
}

function confidenceLabel(confidence: number | null | undefined): string {
  if (confidence == null) {
    return "手入力";
  }
  if (confidence < confidenceThresholdLow) {
    return `低信頼 ${(confidence * 100).toFixed(0)}%`;
  }
  return `OCR ${(confidence * 100).toFixed(0)}%`;
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
            <dd className="font-bold text-ink-100">{heldEvent?.name ?? values.heldEventId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">試合番号</dt>
            <dd>第{values.matchNoInEvent}試合</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-400">作品 / マップ</dt>
            <dd>
              {values.gameTitle} / {values.mapName}
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
    name: "",
    heldAt: toLocalDateTime(new Date().toISOString()),
  });
  const [values, setValues] = useState<ConfirmMatchFormValues>(() => {
    const gameTitle = findGameTitle(defaultSetupValues.gameTitleId);
    return {
      heldEventId: "",
      matchNoInEvent: 1,
      gameTitle: gameTitle.displayName,
      layoutFamily: gameTitle.layoutFamily,
      seasonId: defaultSetupValues.seasonId,
      ownerMemberId: defaultSetupValues.ownerMemberId,
      mapName: defaultSetupValues.mapName,
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
      setNotice(`開催履歴「${event.name}」を作成して選択しました。`);
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
    gameTitles.find((gameTitle) => gameTitle.displayName === values.gameTitle) ??
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

  const readiness = confirmMatchSchema.safeParse(values);
  const readinessIssues = readiness.success
    ? []
    : readiness.error.issues.map((issue) => issue.message);
  const missingDraftCount = slotKinds.filter((kind) => !draftMap[kind]).length;
  const attentionCount = merged.players.reduce((count, player) => {
    const confidenceValues = [
      player.confidence.rank,
      player.confidence.totalAssets,
      player.confidence.revenue,
      ...Object.values(player.confidence.incidents),
    ];
    return (
      count +
      confidenceValues.filter(
        (confidence) => confidence == null || confidence < confidenceThresholdLow,
      ).length +
      player.warnings.length
    );
  }, missingDraftCount);

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

  function handleGameTitleChange(displayName: string) {
    const gameTitle =
      gameTitles.find((candidate) => candidate.displayName === displayName) ??
      findGameTitle(defaultSetupValues.gameTitleId);
    patchValue({
      gameTitle: gameTitle.displayName,
      layoutFamily: gameTitle.layoutFamily,
      mapName: gameTitle.maps[0] ?? "",
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

      <section className="mt-8 grid gap-3 md:grid-cols-3" aria-label="確認ステータス">
        <div className="rounded-[1.5rem] border border-line-soft bg-night-900/72 p-4">
          <p className={labelClass}>Required</p>
          <p className="mt-1 text-2xl font-black text-ink-100">
            {readiness.success ? "確定可能" : `${readinessIssues.length}件確認`}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-300">
            {readiness.success
              ? "開催履歴、4人全員、順位、プレー順が揃っています。"
              : readinessIssues.slice(0, 2).join(" / ")}
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-rail-magenta/25 bg-rail-magenta/10 p-4">
          <p className={labelClass}>Review Hints</p>
          <p className="mt-1 text-2xl font-black text-pink-50">修正推奨 {attentionCount}</p>
          <p className="mt-2 text-sm leading-6 text-pink-100/90">
            金色は手入力、桃色は低信頼度です。セルを直接編集してください。
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-rail-gold/25 bg-rail-gold/10 p-4">
          <p className={labelClass}>Missing Drafts</p>
          <p className="mt-1 text-2xl font-black text-yellow-50">{missingDraftCount}カテゴリ</p>
          <p className="mt-2 text-sm leading-6 text-yellow-100/90">
            下書きがない分類は0/初期値で始め、手入力で確定できます。
          </p>
        </div>
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[minmax(22rem,0.8fr)_minmax(0,1.2fr)]">
        <Card>
          <p className={labelClass}>Match Context</p>
          <h2 className="mt-1 text-2xl font-black">開催履歴と試合情報</h2>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2">
              <span className={labelClass}>開催履歴</span>
              <select
                className={inputClass}
                value={values.heldEventId}
                onChange={(event) => {
                  const heldEvent = heldEvents.find(
                    (candidate) => candidate.id === event.target.value,
                  );
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
                    {event.name}（{new Date(event.heldAt).toLocaleString()} / {event.matchCount}
                    試合）
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-[1.5rem] border border-line-soft bg-capture-black/28 p-4">
              <p className="font-bold text-ink-100">開催履歴を新規作成</p>
              <div className="mt-3 grid gap-3">
                <input
                  className={inputClass}
                  placeholder="例: 2026-04-29 定例会"
                  value={eventDraft.name}
                  onChange={(event) =>
                    setEventDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
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
                  disabled={!eventDraft.name.trim() || createEventMutation.isPending}
                  onClick={() =>
                    createEventMutation.mutate({
                      name: eventDraft.name,
                      heldAt: toIsoFromLocal(eventDraft.heldAt),
                    })
                  }
                >
                  作成して選択
                </Button>
              </div>
            </div>
            <label className="grid gap-2">
              <span className={labelClass}>試合番号</span>
              <input
                className={inputClass}
                min={1}
                type="number"
                value={values.matchNoInEvent}
                onChange={(event) => patchValue({ matchNoInEvent: Number(event.target.value) })}
              />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>開催日時</span>
              <input
                className={inputClass}
                type="datetime-local"
                value={toLocalDateTime(values.playedAt)}
                onChange={(event) => patchValue({ playedAt: toIsoFromLocal(event.target.value) })}
              />
            </label>
          </div>
        </Card>

        <Card>
          <p className={labelClass}>Draft Summary</p>
          <h2 className="mt-1 text-2xl font-black">下書きサマリー</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {slotKinds.map((kind) => {
              const labels: Record<SlotKind, string> = {
                total_assets: "総資産",
                revenue: "収益",
                incident_log: "事件簿",
              };
              const draft = draftMap[kind];
              return (
                <div
                  key={kind}
                  className="rounded-[1.5rem] border border-line-soft bg-capture-black/28 p-4"
                >
                  <p className="text-sm font-black text-ink-100">{labels[kind]}</p>
                  <p className="mt-2 text-xs leading-5 text-ink-400">
                    {draft ? `draft: ${draft.draftId}` : "未取得。手入力で続行できます。"}
                  </p>
                  {draft?.detectedImageType ? (
                    <span className="mt-3 inline-flex rounded-full border border-line-soft px-3 py-1 text-xs text-ink-300">
                      判定: {draft.detectedImageType}
                    </span>
                  ) : null}
                  {!draft ? (
                    <span className="mt-3 inline-flex rounded-full border border-rail-gold/30 bg-rail-gold/10 px-3 py-1 text-xs font-bold text-rail-gold">
                      手入力
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          {merged.warnings.length ? (
            <div className="mt-5 rounded-[1.5rem] border border-rail-magenta/30 bg-rail-magenta/10 p-4 text-sm text-pink-50">
              {merged.warnings.join(" / ")}
            </div>
          ) : null}
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <label className="grid gap-2">
              <span className={labelClass}>作品</span>
              <select
                className={inputClass}
                value={values.gameTitle}
                onChange={(event) => handleGameTitleChange(event.target.value)}
              >
                {gameTitles.map((gameTitle) => (
                  <option key={gameTitle.id} value={gameTitle.displayName}>
                    {gameTitle.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>シーズン</span>
              <select
                className={inputClass}
                value={values.seasonId}
                onChange={(event) => patchValue({ seasonId: event.target.value })}
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>マップ</span>
              <select
                className={inputClass}
                value={values.mapName}
                onChange={(event) => patchValue({ mapName: event.target.value })}
              >
                {selectedGame.maps.map((mapName) => (
                  <option key={mapName} value={mapName}>
                    {mapName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2">
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
        </Card>
      </section>

      <Card className="mt-8 overflow-x-auto">
        <p className={labelClass}>Player Results</p>
        <h2 className="mt-1 text-2xl font-black">4人分の結果を確認・手修正</h2>
        <table className="mt-5 min-w-[1100px] border-separate border-spacing-y-2 text-left text-sm">
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
                    className={inputClass}
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
                    const confidence =
                      key === "rank"
                        ? original?.confidence.rank
                        : key === "totalAssetsManYen"
                          ? original?.confidence.totalAssets
                          : key === "revenueManYen"
                            ? original?.confidence.revenue
                            : 1;
                    return (
                      <td key={key} className="px-2 py-3">
                        <input
                          aria-label={`${memberName(player.memberId)} ${key}`}
                          className={confidenceInputClass(confidence)}
                          min={key === "playOrder" || key === "rank" ? 1 : 0}
                          max={key === "playOrder" || key === "rank" ? 4 : undefined}
                          title={confidenceLabel(confidence)}
                          type="number"
                          value={player[key]}
                          onChange={(event) =>
                            patchPlayer(playerIndex, { [key]: Number(event.target.value) })
                          }
                        />
                        {key !== "playOrder" ? (
                          <p className="mt-1 text-[0.68rem] text-ink-400">
                            {confidenceLabel(confidence)}
                          </p>
                        ) : null}
                      </td>
                    );
                  },
                )}
                {incidentColumns.map(([key, label]) => (
                  <td key={key} className="px-2 py-3 last:rounded-r-2xl">
                    <input
                      aria-label={`${memberName(player.memberId)} ${key}`}
                      className={confidenceInputClass(
                        originalByMember.get(player.memberId)?.confidence.incidents[label],
                      )}
                      min={0}
                      title={confidenceLabel(
                        originalByMember.get(player.memberId)?.confidence.incidents[label],
                      )}
                      type="number"
                      value={player.incidents[key]}
                      onChange={(event) =>
                        patchIncident(playerIndex, key, Number(event.target.value))
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {validationMessage || notice ? (
        <div
          className="mt-6 rounded-3xl border border-rail-gold/25 bg-rail-gold/10 p-4 text-sm text-yellow-50"
          role="status"
        >
          {validationMessage || notice}
        </div>
      ) : null}

      <div className="sticky bottom-4 mt-8 rounded-[2rem] border border-line-soft bg-night-900/92 p-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-300">
            開催履歴・4人全員・順位1〜4・プレー順1〜4が揃うと確定できます。
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
