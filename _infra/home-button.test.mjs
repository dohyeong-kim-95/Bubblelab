import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const SRC = "/_shared/home.js";

// 빌드는 dist를 통째로 지우고 다시 만드는 멱등 스크립트라 테스트에서 그냥 돌린다.
test.before(() => {
  execFileSync("node", [join(ROOT, "_infra/build.mjs")], { cwd: ROOT, stdio: "pipe" });
});

const has = (p) => existsSync(p) && readFileSync(p, "utf8").includes(SRC);
const dirsOf = (p) =>
  readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

// 자동 생성 홈을 가진 카테고리 = 카드 구조. 여기의 카드에만 홈 버튼이 붙는다.
const CARD_SITES = ["slop", "util", "games", "assets"];

test("카드 페이지마다 홈 버튼이 주입된다", () => {
  let checked = 0;
  for (const site of CARD_SITES) {
    const base = join(DIST, site);
    if (!existsSync(base)) continue;
    for (const card of dirsOf(base)) {
      const page = join(base, card, "index.html");
      if (!existsSync(page)) continue;
      assert.ok(has(page), `${site}/${card}에 홈 버튼이 없다`);
      checked++;
    }
  }
  assert.ok(checked >= 20, `카드를 ${checked}개만 확인했다 — 빌드 산출물을 의심하라`);
});

test("카테고리 홈 자신에는 주입되지 않는다 (갈 곳이 없다)", () => {
  for (const site of CARD_SITES) {
    const home = join(DIST, site, "index.html");
    if (!existsSync(home)) continue;
    assert.ok(!has(home), `${site} 홈에 자기 자신으로 가는 버튼이 붙었다`);
  }
});

test("카드 구조가 아닌 서비스·비공개 사이트에는 주입되지 않는다", () => {
  for (const site of ["podcast", "duri", "admin", "www", "work", "estate"]) {
    const base = join(DIST, site);
    if (!existsSync(base)) continue;
    assert.ok(!has(join(base, "index.html")), `${site} 홈에 홈 버튼이 붙었다`);
    for (const sub of dirsOf(base)) {
      const page = join(base, sub, "index.html");
      if (!existsSync(page)) continue;
      assert.ok(!has(page), `${site}/${sub}에 홈 버튼이 붙었다`);
    }
  }
});

test("중복 주입되지 않는다", () => {
  const page = readFileSync(join(DIST, "slop/woodstack/index.html"), "utf8");
  assert.equal(page.split(SRC).length - 1, 1);
});

test("유틸 버튼은 스스로 자리를 잡지 않고 독에 등록한다", () => {
  // 각자 position:fixed로 자리를 잡으면 서로 덮는다 — 실제로 woodstack의 음소거
  // 버튼이 공유 버튼에 완전히 가려 눌리지 않았다. 배치는 독이 전담한다.
  for (const f of ["_shared/home.js", "_shared/share.js"]) {
    const js = readFileSync(join(ROOT, f), "utf8");
    assert.match(js, /window\.blDock\s*=\s*window\.blDock\s*\|\|\s*\[\]/,
      `${f}가 로드 순서에 안전한 큐 방식으로 등록하지 않는다`);
    assert.doesNotMatch(js, /#bl-(home|share)\s*\{[^}]*position:\s*fixed/,
      `${f}가 아직 스스로 고정 배치한다`);
  }
});

test("독이 배치·접기·탭 차단을 전담한다", () => {
  const js = readFileSync(join(ROOT, "_shared/dock.js"), "utf8");
  // 우하단 알약 — 좌하단·하단 중앙은 주간 기록 배지가 폭·높이 모두 가변이라 못 쓴다
  assert.match(js, /#bl-dock\s*\{[^}]*position:\s*fixed[^}]*right:\s*1rem[^}]*bottom:\s*1rem/);
  assert.doesNotMatch(js, /#bl-dock\s*\{[^}]*left:\s*1rem/);
  // 버튼이 많아지면 접히고, 누르면 다시 펼쳐진다
  assert.match(js, /crowded/);
  assert.match(js, /collapsed/);
  // 화면 전체를 탭 영역으로 쓰는 토이에 탭이 새면 안 된다
  assert.match(js, /stopPropagation/);
  // 글자 없는 아이콘이므로 스크린리더용 이름이 필수
  assert.match(js, /aria-label/);
});

test("독 스크립트는 넓게 깔되, 등록이 없으면 그려지지 않는다", () => {
  const page = readFileSync(join(DIST, "slop/woodstack/index.html"), "utf8");
  assert.ok(page.includes("/_shared/dock.js"), "토이에 독이 없다");
  assert.ok(page.includes("/_shared/home.js"), "토이에 홈 버튼이 없다");
  // 카테고리 홈은 홈 버튼도 공유 버튼도 없어 등록이 0건이다. 스크립트는 깔리되
  // 독은 나타나지 않아야 한다 — 빈 알약이 떠 있으면 곤란하다.
  const home = readFileSync(join(DIST, "slop/index.html"), "utf8");
  assert.ok(home.includes("/_shared/dock.js"), "카테고리 홈에 독 스크립트가 없다");
  assert.ok(!home.includes("/_shared/home.js"), "카테고리 홈에 홈 버튼이 붙었다");
  const dock = readFileSync(join(ROOT, "_shared/dock.js"), "utf8");
  assert.match(dock, /if \(!dock\.isConnected && items\.length\)/,
    "등록이 없어도 독을 붙이는 코드로 바뀌었다");
});

test("독은 아래를 축으로 위로 자란다", () => {
  const js = readFileSync(join(ROOT, "_shared/dock.js"), "utf8");
  // bottom 고정 + 세로 배치 = 버튼이 늘면 위로 자란다 (가로로 늘면 좌하단
  // 주간 기록 배지 쪽으로 번진다)
  assert.match(js, /#bl-dock\s*\{[^}]*bottom:\s*1rem/);
  assert.match(js, /flex-direction:\s*column/);
  // order가 작을수록 아래(토글 쪽) — DOM은 위→아래라 내림차순으로 넣어야 한다
  assert.match(js, /sort\(\(a, b\) => \(b\.order \?\? 50\) - \(a\.order \?\? 50\)\)/);
});

test("woodstack 음소거가 독으로 옮겨져 공유 버튼에 덮이지 않는다", () => {
  const toy = readFileSync(join(ROOT, "slop/woodstack/index.html"), "utf8");
  assert.match(toy, /id:\s*"bl-mute"/, "음소거가 독에 등록되지 않았다");
  assert.doesNotMatch(toy, /#mute\s*\{[^}]*position:\s*fixed/, "옛 고정 배치가 남아 있다");
  assert.doesNotMatch(toy, /<button id="mute"/, "옛 버튼 마크업이 남아 있다");
});
