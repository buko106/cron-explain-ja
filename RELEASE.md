# リリース

バージョンは [release-please](https://github.com/googleapis/release-please) が main の
コミットメッセージ（Conventional Commits）から決めます。main にマージするとリリース PR
（`chore(main): release X.Y.Z`）ができ、その PR をマージするとタグ・GitHub Release・
npm への publish がまとめて走ります。npm への publish は Trusted Publishing（OIDC）で
行うので、npm のトークンは保管していません。

この文書はリポジトリの外側にある設定（GitHub Secrets、npm の trusted publisher、
リポジトリの Actions 設定）と、それらを外したときにどう壊れたかの記録です。
npm のパッケージには同梱していません。日々の使い方は README の「リリース」にあります。

## 必要な設定

**GitHub Secrets** は次の 1 つだけです。

| Secret | 用途 |
|---|---|
| `RELEASE_TOKEN` | リリース PR に CI を走らせるための classic PAT（`repo` スコープ） |

fine-grained トークンは使えません。未設定でも `GITHUB_TOKEN` にフォールバックするので
リリース自体は動きますが、main は必須チェック 5 つで保護されているため、リリース PR は
チェックが埋まらずマージできなくなります。

**npm** 側は **npmjs.com → cron-explain-ja → Settings → Trusted publisher** で GitHub Actions を
登録しておく必要があります。ここで指定したワークフロー以外からは publish できません。

| 項目 | 値 |
| --- | --- |
| Organization or user | `buko106` |
| Repository | `cron-explain-ja` |
| Workflow filename | `release.yml` |
| Environment | （空欄） |
| Allowed actions | **`npm publish` にチェック** |

公開リポジトリの公開パッケージなので、npm CLI が provenance も自動で付けます。
Trusted publisher を登録すれば `NPM_TOKEN` の Secret は不要です。

**GitHub の Settings → Actions → General** は次の 2 つを設定します。

| 項目 | 値 |
| --- | --- |
| Workflow permissions | Read and write permissions |
| Actions permissions | Marketplace verified creators を許可（または許可リストに `googleapis/release-please-action@*`） |

**ワークフロー側**の前提は次の 3 つです。

- `permissions` に `id-token: write` を入れる
- npm CLI を 11.5.1 以上にする（Node 24 の同梱 npm が満たすので、入れ替えの手順は要らない）
- リリース PR を作るトークンに `RELEASE_TOKEN` を渡す

## トラブルシューティング履歴

Release ワークフローを組むまでに踏んだ失敗の記録です。上の設定を変える前に読んでください。
どれも症状が原因から遠く、診断に時間がかかったものばかりです。

### npm への publish が E403（Trusted Publishing）

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

### OIDC が試されず通常の認証に落ちる

**症状** — ログに OIDC の交換が現れないまま、認証エラーで publish が止まる。

**原因** — ワークフローの `permissions` に `id-token: write` が無いと、npm CLI は
OIDC を試さずに黙って通常の認証へ落ちる。

**対処** — `permissions` に `id-token: write` を入れる。

### 認証失敗が 404 になって原因を見失う

**症状** — publish が 404 で落ちる。パッケージ名の間違いにしか見えない。

**原因** — `actions/setup-node` の `registry-url` は
`//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` を書いた `.npmrc` を
`NPM_CONFIG_USERCONFIG` に置く。`NODE_AUTH_TOKEN` は渡していないので、OIDC が効かなかった
ときだけプレースホルダのまま publish され、認証失敗が 404 で返ってくる。

**対処** — 404 が出たらパッケージ名ではなく OIDC を疑い、ログに
`oidc` の行があるかを先に見る。`registry-url` は npm の Trusted Publishing の手順が
指定するものなので外さない（外しても既定のレジストリは同じだが、指定なしの構成は
npm 側の想定から外れる）。

### Version PR / リリース PR の CI が走らない

**症状** — リリース用に自動で作られた PR で CI が動かない。必須チェックが埋まらないので
ブランチ保護によってマージできない。

**原因** — ビルトインの `GITHUB_TOKEN` で作った PR は、無限ループ防止のためワークフローを
起動しない（changesets のときは `action_required` で止まった）。承認前の run は check run を
作らないため、チェックが「待ち」ですらなく空のままになる。

**対処** — write 権限を持つユーザーの PAT（`RELEASE_TOKEN`）をアクションの `token` に渡す。
アクターがそのユーザーになり、通常の PR と同じように CI が走る。fine-grained トークンは
push に失敗する報告があるため、classic PAT（`repo` スコープ）を使う。

### リリース PR が作られない

**症状** — main にマージしてもリリース PR ができない。

**原因** — 次のどちらか。

- **Settings → Actions → General → Workflow permissions** が
  「Read repository contents permission」になっている。
- 前回のリリース以降のコミットに `feat:` / `fix:` が 1 つも無い。`chore:` や `ci:` だけでは
  バージョンが上がらないので、release-please は PR を作らない（異常ではない）。

**対処** — 前者は「Read and write permissions」にする。後者は仕様どおりなので、
リリースしたい変更に `feat:` / `fix:` を付ける。

### ジョブが 1 つも作られず `startup_failure`

**症状** — run は作られるがジョブが 1 つも無く `startup_failure` で終わる。
**Re-run ボタンも出ない**。

**原因** — **Settings → Actions → General → Actions permissions** でサードパーティの
アクションが許可されていない。Release ワークフローは `googleapis/release-please-action` を
使うため、オーナー製と GitHub 製だけに絞ると起動できない。

**対処** — 次のどちらかで許可する。`googleapis` は Marketplace の verified creator なので、
チェックボックス 1 つで済む前者が簡単。

- **Allow actions created by Marketplace verified creators** を有効にする
- **Allow specified actions** の許可リストに `googleapis/release-please-action@*` を足す

許可リストで絞る場合は、**カンマ区切りで、バージョンを固定せずに**入力する。改行や空白で
区切ると全体が 1 個のパターンとして扱われ、何にも一致しなくなる。エラーには登録済みの
パターンが表示されるため、一見すると一致しているように見えて原因が分かりにくい。
バージョンを固定すると、アクションのメジャーを上げた時点で弾かれる。
`actions/checkout` と `actions/setup-node` は GitHub 製なので、どちらの方式でも記載は不要。

設定を戻したあとは、ジョブが無い run には Re-run ボタンが出ないため、main に何か push して
新しい run を起こす必要がある。

## 旧構成（pnpm + changesets）で踏んだ失敗

1.2.1 までは pnpm と changesets でリリースしていました。戻す判断をするときのために、
その構成でしか起きなかった失敗を残しておきます。

- **`changesets/action@v1` でタグと Release が黙って飛ばされる。** v1 は publish の出力から
  `New tag:` の行を探して公開を検知するが、`@changesets/cli` 3.x はその形式で出力しない。
  v2 以上は NDJSON のファイル経由で結果を受け取るので取りこぼさない。
- **npm CLI のバージョンを自分で入れ替える必要があった。** OIDC は npm 11.5.1 以上が必要で、
  Node 22 の同梱 npm は 10 系。`changeset publish` が呼ぶのは `pnpm publish` だが、pnpm は
  publish 本体を node と同じディレクトリの npm へ委譲するため、`npm install --global
  "npm@^11.5.1"` で入れ替えれば OIDC が効いた。ただし 12 系にはできない。pnpm 9 は自分専用の
  フラグ（`--no-git-checks`）もそのまま npm へ渡すが、npm 12 は未知のフラグを
  `EUNKNOWNCONFIG` で撥ねる（11 は警告のみで通す）。
