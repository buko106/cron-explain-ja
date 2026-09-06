import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const pkg = createRequire(import.meta.url)("./package.json") as { name: string; version: string };

/**
 * デモが読むライブラリの URL。npm に公開済みのバージョンを指す。
 *
 * package.json の version は changesets が publish に合わせて上げるので、
 * ここに書くのは「最後に公開されたバージョン」になる。リポジトリの src を
 * 直接 import すると、まだ公開していない main の状態がデモに出てしまう。
 */
const cdnUrl = `https://unpkg.com/${pkg.name}@${pkg.version}/dist/index.js`;

/** 未公開の変更をデモで確かめたいときだけ、リポジトリの src を読ませる */
const useLocalLibrary = process.env.DEMO_LIB === "local";

/**
 * `import ... from "cron-explain-ja"` を CDN の URL に差し替える。
 *
 * Vite は http(s) の import をそのまま外部依存として残すので、バンドルには
 * URL の import だけが入り、ライブラリ本体はブラウザが CDN から取る。
 */
function libraryFromCdn(): Plugin {
  return {
    name: "demo-library-from-cdn",
    enforce: "pre",
    resolveId(id) {
      if (id !== pkg.name) return null;
      return { id: cdnUrl, external: true };
    },
    // エントリのスクリプトを解析するまで CDN への要求が始まらないので、先に投げさせる
    transformIndexHtml() {
      return [
        {
          tag: "link",
          attrs: { rel: "modulepreload", href: cdnUrl, crossorigin: "" },
          injectTo: "head",
        },
      ];
    },
  };
}

export default defineConfig({
  root: "site",
  // ユーザーサイト（buko106.github.io）に設定したカスタムドメインは、
  // カスタムドメイン未設定のプロジェクトサイトにも継承される。このリポジトリの
  // 公開先は https://www.buko106.tokyo/cron-explain-ja/ になるため base はサブパス。
  // CNAME ファイルは置かない（置くと継承された既定のドメインを上書きしてしまう）。
  base: "/cron-explain-ja/",
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  ...(useLocalLibrary
    ? {
        resolve: {
          alias: { [pkg.name]: fileURLToPath(new URL("src/index.ts", import.meta.url)) },
        },
      }
    : { plugins: [libraryFromCdn()] }),
  build: { outDir: "../site-dist", emptyOutDir: true },
});
