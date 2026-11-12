import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyHalf, classifyLine, meaningClause, METAPHOR, monthReading, yearReading } from "../util/fortune/tojeong-reading.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "util", "fortune", "tojeong");
const all = readdirSync(DIR).filter((f) => /^\d{3}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

test("구절 분류: 길흉 글자·부정·해소를 구분한다", () => {
  assert.ok(classifyLine("所望如意 必有慶事").tone > 0);
  assert.ok(classifyLine("出行不利 損財多端").tone < 0);
  assert.ok(classifyLine("災消福來 心神自安").tone > 0, "재앙이 사라짐은 길");
  assert.deepEqual(classifyLine("莫近是非 口舌愼之").cautions.map((c) => c.theme), ["talk", "talk"]);
  assert.ok(classifyLine("若非橫財 損財之數").themes.includes("money"));
});

test("비유 구절은 생활 의미로 풀린다", () => {
  const c = classifyLine("一聲砲響 禽獸皆驚");
  assert.equal(c.metaphors[0].half, "一聲砲響");
  assert.match(METAPHOR["一聲砲響"][1], /술렁인다$/);
  for (const [half, [tone, meaning]] of Object.entries(METAPHOR)) {
    assert.equal(half.length, 4, half);
    assert.ok([-1, 0, 1].includes(tone));
    assert.match(meaning, /다$/, `${half}: "~다"로 끝나야 "~는 뜻이에요"에 붙는다`);
  }
});

test("총운: 先困後吉 은 달 점수보다 먼저 '뒤로 갈수록 좋아지는' 흐름을 고른다", () => {
  const data = all.find((d) => d.code === "862");
  const r = yearReading(data);
  assert.equal(r.picks[0], "arc:rising");
  assert.ok(r.picks.includes("metaphor:一聲砲響"));
  assert.match(r.paragraph, /갑작스러운 소식이나 변화로 주변이 술렁인다는 뜻이에요/);
});

test("달: 결과 같은 방향의 분야 조각을 고른다", () => {
  const m = monthReading([
    { hanja: "到處有財 意外得財", ko: "" }, { hanja: "所望如意 必有慶事", ko: "" }, { hanja: "一家和平 喜滿家庭", ko: "" },
  ], 0);
  assert.equal(m.tone, "good");
  assert.ok(m.picks.some((p) => p.endsWith(":good")));
  const bad = monthReading([
    { hanja: "口舌紛紛 損財多端", ko: "" }, { hanja: "出行不利 疾病可畏", ko: "" }, { hanja: "每事不成 心神不安", ko: "" },
  ], 1);
  assert.equal(bad.tone, "bad");
  assert.ok(bad.picks.some((p) => p.endsWith(":bad")));
});

// 커버리지: 144괘 × 12달 전부 해설이 나오고, 규칙에 하나도 걸리지 않아 원문 번역으로
// 대신한 달(fallback)이 얼마인지 센다. 늘어나면 표를 보강할 때다.
test("커버리지: 144괘 모두 총운·12달 해설, 원문 대체는 5% 미만", () => {
  assert.equal(all.length, 144);
  let fallback = 0;
  for (const data of all) {
    const r = yearReading(data);
    assert.ok(r.paragraph.length > 40, data.code);
    assert.equal(r.months.length, 12);
    for (const m of r.months) {
      assert.ok(m.text.length > 10, `${data.code} ${m.month}`);
      assert.doesNotMatch(m.text, /니다\./);
      if (m.fallback) fallback += 1;
    }
  }
  const rate = fallback / (144 * 12);
  console.log(`토정비결 해설 커버리지: 규칙 해설 ${144 * 12 - fallback}/${144 * 12}달, 원문 대체 ${fallback}달 (${(rate * 100).toFixed(1)}%)`);
  assert.ok(rate < 0.05);
});

// ── 심사 루프에서 나온 대표 실패 유형 ──────────────────────────
test("회귀: 길흉은 반 구마다 — '재물은 들어오나 사람 일은 어찌하랴'의 재물은 길", () => {
  const c = classifyLine("財物入手 人難奈何");
  assert.deepEqual(c.sided.find((t) => t.key === "money"), { key: "money", side: "good" });
});

test("회귀: 조심하라는 반 구(勿·莫)는 그 분야의 흉으로 세지 않고 조언으로만 쓴다", () => {
  const c = classifyLine("勿貪人財 反爲損害");
  assert.equal(c.sided.some((t) => t.key === "money" && t.side === "bad" && c.halves[0].themes.includes("money") && c.halves[0].side), false);
  assert.equal(c.halves[0].side, null);
  assert.ok(c.cautions.length);
});

test("회귀: 若非·雖 반 구는 길흉 쪽을 정하지 않는다", () => {
  assert.equal(classifyHalf("若非橫財").side, null);
  assert.equal(classifyHalf("雖有生財").side, null);
});

test("회귀: 先凶後吉·在家則吉 같은 굴곡·조건부 말은 그대로 옮긴다", () => {
  const rise = monthReading([{ hanja: "先凶後吉 吉凶相半", ko: "" }, { hanja: "未月之數 黑白不明", ko: "" }, { hanja: "遠行不利 在家則吉", ko: "" }], 5);
  assert.ok(rise.picks.includes("opener:rise"), rise.picks.join("|"));
  assert.match(rise.text, /^처음엔 막혀도 갈수록 풀리는 달이에요/);
  assert.equal(classifyHalf("在家則吉").side, null);
  assert.equal(classifyHalf("在家則吉").conditional, true);
});

test("회귀: 총운 분야 문장은 총운 9구에 결이 있는 분야만 말한다(달에서 끌어오지 않는다)", () => {
  for (const data of all) {
    const r = yearReading(data);
    const summaryThemes = new Set(data.summary.flatMap((l) => classifyLine(l.hanja).sided.map((t) => `${t.key}:${t.side}`)));
    for (const p of r.picks.filter((x) => x.startsWith("yearTheme:"))) {
      assert.ok(summaryThemes.has(p.slice("yearTheme:".length)), `${data.code} ${p}`);
    }
  }
});

test("회귀: 비유 풀이 조사('반반이다는' 금지)와 문맥이 뒤집는 비유는 풀지 않는다", () => {
  assert.equal(meaningClause("좋은 일과 궂은 일이 반반이다"), "좋은 일과 궂은 일이 반반이라는");
  assert.equal(meaningClause("앞이 환해진다"), "앞이 환해진다는");
  for (const data of all) {
    const r = yearReading(data);
    assert.doesNotMatch(r.paragraph, /이다는 뜻/, data.code);
  }
});

test("회귀: 같은 결의 계절은 묶어 말한다('봄에는 ~고, 여름에는 ~' 반복 금지)", () => {
  for (const data of all) {
    const r = yearReading(data);
    assert.doesNotMatch(r.paragraph, /에는 일이 순하게 풀리고, \S+에는 일이 순하게/, data.code);
    assert.doesNotMatch(r.paragraph, /에는 마음 쓸 일이 생기기 쉽고, \S+에는 마음 쓸 일이/, data.code);
  }
});

test("회귀: 해설 문장에 원문에 없는 구체 사정(보증·투자·윗사람)을 지어내지 않는다", () => {
  for (const data of all) {
    const r = yearReading(data);
    for (const text of [r.paragraph, ...r.months.map((m) => m.text)]) {
      assert.doesNotMatch(text, /보증|투자|윗사람/, `${data.code}: ${text}`);
    }
  }
});

test("회귀(2차): 총운 분야 문장이 분야 이름을 되풀이하지 않는다('재물 쪽으로는 재물 운이')", () => {
  for (const data of all) assert.doesNotMatch(yearReading(data).paragraph, /(재물|집안|사람|건강|이동|인연) 쪽(으로)?는 \1/, data.code);
});

test("회귀(2차): 받침 없는 명사로 끝난 비유 뜻은 '~라는'(편안한 때다 → 때라는)", () => {
  assert.equal(meaningClause("마음이 편안한 때다"), "마음이 편안한 때라는");
  for (const data of all) assert.doesNotMatch(yearReading(data).paragraph, /때다는|자리다는/, data.code);
});

test("회귀(2차): 같은 분야가 총운에서 길·흉으로 갈리면 차이로 정한다(재물 생겨도 흩어짐 ≠ 재물 운 트임)", () => {
  const data = { code: "999", summary: [
    { hanja: "雖有生財 得而反失", ko: "" }, { hanja: "財數論之 損財多端", ko: "" }, { hanja: "到處有財 意外得財", ko: "" },
  ], months: Array.from({ length: 12 }, () => [{ hanja: "此月之數", ko: "" }]) };
  const r = yearReading(data);
  assert.equal(r.picks.some((p) => p === "yearTheme:money:good"), false, r.picks.join("|"));
});

test("회귀(2차): 조심하라는 반 구는 결에 넣지 않는다 — 좋은 구 + 조언 구는 흉한 달이 아니다", () => {
  const m = monthReading([{ hanja: "以小易大 財運大通", ko: "" }, { hanja: "勿貪人財 以小成大", ko: "" }, { hanja: "家人和平 此外何望", ko: "" }], 0);
  assert.notEqual(m.tone, "bad", m.picks.join("|"));
  for (const data of all) for (const mm of yearReading(data).months) assert.doesNotMatch(mm.text, /^서두르면/, "원문에 없는 '서두름'");
});

test("회귀(3차): 달 첫 문장과 분야 문장이 같은 말('마음 쓸 일')을 되풀이하지 않는다", () => {
  for (const data of all) for (const m of yearReading(data).months) {
    assert.ok((m.text.match(/마음 쓸 일/g) ?? []).length <= 1, `${data.code} ${m.month}: ${m.text}`);
    assert.ok((m.text.match(/무리/g) ?? []).length <= 1, `${data.code} ${m.month}: ${m.text}`);
  }
});

test("회귀(3차): 성씨를 조심하라는 반 구는 생활 조언으로 옮기지 않고, 남의 말(人言)은 시비가 아니라 사람 조언", () => {
  assert.equal(classifyHalf("火姓愼之").caution, null);
  assert.equal(classifyHalf("莫信人言").caution.theme, "helper");
  assert.equal(classifyHalf("莫近是非").caution.theme, "talk");
});

test("회귀(3차): 엇갈린 분야는 총운에서 단정하지 않고, 달 점수의 굴곡이 총운의 결을 뒤집지 않는다", () => {
  for (const data of all) {
    const r = yearReading(data);
    const summary = data.summary.map((l) => classifyLine(l.hanja));
    const tone = summary.reduce((s, c) => s + c.tone, 0);
    const split = summary.some((c) => c.split === "rise" || c.split === "fall");
    if (!split && tone > 0) assert.notEqual(r.picks[0], "arc:falling", data.code);
    if (!split && tone < 0) assert.notEqual(r.picks[0], "arc:rising", data.code);
    const sided = summary.flatMap((c) => c.sided);
    for (const p of r.picks.filter((x) => x.startsWith("yearTheme:"))) {
      const [, key, side] = p.split(":");
      assert.ok(!sided.some((t) => t.key === key && t.side !== side), `${data.code} ${p} — 반대 결이 있는 분야`);
    }
  }
});
