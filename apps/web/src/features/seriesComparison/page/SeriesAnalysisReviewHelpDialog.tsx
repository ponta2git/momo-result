import { CircleHelp } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { Dialog } from "@/shared/ui/feedback/Dialog";

export function SeriesAnalysisReviewHelpDialog() {
  return (
    <Dialog
      description="分類の扱い方と、信頼度が低い場合の注意を示します。"
      title="分類の読み方"
      trigger={
        <Button icon={<CircleHelp className="size-4" />} size="sm" variant="quiet">
          分類の読み方
        </Button>
      }
    >
      <div className="grid gap-4 text-sm leading-6">
        <section>
          <h4 className="font-semibold">分類</h4>
          <dl className="mt-2 grid gap-2">
            <HelpItem label="再現する" value="成績が伸びた条件を、次の4戦でも意識する候補です。" />
            <HelpItem label="見直す" value="成績が崩れた条件を避けるため、行動を変える候補です。" />
            <HelpItem label="検証する" value="差は見えるものの、まず次の4戦で確かめる候補です。" />
          </dl>
        </section>
        <section>
          <h4 className="font-semibold">信頼度が低い場合</h4>
          <p className="mt-2 text-[var(--color-text-secondary)]">
            「信頼度低め」と警告された候補は結論ではなく、試す価値のある仮説として扱います。
          </p>
        </section>
        <dl className="border-t border-[var(--color-border)] pt-3">
          <HelpItem
            label="発動条件"
            value="自動検出や次戦予測ではなく、本人が次の試合で自己観察する場面です。"
          />
        </dl>
      </div>
    </Dialog>
  );
}

function HelpItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[6rem_1fr]">
      <dt className="font-semibold">{label}</dt>
      <dd className="text-[var(--color-text-secondary)]">{value}</dd>
    </div>
  );
}
