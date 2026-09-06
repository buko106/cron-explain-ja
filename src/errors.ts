import type { CronField, ParseResult } from "./types";

/**
 * cron 式の構文エラー。
 */
export class CronSyntaxError extends Error {
  readonly field?: CronField;
  readonly position?: number;

  constructor(message: string, options: { field?: CronField; position?: number } = {}) {
    super(message);
    this.name = "CronSyntaxError";
    if (options.field !== undefined) this.field = options.field;
    if (options.position !== undefined) this.position = options.position;
  }
}

/**
 * `parse({ strict: true })` で解釈が曖昧だったときに投げられる。
 */
export class ParseAmbiguityError extends Error {
  readonly result: ParseResult;

  constructor(message: string, result: ParseResult) {
    super(message);
    this.name = "ParseAmbiguityError";
    this.result = result;
  }
}

/**
 * タイムゾーン名を解釈できなかったときに投げられる。
 */
export class CronTimeZoneError extends Error {
  /** 与えられたゾーン名 */
  readonly timeZone: string;

  constructor(message: string, timeZone: string) {
    super(message);
    this.name = "CronTimeZoneError";
    this.timeZone = timeZone;
  }
}
