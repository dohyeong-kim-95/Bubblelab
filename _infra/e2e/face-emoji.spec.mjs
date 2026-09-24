import { expect, test } from "@playwright/test";

const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("얼굴 캐릭터 — 모델을 받은 뒤 사진을 전송하지 않고 실패를 안내한다", async ({ page, context }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request));

  await page.goto("/util/face-emoji/");
  await expect(page.locator("#engineStatus")).toContainText("준비 완료", { timeout: 45_000 });
  await expect(page.locator("#choosePhoto")).toBeEnabled();

  const beforePhoto = requests.length;
  await context.setOffline(true);
  await page.setInputFiles("#photoInput", {
    name: "blank.png",
    mimeType: "image/png",
    buffer: BLANK_PNG,
  });
  await expect(page.locator("#error")).toContainText("얼굴", { timeout: 15_000 });

  const afterPhoto = requests.slice(beforePhoto);
  expect(afterPhoto.filter((request) => request.method() === "POST")).toEqual([]);
  expect(afterPhoto.some((request) => request.url().startsWith("http"))).toBe(false);
  expect(await page.evaluate(() => ({
    localStorage: localStorage.length,
    indexedDB: typeof indexedDB === "undefined" ? -1 : indexedDB.databases
      ? undefined
      : null,
  }))).toMatchObject({ localStorage: 0 });
});

