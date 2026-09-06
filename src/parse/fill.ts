import { DOM_SPEC, type FieldSpec, HOUR_SPEC, MINUTE_SPEC, MONTH_SPEC } from "../cron/fields";
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
import { DOW_SET_APPROX, type FreqUnit, TIME_OF_DAY } from "./dictionary";
import type { IntervalUnit, IntervalValue, TimeValue } from "./tokenize";

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

const INTERVAL_LABELS: Record<IntervalUnit, string> = {
  minute: "分",
  hour: "時",
  day: "日",
  week: "週",
  month: "月",
};

/** 値の並びを持つスロット。時刻は時と分を持つため別扱い */
type ListName = "minute" | "dom" | "dow" | "month";

/** 間隔の単位と、その起点になる値の並び */
const INTERVAL_LIST: Partial<Record<IntervalUnit, ListName>> = {
  minute: "minute",
  day: "dom",
  month: "month",
};

/** 値の並びの 1 要素。`from === to` は単独の値、それ以外は「AからBまで」 */
interface Span {
  from: number;
  to: number;
}

interface ValueList {
  items: Span[];
  /** 「から」を読んだが、範囲の終端がまだ来ていない */
  pendingRange: boolean;
  /** 刻みの起点、あるいは分の値として読み終えた（二重指定として数えない） */
  consumed: boolean;
}

function emptyList(): ValueList {
  return { items: [], pendingRange: false, consumed: false };
}

function pushValue(list: ValueList, value: number): void {
  const last = list.items[list.items.length - 1];
  if (list.pendingRange && last !== undefined) {
    last.to = value;
    list.pendingRange = false;
    return;
  }
  list.items.push({ from: value, to: value });
}

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

/**
 * 値の並びを構文木にする。
 * 「AからBまで」と書かれた範囲は範囲のまま残す（`valuesToAst` は 3 個以上の連なりしか
 * 範囲に畳まないため、`28,31` のように意味が変わってしまう）。
 */
function spansToAst(spans: Span[]): FieldAST {
  if (spans.every((span) => span.from === span.to)) {
    return valuesToAst(spans.map((span) => span.from));
  }
  const items = spans.map<FieldAST>((span) =>
    span.from === span.to
      ? { kind: "value", value: span.from }
      : { kind: "range", from: span.from, to: span.to },
  );
  const only = items[0];
  /* c8 ignore next -- 範囲を含むなら 1 個以上ある */
  if (only === undefined) return ANY;
  return items.length === 1 ? only : { kind: "list", items };
}

function listToAst(list: ValueList): FieldAST {
  return spansToAst(list.items);
}

/**
 * 「AからBまでNごと」「AからNごと」の起点を取り出す。
 * 範囲として書かれていなければ null を返し、値の並びは値のまま残す。
 */
function consumeBase(list: ValueList, spec: FieldSpec): FieldAST | null {
  const span = list.items[0];
  if (span === undefined || list.items.length !== 1) return null;
  if (!list.pendingRange && span.from === span.to) return null;
  list.consumed = true;
  return { kind: "range", from: span.from, to: list.pendingRange ? spec.max : span.to };
}

/**
 * 時刻の並びの 1 要素。時間帯語は `fill` で解決するまで語のまま持つ
 * （{@link resolveWord} が曖昧さと減点を積むため、`collect` では決められない）。
 */
type TimeAtom =
  | { kind: "time"; hour: number; minute: number }
  | { kind: "word"; word: TimeOfDayWord };

/** 時刻の並びの 1 要素。`to === null` は単独の時刻、それ以外は「AからBまで」 */
interface TimeSpan {
  from: TimeAtom;
  to: TimeAtom | null;
}

/** 値の並び（{@link ValueList}）の時刻版。範囲を 2 つ以上持てる */
interface TimeList {
  items: TimeSpan[];
  /** 「から」を読んだが、範囲の終端がまだ来ていない */
  pendingRange: boolean;
}

function pushTime(list: TimeList, atom: TimeAtom): void {
  const last = list.items[list.items.length - 1];
  if (list.pendingRange && last !== undefined) {
    last.to = atom;
    list.pendingRange = false;
    return;
  }
  list.items.push({ from: atom, to: null });
}

/** 時間帯語を解決した時刻 */
interface ResolvedTime {
  hour: number;
  minute: number;
}

interface ResolvedSpan {
  from: ResolvedTime;
  to: ResolvedTime | null;
}

/** 刻みの構文木。起点が全域を覆うなら省く（`1-31/3` は「3日ごと」と同じ集合） */
function stepAst(base: FieldAST | null, step: number, spec: FieldSpec): FieldAST {
  if (base === null) return { kind: "step", base: ANY, step };
  if (base.kind === "range" && base.from === spec.min && base.to === spec.max) {
    return { kind: "step", base: ANY, step };
  }
  return { kind: "step", base, step };
}

/**
 * 時から時間帯語の範囲までの距離（時間）。時計は巡回するので 23 時と 0 時は 1 時間差。
 */
function gapToRange(hour: number, [low, high]: readonly [number, number]): number {
  if (hour >= low && hour <= high) return 0;
  return Math.min((low - hour + 24) % 24, (hour - high + 24) % 24);
}

/**
 * 時間帯語と並んだ時を読む。
 *
 * 12 時までの数字は 12 時間制の書き方なので、そのままの時と 12 時間ずらした時のうち、
 * 語の指す時間帯に近い方を採る（「夜6時」→ 18時、「午後3時」→ 15時）。
 * 13 時以降は 24 時間制としか読めないので、そのまま採る（「朝22時」→ 22時）。
 *
 * 範囲に入っていなくても近い方を採るのは、境界のすぐ外側で読みが裏返らないようにするため。
 * 「夜」は 19 時からだが、「夜6時」を午前 6 時と読むのは行き過ぎで、離れたぶんは
 * {@link fill} が note と減点で伝える（§2.3.5）。
 *
 * 12 時のもう一方の読みは 0 時なので、「午前12時」「夜12時」はどちらも 0 時になる。
 */
function readHour(word: TimeOfDayWord, hour: number): { hour: number; gap: number } {
  const range = TIME_OF_DAY[word].range;
  const literal = { hour, gap: gapToRange(hour, range) };
  if (hour > 12) return literal;
  const shifted = (hour + 12) % 24;
  const alternative = { hour: shifted, gap: gapToRange(shifted, range) };
  return alternative.gap < literal.gap ? alternative : literal;
}

function hourCandidates(from: number, to: number): Ambiguity["candidates"] {
  const candidates: Ambiguity["candidates"] = [];
  for (let hour = from; hour <= to; hour++) {
    candidates.push({ value: hour, label: formatHour(hour, { style: "casual", hour: "12h" }) });
  }
  return candidates;
}

interface Collected {
  times: TimeList;
  /** 「9時台」のように、時そのものではなく時の中を指している */
  hourSpan: boolean;
  lists: Record<ListName, ValueList>;
  intervals: Partial<Record<IntervalUnit, number>>;
  /** 同じ単位の間隔が 2 回書かれた */
  duplicateIntervals: IntervalUnit[];
  /** 値の並びと間隔のどちらが後に書かれたか（§2.3.5 の後勝ち） */
  lastAssign: Partial<Record<ListName, "values" | "interval">>;
  nths: Array<{ weekday: number; nth: number }>;
  domSpecial: "L" | number | null;
  freqs: FreqUnit[];
  unknown: number;
  meaningful: number;
  todNotes: string[];
  /** 時間帯の語と時刻がずれたぶんの減点 */
  todPenalties: Penalty[];
  /** 曜日で近似した語（「休日」）の説明 */
  approxNotes: string[];
}

function collect(tokens: Token[]): Collected {
  const state: Collected = {
    times: { items: [], pendingRange: false },
    hourSpan: false,
    lists: { minute: emptyList(), dom: emptyList(), dow: emptyList(), month: emptyList() },
    intervals: {},
    duplicateIntervals: [],
    lastAssign: {},
    nths: [],
    domSpecial: null,
    freqs: [],
    unknown: 0,
    meaningful: 0,
    todNotes: [],
    todPenalties: [],
    approxNotes: [],
  };

  let pendingWord: TimeOfDayWord | null = null;
  /** 範囲の始点に掛かっていた時間帯語。終端に語が無ければこれを引き継ぐ */
  let spanWord: TimeOfDayWord | null = null;
  let pendingNth: number | null = null;
  /** 直前に読んだ値がどのスロットのものか（「から」の係り先） */
  let last: ListName | "time" | null = null;

  /**
   * 時刻の並びに 1 つ足す。範囲の始点なら、掛かっていた語を終端が引き継げるよう覚える
   * （終端に語が無い「夜6時から9時まで」を 18-21 と読むため）。
   */
  const addTime = (atom: TimeAtom, word: TimeOfDayWord | null) => {
    if (!state.times.pendingRange) spanWord = word;
    pushTime(state.times, atom);
  };

  /** 時刻に結び付かなかった時間帯語を、書かれた位置のまま並びに置く */
  const flushWord = () => {
    if (pendingWord !== null) {
      addTime({ kind: "word", word: pendingWord }, pendingWord);
      pendingWord = null;
    }
  };

  /** 値を並びに足し、「から」の係り先として返す */
  const addValues = (name: ListName, values: number[]): ListName => {
    for (const value of values) pushValue(state.lists[name], value);
    state.lastAssign[name] = "values";
    return name;
  };

  for (const token of tokens) {
    if (token.type !== "UNKNOWN" && token.type !== "SEP") state.meaningful += 1;

    switch (token.type) {
      case "AMPM":
      case "TIME_OF_DAY":
        flushWord();
        pendingWord = token.value as TimeOfDayWord;
        last = "time";
        break;

      case "TIME": {
        const time = token.value as TimeValue;
        let hour = time.hour;
        // 「夜6時から9時まで」の 9 時は始点と同じ時間帯の中。語が書かれていない
        // 範囲の終端は、始点に掛かっていた語で読む（→ 18-21）
        const inherited = state.times.pendingRange ? spanWord : null;
        const word = pendingWord ?? inherited;
        if (word !== null) {
          const reading = readHour(word, hour);
          hour = reading.hour;
          // 書かれた語だけを note にする。引き継いだ語のずれを書くと、
          // 利用者が書いていない語のせいで減点されたように見える
          if (reading.gap > 0 && pendingWord !== null) {
            // 語の指す時間帯から外れた読みしか無い。採った理由は言えないので、
            // どう読んだかを note にして、離れたぶんだけ減点する
            const [low, high] = TIME_OF_DAY[pendingWord].range;
            state.todNotes.push(
              `「${pendingWord}」は通常 ${low}時から${high}時ですが、${hour}時と解釈しました`,
            );
            state.todPenalties.push({
              reason: "時間帯の語と時刻のずれ",
              amount: Math.min(0.3, reading.gap * 0.1),
            });
          }
        }
        addTime({ kind: "time", hour, minute: time.minute }, pendingWord);
        pendingWord = null;
        last = "time";
        break;
      }

      case "MINUTE":
        flushWord();
        last = addValues("minute", [token.value as number]);
        break;

      case "INTERVAL": {
        flushWord();
        const interval = token.value as IntervalValue;
        if (state.intervals[interval.unit] !== undefined) {
          state.duplicateIntervals.push(interval.unit);
        }
        state.intervals[interval.unit] = interval.n;
        const name = INTERVAL_LIST[interval.unit];
        if (name !== undefined) state.lastAssign[name] = "interval";
        // cron に週の刻みは無い。「毎週」として扱い、fill で note を付ける
        if (interval.unit === "week") state.freqs.push("week");
        // 「3か月ごと」だけでは何日に動くか決まらないので「毎月」と同じ期待を置く
        if (interval.unit === "month") state.freqs.push("month");
        break;
      }

      case "RANGE_FROM":
        if (last === "time") {
          // 「朝から17時まで」の「朝」は 17 時の修飾語ではなく、範囲の始点
          flushWord();
          if (state.times.items.length > 0) state.times.pendingRange = true;
        } else if (last !== null && state.lists[last].items.length > 0) {
          state.lists[last].pendingRange = true;
        }
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
          last = addValues("dow", [weekday]);
        }
        break;
      }

      case "DOW_SET": {
        flushWord();
        // 「休日」のように曜日と厳密には一致しない語は、寄せたことを fill で note にする
        const approx = DOW_SET_APPROX[token.raw];
        if (approx !== undefined) state.approxNotes.push(approx);
        last = addValues("dow", token.value as number[]);
        break;
      }

      case "DOM":
        flushWord();
        last = addValues("dom", [token.value as number]);
        break;

      case "DOM_SPECIAL": {
        flushWord();
        const value = token.value as "L" | number;
        if (value === "L") state.domSpecial = "L";
        else last = addValues("dom", [value]);
        break;
      }

      case "MONTH":
        flushWord();
        last = addValues("month", [token.value as number]);
        break;

      case "FREQ":
        flushWord();
        state.freqs.push(token.value as FreqUnit);
        break;

      case "AND":
        // 「午前0時と正午」の「正午」は 2 つ目の時刻。前の語をここで切る
        flushWord();
        break;

      case "HOUR_SPAN":
        state.hourSpan = true;
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

  /** 同じフィールドに 2 通りの指定が並んだとき（§2.3.5 の「2 回代入」） */
  const noteConflict = (label: string) => {
    slots.notes.push(`「${label}」の指定が 2 通りあるため、後に書かれた方を採用しました`);
    penalize("同じフィールドへの二重指定", 0.2);
  };

  // 時間帯の語と時刻のずれ（note は collect が積んでいる）
  for (const penalty of state.todPenalties) slots.penalties.push(penalty);

  for (const unit of state.duplicateIntervals) noteConflict(INTERVAL_LABELS[unit]);

  // 曜日に寄せた語は、指す日がずれるぶんを減点する（cron に祝日は書けない）
  for (const note of state.approxNotes) {
    slots.notes.push(note);
    penalize("曜日で近似した語", 0.2);
  }

  /** 時間帯の語を時に落とす。幅のある語は曖昧さとして報告する */
  const resolveWord = (word: TimeOfDayWord): number => {
    const spec = TIME_OF_DAY[word];
    const override = options.timeOfDay?.[word];
    // 「正午」のように時が一意に定まる語は曖昧ではない
    if (spec.range[0] !== spec.range[1] && override === undefined) {
      slots.ambiguities.push({
        field: "hour",
        question: `「${word}」は何時ですか？`,
        candidates: hourCandidates(spec.range[0], spec.range[1]),
      });
      penalize("時刻を表す語が曖昧", 0.3);
    }
    return override ?? spec.default ?? defaultHour;
  };

  // 時刻に結び付かなかった時間帯語は、それ自体が 1 つの時刻（「午前0時と正午」）。
  // 並びの位置は `collect` が保っているので、書かれた順のまま解決する
  const resolveAtom = (atom: TimeAtom): ResolvedTime =>
    atom.kind === "time"
      ? { hour: atom.hour, minute: atom.minute }
      : { hour: resolveWord(atom.word), minute: 0 };
  const spans = state.times.items.map<ResolvedSpan>((span) => ({
    from: resolveAtom(span.from),
    to: span.to === null ? null : resolveAtom(span.to),
  }));

  /* ---------------- 時刻 ---------------- */

  const minutes = state.lists.minute;
  const minuteStep = state.intervals.minute;
  const hourStep = state.intervals.hour;
  const hasTime = spans.length > 0;
  const hasRange = spans.some((span) => span.to !== null);
  // 時刻の側に書かれた分。範囲の終端が持つ 0 分は「まで」の側なので採らない
  // （「9時30分から17時まで」の分は 30 であって 0,30 ではない）
  const spanMinutes = [...new Set(spans.map((span) => span.from.minute))];

  /** 時刻の並びを時フィールドにする。書かれた範囲は範囲のまま残す */
  const hourList = (): FieldAST =>
    spansToAst(spans.map((span) => ({ from: span.from.hour, to: (span.to ?? span.from).hour })));

  /**
   * 時の刻み。「AからBまでN時間ごと」は範囲ごとに掛かるので、書かれた範囲それぞれに適用する。
   * 範囲が 1 つも無ければ起点を持たない全域からの刻み。
   */
  const hourStepAst = (step: number): FieldAST => {
    if (!hasRange) return { kind: "step", base: ANY, step };
    const items = spans.map<FieldAST>((span) =>
      span.to === null
        ? { kind: "value", value: span.from.hour }
        : stepAst({ kind: "range", from: span.from.hour, to: span.to.hour }, step, HOUR_SPEC),
    );
    const only = items[0];
    /* c8 ignore next -- hasRange が真なら 1 個以上ある */
    if (only === undefined) return { kind: "step", base: ANY, step };
    return items.length === 1 ? only : { kind: "list", items };
  };

  /** 「N時まで」が N 時台を含むことを断る。終端ごとに曖昧なので範囲の数だけ付ける */
  const noteHourRanges = () => {
    for (const span of spans) {
      const to = span.to;
      if (to === null) continue;
      slots.notes.push(
        `「${to.hour}時まで」を ${to.hour}時台まで（${span.from.hour}-${to.hour}）と解釈しました。` +
          `${to.hour}:00 で終える場合は ${span.from.hour}-${to.hour - 1} を指定してください`,
      );
      penalize("時刻範囲の終端が曖昧", 0.1);
    }
  };

  if (state.freqs.includes("minute")) {
    slots.minute = ANY;
    if (hourStep !== undefined) {
      // 「2時間ごと（毎分）」の時の刻み。毎分だけを見て捨てると刻みが消える
      slots.hour = hourStepAst(hourStep);
    } else if (hasTime) {
      // 「午前9時台の毎分」のように時が書かれていれば、その時の中での毎分
      slots.hour = hourList();
    }
    noteHourRanges();
  } else if (minuteStep !== undefined || hourStep !== undefined) {
    if (minuteStep !== undefined) {
      // 「1分から59分まで2分ごと」の起点。範囲が書かれていなければ全域からの刻み
      slots.minute = stepAst(consumeBase(minutes, MINUTE_SPEC), minuteStep, MINUTE_SPEC);
    }
    if (hourStep !== undefined) {
      slots.hour = hourStepAst(hourStep);
      if (minuteStep === undefined) {
        slots.minute =
          minutes.items.length > 0
            ? listToAst(minutes)
            : { kind: "value", value: spanMinutes[0] ?? 0 };
        minutes.consumed = true;
      }
    } else if (hasRange) {
      slots.hour = hourList();
    }

    noteHourRanges();
    if (!hasRange && hasTime) {
      // 「午前9時台と午後6時台の5分ごと」のように時が並ぶことがあるので、全部を採る
      if (minuteStep !== undefined) slots.hour = hourList();
      // 「9時台の10分ごと」は「その時の中で N 分ごと」で、読み方は 1 つしかない。
      // 「9時に10分ごと」のように時が一点を指すときだけ、どちらの意味か決まらない
      const spanned = state.hourSpan && minuteStep !== undefined && hourStep === undefined;
      if (!spanned) {
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
    }

    if (minutes.items.length > 0 && !minutes.consumed) {
      noteConflict(INTERVAL_LABELS.minute);
      if (state.lastAssign.minute === "values") slots.minute = listToAst(minutes);
    }
  } else if (hasTime) {
    // 「午前9時台の10分と44分」のように分が別に書かれていれば、そちらが分フィールド。
    // 「9時」が持つ 0 分は書かれた値ではないので、時だけを取る
    const writtenMinutes = minutes.items.length > 0;
    // 「9時30分と45分」のように時刻の側にも分が書かれていれば、分の二重指定
    if (writtenMinutes && spanMinutes.some((minute) => minute !== 0)) {
      noteConflict(INTERVAL_LABELS.minute);
    }

    slots.hour = hourList();
    noteHourRanges();

    const only = spanMinutes[0];
    if (writtenMinutes) {
      slots.minute = listToAst(minutes);
    } else if (spanMinutes.length === 1 && only !== undefined) {
      slots.minute = { kind: "value", value: only };
    } else {
      slots.minute = valuesToAst(spanMinutes);
      slots.notes.push("複数の時刻が指定されているため、時と分のすべての組み合わせで実行されます");
      penalize("時と分の組み合わせが曖昧", 0.1);
    }
  } else if (state.freqs.includes("hour")) {
    slots.hour = ANY;
    slots.minute = minutes.items.length > 0 ? listToAst(minutes) : { kind: "value", value: 0 };
  } else if (minutes.items.length > 0) {
    slots.hour = ANY;
    slots.minute = listToAst(minutes);
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

  const doms = state.lists.dom;
  const dows = state.lists.dow;
  const months = state.lists.month;
  const dayStep = state.intervals.day;
  const monthStep = state.intervals.month;

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
  } else if (dows.items.length > 0) {
    slots.dow = listToAst(dows);
  }

  if (state.domSpecial === "L") {
    slots.dom = { kind: "last" };
    slots.extensions.add("L");
    if (dayStep !== undefined) noteConflict(INTERVAL_LABELS.day);
  } else if (dayStep !== undefined) {
    // 「1日から3日ごと」は 1 日を起点にした刻み
    slots.dom = stepAst(consumeBase(doms, DOM_SPEC), dayStep, DOM_SPEC);
    if (doms.items.length > 0 && !doms.consumed) {
      noteConflict(INTERVAL_LABELS.day);
      if (state.lastAssign.dom === "values") slots.dom = listToAst(doms);
    }
  } else if (doms.items.length > 0) {
    slots.dom = listToAst(doms);
  }

  if (monthStep !== undefined) {
    slots.month = stepAst(consumeBase(months, MONTH_SPEC), monthStep, MONTH_SPEC);
    if (months.items.length > 0 && !months.consumed) {
      noteConflict(INTERVAL_LABELS.month);
      if (state.lastAssign.month === "values") slots.month = listToAst(months);
    }
  } else if (months.items.length > 0) {
    slots.month = listToAst(months);
  }

  const weekStep = state.intervals.week;
  if (weekStep !== undefined) {
    slots.notes.push(
      `cron には週単位の刻みが無いため「${weekStep}週間ごと」は表現できません。` +
        "毎週として解釈しました",
    );
    penalize("週単位の刻み", 0.3);
  }

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
    // 「3か月ごとの毎日」は日が決まっている。「毎日」が無いときだけ日を補う
    if (freq === "month" && !domSpecified && !dowSpecified && !state.freqs.includes("day")) {
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
    dows.items.length > 0 ||
    state.nths.length > 0 ||
    doms.items.length > 0 ||
    state.domSpecial !== null ||
    months.items.length > 0;
  const hasInterval = Object.keys(state.intervals).length > 0;
  if (state.freqs.length === 0 && !hasDateToken && !hasInterval) {
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
