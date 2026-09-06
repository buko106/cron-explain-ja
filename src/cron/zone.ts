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

/** 壁時計を UTC とみなしたミリ秒 */
function asUtc(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** その瞬間の壁時計と、そのときのゾーンオフセット(分) */
export function wallClockWithOffset(
  timeZone: string,
  date: Date,
): { wall: WallClock; offset: number } {
  const found: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(date)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  const year = Number(found.year);
  const month = Number(found.month);
  const day = Number(found.day);
  const wall: WallClock = {
    year,
    month,
    day,
    // h23 でも 24 を返す実装が過去にあったため丸めておく
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
    // 曜日は暦から求める。ICU の短縮形に依存すると、読めない綴りを黙って日曜にしてしまう
    dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
  return { wall, offset: (asUtc(wall) - Math.floor(date.getTime() / 1000) * 1000) / 60_000 };
}

/** その瞬間のゾーンオフセット(分)。UTC より東が正 */
function offsetMinutes(timeZone: string, date: Date): number {
  return wallClockWithOffset(timeZone, date).offset;
}

/**
 * 壁時計 → 瞬間。オフセットを 2 回反復して収束させる。
 *
 * 夏時間の境界にあたる壁時計では厳密には決まらないが、探索の起点にしか使わないので
 * 近い側に寄せれば足りる。
 */
export function instantAt(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - offsetMinutes(timeZone, new Date(guess)) * 60_000;
  return new Date(guess - offsetMinutes(timeZone, new Date(first)) * 60_000);
}

const fixedOffsets = new Map<string, number>();

/**
 * 変わらないゾーンオフセット(分)を返す。
 *
 * cron 式の書き換えは固定のオフセットでしか行えないため、オフセットが動くゾーンは
 * ここで弾く。書き換えた式は crontab に貼られたあと何年も動き続けるので、
 * 今年だけでなく**翌年まで**を 1 か月ごとにサンプルして、すべて同じであることを確かめる
 * （夏時間を来年から始める国を今年のぶんだけ見て通すと、半年ずれた式を黙って出すことになる）。
 *
 * @throws {CronTimeZoneError} 期間内でオフセットが変わる場合
 */
export function fixedOffsetMinutes(timeZone: string, reference: Date = new Date()): number {
  const year = reference.getUTCFullYear();
  const key = `${timeZone}@${year}`;
  const cached = fixedOffsets.get(key);
  if (cached !== undefined) return cached;

  const offsets = new Set<number>();
  for (let month = 0; month < 24; month += 1) {
    offsets.add(offsetMinutes(timeZone, new Date(Date.UTC(year, month, 15, 12))));
  }
  const [offset] = [...offsets];
  if (offsets.size > 1 || offset === undefined) {
    throw new CronTimeZoneError(
      `${timeZone} は ${year}-${year + 1} 年にオフセットが変わる（夏時間など）ため、` +
        "cron 式を固定のオフセットに書き換えられません",
      timeZone,
    );
  }
  fixedOffsets.set(key, offset);
  return offset;
}
