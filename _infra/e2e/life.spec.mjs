import { expect, test } from "@playwright/test";

test("Life PWA는 모바일에서 초기화하고 할 일을 적고 오프라인으로 다시 연다", async ({ page, context }) => {
  const failures = [];
  let bootstrap = { protocol: 1, initialized: false, head: 0, oldestSeq: 1, sinkAckSeq: 0 };
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text()); });

  await page.route("**/_life/bootstrap", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      bootstrap = { ...bootstrap, initialized: true, salt: body.salt, sentinel: body.sentinel };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ created: true, protocol: 1 }) });
    } else await route.fulfill({ contentType: "application/json", body: JSON.stringify(bootstrap) });
  });
  await page.route("**/_life/changes**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ changes: [], cursor: 0, head: 0, hasMore: false }) }));
  await page.route("**/_life/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ head: 0, sinkAckSeq: 0, sinkLastSeen: null }) }));
  await page.route("**/_life/commit", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ head: 1, revisions: [] }) }));

  await page.goto("/life/?view=today");
  await expect(page.getByRole("heading", { name: "할 일 기록 시작하기" })).toBeVisible();
  await page.locator("#passphrase").fill("correct horse battery staple");
  await page.locator("#passphrase-confirm").fill("correct horse battery staple");
  await page.getByRole("button", { name: "열기" }).click();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible();
  await expect(page.getByText("오늘 할 일이 아직 없습니다.")).toBeVisible();

  await page.locator("#quick-title").fill("20분 달리기");
  await page.getByRole("button", { name: "할 일 추가" }).click();
  await expect(page.getByText("20분 달리기")).toBeVisible();
  await expect(page.locator("#today-count")).toHaveText("0/1");
  await page.getByRole("button", { name: "20분 달리기 완료" }).click();
  await expect(page.locator("#today-count")).toHaveText("1/1");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(failures).toEqual([]);

  // 셸 precache 가 끝난 뒤에 끊어야 오프라인 재진입을 실제로 검사한다.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "오늘", exact: true })).toBeVisible({ timeout: 3000 });
  await expect(page.getByText("20분 달리기")).toBeVisible();
});
