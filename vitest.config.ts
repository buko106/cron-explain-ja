import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const pkg = createRequire(import.meta.url)("./package.json") as { version: string };

export default defineConfig({
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli/main.ts", "src/**/*.d.ts"],
      thresholds: { lines: 90, functions: 90, branches: 85 },
    },
  },
});
