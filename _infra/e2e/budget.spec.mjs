import { expect, test } from "@playwright/test";

// 오늘이 며칠이냐에 따라 기준선이 달라지므로, 화면이 실제로 계산해 낸 값과
// 견준다(숫자를 박아 두면 내일 깨진다). 계산 자체는 _infra/budget.test.mjs 가 본다.
test("가계부 — 한도와 남은 날에 견주어 지금 어디쯤인지 보여 준다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/budget/");
  await page.evaluate(() => localStorage.removeItem("bl_budget_v1"));
  await page.reload();

  await expect(page.getByRole("heading", { name: /가계부/ })).toBeVisible();
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#remaining")).toHaveText("1,000,000원");
  await expect(page.locator("#cycle-range")).toContainText("한도 100만원");
  await expect(page.locator("#verdict")).toContainText("하루");

  // 적으면 남은 돈과 오늘 쓴 돈이 함께 줄어든다.
  await page.locator("#amount").fill("12000");
  await page.locator("#memo").fill("국밥");
  await page.locator("#add-button").click();
  await expect(page.locator("#empty")).toBeHidden();
  await expect(page.locator(".entry")).toHaveCount(1);
  await expect(page.locator("#remaining")).toHaveText("988,000원");
  await expect(page.locator("#fact-spent")).toHaveText("12,000원");
  await expect(page.locator("#fact-today")).toHaveText("12,000원");
  await expect(page.locator("#amount")).toHaveValue("");

  // 금액이 없으면 적히지 않는다.
  await page.locator("#memo").fill("금액 없는 것");
  await page.locator("#add-button").click();
  await expect(page.locator(".entry")).toHaveCount(1);

  // 환불은 음수로 적고 합계에서 빠진다.
  await page.locator("#amount").fill("-2000");
  await page.locator("#memo").fill("부분 환불");
  await page.locator("#add-button").click();
  await expect(page.locator("#fact-spent")).toHaveText("10,000원");
  await expect(page.locator(".entry-amount.refund")).toHaveText("+2,000원");

  // 항목을 눌러 고친다.
  await page.locator(".entry").last().click();
  await page.locator("#editor-amount").fill("15000");
  await page.locator("#editor-memo").fill("국밥(곱빼기)");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#fact-spent")).toHaveText("13,000원");

  // 한도를 넘기면 화면이 초과로 바뀐다.
  await page.locator("#amount").fill("2000000");
  await page.locator("#memo").fill("사고");
  await page.locator("#add-button").click();
  await expect(page.locator("#hero-label")).toHaveText("한도 초과");
  await expect(page.locator("#gauge")).toHaveClass(/over/);
  await expect(page.locator("#verdict")).toContainText("넘겼어요");

  // 지난 주기에는 이번에 적은 것이 없다. 앞으로는 오늘이 든 주기까지만 간다.
  await expect(page.locator("#next-cycle")).toBeDisabled();
  await page.locator("#prev-cycle").click();
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("#cycle-range")).toContainText("지난 주기");
  await page.locator("#next-cycle").click();
  await expect(page.locator(".entry")).toHaveCount(3);

  // 한도와 시작일을 바꿔도 적어 둔 것은 그대로다.
  await page.locator("#settings-button").click();
  await page.locator("#limit-input").fill("700000");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("#cycle-range")).toContainText("한도 70만원");
  await expect(page.locator("#fact-spent")).toHaveText("2,013,000원");

  // 새로고침해도 남아 있다.
  await page.reload();
  await expect(page.locator(".entry")).toHaveCount(3);
  await expect(page.locator("#fact-spent")).toHaveText("2,013,000원");

  expect(failures).toEqual([]);
});

test("가계부 — 문자 여러 건을 한 번에 읽어 고른 것만 담는다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) failures.push(message.text());
  });

  await page.goto("/life/budget/");
  await page.evaluate(() => localStorage.removeItem("bl_budget_v1"));
  await page.reload();

  const today = await page.evaluate(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()));
  const [month, day] = [today.slice(5, 7), today.slice(8, 10)];
  const sms = (amount, time, memo, cancel = "") =>
    `[Web발신]\n신한카드(1234)승인${cancel}\n${amount}원 일시불\n${month}/${day} ${time}\n${memo}\n누적1,234,567원`;

  const drop = (text) => ({ name: "sms.txt", mimeType: "text/plain", buffer: Buffer.from(text) });

  await page.locator("#sms-button").click();
  await page.locator("#sms-file").setInputFiles(drop(
    [sms("12,000", "14:22", "백암순대"), sms("4,500", "16:05", "카페"),
      sms("4,500", "16:20", "카페", "취소"), "[Web발신] 인증번호 [009911]"].join("\n\n")));

  await expect(page.locator("#sms-summary")).toContainText("3건 읽음");
  await expect(page.locator("#sms-summary")).toContainText("못 읽은 것 1건");
  await expect(page.locator(".preview-row")).toHaveCount(3);
  await expect(page.locator("#sms-save")).toHaveText("3건 담기");

  // 한 건은 빼고 담는다.
  await page.locator(".preview-row input").nth(1).uncheck();
  await expect(page.locator("#sms-save")).toHaveText("2건 담기");
  await page.locator("#sms-save").click();
  await expect(page.locator(".entry")).toHaveCount(2);
  await expect(page.locator("#fact-spent")).toHaveText("7,500원");
  await expect(page.locator(".entry-memo").first()).toHaveText("백암순대");

  // 같은 문자를 또 넣어도 두 번 담기지 않는다.
  await page.locator("#sms-button").click();
  await page.locator("#sms-file").setInputFiles(drop(sms("12,000", "14:22", "백암순대")));
  await expect(page.locator("#sms-summary")).toContainText("이미 담긴 것 1건");
  await expect(page.locator(".preview-row.duplicate")).toHaveCount(1);
  await expect(page.locator("#sms-save")).toBeDisabled();
  await page.locator("#sms-cancel").click();
  await expect(page.locator(".entry")).toHaveCount(2);

  // 옛 방식(GET ?text=)으로 오는 공유도 받는다 — 이미 설치된 폰의 WebAPK 는
  // 매니페스트가 갱신될 때까지 그쪽으로 보낸다.
  await page.goto(`/life/budget/?text=${encodeURIComponent(sms("9,900", "19:30", "편의점"))}`);
  await expect(page.locator("#sms")).toBeVisible();
  await expect(page.locator("#sms-summary")).toContainText("1건 읽음");
  expect(new URL(page.url()).search).toBe("");
  await page.locator("#sms-save").click();
  await expect(page.locator("#fact-spent")).toHaveText("17,400원");

  expect(failures).toEqual([]);
});

test("가계부 — 공유 시트로 보낸 백업 파일을 서비스워커가 받아 연다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  // 서비스워커는 LIFE 셸에서 등록된다. 스코프가 /life/ 라 도구 페이지까지 함께 맡는다.
  await page.goto("/life/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.goto("/life/budget/");
  await page.evaluate(() => localStorage.removeItem("bl_budget_v1"));

  // 안드로이드가 공유할 때 보내는 것과 같은 모양: multipart POST 의 file 칸.
  const status = await page.evaluate(async () => {
    const xml = `<smses count="1"><sms address="15778000" date="${Date.now()}" `
      + `body="[Web발신]&#10;신한카드(1234)승인&#10;25,000원 일시불&#10;정육점" /></smses>`;
    const form = new FormData();
    form.append("file", new File([xml], "sms-backup.xml", { type: "text/xml" }));
    const response = await fetch("/life/budget/", { method: "POST", body: form });
    return response.status;
  });
  expect(status).toBe(200);   // 서비스워커가 ?share=1 로 돌려보내고 그 화면이 온다

  await page.goto("/life/budget/?share=1");
  await expect(page.locator("#sms")).toBeVisible();
  await expect(page.locator("#sms-summary")).toContainText("1건 읽음");
  await expect(page.locator(".preview-memo")).toHaveText("정육점");
  expect(new URL(page.url()).search).toBe("");
  await page.locator("#sms-save").click();
  await expect(page.locator("#fact-spent")).toHaveText("25,000원");

  // 한 번 받은 것은 캐시에서 지워진다 — 다시 열어도 같은 것이 또 뜨지 않는다.
  await page.goto("/life/budget/?share=1");
  await expect(page.locator("#sms-summary")).toContainText("읽지 못했습니다");
  await expect(page.locator(".entry")).toHaveCount(1);

  expect(failures).toEqual([]);
});

test("가계부 — 긴 가맹점 이름이 있어도 가로로 넘치지 않는다", async ({ page }) => {
  /* 실기기(삼성)에서 팝업의 오른쪽이 잘려 "담기" 가 화면 밖으로 나갔다. 원인은 팝업이
   * 아니라 본문이다 — 긴 기록 한 줄이 문서를 가로로 넓히면, 그 위에 뜬 팝업도 넓어진
   * 문서를 기준으로 자리를 잡는다. 그래서 목록과 팝업을 함께 본다. */
  const long = "신한카드(3484)승인 김*형님 아주아주긴가맹점이름주식회사강남대로지점";
  await page.goto("/life/budget/");
  await page.evaluate((memo) => localStorage.setItem("bl_budget_v1", JSON.stringify({
    v: 1, limit: 1000000, startDay: 1,
    entries: [{ id: "a", amount: 39600, memo, on: "2026-08-10", at: "2026-08-10T03:00:00Z" }],
  })), long);
  await page.reload();
  await expect(page.locator(".entry")).toHaveCount(1);

  const viewport = page.viewportSize().width;
  const fits = async (what) =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth), what)
      .toBeLessThanOrEqual(page.viewportSize().width + 1);
  await fits("목록이 가로로 넘친다");

  await page.locator("#sms-button").click();
  await page.locator("#sms-file").setInputFiles({
    name: "sms.txt", mimeType: "text/plain",
    buffer: Buffer.from(`${long} 12,000원 08/23\n\n${long} 4,500원 08/22`),
  });
  await expect(page.locator(".preview-row")).toHaveCount(2);
  await fits("팝업이 열린 뒤 가로로 넘친다");

  const box = await page.locator("#sms").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "팝업이 화면보다 넓다").toBeLessThanOrEqual(viewport + 1);
  // 담을 수 있는지는 버튼이 화면 안에 있느냐로 갈린다.
  const save = await page.locator("#sms-save").boundingBox();
  expect(save.x + save.width, "담기 버튼이 화면 밖에 있다").toBeLessThanOrEqual(viewport + 1);
  await expect(page.locator("#sms-save")).toBeVisible();
});

test("가계부 — 담은 것을 지우지 않고 합계에서만 뺀다", async ({ page }) => {
  /* 즉시결제로 빠져나간 카드값처럼 "쓴 돈이 아닌" 것이 담길 때가 있다. 지우면 다음
   * 백업에서 또 담기므로, 목록에 남겨 둔 채 합계에서만 뺀다. */
  await page.goto("/life/budget/");
  // 날짜를 박아 두면 주기를 찾아가야 한다 — 오늘로 심어 지금 보는 주기에 두 건이 있게 한다.
  await page.evaluate(() => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    localStorage.setItem("bl_budget_v1", JSON.stringify({
      v: 1, limit: 1000000, startDay: 1,
      entries: [
        { id: "a", amount: 12000, memo: "국밥", on: today, at: `${today}T03:00:00Z` },
        { id: "b", amount: 500000, memo: "카드값 출금", on: today, at: `${today}T04:00:00Z` },
      ],
    }));
  });
  await page.reload();
  await expect(page.locator(".entry")).toHaveCount(2);
  await expect(page.locator("#fact-spent")).toHaveText("512,000원");

  await page.locator(".entry").filter({ hasText: "카드값 출금" }).locator(".entry-skip").click();
  await expect(page.locator("#fact-spent")).toHaveText("12,000원");
  await expect(page.locator(".entry")).toHaveCount(2);          // 목록에는 남는다
  await expect(page.locator(".entry.skipped")).toHaveCount(1);

  // 새로고침해도 뺀 상태가 남고, 한 번 더 누르면 되돌아온다.
  await page.reload();
  await expect(page.locator("#fact-spent")).toHaveText("12,000원");
  await page.locator(".entry.skipped .entry-skip").click();
  await expect(page.locator("#fact-spent")).toHaveText("512,000원");
});

test("가계부 — 기억한 폴더의 최신 백업을 한 번에 받고 되돌린다", async ({ page }) => {
  /* 백업 앱은 매번 새 파일을 쓴다. 손으로 열어 담는 게 하루 일과가 되지 않게, 폴더를
   * 기억해 두면 최신 파일에서 새 결제만 담는다. 실제 폴더 선택창은 자동으로 못 여니
   * 가짜 손잡이를 심어 그 뒤의 길(최신 파일 고르기 → 새 것만 담기 → 되돌리기)을 본다. */
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [month, day] = [today.slice(5, 7), today.slice(8, 10)];
  const sms = (amount, time, memo) =>
    `[Web발신]\n신한카드(1234)승인\n${amount}원 일시불\n${month}/${day} ${time}\n${memo}\n누적1,234,567원`;

  await page.addInitScript(([old, fresh]) => {
    const file = (name, text, lastModified) => Object.assign(new File([text], name, { lastModified }), {});
    const files = [file("sms-old.xml", old, 1000), file("sms-new.xml", fresh, 2000)];
    const handle = {
      name: "Backups",
      entries: async function* entries() {
        for (const one of files) yield [one.name, { kind: "file", getFile: async () => one }];
      },
      queryPermission: async () => "granted",
    };
    window.showDirectoryPicker = async () => handle;
  }, [sms("12,000", "14:22", "옛날국밥"), [sms("12,000", "14:22", "옛날국밥"), sms("9,360", "17:52", "메가엠지씨커피")].join("\n\n")]);

  await page.goto("/life/budget/");
  await page.evaluate(() => localStorage.removeItem("bl_budget_v1"));
  await page.reload();
  await expect(page.locator("#sync")).toBeHidden();     // 기억한 폴더가 없으면 자리도 없다

  // 📩 에서 폴더를 한 번 고르면 그 자리가 생긴다.
  await page.locator("#sms-button").click();
  await page.locator("#folder-open").click();
  await expect(page.locator("#sms-summary")).toContainText("sms-new.xml");
  await page.locator("#sms-cancel").click();
  await expect(page.locator("#sync-now")).toBeVisible();

  // 원버튼 — 최신 파일에서 두 건을 담는다.
  await page.locator("#sync-now").click();
  await expect(page.locator("#sync-line")).toContainText("sms-new.xml 에서 2건 담았어요");
  await expect(page.locator(".entry")).toHaveCount(2);
  await expect(page.locator("#fact-spent")).toHaveText("21,360원");

  // 한 번 더 눌러도 늘지 않는다(같은 문자는 두 번 담지 않는다).
  await page.locator("#sync-now").click();
  await expect(page.locator("#sync-line")).toContainText("새 결제 없음");
  await expect(page.locator(".entry")).toHaveCount(2);

  await expect(page.locator("#sync-undo")).toBeHidden();    // 되돌릴 게 없으면 버튼도 없다

  // 한 건을 지워 두면 그 한 건만 다시 담기고, 방금 담은 것은 되돌릴 수 있다.
  await page.locator(".entry").filter({ hasText: "메가엠지씨커피" }).locator(".entry-main").click();
  await page.locator("#editor-delete").click();
  await expect(page.locator(".entry")).toHaveCount(1);
  await page.locator("#sync-now").click();
  await expect(page.locator("#sync-line")).toContainText("1건 담았어요");
  await expect(page.locator(".entry")).toHaveCount(2);
  await page.locator("#sync-undo").click();
  await expect(page.locator("#sync-line")).toContainText("되돌렸어요");
  await expect(page.locator(".entry")).toHaveCount(1);
  await expect(page.locator("#fact-spent")).toHaveText("12,000원");

  expect(failures).toEqual([]);
});
