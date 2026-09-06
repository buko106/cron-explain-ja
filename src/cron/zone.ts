import { CronTimeZoneError } from "../errors";

/**
 * 自然言語（日本語）側の既定のタイムゾーン。
 *
 * cron 式は常に UTC のサーバーで動くものとして扱い、日本語はこのゾーンの壁時計として読む。
 */
export const DEFAULT_TIME_ZONE = "Asia/Tokyo";

/** 実行環境のタイムゾーンを指す特別な値 */
export const LOCAL_TIME_ZONE = "local";

/** cron 式が動くサーバーのタイムゾーン。固定 */
export const SERVER_TIME_ZONE = "UTC";

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

/** その瞬間の壁時計 */
export function wallClock(timeZone: string, date: Date): WallClock {
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

/** その瞬間のゾーンオフセット(分)。UTC より東が正 */
export function offsetMinutes(timeZone: string, date: Date): number {
  const parts = wallClock(timeZone, date);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

const fixedOffsets = new Map<string, number>();

/**
 * 年間を通して変わらないゾーンオフセット(分)を返す。
 *
 * cron 式の書き換えは固定のオフセットでしか行えないため、夏時間のあるゾーンは
 * ここで弾く。1 か月ごとに 12 点サンプルして、すべて同じであることを確かめる。
 *
 * @throws {CronTimeZoneError} 年内でオフセットが変わる（＝夏時間がある）場合
 */
export function fixedOffsetMinutes(timeZone: string, reference: Date = new Date()): number {
  const year = reference.getUTCFullYear();
  const key = `${timeZone}@${year}`;
  const cached = fixedOffsets.get(key);
  if (cached !== undefined) return cached;

  const offsets = new Set<number>();
  for (let month = 0; month < 12; month += 1) {
    offsets.add(offsetMinutes(timeZone, new Date(Date.UTC(year, month, 15, 12))));
  }
  const [offset] = [...offsets];
  if (offsets.size > 1 || offset === undefined) {
    throw new CronTimeZoneError(
      `${timeZone} は ${year} 年に夏時間があるため、cron 式を固定のオフセットに書き換えられません`,
      timeZone,
    );
  }
  fixedOffsets.set(key, offset);
  return offset;
}
