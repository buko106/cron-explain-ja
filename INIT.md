# INIT.md — cron-explain-ja リポジトリ初期化手順

## 前提

- Node.js 20 LTS 以上（`util.parseArgs` を使うため 18.3 以上が必須）
- pnpm 9 以上（npm / yarn でも可、以下は pnpm 前提）
- GitHub アカウント、npm アカウント（2FA 有効）

## 1. リポジトリ作成

```bash
mkdir cron-explain-ja && cd cron-explain-ja
git init
pnpm init
```

`package.json` を以下のように編集する。

```json
{
  "name": "cron-explain-ja",
  "version": "0.0.0",
  "description": "cron式と日本語を相互変換するライブラリ / CLI",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "bin": { "cron-ja": "./dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "sideEffects": false,
  "engines": { "node": ">=18.3" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build",
    "release": "changeset publish"
  },
  "keywords": ["cron", "crontab", "japanese", "日本語", "schedule", "parser", "cli"],
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/<you>/cron-explain-ja.git" },
  "publishConfig": { "access": "public" }
}
```

## 2. 依存パッケージ

```bash
pnpm add -D typescript tsup vitest @vitest/coverage-v8 @biomejs/biome @changesets/cli @types/node
```

ランタイム依存はゼロを維持する（バンドルサイズと保守性のため）。CLI の引数解析も Node 標準の `util.parseArgs` を使う。

## 3. 設定ファイル

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### tsup.config.ts

```ts
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
  },
  {
    entry: { cli: 'src/cli/main.ts' },
    format: ['esm'],
    banner: { js: '#!/usr/bin/env node' },
    sourcemap: true,
    target: 'node18',
  },
]);
```

### vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/cli/main.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85 },
    },
  },
});
```

### biome.json

```bash
pnpm biome init
```

生成後、`formatter.indentStyle` を `space`、`lineWidth` を `100` に変更。

### Changesets

```bash
pnpm changeset init
```

## 4. ディレクトリ構成

```
cron-explain-ja/
├── src/
│   ├── index.ts              # 公開API
│   ├── types.ts              # 型定義
│   ├── explain/              # cron → 日本語
│   │   ├── index.ts
│   │   ├── field.ts          # フィールド単位の説明生成
│   │   └── compose.ts        # 文の組み立て
│   ├── parse/                # 日本語 → cron
│   │   ├── index.ts
│   │   ├── normalize.ts      # 正規化
│   │   ├── tokenize.ts       # トークナイズ
│   │   ├── dictionary.ts     # 語彙辞書
│   │   └── fill.ts           # スロット埋め
│   ├── cron/
│   │   ├── parser.ts         # cron式の構文解析
│   │   ├── validate.ts
│   │   └── next.ts           # 次回実行日時計算
│   ├── cli/
│   │   ├── main.ts           # エントリ。サブコマンド振り分け
│   │   ├── args.ts           # parseArgs 設定とヘルプ生成
│   │   ├── io.ts             # stdin/引数の入力取得、出力整形
│   │   ├── format.ts         # 色付け、テーブル整形
│   │   └── commands/
│   │       ├── explain.ts
│   │       ├── parse.ts
│   │       ├── validate.ts
│   │       └── next.ts
│   └── util/
│       └── number.ts         # 漢数字変換など
├── test/
│   ├── fixtures/
│   │   ├── explain.jsonl
│   │   ├── parse.jsonl
│   │   └── roundtrip.jsonl
│   ├── cli.test.ts           # E2E
│   └── *.test.ts
├── .github/workflows/
│   ├── ci.yml
│   └── release.yml
├── .changeset/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── biome.json
├── README.md
├── DESIGN.md
├── LICENSE
└── .gitignore
```

## 5. 初期ファイル

```bash
mkdir -p src/{explain,parse,cron,util,cli/commands} test/fixtures .github/workflows .changeset
echo 'export {};' > src/index.ts
echo 'console.log("cron-ja");' > src/cli/main.ts
printf 'node_modules\ndist\ncoverage\n.DS_Store\n' > .gitignore
```

LICENSE は MIT を https://choosealicense.com/licenses/mit/ から取得して配置。

## 6. CI

### .github/workflows/ci.yml

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix: { node: [18, 20, 22] }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }}, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - run: pnpm build
      - run: node dist/cli.js --version
```

### .github/workflows/release.yml

```yaml
name: Release
on:
  push: { branches: [main] }
permissions:
  contents: write
  pull-requests: write
  id-token: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm, registry-url: https://registry.npmjs.org }
      - run: pnpm install --frozen-lockfile
      - uses: changesets/action@v1
        with:
          publish: pnpm release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

## 7. GitHub / npm 側の設定

1. GitHub にリポジトリ作成、`git remote add origin` して push
2. Settings → Actions → General → Workflow permissions を「Read and write」に
3. npm で名前の空き確認：`npm view cron-explain-ja`（404 なら空き）
4. npm の Granular Access Token を発行し、GitHub Secrets に `NPM_TOKEN` として登録
5. `main` ブランチ保護（PR 必須、CI 必須）

## 8. 動作確認

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
ls dist/   # index.js, index.cjs, index.d.ts, index.d.cts, cli.js が存在すること
node dist/cli.js
pnpm link --global && cron-ja --version   # 確認後 pnpm unlink --global
```

## 9. 初回コミット

```bash
git add -A
git commit -m "chore: initialize repository"
git push -u origin main
```

## 10. 公開までの流れ（初回）

1. DESIGN.md に従い実装
2. `pnpm changeset` で変更を記録（初回は `minor` で 0.1.0）
3. PR → main マージ → Release ワークフローが "Version Packages" PR を作成
4. その PR をマージすると npm に公開される

## 補足：ローカルでの公開テスト

```bash
pnpm build
pnpm pack
cd /tmp && mkdir t && cd t && npm init -y
npm i /path/to/cron-explain-ja-0.0.0.tgz
node -e "import('cron-explain-ja').then(m => console.log(m.explain('0 9 * * 1-5')))"
npx cron-ja explain "0 9 * * 1-5"
```