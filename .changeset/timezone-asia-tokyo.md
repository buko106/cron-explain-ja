---
"cron-explain-ja": minor
---

タイムゾーンを開き、既定を `Asia/Tokyo` にする

- **破壊的**: `next()` は実行環境のローカル時刻ではなく `Asia/Tokyo` を既定として解釈する。
  JST 以外の環境では返る値が変わる（`explainDetailed().next` も同じ）。
  従来どおり実行環境のゾーンで見たい場合は `tz: 'local'` を明示する
- `NextOptions.tz` を `'UTC' | 'local'` から `string` に広げ、IANA のゾーン名
  （`'Asia/Tokyo'` `'America/New_York'` …）を受け付ける。`'local'` は実行環境のゾーンを指す
- CLI の `--tz` も IANA のゾーン名を受け付ける。意味は「この cron 式が動くタイムゾーン」に統一し、
  `explain` は併記、`next` は計算に使う
- `explainDetailed()` の `next` を `tz` のゾーンで計算する
- **破壊的**: `cron-ja next --format=iso` をオフセット付き（`2026-09-07T09:00:00+09:00`）にする。
  オフセット 0 は従来どおり `Z`。`--format=human` は指定ゾーンの壁時計で出す
- `cron-ja next --json` に `tz` フィールドを足す（日時は従来どおり UTC 正規化）
- 解釈できないゾーン名に `CronTimeZoneError` を追加（CLI では exit 2）
- 夏時間の境界を決めた。存在しない壁時計（春の飛び）は切り替え直後に寄せて 1 回、
  2 回ある壁時計（秋の巻き戻し）は早い方で 1 回だけ動かす

`explain()` の文面は変わらない。併記は従来どおり `tz` を明示したときだけ付く。
