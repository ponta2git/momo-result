import { Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";

import {
  buildJointDistribution,
  compareRationals,
  countsPerTwenty,
  distributionFromCounts,
  distributionMean,
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
import {
  adoptOutlookSummary,
  applyOutlookDistribution,
  finishOutlookGesture,
  sameDistribution,
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
    if (crossing.rivalAtLeast === null)
      return `${focus}が先行しています。この成績が続くと、先行を保ちます。`;
    return crossing.exactTie === crossing.rivalAtLeast
      ? `${crossing.rivalAtLeast}戦で同率、${crossing.rivalAhead}戦で${rival}が上回ります。`
      : `${crossing.rivalAhead}戦で${rival}が上回ります。`;
  }
  if (crossing.current === "tied") {
    if (crossing.focusAhead !== null)
      return `現在同率。${crossing.focusAhead}戦で${focus}が上回ります。`;
    if (crossing.rivalAhead !== null)
      return `現在同率。${crossing.rivalAhead}戦で${rival}が上回ります。`;
    return "現在同率。この成績が続くと、平均の線は同率のままです。";
  }
  if (crossing.focusAtLeast === null) return "この成績が続いても、相手には追いつきません。";
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
  const crossing = outlookCrossings(cumulative, focus, rival);
  const baselineCrossing = outlookCrossings(cumulative, recent[0], recent[1]);
  const changed = !sameDistribution(focus, recent[0]) || !sameDistribution(rival, recent[1]);
  const conclusion = crossingLabel(crossing, names[0], names[1]);
  const marker = crossing.current === "ahead" ? crossing.rivalAtLeast : crossing.focusAtLeast;
  const chartPoints = Array.from({ length: 101 }, (_, h) => ({
    h,
    gap: rationalToNumber(projectOutlook(cumulative, focus, rival, h).gap),
  }));
  const recentPoints = Array.from({ length: 101 }, (_, h) => ({
    h,
    gap: rationalToNumber(projectOutlook(cumulative, recent[0], recent[1], h).gap),
  }));
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
  const numericRows = [...new Set([0, 10, 20, 50, 100, session.horizon])]
    .toSorted((a, b) => a - b)
    .map((h) => ({ h, ...projectOutlook(cumulative, focus, rival, h) }));
  const required = requiredMean(cumulative, rival, session.horizon);
  const recentMean = distributionMean(recent[0]);
  const targetMean =
    required.maximumHundredths !== null ? rational(BigInt(required.maximumHundredths), 100n) : null;
  const improves = targetMean !== null && compareRationals(recentMean, targetMean) > 0;
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
    <div className="grid min-w-0 gap-6">
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
            <p className={contentText.body}>
              総合の平均順位 {people[role].averageRank.toFixed(2)}位
            </p>
          </div>
        ))}
        <p className={cn(contentText.supporting, "sm:col-span-2")}>
          人物を変更すると、2名とも直近の成績から試します。
          {selection.seasonMasterId
            ? "選んだシーズンに、この先の試合を加えた場合です。"
            : "作品総合に、この先の試合を加えた場合です。"}
        </p>
      </div>
      <section aria-labelledby="outlook-conclusion" className="grid gap-2">
        <h2 id="outlook-conclusion" className={contentText.heading}>
          {changed ? "試している成績が続くと" : `直近${response.recent.matchCount}戦の成績が続くと`}
        </h2>
        <p className={contentText.primary} aria-live="off">
          {conclusion}
        </p>
        {changed ? (
          <p className={contentText.supporting}>
            直近のままなら：{crossingLabel(baselineCrossing, names[0], names[1])}
          </p>
        ) : null}
        <p className={contentText.supporting}>
          これからの平均順位：{names[0]} {outlookAverage(distributionMean(focus))}位 / {names[1]}{" "}
          {outlookAverage(distributionMean(rival))}位
        </p>
        {session.notice ? (
          <p className={contentText.body} role="status">
            {session.notice}
          </p>
        ) : null}
      </section>
      <OutlookRequirements
        response={response}
        focusId={focusMemberId}
        cumulative={cumulative}
        session={session}
        change={change}
      />
      <section aria-label="成績を変えて見通しを比べる" className="grid min-w-0 gap-3">
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)]">
          <div className="grid min-w-0 content-start gap-3">
            <OutlookChart
              points={chartPoints}
              recent={recentPoints}
              examples={
                examples?.examples.map((example) => example.points.map((point) => point.gap)) ?? []
              }
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
              label="試合ごとのブレを重ねる"
              checked={session.noise}
              onChange={(event) => {
                const checked = event.target.checked;
                change((current) => ({ ...current, noise: checked }));
              }}
              description="試している2名の成績から作った、展開の異なる3例です。上限・下限や逆転の確率ではありません。"
            />
            {session.noise ? (
              <p className={contentText.supporting} role="status">
                {session.gesture
                  ? "操作を確定すると、ブレの例を更新します。"
                  : examples === null
                    ? "この条件のブレを計算できません。平均の見通しは引き続き使えます。"
                    : examples?.constantPerGameDifference
                      ? "この内訳では毎試合の差が一定になり、3本が重なります。"
                      : examples && examples.distinctCandidateCount < 3
                        ? `異なる展開は${examples.distinctCandidateCount}例のため、一部が重なっています。`
                        : "展開例1・2・3：100戦後の差が異なる例を選んでいます。途中で再び追い越される場合もあります。"}
              </p>
            ) : null}
          </div>
          <div className="grid min-w-0 content-start gap-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1" data-outlook-preserve-draft>
              {([0, 1] as const).map((role) => {
                const entry = session.entries[role];
                const pending = entry.countDraft !== undefined || entry.meanDraft !== undefined;
                return (
                  <div key={role} className="grid content-start gap-1">
                    <p className={contentText.heading}>
                      <MemberSequenceLabel memberId={ids[role]}>{names[role]}</MemberSequenceLabel>{" "}
                      · これからの平均順位 {outlookAverage(distributionMean(entry.distribution))}位
                    </p>
                    <p className={contentText.supporting}>
                      {outlookSourceLabel(entry.source, session.artifactId)}
                    </p>
                    {pending ? (
                      <div className="grid gap-1">
                        <p className={contentText.body}>
                          {names[role]}の{entry.countDraft ? "回数" : "平均"}
                          は入力中・まだ反映されていません。
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() =>
                              change((current) => ({
                                ...current,
                                editor: role,
                                method: entry.countDraft ? "counts" : "mean",
                              }))
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
                                  countDraft: undefined,
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
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div data-outlook-preserve-draft>
              <TabsRoot
                value={String(session.editor)}
                onValueChange={(value) =>
                  change((current) => ({ ...current, editor: Number(value) as OutlookRole }))
                }
              >
                <TabsList aria-label="調整する人" activateOnFocus={false}>
                  {names.map((name, role) => (
                    <TabsTab key={ids[role]} value={String(role)}>
                      {name}
                    </TabsTab>
                  ))}
                </TabsList>
                <TabsPanel value={String(session.editor)}>
                  <TabsRoot
                    value={session.method}
                    onValueChange={(value) =>
                      change((current) => ({ ...current, method: value as "mean" | "counts" }))
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
                      <div className="pt-3">
                        <OutlookEditor
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
            <div className="flex flex-wrap items-center gap-2" data-outlook-preserve-draft>
              <Button
                size="sm"
                variant="quiet"
                icon={<Undo2 />}
                disabled={
                  !session.history.length ||
                  Boolean(session.gesture) ||
                  session.entries.some((entry) => entry.countDraft !== undefined)
                }
                onClick={() => change(undoOutlook)}
              >
                元に戻す
              </Button>
              <Button
                size="sm"
                variant="quiet"
                disabled={Boolean(session.entries[session.editor].countDraft)}
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
          summary="指定した時点の数値と参照した実績"
          ariaLabel="指定した時点の数値と参照した実績"
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
        session={session}
        change={change}
      />
      <section
        className="grid gap-2"
        aria-labelledby="outlook-review-heading"
        data-outlook-preserve-draft
      >
        <h2 id="outlook-review-heading" className={contentText.heading}>
          {names[0]}の次の検討へ
        </h2>
        <p className={contentText.body}>
          {improves && targetMean
            ? `直近より平均順位を${formatRational(subtractRationals(recentMean, targetMean), 2)}位良くし、平均${formatRational(targetMean, 2)}位以下を${session.horizon}戦続けると上回ります。`
            : compareRationals(recentMean, required.threshold) < 0
              ? `直近の成績なら、${session.horizon}戦後も上回る条件を満たします。維持できた試合を振り返りましょう。`
              : "必要な改善と続ける試合数を変えながら、見直す手掛かりを探しましょう。"}
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
        <p className={contentText.supporting}>
          戦績一覧へは作品・シーズン・確定状態を引き継ぎます。人物・順位では絞り込みません。
        </p>
      </section>
    </div>
  );
}
