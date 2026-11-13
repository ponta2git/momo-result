import { AlertTriangle } from "lucide-react";

import type { MatchWorkspaceConfirmationDialogView } from "@/features/matches/workspace/matchWorkspacePanelViews";
import type { HeldEventResponse } from "@/shared/api/heldEvents";
import { formatMatchNoInEvent } from "@/shared/domain/matchLabels";
import { memberDisplayName, orderFixedMembers } from "@/shared/domain/members";
import { formatDateTimeLong } from "@/shared/lib/dateTime";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { RankBadge } from "@/shared/matches/RankBadge";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { DataTable } from "@/shared/ui/data/DataTable";
import { FactList } from "@/shared/ui/data/FactList";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { Notice } from "@/shared/ui/feedback/Notice";
import { contentText } from "@/shared/ui/typography";

type MatchConfirmSummaryProps = {
  gameTitleName?: string | undefined;
  heldEvent: HeldEventResponse | undefined;
  mapName?: string | undefined;
  seasonName?: string | undefined;
};

function ConfirmActionButtons({ onCancel, pending }: { onCancel: () => void; pending: boolean }) {
  return (
    <DialogFooter>
      <Button variant="secondary" disabled={pending} onClick={onCancel} type="button">
        戻って修正
      </Button>
      <Button pending={pending} pendingLabel="確定中…" type="submit">
        確定する
      </Button>
    </DialogFooter>
  );
}

function MatchConfirmSummary({
  gameTitleName,
  heldEvent,
  mapName,
  seasonName,
  values,
}: MatchConfirmSummaryProps & { values: MatchWorkspaceConfirmationDialogView["values"] }) {
  return (
    <FactList
      ariaLabel="確定する試合の開催条件"
      items={[
        {
          id: "held-event",
          label: "開催",
          value: heldEvent ? formatDateTimeLong(heldEvent.heldAt) : "未選択",
        },
        {
          id: "match-no",
          label: "試合番号",
          value: formatMatchNoInEvent(values.matchNoInEvent),
        },
        ...(values.playedAt
          ? [{ id: "played-at", label: "対戦日時", value: formatDateTimeLong(values.playedAt) }]
          : []),
        { id: "game-title", label: "作品", value: gameTitleName ?? "未選択" },
        { id: "season", label: "シーズン", value: seasonName ?? "未選択" },
        { id: "map", label: "マップ", value: mapName ?? "未選択" },
      ]}
      columns={2}
      layout="plain"
    />
  );
}

function PlayerLedger({ values }: { values: MatchWorkspaceConfirmationDialogView["values"] }) {
  return (
    <DataTable
      caption={{ content: "確定する4人分の結果" }}
      columns={[
        { key: "rank", header: "順位", renderCell: (player) => <RankBadge rank={player.rank} /> },
        {
          key: "member",
          header: "メンバー",
          rowHeader: true,
          renderCell: (player) => (
            <MemberSequenceLabel memberId={player.memberId}>
              {memberDisplayName(player.memberId)}
            </MemberSequenceLabel>
          ),
        },
        {
          key: "assets",
          header: "総資産（万円）",
          align: "right",
          tabular: true,
          renderCell: (player) => (
            <span className={contentText.compactPrimary}>
              {player.totalAssetsManYen.toLocaleString("ja-JP")}
            </span>
          ),
        },
        {
          key: "revenue",
          header: "収益（万円）",
          align: "right",
          tabular: true,
          renderCell: (player) => player.revenueManYen.toLocaleString("ja-JP"),
        },
      ]}
      density="compact"
      getRowKey={(player) => player.memberId}
      minWidth="29rem"
      rows={orderFixedMembers(values.players)}
    />
  );
}

/**
 * The dialog confirms the conditions and the four results. Of the OCR review it only carries the
 * one caution that can change the decision: readings still unconfirmed against the source image.
 */
function UnresolvedReadingsCaution({ unresolvedCount }: { unresolvedCount: number }) {
  if (unresolvedCount === 0) return null;
  return (
    <p className={cn(contentText.body, "flex gap-2 text-pretty")}>
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]"
      />
      <span>
        未確認の読み取りが{unresolvedCount}
        件あります。このまま確定できますが、元画像との照合をおすすめします。
      </span>
    </p>
  );
}

export function MatchConfirmDialog({ view }: { view: MatchWorkspaceConfirmationDialogView }) {
  return (
    <Dialog
      busy={view.pending}
      open
      title="この内容で確定しますか？"
      onOpenChange={(open) => {
        if (!open) {
          view.actions.onClose();
        }
      }}
    >
      <form action={view.actions.onConfirm} className="grid min-w-0 gap-6">
        <MatchConfirmSummary {...view.summary} values={view.values} />
        <PlayerLedger values={view.values} />
        {view.values.achievements?.length ? (
          <section aria-label="今回記録する実績" className="grid gap-2">
            <h3 className={contentText.heading}>今回記録する実績</h3>
            <ul className="grid gap-1">
              {view.values.achievements.map((entry) => (
                <li key={`${entry.achievementId}:${entry.memberId}`} className={contentText.body}>
                  {entry.achievementName}・{memberDisplayName(entry.memberId)}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {view.values.noteBody.trim().length > 0 ? (
          <section aria-labelledby="confirm-match-note-heading" className="grid gap-2">
            <h3 className={contentText.heading} id="confirm-match-note-heading">
              試合メモ
            </h3>
            <p className={cn(contentText.body, "break-words whitespace-pre-wrap")}>
              {view.values.noteBody}
            </p>
          </section>
        ) : null}
        <UnresolvedReadingsCaution unresolvedCount={view.review.unresolvedCount} />

        {view.feedback.validationMessage ? (
          <Notice presentation="nested" role="alert" tone="warning">
            {view.feedback.validationMessage}
          </Notice>
        ) : null}

        <ConfirmActionButtons pending={view.pending} onCancel={view.actions.onClose} />
      </form>
    </Dialog>
  );
}
