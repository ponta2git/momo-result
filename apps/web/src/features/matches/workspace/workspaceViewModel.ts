import type { WorkspaceMode } from "@/features/matches/workspace/matchFormTypes";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { reviewStatusLabel } from "@/shared/domain/draftStatus";

export function buildWorkspacePageCopy(args: {
  mode: WorkspaceMode;
  reviewStatus: string | null | undefined;
}) {
  if (args.mode === "edit") {
    return {
      description: "確定済みの試合記録を編集します。保存後は一覧と出力に反映されます。",
      title: "試合を編集",
    };
  }
  if (args.mode === "review") {
    return {
      description: `読み取り結果を確認して、開催と4人分の結果を確定します。現在の状態: ${reviewStatusLabel(args.reviewStatus)}`,
      title: "OCR結果の確認",
    };
  }
  return {
    description: "開催と4人分の結果を入力して、確定前の確認へ進みます。",
    title: "試合の新規作成",
  };
}

export function latestHeldEventPatch(
  heldEvents: readonly HeldEventResponse[],
): { heldEventId: string; matchNoInEvent: number; playedAt: string } | undefined {
  const latest = heldEvents.toSorted(
    (left, right) => new Date(right.heldAt).getTime() - new Date(left.heldAt).getTime(),
  )[0];
  if (!latest) {
    return undefined;
  }
  return heldEventPatch(latest);
}

export function heldEventPatchById(
  heldEvents: readonly HeldEventResponse[],
  heldEventId: string | undefined,
): { heldEventId: string; matchNoInEvent: number; playedAt: string } | undefined {
  if (!heldEventId) {
    return undefined;
  }
  const heldEvent = heldEvents.find((event) => event.id === heldEventId);
  return heldEvent ? heldEventPatch(heldEvent) : undefined;
}

function heldEventPatch(heldEvent: HeldEventResponse): {
  heldEventId: string;
  matchNoInEvent: number;
  playedAt: string;
} {
  return {
    heldEventId: heldEvent.id,
    matchNoInEvent: heldEvent.nextMatchNo,
    playedAt: heldEvent.heldAt,
  };
}
