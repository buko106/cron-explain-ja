import { instantAt, next } from "../../cron";
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

/** タイムゾーンを伴わない ISO 8601（'2026-06-14' や '2026-06-14T02:00'） */
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * `--from` を解釈する。
 *
 * オフセットを書いていない日時は `tz` の壁時計として読む。`new Date()` に任せると
 * 実行環境のローカル時刻になり、結果がホストのゾーンに左右されてしまう。
 */
function fromOption(args: CliArgs, tz: string): Date | undefined {
  const from = stringOption(args, "from");
  if (from === undefined) return undefined;

  const naive = NAIVE_DATETIME.exec(from);
  const date =
    naive === null
      ? new Date(from)
      : instantAt(
          tz,
          Number(naive[1]),
          Number(naive[2]),
          Number(naive[3]),
          Number(naive[4] ?? 0),
          Number(naive[5] ?? 0),
          Number(naive[6] ?? 0),
        );
  if (Number.isNaN(date.getTime())) {
    throw new CliUsageError(`--from の日時 '${from}' を解釈できません`);
  }
  return date;
}

export function nextOptions(args: CliArgs, tz: string): NextOptions {
  const options: NextOptions = {
    count: intOption(args, "count", 3),
  };
  if (boolOption(args, "seconds")) options.seconds = true;

  const from = fromOption(args, tz);
  if (from !== undefined) options.from = from;
  return options;
}

/**
 * `cron-ja next`
 */
export async function nextCommand(args: CliArgs, io: IO): Promise<number> {
  // cron 式は UTC として解釈し、--tz は表示にだけ使う
  const tz = resolveZone(stringOption(args, "tz"));
  const options = nextOptions(args, tz);
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
