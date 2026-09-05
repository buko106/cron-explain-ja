# cron-explain-ja: タイムゾーン対応

## リポジトリ

buko106/cron-explain-ja（TypeScript / pnpm / 単一パッケージ、**ランタイム依存なし**）
設計は DESIGN.md が正。`next` の探索は §2.4、公開 API は §1.6、CLI は §4.3、残件は §6。

## 今の状態

- main = `fe9e37e`。**v0.1.5 は publish 済みで、未消化の changeset は無い**。
  破壊的変更を patch リリースに混ぜる心配が無いので、順番待ちせずすぐ着手してよい
- 798 tests / カバレッジ lines 97.4%・branches 90.72%・functions 96.01%（閾値 90 / 85 / 90）
- テストは現在 TZ 非依存。`TZ=UTC` / `TZ=Asia/Tokyo` / `TZ=America/New_York` のいずれでも 798 件通る

## やること

### 1. 既定のタイムゾーンを `Asia/Tokyo` にする

いま `next()` は実行環境のローカル時刻で解釈している（`options.tz` 既定 `'local'`）。
これを `Asia/Tokyo` 既定にする。

### 2. タイムゾーンオプションを追加する（ライブラリと CLI の両方）

いまは `'UTC' | 'local'` の 2 択しかない。IANA のゾーン名（`Asia/Tokyo`、`America/New_York` …）を
受け付けるようにする。DESIGN.md §6 に「CLI の `--tz` で IANA タイムゾーンを扱うか（v1 は
UTC/local のみ）」として残していた項目。

## このタスクの範囲

**実装 → テスト → ドキュメント更新 → changeset → PR 作成まで。マージはしない。**

下に「実装前に決めること」が 5 つある。いずれも人の判断が要るものなので、
**選んだ根拠を PR 本文に書いて、レビューで覆せる形にすること**。勝手に決めて黙って進めない。
判断がつかないもの、特に決定 3（夏時間の飛びと重なり）は、実装を止めずに
片方で作っておき「こう決めた、理由はこれ、変えるならここ」と PR に書けばよい。

---

## 現状の作り（触る場所）

### 時計を持っているのは `next` だけ

`src/cron/next.ts:16-54` に `Clock` インタフェースがあり、`localClock` と `utcClock` の
2 実装が並んでいる。`src/cron/next.ts:83` の 1 行で切り替えているだけ。

```ts
interface Clock {
  parts(date: Date): Parts;                                  // Date → 壁時計
  make(y, mo, d, h, mi, s): Date;                            // 壁時計 → Date
}
const clock = options.tz === "UTC" ? utcClock : localClock;  // next.ts:83
```

**この抽象はそのまま使える。** `zoneClock(tz)` を足して 3 実装目にするのが素直。
探索ループ（`next.ts:130-177`）は `clock` 越しにしか時刻を触っていないので、ループ本体は
原則いじらなくてよい（ただし後述の「春の飛び」だけは別）。

`explain` / `parse` / `validate` は時計を持たない。cron 式の文面はタイムゾーンに依存しないので、
本質的に影響を受けるのは `next` と、`next` を呼んでいる `explainDetailed`（`src/explain/index.ts:153`）だけ。

### `tz` はいま 2 つの意味を持っている ← 最大の論点

| 場所 | 型 | 意味 |
|---|---|---|
| `ExplainOptions.tz`（`src/types.ts:60`） | `string` | **表示だけ**。文末に「（Asia/Tokyo）」と併記する（`src/explain/index.ts:59`） |
| `NextOptions.tz`（`src/types.ts:183`） | `'UTC' \| 'local'` | **時計**。探索に使う |
| CLI `--tz`（`src/cli/args.ts:53-58`） | `string` | 上の 2 つを 1 つのフラグで兼ねている |

CLI のヘルプがその衝突をそのまま書いている:

```
--tz <zone>    explain: 併記するタイムゾーン名 / next: UTC または local
```

`next` に IANA を通すなら、この 2 つの意味をどう整理するかを先に決めること。

### そのほか触る場所

| ファイル | 何をしているか |
|---|---|
| `src/cli/commands/next.ts:23` | `enumOption(args, "tz", ["UTC","local"], "local")` で 2 択に固定している |
| `src/cli/commands/next.ts:84-87` | 表示用に `tz` を `formatDateHuman` へ渡す |
| `src/cli/commands/shared.ts:97-115` | `formatDateHuman`。`getUTC*` と `get*` の 2 系統で日時を組み立てている |
| `src/cli/commands/explain.ts:36-37` | `--tz` をそのまま `ExplainOptions.tz`（併記用）へ流す |
| `src/explain/index.ts:153` | `explainDetailed` の `next` フィールド。`tz` を渡していないので既定に従う |

---

## 実装前に決めること

### 決定 1: オプションの名前と型

`NextOptions.tz` を `'UTC' | 'local'` から広げる。3 案:

- **A. `tz?: string` に広げ、既定 `'Asia/Tokyo'`**（推奨）
  `'UTC'` は IANA 名でもあるので既存の指定はそのまま動く。`'local'` だけ特別扱いで残す。
  移行コストが最小。
- B. `timeZone?: string` を新設し、`tz` は非推奨として残す
  名前は明確になるが、0.x のうちに増やすと後で消す手間が残る
- C. `tz?: string | 'local'` に加えて `Clock` を公開して差し替え可能にする
  柔軟だが v1 の公開 API としては重い

**A を推す。** ただし `'local'` を残すかは別途決めること（残さないと「実行環境の時刻で見たい」が
表現できなくなる。`Intl.DateTimeFormat().resolvedOptions().timeZone` で解決する手もある）。

### 決定 2: `explain` の併記に既定値を付けてはいけない

「既定を Tokyo に」を `ExplainOptions.tz` にまで適用すると、`explain('0 9 * * *')` が
「毎日午前9時（Asia/Tokyo）」になり、**`explain.jsonl` と `explain-real.jsonl` の 209 件が全滅する**。
`explain-real.jsonl` は実在 crontab を人手でレビューして固定したもので、動かす筋の話ではない。

併記はいまどおり**明示したときだけ**にすること。既定を変えるのは時計（`next`）だけ。

### 決定 3: 存在しない壁時計・重複する壁時計をどう扱うか

`Asia/Tokyo` に夏時間は無いので既定では起きない。**が、`--tz` を開ける以上は決めが要る。**
下の試作で実測した挙動:

| 場面 | 例 | 試作の挙動 |
|---|---|---|
| 春の飛び（その壁時計が存在しない） | New York `30 2 * * *`、2026-03-08 は 02 時台が無い | **その日は黙って飛ばす**。翌 3/9 02:30 から返る |
| 秋の巻き戻し（壁時計が 2 回ある） | New York `30 1 * * *`、2026-11-01 の 01:30 | **早い方（EDT）で 1 回だけ**返る |

秋の挙動は妥当。春は「飛ばす」「切り替え後（03:30）に寄せる」「切り替え前（01:30）に寄せる」の
3 通りがあり、Vixie cron は**切り替え直後に 1 回動かす**。飛ばすのが正しいかはプロダクト判断。
どちらにしても DESIGN.md §6 に決定として書き残すこと。

**あわせて性能の落とし穴がある**（下の実測を参照）。春の飛びの日は探索ループが 1 秒刻みで
空回りし、反復が 13 回 → 3618 回に膨らむ。壁時計が飛んでいることを `make()` の結果から
検出して日単位で飛ばす手当てを入れるのが望ましい。

### 決定 4: `next --format=iso` / `--format=unix` をどうするか

`--format=iso` は `date.toISOString()`（常に UTC の `Z` 表記）。ゾーンを指定したのに
`Z` で出るのは分かりにくいので、`2026-09-07T09:00:00+09:00` に変える案がある。
ただし出力形式の変更は破壊的。`--format=human` はゾーンの壁時計で出す必要がある
（`formatDateHuman` の改修が要る）。

### 決定 5: バージョン

**`next()` の既定変更は破壊的**。JST 以外の環境では返る値が変わり、`explainDetailed().next` も変わる。
0.1.x なので changeset は `minor`（→ 0.2.0）が妥当。`patch` にはしないこと。

v0.1.5 は publish 済みで未消化の changeset も無いので、この作業の changeset が
次のリリース（0.2.0）を単独で作る。ほかの変更と同居しないので順番待ちは不要。

---

## 実装の勘所

### `Intl` だけで書ける（ランタイム依存を足さないこと）

- `Temporal` は **Node 18/20/22 のいずれにも無い**（`typeof Temporal === "undefined"` を確認済み）
- ランタイム依存ゼロは設計原則 2。`luxon` や `date-fns-tz` は入れられない
- `Intl.DateTimeFormat` の `timeZone` は Node 18 から full-ICU で使える。公開物の下限は Node 18.3

`Date → 壁時計` は `formatToParts` で素直に取れる。逆（`壁時計 → Date`）はオフセットの
逆算が要るが、**2 回反復すれば収束する**。以下は動作確認済みの試作:

```js
const FMT = new Map();
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function fmt(tz) {
  let f = FMT.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    });
    FMT.set(tz, f);               // 生成は高いのでゾーンごとにキャッシュする
  }
  return f;
}

function parts(tz, date) {
  const o = {};
  for (const p of fmt(tz).formatToParts(date)) if (p.type !== "literal") o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day,
           hour: +o.hour % 24, minute: +o.minute, second: +o.second, dayOfWeek: DOW[o.weekday] };
}

/** その瞬間のゾーンオフセット(ms)。壁時計を UTC とみなした値 - 実時刻 */
function offset(tz, date) {
  const p = parts(tz, date);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
       - Math.floor(date.getTime() / 1000) * 1000;   // parts に ms が無いので秒に丸める
}

/** 壁時計 → Date。オフセットを 2 回反復して収束させる */
function make(tz, y, mo, d, h, mi, s) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const t = guess - offset(tz, new Date(guess));
  return new Date(guess - offset(tz, new Date(t)));
}
```

`hourCycle: "h23"` は必須。`hour12: false` だと環境によって 0 時が `24` になる
（`% 24` はその保険）。

**往復検証済み**: `Asia/Tokyo` / `UTC` / `America/New_York` / `Europe/London` /
`Australia/Lord_Howe`（30 分刻みの DST）の 5 ゾーンで、2026 年を 4.37 時間おきに 20,000 点
サンプルして `parts → make → parts` が全点一致。夏時間の境界も含めて 0 件の不一致。

### ゾーン名の検証

`Intl.DateTimeFormat` は不正なゾーンで `RangeError` を投げるので、これで弾ける:

```js
try { new Intl.DateTimeFormat("en-US", { timeZone: z }); } catch { /* 不正 */ }
```

`Intl.supportedValuesOf("timeZone")` でも取れる（この環境では 418 件）が、上の try/catch の方が
Node 18 まで確実。

**注意**: `Intl` は `"JST"` や `"+09:00"` も**通す**。IANA 名だけに絞りたいなら別途チェックが要る。
`"utc"` `"asia/tokyo"` のような小文字も通る（大文字小文字を保って表示すると見た目が揃わない）。

CLI では不正なゾーンを `CliUsageError` にして exit 2 に落とすのが既存の作法
（`src/cli/commands/next.ts:30-32` の `--from` と同じ）。

### 性能

`formatToParts` は `getHours()` の **約 63 倍遅い**（20 万回で 1075ms 対 17ms）。
探索ループは 1 反復あたり `parts` 1 回 + `make` 2 回 = 最大 3 回の `formatToParts` を呼ぶ。

実測（試作をループに差し込んで計測、初回の ICU 初期化ぶんは除く）:

| ケース | 反復 | Intl 呼び出し | 時間 |
|---|---|---|---|
| `0 9 * * *` / Asia/Tokyo（典型） | 13 | 40 | 0.3 ms |
| `30 1 * * *` / New York・秋の巻き戻し | 16 | 49 | 0.3 ms |
| 到達しない式（5 年走査の最悪ケース） | 1,828 | 5,486 | 34 ms |
| **`30 2 * * *` / New York・春の飛び** | **3,618** | **10,855** | **76 ms** |

現状（ローカル時計）の同等ケースは 0.14〜0.27 ms なので、典型ケースで 2〜3 倍、最悪で 100 倍以上。
実用上は許容範囲だが、**春の飛びの行は明らかに空回りしている**（決定 3 参照）。
気になるならオフセットを UTC の日単位でキャッシュすると `make` の 1 回目を省ける。

---

## 壊れるもの

### `test/next.test.ts`

ローカル時計前提で書かれている。既定が Tokyo になると **JST 以外の環境で落ちる**（CI ランナーは UTC）。

```ts
const FROM = new Date(2026, 8, 5, 12, 34, 56);   // :5  ローカルの Date コンストラクタ
dates.map((d) => `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}`)  // :19  ローカルの getter
```

`from` と期待値の両方を UTC 基準（`new Date("...Z")` と `toISOString()`）に書き直すか、
テストごとに `tz` を明示すること。**ゾーンをまたぐ回帰を捕まえたいので、
`vitest.config.ts` で `TZ` を固定するより、テスト側でゾーンを明示する方がよい**
（`TZ` を固定すると「ランナーのゾーンに依存していないこと」が検証できなくなる）。

### CLI のヘルプスナップショット

`test/__snapshots__/help.test.ts.snap:12,32` に `--tz` の説明文がそのまま入っている。
説明を変えたら `pnpm vitest run -u` で更新すること。

### 触らなくてよいもの

- `explain` / `parse` のフィクスチャ 209 件 + `parse.jsonl` 47 件 — 決定 2 を守れば無傷
- `test/property.test.ts:65` は `Array.isArray(next(...))` を見ているだけなので影響なし

### ドキュメント

| 場所 | 内容 |
|---|---|
| `DESIGN.md:161-171` | §1.6 `NextOptions` の型と既定値 |
| `DESIGN.md:466` | §2.4 next の箇条書き（タイムゾーンの扱いを 1 行足す） |
| `DESIGN.md:690-697` | §4.3 CLI next の Options ブロック（`--tz <UTC\|local> default: local`） |
| `DESIGN.md:888` | §6 残件の「CLI の `--tz` で IANA タイムゾーンを扱うか」を「決めたこと」へ移す |
| `README.md:39` | explain の `tz` の説明（併記だけであることを明記する好機） |
| `README.md:102` | `next(..., { tz: "local" })` の例 |

---

## 検証に使えるスクリプト

`pnpm build` してからリポジトリ直下に置いて `node` で実行する。

### ゾーン往復（`make` の正しさ）

```js
import { next } from "./dist/index.js";
// 実装後に、次の 3 点が成り立つことを確かめる
const zones = ["Asia/Tokyo", "UTC", "America/New_York", "Europe/London", "Australia/Lord_Howe"];
for (const tz of zones) {
  // 1. 壁時計が指定どおりか
  const [d] = next("30 9 * * *", { tz, from: new Date("2026-06-15T00:00:00Z"), count: 1 });
  const wall = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    hour: "2-digit", minute: "2-digit" }).format(d);
  console.log(`${tz.padEnd(22)} ${d.toISOString()}  壁時計 ${wall}  ${wall === "09:30" ? "ok" : "NG"}`);
}
// 2. 既定が Asia/Tokyo であること（TZ 環境変数を変えても同じ結果になること）
//    TZ=UTC node x.mjs と TZ=America/New_York node x.mjs の出力が一致するか
// 3. tz: "UTC" が従来と同じ値を返すこと（後方互換）
```

### 既定変更の影響範囲

```sh
# ランナーのゾーンに依存していないことの確認。3 つとも同じ結果になるべき
for z in UTC Asia/Tokyo America/New_York Pacific/Kiritimati; do
  echo "== $z"; TZ=$z pnpm vitest run 2>&1 | grep -E "Tests|FAIL"
done
```

### 夏時間の境界

New York の 2026 年は 3/8 に春の飛び、11/1 に秋の巻き戻し。
`30 2 * * *`（春）と `30 1 * * *`（秋）を `--from` で境界の前日に置いて、
決定 3 で決めた挙動どおりになっているか見ること。

---

## 進め方の決まり

- main はブランチ保護。PR 必須、CI 5 ジョブ（test × Node 22/24/26、runtime × Node 18/20）
- main から作業ブランチを切って PR → squash マージ
- コミット前に必ず: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- 公開物に影響するので `pnpm changeset` を追加する。**今回は `minor`**（破壊的変更のため）
- カバレッジ閾値 lines 90% / branches 85% / functions 90%（`vitest.config.ts` で強制）
- 開発ツールチェーンは Node 22.12+ が必要（公開物自体は Node 18.3+ で動く）
- リリース周りの落とし穴は README「開発 > リリース」に全部書いてある。触る前に読むこと

## 完了の条件

次を全部満たしたら終わり。

1. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` が通る
2. カバレッジが閾値（lines 90 / branches 85 / functions 90）を割っていない
3. `TZ=UTC` `TZ=Asia/Tokyo` `TZ=America/New_York` `TZ=Pacific/Kiritimati` の 4 つで
   テストが通る（ランナーのゾーンに依存していないことの確認。下の検証スクリプト参照）
4. `pnpm changeset` で **minor** の changeset がある
5. DESIGN.md の該当箇所（下の表）を更新し、§6 の残件から `--tz` の行を「決めたこと」へ移した
6. README の `tz` の説明（`:39`）と `next` の例（`:102`）が新しい仕様と合っている
7. **PR を作り、CI 5 ジョブが green になっている**

### PR について

- **PR テンプレートは無い**（`.github/` には `workflows/` しか無い）。通常の本文で書く
- タイトルに破壊的変更であることが分かるように書く
  （例: `feat!: 既定のタイムゾーンを Asia/Tokyo にし、IANA ゾーン名を受け付ける`）
- 本文に最低限これを載せる:
  - 何が変わるか。**特に `next()` の既定が変わって JST 以外の環境で結果が変わること**
  - 「実装前に決めること」の 1〜5 で**どれを選んだか、なぜか**。特に決定 3（夏時間の飛びと重なり）
    は実測の挙動を添える
  - 検証結果（ゾーン往復、4 つの `TZ` でのテスト、夏時間の境界、性能）
  - 移行方法（従来どおりの挙動が欲しい人は `tz: 'local'` を明示、など）
- **マージはしない。** マージすると Version Packages の PR が 0.2.0 で作られ、
  その PR をマージした時点で npm に publish される。破壊的変更を世に出す判断は人に任せる
- CI が赤くなったら直してから終えること。green にせずに投げっぱなしにしない

## 注意

- **ランタイム依存を足さないこと**（設計原則 2）。`Intl` で足りることは確認済み
- **`explain` の出力を変えないこと**。`explain-real.jsonl` は実在 crontab 167 式を人手で
  レビューして固定したもの。既定のゾーンを文面に出すと全部書き換えになる（決定 2）
- runtime ジョブ（Node 18/20）は `dist` を import するだけで**テストは走らない**。
  Node 18 の `Intl` 挙動差は CI では捕まらないので、必要なら runtime ジョブに
  1 行スモークを足すこと（例: `node -e "require('./dist/index.cjs').next('0 9 * * *', { tz: 'Asia/Tokyo' })"`）
- `next` の探索上限は 5 年（`src/cron/next.ts:65`）、無限ループ保険が 200 万反復（`:68`）。
  春の飛びで反復が膨らむのはこの保険の範囲内だが、上限に頼らず日単位で飛ばす方がよい
