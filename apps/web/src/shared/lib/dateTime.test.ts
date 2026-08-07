import { describe, expect, it } from "vitest";

import {
  formatDateOnly,
  formatDateTimeCompact,
  formatDateTimeLong,
  toIsoFromLocalDateTime,
  toLocalDateTimeInputValue,
} from "@/shared/lib/dateTime";

describe("shared date-time formatting", () => {
  const localDate = new Date(2026, 0, 2, 3, 4);

  it("uses one long, compact, and date-only Japanese format", () => {
    expect(formatDateTimeLong(localDate)).toBe("2026/01/02 03:04");
    expect(formatDateTimeCompact(localDate)).toBe("01/02 03:04");
    expect(formatDateOnly(localDate)).toBe("2026/01/02");
  });

  it("preserves invalid API values and uses a fallback for missing values", () => {
    expect(formatDateTimeLong("invalid-date")).toBe("invalid-date");
    expect(formatDateTimeLong(undefined, "未選択")).toBe("未選択");
  });

  it("converts datetime-local values without applying the timezone twice", () => {
    expect(toLocalDateTimeInputValue(localDate)).toBe("2026-01-02T03:04");
    expect(toIsoFromLocalDateTime("invalid-date")).toBe("invalid-date");
  });
});
