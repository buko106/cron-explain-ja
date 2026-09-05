import type { CronField } from "../types";

export interface FieldSpec {
  field: CronField;
  /** エラーメッセージ用の日本語名 */
  label: string;
  /** 展開後の下限 */
  min: number;
  /** 展開後の上限 */
  max: number;
  /** 入力として許容する上限（曜日のみ 7） */
  inputMax: number;
  /** 名前による指定（JAN, MON など） */
  names?: Record<string, number>;
}

export const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

export const DOW_NAMES: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export const SECOND_SPEC: FieldSpec = {
  field: "second",
  label: "秒",
  min: 0,
  max: 59,
  inputMax: 59,
};
export const MINUTE_SPEC: FieldSpec = {
  field: "minute",
  label: "分",
  min: 0,
  max: 59,
  inputMax: 59,
};
export const HOUR_SPEC: FieldSpec = { field: "hour", label: "時", min: 0, max: 23, inputMax: 23 };
export const DOM_SPEC: FieldSpec = {
  field: "dayOfMonth",
  label: "日",
  min: 1,
  max: 31,
  inputMax: 31,
};
export const MONTH_SPEC: FieldSpec = {
  field: "month",
  label: "月",
  min: 1,
  max: 12,
  inputMax: 12,
  names: MONTH_NAMES,
};
export const DOW_SPEC: FieldSpec = {
  field: "dayOfWeek",
  label: "曜日",
  min: 0,
  max: 6,
  inputMax: 7,
  names: DOW_NAMES,
};

/** 5 フィールド式の並び */
export const FIELD_SPECS: FieldSpec[] = [MINUTE_SPEC, HOUR_SPEC, DOM_SPEC, MONTH_SPEC, DOW_SPEC];

/** 6 フィールド（秒付き）式の並び */
export const FIELD_SPECS_WITH_SECONDS: FieldSpec[] = [SECOND_SPEC, ...FIELD_SPECS];

export const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export const DOW_LABELS = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
