import { createRequire } from "node:module";
import { defineConfig } from "tsdown";

const pkg = createRequire(import.meta.url)("./package.json") as { version: string };
const define = { __PKG_VERSION__: JSON.stringify(pkg.version) };

/**
 * tsdown は platform: "node" のとき拡張子を .mjs / .cjs に固定する。この
 * パッケージが公開している道筋（exports の ./dist/index.js と bin の
 * ./dist/cli.js）はその形ではないので、package.json の type: "module" に
 * 従った .js / .cjs のままにする。
 */
const fixedExtension = false;

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    // sourcemap: true だけだと .d.ts の末尾に sourceMappingURL の行だけが付いて
    // 参照先の .d.ts.map が出ない。dts 側にも明示して実体を出させる。
    dts: { sourcemap: true },
    sourcemap: true,
    clean: true,
    target: "es2022",
    fixedExtension,
    define,
  },
  {
    entry: { cli: "src/cli/main.ts" },
    format: ["esm"],
    // package.json に types があると tsdown は既定で型定義を出す。
    // CLI は import される入口ではないので要らない。
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    target: "node18",
    fixedExtension,
    define,
  },
]);
