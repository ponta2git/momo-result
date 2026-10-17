import type { CumulativePair } from "@/features/seriesComparison/outlook/calculation";
import { OutlookEditor } from "@/features/seriesComparison/outlook/OutlookEditor";
import type { OutlookRole } from "@/features/seriesComparison/outlook/outlookWorkspaceState";
import { useOutlookPlayerEditor } from "@/features/seriesComparison/outlook/useOutlookPlayerEditor";
import type { SeriesAnalysisOutlookSummary } from "@/shared/api/seriesAnalysis";
import { MemberSequenceLabel } from "@/shared/matches/MemberSequenceLabel";
import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { Dialog, DialogFooter } from "@/shared/ui/feedback/Dialog";
import { contentText } from "@/shared/ui/typography";

type Props = {
  response: SeriesAnalysisOutlookSummary;
  cumulative: CumulativePair;
  role: OutlookRole;
  names: readonly [string, string];
  memberIds: readonly [string, string];
  showComparison?: boolean;
};

/** A named player's condition stays next to both ways of changing it. */
export function OutlookPlayerEditor(props: Props) {
  const { response, cumulative, role, names, memberIds, showComparison = false } = props;
  const playerEditor = useOutlookPlayerEditor({
    response,
    cumulative,
    role,
    names,
    memberId: memberIds[role],
    showComparison,
  });
  const { editor, dialog } = playerEditor;
  const proposal = dialog.proposal;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-2" aria-label={`${names[role]}の成績を試す`}>
      <h3 className={cn(contentText.heading, "flex items-center")}>
        <MemberSequenceLabel memberId={memberIds[role]}>{names[role]}</MemberSequenceLabel>
      </h3>
      <p
        className={contentText.supporting}
        aria-label={`${names[role]}の${editor.hasBaseline ? "比較基準" : "直近の平均"}`}
      >
        {editor.hasBaseline ? "残した平均" : "直近の平均"} {editor.baselineMean}位
      </p>
      <OutlookEditor
        view={editor}
        role={role}
        method="mean"
        name={names[role]}
        label="これからの平均順位"
        edit={playerEditor.edit}
      />
      <div className="grid gap-1">
        <p className={contentText.supporting} aria-label={`${names[role]}の直近からの差`}>
          {editor.outdated ? "更新前の成績 · " : ""}
          {editor.differenceLabel}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="quiet"
            disabled={editor.unchanged}
            aria-label={`${names[role]}を直近の成績に戻す`}
            onClick={playerEditor.resetRecent}
          >
            直近に戻す
          </Button>
          <Dialog
            open={dialog.open}
            onOpenChange={dialog.setOpen}
            title={`${proposal?.name ?? names[role]}の順位の回数を変える`}
            trigger={
              <Button variant="quiet" size="sm" aria-label={`${names[role]}を順位の回数で設定`}>
                回数で設定
              </Button>
            }
          >
            {proposal ? (
              <div className="grid min-w-0 grid-cols-1 gap-4">
                <p className={contentText.supporting}>{proposal.sourceLabel}</p>
                <OutlookEditor
                  key={proposal.editorVersion}
                  view={proposal.editor}
                  role={proposal.role}
                  method="counts"
                  name={proposal.name}
                  edit={dialog.edit}
                />
                <div
                  className="grid gap-2 border-t border-[var(--color-border)] pt-4"
                  aria-label="この回数を続けた結果"
                >
                  <p className={contentText.heading}>
                    {proposal.name}の平均：{proposal.average}位
                  </p>
                  <p className={contentText.body}>{proposal.outcome.headline}</p>
                  {proposal.outcome.detail ? (
                    <p className={contentText.supporting}>{proposal.outcome.detail}</p>
                  ) : null}
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={!proposal.canUndo}
                    onClick={dialog.undo}
                  >
                    回数の変更を戻す
                  </Button>
                </div>
                {proposal.stale ? (
                  <p className={contentText.body} role="status">
                    実績または比較する人が変わりました。閉じて、現在の条件から設定し直してください。
                  </p>
                ) : null}
                <DialogFooter data-outlook-preserve-draft>
                  <Button variant="quiet" onClick={() => dialog.setOpen(false)}>
                    キャンセル
                  </Button>
                  <Button
                    variant="primary"
                    aria-disabled={!proposal.canApply || undefined}
                    onClick={dialog.apply}
                  >
                    この回数を使う
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
          </Dialog>
        </div>
      </div>
    </section>
  );
}
