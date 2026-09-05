import { CronSyntaxError } from "../errors";
import type { CronAST, CronExtension, CronField, FieldAST, ParserOptions } from "../types";
import {
  FIELD_SPECS,
  FIELD_SPECS_WITH_SECONDS,
  type FieldSpec,
  MACROS,
  UNSCHEDULABLE_MACROS,
} from "./fields";

export interface ParsedExpression {
  ast: CronAST;
  /** フィールドごとの入力文字列（正規化前） */
  raw: {
    seconds?: string;
    minute: string;
    hour: string;
    dayOfMonth: string;
    month: string;
    dayOfWeek: string;
  };
  /** 使用されている拡張構文 */
  extensions: CronExtension[];
  /** マクロが展開された場合、その元の表記 */
  macro?: string;
}

interface Part {
  text: string;
  offset: number;
}

/** カンマ区切りで位置情報を保ったまま分割する */
function splitParts(text: string, offset: number, separator: string): Part[] {
  const parts: Part[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === separator) {
      parts.push({ text: text.slice(start, i), offset: offset + start });
      start = i + 1;
    }
  }
  return parts;
}

function parseNumber(text: string, spec: FieldSpec, position: number): number {
  const upper = text.toUpperCase();
  const named = spec.names?.[upper];
  if (named !== undefined) return named;

  if (!/^\d{1,2}$/.test(text)) {
    throw new CronSyntaxError(`${spec.label} フィールドの値 '${text}' を解釈できません`, {
      field: spec.field,
      position,
    });
  }
  const value = Number(text);
  if (value < spec.min || value > spec.inputMax) {
    throw new CronSyntaxError(
      `${spec.label} フィールドの値 ${value} は範囲外です (${spec.min}-${spec.inputMax})`,
      { field: spec.field, position },
    );
  }
  // 曜日の 7 は 0 に正規化する
  return spec.field === "dayOfWeek" && value === 7 ? 0 : value;
}

function parseAtom(text: string, spec: FieldSpec, position: number): FieldAST {
  if (text === "") {
    throw new CronSyntaxError(`${spec.label} フィールドが空です`, {
      field: spec.field,
      position,
    });
  }
  if (text === "*") return { kind: "any" };

  if (text === "?") {
    if (spec.field !== "dayOfMonth" && spec.field !== "dayOfWeek") {
      throw new CronSyntaxError(`'?' は日・曜日フィールドでのみ使用できます`, {
        field: spec.field,
        position,
      });
    }
    return { kind: "noSpecific" };
  }

  if (spec.field === "dayOfMonth") {
    if (text === "L") return { kind: "last" };
    const lastOffset = /^L-(\d{1,2})$/.exec(text);
    if (lastOffset?.[1] !== undefined) {
      const offset = Number(lastOffset[1]);
      if (offset > 30) {
        throw new CronSyntaxError(`'L-${offset}' のオフセットは 0-30 の範囲で指定してください`, {
          field: spec.field,
          position,
        });
      }
      return { kind: "last", offset };
    }
    const nearest = /^(\d{1,2})W$/i.exec(text);
    if (nearest?.[1] !== undefined) {
      return { kind: "nearestWeekday", day: parseNumber(nearest[1], spec, position) };
    }
  }

  if (spec.field === "dayOfWeek") {
    const hash = text.indexOf("#");
    if (hash >= 0) {
      const weekday = parseNumber(text.slice(0, hash), spec, position);
      const nthText = text.slice(hash + 1);
      if (!/^[1-5]$/.test(nthText)) {
        throw new CronSyntaxError(`'#' の後は 1-5 で指定してください`, {
          field: spec.field,
          position: position + hash + 1,
        });
      }
      return { kind: "nth", weekday, nth: Number(nthText) };
    }
    if (/^.+L$/i.test(text)) {
      const weekday = parseNumber(text.slice(0, -1), spec, position);
      return { kind: "nth", weekday, nth: -1 };
    }
    if (text.toUpperCase() === "L") {
      throw new CronSyntaxError(`曜日フィールドの 'L' は '5L' のように曜日と組み合わせてください`, {
        field: spec.field,
        position,
      });
    }
  }

  const dash = text.indexOf("-");
  if (dash > 0) {
    const from = parseNumber(text.slice(0, dash), spec, position);
    const to = parseNumber(text.slice(dash + 1), spec, position + dash + 1);
    return { kind: "range", from, to };
  }

  return { kind: "value", value: parseNumber(text, spec, position) };
}

function parseItem(text: string, spec: FieldSpec, position: number): FieldAST {
  const slash = text.indexOf("/");
  if (slash < 0) return parseAtom(text, spec, position);

  const stepText = text.slice(slash + 1);
  if (!/^\d{1,2}$/.test(stepText)) {
    throw new CronSyntaxError(`${spec.label} フィールドの刻み幅 '${stepText}' を解釈できません`, {
      field: spec.field,
      position: position + slash + 1,
    });
  }
  const step = Number(stepText);
  if (step < 1) {
    throw new CronSyntaxError(`${spec.label} フィールドの刻み幅は 1 以上で指定してください`, {
      field: spec.field,
      position: position + slash + 1,
    });
  }

  const baseText = text.slice(0, slash);
  const base = parseAtom(baseText === "" ? "*" : baseText, spec, position);
  if (base.kind === "value") {
    // `5/15` は「5 から max まで 15 刻み」の意味
    return { kind: "step", base: { kind: "range", from: base.value, to: spec.max }, step };
  }
  if (base.kind !== "any" && base.kind !== "range") {
    throw new CronSyntaxError(`${spec.label} フィールドの刻みは '*' か範囲にのみ指定できます`, {
      field: spec.field,
      position,
    });
  }
  return { kind: "step", base, step };
}

function parseField(text: string, spec: FieldSpec, offset: number): FieldAST {
  const parts = splitParts(text, offset, ",");
  const items = parts.map((part) => parseItem(part.text, spec, part.offset));
  const first = items[0];
  if (first === undefined) {
    throw new CronSyntaxError(`${spec.label} フィールドが空です`, {
      field: spec.field,
      position: offset,
    });
  }
  if (items.length === 1) return first;
  return { kind: "list", items };
}

function collectExtensions(ast: FieldAST, into: Set<CronExtension>): void {
  switch (ast.kind) {
    case "last":
      into.add("L");
      break;
    case "nth":
      into.add(ast.nth === -1 ? "L" : "#");
      break;
    case "nearestWeekday":
      into.add("W");
      break;
    case "noSpecific":
      into.add("?");
      break;
    case "list":
      for (const item of ast.items) collectExtensions(item, into);
      break;
    case "step":
      collectExtensions(ast.base, into);
      break;
    default:
      break;
  }
}

/**
 * cron 式を構文解析する。不正な式は {@link CronSyntaxError} を投げる。
 */
export function parseExpression(expression: string, options: ParserOptions = {}): ParsedExpression {
  if (typeof expression !== "string") {
    throw new CronSyntaxError("cron 式は文字列で指定してください");
  }
  const trimmed = expression.trim();
  if (trimmed === "") {
    throw new CronSyntaxError("cron 式が空です");
  }

  let source = trimmed;
  let macro: string | undefined;
  if (source.startsWith("@")) {
    // crontab の行は「@daily <コマンド>」の形を取り、マクロは常に先頭の 1 トークン。
    // 数値のフィールドと違って区切りが曖昧にならないので、残りはコマンドとして捨てる
    const token = /^\S+/.exec(source)?.[0] ?? source;
    const lower = token.toLowerCase();
    const expanded = MACROS[lower];
    if (expanded === undefined) {
      const reason = UNSCHEDULABLE_MACROS[lower];
      if (reason !== undefined) {
        throw new CronSyntaxError(`'${token}' は${reason}`, { position: 0 });
      }
      throw new CronSyntaxError(`マクロ '${token}' には対応していません`, { position: 0 });
    }
    macro = token;
    source = expanded;
  }

  const specs = options.seconds === true ? FIELD_SPECS_WITH_SECONDS : FIELD_SPECS;
  const fields: Part[] = [];
  const re = /\S+/g;
  let match = re.exec(source);
  while (match !== null) {
    fields.push({ text: match[0], offset: match.index });
    match = re.exec(source);
  }

  if (fields.length !== specs.length) {
    const hint =
      fields.length === 6 && options.seconds !== true
        ? "。秒付きの式は seconds オプションを有効にしてください"
        : "";
    throw new CronSyntaxError(
      `フィールド数が不正です（${specs.length} 個必要ですが ${fields.length} 個でした）${hint}`,
      { position: 0 },
    );
  }

  interface Entry {
    spec: FieldSpec;
    part: Part;
    ast: FieldAST;
  }
  const parsed: Entry[] = specs.map((spec, index) => {
    const part = fields[index];
    /* c8 ignore next -- fields.length === specs.length を確認済み */
    if (part === undefined) throw new CronSyntaxError("フィールド数が不正です");
    return { spec, part, ast: parseField(part.text, spec, part.offset) };
  });

  const byField = new Map<CronField, Entry>(parsed.map((entry) => [entry.spec.field, entry]));
  const get = (field: CronField): Entry => {
    const entry = byField.get(field);
    /* c8 ignore next -- specs は必ず全フィールドを含む */
    if (entry === undefined) throw new CronSyntaxError("フィールドが不足しています");
    return entry;
  };

  const minute = get("minute");
  const hour = get("hour");
  const dayOfMonth = get("dayOfMonth");
  const month = get("month");
  const dayOfWeek = get("dayOfWeek");
  const seconds = options.seconds === true ? get("second") : undefined;

  const ast: CronAST = {
    minute: minute.ast,
    hour: hour.ast,
    dayOfMonth: dayOfMonth.ast,
    month: month.ast,
    dayOfWeek: dayOfWeek.ast,
  };
  if (seconds !== undefined) ast.seconds = seconds.ast;

  const extensions = new Set<CronExtension>();
  for (const entry of parsed) collectExtensions(entry.ast, extensions);

  const result: ParsedExpression = {
    ast,
    raw: {
      minute: minute.part.text,
      hour: hour.part.text,
      dayOfMonth: dayOfMonth.part.text,
      month: month.part.text,
      dayOfWeek: dayOfWeek.part.text,
    },
    extensions: [...extensions],
  };
  if (seconds !== undefined) result.raw.seconds = seconds.part.text;
  if (macro !== undefined) result.macro = macro;
  return result;
}
