import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyLine, METAPHOR, monthReading, yearReading } from "../util/fortune/tojeong-reading.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "util", "fortune", "tojeong");
const all = readdirSync(DIR).filter((f) => /^\d{3}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

test("구절 분류: 길흉 글자·부정·해소를 구분한다", () => {
  assert.ok(classifyLine("所望如意 必有慶事").tone > 0);
  assert.ok(classifyLine("出行不利 損財多端").tone < 0);
  assert.ok(classifyLine("災消福來 心神自安").tone > 0, "재앙이 사라짐은 길");
  assert.deepEqual(classifyLine("莫近是非 口舌愼之").cautions.map((c) => c.label), ["말과 말다툼"]);
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
