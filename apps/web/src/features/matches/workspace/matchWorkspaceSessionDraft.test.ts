import { describe, expect, it } from "vitest";

import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import {
  loadMatchWorkspaceSessionDraft,
  matchWorkspaceDraftFingerprint,
  matchWorkspaceSessionDraftKey,
  matchWorkspaceSessionDraftTtlMs,
  matchWorkspaceValuesFingerprint,
  parseMatchWorkspaceSessionDraft,
  saveMatchWorkspaceSessionDraft,
} from "@/features/matches/workspace/matchWorkspaceSessionDraft";

const values = createEmptyMatchForm("2026-08-03T12:00:00.000Z");
const scope = {
  accountId: "account_ponta",
  mode: "review" as const,
  workspaceKey: "draft/1",
};

describe("matchWorkspaceSessionDraft", () => {
  it("restores pending achievement selections with their concurrency versions and result baseline", () => {
    const editing = {
      ...values,
      expectedVersion: "12",
      initialResultFingerprint: "saved-result",
      achievements: [
        {
          achievementId: "achievement-1",
          achievementName: "手入力の実績",
          memberId: "member_ponta" as const,
          expectedItemVersion: "4",
          expectedClaimVersion: "2",
        },
      ],
    };
    const draft = {
      accountId: scope.accountId,
      acknowledgedCellIds: [],
      baselineFingerprint: "base",
      savedAt: new Date().toISOString(),
      values: editing,
      version: 2 as const,
    };
    expect(saveMatchWorkspaceSessionDraft(scope, draft)).toBe(true);
    expect(loadMatchWorkspaceSessionDraft(scope)?.values).toEqual(editing);
    expect(matchWorkspaceValuesFingerprint(editing, "edit")).not.toBe(
      matchWorkspaceValuesFingerprint({ ...editing, expectedVersion: "13" }, "edit"),
    );
  });

  it("round-trips a valid draft through session storage", () => {
    const key = matchWorkspaceSessionDraftKey(scope);
    const draft = {
      accountId: scope.accountId,
      acknowledgedCellIds: ["players.0.rank"],
      baselineFingerprint: matchWorkspaceValuesFingerprint(values, "review"),
      savedAt: new Date().toISOString(),
      values: {
        ...values,
        players: values.players.map((player, index) =>
          index === 0 ? { ...player, totalAssetsManYen: 12_345 } : player,
        ) as typeof values.players,
      },
      version: 2 as const,
    };

    expect(saveMatchWorkspaceSessionDraft(scope, draft)).toBe(true);
    expect(loadMatchWorkspaceSessionDraft(scope)).toEqual(draft);
    expect(key).toContain("draft%2F1");
    expect(key).toContain("matchWorkspaceDraft.v2.account_ponta");
  });

  it("rejects malformed or non-finite stored values", () => {
    expect(parseMatchWorkspaceSessionDraft("not-json", scope.accountId)).toBeNull();
    expect(
      parseMatchWorkspaceSessionDraft(
        JSON.stringify({
          accountId: scope.accountId,
          acknowledgedCellIds: [],
          baselineFingerprint: "baseline",
          savedAt: "2026-08-03T12:34:00.000Z",
          values: { ...values, matchNoInEvent: null },
          version: 2,
        }),
        scope.accountId,
      ),
    ).toBeNull();
  });

  it("isolates drafts by authenticated account even when workspace ids are equal", () => {
    const otherScope = { ...scope, accountId: "account_eu" };
    const draft = {
      accountId: scope.accountId,
      acknowledgedCellIds: [],
      baselineFingerprint: matchWorkspaceValuesFingerprint(values, "review"),
      savedAt: new Date().toISOString(),
      values,
      version: 2 as const,
    };

    expect(matchWorkspaceSessionDraftKey(otherScope)).not.toBe(
      matchWorkspaceSessionDraftKey(scope),
    );
    expect(saveMatchWorkspaceSessionDraft(scope, draft)).toBe(true);
    expect(loadMatchWorkspaceSessionDraft(otherScope)).toBeNull();
    expect(loadMatchWorkspaceSessionDraft({ ...scope, workspaceKey: "draft/2" })).toBeNull();
    expect(loadMatchWorkspaceSessionDraft({ ...scope, mode: "create" })).toBeNull();

    window.sessionStorage.setItem(matchWorkspaceSessionDraftKey(otherScope), JSON.stringify(draft));
    expect(loadMatchWorkspaceSessionDraft(otherScope)).toBeNull();
  });

  it("rejects expired, invalid, and future timestamps even for automatic recovery", () => {
    const now = Date.now();
    const serialized = (savedAt: string) =>
      JSON.stringify({
        accountId: scope.accountId,
        acknowledgedCellIds: [],
        baselineFingerprint: matchWorkspaceValuesFingerprint(values, "review"),
        resumeAutomatically: true,
        savedAt,
        values,
        version: 2,
      });
    expect(
      parseMatchWorkspaceSessionDraft(
        serialized(new Date(now - matchWorkspaceSessionDraftTtlMs).toISOString()),
        scope.accountId,
        now,
      ),
    ).not.toBeNull();
    for (const savedAt of [
      new Date(now - matchWorkspaceSessionDraftTtlMs - 1).toISOString(),
      new Date(now + 1).toISOString(),
      "invalid-date",
    ]) {
      expect(parseMatchWorkspaceSessionDraft(serialized(savedAt), scope.accountId, now)).toBeNull();
    }
  });

  it("discards legacy v1 drafts without attempting to restore them", () => {
    const legacyKey = "momoresult.matchWorkspaceDraft.v1.review.draft%2F1";
    window.sessionStorage.setItem(
      legacyKey,
      JSON.stringify({
        acknowledgedCellIds: [],
        baselineFingerprint: "legacy",
        savedAt: "2026-08-03T12:34:00.000Z",
        values,
        version: 1,
      }),
    );

    expect(loadMatchWorkspaceSessionDraft(scope)).toBeNull();
    expect(window.sessionStorage.getItem(legacyKey)).toBeNull();
  });

  it("treats edits and review acknowledgements as dirty state", () => {
    const baseline = matchWorkspaceDraftFingerprint({
      acknowledgedCellIds: [],
      mode: "review",
      values,
    });
    const changedValue = matchWorkspaceDraftFingerprint({
      acknowledgedCellIds: [],
      mode: "review",
      values: { ...values, matchNoInEvent: 2 },
    });
    const acknowledged = matchWorkspaceDraftFingerprint({
      acknowledgedCellIds: ["players.0.rank"],
      mode: "review",
      values,
    });

    expect(changedValue).not.toBe(baseline);
    expect(acknowledged).not.toBe(baseline);
  });

  it("keeps generated workspaces compatible across initial timestamps", () => {
    const laterValues = createEmptyMatchForm("2026-08-03T12:05:00.000Z");

    expect(matchWorkspaceValuesFingerprint(laterValues, "create")).toBe(
      matchWorkspaceValuesFingerprint(values, "create"),
    );
    expect(matchWorkspaceValuesFingerprint(laterValues, "review")).toBe(
      matchWorkspaceValuesFingerprint(values, "review"),
    );
    expect(matchWorkspaceValuesFingerprint(laterValues, "edit")).not.toBe(
      matchWorkspaceValuesFingerprint(values, "edit"),
    );
  });
});
