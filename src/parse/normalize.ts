const KANJI_DIGITS: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const KANJI_RUN = /[〇零一二三四五六七八九十]+/g;

function convertRun(run: string): string {
  if (!run.includes("十")) {
    let digits = "";
    for (const char of run) {
      const digit = KANJI_DIGITS[char];
      /* c8 ignore next -- KANJI_RUN が一致した文字は必ず辞書にある */
      if (digit === undefined) return run;
      digits += String(digit);
    }
    return digits;
  }

  let total = 0;
  let current = 0;
  for (const char of run) {
    if (char === "十") {
      total += (current === 0 ? 1 : current) * 10;
      current = 0;
    } else {
      const digit = KANJI_DIGITS[char];
      /* c8 ignore next -- KANJI_RUN が一致した文字は必ず辞書にある */
      if (digit === undefined) return run;
      current = digit;
    }
  }
  return String(total + current);
}

/** 漢数字を算用数字に変換する（「半」はそのまま残す） */
export function kanjiToArabic(text: string): string {
  return text.replace(KANJI_RUN, (run) => convertRun(run));
}

/** 文末の動詞句・丁寧表現を落とす */
const TAIL_PATTERNS: RegExp[] = [
  /(に|で)?(実行|起動|開始|動作)(する|して|し|す)?(たい|ください|下さい|ます|ましょう|よう)?$/,
  /(して)?(ください|下さい|ほしい|欲しい|たい)$/,
  /(です|ます|だ|である)(か)?$/,
  /[。！!？?、,\s]+$/,
];

export function stripTail(text: string): string {
  let result = text;
  for (let i = 0; i < 5; i++) {
    let changed = false;
    for (const pattern of TAIL_PATTERNS) {
      const next = result.replace(pattern, "");
      if (next !== result && next.length > 0) {
        result = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return result;
}

/**
 * 解析前の前処理。NFKC 正規化 → 漢数字変換 → 文末表現の除去。
 */
export function normalize(text: string): string {
  return stripTail(kanjiToArabic(text.normalize("NFKC")).trim()).trim();
}
