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

describe("matchWorkspaceSessionDraft", () => {
  it("round-trips a valid draft through session storage", () => {
    const key = matchWorkspaceSessionDraftKey({ mode: "review", workspaceKey: "draft/1" });
    const draft = {
      acknowledgedCellIds: ["players.0.rank"],
      baselineFingerprint: matchWorkspaceValuesFingerprint(values, "review"),
      savedAt: "2026-08-03T12:34:00.000Z",
      values: {
        ...values,
        players: values.players.map((player, index) =>
          index === 0 ? { ...player, totalAssetsManYen: 12_345 } : player,
        ) as typeof values.players,
      },
      version: 1 as const,
    };

    expect(saveMatchWorkspaceSessionDraft(key, draft)).toBe(true);
    expect(loadMatchWorkspaceSessionDraft(key)).toEqual(draft);
    expect(key).toContain("draft%2F1");
  });

  it("rejects malformed or non-finite stored values", () => {
    expect(parseMatchWorkspaceSessionDraft("not-json")).toBeNull();
    expect(
      parseMatchWorkspaceSessionDraft(
        JSON.stringify({
          acknowledgedCellIds: [],
          baselineFingerprint: "baseline",
          savedAt: "2026-08-03T12:34:00.000Z",
          values: { ...values, matchNoInEvent: null },
          version: 1,
        }),
      ),
    ).toBeNull();
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
