import { expect, test } from "@playwright/test";

const LYRICS = "[Coro]\nEl amor no me deja dormir\nTe quiero más que ayer\nEl amor no me deja dormir";

test("노래 스페인어 — 가사를 넣고, 소리로 익히고, 진도가 남는다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/espanol/");
  await expect(page.locator("#empty")).toBeVisible();

  // 곡 하나를 넣는다. 안내 줄([Coro])은 가사가 아니라 빠진다.
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("잠 못 드는 밤");
  await page.locator("#artist-input").fill("아무개");
  await page.locator("#lyrics-input").fill(LYRICS);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#heading")).toHaveText("잠 못 드는 밤");
  await expect(page.locator(".line")).toHaveCount(3);

  // 소리가 박 단위로 붙고, 연음이 실제로 이어진다 (el amor → 에라모르).
  const firstLine = page.locator(".line").first();
  await expect(firstLine.locator(".beat").first()).toHaveText("에");
  await expect(firstLine.locator(".beat.on")).toHaveCount(4);      // 줄에 강세가 네 번
  await expect(firstLine.locator(".sound")).toContainText("라모르");
  // 가사만 봐서는 안 보이는 자리 — el 의 l 이 amor 로 넘어간다.
  await expect(firstLine.locator(".tie")).toHaveCount(1);

  // 줄을 누르면 아는 낱말의 뜻이 이미 달려 있다. 내가 적는 뜻은 그 위에 얹는다.
  await page.locator(".line-body").nth(1).click();
  await expect(page.locator("#gloss-known li").first()).toContainText("te quiero");
  await page.locator("#gloss-input").fill("어제보다 더 사랑해");
  await page.locator("#gloss-form").getByRole("button", { name: "저장" }).click();
  await expect(page.locator(".line").nth(1).locator(".ko")).toHaveText("어제보다 더 사랑해");

  // 연습 — 후렴이 두 번 나와도 카드는 두 장이다.
  await expect(page.locator("#song-progress")).toContainText("2줄");
  await page.locator("#start-practice").click();
  await expect(page.locator("#practice-progress")).toHaveText("2줄 남음");

  // 가사는 마지막에야 열린다. 먼저 보여 주면 듣기 연습이 아니라 읽기 연습이 된다.
  await expect(page.locator("#card-sound")).toBeHidden();
  await expect(page.locator("#card-es")).toBeHidden();
  await page.locator("#reveal").click();
  await expect(page.locator("#card-sound")).toBeVisible();
  await expect(page.locator("#card-es")).toBeHidden();
  await page.locator("#reveal").click();
  await expect(page.locator("#card-es")).toBeVisible();
  await expect(page.locator("#card-gloss")).toBeVisible();

  // 모르겠으면 이번 판 안에서 다시 돌아온다.
  await page.locator("#again").click();
  await expect(page.locator("#practice-progress")).toHaveText("2줄 남음");
  for (let round = 0; round < 2; round += 1) {
    await page.locator("#reveal").click();
    await page.locator("#reveal").click();
    await page.locator("#got").click();
  }
  await expect(page.locator("#practice-done")).toContainText("오늘 몫을 끝냈습니다");

  // 뒤로 가면 곡으로, 다시 뒤로 가면 목록으로 — 새로고침해도 진도가 남는다.
  await page.goBack();
  await expect(page.locator("#heading")).toHaveText("잠 못 드는 밤");
  await page.reload();
  await expect(page.locator(".line")).toHaveCount(3);
  await expect(page.locator("#song-progress")).toContainText("오늘 연습할 줄 0줄");
  await page.locator("#back").click();
  await expect(page.locator(".song-stat").first()).toContainText("가사 없이 아는 줄 0/2");

  // LIFE 로 돌아간다.
  await page.locator("#back").click();
  await expect(page.locator("#list-name")).toBeVisible();

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(failures).toEqual([]);
});

/** 8kHz 8bit 모노 무음 WAV. 진짜 노래를 넣을 수는 없으니 소리 없는 파일로 길만 확인한다. */
function silentWav(seconds = 3, rate = 8000) {
  const data = Buffer.alloc(seconds * rate, 128);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate, 28);
  head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test("음원 — 기기에서 고른 파일로 줄을 맞추고 그 구간만 듣는다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto("/life/espanol/");
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill("음원 붙일 곡");
  await page.locator("#lyrics-input").fill("El amor no me deja dormir\nTe quiero más que ayer");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#clip-sync")).toBeHidden();

  await page.locator("#clip-input").setInputFiles({
    name: "song.wav", mimeType: "audio/wav", buffer: silentWav(),
  });
  await expect(page.locator("#clip-name")).toHaveText("song.wav");
  await expect(page.locator("#clip-error")).toHaveText("");
  // 외부 호스트가 막혀 있어 재생은 blob: 으로만 된다 (life CSP 의 media-src).
  await expect(page.locator("#player")).toHaveAttribute("src", /^blob:/);

  // 들으면서 줄이 시작할 때 누른다.
  await page.locator("#clip-sync").click();
  await expect(page.locator("#sync-at")).toHaveText("1 / 2");
  await page.locator("#sync-now").click();
  await expect(page.locator("#sync-at")).toHaveText("2 / 2");
  await page.locator("#sync-close").click();
  await expect(page.locator(".line.marked")).toHaveCount(1);

  // 새로고침해도 음원이 남고(IndexedDB), 찍어 둔 줄은 그 구간이 재생된다.
  await page.reload();
  await expect(page.locator("#clip-name")).toHaveText("song.wav");
  await page.locator(".line-play").first().click();
  await expect.poll(() => page.evaluate(() => !document.getElementById("player").paused)).toBe(true);

  expect(failures).toEqual([]);
});
