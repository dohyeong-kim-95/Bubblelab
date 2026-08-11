// 핵심 화면 모바일 스모크. 단위 테스트가 못 잡는 세 가지만 본다:
//   ① 스크립트 예외로 화면이 통째로 비는가
//   ② 휴대폰 폭에서 가로로 넘치는가 (본문이 옆으로 밀리면 토이는 못 쓴다)
//   ③ 첫 화면에 눈에 보이는 내용이 있는가
// 기능·로직은 _infra/*.test.mjs 가 담당한다 — 여기서 늘리지 않는다.
import { test, expect } from "@playwright/test";

// 게이트 뒤(work·admin·duri·podcast·estate·invest)는 로그인이 필요해 스모크 대상이 아니다.
const SCREENS = [
  { name: "랜딩", path: "/" },
  { name: "slop 홈", path: "/slop/" },
  { name: "puzzle 홈", path: "/puzzle/" },
  { name: "util 홈", path: "/util/" },
  { name: "assets 홈", path: "/assets/" },
  // 카탈로그 카드(catalog.js/css)를 실제로 그리는 화면 — 항목이 있는 카테고리로 본다
  { name: "assets 배경화면", path: "/assets/wallpaper/" },
  // 상세페이지는 캔버스(내 기기에 맞게 저장·케이스 목업)까지 도는 화면이다
  { name: "assets 배경화면 상세", path: "/assets/wallpaper/stars-bootes/" },
  { name: "mindfulness 홈", path: "/mindfulness/" },
  { name: "idle 홈", path: "/idle/" },
  { name: "아침 브리핑", path: "/util/brief/" },
  { name: "달력", path: "/util/calendar/" },
  { name: "운세", path: "/util/fortune/" },
  { name: "별자리 배경화면", path: "/util/stars/" },
  // textarea 뒤에 거울을 깔아 밑줄을 그린다 — 두 층이 어긋나면 가로로 넘친다
  { name: "맞춤법 검사", path: "/util/proofread/" },
  // 카메라가 없는 환경(헤드리스)에서도 첫 화면이 떠야 한다 — 게임 로직은 단위 테스트가 본다
  { name: "발판 리듬", path: "/games/stepcam/" },
  // 스페인어 학습장은 화면을 전부 스크립트로 그린다 — 모듈이 하나만 깨지면 빈 화면이 된다
  { name: "스페인어 홈", path: "/espanol/" },
  { name: "스페인어 훈련", path: "/espanol/drill/" },
  { name: "스페인어 문법", path: "/espanol/grammar/" },
  // 리포트를 전부 스크립트로 그린다 — JSON을 못 읽으면 빈 화면이 된다
  { name: "클로드 인사이트", path: "/lab/claude-insights/" },
];

for (const screen of SCREENS) {
  test(`${screen.name} — 모바일에서 깨지지 않는다`, async ({ page }) => {
    const failures = [];
    page.on("pageerror", (error) => failures.push(`예외: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // 상류 API(_brief/rates 등)는 로컬 정적 서버에 없다 — 네트워크 404는 화면
      // 깨짐이 아니라 이 서버의 한계다. 스크립트 예외만 실패로 본다.
      if (/Failed to load resource|net::ERR_/.test(message.text())) return;
      failures.push(`콘솔: ${message.text()}`);
    });

    const response = await page.goto(screen.path);
    expect(response?.status(), `${screen.path} 가 200이 아니다`).toBe(200);
    await page.waitForLoadState("domcontentloaded");

    // ③ 첫 화면에 보이는 내용이 있어야 한다 (빈 흰 화면 방지)
    await expect(page.locator("body")).not.toBeEmpty();
    const visibleText = (await page.locator("body").innerText()).trim();
    expect(visibleText.length, "화면에 보이는 글자가 없다").toBeGreaterThan(0);

    // ② 가로 넘침 — 뷰포트보다 2px 넘게 넓으면 옆으로 밀린다
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "본문이 가로로 넘친다(모바일에서 옆으로 밀림)").toBeLessThanOrEqual(2);

    // ① 스크립트 예외 없음
    expect(failures, failures.join("\n")).toEqual([]);
  });
}

test("랜딩의 카테고리 링크가 모두 살아 있다", async ({ page }) => {
  await page.goto("/");
  const hrefs = await page.locator("a.card").evaluateAll((links) => links.map((a) => a.href));
  expect(hrefs.length, "랜딩에 카드가 없다").toBeGreaterThan(0);
  for (const href of hrefs) {
    // 카드가 가리키는 곳은 서브도메인이다 — 로컬에선 첫 경로 세그먼트로 바꿔 확인한다
    const subdomain = new URL(href).hostname.split(".")[0];
    const target = subdomain === "bubblelab" ? "/" : `/${subdomain}/`;
    const response = await page.request.get(target);
    expect(response.status(), `${href} → ${target} 가 열리지 않는다`).toBe(200);
  }
});
