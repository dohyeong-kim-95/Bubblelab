import { expect, test } from "@playwright/test";

test("반도체 — 카드를 적고 복습에서 다시 떠올린다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/semi/");
  await page.evaluate(() => localStorage.removeItem("bl_semi_v1"));
  await page.reload();

  // 카드가 없어도 주제는 자리를 지키고, 그 자리에 답해야 할 질문이 보인다.
  await expect(page.locator(".topic")).toHaveCount(7);
  await expect(page.locator(".topic-hint").first()).toContainText("워드라인");

  await page.locator("#add-button").click();
  await page.locator("#topic-input").selectOption("sense");
  await page.locator("#title-input").fill("센스앰프는 왜 필요한가");
  await page.locator("#body-input").fill("셀 커패시터가 작아 비트라인 전압이 조금만 움직인다. 그 차이를 키워 0/1 로 만든다.");
  await page.getByRole("button", { name: "저장", exact: true }).first().click();
  await expect(page.locator(".card")).toHaveCount(1);

  // 출처는 http(s) 만 받는다 — 링크가 되므로 조용히 버리지 않고 이유를 적는다.
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("tRCD 는 무엇인가");
  await page.locator("#body-input").fill("ACT 뒤 읽기까지 기다려야 하는 시간.");
  await page.locator("#source-input").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "저장", exact: true }).first().click();
  await expect(page.locator("#editor-error")).toContainText("http");
  await page.locator("#source-input").fill("https://example.com/dram");
  await page.getByRole("button", { name: "저장", exact: true }).first().click();
  await expect(page.locator(".card")).toHaveCount(2);

  // 복습: 제목만 보이고, 확인을 눌러야 답이 드러난다.
  await page.locator("#tab-review").click();
  await expect(page.locator("#review-title")).toHaveText("센스앰프는 왜 필요한가");
  await expect(page.locator("#review-body")).toHaveClass(/veiled/);
  await expect(page.locator("#review-ok")).toBeDisabled();

  // 확인해도 채점 버튼 자리는 그대로다 — 답이 자리를 차지한 채 가려져 있어서다.
  const before = await page.locator("#review-ok").boundingBox();
  await page.locator("#review-show").click();
  await expect(page.locator("#review-body")).not.toHaveClass(/veiled/);
  expect(await page.locator("#review-ok").boundingBox()).toEqual(before);

  await page.locator("#review-ok").click();
  await expect(page.locator("#review-title")).toHaveText("tRCD 는 무엇인가");
  // "아직" 은 뒤로 돌아가는데, 남은 것이 이것뿐이면 곧바로 다시 나온다.
  await page.locator("#review-show").click();
  await page.locator("#review-again").click();
  await expect(page.locator("#review-title")).toHaveText("tRCD 는 무엇인가");
  await page.locator("#review-show").click();
  await page.locator("#review-ok").click();
  await expect(page.locator("#review-empty")).toContainText("지금 볼 카드가 없습니다");

  // 다시 열어도 남아 있다(localStorage).
  await page.reload();
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(page.locator("#count")).toHaveText("0/2");

  expect(failures).toEqual([]);
});
