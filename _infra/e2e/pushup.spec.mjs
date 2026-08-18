import { expect, test } from "@playwright/test";

test("팔굽혀펴기 — 회차를 수행하고, 다시 재면 계획이 새로 잡힌다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/pushup/");
  await page.evaluate(() => localStorage.removeItem("bl_pushup_v1"));
  await page.reload();

  // 최대 5개 기준 초기 계획. 1일차는 리서치한 표와 같다.
  await expect(page.locator("#summary")).toContainText("현재 최대 5개");
  await expect(page.locator("#progress")).toHaveText("0/32");
  await expect(page.locator(".day").first().locator(".day-sets")).toHaveText("2 · 3 · 2 · 2 · 3+");
  await expect(page.locator(".day").first()).toHaveClass(/next/);

  // 1일차 수행 — 세트 5개, 사이에 휴식.
  await page.locator(".day").first().click();
  await expect(page.locator("#runner-step")).toHaveText("세트 1 / 5");
  await expect(page.locator("#runner-reps")).toHaveText("2");
  await page.locator("#runner-next").click();
  await expect(page.locator("#runner-step")).toHaveText("쉬는 중");
  await expect(page.locator("#runner-rest")).toContainText("초");
  await page.locator("#runner-next").click();          // 휴식 건너뛰기
  await expect(page.locator("#runner-step")).toHaveText("세트 2 / 5");
  await expect(page.locator("#runner-reps")).toHaveText("3");

  for (let step = 2; step <= 4; step += 1) {
    await page.locator("#runner-next").click();        // 세트 완료
    await page.locator("#runner-next").click();        // 휴식 건너뛰기
  }
  await expect(page.locator("#runner-step")).toContainText("최대한");
  await expect(page.locator("#runner-reps")).toHaveText("3+");
  await expect(page.locator("#actual")).toHaveValue("3");
  await page.locator("#actual").fill("6");
  await page.locator("#runner-next").click();

  await expect(page.locator("#progress")).toHaveText("1/32");
  await expect(page.locator(".day").first()).toHaveClass(/done/);
  await expect(page.locator(".day").nth(1)).toHaveClass(/next/);
  await expect(page.locator("#summary")).toContainText("최고 기록 6개");

  // 새로고침해도 남아 있다.
  await page.reload();
  await expect(page.locator("#progress")).toHaveText("1/32");

  // 다시 재면 계획이 그 값에 맞게 새로 잡힌다.
  await page.locator("#retest-button").click();
  // 0 은 브라우저가 먼저 막는다(min="1") — 계획이 바뀌지 않아야 한다.
  await page.locator("#retest-max").fill("0");
  await page.getByRole("button", { name: "계획 다시 짜기" }).click();
  await expect(page.locator("#retest")).toBeVisible();
  await expect(page.locator("#progress")).toHaveText("1/32");
  await page.locator("#retest-max").fill("20");
  await page.getByRole("button", { name: "계획 다시 짜기" }).click();
  await expect(page.locator("#summary")).toContainText("현재 최대 20개");
  await expect(page.locator("#progress")).toHaveText("0/20");
  await expect(page.locator("#summary")).toContainText("최고 기록", { timeout: 2000 });

  // 마지막 회차는 반드시 100개다.
  await expect(page.locator(".day").last().locator(".day-sets")).toContainText("100+");

  await page.getByRole("link", { name: "LIFE 로 돌아가기" }).click();
  await expect(page.locator("#list-name")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(failures).toEqual([]);
});
