---
"cron-explain-ja": patch
---

リリースを npm の Trusted Publishing（OIDC）経由に切り替えた

ライブラリと CLI の動作は 1.0.0 と同じ。長期トークン（`NPM_TOKEN`）を GitHub
Secrets に置く代わりに、GitHub Actions の OIDC トークンを npm の短命な publish
トークンに交換して公開するようにした。同梱の README のリリース手順も、この
構成に合わせて書き直している。

1.0.1 からは provenance が付く。npm のパッケージページから、この tarball が
`buko106/cron-explain-ja` の `release.yml` で作られたことを検証できる。
