import { Link } from "react-router-dom";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

import { ExportCandidateSelect } from "./ExportCandidateSelect";
import { ExportFormatSegment } from "./ExportFormatSegment";
import { ExportScopeSelector } from "./ExportScopeSelector";
import { ExportTicket } from "./ExportTicket";
import type { ExportFormat, ExportScope } from "./exportTypes";
import type { ExportViewModel } from "./exportViewModel";

type ExportWorkspaceProps = {
  isPending: boolean;
  onCandidateChange: (value: string) => void;
  onDownload: () => void;
  onFormatChange: (format: ExportFormat) => void;
  onScopeChange: (scope: ExportScope) => void;
  view: ExportViewModel;
};

export function ExportWorkspace({
  isPending,
  onCandidateChange,
  onDownload,
  onFormatChange,
  onScopeChange,
  view,
}: ExportWorkspaceProps) {
  return (
    <PageFrame className="max-w-[70rem] gap-5">
      <PageHeader
        actions={
          <Link to="/matches">
            <Button variant="secondary">試合一覧へ戻る</Button>
          </Link>
        }
        description="確定済み試合を固定列順で書き出します。OCR中・確定前の作業は出力対象外です。"
        eyebrow="Export Gate"
        title="CSV / TSV 出力"
      />

      {view.errors.length > 0 ? (
        <Notice tone="danger" title="URLの出力条件を確認してください">
          {view.errors.join(" ")}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-start">
        <section className="momo-ui-surface grid gap-5 p-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">出力条件</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
              集計に渡す範囲切符を作ります。条件を変えるとURLも共有可能な形で更新されます。
            </p>
          </div>

          <div className="grid gap-5">
            <div className="grid gap-2">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">ファイル形式</p>
              <ExportFormatSegment
                disabled={isPending}
                format={view.format}
                onChange={onFormatChange}
              />
            </div>

            <div className="grid gap-2">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">出力範囲</p>
              <ExportScopeSelector
                disabled={isPending}
                scope={view.scope}
                onChange={onScopeChange}
              />
            </div>

            <ExportCandidateSelect
              disabled={isPending}
              scope={view.scope}
              view={view.candidate}
              onChange={onCandidateChange}
            />
          </div>
        </section>

        <ExportTicket isPending={isPending} view={view} onDownload={onDownload} />
      </div>
    </PageFrame>
  );
}
