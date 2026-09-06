# DESIGN.md — cron-explain-ja 設計書

## 0. 目的とスコープ

cron 式と日本語の自然な表現を相互変換する。

- `explain`: cron 式 → 日本語文
- `parse`: 日本語文 → cron 式
- 補助: バリデーション、次回実行日時計算
- CLI: `cron-ja` コマンドで上記をシェルから利用

### 非目標（v1）

- 英語など他言語への対応
- LLM や機械学習による解釈
- 秒フィールド・タイムゾーン変換の完全対応（オプションでの最小対応のみ）
- 実際のジョブスケジューリング

### 設計原則

1. **決定的**: 同じ入力は常に同じ出力。乱数・外部API・時刻依存なし（`next` を除く）
2. **ゼロ依存**: ランタイム依存パッケージを持たない（CLI も含む）
3. **正直な曖昧性**: 解釈が一意でない場合は黙って決めず、`confidence` と `ambiguities` で返す
4. **拡張の分離**: 標準 5 フィールド cron を中心とし、Quartz 拡張（`L` `#` `W`）は明示的にマーク

---

## 1. 公開 API

### 1.1 エントリポイント

```ts
export { explain, explainDetailed } from './explain';
export { parse } from './parse';
export { validate, next } from './cron';
export type * from './types';
```

### 1.2 `explain(expression, options?) => string`

cron 式を 1 文の日本語に変換する。

```ts
explain('0 9 * * 1-5');           // '平日の午前9時'
explain('*/15 * * * *');          // '15分ごと'
explain('0 0 1 * *');             // '毎月1日の午前0時'
explain('30 18 * * 5');           // '毎週金曜日の午後6時30分'
explain('0 12 1,15 * *');         // '毎月1日と15日の正午'
explain('0 */2 * * *');           // '2時間ごと（毎時0分）'
explain('0 9-17 * * 1-5');        // '平日の午前9時から午後5時まで毎時0分'
explain('0 0 * 1 *');             // '1月の毎日午前0時'
explain('0 0 1 1 *');             // '毎年1月1日の午前0時'
```

不正な式は `CronSyntaxError` を throw する。

#### タイムゾーンの前提

**cron 式は UTC のサーバーで動くものとして扱い、日本語は `tz`（既定 `'Asia/Tokyo'`）の
壁時計として読む。** `explain` は UTC → `tz`、`parse` は `tz` → UTC に書き換える。
`tz: 'UTC'` を渡すと書き換えは起きない。詳細は §2.5。

#### ExplainOptions

```ts
interface ExplainOptions {
  /** 'casual': '毎日9時' / 'formal': '毎日午前9時00分' (default: 'casual') */
  style?: 'casual' | 'formal';
  /** '12h': '午後3時' / '24h': '15時' (default: '12h') */
  hour?: '12h' | '24h';
  /** 6フィールド（秒付き）として解釈 (default: false) */
  seconds?: boolean;
  /** cron 式(UTC)を読み替えるゾーン。IANA 名 または 'local' (default: 'Asia/Tokyo') */
  tz?: string;
  /** 文末に '（Asia/Tokyo）' とゾーン名を併記する (default: false) */
  showTimeZone?: boolean;
  /** 曜日を「平日」「週末」に畳むか (default: true) */
  collapseWeekdays?: boolean;
}
```

### 1.3 `explainDetailed(expression, options?) => Explanation`

```ts
interface Explanation {
  text: string;
  expression: string;              // 正規化済み
  fields: {
    second?: FieldExplanation;
    minute: FieldExplanation;
    hour: FieldExplanation;
    dayOfMonth: FieldExplanation;
    month: FieldExplanation;
    dayOfWeek: FieldExplanation;
  };
  extensions: Array<'L' | '#' | 'W' | '?'>;
  notes: string[];
  next: Date[];                    // 次回3回
}

interface FieldExplanation {
  raw: string;                    // '1-5'
  kind: 'any' | 'value' | 'list' | 'range' | 'step' | 'extension';
  values: number[];               // [1,2,3,4,5]
  text: string;                   // '平日'
}
```

### 1.4 `parse(text, options?) => ParseResult`

```ts
interface ParseResult {
  expression: string | null;      // UTC のサーバー向け
  localExpression: string | null; // tz の壁時計のまま
  tz: string;                     // 解釈に使ったゾーン（IANA の正規名）
  confidence: number;             // 0.0 – 1.0
  ambiguities: Ambiguity[];
  notes: string[];
  tokens: Token[];                // デバッグ用
}

interface Ambiguity {
  field: CronField;
  question: string;               // '「朝」は何時ですか？'
  candidates: Array<{ value: number | string; label: string }>;
}

interface ParseOptions {
  strict?: boolean;               // default: false
  defaultHour?: number;           // default: 9
  timeOfDay?: Partial<Record<TimeOfDayWord, number>>;
  allowExtensions?: boolean;      // default: false
  /** 日本語をどのゾーンの壁時計として読むか (default: 'Asia/Tokyo') */
  tz?: string;
}
```

#### 期待動作

| 入力 | expression | confidence | 備考 |
|---|---|---|---|
| 平日の朝9時 | `0 9 * * 1-5` | 1.0 | |
| 毎日9時半 | `30 9 * * *` | 1.0 | |
| 毎月15日の夕方6時 | `0 18 15 * *` | 1.0 | |
| 15分ごと | `*/15 * * * *` | 1.0 | |
| 2時間おき | `0 */2 * * *` | 1.0 | minute を 0 に固定 |
| 毎週月曜と金曜の午後3時 | `0 15 * * 1,5` | 1.0 | |
| 9時から18時まで30分ごと | `*/30 9-18 * * *` | 0.9 | 18時台の扱いに note |
| 毎日 | `0 9 * * *` | 0.6 | defaultHour 使用、ambiguity 付き |
| 朝 | `0 9 * * *` | 0.5 | 「毎日」補完 + 曖昧語 |
| 第2月曜の10時 | `0 10 * * 1#2` | 0.9 | extensions 使用 note |
| 月末の23時 | `0 23 L * *` | 0.9 | 同上 |
| 火曜日の15日 | `0 9 15 * 2` | 0.4 | DOM と DOW の OR 挙動を note |
| 毎時9分と39分 | `9,39 * * * *` | 1.0 | 分のリスト |
| 毎日午前0時と正午 | `0 0,12 * * *` | 1.0 | 時間帯語も 1 つの時刻 |
| 毎月28日から31日までの午前3時 | `0 3 28-31 * *` | 1.0 | 日の範囲 |
| 3か月ごとの1日の午前0時 | `0 0 1 */3 *` | 1.0 | 月の刻み |
| 1分から59分まで2分ごと | `1-59/2 * * * *` | 1.0 | 起点のある刻み |
| 毎月1日と3日ごとの午前0時 | `0 0 */3 * *` | 0.8 | 日の二重指定を note（後勝ち） |
| 2週間ごとの月曜日の午前0時 | `0 0 * * 1` | 0.7 | 週の刻みは表せず note |
| こんにちは | `null` | 0.0 | 時間表現が皆無 |

### 1.5 `validate(expression, options?) => ValidationResult`

```ts
interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: CronField | 'expression'; message: string; position?: number }>;
  warnings: string[];             // '2月30日は存在しません' など
}
```

### 1.6 `next(expression, options?) => Date[]`

```ts
interface NextOptions {
  from?: Date;                    // default: now
  count?: number;                 // default: 3
}
```

cron 式は UTC として解釈する。返るのは絶対時刻（`Date`）なので、どのゾーンで表示するかは
呼び出し側の裁量（CLI は `--tz` で表示する）。

### 1.7 エラー型

```ts
class CronSyntaxError extends Error {
  field?: CronField;
  position?: number;
}
class ParseAmbiguityError extends Error {   // strict モード時のみ
  result: ParseResult;
}
```

---

## 2. 内部設計

### 2.1 共通: cron 式の構文解析（`src/cron/parser.ts`）

```ts
interface CronAST {
  seconds?: FieldAST;
  minute: FieldAST;
  hour: FieldAST;
  dayOfMonth: FieldAST;
  month: FieldAST;
  dayOfWeek: FieldAST;
}

type FieldAST =
  | { kind: 'any' }                                   // *
  | { kind: 'value'; value: number }                  // 5
  | { kind: 'range'; from: number; to: number }       // 1-5
  | { kind: 'step'; base: FieldAST; step: number }    // */15, 1-10/2
  | { kind: 'list'; items: FieldAST[] }               // 1,3,5
  | { kind: 'last'; offset?: number }                 // L, L-3
  | { kind: 'nth'; weekday: number; nth: number }     // 1#2
  | { kind: 'nearestWeekday'; day: number }           // 15W
  | { kind: 'noSpecific' };                           // ?
```

- 許容範囲: minute 0-59, hour 0-23, dom 1-31, month 1-12, dow 0-7（7 は 0 に正規化。ただし
  範囲の `0-7` と刻みの起点 `7/n` は上限としての 7 を見る）
- 月名 `JAN`-`DEC`、曜日名 `SUN`-`SAT` を数値に変換
- マクロ `@daily` `@hourly` `@weekly` `@monthly` `@yearly` `@annually` を展開
- 位置情報を保持し、エラー時に `position` を返す

### 2.2 explain（cron → 日本語）

#### 2.2.1 フィールド単位の説明（`field.ts`）

| AST | 出力例 |
|---|---|
| minute any | （時と組み合わせて「毎分」） |
| minute value 0 | 「0分」（casual では省略） |
| minute value 30 | 「30分」→ 時と結合して「9時半」 |
| minute step 15 | 「15分ごと」 |
| hour range 9-17 | 「午前9時から午後5時まで」 |
| dow range 1-5 | 「平日」 |
| dow list 0,6 | 「週末」 |
| dow list 1,5 | 「月曜日と金曜日」 |
| dom value 1 | 「1日」 |
| dom last | 「月末」 |
| month value 1 | 「1月」 |
| dow nth 1#2 | 「第2月曜日」 |

#### 2.2.2 文の組み立て（`compose.ts`）

```
[年頻度] [月] [日 or 曜日] の [時刻表現]
```

パターン分岐（優先順）:

1. すべて any → 「毎分」
2. minute のみ → 「毎時N分」
3. minute step のみ → 「N分ごと」
4. hour step → 「N時間ごと（毎時M分）」
5. dom/month/dow すべて any → 「毎日」+ 時刻
6. dow のみ → 「毎週X曜日の」/「平日の」/「週末の」+ 時刻
7. dom のみ → 「毎月N日の」+ 時刻
8. month + dom → 「毎年M月N日の」+ 時刻
9. month のみ → 「M月の毎日」+ 時刻
10. dom と dow の両方 → 「毎月N日およびX曜日の」+ 時刻 + note（OR 挙動）

#### 2.2.3 時刻表現ルール

- `12h` casual: 0→「午前0時」、12 かつ minute 0→「正午」、13-23→「午後N時」
- `24h`: 「N時」
- minute 0: casual では「N時」、formal では「N時00分」
- minute 30: 「N時30分」（`explain('30 18 * * 5')` の例に合わせ、casual でも「N時半」は使わない。
  出力の一貫性を優先した。parse 側は「9時半」を入力として受け付ける）
- 「深夜」「早朝」など曖昧語は出力側で使わない

#### 2.2.4 範囲・リストの自然化

- 連続した list（`1,2,3`）は range に畳む
- 曜日 `1-5` → 「平日」、`0,6` → 「週末」、`0-6` → 省略
- 3 要素以上は「A、B、C」、2 要素は「AとB」

#### 2.2.5 分の節を置く位置

分の節は、前に時の節があるかで形を変える。

| 位置 | `5-59/15` | `0-30/5` |
|---|---|---|
| 単独（時が `*`、フィールド単位の説明） | 「5分から59分まで15分ごと」 | 「0分から30分まで5分ごと」 |
| 時の節に続く | 「毎時5分から15分ごと」 | 「毎時0分から30分まで5分ごと」 |
| 「N時台の」に続く | 「5分から15分ごと」 | 「0分から30分まで5分ごと」 |

自己完結した「AからBまで」のまま時の節に続けると
「午前9時から午後5時まで5分から59分まで15分ごと」と「まで」が重なって読めなくなる。
刻みは時をまたがないので、上限が 59 分なら「59分まで」は何も足さない。落として重なりを消す。
`0-30/5` のように途中で終わる範囲の上限は書かれた値なので残す。

### 2.3 parse（日本語 → cron）

#### 2.3.1 パイプライン

```
text → normalize() → tokenize() → fill() → emit()
```

#### 2.3.2 normalize

1. NFKC 正規化
2. 漢数字 → 算用数字（「半」は残す）
3. 「時」直前の「午前/午後/朝/夜」は保持
4. 空白、読点、「の」「に」「は」→ 区切り（「と」は list 用に別トークン）
5. 文末の動詞句除去（「〜してください」「〜したい」「〜に実行」など）

#### 2.3.3 辞書（`dictionary.ts`）

```ts
export const DOW: Record<string, number> = {
  日曜日: 0, 日曜: 0, 月曜日: 1, 月曜: 1, 火曜日: 2, 火曜: 2,
  水曜日: 3, 水曜: 3, 木曜日: 4, 木曜: 4, 金曜日: 5, 金曜: 5, 土曜日: 6, 土曜: 6,
};

export const DOW_SET: Record<string, number[]> = {
  平日: [1, 2, 3, 4, 5],
  週末: [0, 6],
  土日: [0, 6],
};

export const TIME_OF_DAY = {
  早朝: { default: 6,    range: [4, 7]   },
  朝:   { default: 9,    range: [6, 10]  },
  午前: { default: null, range: [0, 11]  },
  昼:   { default: 12,   range: [11, 13] },
  正午: { default: 12,   range: [12, 12] },
  午後: { default: null, range: [12, 23] },
  夕方: { default: 18,   range: [16, 19] },
  夜:   { default: 21,   range: [19, 23] },
  深夜: { default: 2,    range: [0, 4]   },
  夜中: { default: 2,    range: [0, 4]   },
} as const;

export const FREQ = {
  毎分: 'minute', 毎時: 'hour', 毎日: 'day', 毎週: 'week', 毎月: 'month', 毎年: 'year',
};

export const DOM_SPECIAL = { 月末: 'L', 月初: 1 };
export const NTH = { 第1: 1, 第2: 2, 第3: 3, 第4: 4, 第5: 5, 最終: 'L' };
```

単独の「月」「日」は月名・日付と衝突するため曜日辞書から除外し、「月曜」以上の長さでのみ曜日と認識する。

#### 2.3.4 tokenize

```ts
interface Token {
  type: 'FREQ' | 'DOW' | 'DOW_SET' | 'DOM' | 'DOM_SPECIAL' | 'MONTH'
      | 'TIME' | 'TIME_OF_DAY' | 'AMPM' | 'HOUR_SPAN' | 'INTERVAL'
      | 'RANGE_FROM' | 'RANGE_TO' | 'NTH' | 'SEP' | 'AND' | 'UNKNOWN';
  raw: string;
  value?: unknown;
  position: number;
}

const RULES: Array<[RegExp, (m: RegExpMatchArray) => Token]> = [
  [/^(\d{1,2})時間(ごと|おき|毎)/,  m => ({ type: 'INTERVAL', unit: 'hour', n: +m[1] })],
  [/^(\d{1,2})分(ごと|おき|毎)/,    m => ({ type: 'INTERVAL', unit: 'minute', n: +m[1] })],
  [/^(\d{1,2})日(ごと|おき|毎)/,    m => ({ type: 'INTERVAL', unit: 'day', n: +m[1] })],
  [/^(\d{1,2})[かヶ]?月(ごと|おき|毎)/, m => ({ type: 'INTERVAL', unit: 'month', n: +m[1] })],
  [/^(\d{1,2})週間?(ごと|おき|毎)/, m => ({ type: 'INTERVAL', unit: 'week', n: +m[1] })],
  [/^(\d{1,2})時(半|(\d{1,2})分)?/,  m => ({ type: 'TIME', hour: +m[1], minute: m[2]==='半'?30:+(m[3]??0) })],
  [/^(\d{1,2}):(\d{2})/,           m => ({ type: 'TIME', hour: +m[1], minute: +m[2] })],
  [/^第([1-5])/,                    m => ({ type: 'NTH', n: +m[1] })],
  [/^(\d{1,2})月/,                  m => ({ type: 'MONTH', value: +m[1] })],
  [/^(\d{1,2})日/,                  m => ({ type: 'DOM', value: +m[1] })],
  [/^(平日|週末|土日)/,             m => ({ type: 'DOW_SET', value: DOW_SET[m[1]] })],
  [/^(日|月|火|水|木|金|土)曜日?/,  m => ({ type: 'DOW', value: DOW[m[1]+'曜'] })],
  [/^(早朝|朝|昼|正午|夕方|夜中|深夜|夜)/, m => ({ type: 'TIME_OF_DAY', word: m[1] })],
  [/^(午前|午後)/,                  m => ({ type: 'AMPM', value: m[1] })],
  [/^毎(分|時|日|週|月|年)/,        m => ({ type: 'FREQ', value: FREQ['毎'+m[1]] })],
  [/^月末/,                         () => ({ type: 'DOM_SPECIAL', value: 'L' })],
  [/^から/,                         () => ({ type: 'RANGE_FROM' })],
  [/^まで/,                         () => ({ type: 'RANGE_TO' })],
  [/^(と|、|,)/,                    () => ({ type: 'AND' })],
  [/^台/,                           () => ({ type: 'HOUR_SPAN' })],
  [/^(の|に|は|\s)+/,               () => ({ type: 'SEP' })],
];
```

長い表現を先に試す。`UNKNOWN` は減点しつつ無視し、全トークンが `UNKNOWN`/`SEP` なら `expression: null`。

間隔の「毎」で終わる形（「15分毎」）は、後ろに頻度語の単位が続く場合だけ採らない。
「1月毎日」を「1か月ごと」＋「日」と切ってしまうため。
「9時台」の「台」は explain 側の言い回しで、意味は直前の時に含まれるので区切りとして読む。

#### 2.3.5 fill（スロット埋め）

```ts
interface Slots {
  minute: FieldAST; hour: FieldAST; dom: FieldAST; month: FieldAST; dow: FieldAST;
  extensions: Set<string>;
  penalties: Array<{ reason: string; amount: number }>;
  ambiguities: Ambiguity[];
  notes: string[];
}
```

**時刻**

- `TIME` → hour/minute。直前の `AMPM`/`TIME_OF_DAY` で補正（「午後3時」→15、「夜9時」→21）
- 補正後 hour が range 外なら note
- `TIME` 複数 → 値の並び（`ValueList`）と同じ形の並びで持つ。`AND` なら値、
  `RANGE_FROM…RANGE_TO` なら範囲。範囲は 2 つ以上あってよい
  （「0時から2時までと20時から23時まで」→ `0-2,20-23`）
- `TIME_OF_DAY` 単独 → `default` 採用、ambiguity、-0.3。
  時刻に結び付かなかった時間帯語はそれ自体が 1 つの時刻として扱う（「午前0時と正午」→ `0,12`）。
  並びの中の位置は保つので、範囲の端にも置ける（「朝から17時まで」→ `9-17`）。
  語を時に落とすのは `fill`（ambiguity と減点を積むため）で、`collect` は語のまま並びに置く
- 「AからBまで」の終端が持つ 0 分は書かれた値ではないので、分フィールドには採らない
  （「9時30分から17時まで」→ `30 9-17`）
- `MINUTE` 複数 → minute list（「毎時9分と39分」→ `9,39`）。
  時刻と並んだときは `MINUTE` が minute フィールドを決める。「9時」が持つ 0 分は
  書かれた値ではないため（「午後2時台の10分と44分」→ `10,44 14`）
- `HOUR_SPAN`（「台」）→ 直前の時が一点ではなくその時の中を指す
- `INTERVAL` minute N → minute step N。
  直前に「AからBまで」があればそれを起点にする（「1分から59分まで2分ごと」→ `1-59/2`）
- `INTERVAL` hour N → hour step N、minute 0。刻みは書かれた範囲それぞれに掛かる
  （「0時から2時までと20時から23時まで2時間ごと」→ `0-2/2,20-23/2`）。
  範囲が 1 つも無ければ起点を持たない全域からの刻み
- `毎分` → minute any。時が書かれていればその時の中での毎分（「午前9時台の毎分」→ `* 9`）。
  時の刻み・範囲は `毎分` と併記されても読む（「2時間ごとの毎分」→ `* */2`）
- 時刻トークン皆無 → `defaultHour`、ambiguity、-0.4

**日付・曜日**

- `DOW` → dow（複数は list）
- `DOW_SET` → dow range/list
- `NTH` + `DOW` → nth、extensions `#`
- `DOM` → dom
- `DOM_SPECIAL` L → last、extensions `L`
- `MONTH` → month
- `RANGE_FROM…RANGE_TO` は dom / dow / month でも範囲にする
  （「28日から31日まで」→ `28-31`、「火曜日から土曜日まで」→ `2-6`）。
  値の並びは「書かれたとおり」を保つ。連続した値を範囲に畳むのは 3 個以上のときだけなので、
  範囲を値の列に落とすと `28,31` のように意味が変わる
- `INTERVAL` day N → dom step N。直前に `DOM` と「から」があればそれを起点にする
  （「1日から3日ごと」→ `1-31/3`）。起点がフィールドの下限と上限を覆うなら `*` に畳む（→ `*/3`）
- `INTERVAL` month N → month step N。日が書かれていなければ `毎月` と同じ期待を置く。
  `毎日` が書かれていれば日は決まっているので補わない（「3か月ごとの毎日」→ dom any）
- `INTERVAL` week N → cron に週の刻みは無い。`毎週` として扱い、note、-0.3

**頻度語**

- `毎日` → dom/dow が any を期待（違えば note、-0.1）
- `毎週` → 直後に `DOW` を期待。なければ ambiguity
- `毎月` → 直後に `DOM` を期待。なければ ambiguity
- `毎時` → hour any、minute 未指定なら 0
- `毎分` → 全 any

**衝突**

- dom と dow が両方非 any → note「標準 cron では OR 条件」、-0.2
- `INTERVAL` と単独 `TIME` → ambiguity。
  ただし `HOUR_SPAN` が付いた時と分の刻みの組み合わせ（「9時台の10分ごと」）は
  読み方が 1 つしかないので曖昧にしない
- 同フィールドへ list 以外で 2 回代入 → 後勝ち + note、-0.2。
  値の並びと同じ単位の間隔が並んだ場合（「毎月1日と3日ごと」「毎時1分と5分ごと」）を含む。
  「1日から3日ごと」のように範囲として書かれていれば刻みの起点なので衝突にしない

**confidence**

```
confidence = max(0, 1.0 - Σ penalties)
```

UNKNOWN 1 つにつき -0.1（上限 -0.3）。

#### 2.3.6 emit

FieldAST → 文字列。`allowExtensions: false` かつ extensions 非空なら生成はするが note を付け -0.1。

### 2.4 next

- cron 式は UTC として解釈する（実行環境の `TZ` には依存しない）
- 分→時→日→月の順で次候補へジャンプ
- 5 年先まで見つからなければ空配列
- dom と dow 両指定は OR（Vixie cron 準拠）
- `L` `#` `W` は v1 非対応 → 空配列 + validate warning

### 2.5 タイムゾーンの書き換え（`src/cron/shift.ts`）

cron 式（UTC）と日本語（`tz` の壁時計）の間で、壁時計を固定のオフセットぶんだけずらす。
`explain` は `+offset`、`parse` は `-offset` を掛ける。

#### できること

| 段階 | 扱い |
|---|---|
| 分 | 1 日の中の分（0-1439）に直してずらし、分と時に戻す |
| 時 | 同上。`0-22/2` のような刻みは値の並びから組み直す（`*/2` に畳めるなら畳む） |
| 日をまたぐ | 曜日は循環でずらす。日は 1 日ずらす |
| 月 | 変えない |
| 秒 | オフセットは必ず分単位なので変えない |

#### できないこと（`CronTimeZoneError` で失敗させる）

cron 式は「フィールドごとに独立した値の集合」しか表せないので、その形に収まらない
組み合わせがある。近い式を黙って返すと半年ずれた予定を出すことになるため、失敗させる。

| 場面 | 例（`Asia/Tokyo`） |
|---|---|
| 分の繰り上がりが時刻によって変わる | `0,30 4 * * *` を `+5:45` のゾーンへ |
| 日をまたぐ時刻とまたがない時刻が混ざる | `0 9-17 * * 1-5`（18:00-翌02:00 になる） |
| 日が 1 日ずれて月をまたぐ | `0 20 31 * *`、`0 20 * 1 *` |
| 日がずれて `L` `#` `W` の意味が変わる | `0 20 L * *` |
| ゾーンに夏時間がある | `America/New_York` |

日をずらせるのは **1-28 日の範囲に収まるとき**だけ。29-31 日は月によって存在したりしなかったり
するため、ずらすと意味が変わる（`0 20 28 * *` の翌日は 2 月では 3 月 1 日になる）。

夏時間のあるゾーンは、そもそも 1 つの cron 式に落ちない（冬と夏で時刻が変わる）。
書き換えた式は crontab に貼られたあと何年も動くので、今年と翌年を 1 か月ごとに
24 点サンプルして、すべて同じオフセットであることを確かめる。

---

## 3. テスト方針

### 3.1 レイヤー

| レイヤー | 対象 | 方式 |
|---|---|---|
| 単体 | parser, normalize, tokenize, formatHour など | `it.each` |
| フィクスチャ | explain / parse の入出力 | JSONL 全件実行 |
| 往復 | `explain(parse(x))` の意味的一致 | フィクスチャ + 生成 |
| プロパティ | parser のクラッシュ耐性 | ランダム文字列 |
| 差分 | cron-parser との意味の一致 | フィクスチャ + ランダム生成 |
| CLI 単体 | commands/*.ts | io 差し替え |
| CLI E2E | dist/cli.js | execFile |
| 回帰 | issue 由来 | `test/regression/` |

### 3.2 フィクスチャ形式

`test/fixtures/explain.jsonl`

```jsonl
{"expr":"0 9 * * 1-5","casual":"平日の午前9時","formal":"平日の午前9時00分","h24":"平日の9時"}
{"expr":"*/15 * * * *","casual":"15分ごと"}
{"expr":"0 0 L * *","casual":"毎月月末の午前0時","extensions":["L"]}
```

`test/fixtures/parse.jsonl`

```jsonl
{"text":"平日の朝9時","expr":"0 9 * * 1-5","confidence":1.0}
{"text":"毎日","expr":"0 9 * * *","confidence":0.6,"ambiguities":["hour"]}
{"text":"こんにちは","expr":null,"confidence":0}
```

実装前に書き、仕様書として機能させる。

### 3.3 往復テスト

2 方向を回す。

- `parse → explain → parse`: `parse.jsonl` の各入力。式の文字列が一致すること
- `explain → parse`: `explain.jsonl` と `explain-real.jsonl` の全式。**意味**が一致すること

後者は式の文字列ではなく値の集合で比べる。

```ts
const signature = (expression: string) => {
  const { fields } = explainDetailed(expression);
  return JSON.stringify([
    fields.minute.values, fields.hour.values, fields.dayOfMonth.values,
    fields.month.values, fields.dayOfWeek.values,
  ]);
};
expect(signature(parse(explain(expr)).expression)).toBe(signature(expr));
```

`0-6` と `*`、曜日の `7` と `0`、`1-31/3` と `*/3` のように表記が違っても、
同じ日時に動くなら通す。`hour: '24h'` と `style: 'formal'` の言い回しでも同じ集合になることを
確かめる。拡張構文（`extensions`）と秒付き（`seconds`）は日本語で一意に表せないため除く。

### 3.4 組み合わせ生成テスト

時刻 × 曜日 × 頻度語を自動生成し、throw しない・valid・confidence 0-1 のみ検証。

### 3.5 cron-parser をベンチマークにした比較

`cron-parser`（MIT / harrisiirak, v5.10.0）を devDependency として入れ、同じ式を同じ意味で
読めているかを突き合わせる。相手は展開済みの値の配列（`CronField#values`）を、うちは構文木を
持つので、比べるのは「その式が動く値の集合」と「次回実行日時の並び」。

- `test/cron-parser-parity.test.ts`: 一致を見る。展開値・公開 API が返す値・次回実行日時
  （5 起点 × 5 件）・正規化表記の相互解釈を、フィクスチャとランダム生成の両方で比較する
- `test/cron-parser-cases.test.ts`: 意図的に違う振る舞いを固定する。相手のテストにあって
  うちのコーパスに無かった入力もここに取り込む

コーパスは `test/fixtures/cron-parser.jsonl`（cron-parser の `tests/CronExpression.test.ts`
と `tests/CronExpressionParser.test.ts` から採った式）と、既存の `explain.jsonl` /
`explain-real.jsonl`。

表記の違い（曜日の 7 と 0、`*` と `0-6`、値の重複、月が 1 つのときの日の切り詰め）は
`test/helpers/cron-parser.ts` で吸収する。吸収と除外は、こっそり広がると検査が空回りするので
番人を置く。読めない式・書き戻せない式は集合として、比べたフィールド数と式数は実数として
固定してあり、どれかが減ればテストが落ちる。

意図的な差で主なものは 3 つ。

| 差 | 相手 | うち |
|---|---|---|
| 循環範囲（`5-1`）、`L-3`、`15W`、`@midnight` | 断る | 読む |
| `H` 記法、`@minutely`、フィールド数の補完、任意フィールドの `?` | 読む | 断る |
| 曜日の `*/1`（日と曜日の OR 判定） | 制約と見なす | `*` と同じに扱う |

値と次回実行日時が一致していても、日本語が別の日を指していれば意味がない。日と曜日の OR を
`explain` だけが取り違えていた欠陥があったので、「62 日連続で動く式だけが日付を限定しない
日本語になる」ことも `next` を基準に確かめている。

### 3.6 カバレッジ

lines 90% / branches 85%、`dictionary.ts` は 100%。

### 3.7 手動レビュー（実施済み）

実在 crontab 201 件（重複を除いて 167 式）の `explain` 出力を一覧化して人手で確認し、
`test/fixtures/explain-real.jsonl` に固定した。各行の `source` が出典を示す。

収集元は次のとおり。

| 分類 | 例 |
|---|---|
| ディストリの標準設定 | Debian/Ubuntu `/etc/crontab`、`/etc/cron.d/*`（e2scrub_all, php, sysstat, mdadm, certbot）、RHEL `0hourly` |
| Web アプリ / CMS | Nextcloud, WordPress, Drupal, GitLab, Redmine, Matomo, AWStats |
| バックアップ | rsnapshot, Amanda, Bacula, BackupPC, borg/restic |
| 監視・セキュリティ | Munin, Zabbix, ClamAV, rkhunter, AIDE, Lynis |
| メール・DB | Mailman, postfix, Dovecot, PostgreSQL, MySQL, Elasticsearch |
| CI / コンテナ | GitHub Actions `on.schedule`、Kubernetes CronJob、Velero |
| Quartz / Spring | Quartz CronTrigger チュートリアルの例（秒付き 6 フィールド） |
| その他 | crontab のマクロ、crontab.guru の掲載例 |

レビューで見つかった問題と対応は §6「実装時に決めたこと」に記録した。
フィクスチャは `explain` が throw する式も `error` フィールドで固定している。

このコーパスは実在の式を集めたものなので、フィールドの端（全値を含む循環範囲、
幅を超える刻み、2 個だけ連続する時のリスト）は踏まない。そこはコーパスではなく
`test/explain-fields.test.ts` で押さえている。

---

## 4. CLI

### 4.1 方針

- コマンド名 `cron-ja`（`npx cron-explain-ja` でも起動）
- 引数解析は `util.parseArgs`、対話は `node:readline/promises`
- ライブラリの薄いラッパー。CLI 固有ロジックは入力の受け取りと出力整形のみ
- 人間向け出力とパイプ向け出力（`--json`）を分離

### 4.2 コマンド一覧

```
cron-ja <command> [args] [options]

Commands:
  explain   <expr>      cron式を日本語にする
  parse     <text>      日本語をcron式にする
  validate  <expr>      cron式を検証する
  next      <expr>      次回の実行日時を表示する
  (省略)    <input>     入力を自動判定して explain または parse

Global options:
  --json                JSON で出力する
  -q, --quiet           結果のみ出力
  --no-color            色を無効化（NO_COLOR 環境変数でも可）
  -h, --help
  -v, --version
```

サブコマンド省略時、5〜6 個の空白区切りフィールドで各フィールドが `[0-9*,/\-#LW?A-Za-z@]` のみなら `explain`、それ以外は `parse`。

### 4.3 各コマンド

#### explain

```
Options:
  --style <casual|formal>     default: casual
  --hour <12h|24h>            default: 12h
  --seconds
  --tz <zone>                 IANA ゾーン名 または local。default: Asia/Tokyo
  --show-tz                   文末にゾーン名を併記
  --detailed                  フィールド別内訳と次回3回を表示
```

```
$ cron-ja explain "0 9 * * 1-5"
平日の午前9時

$ cron-ja explain "0 9 * * 1-5" --detailed
平日の午前9時

  分      0        0分
  時      9        午前9時
  日      *        毎日
  月      *        毎月
  曜日    1-5      平日

次回:
  2026-09-07 (月) 09:00
  2026-09-08 (火) 09:00
  2026-09-09 (水) 09:00

$ cron-ja explain "0 0 L * *"
毎月月末の午前0時
note: 'L' は Quartz 拡張です。標準の cron では動作しません。
```

#### parse

```
Options:
  --strict                    曖昧なら失敗（exit 3）
  --default-hour <n>          default: 9
  --allow-extensions
  -i, --interactive           曖昧な点を対話で確認
```

```
$ cron-ja parse "平日の朝9時"
0 9 * * 1-5

$ cron-ja parse "毎日"
0 9 * * *
warn: 時刻が指定されていないため 9時 としました（confidence: 0.6）
      --default-hour で変更できます

$ cron-ja parse "毎日" --strict
error: 時刻が曖昧です: 「毎日」は何時ですか？
exit status 3

$ cron-ja parse "毎日" -i
? 「毎日」は何時ですか？ (0-23) › 9
0 9 * * *

$ cron-ja parse "こんにちは"
error: 時間表現が見つかりません
exit status 2
```

`--interactive` は stdin が TTY でなければ `--strict` 相当。

#### validate

```
$ cron-ja validate "0 9 * * 1-5"
ok

$ cron-ja validate "0 25 * * *"
error: 時 フィールドの値 25 は範囲外です (0-23)
  0 25 * * *
    ^^
exit status 2

$ cron-ja validate "0 0 30 2 *"
ok
warn: 2月30日は存在しないため、このジョブは実行されません
```

#### next

```
Options:
  -n, --count <n>             default: 3
  --from <iso-datetime>       default: 現在時刻
  --tz <zone>                 表示に使うゾーン。default: Asia/Tokyo
  --format <human|iso|unix>   default: human
```

式は UTC として数え、`--tz` は表示だけを変える。`--format` の出力はいずれも `--tz` のゾーンで表す。

| format | 例 |
|---|---|
| `human` | `2026-09-07 (月) 13:00`（ゾーンの壁時計） |
| `iso` | `2026-09-07T13:00:00+09:00`（オフセット付き。オフセット 0 は `Z`） |
| `unix` | `1757214000`（ゾーンに依存しない） |

`--from` にタイムゾーンを書かなかった日時（`2026-06-14T02:00`）は `--tz` の壁時計として読む。
`new Date()` に任せると実行環境のローカル時刻になり、結果がホストのゾーンに左右されるため。

`--json` の日時は `toISOString()` のまま（UTC 正規化）で、どのゾーンで表示したかは `tz`
フィールドで示す。

```
$ cron-ja next "0 9 * * 1-5" -n 5
2026-09-07 (月) 09:00
2026-09-08 (火) 09:00
...
```

### 4.4 入力の受け取り方

引数が無く stdin が TTY でない場合、または `-` を渡した場合は stdin を 1 行ずつ処理する。

```
$ crontab -l | grep -v '^#' | cut -d' ' -f1-5 | cron-ja explain
平日の午前9時
毎日午前3時
15分ごと

$ cat schedules.txt | cron-ja parse --json
{"input":"平日の朝9時","expression":"0 9 * * 1-5","confidence":1,...}
{"input":"毎日","expression":"0 9 * * *","confidence":0.6,...}
```

複数行時の `--json` は JSONL で `input` を付加。エラー行は `{"input":"...","error":"..."}` として続行。

### 4.5 出力の書き分け

| 状況 | stdout | stderr |
|---|---|---|
| 通常 | 結果 | note / warn |
| `--quiet` | 結果 | エラーのみ |
| `--json` | JSON | エラー（非 JSON） |
| エラー | 空 | `error: ...` |

`$(cron-ja parse "...")` で結果だけを受け取れるよう、note/warn は stderr。色は `NO_COLOR` または非 TTY で無効。

### 4.6 終了コード

| code | 意味 |
|---|---|
| 0 | 成功 |
| 1 | 内部エラー |
| 2 | 入力エラー |
| 3 | 曖昧（`--strict` 時のみ） |

複数行入力では最大のコードを返す。

### 4.7 ヘルプ

`args.ts` にオプション定義と説明を同一オブジェクトで持ち、`--help` を生成する。

```ts
const OPTIONS = {
  style: { type: 'string', description: '出力スタイル (casual|formal)', default: 'casual', commands: ['explain'] },
  json:  { type: 'boolean', description: 'JSON で出力', commands: '*' },
} as const;
```

### 4.8 テスト

- `commands/*.ts` は `(args, io) => Promise<number>` とし、`io` を差し替えて単体テスト
- E2E は `dist/cli.js` を `execFile` で実行し、`--version` 一致・stdin パイプ・exit code・`--json` の parse 可否を確認
- ヘルプはスナップショット

### 4.9 将来の拡張

- `cron-ja completion <bash|zsh|fish>`
- `cron-ja explain --watch <crontab-path>`
- `cron-ja parse --suggest`

---

## 5. マイルストーン

| Ver | 内容 |
|---|---|
| 0.1.0 | cron parser, explain（casual/12h）, validate, CLI 骨格（explain/validate） |
| 0.2.0 | parse 最小構成（TIME + DOW + FREQ）, 往復テスト, CLI parse |
| 0.3.0 | parse 拡張（INTERVAL, RANGE, DOM, MONTH）, ambiguity, CLI `-i` |
| 0.4.0 | explain オプション（formal/24h）, next, CLI next / --detailed |
| 0.5.0 | Quartz 拡張（L, #, W）, seconds, stdin 複数行 |
| 1.0.0 | API 凍結、ドキュメント整備 |

---

## 6. 未決事項

### 実装時に決めたこと

- 「18時まで30分ごと」は `9-18`（18時台を含む）とし、note で明示して -0.1 する
- 「毎週」単独のデフォルト曜日は月曜（ambiguity 付き、-0.3）
- 「土日」の出力順は `0,6`
- confidence は §2.3.5 の減点表を正とし、`confidence = max(0, 1 - Σ penalties)` で算出する。
  §1.4 の表の「火曜日の15日」は、この式に従うと 0.4（時刻未指定 -0.4 + 日と曜日の同時指定 -0.2）
- 「正午」のように時が一意に定まる時間帯語は、単独で現れても ambiguity にしない
- 時刻表現が無く、頻度語・日付・曜日・間隔のいずれも無い入力は「毎日」を補い -0.2 する
- `FieldAST` の `nth` は 1-5 に加えて `-1` を「最終曜日」（`5L`）として使う
- Vixie cron に合わせ、`5-1` のような循環する範囲を許容する
- `0-6` のように全域を列挙した指定は `*` と同じものとして説明する
- 「N週間ごと」は cron に対応する刻みが無い。`*/N` に落とせる週フィールドが無く、
  dow の `*/N` は「N 曜日ごと」であって「N 週ごと」ではないため、`毎週` として解釈し、
  表現できない旨を note にして -0.3 する。黙って毎週にすると 2 週おきの意図が消えるため、
  トークンとして読まずに `UNKNOWN` に落とすより減点の理由が明示できる

#### §3.7 のレビューで決めたこと

- 全域を `*` と同じに畳む扱いは、刻みの base にも適用する。
  `0-59/5` は `*/5` と同じ集合なので「5分ごと」とする（Quartz 由来の `0/5` は
  `0-59/5` に正規化されるため、この畳み込みが効く）。
  以前は「0分から59分まで5分ごと」となり、時の範囲と併記すると
  「午前8時から午前10時まで0分から59分まで30分ごと」のように「まで」が重なっていた。
  畳めるのは **base の下限がフィールドの下限と一致する場合だけ**。刻みは base の下限から
  数えるため、`1-0/2`（循環して全値を含む）は 1,3,5… であって `*/2` の 0,2,4… ではない
- フィールドの幅を超える刻みは「Nごと」と説明しない。`*/90` は実際には毎時 0 分に
  1 回動くだけで、「90分ごと」と言うと利用者の誤解をそのまま肯定してしまう。
  値の列（この場合「毎時0分」）として説明する
- 時のリストを点として扱うかの判定は、`describeValues` が範囲に畳む閾値（3 個以上）に
  合わせる。`toRanges` は 2 個の連なりも 1 範囲にするため、閾値がずれると
  `0 12,13 * * *` が「午後0時と午後1時毎時0分」のように接続の抜けた文になる
- `@daily <コマンド>` のように後ろにコマンドが続く crontab の行を受け付ける。
  マクロは常に先頭の 1 トークンなので、数値のフィールドと違って区切りが曖昧にならない。
  5 フィールドの行にコマンドが付いたものは、秒付き 6 フィールドと区別できないため
  従来どおりフィールド数のエラーにする
- 時をリストで並べて「台」を付けるときは、各時に付ける。
  「午後2時と午後6時台」では「台」が午後2時に掛からない
- 日の `*/N` は「N日ごと」のままにする。「1日からN日ごと」の方が
  月ごとに数え直す点が明確だが、言い回しが冗長になる。
  parse は後から「1日から3日ごと」も受け付けるようにした（`1-31/3` ＝ `*/3`）ので、
  explain の言い回しを変えても往復（§3.3）は壊れない。変える理由が無いので現状のままとする
- `0,15,30,45` のような等間隔のリストは刻みに畳まない。
  「毎時0分、15分、30分、45分」は冗長だが曖昧さがなく、書かれたとおりを保つ方を採る
- `@reboot` は「対応していないマクロ」ではなく、日時を持たないため説明できないものとして
  専用のエラーメッセージを返す。実在の crontab に頻出し、`crontab -l | cron-ja explain`
  で必ず当たるため
- 曜日番号は Unix cron（0=日曜）に従う。Quartz は 1=日曜なので、Quartz の式をそのまま
  渡すと曜日が 1 つずれる。仕様として受け入れ、README に注意書きを置く
- レビューで見つかった往復の不一致 16 件は、いずれも parse 側の欠陥だった
  （分・時のリストが 1 個目しか読まれない、「AからBまで」がリストになる、
  「Nか月ごと」が読めない、「AからBまでNごと」の起点が落ちる）。
  explain の出力は人手で確認済みの正解なので、explain ではなく parse を直した。
  修正後、このコーパスを往復テスト（§3.3）に繋いだ

#### 往復コーパスを広げたときに決めたこと

- 分の節は、置く位置で形を変える。前に時の節が無ければ自己完結した
  「5分から59分まで15分ごと」、時の節に続けるときは時の中での位置として
  「毎時5分から15分ごと」にする。自己完結した形のまま続けると
  「午前9時から午後5時まで5分から59分まで15分ごと」と「まで」が重なって読めなくなる。
  刻みは時をまたがないので、上限が 59 分なら「59分まで」は何も足さない。落として
  「まで」の重なりを消す。`0-30/5` のように途中で終わる範囲の上限は書かれた値なので残す
- 「台」は SEP ではなく `HOUR_SPAN` トークンとして読む。「9時台の10分ごと」は
  「その時の中で N 分ごと」で読み方が 1 つしかないのに、「台」を捨てると
  「間隔と単独時刻の併用」に見えて -0.2 していた。「9時に10分ごと」のように
  時が一点を指すときは曖昧なまま
- 往復テスト（§3.3）の対象を、拡張が `?` だけの式と秒フィールドが `0` の式にも広げた。
  `?` は「制約なし」で `*` と同じ集合、秒が 0 の式は文に秒が出てこないので、
  5 フィールドの意味なら比べられる。`L` `#` `W` は値に展開できないため除いたまま。
  この 3 件（`0 0/5 14,18 * * ?` / `0 0-5 14 * * ?` / `0 10,44 14 ? 3 WED`）が
  除外されていたせいで、下の parse の取りこぼしが往復テストをすり抜けていた
- レビューで見つかった parse の取りこぼし 4 件を直した。いずれも値を黙って捨てており、
  しかも confidence は 1.0 のままだった（設計原則 3 に反する）
  - 時のリストと間隔が並ぶと 1 つ目の時しか読まない（「午後2時台と午後6時台の5分ごと」）
  - 時刻と分のリストが並ぶと分を捨てて時刻側の 0 分を採る（「午後2時台の10分と44分」）
  - 「毎分」があると時の刻みを読まない（「2時間ごと（毎分）」が `* * * * *` になる）
  - 「Nか月ごと」が「毎日」と並んでも日を 1 日に決めてしまう（「3か月ごとの毎日毎分」）

#### 時刻を範囲の並びとして持ち直したときに決めたこと

- 時刻も値の並び（`ValueList`）と同じ構造で持つ。`collect` が時刻を `TimeValue[]` の
  平坦な並びで持ち、範囲かどうかを `timeMode` の 1 つの旗で表していたため、
  `times[0]`-`times[1]` の 1 組しか範囲にできず、`0 0-2,20-23 * * *` の説明を読み戻すと
  `0 0-2 * * *` になっていた（しかも confidence 0.9 のまま 20-23 を捨てていた）。
  `Span[]` + `pendingRange` を時刻版にした `TimeList` に置き換え、範囲を並べられるようにした
- 時間帯語（「朝」「夕方」）は `standaloneWords` に貯めて末尾に回すのをやめ、
  並びの中の書かれた位置に置く。後ろに回していたときは「朝から17時まで」の「朝」が
  「17時」の修飾語として吸われ、`* 17 * * *` を confidence 1.0 で返していた。
  語を時に落とすのは `resolveWord`（ambiguity と減点を積む）なので `fill` のままにし、
  `collect` は「時か、未解決の時間帯語か」を保ったまま範囲構造だけ記録する
- 「N時まで」の終端が N 時台を含む断りは、範囲ごとに付ける。「まで」はそれぞれ独立に
  曖昧なので、範囲が 2 つあれば note も減点も 2 つ
- 時の刻みは、書かれた範囲それぞれに掛ける（「0時から2時までと20時から23時まで2時間ごと」→
  `0-2/2,20-23/2`）。1 つの起点しか持てないと 2 つ目以降の範囲が黙って消える。
  範囲と単独の時が混ざっていれば単独の時はそのまま値として残す（→ `0-2/2,20`）
- 「まで」の来なかった「から」は範囲を作らない。「9時と17時から」は `9-17` ではなく `9,17`。
  「と」で並べた値に後から「から」が付いても、終端が無ければ範囲として読む根拠がない

#### タイムゾーンを開いたときに決めたこと

- **cron 式は UTC のサーバーで動くものとして扱い、日本語は `tz`（既定 `Asia/Tokyo`）の
  壁時計として読む。** 「日本語で書いた予定を UTC のサーバーの crontab に貼る」
  「UTC の crontab を日本時間で読む」の 2 つが、このライブラリの主な使い道だから。
  サーバー側は固定で、指定できるのは日本語側のゾーンだけ
- `tz` の意味は「日本語側のゾーン」の 1 つに揃える。`explain` `parse` `next`（表示）で
  同じ意味になる。以前の `ExplainOptions.tz`（併記だけの自由文字列）は `showTimeZone` に分けた
- **`explain` の併記に既定値は入れない。** 既定で「（Asia/Tokyo）」が付くと、実在 crontab から
  起こしたフィクスチャ 209 件が全部書き換えになる。併記は `showTimeZone` を明示したときだけ
- **フィクスチャは `tz: 'UTC'`（書き換えなし）で回す。** cron 式と日本語の対応そのものと、
  タイムゾーンの書き換えは別の関心。混ぜると 209 件の期待値が「+9 時間した文」になり、
  人手でレビューした意味が薄れる
- **書き換えられない式はエラーにする**（§2.5）。近い式を warn 付きで返す案もあったが、
  警告を読み飛ばすと半年ずれた予定が黙って通る。cron 式は貼ったあと誰も見ない
- ゾーン名の検証と正規化は `Intl.DateTimeFormat(...).resolvedOptions().timeZone` に任せる。
  実行環境が知っている名前が常に正になり、`asia/tokyo` や `JST` のような別名も揃う
- `next` は UTC 解釈に固定した。返すのは絶対時刻なので、表示のゾーンは CLI の関心にした
- `--format=iso` はオフセット付き（`2026-09-07T13:00:00+09:00`）に変える。
  ゾーンを指定したのに `Z` で出るのは分かりにくい。オフセット 0 は `Z` のまま

#### 1.0 の API 凍結で決めたこと

公開 API として保証する範囲は README「互換性」に書いた。以下はその判断の記録。

- **書き換えられない式は throw のまま凍結する。** 実在 crontab のフィクスチャ 167 件のうち、
  5 フィールドの式で既定 tz（`Asia/Tokyo`）から `CronTimeZoneError` になるのは 6 件。
  `*/5 9-17 * * 1-5` のような業務時間帯の式が含まれるので無視できる数ではないが、
  近い式を黙って返す危険（§2.5）と天秤にかけて方針は変えない。
  代わりに **CLI で逃げ道を案内する**。`--tz UTC` を知らないとエラーだけ見て行き止まりに
  なるため、書き換えに失敗したときだけ note で 1 回出す。ライブラリのメッセージは
  フィクスチャが文面ごと押さえているので触らない。
  オプトインのフォールバック（`onUnrepresentable` のようなもの）は後から非破壊で足せるので、
  必要になってから入れる
- **`ParseResult.tokens` は残すが semver の対象外**にする。デバッグには役立つが、
  ここを凍結するとトークン種別を増やすたびに major が要る。型（`Token` / `TokenType`）ごと
  「中身は minor でも変わりうる」と `types.ts` と README に明記した
- **サーバー側のゾーン指定は 1.0 では入れない。** JST のサーバーの crontab を読むのに
  `--tz UTC` と書かせるのは名前として直感的でないが、`srcTz` のようなオプションは
  後から足しても非破壊。凍結するのは「`tz` は日本語側のゾーン」という意味だけにする
- **`next` が `L` / `#` / `W` の式で空配列を返すのは維持する。** throw に変えると
  `explainDetailed` が内部で `next` を呼んでいる（§1.3 の `next` フィールド）ため、
  拡張構文を含む式の説明まで失敗する。README に明記して現状のまま凍結する
- **`FieldAST` の `kind` は minor でも増えうる**ものとして扱う。`LW` を後から足せる余地を
  残すため。網羅 `switch` を書く利用者には `default` を用意してもらう
- `explain` 文末の「に実行」オプションは入れない。付ける値がない
- `next` の探索上限（5 年）は固定のまま。設定できるようにする理由が見当たらない

### 残っているもの

- Quartz の `LW`（月末最後の平日）が未対応。`L` `L-3` `15W` は解釈できるが `LW` は
  `FieldAST` に対応する種別がない（§2.1）。実在の crontab では稀なため見送った
- 範囲を含む値の並びは書かれた順のまま出す（「1日から3日までと10日から12日まで」→
  `1-3,10-12`）。重なりや逆順は整理しないので、書き方によっては冗長な式になる