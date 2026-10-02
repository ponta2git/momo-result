import type {
  PlayerRadarAxisId,
  PlayerRadarBasis,
  PlayerRadarDisplay,
  PlayerRadarSample,
} from "@/shared/seriesAnalysis/playerRadarPresentation";
import type { SelectOption } from "@/shared/ui/forms/SelectControl";

export type PlayerRadarPreviewModel = {
  previewId: string;
  createdAt: string;
  evaluationState: "ready" | "loading" | "empty" | "awaiting_analysis" | "error";
  before: PlayerRadarDisplay | null;
  after: PlayerRadarDisplay | null;
  beforeBasis: PlayerRadarBasis | null;
  candidateBasis: PlayerRadarBasis;
};

export type PlayerRadarPreviewFilter = {
  seasonMasterId: string;
  mapMasterId: string;
  seasonOptions: SelectOption[];
  mapOptions: SelectOption[];
};

export type PlayerRadarApplyTarget = {
  gameTitleId: string;
  candidateId: string;
  previewId: string;
  expectedCurrentBasisId: string | null;
};

export type PlayerRadarAdminAction = {
  disabledReason: string | null;
  pending: boolean;
  run: () => Promise<void> | void;
};

export type PlayerRadarAdminModel = {
  gameTitleId: string;
  gameTitleName: string;
  currentBasis: PlayerRadarBasis | null;
  previousBasis: PlayerRadarBasis | null;
  eligibility: { matchCount: number; heldEventCount: number };
  candidate: {
    candidateId: string;
    status: "pending" | "ready" | "unavailable" | "invalid" | "withdrawn" | "applied" | "failed";
    source: PlayerRadarSample | null;
    basis: PlayerRadarBasis | null;
    failureMessage: string | null;
    unavailableAxes: ReadonlyArray<{ axisId: PlayerRadarAxisId; reason: string }>;
  } | null;
  preview: PlayerRadarPreviewModel | null;
  previewState: "none" | "pending" | "ready" | "stale" | "invalid" | "failed";
  previewFilter: PlayerRadarPreviewFilter;
  previewUpdating: boolean;
  operation: {
    operationId: string;
    status: "pending" | "running" | "succeeded" | "failed" | "withdrawn";
    kind: "candidate" | "preview" | "apply" | "withdraw" | "restore" | "acknowledge" | "retry";
    title: string;
    detail: string;
  } | null;
  review: {
    explanation: string | null;
    reasons: ReadonlyArray<{
      evidenceKey: string;
      label: string;
      acknowledged: boolean;
      evidence: ReadonlyArray<{ label: string; value: string }>;
    }>;
  };
  feedback: {
    title: string;
    detail: string;
    tone: "info" | "success" | "warning" | "danger";
  } | null;
  communicationUnknown: boolean;
  applyDisabledReason: string | null;
  applyPending: boolean;
  actions: {
    refresh: PlayerRadarAdminAction;
    generate: PlayerRadarAdminAction;
    rebuildPreview: PlayerRadarAdminAction;
    withdraw: PlayerRadarAdminAction;
    restore: PlayerRadarAdminAction;
    retry: PlayerRadarAdminAction;
    checkOperation: PlayerRadarAdminAction;
    apply: (target: PlayerRadarApplyTarget) => Promise<void>;
    acknowledge: (evidenceKey: string) => void;
    selectSeason: (value: string) => void;
    selectMap: (value: string) => void;
    resetPreviewFilter: () => void;
  };
};
