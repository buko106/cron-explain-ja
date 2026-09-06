---
"cron-explain-ja": minor
---

cron 式（UTC）と日本語（既定 Asia/Tokyo）の間でタイムゾーンを変換する

「日本語で書いた予定を UTC のサーバーの crontab に貼る」「UTC の crontab を日本時間で読む」
のに必要な変換を入れた。cron 式は UTC のサーバーで動くものとして扱い、日本語は `tz`
（既定 `Asia/Tokyo`）の壁時計として読む。

```ts
parse("毎日午後1時").expression; // '0 4 * * *'
explain("0 4 * * *"); //            '毎日午後1時'
```

- **破壊的**: `explain` / `explainDetailed` は既定で UTC → `Asia/Tokyo` に読み替える。
  `explain('0 9 * * *')` は「毎日午後6時」になる。従来どおりの出力には `tz: 'UTC'` を指定する
- **破壊的**: `parse` は既定で `Asia/Tokyo` → UTC に読み替えた式を返す。
  `parse('平日の朝9時').expression` は `'0 0 * * 1-5'` になる。従来は `tz: 'UTC'`
- **破壊的**: `next` は cron 式を UTC として解釈する（従来は実行環境のローカル時刻）。
  `NextOptions.tz` は廃止。返るのは絶対時刻なので、表示のゾーンは呼び出し側で決める
- **破壊的**: `ExplainOptions.tz` は併記用の自由文字列ではなくなった。併記は `showTimeZone`
  に分けた（`explain(expr, { showTimeZone: true })`）
- **破壊的**: `cron-ja next --format=iso` をオフセット付き（`2026-09-07T13:00:00+09:00`）にする。
  オフセット 0 は従来どおり `Z`
- CLI の `--tz` は `explain` / `parse` / `next` で受け付ける（IANA のゾーン名か `local`）。
  `explain` に `--show-tz` を追加
- `ParseResult` に `localExpression` / `tz`、`Explanation` に `localExpression` / `tz` を追加
- 変換できない式（日をまたぐ時刻の混在、月をまたぐ日のずれ、`L`/`#`/`W`、分の繰り上がりの
  不一致、夏時間のあるゾーン）は `CronTimeZoneError` で失敗させる。近い式は返さない
- `cron-ja next --json` に `tz` フィールドを追加
