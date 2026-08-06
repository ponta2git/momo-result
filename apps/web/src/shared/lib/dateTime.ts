type DateTimeValue = Date | string | undefined;

const longDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const compactDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatDateTimeLong(value: DateTimeValue, fallback = "日時未設定"): string {
  return formatDateValue(value, longDateTimeFormatter, fallback);
}

export function formatDateTimeCompact(value: DateTimeValue, fallback = "日時未設定"): string {
  return formatDateValue(value, compactDateTimeFormatter, fallback);
}

export function formatDateOnly(value: DateTimeValue, fallback = "日付未設定"): string {
  return formatDateValue(value, dateFormatter, fallback);
}

export function toLocalDateTimeInputValue(value: Date | string = new Date()): string {
  const date = asValidDate(value);
  if (!date) {
    return typeof value === "string" ? value : "";
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function toIsoFromLocalDateTime(value: string): string {
  const date = asValidDate(value);
  return date ? date.toISOString() : value;
}

function formatDateValue(
  value: DateTimeValue,
  formatter: Intl.DateTimeFormat,
  fallback: string,
): string {
  const date = asValidDate(value);
  if (date) {
    return formatter.format(date);
  }
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asValidDate(value: DateTimeValue): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
