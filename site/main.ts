import {
  CronSyntaxError,
  CronTimeZoneError,
  type Explanation,
  explainDetailed,
  type ParseResult,
  parse,
  type ValidationError,
  validate,
} from "cron-explain-ja";

/**
 * 画面で扱うオプション。すべて必須にして `exactOptionalPropertyTypes` の
 * 「undefined を渡せない」制約を避ける。
 */
interface DemoOptions {
  tz: string;
  style: "casual" | "formal";
  hour: "12h" | "24h";
}

/** 変換の向き。入力できるのは変換元の欄だけで、変換先は読み取り専用 */
type Direction = "cronToJa" | "jaToCron";

const CRON_SAMPLES = ["0 0 * * 1-5", "*/15 * * * *", "0 4 * * *", "30 15 1 * *", "@daily"];
const JA_SAMPLES = ["平日の朝9時", "毎日午後1時", "毎時9分と39分", "毎月10日と25日の午前10時"];

const PLACEHOLDER = { cron: "0 0 * * 1-5", ja: "平日の午前9時" };

const FIELD_LABELS = [
  ["second", "秒"],
  ["minute", "分"],
  ["hour", "時"],
  ["dayOfMonth", "日"],
  ["month", "月"],
  ["dayOfWeek", "曜日"],
] as const;

const DOW_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`要素 #${id} が見つかりません`);
  return found as T;
}

const cronInput = element<HTMLTextAreaElement>("cron");
const jaInput = element<HTMLTextAreaElement>("ja");
const cronDiag = element("cron-diag");
const jaDiag = element("ja-diag");
const cronZone = element("cron-zone");
const jaZone = element("ja-zone");
const cronRole = element("cron-role");
const jaRole = element("ja-role");
const panes = element("panes");
const swapButton = element<HTMLButtonElement>("swap");
const dirFrom = element("dir-from");
const dirTo = element("dir-to");
const tzSelect = element<HTMLSelectElement>("tz");
const styleSelect = element<HTMLSelectElement>("style");
const hourSelect = element<HTMLSelectElement>("hour");
const detailBox = element("detail");
const fieldsBody = element("fields-body");
const fieldsZone = element("fields-zone");
const nextList = element("next-list");
const nextZone = element("next-zone");
const proseZone = element("prose-zone");

/** Intl.DateTimeFormat の生成は重いのでゾーンごとに使い回す */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // hour12: false は環境によって 0 時を 24 と読ませるため h23 を使う
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatters.set(timeZone, created);
  return created;
}

/** 「2026-09-07 (月) 09:00」。CLI の `formatDateHuman` と同じ形式 */
function formatInstant(date: Date, tz: string): string {
  const found: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(date)) {
    if (part.type !== "literal") found[part.type] = part.value;
  }
  const year = found.year ?? "";
  const month = found.month ?? "";
  const day = found.day ?? "";
  // 曜日名はロケールの表記に左右されるので、壁時計の日付から自分で引く
  const wall = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const weekday = DOW_SHORT[wall.getUTCDay()] ?? "";
  return `${year}-${month}-${day} (${weekday}) ${found.hour ?? ""}:${found.minute ?? ""}`;
}

/**
 * エラー位置を指す `^^^` の行。CLI の `caretLine` と同じだが、
 * 画面では式と同じ桁から始めるのでインデントを足さない。
 */
function caretLine(input: string, position: number | undefined): string | null {
  if (position === undefined || position < 0 || position >= input.length) return null;
  const length = /^\S+/.exec(input.slice(position))?.[0].length ?? 1;
  return `${" ".repeat(position)}${"^".repeat(Math.max(1, length))}`;
}

/**
 * 画面に出すゾーン名を IANA の正規名に揃える。`'local'` は端末の設定を指す。
 * 解決に失敗しても画面は描く（理由は explain / parse 側がエラーとして出す）
 */
function resolveZoneSafely(tz: string): string {
  try {
    const requested = tz === "local" ? new Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
    return new Intl.DateTimeFormat("en-US", { timeZone: requested }).resolvedOptions().timeZone;
  } catch {
    return tz;
  }
}

function addDiagnostic(host: HTMLElement, level: "error" | "warn", message: string): HTMLElement {
  const row = document.createElement("div");
  row.className = `diag diag-${level}`;

  const tag = document.createElement("span");
  tag.className = "diag-tag";
  tag.textContent = level;

  const body = document.createElement("span");
  body.className = "diag-message";
  body.textContent = message;

  row.append(tag, body);
  host.append(row);
  return row;
}

function addErrorWithCaret(host: HTMLElement, expression: string, error: ValidationError): void {
  const row = addDiagnostic(host, "error", error.message);
  const caret = caretLine(expression, error.position);
  if (caret === null) return;

  const pre = document.createElement("pre");
  pre.className = "diag-caret";
  pre.textContent = `${expression}\n${caret}`;
  row.append(pre);
}

function renderFields(detail: Explanation): void {
  fieldsBody.replaceChildren();
  for (const [key, label] of FIELD_LABELS) {
    const field = detail.fields[key];
    if (field === undefined) continue;

    const head = document.createElement("th");
    head.scope = "row";
    head.textContent = label;

    const raw = document.createElement("td");
    raw.className = "mono";
    raw.textContent = field.raw;

    const text = document.createElement("td");
    text.textContent = field.text;

    const row = document.createElement("tr");
    row.append(head, raw, text);
    fieldsBody.append(row);
  }
}

function renderNext(detail: Explanation): void {
  nextList.replaceChildren();

  if (detail.next.length === 0) {
    const empty = document.createElement("li");
    empty.className = "next-empty";
    empty.textContent = "計算できません（拡張構文 L / # / W を含む式、または到達しない日付です）";
    nextList.append(empty);
    return;
  }

  for (const date of detail.next) {
    const item = document.createElement("li");
    item.textContent = formatInstant(date, detail.tz);
    nextList.append(item);
  }
}

function showDetail(detail: Explanation): void {
  renderFields(detail);
  renderNext(detail);
  detailBox.hidden = false;
}

function hideDetail(): void {
  detailBox.hidden = true;
}

/** 変換元がエラーのとき、変換先に残る前回の結果を「今の入力のものではない」と示す */
function markStale(pane: "cron" | "ja"): void {
  (pane === "cron" ? cronInput : jaInput).classList.add("stale");
}

/** cron 式 → 日本語 */
function renderFromCron(options: DemoOptions): void {
  const expression = cronInput.value.trim();
  if (expression === "") {
    jaInput.value = "";
    hideDetail();
    return;
  }

  let detail: Explanation;
  try {
    detail = explainDetailed(expression, options);
  } catch (error) {
    hideDetail();
    markStale("ja");
    if (error instanceof CronSyntaxError) {
      // エラー位置は validate が持っている。取れなければ本文だけ出す
      const { errors } = validate(expression);
      if (errors.length === 0) addDiagnostic(cronDiag, "error", error.message);
      for (const entry of errors) addErrorWithCaret(cronDiag, expression, entry);
      return;
    }
    if (error instanceof CronTimeZoneError) {
      addDiagnostic(cronDiag, "error", error.message);
      return;
    }
    throw error;
  }

  jaInput.value = detail.text;
  showDetail(detail);
  for (const note of detail.notes) addDiagnostic(cronDiag, "warn", note);
}

/** 日本語 → cron 式 */
function renderFromJa(options: DemoOptions): void {
  const text = jaInput.value.trim();
  if (text === "") {
    cronInput.value = "";
    hideDetail();
    return;
  }

  let result: ParseResult;
  try {
    result = parse(text, { tz: options.tz });
  } catch (error) {
    hideDetail();
    markStale("cron");
    if (error instanceof CronTimeZoneError) {
      addDiagnostic(jaDiag, "error", error.message);
      return;
    }
    throw error;
  }

  if (result.expression === null) {
    hideDetail();
    markStale("cron");
    addDiagnostic(jaDiag, "error", "日本語として解釈できませんでした");
    return;
  }

  cronInput.value = result.expression;
  // 解釈が一意でないときに黙って決めたように見せない。候補から選ぶ UI は持たないので質問だけ出す
  for (const ambiguity of result.ambiguities) addDiagnostic(jaDiag, "warn", ambiguity.question);
  for (const note of result.notes) addDiagnostic(jaDiag, "warn", note);

  try {
    showDetail(explainDetailed(result.expression, options));
  } catch {
    // parse が返した式なので通常は成功する。内訳だけ諦めて cron 式は残す
    hideDetail();
  }
}

function currentOptions(): DemoOptions {
  return {
    tz: tzSelect.value,
    style: styleSelect.value === "formal" ? "formal" : "casual",
    hour: hourSelect.value === "24h" ? "24h" : "12h",
  };
}

function updateZoneLabels(zone: string): void {
  cronZone.textContent = "UTC として読みます";
  jaZone.textContent = `${zone} の時刻`;
  fieldsZone.textContent = `（${zone} の壁時計）`;
  nextZone.textContent = `（${zone}）`;
  proseZone.textContent = zone;
}

let direction: Direction = "cronToJa";

/** 向きに合わせて、どちらが入力でどちらが結果かを画面に反映する */
function applyDirection(): void {
  const fromCron = direction === "cronToJa";
  panes.dataset.direction = direction;

  cronInput.readOnly = !fromCron;
  jaInput.readOnly = fromCron;
  cronInput.placeholder = fromCron ? PLACEHOLDER.cron : "";
  jaInput.placeholder = fromCron ? "" : PLACEHOLDER.ja;

  cronRole.textContent = fromCron ? "入力" : "結果";
  jaRole.textContent = fromCron ? "結果" : "入力";
  cronRole.className = `pane-role pane-role-${fromCron ? "source" : "output"}`;
  jaRole.className = `pane-role pane-role-${fromCron ? "output" : "source"}`;

  dirFrom.textContent = fromCron ? "cron 式" : "日本語";
  dirTo.textContent = fromCron ? "日本語" : "cron 式";
  swapButton.textContent = fromCron ? "⇄ 日本語から変換する" : "⇄ cron 式から変換する";
}

function render(): void {
  const options = currentOptions();
  cronDiag.replaceChildren();
  jaDiag.replaceChildren();
  cronInput.classList.remove("stale");
  jaInput.classList.remove("stale");
  updateZoneLabels(resolveZoneSafely(options.tz));

  if (direction === "cronToJa") renderFromCron(options);
  else renderFromJa(options);
}

/**
 * 向きを変える。両方の欄は値を保ったままなので、それまでの変換結果が
 * そのまま新しい入力になる。
 */
function setDirection(next: Direction): void {
  direction = next;
  applyDirection();
  render();
}

let composing = false;
let pending: number | undefined;

function schedule(): void {
  if (pending !== undefined) window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = undefined;
    render();
  }, 180);
}

for (const input of [cronInput, jaInput]) {
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    schedule();
  });
  // 変換確定前の未確定文字列で parse を走らせるとエラーが点滅するので、確定を待つ
  input.addEventListener("input", () => {
    if (!composing) schedule();
  });
}

swapButton.addEventListener("click", () => {
  setDirection(direction === "cronToJa" ? "jaToCron" : "cronToJa");
});

for (const select of [tzSelect, styleSelect, hourSelect]) {
  select.addEventListener("change", () => {
    render();
  });
}

function addSamples(hostId: string, samples: readonly string[], target: Direction): void {
  const host = element(hostId);
  for (const text of samples) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = target === "cronToJa" ? "sample mono" : "sample";
    button.textContent = text;
    button.addEventListener("click", () => {
      (target === "cronToJa" ? cronInput : jaInput).value = text;
      setDirection(target);
    });
    host.append(button);
  }
}

addSamples("samples-cron", CRON_SAMPLES, "cronToJa");
addSamples("samples-ja", JA_SAMPLES, "jaToCron");

for (const node of document.querySelectorAll(".version")) {
  node.textContent = `v${__PKG_VERSION__}`;
}

cronInput.value = "0 0 * * 1-5";
setDirection("cronToJa");
