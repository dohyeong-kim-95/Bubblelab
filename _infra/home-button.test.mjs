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
// **빌드 산출물 검사는 이 파일에 모은다** — 테스트 파일은 병렬로 돌아서,
// 두 파일이 각자 빌드하면 같은 dist를 두고 경합한다.
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

// 토이가 소리 토글을 직접 배치하면 공용 UI에 덮인다 — 우드 스택은 공유 버튼에,
// 홈런은 시작 오버레이에 가려 눌리지 않았다. 전부 독으로 옮겼다.
for (const toy of ["woodstack", "dino", "homerun", "fruitmerge"]) {
  test(`${toy}의 소리 토글이 독에 등록돼 있다`, () => {
    const html = readFileSync(join(ROOT, `slop/${toy}/index.html`), "utf8");
    assert.match(html, /id:\s*"bl-mute"/, "독에 등록되지 않았다");
    assert.doesNotMatch(html, /<button[^>]*id="(mute|sound)"/, "옛 버튼 마크업이 남아 있다");
    assert.doesNotMatch(html, /#(mute|sound)\s*\{[^}]*position:\s*(fixed|absolute)/,
      "옛 고정 배치가 남아 있다");
  });
}

test("소리 토글을 쓰는 토이가 빠짐없이 독을 쓴다", () => {
  // 새 토이가 자기 버튼을 직접 배치하면 여기서 걸린다
  const missed = [];
  for (const toy of readdirSync(join(ROOT, "slop"), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name)) {
    const p = join(ROOT, "slop", toy, "index.html");
    if (!existsSync(p)) continue;
    const html = readFileSync(p, "utf8");
    if (/<button[^>]*id="(mute|sound)"/.test(html)) missed.push(toy);
  }
  assert.deepEqual(missed, [], `독을 쓰지 않고 직접 배치한 토이: ${missed.join(", ")}`);
});

// 비공개 카드는 목록에서 빠지되 주소로는 열려야 한다. 한쪽만 걸면 어중간해진다.
test("비공개 카드는 카테고리 홈에 없지만 페이지는 살아 있다", () => {
  for (const [site, names] of [["util", ["passport-pic"]], ["games", ["avalon", "liargame", "yacht"]]]) {
    const home = readFileSync(join(DIST, site, "index.html"), "utf8");
    for (const name of names) {
      assert.ok(!home.includes(`href="/${name}/"`), `${site} 홈에 ${name} 카드가 다시 나왔다`);
      assert.ok(existsSync(join(DIST, site, name, "index.html")),
        `${site}/${name} 페이지가 사라졌다 — 목록에서만 빼야 한다`);
    }
  }
});

test("비공개 카드는 검색에도 걸리지 않는다", () => {
  // 목록에서만 빼면 검색으로 발견된다 — noindex를 함께 건다.
  const page = readFileSync(join(DIST, "util/passport-pic/index.html"), "utf8");
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
});

// 비공개 서브도메인은 랜딩·풀다운·검색 어디에도 나오면 안 된다.
// (빌드가 랜딩 링크는 검사하지만 풀다운과 noindex는 검사하지 않는다)
test("비공개 서브도메인은 풀다운 메뉴에도 나오지 않는다", () => {
  const menuOf = (site) => readFileSync(join(DIST, site, "index.html"), "utf8");
  for (const site of ["slop", "util", "games"]) {
    const home = menuOf(site);
    for (const hidden of ["invest", "admin", "work", "estate", "duri", "podcast", "test"]) {
      assert.ok(!home.includes(`https://${hidden}.bubblelab.dev`),
        `${site} 홈 풀다운에 비공개 ${hidden}이 나온다`);
    }
  }
  // 페이지 자체는 살아 있어야 한다 (주소를 아는 사람은 들어간다)
  assert.ok(existsSync(join(DIST, "invest/index.html")));
});

// ── 배경화면 상세페이지 (/assets/wallpaper/<id>/) ────────────────────────

test("배경화면 항목마다 상세페이지가 생성된다", () => {
  const catalog = JSON.parse(readFileSync(join(DIST, "_assets", "catalog.json"), "utf8"));
  // 카탈로그에는 숨긴 항목도 들어 있다 (공개 여부는 워커가 요청 시점에 거른다).
  // 상세페이지는 공개 항목에만 필요하다 — 배경화면은 admin 토글 대상이 아니다.
  const wallpapers = catalog.items.filter((item) => item.category === "wallpaper" && item.active !== false);
  assert.ok(wallpapers.length, "카탈로그에 배경화면이 하나도 없다 — 이 검사가 무의미해진다");
  for (const item of wallpapers) {
    const page = join(DIST, "assets", "wallpaper", item.id, "index.html");
    assert.ok(existsSync(page), `${item.id}: 상세페이지가 없다`);
    const html = readFileSync(page, "utf8");
    assert.ok(html.includes('id="item-data"'), `${item.id}: 항목 데이터가 심어지지 않았다`);
    assert.ok(html.includes("item.js"), `${item.id}: item.js 연결이 없다`);
    // 데이터가 스크립트 블록을 끊지 않아야 한다
    const data = html.split('id="item-data">')[1].split("</script>")[0];
    assert.deepEqual(JSON.parse(data).id, item.id);
    assert.equal(data.includes("<"), false, `${item.id}: 심은 JSON에 이스케이프되지 않은 <`);
  }
  // 상세페이지가 쓰는 파일이 실제로 배포되는지
  for (const asset of [["assets", "item.js"], ["assets", "item.css"], ["_shared", "crop.js"]]) {
    assert.ok(existsSync(join(DIST, ...asset)), `${asset.join("/")}가 배포되지 않았다`);
  }
});

// ── 랜딩 검색 색인 (www/index.html 안에 심는다) ───────────────────────────

function landingIndex() {
  const html = readFileSync(join(DIST, "www", "index.html"), "utf8");
  const m = html.match(/<script type="application\/json" id="bl-cards">([\s\S]*?)<\/script>/);
  assert.ok(m, "랜딩에 검색 색인 자리가 없다");
  const raw = m[1];
  assert.equal(raw.includes("<"), false, "심은 JSON에 이스케이프되지 않은 <");
  return JSON.parse(raw);
}

test("랜딩 검색 색인이 공개 카드로 채워진다", () => {
  const cards = landingIndex();
  assert.ok(cards.length >= 40, `색인이 ${cards.length}개뿐이다 — 빌드 산출물을 의심하라`);
  assert.ok(cards.every((c) => c.site && c.name && c.label), "빈 항목이 있다");
  // 폴더 이름(영문)만으로는 한국어 검색이 안 된다 — 제목이 함께 들어가야 한다.
  const ladder = cards.find((c) => c.site === "util" && c.name === "ladder");
  assert.ok(ladder, "util/ladder가 색인에 없다");
  assert.equal(ladder.label, "사다리타기");
  assert.ok(ladder.title.includes("사다리타기"));
  // 카드 홈이 아닌 공개 서브도메인(mindfulness·idle)도 검색된다
  assert.ok(cards.some((c) => c.site === "mindfulness"), "mindfulness가 색인에 없다");
  assert.ok(existsSync(join(DIST, "_shared", "search-rules.js")), "규칙 엔진이 배포되지 않았다");
});

test("에이전트 문서(README·CLAUDE·AGENTS)는 배포되지 않는다", () => {
  // 서브도메인마다 두는 CLAUDE.md 에는 게이트·DO 바인딩·env 이름이 적혀 있다.
  // 걸러 내지 않으면 `<서브도메인>.bubblelab.dev/CLAUDE.md` 로 그대로 서빙된다.
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

  const leaked = walk(DIST)
    .filter((path) => /\/(README|CLAUDE|AGENTS)\.md$/.test(path))
    .map((path) => path.slice(DIST.length + 1));

  assert.deepEqual(leaked, [], `에이전트 문서가 배포에 섞였다: ${leaked.join(", ")}`);
});

test("비공개 서브도메인·감춘 카드는 검색 색인에도 없다", () => {
  const cards = landingIndex();
  // 카테고리 홈 카드에서 감춘 것과 같은 기준이어야 한다 — 검색이 뒷문이 되면 안 된다.
  for (const site of ["admin", "work", "podcast", "estate", "duri", "test", "invest", "www"]) {
    const leaked = cards.filter((c) => c.site === site).map((c) => c.name);
    assert.deepEqual(leaked, [], `${site}가 검색 색인에 샜다`);
  }
  for (const name of ["avalon", "liargame", "yacht", "passport-pic"]) {
    const leaked = cards.filter((c) => c.name === name).map((c) => `${c.site}/${c.name}`);
    assert.deepEqual(leaked, [], `${name}이 검색 색인에 샜다`);
  }
});
