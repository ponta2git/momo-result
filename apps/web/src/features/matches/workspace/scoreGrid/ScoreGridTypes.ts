import type { KeyboardEvent } from "react";

import type { MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import type { EditablePlayerField } from "@/features/matches/workspace/matchWorkspaceEditing";
import type {
  MatchWorkspaceScoreRowView,
  WorkspaceSubscription,
} from "@/features/matches/workspace/matchWorkspaceEditingStore";
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
  errorPathSet: ReadonlySet<string>;
  validationFocusRequest?: { path: string; sequence: number } | null | undefined;
  rows: ReadonlyArray<WorkspaceSubscription<MatchWorkspaceScoreRowView>>;
  review: {
    acknowledgedCellIds: readonly string[];
    activeCellId: string | null;
    items: ReadonlyArray<Readonly<ReviewItem>>;
  };
};

export type ScoreGridActions = {
  onAcknowledgeReviewCell: (cellId: string) => void;
  onIncidentChange: (index: number, key: IncidentKey, value: number) => void;
  onNumericDraftChange: (path: string, value: string | undefined) => void;
  onPlayerChange: <K extends EditablePlayerField>(
    index: number,
    field: K,
    value: MatchFormValues["players"][number][K],
  ) => void;
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
