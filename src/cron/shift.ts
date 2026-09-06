import { CronTimeZoneError } from "../errors";
import type { CronAST, FieldAST, ParserOptions } from "../types";
import { DOM_SPEC, DOW_SPEC, type FieldSpec, HOUR_SPEC, MINUTE_SPEC, MONTH_SPEC } from "./fields";
import { parseExpression } from "./parser";
import { coversAll, expandField, formatExpression, hasExtension, toRanges } from "./values";
import { fixedOffsetMinutes, SERVER_TIME_ZONE } from "./zone";

/**
 * 書き換えの向き。
 * - `'toLocal'`: cron 式(UTC) → `timeZone` の壁時計（explain）
 * - `'toServer'`: `timeZone` の壁時計 → cron 式(UTC)（parse）
 */
export type ShiftDirection = "toLocal" | "toServer";

const MINUTES_PER_DAY = 1440;

/** 日をまたぐ書き換えが月の長さに左右されないのは 1-28 日の範囲だけ */
const SAFE_DAY_MIN = 1;
const SAFE_DAY_MAX = 28;

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function sorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function sameValues(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** 「+9:00」「-4:30」 */
function formatOffset(minutes: number): string {
  const absolute = Math.abs(minutes);
  const hour = Math.floor(absolute / 60);
  const minute = absolute % 60;
  return `${minutes < 0 ? "-" : "+"}${hour}:${String(minute).padStart(2, "0")}`;
}

/**
 * 値の並びから、なるべく自然な構文木を組み立てる。
 *
 * 連番は範囲に、等間隔は刻みに畳む。説明文の質がここで決まる
 * （`1,3,5,…,23` を並べ立てず `1-23/2` にする）。
 */
function fromValues(values: number[], spec: FieldSpec): FieldAST {
  const first = values[0];
  const last = values[values.length - 1];
  /* c8 ignore next -- 呼び出し側が空配列を渡さない */
  if (first === undefined || last === undefined) return { kind: "any" };
  if (values.length === spec.max - spec.min + 1) return { kind: "any" };
  if (values.length === 1) return { kind: "value", value: first };

  const step = (values[1] as number) - first;
  const evenlySpaced =
    values.length > 2 &&
    step > 1 &&
    values.every((value, index) => index === 0 || value - (values[index - 1] as number) === step);
  if (evenlySpaced) {
    // 下限から刻んで上限に届いているなら `*/N`。`0-22/2` より `*/2` の方が説明しやすい
    const fromMin = first === spec.min && last + step > spec.max;
    const base: FieldAST = fromMin ? { kind: "any" } : { kind: "range", from: first, to: last };
    return { kind: "step", base, step };
  }

  const items = toRanges(values).map(
    ([from, to]): FieldAST =>
      from === to ? { kind: "value", value: from } : { kind: "range", from, to },
  );
  return items.length === 1 ? (items[0] as FieldAST) : { kind: "list", items };
}

/**
 * cron 式(UTC) と `timeZone` の壁時計の間で、フィールドをずらす。
 *
 * cron 式は「フィールドごとに独立した値の集合」しか表せないので、ずらした結果が
 * その形に収まらない場合は書き換えられない。収まらないまま近い式を返すと、
 * 半年ずれた予定を黙って出すことになるため {@link CronTimeZoneError} で失敗させる。
 *
 * @throws {CronTimeZoneError} ゾーンのオフセットが動く、または結果が cron 式で表せない場合
 */
export function shiftAst(ast: CronAST, timeZone: string, direction: ShiftDirection): CronAST {
  // UTC のままなら書き換えも夏時間の検査も要らない
  if (timeZone === SERVER_TIME_ZONE) return ast;

  const zoneOffset = fixedOffsetMinutes(timeZone);
  const deltaMinutes = direction === "toLocal" ? zoneOffset : -zoneOffset;
  if (deltaMinutes === 0) return ast;

  // 表示するのは常にゾーンのオフセット。向きによって符号が変わると読み手が混乱する
  const offset = formatOffset(zoneOffset);
  const fail = (reason: string): never => {
    throw new CronTimeZoneError(`${timeZone}（時差 ${offset}）では${reason}`, timeZone);
  };

  const minutes = expandField(ast.minute, MINUTE_SPEC);
  const hours = expandField(ast.hour, HOUR_SPEC);
  if (minutes.length === 0 || hours.length === 0) {
    return fail("分・時のフィールドを展開できないため、cron 式に書き換えられません");
  }

  // 1 日の中の分（0-1439）に直してからずらす
  const moved = new Set<number>();
  const carries = new Set<number>();
  for (const hour of hours) {
    for (const minute of minutes) {
      const value = hour * 60 + minute + deltaMinutes;
      moved.add(mod(value, MINUTES_PER_DAY));
      carries.add(Math.floor(value / MINUTES_PER_DAY));
    }
  }

  const newMinutes = sorted([...moved].map((value) => value % 60));
  const newHours = sorted([...moved].map((value) => Math.floor(value / 60)));
  // cron の分と時は独立した集合なので、直積に戻らない組み合わせは表せない
  if (newMinutes.length * newHours.length !== moved.size) {
    return fail(
      "分と時の組み合わせが崩れるため、cron 式に書き換えられません" +
        "（分の繰り上がりが時刻によって変わります）",
    );
  }

  const domRestricted = !coversAll(ast.dayOfMonth, DOM_SPEC);
  const dowRestricted = !coversAll(ast.dayOfWeek, DOW_SPEC);
  const monthRestricted = !coversAll(ast.month, MONTH_SPEC);
  const everyDay = !domRestricted && !dowRestricted && !monthRestricted;

  const [onlyCarry] = [...carries];
  const dayShift = carries.size === 1 && onlyCarry !== undefined ? onlyCarry : null;
  if (dayShift === null && !everyDay) {
    return fail("日付をまたぐ時刻とまたがない時刻が混ざるため、cron 式に書き換えられません");
  }

  let dayOfMonth = ast.dayOfMonth;
  let dayOfWeek = ast.dayOfWeek;
  if (dayShift !== null && dayShift !== 0 && !everyDay) {
    if (hasExtension(ast.dayOfMonth) || hasExtension(ast.dayOfWeek)) {
      return fail("日付が 1 日ずれるため、L / # / W を含む式は書き換えられません");
    }
    // 月フィールドが絞られていると、月末の実行が翌月へこぼれる。
    // 日で絞られていて月をまたがないと分かっている場合だけ通す
    if (monthRestricted && (!domRestricted || dowRestricted)) {
      return fail("日付が 1 日ずれて月をまたぐため、cron 式に書き換えられません");
    }
    if (domRestricted) {
      const days = expandField(ast.dayOfMonth, DOM_SPEC);
      const shiftedDays = days.map((day) => day + dayShift);
      // 29-31 日は月によって存在したりしなかったりするので、ずらすと意味が変わる
      const safe = days.every(
        (day, index) =>
          day <= SAFE_DAY_MAX &&
          (shiftedDays[index] as number) >= SAFE_DAY_MIN &&
          (shiftedDays[index] as number) <= SAFE_DAY_MAX,
      );
      if (!safe) {
        return fail(
          "日付が 1 日ずれて月をまたぐ可能性があるため、cron 式に書き換えられません" +
            "（1-28 日の範囲に収まる指定であれば書き換えられます）",
        );
      }
      dayOfMonth = fromValues(shiftedDays, DOM_SPEC);
    }
    if (dowRestricted) {
      const weekdays = expandField(ast.dayOfWeek, DOW_SPEC);
      dayOfWeek = fromValues(sorted(weekdays.map((day) => mod(day + dayShift, 7))), DOW_SPEC);
    }
  }

  return {
    ...ast,
    minute: sameValues(newMinutes, minutes) ? ast.minute : fromValues(newMinutes, MINUTE_SPEC),
    hour: sameValues(newHours, hours) ? ast.hour : fromValues(newHours, HOUR_SPEC),
    dayOfMonth,
    dayOfWeek,
  };
}

/**
 * cron 式の文字列を {@link shiftAst} と同じ規則でずらす。
 *
 * @throws {CronSyntaxError} 式が不正な場合
 * @throws {CronTimeZoneError} ゾーンのオフセットが動く、または結果が cron 式で表せない場合
 */
export function shiftExpression(
  expression: string,
  timeZone: string,
  direction: ShiftDirection,
  options: ParserOptions = {},
): string {
  if (timeZone === SERVER_TIME_ZONE) return expression;
  const { ast } = parseExpression(expression, options);
  return formatExpression(shiftAst(ast, timeZone, direction));
}
