# cron-explain-ja

cron 式と日本語を相互変換するライブラリ / CLI。ランタイム依存パッケージはありません。

```ts
import { explain, parse } from "cron-explain-ja";

explain("0 9 * * 1-5"); // '平日の午前9時'
parse("平日の朝9時").expression; // '0 9 * * 1-5'
```

## インストール

```bash
npm i cron-explain-ja
```

## ライブラリ

### `explain(expression, options?): string`

cron 式を 1 文の日本語にします。不正な式は `CronSyntaxError` を投げます。

```ts
explain("*/15 * * * *"); // '15分ごと'
explain("0 0 1 * *"); // '毎月1日の午前0時'
explain("0 */2 * * *"); // '2時間ごと（毎時0分）'
explain("0 9-17 * * 1-5"); // '平日の午前9時から午後5時まで毎時0分'
explain("0 9 * * *", { hour: "24h" }); // '毎日9時'
explain("0 9 * * *", { style: "formal" }); // '毎日午前9時00分'
explain("0 9 * * *", { tz: "Asia/Tokyo" }); // '毎日午前9時（Asia/Tokyo）'
```

`tz` は「この cron 式が動くタイムゾーン」です。`explain` では**指定したときだけ**末尾に
併記します（既定では何も付きません）。`explainDetailed` では `next` の計算にも使います。

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `style` | `'casual'` | `'formal'` は分を 2 桁で必ず表示する |
| `hour` | `'12h'` | `'24h'` は「15時」形式 |
| `seconds` | `false` | 6 フィールド（秒付き）として解釈する |
| `tz` | — | この式が動くタイムゾーン。指定すると末尾に `（zone）` を付ける |
| `collapseWeekdays` | `true` | `1-5` を「平日」、`0,6` を「週末」に畳む |

`L` / `#` / `W` は Quartz 拡張として解釈しますが、**曜日番号は Unix cron の 0 = 日曜**に
従います。Quartz は 1 = 日曜なので、Quartz 向けに書かれた式をそのまま渡すと曜日が 1 つ
ずれます。

```ts
explain("0 10 * * 6L"); // '最終土曜日の午前10時'（Quartz の意味では最終金曜日）
```

マクロは `@daily /usr/bin/foo` のようにコマンドが続いていても解釈します（crontab の行を
そのまま渡せます）。ただし `@reboot` は起動時に一度だけ実行される指定で日時を持たないため、
`CronSyntaxError` を投げます。

### `explainDetailed(expression, options?): Explanation`

フィールド別の内訳、正規化済みの式、注意書き、次回 3 回を返します。

```ts
const detail = explainDetailed("0 9 * * 1-5");
detail.text; // '平日の午前9時'
detail.expression; // '0 9 * * 1-5'（JAN や 7 は数値・0 に正規化される）
detail.fields.dayOfWeek; // { raw: '1-5', kind: 'range', values: [1,2,3,4,5], text: '平日' }
detail.next; // [Date, Date, Date]
```

### `parse(text, options?): ParseResult`

日本語を cron 式にします。解釈が一意でないときは黙って決めず、`confidence`
（0.0–1.0）と `ambiguities` で返します。

```ts
parse("平日の朝9時"); // { expression: '0 9 * * 1-5', confidence: 1, ... }
parse("毎時9分と39分"); // { expression: '9,39 * * * *', confidence: 1, ... }
parse("毎月28日から31日までの午前3時"); // { expression: '0 3 28-31 * *', confidence: 1, ... }
parse("3か月ごとの1日の午前0時"); // { expression: '0 0 1 */3 *', confidence: 1, ... }
parse("毎日"); // { expression: '0 9 * * *', confidence: 0.6, ambiguities: [{ field: 'hour', ... }] }
parse("こんにちは"); // { expression: null, confidence: 0, ... }
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `strict` | `false` | 曖昧なら `ParseAmbiguityError` を投げる |
| `defaultHour` | `9` | 時刻が読み取れないときに使う時 |
| `timeOfDay` | — | 「朝」などの既定の時を上書きする |
| `allowExtensions` | `false` | `L` / `#` / `W` の使用で減点しない |

### `validate(expression, options?): ValidationResult`

構文エラーを投げずに返し、実行されない日付なども警告します。

```ts
validate("0 25 * * *").errors; // [{ field: 'hour', message: '…範囲外です (0-23)', position: 2 }]
validate("0 0 30 2 *").warnings; // ['2月30日は存在しないため、このジョブは実行されません']
```

### `next(expression, options?): Date[]`

次回の実行日時を返します。日と曜日の同時指定は標準 cron と同じく OR 条件です。
`L` / `#` / `W` を含む式は計算対象外で、空配列を返します。

```ts
next("0 9 * * 1-5"); // 既定は Asia/Tokyo の 9 時
next("0 9 * * 1-5", { count: 5, from: new Date(), tz: "America/New_York" });
next("0 9 * * 1-5", { tz: "local" }); // 実行環境のタイムゾーン
```

| オプション | 既定 | 説明 |
| --- | --- | --- |
| `from` | 現在時刻 | 起点。これより後の日時だけを返す |
| `count` | `3` | 取得件数 |
| `seconds` | `false` | 6 フィールド（秒付き）として解釈する |
| `tz` | `'Asia/Tokyo'` | 壁時計を解釈するタイムゾーン |

`tz` には `'Asia/Tokyo'` `'America/New_York'` のような IANA のゾーン名か、実行環境の
タイムゾーンを指す `'local'` を渡せます。**実行環境の `TZ` には依存しません**
（`'local'` を明示したときだけ従います）。解釈できない名前は `CronTimeZoneError` を投げます。

夏時間のある地域では、境界を次のように扱います。

| 場面 | 例（`America/New_York`） | 挙動 |
| --- | --- | --- |
| その壁時計が存在しない | `30 2 * * *` の 2026-03-08 | 切り替え直後（03:30 EDT）に寄せて 1 回 |
| 壁時計が 2 回ある | `30 1 * * *` の 2026-11-01 | 早い方（01:30 EDT）で 1 回だけ |

## CLI

```
cron-ja <command> [args] [options]

Commands:
  explain   <expr>      cron式を日本語にする
  parse     <text>      日本語をcron式にする
  validate  <expr>      cron式を検証する
  next      <expr>      次回の実行日時を表示する
  (省略)    <input>     入力を自動判定して explain または parse
```

```bash
$ cron-ja explain "0 9 * * 1-5"
平日の午前9時

$ cron-ja explain "0 9 * * 1-5" --detailed
平日の午前9時

  分      0       0分
  時      9       午前9時
  日      *       毎日
  月      *       毎月
  曜日    1-5     平日

次回:
  2026-09-07 (月) 09:00
  2026-09-08 (火) 09:00
  2026-09-09 (水) 09:00

$ cron-ja parse "毎日"
0 9 * * *
warn: 「毎日」は何時ですか？ → '9' としました（confidence: 0.6）
      --default-hour で変更できます

$ cron-ja validate "0 25 * * *"
error: 時 フィールドの値 25 は範囲外です (0-23)
  0 25 * * *
    ^^

$ cron-ja next "0 9 * * 1-5" -n 3
2026-09-07 (月) 09:00
2026-09-08 (火) 09:00
2026-09-09 (水) 09:00

$ cron-ja next "0 9 * * 1-5" --tz America/New_York --format iso -n 2
2026-09-07T09:00:00-04:00
2026-09-08T09:00:00-04:00

$ crontab -l | grep -v '^#' | cut -d' ' -f1-5 | cron-ja explain
平日の午前9時
毎日午前3時
15分ごと
```

結果は stdout、note / warn は stderr に出るため、`$(cron-ja parse "...")` で結果だけを
受け取れます。`--json`（複数行入力では JSONL）でスクリプトから扱えます。

終了コード: `0` 成功 / `1` 内部エラー / `2` 入力エラー / `3` 曖昧（`--strict` 時）。

`--tz` には IANA のゾーン名か `local` を渡します。`next` は既定で `Asia/Tokyo` として数え、
`--format` の出力（`human` の壁時計、`iso` のオフセット）もそのゾーンで表します。
`explain` では併記にしか使いません。`--json` の日時は UTC 正規化のままで、
どのゾーンで数えたかは `tz` フィールドに入ります。

## 開発

開発用ツールチェーン（vitest 5 / changesets 3）は **Node 22.12 以上**を必要とします。
公開されるパッケージ自体は `engines` のとおり Node 18.3 以上で動作し、CI の
`runtime` ジョブがビルド成果物を Node 18 / 20 で実行して検証しています。

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

詳細な設計は [DESIGN.md](./DESIGN.md) を参照してください。

### リリース

変更は [changesets](https://github.com/changesets/changesets) で記録します。

```bash
pnpm changeset        # 変更の種類（major/minor/patch）と説明を書く
```

main にマージすると Release ワークフローが「Version Packages」PR を作り、その PR を
マージすると npm に公開されます。

必要な GitHub Secrets は次の 2 つです。

| Secret | 用途 |
|---|---|
| `NPM_TOKEN` | npm への publish。`cron-explain-ja` に対する Read and write 権限 |
| `RELEASE_TOKEN` | Version PR に CI を走らせるための classic PAT（`repo` スコープ） |

`RELEASE_TOKEN` が要るのは、ビルトインの `GITHUB_TOKEN` で push すると **Version PR の
CI が承認待ち（`action_required`）で止まる**ためです。承認前の run は check run を作らない
ので必須チェックが埋まらず、ブランチ保護でマージできません。write 権限を持つユーザーの
PAT で push すればアクターがそのユーザーになり、承認なしで CI が走ります。

fine-grained トークンは changesets のアクションで push に失敗する報告があるため、
classic PAT を使ってください。未設定でも `GITHUB_TOKEN` にフォールバックするので、
リリース自体は動きます（Version PR の承認だけ手作業になります）。

`RELEASE_TOKEN` は `actions/checkout` の `token` にも渡しています。changesets の
アクションは v2 から既定で GitHub API 経由で push するため通常は不要ですが、
`push-with-git-cli` を有効にすると checkout が `.git/config` に埋めた
`http.extraheader` が使われ、push だけ bot 名義に戻るためです。

アクションは **v2 以上**を使ってください。v1 は publish の出力から `New tag:` の行を
探して公開を検知しますが、`@changesets/cli` 3.x はその形式で出力しないため、
**タグの push と GitHub Release の作成が黙って飛ばされます**（publish 自体は成功するので
気づきにくい）。v2 は NDJSON のファイル経由で結果を受け取るのでこの問題がありません。

`NPM_TOKEN` は `NODE_AUTH_TOKEN` としても渡す必要があります。`actions/setup-node` に
`registry-url` を指定すると `NPM_CONFIG_USERCONFIG` が設定され、npm は changesets が書く
`~/.npmrc` ではなくそちらを読むためです。渡し忘れると setup-node が入れたプレースホルダの
まま publish され、**npm は認証失敗を 404 で返す**ので権限不足と見分けがつきません。

（0.1.0 はこの設定漏れに気づく前に手元から publish しました。トークンの種類が原因では
ありません）

**Settings → Actions → General → Actions permissions** は、サードパーティのアクションを
許可する設定にしておく必要があります。ワークフローが `pnpm/action-setup` と
`changesets/action` を使っているためです。オーナー製と GitHub 製だけに絞ると
`startup_failure` になります。

「Allow specified actions」で絞る場合は、**カンマ区切りで、バージョンを固定せずに**
入力してください。

```
pnpm/action-setup@*, changesets/action@*
```

改行や空白で区切ると全体が 1 個のパターンとして扱われ、何にも一致しなくなります。
エラーには登録済みのパターンが表示されるため、一見すると一致しているように見えて
原因が分かりにくいので注意してください。

`changesets/action@v1` のようにバージョンを固定すると、アクションを v2 に上げた
時点で弾かれます。`actions/checkout` と `actions/setup-node` は GitHub 製なので
記載は不要です。

この失敗はジョブが 1 つも作られないため **Re-run ボタンが出ません**。設定を戻したあと、
main に何か push して新しい run を起こす必要があります。

## ライセンス

[MIT](./LICENSE)
