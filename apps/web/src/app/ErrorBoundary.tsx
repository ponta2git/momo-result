import type { ReactNode } from "react";
import { Component } from "react";

import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageFrame } from "@/shared/ui/layout/PageFrame";

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

  override render() {
    if (this.state.error) {
      return (
        <main className="px-4 py-10 sm:py-16">
          <PageFrame width="narrow">
            <Notice className="p-4" role="alert" tone="danger" title="画面を表示できません">
              <p>
                予期しない問題が発生しました。再表示しても直らない場合は、時間をおいてから開き直してください。
              </p>
              <div className="mt-3">
                <Button variant="secondary" onClick={() => this.setState({ error: null })}>
                  画面を再表示
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
