# cron-explain-ja

## 0.1.2

### Patch Changes

- d44e1aa: README のリリース手順から誤った記述を削除した。npm の publish が 404 になる原因を
  「Granular Access Token では新規パッケージを作成できない」と説明していたが、実際は
  `NODE_AUTH_TOKEN` の渡し漏れであり、トークンの種類とは無関係だった。

## 0.1.1

### Patch Changes

- 2106a11: `exports` に `./package.json` を追加し、`require('cron-explain-ja/package.json')` が
  `ERR_PACKAGE_PATH_NOT_EXPORTED` にならないようにした。パッケージのメタ情報を読む
  ツールから参照できる。

## 0.1.0

### Minor Changes

- 93a6109: DESIGN.md に沿った初期実装
  
  - `explain` / `explainDetailed`: cron 式 → 日本語。casual/formal、12h/24h、秒フィールド、タイムゾーン併記に対応
  - `parse`: 日本語 → cron 式。confidence と ambiguities で解釈の曖昧さを返す
  - `validate`: 構文エラーを投げずに返し、存在しない日付や日と曜日の OR 挙動を警告
  - `next`: 次回実行日時の計算（UTC / ローカル、秒フィールド対応）
  - cron パーサ: 5〜6 フィールド、マクロ、月名・曜日名、循環範囲、Quartz 拡張（`L` `#` `W` `?`）
  - CLI `cron-ja`: explain / parse / validate / next、サブコマンド自動判定、標準入力の複数行処理、
    `--json`（複数行は JSONL）、`--detailed`、`-i` の対話解決、終了コードの使い分け
