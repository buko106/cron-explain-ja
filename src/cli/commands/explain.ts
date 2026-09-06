import { SERVER_TIME_ZONE, validate } from "../../cron";
import { CronSyntaxError, CronTimeZoneError } from "../../errors";
import { explain, explainDetailed } from "../../explain";
import type { ExplainOptions } from "../../types";
import type { CliArgs } from "../args";
import type { IO } from "../io";
import { dim } from "../io";
import {
  boolOption,
  collectInputs,
  displayWidth,
  EXIT_INPUT,
  EXIT_OK,
  enumOption,
  formatDateHuman,
  padDisplay,
  reportError,
  reportNote,
  resolveZone,
  stringOption,
  timeZoneHint,
} from "./shared";

const FIELD_LABELS: Array<[keyof ReturnType<typeof explainDetailed>["fields"], string]> = [
  ["second", "秒"],
  ["minute", "分"],
  ["hour", "時"],
  ["dayOfMonth", "日"],
  ["month", "月"],
  ["dayOfWeek", "曜日"],
];

export function explainOptions(args: CliArgs): ExplainOptions {
  const options: ExplainOptions = {
    style: enumOption(args, "style", ["casual", "formal"] as const, "casual"),
    hour: enumOption(args, "hour", ["12h", "24h"] as const, "12h"),
  };
  if (boolOption(args, "seconds")) options.seconds = true;
  if (boolOption(args, "show-tz")) options.showTimeZone = true;
  const tz = stringOption(args, "tz");
  // 解釈できない名前はライブラリに渡す前に exit 2 へ落とす
  if (tz !== undefined) options.tz = resolveZone(tz);
  return options;
}

function detailedLines(expression: string, options: ExplainOptions, io: IO): string[] {
  const detail = explainDetailed(expression, options);
  const lines: string[] = [detail.text, ""];

  // 書き換えが起きたときは、どの式をどう読み替えたのかを見せる
  if (detail.localExpression !== detail.expression) {
    lines.push(
      `  ${SERVER_TIME_ZONE} ${detail.expression}  →  ${detail.tz} ${detail.localExpression}`,
      "",
    );
  }

  const rows: Array<[string, string, string]> = [];
  for (const [key, label] of FIELD_LABELS) {
    const field = detail.fields[key];
    if (field === undefined) continue;
    rows.push([label, field.raw, field.text]);
  }
  const rawWidth = Math.max(...rows.map(([, raw]) => displayWidth(raw)), 6);
  for (const [label, raw, text] of rows) {
    lines.push(`  ${padDisplay(label, 8)}${padDisplay(raw, rawWidth + 2)}${text}`);
  }

  if (detail.next.length > 0) {
    // next は UTC 解釈の絶対時刻なので、表示だけ tz の壁時計に直す
    lines.push("", "次回:");
    for (const date of detail.next) {
      lines.push(
        `  ${formatDateHuman(date, { tz: detail.tz, seconds: options.seconds === true })}`,
      );
    }
  }
  return lines.map((line) => (line === detail.text ? line : dim(io, line)));
}

/**
 * `cron-ja explain`
 */
export async function explainCommand(args: CliArgs, io: IO): Promise<number> {
  const options = explainOptions(args);
  const detailed = boolOption(args, "detailed");
  const json = boolOption(args, "json");
  const quiet = boolOption(args, "quiet");

  const inputs = await collectInputs(args, io);
  const multiple = inputs.length > 1;
  const hintTimeZone = timeZoneHint(io, !json && !quiet);
  let code = EXIT_OK;

  for (const input of inputs) {
    try {
      if (json) {
        const detail = explainDetailed(input, options);
        io.out(JSON.stringify(multiple ? { input, ...detail } : detail));
        continue;
      }

      if (detailed) {
        for (const line of detailedLines(input, options, io)) io.out(line);
      } else {
        io.out(explain(input, options));
        // note は式の検証結果そのもの。explainDetailed を組み立て直すと
        // 捨てるだけの next() まで走ってしまう
        if (!quiet) {
          const parserOptions = options.seconds === true ? { seconds: true } : {};
          for (const note of validate(input, parserOptions).warnings) reportNote(io, note);
        }
      }
    } catch (error) {
      if (error instanceof CronSyntaxError || error instanceof CronTimeZoneError) {
        if (json && multiple) {
          io.out(JSON.stringify({ input, error: error.message }));
        } else {
          reportError(io, multiple ? `${input}: ${error.message}` : error.message);
        }
        if (error instanceof CronTimeZoneError) hintTimeZone();
        code = Math.max(code, EXIT_INPUT);
        continue;
      }
      /* c8 ignore next 2 -- 想定外の例外は main で処理する */
      throw error;
    }
  }

  return code;
}
