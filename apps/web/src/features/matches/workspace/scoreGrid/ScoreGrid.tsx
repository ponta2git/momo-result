import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { fixedMembers } from "@/features/auth/members";
import type { IncidentLookupEntry, ReviewPlayer } from "@/features/draftReview/reviewViewModel";
import { incidentColumns } from "@/features/matches/workspace/matchFormTypes";
import type { IncidentKey, MatchFormValues } from "@/features/matches/workspace/matchFormTypes";
import { handleScoreGridKeydown } from "@/features/matches/workspace/scoreGrid/ScoreGridKeyboard";
import { useMediaQuery } from "@/shared/lib/useMediaQuery";

type GridColumn =
  | "memberId"
  | "playOrder"
  | "rank"
  | "totalAssetsManYen"
  | "revenueManYen"
  | `incident.${IncidentKey}`;

const gridColumns: GridColumn[] = [
  "memberId",
  "playOrder",
  "rank",
  "totalAssetsManYen",
  "revenueManYen",
  ...incidentColumns.map(([key]) => `incident.${key}` as const),
];

const baseInputClass =
  "w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 text-sm text-[var(--color-text-primary)] transition-colors duration-150 hover:bg-[var(--color-surface-subtle)]";
const textNumericShortClass = `${baseInputClass} min-w-[6ch] text-center tabular-nums`;
const textNumericClass = `${baseInputClass} min-w-[12ch] text-right tabular-nums`;
const selectShortClass = `${baseInputClass} min-w-[6ch] text-center`;
const memberSelectClass = `${baseInputClass} min-w-[10rem]`;

function memberName(memberId: string): string {
  return fixedMembers.find((member) => member.memberId === memberId)?.displayName ?? memberId;
}

type CellViewState = {
  label?: string;
  toneClass: string;
};

function cellViewState(args: {
  confidence: number | null | undefined;
  currentValue: number;
  error: boolean;
  originalValue: number | undefined;
  synced: boolean;
}): CellViewState {
  if (args.error) {
    return {
      label: "要確認",
      toneClass: "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10",
    };
  }

  if (args.synced) {
    return {
      label: "同期済み",
      toneClass: "border-[var(--color-action)]/55 bg-[var(--color-action)]/10",
    };
  }

  if (args.originalValue !== undefined && args.currentValue !== args.originalValue) {
    return {
      label: "手修正",
      toneClass: "border-[var(--color-warning)]/65 bg-[var(--color-warning)]/18",
    };
  }

  return {
    toneClass: "",
  };
}

function normalizeNumericDraft(input: string, allowSign: boolean): string {
  if (input.trim() === "") {
    return "";
  }

  if (allowSign && input === "-") {
    return input;
  }

  const sign = allowSign && input.startsWith("-") ? "-" : "";
  const rest = sign ? input.slice(1) : input;
  const digits = rest.replaceAll(/\D/gu, "");

  if (!digits) {
    return sign;
  }

  return `${sign}${digits.replace(/^0+(?=\d)/u, "")}`;
}

function parseNumericValue(value: string, allowSign: boolean): number {
  if (value.trim() === "" || value === "-") {
    return Number.NaN;
  }

  if (allowSign) {
    return /^-?\d+$/u.test(value) ? Number(value) : Number.NaN;
  }

  return /^\d+$/u.test(value) ? Number(value) : Number.NaN;
}

function keyToPath(row: number, column: GridColumn): string {
  if (column.startsWith("incident.")) {
    return `players.${row}.incidents.${column.replace("incident.", "")}`;
  }
  return `players.${row}.${column}`;
}

function preferImageKind(column: GridColumn): "incident_log" | "revenue" | "total_assets" {
  if (column === "revenueManYen") {
    return "revenue";
  }
  if (column.startsWith("incident.")) {
    return "incident_log";
  }
  return "total_assets";
}

type ScoreGridProps = {
  errorPathSet: Set<string>;
  incidentByPlayOrder: Map<number, IncidentLookupEntry> | undefined;
  lastSyncedPlayerIndex: number | null;
  onIncidentChange: (index: number, key: IncidentKey, value: number) => void;
  onPlayerChange: (index: number, patch: Partial<MatchFormValues["players"][number]>) => void;
  onPlayOrderChange: (index: number, playOrder: number) => void;
  onPreferImageKindChange?: (kind: "incident_log" | "revenue" | "total_assets") => void;
  onRequestSubmitFocus: () => void;
  originalPlayers: ReviewPlayer[] | undefined;
  players: MatchFormValues["players"];
};

export function ScoreGrid({
  errorPathSet,
  incidentByPlayOrder,
  lastSyncedPlayerIndex,
  onIncidentChange,
  onPlayerChange,
  onPlayOrderChange,
  onPreferImageKindChange,
  onRequestSubmitFocus,
  originalPlayers,
  players,
}: ScoreGridProps) {
  const [expandedMobilePlayer, setExpandedMobilePlayer] = useState(0);
  const isNarrowViewport = useMediaQuery("(max-width: 1023px)");
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});
  const editStartByCell = useRef(new Map<string, string>());
  const inputRefs = useRef(new Map<string, HTMLElement>());

  const originalByPlayOrder = useMemo(() => {
    if (!originalPlayers) {
      return new Map<number, ReviewPlayer>();
    }
    return new Map(originalPlayers.map((player) => [player.playOrder, player]));
  }, [originalPlayers]);

  const getCellId = (row: number, col: number) => `player-${row}-${gridColumns[col]}`;

  const focusCell = (cellId: string) => {
    const next = inputRefs.current.get(cellId);
    if (next) {
      next.focus();
    }
  };

  const updateDraft = (cellId: string, value: string) => {
    setDraftInputs((current) => ({
      ...current,
      [cellId]: value,
    }));
  };

  const clearDraft = (cellId: string) => {
    setDraftInputs((current) => {
      if (!(cellId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[cellId];
      return next;
    });
  };

  const handleKeyboard = (args: {
    col: number;
    event: KeyboardEvent<HTMLElement>;
    onRevertCell: () => void;
    row: number;
  }) => {
    const target = args.event.currentTarget;

    if (args.event.key === "ArrowLeft" || args.event.key === "ArrowRight") {
      const delta = args.event.key === "ArrowLeft" ? -1 : 1;
      const nextCol = args.col + delta;
      if (nextCol >= 0 && nextCol < gridColumns.length) {
        const isSelect = target instanceof HTMLSelectElement;
        const isInputSelectedAll =
          target instanceof HTMLInputElement &&
          target.selectionStart === 0 &&
          target.selectionEnd === target.value.length;

        if (isSelect || isInputSelectedAll) {
          args.event.preventDefault();
          focusCell(getCellId(args.row, nextCol));
          return;
        }
      }
    }

    handleScoreGridKeydown({
      colCount: gridColumns.length,
      event: args.event,
      getCellId: ({ col, row }) => getCellId(row, col),
      horizontalEnterFromCol: 5,
      onFocusCell: focusCell,
      onRevertCell: args.onRevertCell,
      onSubmitFocus: onRequestSubmitFocus,
      position: { col: args.col, row: args.row },
      rowCount: players.length,
    });
  };

  const renderNumericCell = (args: {
    allowSign: boolean;
    col: number;
    field: "rank" | "revenueManYen" | "totalAssetsManYen";
    row: number;
    viewState: CellViewState;
  }) => {
    const player = players[args.row];
    if (!player) {
      return null;
    }
    const cellId = getCellId(args.row, args.col);
    const rawValue = player[args.field];
    const fallbackValue = Number.isFinite(rawValue) ? String(rawValue) : "";
    const draftValue = draftInputs[cellId] ?? fallbackValue;

    return (
      <>
        <input
          ref={(node) => {
            if (node) {
              inputRefs.current.set(cellId, node);
            } else {
              inputRefs.current.delete(cellId);
            }
          }}
          aria-label={`${memberName(player.memberId)} ${args.field}`}
          className={`${args.field === "rank" ? textNumericShortClass : textNumericClass} ${args.viewState.toneClass}`}
          inputMode="numeric"
          type="text"
          value={draftValue}
          onBlur={() => {
            const parsed = parseNumericValue(draftValue, args.allowSign);
            onPlayerChange(args.row, { [args.field]: parsed } as Partial<
              MatchFormValues["players"][number]
            >);
            if (!Number.isNaN(parsed)) {
              clearDraft(cellId);
            }
          }}
          onChange={(event) => {
            const normalized = normalizeNumericDraft(event.target.value, args.allowSign);
            updateDraft(cellId, normalized);
            onPlayerChange(args.row, {
              [args.field]: parseNumericValue(normalized, args.allowSign),
            } as Partial<MatchFormValues["players"][number]>);
          }}
          onFocus={() => {
            editStartByCell.current.set(cellId, draftValue);
            if (args.field !== "rank") {
              const column = gridColumns[args.col];
              if (column) {
                onPreferImageKindChange?.(preferImageKind(column));
              }
            }
          }}
          onKeyDown={(event) =>
            handleKeyboard({
              col: args.col,
              event,
              onRevertCell: () => {
                const before = editStartByCell.current.get(cellId) ?? fallbackValue;
                updateDraft(cellId, before);
                const parsed = parseNumericValue(before, args.allowSign);
                onPlayerChange(args.row, {
                  [args.field]: parsed,
                } as Partial<MatchFormValues["players"][number]>);
              },
              row: args.row,
            })
          }
        />
        {args.viewState.label ? (
          <p className="mt-1 text-[0.68rem] text-[var(--color-text-secondary)]">
            {args.viewState.label}
          </p>
        ) : null}
      </>
    );
  };

  const renderIncidentCell = (
    row: number,
    incidentKey: IncidentKey,
    col: number,
    viewState: CellViewState,
  ) => {
    const player = players[row];
    if (!player) {
      return null;
    }
    const cellId = getCellId(row, col);
    const fallbackValue = Number.isFinite(player.incidents[incidentKey])
      ? String(player.incidents[incidentKey])
      : "";
    const draftValue = draftInputs[cellId] ?? fallbackValue;

    return (
      <>
        <input
          ref={(node) => {
            if (node) {
              inputRefs.current.set(cellId, node);
            } else {
              inputRefs.current.delete(cellId);
            }
          }}
          aria-label={`${memberName(player.memberId)} ${incidentKey}`}
          className={`${textNumericShortClass} ${viewState.toneClass}`}
          inputMode="numeric"
          type="text"
          value={draftValue}
          onBlur={() => {
            const parsed = parseNumericValue(draftValue, false);
            onIncidentChange(row, incidentKey, parsed);
            if (!Number.isNaN(parsed)) {
              clearDraft(cellId);
            }
          }}
          onChange={(event) => {
            const normalized = normalizeNumericDraft(event.target.value, false);
            updateDraft(cellId, normalized);
            onIncidentChange(row, incidentKey, parseNumericValue(normalized, false));
          }}
          onFocus={() => {
            editStartByCell.current.set(cellId, draftValue);
            onPreferImageKindChange?.("incident_log");
          }}
          onKeyDown={(event) =>
            handleKeyboard({
              col,
              event,
              onRevertCell: () => {
                const before = editStartByCell.current.get(cellId) ?? fallbackValue;
                updateDraft(cellId, before);
                onIncidentChange(row, incidentKey, parseNumericValue(before, false));
              },
              row,
            })
          }
        />
        {viewState.label ? (
          <p className="mt-1 text-[0.68rem] text-[var(--color-text-secondary)]">
            {viewState.label}
          </p>
        ) : null}
      </>
    );
  };

  const grid = (
    <table className="min-w-[64rem] table-fixed border-separate border-spacing-y-2 text-left text-sm">
      <colgroup>
        <col className="w-[10rem]" />
        <col className="w-[7ch]" />
        <col className="w-[7ch]" />
        <col className="w-[12ch]" />
        <col className="w-[12ch]" />
        {incidentColumns.map(([, label]) => (
          <col key={label} className="w-[7ch]" />
        ))}
      </colgroup>
      <thead className="text-xs text-[var(--color-text-secondary)]">
        <tr>
          <th className="sticky left-0 z-[var(--z-dropdown)] bg-[var(--color-surface)] px-2 py-2">
            メンバー
          </th>
          <th className="px-2 py-2">順</th>
          <th className="px-2 py-2">順位</th>
          <th className="px-2 py-2">総資産</th>
          <th className="px-2 py-2">収益</th>
          {incidentColumns.map(([, label]) => (
            <th key={label} className="px-2 py-2">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {players.map((player, rowIndex) => {
          const incidentLookup = incidentByPlayOrder?.get(player.playOrder);
          const originalRow = originalPlayers?.[rowIndex];
          const originalByOrder = originalByPlayOrder.get(player.playOrder);
          return (
            <tr key={player.memberId} className="bg-[var(--color-surface-subtle)]">
              <td className="sticky left-0 z-[var(--z-sticky)] rounded-l-[var(--radius-md)] bg-[var(--color-surface-subtle)] px-2 py-3 align-top">
                <select
                  ref={(node) => {
                    const cellId = getCellId(rowIndex, 0);
                    if (node) {
                      inputRefs.current.set(cellId, node);
                    } else {
                      inputRefs.current.delete(cellId);
                    }
                  }}
                  aria-label={`${memberName(player.memberId)} memberId`}
                  className={memberSelectClass}
                  value={player.memberId}
                  onChange={(event) => {
                    onPlayerChange(rowIndex, {
                      memberId: event.target
                        .value as MatchFormValues["players"][number]["memberId"],
                    });
                  }}
                  onKeyDown={(event) =>
                    handleKeyboard({
                      col: 0,
                      event,
                      onRevertCell: () => undefined,
                      row: rowIndex,
                    })
                  }
                >
                  {fixedMembers.map((member) => (
                    <option key={member.memberId} value={member.memberId}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </td>

              <td className="px-2 py-3 align-top">
                {(() => {
                  const cellId = getCellId(rowIndex, 1);
                  return (
                    <select
                      ref={(node) => {
                        if (node) {
                          inputRefs.current.set(cellId, node);
                        } else {
                          inputRefs.current.delete(cellId);
                        }
                      }}
                      aria-label={`${memberName(player.memberId)} playOrder`}
                      className={`${selectShortClass} ${
                        errorPathSet.has(keyToPath(rowIndex, "playOrder"))
                          ? "border-[var(--color-danger)]/65 bg-[var(--color-danger)]/10"
                          : ""
                      }`}
                      value={Number.isFinite(player.playOrder) ? String(player.playOrder) : ""}
                      onChange={(event) =>
                        onPlayOrderChange(rowIndex, Number.parseInt(event.target.value, 10))
                      }
                      onFocus={() => onPreferImageKindChange?.("incident_log")}
                      onKeyDown={(event) =>
                        handleKeyboard({
                          col: 1,
                          event,
                          onRevertCell: () => undefined,
                          row: rowIndex,
                        })
                      }
                    >
                      <option value="">-</option>
                      {[1, 2, 3, 4].map((order) => (
                        <option key={order} value={order}>
                          {order}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </td>

              <td className="px-2 py-3 align-top">
                {renderNumericCell({
                  allowSign: false,
                  col: 2,
                  field: "rank",
                  row: rowIndex,
                  viewState: cellViewState({
                    confidence: originalRow?.confidence.rank,
                    currentValue: player.rank,
                    error: errorPathSet.has(keyToPath(rowIndex, "rank")),
                    originalValue: originalRow?.rank,
                    synced: false,
                  }),
                })}
              </td>

              <td className="px-2 py-3 align-top">
                {renderNumericCell({
                  allowSign: true,
                  col: 3,
                  field: "totalAssetsManYen",
                  row: rowIndex,
                  viewState: cellViewState({
                    confidence: originalRow?.confidence.totalAssets,
                    currentValue: player.totalAssetsManYen,
                    error: errorPathSet.has(keyToPath(rowIndex, "totalAssetsManYen")),
                    originalValue: originalRow?.totalAssetsManYen,
                    synced: false,
                  }),
                })}
              </td>

              <td className="px-2 py-3 align-top">
                {renderNumericCell({
                  allowSign: true,
                  col: 4,
                  field: "revenueManYen",
                  row: rowIndex,
                  viewState: cellViewState({
                    confidence: originalRow?.confidence.revenue,
                    currentValue: player.revenueManYen,
                    error: errorPathSet.has(keyToPath(rowIndex, "revenueManYen")),
                    originalValue: originalRow?.revenueManYen,
                    synced: false,
                  }),
                })}
              </td>

              {incidentColumns.map(([incidentKey, incidentLabel], incidentIndex) => {
                const col = incidentIndex + 5;
                const incidentState = cellViewState({
                  confidence: incidentLookup?.confidence[incidentLabel],
                  currentValue: player.incidents[incidentKey],
                  error: errorPathSet.has(
                    keyToPath(rowIndex, `incident.${incidentKey}` as GridColumn),
                  ),
                  originalValue: originalByOrder?.incidents[incidentLabel],
                  synced: lastSyncedPlayerIndex === rowIndex,
                });
                return (
                  <td
                    key={incidentKey}
                    className="px-2 py-3 align-top last:rounded-r-[var(--radius-md)]"
                  >
                    {renderIncidentCell(rowIndex, incidentKey, col, incidentState)}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            4人分の結果を確認・修正
          </h2>
          <p className="mt-1 text-sm text-pretty text-[var(--color-text-secondary)]">
            Enterキーと矢印キーで移動できます。Escキーで編集中のセルを元に戻せます。
          </p>
        </div>
      </div>

      {isNarrowViewport ? null : <div className="mt-4 overflow-x-auto pb-2">{grid}</div>}

      {isNarrowViewport ? (
        <div className="mt-4 grid gap-3">
          {players.map((player, index) => (
            <article
              key={player.memberId}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <button
                className="flex w-full items-center justify-between text-left"
                type="button"
                onClick={() =>
                  setExpandedMobilePlayer((current) => (current === index ? -1 : index))
                }
              >
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {memberName(player.memberId)}
                </span>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {expandedMobilePlayer === index ? "閉じる" : "詳細"}
                </span>
              </button>
              {expandedMobilePlayer === index ? (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
                      プレー順
                      <select
                        className={selectShortClass}
                        value={Number.isFinite(player.playOrder) ? String(player.playOrder) : ""}
                        onChange={(event) =>
                          onPlayOrderChange(index, Number.parseInt(event.target.value, 10))
                        }
                      >
                        <option value="">-</option>
                        {[1, 2, 3, 4].map((order) => (
                          <option key={order} value={order}>
                            {order}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
                      順位
                      <input
                        className={textNumericShortClass}
                        inputMode="numeric"
                        type="text"
                        value={Number.isFinite(player.rank) ? String(player.rank) : ""}
                        onChange={(event) =>
                          onPlayerChange(index, {
                            rank: parseNumericValue(
                              normalizeNumericDraft(event.target.value, false),
                              false,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
                    総資産
                    <input
                      className={textNumericClass}
                      inputMode="numeric"
                      type="text"
                      value={
                        Number.isFinite(player.totalAssetsManYen)
                          ? String(player.totalAssetsManYen)
                          : ""
                      }
                      onFocus={() => onPreferImageKindChange?.("total_assets")}
                      onChange={(event) =>
                        onPlayerChange(index, {
                          totalAssetsManYen: parseNumericValue(
                            normalizeNumericDraft(event.target.value, true),
                            true,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-[var(--color-text-secondary)]">
                    収益
                    <input
                      className={textNumericClass}
                      inputMode="numeric"
                      type="text"
                      value={
                        Number.isFinite(player.revenueManYen) ? String(player.revenueManYen) : ""
                      }
                      onFocus={() => onPreferImageKindChange?.("revenue")}
                      onChange={(event) =>
                        onPlayerChange(index, {
                          revenueManYen: parseNumericValue(
                            normalizeNumericDraft(event.target.value, true),
                            true,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {incidentColumns.map(([incidentKey, incidentLabel]) => (
                      <label
                        key={incidentKey}
                        className="grid gap-1 text-xs text-[var(--color-text-secondary)]"
                      >
                        {incidentLabel}
                        <input
                          className={textNumericShortClass}
                          inputMode="numeric"
                          type="text"
                          value={
                            Number.isFinite(player.incidents[incidentKey])
                              ? String(player.incidents[incidentKey])
                              : ""
                          }
                          onFocus={() => onPreferImageKindChange?.("incident_log")}
                          onChange={(event) =>
                            onIncidentChange(
                              index,
                              incidentKey,
                              parseNumericValue(
                                normalizeNumericDraft(event.target.value, false),
                                false,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
