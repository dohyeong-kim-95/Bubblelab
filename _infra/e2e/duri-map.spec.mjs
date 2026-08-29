import { test, expect } from "@playwright/test";

const PINS = [
  // 한국편에서 색칠돼야 하는 것 + 해안(근접 판정 대상)
  { seq: 1, lat: 37.5665, lng: 126.9780, owner: "나", photo: true },   // 서울 중구
  { seq: 2, lat: 37.5172, lng: 127.0473, owner: "나", photo: true },   // 강남구
  { seq: 3, lat: 35.1587, lng: 129.1604, owner: "너", photo: true },   // 해운대
  { seq: 4, lat: 33.5104, lng: 126.4914, owner: "너", photo: false },  // 제주
  // 해외 — 한국편에선 "해외", 세계편에선 색칠
  { seq: 5, lat: 35.6812, lng: 139.7671, owner: "나", photo: true },   // 도쿄
  { seq: 6, lat: 1.2834, lng: 103.8607, owner: "너", photo: true },    // 싱가포르(매립지)
  { seq: 7, lat: 48.8584, lng: 2.2945, owner: "나", photo: true },     // 파리
  { seq: 8, lat: 40.7580, lng: -73.9855, owner: "너", photo: true },   // 뉴욕(섬)
  { seq: 9, lat: 0, lng: -150, owner: "나", photo: true },             // 태평양 한복판 → 어디에도 안 붙음
];

test("duri 지도 — 한국편/세계편이 모두 그려지고 토글된다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("예외: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push("콘솔: " + m.text());
  });

  await page.goto("/duri/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => typeof window.renderMap === "function");

  // 핀은 calEvents(스크립트 스코프)에서 나온다 — 전역 함수 loadPins 를 갈아 끼워
  // 지도 그리기만 떼어 본다. 클래식 스크립트라 내부 호출도 이 전역을 탄다.
  await page.evaluate((pins) => { window.loadPins = () => pins; }, PINS);

  const shot = async () => {
    await page.evaluate(() => window.openMap?.());
    await page.waitForFunction(() => document.getElementById("map-paths").children.length > 0, null, { timeout: 15000 });
    return page.evaluate(() => ({
      paths: document.getElementById("map-paths").children.length,
      painted: [...document.getElementById("map-paths").children]
        .filter((p) => p.getAttribute("fill") !== "var(--panel)")
        .map((p) => p.querySelector("title")?.textContent),
      dots: document.getElementById("map-dots").querySelectorAll("circle").length,
      viewBox: document.getElementById("map-svg").getAttribute("viewBox"),
      count: document.getElementById("map-count").textContent,
      summary: document.getElementById("map-summary").innerText.replace(/\s+/g, " ").trim(),
      toggle: document.getElementById("map-mode").textContent,
      toggleTitle: document.getElementById("map-mode").title,
    }));
  };

  const kr = await shot();
  console.log("한국편:", JSON.stringify(kr, null, 1));
  expect(kr.paths).toBe(256);
  expect(kr.viewBox).toBe("0 0 1000 1200");
  expect(kr.painted.length).toBe(4);           // 중구·강남구·해운대구·제주시
  expect(kr.count).toBe("4개 지역");
  expect(kr.summary).toContain("🌏 5");        // 해외 5(도쿄·싱가포르·파리·뉴욕·태평양)
  expect(kr.summary).toContain("색칠된 지역을 탭하면");
  expect(kr.toggle).toBe("🌏");

  await page.evaluate(() => window.setMapMode("world"));
  await page.waitForFunction(() => document.getElementById("map-svg").getAttribute("viewBox") === "0 0 1000 428", null, { timeout: 20000 });
  const world = await page.evaluate(() => ({
    paths: document.getElementById("map-paths").children.length,
    painted: [...document.getElementById("map-paths").children]
      .filter((p) => p.getAttribute("fill") !== "var(--panel)")
      .map((p) => p.querySelector("title")?.textContent).sort(),
    dots: document.getElementById("map-dots").querySelectorAll("circle").length,
    viewBox: document.getElementById("map-svg").getAttribute("viewBox"),
    count: document.getElementById("map-count").textContent,
    summary: document.getElementById("map-summary").innerText.replace(/\s+/g, " ").trim(),
    toggle: document.getElementById("map-mode").textContent,
    toggleTitle: document.getElementById("map-mode").title,
  }));
  console.log("세계편:", JSON.stringify(world, null, 1));
  expect(world.paths).toBe(233);
  expect(world.painted.map((t) => t.split(" · ")[0])).toEqual(
    ["대한민국", "미국", "싱가포르", "일본", "프랑스"]);
  expect(world.painted.find((t) => t.startsWith("대한민국"))).toBe("대한민국 · 4개");
  expect(world.count).toBe("5개 나라");
  expect(world.summary).toContain("🌏 5");   // 다녀온 나라 5
  expect(world.summary).toContain("❓ 1");   // 태평양 한복판
  expect(world.summary).toContain("색칠된 나라를 탭하면"); // 조사가 "나라을" 로 깨지지 않는다
  expect(world.toggle).toBe("🇰🇷");
  expect(world.dots).toBe(5);

  // 나라를 탭하면 그 나라 앨범이 열린다
  await page.evaluate(() => {
    const p = [...document.getElementById("map-paths").children]
      .find((el) => el.querySelector("title")?.textContent.startsWith("싱가포르"));
    p.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(page.locator("#region-name")).toHaveText("싱가포르");
  await expect(page.locator("#region-box")).toBeVisible();

  // 다시 한국편으로
  await page.evaluate(() => window.setMapMode("kr"));
  await page.waitForFunction(() => document.getElementById("map-svg").getAttribute("viewBox") === "0 0 1000 1200");
  expect(await page.locator("#map-count").textContent()).toBe("4개 지역");
  await expect(page.locator("#region-box")).toBeHidden(); // 모드 바꾸면 앨범은 닫힌다

  // 마지막으로 본 편이 기억된다 — 다음에 열 때 그 지도로 열린다
  expect(await page.evaluate(() => localStorage.getItem("duri:mapMode"))).toBe("kr");

  expect(errors).toEqual([]);
});
