import { test, expect } from "@playwright/test";

// 스티커/이모지 서랍은 높이를 **측정된 키보드 높이(--kb)** 로 맞춘다. 그 값이 잘못
// 굳으면 서랍이 찌그러져 스티커가 한 줄만 보인다 — 실기기에서 그렇게 나왔다.
const enter = async (page) => {
  await page.goto("/duri/");
  await page.waitForFunction(() => typeof window.renderFit === "function");
  await page.locator("#pass").fill("우리만아는긴문장");
  await page.locator("#name").fill("빵");
  await page.locator("#enter").click();
  await expect(page.locator("#bar")).toBeVisible();
};
const pickerHeight = (page) =>
  page.locator("#picker").evaluate((el) => el.getBoundingClientRect().height);

test("서랍은 팩을 고르면 16장을 다 담고 스크롤된다", async ({ page }) => {
  await enter(page);
  await page.locator("#sticker-btn").click();
  await page.locator("#tabs button", { hasText: "후드커플" }).click();
  await expect(page.locator("#grid button")).toHaveCount(16);
  const grid = await page.locator("#grid").evaluate((el) => ({
    client: el.clientHeight, scroll: el.scrollHeight,
  }));
  expect(grid.client, "그리드가 눌려 한 줄도 못 보여준다").toBeGreaterThan(120);
  expect(grid.scroll, "16장이 들어갈 높이가 아니다").toBeGreaterThan(grid.client);
});

test("굳어 버린 작은 키보드 높이는 버리고 기본값으로 연다", async ({ page }) => {
  await enter(page);
  const normal = await (async () => {
    await page.locator("#sticker-btn").click();
    return pickerHeight(page);
  })();

  // 키보드 애니메이션 중간 프레임(150px 미만)이 저장된 상태를 만든다
  await page.evaluate(() => localStorage.setItem("duri:kbHeight", "138"));
  await page.reload();
  await expect(page.locator("#bar")).toBeVisible();
  await page.locator("#sticker-btn").click();
  expect(await pickerHeight(page),
    "터무니없이 작은 저장값을 그대로 써서 서랍이 찌그러졌다").toBe(normal);

  // 제대로 재진 값(화면의 4분의 1 이상)은 그대로 쓴다
  const tall = await page.evaluate(() => {
    const v = Math.round(window.innerHeight * 0.42);
    localStorage.setItem("duri:kbHeight", String(v));
    return v;
  });
  await page.reload();
  await expect(page.locator("#bar")).toBeVisible();
  await page.locator("#sticker-btn").click();
  expect(await pickerHeight(page)).toBeCloseTo(tall, 0);
});
