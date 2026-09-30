// 약속(util/yaksok) — 정적 서버에는 워커가 없으니 /_yaksok 은 실제 서버 코드
// (_infra/yaksok.js 의 handleYaksokApi + YaksokDO)를 메모리 저장소 위에서 돌려 답한다.
// 방 주소(/util/yaksok/<코드>)도 워커처럼 방 화면을 내준다.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { YaksokDO, handleYaksokApi } from "../yaksok.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(k) { return this.data.has(k) ? structuredClone(this.data.get(k)) : undefined; }
  async put(k, v) { this.data.set(k, structuredClone(v)); }
  async deleteAll() { this.data.clear(); }
  async setAlarm() {}
}

async function serveYaksok(page) {
  const rooms = new Map();
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
  await page.route(/\/util\/yaksok\/[23456789a-z]{6}$/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: shell }));
  return rooms;
}

async function createRoom(page) {
  await page.goto("/util/yaksok/");
  await page.fill("#c-title", "10월 동기 모임");
  await page.fill("#c-name", "도형");
  await page.click("#create button[type=submit]");
  await page.waitForURL(/\/util\/yaksok\/[23456789a-z]{6}$/);
  await expect(page.locator("#r-title")).toHaveText("10월 동기 모임");
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

  await page.setViewportSize({ width: 1280, height: 860 });
  const side = await page.locator(".side").boundingBox();
  const cal2 = await page.locator(".cal").boundingBox();
  expect(side.x).toBeGreaterThan(cal2.x + cal2.width - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
