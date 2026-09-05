import type { FieldAST } from "../types";
import type { FieldSpec } from "./fields";

/** 拡張構文（L / # / W / ?）を含むか */
export function hasExtension(ast: FieldAST): boolean {
  switch (ast.kind) {
    case "last":
    case "nth":
    case "nearestWeekday":
      return true;
    case "list":
      return ast.items.some(hasExtension);
    case "step":
      return hasExtension(ast.base);
    default:
      return false;
  }
}

/** `*` あるいは `?`（＝制約なし）か */
export function isAny(ast: FieldAST): boolean {
  if (ast.kind === "any" || ast.kind === "noSpecific") return true;
  if (ast.kind === "step") return ast.step === 1 && isAny(ast.base);
  return false;
}

/** 表記は違っても、そのフィールドの全値を含むか（`0-6` など） */
export function coversAll(ast: FieldAST, spec: FieldSpec): boolean {
  if (isAny(ast)) return true;
  if (hasExtension(ast)) return false;
  return expandField(ast, spec).length === spec.max - spec.min + 1;
}

/**
 * フィールドの全域に対する刻みなら、その刻み幅を返す。
 * `0-59/5` のように範囲が全域を覆う場合を含み、`*` を base にしたものと同じ意味になる。
 */
export function fullRangeStep(ast: FieldAST, spec: FieldSpec): number | undefined {
  if (ast.kind !== "step") return undefined;
  const base = ast.base;
  // 刻みは base の下限を起点に数えるため、全値を含んでいても起点が min でなければ
  // `*` とは値が違う。`1-0/2` は循環して全値を含むが 1,3,5… であり `*/2` ではない
  const fromMin =
    isAny(base) || (base.kind === "range" && base.from === spec.min && base.to === spec.max);
  if (!fromMin) return undefined;
  // 幅を超える刻みは実際には起点で 1 回動くだけなので、「Nごと」とは説明しない
  if (ast.step > spec.max - spec.min) return undefined;
  return ast.step;
}

/**
 * 「AからBまでNごと」と説明できる刻みなら、その範囲と刻み幅を返す。
 * 幅を超える刻みは起点で 1 回動くだけなので、範囲としては説明しない。
 */
export function rangeStep(
  ast: FieldAST,
  spec: FieldSpec,
): { from: number; to: number; step: number } | undefined {
  if (ast.kind !== "step" || ast.base.kind !== "range") return undefined;
  const { from, to } = ast.base;
  const span = spec.max - spec.min + 1;
  const width = from <= to ? to - from : span - from + to;
  if (ast.step > width) return undefined;
  return { from, to, step: ast.step };
}

function rangeValues(from: number, to: number, spec: FieldSpec, step: number): number[] {
  const values: number[] = [];
  const span = spec.max - spec.min + 1;
  // from > to は循環範囲（例: 金-月 = 5-1）として扱う
  const length = from <= to ? to - from + 1 : span - from + to + 1;
  for (let i = 0; i < length; i += step) {
    values.push(spec.min + ((from - spec.min + i) % span));
  }
  return values;
}

/**
 * フィールドの構文木を実際の値へ展開する。
 * 拡張構文（L / # / W）は静的に展開できないため空配列を返す。
 */
export function expandField(ast: FieldAST, spec: FieldSpec): number[] {
  const values = collect(ast, spec);
  return [...new Set(values)].sort((a, b) => a - b);
}

function collect(ast: FieldAST, spec: FieldSpec): number[] {
  switch (ast.kind) {
    case "any":
    case "noSpecific":
      return rangeValues(spec.min, spec.max, spec, 1);
    case "value":
      return [ast.value];
    case "range":
      return rangeValues(ast.from, ast.to, spec, 1);
    case "step": {
      const base = ast.base;
      if (base.kind === "range") return rangeValues(base.from, base.to, spec, ast.step);
      return rangeValues(spec.min, spec.max, spec, ast.step);
    }
    case "list":
      return ast.items.flatMap((item) => collect(item, spec));
    default:
      return [];
  }
}

/** 構文木を正規化された cron 表記へ戻す */
export function formatField(ast: FieldAST): string {
  switch (ast.kind) {
    case "any":
      return "*";
    case "noSpecific":
      return "?";
    case "value":
      return String(ast.value);
    case "range":
      return `${ast.from}-${ast.to}`;
    case "step":
      return `${formatField(ast.base)}/${ast.step}`;
    case "list":
      return ast.items.map(formatField).join(",");
    case "last":
      return ast.offset === undefined ? "L" : `L-${ast.offset}`;
    case "nth":
      return ast.nth === -1 ? `${ast.weekday}L` : `${ast.weekday}#${ast.nth}`;
    case "nearestWeekday":
      return `${ast.day}W`;
  }
}

/** 連続した値の並びを範囲に畳む（[1,2,3,5] → [[1,3],[5,5]]） */
export function toRanges(values: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const value of values) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && value === last[1] + 1) {
      last[1] = value;
    } else {
      ranges.push([value, value]);
    }
  }
  return ranges;
}
