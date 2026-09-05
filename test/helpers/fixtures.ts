import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function loadFixtures<T>(name: string): T[] {
  const path = join(here, "..", "fixtures", name);
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as T);
}

export interface ExplainFixture {
  expr: string;
  /** error を持つ場合のみ省略できる */
  casual?: string;
  formal?: string;
  h24?: string;
  extensions?: string[];
  /** 6 フィールド（秒付き）として解釈する */
  seconds?: boolean;
  /** explain がこのメッセージで throw することを期待する */
  error?: string;
  /** 実在 crontab フィクスチャの出典 */
  source?: string;
}

export interface ParseFixture {
  text: string;
  expr: string | null;
  confidence: number;
  ambiguities?: string[];
}
