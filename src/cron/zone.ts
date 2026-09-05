import { CronTimeZoneError } from "../errors";

/** 既定のタイムゾーン。実行環境のローカル時刻には依存しない */
export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

/** 実行環境のタイムゾーンを指す特別な値 */
export const LOCAL_TIME_ZONE = "local";

/**
 * ある瞬間をタイムゾーンで読んだ壁時計。
 */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

/**
 * 壁時計と瞬間を相互に変換する。
 */
export interface Clock {
  /** その瞬間の壁時計 */
  parts(date: Date): WallClock;
  /** 壁時計が指す瞬間。夏時間の扱いは {@link zoneMake} を参照 */
  make(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
  ): Date;
}

const DAY_MS = 86_400_000;

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Intl.DateTimeFormat の生成は重いのでゾーンごとに使い回す */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // hour12: false は環境によって 0 時を 24 と読ませるため h23 を使う
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  formatters.set(timeZone, created);
  return created;
}

/**
 * `'local'` を実行環境のゾーン名に、未指定を {@link DEFAULT_TIME_ZONE} に解決し、
 * IANA の正規名に揃えて返す。
 *
 * @throws {CronTimeZoneError} 実行環境が知らないゾーン名の場合
 */
export function resolveTimeZone(tz?: string): string {
  if (tz === undefined) return DEFAULT_TIME_ZONE;
  const requested =
    tz === LOCAL_TIME_ZONE ? new Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: requested }).resolvedOptions().timeZone;
  } catch {
    throw new CronTimeZoneError(`タイムゾーン '${tz}' を解釈できません`, tz);
  }
}

function zoneParts(timeZone: string, date: Date): WallClock {
  const found: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    // h23 でも 24 を返す実装が過去にあったため丸めておく
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
    dayOfWeek: WEEKDAYS[found.weekday ?? ""] ?? 0,
  };
}

/** その瞬間のゾーンオフセット(ms)。壁時計を UTC とみなした値 - 実時刻 */
function zoneOffset(timeZone: string, time: number): number {
  const parts = zoneParts(timeZone, new Date(time));
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    Math.floor(time / 1000) * 1000
  );
}

/**
 * 壁時計 → 瞬間。夏時間の境界では次のように決める。
 *
 * - 壁時計が 2 回ある（秋の巻き戻し）: 早い方を返す
 * - 壁時計が存在しない（春の飛び）: 切り替え直後に寄せる（Vixie cron / cron-parser と同じ）
 *
 * 前後 1 日のオフセットから候補を作って往復検証する方法は ECMA-402 と同じ。
 */
function zoneMake(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const before = zoneOffset(timeZone, guess - DAY_MS);
  const after = zoneOffset(timeZone, guess + DAY_MS);
  // 前後 1 日でオフセットが同じなら切り替えは挟まっていない（ほぼ全てのケース）
  if (before === after) return new Date(guess - before);

  for (const candidate of [guess - before, guess - after].sort((a, b) => a - b)) {
    // 壁時計が要求どおりに戻る候補だけが実在する。重なりでは早い方を採る
    if (zoneOffset(timeZone, candidate) === guess - candidate) return new Date(candidate);
  }
  // どちらも戻らない = その壁時計は存在しない。切り替え前のオフセットで読むと直後に落ちる
  return new Date(guess - before);
}

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

const clocks = new Map<string, Clock>([["UTC", utcClock]]);

/**
 * 解決済みのゾーン名に対する {@link Clock} を返す。
 */
export function clockFor(timeZone: string): Clock {
  const cached = clocks.get(timeZone);
  if (cached !== undefined) return cached;
  const created: Clock = {
    parts: (date) => zoneParts(timeZone, date),
    make: (year, month, day, hour, minute, second) =>
      zoneMake(timeZone, year, month, day, hour, minute, second),
  };
  clocks.set(timeZone, created);
  return created;
}

/** その瞬間のゾーンオフセット(分)。UTC より東が正 */
export function offsetMinutes(timeZone: string, date: Date): number {
  return zoneOffset(timeZone, date.getTime()) / 60_000;
}
