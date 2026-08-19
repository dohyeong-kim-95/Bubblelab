import { expect, test } from "@playwright/test";

test("백업 — 내보낸 파일 하나로 전부 되돌아온다", async ({ page }) => {
  // 1) 여러 도구에 기록을 만든다.
  await page.goto("/life/");
  await page.locator("#add-text").fill("백업 확인용 할 일");
  await page.getByRole("button", { name: "추가" }).click();
  await expect(page.locator(".item")).toHaveCount(1);

  await page.goto("/life/library/");
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("백업된 책");
  await page.locator("#note-input").fill("이 줄이 돌아와야 한다.");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator(".book")).toHaveCount(1);

  await page.goto("/life/backup/");
  // 지워진 도구가 남긴 기록도 백업돼야 한다 — 코드가 없어졌다고 잃으면 안 된다.
  await page.evaluate(() => localStorage.setItem("bl_사라진도구", JSON.stringify({ 남은것: true })));
  await page.reload();
  await expect(page.locator("#current li")).toContainText([/library/, /life_v1/, /사라진도구/]);

  // 2) 내보낸다.
  const download = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-button").click(),
  ]).then(([event]) => event);
  expect(download.suggestedFilename()).toMatch(/^life-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();

  // 3) 전부 지운다.
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
  await expect(page.locator("#current-empty")).toBeVisible();

  // 4) 되돌린다.
  await page.locator("#import-input").setInputFiles(file);
  await expect(page.locator("#confirm")).toBeVisible();
  await expect(page.locator("#incoming li")).toContainText([/library/, /life_v1/, /사라진도구/]);
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#status")).toContainText("가져왔습니다");

  // 5) 각 도구에서 실제로 살아 있는지 본다.
  await page.goto("/life/");
  await expect(page.locator(".item .text")).toHaveText([/백업 확인용 할 일/]);

  await page.goto("/life/library/");
  await expect(page.locator(".book")).toHaveCount(1);
  await expect(page.locator(".book-title")).toHaveText("백업된 책");
  await expect(page.locator(".book-note")).toContainText("이 줄이 돌아와야 한다");

  await page.goto("/life/backup/");
  const orphan = await page.evaluate(() => localStorage.getItem("bl_사라진도구"));
  expect(JSON.parse(orphan)).toEqual({ 남은것: true });
});

test("백업 — 남의 파일은 거절하고 기존 기록을 건드리지 않는다", async ({ page }) => {
  await page.goto("/life/backup/");
  await page.evaluate(() => localStorage.setItem("bl_life_v1", JSON.stringify({ v: 1, lists: [] })));

  await page.locator("#import-input").setInputFiles({
    name: "other.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "somethingelse", data: 1 })),
  });
  await expect(page.locator("#status")).toContainText("LIFE 백업 파일이 아닙니다");
  await expect(page.locator("#confirm")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("bl_life_v1"))).not.toBeNull();
});
