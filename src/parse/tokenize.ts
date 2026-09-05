import type { TimeOfDayWord, Token } from "../types";
import { DOM_SPECIAL, DOW, DOW_SET, FREQ, type FreqUnit, NTH } from "./dictionary";

export type IntervalUnit = "minute" | "hour" | "day" | "week" | "month";

export interface IntervalValue {
  unit: IntervalUnit;
  n: number;
}

export interface TimeValue {
  hour: number;
  minute: number;
}

type Rule = [RegExp, (match: RegExpMatchArray) => Omit<Token, "raw" | "position"> | null];

function int(text: string | undefined): number {
  return Number(text ?? "0");
}

/** 範囲外の数値はトークンにしない（後続のルール、最終的には UNKNOWN に回す） */
function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/**
 * 長い表現から順に試すため、並び順に意味がある。
 *
 * 「毎」で終わる間隔（「15分毎」）は、後ろに頻度語の単位が続く場合だけ採らない。
 * 「1月毎日」を「1か月ごと」+「日」と切ってしまうのを避けるため。
 */
const RULES: Rule[] = [
  [
    /^(\d{1,2})時間(?:ごと|おき|毎(?![分時日週月年]))に?/,
    (m) => {
      const n = int(m[1]);
      if (!inRange(n, 1, 23)) return null;
      return { type: "INTERVAL", value: { unit: "hour", n } satisfies IntervalValue };
    },
  ],
  [
    /^(\d{1,2})分(?:ごと|おき|毎(?![分時日週月年]))に?/,
    (m) => {
      const n = int(m[1]);
      if (!inRange(n, 1, 59)) return null;
      return { type: "INTERVAL", value: { unit: "minute", n } satisfies IntervalValue };
    },
  ],
  [
    /^(\d{1,2})日(?:ごと|おき|毎(?![分時日週月年]))に?/,
    (m) => {
      const n = int(m[1]);
      if (!inRange(n, 1, 31)) return null;
      return { type: "INTERVAL", value: { unit: "day", n } satisfies IntervalValue };
    },
  ],
  [
    // 「か月」の表記ゆれ（か / ヶ / ヵ / ケ / カ / 箇）と、「3月ごと」の省略形を受ける
    /^(\d{1,2})[かカヵケヶ箇]?月(?:ごと|おき|毎(?![分時日週月年]))に?/,
    (m) => {
      const n = int(m[1]);
      if (!inRange(n, 1, 12)) return null;
      return { type: "INTERVAL", value: { unit: "month", n } satisfies IntervalValue };
    },
  ],
  [
    /^(\d{1,2})週間?(?:ごと|おき|毎(?![分時日週月年]))に?/,
    (m) => {
      const n = int(m[1]);
      if (!inRange(n, 1, 52)) return null;
      return { type: "INTERVAL", value: { unit: "week", n } satisfies IntervalValue };
    },
  ],
  [
    /^(\d{1,2}):(\d{2})/,
    (m) => {
      const hour = int(m[1]);
      const minute = int(m[2]);
      if (!inRange(hour, 0, 23) || !inRange(minute, 0, 59)) return null;
      return { type: "TIME", value: { hour, minute } satisfies TimeValue };
    },
  ],
  [
    /^(\d{1,2})時(半|(\d{1,2})分)?/,
    (m) => {
      const hour = int(m[1]);
      const minute = m[2] === "半" ? 30 : int(m[3]);
      if (!inRange(hour, 0, 23) || !inRange(minute, 0, 59)) return null;
      return { type: "TIME", value: { hour, minute } satisfies TimeValue };
    },
  ],
  [
    /^(\d{1,2})分/,
    (m) => {
      const value = int(m[1]);
      return inRange(value, 0, 59) ? { type: "MINUTE", value } : null;
    },
  ],
  [
    /^(第[1-5]|最終|最後)(週|の)?/,
    (m) => {
      const nth = NTH[m[1] ?? ""];
      return nth === undefined ? null : { type: "NTH", value: nth };
    },
  ],
  [
    /^(\d{1,2})月/,
    (m) => {
      const value = int(m[1]);
      return inRange(value, 1, 12) ? { type: "MONTH", value } : null;
    },
  ],
  [
    /^(\d{1,2})日/,
    (m) => {
      const value = int(m[1]);
      return inRange(value, 1, 31) ? { type: "DOM", value } : null;
    },
  ],
  [
    /^(平日|週末|土日)/,
    (m) => {
      const values = DOW_SET[m[1] ?? ""];
      return values === undefined ? null : { type: "DOW_SET", value: [...values] };
    },
  ],
  [
    /^(日|月|火|水|木|金|土)曜日?/,
    (m) => {
      const value = DOW[`${m[1]}曜`];
      return value === undefined ? null : { type: "DOW", value };
    },
  ],
  [
    /^毎?(月末|月初)/,
    (m) => {
      const value = DOM_SPECIAL[m[1] ?? ""];
      return value === undefined ? null : { type: "DOM_SPECIAL", value };
    },
  ],
  [
    /^(早朝|朝|正午|昼|夕方|夜中|深夜|夜|午前|午後)/,
    (m) => {
      const word = m[1] as TimeOfDayWord;
      if (word === "午前" || word === "午後") return { type: "AMPM", value: word };
      return { type: "TIME_OF_DAY", value: word };
    },
  ],
  [
    /^毎(分|時|日|週|月|年)/,
    (m) => {
      const unit: FreqUnit | undefined = FREQ[`毎${m[1]}`];
      return unit === undefined ? null : { type: "FREQ", value: unit };
    },
  ],
  [/^(から|以降)/, () => ({ type: "RANGE_FROM" })],
  [/^(まで|以前)/, () => ({ type: "RANGE_TO" })],
  [/^(および|かつ|と|、|,)/, () => ({ type: "AND" })],
  // 「9時台」は「9時00分」ではなく 9 時の中を指す。区切りとして捨てると
  // 「9時台の10分ごと」が間隔と単独時刻の併用に見えるので、専用のトークンにする
  [/^台/, () => ({ type: "HOUR_SPAN" })],
  [/^(の|に|は|が|を|\s|。)+/, () => ({ type: "SEP" })],
];

/**
 * 正規化済みの日本語をトークン列に分解する。
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;

  while (position < text.length) {
    const rest = text.slice(position);
    let matched = false;

    for (const [pattern, build] of RULES) {
      const match = pattern.exec(rest);
      if (match === null || match[0] === "") continue;
      const token = build(match);
      /* c8 ignore next -- 辞書引きに失敗した場合のみ。通常は起きない */
      if (token === null) continue;
      tokens.push({ ...token, raw: match[0], position });
      position += match[0].length;
      matched = true;
      break;
    }

    if (!matched) {
      tokens.push({ type: "UNKNOWN", raw: text[position] ?? "", position });
      position += 1;
    }
  }

  return tokens;
}
