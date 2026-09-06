# cron-explain-ja

[![npm](https://img.shields.io/npm/v/cron-explain-ja.svg)](https://www.npmjs.com/package/cron-explain-ja)
[![CI](https://github.com/buko106/cron-explain-ja/actions/workflows/ci.yml/badge.svg)](https://github.com/buko106/cron-explain-ja/actions/workflows/ci.yml)

cron 式と日本語を相互変換するライブラリ / CLI。ランタイム依存パッケージはありません。

ブラウザから試せる[デモページ](https://www.buko106.tokyo/cron-explain-ja/)があります。

**cron 式は UTC のサーバーで動くもの、日本語は `tz`（既定 `Asia/Tokyo`）の時刻**として
扱います。「日本語で書いた予定を UTC のサーバーの crontab に貼る」「UTC の crontab を
日本時間で読む」ためのタイムゾーン変換が入ります。

```ts
parse("毎日午後1時").expression; // '0 4 * * *'   JST 13:00 → UTC 04:00
explain("0 4 * * *"); //            '毎日午後1時'  UTC 04:00 → JST 13:00
```

変換したくない場合は `tz: "UTC"`（CLI では `--tz UTC`）を指定します。

## CLI

インストールせずに npx から実行できます。パッケージ名は `cron-explain-ja`、
コマンド名は `cron-ja` です。

```bash
$ npx cron-explain-ja explain "0 4 * * 1-5"
平日の午後1時

$ npx cron-explain-ja parse "毎日午後1時"
0 4 * * *
```

繰り返し使うならインストールして `cron-ja` で呼びます（以下の例はこの形で書きます）。

```bash
npm i -g cron-explain-ja      # プロジェクトに入れるなら npm i -D cron-explain-ja
```

### コマンド

```
cron-ja <command> [args] [options]

Commands:
  explain   <expr>      cron式を日本語にする
  parse     <text>      日本語をcron式にする
  validate  <expr>      cron式を検証する
  next      <expr>      次回の実行日時を表示する
  (省略)    <input>     入力を自動判定して explain または parse
```

引数を省略して標準入力をパイプすると、1 行ずつ処理します。

```bash
$ cron-ja parse "毎日午後1時"
0 4 * * *

$ cron-ja explain "0 4 * * 1-5"
平日の午後1時

$ cron-ja explain "0 4 * * 1-5" --detailed
平日の午後1時

  UTC 0 4 * * 1-5  →  Asia/Tokyo 0 13 * * 1-5

  分      0       0分
  時      13      午後1時
  日      *       毎日
  月      *       毎月
  曜日    1-5     平日

次回:
  2026-09-07 (月) 13:00
  2026-09-08 (火) 13:00
  2026-09-09 (水) 13:00

$ cron-ja explain "0 9 * * 1-5" --tz UTC     # 変換しない
平日の午前9時

$ cron-ja parse "毎日"
0 0 * * *
warn: 「毎日」は何時ですか？ → '9' としました（confidence: 0.6）
      --default-hour で変更できます

$ cron-ja validate "0 25 * * *"
error: 時 フィールドの値 25 は範囲外です (0-23)
  0 25 * * *
    ^^

$ cron-ja explain "0 9-17 * * 1-5"           # 変換できない式
error: Asia/Tokyo（時差 +9:00）では日付をまたぐ時刻とまたがない時刻が混ざるため、cron 式に書き換えられません

$ crontab -l | grep -v '^#' | cut -d' ' -f1-5 | cron-ja explain --tz UTC
平日の午前9時
毎日午前3時
15分ごと
```

### オプション

すべてのコマンドで使えます。

| オプション | 説明 |
| --- | --- |
| `--json` | JSON で出力する（複数行入力では JSONL） |
| `-q`, `--quiet` | 結果のみ出力する |
| `--no-color` | 色を無効化する（`NO_COLOR` 環境変数でも可） |
| `-h`, `--help` | ヘルプを表示する |
| `-v`, `--version` | バージョンを表示する |

`explain`:

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--style <casual\|formal>` | `casual` | `formal` は分を 2 桁で必ず表示する |
| `--hour <12h\|24h>` | `12h` | `24h` は「15時」形式 |
| `--seconds` | — | 6 フィールド（秒付き）として解釈する |
| `--tz <zone>` | `Asia/Tokyo` | 日本語側のタイムゾーン。IANA 名か `local` |
| `--show-tz` | — | 文末にタイムゾーン名を併記する |
| `--detailed` | — | フィールド別の内訳と次回 3 回を表示する |

`parse`:

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--tz <zone>` | `Asia/Tokyo` | 日本語を読む壁時計のゾーン。出力は常に UTC |
| `--strict` | — | 曖昧なら失敗する（exit 3） |
| `--default-hour <n>` | `9` | 時刻が読み取れないときに使う時 |
| `--allow-extensions` | — | `L` / `#` / `W` の使用を許可する |
| `-i`, `--interactive` | — | 曖昧な点を対話で確認する |

`validate`:

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--seconds` | — | 6 フィールド（秒付き）として解釈する |

`next`:

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `--seconds` | — | 6 フィールド（秒付き）として解釈する |
| `--tz <zone>` | `Asia/Tokyo` | 表示に使うゾーン。式は常に UTC として数える |
| `-n`, `--count <n>` | `3` | 表示件数 |
| `--from <iso-datetime>` | — | 起点の日時（ISO 8601） |
| `--format <human\|iso\|unix>` | `human` | 出力形式 |

`--tz` は `explain` と `parse` では変換に、`next` では表示に使います。
`--from` にタイムゾーンを書かなかった場合（`2026-06-14T02:00` など）は `--tz` の壁時計として
読みます（`Z` やオフセットを書けばそのとおりに解釈します）。

```bash
$ cron-ja next "0 4 * * *" -n 2              # 表示は Asia/Tokyo
2026-09-07 (月) 13:00
2026-09-08 (火) 13:00

$ cron-ja next "0 4 * * *" --tz UTC --format iso -n 1
2026-09-07T04:00:00Z
```

結果は stdout、note / warn は stderr に出るため、`$(cron-ja parse "...")` で結果だけを
受け取れます。`--json`（複数行入力では JSONL）でスクリプトから扱えます。

終了コード: `0` 成功 / `1` 内部エラー / `2` 入力エラー / `3` 曖昧（`--strict` 時）。

## ライブラリ

```bash
npm i cron-explain-ja
```

```ts
import { explain, parse } from "cron-explain-ja";

explain("0 9 * * 1-5", { tz: "UTC" }); // '平日の午前9時'
parse("平日の朝9時", { tz: "UTC" }).expression; // '0 9 * * 1-5'
```

### `explain(expression, options?): string`

cron 式を 1 文の日本語にします。不正な式は `CronSyntaxError` を投げます。

以下の例は既定の `tz`（`Asia/Tokyo`）で動かしたものです。入力の cron 式は UTC なので、
出力の時刻は 9 時間進んでいます。

```ts
explain("*/15 * * * *"); // '15分ごと'
explain("0 0 1 * *"); // '毎月1日の午前9時'
explain("0 */3 * * *"); // '3時間ごと（毎時0分）'
explain("0 0-8 * * 1-5"); // '平日の午前9時から午後5時まで毎時0分'
explain("0 0 * * *", { hour: "24h" }); // '毎日9時'
explain("0 0 * * *", { style: "formal" }); // '毎日午前9時00分'
explain("0 4 * * *"); // '毎日午後1時'（UTC 04:00 を JST で読む）
explain("0 9 * * *", { tz: "UTC" }); // '毎日午前9時'（変換しない）
explain("0 4 * * *", { showTimeZone: true }); // '毎日午後1時（Asia/Tokyo）'
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `style` | `'casual'` | `'formal'` は分を 2 桁で必ず表示する |
| `hour` | `'12h'` | `'24h'` は「15時」形式 |
| `seconds` | `false` | 6 フィールド（秒付き）として解釈する |
| `tz` | `'Asia/Tokyo'` | cron 式(UTC)を読み替えるゾーン。IANA 名か `'local'` |
| `showTimeZone` | `false` | 末尾に `（zone）` を付ける |
| `collapseWeekdays` | `true` | `1-5` を「平日」、`0,6` を「週末」に畳む |

`L` / `#` / `W` は Quartz 拡張として解釈しますが、**曜日番号は Unix cron の 0 = 日曜**に
従います。Quartz は 1 = 日曜なので、Quartz 向けに書かれた式をそのまま渡すと曜日が 1 つ
ずれます。7 も日曜なので、`0-7` は「日曜から日曜」ではなく全曜日を指します。

```ts
explain("0 1 * * 6L"); // '最終土曜日の午前10時'（Quartz の意味では最終金曜日）
```

マクロは `@daily /usr/bin/foo` のようにコマンドが続いていても解釈します（crontab の行を
そのまま渡せます）。ただし `@reboot` は起動時に一度だけ実行される指定で日時を持たないため、
`CronSyntaxError` を投げます。

### `explainDetailed(expression, options?): Explanation`

フィールド別の内訳、正規化済みの式、注意書き、次回 3 回を返します。

```ts
const detail = explainDetailed("0 0 * * 1-5");
detail.text; // '平日の午前9時'
detail.expression; // '0 0 * * 1-5'（入力(UTC)を正規化。JAN は数値に、単独の 7 は 0 になる）
detail.localExpression; // '0 9 * * 1-5'（tz の壁時計。text と fields はこちらの説明）
detail.fields.dayOfWeek; // { raw: '1-5', kind: 'range', values: [1,2,3,4,5], text: '平日' }
detail.next; // [Date, Date, Date]
```

### `parse(text, options?): ParseResult`

日本語を cron 式にします。解釈が一意でないときは黙って決めず、`confidence`
（0.0–1.0）と `ambiguities` で返します。

日本語は `tz`（既定 `Asia/Tokyo`）の壁時計として読み、返る `expression` は UTC です。

```ts
parse("平日の朝9時"); // { expression: '0 0 * * 1-5', confidence: 1, ... }
parse("毎時9分と39分"); // { expression: '9,39 * * * *', confidence: 1, ... }
parse("毎月10日から20日までの午後3時"); // { expression: '0 6 10-20 * *', confidence: 1, ... }
parse("3か月ごとの1日の午前9時"); // { expression: '0 0 1 */3 *', confidence: 1, ... }
parse("毎日"); // { expression: '0 0 * * *', confidence: 0.6, ambiguities: [{ field: 'hour', ... }] }
parse("こんにちは"); // { expression: null, confidence: 0, ... }
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `strict` | `false` | 曖昧なら `ParseAmbiguityError` を投げる |
| `defaultHour` | `9` | 時刻が読み取れないときに使う時 |
| `timeOfDay` | — | 「朝」などの既定の時を上書きする |
| `allowExtensions` | `false` | `L` / `#` / `W` の使用で減点しない |
| `tz` | `'Asia/Tokyo'` | 日本語を読む壁時計のゾーン。IANA 名か `'local'`。出力は常に UTC |

### `validate(expression, options?): ValidationResult`

構文エラーを投げずに返し、実行されない日付なども警告します。

```ts
validate("0 25 * * *").errors; // [{ field: 'hour', message: '…範囲外です (0-23)', position: 2 }]
validate("0 0 30 2 *").warnings; // ['2月30日は存在しないため、このジョブは実行されません']
```

### `next(expression, options?): Date[]`

次回の実行日時を返します。**式は UTC として解釈します**（実行環境の `TZ` には依存しません）。
返るのは絶対時刻なので、どのタイムゾーンで表示するかは呼び出し側の裁量です。
日と曜日の同時指定は標準 cron と同じく OR 条件、`L` / `#` / `W` を含む式は空配列を返します。

```ts
next("0 9 * * 1-5", { count: 5, from: new Date() });
```

## タイムゾーン

`tz` には `'Asia/Tokyo'` `'America/New_York'` のような IANA のゾーン名か、実行環境の
タイムゾーンを指す `'local'` を渡せます。`'UTC'` を渡すと変換は起きません。

```ts
parse("毎日午後1時").expression; // '0 4 * * *'
parse("毎日午後1時", { tz: "UTC" }).expression; // '0 13 * * *'
explain("0 20 * * 1"); // '毎週火曜日の午前5時'（UTC 月曜 20:00 = JST 火曜 05:00）
```

日をまたぐときは曜日や日も一緒にずれます。`parse` の `localExpression`、`explainDetailed`
の `localExpression` に、変換前後のもう一方の式が入ります。

### 変換できない式

cron 式は「フィールドごとに独立した値の集合」しか表せないため、ずらした結果がその形に
収まらないことがあります。近い式を黙って返すと半年ずれた予定になるので、
`CronTimeZoneError` を投げます。

| 場面 | 例（`Asia/Tokyo`） |
| --- | --- |
| 日をまたぐ時刻とまたがない時刻が混ざる | `0 9-17 * * 1-5`（18:00〜翌02:00 になる） |
| 日が 1 日ずれて月をまたぐ | `0 20 31 * *`、`0 20 * 1 *` |
| 日がずれて `L` / `#` / `W` の意味が変わる | `0 20 L * *` |
| 分の繰り上がりが時刻によって変わる | `0,30 4 * * *` を `+5:45` のゾーンへ |
| ゾーンに夏時間がある | `America/New_York` |

夏時間のあるゾーンは、冬と夏で時刻が変わるため 1 つの cron 式に落ちません。書き換えた式は
crontab に貼られたあと何年も動くので、オフセットが変わらないことは**今年と翌年**にわたって
確かめます。変換せずに読みたい場合は `tz: "UTC"` を指定してください。

## 開発

開発用ツールチェーン（vitest 5 / changesets 3）は **Node 22.12 以上**を必要とします。
公開されるパッケージ自体は `engines` のとおり Node 18.3 以上で動作し、CI の
`runtime` ジョブがビルド成果物を Node 18 / 20 で実行して検証しています。

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

詳細な設計は [DESIGN.md](https://github.com/buko106/cron-explain-ja/blob/main/DESIGN.md) を
参照してください（npm のパッケージには同梱していません）。

## リリース

変更は [changesets](https://github.com/changesets/changesets) で記録します。

```bash
pnpm changeset        # 変更の種類（major/minor/patch）と説明を書く
```

main にマージすると Release ワークフローが「Version Packages」PR を作り、その PR を
マージすると npm に公開されます。npm への publish は Trusted Publishing（OIDC）で行うので、
npm のトークンは保管していません。

リポジトリの外側にある設定（GitHub Secrets、npm の trusted publisher、Actions の設定）と、
それらを外したときにどう壊れたかの記録は
[RELEASE.md](https://github.com/buko106/cron-explain-ja/blob/main/RELEASE.md) にあります。

## 互換性

[Semantic Versioning](https://semver.org/lang/ja/) に従います。1.0.0 以降、次のものを
公開 API として扱います。

- `explain` / `explainDetailed` / `parse` / `validate` / `next` の引数とオプション
- `Explanation` / `ParseResult` / `ValidationResult` が返すフィールドの型と意味
- `CronSyntaxError` / `CronTimeZoneError` / `ParseAmbiguityError` の型
- CLI のサブコマンド、オプション名、終了コード、stdout に出る内容

次のものは対象外です。変わっても major は上げません。

| 対象外 | 理由 |
| --- | --- |
| 出力される日本語の言い回し | 不自然な説明を直すのは patch。文面に依存するなら自分でスナップショットを取ること |
| stderr の note / warn の文面 | 同上 |
| `ParseResult.tokens`（`Token` / `TokenType`） | デバッグ用。パーサを改良すると種別が増減する |
| `FieldAST` の `kind` の顔ぶれ | Quartz の `LW` など未対応の構文を後から足せるようにしておく。`switch` を書くなら `default` を用意すること |
| `confidence` の具体的な値 | 減点の重みは実例を見て調整する。閾値で使うなら余裕を持たせること |

## ライセンス

[MIT](./LICENSE)
