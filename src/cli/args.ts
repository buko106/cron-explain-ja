import { parseArgs } from "node:util";

export type CommandName = "explain" | "parse" | "validate" | "next";

export const COMMANDS: Record<CommandName, string> = {
  explain: "cron式を日本語にする",
  parse: "日本語をcron式にする",
  validate: "cron式を検証する",
  next: "次回の実行日時を表示する",
};

export interface OptionDef {
  type: "string" | "boolean";
  short?: string;
  description: string;
  default?: string;
  /** そのオプションを受け付けるコマンド。'*' はすべて */
  commands: CommandName[] | "*";
  /** ヘルプに表示する値のプレースホルダ */
  placeholder?: string;
}

export const OPTIONS: Record<string, OptionDef> = {
  json: { type: "boolean", description: "JSON で出力する", commands: "*" },
  quiet: { type: "boolean", short: "q", description: "結果のみ出力する", commands: "*" },
  "no-color": {
    type: "boolean",
    description: "色を無効化する（NO_COLOR 環境変数でも可）",
    commands: "*",
  },
  help: { type: "boolean", short: "h", description: "ヘルプを表示する", commands: "*" },
  version: { type: "boolean", short: "v", description: "バージョンを表示する", commands: "*" },

  style: {
    type: "string",
    description: "出力スタイル",
    default: "casual",
    placeholder: "casual|formal",
    commands: ["explain"],
  },
  hour: {
    type: "string",
    description: "時刻の表記",
    default: "12h",
    placeholder: "12h|24h",
    commands: ["explain"],
  },
  seconds: {
    type: "boolean",
    description: "6 フィールド（秒付き）として解釈する",
    commands: ["explain", "validate", "next"],
  },
  tz: {
    type: "string",
    description: "タイムゾーン（IANA 名 / local）。explain は併記のみ、next の既定は Asia/Tokyo",
    placeholder: "zone",
    commands: ["explain", "next"],
  },
  detailed: {
    type: "boolean",
    description: "フィールド別の内訳と次回3回を表示する",
    commands: ["explain"],
  },

  strict: { type: "boolean", description: "曖昧なら失敗する（exit 3）", commands: ["parse"] },
  "default-hour": {
    type: "string",
    description: "時刻が読み取れないときに使う時",
    default: "9",
    placeholder: "n",
    commands: ["parse"],
  },
  "allow-extensions": {
    type: "boolean",
    description: "L / # / W の使用を許可する",
    commands: ["parse"],
  },
  interactive: {
    type: "boolean",
    short: "i",
    description: "曖昧な点を対話で確認する",
    commands: ["parse"],
  },

  count: {
    type: "string",
    short: "n",
    description: "表示件数",
    default: "3",
    placeholder: "n",
    commands: ["next"],
  },
  from: {
    type: "string",
    description: "起点の日時（ISO 8601）",
    placeholder: "iso-datetime",
    commands: ["next"],
  },
  format: {
    type: "string",
    description: "出力形式",
    default: "human",
    placeholder: "human|iso|unix",
    commands: ["next"],
  },
};

export type OptionValues = Record<string, string | boolean | undefined>;

export interface CliArgs {
  command: CommandName | null;
  positionals: string[];
  values: OptionValues;
}

export class CliUsageError extends Error {}

function isCommandName(value: string): value is CommandName {
  return value === "explain" || value === "parse" || value === "validate" || value === "next";
}

/** cron 式らしい入力か（サブコマンド省略時の判定） */
export function looksLikeCron(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === "") return false;
  if (/^@[a-z]+$/i.test(trimmed)) return true;
  const fields = trimmed.split(/\s+/);
  if (fields.length < 5 || fields.length > 6) return false;
  return fields.every((field) => /^[0-9*,/\-#LW?A-Za-z@]+$/.test(field));
}

/**
 * argv を解釈する。未知のオプションは {@link CliUsageError}。
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const config: Record<string, { type: "string" | "boolean"; short?: string }> = {};
  for (const [name, def] of Object.entries(OPTIONS)) {
    config[name] =
      def.short === undefined ? { type: def.type } : { type: def.type, short: def.short };
  }

  let command: CommandName | null = null;
  let rest = argv;
  const first = argv[0];
  if (first !== undefined && isCommandName(first)) {
    command = first;
    rest = argv.slice(1);
  }

  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: config,
      allowPositionals: true,
      strict: true,
    });
    return { command, positionals, values: values as OptionValues };
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
}

function optionUsage(name: string, def: OptionDef): string {
  const flag = def.short === undefined ? `    --${name}` : `-${def.short}, --${name}`;
  const value = def.type === "string" ? ` <${def.placeholder ?? "value"}>` : "";
  return `${flag}${value}`;
}

function optionLines(command: CommandName | null, global: boolean): string[] {
  const lines: string[] = [];
  for (const [name, def] of Object.entries(OPTIONS)) {
    const isGlobal = def.commands === "*";
    if (isGlobal !== global) continue;
    if (!global && (command === null || !def.commands.includes(command))) continue;
    const usage = optionUsage(name, def);
    const suffix = def.default === undefined ? "" : `（既定: ${def.default}）`;
    lines.push(`  ${usage.padEnd(26)}${def.description}${suffix}`);
  }
  return lines;
}

/** --help の本文を組み立てる */
export function help(command: CommandName | null): string {
  const lines: string[] = [];
  if (command === null) {
    lines.push("cron-ja <command> [args] [options]", "");
    lines.push("Commands:");
    for (const [name, description] of Object.entries(COMMANDS)) {
      lines.push(`  ${name.padEnd(20)}${description}`);
    }
    lines.push(`  ${"(省略)".padEnd(20)}入力を自動判定して explain または parse`);
    lines.push("");
  } else {
    lines.push(`cron-ja ${command} <${command === "parse" ? "text" : "expr"}> [options]`, "");
    lines.push(COMMANDS[command], "");
    const specific = optionLines(command, false);
    if (specific.length > 0) {
      lines.push("Options:", ...specific, "");
    }
  }
  lines.push("Global options:", ...optionLines(command, true));
  lines.push("");
  lines.push("引数を省略し標準入力がパイプの場合、1 行ずつ処理します。");
  return lines.join("\n");
}
