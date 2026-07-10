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

  // dir 바꿔치기 시도: 첫 기록의 dir(min)로 비교되어 거절된다
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

test("rejects malformed submissions", async () => {
  const records = new RecordsDO({ storage: new MemoryStorage() });
  const bad = [
    { game: "touch25", nick: "일곱글자닉네임", score: 1, dir: "min" }, // 6자 초과
    { game: "touch25", nick: "한 글", score: 1, dir: "min" },          // 공백
    { game: "touch25", nick: "nick!", score: 1, dir: "min" },          // 특수문자
    { game: "touch25", nick: "철수", score: "12", dir: "min" },        // 문자열 점수
    { game: "touch25", nick: "철수", score: Infinity, dir: "min" },
    { game: "touch25", nick: "철수", score: 1, dir: "sideways" },
    { game: "Touch 25", nick: "철수", score: 1, dir: "min" },          // 게임 이름
  ];
  for (const body of bad) {
    const res = await post(records, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  // 한글/영문/숫자 6자는 통과
  const ok = await post(records, { game: "touch25", nick: "김a1나2", score: 1, dir: "min" });
  assert.equal(ok.status, 200);
});
