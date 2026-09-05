export interface TimeStyle {
  style: "casual" | "formal";
  hour: "12h" | "24h";
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * 「午前9時」「15時」のように時だけを表す。
 */
export function formatHour(hour: number, style: TimeStyle): string {
  if (style.hour === "24h") return `${hour}時`;
  if (hour < 12) return `午前${hour}時`;
  return `午後${hour - 12}時`;
}

/**
 * 「午前9時」「午後6時30分」「正午」のように時刻を表す。
 */
export function formatTime(hour: number, minute: number, style: TimeStyle): string {
  if (style.style === "casual" && style.hour === "12h" && hour === 12 && minute === 0) {
    return "正午";
  }
  const base = formatHour(hour, style);
  if (style.style === "formal") return `${base}${pad2(minute)}分`;
  return minute === 0 ? base : `${base}${minute}分`;
}
