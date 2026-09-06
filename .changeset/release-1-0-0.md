---
"cron-explain-ja": major
---

1.0.0: 公開 API を凍結する

0.2.0 からの破壊的変更はない。動く範囲は同じで、**どこまでを約束するかを決めた**リリース。

保証するもの:

- `explain` / `explainDetailed` / `parse` / `validate` / `next` の引数とオプション
- `Explanation` / `ParseResult` / `ValidationResult` のフィールドの型と意味
- `CronSyntaxError` / `CronTimeZoneError` / `ParseAmbiguityError`
- CLI のサブコマンド、オプション名、終了コード、stdout に出る内容

対象外にするもの（変わっても major は上げない）:

- 出力される日本語の言い回しと、stderr の note / warn の文面
- `ParseResult.tokens`（`Token` / `TokenType`）。デバッグ用で、パーサの改良に伴って変わる
- `FieldAST` の `kind` の顔ぶれ。Quartz の `LW` など未対応の構文を後から足せるようにする
- `confidence` の具体的な値

判断の根拠は DESIGN.md §6「1.0 の API 凍結で決めたこと」に、約束の一覧は README
「互換性」に書いた。
