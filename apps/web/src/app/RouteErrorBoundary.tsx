import type { ReactNode } from "react";
import { Component } from "react";

import { RouteTerminalPage } from "@/app/RouteTerminalPage";
import { normalizeUnknownApiError } from "@/shared/api/problemDetails";
import { isModuleLoadError, reloadCurrentPage } from "@/shared/lib/moduleLoadError";
import { Button } from "@/shared/ui/actions/Button";
import { Notice } from "@/shared/ui/feedback/Notice";

type RouteErrorBoundaryProps = {
  children: ReactNode;
  onReset?: (() => void) | undefined;
  pathname: string;
  search?: string | undefined;
};

type RouteErrorBoundaryState = {
  error: Error | null;
  pathname: string;
};

/**
 * アプリのルート単位の ErrorBoundary。通常の query / render エラーは境界を解除して再試行し、
 * 同じ React.lazy type では回復できない module 読み込み失敗だけは画面全体を再読み込みする。
 * pathname が変わった場合も自動リセットする。
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { error: null, pathname: props.pathname };
  }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    if (props.pathname !== state.pathname) {
      return { error: null, pathname: props.pathname };
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
        <RouteTerminalPage
          pathname={this.props.pathname}
          search={this.props.search}
          title="画面の読み込みに失敗しました"
        >
          <Notice
            action={
              <Button onClick={this.handleRecovery}>
                {reloadRequired ? "画面を再読み込み" : "もう一度読み込む"}
              </Button>
            }
            role="alert"
            tone="danger"
          >
            <p className="momo-break-token text-sm">{detail}</p>
          </Notice>
        </RouteTerminalPage>
      );
    }

    return this.props.children;
  }
}
