import { describe, expect, it } from "vitest";
import { help } from "../src/cli/args";

describe("ヘルプ（スナップショット）", () => {
  it("トップレベル", () => {
    expect(help(null)).toMatchSnapshot();
  });

  it.each(["explain", "parse", "validate", "next"] as const)("%s", (command) => {
    expect(help(command)).toMatchSnapshot();
  });
});
