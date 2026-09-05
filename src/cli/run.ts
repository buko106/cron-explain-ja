import {
  type CliArgs,
  CliUsageError,
  type CommandName,
  help,
  looksLikeCron,
  parseCliArgs,
} from "./args";
import { explainCommand } from "./commands/explain";
import { nextCommand } from "./commands/next";
import { parseCommand } from "./commands/parse";
import { EXIT_INPUT, EXIT_OK, reportError } from "./commands/shared";
import { validateCommand } from "./commands/validate";
import type { IO } from "./io";

export const VERSION = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "0.0.0";

async function dispatch(command: CommandName, args: CliArgs, io: IO): Promise<number> {
  switch (command) {
    case "explain":
      return explainCommand(args, io);
    case "parse":
      return parseCommand(args, io);
    case "validate":
      return validateCommand(args, io);
    case "next":
      return nextCommand(args, io);
  }
}

/**
 * CLI 本体。終了コードを返す。
 */
export async function run(argv: string[], io: IO): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (error) {
    reportError(io, error instanceof Error ? error.message : String(error));
    return EXIT_INPUT;
  }

  if (args.values.version === true) {
    io.out(VERSION);
    return EXIT_OK;
  }
  if (
    args.values.help === true ||
    (args.command === null && args.positionals.length === 0 && io.stdinIsTTY)
  ) {
    io.out(help(args.command));
    return EXIT_OK;
  }

  let command = args.command;
  if (command === null) {
    const input = args.positionals.join(" ");
    command = input !== "" && !looksLikeCron(input) ? "parse" : "explain";
  }

  try {
    return await dispatch(command, args, io);
  } catch (error) {
    if (error instanceof CliUsageError) {
      reportError(io, error.message);
      return EXIT_INPUT;
    }
    throw error;
  }
}
