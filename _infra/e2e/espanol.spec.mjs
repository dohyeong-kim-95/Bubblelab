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
    name: "song.wav", mimeType: "audio/wav", buffer: silentWav(8),
  });
  // 소리만 든 파일은 그대로 담는다 — 풀었다 다시 쓰면 커지기만 한다.
  await expect(page.locator("#clip-name")).toContainText("song.wav");
  await expect(page.locator("#clip-name")).not.toContainText("소리만");
  await expect(page.locator("#clip-error")).toHaveText("");
  // 외부 호스트가 막혀 있어 재생은 blob: 으로만 된다 (life CSP 의 media-src).
  await expect(page.locator("#player")).toHaveAttribute("src", /^blob:/);

  // 들으면서 줄이 시작할 때 누른다.
  await page.locator("#clip-sync").click();
  await expect(page.locator("#sync-at")).toHaveText("1 / 2");

  // 한 줄 놓쳤다고 처음부터 다시 듣게 하면 아무도 끝까지 안 한다 — 되감을 수 있어야 한다.
  const at = () => page.evaluate(() => document.getElementById("player").currentTime);
  await expect.poll(() => page.evaluate(() => Number(document.getElementById("sync-seek").max)))
    .toBeGreaterThan(1);                              // 재생바가 곡 길이를 안다

  // 재는 동안에는 멈춰 둔다 — 흐르는 시각과 겨루면 무엇이 틀렸는지 알 수 없다.
  await page.locator("#sync-play").click();
  await expect(page.locator("#sync-play")).toHaveText("▶︎");
  await page.locator("#sync-seek").fill("5");
  await expect.poll(at).toBe(5);
  await expect(page.locator("#sync-time")).toHaveText("0:05 / 0:08");
  await page.locator("#sync-back3").click();
  await expect.poll(at).toBe(2);
  await page.locator("#sync-fwd3").click();
  await expect.poll(at).toBe(5);
  await page.locator("#sync-play").click();           // 다시 재생
  await expect(page.locator("#sync-play")).toHaveText("⏸");

  await page.locator("#sync-now").click();
  await expect(page.locator("#sync-at")).toHaveText("2 / 2");

  // 앞 줄로 돌아가면 소리도 그 줄의 시각으로 되돌아간다 — 거기서 다시 들어야 고칠 수 있다.
  await page.locator("#sync-fwd3").click();
  await page.locator("#sync-back").click();
  await expect(page.locator("#sync-at")).toContainText("1 / 2 · 찍어 둔 시각");
  // 재생 중이라 시각은 계속 흐른다 — 되돌아왔는지만 본다(+3초 자리에 남아 있지 않다).
  await expect.poll(at).toBeLessThan(7);

  await page.locator("#sync-close").click();
  await expect(page.locator(".line.marked")).toHaveCount(1);

  // 새로고침해도 음원이 남고(IndexedDB), 찍어 둔 줄은 그 구간이 재생된다.
  await page.reload();
  await expect(page.locator("#clip-name")).toContainText("song.wav");
  await page.locator(".line-play").first().click();
  await expect.poll(() => page.evaluate(() => !document.getElementById("player").paused)).toBe(true);

  expect(failures).toEqual([]);
});

/**
 * 브라우저 안에서 "영상 + 소리" 파일을 만들어 파일 선택기에 넣는다. 실제 뮤직비디오처럼
 * 영상 쪽이 무겁도록 매 프레임 잡음을 그린다 — 그래야 "소리만 남기기"가 실제로 이득인
 * 경우가 되고, 그 판단까지 함께 검사된다. (컨테이너의 크로미움에는 AAC 가 없어 mp4 대신
 * webm 으로 만든다. 판단하는 코드는 컨테이너를 가리지 않는다 — 소리·영상 여부만 본다.)
 */
async function feedVideoFile(page, { seconds = 2, name = "뮤직비디오.webm", type = "video/webm" } = {}) {
  return page.evaluate(async ({ length, fileName, fileType }) => {
    if (!MediaRecorder.isTypeSupported("video/webm")) throw new Error("이 브라우저가 영상을 못 만든다");
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.frequency.value = 440;
    osc.connect(dest);
    osc.start();

    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 640;
    const paint = () => {
      const surface = canvas.getContext("2d");
      const image = surface.createImageData(640, 640);
      for (let index = 0; index < image.data.length; index += 1) image.data[index] = (Math.random() * 255) | 0;
      surface.putImageData(image, 0, 0);
    };
    paint();
    const timer = setInterval(paint, 40);

    const stream = new MediaStream([
      ...canvas.captureStream(25).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm", videoBitsPerSecond: 6_000_000 });
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start();
    await new Promise((done) => setTimeout(done, length * 1000));
    await new Promise((done) => { recorder.onstop = done; recorder.stop(); });
    clearInterval(timer);
    osc.stop();
    await ctx.close();

    const blob = new Blob(chunks, { type: "video/webm" });
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], fileName, { type: fileType }));
    const input = document.getElementById("clip-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return blob.size;
  }, { length: seconds, fileName: name, fileType: type });
}

async function addSong(page, title) {
  await page.locator("#add-button").click();
  await page.locator("#title-input").fill(title);
  await page.locator("#lyrics-input").fill("El amor no me deja dormir\nTe quiero más que ayer");
  await page.getByRole("button", { name: "저장", exact: true }).click();
}

test("영상 파일 — 소리만 뽑아 담고, 그것으로 연습한다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto("/life/espanol/");
  await addSong(page, "뮤직비디오 곡");

  // 파일 선택기에서 거르지 않는다. 안드로이드는 accept="audio/*" 를 보면 "음악" 전용
  // 선택기를 띄워 mp4 가 목록에서 아예 사라진다 — 실제로 그렇게 막혔다.
  expect(await page.locator("#clip-input").getAttribute("accept")).toBeNull();

  const videoBytes = await feedVideoFile(page);
  await expect(page.locator("#clip-name")).toContainText("· 소리만", { timeout: 20_000 });
  await expect(page.locator("#clip-error")).toHaveText("");

  // 담긴 것은 소리뿐이고, 넣은 영상보다 훨씬 작다.
  const clip = await page.evaluate(async () => {
    const db = await new Promise((done) => {
      const request = indexedDB.open("bl_espanol_audio", 1);
      request.onsuccess = () => done(request.result);
    });
    const [row] = await new Promise((done) => {
      const request = db.transaction("clips").objectStore("clips").getAll();
      request.onsuccess = () => done(request.result);
    });
    const bytes = Uint8Array.from(atob(row.data.split(",")[1]), (letter) => letter.charCodeAt(0));
    const head = new DataView(bytes.buffer);
    return {
      kind: row.kind,
      size: row.size,
      type: row.data.slice(5, row.data.indexOf(";")),
      channels: head.getUint16(22, true),
      rate: head.getUint32(24, true),
    };
  });
  expect(clip.kind).toBe("sound");
  expect(clip.type).toBe("audio/wav");
  expect(clip.channels).toBe(1);                    // 따라 부르기용이라 모노면 충분하다
  expect(clip.rate).toBe(22050);
  expect(clip.size).toBeLessThan(videoBytes / 2);

  // 뽑아낸 소리로 구간 반복까지 실제로 된다.
  await page.locator("#clip-sync").click();
  await page.locator("#sync-now").click();
  await page.locator("#sync-close").click();
  await expect(page.locator(".line.marked")).toHaveCount(1);
  await page.locator(".line-play").first().click();
  await expect.poll(() => page.evaluate(() => !document.getElementById("player").paused)).toBe(true);

  expect(failures).toEqual([]);
});

test("형식을 MIME 하나로 판단하지 않는다 — 안드로이드가 빈 값을 준다", async ({ page }) => {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto("/life/espanol/");
  await addSong(page, "이름만 mp4 인 곡");

  // 안드로이드의 파일 제공자는 MIME 을 비워 두거나 octet-stream 으로 주는 일이 잦다.
  // 그 말만 믿으면 멀쩡한 mp4 를 "소리 파일이 아니에요"로 되돌린다.
  await feedVideoFile(page, { name: "노래.mp4", type: "" });
  await expect(page.locator("#clip-error")).toHaveText("", { timeout: 20_000 });
  await expect(page.locator("#clip-name")).toContainText("노래.mp4");
  await expect(page.locator("#clip-sync")).toBeVisible();

  // 소리·영상이 아닌 것은 그대로 거절한다.
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["그냥 글"], "메모.txt", { type: "text/plain" }));
    const input = document.getElementById("clip-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#clip-error")).toContainText("소리나 영상 파일이 아니에요");

  expect(failures).toEqual([]);
});
