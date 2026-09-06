import { CircleHelp } from "lucide-react";

import { Button } from "@/shared/ui/actions/Button";
import { cn } from "@/shared/ui/cn";
import { FactList } from "@/shared/ui/data/FactList";
import { Dialog } from "@/shared/ui/feedback/Dialog";
import { contentText } from "@/shared/ui/typography";

export function SeriesAnalysisReviewHelpDialog() {
  return (
    <Dialog
      description="分類の扱い方と、信頼度が低い場合の注意を示します。"
      title="分類の読み方"
      trigger={
        <Button icon={<CircleHelp />} size="sm" variant="quiet">
          分類の読み方
        </Button>
      }
    >
      <div className="grid gap-6">
        <section>
          <h4 className={contentText.heading}>分類</h4>
          <div className="mt-2">
            <FactList
              ariaLabel="行動仮説の分類"
              layout="plain"
              items={[
                {
                  id: "reproduce",
                  label: "再現する",
                  value: "成績が伸びた条件を、今後の試合でも意識する候補です。",
                },
                {
                  id: "review",
                  label: "見直す",
                  value: "成績が崩れた条件を避けるため、行動を変える候補です。",
                },
                {
                  id: "verify",
                  label: "検証する",
                  value: "差は見えるものの、今後の試合で確かめる候補です。",
                },
              ]}
            />
          </div>
        </section>
        <section>
          <h4 className={contentText.heading}>信頼度が低い場合</h4>
          <p className={cn(contentText.body, "mt-2")}>
            「信頼度低め」と警告された候補は結論ではなく、試す価値のある仮説として扱います。
          </p>
        </section>
        <FactList
          ariaLabel="発動条件の読み方"
          layout="plain"
          items={[
            {
              id: "trigger",
              label: "発動条件",
              value: "自動検出や次戦予測ではなく、本人が次の試合で自己観察する場面です。",
            },
          ]}
        />
      </div>
    </Dialog>
  );
}
