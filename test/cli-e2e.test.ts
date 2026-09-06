import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const built = existsSync(cli);

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], input?: string): Promise<Result> {
  try {
    const child = execFileAsync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (input !== undefined) {
      child.child.stdin?.end(input);
    }
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

// dist が未ビルドの環境（CI では test の後に build する）ではスキップする
describe.skipIf(!built)("CLI E2E (dist/cli.js)", () => {
  it("--version は package.json と一致する", async () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    const result = await runCli(["--version"]);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("explain（既定で UTC → Asia/Tokyo に読み替える）", async () => {
    const result = await runCli(["explain", "0 4 * * 1-5"]);
    expect(result.stdout.trim()).toBe("平日の午後1時");
    expect(result.code).toBe(0);

    const utc = await runCli(["explain", "0 9 * * 1-5", "--tz", "UTC"]);
    expect(utc.stdout.trim()).toBe("平日の午前9時");
  });

  it("parse（既定で Asia/Tokyo → UTC に読み替える）", async () => {
    const result = await runCli(["parse", "毎日午後1時"]);
    expect(result.stdout.trim()).toBe("0 4 * * *");

    const utc = await runCli(["parse", "平日の朝9時", "--tz", "UTC"]);
    expect(utc.stdout.trim()).toBe("0 9 * * 1-5");
  });

  it("標準入力をパイプで受け取る", async () => {
    const result = await runCli(["explain"], "0 4 * * 1-5\n0 18 * * *\n");
    expect(result.stdout.trim().split("\n")).toEqual(["平日の午後1時", "毎日午前3時"]);
  });

  it("--json は JSON として読める", async () => {
    const result = await runCli(["explain", "0 4 * * 1-5", "--json"]);
    const payload = JSON.parse(result.stdout) as { text: string; localExpression: string };
    expect(payload.text).toBe("平日の午後1時");
    expect(payload.localExpression).toBe("0 13 * * 1-5");
  });

  it("不正な式は exit 2 で stdout は空", async () => {
    const result = await runCli(["explain", "0 99 * * *"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error");
  });

  it("--strict の曖昧な入力は exit 3", async () => {
    const result = await runCli(["parse", "毎日", "--strict"]);
    expect(result.code).toBe(3);
  });

  it("結果だけを取り出せる（note は stderr）", async () => {
    const result = await runCli(["explain", "0 0 L * *"]);
    expect(result.stdout.trim()).toBe("毎月月末の午前9時");
    expect(result.stderr).toContain("note");
  });
});
