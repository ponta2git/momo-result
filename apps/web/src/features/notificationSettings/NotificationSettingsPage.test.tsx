import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { NotificationSettingsPage } from "@/features/notificationSettings/NotificationSettingsPage";
import type {
  NotificationSettings,
  NotificationSettingsUpdate,
} from "@/shared/api/notificationSettings";
import { notificationSettingsKeys } from "@/shared/api/queryKeys";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

const path = "/api/admin/notification-settings";
let queryClient: QueryClient;
let user: ReturnType<typeof userEvent.setup>;
let saved: NotificationSettings;

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationSettingsPage />
    </QueryClientProvider>,
  );
}

function problem(status: number, code: string) {
  return HttpResponse.json(
    { type: "about:blank", title: "Failed", detail: "private error", status, code },
    { status },
  );
}

async function chooseOcrOff() {
  await user.click(await screen.findByRole("checkbox", { name: "OCR完了" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  return screen.getByRole("alertdialog", { name: "通知をOFFにして保存しますか？" });
}

async function confirmOff() {
  await user.click(screen.getByRole("button", { name: "OFFにして保存" }));
}

describe("NotificationSettingsPage", () => {
  beforeEach(() => {
    queryClient = createTestQueryClient();
    user = userEvent.setup();
    setDevUser();
    saved = {
      ocrCompleted: { enabled: true, generation: "0" },
      analysisCompleted: { enabled: true, generation: "0" },
    };
    server.use(http.get(path, () => HttpResponse.json(structuredClone(saved))));
  });

  it("does not invent defaults before loading and renders the confirmed values", async () => {
    const loaded = createDeferred();
    saved.ocrCompleted.enabled = false;
    server.use(
      http.get(path, async () => {
        await loaded.promise;
        return HttpResponse.json(saved);
      }),
    );
    renderPage();
    expect(screen.getByRole("status", { name: "通知設定を読み込み中" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await act(async () => loaded.resolve());
    expect(await screen.findByRole("checkbox", { name: "OCR完了" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "分析完了" })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("saves both choices only after confirmation, with exact generations and one pending request", async () => {
    const committed = createDeferred();
    const submissions: Array<{
      body: NotificationSettingsUpdate;
      key: string | null;
      csrf: string | null;
    }> = [];
    saved.ocrCompleted.generation = "9007199254740993";
    server.use(
      http.put(path, async ({ request }) => {
        submissions.push({
          body: (await request.json()) as NotificationSettingsUpdate,
          key: request.headers.get("Idempotency-Key"),
          csrf: request.headers.get("X-CSRF-Token"),
        });
        await committed.promise;
        saved = {
          ocrCompleted: { enabled: false, generation: "9007199254740994" },
          analysisCompleted: { enabled: false, generation: "1" },
        };
        return HttpResponse.json(saved);
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "OCR完了" }));
    await user.click(screen.getByRole("checkbox", { name: "分析完了" }));
    expect(submissions).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "保存" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(submissions).toHaveLength(0);
    expect(screen.getByRole("checkbox", { name: "OCR完了" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await confirmOff();
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(screen.getByLabelText("OCR完了")).toBeDisabled();
    expect(screen.getByLabelText("分析完了")).toBeDisabled();
    expect(screen.queryByText("通知設定を保存しました。")).not.toBeInTheDocument();
    expect(submissions[0]).toEqual({
      body: {
        ocrCompleted: { enabled: false, expectedGeneration: "9007199254740993" },
        analysisCompleted: { enabled: false, expectedGeneration: "0" },
      },
      key: expect.any(String),
      csrf: "dev",
    });
    await act(async () => committed.resolve());
    expect(await screen.findByText("通知設定を保存しました。")).toBeInTheDocument();
    expect(screen.getAllByText("保存済み：OFF")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("keeps controls unavailable on initial failure and can reload", async () => {
    server.use(http.get(path, () => problem(503, "DEPENDENCY_FAILED")));
    renderPage();
    expect(await screen.findByText("通知設定を読み込めません")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    server.use(http.get(path, () => HttpResponse.json(saved)));
    await user.click(screen.getByRole("button", { name: "現在の設定を読み込む" }));
    expect(await screen.findByRole("checkbox", { name: "OCR完了" })).toBeChecked();
  });

  it("retains a rejected form and reuses its idempotency key for the same retry", async () => {
    const submissions: string[] = [];
    server.use(
      http.put(path, ({ request }) => {
        submissions.push(request.headers.get("Idempotency-Key") ?? "");
        if (submissions.length === 1) return problem(429, "TOO_MANY_REQUESTS");
        saved.ocrCompleted = { enabled: false, generation: "1" };
        return HttpResponse.json(saved);
      }),
    );
    renderPage();
    await chooseOcrOff();
    await confirmOff();
    expect(await screen.findByText(/保存できませんでした/u)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "OCR完了" })).not.toBeChecked();
    expect(screen.getAllByText("保存済み：ON")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await confirmOff();
    expect(await screen.findByText("通知設定を保存しました。")).toBeInTheDocument();
    expect(submissions).toHaveLength(2);
    expect(submissions[0]).toBeTruthy();
    expect(submissions[1]).toBe(submissions[0]);
  });

  it("reconciles an unknown committed outcome without claiming failure or silently retrying", async () => {
    server.use(
      http.put(path, () => {
        saved.ocrCompleted = { enabled: false, generation: "1" };
        return HttpResponse.error();
      }),
    );
    renderPage();
    await chooseOcrOff();
    await confirmOff();
    expect(await screen.findByText(/保存結果を確認できません/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getAllByText("保存済み：ON")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "現在の設定を読み込んで選び直す" }));
    expect(await screen.findByText("保存済み：OFF")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "OCR完了" })).not.toBeChecked();
    expect(screen.queryByText("未保存の変更があります")).not.toBeInTheDocument();
  });

  it("keeps the edit's original generations when cache changes, then requires explicit conflict resolution", async () => {
    const submissions: NotificationSettingsUpdate[] = [];
    server.use(
      http.put(path, async ({ request }) => {
        submissions.push((await request.json()) as NotificationSettingsUpdate);
        return problem(409, "NOTIFICATION_SETTINGS_VERSION_CONFLICT");
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "OCR完了" }));
    saved.analysisCompleted = { enabled: false, generation: "1" };
    act(() => {
      queryClient.setQueryData(notificationSettingsKeys.all(), structuredClone(saved));
    });
    expect(screen.getByRole("checkbox", { name: "分析完了" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await confirmOff();
    expect(await screen.findByText(/通知設定が別の画面で更新されています/u)).toBeInTheDocument();
    expect(submissions).toEqual([
      {
        ocrCompleted: { enabled: false, expectedGeneration: "0" },
        analysisCompleted: { enabled: true, expectedGeneration: "0" },
      },
    ]);
    await user.click(screen.getByRole("button", { name: "現在の設定を読み込んで選び直す" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "OCR完了" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "分析完了" })).not.toBeChecked();
  });

  it("reports a saved mutation separately from a failed refresh", async () => {
    server.use(
      http.put(path, () => {
        saved.ocrCompleted = { enabled: false, generation: "1" };
        server.use(http.get(path, () => problem(503, "DEPENDENCY_FAILED")));
        return HttpResponse.json(saved);
      }),
    );
    renderPage();
    await chooseOcrOff();
    await confirmOff();
    expect(await screen.findByText("通知設定を保存しました。")).toBeInTheDocument();
    expect(await screen.findByText("現在の設定を確認できません")).toBeInTheDocument();
    expect(screen.getByText("保存済み：OFF")).toBeInTheDocument();
    expect(screen.queryByText(/保存できませんでした/u)).not.toBeInTheDocument();
  });
});
