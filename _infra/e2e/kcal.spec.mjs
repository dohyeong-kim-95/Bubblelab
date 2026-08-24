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
  await page.locator("#goal-save").click();
  await expect(page.locator("#left-kcal")).toHaveText("2,000");
  await expect(page.locator("#eaten-line")).toContainText("0 / 2,000 kcal");

  // 리포의 음식표에서 골라 담는다.
  await page.locator(".meal").filter({ hasText: "점심" }).locator(".meal-add").click();
  await page.locator("#search").fill("랩노쉬");
  await expect(page.locator(".result")).not.toHaveCount(0);
  await page.locator(".result-button").first().click();
  await expect(page.locator("#editor-total")).toContainText("kcal");
  await page.locator("#editor-save").click();

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
  await page.locator("#editor-save").click();
  await expect(page.locator("#left-kcal")).toHaveText("1,395");

  // 한 번 적은 것은 다음부터 목록에 남는다 — 즐겨찾기를 따로 만들지 않는다.
  await page.locator(".meal").filter({ hasText: "아침" }).locator(".meal-add").click();
  await expect(page.locator(".result")).toContainText([/집 김치찌개/]);
  await page.locator("#picker-cancel").click();

  // 눌러서 고치고 지운다.
  await page.locator(".meal-item-button").first().click();
  await page.locator("#editor-kcal").fill("200");
  await page.locator("#editor-save").click();
  await expect(page.locator("#left-kcal")).toHaveText("1,320");
  await page.locator(".meal-item-button").first().click();
  await page.locator("#editor-delete").click();
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

test("칼로리 — 소수를 넣어도 저장이 막히지 않는다", async ({ page }) => {
  /* 실기기에서 "몸 정보와 목표를 고쳐도 저장이 안 된다" 는 제보. 원인은 number 입력의
   * step 이었다 — 78.5kg 을 넣으면 브라우저 검증이 submit 을 조용히 막고, 그 툴팁은
   * 폰에서 시트에 가려 보이지 않는다. 검증은 store 가 하고 이유는 화면에 적는다. */
  await page.goto("/life/kcal/");
  await page.evaluate(() => localStorage.removeItem("bl_kcal_v1"));
  await page.reload();

  await page.locator("#goal-button").click();
  await page.locator("#weight").fill("78.5");
  await page.locator("#height").fill("176.5");
  await page.locator("#goal-save").click();
  await expect(page.locator("#goal")).toBeHidden();
  const profile = await page.evaluate(() => JSON.parse(localStorage.getItem("bl_kcal_v1")).profile);
  expect(profile.weight, "몸무게가 저장되지 않았다").toBe(79);   // store 가 반올림해 담는다
  expect(profile.height).toBe(177);

  // 담기 쪽도 같은 함정이 있었다.
  await page.locator(".meal").first().locator(".meal-add").click();
  await page.locator("#picker-new").click();
  await page.locator("#editor-name").fill("반 공기");
  await page.locator("#editor-kcal").fill("155.5");
  await page.locator("#editor-carb").fill("34.2");
  await page.locator("#editor-amount").fill("0.75");
  await page.locator("#editor-save").click();
  await expect(page.locator(".meal-item")).toHaveCount(1);
  await expect(page.locator(".meal-item .item-kcal")).toHaveText("117");   // 155.5 × 0.75 ("kcal" 은 CSS 로 붙인다)

  // 이름을 비우면 브라우저가 아니라 화면이 이유를 말한다.
  await page.locator(".meal").first().locator(".meal-add").click();
  await page.locator("#picker-new").click();
  await page.locator("#editor-name").fill(" ");
  await page.locator("#editor-kcal").fill("100");
  await page.locator("#editor-save").click();
  await expect(page.locator("#editor-error")).toContainText("무엇을 먹었는지");
  await expect(page.locator("#editor")).toBeVisible();
});

test("칼로리 — 취소·담기가 팝업 위쪽에도 있다", async ({ page }) => {
  // 키보드가 올라오면 아래쪽 버튼이 가려져 키보드를 내렸다가 눌러야 했다.
  await page.goto("/life/kcal/");
  await page.evaluate(() => localStorage.removeItem("bl_kcal_v1"));
  await page.reload();

  await page.locator(".meal").filter({ hasText: "점심" }).locator(".meal-add").click();
  await expect(page.locator("#picker-cancel-top")).toBeVisible();
  await page.locator("#picker-new-top").click();
  await page.locator("#editor-name").fill("위쪽 버튼으로 담기");
  await page.locator("#editor-kcal").fill("120");
  await page.locator("#editor-save-top").click();
  await expect(page.locator(".meal-item")).toHaveCount(1);

  await page.locator(".meal-item-button").first().click();
  await page.locator("#editor-cancel-top").click();
  await expect(page.locator("#editor")).toBeHidden();

  await page.locator("#goal-button").click();
  await page.locator("#weight").fill("81");
  await page.locator("#goal-save-top").click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("bl_kcal_v1")).profile.weight)).toBe(81);
});
