import type { PlayerRadarAdminModel } from "@/features/seriesAnalysisAdmin/radar/playerRadarAdminTypes";
import { radarBasisInput } from "@/features/seriesAnalysisAdmin/radar/radarThresholdInput";
import {
  playerRadarBasisDisplay,
  playerRadarEvaluationDisplay,
} from "@/shared/seriesAnalysis/playerRadarDisplay";
import { makePlayerRadarBasis, makePlayerRadarEvaluation } from "@/test/msw/playerRadarFixtures";

const action = () => ({ disabledReason: null, pending: false, run: () => {} });

export function makePlayerRadarEditorModel(): PlayerRadarAdminModel {
  const basis = playerRadarBasisDisplay(makePlayerRadarBasis(), []);
  const display = playerRadarEvaluationDisplay(makePlayerRadarEvaluation(), basis, []);
  return {
    gameTitleId: "gt_momotetsu_2",
    gameTitleName: "桃太郎電鉄2",
    currentBasis: basis,
    previousBasis: null,
    candidate: null,
    eligibility: { matchCount: 40, heldEventCount: 8 },
    preview: null,
    previewState: "none",
    previewUpdating: false,
    previewFilter: {
      seasonMasterId: "",
      mapMasterId: "",
      seasonOptions: [{ label: "全期間", value: "" }],
      mapOptions: [{ label: "全マップ", value: "" }],
    },
    operation: null,
    review: { explanation: null, reasons: [] },
    feedback: null,
    communicationUnknown: false,
    applyDisabledReason: "有効な変更案が必要です。",
    applyPending: false,
    editing: {
      current: {
        label: "適用中の基準",
        basis,
        input: radarBasisInput(basis),
        sourceBasisId: basis.basisId,
        sourceCandidateId: null,
        expectedCurrentBasisId: basis.basisId,
        expectedCandidateId: null,
        savedCandidateId: null,
      },
      candidate: null,
      evaluation: {
        key: "saved-evaluation",
        before: display,
        raw: display,
        createdAt: "2026-10-12T00:00:00Z",
      },
      evaluationMessage: null,
      evaluationUpdating: false,
      permissionReason: null,
      saveDisabledReason: null,
      onActiveChange: () => {},
      save: async () => ({ candidateId: "saved-candidate", operationId: "saved-operation" }),
      discard: async () => {},
      reuseCandidate: async () => {},
    },
    actions: {
      refresh: action(),
      generate: action(),
      rebuildPreview: action(),
      withdraw: action(),
      restore: action(),
      retry: action(),
      checkOperation: action(),
      apply: async () => {},
      acknowledge: () => {},
      selectSeason: () => {},
      selectMap: () => {},
      resetPreviewFilter: () => {},
    },
  };
}
