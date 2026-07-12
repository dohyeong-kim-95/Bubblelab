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

test("keeps only the best record per game and lets a better one claim it", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });

  let res = await post(records, { game: "touch25", nick: "철수", score: 15.2, dir: "min" });
  assert.equal((await res.json()).accepted, true);

  // 더 나쁜 기록은 거절 (min이므로 큰 값이 나쁨)
  res = await post(records, { game: "touch25", nick: "영희", score: 20, dir: "min" });
  let body = await res.json();
  assert.equal(body.accepted, false);
  assert.equal(body.record.nick, "철수");

  // 더 좋은 기록은 교체
  res = await post(records, { game: "touch25", nick: "영희", score: 12.01, dir: "min" });
  body = await res.json();
  assert.equal(body.accepted, true);
  assert.equal(body.record.nick, "영희");

  // dir 바꿔치기 시도: 클라이언트 dir은 무시되고 서버 설정(min)으로 비교된다
  res = await post(records, { game: "touch25", nick: "해커", score: 999, dir: "max" });
  assert.equal((await res.json()).accepted, false);

  const get = await records.fetch(new Request("https://records.internal/?game=touch25"));
  const data = await get.json();
  assert.equal(data.record.nick, "영희");
  assert.equal(data.record.score, 12.01);
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

  const res = await records.fetch(
    new Request("https://records.internal/?games=touch25,circle,2048,lotto,invalid game!!"),
  );
  const { records: batch } = await res.json();
  assert.equal(batch.touch25.text, "12.34초");
  assert.equal(batch.circle.text, "95.5%");
  assert.equal(batch["2048"].text, "100");
  assert.equal("lotto" in batch, false); // 기록 없는 게임은 빠진다
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

  // 리셋 후 새 기록이 다시 들어간다
  const again = await post(records, { game: "beer", nick: "새주인", score: 10 });
  assert.equal((await again.json()).accepted, true);
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
