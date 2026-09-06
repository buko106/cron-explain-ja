import { CronExpressionParser } from "cron-parser";
import { describe, expect, it } from "vitest";
import {
  expandField,
  formatExpression,
  hasExtension,
  MONTH_SPEC,
  next,
  parseExpression,
} from "../src/cron";
import { explainDetailed } from "../src/index";
import type { ParserOptions } from "../src/types";
import {
  CRON_FIELDS,
  clampDayOfMonth,
  differsOnWildcardRule,
  hasCyclicRange,
  ownValues,
  referenceValues,
} from "./helpers/cron-parser";
import { type CronParserFixture, type ExplainFixture, loadFixtures } from "./helpers/fixtures";

/**
 * cron-parser（MIT / harrisiirak, v5）をベンチマークに、同じ式を同じ意味で読めているか見る。
 *
 * 比べるのは「その式が動く値の集合」と「次回実行日時の並び」。表記の違い（曜日の 7 と 0、
 * `*` と `0-6`、値の重複）は test/helpers/cron-parser.ts で吸収する。
 * 意図的に違うところは test/cron-parser-cases.test.ts に一覧がある。
 */

/** cron-parser のテストから採った式。全て両方のライブラリが受け付ける */
const corpus = loadFixtures<CronParserFixture>("cron-parser.jsonl");

/** 実在 crontab を含む、既存フィクスチャの式 */
const fixtureExpressions = [
  ...new Map(
    [
      ...loadFixtures<ExplainFixture>("explain.jsonl"),
      ...loadFixtures<ExplainFixture>("explain-real.jsonl"),
    ]
      .filter((fixture) => fixture.error === undefined)
      .map<[string, CronParserFixture]>((fixture) => [
        fixture.expr,
        fixture.seconds === true ? { expr: fixture.expr, seconds: true } : { expr: fixture.expr },
      ]),
  ).values(),
];

/**
 * 既存フィクスチャのうち cron-parser が読めない式。
 * うちにしかない書き方なので比較から外す。増えたときは意図した差か確かめる
 */
const UNREADABLE_BY_REFERENCE = new Set([
  "0 0 L-3 * *",
  "0 10 15W * *",
  "0 12 1W * *",
  "@midnight",
]);

/**
 * cron-parser の `stringify` が書き戻せない式。
 * 同じ値が 3 つ以上並ぶと `compactField` が刻み幅の無い範囲を作って落ちる（v5.10.0）。
 * 相手側の制限なので、書き戻しの比較からだけ外す
 */
const UNWRITABLE_BY_REFERENCE = new Set(["0 0 * * 0,0,0", "0,0,0 * * * *"]);

function optionsOf(fixture: CronParserFixture): ParserOptions {
  return fixture.seconds === true ? { seconds: true } : {};
}

function label(fixture: CronParserFixture): string {
  return fixture.note === undefined ? fixture.expr : `${fixture.expr}（${fixture.note}）`;
}

/** 同じ式を 2 度検査しない */
function dedupe(fixtures: CronParserFixture[]): CronParserFixture[] {
  return [...new Map(fixtures.map((fixture) => [fixture.expr, fixture])).values()];
}

/** next の探索は起点から 5 年で打ち切る */
const SEARCH_YEARS = 5;

/**
 * cron-parser が挙げる次回実行日時。
 * 5 年より先と、候補が尽きた（4 月 31 日のような）ところで打ち切る
 */
function referenceOccurrences(fixture: CronParserFixture, from: Date, count: number): string[] {
  const reference = CronExpressionParser.parse(fixture.expr, { currentDate: from, tz: "UTC" });
  const dates: string[] = [];
  for (let index = 0; index < count; index += 1) {
    let date: Date;
    try {
      date = reference.next().toDate();
    } catch {
      // 4 月 31 日のように永遠に来ない式では cron-parser が例外を投げる。うちは空配列を返す
      break;
    }
    if (date.getUTCFullYear() > from.getUTCFullYear() + SEARCH_YEARS) break;
    dates.push(date.toISOString());
  }
  return dates;
}

/**
 * 展開値をフィールドごとに突き合わせる。比べられたフィールド数を返す。
 *
 * 拡張構文（L / # / W）を含むフィールドは値に展開できないので飛ばす。
 * cron-parser は `'5L'` のような文字列を値として持つので、そこは形が違って比べられない
 */
function expectSameValues(fixture: CronParserFixture): number {
  const own = ownValues(fixture.expr, optionsOf(fixture));
  const reference = referenceValues(fixture.expr);
  let compared = 0;
  for (const field of CRON_FIELDS) {
    if (own.extended.has(field)) continue;
    const values =
      field === "dayOfMonth"
        ? clampDayOfMonth(own.values.dayOfMonth, own.values.month)
        : own.values[field];
    expect(values, `${fixture.expr} の ${field}`).toEqual(reference[field]);
    compared += 1;
  }
  return compared;
}

describe("cron-parser との一致: フィールドの展開値", () => {
  it.each(corpus.map((fixture) => [label(fixture), fixture] as const))("%s", (_label, fixture) => {
    // 全フィールドが拡張構文ということはないので、必ず 1 つ以上は比べている
    expect(expectSameValues(fixture)).toBeGreaterThan(0);
  });

  it.each(fixtureExpressions.filter((fixture) => !UNREADABLE_BY_REFERENCE.has(fixture.expr)))(
    "$expr",
    (fixture) => {
      expect(expectSameValues(fixture)).toBeGreaterThan(0);
    },
  );

  it("cron-parser が読めない式は、うちにしかない書き方に限られる", () => {
    const unreadable = fixtureExpressions
      .filter((fixture) => {
        try {
          CronExpressionParser.parse(fixture.expr);
          return false;
        } catch {
          return true;
        }
      })
      .map((fixture) => fixture.expr);
    expect(new Set(unreadable)).toEqual(UNREADABLE_BY_REFERENCE);
  });

  it("公開 API（explainDetailed）が返す値も一致する", () => {
    for (const fixture of corpus) {
      const { fields } = explainDetailed(fixture.expr, { ...optionsOf(fixture), tz: "UTC" });
      const reference = referenceValues(fixture.expr);
      const months = fields.month.values;
      for (const field of CRON_FIELDS) {
        const explanation = field === "second" ? fields.second : fields[field];
        // 秒を持たない式の秒フィールドと、拡張構文のフィールドは値を持たない
        if (explanation === undefined || explanation.values.length === 0) continue;
        const values =
          field === "dayOfMonth" ? clampDayOfMonth(explanation.values, months) : explanation.values;
        expect(values, `${fixture.expr} の ${field}`).toEqual(reference[field]);
      }
    }
  });
});

describe("cron-parser との一致: 次回実行日時", () => {
  /** 2026-09-05 (土) 12:34:56 UTC を基準に、月末・年末・うるう年をまたぐ起点を混ぜる */
  const FROMS = [
    "2026-09-05T12:34:56Z",
    "2026-01-31T23:59:59Z",
    "2026-12-31T23:00:00Z",
    "2027-03-01T00:00:00Z",
    "2028-02-28T00:00:00Z",
  ].map((iso) => new Date(iso));

  const comparable = dedupe([...corpus, ...fixtureExpressions]).filter((fixture) => {
    if (UNREADABLE_BY_REFERENCE.has(fixture.expr)) return false;
    const parsed = parseExpression(fixture.expr, optionsOf(fixture));
    // L / # / W を含む式は next を計算しない（`?` は制約なしなので計算できる）
    if (parsed.extensions.some((extension) => extension !== "?")) return false;
    return !differsOnWildcardRule(parsed.raw.dayOfMonth, parsed.raw.dayOfWeek);
  });

  it.each(comparable.map((fixture) => [label(fixture), fixture] as const))(
    "%s",
    (_label, fixture) => {
      for (const from of FROMS) {
        const actual = next(fixture.expr, { ...optionsOf(fixture), from, count: 5 }).map((date) =>
          date.toISOString(),
        );
        expect(actual, `${fixture.expr} @ ${from.toISOString()}`).toEqual(
          referenceOccurrences(fixture, from, 5),
        );
      }
    },
  );

  it("式の総数が減っていない", () => {
    // 比較から外す条件を広げすぎると、この describe が空回りしていても気づけない
    expect(comparable.length).toBeGreaterThan(180);
  });
});

describe("cron-parser との一致: 正規化した表記", () => {
  const withoutExtensions = dedupe([...corpus, ...fixtureExpressions]).filter((fixture) => {
    if (UNREADABLE_BY_REFERENCE.has(fixture.expr)) return false;
    const { ast } = parseExpression(fixture.expr, optionsOf(fixture));
    return !CRON_FIELDS.some((field) => {
      const node = field === "second" ? ast.seconds : ast[field as Exclude<typeof field, "second">];
      return node !== undefined && hasExtension(node);
    });
  });

  it("cron-parser が書き戻した式を、同じ意味で読み直せる", () => {
    for (const fixture of withoutExtensions) {
      if (UNWRITABLE_BY_REFERENCE.has(fixture.expr)) continue;
      const seconds = fixture.seconds === true;
      const normalized = CronExpressionParser.parse(fixture.expr).stringify(seconds);
      const own = ownValues(normalized, optionsOf(fixture));
      const reference = referenceValues(fixture.expr);
      for (const field of CRON_FIELDS) {
        const values =
          field === "dayOfMonth"
            ? clampDayOfMonth(own.values.dayOfMonth, own.values.month)
            : own.values[field];
        expect(values, `${fixture.expr} → ${normalized} の ${field}`).toEqual(reference[field]);
      }
    }
  });

  it("うちが書き戻した式を、cron-parser が同じ意味で読む", () => {
    let compared = 0;
    for (const fixture of withoutExtensions) {
      const { ast } = parseExpression(fixture.expr, optionsOf(fixture));
      // 循環する範囲（`5-1`）は cron-parser が読めないので外す
      const fields = [ast.minute, ast.hour, ast.dayOfMonth, ast.month, ast.dayOfWeek];
      if (ast.seconds !== undefined) fields.push(ast.seconds);
      if (fields.some(hasCyclicRange)) continue;

      const normalized = formatExpression(ast);
      const reference = referenceValues(normalized);
      const own = ownValues(fixture.expr, optionsOf(fixture));
      for (const field of CRON_FIELDS) {
        const values =
          field === "dayOfMonth"
            ? clampDayOfMonth(own.values.dayOfMonth, own.values.month)
            : own.values[field];
        expect(values, `${fixture.expr} → ${normalized} の ${field}`).toEqual(reference[field]);
      }
      compared += 1;
    }
    expect(compared).toBeGreaterThan(180);
  });

  it("書き戻せない式は、cron-parser 側の既知の制限に限られる", () => {
    const unwritable = withoutExtensions
      .filter((fixture) => {
        try {
          CronExpressionParser.parse(fixture.expr).stringify(fixture.seconds === true);
          return false;
        } catch {
          return true;
        }
      })
      .map((fixture) => fixture.expr);
    expect(new Set(unwritable)).toEqual(UNWRITABLE_BY_REFERENCE);
  });
});

describe("cron-parser との一致: ランダム生成による差分検査", () => {
  /** 決定的な擬似乱数（テストを再現可能にする） */
  function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  const random = createRandom(20260906);
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)] as T;
  const between = (min: number, max: number): number =>
    min + Math.floor(random() * (max - min + 1));

  function randomAtom(min: number, max: number): string {
    const form = pick(["any", "value", "range", "step", "rangeStep"]);
    if (form === "any") return "*";
    if (form === "value") return String(between(min, max));
    if (form === "step") return `*/${between(1, max - min + 1)}`;
    const from = between(min, max);
    const to = between(from, max);
    if (form === "range") return `${from}-${to}`;
    return `${from}-${to}/${between(1, max - min + 1)}`;
  }

  function randomField(min: number, max: number): string {
    return Array.from({ length: pick([1, 1, 1, 2, 3]) }, () => randomAtom(min, max)).join(",");
  }

  const FROM = new Date("2026-09-05T12:34:56Z");

  it("生成した式の展開値と次回実行日時が cron-parser と一致する", () => {
    let checked = 0;
    for (let attempt = 0; attempt < 6000; attempt += 1) {
      // 曜日は 0-6 だけを使う。7 と循環範囲は cron-parser と読み方が違うので別に押さえている
      const expression = [
        randomField(0, 59),
        randomField(0, 23),
        randomField(1, 31),
        randomField(1, 12),
        randomField(0, 6),
      ].join(" ");

      const own = ownValues(expression);
      try {
        // 終わりが始まりより小さい範囲など、cron-parser が受け付けない形は飛ばす
        CronExpressionParser.parse(expression);
      } catch {
        continue;
      }
      const reference = referenceValues(expression);
      for (const field of CRON_FIELDS) {
        const values =
          field === "dayOfMonth"
            ? clampDayOfMonth(own.values.dayOfMonth, own.values.month)
            : own.values[field];
        expect(values, `${expression} の ${field}`).toEqual(reference[field]);
      }

      if (!differsOnWildcardRule(own.raw.dayOfMonth, own.raw.dayOfWeek)) {
        const iterator = CronExpressionParser.parse(expression, { currentDate: FROM, tz: "UTC" });
        let expected: string[];
        try {
          expected = Array.from({ length: 3 }, () => iterator.next().toDate().toISOString());
        } catch {
          // 2 月 31 日のように、cron-parser が候補を出せない式
          expected = [];
        }
        const actual = next(expression, { from: FROM, count: 3 }).map((date) => date.toISOString());
        if (expected.length === 3) expect(actual, expression).toEqual(expected);
        else expect(actual, expression).toEqual([]);
      }
      checked += 1;
    }
    // 生成条件を変えて式がほとんど通らなくなっていないか見る
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("うるう年と月の端", () => {
  // 実在 crontab のコーパスは踏まない端を、cron-parser と突き合わせて確かめる
  it.each([
    ["0 0 29 2 *", "2024-01-01T00:00:00Z"],
    ["0 0 30 4 *", "2026-05-01T00:00:00Z"],
    ["0 0 31 1,3,5,7,8,10,12 *", "2026-12-30T00:00:00Z"],
    ["0 0 1 * *", "2026-12-31T23:59:59Z"],
    ["59 23 * * *", "2026-12-31T23:59:00Z"],
    ["0 0 * * 1", "2028-02-27T00:00:00Z"],
    ["0 0 29 * *", "2027-01-30T00:00:00Z"],
  ])("%s（起点 %s）", (expression, iso) => {
    const from = new Date(iso);
    const reference = CronExpressionParser.parse(expression, { currentDate: from, tz: "UTC" });
    const expected = Array.from({ length: 4 }, () => reference.next().toDate())
      .filter((date) => date.getUTCFullYear() <= from.getUTCFullYear() + 5)
      .map((date) => date.toISOString());
    expect(next(expression, { from, count: 4 }).map((date) => date.toISOString())).toEqual(
      expected,
    );
  });

  it("2 月 29 日は 4 年ごとにしか来ない", () => {
    const from = new Date("2024-03-01T00:00:00Z");
    const dates = next("0 0 29 2 *", { from, count: 2 });
    expect(dates.map((date) => date.toISOString())).toEqual([
      "2028-02-29T00:00:00.000Z",
      // 起点の 5 年先までしか探さないので 2032 年は出ない
    ]);
    expect(expandField(parseExpression("0 0 29 2 *").ast.month, MONTH_SPEC)).toEqual([2]);
  });
});
