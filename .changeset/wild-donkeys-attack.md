---
"cron-explain-ja": minor
---

DESIGN.md に沿った初期実装

- `explain` / `explainDetailed`: cron 式 → 日本語。casual/formal、12h/24h、秒フィールド、タイムゾーン併記に対応
- `parse`: 日本語 → cron 式。confidence と ambiguities で解釈の曖昧さを返す
- `validate`: 構文エラーを投げずに返し、存在しない日付や日と曜日の OR 挙動を警告
- `next`: 次回実行日時の計算（UTC / ローカル、秒フィールド対応）
- cron パーサ: 5〜6 フィールド、マクロ、月名・曜日名、循環範囲、Quartz 拡張（`L` `#` `W` `?`）
- CLI `cron-ja`: explain / parse / validate / next、サブコマンド自動判定、標準入力の複数行処理、
  `--json`（複数行は JSONL）、`--detailed`、`-i` の対話解決、終了コードの使い分け
