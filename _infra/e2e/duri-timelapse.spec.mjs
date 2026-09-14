import { test, expect } from "@playwright/test";

// 지도 우하단 유틸 독과 타임랩스 동영상. 녹화는 실시간이라(핀 날짜 수 × 1.1초)
// 검사는 날짜를 세 개만 심어 짧게 끝낸다.
test.setTimeout(60000);

// **데이트 로그라 둘이 같은 날 찍은 날만 담긴다** — 날마다 두 사람 핀을 함께 심는다.
// 한 사람 것만 심으면 영상에 아무 날도 들어가지 않는다(그래서 토스트로 끝난다).
const DAYS = [
  ["2026-05-03", 37.5665, 126.9780],
  ["2026-06-11", 35.1587, 129.1604],
  ["2026-07-20", 33.5104, 126.4914],
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
    for (const [d, lat, lng] of days) {
      const at = new Date(`${d}T09:00:00+09:00`).getTime();
      for (const [i, who] of ["빵", "쫑"].entries()) {
        seq += 1;
        const [la, ln] = [lat + i * 0.01, lng + i * 0.01];
        await window.calPutRecord(`pin${String(seq).padStart(12, "0")}`,
          { kind: "pin", seq, lat: la, lng: ln, at, owner: who, photo: true });
        await window.putEntry({ seq, kind: "photo", at, name: who, thumb: await shot(),
                                loc: { lat: la, lng: ln }, w: 64, h: 64 });
      }
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
  // 먼저 배경음악을 고르는 자리가 나온다 — 목록은 assets 카탈로그에서 읽어 온다
  await expect(page.locator("#tl-setup")).toBeVisible();
  await expect(page.locator("#tl-bgm option")).not.toHaveCount(1);
  await page.locator("#tl-start").click();
  await expect(page.locator("#tl-setup")).toBeHidden();
  const canvas = await page.locator("#tl-canvas").evaluate((c) => [c.width, c.height]);
  expect(canvas, "9:16 세로 — 폰에서 보고 공유하는 물건이다").toEqual([1080, 1920]);

  // 다 만들면 크기가 찍히고 저장 버튼이 뜬다(= blob 이 실제로 생겼다)
  await expect(page.locator("#tl-save")).toBeVisible({ timeout: 40000 });
  await expect(page.locator("#tl-status")).toHaveText(/다 됐어요 · \d+\.\d+MB/);

  await page.locator("#tl-close").click();
  await expect(page.locator("#tl")).toBeHidden();
  expect(errors).toEqual([]);
});

test("배경음악을 고르면 소리 트랙까지 담긴다", async ({ page }) => {
  await openMapWithPins(page);
  await page.locator("#map-dock-toggle").click();
  await page.locator("#map-export").click();
  await page.locator("#tl-setup").waitFor();
  await page.selectOption("#tl-bgm", { index: 1 }); // 카탈로그의 첫 곡
  await page.locator("#tl-start").click();
  await expect(page.locator("#tl-save")).toBeVisible({ timeout: 40000 });

  // 골랐으면 결과를 **어느 쪽이든 말해 준다** — 저장한 뒤에야 무음인 걸 알면 늦다.
  // (기기·컨테이너마다 오디오 코덱이 달라 "붙었다"를 단정할 수 없다.)
  const status = await page.locator("#tl-status").textContent();
  expect(status).toMatch(/음악 포함|음악은 못 넣었어요/);
  if (status.includes("음악 포함")) {
    const hasSound = await page.evaluate(async () => {
      const bytes = new Uint8Array(await window.tlBlob.arrayBuffer());
      const text = new TextDecoder("latin1").decode(bytes);
      return /soun|A_OPUS|A_VORBIS/.test(text); // mp4 는 handler, webm 은 CodecID
    });
    expect(hasSound, "소리를 넣었다고 했으면 파일에 소리 트랙이 있어야 한다").toBe(true);
  }

  // 고른 곡은 다음에 열 때 그대로 있다
  const picked = await page.locator("#tl-bgm").inputValue();
  await page.reload();
  await expect(page.locator("#bar")).toBeVisible();
  await page.evaluate(() => window.openMap());
  await page.locator("#map-export").click();
  await expect(page.locator("#tl-bgm")).toHaveValue(picked);
});

test("날짜가 많아도 영상은 짧게 끝난다 — 만드는 시간이 곧 영상 길이다", async ({ page }) => {
  // 녹화가 실시간이라 우회가 없다. 그래서 전체 길이에 상한을 두고 날짜 수로 한 단계를
  // 나눈다 — 하루당 고정 길이였을 때 마흔 날이면 46초였다.
  const many = [];
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    many.push([d.toISOString().slice(0, 10), 35 + (i % 7) * 0.4, 127 + (i % 5) * 0.5]);
  }
  await openMapWithPins(page, many);
  await page.locator("#map-dock-toggle").click();

  await page.locator("#map-export").click();
  await page.locator("#tl-start").waitFor();
  const t0 = Date.now();
  await page.locator("#tl-start").click();
  await expect(page.locator("#tl-save")).toBeVisible({ timeout: 40000 });
  const took = (Date.now() - t0) / 1000;
  expect(took, `40일치가 ${took.toFixed(1)}초 걸렸다 — 길이 상한이 풀렸다`).toBeLessThan(17);
});
