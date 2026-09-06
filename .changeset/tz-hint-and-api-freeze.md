---
"cron-explain-ja": patch
---

書き換えられない式に当たったとき、CLI が逃げ道を案内するようにした

`cron-ja explain "0 9-17 * * 1-5"` のように、実在の crontab 行をそのまま渡すと
タイムゾーンの書き換えに失敗することがある（実在 crontab のフィクスチャ 167 件のうち 6 件）。
これまではエラーだけで終わっていたため、`--tz UTC` を知らないと行き止まりだった。
書き換えに失敗したときだけ、note を 1 回出す。

```
$ cron-ja explain "0 9-17 * * 1-5"
error: Asia/Tokyo（時差 +9:00）では日付をまたぐ時刻とまたがない時刻が混ざるため、cron 式に書き換えられません
note: --tz UTC を付けると書き換えを止められます
```

あわせて 1.0.0 に向けた互換性の約束を README に書き、`ParseResult.tokens`
（`Token` / `TokenType`）が semver の対象外であることを型のドキュメントにも明記した。
