const LOCAL_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

const LOCAL_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

const LOCAL_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
};

function parseCompactDate(value: string): Date | null {
  const compact = /^(\d{2})(\d{2})(\d{4})$/.exec(value);
  if (!compact) {
    return null;
  }

  const [, dayText, monthText, yearText] = compact;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDotDate(value: string): Date | null {
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!dotted) {
    return null;
  }

  const [, dayText, monthText, yearText] = dotted;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIsoDateOnly(value: string): Date | null {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!isoDate) {
    return null;
  }

  const [, yearText, monthText, dayText] = isoDate;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toEpochMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }

  const parsedNumeric = Number(text);
  if (Number.isFinite(parsedNumeric)) {
    const milliseconds = parsedNumeric < 10_000_000_000 ? parsedNumeric * 1000 : parsedNumeric;
    return Number.isFinite(milliseconds) ? milliseconds : 0;
  }

  const localDate = parseIsoDateOnly(text) ?? parseCompactDate(text) ?? parseDotDate(text);
  if (localDate) {
    return localDate.getTime();
  }

  const parsedDate = new Date(text).getTime();
  return Number.isFinite(parsedDate) ? parsedDate : 0;
}

export function formatLocalDateTime(
  value: unknown,
  fallback = "-",
  options: Intl.DateTimeFormatOptions = LOCAL_DATE_TIME_OPTIONS,
): string {
  const epochMs = toEpochMs(value);
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return fallback;
  }
  return new Date(epochMs).toLocaleString(undefined, options);
}

export function formatLocalDate(
  value: unknown,
  fallback = "-",
  options: Intl.DateTimeFormatOptions = LOCAL_DATE_OPTIONS,
): string {
  const epochMs = toEpochMs(value);
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return fallback;
  }
  return new Date(epochMs).toLocaleDateString(undefined, options);
}

export function formatLocalTime(
  value: unknown,
  fallback = "-",
  options: Intl.DateTimeFormatOptions = LOCAL_TIME_OPTIONS,
): string {
  const epochMs = toEpochMs(value);
  if (!Number.isFinite(epochMs) || epochMs <= 0) {
    return fallback;
  }
  return new Date(epochMs).toLocaleTimeString(undefined, options);
}

export function localDateSearchToken(value: unknown): string {
  const dateText = formatLocalDate(value, "");
  return dateText.replace(/\D/g, "");
}

export function buildInfoLocalDateTimeLabel(dateValue: unknown, timeValue: unknown): string {
  const dateText = String(dateValue ?? "").trim();
  const timeText = String(timeValue ?? "").trim();
  if (!dateText || dateText === "--------") {
    return "-------- --:--";
  }

  const dateOnly = parseCompactDate(dateText) ?? parseDotDate(dateText) ?? parseIsoDateOnly(dateText);
  if (!dateOnly) {
    return `${dateText}${timeText ? ` ${timeText}` : ""}`.trim();
  }

  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeText);
  if (!timeMatch) {
    return dateOnly.toLocaleDateString();
  }

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const seconds = Number(timeMatch[3] ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return dateOnly.toLocaleDateString();
  }

  const localDateTime = new Date(
    dateOnly.getFullYear(),
    dateOnly.getMonth(),
    dateOnly.getDate(),
    hours,
    minutes,
    seconds,
  );
  return localDateTime.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
