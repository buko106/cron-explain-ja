import { next } from "../../cron";
import { CronSyntaxError } from "../../errors";
import type { NextOptions } from "../../types";
import type { CliArgs } from "../args";
import { CliUsageError } from "../args";
import type { IO } from "../io";
import {
  boolOption,
  collectInputs,
  EXIT_INPUT,
  EXIT_OK,
  enumOption,
  formatDateHuman,
  formatDateIso,
  intOption,
  reportError,
  reportWarn,
  resolveZone,
  stringOption,
} from "./shared";

export function nextOptions(args: CliArgs): NextOptions {
  const options: NextOptions = {
    count: intOption(args, "count", 3),
  };
  if (boolOption(args, "seconds")) options.seconds = true;

  const from = stringOption(args, "from");
  if (from !== undefined) {
    const date = new Date(from);
    if (Number.isNaN(date.getTime())) {
      throw new CliUsageError(`--from の日時 '${from}' を解釈できません`);
    }
    options.from = date;
  }
  return options;
}

/**
 * `cron-ja next`
 */
export async function nextCommand(args: CliArgs, io: IO): Promise<number> {
  // cron 式は UTC として解釈し、--tz は表示にだけ使う
  const tz = resolveZone(stringOption(args, "tz"));
  const options = nextOptions(args);
  const format = enumOption(args, "format", ["human", "iso", "unix"] as const, "human");
  const json = boolOption(args, "json");
  const quiet = boolOption(args, "quiet");

  const inputs = await collectInputs(args, io);
  const multiple = inputs.length > 1;
  let code = EXIT_OK;

  for (const input of inputs) {
    let dates: Date[];
    try {
      dates = next(input, options);
    } catch (error) {
      if (error instanceof CronSyntaxError) {
        if (json && multiple) io.out(JSON.stringify({ input, error: error.message }));
        else reportError(io, multiple ? `${input}: ${error.message}` : error.message);
        code = Math.max(code, EXIT_INPUT);
        continue;
      }
      /* c8 ignore next 2 -- next は CronSyntaxError しか投げない */
      throw error;
    }

    if (json) {
      // 機械向けなので日時は UTC 正規化のまま。どのゾーンで表示したかは tz で示す
      const payload = { tz, next: dates.map((date) => date.toISOString()) };
      io.out(JSON.stringify(multiple ? { input, ...payload } : payload));
      continue;
    }

    if (dates.length === 0 && !quiet) {
      reportWarn(
        io,
        "次回の実行日時を計算できませんでした（拡張構文や到達しない日付の可能性があります）",
      );
      continue;
    }

    for (const date of dates) {
      if (format === "iso") io.out(formatDateIso(date, tz));
      else if (format === "unix") io.out(String(Math.floor(date.getTime() / 1000)));
      else io.out(formatDateHuman(date, { tz, seconds: options.seconds === true }));
    }
  }

  return code;
}
