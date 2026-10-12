import type { Page } from "@playwright/test";

import type { SeriesPlayerRadarCommand } from "../../src/shared/api/seriesPlayerRadar";
import type { PlayerRadarRevisionDetail } from "../../src/shared/api/seriesPlayerRadarHistory";
import { createDeferred } from "../../src/test/deferred";
import {
  makePlayerRadarBasis,
  makePlayerRadarOperation,
  makePlayerRadarPreview,
  makeReadyPlayerRadarState,
} from "../../src/test/msw/playerRadarFixtures";
import {
  makeSeriesAnalysisAdminOverview,
  makeSeriesAnalysisOptions,
  makeSeriesAnalysisStatus,
} from "../../src/test/msw/seriesAnalysisFixtures";

/** Wire responses are controlled here; these browser tests do not validate worker scoring. */
export async function installRadarResponses(page: Page) {
  const state = makeReadyPlayerRadarState();
  const preview = makePlayerRadarPreview();
  const overview = makeSeriesAnalysisAdminOverview();
  const historyTitleId = "radar-history-other-title";
  overview.titleOptions.push({
    gameTitleId: historyTitleId,
    gameTitleName: "履歴確認用の別作品",
    confirmedMatchCount: 40,
  });
  const detail: PlayerRadarRevisionDetail = {
    schemaVersion: 1,
    revision: {
      revisionId: "radar-browser-revision",
      gameTitleId: historyTitleId,
      gameTitleName: "履歴確認用の別作品",
      kind: "manual",
      appliedAt: "2026-10-12T00:00:00Z",
      appliedBy: { accountId: "radar-applying-operator", displayName: "適用時の担当者" },
      savedBy: { accountId: "radar-saving-operator", displayName: "保存時の担当者" },
      beforeBasisId: "radar-history-before",
      afterBasisId: "radar-history-after",
      sourceBasisId: "radar-history-before",
      sourceCandidateId: null,
    },
    beforeBasis: makePlayerRadarBasis().basis,
    afterBasis: makePlayerRadarBasis().basis,
  };
  detail.afterBasis.axes[0].thresholds[0] = 4.123456789123;
  const commands: SeriesPlayerRadarCommand[] = [];
  const historyQueries: URLSearchParams[] = [];
  const withdrawal = createDeferred();
  const withdrawalStarted = createDeferred();
  const expectedInput = {
    axes: makePlayerRadarBasis().basis.axes.map(({ axisId, thresholds }) => ({
      axisId,
      thresholds: [...thresholds],
    })),
  };
  const averageRank = expectedInput.axes.find((axis) => axis.axisId === "averageRank");
  if (!averageRank) throw new Error("The radar browser fixture requires average rank boundaries");
  averageRank.thresholds[0] = 4.95;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/admin/series-analysis/radar/operations" && request.method() === "POST") {
      const command: SeriesPlayerRadarCommand = request.postDataJSON();
      commands.push(command);
      if (command.kind === "manual") {
        const candidate = state.candidate;
        if (
          !candidate?.result?.basis ||
          !candidate.latestPreview ||
          !command.manualInput?.axes ||
          !state.currentBasis
        )
          throw new Error("The manual browser fixture requires a current basis and six axes");
        const manualInput = {
          axes: command.manualInput.axes.map((axis) => {
            if (!axis.thresholds || axis.thresholds.length !== 9)
              throw new Error("The manual browser fixture requires all nine thresholds");
            return { axisId: axis.axisId, thresholds: [...axis.thresholds] };
          }),
        };
        candidate.candidateId = "radar-browser-manual-candidate";
        candidate.basisId = "radar-browser-manual-basis";
        candidate.originKind = "manual";
        candidate.manualInput = manualInput;
        candidate.sourceBasisId = state.currentBasis.basisId;
        candidate.sourceCandidateId = null;
        candidate.sourceBasis = state.currentBasis;
        candidate.savedBy = { accountId: "account_ponta", displayName: "保存時の担当者" };
        for (const axis of manualInput.axes) {
          const result = candidate.result.basis.axes.find((entry) => entry.axisId === axis.axisId);
          if (result)
            axis.thresholds.forEach((threshold, index) => {
              result.thresholds[index] = threshold;
            });
        }
        candidate.latestPreview = {
          ...candidate.latestPreview,
          previewId: "radar-browser-manual-preview",
        };
        preview.previewId = candidate.latestPreview.previewId;
        preview.candidateId = candidate.candidateId;
        preview.candidateBasisId = candidate.basisId;
        // Moving the 2-point cutoff from 4.9 to 4.95 changes none of the fixture scores.
        // Keep the independent saved evaluation instead of computing it with UI code.
        const operation = {
          ...makePlayerRadarOperation("manual"),
          operationId: "radar-browser-manual-operation",
          candidateId: candidate.candidateId,
          basisId: candidate.basisId,
          previewId: preview.previewId,
          status: "succeeded" as const,
        };
        state.operations = [operation];
        await route.fulfill({ status: 202, json: operation });
      } else if (command.kind === "withdraw") {
        withdrawalStarted.resolve();
        await withdrawal.promise;
        const operation = {
          ...makePlayerRadarOperation("withdraw"),
          operationId: "radar-browser-withdraw-operation",
          candidateId: state.candidate?.candidateId ?? null,
          originOperationId: command.originOperationId ?? null,
          status: "succeeded" as const,
        };
        if (state.candidate) state.candidate.status = "withdrawn";
        state.operations = [operation];
        await route.fulfill({ status: 202, json: operation });
      } else if (command.kind === "apply") {
        const operation = {
          ...makePlayerRadarOperation("apply"),
          operationId: "radar-browser-apply-operation",
          candidateId: state.candidate?.candidateId ?? null,
          previewId: preview.previewId,
          basisId: preview.candidateBasisId,
        };
        state.operations = [operation];
        await route.fulfill({ status: 202, json: operation });
      } else {
        throw new Error(`Unexpected radar browser command: ${command.kind}`);
      }
      return;
    }
    if (request.method() !== "GET") return route.fallback();
    if (path === "/api/admin/series-analysis/radar/revisions") {
      historyQueries.push(url.searchParams);
      await route.fulfill({
        json: { schemaVersion: 1, items: [detail.revision], nextCursor: null },
      });
    } else if (
      path === `/api/admin/series-analysis/radar/revisions/${detail.revision.revisionId}`
    ) {
      await route.fulfill({ json: detail });
    } else if (path === "/api/admin/series-analysis/radar") {
      await route.fulfill({ json: state });
    } else if (path === "/api/admin/series-analysis/radar/preview") {
      await route.fulfill({ json: preview });
    } else if (path === "/api/admin/series-analysis/overview") {
      await route.fulfill({ json: overview });
    } else if (path === "/api/analytics/series-comparison/v2/options") {
      await route.fulfill({ json: makeSeriesAnalysisOptions() });
    } else if (path === "/api/analytics/series-comparison/v2/status") {
      await route.fulfill({ json: makeSeriesAnalysisStatus() });
    } else {
      await route.fallback();
    }
  });

  return {
    gameTitleId: state.gameTitleId,
    historyTitleId,
    expectedInput,
    commands,
    historyQueries,
    withdrawalStarted: withdrawalStarted.promise,
    finishWithdrawal: () => withdrawal.resolve(),
  };
}
