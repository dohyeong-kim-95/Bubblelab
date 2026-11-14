// 운세 노트(util/fortune) — 정적 서버에는 워커가 없으니 /_fortune/* 는 실제 서버 코드
// (_infra/fortune.js 의 handleFortuneChart·handleFortuneComic + FortuneDO)를 메모리 저장소 위에서 돌려 답한다.
// 보는 것: 첫 방문 빈칸 문장 → 쓰는 동작(탭하면 끝) → 다시 온 사람의 오늘 장 넘기기(하루 한 번),
// 어두운 OS 에서도 밝은 종이, 인생 곡선 이름표가 겹치지 않는 자리, 만화 사주 신청(동의 필수).
import { expect, test } from "@playwright/test";
import { FortuneDO, handleFortuneChart, handleFortuneComic, handleFortuneReview, handleFortuneShare } from "../fortune.js";

class MemoryStorage {
  constructor() { this.data = new Map(); }
  async get(k) { return this.data.has(k) ? structuredClone(this.data.get(k)) : undefined; }
  async put(k, v) { this.data.set(k, structuredClone(v)); }
  async delete(k) { this.data.delete(k); }
  async list({ prefix = "" } = {}) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix))); }
}

class MemoryBucket {
  constructor() { this.data = new Map(); }
  async put(k, v) { this.data.set(k, new Uint8Array(v)); }
  async get(k) { return this.data.has(k) ? { body: this.data.get(k) } : null; }
  async delete(k) { this.data.delete(k); }
  async list({ prefix }) { return { objects: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
}

async function serveFortune(page) {
  const env = { COMIC_SINK_SECRET: "sink", FORTUNE_BUCKET: new MemoryBucket() };
  const fortune = new FortuneDO({ storage: new MemoryStorage() }, env);
  env.FORTUNE = { idFromName: () => "global", get: () => ({ fetch: (u, i) => fortune.fetch(new Request(u, i)) }) };
  fortune.env = env;
  fortune.share = (method, path, body) => {
    const url = new URL(`https://util.bubblelab.dev${path}`);
    return handleFortuneShare(new Request(url, { method, headers: { Authorization: "Bearer sink" }, ...(body ? { body } : {}) }), env, url);
  };
  await page.route(/\/_fortune\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const request = new Request(url, { method: req.method(), headers: req.headers(), body: req.method() === "GET" ? undefined : req.postData() });
    const res = url.pathname === "/_fortune/chart" ? await handleFortuneChart(request, {})
      : url.pathname.startsWith("/_fortune/comic") ? await handleFortuneComic(request, env, url)
      : url.pathname.startsWith("/_fortune/review") ? await handleFortuneReview(request, env, url)
      : url.pathname.startsWith("/_fortune/share") ? await handleFortuneShare(request, env, url)
      : Response.json({ vapidPublicKey: null });
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  return fortune;
}
const stored = (b) => ({ calendar: "solar", lunarLeap: false, timeMode: "branch", time: null, h: null, gender: "unspecified", ...b });
const remember = (page, birth, extra = {}) => page.addInitScript(([b, e]) => {
  localStorage.setItem("bl-fortune-birth", JSON.stringify(b));
  for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
}, [birth, extra]);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("첫 방문: 빈칸 문장에 적고 풀면 맞은편에서 적어 나가고, 누르면 바로 끝난다", async ({ page }) => {
  await serveFortune(page);
  await page.goto("/util/fortune/");
  await expect(page.locator("#ask")).toContainText("태어난 날부터 적어 볼게요");
  await expect(page.locator("#tabs")).toHaveClass(/off/);
  expect(await overflow(page)).toBeLessThanOrEqual(2);
  await page.fill("#birth-form input[aria-label='태어난 해']", "1992");
  await page.fill("#birth-form input[aria-label='월']", "8");
  await page.fill("#birth-form input[aria-label='일']", "20");
  await page.fill("#birth-form input[aria-label^='시(']", "10");
  await page.click("#birth-form .pick:has-text('남자')");
  await page.click("#birth-form button[type=submit]");
  await expect(page.locator("#tab-saju")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".chart .cell .k")).toHaveCount(8);
  await expect(page.locator(".chart .cell.me .k")).toHaveText("무");
  // 움직이는 중이다 — 화면을 한 번 누르면 전부 끝난다
  await page.waitForFunction(() => document.getAnimations().some((a) => a.playState === "running"));
  await page.mouse.click(200, 300);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await expect(page.locator(".curve-plot svg")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bl-fortune-birth")));
  expect(saved).toMatchObject({ y: 1992, m: 8, d: 20, calendar: "solar", gender: "male", timeMode: "branch", h: 5 });
});

test("다시 온 사람(예전 화면에서 저장한 값): 노트가 바로 열리고 오늘 장은 하루에 한 번만 넘긴다", async ({ page }) => {
  await serveFortune(page);
  await remember(page, stored({ y: 1985, m: 3, d: 3, gender: "female", h: 3 }));
  await page.goto("/util/fortune/");
  await expect(page.locator("#form")).toBeHidden();
  await expect(page.locator("#tab-today")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#fortune h2")).toContainText("오늘은");
  await page.waitForSelector(".flipper", { state: "detached" });
  await page.reload();
  await expect(page.locator("#fortune h2")).toContainText("오늘은");
  expect(await page.locator(".flipper").count()).toBe(0);
});

test("어두운 OS 설정이어도 종이는 밝다", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await serveFortune(page);
  await page.goto("/util/fortune/");
  const paper = await page.evaluate(() => getComputedStyle(document.querySelector(".page")).backgroundColor);
  expect(paper).toBe("rgb(251, 250, 246)");
  await context.close();
});

test("인생 곡선: 여러 생년월일에서 이름표가 곡선·서로와 겹치지 않는 자리에 놓인다", async ({ page }) => {
  await serveFortune(page);
  for (const [y, m, d, h, gender] of [[1992, 8, 20, 5, "male"], [1985, 3, 3, 3, "female"], [2001, 12, 25, 0, "female"], [1970, 6, 15, 7, "male"], [1958, 1, 9, 11, "male"]]) {
    await remember(page, stored({ y, m, d, h, gender }), { "bl-fortune-turned": "x" });
    await page.goto("/util/fortune/#saju");
    const plot = page.locator(".curve-plot").first();
    await expect(plot).toHaveAttribute("data-labels", /now:/);
    const labels = await plot.getAttribute("data-labels");
    expect(labels, `${y}-${m}-${d}`).not.toMatch(/:0/);
    expect(await overflow(page)).toBeLessThanOrEqual(2);
  }
});

test("움직임 줄이기면 쓰는 동작 없이 다 그려진 채로 연다", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await serveFortune(page);
  await page.goto("/util/fortune/");
  await page.fill("#birth-form input[aria-label='태어난 해']", "1990");
  await page.fill("#birth-form input[aria-label='월']", "1");
  await page.fill("#birth-form input[aria-label='일']", "1");
  await page.click("#birth-form button[type=submit]");
  await expect(page.locator(".chart .cell .k")).toHaveCount(8);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
  await context.close();
});

test("만화 사주: 동의해야 접수되고, 접수하면 순서대로 보낸다고 말한다", async ({ page }) => {
  const fortune = await serveFortune(page);
  await remember(page, stored({ y: 1992, m: 8, d: 20, h: 5, gender: "male" }), { "bl-fortune-turned": "x" });
  await page.goto("/util/fortune/#saju");
  await expect(page.locator("#comic")).toBeVisible();
  await expect(page.locator("#comic-left")).toHaveText("남은 자리 10");
  await page.fill("#comic-email", "me@example.com");
  await page.click("#comic-send");
  await expect(page.locator("#comic-err")).toContainText("동의");
  await page.click("#comic-consent");
  await page.click("#comic-send");
  await expect(page.locator("#comic-done")).toContainText("신청하신 순서대로");
  const saved = [...fortune.storage.data.values()].find((v) => v?.email === "me@example.com");
  expect(saved.birth).toMatchObject({ y: 1992, m: 8, d: 20, h: 5 });
});

// 2026-11-12 실제 폰(갤럭시, 폭 ~360)에서 '일'이 다음 줄로 밀렸고, 첫 화면에는 선착순 안내가 없어
// 신청 칸을 못 찾았다(사주 탭 맨 아래에만 있었다).
test("좁은 폰 첫 화면: 년·월·일이 한 줄이고, 만화 사주 선착순 안내가 보인다", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  await serveFortune(page);
  await page.goto("/util/fortune/");
  await expect(page.locator("#comic-teaser")).toBeVisible();
  await expect(page.locator("#comic-teaser-left")).toHaveText("(남은 자리 10)");
  const { h, lh } = await page.locator(".date-line").first().evaluate((l) => ({
    h: l.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(l).lineHeight) }));
  expect(h).toBeLessThan(lh * 1.5);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await ctx.close();
});

// 만화 사주를 받은 사람이 메일의 주소로 와서 후기를 남긴다(연락처는 받지 않는다).
test("후기: 좁은 폰에서 별점 없이는 안 가고, 별점·글을 적으면 저장된다", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const fortune = await serveFortune(page);
  await page.goto("/util/fortune/review/");
  await page.fill("#review-text", "제 성격이랑 꼭 닮아서 웃었어요.");
  await page.click("#review-send");
  await expect(page.locator("#review-err")).toContainText("별점");
  await page.locator(".star").nth(3).click();
  await page.fill("#review-nick", "토끼");
  await page.click("#review-publish");
  await page.click("#review-send");
  await expect(page.locator("#review-done")).toBeVisible();
  const items = [...(await fortune.storage.list({ prefix: "review:item:" })).values()];
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ rating: 4, nick: "토끼", publish: true, text: "제 성격이랑 꼭 닮아서 웃었어요." });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await ctx.close();
});

// 인스타 DM 신청분은 메일 대신 링크(#토큰)로 받는다 — 제목·PDF·그림이 보이고, 지난 링크는 지웠다고 말한다.
test("만화 사주 받기: 링크로 열면 제목·PDF·그림이 보이고, 잘못된 링크는 안내한다", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const fortune = await serveFortune(page);
  const { token } = await (await fortune.share("POST", "/_fortune/share", JSON.stringify({ title: "촛불 켠 사람" }))).json();
  await fortune.share("PUT", `/_fortune/share/${token}/saju-01.jpg`, new Uint8Array([255, 216, 255]));
  await fortune.share("PUT", `/_fortune/share/${token}/saju_comic.pdf`, new Uint8Array([37, 80, 68, 70]));
  await page.goto(`/util/fortune/get/#${token}`);
  await expect(page.locator("#get-title")).toHaveText("「촛불 켠 사람」");
  await expect(page.locator("#get-pdf")).toHaveAttribute("href", `/_fortune/share/${token}/saju_comic.pdf`);
  await expect(page.locator("#get-pages img")).toHaveCount(1);
  await expect(page.locator("#get-expire")).toContainText("7일");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.goto("/util/fortune/get/#AAAAAAAAAAAAAAAAAAAAAA");
  await page.reload();
  await expect(page.locator("#get-status")).toContainText("지워졌어요");
  await ctx.close();
});
