import {
  fixedOffsetMinutes,
  offsetMinutes,
  resolveTimeZone,
  SERVER_TIME_ZONE,
  shiftExpression,
  wallClock,
} from "../../cron";
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

/**
 * ゾーン名を解決する。解釈できなければ {@link CliUsageError}（exit 2）にする。
 */
export function resolveZone(tz: string | undefined): string {
  try {
    return resolveTimeZone(tz);
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * `tz` の壁時計で書かれた cron 式を、UTC のサーバー向けに書き換える。
 *
 * @throws {CronTimeZoneError} UTC の cron 式で表せない場合
 */
export function shiftToServer(expression: string, tz: string): string {
  if (tz === SERVER_TIME_ZONE) return expression;
  return shiftExpression(expression, -fixedOffsetMinutes(tz), tz);
}

/**
 * 「2026-09-07 (月) 09:00」。壁時計は `tz`（解決済みのゾーン名）で読む。
 */
export function formatDateHuman(date: Date, options: { tz: string; seconds?: boolean }): string {
  const wall = wallClock(options.tz, date);
  const weekday = DOW_SHORT[wall.dayOfWeek] ?? "";
  const time =
    options.seconds === true
      ? `${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}`
      : `${pad2(wall.hour)}:${pad2(wall.minute)}`;
  return `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)} (${weekday}) ${time}`;
}

/**
 * 「2026-09-07T09:00:00+09:00」。オフセット 0 は `Z` で表す。
 */
export function formatDateIso(date: Date, tz: string): string {
  const wall = wallClock(tz, date);
  const offset = offsetMinutes(tz, date);
  const absolute = Math.abs(offset);
  const zone =
    offset === 0
      ? "Z"
      : `${offset < 0 ? "-" : "+"}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
  const day = `${String(wall.year).padStart(4, "0")}-${pad2(wall.month)}-${pad2(wall.day)}`;
  return `${day}T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}${zone}`;
}
