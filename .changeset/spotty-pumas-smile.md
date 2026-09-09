---
"cron-explain-ja": patch
---

ビルドを tsup から tsdown に移し、TypeScript を 7 に上げた

ライブラリと CLI の動作は変わらない。tsup がメンテナンスを終えたため、後継として
案内されている tsdown（rolldown）に置き換えた。公開する道筋（`dist/index.js` /
`dist/index.cjs` / `dist/index.d.ts` / `dist/index.d.cts` / `dist/cli.js`）と
`exports` はそのままで、型定義に `.d.ts.map` が増える。

型定義の生成も TypeScript 7 で行う。TypeScript 6 以降は `@types/*` を自動では
読み込まないため、`tsconfig.json` に `types: ["node"]` を明示した。開発用
ツールチェーンが必要とする Node は 22.12 以上から **22.18 以上**（tsdown の
`engines`）に上がる。公開するパッケージ自体は今までどおり Node 18.3 以上で動く。
