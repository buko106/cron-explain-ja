/**
 * cron 式のフィールド識別子。
 */
export type CronField = "second" | "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";

/**
 * 標準 cron を超える拡張構文。
 * - `L`: 月末 / 最終曜日
 * - `#`: 第 N 曜日
 * - `W`: 直近の平日
 * - `?`: 指定なし
 */
export type CronExtension = "L" | "#" | "W" | "?";

/**
 * 1 フィールドの構文木。
 *
 * `nth.nth` は 1-5 が第 N 曜日、`-1` が最終曜日（`5L`）を表す。
 */
export type FieldAST =
  | { kind: "any" }
  | { kind: "value"; value: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "step"; base: FieldAST; step: number }
  | { kind: "list"; items: FieldAST[] }
  | { kind: "last"; offset?: number }
  | { kind: "nth"; weekday: number; nth: number }
  | { kind: "nearestWeekday"; day: number }
  | { kind: "noSpecific" };

export type FieldKind = FieldAST["kind"];

/**
 * cron 式全体の構文木。
 */
export interface CronAST {
  seconds?: FieldAST;
  minute: FieldAST;
  hour: FieldAST;
  dayOfMonth: FieldAST;
  month: FieldAST;
  dayOfWeek: FieldAST;
}

export interface ParserOptions {
  /** 6 フィールド（秒付き）として解釈する */
  seconds?: boolean;
}

/* ------------------------------------------------------------------ */
/* explain                                                             */
/* ------------------------------------------------------------------ */

export interface ExplainOptions extends ParserOptions {
  /** 'casual': 「毎日午前9時」 / 'formal': 「毎日午前9時00分」 */
  style?: "casual" | "formal";
  /** '12h': 「午後3時」 / '24h': 「15時」 */
  hour?: "12h" | "24h";
  /**
   * cron 式が動くタイムゾーン。IANA のゾーン名か `'local'`。
   *
   * `explain` では指定したときだけ末尾に「（Asia/Tokyo）」と併記する（既定では付けない）。
   * `explainDetailed` では `next` の計算にも使う（未指定なら 'Asia/Tokyo'）。
   */
  tz?: string;
  /** 曜日を「平日」「週末」に畳むか */
  collapseWeekdays?: boolean;
}

export interface FieldExplanation {
  /** 入力そのまま（正規化前） */
  raw: string;
  kind: "any" | "value" | "list" | "range" | "step" | "extension";
  /** 展開後の値。拡張構文では空配列 */
  values: number[];
  text: string;
}

export interface Explanation {
  text: string;
  /** 正規化済みの cron 式 */
  expression: string;
  fields: {
    second?: FieldExplanation;
    minute: FieldExplanation;
    hour: FieldExplanation;
    dayOfMonth: FieldExplanation;
    month: FieldExplanation;
    dayOfWeek: FieldExplanation;
  };
  extensions: CronExtension[];
  notes: string[];
  /** 次回 3 回。拡張構文を含む式では空配列 */
  next: Date[];
}

/* ------------------------------------------------------------------ */
/* parse                                                               */
/* ------------------------------------------------------------------ */

export type TimeOfDayWord =
  | "早朝"
  | "朝"
  | "午前"
  | "昼"
  | "正午"
  | "午後"
  | "夕方"
  | "夜"
  | "深夜"
  | "夜中";

export type TokenType =
  | "FREQ"
  | "DOW"
  | "DOW_SET"
  | "DOM"
  | "DOM_SPECIAL"
  | "MONTH"
  | "TIME"
  | "MINUTE"
  | "TIME_OF_DAY"
  | "AMPM"
  | "HOUR_SPAN"
  | "INTERVAL"
  | "RANGE_FROM"
  | "RANGE_TO"
  | "NTH"
  | "SEP"
  | "AND"
  | "UNKNOWN";

export interface Token {
  type: TokenType;
  raw: string;
  value?: unknown;
  position: number;
}

export interface Ambiguity {
  field: CronField;
  question: string;
  candidates: Array<{ value: number | string; label: string }>;
}

export interface ParseResult {
  expression: string | null;
  /** 0.0 - 1.0 */
  confidence: number;
  ambiguities: Ambiguity[];
  notes: string[];
  tokens: Token[];
}

export interface ParseOptions {
  /** 曖昧な場合に ParseAmbiguityError を投げる */
  strict?: boolean;
  /** 時刻が読み取れなかったときの既定の時 */
  defaultHour?: number;
  /** 「朝」などの曖昧語に対する時の上書き */
  timeOfDay?: Partial<Record<TimeOfDayWord, number>>;
  /** L / # / W の使用を許可する（false でも生成はするが note を付ける） */
  allowExtensions?: boolean;
}

/* ------------------------------------------------------------------ */
/* validate / next                                                     */
/* ------------------------------------------------------------------ */

export interface ValidationError {
  field: CronField | "expression";
  message: string;
  position?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface NextOptions extends ParserOptions {
  /** 起点。既定は現在時刻 */
  from?: Date;
  /** 取得件数。既定は 3 */
  count?: number;
  /**
   * 壁時計を解釈するタイムゾーン。IANA のゾーン名（'Asia/Tokyo' 'America/New_York' …）か、
   * 実行環境のゾーンを指す `'local'`。既定は 'Asia/Tokyo'
   */
  tz?: string;
}
