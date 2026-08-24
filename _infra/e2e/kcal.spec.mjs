import { expect, test } from "@playwright/test";

test("칼로리 — 목표를 정하고 먹은 것을 담으면 남은 것이 줄어든다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/kcal/");
  await page.evaluate(() => localStorage.removeItem("bl_kcal_v1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "칼로리" })).toBeVisible();

  // 목표를 직접 정한다 — 몸 정보 기본값에 흔들리지 않게.
  await page.locator("#goal-button").click();
  await page.locator("#manual").check();
  await page.locator("#goal-kcal").fill("2000");
  await page.locator("#goal-carb").fill("250");
  await page.locator("#goal-protein").fill("100");
  await page.locator("#goal-fat").fill("67");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#left-kcal")).toHaveText("2,000");
  await expect(page.locator("#eaten-line")).toContainText("0 / 2,000 kcal");

  // 리포의 음식표에서 골라 담는다.
  await page.locator(".meal").filter({ hasText: "점심" }).locator(".meal-add").click();
  await page.locator("#search").fill("랩노쉬");
  await expect(page.locator(".result")).not.toHaveCount(0);
  await page.locator(".result-button").first().click();
  await expect(page.locator("#editor-total")).toContainText("kcal");
  await page.getByRole("button", { name: "담기", exact: true }).click();

  await expect(page.locator(".meal-item")).toHaveCount(1);
  await expect(page.locator("#left-kcal")).toHaveText("1,875");   // 2000 - 125
  await expect(page.locator("#macro-protein .macro-grams")).toHaveText("27g");

  // 없는 음식은 직접 적는다. 수량을 곱해 담긴다.
  await page.locator(".meal").filter({ hasText: "저녁" }).locator(".meal-add").click();
  await page.locator("#search").fill("집 김치찌개");
  await page.locator("#picker-new").click();
  await expect(page.locator("#editor-name")).toHaveValue("집 김치찌개");
  await page.locator("#editor-kcal").fill("240");
  await page.locator("#editor-carb").fill("12");
  await page.locator("#editor-protein").fill("18");
  await page.locator("#editor-fat").fill("13");
  await page.locator("#editor-amount").fill("2");
  await expect(page.locator("#editor-total")).toContainText("480 kcal");
  await page.getByRole("button", { name: "담기", exact: true }).click();
  await expect(page.locator("#left-kcal")).toHaveText("1,395");

  // 한 번 적은 것은 다음부터 목록에 남는다 — 즐겨찾기를 따로 만들지 않는다.
  await page.locator(".meal").filter({ hasText: "아침" }).locator(".meal-add").click();
  await expect(page.locator(".result")).toContainText([/집 김치찌개/]);
  await page.locator("#picker-cancel").click();

  // 눌러서 고치고 지운다.
  await page.locator(".meal-item-button").first().click();
  await page.locator("#editor-kcal").fill("200");
  await page.getByRole("button", { name: "담기", exact: true }).click();
  await expect(page.locator("#left-kcal")).toHaveText("1,320");
  await page.locator(".meal-item-button").first().click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page.locator(".meal-item")).toHaveCount(1);

  // 어제로 넘기면 오늘 담은 것이 없다. 내일로는 가지 않는다.
  await expect(page.locator("#next-day")).toBeDisabled();
  await page.locator("#prev-day").click();
  await expect(page.locator(".meal-item")).toHaveCount(0);
  await expect(page.locator("#left-kcal")).toHaveText("2,000");

  // 새로고침해도 남아 있다.
  await page.reload();
  await expect(page.locator(".meal-item")).toHaveCount(1);
  await expect(page.locator("#left-kcal")).toHaveText("1,520");   // 2000 - 480

  expect(failures).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
