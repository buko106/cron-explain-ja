import { CronExpressionParser } from "cron-parser";
import {
  DOM_SPEC,
  DOW_SPEC,
  expandField,
  type FieldSpec,
  HOUR_SPEC,
  hasExtension,
  MINUTE_SPEC,
  MONTH_SPEC,
  parseExpression,
  SECOND_SPEC,
} from "../../src/cron";
import type { CronField, FieldAST, ParserOptions } from "../../src/types";

/**
 * cron-parser（MIT / harrisiirak）をベンチマークにするための橋渡し。
 *
 * 両者は同じ cron 式を別の形で保持している。cron-parser は展開済みの値の配列
 * （`CronField#values`）を、うちは構文木（{@link FieldAST}）を持つ。比べられるのは
 * 「その式が動く値の集合」なので、表記の違いはここで吸収してから比較する。
 *
 * 意図的に違う入力は test/cron-parser-cases.test.ts に一覧がある。
 */

export const CRON_FIELDS: CronField[] = [
  "second",
  "minute",
  "hour",
  "dayOfMonth",
  "month",
  "dayOfWeek",
];

export const SPEC_BY_FIELD: Record<CronField, FieldSpec> = {
  second: SECOND_SPEC,
  minute: MINUTE_SPEC,
  hour: HOUR_SPEC,
  dayOfMonth: DOM_SPEC,
  month: MONTH_SPEC,
  dayOfWeek: DOW_SPEC,
};

/** うるう年を含めた各月の日数 */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export type FieldValues = Record<CronField, number[]>;

function sortUnique(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * cron-parser が展開した値。
 *
 * - 曜日の 7 は 0 と同じ日曜なので畳む（cron-parser は `1-7` を `[0,1,...,7]` として持つ）
 * - `L` や `5L` は数値でない要素として混ざるので落とす
 * - 重複した値は落とす。うちは `expandField` が必ず一意にするので、この正規化が
 *   うち側の欠陥を隠すことはない
 */
export function referenceValues(expression: string): FieldValues {
  const reference = CronExpressionParser.parse(expression);
  const values = {} as FieldValues;
  for (const field of CRON_FIELDS) {
    const raw = reference.fields[field].values as Array<number | string>;
    const numbers = raw.filter((value): value is number => typeof value === "number");
    values[field] = sortUnique(
      numbers.map((value) => (field === "dayOfWeek" && value === 7 ? 0 : value)),
    );
  }
  return values;
}

export interface OwnFields {
  values: FieldValues;
  /** 値に展開できない拡張構文（L / # / W）を含むフィールド */
  extended: Set<CronField>;
  raw: Record<CronField, string>;
}

/**
 * うちのライブラリが構文木として持っている内容を、値の集合として取り出す。
 *
 * 秒を持たない 5 フィールド式は `0 秒` として扱う。cron-parser も欠けた秒を `0` で補う
 */
export function ownValues(expression: string, options: ParserOptions = {}): OwnFields {
  const parsed = parseExpression(expression, options);
  const values = {} as FieldValues;
  const raw = {} as Record<CronField, string>;
  const extended = new Set<CronField>();
  for (const field of CRON_FIELDS) {
    const ast: FieldAST | undefined =
      field === "second" ? parsed.ast.seconds : parsed.ast[field as Exclude<CronField, "second">];
    if (ast === undefined) {
      values[field] = [0];
      raw[field] = "0";
      continue;
    }
    values[field] = expandField(ast, SPEC_BY_FIELD[field]);
    raw[field] = parsed.raw[field === "second" ? "seconds" : field] ?? "";
    if (hasExtension(ast)) extended.add(field);
  }
  return { values, extended, raw };
}

/**
 * cron-parser は月が 1 つに決まるとき、その月に存在しない日を日フィールドから落とす
 * （`CronDayOfMonth.fromMonth`）。全部落ちてしまう場合だけは元のまま残す。
 *
 * うちは日フィールド単体では落とさず、`validate` の警告で「その日は実行されません」と
 * 伝える。比べる前に同じ規則を当てて、この設計の違いだけで差が出ないようにする。
 */
export function clampDayOfMonth(days: number[], months: number[]): number[] {
  const month = months[0];
  if (months.length !== 1 || month === undefined) return days;
  const limit = DAYS_IN_MONTH[month - 1] ?? 31;
  const kept = days.filter((day) => day <= limit);
  return kept.length > 0 ? kept : days;
}

/**
 * `5-1`（金曜から月曜）のように終わりが始まりより小さい範囲を含むか。
 *
 * うちは循環する範囲として読むが、cron-parser は `min > max` として拒否する
 */
export function hasCyclicRange(ast: FieldAST): boolean {
  switch (ast.kind) {
    case "range":
      return ast.from > ast.to;
    case "step":
      return hasCyclicRange(ast.base);
    case "list":
      return ast.items.some(hasCyclicRange);
    default:
      return false;
  }
}

/** 全域に刻み 1 を付けた書き方。`*` と同じ値を指すが、cron-parser は別扱いする */
export const STEP_ONE_WILDCARD = "*/1";

/** `*` / `?` そのもの。どちらのライブラリも「指定なし」と読む */
function unrestricted(raw: string): boolean {
  return raw === "*" || raw === "?";
}

// 日・曜日が「制約されているか」は、どちらのライブラリも書き方で決める。cron-parser は
// 書かれた文字列をそのまま見る（`*` か `?` だけが制約なし）ので STEP_ONE_WILDCARD を制約と
// 見なすが、うちは `isAny` が刻み 1 の `*` を `*` と同じ書き方として畳む。
//
// この違いが効くのは日と曜日の OR 条件を通したときだけなので、片方が STEP_ONE_WILDCARD で、
// かつもう片方が制約されている組み合わせだけを次回実行日時の比較から外す。`*/1 * * * *` の
// ように OR に関係しない位置なら結果は一致するので、外す必要はない。
// 差そのものは cron-parser-cases.test.ts で押さえる
export function differsOnWildcardRule(dayOfMonth: string, dayOfWeek: string): boolean {
  if (dayOfMonth === STEP_ONE_WILDCARD) return !unrestricted(dayOfWeek);
  if (dayOfWeek === STEP_ONE_WILDCARD) return !unrestricted(dayOfMonth);
  return false;
}
