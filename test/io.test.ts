import { afterEach, describe, expect, it } from "vitest";
import { createIO, createMemoryIO, dim, red, yellow } from "../src/cli/io";

const original = process.env.NO_COLOR;

afterEach(() => {
  if (original === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = original;
});

describe("色付け", () => {
  it("color: false なら装飾しない", () => {
    const io = createMemoryIO({ color: false });
    expect(dim(io, "x")).toBe("x");
    expect(red(io, "x")).toBe("x");
    expect(yellow(io, "x")).toBe("x");
  });

  it("color: true なら ANSI を付ける", () => {
    const io = createMemoryIO({ color: true });
    expect(red(io, "x")).toBe("\u001B[31mx\u001B[0m");
  });
});

describe("createIO", () => {
  it("NO_COLOR があれば色を使わない", () => {
    process.env.NO_COLOR = "1";
    expect(createIO().color).toBe(false);
  });

  it("明示指定が優先される", () => {
    process.env.NO_COLOR = "1";
    expect(createIO({ color: true }).color).toBe(true);
  });

  it("出力先を持つ", () => {
    const io = createIO({ color: false });
    expect(typeof io.out).toBe("function");
    expect(typeof io.err).toBe("function");
    expect(typeof io.readLines).toBe("function");
    expect(typeof io.ask).toBe("function");
  });
});

describe("createMemoryIO", () => {
  it("出力を貯める", () => {
    const io = createMemoryIO();
    io.out("a");
    io.err("b");
    expect(io.stdout).toEqual(["a"]);
    expect(io.stderr).toEqual(["b"]);
  });

  it("答えを使い切ったら空文字を返す", async () => {
    const io = createMemoryIO({ answers: ["1"] });
    expect(await io.ask("q1")).toBe("1");
    expect(await io.ask("q2")).toBe("");
    expect(io.questions).toEqual(["q1", "q2"]);
  });
});
