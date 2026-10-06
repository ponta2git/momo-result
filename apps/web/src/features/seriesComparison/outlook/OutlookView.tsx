import { Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";

import {
  buildJointDistribution,
  areDistributionsCompatible,
  compareRationals,
  countsPerTwenty,
  distributionFromCounts,
  distributionMean,
  distributionsEqual,
  formatRational,
  generateOutlookExamples,
  jointFromCounts,
  nextMatchOutcomes,
  outlookCrossings,
  projectOutlook,
  rational,
  rationalToNumber,
  requiredMean,
  subtractRationals,
} from "@/features/seriesComparison/model/outlook";
import type { CumulativePair } from "@/features/seriesComparison/model/outlook";
import { seriesAnalysisScopeSignature } from "@/features/seriesComparison/model/seriesAnalysisDisplayBundle";
import { normalizeOutlookPair } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import type { SeriesAnalysisUrlState } from "@/features/seriesComparison/model/seriesAnalysisViewModel";
import { OutlookChart } from "@/features/seriesComparison/outlook/OutlookChart";
import { OutlookEditor } from "@/features/seriesComparison/outlook/OutlookEditor";
import {
  exactAverageFraction,
  outlookAverage,
  outlookSourceLabel,
} from "@/features/seriesComparison/outlook/outlookPresentation";
import {
  OutlookPastExamples,
  OutlookRequirements,
} from "@/features/seriesComparison/outlook/OutlookReferences";
import { OutlookResults } from "@/features/seriesComparison/outlook/OutlookResults";
import {
  adoptOutlookSummary,
  applyOutlookDistribution,
  finishOutlookGesture,
  outlookPlayer,
  undoOutlook,
  updateOutlookEntry,
} from "@/features/seriesComparison/outlook/outlookSession";
import type {
  OutlookRole,
  OutlookSession,
} from "@/features/seriesComparison/outlook/outlookSession";
import { useOutlookSession } from "@/features/seriesComparison/outlook/OutlookSessionOwner";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { canonicalResultMemberIds, orderFixedMembers } from "@/shared/domain/members";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { currentInternalLocation, withReturnTo } from "@/shared/navigation/returnTo";
import { Button } from "@/shared/ui/actions/Button";
import { LinkButton } from "@/shared/ui/actions/LinkButton";
import { cn } from "@/shared/ui/cn";
import { Disclosure } from "@/shared/ui/data/Collapsible";
import { DataTable } from "@/shared/ui/data/DataTable";
import { CheckboxField } from "@/shared/ui/forms/CheckboxField";
import { SelectField } from "@/shared/ui/forms/SelectField";
import { TabsRoot, TabsList, TabsTab, TabsPanel } from "@/shared/ui/forms/Tabs";
import { contentText } from "@/shared/ui/typography";

function crossingLabel(
  crossing: ReturnType<typeof outlookCrossings>,
  focus: string,
  rival: string,
) {
  if (crossing.current === "ahead") {
    if (crossing.rivalAtLeast === null) return `${focus}の先行が続きます。`;
    return crossing.exactTie === crossing.rivalAtLeast
      ? `${crossing.rivalAtLeast}戦で同率、${crossing.rivalAhead}戦で${rival}が上回ります。`
      : `${crossing.rivalAhead}戦で${rival}が上回ります。`;
  }
  if (crossing.current === "tied") {
    if (crossing.focusAhead !== null)
      return `現在同率。${crossing.focusAhead}戦で${focus}が上回ります。`;
    if (crossing.rivalAhead !== null)
      return `現在同率。${crossing.rivalAhead}戦で${rival}が上回ります。`;
    return "同率のまま推移します。";
  }
  if (crossing.focusAtLeast === null) return "相手には追いつきません。";
  return crossing.exactTie === crossing.focusAtLeast
    ? `${crossing.focusAtLeast}戦で同率、${crossing.focusAhead}戦で上回ります。`
    : `${crossing.focusAhead}戦で上回ります。`;
}

export function OutlookView({
  response,
  selection,
  onMemberChange,
}: {
  response: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisUrlState;
  onMemberChange?: ((role: "focus" | "rival", memberId: string) => void) | undefined;
}) {
  const { store, session: storedSession } = useOutlookSession();
  const pairIds = normalizeOutlookPair(selection.focusMemberId, selection.rivalMemberId);
  const scopeKey = seriesAnalysisScopeSignature(selection);
  const session = adoptOutlookSummary(storedSession, response, scopeKey, [
    pairIds.focusMemberId,
    pairIds.rivalMemberId,
  ]);
  useLayoutEffect(() => {
    store.update((current) =>
      adoptOutlookSummary(current, response, scopeKey, [
        pairIds.focusMemberId,
        pairIds.rivalMemberId,
      ]),
    );
  }, [store, response, scopeKey, pairIds.focusMemberId, pairIds.rivalMemberId]);
  useEffect(
    () => () => {
      store.update((current) => (current ? finishOutlookGesture(current) : current));
    },
    [store],
  );
  const change = useCallback(
    (update: (current: OutlookSession) => OutlookSession) => {
      store.update((current) => (current ? update(current) : current));
    },
    [store],
  );
  if (!session) return <p className={contentText.body}>この範囲に確定済みの試合がありません。</p>;
  return (
    <OutlookWorkspace
      response={response}
      selection={selection}
      session={session}
      change={change}
      onMemberChange={onMemberChange}
    />
  );
}

function OutlookWorkspace({
  response,
  selection,
  session,
  change,
  onMemberChange,
}: {
  response: SeriesAnalysisOutlookSummary;
  selection: SeriesAnalysisUrlState;
  session: OutlookSession;
  change: (update: (current: OutlookSession) => OutlookSession) => void;
  onMemberChange: ((role: "focus" | "rival", memberId: string) => void) | undefined;
}) {
  const location = useLocation();
  const { focusMemberId, rivalMemberId } = normalizeOutlookPair(
    selection.focusMemberId,
    selection.rivalMemberId,
  );
  const ids = useMemo(
    () => [focusMemberId, rivalMemberId] as const,
    [focusMemberId, rivalMemberId],
  );
  const people = [
    outlookPlayer(response.players, focusMemberId),
    outlookPlayer(response.players, rivalMemberId),
  ] as const;
  const names = [people[0].displayName, people[1].displayName] as const;
  const recent = useMemo(
    () =>
      [
        distributionFromCounts(outlookPlayer(response.recent.players, focusMemberId).rankCounts),
        distributionFromCounts(outlookPlayer(response.recent.players, rivalMemberId).rankCounts),
      ] as const,
    [response.recent.players, focusMemberId, rivalMemberId],
  );
  const cumulative: CumulativePair = useMemo(
    () => ({
      games: response.scope.matchCount,
      focusRankSum: outlookPlayer(response.players, focusMemberId).rankSum,
      rivalRankSum: outlookPlayer(response.players, rivalMemberId).rankSum,
    }),
    [response.scope.matchCount, response.players, focusMemberId, rivalMemberId],
  );
  const focus = session.entries[0].distribution;
  const rival = session.entries[1].distribution;
  const crossing = useMemo(
    () => outlookCrossings(cumulative, focus, rival),
    [cumulative, focus, rival],
  );
  const baselineCrossing = useMemo(
    () => outlookCrossings(cumulative, recent[0], recent[1]),
    [cumulative, recent],
  );
  const changed = !distributionsEqual(focus, recent[0]) || !distributionsEqual(rival, recent[1]);
  const conclusion = crossingLabel(crossing, names[0], names[1]);
  const marker = crossing.current === "ahead" ? crossing.rivalAtLeast : crossing.focusAtLeast;
  const chartPoints = useMemo(
    () =>
      Array.from({ length: 101 }, (_, h) => ({
        h,
        gap: rationalToNumber(projectOutlook(cumulative, focus, rival, h).gap),
      })),
    [cumulative, focus, rival],
  );
  const recentPoints = useMemo(
    () =>
      Array.from({ length: 101 }, (_, h) => ({
        h,
        gap: rationalToNumber(projectOutlook(cumulative, recent[0], recent[1], h).gap),
      })),
    [cumulative, recent],
  );
  const examples = useMemo(() => {
    if (!session.noise || session.gesture) return undefined;
    const jointRecord = response.recent.jointRanks.find(
      (pair) =>
        ids.includes(pair.memberAId as (typeof ids)[number]) &&
        ids.includes(pair.memberBId as (typeof ids)[number]),
    );
    if (!jointRecord) return null;
    const canonicalIds = canonicalResultMemberIds.filter((id) => ids.includes(id)) as [
      string,
      string,
    ];
    const canonicalFocusFirst = canonicalIds[0] === focusMemberId;
    const observed =
      jointRecord.memberAId === canonicalIds[0]
        ? jointRecord.rankCounts
        : [0, 1, 2, 3].map((column) =>
            jointRecord.rankCounts.map((row) => {
              const value = row[column];
              if (value === undefined) throw new Error("Incomplete joint ranks");
              return value;
            }),
          );
    const joint = buildJointDistribution(
      canonicalFocusFirst ? focus : rival,
      canonicalFocusFirst ? rival : focus,
      jointFromCounts(observed),
    );
    return joint
      ? generateOutlookExamples({
          gameTitleId: response.artifact.gameTitleId,
          canonicalMemberIds: canonicalIds,
          focusMemberId,
          cumulative,
          joint,
        })
      : null;
  }, [session.noise, session.gesture, focus, rival, response, focusMemberId, ids, cumulative]);
  const examplePoints = useMemo(
    () => examples?.examples.map((example) => example.points.map((point) => point.gap)) ?? [],
    [examples],
  );
  const numericRows = useMemo(
    () =>
      [...new Set([0, 10, 20, 50, 100, session.horizon])]
        .toSorted((a, b) => a - b)
        .map((h) => ({ h, ...projectOutlook(cumulative, focus, rival, h) })),
    [cumulative, focus, rival, session.horizon],
  );
  // All three consumers share the same exact requirement for the selected horizon.
  const { required, requirements } = useMemo(() => {
    const atHorizon = requiredMean(cumulative, rival, session.horizon);
    return {
      required: atHorizon,
      requirements: [
        { h: session.horizon, required: atHorizon },
        ...[50, 100]
          .filter((h) => h !== session.horizon)
          .map((h) => ({
            h,
            required: requiredMean(cumulative, rival, h),
          })),
      ],
    };
  }, [cumulative, rival, session.horizon]);
  const recentMean = distributionMean(recent[0]);
  const targetMean =
    required.maximumHundredths !== null ? rational(BigInt(required.maximumHundredths), 100n) : null;
  const improves = targetMean !== null && compareRationals(recentMean, targetMean) > 0;
  const recentCanReach =
    areDistributionsCompatible(recent[0], rival) &&
    compareRationals(recentMean, required.threshold) < 0;
  const reviewSearch = new URLSearchParams(location.search);
  reviewSearch.set("view", "review");
  const reviewHref = `${location.pathname}?${reviewSearch}#review-member-${focusMemberId}`;
  const matchParams = new URLSearchParams({
    gameTitleId: response.artifact.gameTitleId,
    status: "confirmed",
  });
  if (selection.seasonMasterId) matchParams.set("seasonMasterId", selection.seasonMasterId);
  const matchHref = withReturnTo(`/matches?${matchParams}`, currentInternalLocation(location));
  const chosenCounts = ["counts", "example"].includes(session.entries[0].source.kind);
  const recentCounts = countsPerTwenty(recent[0]);
  const focusCounts = countsPerTwenty(focus);
  const lessLow =
    chosenCounts &&
    compareRationals(
      subtractRationals(focusCounts[2], recentCounts[2]),
      subtractRationals(recentCounts[3], focusCounts[3]),
    ) < 0;
  const moreWins = chosenCounts && compareRationals(focusCounts[0], recentCounts[0]) > 0;
  const nextOutcomes = nextMatchOutcomes(cumulative).filter((outcome) =>
    crossing.current === "ahead"
      ? outcome.relation !== "ahead"
      : crossing.current === "behind"
        ? outcome.relation !== "behind"
        : true,
  );
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-2" data-outlook-preserve-draft>
        {([0, 1] as const).map((role) => (
          <div key={role} className="grid gap-1">
            <SelectField
              label={role === 0 ? "注目する人" : "比較する相手"}
              value={ids[role]}
              options={orderFixedMembers(response.players).map((player) => ({
                label: player.displayName,
                value: player.memberId,
                disabled: player.memberId === ids[role === 0 ? 1 : 0],
              }))}
              onValueChange={(id) => onMemberChange?.(role === 0 ? "focus" : "rival", id)}
            />
          </div>
        ))}
        <p className={cn(contentText.supporting, "sm:col-span-2")}>
          人物を変更すると、直近の成績に戻ります。
        </p>
      </div>
      <section aria-labelledby="outlook-conclusion" className="grid gap-2">
        <h2 id="outlook-conclusion" className={contentText.heading}>
          {changed ? "試している成績が続くと" : `直近${response.recent.matchCount}戦の成績が続くと`}
        </h2>
        <p className={contentText.primary} aria-live="off">
          {conclusion}
        </p>
        {changed && conclusion !== crossingLabel(baselineCrossing, names[0], names[1]) ? (
          <p className={contentText.supporting}>
            直近のままなら：{crossingLabel(baselineCrossing, names[0], names[1])}
          </p>
        ) : null}
        {session.notice ? (
          <p className={contentText.body} role="status">
            {session.notice}
          </p>
        ) : null}
      </section>
      <section aria-label="成績を変えて見通しを比べる" className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)]">
          <div className="grid min-w-0 content-start gap-3">
            <div className="grid min-w-0 content-start gap-3">
              <OutlookChart
                points={chartPoints}
                recent={recentPoints}
                examples={examplePoints}
                sameLine={
                  compareRationals(
                    subtractRationals(distributionMean(rival), distributionMean(focus)),
                    subtractRationals(distributionMean(recent[1]), distributionMean(recent[0])),
                  ) === 0
                }
                recentCount={response.recent.matchCount}
                horizon={session.horizon}
                marker={marker !== null && marker <= 100n ? Number(marker) : null}
                markerLabel={conclusion}
                focusName={names[0]}
                rivalName={names[1]}
                gesturing={Boolean(session.gesture)}
              />
              <CheckboxField
                label="順位のブレも見る"
                checked={session.noise}
                onChange={(event) => {
                  const checked = event.target.checked;
                  change((current) => ({ ...current, noise: checked }));
                }}
              />
              {session.noise ? (
                <p className={contentText.supporting} role="status">
                  {session.gesture
                    ? "操作を終えると展開例を更新します。"
                    : examples === null
                      ? "展開例を計算できません。平均の見通しは表示しています。"
                      : examples?.constantPerGameDifference
                        ? "この内訳では毎試合の差が一定になり、3本が重なります。"
                        : examples && examples.distinctCandidateCount < 3
                          ? `異なる展開は${examples.distinctCandidateCount}例のため、一部が重なっています。`
                          : "2人の順位が揺れる3つの展開例です。確率や上下限を示すものではありません。"}
                </p>
              ) : null}
            </div>
            <div className="min-w-0">
              <OutlookResults
                cumulative={cumulative}
                names={names}
                session={session}
                change={change}
              />
            </div>
          </div>
          <div className="grid min-w-0 content-start gap-3">
            <div data-outlook-preserve-draft>
              <p className={cn(contentText.heading, "mb-2")}>これからの成績</p>
              <TabsRoot
                value={String(session.editor)}
                onValueChange={(value) =>
                  change((current) => ({ ...current, editor: Number(value) as OutlookRole }))
                }
              >
                <TabsList aria-label="調整する人" activateOnFocus={false}>
                  {names.map((name, role) => (
                    <TabsTab key={ids[role]} value={String(role)} aria-label={name}>
                      <span className="grid gap-1">
                        <MemberSequenceLabel memberId={ids[role as OutlookRole]}>
                          {name}
                        </MemberSequenceLabel>
                        <span className={contentText.supporting}>
                          {outlookAverage(
                            distributionMean(session.entries[role as OutlookRole].distribution),
                          )}
                          位
                        </span>
                      </span>
                    </TabsTab>
                  ))}
                </TabsList>
                <TabsPanel value={String(session.editor)}>
                  <TabsRoot
                    value={session.method}
                    onValueChange={(value) =>
                      change((current) => ({
                        ...updateOutlookEntry(current, current.editor, { error: undefined }),
                        method: value as "mean" | "counts",
                      }))
                    }
                  >
                    <TabsList
                      aria-label="成績の入力方法"
                      variant="underline"
                      activateOnFocus={false}
                    >
                      <TabsTab value="mean">平均順位で調整</TabsTab>
                      <TabsTab value="counts">順位の回数で調整</TabsTab>
                    </TabsList>
                    <TabsPanel value={session.method}>
                      <div className="grid gap-2 pt-3">
                        {!(
                          session.entries[session.editor].source.kind === "counts" &&
                          session.method === "counts"
                        ) &&
                        !(
                          session.entries[session.editor].source.kind === "average" &&
                          session.method === "mean"
                        ) ? (
                          <p className={contentText.supporting}>
                            {outlookSourceLabel(
                              session.entries[session.editor].source,
                              session.artifactId,
                            )}
                          </p>
                        ) : null}
                        <OutlookEditor
                          key={session.editor}
                          session={session}
                          name={names[session.editor]}
                          change={change}
                        />
                      </div>
                    </TabsPanel>
                  </TabsRoot>
                </TabsPanel>
              </TabsRoot>
            </div>
            {([0, 1] as const)
              .filter(
                (role) =>
                  session.entries[role].meanDraft !== undefined &&
                  (role !== session.editor || session.method !== "mean"),
              )
              .map((role) => (
                <div key={role} className="grid gap-1" data-outlook-preserve-draft>
                  <p className={contentText.supporting}>{names[role]}の平均は入力中です。</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        change((current) => ({ ...current, editor: role, method: "mean" }))
                      }
                    >
                      入力へ戻る
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() =>
                        change((current) =>
                          updateOutlookEntry(current, role, {
                            meanDraft: undefined,
                            error: undefined,
                          }),
                        )
                      }
                    >
                      入力を破棄
                    </Button>
                  </div>
                </div>
              ))}
            <div className="flex flex-wrap items-center gap-2" data-outlook-preserve-draft>
              <Button
                size="sm"
                variant="quiet"
                icon={<Undo2 />}
                disabled={!session.history.length && !session.gesture}
                onClick={() => change((current) => undoOutlook(finishOutlookGesture(current)))}
              >
                元に戻す
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() =>
                  change((current) =>
                    applyOutlookDistribution(current, current.editor, recent[current.editor], {
                      kind: "recent",
                      artifactId: response.artifact.artifactId,
                      matchCount: response.recent.matchCount,
                      ...(response.recent.period ? { period: response.recent.period } : {}),
                    }),
                  )
                }
              >
                {names[session.editor]}を直近の成績に戻す
              </Button>
            </div>
          </div>
        </div>
        <Disclosure
          summary="計算に使った実績と詳しい数値"
          ariaLabel="計算に使った実績と詳しい数値"
          panelPadding="sm"
        >
          <div className="grid gap-3">
            <DataTable
              caption={{ content: "今後の総合平均順位", visibility: "screen-reader" }}
              rows={numericRows}
              getRowKey={(row) => String(row.h)}
              density="compact"
              columns={[
                {
                  key: "h",
                  header: "この先",
                  rowHeader: true,
                  renderCell: (row) => (row.h === 0 ? "現在" : `${row.h}戦`),
                },
                {
                  key: "focus",
                  header: names[0],
                  tabular: true,
                  renderCell: (row) => outlookAverage(row.focusAverage),
                },
                {
                  key: "rival",
                  header: names[1],
                  tabular: true,
                  renderCell: (row) => outlookAverage(row.rivalAverage),
                },
                {
                  key: "gap",
                  header: "平均順位の差",
                  tabular: true,
                  renderCell: (row) =>
                    `${formatRational(row.gap, 4)} · ${row.relation === "tied" ? "同率" : `${row.relation === "ahead" ? names[0] : names[1]}が上`}`,
                },
              ]}
            />
            <p className={contentText.supporting}>
              累積は選択した範囲の{response.scope.matchCount}戦。初期値は作品全体の直近
              {response.recent.matchCount}戦
              {response.recent.period
                ? `（${response.recent.period.startedAt.slice(0, 10)}〜${response.recent.period.endedAt.slice(0, 10)}）`
                : ""}
              です。表示を丸めても、同率・逆転は丸め前の値で判定しています。
            </p>
            <p className={contentText.supporting}>
              {names[0]}の直近平均：{exactAverageFraction(recent[0])}、{names[1]}：
              {exactAverageFraction(recent[1])}（順位合計 / 戦数）。
            </p>
            {response.recent.qualityStatus === "reference" ? (
              <p className={contentText.supporting}>
                直近の実績は少数のため参考値です。ブレの例も将来の確かさを示すものではありません。
              </p>
            ) : null}
          </div>
        </Disclosure>
      </section>
      <OutlookRequirements
        response={response}
        focusId={focusMemberId}
        horizon={session.horizon}
        recent={recent[0]}
        rival={rival}
        requirements={requirements}
      />
      {nextOutcomes.length ? (
        <Disclosure
          summary="実際の次戦でも同率・逆転が可能です"
          ariaLabel="次戦の順位の組合せ"
          panelPadding="sm"
        >
          <p className={contentText.body}>
            {nextOutcomes
              .map(
                (outcome) =>
                  `${names[0]}${outcome.focusRank}位・${names[1]}${outcome.rivalRank}位で${outcome.relation === "tied" ? "同率" : `${outcome.relation === "ahead" ? names[0] : names[1]}が上`}`,
              )
              .join("。")}
          </p>
        </Disclosure>
      ) : null}
      <OutlookPastExamples
        response={response}
        focusId={focusMemberId}
        focusName={names[0]}
        cumulative={cumulative}
        required={required}
        session={session}
        change={change}
      />
      <section
        className="grid gap-2"
        aria-labelledby="outlook-review-heading"
        data-outlook-preserve-draft
      >
        <h2 id="outlook-review-heading" className={contentText.heading}>
          戦績を振り返る
        </h2>
        <p className={contentText.body}>
          {improves && targetMean
            ? `直近より平均順位を${formatRational(subtractRationals(recentMean, targetMean), 2)}位良くし、平均${formatRational(targetMean, 2)}位以下を${session.horizon}戦続けると上回ります。`
            : recentCanReach
              ? `直近の成績を${session.horizon}戦続けると上回ります。好調だった試合を振り返りましょう。`
              : required.kind === "mean"
                ? "直近の平均は条件を満たしますが、順位の内訳が相手の指定と両立しません。相手の指定も踏まえ、内訳を見直せます。"
                : `${session.horizon}戦後に上回るには、相手の成績か続ける戦数を変えて検討できます。`}
        </p>
        {lessLow ? (
          <p className={contentText.body}>下位だった試合で、共通する展開を確かめる。</p>
        ) : null}
        {moreWins ? (
          <p className={contentText.body}>勝ち切れなかった試合で、見直せる点を探す。</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="secondary" size="sm" to={reviewHref}>
            {names[0]}の行動仮説を見る
          </LinkButton>
          <LinkButton variant="quiet" size="sm" to={matchHref}>
            {selection.seasonMasterId ? "このシーズンの確定戦績を見る" : "この作品の確定戦績を見る"}
          </LinkButton>
        </div>
      </section>
    </div>
  );
}
