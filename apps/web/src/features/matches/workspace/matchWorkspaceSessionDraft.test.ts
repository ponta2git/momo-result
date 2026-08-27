import { describe, expect, it } from "vitest";

import { createEmptyMatchForm } from "@/features/matches/workspace/matchFormTypes";
import {
  loadMatchWorkspaceSessionDraft,
  matchWorkspaceDraftFingerprint,
  matchWorkspaceSessionDraftKey,
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
  it("round-trips a valid draft through session storage", () => {
    const key = matchWorkspaceSessionDraftKey(scope);
    const draft = {
      accountId: scope.accountId,
      acknowledgedCellIds: ["players.0.rank"],
      baselineFingerprint: matchWorkspaceValuesFingerprint(values, "review"),
      savedAt: "2026-08-03T12:34:00.000Z",
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
      savedAt: "2026-08-03T12:34:00.000Z",
      values,
      version: 2 as const,
    };

    expect(matchWorkspaceSessionDraftKey(otherScope)).not.toBe(
      matchWorkspaceSessionDraftKey(scope),
    );
    expect(saveMatchWorkspaceSessionDraft(scope, draft)).toBe(true);
    expect(loadMatchWorkspaceSessionDraft(otherScope)).toBeNull();

    window.sessionStorage.setItem(matchWorkspaceSessionDraftKey(otherScope), JSON.stringify(draft));
    expect(loadMatchWorkspaceSessionDraft(otherScope)).toBeNull();
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
