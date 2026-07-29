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

test("홈 버튼 스크립트가 기존 공용 UI와 자리를 다투지 않는다", () => {
  const js = readFileSync(join(ROOT, "_shared/home.js"), "utf8");
  // 주간 기록 배지가 좌하단을 먼저 쓰므로 그 위로 쌓여야 한다
  assert.match(js, /body:has\(#bl-weekly\)\s*#bl-home\s*\{\s*bottom:/);
  // 공유 버튼(우하단)과 반대편에 있어야 한다
  assert.match(js, /#bl-home\s*\{[^}]*left:\s*1rem/);
  // 전면 탭 토이에 탭이 새지 않도록 막아야 한다
  assert.match(js, /stopPropagation/);
});
