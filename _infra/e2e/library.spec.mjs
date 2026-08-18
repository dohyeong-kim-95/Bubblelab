import { expect, test } from "@playwright/test";

test("서재 — 표지와 한두 줄로 읽은 책을 남긴다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/library/");
  await expect(page.getByRole("heading", { name: /서재/ })).toBeVisible();
  await expect(page.locator("#empty")).toBeVisible();

  // 표지 없이도 남길 수 있다.
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("죽음의 수용소에서");
  await page.locator("#note-input").fill("의미를 붙들면 견딜 수 있다는 이야기.");
  await page.locator("#date-input").fill("2026-08-19");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".book")).toHaveCount(1);
  await expect(page.locator("#count")).toHaveText("1권");
  await expect(page.locator(".year")).toHaveText("2026 · 1권");

  // 한두 줄이 없으면 기록으로 치지 않는다.
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("제목만 있는 책");
  await page.locator("#note-input").fill(" ");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#editor-error")).toContainText("한두 줄");
  await page.locator("#editor-cancel").click();

  // 표지를 붙이면 줄여서 담는다.
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("사피엔스");
  await page.locator("#note-input").fill("우리가 믿는 이야기가 우리를 묶는다.");
  await page.locator("#date-input").fill("2025-11-02");
  await page.locator("#cover-input").setInputFiles({
    name: "cover.png", mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"),
  });
  await expect(page.locator("#cover-preview")).toBeVisible();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".book")).toHaveCount(2);
  await expect(page.locator(".book img")).toHaveCount(1);
  await expect(page.locator(".year")).toHaveText(["2026 · 1권", "2025 · 1권"]);

  // 새로고침해도 남아 있다 (IndexedDB).
  await page.reload();
  await expect(page.locator(".book")).toHaveCount(2);
  await expect(page.locator(".book img")).toHaveCount(1);

  // 고치고 지운다.
  await page.locator(".book").first().click();
  await expect(page.locator("#editor-title")).toHaveText("책 고치기");
  await page.locator("#editor-delete").click();
  await expect(page.locator(".book")).toHaveCount(1);

  // LIFE 로 돌아간다.
  await page.getByRole("link", { name: "LIFE 로 돌아가기" }).click();
  await expect(page.locator("#list-name")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(failures).toEqual([]);
});
