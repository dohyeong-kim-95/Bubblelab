import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PODIUM = readFileSync(join(ROOT, "_shared/podium.js"), "utf8");
const BUILD = readFileSync(join(ROOT, "_infra/build.mjs"), "utf8");
const HOF = readFileSync(join(ROOT, "slop/hall-of-fame/index.html"), "utf8");

// 등수 계산은 _shared/podium.js에 있다. 같은 규칙을 여기 옮겨 적어 돌리고,
// 아래 첫 테스트가 원본과 어긋나지 않았는지 문자열로 확인한다.
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

test("공용 모듈의 등수 계산이 이 테스트와 같은 규칙이다", () => {
  // 구현이 바뀌면 이 테스트가 낡았다는 신호 — 문자열로 못박아 둔다
  assert.match(PODIUM, /if \(last && last\.count === p\.count\) last\.members\.push\(p\);/);
  assert.match(PODIUM, /else tiers\.push\(\{ rank: placed \+ 1, count: p\.count, members: \[p\] \}\);/);
  assert.match(PODIUM, /tiers\.filter\(\(t\) => t\.rank <= 3\)/);
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

test("렌더러가 등수 단 구조를 그린다", () => {
  // 동점이면 한 단에 이름을 모아 붙이고 "공동"을 표기한다
  assert.match(PODIUM, /t\.members\.map\(\(m\) => m\.nick\)\.join\(" · "\)/);
  assert.match(PODIUM, /t\.members\.length > 1 \? "공동 " : ""/);
  // 단이 빠졌을 때 1등이 끝으로 밀리지 않게 배치를 바꾼다
  assert.match(PODIUM, /const full = \[1, 2, 3\]\.every\(\(r\) => byRank\.has\(r\)\)/);
  assert.match(PODIUM, /Array\.isArray\(t\.members\) && t\.rank/);
});

test("시상대가 제 자리에 하나씩만 붙어 있다", () => {
  // 이번 주 = 카테고리 홈(slop), 올타임 = 명예의 전당
  assert.match(BUILD, /id="week-podium"[^>]*class="bl-podium"/);
  assert.match(BUILD, /🔥 이번 주 slop 삼대장/);
  assert.ok(!BUILD.includes("올타임 slop 삼대장"), "올타임 시상대가 홈에 남아 있다");
  assert.match(HOF, /id="hof-podium"[^>]*class="bl-podium"/);
  assert.match(HOF, /👑 올타임 slop 삼대장/);
  // 둘 다 공용 모듈을 읽어야 한다
  assert.match(BUILD, /\/_shared\/podium\.js/);
  assert.match(HOF, /\/_shared\/podium\.js/);
});

test("올타임 집계는 slop 스코프만 본다", () => {
  // puzzle 서브도메인 게임의 올타임 1위가 섞이면 관왕 수가 오염된다.
  // (시상대가 카테고리 홈에 있던 시절 build.mjs가 지키던 조건 — 이사하며 함께 옮겼다)
  assert.match(HOF, /alltime=1&scope=slop/);
});

test("defer 로드 경합을 막는다", () => {
  // podium.js는 defer라 파싱이 끝나야 실행된다. fetch가 먼저 끝나면 아직 없다.
  for (const [name, src] of [["build.mjs", BUILD], ["hall-of-fame", HOF]]) {
    assert.match(src, /document\.readyState === "loading"/, `${name}가 DOM 준비를 안 기다린다`);
    assert.match(src, /DOMContentLoaded/, `${name}가 DOM 준비를 안 기다린다`);
  }
});

test("slop 홈 상단: 올타임 1위 한 줄(스코프 준수) + 연속 방문은 구석 배지", () => {
  assert.match(BUILD, /id="alltime-top"[^>]*href="\/hall-of-fame\/"/);
  // 홈의 올타임 1위 집계도 slop 스코프만 봐야 한다 (puzzle 오염 방지)
  assert.match(BUILD, /_records\?alltime=1&scope=slop/);
  // 동점 규칙은 공용 모듈의 rank를 그대로 쓴다
  assert.match(BUILD, /blPodium\?\.rank\(records\)/);
  assert.match(BUILD, /id="streak" title=/);
});

test("slop 홈은 시상대가 대신하므로 #crown을 빼고, 다른 카테고리는 유지한다", () => {
  assert.match(BUILD, /site === "slop" \? "" : '  <div id="crown"/);
  // slop에는 요소가 없으므로 갱신 코드가 방어해야 한다
  assert.match(BUILD, /const crown = document\.getElementById\("crown"\);/);
  assert.match(BUILD, /if \(crown\) crown\.textContent =/);
});
