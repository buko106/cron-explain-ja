# cron-explain-ja

cron 式と日本語を相互変換するライブラリ / CLI。

> [!NOTE]
> 現在は初期化のみ完了した状態です。実装は [DESIGN.md](./DESIGN.md) に従って進めます。

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
