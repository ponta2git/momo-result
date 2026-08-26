import type { ReactNode } from "react";
import { Component } from "react";

import { isModuleLoadError, reloadCurrentPage } from "@/shared/lib/moduleLoadError";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  private readonly handleRecovery = () => {
    if (isModuleLoadError(this.state.error)) {
      reloadCurrentPage();
      return;
    }

    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      const reloadRequired = isModuleLoadError(this.state.error);
      return (
        <main className="px-4 py-10 sm:py-16">
          <PageFrame width="narrow">
            <PageHeader title="画面を表示できません" />
            <Notice className="p-4" role="alert" tone="danger">
              <p>
                {reloadRequired
                  ? "画面を構成するファイルを取得できませんでした。通信状態を確認して、画面全体を再読み込みしてください。"
                  : "予期しない問題が発生しました。再表示しても直らない場合は、時間をおいてから開き直してください。"}
              </p>
              <div className="mt-3">
                <Button onClick={this.handleRecovery}>
                  {reloadRequired ? "画面を再読み込み" : "画面を再表示"}
                </Button>
              </div>
            </Notice>
          </PageFrame>
        </main>
      );
    }

    return this.props.children;
  }
}
