import { describe, expect, it } from "vitest";
import { validate } from "../src/index";

describe("validate", () => {
  it("正しい式は valid", () => {
    expect(validate("0 9 * * 1-5")).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("構文エラーは errors に入る（throw しない）", () => {
    const result = validate("0 25 * * *");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toEqual({
      field: "hour",
      message: "時 フィールドの値 25 は範囲外です (0-23)",
      position: 2,
    });
  });

  it("フィールド数の誤りは expression のエラー", () => {
    const result = validate("0 9 * *");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.field).toBe("expression");
  });

  it("存在しない日付を警告する", () => {
    const result = validate("0 0 30 2 *");
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain("2月30日は存在しないため、このジョブは実行されません");
  });

  it("一部の月にだけ存在しない日付も警告する", () => {
    const result = validate("0 0 31 1,4 *");
    expect(result.warnings.some((warning) => warning.includes("4月31日"))).toBe(true);
  });

  it("2月29日はうるう年のみと警告する", () => {
    expect(validate("0 0 29 2 *").warnings).toContain("2月29日はうるう年にのみ実行されます");
  });

  it("日と曜日の同時指定を警告する", () => {
    expect(validate("0 0 15 * 2").warnings.some((warning) => warning.includes("OR"))).toBe(true);
  });

  it("拡張構文を警告する", () => {
    const warnings = validate("0 0 L * *").warnings;
    expect(warnings.some((warning) => warning.includes("Quartz"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("next"))).toBe(true);
  });

  it("秒付きの式を検証できる", () => {
    expect(validate("0 0 9 * * *", { seconds: true }).valid).toBe(true);
    expect(validate("0 0 9 * * *").valid).toBe(false);
  });
});
