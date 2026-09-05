import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const pkg = createRequire(import.meta.url)("./package.json") as { version: string };
const define = { __PKG_VERSION__: JSON.stringify(pkg.version) };

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    define,
  },
  {
    entry: { cli: "src/cli/main.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    target: "node18",
    define,
  },
]);
