import type { ReactNode } from "react";
import { Component } from "react";

import { Button } from "@/shared/ui/actions/Button";

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
        <main className="mx-auto max-w-3xl px-6 py-16">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 p-8 shadow-sm">
            <p className="text-sm font-semibold text-[var(--color-danger)]">予期しないエラー</p>
            <h1 className="mt-3 text-2xl font-bold">画面を表示できませんでした</h1>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              もう一度表示しても直らない場合は、時間をおいて再度お試しください。
            </p>
            <Button className="mt-6" onClick={() => this.setState({ error: null })}>
              もう一度表示する
            </Button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
