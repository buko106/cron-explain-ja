---
"cron-explain-ja": patch
---

`exports` に `./package.json` を追加し、`require('cron-explain-ja/package.json')` が
`ERR_PACKAGE_PATH_NOT_EXPORTED` にならないようにした。パッケージのメタ情報を読む
ツールから参照できる。
