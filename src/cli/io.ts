export interface IO {
  /** 結果を stdout へ */
  out(text: string): void;
  /** note / warn / error を stderr へ */
  err(text: string): void;
  /** 色を使ってよいか */
  color: boolean;
  /** 標準入力が TTY か（パイプなら false） */
  stdinIsTTY: boolean;
  /** 標準入力を 1 行ずつ読む */
  readLines(): Promise<string[]>;
  /** 対話で 1 行たずねる */
  ask(question: string): Promise<string>;
}

export function paint(io: IO, code: string, text: string): string {
  return io.color ? `\u001B[${code}m${text}\u001B[0m` : text;
}

export function dim(io: IO, text: string): string {
  return paint(io, "2", text);
}

export function red(io: IO, text: string): string {
  return paint(io, "31", text);
}

export function yellow(io: IO, text: string): string {
  return paint(io, "33", text);
}

/** プロセス入出力に接続した既定の IO */
export function createIO(options: { color?: boolean } = {}): IO {
  const color =
    options.color ?? (process.env.NO_COLOR === undefined && process.stdout.isTTY === true);

  return {
    out: (text) => {
      process.stdout.write(`${text}\n`);
    },
    err: (text) => {
      process.stderr.write(`${text}\n`);
    },
    color,
    stdinIsTTY: process.stdin.isTTY === true,
    readLines: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks)
        .toString("utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    },
    ask: async (question) => {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return (await rl.question(question)).trim();
      } finally {
        rl.close();
      }
    },
  };
}

/** テスト用: 出力を配列に貯める IO */
export function createMemoryIO(
  options: { stdin?: string[]; answers?: string[]; stdinIsTTY?: boolean; color?: boolean } = {},
): IO & { stdout: string[]; stderr: string[]; questions: string[] } {
  const answers = [...(options.answers ?? [])];
  const io = {
    stdout: [] as string[],
    stderr: [] as string[],
    questions: [] as string[],
    out(text: string) {
      this.stdout.push(text);
    },
    err(text: string) {
      this.stderr.push(text);
    },
    color: options.color ?? false,
    stdinIsTTY: options.stdinIsTTY ?? true,
    readLines: async () => options.stdin ?? [],
    async ask(question: string) {
      this.questions.push(question);
      return answers.shift() ?? "";
    },
  };
  return io;
}
