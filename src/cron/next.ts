import type { NextOptions } from "../types";
import { DOM_SPEC, DOW_SPEC, HOUR_SPEC, MINUTE_SPEC, MONTH_SPEC, SECOND_SPEC } from "./fields";
import { parseExpression } from "./parser";
import { expandField, isAny } from "./values";

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

interface Clock {
  parts(date: Date): Parts;
  make(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
  ): Date;
}

const localClock: Clock = {
  parts: (date) => ({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    dayOfWeek: date.getDay(),
  }),
  make: (year, month, day, hour, minute, second) =>
    new Date(year, month - 1, day, hour, minute, second, 0),
};

const utcClock: Clock = {
  parts: (date) => ({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    dayOfWeek: date.getUTCDay(),
  }),
  make: (year, month, day, hour, minute, second) =>
    new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0)),
};

/** sorted の中で value 以上の最小値。無ければ null */
function atLeast(sorted: number[], value: number): number | null {
  for (const candidate of sorted) {
    if (candidate >= value) return candidate;
  }
  return null;
}

/** 5 年先まで探索する */
const SEARCH_YEARS = 5;

/** 無限ループを避けるための保険 */
const MAX_ITERATIONS = 2_000_000;

/**
 * cron 式の次回実行日時を求める。
 *
 * `L` / `#` / `W` を含む式は v1 では計算対象外で、空配列を返す。
 */
export function next(expression: string, options: NextOptions = {}): Date[] {
  const parserOptions = options.seconds === true ? { seconds: true } : {};
  const parsed = parseExpression(expression, parserOptions);
  if (parsed.extensions.some((extension) => extension !== "?")) return [];

  const count = options.count ?? 3;
  if (count <= 0) return [];

  const clock = options.tz === "UTC" ? utcClock : localClock;
  const from = options.from ?? new Date();
  if (Number.isNaN(from.getTime())) return [];

  const ast = parsed.ast;
  const seconds = ast.seconds === undefined ? [0] : expandField(ast.seconds, SECOND_SPEC);
  const minutes = expandField(ast.minute, MINUTE_SPEC);
  const hours = expandField(ast.hour, HOUR_SPEC);
  const months = expandField(ast.month, MONTH_SPEC);
  const days = expandField(ast.dayOfMonth, DOM_SPEC);
  const weekdays = expandField(ast.dayOfWeek, DOW_SPEC);
  if ([seconds, minutes, hours, months].some((values) => values.length === 0)) return [];

  const domRestricted = !isAny(ast.dayOfMonth);
  const dowRestricted = !isAny(ast.dayOfWeek);
  const daySet = new Set(days);
  const weekdaySet = new Set(weekdays);
  const monthSet = new Set(months);

  const dayMatches = (parts: Parts): boolean => {
    if (domRestricted && dowRestricted) {
      return daySet.has(parts.day) || weekdaySet.has(parts.dayOfWeek);
    }
    if (domRestricted) return daySet.has(parts.day);
    if (dowRestricted) return weekdaySet.has(parts.dayOfWeek);
    return true;
  };

  const startParts = clock.parts(from);
  const limitYear = startParts.year + SEARCH_YEARS;

  const initial = clock.parts(new Date(from.getTime() + 1000));
  let cursor = clock.make(
    initial.year,
    initial.month,
    initial.day,
    initial.hour,
    initial.minute,
    initial.second,
  );

  /** 夏時間の巻き戻しなどで時刻が戻らないよう、必ず前進させる */
  const moveTo = (candidate: Date): Date =>
    candidate.getTime() > cursor.getTime() ? candidate : new Date(cursor.getTime() + 1000);

  const results: Date[] = [];
  let iterations = 0;
  while (results.length < count && iterations < MAX_ITERATIONS) {
    iterations += 1;
    const parts = clock.parts(cursor);
    if (parts.year > limitYear) break;

    if (!monthSet.has(parts.month)) {
      cursor = moveTo(clock.make(parts.year, parts.month + 1, 1, 0, 0, 0));
      continue;
    }
    if (!dayMatches(parts)) {
      cursor = moveTo(clock.make(parts.year, parts.month, parts.day + 1, 0, 0, 0));
      continue;
    }
    const hour = atLeast(hours, parts.hour);
    if (hour === null) {
      cursor = moveTo(clock.make(parts.year, parts.month, parts.day + 1, 0, 0, 0));
      continue;
    }
    if (hour !== parts.hour) {
      cursor = moveTo(clock.make(parts.year, parts.month, parts.day, hour, 0, 0));
      continue;
    }
    const minute = atLeast(minutes, parts.minute);
    if (minute === null) {
      cursor = moveTo(clock.make(parts.year, parts.month, parts.day, parts.hour + 1, 0, 0));
      continue;
    }
    if (minute !== parts.minute) {
      cursor = moveTo(clock.make(parts.year, parts.month, parts.day, parts.hour, minute, 0));
      continue;
    }
    const second = atLeast(seconds, parts.second);
    if (second === null) {
      cursor = moveTo(
        clock.make(parts.year, parts.month, parts.day, parts.hour, parts.minute + 1, 0),
      );
      continue;
    }
    if (second !== parts.second) {
      cursor = moveTo(
        clock.make(parts.year, parts.month, parts.day, parts.hour, parts.minute, second),
      );
      continue;
    }

    results.push(new Date(cursor.getTime()));
    cursor = new Date(cursor.getTime() + 1000);
  }

  return results;
}
