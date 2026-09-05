import { validate } from "../../cron";
import { ParseAmbiguityError } from "../../errors";
import { parse } from "../../parse";
import type { Ambiguity, ParseOptions, ParseResult } from "../../types";
import type { CliArgs } from "../args";
import type { IO } from "../io";
import {
  boolOption,
  collectInputs,
  EXIT_AMBIGUOUS,
  EXIT_INPUT,
  EXIT_OK,
  intOption,
  reportError,
  reportNote,
  reportWarn,
} from "./shared";

const FIELD_INDEX: Record<Ambiguity["field"], number> = {
  second: -1,
  minute: 0,
  hour: 1,
  dayOfMonth: 2,
  month: 3,
  dayOfWeek: 4,
};

export function parseOptions(args: CliArgs): ParseOptions {
  const options: ParseOptions = { defaultHour: intOption(args, "default-hour", 9) };
  if (boolOption(args, "allow-extensions")) options.allowExtensions = true;
  return options;
}

function candidateHint(ambiguity: Ambiguity): string {
  const values = ambiguity.candidates.map((candidate) => candidate.value);
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (numbers.length === values.length && numbers.length > 2) {
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    return `(${first}-${last})`;
  }
  return `(${values.join("|")})`;
}

/** 対話で曖昧な点を埋め、cron 式を組み立て直す */
async function resolveInteractively(result: ParseResult, io: IO): Promise<string | null> {
  if (result.expression === null) return null;
  const fields = result.expression.split(" ");

  for (const ambiguity of result.ambiguities) {
    const index = FIELD_INDEX[ambiguity.field];
    if (index < 0) continue;
    const answer = await io.ask(`? ${ambiguity.question} ${candidateHint(ambiguity)} › `);
    if (answer === "") continue;
    fields[index] = answer;
  }

  const expression = fields.join(" ");
  const validation = validate(expression);
  if (!validation.valid) {
    const first = validation.errors[0];
    reportError(io, first?.message ?? "入力を解釈できません");
    return null;
  }
  return expression;
}

/**
 * `cron-ja parse`
 */
export async function parseCommand(args: CliArgs, io: IO): Promise<number> {
  const options = parseOptions(args);
  const json = boolOption(args, "json");
  const quiet = boolOption(args, "quiet");
  const wantsInteractive = boolOption(args, "interactive") && io.stdinIsTTY;
  const strict = boolOption(args, "strict") || (boolOption(args, "interactive") && !io.stdinIsTTY);

  const inputs = await collectInputs(args, io);
  const multiple = inputs.length > 1;
  let code = EXIT_OK;

  for (const input of inputs) {
    let result: ParseResult;
    try {
      result = parse(input, strict && !wantsInteractive ? { ...options, strict: true } : options);
    } catch (error) {
      if (error instanceof ParseAmbiguityError) {
        if (json && multiple) {
          io.out(JSON.stringify({ input, error: error.message }));
        } else {
          reportError(io, error.message);
        }
        code = Math.max(code, EXIT_AMBIGUOUS);
        continue;
      }
      /* c8 ignore next 2 -- parse は ParseAmbiguityError しか投げない */
      throw error;
    }

    if (result.expression === null) {
      if (json && multiple) {
        io.out(JSON.stringify({ input, error: "時間表現が見つかりません" }));
      } else {
        reportError(io, "時間表現が見つかりません");
      }
      code = Math.max(code, EXIT_INPUT);
      continue;
    }

    let expression = result.expression;
    if (wantsInteractive && result.ambiguities.length > 0) {
      const resolved = await resolveInteractively(result, io);
      if (resolved === null) {
        code = Math.max(code, EXIT_INPUT);
        continue;
      }
      expression = resolved;
    }

    if (json) {
      const payload = { ...result, expression };
      io.out(JSON.stringify(multiple ? { input, ...payload } : payload));
      continue;
    }

    io.out(expression);
    if (!quiet && !wantsInteractive) {
      const fields = expression.split(" ");
      for (const ambiguity of result.ambiguities) {
        const index = FIELD_INDEX[ambiguity.field];
        const chosen = index >= 0 ? fields[index] : undefined;
        const suffix = chosen === undefined ? "" : ` → '${chosen}' としました`;
        reportWarn(io, `${ambiguity.question}${suffix}（confidence: ${result.confidence}）`);
        if (ambiguity.field === "hour") io.err("      --default-hour で変更できます");
      }
      for (const note of result.notes) reportNote(io, note);
    }
  }

  return code;
}
