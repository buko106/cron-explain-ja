import { describe, expect, it } from "vitest";
import { help, looksLikeCron, parseCliArgs } from "../src/cli/args";
import { caretLine } from "../src/cli/commands/validate";
import { createMemoryIO } from "../src/cli/io";
import { run, VERSION } from "../src/cli/run";

function io(options?: Parameters<typeof createMemoryIO>[0]) {
  return createMemoryIO(options);
}

describe("引数解析", () => {
  it("サブコマンドを取り出す", () => {
    const args = parseCliArgs(["explain", "0 9 * * *", "--json"]);
    expect(args.command).toBe("explain");
    expect(args.positionals).toEqual(["0 9 * * *"]);
    expect(args.values.json).toBe(true);
  });

  it("サブコマンドが無ければ null", () => {
    expect(parseCliArgs(["0 9 * * *"]).command).toBeNull();
  });

  it("未知のオプションはエラー", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow();
  });
});

describe("looksLikeCron", () => {
  it.each(["0 9 * * 1-5", "*/15 * * * *", "0 0 L * *", "@daily", "0 0 9 * * *"])(
    "%s は cron 式",
    (input) => {
      expect(looksLikeCron(input)).toBe(true);
    },
  );

  it.each(["平日の朝9時", "毎日", "", "0 9 * *", "0 9 * * 1-5 extra field"])(
    "%s は cron 式でない",
    (input) => {
      expect(looksLikeCron(input)).toBe(false);
    },
  );
});

describe("help", () => {
  it("コマンド一覧を含む", () => {
    const text = help(null);
    expect(text).toContain("explain");
    expect(text).toContain("Global options:");
  });

  it("コマンド固有のオプションを載せる", () => {
    expect(help("parse")).toContain("--default-hour");
    expect(help("next")).toContain("--format");
  });
});

describe("caretLine", () => {
  it("位置を指す", () => {
    expect(caretLine("0 25 * * *", 2)).toBe("    ^^");
  });

  it("位置が無ければ null", () => {
    expect(caretLine("0 25 * * *", undefined)).toBeNull();
    expect(caretLine("0 25 * * *", 99)).toBeNull();
  });
});

describe("run: explain", () => {
  it("日本語を出力する", async () => {
    const memory = io();
    expect(await run(["explain", "0 9 * * 1-5", "--tz", "UTC"], memory)).toBe(0);
    expect(memory.stdout).toEqual(["平日の午前9時"]);
  });

  it("サブコマンド省略時に cron 式を判定する", async () => {
    const memory = io();
    await run(["0 9 * * 1-5", "--tz", "UTC"], memory);
    expect(memory.stdout).toEqual(["平日の午前9時"]);
  });

  it("--style / --hour を反映する", async () => {
    const memory = io();
    await run(
      ["explain", "0 9 * * 1-5", "--style", "formal", "--hour", "24h", "--tz", "UTC"],
      memory,
    );
    expect(memory.stdout).toEqual(["平日の9時00分"]);
  });

  it("--detailed で内訳と次回を出す", async () => {
    const memory = io();
    await run(["explain", "0 9 * * 1-5", "--detailed", "--tz", "UTC"], memory);
    expect(memory.stdout[0]).toBe("平日の午前9時");
    expect(memory.stdout.some((line) => line.includes("曜日") && line.includes("平日"))).toBe(true);
    expect(memory.stdout).toContain("次回:");
  });

  it("--json で JSON を出す", async () => {
    const memory = io();
    await run(["explain", "0 9 * * 1-5", "--json", "--tz", "UTC"], memory);
    const payload = JSON.parse(memory.stdout[0] ?? "{}") as { text: string; expression: string };
    expect(payload.text).toBe("平日の午前9時");
    expect(payload.expression).toBe("0 9 * * 1-5");
  });

  it("note は stderr に出す", async () => {
    const memory = io();
    await run(["explain", "0 0 L * *", "--tz", "UTC"], memory);
    expect(memory.stdout).toEqual(["毎月月末の午前0時"]);
    expect(memory.stderr.some((line) => line.includes("Quartz"))).toBe(true);
  });

  it("--quiet は note を止める", async () => {
    const memory = io();
    await run(["explain", "0 0 L * *", "--quiet", "--tz", "UTC"], memory);
    expect(memory.stderr).toEqual([]);
  });

  it("不正な式は exit 2", async () => {
    const memory = io();
    expect(await run(["explain", "0 25 * * *"], memory)).toBe(2);
    expect(memory.stdout).toEqual([]);
    expect(memory.stderr[0]).toContain("error");
  });

  it("--style の値が不正なら exit 2", async () => {
    const memory = io();
    expect(await run(["explain", "0 9 * * *", "--style", "wrong"], memory)).toBe(2);
  });
});

describe("run: parse", () => {
  it("cron 式を出力する", async () => {
    const memory = io();
    expect(await run(["parse", "平日の朝9時", "--tz", "UTC"], memory)).toBe(0);
    expect(memory.stdout).toEqual(["0 9 * * 1-5"]);
  });

  it("サブコマンド省略時に日本語を判定する", async () => {
    const memory = io();
    await run(["平日の朝9時", "--tz", "UTC"], memory);
    expect(memory.stdout).toEqual(["0 9 * * 1-5"]);
  });

  it("曖昧なら warn を出す", async () => {
    const memory = io();
    await run(["parse", "毎日", "--tz", "UTC"], memory);
    expect(memory.stdout).toEqual(["0 9 * * *"]);
    expect(memory.stderr.some((line) => line.includes("confidence: 0.6"))).toBe(true);
    expect(memory.stderr.some((line) => line.includes("--default-hour"))).toBe(true);
  });

  it("--default-hour を反映する", async () => {
    const memory = io();
    await run(["parse", "毎日", "--default-hour", "7", "--tz", "UTC"], memory);
    expect(memory.stdout).toEqual(["0 7 * * *"]);
  });

  it("--strict は exit 3", async () => {
    const memory = io();
    expect(await run(["parse", "毎日", "--strict"], memory)).toBe(3);
    expect(memory.stdout).toEqual([]);
  });

  it("時間表現が無ければ exit 2", async () => {
    const memory = io();
    expect(await run(["parse", "こんにちは"], memory)).toBe(2);
    expect(memory.stderr[0]).toContain("時間表現が見つかりません");
  });

  it("-i は対話で曖昧さを埋める", async () => {
    const memory = io({ answers: ["7"] });
    expect(await run(["parse", "毎日", "-i", "--tz", "UTC"], memory)).toBe(0);
    expect(memory.questions[0]).toContain("何時ですか");
    expect(memory.stdout).toEqual(["0 7 * * *"]);
  });

  it("-i で不正な答えなら exit 2", async () => {
    const memory = io({ answers: ["99"] });
    expect(await run(["parse", "毎日", "-i"], memory)).toBe(2);
  });

  it("-i は TTY でなければ --strict 相当", async () => {
    const memory = io({ stdinIsTTY: false, stdin: ["毎日"] });
    expect(await run(["parse", "毎日", "-i"], memory)).toBe(3);
  });

  it("--json は confidence を含む", async () => {
    const memory = io();
    await run(["parse", "毎日", "--json", "--tz", "UTC"], memory);
    const payload = JSON.parse(memory.stdout[0] ?? "{}") as { confidence: number };
    expect(payload.confidence).toBe(0.6);
  });
});

describe("run: validate", () => {
  it("正しい式は ok", async () => {
    const memory = io();
    expect(await run(["validate", "0 9 * * 1-5"], memory)).toBe(0);
    expect(memory.stdout).toEqual(["ok"]);
  });

  it("警告は stderr", async () => {
    const memory = io();
    await run(["validate", "0 0 30 2 *"], memory);
    expect(memory.stdout).toEqual(["ok"]);
    expect(memory.stderr.some((line) => line.includes("2月30日"))).toBe(true);
  });

  it("エラーは位置を示して exit 2", async () => {
    const memory = io();
    expect(await run(["validate", "0 25 * * *"], memory)).toBe(2);
    expect(memory.stderr).toContain("  0 25 * * *");
    expect(memory.stderr).toContain("    ^^");
  });

  it("--json でも exit code を返す", async () => {
    const memory = io();
    expect(await run(["validate", "0 25 * * *", "--json"], memory)).toBe(2);
    const payload = JSON.parse(memory.stdout[0] ?? "{}") as { valid: boolean };
    expect(payload.valid).toBe(false);
  });
});

describe("run: next", () => {
  it("既定は 3 件", async () => {
    const memory = io();
    expect(await run(["next", "0 9 * * 1-5"], memory)).toBe(0);
    expect(memory.stdout).toHaveLength(3);
    expect(memory.stdout[0]).toMatch(/^\d{4}-\d{2}-\d{2} \(.\) \d{2}:\d{2}$/);
  });

  it("-n と --from を反映する", async () => {
    const memory = io();
    await run(["next", "0 9 * * 1-5", "-n", "5", "--from", "2026-09-05T00:00:00Z"], memory);
    expect(memory.stdout).toHaveLength(5);
  });

  it("--format iso / unix", async () => {
    // 式は UTC の 09:00。--tz は表示だけを変える
    const isoIO = io();
    await run(["next", "0 9 * * *", "--format", "iso", "-n", "1"], isoIO);
    expect(isoIO.stdout[0]).toMatch(/^\d{4}-\d{2}-\d{2}T18:00:00\+09:00$/);

    const utcIO = io();
    await run(["next", "0 9 * * *", "--format", "iso", "--tz", "UTC", "-n", "1"], utcIO);
    expect(utcIO.stdout[0]).toMatch(/^\d{4}-\d{2}-\d{2}T09:00:00Z$/);

    const nyIO = io();
    await run(
      ["next", "0 9 * * *", "--format", "iso", "--tz", "America/New_York", "-n", "1"],
      nyIO,
    );
    expect(nyIO.stdout[0]).toMatch(/^\d{4}-\d{2}-\d{2}T0[45]:00:00-0[45]:00$/);

    const unixIO = io();
    await run(["next", "0 9 * * *", "--format", "unix", "-n", "1"], unixIO);
    expect(unixIO.stdout[0]).toMatch(/^\d+$/);
  });

  it("式は UTC として数え、--tz のゾーンで表示する", async () => {
    // UTC の 09:00 は JST の 18:00、New York（EDT）の 05:00
    const base = ["next", "0 9 * * *", "--from", "2026-06-14T00:00:00Z", "-n", "1"];

    const tokyo = io();
    await run(base, tokyo);
    expect(tokyo.stdout).toEqual(["2026-06-14 (日) 18:00"]);

    const utc = io();
    await run([...base, "--tz", "UTC"], utc);
    expect(utc.stdout).toEqual(["2026-06-14 (日) 09:00"]);

    const newYork = io();
    await run([...base, "--tz", "America/New_York"], newYork);
    expect(newYork.stdout).toEqual(["2026-06-14 (日) 05:00"]);

    const json = io();
    await run([...base, "--json"], json);
    expect(JSON.parse(json.stdout[0] ?? "{}")).toEqual({
      tz: "Asia/Tokyo",
      next: ["2026-06-14T09:00:00.000Z"],
    });
  });

  it("--tz が不正なら exit 2", async () => {
    const memory = io();
    expect(await run(["next", "0 9 * * *", "--tz", "Nowhere/Nothing"], memory)).toBe(2);
    expect(memory.stderr[0]).toContain("Nowhere/Nothing");

    const explainIO = io();
    expect(await run(["explain", "0 9 * * *", "--tz", "Nowhere/Nothing"], explainIO)).toBe(2);
  });

  it("--from が不正なら exit 2", async () => {
    const memory = io();
    expect(await run(["next", "0 9 * * *", "--from", "yesterday"], memory)).toBe(2);
  });

  it("拡張構文は warn を出す", async () => {
    const memory = io();
    await run(["next", "0 0 L * *"], memory);
    expect(memory.stdout).toEqual([]);
    expect(memory.stderr[0]).toContain("warn");
  });
});

describe("run: 書き換えられない式の案内", () => {
  // 実在の crontab 行をそのまま渡すとここに当たる。--tz UTC を知らないと行き止まりになる
  it("explain は逃げ道を note で案内する", async () => {
    const memory = io();
    expect(await run(["explain", "0 9-17 * * 1-5"], memory)).toBe(2);
    expect(memory.stderr[0]).toContain("書き換えられません");
    expect(memory.stderr[1]).toContain("--tz UTC");
  });

  it("parse でも案内する", async () => {
    const memory = io();
    expect(await run(["parse", "毎月28日から31日までの午前3時"], memory)).toBe(2);
    expect(memory.stderr.some((line) => line.includes("--tz UTC"))).toBe(true);
  });

  it("構文エラーには案内を付けない", async () => {
    const memory = io();
    await run(["explain", "0 25 * * *"], memory);
    expect(memory.stderr.some((line) => line.includes("--tz UTC"))).toBe(false);
  });

  it("--quiet と --json では黙る", async () => {
    const quiet = io();
    await run(["explain", "0 9-17 * * 1-5", "--quiet"], quiet);
    expect(quiet.stderr.some((line) => line.includes("--tz UTC"))).toBe(false);

    const json = io();
    await run(["explain", "0 9-17 * * 1-5", "--json"], json);
    expect(json.stderr.some((line) => line.includes("--tz UTC"))).toBe(false);
  });

  it("複数行でも 1 回だけ出す", async () => {
    const memory = io({
      stdinIsTTY: false,
      stdin: ["0 9-17 * * 1-5", "*/5 9-17 * * 1-5", "0 8-18/2 * * 1-5"],
    });
    expect(await run(["explain"], memory)).toBe(2);
    expect(memory.stderr.filter((line) => line.includes("--tz UTC"))).toHaveLength(1);
  });
});

describe("run: 共通", () => {
  it("--version", async () => {
    const memory = io();
    expect(await run(["--version"], memory)).toBe(0);
    expect(memory.stdout).toEqual([VERSION]);
  });

  it("--help", async () => {
    const memory = io();
    expect(await run(["--help"], memory)).toBe(0);
    expect(memory.stdout[0]).toContain("cron-ja <command>");
  });

  it("引数も標準入力も無ければヘルプ", async () => {
    const memory = io();
    expect(await run([], memory)).toBe(0);
    expect(memory.stdout[0]).toContain("cron-ja <command>");
  });

  it("未知のオプションは exit 2", async () => {
    const memory = io();
    expect(await run(["--nope"], memory)).toBe(2);
  });

  it("標準入力を 1 行ずつ処理する", async () => {
    const memory = io({ stdinIsTTY: false, stdin: ["0 9 * * 1-5", "0 3 * * *", "*/15 * * * *"] });
    expect(await run(["explain", "--tz", "UTC"], memory)).toBe(0);
    expect(memory.stdout).toEqual(["平日の午前9時", "毎日午前3時", "15分ごと"]);
  });

  it("複数行の --json は JSONL で input を付ける", async () => {
    const memory = io({ stdinIsTTY: false, stdin: ["平日の朝9時", "毎日"] });
    await run(["parse", "--json"], memory);
    const rows = memory.stdout.map((line) => JSON.parse(line) as { input: string });
    expect(rows.map((row) => row.input)).toEqual(["平日の朝9時", "毎日"]);
  });

  it("複数行ではエラー行を飛ばして続行し、最大の exit code を返す", async () => {
    const memory = io({ stdinIsTTY: false, stdin: ["0 9 * * 1-5", "0 99 * * *"] });
    expect(await run(["explain", "--tz", "UTC"], memory)).toBe(2);
    expect(memory.stdout).toEqual(["平日の午前9時"]);
  });

  it("空の標準入力は exit 2", async () => {
    const memory = io({ stdinIsTTY: false, stdin: [] });
    expect(await run(["explain"], memory)).toBe(2);
  });
});
