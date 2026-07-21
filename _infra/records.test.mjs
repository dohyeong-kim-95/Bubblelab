import test from "node:test";
import assert from "node:assert/strict";
import { RecordsDO, weekKey } from "./records.js";

class MemoryStorage {
  constructor(entries = []) { this.data = new Map(entries); }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key);
  }
  async list({ prefix } = {}) {
    return new Map([...this.data].filter(([key]) => !prefix || key.startsWith(prefix)));
  }
}

const post = (records, body) => records.fetch(new Request("https://records.internal/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));

test("weekKey rolls over at Monday 09:00 KST (= Monday 00:00 UTC)", () => {
  // 2026-07-06은 월요일
  assert.equal(weekKey(new Date("2026-07-08T12:00:00Z")), "2026-07-06");
  assert.equal(weekKey(new Date("2026-07-06T00:00:00Z")), "2026-07-06"); // 경계 직후
  assert.equal(weekKey(new Date("2026-07-05T23:59:59Z")), "2026-06-29"); // 월요일 08:59 KST
  assert.equal(weekKey(new Date("2026-07-12T23:59:59Z")), "2026-07-06"); // 일요일 밤
});

test("weekly board keeps top 3, deduped by nick, best-first", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });
  const nicks = async (body) => (await body.json()).top3.map((r) => r.nick);

  // 자리가 남는 동안은 더 나쁜 기록도 진입한다 (min: 작을수록 좋음)
  assert.equal((await (await post(records, { game: "touch25", nick: "철수", score: 15.2, dir: "min" })).json()).accepted, true);

  let body = await (await post(records, { game: "touch25", nick: "영희", score: 20, dir: "min" })).json();
  assert.equal(body.accepted, true);            // 2위로 진입
  assert.equal(body.record.nick, "철수");        // 1위는 여전히 철수
  assert.deepEqual(body.top3.map((r) => r.nick), ["철수", "영희"]);

  // 3위까지 채움 → [철수15.2, 민수18, 영희20]
  assert.deepEqual(await nicks(await post(records, { game: "touch25", nick: "민수", score: 18, dir: "min" })), ["철수", "민수", "영희"]);

  // 3위보다 나쁜 새 닉네임은 거절
  body = await (await post(records, { game: "touch25", nick: "꼴찌", score: 25, dir: "min" })).json();
  assert.equal(body.accepted, false);
  assert.deepEqual(body.top3.map((r) => r.nick), ["철수", "민수", "영희"]);

  // 같은 닉네임의 더 좋은 기록 → 순위 갱신, 중복 없음
  body = await (await post(records, { game: "touch25", nick: "영희", score: 12.01, dir: "min" })).json();
  assert.equal(body.accepted, true);
  assert.equal(body.record.nick, "영희");        // 새 1위
  assert.deepEqual(body.top3.map((r) => r.nick), ["영희", "철수", "민수"]);
  assert.equal(body.top3.filter((r) => r.nick === "영희").length, 1);

  // 같은 닉네임의 더 나쁜 기록 재제출 → 순위 불변
  body = await (await post(records, { game: "touch25", nick: "영희", score: 30, dir: "min" })).json();
  assert.equal(body.accepted, false);
  assert.deepEqual(body.top3.map((r) => r.nick), ["영희", "철수", "민수"]);

  // dir 바꿔치기 시도: 서버(min) 기준으로 999는 3위(민수18)보다 나빠 거절
  assert.equal((await (await post(records, { game: "touch25", nick: "해커", score: 999, dir: "max" })).json()).accepted, false);

  const data = await (await records.fetch(new Request("https://records.internal/?game=touch25"))).json();
  assert.equal(data.record.nick, "영희");
  assert.equal(data.record.score, 12.01);
  assert.deepEqual(data.top3.map((r) => r.nick), ["영희", "철수", "민수"]);
});

test("games are independent and old weeks are pruned", async () => {
  const storage = new MemoryStorage([
    ["rec:2000-01-03:touch25", { nick: "고인물", score: 1, dir: "min", at: 0 }],
  ]);
  const records = new RecordsDO({ storage });

  await post(records, { game: "circle", nick: "동글이", score: 95.5, dir: "max" });
  const get = await records.fetch(new Request("https://records.internal/?game=touch25"));
  assert.equal((await get.json()).record, null); // 지난주 기록은 이번 주에 안 보임
  assert.equal(storage.data.has("rec:2000-01-03:touch25"), false); // 정리됨

  const circle = await records.fetch(new Request("https://records.internal/?game=circle"));
  assert.equal((await circle.json()).record.nick, "동글이");
});

test("stores display text and serves batch lookups for category homes", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });
  await post(records, { game: "touch25", nick: "철수", score: 12.34, dir: "min", text: "12.34초" });
  await post(records, { game: "circle", nick: "동글이", score: 95.5, dir: "max", text: "95.5%" });
  // 수상한 text는 숫자로 대체
  await post(records, { game: "2048", nick: "해커", score: 100, dir: "max", text: "<img onerror=x>" });
  const ten = await post(records, { game: "10sec", nick: "시계왕", score: 0.123, text: "오차 0.123초" });
  assert.equal((await ten.json()).record.text, "오차 123 ms");

  const res = await records.fetch(
    new Request("https://records.internal/?games=touch25,circle,2048,10sec,lotto,invalid game!!"),
  );
  const { records: batch } = await res.json();
  assert.equal(batch.touch25.text, "12.34초");
  assert.equal(batch.circle.text, "95.5%");
  assert.equal(batch["2048"].text, "100");
  assert.equal(batch["10sec"].text, "오차 123 ms"); // 예전 초 단위 저장분도 ms로 정규화
  assert.equal("lotto" in batch, false); // 기록 없는 게임은 빠진다
});

test("stores an all-time personal best per browser and game", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });
  const vid = "00000000-0000-4000-8000-000000000001";
  const personal = (body) => records.fetch(new Request("https://records.internal/_personal", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vid, game: "reactiontime", ...body }),
  }));

  assert.equal((await (await personal({ score: 250, text: "250ms" })).json()).accepted, true);
  assert.equal((await (await personal({ score: 300, text: "300ms" })).json()).accepted, false);
  assert.equal((await (await personal({ score: 190, text: "190ms" })).json()).accepted, true);

  const response = await records.fetch(new Request(
    `https://records.internal/?games=reactiontime,lotto&vid=${vid}`,
  ));
  const data = await response.json();
  assert.equal(data.personal.reactiontime.score, 190);
  assert.deepEqual(data.supported, ["reactiontime"]);
});

test("admin can list this week's records and reset one", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });
  await post(records, { game: "beer", nick: "맥주왕", score: 3.2, text: "오차 3cc·1.2초" });
  await post(records, { game: "circle", nick: "동글이", score: 95.5 });

  let res = await records.fetch(new Request("https://records.internal/_allrecords"));
  let { records: all } = await res.json();
  assert.deepEqual(Object.keys(all).sort(), ["beer", "circle"]);
  assert.equal(all.beer.nick, "맥주왕");

  // beer만 리셋
  res = await records.fetch(
    new Request("https://records.internal/_records?game=beer", { method: "DELETE" }),
  );
  assert.equal(res.status, 204);
  res = await records.fetch(new Request("https://records.internal/_allrecords"));
  all = (await res.json()).records;
  assert.deepEqual(Object.keys(all), ["circle"]);

  // 주간 리셋은 top3까지 비운다
  const afterReset = await (await records.fetch(new Request("https://records.internal/?game=beer"))).json();
  assert.equal(afterReset.record, null);
  assert.deepEqual(afterReset.top3, []);

  // 리셋 후 새 기록이 다시 들어간다
  const again = await post(records, { game: "beer", nick: "새주인", score: 10 });
  assert.equal((await again.json()).accepted, true);
});

test("all-time hall of fame: updates on accept, survives weekly pruning", async () => {
  const storage = new MemoryStorage([
    // 올타임 도입 전에 세워진 지난주 기록 (아직 올타임에 없음)
    ["rec:2000-01-03:touch25", { nick: "고인물", score: 9.9, text: "9.90초", dir: "min", at: 0 }],
  ]);
  const records = new RecordsDO({ storage });
  const alltime = async () => {
    const res = await records.fetch(new Request("https://records.internal/?alltime=1"));
    return (await res.json()).records;
  };

  // 이번 주 기록이 들어오면 지난주 것은 프루닝 전에 올타임으로 흡수된다
  await post(records, { game: "touch25", nick: "뉴비", score: 20 });
  assert.equal(storage.data.has("rec:2000-01-03:touch25"), false);
  assert.equal((await alltime()).touch25.nick, "고인물"); // 20초 < 9.9초 아님

  // 올타임보다 좋은 기록이 들어오면 교체된다
  await post(records, { game: "touch25", nick: "신기록", score: 5.5 });
  assert.equal((await alltime()).touch25.nick, "신기록");

  // 올타임 저장분이 없어도 이번 주 기록은 병합돼 보인다 (이행기)
  await post(records, { game: "circle", nick: "동글이", score: 95.5 });
  await storage.delete("alltime:circle");
  assert.equal((await alltime()).circle.nick, "동글이");

  // 주간 리셋(DELETE)은 올타임에 손대지 않고, alltime 파라미터로만 지운다
  await records.fetch(new Request("https://records.internal/?game=touch25", { method: "DELETE" }));
  assert.equal((await alltime()).touch25.nick, "신기록");
  await records.fetch(new Request("https://records.internal/?game=touch25&alltime=1", { method: "DELETE" }));
  assert.equal("touch25" in (await alltime()), false);
});

test("notice: set, piggybacks on record reads, delete, validation", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });
  const notice = (method, body) => records.fetch(new Request("https://records.internal/_notice", {
    method,
    ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }));

  assert.equal((await notice("POST", { text: "  지난주 통합 1위는 김윤배님!  " })).status, 201);
  assert.equal((await notice("POST", { text: "" })).status, 400);
  assert.equal((await notice("POST", { text: "가".repeat(201) })).status, 400);
  assert.equal((await (await notice("GET")).json()).notice.text, "지난주 통합 1위는 김윤배님!");

  // 기록 조회(단건·배치) 응답에 공지가 실려온다
  let res = await records.fetch(new Request("https://records.internal/?game=circle"));
  assert.equal((await res.json()).notice.text, "지난주 통합 1위는 김윤배님!");
  res = await records.fetch(new Request("https://records.internal/?games=circle,touch25"));
  assert.equal((await res.json()).notice.text, "지난주 통합 1위는 김윤배님!");

  assert.equal((await notice("DELETE")).status, 204);
  assert.equal((await (await notice("GET")).json()).notice, null);
  res = await records.fetch(new Request("https://records.internal/?game=circle"));
  assert.equal((await res.json()).notice, null);
});

test("suggestion box: submit, list newest-first, delete, daily cap", async (t) => {
  // at은 Date.now()라 같은 밀리초에 제출되면 최신순 정렬이 동률로 뒤섞인다.
  // 시계를 단조 증가로 고정해 순서를 결정적으로 만든다.
  const realNow = Date.now;
  let tick = realNow();
  Date.now = () => ++tick;
  t.after(() => { Date.now = realNow; });

  const storage = new MemoryStorage();
  const records = new RecordsDO({ storage });
  const vid = "00000000-0000-4000-8000-000000000001";
  const suggest = (body) => records.fetch(new Request("https://records.internal/_suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vid, date: "2026-07-11", ...body }),
  }));

  // 정상 제출 (앞뒤 공백·연속 공백 정리)
  let res = await suggest({ text: "  테트리스   만들어줘요  ", page: "slop" });
  assert.equal(res.status, 201);
  // 잘못된 제출
  assert.equal((await suggest({ text: "" })).status, 400);
  assert.equal((await suggest({ text: "가".repeat(201) })).status, 400);

  // 하루 5건 제한 (위에서 1건 사용)
  for (let i = 0; i < 4; i++) {
    assert.equal((await suggest({ text: `아이디어 ${i}` })).status, 201);
  }
  assert.equal((await suggest({ text: "6번째" })).status, 429);

  // 목록: 최신순 + 정리된 텍스트
  res = await records.fetch(new Request("https://records.internal/_suggestions"));
  const { items } = await res.json();
  assert.equal(items.length, 5);
  assert.equal(items[items.length - 1].text, "테트리스 만들어줘요");
  assert.equal(items[items.length - 1].page, "slop");

  // 삭제
  res = await records.fetch(new Request(
    `https://records.internal/_suggestions?id=${encodeURIComponent(items[0].id)}`,
    { method: "DELETE" },
  ));
  assert.equal(res.status, 204);
  const after = await (await records.fetch(new Request("https://records.internal/_suggestions"))).json();
  assert.equal(after.items.length, 4);
});

test("rejects malformed submissions", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });
  const bad = [
    { game: "touch25", nick: "일곱글자닉네임", score: 1 },  // 6자 초과
    { game: "touch25", nick: "한 글", score: 1 },           // 공백
    { game: "touch25", nick: "nick!", score: 1 },           // 특수문자
    { game: "touch25", nick: "철수", score: "12" },         // 문자열 점수
    { game: "touch25", nick: "철수", score: Infinity },
    { game: "Touch 25", nick: "철수", score: 1 },           // 게임 이름
    { game: "lotto", nick: "철수", score: 1 },              // GAMES 미등록
    { game: "touch25", nick: "철수", score: -1 },           // 범위 밖 (min 0)
    { game: "touch25", nick: "철수", score: 999999 },       // 범위 밖 (max 3600)
    { game: "circle", nick: "철수", score: 100.1 },         // 100% 초과
    { game: "reactiontime", nick: "봇임", score: 1 },       // 인간 불가능 반응속도
  ];
  for (const body of bad) {
    const res = await post(records, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  // 한글/영문/숫자 6자 + 범위 내 점수는 통과
  const ok = await post(records, { game: "touch25", nick: "김a1나2", score: 1 });
  assert.equal(ok.status, 200);
});
