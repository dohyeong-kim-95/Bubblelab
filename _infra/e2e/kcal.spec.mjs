import { expect, test } from "@playwright/test";

/* 끼니 칸은 지금 시각의 것만 펴져 있다(점심때면 점심). 다른 칸을 보려면 머리줄을 눌러 편다 —
 * 테스트가 몇 시에 돌든 같은 자리를 보게 하는 장치다. */
async function openMeal(page, name) {
  const head = page.locator(".meal").filter({ hasText: name }).locator(".meal-head").first();
  if (await head.getAttribute("aria-expanded") === "false") await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
}

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

  // 리포의 음식표에서 골라 담는다. 하나만 골랐으면 양을 정하러 갈 수 있다.
  await openMeal(page, "점심");
  await page.locator(".meal").filter({ hasText: "점심" }).locator(".meal-add").click();
  await page.locator("#search").fill("랩노쉬");
  await expect(page.locator(".result")).not.toHaveCount(0);
  await page.locator(".result-button").first().click();
  await page.locator("#picker-amount").click();
  await expect(page.locator("#editor-total")).toContainText("kcal");
  await page.locator("#editor-save").click();

  await expect(page.locator(".meal-item")).toHaveCount(1);
  await expect(page.locator("#left-kcal")).toHaveText("1,875");   // 2000 - 125
  await expect(page.locator("#macro-protein .macro-grams")).toHaveText("27g");

  // 없는 음식은 직접 적는다. 수량을 곱해 담긴다.
  await openMeal(page, "저녁");
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
  await openMeal(page, "아침");
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

  // 새로고침해도 남아 있다(칸은 다시 접히므로 저녁을 펴서 본다).
  await page.reload();
  await openMeal(page, "저녁");
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
  await openMeal(page, "아침");
  await page.locator(".meal").filter({ hasText: "아침" }).locator(".meal-add").click();
  await page.locator("#picker-new").click();
  await page.locator("#editor-name").fill("반 공기");
  await page.locator("#editor-kcal").fill("155.5");
  await page.locator("#editor-carb").fill("34.2");
  await page.locator("#editor-amount").fill("0.75");
  await page.locator("#editor-save").click();
  await expect(page.locator(".meal-item")).toHaveCount(1);
  await expect(page.locator(".meal-item .item-kcal")).toHaveText("117");   // 155.5 × 0.75 ("kcal" 은 CSS 로 붙인다)

  // 이름을 비우면 브라우저가 아니라 화면이 이유를 말한다.
  await page.locator(".meal").filter({ hasText: "아침" }).locator(".meal-add").click();
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

  await openMeal(page, "점심");
  await page.locator(".meal").filter({ hasText: "점심" }).locator(".meal-add").click();
  await expect(page.locator("#picker-cancel-top")).toBeVisible();
  // 위쪽 담기는 늘 같은 자리에 있고, 고르기 전에는 눌리지 않을 뿐이다.
  await expect(page.locator("#picker-save-top")).toBeDisabled();
  await page.locator("#search").fill("아메리카노");
  await page.locator(".result-button").first().click();
  await expect(page.locator("#picker-save-top")).toBeEnabled();
  await page.locator("#picker-new").click();
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

test("칼로리 — 아래로 당겨도 새로고침이 걸리지 않는다", async ({ page }) => {
  // 목록 맨 위에서 손가락을 조금 내리면 화면이 통째로 다시 뜨는 게 폰에서 성가시다.
  // 셸의 ../styles.css 하나로 도구 전부에 걸린다(life/CLAUDE.md).
  await page.goto("/life/kcal/");
  const overscroll = await page.evaluate(() => [
    getComputedStyle(document.documentElement).overscrollBehaviorY,
    getComputedStyle(document.body).overscrollBehaviorY,
  ]);
  expect(overscroll, "도구에서 body 를 다시 정의하며 이 속성을 지웠다").toEqual(["contain", "contain"]);
});

test("칼로리 — 운동을 담으면 그만큼 더 먹을 수 있다", async ({ page }) => {
  await page.goto("/life/kcal/");
  await page.evaluate(() => localStorage.removeItem("bl_kcal_v1"));
  await page.reload();

  // 몸무게가 소모 계산에 쓰인다 — 목표도 함께 직접 정해 숫자를 고정한다.
  await page.locator("#goal-button").click();
  await page.locator("#weight").fill("78");
  await page.locator("#manual").check();
  await page.locator("#goal-kcal").fill("2000");
  await page.locator("#goal-save").click();
  await expect(page.locator("#left-kcal")).toHaveText("2,000");

  // 걷기·사이클 각각 세 강도가 있고, 강도를 올리면 태우는 값이 커진다.
  await page.locator("#workouts .meal-add").click();
  await expect(page.locator("#exercise-list .result")).toHaveCount(6);
  await expect(page.locator("#exercise-list .item-name")).toContainText(
    [/걷기 · 가볍게/, /걷기 · 중간/, /걷기 · 열심히/, /사이클 · 가볍게/, /사이클 · 중간/, /사이클 · 열심히/]);
  const shown = async () => (await page.locator("#exercise-list .item-kcal").allTextContents()).map(Number);
  const [walkEasy, walkMid, walkHard, cycleEasy, cycleMid, cycleHard] = await shown();
  expect(walkEasy).toBeLessThan(walkMid);
  expect(walkMid).toBeLessThan(walkHard);
  expect(cycleEasy).toBeLessThan(cycleMid);
  expect(cycleMid).toBeLessThan(cycleHard);
  expect(walkMid, "같은 강도면 걷기가 사이클보다 덜 태운다").toBeLessThan(cycleMid);

  // 처음 서 있는 자리는 걷기 · 중간이다. 3.5 MET × 3.5 × 78kg ÷ 200 × 30분 = 143
  await expect(page.locator("#exercise-name")).toHaveValue("걷기 · 중간");
  await expect(page.locator("#exercise-kcal")).toHaveValue("143");

  // 8 MET × 3.5 × 78kg ÷ 200 × 30분 = 328
  await page.locator("#exercise-list .result-button").nth(4).click();
  await expect(page.locator("#exercise-kcal")).toHaveValue("328");
  await expect(page.locator("#exercise-name")).toHaveValue("사이클 · 중간");
  await page.locator("#exercise-minutes").fill("60");
  await expect(page.locator("#exercise-kcal")).toHaveValue("655");
  await page.locator("#exercise-minutes").fill("30");
  await page.locator("#exercise-save").click();

  await expect(page.locator("#workouts .meal-item")).toHaveCount(1);
  await expect(page.locator("#left-kcal")).toHaveText("2,328");   // 태운 만큼 여유가 는다
  await expect(page.locator("#eaten-line")).toContainText("328 태움");

  // 칼로리를 직접 고치면 시간이 바뀌어도 그 값을 지킨다.
  await page.locator("#workouts .meal-item-button").click();
  await page.locator("#exercise-kcal").fill("400");
  await page.locator("#exercise-minutes").fill("45");
  await expect(page.locator("#exercise-kcal")).toHaveValue("400");
  await page.locator("#exercise-save").click();
  await expect(page.locator("#left-kcal")).toHaveText("2,400");

  // 지우면 여유도 사라진다.
  await page.locator("#workouts .meal-item-button").click();
  await page.locator("#exercise-delete").click();
  await expect(page.locator("#workouts .meal-item")).toHaveCount(0);
  await expect(page.locator("#left-kcal")).toHaveText("2,000");
});

test("칼로리 — 여러 개를 골라 한 번에 담고, 끼니는 접었다 편다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto("/life/kcal/");
  await page.evaluate(() => localStorage.removeItem("bl_kcal_v1"));
  await page.reload();

  // 지금 시각의 끼니 하나만 펴져 있다 — 네 칸을 다 펴 두면 적을 자리를 찾아 내려가야 한다.
  await expect(page.locator(".meal-head[aria-expanded='true']")).toHaveCount(1);

  await page.locator("#goal-button").click();
  await page.locator("#manual").check();
  await page.locator("#goal-kcal").fill("2000");
  await page.locator("#goal-save").click();

  await openMeal(page, "점심");
  await page.locator(".meal").filter({ hasText: "점심" }).locator(".meal-add").click();

  /* 고른 개수가 0·1·2 로 바뀌어도 뼈대는 같아야 한다 — 버튼이 나타났다 사라지면
   * 누르려던 자리가 매번 달라져 정신없다("담기" 자리를 재어 견준다). */
  const box = async (id) => JSON.stringify(await page.locator(id).boundingBox());
  const frame = async () => [await box("#picker-save"), await box("#picker-amount"),
    await box("#picker-new"), await box("#picker-cancel"), await box("#picker-count")];
  const none = await frame();
  await expect(page.locator("#picker-save")).toBeDisabled();
  await expect(page.locator("#picker-amount")).toBeDisabled();

  // 눌러서 고르고, 다시 눌러 뺀다. 찾기를 다시 해도 고른 것은 풀리지 않는다.
  await page.locator("#search").fill("아메리카노");
  await page.locator(".result-button").first().click();
  await expect(page.locator("#picker-count")).toContainText("1개 고름");
  await expect(page.locator("#picker-save")).toBeEnabled();
  await expect(page.locator("#picker-amount")).toBeEnabled();   // 하나면 양을 정하러 갈 수 있다
  expect(await frame(), "하나 골랐다고 자리가 움직였다").toEqual(none);

  await page.locator("#search").fill("햄에그");
  await page.locator(".result-button").first().click();
  await expect(page.locator("#picker-count")).toContainText("2개 고름");
  await expect(page.locator("#picker-amount")).toBeDisabled();  // 여럿이면 양을 따로 정하지 않는다
  expect(await frame(), "여러 개 골랐다고 자리가 움직였다").toEqual(none);

  // 찾은 것이 몇 개든 목록 칸의 높이는 같다.
  await page.locator("#search").fill("없는음식이름");
  await expect(page.locator("#picker-empty")).toBeVisible();
  expect(await frame(), "결과가 없다고 버튼이 올라왔다").toEqual(none);
  await page.locator("#search").fill("");

  // 뺐다가 다시 넣어도 수가 맞는다.
  await page.locator("#search").fill("아메리카노");
  await page.locator(".result-button.picked").first().click();
  await expect(page.locator("#picker-count")).toContainText("1개 고름");
  await page.locator(".result-button").first().click();
  await expect(page.locator("#picker-count")).toContainText("2개 고름");

  await page.locator("#picker-save").click();
  await expect(page.locator("#picker")).toBeHidden();
  await expect(page.locator(".meal").filter({ hasText: "점심" }).locator(".meal-item")).toHaveCount(2);
  await expect(page.locator("#left-kcal")).toHaveText("1,666");   // 2000 − (324 + 10)

  // 접으면 줄은 사라지지만 몇 개·몇 kcal 인지는 머리줄에 남는다.
  const lunch = page.locator(".meal").filter({ hasText: "점심" });
  await lunch.locator(".meal-head").click();
  await expect(lunch.locator(".meal-item")).toHaveCount(0);
  await expect(lunch.locator(".meal-total")).toContainText("2개");
  await expect(lunch.locator(".meal-total")).toContainText("334 kcal");
  await expect(page.locator("#left-kcal")).toHaveText("1,666");   // 접어도 합계는 그대로다

  await lunch.locator(".meal-head").click();
  await expect(lunch.locator(".meal-item")).toHaveCount(2);

  expect(failures).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
