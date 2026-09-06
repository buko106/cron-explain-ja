import { CronExpressionParser } from "cron-parser";
import { describe, expect, it } from "vitest";
import {
  DOW_SPEC,
  expandField,
  MINUTE_SPEC,
  MONTH_SPEC,
  next,
  parseExpression,
  SECOND_SPEC,
} from "../src/cron";
import { CronSyntaxError, CronTimeZoneError, explain, validate } from "../src/index";
import type { ParserOptions } from "../src/types";
import { referenceValues } from "./helpers/cron-parser";

/**
 * cron-parser（MIT / harrisiirak）のテストにあって、うちのコーパスに無かった入力を取り込む。
 *
 * ここは「一致すること」ではなく「どう振る舞うか」を固定する場所。
 * 値や次回実行日時が一致することは test/cron-parser-parity.test.ts で見ている。
 */

const withSeconds: ParserOptions = { seconds: true };

/** 2026-09-05 (土) 00:00 UTC */
const FROM = new Date("2026-09-05T00:00:00Z");

function occurrences(expression: string, count: number): string[] {
  return next(expression, { from: FROM, count }).map((date) => date.toISOString());
}

function referenceOccurrences(expression: string, count: number): string[] {
  const reference = CronExpressionParser.parse(expression, { currentDate: FROM, tz: "UTC" });
  return Array.from({ length: count }, () => reference.next().toDate().toISOString());
}

describe("cron-parser が拒否する式は、うちも理由を添えて拒否する", () => {
  it.each([
    ["61 * * * * *", withSeconds, "秒 フィールドの値 61 は範囲外です (0-59)"],
    ["-1 * * * * *", withSeconds, "秒 フィールドの値 '-1' を解釈できません"],
    ["- * * * * *", withSeconds, "秒 フィールドの値 '-' を解釈できません"],
    ["* 32,72 * * * *", withSeconds, "分 フィールドの値 72 は範囲外です (0-59)"],
    ["* * 12-36 * * *", withSeconds, "時 フィールドの値 36 は範囲外です (0-23)"],
    ["* * * 10-15,40 * *", withSeconds, "日 フィールドの値 40 は範囲外です (1-31)"],
    ["* * * * */10,12-13 *", withSeconds, "月 フィールドの値 13 は範囲外です (1-12)"],
    ["* * * * * 9", withSeconds, "曜日 フィールドの値 9 は範囲外です (0-7)"],
    ["10 ! 12 8 0", {}, "時 フィールドの値 '!' を解釈できません"],
    ["10 x 12 8 0", {}, "時 フィールドの値 'x' を解釈できません"],
    ["10 ) 12 8 0", {}, "時 フィールドの値 ')' を解釈できません"],
    ["10 */A 12 8 0", {}, "時 フィールドの刻み幅 'A' を解釈できません"],
    ["10 0-z 12 8 0", {}, "時 フィールドの値 'z' を解釈できません"],
    ["10 0,1,z 12 8 0", {}, "時 フィールドの値 'z' を解釈できません"],
    ["0 */0 * * *", {}, "時 フィールドの刻み幅は 1 以上で指定してください"],
    ["0 */-5 * * *", {}, "時 フィールドの刻み幅 '-5' を解釈できません"],
    ["0 5/5/5 * * *", {}, "時 フィールドの刻み幅 '5/5' を解釈できません"],
    ["15 10 * * MON-TUR", {}, "曜日 フィールドの値 'TUR' を解釈できません"],
    ["*/10 * * * * ,", withSeconds, "曜日 フィールドが空です"],
    ["*/10 * * * * ,2", withSeconds, "曜日 フィールドが空です"],
    ["0 0 0 ? * 2-4#2", withSeconds, "曜日 フィールドの値 '2-4' を解釈できません"],
    ["0 0 0 ? * 1/2#3", withSeconds, "曜日 フィールドの刻み幅 '2#3' を解釈できません"],
    ["0 0 0 ? * 1.2#2", withSeconds, "曜日 フィールドの値 '1.2' を解釈できません"],
    ["0 0 0 * * L", withSeconds, "曜日フィールドの 'L' は '5L' のように曜日と組み合わせてください"],
    [
      "0 0 0 * * 1,L",
      withSeconds,
      "曜日フィールドの 'L' は '5L' のように曜日と組み合わせてください",
    ],
    ["0 12 LW * *", {}, "日 フィールドの値 'LW' を解釈できません"],
    ["0 0 L/2 * *", {}, "日 フィールドの刻みは '*' か範囲にのみ指定できます"],
    ["* * * * * * * *ASD", {}, "フィールド数が不正です（5 個必要ですが 8 個でした）"],
  ] as const)("%s", (expression, options, message) => {
    expect(() => CronExpressionParser.parse(expression)).toThrow();
    expect(() => parseExpression(expression, options)).toThrow(CronSyntaxError);
    expect(() => parseExpression(expression, options)).toThrow(message);
  });
});

describe("cron-parser にしかない構文", () => {
  // Jenkins 由来の H（ハッシュで散らす指定）。同じ式が毎回同じ時刻になる保証は
  // 実装ごとに違うので、日本語に直す意味が定まらない。読めないことを固定しておく
  it.each([
    ["H/40 * * * *", "分 フィールドの値 'H' を解釈できません"],
    ["H(1-5)/10 * * * *", "分 フィールドの値 'H(1' を解釈できません"],
    ["H(50-100)/60 * * * *", "分 フィールドの値 'H(50' を解釈できません"],
    ["0 0 H(0-5) * *", "日 フィールドの値 'H(0' を解釈できません"],
    ["0 0 * H/60 *", "月 フィールドの値 'H' を解釈できません"],
  ])("H 記法 %s は読めない", (expression, message) => {
    expect(() => CronExpressionParser.parse(expression)).not.toThrow();
    expect(() => parseExpression(expression)).toThrow(message);
  });

  it.each([
    ["@minutely", "0 * * * * *"],
    ["@secondly", "* * * * * *"],
    ["@weekdays", "0 0 0 * * 1-5"],
    ["@weekends", "0 0 0 * * 0,6"],
  ])("マクロ %s には対応していない", (macro, expanded) => {
    expect(CronExpressionParser.parse(macro).stringify(true)).toBe(expanded);
    expect(() => parseExpression(macro)).toThrow(`マクロ '${macro}' には対応していません`);
  });

  // cron-parser は足りないフィールドを先頭から補う（`20 15 * *` は「毎日 20 時台の毎分」）。
  // 補い方は実装ごとに違い、書き手の意図とずれるので、うちは数が合わない時点で断る
  it.each([
    ["20 15 * *", "0 * 20 15 * *", 4],
    ["15 * *", "0 * * 15 * *", 3],
  ])("フィールドが足りない %s は補わない", (expression, padded, count) => {
    expect(CronExpressionParser.parse(expression).stringify(true)).toBe(padded);
    expect(() => parseExpression(expression)).toThrow(
      `フィールド数が不正です（5 個必要ですが ${count} 個でした）`,
    );
  });

  it.each(["? * * * *", "0 ? * * *"])("日・曜日以外の '?' は受け付けない: %s", (expression) => {
    expect(() => CronExpressionParser.parse(expression)).not.toThrow();
    expect(() => parseExpression(expression)).toThrow("'?' は日・曜日フィールドでのみ使用できます");
  });

  // cron-parser は `?` を全域に置き換えてから読むので刻みを付けられるが、
  // `?` は「指定なし」であって値の並びではないので、うちは刻みの土台にしない
  it.each([
    ["0 0 ?/2 * *", "日"],
    ["0 0 * * ?/2", "曜日"],
  ])("'?' に刻みは付けられない: %s", (expression, label) => {
    expect(() => CronExpressionParser.parse(expression)).not.toThrow();
    expect(() => parseExpression(expression)).toThrow(
      `${label} フィールドの刻みは '*' か範囲にのみ指定できます`,
    );
  });

  // cron-parser は 3 文字の別名を月・曜日のどちらの表からも引くので、曜日に `jan` と
  // 書くと月曜になる。書き間違いを通してしまうため、うちは曜日の表だけを見る
  it("曜日フィールドに月名は書けない", () => {
    expect(CronExpressionParser.parse("* * * * jan").stringify(true)).toBe("0 * * * * 1");
    expect(() => parseExpression("* * * * jan")).toThrow(
      "曜日 フィールドの値 'jan' を解釈できません",
    );
    expect(expandField(parseExpression("* * * * mon").ast.dayOfWeek, DOW_SPEC)).toEqual([1]);
  });

  it("日が実在しない式は、cron-parser は解析時に落ちる", () => {
    expect(() => CronExpressionParser.parse("0 0 31 4 *")).toThrow(
      "Invalid explicit day of month definition",
    );
    // うちは説明できる式として受け取り、警告と空の next で伝える
    expect(validate("0 0 31 4 *")).toEqual({
      valid: true,
      errors: [],
      warnings: ["4月31日は存在しないため、このジョブは実行されません"],
    });
    expect(occurrences("0 0 31 4 *", 2)).toEqual([]);
  });
});

describe("うちにしかない構文", () => {
  it.each([
    ["0 0 L-3 * *", "毎月月末の3日前の午前0時"],
    ["0 0 15W * *", "毎月15日に最も近い平日の午前0時"],
    ["0 12 1W * *", "毎月1日に最も近い平日の正午"],
  ])("Quartz 拡張 %s を読む", (expression, text) => {
    expect(() => CronExpressionParser.parse(expression)).toThrow();
    expect(validate(expression).valid).toBe(true);
    expect(explain(expression, { tz: "UTC" })).toBe(text);
  });

  it("@midnight を読む", () => {
    expect(() => CronExpressionParser.parse("@midnight")).toThrow();
    expect(parseExpression("@midnight").macro).toBe("@midnight");
    expect(explain("@midnight", { tz: "UTC" })).toBe("毎日午前0時");
    expect(occurrences("@midnight", 1)).toEqual(["2026-09-06T00:00:00.000Z"]);
  });

  // crontab では `5-1`（金曜から月曜）のように年末・週末をまたぐ範囲が書ける。
  // cron-parser は min > max として断るが、うちは循環する範囲として読む
  it.each([
    ["0 0 * * 5-1", DOW_SPEC, [0, 1, 5, 6], "毎週日曜日、月曜日、金曜日、土曜日の午前0時"],
    ["0 0 1 11-2 *", MONTH_SPEC, [1, 2, 11, 12], "1月、2月、11月、12月の1日の午前0時"],
    ["0 0 1 dec-jan *", MONTH_SPEC, [1, 12], "1月と12月の1日の午前0時"],
    ["0 0 * * MON-SUN", DOW_SPEC, [0, 1, 2, 3, 4, 5, 6], "毎日午前0時"],
  ] as const)("循環する範囲 %s を読む", (expression, spec, values, text) => {
    expect(() => CronExpressionParser.parse(expression)).toThrow(/Invalid range/);
    const { ast } = parseExpression(expression);
    expect(expandField(spec === MONTH_SPEC ? ast.month : ast.dayOfWeek, spec)).toEqual(values);
    expect(explain(expression, { tz: "UTC" })).toBe(text);
  });

  // Quartz は `#` を他の指定と組み合わせられない。cron-parser もそれに合わせて断るが、
  // 説明するだけなら「日曜日と第 4 土曜日」と読めるので、うちは通して警告に留める
  it("リストの中の '#' を読む", () => {
    expect(() => CronExpressionParser.parse("0 0 0 ? * 0,6#4")).toThrow(
      "invalid dayOfWeek `#` and `,` special characters are incompatible",
    );
    expect(validate("0 0 0 ? * 0,6#4", withSeconds).valid).toBe(true);
    expect(explain("0 0 0 ? * 0,6#4", { ...withSeconds, tz: "UTC" })).toContain("第4土曜日");
  });

  it("@reboot は日時を持たない指定として断る", () => {
    // cron-parser は '@reboot' を別名解決に失敗した式として断る
    expect(() => CronExpressionParser.parse("@reboot")).toThrow('cannot resolve alias "reb"');
    expect(() => parseExpression("@reboot")).toThrow(
      "'@reboot' は起動時に一度だけ実行される指定で、日時を持たないため説明できません",
    );
  });
});

describe("日と曜日の OR 条件", () => {
  // 「制約されているか」は、どちらのライブラリも書き方で決める。cron-parser は書かれた
  // 文字列をそのまま見る（`*` か `?` だけが制約なし）ので、全曜日を指す `*` に刻み 1 を
  // 付けた形を制約と見なし、日との OR で毎日動く式になる。うちは同じ値を指す書き方として
  // `*` に畳む。Vixie cron も `*` で始まる曜日を制約なしに扱うので、そちらに合わせている
  it("全曜日に刻み 1 を付けた形は、曜日の制約とは見なさない", () => {
    const expression = "0 0 16 * */1";
    expect(occurrences(expression, 2)).toEqual([
      "2026-09-16T00:00:00.000Z",
      "2026-10-16T00:00:00.000Z",
    ]);
    expect(referenceOccurrences(expression, 2)).toEqual([
      "2026-09-06T00:00:00.000Z",
      "2026-09-07T00:00:00.000Z",
    ]);
    // 値そのものは一致している。差が出るのは日と曜日を突き合わせるところだけ
    expect(referenceValues(expression).dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it.each([
    ["0 0 15 * 1", "日と曜日の両方が制約"],
    ["0 0 1-31 * 5", "日が全域でも制約"],
    ["0 0 31 2 1-5", "日が実在しなくても曜日で動く"],
    ["0 0 15 * 0-7", "曜日が全域を覆うので毎日"],
    ["0 0 15 * 0-6", "曜日が全域を覆うので毎日"],
    ["0 0 15 * SUN-SAT", "曜日名で全域を覆うので毎日"],
  ])("%s は cron-parser と同じ日に動く（%s）", (expression) => {
    expect(occurrences(expression, 5)).toEqual(referenceOccurrences(expression, 5));
  });

  // 片方が全域を覆っていれば OR でどの日にも一致する。日本語もそう言わなければならない。
  // `0-7` を全曜日として読めるようになったことで、ここが next と食い違っていた
  it.each([
    ["0 0 15 * 0-7", "毎日午前0時"],
    ["0 0 15 * 0-6", "毎日午前0時"],
    ["0 0 15 * 1-7", "毎日午前0時"],
    ["0 0 15 * SUN-SAT", "毎日午前0時"],
    ["0 0 1-31 * 5", "毎日午前0時"],
    ["0 0 15 2 0-6", "2月の毎日午前0時"],
    ["0 0 15 * *", "毎月15日の午前0時"],
    ["0 0 15 * 1", "毎月15日および月曜日の午前0時"],
  ])("%s の説明は「%s」", (expression, text) => {
    expect(explain(expression, { tz: "UTC" })).toBe(text);
  });

  // 日をずらすタイムゾーン変換も同じ判定を使う。毎日動く式を「15 日だけ」と読むと、
  // 月をまたぐかどうかの検査をすり抜けて、黙って別の予定の式を返してしまう
  it("毎日動く式は、日をずらす変換の対象にしない", () => {
    expect(() => explain("0 20 15 2 0-7", { tz: "Asia/Tokyo" })).toThrow(CronTimeZoneError);
    expect(explain("0 20 15 2 *", { tz: "Asia/Tokyo" })).toBe("毎年2月16日の午前5時");
  });
});

describe("表記が違っても同じ意味になる", () => {
  it.each([
    [
      "0 0 * * 0-7",
      [0, 1, 2, 3, 4, 5, 6],
      "0-7 は全曜日。7 を先に 0 と見ると日曜だけになってしまう",
    ],
    ["0 0 * * 1-7", [0, 1, 2, 3, 4, 5, 6], "月曜から日曜まで"],
    ["0 0 * * 0-7/2", [0, 2, 4, 6], "全曜日に刻みを付ける"],
    ["0 0 * * 7-7", [0], "7 も 0 も日曜"],
    ["0 0 * * 6-7", [0, 6], "土曜と日曜"],
    ["0 0 * * 0,7", [0], "同じ日曜の重複"],
    ["0 0 * * 7", [0], "7 は日曜"],
    ["0 0 * * SUN-SAT", [0, 1, 2, 3, 4, 5, 6], "曜日名で全域"],
  ] as const)("%s の曜日は %j（%s）", (expression, values, _note) => {
    expect(expandField(parseExpression(expression).ast.dayOfWeek, DOW_SPEC)).toEqual(values);
    expect(referenceValues(expression).dayOfWeek).toEqual(values);
  });

  it("全曜日になる書き方は、日本語でも曜日を言わない", () => {
    for (const expression of ["0 0 * * 0-7", "0 0 * * 1-7", "0 0 * * SUN-SAT", "0 0 * * *"]) {
      expect(explain(expression, { tz: "UTC" }), expression).toBe("毎日午前0時");
    }
    expect(explain("0 0 * * 0-7/2", { tz: "UTC" })).toBe(
      "毎週日曜日、火曜日、木曜日、土曜日の午前0時",
    );
  });

  it.each([
    ["*\t*\t*\t*\t*", "タブ区切り"],
    ["* \t    *\t \t  *   *  \t \t  *", "空白とタブの混在"],
    ["  * * * * *  ", "前後の空白"],
  ])("%s は '* * * * *' と同じ（%s）", (expression) => {
    expect(occurrences(expression, 3)).toEqual(occurrences("* * * * *", 3));
  });

  // cron-parser は同じ値が 2 度現れる式を拒否する。ただし配布ビルド v5.10.0 は重複値の
  // 判定が falsy 検査になっているため、重複しているのが `0` のときだけすり抜けて
  // `[0, 0]` のまま残る。うちは展開時に必ず一意にするので、比べるときは相手側で落としている
  it.each([
    ["0,0 * * * *", "minute"],
    ["0,0,0 * * * *", "minute"],
    ["0 0 * * 0,0,0", "dayOfWeek"],
  ] as const)("同じ値が並んだ %s は一度だけ数える", (expression, field) => {
    const { ast } = parseExpression(expression);
    const spec = field === "minute" ? MINUTE_SPEC : DOW_SPEC;
    expect(expandField(field === "minute" ? ast.minute : ast.dayOfWeek, spec)).toEqual([0]);
    expect(referenceValues(expression)[field]).toEqual([0]);
    expect(occurrences(expression, 3)).toEqual(referenceOccurrences(expression, 3));
  });

  it.each(["1,1 * * * *", "0 0 * * 1,1,1"])(
    "0 以外の重複は cron-parser が断る: %s",
    (expression) => {
      expect(() => CronExpressionParser.parse(expression)).toThrow(/duplicate values found/);
      // うちは重複を畳んで受け付ける。実行される日時は重複の有無で変わらない
      expect(validate(expression).valid).toBe(true);
    },
  );

  // 曜日は上限が 7（日曜）なので、`5/1` は金・土・日。範囲 `5-7` と同じ集合になる
  it.each([
    ["0 0 * * 7/2", [0], "7 は日曜。そこから先に値は無い"],
    ["0 0 * * 5/1", [0, 5, 6], "金曜から日曜まで"],
    ["0 0 * * 1/2", [0, 1, 3, 5], "月・水・金・日"],
    ["0 0 * * 0/2", [0, 2, 4, 6], "日・火・木・土"],
  ] as const)("曜日に刻みを付けた %s は %j（%s）", (expression, values, _note) => {
    expect(expandField(parseExpression(expression).ast.dayOfWeek, DOW_SPEC)).toEqual(values);
    expect(referenceValues(expression).dayOfWeek).toEqual(values);
    // 上限まで書き下した範囲と同じ集合になる（`1/2` は `1-7/2`）
    const range = expression.replace(/(\d)\/(\d)$/, "$1-7/$2");
    expect(expandField(parseExpression(range).ast.dayOfWeek, DOW_SPEC)).toEqual(values);
  });

  it.each([
    ["5/5 * * * *", false, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]],
    ["6/23 * * * *", false, [6, 29, 52]],
    ["0/30 * * * * ?", true, [0, 30]],
  ] as const)("値に刻みを付けた %s は最大値まで進む", (expression, seconds, values) => {
    const parsed = parseExpression(expression, seconds ? withSeconds : {});
    const target = seconds ? parsed.ast.seconds : parsed.ast.minute;
    expect(target).toEqual({
      kind: "step",
      base: { kind: "range", from: values[0], to: 59 },
      step: values[1] - values[0],
    });
    expect(expandField(target ?? { kind: "any" }, seconds ? SECOND_SPEC : MINUTE_SPEC)).toEqual(
      values,
    );
    expect(referenceValues(expression)[seconds ? "second" : "minute"]).toEqual(values);
  });
});
