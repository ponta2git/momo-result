import type { ReactNode } from "react";
import { Component } from "react";

import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { isModuleLoadError, reloadCurrentPage } from "@/shared/lib/moduleLoadError";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";
import { PageContentSurface } from "@/shared/ui/layout/PageContentSurface";
import { PageFrame } from "@/shared/ui/layout/PageFrame";
import { PageHeader } from "@/shared/ui/layout/PageHeader";

type RouteErrorBoundaryProps = {
  children: ReactNode;
  onReset?: (() => void) | undefined;
  resetKey?: string;
};

type RouteErrorBoundaryState = {
  error: Error | null;
  resetKey: string | undefined;
};

/**
 * アプリのルート単位の ErrorBoundary。通常の query / render エラーは境界を解除して再試行し、
 * 同じ React.lazy type では回復できない module 読み込み失敗だけは画面全体を再読み込みする。
 * `resetKey`（例: pathname）が変わった場合も自動リセットする。
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

  private readonly handleRecovery = () => {
    if (isModuleLoadError(this.state.error)) {
      reloadCurrentPage();
      return;
    }

    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      const reloadRequired = isModuleLoadError(this.state.error);
      const normalized = normalizeUnknownApiError(this.state.error);
      const detail = reloadRequired
        ? "画面を構成するファイルを取得できませんでした。通信状態を確認して、画面全体を再読み込みしてください。"
        : normalized.detail || normalized.title || this.state.error.message;
      return (
        <PageFrame className="py-8 sm:py-12" width="narrow">
          <PageHeader title="画面の読み込みに失敗しました" />
          <PageContentSurface>
            <Notice className="p-4" role="alert" tone="danger">
              <p className="momo-break-token text-sm">{detail}</p>
              <div className="mt-3">
                <Button onClick={this.handleRecovery}>
                  {reloadRequired ? "画面を再読み込み" : "もう一度読み込む"}
                </Button>
              </div>
            </Notice>
          </PageContentSurface>
        </PageFrame>
      );
    }

    return this.props.children;
  }
}
