import { test, expect } from "@playwright/test";

// 지도 우하단 유틸 독과 타임랩스 동영상. 녹화는 실시간이라(핀 날짜 수 × 1.1초)
// 검사는 날짜를 세 개만 심어 짧게 끝낸다.
test.setTimeout(60000);

const DAYS = [
  ["2026-05-03", 37.5665, 126.9780, "빵"],
  ["2026-06-11", 35.1587, 129.1604, "쫑"],
  ["2026-07-20", 33.5104, 126.4914, "빵"],
];

const openMapWithPins = async (page, days = DAYS) => {
  await page.goto("/duri/");
  await page.waitForFunction(() => typeof window.renderMap === "function");
  await page.locator("#pass").fill("우리만아는긴문장");
  await page.locator("#name").fill("빵");
  await page.locator("#enter").click();
  await expect(page.locator("#bar")).toBeVisible();
  await page.evaluate(async (days) => {
    // 사진도 같이 심는다 — 타임랩스가 핀의 seq 로 정확히 붙여 온다
    const shot = () => new Promise((res) => {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const g = c.getContext("2d"); g.fillStyle = "#4a8"; g.fillRect(0, 0, 64, 64);
      c.toBlob(res, "image/png");
    });
    let seq = 1000;
    for (const [d, lat, lng, who] of days) {
      const at = new Date(`${d}T09:00:00+09:00`).getTime();
      seq += 1;
      await window.calPutRecord(`pin${String(seq).padStart(12, "0")}`,
        { kind: "pin", seq, lat, lng, at, owner: who, photo: true });
      await window.putEntry({ seq, kind: "photo", at, name: who, thumb: await shot(),
                              loc: { lat, lng }, w: 64, h: 64 });
    }
  }, days);
  await page.evaluate(() => window.openMap());
};

test("독은 접힌 채로 열리고, 펴면 동기화·내보내기가 나온다", async ({ page }) => {
  await openMapWithPins(page);
  // 헤더 오른쪽은 📍·🌏 둘뿐이다 — 🔄 는 독으로 내려갔다
  await expect(page.locator(".map-head #map-sync")).toHaveCount(0);
  await expect(page.locator("#map-dock #map-sync")).toHaveCount(1);

  await expect(page.locator("#map-export")).toBeHidden();  // 기본 접힘
  await expect(page.locator("#map-dock-toggle")).toHaveText("⋯");
  await page.locator("#map-dock-toggle").click();
  await expect(page.locator("#map-export")).toBeVisible();
  await expect(page.locator("#map-sync")).toBeVisible();
  await expect(page.locator("#map-dock-toggle")).toHaveText("✕");

  // 접힘 상태는 기억된다
  await page.reload();
  await expect(page.locator("#bar")).toBeVisible();
  await page.evaluate(() => window.openMap());
  await expect(page.locator("#map-export")).toBeVisible();
});

test("🎬 는 핀을 시간순으로 얹은 동영상 파일을 만든다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openMapWithPins(page);
  await page.locator("#map-dock-toggle").click();
  await page.locator("#map-export").click();

  await expect(page.locator("#tl")).toBeVisible();
  const canvas = await page.locator("#tl-canvas").evaluate((c) => [c.width, c.height]);
  expect(canvas, "9:16 세로 — 폰에서 보고 공유하는 물건이다").toEqual([1080, 1920]);

  // 다 만들면 크기가 찍히고 저장 버튼이 뜬다(= blob 이 실제로 생겼다)
  await expect(page.locator("#tl-save")).toBeVisible({ timeout: 40000 });
  await expect(page.locator("#tl-status")).toHaveText(/다 됐어요 · \d+\.\d+MB/);

  await page.locator("#tl-close").click();
  await expect(page.locator("#tl")).toBeHidden();
  expect(errors).toEqual([]);
});

test("날짜가 많아도 영상은 짧게 끝난다 — 만드는 시간이 곧 영상 길이다", async ({ page }) => {
  // 녹화가 실시간이라 우회가 없다. 그래서 전체 길이에 상한을 두고 날짜 수로 한 단계를
  // 나눈다 — 하루당 고정 길이였을 때 마흔 날이면 46초였다.
  const many = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    many.push([d.toISOString().slice(0, 10), 35 + (i % 7) * 0.4, 127 + (i % 5) * 0.5, i % 2 ? "쫑" : "빵"]);
  }
  await openMapWithPins(page, many);
  await page.locator("#map-dock-toggle").click();

  const t0 = Date.now();
  await page.locator("#map-export").click();
  await expect(page.locator("#tl-save")).toBeVisible({ timeout: 40000 });
  const took = (Date.now() - t0) / 1000;
  expect(took, `40일치가 ${took.toFixed(1)}초 걸렸다 — 길이 상한이 풀렸다`).toBeLessThan(17);
});
