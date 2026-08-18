import { expect, test } from "@playwright/test";

test("할 일 PWA — 목록을 옆으로 넘기고, 적은 내용이 오프라인에서도 남는다", async ({ page, context }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/");
  await expect(page.getByRole("heading", { name: "할 일" })).toBeVisible();

  await page.locator("#add-text").fill("우유 사기");
  await page.getByRole("button", { name: "추가" }).click();
  await expect(page.getByText("우유 사기")).toBeVisible();
  await expect(page.locator("#list-count")).toHaveText("0/1");
  await page.getByRole("button", { name: "우유 사기 완료" }).click();
  await expect(page.locator("#list-count")).toHaveText("1/1");

  // 두 번째 목록을 만들면 점이 생기고 그쪽으로 넘어간다.
  await page.locator("#menu-button").click();
  await page.getByRole("button", { name: "새 목록" }).click();
  await page.locator("#prompt-text").fill("장보기");
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByRole("heading", { name: "장보기" })).toBeVisible();
  await expect(page.locator("#dots .dot")).toHaveCount(2);

  // 가로 스크롤(스와이프)로 넘겨도 헤더와 점이 따라온다.
  await page.evaluate(() => {
    const track = document.getElementById("track");
    track.scrollTo({ left: 0, behavior: "auto" });
    track.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByRole("heading", { name: "할 일" })).toBeVisible();
  await expect(page.locator("#dots .dot").first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#list-count")).toHaveText("1/1");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(failures).toEqual([]);

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("우유 사기")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#dots .dot")).toHaveCount(2);
});

test("PWA 로 설치되면 주소창 없이 뜬다", async ({ page }) => {
  await page.goto("/life/");
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    return (await fetch(href)).json();
  });
  assertStandalone(manifest);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", /#/);
  const registered = await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  expect(registered).toBe(true);
});

function assertStandalone(manifest) {
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBeTruthy();
  // 안드로이드 크롬이 설치 대상으로 인정하려면 192·512 아이콘이 필요하다.
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(manifest.icons.some((icon) => icon.purpose?.includes("maskable"))).toBe(true);
}
