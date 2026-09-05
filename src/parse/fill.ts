import { formatField } from "../cron/values";
import { formatHour } from "../explain/time";
import type {
  Ambiguity,
  CronExtension,
  FieldAST,
  ParseOptions,
  TimeOfDayWord,
  Token,
} from "../types";
import { type FreqUnit, TIME_OF_DAY } from "./dictionary";
import type { IntervalValue, TimeValue } from "./tokenize";

export interface Penalty {
  reason: string;
  amount: number;
}

export interface Slots {
  minute: FieldAST;
  hour: FieldAST;
  dom: FieldAST;
  month: FieldAST;
  dow: FieldAST;
  extensions: Set<CronExtension>;
  penalties: Penalty[];
  ambiguities: Ambiguity[];
  notes: string[];
  /** 意味のあるトークンが 1 つも無かった */
  empty: boolean;
}

const ANY: FieldAST = { kind: "any" };

const FREQ_LABELS: Record<FreqUnit, string> = {
  minute: "毎分",
  hour: "毎時",
  day: "毎日",
  week: "毎週",
  month: "毎月",
  year: "毎年",
};

/** 値の並びを、連続部分を範囲に畳んだ構文木にする */
function valuesToAst(values: number[]): FieldAST {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const first = sorted[0];
  if (first === undefined) return ANY;
  if (sorted.length === 1) return { kind: "value", value: first };

  const items: FieldAST[] = [];
  let from = first;
  let previous = first;
  const flush = () => {
    if (previous - from >= 2) items.push({ kind: "range", from, to: previous });
    else for (let value = from; value <= previous; value++) items.push({ kind: "value", value });
  };
  for (const value of sorted.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    flush();
    from = value;
    previous = value;
  }
  flush();
  const only = items[0];
  /* c8 ignore next -- items は必ず 1 個以上になる */
  if (only === undefined) return ANY;
  return items.length === 1 ? only : { kind: "list", items };
}

function hourCandidates(from: number, to: number): Ambiguity["candidates"] {
  const candidates: Ambiguity["candidates"] = [];
  for (let hour = from; hour <= to; hour++) {
    candidates.push({ value: hour, label: formatHour(hour, { style: "casual", hour: "12h" }) });
  }
  return candidates;
}

interface Collected {
  times: TimeValue[];
  timeMode: "list" | "range";
  minutes: number[];
  interval: IntervalValue | null;
  dows: number[];
  nths: Array<{ weekday: number; nth: number }>;
  doms: number[];
  domSpecial: "L" | number | null;
  months: number[];
  freqs: FreqUnit[];
  standaloneWords: TimeOfDayWord[];
  unknown: number;
  meaningful: number;
  todNotes: string[];
}

function collect(tokens: Token[]): Collected {
  const state: Collected = {
    times: [],
    timeMode: "list",
    minutes: [],
    interval: null,
    dows: [],
    nths: [],
    doms: [],
    domSpecial: null,
    months: [],
    freqs: [],
    standaloneWords: [],
    unknown: 0,
    meaningful: 0,
    todNotes: [],
  };

  let pendingWord: TimeOfDayWord | null = null;
  let pendingNth: number | null = null;

  const flushWord = () => {
    if (pendingWord !== null) {
      state.standaloneWords.push(pendingWord);
      pendingWord = null;
    }
  };

  for (const token of tokens) {
    if (token.type !== "UNKNOWN" && token.type !== "SEP") state.meaningful += 1;

    switch (token.type) {
      case "AMPM":
      case "TIME_OF_DAY":
        flushWord();
        pendingWord = token.value as TimeOfDayWord;
        break;

      case "TIME": {
        const time = token.value as TimeValue;
        let hour = time.hour;
        if (pendingWord !== null) {
          const spec = TIME_OF_DAY[pendingWord];
          const [low, high] = spec.range;
          if (pendingWord === "午前" && hour === 12) {
            // 「午前12時」は 0 時
            hour = 0;
          } else if (hour < low || hour > high) {
            if (hour + 12 >= low && hour + 12 <= high) {
              hour += 12;
            } else {
              state.todNotes.push(
                `「${pendingWord}」は通常 ${low}時から${high}時ですが、${hour}時と解釈しました`,
              );
            }
          }
          pendingWord = null;
        }
        state.times.push({ hour, minute: time.minute });
        break;
      }

      case "MINUTE":
        flushWord();
        state.minutes.push(token.value as number);
        break;

      case "INTERVAL":
        flushWord();
        state.interval = token.value as IntervalValue;
        break;

      case "RANGE_FROM":
        if (state.times.length > 0) state.timeMode = "range";
        break;

      case "RANGE_TO":
        break;

      case "NTH":
        flushWord();
        pendingNth = token.value as number;
        break;

      case "DOW": {
        flushWord();
        const weekday = token.value as number;
        if (pendingNth !== null) {
          state.nths.push({ weekday, nth: pendingNth });
          pendingNth = null;
        } else {
          state.dows.push(weekday);
        }
        break;
      }

      case "DOW_SET":
        flushWord();
        state.dows.push(...(token.value as number[]));
        break;

      case "DOM":
        flushWord();
        state.doms.push(token.value as number);
        break;

      case "DOM_SPECIAL": {
        flushWord();
        const value = token.value as "L" | number;
        if (value === "L") state.domSpecial = "L";
        else state.doms.push(value);
        break;
      }

      case "MONTH":
        flushWord();
        state.months.push(token.value as number);
        break;

      case "FREQ":
        flushWord();
        state.freqs.push(token.value as FreqUnit);
        break;

      default:
        if (token.type === "UNKNOWN") state.unknown += 1;
        break;
    }
  }

  flushWord();
  return state;
}

/**
 * トークン列から cron の各フィールドを埋める。
 */
export function fill(tokens: Token[], options: ParseOptions = {}): Slots {
  const requested = options.defaultHour ?? 9;
  const defaultHour =
    Number.isInteger(requested) && requested >= 0 && requested <= 23 ? requested : 9;
  const state = collect(tokens);

  const slots: Slots = {
    minute: ANY,
    hour: ANY,
    dom: ANY,
    month: ANY,
    dow: ANY,
    extensions: new Set<CronExtension>(),
    penalties: [],
    ambiguities: [],
    notes: [...state.todNotes],
    empty: state.meaningful === 0,
  };
  if (slots.empty) return slots;

  const penalize = (reason: string, amount: number) => {
    slots.penalties.push({ reason, amount });
  };

  /* ---------------- 時刻 ---------------- */

  const rangeTimes = state.timeMode === "range" && state.times.length >= 2;
  const noteHourRange = () => {
    const from = state.times[0];
    const to = state.times[1];
    /* c8 ignore next -- rangeTimes が真なら 2 件ある */
    if (from === undefined || to === undefined) return;
    slots.notes.push(
      `「${to.hour}時まで」を ${to.hour}時台まで（${from.hour}-${to.hour}）と解釈しました。` +
        `${to.hour}:00 で終える場合は ${from.hour}-${to.hour - 1} を指定してください`,
    );
    penalize("時刻範囲の終端が曖昧", 0.1);
  };

  const hourRangeAst = (): FieldAST | null => {
    const from = state.times[0];
    const to = state.times[1];
    /* c8 ignore next -- rangeTimes が真なら 2 件ある */
    if (from === undefined || to === undefined) return null;
    return { kind: "range", from: from.hour, to: to.hour };
  };

  if (state.freqs.includes("minute")) {
    slots.minute = ANY;
    slots.hour = ANY;
  } else if (state.interval !== null && state.interval.unit !== "day") {
    const interval = state.interval;
    if (interval.unit === "minute") {
      slots.minute = { kind: "step", base: ANY, step: interval.n };
    } else {
      slots.hour = { kind: "step", base: ANY, step: interval.n };
      const minute = state.minutes[0] ?? state.times[0]?.minute ?? 0;
      slots.minute = { kind: "value", value: minute };
    }

    if (rangeTimes) {
      const range = hourRangeAst();
      if (range !== null) {
        slots.hour =
          interval.unit === "hour" && range.kind === "range"
            ? { kind: "step", base: range, step: interval.n }
            : range;
      }
      noteHourRange();
    } else if (state.times.length > 0) {
      const first = state.times[0];
      /* c8 ignore next -- times.length > 0 なら必ず取れる */
      if (first !== undefined && interval.unit === "minute") {
        slots.hour = { kind: "value", value: first.hour };
      }
      slots.ambiguities.push({
        field: "hour",
        question: "「〜ごと」と時刻の両方が指定されています。どちらの意味ですか？",
        candidates: [
          { value: "interval", label: "指定した間隔で繰り返す" },
          { value: "at", label: "指定した時刻にだけ実行する" },
        ],
      });
      penalize("間隔と時刻の併用", 0.2);
    }
  } else if (state.times.length > 0) {
    if (rangeTimes) {
      const range = hourRangeAst();
      if (range !== null) slots.hour = range;
      slots.minute = { kind: "value", value: state.times[0]?.minute ?? 0 };
      noteHourRange();
    } else {
      const hours = state.times.map((time) => time.hour);
      const minutes = [...new Set(state.times.map((time) => time.minute))];
      slots.hour = valuesToAst(hours);
      const only = minutes[0];
      if (minutes.length === 1 && only !== undefined) {
        slots.minute = { kind: "value", value: only };
      } else {
        slots.minute = valuesToAst(minutes);
        slots.notes.push(
          "複数の時刻が指定されているため、時と分のすべての組み合わせで実行されます",
        );
        penalize("時と分の組み合わせが曖昧", 0.1);
      }
    }
  } else if (state.standaloneWords.length > 0) {
    const word = state.standaloneWords[state.standaloneWords.length - 1] as TimeOfDayWord;
    const spec = TIME_OF_DAY[word];
    const override = options.timeOfDay?.[word];
    const hour = override ?? spec.default ?? defaultHour;
    slots.hour = { kind: "value", value: hour };
    slots.minute = { kind: "value", value: 0 };
    // 「正午」のように時が一意に定まる語は曖昧ではない
    if (spec.range[0] !== spec.range[1] && override === undefined) {
      slots.ambiguities.push({
        field: "hour",
        question: `「${word}」は何時ですか？`,
        candidates: hourCandidates(spec.range[0], spec.range[1]),
      });
      penalize("時刻を表す語が曖昧", 0.3);
    }
  } else if (state.freqs.includes("hour")) {
    slots.hour = ANY;
    slots.minute = { kind: "value", value: state.minutes[0] ?? 0 };
  } else if (state.minutes.length > 0) {
    slots.hour = ANY;
    slots.minute = valuesToAst(state.minutes);
  } else {
    slots.hour = { kind: "value", value: defaultHour };
    slots.minute = { kind: "value", value: 0 };
    const freqLabel = state.freqs[0] === undefined ? undefined : FREQ_LABELS[state.freqs[0]];
    slots.ambiguities.push({
      field: "hour",
      question: freqLabel === undefined ? "何時に実行しますか？" : `「${freqLabel}」は何時ですか？`,
      candidates: hourCandidates(0, 23),
    });
    penalize("時刻が指定されていない", 0.4);
  }

  /* ---------------- 日付・曜日 ---------------- */

  if (state.nths.length > 0) {
    const items = state.nths.map<FieldAST>((entry) => ({
      kind: "nth",
      weekday: entry.weekday,
      nth: entry.nth,
    }));
    const first = items[0];
    /* c8 ignore next -- nths.length > 0 なら必ず取れる */
    slots.dow = items.length === 1 && first !== undefined ? first : { kind: "list", items };
    for (const entry of state.nths) slots.extensions.add(entry.nth === -1 ? "L" : "#");
  } else if (state.dows.length > 0) {
    slots.dow = valuesToAst(state.dows);
  }

  if (state.domSpecial === "L") {
    slots.dom = { kind: "last" };
    slots.extensions.add("L");
  } else if (state.doms.length > 0) {
    slots.dom = valuesToAst(state.doms);
  } else if (state.interval?.unit === "day") {
    slots.dom = { kind: "step", base: ANY, step: state.interval.n };
  }

  if (state.months.length > 0) slots.month = valuesToAst(state.months);

  /* ---------------- 頻度語の期待 ---------------- */

  const domSpecified = slots.dom.kind !== "any";
  const dowSpecified = slots.dow.kind !== "any";

  for (const freq of state.freqs) {
    if (freq === "day" && (domSpecified || dowSpecified)) {
      slots.notes.push(
        "「毎日」と日付・曜日の指定が同時にあるため、日付・曜日の指定を優先しました",
      );
      penalize("頻度語と日付指定の不一致", 0.1);
    }
    if (freq === "week" && !dowSpecified) {
      slots.dow = { kind: "value", value: 1 };
      slots.ambiguities.push({
        field: "dayOfWeek",
        question: "「毎週」は何曜日ですか？",
        candidates: [
          { value: 0, label: "日曜日" },
          { value: 1, label: "月曜日" },
          { value: 2, label: "火曜日" },
          { value: 3, label: "水曜日" },
          { value: 4, label: "木曜日" },
          { value: 5, label: "金曜日" },
          { value: 6, label: "土曜日" },
        ],
      });
      penalize("「毎週」の曜日が未指定", 0.3);
    }
    if (freq === "month" && !domSpecified && !dowSpecified) {
      slots.dom = { kind: "value", value: 1 };
      slots.ambiguities.push({
        field: "dayOfMonth",
        question: "「毎月」は何日ですか？",
        candidates: [
          { value: 1, label: "1日" },
          { value: 15, label: "15日" },
          { value: "L", label: "月末" },
        ],
      });
      penalize("「毎月」の日が未指定", 0.3);
    }
    if (freq === "year" && slots.month.kind === "any") {
      slots.month = { kind: "value", value: 1 };
      if (slots.dom.kind === "any") slots.dom = { kind: "value", value: 1 };
      slots.ambiguities.push({
        field: "month",
        question: "「毎年」は何月ですか？",
        candidates: Array.from({ length: 12 }, (_, index) => ({
          value: index + 1,
          label: `${index + 1}月`,
        })),
      });
      penalize("「毎年」の月が未指定", 0.3);
    }
  }

  /* ---------------- 衝突・減点 ---------------- */

  if (slots.dom.kind !== "any" && slots.dow.kind !== "any") {
    slots.notes.push(
      "標準の cron では日と曜日を同時に指定すると OR 条件になり、どちらかに一致する日に実行されます",
    );
    penalize("日と曜日の同時指定", 0.2);
  }

  const hasDateToken =
    state.dows.length > 0 ||
    state.nths.length > 0 ||
    state.doms.length > 0 ||
    state.domSpecial !== null ||
    state.months.length > 0;
  if (state.freqs.length === 0 && !hasDateToken && state.interval === null) {
    slots.notes.push("頻度が明示されていないため、毎日として解釈しました");
    penalize("頻度語が無い", 0.2);
  }

  if (slots.extensions.size > 0 && options.allowExtensions !== true) {
    const used = [...slots.extensions].join("', '");
    slots.notes.push(
      `'${used}' は Quartz 拡張です。標準の cron では動作しません（allowExtensions で抑制できます）`,
    );
    penalize("拡張構文の使用", 0.1);
  }

  if (state.unknown > 0) {
    penalize("解釈できない語", Math.min(0.3, state.unknown * 0.1));
  }

  return slots;
}

/** スロットを cron 式にする */
export function emit(slots: Slots): string {
  return [slots.minute, slots.hour, slots.dom, slots.month, slots.dow].map(formatField).join(" ");
}
