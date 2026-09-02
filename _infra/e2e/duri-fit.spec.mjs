import { test, expect } from "@playwright/test";

// 운동 인증 — 둘이 하루 한 번 체크하는 달력. 저장소는 캘린더와 같은 cal:<id> 라
// 화면만 여기서 본다(레코드 모양·상한 근거는 duri/README.md 에 적혀 있다).
// 기록은 암호 문구로 유도한 키로 암호화해 저장하므로, DOM 을 걷어내는 대신 실제
// 시작 화면을 통과한다. 서버(WebSocket)는 이 정적 서버에 없지만 그래도 된다 —
// 보낼 것은 오프라인 큐에 쌓이고 화면은 로컬 상태로 그려진다.
const MINE = "빵", PEER = "쫑";
const enter = async (page) => {
  await page.goto("/duri/");
  await page.waitForFunction(() => typeof window.renderFit === "function");
  await page.locator("#pass").fill("우리만아는긴문장");
  await page.locator("#name").fill(MINE);
  await page.locator("#enter").click();
  await expect(page.locator("#bar")).toBeVisible();
};
const open = async (page) => {
  await enter(page);
  await page.locator("#fit-open").click();
};
// 화면 안의 const 화살표 함수는 전역이 아니라 evaluate 에서 못 부른다 — 여기서 센다.
const pad2 = (n) => String(n).padStart(2, "0");
const ymdOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

test("헤더 💪 로 열리고, 오늘을 체크하면 달력·집계가 따라 움직인다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("예외: " + e.message));
  page.on("console", (m) => {
    // 이 정적 서버에는 /_duri WebSocket 이 없다 — 서버의 부재이지 화면이 깨진 게 아니다.
    if (m.type() === "error" && !/Failed to load resource|net::ERR_|WebSocket/.test(m.text())) errors.push("콘솔: " + m.text());
  });

  await enter(page);
  await expect(page.locator("#fit")).toBeHidden();
  await page.locator("#fit-open").click();          // 헤더 버튼(💪)으로 열린다
  await expect(page.locator("#fit")).toBeVisible();

  const today = ymdOf(new Date());
  const cell = page.locator(`#fit-grid [data-date="${today}"]`);
  await expect(cell).toHaveClass(/today/);
  await expect(cell).not.toHaveClass(/on/);
  await expect(page.locator("#fit-check")).toHaveText("오늘 운동 체크하기");
  await expect(page.locator("#fit-memo-form")).toBeHidden(); // 체크 전에는 메모를 못 적는다

  await page.locator("#fit-check").click();
  await expect(cell).toHaveClass(/on/);
  await expect(page.locator("#fit-check")).toHaveText("체크 취소하기");
  await expect(page.locator("#fit-stats .card").first().locator(".n")).toHaveText("1일");
  await expect(page.locator("#fit-memo-form")).toBeVisible();

  // 메모는 체크한 날에만, 그 날 칸에 붙는다
  await page.locator("#fit-memo").fill("오느른 팔운동 해서 팔에 알이 배겨따.");
  await page.locator("#fit-memo-form button").click();
  await expect(page.locator("#fit-notes .note .tx")).toHaveText("오느른 팔운동 해서 팔에 알이 배겨따.");

  // 체크를 취소하면 칸도 집계도 되돌아온다(툼스톤에 막히지 않고 다시 켤 수도 있어야 한다)
  await page.locator("#fit-check").click();
  await expect(cell).not.toHaveClass(/on/);
  await expect(page.locator("#fit-stats .card").first().locator(".n")).toHaveText("0일");
  await page.locator("#fit-check").click();
  await expect(cell).toHaveClass(/on/);
  await expect(page.locator("#fit-stats .card").first().locator(".n")).toHaveText("1일");

  expect(errors).toEqual([]);
});

test("둘 다 체크한 날은 하트로, 앞으로 올 날은 못 누른다", async ({ page }) => {
  await open(page);
  const now = new Date();
  const month = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

  // 상대가 1일을 체크해 둔 상태를 만든다(상대 기기가 올린 레코드와 같은 모양)
  await page.evaluate(async ([m, p]) => {
    const id = `wk${m.replace("-", "")}${window.whoKey(p)}`;
    await window.calPutRecord(id, {
      kind: "workout", month: m, owner: p, days: { 1: { at: Date.now(), memo: "런닝 5km" } },
    });
    window.renderFit();
  }, [month, PEER]);

  const first = page.locator(`#fit-grid [data-date="${month}-01"]`);
  await expect(first).toHaveClass(/on/);
  await expect(first).toHaveText("");                       // 한 사람만 — 색만 칠한다
  await expect(page.locator("#fit-stats .card").nth(1).locator(".n")).toHaveText("1일");

  await first.click();                                      // 그 날을 골라 나도 체크
  await expect(page.locator("#fit-notes .note .tx")).toHaveText("런닝 5km");
  await page.locator("#fit-check").click();
  await expect(first).toHaveText("♥");                      // 둘 다 → 하트
  await expect(page.locator("#fit-stats .card").nth(2).locator(".n")).toHaveText("1일"); // 같이 1일

  // 아직 안 온 날은 고를 수는 있어도 체크는 못 한다
  const last = `${month}-${pad2(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`;
  const today = ymdOf(now);
  if (last > today) {
    await page.locator(`#fit-grid [data-date="${last}"]`).click();
    await expect(page.locator("#fit-check")).toBeDisabled();
    await expect(page.locator("#fit-check")).toHaveText("아직 오지 않은 날이에요");
  }
});
