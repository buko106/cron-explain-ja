# cron-explain-ja

cron 式と日本語を相互変換するライブラリ / CLI。

> [!NOTE]
> 現在は初期化のみ完了した状態です。実装は [DESIGN.md](./DESIGN.md) に従って進めます。
> 空の `0.0.0` が誤って npm に公開されるのを防ぐため、`package.json` に一時的に
> `"private": true` を設定しています。**初回公開の直前にこの行を削除してください。**

## 開発

開発用ツールチェーン（vitest 5 / changesets 3）は **Node 22.12 以上**を必要とします。
公開されるパッケージ自体は `engines` のとおり Node 18.3 以上で動作し、CI の
`runtime-compat` ジョブがビルド成果物を Node 18 / 20 で実行して検証しています。

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## インストール

```bash
npm i cron-explain-ja
```

## 使い方

```bash
npx cron-ja explain "0 9 * * 1-5"
```

詳細な設計は [DESIGN.md](./DESIGN.md) を参照してください。

## ライセンス

[MIT](./LICENSE)
