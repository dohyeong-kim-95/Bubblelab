// 약속(util/yaksok) — 정적 서버에는 워커가 없으니 /_yaksok 은 실제 서버 코드
// (_infra/yaksok.js 의 handleYaksokApi + YaksokDO)를 메모리 저장소 위에서 돌려 답한다.
// 방 주소(/util/yaksok/<코드>)도 워커처럼 방 화면을 내준다.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { YaksokDO, handleYaksokApi } from "../yaksok.js";

class MemoryStorage {
  constructor() { this.data = new Map(); this.alarm = null; }
  async get(k) {
    if (Array.isArray(k)) return new Map(k.filter((x) => this.data.has(x)).map((x) => [x, structuredClone(this.data.get(x))]));
    return this.data.has(k) ? structuredClone(this.data.get(k)) : undefined;
  }
  async put(k, v) {
    if (typeof k === "object") { for (const [kk, vv] of Object.entries(k)) this.data.set(kk, structuredClone(vv)); return; }
    this.data.set(k, structuredClone(v));
  }
  async delete(k) { for (const x of [].concat(k)) this.data.delete(x); }
  async deleteAll() { this.data.clear(); }
  async setAlarm(t) { this.alarm = t; }
}

async function serveYaksok(page, rooms = new Map()) {
  const env = {
    YAKSOK: {
      idFromName: (name) => name,
      get: (id) => {
        if (!rooms.has(id)) rooms.set(id, new YaksokDO({ storage: new MemoryStorage() }, {}));
        return { fetch: (url, init) => rooms.get(id).fetch(new Request(url, init)) };
      },
    },
  };
  await page.route(/\/_yaksok\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const response = await handleYaksokApi(new Request(url, {
      method: req.method(), headers: req.headers(), body: req.postData() ?? undefined,
    }), env, url.pathname);
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
  const shell = readFileSync("dist/util/yaksok/index.html", "utf8");
  await page.route(/\/util\/yaksok\/[a-z0-9]{6}$/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: shell }));
  return rooms;
}

async function createRoom(page, code = "dinner", name = "도형") {
  await page.goto("/util/yaksok/");
  await page.fill("#c-code", code);
  await page.fill("#c-name", name);
  await page.click("#create button[type=submit]");
  await page.waitForURL(new RegExp(`/util/yaksok/${code}$`));
  await expect(page.locator("#r-title")).toHaveText(`🫧 ${code}`);
}

const days = (page) => page.locator("#months .day:not([disabled])");
const myVotes = async (rooms) => {
  const [room] = rooms.values();
  return (await room.storage.get("room")).votes.m1 ?? {};
};

test("방을 만들고 날짜를 톡 누르면 전일 → 점심 → 저녁 → 불가로 돌고 서버에 저장된다", async ({ page }) => {
  const rooms = await serveYaksok(page);
  await createRoom(page);
  const first = days(page).first();
  const date = await first.getAttribute("data-date");
  const labels = [];
  for (let i = 0; i < 4; i += 1) {
    await first.click();
    labels.push((await first.getAttribute("aria-label")).split(" ").pop());
  }
  expect(labels).toEqual(["가능", "점심만", "저녁만", "불가"]);
  await expect(page.locator("#saving")).toHaveText("저장됨");
  expect((await myVotes(rooms))[date]).toBe(4);
});

test("마우스로 누른 채 끌면 지나간 날이 모두 같은 상태로 칠해진다", async ({ page }) => {
  const rooms = await serveYaksok(page);
  await createRoom(page);
  const all = days(page);
  const sunday = await all.evaluateAll((els) => els.findIndex((el) => new Date(el.dataset.date).getUTCDay() === 0));
  const cells = { nth: (i) => all.nth(sunday + i) };
  await cells.nth(0).scrollIntoViewIfNeeded();
  const a = await cells.nth(0).boundingBox();
  const c = await cells.nth(2).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#saving")).toHaveText("저장됨");
  const votes = await myVotes(rooms);
  const dates = await Promise.all([0, 1, 2].map((i) => cells.nth(i).getAttribute("data-date")));
  expect(dates.map((d) => votes[d])).toEqual([1, 1, 1]);
});

// 터치: 꾹 눌렀다 끌면 칠하고, 바로 쓸면 스크롤이라 칠하지 않는다.
async function touchDrag(page, from, to, holdMs) {
  const cdp = await page.context().newCDPSession(page);
  const point = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const p0 = point(from), p1 = point(to);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p0] });
  await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 8; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: p0.x + (p1.x - p0.x) * i / 8, y: p0.y + (p1.y - p0.y) * i / 8 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("터치로 꾹 누른 뒤 끌면 여러 날을 칠하고, 바로 쓸면 칠하지 않는다", async ({ page, browserName }) => {
  // 터치 끌기는 Chrome DevTools 프로토콜로만 흉내 낼 수 있다 — 아이폰은 실기기로 확인한다.
  test.skip(browserName !== "chromium", "CDP 터치는 Chromium 전용");
  const rooms = await serveYaksok(page);
  await createRoom(page);
  // 같은 줄의 네 칸(일~수)을 고른다 — 줄을 넘기면 대각선으로 긋는 셈이라 다른 칸을 지난다.
  const all = days(page);
  const sunday = await all.evaluateAll((els) => els.findIndex((el) => new Date(el.dataset.date).getUTCDay() === 0));
  const cells = { nth: (i) => all.nth(sunday + i) };
  await cells.nth(0).scrollIntoViewIfNeeded();
  const dates = await Promise.all([0, 1, 2, 3].map((i) => cells.nth(i).getAttribute("data-date")));

  await touchDrag(page, await cells.nth(0).boundingBox(), await cells.nth(3).boundingBox(), 60);
  await page.waitForTimeout(900);
  expect(Object.keys(await myVotes(rooms))).toEqual([]);

  await touchDrag(page, await cells.nth(0).boundingBox(), await cells.nth(3).boundingBox(), 400);
  await expect(page.locator("#saving")).toHaveText("저장됨");
  const votes = await myVotes(rooms);
  expect(dates.map((d) => votes[d])).toEqual([1, 1, 1, 1]);
});

test("모바일은 요약이 달력 위, PC 는 두 열이고 어느 폭에서도 가로로 넘치지 않는다", async ({ page }) => {
  await serveYaksok(page);
  await createRoom(page);
  await days(page).first().click();
  await expect(page.locator("#best li")).toHaveCount(1);

  const best = await page.locator("#best-card").boundingBox();
  const cal = await page.locator(".cal").boundingBox();
  expect(best.y).toBeLessThan(cal.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  // 오른쪽 아래 공용 독이 달력 칸을 덮지 않는다(토요일 줄을 누르다 독이 눌리던 자리)
  await expect(page.locator("#bl-dock")).toBeVisible();
  const covered = await page.evaluate(() => {
    const dock = document.querySelector("#bl-dock").getBoundingClientRect();
    return [...document.querySelectorAll("#months .day")].some((d) => d.getBoundingClientRect().right > dock.left);
  });
  expect(covered).toBe(false);

  await page.setViewportSize({ width: 1280, height: 860 });
  const side = await page.locator(".side").boundingBox();
  const cal2 = await page.locator(".cal").boundingBox();
  expect(side.x).toBeGreaterThan(cal2.x + cal2.width - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("PC·폰에서 같은 코드를 치면 같은 방이 열리고, 🎲 는 새 코드를 뽑는다", async ({ browser }) => {
  const rooms = new Map();
  const pc = await (await browser.newContext()).newPage();
  const phone = await (await browser.newContext()).newPage();
  await serveYaksok(pc, rooms);
  await serveYaksok(phone, rooms);

  await pc.goto("/util/yaksok/");
  const first = await pc.inputValue("#c-code");
  await pc.click("#dice");
  expect(await pc.inputValue("#c-code")).toMatch(/^[a-z0-9]{6}$/);
  expect(await pc.inputValue("#c-code")).not.toBe(first);
  await pc.fill("#c-code", "Meet26");
  expect(await pc.inputValue("#c-code")).toBe("meet26");     // 대문자는 소문자로
  await pc.fill("#c-name", "도형");
  await pc.click("#create button[type=submit]");
  await pc.waitForURL(/\/util\/yaksok\/meet26$/);

  // 다른 기기: 같은 코드 + 다른 닉네임 → 같은 방에 참여
  await createRoom(phone, "meet26", "민지");
  await expect(phone.locator(".seat:not(.empty)")).toHaveCount(2);
  expect(rooms.size).toBe(1);

  // 같은 닉네임이면 막히고 방 안의 참여 칸에서 이어하기 링크를 안내한다
  const tablet = await (await browser.newContext()).newPage();
  await serveYaksok(tablet, rooms);
  await tablet.goto("/util/yaksok/");
  await tablet.fill("#c-code", "meet26");
  await tablet.fill("#c-name", "도형");
  await tablet.click("#create button[type=submit]");
  await tablet.waitForURL(/\/util\/yaksok\/meet26$/);
  await expect(tablet.locator("#join")).toBeVisible();
  await expect(tablet.locator("#j-err")).toContainText("이어하기 링크");
});

test("코드로 들어가기 — 코드만 넣으면 그 방이 열리고 방 안에서 참여한다", async ({ page, browser }) => {
  const rooms = new Map();
  const host = await (await browser.newContext()).newPage();
  await serveYaksok(host, rooms);
  await createRoom(host, "abc123");

  await serveYaksok(page, rooms);
  await page.goto("/util/yaksok/");
  await page.fill("#e-code", "ABC123");
  await page.click("#enter button[type=submit]");
  await page.waitForURL(/\/util\/yaksok\/abc123$/);
  await expect(page.locator("#join")).toBeVisible();
  await page.fill("#j-name", "친구");
  await page.click("#join button[type=submit]");
  await expect(page.locator(".seat:not(.empty)")).toHaveCount(2);
});

test("방을 만들 때 정원을 고르면 그 인원까지만 들어온다", async ({ page, browser }) => {
  const rooms = new Map();
  await serveYaksok(page, rooms);
  await page.goto("/util/yaksok/");
  await expect(page.locator("#c-cap-val")).toHaveText("10");
  for (let i = 0; i < 8; i += 1) await page.click('#c-cap button[data-step="-1"]');
  await expect(page.locator("#c-cap-val")).toHaveText("2");
  await expect(page.locator('#c-cap button[data-step="-1"]')).toBeDisabled();
  await page.fill("#c-code", "duo222");
  await page.fill("#c-name", "도형");
  await page.click("#create button[type=submit]");
  await page.waitForURL(/\/util\/yaksok\/duo222$/);
  await expect(page.locator("#ready-count")).toContainText("1/2명");
  await expect(page.locator(".seat")).toHaveCount(2);
  await expect(page.locator(".seat.empty")).toHaveCount(1);

  const friend = await (await browser.newContext()).newPage();
  await serveYaksok(friend, rooms);
  await createRoom(friend, "duo222", "민지");
  const third = await (await browser.newContext()).newPage();
  await serveYaksok(third, rooms);
  await third.goto("/util/yaksok/");
  await third.fill("#c-code", "duo222");
  await third.fill("#c-name", "세번째");
  await third.click("#create button[type=submit]");
  await third.waitForURL(/\/util\/yaksok\/duo222$/);
  await expect(third.locator("#j-err")).toContainText("정원 2명");
});

test("중간에 터트리기: 저장 전 응답이 있던 다른 참여자 화면도 곧 '터트린 방'으로 바뀐다", async ({ browser }) => {
  const rooms = new Map();
  const host = await (await browser.newContext()).newPage();
  const friend = await (await browser.newContext()).newPage();
  await serveYaksok(host, rooms);
  await serveYaksok(friend, rooms);
  await createRoom(host, "popmid");
  await createRoom(friend, "popmid", "민지");

  // 친구가 날짜를 누르고(0.6초 뒤 저장) — 그 사이 방장이 터트린다
  let votePosts = 0;
  friend.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/vote")) votePosts += 1; });
  await friend.locator("#months .day:not([disabled])").nth(1).click();
  await host.click("#host-card summary");
  await host.fill("#pop-code", "popmid");
  await host.click("#pop");
  await expect(host.locator("#gone-title")).toHaveText("펑! 방을 터트렸어요");

  await expect(friend.locator("#gone-title")).toHaveText("터트린 방이에요", { timeout: 4000 });
  const posted = votePosts;
  await friend.waitForTimeout(2500);
  expect(votePosts, "터진 방에 저장을 계속 다시 보내지 않는다").toBe(posted);
  expect(posted).toBeLessThanOrEqual(1);
});
