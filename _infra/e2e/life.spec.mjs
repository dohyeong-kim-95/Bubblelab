import { expect, test } from "@playwright/test";

test("할 일 PWA — 목록을 옆으로 넘기고, 적은 내용이 오프라인에서도 남는다", async ({ page, context }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/");
  await expect(page.locator("#list-name")).toHaveText("할 일");

  for (const text of ["우유 사기", "세탁", "이력서"]) {
    await page.locator("#add-text").fill(text);
    await page.getByRole("button", { name: "추가" }).click();
  }
  await expect(page.locator(".item")).toHaveCount(3);
  await expect(page.locator("#list-count")).toHaveText("0/3");

  // 완료한 것은 항상 아래로 내려간다.
  await page.getByRole("button", { name: "세탁 완료" }).click();
  await expect(page.locator("#list-count")).toHaveText("1/3");
  await expect(page.locator(".item .text")).toHaveText([/우유 사기/, /이력서/, /세탁/]);
  await page.getByRole("button", { name: "세탁 완료 취소" }).click();
  await expect(page.locator(".item .text")).toHaveText([/우유 사기/, /세탁/, /이력서/]);
  await page.getByRole("button", { name: "우유 사기 완료" }).click();
  await expect(page.locator(".item .text")).toHaveText([/세탁/, /이력서/, /우유 사기/]);

  // 두 번째 목록을 만들면 점이 생기고 그쪽으로 넘어간다.
  await page.locator("#menu-button").click();
  await page.getByRole("button", { name: "새 목록" }).click();
  await page.locator("#prompt-text").fill("장보기");
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.locator("#list-name")).toHaveText("장보기");
  await expect(page.locator("#dots .dot")).toHaveCount(2);

  // 가로 스크롤(스와이프)로 넘겨도 헤더와 점이 따라온다.
  await page.evaluate(() => {
    const track = document.getElementById("track");
    track.dispatchEvent(new PointerEvent("pointerdown"));   // 손가락이 닿았다
    track.scrollTo({ left: 0, behavior: "auto" });
    track.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator("#list-name")).toHaveText("할 일");
  await expect(page.locator("#dots .dot").first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#list-count")).toHaveText("1/3");

  // 제목을 한 번 누르면 목록 선택, 두 번 누르면 이름 바꾸기.
  await page.locator("#list-name").click();
  await expect(page.locator("#picker")).toBeVisible();
  await page.locator("#picker .pick-open").nth(1).click();
  await expect(page.locator("#list-name")).toHaveText("장보기");

  await page.locator("#list-name").dblclick();
  await expect(page.locator("#prompt-title")).toHaveText("이름 바꾸기");
  await page.locator("#prompt-text").fill("주말 장보기");
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.locator("#list-name")).toHaveText("주말 장보기");
  await expect(page.locator("#picker")).toBeHidden();
  await page.locator("#dots .dot").first().click();
  await expect(page.locator("#list-name")).toHaveText("할 일");

  // 할 일을 길게 누르면 도구를 연결하고, 두 번 누르면 그 도구가 열린다.
  await page.locator("#dots .dot").first().click();
  await expect(page.locator("#list-name")).toHaveText("할 일");
  const text = page.locator(".item .text").first();  // 맨 위 = 미완료 첫 항목
  await text.hover();
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.locator("#prompt-title")).toHaveText("도구 연결");
  await page.locator("#prompt-text").fill("invest");
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.locator(".item .tool").first()).toHaveText("↗ invest");

  await text.dblclick();
  await expect(page).toHaveURL(/\/life\/invest\/$/);
  await page.goBack();
  await expect(page.locator(".item .tool").first()).toHaveText("↗ invest");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(failures).toEqual([]);

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("우유 사기")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#dots .dot")).toHaveCount(2);
  await expect(page.locator(".item .tool").first()).toHaveText("↗ invest", { timeout: 3000 });
  await expect(page.locator(".item .text")).toHaveText([/세탁/, /이력서/, /우유 사기/], { timeout: 3000 });
});

test("PWA 로 설치되면 주소창 없이 뜬다", async ({ page }) => {
  await page.goto("/life/");
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    return (await fetch(href)).json();
  });
  expect(manifest.name).toBe("LIFE");
  expect(manifest.short_name).toBe("LIFE");
  assertStandalone(manifest);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
  expect(manifest.background_color).toBe("#000000");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(0, 0, 0)");
  // 게이트 뒤에 있으므로 매니페스트는 쿠키와 함께 받아야 한다. 이 속성이 빠지면
  // 크롬이 매니페스트를 못 읽어 설치 대신 바로가기가 되고 주소창이 남는다.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("crossorigin", "use-credentials");
  // 키보드가 앱을 덮지 않고 레이아웃을 줄이도록 선언한다.
  await expect(page.locator('meta[name="viewport"]'))
    .toHaveAttribute("content", /interactive-widget=resizes-content/);
  const registered = await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  expect(registered).toBe(true);
});

test("도구는 열 때 받는다 — 시작에는 섞이지 않는다", async ({ page }) => {
  const paths = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));

  await page.goto("/life/", { waitUntil: "networkidle" });
  // 도구가 몇 개가 되든 시작에 받는 것은 셸뿐이어야 한다. 여기가 늘어나는 순간
  // 여는 속도가 도구 개수를 따라간다.
  const tools = paths.filter((path) => /^\/life\/[^/]+\//.test(path));
  expect(tools, `시작에 도구를 받았다: ${tools.join(", ")}`).toEqual([]);
  expect(paths.filter((path) => path.startsWith("/life/"))).toHaveLength(4);

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForTimeout(400);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names.find((name) => name.startsWith("life-")));
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cached.filter((path) => /^\/life\/[^/]+\//.test(path))).toEqual([]);

  // 도구는 눌렀을 때 비로소 받는다.
  paths.length = 0;
  await page.goto("/life/pushup/", { waitUntil: "networkidle" });
  expect(paths.some((path) => path.startsWith("/life/pushup/"))).toBe(true);
});

test("두 번째부터는 네트워크를 기다리지 않고 열린다", async ({ page }) => {
  await page.goto("/life/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForTimeout(400);   // 셸이 캐시에 담길 때까지

  await page.reload();
  await expect(page.locator("#list-name")).toBeVisible();
  const delivery = await page.evaluate(() =>
    performance.getEntriesByType("navigation")[0].deliveryType);
  // 네트워크를 타면 여는 순간이 왕복만큼 늦어진다 — todo 앱은 누르자마자 떠야 한다.
  expect(delivery).toBe("cache-storage");
});

function assertStandalone(manifest) {
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBeTruthy();
  // 안드로이드 크롬이 설치 대상으로 인정하려면 192·512 아이콘이 필요하다.
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
  expect(manifest.icons.some((icon) => icon.purpose?.includes("maskable"))).toBe(true);
}

async function dragGrip(page, grip, target, offset) {
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // 여러 번 나눠 움직여야 pointermove 가 실제로 여러 번 들어온다.
  for (let step = 1; step <= 4; step += 1) {
    const y = from.y + ((to.y + offset - from.y) * step) / 4;
    await page.mouse.move(from.x + from.width / 2, y + from.height / 2);
  }
  await page.mouse.up();
}

test("손잡이를 끌어 항목과 목록 순서를 바꾼다", async ({ page }) => {
  await page.goto("/life/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  for (const text of ["하나", "둘", "셋"]) {
    await page.locator("#add-text").fill(text);
    await page.getByRole("button", { name: "추가" }).click();
  }
  await expect(page.locator(".item .text")).toHaveText([/하나/, /둘/, /셋/]);

  // 첫 항목을 셋째 자리로 끌어 내린다.
  const rows = page.locator(".item");
  await dragGrip(page, rows.nth(0).locator(".grip"), rows.nth(2), 20);
  await expect(page.locator(".item .text")).toHaveText([/둘/, /셋/, /하나/]);

  // 새로고침해도 그대로다 (저장됐다).
  await page.reload();
  await expect(page.locator(".item .text")).toHaveText([/둘/, /셋/, /하나/]);

  // 목록도 선택 화면에서 끌어 옮긴다.
  await page.locator("#menu-button").click();
  await page.getByRole("button", { name: "새 목록" }).click();
  await page.locator("#prompt-text").fill("둘째 목록");
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.locator("#list-name")).toHaveText("둘째 목록");

  await page.locator("#list-name").click();
  await expect(page.locator("#picker")).toBeVisible();
  const picks = page.locator("#picker .pick");
  await expect(picks).toHaveCount(2);
  await dragGrip(page, picks.nth(0).locator(".grip"), picks.nth(1), 20);
  await expect(page.locator("#picker .pick-open")).toHaveText([/둘째 목록/, /할 일/]);

  // 순서가 바뀌어도 보고 있던 목록은 그대로 따라온다.
  await page.locator("#picker").press("Escape");
  await expect(page.locator("#list-name")).toHaveText("둘째 목록");
});
