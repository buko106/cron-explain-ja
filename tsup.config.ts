import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
  },
  {
    entry: { cli: "src/cli/main.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    target: "node18",
  },
]);
