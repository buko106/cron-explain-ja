# リリース設定のトラブルシューティング履歴

Release ワークフロー（changesets + npm の Trusted Publishing）を組むまでに踏んだ失敗の
記録です。**現在必要な設定は README の「リリース」に書いてあります**。ここにあるのは
「なぜその設定なのか」「外すとどう壊れるか」だけで、手順書ではありません。

どれも症状が原因から遠いものばかりで、設定を変える前に読み返す価値があります。
npm のパッケージには同梱していません。

## Version PR の CI が承認待ちで止まる

**症状** — changesets のアクションが作った「Version Packages」PR で、CI が
`action_required` のまま動かない。必須チェックが埋まらないのでブランチ保護によって
マージできない。

**原因** — ビルトインの `GITHUB_TOKEN` で push すると、承認ゲートの対象になる。
承認前の run は check run を作らないため、チェックが「待ち」ですらなく空のままになる。

**対処** — write 権限を持つユーザーの PAT（`RELEASE_TOKEN`）で push する。アクターが
そのユーザーになり、承認なしで CI が走る。

fine-grained トークンは changesets のアクションで push に失敗する報告があるため、
classic PAT（`repo` スコープ）を使う。未設定でも `GITHUB_TOKEN` にフォールバックするので、
リリース自体は動く（Version PR の承認だけ手作業になる）。

`RELEASE_TOKEN` は `actions/checkout` の `token` にも渡している。changesets の
アクションは v2 から既定で GitHub API 経由で push するため通常は不要だが、
`push-with-git-cli` を有効にすると checkout が `.git/config` に埋めた
`http.extraheader` が使われ、push だけ bot 名義に戻るため。

## `changesets/action@v1` でタグと Release が黙って飛ばされる

**症状** — publish は成功しているのに、git のタグが push されず GitHub Release も
作られない。ログにエラーは出ない。

**原因** — v1 は publish の出力から `New tag:` の行を探して公開を検知するが、
`@changesets/cli` 3.x はその形式で出力しない。

**対処** — アクションは **v2 以上**を使う。v2 は NDJSON のファイル経由で結果を
受け取るのでこの取りこぼしが起きない。

## npm への publish が E403（Trusted Publishing）

**症状** — トークンの交換は 201 で成功し、provenance の署名まで通ったうえで、
最後の `PUT` だけが 403 になる。

```
npm http fetch POST 201 https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/cron-explain-ja
npm verbose oidc Successfully retrieved and set token
npm notice publish Signed provenance statement with source and build information from GitHub Actions
npm http fetch PUT 403 https://registry.npmjs.org/cron-explain-ja - OIDC permission denied for this action
```

**原因** — Trusted publisher の **Allowed actions** で `npm publish` が有効になっていない。
npm は 2026-09-03 に既定を変えており、それ以降に作った設定は `npm stage publish` だけが
許可された状態でできあがる（直接 publish は設定ごとの opt-in）。

「permission denied for this **action**」の action は、GitHub Actions ではなく
`npm publish` / `npm stage publish` という**アクションの種別**を指している。交換が
成功することは、publish の権限があることを意味しない（1.0.1 はこれで 3 回落ちた）。

**対処** — Trusted publisher の設定で `npm publish` にチェックを入れる。

なお npm 自身は、trust relationship では `npm stage publish` だけを許可することを推奨して
いる。ステージングは CI が 2FA 無しで版を「保留状態」で置き、人が `npm stage approve`
（2FA が要る）で公開する仕組み。安全側だが公開に手作業が挟まるので、ここでは
自動リリースを優先して `npm publish` を選んでいる。

## OIDC が試されず通常の認証に落ちる

**症状** — ログに OIDC の交換が現れないまま、認証エラーで publish が止まる。

**原因** — ワークフローの `permissions` に `id-token: write` が無いと、npm CLI は
OIDC を試さずに黙って通常の認証へ落ちる。

**対処** — `permissions` に `id-token: write` を入れる。

## npm CLI のバージョン（10 系では動かず、12 系では別の失敗）

**症状** — Node 22 の同梱 npm（10 系）では Trusted Publishing がそもそも動かない。
一方 12 系に上げると `EUNKNOWNCONFIG` で publish が落ちる。

**原因** — OIDC は npm 11.5.1 以上が必要。`changeset publish` が呼ぶのは `pnpm publish`
だが、pnpm は publish 本体を node と同じディレクトリの npm（無ければ PATH 上の npm）へ
委譲するため、pnpm 自体が OIDC 未対応でも入れ替えた npm がそのまま使われる。
pnpm 9 は自分専用のフラグ（`--no-git-checks`）もそのまま npm へ渡すが、npm 12 は
未知のフラグを `EUNKNOWNCONFIG` で撥ねる（11 は警告のみで通す）。

**対処** — `npm install --global "npm@^11.5.1"` で 11 系に入れ替える。12 に上げるなら、
委譲前にフラグを落とす pnpm 10 以上へ先に揃えること。

## 認証失敗が 404 になって原因を見失う

**症状** — publish が 404 で落ちる。パッケージ名の間違いにしか見えない。

**原因** — `actions/setup-node` に `registry-url` を指定すると、
`//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` を書いた `.npmrc` が
`NPM_CONFIG_USERCONFIG` になる。OIDC が効かなかったときにプレースホルダのトークンで
publish され、認証失敗が 404 で返ってくる。

**対処** — `registry-url` を **指定しない**。既定のレジストリは registry.npmjs.org なので
publish 先は変わらず、認証が無いときは `ENEEDAUTH` で止まるので原因が分かる。

## Version PR が作られない

**症状** — main にマージしても changesets のアクションが Version PR を作らない。

**原因** — **Settings → Actions → General → Workflow permissions** が
「Read repository contents permission」になっている。

**対処** — 「Read and write permissions」にする。

## ジョブが 1 つも作られず `startup_failure`

**症状** — run は作られるがジョブが 1 つも無く `startup_failure` で終わる。
**Re-run ボタンも出ない**。

**原因** — **Settings → Actions → General → Actions permissions** でサードパーティの
アクションが許可されていない。ワークフローは `pnpm/action-setup` と `changesets/action`
を使うため、オーナー製と GitHub 製だけに絞ると起動できない。

**対処** — サードパーティのアクションを許可する。「Allow specified actions」で絞る場合は、
**カンマ区切りで、バージョンを固定せずに**入力する。

```
pnpm/action-setup@*, changesets/action@*
```

改行や空白で区切ると全体が 1 個のパターンとして扱われ、何にも一致しなくなる。
エラーには登録済みのパターンが表示されるため、一見すると一致しているように見えて
原因が分かりにくい。`changesets/action@v1` のようにバージョンを固定すると、アクションを
v2 に上げた時点で弾かれる。`actions/checkout` と `actions/setup-node` は GitHub 製なので
記載は不要。

設定を戻したあとは、ジョブが無い run には Re-run ボタンが出ないため、main に何か push して
新しい run を起こす必要がある。
