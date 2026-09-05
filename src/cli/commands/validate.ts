import { validate } from "../../cron";
import type { ParserOptions } from "../../types";
import type { CliArgs } from "../args";
import type { IO } from "../io";
import { boolOption, collectInputs, EXIT_INPUT, EXIT_OK, reportError, reportWarn } from "./shared";

/** エラー位置を指す ^^^ の行を作る */
export function caretLine(input: string, position: number | undefined): string | null {
  if (position === undefined || position < 0 || position >= input.length) return null;
  const rest = input.slice(position);
  const length = /^\S+/.exec(rest)?.[0].length ?? 1;
  return `${" ".repeat(2 + position)}${"^".repeat(Math.max(1, length))}`;
}

/**
 * `cron-ja validate`
 */
export async function validateCommand(args: CliArgs, io: IO): Promise<number> {
  const options: ParserOptions = boolOption(args, "seconds") ? { seconds: true } : {};
  const json = boolOption(args, "json");
  const quiet = boolOption(args, "quiet");

  const inputs = await collectInputs(args, io);
  const multiple = inputs.length > 1;
  let code = EXIT_OK;

  for (const input of inputs) {
    const result = validate(input, options);

    if (json) {
      io.out(JSON.stringify(multiple ? { input, ...result } : result));
      if (!result.valid) code = Math.max(code, EXIT_INPUT);
      continue;
    }

    if (result.valid) {
      io.out(multiple ? `${input}: ok` : "ok");
      if (!quiet) {
        for (const warning of result.warnings) reportWarn(io, warning);
      }
      continue;
    }

    code = Math.max(code, EXIT_INPUT);
    for (const error of result.errors) {
      reportError(io, error.message);
      const caret = caretLine(input, error.position);
      if (caret !== null) {
        io.err(`  ${input}`);
        io.err(caret);
      }
    }
  }

  return code;
}
