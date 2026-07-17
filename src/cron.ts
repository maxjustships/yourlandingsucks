interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

function integer(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} contains an invalid value: ${value}`);
  return Number(value);
}

function cronField(raw: string, min: number, max: number, label: string, normalize?: (value: number) => number): CronField {
  if (!raw) throw new Error(`${label} must not be empty`);
  const values = new Set<number>();
  for (const segment of raw.split(",")) {
    const [base, stepRaw, extra] = segment.split("/");
    if (extra !== undefined || !base) throw new Error(`${label} contains an invalid segment: ${segment}`);
    const step = stepRaw === undefined ? 1 : integer(stepRaw, label);
    if (step <= 0) throw new Error(`${label} step must be positive`);
    let start: number;
    let end: number;
    if (base === "*") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const parts = base.split("-");
      if (parts.length !== 2) throw new Error(`${label} contains an invalid range: ${base}`);
      start = integer(parts[0]!, label);
      end = integer(parts[1]!, label);
    } else {
      start = integer(base, label);
      end = start;
    }
    if (start < min || start > max || end < min || end > max || start > end) {
      throw new Error(`${label} values must be between ${min} and ${max}`);
    }
    for (let value = start; value <= end; value += step) values.add(normalize ? normalize(value) : value);
  }
  return { values, wildcard: raw === "*" };
}

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("watch.schedule.cron must contain exactly five fields");
  return {
    minute: cronField(fields[0]!, 0, 59, "cron minute"),
    hour: cronField(fields[1]!, 0, 23, "cron hour"),
    dayOfMonth: cronField(fields[2]!, 1, 31, "cron day-of-month"),
    month: cronField(fields[3]!, 1, 12, "cron month"),
    dayOfWeek: cronField(fields[4]!, 0, 7, "cron day-of-week", (value) => value === 7 ? 0 : value),
  };
}

export function validateTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    throw new Error(`watch.schedule.timezone is invalid: ${timezone}`);
  }
}

function localParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
} {
  validateTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return {
    year,
    month,
    day,
    hour: Number(values.hour),
    minute: Number(values.minute),
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

export function cronMatches(expression: string, date: Date, timezone: string): boolean {
  if (Number.isNaN(date.getTime())) throw new Error("watch time must be a valid ISO timestamp");
  const parsed = parseCron(expression);
  const local = localParts(date, timezone);
  const dayOfMonthMatches = parsed.dayOfMonth.values.has(local.day);
  const dayOfWeekMatches = parsed.dayOfWeek.values.has(local.dayOfWeek);
  const dayMatches = parsed.dayOfMonth.wildcard && parsed.dayOfWeek.wildcard
    ? true
    : parsed.dayOfMonth.wildcard
      ? dayOfWeekMatches
      : parsed.dayOfWeek.wildcard
        ? dayOfMonthMatches
        : dayOfMonthMatches || dayOfWeekMatches;
  return parsed.minute.values.has(local.minute) && parsed.hour.values.has(local.hour) &&
    parsed.month.values.has(local.month) && dayMatches;
}

export function scheduledMinuteKey(date: Date, timezone: string): string {
  const local = localParts(date, timezone);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}@${timezone}`;
}
