import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MatchNoteNavigationGuard,
  MatchNoteRecovery,
  MatchNoteSection,
} from "@/features/matches/MatchNoteSection";
import { useMatchNoteEditor } from "@/features/matches/useMatchNoteEditor";
import type { MatchNoteCommit, MatchNoteReadResult } from "@/features/matches/useMatchNoteEditor";
import type { MatchDetailResponse } from "@/shared/api/matches";
import { setDevUser } from "@/test/auth";
import { createDeferred } from "@/test/deferred";
import { makeMatchDetail } from "@/test/factories";
import { setupMsw } from "@/test/msw/lifecycle";
import { server } from "@/test/msw/server";
import { createTestQueryClient } from "@/test/queryClient";

setupMsw();

function matchWithNote(body: string, version: string): MatchDetailResponse {
  return makeMatchDetail({
    note: {
      body,
      updatedAt: "2026-04-04T13:10:00.000Z",
      updatedByDisplayName: "ぽんた",
      version,
    },
  });
}

function renderNote({
  initialMatch = matchWithNote("保存済みメモ", "baseline"),
  latestMatch = matchWithNote("別の利用者のメモ", "latest"),
  readLatest = async (): Promise<MatchNoteReadResult> => ({ kind: "found", match: latestMatch }),
  commitSavedNote = async (): Promise<MatchNoteReadResult> => ({ kind: "failed" }),
}: {
  initialMatch?: MatchDetailResponse;
  latestMatch?: MatchDetailResponse;
  readLatest?: () => Promise<MatchNoteReadResult>;
  commitSavedNote?: (commit: MatchNoteCommit) => Promise<MatchNoteReadResult>;
} = {}) {
  function NoteRoute() {
    const [match, setMatch] = useState<MatchDetailResponse | undefined>(initialMatch);
    const editor = useMatchNoteEditor({
      matchId: initialMatch.matchId,
      match,
      readLatest,
      commitSavedNote: async (commit) => {
        // The real screen's cache callback owns this committed projection and its refresh.
        setMatch((current) =>
          current
            ? {
                ...current,
                note: {
                  ...(commit.body === undefined ? {} : { body: commit.body }),
                  version: commit.version,
                },
              }
            : undefined,
        );
        return commitSavedNote(commit);
      },
    });
    return (
      <>
        <MatchNoteNavigationGuard editor={editor} />
        <Link to="/next">後の試合</Link>
        <button onClick={() => setMatch(latestMatch)} type="button">
          別の取得結果を表示
        </button>
        <button onClick={() => setMatch(undefined)} type="button">
          試合の削除を検知
        </button>
        {match ? (
          <MatchNoteSection editor={editor} match={match} />
        ) : (
          <MatchNoteRecovery editor={editor} />
        )}
      </>
    );
  }
  const router = createMemoryRouter(
    [
      { path: "/matches/match-1", element: <NoteRoute /> },
      { path: "/next", element: <p>次の試合へ移動しました</p> },
      { path: "/origin", element: <p>起点へ戻りました</p> },
    ],
    { initialEntries: ["/origin", "/matches/match-1"], initialIndex: 1 },
  );
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

async function editNote(user: ReturnType<typeof userEvent.setup>, body = "編集中のメモ") {
  await user.click(screen.getByRole("button", { name: "編集" }));
  const input = screen.getByRole("textbox", { name: "試合メモ" });
  await user.clear(input);
  await user.type(input, body);
  return input;
}

describe("MatchNoteSection", () => {
  beforeEach(() => setDevUser());

  it("keeps the edit's body and expected version when a later detail arrives", async () => {
    const user = userEvent.setup();
    const commits: MatchNoteCommit[] = [];
    const requests: unknown[] = [];
    server.use(
      http.put("/api/matches/:matchId/note", async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ matchId: "match-1", version: "committed" });
      }),
    );
    renderNote({
      commitSavedNote: async (commit) => {
        commits.push(commit);
        return { kind: "failed" };
      },
    });

    const input = await editNote(user);
    expect(input).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "別の取得結果を表示" }));
    expect(input).toHaveValue("編集中のメモ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存しました");
    expect(requests).toEqual([{ body: "編集中のメモ", expectedVersion: "baseline" }]);
    expect(commits).toEqual([
      {
        matchId: "match-1",
        body: "編集中のメモ",
        expectedVersion: "baseline",
        version: "committed",
      },
    ]);
    expect(screen.getByText("編集中のメモ")).toBeInTheDocument();
    expect(screen.getByText("保存後の表示を更新できませんでした")).toBeInTheDocument();
    expect(screen.queryByText(/ぽんたが/u)).not.toBeInTheDocument();
  });

  it("keeps dirty text when navigation is cancelled and discards only on confirmation", async () => {
    const user = userEvent.setup();
    renderNote();
    await editNote(user);
    await user.click(screen.getByRole("link", { name: "後の試合" }));
    const dialog = await screen.findByRole("alertdialog", { name: "未保存の変更を破棄しますか？" });
    expect(dialog).not.toHaveTextContent("OCR");
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    expect(screen.getByRole("textbox", { name: "試合メモ" })).toHaveValue("編集中のメモ");
    await user.click(screen.getByRole("link", { name: "後の試合" }));
    await user.click(await screen.findByRole("button", { name: "破棄して移動" }));
    expect(await screen.findByText("次の試合へ移動しました")).toBeInTheDocument();
  });

  it.each(["save", "delete"] as const)(
    "blocks navigation during %s, then permits leaving while display refresh waits",
    async (operation) => {
      const user = userEvent.setup();
      const response = createDeferred();
      const display = createDeferred<MatchNoteReadResult>();
      server.use(
        http.put("/api/matches/:matchId/note", async () => {
          await response.promise;
          return HttpResponse.json({ matchId: "match-1", version: "committed" });
        }),
      );
      const router = renderNote({ commitSavedNote: () => display.promise });
      if (operation === "save") {
        await editNote(user);
        await user.click(screen.getByRole("button", { name: "保存" }));
      } else {
        await user.click(screen.getByRole("button", { name: "メモを削除" }));
        await user.click(await screen.findByRole("button", { name: "削除する" }));
      }

      await act(async () => {
        await router.navigate(-1);
      });
      const waiting = await screen.findByRole("dialog", { name: "処理結果を確認しています" });
      expect(waiting).not.toHaveTextContent("破棄して移動");
      expect(screen.queryByText("起点へ戻りました")).not.toBeInTheDocument();
      await user.click(within(waiting).getByRole("button", { name: "このページで待つ" }));
      await act(async () => response.resolve());
      await screen.findByText(operation === "save" ? "保存しました" : "メモを削除しました");
      expect(screen.getByText("メモの最新表示を確認しています。")).toBeInTheDocument();
      await user.click(screen.getByRole("link", { name: "後の試合" }));
      expect(await screen.findByText("次の試合へ移動しました")).toBeInTheDocument();
      await act(async () => display.resolve({ kind: "failed" }));
    },
  );

  it("preserves failed save input and retries the same version and idempotency key", async () => {
    const user = userEvent.setup();
    const requests: Array<{ body: unknown; key: string | null }> = [];
    server.use(
      http.put("/api/matches/:matchId/note", async ({ request }) => {
        requests.push({ body: await request.json(), key: request.headers.get("Idempotency-Key") });
        return requests.length === 1
          ? HttpResponse.json({ detail: "temporarily unavailable" }, { status: 500 })
          : HttpResponse.json({ matchId: "match-1", version: "committed" });
      }),
    );
    renderNote();
    await editNote(user);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "試合メモ" })).toHaveValue("編集中のメモ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("保存しました");
    expect(requests).toHaveLength(2);
    expect(requests[0]?.key).toBeTruthy();
    expect(requests[1]).toEqual(requests[0]);
  });

  it("does not label cached data as the latest note after conflict refresh fails", async () => {
    const user = userEvent.setup();
    const requests: unknown[] = [];
    server.use(
      http.put("/api/matches/:matchId/note", async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json(
          {
            code: "MATCH_NOTE_VERSION_CONFLICT",
            detail: "conflict",
            type: "about:blank",
            title: "Conflict",
            status: 409,
          },
          { status: 409 },
        );
      }),
    );
    renderNote({ readLatest: async () => ({ kind: "failed" }) });
    await editNote(user);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText(/最新版を取得できませんでした/u);
    expect(screen.queryByText("保存済みの最新版")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "試合メモ" })).toHaveValue("編集中のメモ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual({ body: "編集中のメモ", expectedVersion: "baseline" });
  });

  it("uses a fresh conflict version only after explicit retry", async () => {
    const user = userEvent.setup();
    const requests: unknown[] = [];
    server.use(
      http.put("/api/matches/:matchId/note", async ({ request }) => {
        requests.push(await request.json());
        return requests.length === 1
          ? HttpResponse.json(
              {
                code: "MATCH_NOTE_VERSION_CONFLICT",
                detail: "conflict",
                type: "about:blank",
                title: "Conflict",
                status: 409,
              },
              { status: 409 },
            )
          : HttpResponse.json({ matchId: "match-1", version: "committed" });
      }),
    );
    renderNote();
    await editNote(user);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("別の利用者のメモ");
    expect(requests).toEqual([{ body: "編集中のメモ", expectedVersion: "baseline" }]);
    await user.click(screen.getByRole("button", { name: "この入力で再試行" }));
    await screen.findByText("保存しました");
    expect(requests[1]).toEqual({ body: "編集中のメモ", expectedVersion: "latest" });
  });

  it("keeps only unsaved text after a 404 and protects it until copied or discarded", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderNote();
    await editNote(user);
    await user.click(screen.getByRole("button", { name: "試合の削除を検知" }));
    expect(screen.queryByText("保存済みメモ")).not.toBeInTheDocument();
    const recovered = screen.getByRole("textbox", { name: "退避した未保存の試合メモ" });
    expect(recovered).toHaveValue("編集中のメモ");
    expect(recovered).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "メモをコピー" }));
    await screen.findByText("未保存のメモをコピーしました。");
    expect(writeText).toHaveBeenCalledWith("編集中のメモ");
    await user.click(screen.getByRole("link", { name: "後の試合" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "キャンセル" }));
    await user.click(screen.getByRole("button", { name: "未保存のメモを破棄" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "後の試合" }));
    expect(await screen.findByText("次の試合へ移動しました")).toBeInTheDocument();
  });
});
