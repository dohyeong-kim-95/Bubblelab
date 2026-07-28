import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GAMES } from "./records.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(join(ROOT, "slop/animal-vs/index.html"), "utf8");

// 게임 파일에 인라인된 ANIMALS 배열을 그대로 꺼내 검증한다.
// (토이는 빌드 도구 없는 단일 HTML이라 import 대신 발췌해서 평가한다)
function loadAnimals() {
  const start = HTML.indexOf("const ANIMALS = [");
  const end = HTML.indexOf("].sort(", start);
  assert.ok(start !== -1 && end !== -1, "ANIMALS 배열을 찾지 못했다");
  const rows = JSON.parse(
    HTML.slice(HTML.indexOf("[", start), end + 1).replace(/,(\s*])/g, "$1"),
  );
  return rows.sort((a, b) => a[1] - b[1]);
}

const ANIMALS = loadAnimals();
const minRatio = (s) => (s < 5 ? 6 : s < 15 ? 3 : s < 30 ? 2 : 1.5);

test("주간 보드에 등록돼 있다 (빠지면 서버가 기록 제출을 거절한다)", () => {
  const cfg = GAMES["animal-vs"];
  assert.ok(cfg, "_infra/records.js의 GAMES에 animal-vs가 없다");
  assert.equal(cfg.dir, "max");
  assert.equal(cfg.min, 0);
  assert.ok(cfg.max >= 100);
});

test("게임 파일이 토이 관례를 지킨다", () => {
  assert.match(HTML, /window\.blWeekly\s*=\s*\{\s*game:\s*"animal-vs"/);
  assert.match(HTML, /window\.blWeeklyReport\?\.\(/);
  assert.match(HTML, /window\.blShareText/);
  assert.match(HTML, /\/_shared\/records\.js/);
  assert.match(HTML, /\/_shared\/share\.js/);
  assert.match(HTML, /color-scheme: light dark/);
  // 카드 아이콘은 파일의 첫 이모지에서 뽑힌다
  assert.equal(HTML.match(/\p{Extended_Pictographic}/u)[0], "🐋");
});

test("데이터셋이 온전하다", () => {
  assert.ok(ANIMALS.length >= 150, `동물이 ${ANIMALS.length}종뿐이다`);
  const names = ANIMALS.map(([n]) => n);
  assert.equal(new Set(names).size, names.length, "중복된 동물이 있다");
  for (const [name, kg] of ANIMALS) {
    assert.ok(typeof name === "string" && name.length > 0, `이름이 비었다: ${name}`);
    assert.ok(Number.isFinite(kg) && kg > 0, `몸무게가 이상하다: ${name} ${kg}`);
  }
});

test("로그 스케일로 고르게 퍼져 있다 (난이도 곡선의 전제)", () => {
  const lo = Math.log10(ANIMALS[0][1]);
  const hi = Math.log10(ANIMALS.at(-1)[1]);
  assert.ok(hi - lo >= 6, `로그 범위가 ${(hi - lo).toFixed(1)}구간뿐이다`);
  // 가장 어려운 티어(1.5배 = 0.176구간)를 만들려면 큰 구멍이 없어야 한다
  for (let i = 1; i < ANIMALS.length; i++) {
    const gap = Math.log10(ANIMALS[i][1]) - Math.log10(ANIMALS[i - 1][1]);
    assert.ok(gap <= 0.7, `${ANIMALS[i - 1][0]}과 ${ANIMALS[i][0]} 사이가 비었다`);
  }
});

test("모든 난이도 구간에서 페어가 만들어진다", () => {
  for (const streak of [0, 5, 15, 30, 60]) {
    const r = minRatio(streak);
    for (const base of ANIMALS) {
      const ok = ANIMALS.some((a) => a !== base && Math.max(a[1], base[1]) / Math.min(a[1], base[1]) >= r);
      assert.ok(ok, `연속 ${streak}개에서 ${base[0]} 기준 상대를 못 찾는다`);
    }
  }
});

test("정답 방향이 한쪽으로 쏠리지 않는다", () => {
  // 방향을 먼저 정하는 구현이라, 양방향 후보가 모두 있는 기준에서는 50:50이어야 한다
  for (const streak of [0, 30]) {
    const r = minRatio(streak);
    const both = ANIMALS.filter(
      (base) =>
        ANIMALS.some((a) => a[1] / base[1] >= r) && ANIMALS.some((a) => base[1] / a[1] >= r),
    );
    assert.ok(both.length / ANIMALS.length > 0.5,
      `연속 ${streak}개에서 양방향 가능한 기준이 ${both.length}종뿐이다`);
  }
});
