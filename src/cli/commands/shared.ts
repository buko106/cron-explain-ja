import type { CliArgs } from "../args";
import { CliUsageError } from "../args";
import type { IO } from "../io";
import { dim, red, yellow } from "../io";

export const EXIT_OK = 0;
export const EXIT_INTERNAL = 1;
export const EXIT_INPUT = 2;
export const EXIT_AMBIGUOUS = 3;

/** 全角文字を 2 桁として数えた表示幅 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 0x1100 && code < 0xff61 ? 2 : 1;
  }
  return width;
}

export function padDisplay(text: string, width: number): string {
  const padding = width - displayWidth(text);
  return padding > 0 ? text + " ".repeat(padding) : text;
}

export function stringOption(args: CliArgs, name: string): string | undefined {
  const value = args.values[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CliUsageError(`--${name} には値が必要です`);
  }
  return value;
}

export function boolOption(args: CliArgs, name: string): boolean {
  return args.values[name] === true;
}

export function enumOption<T extends string>(
  args: CliArgs,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = stringOption(args, name);
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T)) {
    throw new CliUsageError(`--${name} には ${allowed.join("|")} のいずれかを指定してください`);
  }
  return value as T;
}

export function intOption(args: CliArgs, name: string, fallback: number): number {
  const value = stringOption(args, name);
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(value)) {
    throw new CliUsageError(`--${name} には整数を指定してください`);
  }
  return Number(value);
}

/**
 * 位置引数、あるいは標準入力から入力を集める。
 */
export async function collectInputs(args: CliArgs, io: IO): Promise<string[]> {
  const positionals = args.positionals.filter((value) => value !== "-");
  const wantsStdin = args.positionals.includes("-") || positionals.length === 0;
  if (!wantsStdin) return [positionals.join(" ")];

  if (!args.positionals.includes("-") && io.stdinIsTTY) {
    throw new CliUsageError("入力がありません");
  }
  const lines = await io.readLines();
  if (lines.length === 0) throw new CliUsageError("入力がありません");
  return lines;
}

export function reportError(io: IO, message: string): void {
  io.err(`${red(io, "error")}: ${message}`);
}

export function reportWarn(io: IO, message: string): void {
  io.err(`${yellow(io, "warn")}: ${message}`);
}

export function reportNote(io: IO, message: string): void {
  io.err(`${dim(io, "note")}: ${message}`);
}

const DOW_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 「2026-09-07 (月) 09:00」 */
export function formatDateHuman(
  date: Date,
  options: { tz?: "UTC" | "local"; seconds?: boolean } = {},
): string {
  const utc = options.tz === "UTC";
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const second = utc ? date.getUTCSeconds() : date.getSeconds();
  const weekday = DOW_SHORT[utc ? date.getUTCDay() : date.getDay()] ?? "";
  const time =
    options.seconds === true
      ? `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
      : `${pad2(hour)}:${pad2(minute)}`;
  return `${year}-${pad2(month)}-${pad2(day)} (${weekday}) ${time}`;
}
