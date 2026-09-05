import type { NextOptions } from "../types";
import { DOM_SPEC, DOW_SPEC, HOUR_SPEC, MINUTE_SPEC, MONTH_SPEC, SECOND_SPEC } from "./fields";
import { parseExpression } from "./parser";
import { expandField, isAny } from "./values";
import { clockFor, resolveTimeZone, type WallClock } from "./zone";

/** sorted の中で value 以上の最小値。無ければ null */
function atLeast(sorted: number[], value: number): number | null {
  for (const candidate of sorted) {
    if (candidate >= value) return candidate;
  }
  return null;
}

/**
 * 壁時計のフィールドを繰り上げて正規化する（13 月・32 日・24 時などを畳む）。
 *
 * 純粋な暦の計算なのでタイムゾーンには依存しない。探索はこの上を歩き、
 * 実際の瞬間に直すのは候補が確定したときだけにする。
 */
function normalize(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): WallClock {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    dayOfWeek: date.getUTCDay(),
  };
}

/** 5 年先まで探索する */
const SEARCH_YEARS = 5;

/** 無限ループを避けるための保険 */
const MAX_ITERATIONS = 2_000_000;

/**
 * cron 式の次回実行日時を求める。
 *
 * 壁時計は `options.tz` のタイムゾーンで解釈する（既定は `'Asia/Tokyo'`）。
 *
 * `L` / `#` / `W` を含む式は v1 では計算対象外で、空配列を返す。
 *
 * @throws {CronSyntaxError} 式が不正な場合
 * @throws {CronTimeZoneError} タイムゾーン名を解釈できない場合
 */
export function next(expression: string, options: NextOptions = {}): Date[] {
  const clock = clockFor(resolveTimeZone(options.tz));

  const parserOptions = options.seconds === true ? { seconds: true } : {};
  const parsed = parseExpression(expression, parserOptions);
  if (parsed.extensions.some((extension) => extension !== "?")) return [];

  const count = options.count ?? 3;
  if (count <= 0) return [];

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

  const dayMatches = (wall: WallClock): boolean => {
    if (domRestricted && dowRestricted) {
      return daySet.has(wall.day) || weekdaySet.has(wall.dayOfWeek);
    }
    if (domRestricted) return daySet.has(wall.day);
    if (dowRestricted) return weekdaySet.has(wall.dayOfWeek);
    return true;
  };

  const start = clock.parts(from);
  const limitYear = start.year + SEARCH_YEARS;
  let wall = normalize(
    start.year,
    start.month,
    start.day,
    start.hour,
    start.minute,
    start.second + 1,
  );

  const results: Date[] = [];
  /** 巻き戻しで同じ瞬間を 2 度返さないよう、直前に確定した瞬間を覚えておく */
  let previous = from.getTime();
  let iterations = 0;
  while (results.length < count && iterations < MAX_ITERATIONS) {
    iterations += 1;
    if (wall.year > limitYear) break;

    if (!monthSet.has(wall.month)) {
      wall = normalize(wall.year, wall.month + 1, 1, 0, 0, 0);
      continue;
    }
    if (!dayMatches(wall)) {
      wall = normalize(wall.year, wall.month, wall.day + 1, 0, 0, 0);
      continue;
    }
    const hour = atLeast(hours, wall.hour);
    if (hour === null) {
      wall = normalize(wall.year, wall.month, wall.day + 1, 0, 0, 0);
      continue;
    }
    if (hour !== wall.hour) {
      wall = normalize(wall.year, wall.month, wall.day, hour, 0, 0);
      continue;
    }
    const minute = atLeast(minutes, wall.minute);
    if (minute === null) {
      wall = normalize(wall.year, wall.month, wall.day, wall.hour + 1, 0, 0);
      continue;
    }
    if (minute !== wall.minute) {
      wall = normalize(wall.year, wall.month, wall.day, wall.hour, minute, 0);
      continue;
    }
    const second = atLeast(seconds, wall.second);
    if (second === null) {
      wall = normalize(wall.year, wall.month, wall.day, wall.hour, wall.minute + 1, 0);
      continue;
    }
    if (second !== wall.second) {
      wall = normalize(wall.year, wall.month, wall.day, wall.hour, wall.minute, second);
      continue;
    }

    const date = clock.make(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second);
    if (date.getTime() > previous) {
      results.push(date);
      previous = date.getTime();
    }
    wall = normalize(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second + 1);
  }

  return results;
}
