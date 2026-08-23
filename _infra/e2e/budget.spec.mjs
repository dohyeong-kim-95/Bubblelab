import { expect, test } from "@playwright/test";

// 오늘이 며칠이냐에 따라 기준선이 달라지므로, 화면이 실제로 계산해 낸 값과
// 견준다(숫자를 박아 두면 내일 깨진다). 계산 자체는 _infra/budget.test.mjs 가 본다.
test("가계부 — 한도와 남은 날에 견주어 지금 어디쯤인지 보여 준다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/budget/");
  await page.evaluate(() => localStorage.removeItem("bl_budget_v1"));
  await page.reload();

  await expect(page.getByRole("heading", { name: /가계부/ })).toBeVisible();
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#remaining")).toHaveText("1,000,000원");
  await expect(page.locator("#cycle-range")).toContainText("한도 100만원");
  await expect(page.locator("#verdict")).toContainText("하루");

  // 적으면 남은 돈과 오늘 쓴 돈이 함께 줄어든다.
  await page.locator("#amount").fill("12000");
  await page.locator("#memo").fill("국밥");
  await page.locator("#add-button").click();
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator(".entry")).toHaveCount(1);
  await expect(page.locator("#remaining")).toHaveText("988,000원");
  await expect(page.locator("#fact-spent")).toHaveText("12,000원");
  await expect(page.locator("#fact-today")).toHaveText("12,000원");
  await expect(page.locator("#amount")).toHaveValue("");

  // 금액이 없으면 적히지 않는다.
  await page.locator("#memo").fill("금액 없는 것");
  await page.locator("#add-button").click();
  await expect(page.locator(".entry")).toHaveCount(1);

  // 환불은 음수로 적고 합계에서 빠진다.
  await page.locator("#amount").fill("-2000");
  await page.locator("#memo").fill("부분 환불");
  await page.locator("#add-button").click();
  await expect(page.locator("#fact-spent")).toHaveText("10,000원");
  await expect(page.locator(".entry-amount.refund")).toHaveText("+2,000원");

  // 항목을 눌러 고친다.
  await page.locator(".entry").last().click();
  await page.locator("#editor-amount").fill("15000");
  await page.locator("#editor-memo").fill("국밥(곱빼기)");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#fact-spent")).toHaveText("13,000원");

  // 한도를 넘기면 화면이 초과로 바뀐다.
  await page.locator("#amount").fill("2000000");
  await page.locator("#memo").fill("사고");
  await page.locator("#add-button").click();
  await expect(page.locator("#hero-label")).toHaveText("한도 초과");
  await expect(page.locator("#gauge")).toHaveClass(/over/);
  await expect(page.locator("#verdict")).toContainText("넘겼어요");

  // 지난 주기에는 이번에 적은 것이 없다. 앞으로는 오늘이 든 주기까지만 간다.
  await expect(page.locator("#next-cycle")).toBeDisabled();
  await page.locator("#prev-cycle").click();
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#cycle-range")).toContainText("지난 주기");
  await page.locator("#next-cycle").click();
  await expect(page.locator(".entry")).toHaveCount(3);

  // 한도와 시작일을 바꿔도 적어 둔 것은 그대로다.
  await page.locator("#settings-button").click();
  await page.locator("#limit-input").fill("700000");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#cycle-range")).toContainText("한도 70만원");
  await expect(page.locator("#fact-spent")).toHaveText("2,013,000원");

  // 새로고침해도 남아 있다.
  await page.reload();
  await expect(page.locator(".entry")).toHaveCount(3);
  await expect(page.locator("#fact-spent")).toHaveText("2,013,000원");

  expect(failures).toEqual([]);
});
