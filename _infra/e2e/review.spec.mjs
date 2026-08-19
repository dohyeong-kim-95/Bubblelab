import { expect, test } from "@playwright/test";

test("돌아보기 — 도구들에 쌓인 것을 한 해로 모아 보여 준다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  // 할 일을 끝내면 기록이 남아야 한다.
  await page.goto("/life/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  for (const text of ["이력서 고치기", "운동하기"]) {
    await page.locator("#add-text").fill(text);
    await page.getByRole("button", { name: "추가" }).click();
  }
  await page.getByRole("button", { name: "이력서 고치기 완료" }).click();
  await page.getByRole("button", { name: "운동하기 완료" }).click();

  // 책 한 권과 운동 한 번.
  await page.goto("/life/library/");
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("돌아볼 책");
  await page.locator("#note-input").fill("남는 한 줄.");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".book")).toHaveCount(1);

  await page.goto("/life/pushup/");
  await page.locator(".day").first().click();
  for (let step = 1; step <= 4; step += 1) {
    await page.locator("#runner-next").click();   // 세트
    await page.locator("#runner-next").click();   // 스킵
  }
  await page.locator("#actual").fill("9");
  await page.locator("#runner-next").click();
  await expect(page.locator("#progress")).toHaveText("1/32");

  // 모아 보기.
  await page.goto("/life/review/");
  const year = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }).slice(0, 4);
  await expect(page.locator("#year")).toHaveValue(year);
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator(".block")).toHaveCount(3);
  await expect(page.locator(".headline").nth(0)).toContainText("2");
  await expect(page.locator(".headline").nth(0)).toContainText("끝냈습니다");
  await expect(page.locator(".headline").nth(1)).toContainText("1");
  await expect(page.locator(".headline").nth(1)).toContainText("읽었습니다");
  await expect(page.locator(".headline").nth(2)).toContainText("운동했습니다");
  await expect(page.locator(".note")).toContainText("최고 9개");
  await expect(page.locator(".months .month")).toHaveCount(12);

  // 되돌리면 끝냈다는 기록도 빠진다.
  await page.goto("/life/");
  await page.getByRole("button", { name: "이력서 고치기 완료 취소" }).click();
  await page.goto("/life/review/");
  await expect(page.locator(".headline").nth(0)).toContainText("1");

  // 기록이 없는 해는 비어 있다고 말한다.
  await page.selectOption("#year", { index: (await page.locator("#year option").count()) - 1 }).catch(() => {});
  expect(failures).toEqual([]);
});

test("돌아보기 — 아무것도 없으면 없다고 말한다", async ({ page }) => {
  await page.goto("/life/review/");
  await page.evaluate(async () => {
    localStorage.clear();
    for (const database of await indexedDB.databases()) {
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(database.name);
        request.onsuccess = request.onerror = request.onblocked = resolve;
      });
    }
  });
  await page.reload();
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator(".block")).toHaveCount(0);
});
