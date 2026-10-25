import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOT_NAME, MAX_AGE_MS, buildContext, buildMessages, createAssistant, parseTrigger, plan, validateAction, ymd,
} from "./assistant.mjs";

const NOW = new Date(2026, 9, 25, 12, 0).getTime(); // 2026-10-25 (일) 정오, 로컬
const TODAY = ymd(new Date(NOW));
const EVENTS = [
  { id: "aaaaaa1", rev: 1, deleted: false, date: "2026-10-31", title: "르파비스 임장", owner: "도형", shared: true, start: "10:00" },
  { id: "aaaaaa2", rev: 1, deleted: false, date: "2026-11-03", endDate: "2026-11-04", title: "출장", owner: "도형", shared: false },
  { id: "aaaaaa3", rev: 1, deleted: false, date: "2026-10-27", title: "운동", recur: { freq: "weekly" }, shared: true },
  { id: "cmt0001", rev: 1, deleted: false, kind: "comment", eventId: "aaaaaa1", text: "주차 확인", author: "도형" },
  { id: "mark001", rev: 1, deleted: false, kind: "marker", date: "2026-10-30", marker: "🎂" },
  { id: "gone001", rev: 1, deleted: true },
];

function harness(answers) {
  const said = [], applied = [];
  const asks = [];
  const a = createAssistant({
    ask: async (messages) => { asks.push(messages); const x = answers.shift(); if (x instanceof Error) throw x; return x; },
    events: () => EVENTS,
    apply: async (p) => { applied.push(p); },
    say: async (t) => { said.push(t); },
  }, { now: () => NOW });
  const send = (text, extra = {}) => a.onMessage({ name: "도형", text, at: NOW - 1000, ...extra });
  return { said, applied, asks, send };
}

test("@비서 로 시작하는 말만 명령이다", () => {
  assert.equal(parseTrigger("@비서 내일 회의 넣어줘"), "내일 회의 넣어줘");
  assert.equal(parseTrigger("  @비서이번 주 일정"), "이번 주 일정");
  assert.equal(parseTrigger("비서야 해줘"), null);
  assert.equal(parseTrigger(undefined), null);
});

test("문맥: 일반 일정만 별칭으로, 날짜표는 오늘부터 21일", () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.deepEqual([...ctx.aliases.values()].map((e) => e.id), ["aaaaaa3", "aaaaaa1", "aaaaaa2"]);
  assert.equal(ctx.days.length, 21);
  assert.match(ctx.days[0], /^2026-10-25 일 \(오늘\)$/);
  assert.match(ctx.days[6], /^2026-10-31 토$/);
  const [sys, user] = buildMessages("토요일 임장 일정 지워줘", ctx);
  assert.match(sys.content, /e2: 2026-10-31 10:00 "르파비스 임장"/);
  assert.equal(user.content, "토요일 임장 일정 지워줘");
});

test("검증: 모델이 지어낸 날짜·id·시간은 통과시키지 않는다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.equal(validateAction({ op: "add", title: "회의", date: "2026-02-30" }, ctx, TODAY).op, "unknown");
  assert.equal(validateAction({ op: "add", title: "", date: "2026-10-30" }, ctx, TODAY).op, "unknown");
  assert.equal(validateAction({ op: "add", title: "회의", date: "2026-10-30", start: "25:00" }, ctx, TODAY).op, "unknown");
  assert.equal(validateAction({ op: "delete", id: "e99" }, ctx, TODAY).op, "unknown");
  assert.equal(validateAction({ op: "delete", id: "e1" }, ctx, TODAY).reason, "반복 일정은 캘린더 탭에서 고쳐 주세요");
  assert.equal(validateAction(null, ctx, TODAY).op, "unknown");
  const bad = validateAction({ op: "add", title: "회의", date: "2026-10-30", start: "15:00", end: "14:00" }, ctx, TODAY);
  assert.equal(bad.start, "15:00");
  assert.equal(bad.end, undefined); // 끝이 시작보다 앞이면 끝을 버린다
});

test("추가는 바로 하고, 웹앱과 같은 일정 구조로 만든다", async () => {
  const h = harness([{ op: "add", title: "르파비스 임장", date: "2026-11-01", start: "10:00" }]);
  await h.send("@비서 다음 일요일 10시 르파비스 임장 넣어줘");
  assert.equal(h.applied.length, 1);
  const { puts, dels } = h.applied[0];
  assert.equal(dels.length, 0);
  assert.match(puts[0].id, /^[a-z0-9]{12}$/); // 서버 CAL_ID(영숫자 6~40)
  assert.deepEqual(puts[0].content, { date: "2026-11-01", title: "르파비스 임장", owner: "도형", shared: true, start: "10:00" });
  assert.equal(h.said[0], '📅 "르파비스 임장" 일정 추가됨 (11/1 (일) 10:00)');
});

test("옮기기·삭제는 되묻고 '@비서 응' 이어야 실행한다", async () => {
  const h = harness([{ op: "move", id: "e2", date: "2026-11-01" }, { op: "delete", id: "e3" }]);
  await h.send("@비서 임장 일요일로 옮겨줘");
  assert.equal(h.applied.length, 0);
  assert.match(h.said[0], /옮길까요/);
  await h.send("@비서 응");
  assert.equal(h.applied.length, 1);
  assert.deepEqual(h.applied[0].puts[0].content,
    { date: "2026-11-01", title: "르파비스 임장", owner: "도형", shared: true, start: "10:00" });
  assert.match(h.said[1], /→ 11\/1 \(일\) 10:00로 옮김/);

  await h.send("@비서 출장 지워줘");
  await h.send("@비서 취소");
  assert.equal(h.applied.length, 1);
  assert.equal(h.said.at(-1), "🤖 취소했어요");
  assert.equal(h.asks.length, 2); // 응/취소는 모델에 묻지 않는다
});

test("삭제하면 그 일정의 댓글도 같이 지운다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  const p = plan(validateAction({ op: "delete", id: "e2" }, ctx, TODAY), { events: EVENTS, sender: "도형", now: 5 });
  assert.deepEqual(p.dels, [{ id: "aaaaaa1", rev: 5 }, { id: "cmt0001", rev: 5 }]);
});

test("여러 날 일정을 옮기면 종료일도 같이 민다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  const p = plan(validateAction({ op: "move", id: "e3", date: "2026-11-05" }, ctx, TODAY), { events: EVENTS, sender: "도형" });
  assert.equal(p.puts[0].content.date, "2026-11-05");
  assert.equal(p.puts[0].content.endDate, "2026-11-06");
});

test("조회: 범위 안 일반 일정만, 반복은 빼고", () => {
  const p = plan({ op: "list", from: "2026-10-25", to: "2026-11-05" }, { events: EVENTS, sender: "도형" });
  assert.equal(p.reply.split("\n")[0], "📅 10/25 (일) ~ 11/5 (목) 일정 2개");
  assert.match(p.reply, /10\/31 \(토\) 10:00 르파비스 임장/);
  assert.match(p.reply, /11\/3 \(화\) ~ 11\/4 \(수\) 출장/);
});

test("늦게 받은 명령·비서 자신의 말·일반 대화는 무시한다", async () => {
  const h = harness([]);
  await h.send("@비서 내일 회의", { at: NOW - MAX_AGE_MS - 1 });
  assert.match(h.said[0], /PC가 꺼져 있던 때/);
  await h.send("@비서 내일 회의", { at: NOW - 24 * 3600_000 }); // 아주 오래된 건 답도 안 한다
  await a_noop(h);
  assert.equal(h.said.length, 1);
  assert.equal(h.asks.length, 0);
});
async function a_noop(h) {
  await h.send("오늘 저녁 뭐 먹지");
  await createAssistant({ ask: async () => { throw new Error("불리면 안 됨"); }, events: () => [], apply: async () => {}, say: async () => { throw new Error("답하면 안 됨"); } }, { now: () => NOW })
    .onMessage({ name: BOT_NAME, text: "@비서 응", at: NOW });
}

test("모델이 죽어 있으면 그렇다고 답한다", async () => {
  const h = harness([new Error("ECONNREFUSED")]);
  await h.send("@비서 내일 회의 넣어줘");
  assert.equal(h.applied.length, 0);
  assert.match(h.said[0], /Ollama/);
});

test("비서가 암호화한 일정은 싱크 저장 계층이 그대로 푼다(웹앱과 같은 프레임)", async () => {
  const { deriveKey, encryptJson, createStore } = await import("./store.mjs");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "duri-asst-"));
  try {
    const key = await deriveKey("우리만아는긴문장");
    const store = createStore({ dir, key, fetchPhoto: async () => new Uint8Array() });
    const content = { date: "2026-11-01", title: "임장", owner: "도형", shared: true, start: "10:00" };
    const f = await encryptJson(key, content);
    await store.persistCalendar([{ id: "abcdef123456", rev: 7, iv: f.iv, ct: f.ct }]);
    assert.deepEqual(store.calendarEvents(), [{ id: "abcdef123456", rev: 7, deleted: false, ...content }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ollamaAsk: /api/chat 에 JSON 형식으로 묻고 content 를 파싱한다", async () => {
  const { ollamaAsk } = await import("./assistant.mjs");
  const { createServer } = await import("node:http");
  let got;
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (c) => { b += c; });
    req.on("end", () => {
      got = { url: req.url, body: JSON.parse(b) };
      res.end(JSON.stringify({ message: { content: '{"op":"list","from":"2026-10-25","to":"2026-10-31"}' } }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const ask = ollamaAsk({ url: `http://127.0.0.1:${srv.address().port}/`, model: "qwen2.5:7b" });
    const out = await ask([{ role: "user", content: "이번 주" }]);
    assert.deepEqual(out, { op: "list", from: "2026-10-25", to: "2026-10-31" });
    assert.equal(got.url, "/api/chat");
    assert.equal(got.body.format, "json");
    assert.equal(got.body.stream, false);
    assert.equal(got.body.model, "qwen2.5:7b");
  } finally { srv.close(); }
});
