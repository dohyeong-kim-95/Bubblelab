import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = readFileSync(join(ROOT, "_infra/build.mjs"), "utf8");

// 시상대 등수 계산은 카테고리 홈에 인라인으로 박히는 코드다. 빌드 소스에서
// 그 블록을 그대로 떼어내 돌린다 — 문구가 바뀌면 여기서 먼저 걸린다.
function rankTiers(people) {
  const tiers = [];
  let placed = 0;
  for (const p of people) {
    const last = tiers[tiers.length - 1];
    if (last && last.count === p.count) last.members.push(p);
    else tiers.push({ rank: placed + 1, count: p.count, members: [p] });
    placed += 1;
  }
  return tiers.filter((t) => t.rank <= 3);
}

const of = (...counts) =>
  rankTiers(counts.map((count, i) => ({ nick: `p${i}`, count })))
    .map((t) => `${t.rank}위:${t.members.map((m) => m.nick).join("+")}(${t.count})`);

test("빌드 소스의 등수 계산이 이 테스트와 같은 규칙이다", () => {
  // 구현이 바뀌면 이 테스트가 낡았다는 신호 — 문자열로 못박아 둔다
  assert.match(BUILD, /if \(last && last\.count === p\.count\) last\.members\.push\(p\);/);
  assert.match(BUILD, /else tiers\.push\(\{ rank: placed \+ 1, count: p\.count, members: \[p\] \}\);/);
  assert.match(BUILD, /tiers\.filter\(\(t\) => t\.rank <= 3\)/);
});

test("동점이 없으면 1·2·3위", () => {
  assert.deepEqual(of(3, 2, 1), ["1위:p0(3)", "2위:p1(2)", "3위:p2(1)"]);
});

test("공동 1위 둘이면 다음은 3위 — 2위 단은 없다", () => {
  assert.deepEqual(of(3, 3, 1), ["1위:p0+p1(3)", "3위:p2(1)"]);
});

test("공동 2위 둘이면 3위 단이 없다", () => {
  assert.deepEqual(of(3, 2, 2), ["1위:p0(3)", "2위:p1+p2(2)"]);
});

test("전원 동점이면 모두 공동 1위", () => {
  assert.deepEqual(of(2, 2, 2), ["1위:p0+p1+p2(2)"]);
});

test("동점 인원이 3명을 넘어도 한 단에 모두 올린다", () => {
  assert.deepEqual(of(3, 2, 2, 2), ["1위:p0(3)", "2위:p1+p2+p3(2)"]);
  assert.deepEqual(of(1, 1, 1, 1, 1), ["1위:p0+p1+p2+p3+p4(1)"]);
});

test("4위 이하는 잘라낸다", () => {
  assert.deepEqual(of(4, 3, 2, 1), ["1위:p0(4)", "2위:p1(3)", "3위:p2(2)"]);
  // 공동 1위가 셋이면 그 다음(4위)은 시상대에 오르지 못한다
  assert.deepEqual(of(2, 2, 2, 1), ["1위:p0+p1+p2(2)"]);
});

test("렌더러가 등수 단 구조를 그리고 옛 캐시를 막는다", () => {
  // 동점이면 한 단에 이름을 모아 붙이고 "공동"을 표기한다
  assert.match(BUILD, /t\.members\.map\(\(m\) => m\.nick\)\.join\(" · "\)/);
  assert.match(BUILD, /t\.members\.length > 1 \? "공동 " : ""/);
  // 단이 빠졌을 때 1등이 끝으로 밀리지 않게 배치를 바꾼다
  assert.match(BUILD, /const full = \[1, 2, 3\]\.every\(\(r\) => byRank\.has\(r\)\)/);
  // 옛 캐시를 그대로 그리면 안 된다 — 키를 갈랐고(v3: puzzle 오염 집계 무효화)
  // 형태도 검사한다. 집계는 slop 스코프만 (puzzle 올타임과 분리).
  assert.match(BUILD, /bl-hof-podium-v3/);
  assert.match(BUILD, /alltime=1&scope=slop/);
  assert.match(BUILD, /Array\.isArray\(t\.members\) && t\.rank/);
});
