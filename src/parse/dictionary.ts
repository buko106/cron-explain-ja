import type { TimeOfDayWord } from "../types";

export const DOW: Record<string, number> = {
  日曜日: 0,
  日曜: 0,
  月曜日: 1,
  月曜: 1,
  火曜日: 2,
  火曜: 2,
  水曜日: 3,
  水曜: 3,
  木曜日: 4,
  木曜: 4,
  金曜日: 5,
  金曜: 5,
  土曜日: 6,
  土曜: 6,
};

export const DOW_SET: Record<string, number[]> = {
  平日: [1, 2, 3, 4, 5],
  週末: [0, 6],
  土日: [0, 6],
};

export interface TimeOfDaySpec {
  /** 既定の時。null は「時そのものは決まらない」 */
  default: number | null;
  /** その語が自然に指す時間帯 */
  range: readonly [number, number];
}

export const TIME_OF_DAY: Record<TimeOfDayWord, TimeOfDaySpec> = {
  早朝: { default: 6, range: [4, 7] },
  朝: { default: 9, range: [6, 10] },
  午前: { default: null, range: [0, 11] },
  昼: { default: 12, range: [11, 13] },
  正午: { default: 12, range: [12, 12] },
  午後: { default: null, range: [12, 23] },
  夕方: { default: 18, range: [16, 19] },
  夜: { default: 21, range: [19, 23] },
  深夜: { default: 2, range: [0, 4] },
  夜中: { default: 2, range: [0, 4] },
};

export type FreqUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

export const FREQ: Record<string, FreqUnit> = {
  毎分: "minute",
  毎時: "hour",
  毎日: "day",
  毎週: "week",
  毎月: "month",
  毎年: "year",
};

export const DOM_SPECIAL: Record<string, "L" | number> = { 月末: "L", 月初: 1 };

export const NTH: Record<string, number> = {
  第1: 1,
  第2: 2,
  第3: 3,
  第4: 4,
  第5: 5,
  最終: -1,
  最後: -1,
};

/** 曜日語として認識する表記（「月」「日」単独は月名・日付と衝突するため含めない） */
export const DOW_HEADS = ["日", "月", "火", "水", "木", "金", "土"] as const;
