import { describe, expect, it } from "vitest";

describe("package entrypoint", () => {
  it("は読み込める", async () => {
    const mod = await import("../src/index.js");
    expect(mod).toBeTypeOf("object");
  });
});
