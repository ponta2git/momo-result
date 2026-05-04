import type { ReactNode } from "react";
import { Component } from "react";

import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

type RouteErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
};

type RouteErrorBoundaryState = {
  error: Error | null;
  resetKey: string | undefined;
};

/**
 * ルート単位の ErrorBoundary。Suspense 配下の query エラーを `Notice`(danger) で表示し、
 * 再表示ボタンで境界を解除する。`resetKey`（例: pathname）が変わった場合も自動リセットする。
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  private readonly handleReset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      const normalized = normalizeUnknownApiError(this.state.error);
      const detail = normalized.detail || normalized.title || this.state.error.message;
      return (
        <main className="mx-auto max-w-3xl px-4 py-12" role="alert">
          <Notice tone="danger" title="画面の読み込みに失敗しました">
            <p className="text-sm">{detail}</p>
            <div className="mt-3">
              <Button onClick={this.handleReset} variant="secondary">
                もう一度読み込む
              </Button>
            </div>
          </Notice>
        </main>
      );
    }

    return this.props.children;
  }
}
