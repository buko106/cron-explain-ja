import { createRequire } from "node:module";
import { defineConfig } from "vite";

const pkg = createRequire(import.meta.url)("./package.json") as { version: string };

export default defineConfig({
  root: "site",
  // ユーザーサイト（buko106.github.io）に設定したカスタムドメインは、
  // カスタムドメイン未設定のプロジェクトサイトにも継承される。このリポジトリの
  // 公開先は https://www.buko106.tokyo/cron-explain-ja/ になるため base はサブパス。
  // CNAME ファイルは置かない（置くと継承された既定のドメインを上書きしてしまう）。
  base: "/cron-explain-ja/",
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: "../site-dist", emptyOutDir: true },
});
