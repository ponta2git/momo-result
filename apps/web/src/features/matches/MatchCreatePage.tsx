import { Link } from "react-router-dom";

import { EmptyState } from "@/shared/ui/feedback/EmptyState";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

const linkClass =
  "inline-flex min-h-10 items-center justify-center rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold transition-colors duration-150";

export function MatchCreatePage() {
  return (
    <PageFrame>
      <PageHeader
        title="試合の新規作成"
        description="手入力の新規作成は次タスクで実装します。現在はOCR取り込みまたは既存試合の確認を利用してください。"
      />
      <EmptyState
        title="新規作成は準備中です"
        description="先に /matches と /ocr/new を統合した導線を整備しています。"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              className={`${linkClass} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)]`}
              to="/matches"
            >
              試合一覧へ戻る
            </Link>
            <Link
              className={`${linkClass} border-[var(--color-action)] bg-[var(--color-action)] text-white hover:bg-[#205f92]`}
              to="/ocr/new"
            >
              OCR登録へ進む
            </Link>
          </div>
        }
      />
    </PageFrame>
  );
}
