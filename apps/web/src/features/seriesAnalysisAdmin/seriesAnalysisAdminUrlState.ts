export function parseSeriesAnalysisAdminSearch(params: URLSearchParams) {
  const requestedTab = params.get("tab");
  return {
    gameTitleId: params.get("gameTitleId")?.trim() || undefined,
    activeTab: requestedTab === "radar" || requestedTab === "history" ? "radar" : "recalculation",
    radarView:
      requestedTab === "history" || params.get("radarView") === "history" ? "history" : "current",
    history: {
      gameTitleId: params.get("historyGameTitleId") || undefined,
      cursor: params.get("historyCursor") || undefined,
      revisionId: params.get("historyRevisionId") || undefined,
    },
  };
}

export type SeriesAnalysisAdminNavigation =
  | { kind: "title"; value: string }
  | { kind: "tab"; value: string }
  | { kind: "radarView"; value: string }
  | { kind: "historyList" }
  | { kind: "historyRevision"; value: string }
  | { kind: "historyTitle"; value: string }
  | { kind: "historyCursor"; value: string | undefined };

/** History filters stay independent from the title and scope of the threshold editor. */
export function updateSeriesAnalysisAdminSearch(
  params: URLSearchParams,
  action: SeriesAnalysisAdminNavigation,
) {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | undefined) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  switch (action.kind) {
    case "title":
      set("gameTitleId", action.value);
      break;
    case "tab":
      next.set("tab", action.value);
      break;
    case "radarView":
      next.set("tab", "radar");
      set("radarView", action.value === "history" ? "history" : undefined);
      break;
    case "historyList":
      next.delete("historyRevisionId");
      break;
    case "historyRevision":
      set("historyRevisionId", action.value);
      break;
    case "historyTitle":
      set("historyGameTitleId", action.value);
      next.delete("historyCursor");
      next.delete("historyRevisionId");
      break;
    case "historyCursor":
      set("historyCursor", action.value);
      break;
  }
  return { params: next, replace: action.kind === "title" };
}
