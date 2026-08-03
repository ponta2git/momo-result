import type { KeyboardEvent } from "react";

import type {
  MatchFormValues,
  OriginalPlayerSnapshot,
} from "@/features/matches/workspace/matchFormTypes";
import type { ReviewItem } from "@/features/matches/workspace/review/reviewProgress";
import type { ReviewFieldKey } from "@/features/matches/workspace/review/reviewWarningModel";
import type {
  IncidentNumericCommit,
  PlayerNumericCommit,
} from "@/features/matches/workspace/scoreGrid/ScoreGridNumericEditor";
import type { IncidentKey } from "@/shared/domain/incidents";

export type ScoreGridProps = {
  actions: ScoreGridActions;
  data: ScoreGridData;
};

export type ScoreGridData = {
  errorPathSet: Set<string>;
  lastSyncedPlayerIndex: number | null;
  originalPlayers: OriginalPlayerSnapshot[] | undefined;
  players: MatchFormValues["players"];
  review: {
    acknowledgedCellIds: string[];
    activeCellId: string | null;
    items: ReviewItem[];
  };
};

export type ScoreGridActions = {
  onAcknowledgeReviewCell: (cellId: string) => void;
  onIncidentChange: (index: number, key: IncidentKey, value: number) => void;
  onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
  onPlayOrderChange: (index: number, playOrder: number) => void;
  onPreferImageKindChange?: (kind: "incident_log" | "revenue" | "total_assets") => void;
  onRequestSubmitFocus: () => void;
  onReviewCellFocus: (row: number, field: ReviewFieldKey) => void;
};

export type ScoreGridKeyboardHandler = (args: {
  col: number;
  event: KeyboardEvent<HTMLElement>;
  onRevertCell: () => void;
  row: number;
}) => void;

export type ScoreGridCellRegistry = {
  getCellId: (row: number, col: number) => string;
  registerCellRef: (cellId: string, node: HTMLElement | null) => void;
};

export type ScoreGridNumericHandlers = {
  handleIncidentNumericCommit: IncidentNumericCommit;
  handlePlayerNumericCommit: PlayerNumericCommit;
};
