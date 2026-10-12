import type { RadarManualInput } from "@/features/seriesAnalysisAdmin/radarThresholdInput";
import type {
  PlayerRadarBasis,
  PlayerRadarDisplay,
} from "@/shared/seriesAnalysis/playerRadarPresentation";

export type RadarEditingSource = {
  label: string;
  basis: PlayerRadarBasis;
  input: RadarManualInput;
  sourceBasisId: string;
  sourceCandidateId: string | null;
  expectedCurrentBasisId: string | null;
  expectedCandidateId: string | null;
  savedCandidateId: string | null;
};

export type RadarManualSave = {
  expectedCurrentBasisId: string | null;
  expectedCandidateId: string | null;
  sourceBasisId: string;
  sourceCandidateId: string | null;
  manualInput: RadarManualInput;
};

export type RadarEditingModel = {
  acceptedSave?: { candidateId: string; request: RadarManualSave } | null;
  current: RadarEditingSource | null;
  candidate: RadarEditingSource | null;
  evaluation: {
    key: string;
    before: PlayerRadarDisplay | null;
    raw: PlayerRadarDisplay;
    createdAt: string;
  } | null;
  evaluationMessage: string | null;
  evaluationUpdating: boolean;
  permissionReason: string | null;
  saveDisabledReason: string | null;
  onActiveChange: (active: boolean) => void;
  save: (request: RadarManualSave) => Promise<string>;
  reuseCandidate: (candidateId: string) => Promise<void>;
};
