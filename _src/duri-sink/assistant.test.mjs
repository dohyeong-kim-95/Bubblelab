import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOT_NAME, MAX_AGE_MS, briefDue, briefFacts, briefFallback, buildBriefingMessages, buildContext, buildMessages, buildRecommendMessages,
  calEventOnDate, chatSticker, createAssistant, memoryFacts, onThisDay, spreadPick, countSaid, fitId, kstYmd, parseTrigger, plan, validateAction, whoKey, ymd,
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

test("@당이·@당·@당아 로 시작하는 말만 명령이다", () => {
  assert.equal(parseTrigger("@당이 내일 회의 넣어줘"), "내일 회의 넣어줘");
  assert.equal(parseTrigger("@당아 우리 봉천동 언제 갔었지?"), "우리 봉천동 언제 갔었지?");
  assert.equal(parseTrigger("@당야, 안녕"), "안녕");
  assert.equal(parseTrigger("@당이야! 고마워"), "고마워");
  assert.equal(parseTrigger("@당아지 귀여워"), null);
  assert.equal(parseTrigger("  @당 이번 주 일정"), "이번 주 일정");
  assert.equal(parseTrigger("@당이"), "");
  assert.equal(parseTrigger("@당근 사 와"), null); // 뒤에 공백이 없으면 다른 말이다
  assert.equal(parseTrigger("@비서 해줘"), null);
  assert.equal(parseTrigger("당이야 해줘"), null);
  assert.equal(parseTrigger(undefined), null);
});

test("문맥: 일반 일정만 별칭으로, 날짜표는 오늘부터 60일 + 지난 7일은 따로", () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.deepEqual([...ctx.aliases.values()].map((e) => e.id), ["aaaaaa3", "aaaaaa1", "aaaaaa2"]);
  assert.equal(ctx.days.length, 60);
  assert.match(ctx.days[0], /^2026-10-25 일 \(오늘\)$/);
  assert.match(ctx.days[6], /^2026-10-31 토$/);
  assert.match(ctx.days[24], /^2026-11-18 수$/);
  assert.match(ctx.past, /^2026-10-24 토 \(어제\), 2026-10-23 금 \(그제\), .*2026-10-18 일$/);
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
  await h.send("@당이 다음 일요일 10시 르파비스 임장 넣어줘");
  assert.equal(h.applied.length, 1);
  const { puts, dels } = h.applied[0];
  assert.equal(dels.length, 0);
  assert.match(puts[0].id, /^[a-z0-9]{12}$/); // 서버 CAL_ID(영숫자 6~40)
  assert.deepEqual(puts[0].content, { date: "2026-11-01", title: "르파비스 임장", owner: "도형", shared: true, start: "10:00" });
  assert.equal(h.said[0], '📅 "르파비스 임장" 일정 추가됨 (11/1 (일) 10:00)');
});

test("옮기기·삭제는 되묻고 '@당이 응' 이어야 실행한다", async () => {
  const h = harness([{ op: "move", id: "e2", date: "2026-11-01" }, { op: "delete", id: "e3" }]);
  await h.send("@당이 임장 일요일로 옮겨줘");
  assert.equal(h.applied.length, 0);
  assert.match(h.said[0], /옮길까요/);
  await h.send("@당이 응");
  assert.equal(h.applied.length, 1);
  assert.deepEqual(h.applied[0].puts[0].content,
    { date: "2026-11-01", title: "르파비스 임장", owner: "도형", shared: true, start: "10:00" });
  assert.match(h.said[1], /→ 11\/1 \(일\) 10:00로 옮김/);

  await h.send("@당이 출장 지워줘");
  await h.send("@당이 취소");
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

test("늦게 받은 명령·당이 자신의 말·일반 대화는 조용히 무시한다", async () => {
  const h = harness([]);
  // PC 가 꺼져 있던 동안의 명령 — 그때 앱이 이미 "자고 있어요" 라고 했다.
  await h.send("@당이 내일 회의", { at: NOW - MAX_AGE_MS - 1 });
  await a_noop(h);
  assert.equal(h.said.length, 0);
  assert.equal(h.asks.length, 0);
});
async function a_noop(h) {
  await h.send("오늘 저녁 뭐 먹지");
  await createAssistant({ ask: async () => { throw new Error("불리면 안 됨"); }, events: () => [], apply: async () => {}, say: async () => { throw new Error("답하면 안 됨"); } }, { now: () => NOW })
    .onMessage({ name: BOT_NAME, text: "@당이 응", at: NOW });
}

test("모델이 죽어 있으면 그렇다고 답한다", async () => {
  const h = harness([new Error("ECONNREFUSED")]);
  await h.send("@당이 내일 회의 넣어줘");
  assert.equal(h.applied.length, 0);
  assert.match(h.said[0], /모델 서버/);
});

test("당이가 암호화한 일정은 싱크 저장 계층이 그대로 푼다(웹앱과 같은 프레임)", async () => {
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
    const ask = ollamaAsk({ url: `http://127.0.0.1:${srv.address().port}/`, model: "qwen2.5:7b", keepAlive: "1h" });
    const out = await ask([{ role: "user", content: "이번 주" }]);
    assert.deepEqual(out, { op: "list", from: "2026-10-25", to: "2026-10-31" });
    assert.equal(got.url, "/api/chat");
    assert.equal(got.body.format, "json");
    assert.equal(got.body.stream, false);
    assert.equal(got.body.model, "qwen2.5:7b");
    assert.equal(got.body.keep_alive, "1h");
  } finally { srv.close(); }
});

test("llamaAsk: /v1/chat/completions 에 JSON·속생각 끄기로 묻고 content 를 파싱한다", async () => {
  const { llamaAsk } = await import("./assistant.mjs");
  const { createServer } = await import("node:http");
  let got;
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (c) => { b += c; });
    req.on("end", () => {
      got = { url: req.url, body: JSON.parse(b) };
      res.end(JSON.stringify({ choices: [{ message: { content: '{"op":"chat","reply":"푸히힝"}' } }] }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const ask = llamaAsk({ url: `http://127.0.0.1:${srv.address().port}/` });
    const out = await ask([{ role: "user", content: "안녕" }]);
    assert.deepEqual(out, { op: "chat", reply: "푸히힝" });
    assert.equal(got.url, "/v1/chat/completions");
    assert.deepEqual(got.body.response_format, { type: "json_object" });
    assert.equal(got.body.temperature, 0);
    assert.equal(got.body.cache_prompt, true);
    assert.equal(got.body.chat_template_kwargs.enable_thinking, false);
  } finally { srv.close(); }
});

test("install.sh 가 데몬이 import 하는 모듈을 전부 복사한다", async () => {
  const { readFileSync } = await import("node:fs");
  const here = new URL(".", import.meta.url);
  const sink = readFileSync(new URL("duri-sink.mjs", here), "utf8");
  const install = readFileSync(new URL("install.sh", here), "utf8");
  const local = [...sink.matchAll(/from "\.\/([\w-]+\.mjs)"/g)].map((m) => m[1]);
  assert.ok(local.includes("assistant.mjs"));
  for (const f of local) assert.match(install, new RegExp(`\\$HERE/${f.replace(".", "\\.")}`), `install.sh 가 ${f} 를 복사하지 않는다`);
});

test("잡담: chat 은 말투 그대로 답만 하고 캘린더는 건드리지 않는다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  const [sys] = buildMessages("안녕", ctx);
  assert.match(sys.content, /다그당스/);
  assert.match(sys.content, /사과랑 각설탕/);
  assert.match(sys.content, /"op":"chat"/);
  const a = validateAction({ op: "chat", reply: "  안녕! 오늘도 힘내승~ 푸히힝  " }, ctx, TODAY);
  assert.deepEqual(a, { op: "chat", reply: "안녕! 오늘도 힘내승~ 푸히힝" });
  assert.deepEqual(plan(a, { events: EVENTS, sender: "도경" }), { puts: [], dels: [], reply: "안녕! 오늘도 힘내승~ 푸히힝" });
  assert.equal(validateAction({ op: "chat", reply: "  " }, ctx, TODAY).op, "unknown");
  assert.equal(validateAction({ op: "chat", reply: "가".repeat(900) }, ctx, TODAY).reply.length, 400);
});

test("운동: whoKey·fitId 가 웹앱(duri/index.html)과 같은 id 를 만든다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../../duri/index.html", import.meta.url), "utf8");
  const src = html.match(/function whoKey\(name\) \{[\s\S]*?\n\}/)[0];
  const appWhoKey = new Function(`${src}; return whoKey;`)();
  for (const name of ["도경", "민지", "Kim", "🐴 당근", ""]) assert.equal(whoKey(name), appWhoKey(name));
  assert.match(html, /const fitId = \(month, name\) => `wk\$\{month\.replace\("-", ""\)\}\$\{whoKey\(name\)\}`;/);
  assert.equal(fitId("2026-10", "도경"), `wk202610${whoKey("도경")}`);
});

test("운동: fit 은 말한 사람 달 레코드에 그날을 더하고, 기존 날·메모는 지킨다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  const id = fitId("2026-10", "도경");
  const events = [...EVENTS, { id, rev: 1, deleted: false, kind: "workout", month: "2026-10", owner: "도경", days: { "3": { at: 1, memo: "러닝" } } }];
  const a = validateAction({ op: "fit", memo: " 헬스 1시간 " }, ctx, TODAY); // 날짜 없으면 오늘
  assert.deepEqual(a, { op: "fit", date: "2026-10-25", memo: "헬스 1시간" });
  const p = plan(a, { events, sender: "도경", now: 99 });
  assert.equal(p.puts[0].id, id);
  assert.deepEqual(p.puts[0].content, { kind: "workout", month: "2026-10", owner: "도경", at: 99,
    days: { "3": { at: 1, memo: "러닝" }, "25": { at: 99, memo: "헬스 1시간" } } });
  assert.match(p.reply, /도경님 10\/25 \(일\) 운동 완료! — 헬스 1시간 \(10월 2회째\)/);
  // 상대 레코드는 따로 — 민지가 하면 민지 id
  assert.equal(plan(a, { events, sender: "민지", now: 99 }).puts[0].id, fitId("2026-10", "민지"));
  assert.equal(validateAction({ op: "fit", date: "2026-10-26" }, ctx, TODAY).op, "unknown"); // 미래
});

test("운동: unfit 은 그날만 빼고, 없으면 아무것도 안 쓴다 / fitlist 는 둘 다 센다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  const mine = { id: fitId("2026-10", "도경"), rev: 1, deleted: false, kind: "workout", month: "2026-10", owner: "도경", days: { "3": { at: 1 }, "24": { at: 2 } } };
  const hers = { id: fitId("2026-10", "민지"), rev: 1, deleted: false, kind: "workout", month: "2026-10", owner: "민지", days: { "10": { at: 1 } } };
  const events = [...EVENTS, mine, hers];
  const off = plan(validateAction({ op: "unfit", date: "2026-10-24" }, ctx, TODAY), { events, sender: "도경", now: 5 });
  assert.deepEqual(off.puts[0].content.days, { "3": { at: 1 } });
  assert.deepEqual(plan(validateAction({ op: "unfit", date: "2026-10-20" }, ctx, TODAY), { events, sender: "도경" }).puts, []);
  const list = plan(validateAction({ op: "fitlist" }, ctx, TODAY), { events, sender: "도경" });
  assert.equal(list.reply, "💪 10월 운동 기록\n· 도경 2회 (3, 24일)\n· 민지 1회 (10일)");
  assert.equal(plan(validateAction({ op: "fitlist", month: "2026-09" }, ctx, TODAY), { events, sender: "도경" }).reply, "💪 9월 운동 기록이 아직 없어요");
});

test("시간: 하나만 end 에 들어오면 시작 시각으로 본다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  const a = validateAction({ op: "add", title: "치과", date: "2026-10-26", start: "", end: "15:00" }, ctx, TODAY);
  assert.equal(a.start, "15:00");
  assert.equal(a.end, undefined);
});

test("운동: 달 이름표가 프롬프트에 있고, 내용 없는 메모는 버린다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.match(buildMessages("지난달 운동", ctx)[0].content, /달: 이번 달 2026-10, 지난달 2026-09, 다음 달 2026-11/);
  assert.deepEqual(validateAction({ op: "fit", memo: "운동" }, ctx, TODAY), { op: "fit", date: "2026-10-25" });
  assert.deepEqual(validateAction({ op: "fit", memo: "운동 인증" }, ctx, TODAY), { op: "fit", date: "2026-10-25" });
  assert.equal(validateAction({ op: "fit", memo: "운동장 5바퀴" }, ctx, TODAY).memo, "운동장 5바퀴");
});

test("운동: 주간 요약은 기간 안 날짜·메모를, 0회인 사람도 보여 준다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.deepEqual(validateAction({ op: "fitlist", week: "this" }, ctx, TODAY), { op: "fitlist", from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(validateAction({ op: "fitlist", week: "last" }, ctx, TODAY), { op: "fitlist", from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(validateAction({ op: "fitlist", week: "this" }, ctx, "2026-10-19"), { op: "fitlist", from: "2026-10-19", to: "2026-10-19" }); // 월요일
  const events = [...EVENTS,
    { id: fitId("2026-10", "도경"), rev: 1, deleted: false, kind: "workout", month: "2026-10", owner: "도경",
      days: { "18": { at: 1 }, "20": { at: 1, memo: "헬스 1시간" }, "24": { at: 1 } } },
    { id: fitId("2026-10", "민지"), rev: 1, deleted: false, kind: "workout", month: "2026-10", owner: "민지", days: { "2": { at: 1 } } },
  ];
  const a = validateAction({ op: "fitlist", from: "2026-10-19", to: "2026-10-31" }, ctx, TODAY);
  assert.deepEqual(a, { op: "fitlist", from: "2026-10-19", to: "2026-10-25" }); // 앞날은 자른다
  assert.equal(plan(a, { events, sender: "도경" }).reply,
    "💪 10/19 (월) ~ 10/25 (일) 운동 요약\n· 도경 2회 — 10/20 (화) 헬스 1시간, 10/24 (토)\n· 민지 0회");
  // 달을 넘는 주도 센다
  const cross = [...events, { id: fitId("2026-11", "민지"), rev: 1, deleted: false, kind: "workout", month: "2026-09", owner: "민지", days: { "30": { at: 1 } } }];
  assert.match(plan(validateAction({ op: "fitlist", from: "2026-09-28", to: "2026-10-04" }, ctx, TODAY), { events: cross, sender: "도경" }).reply,
    /민지 2회 — 9\/30 \(수\), 10\/2 \(금\)/);
  assert.equal(validateAction({ op: "fitlist", from: "2026-01-01", to: "2026-10-25" }, ctx, TODAY).op, "unknown");
});

test("운동: 운동 낱말이 없으면 운동 동작을 쓰지 않는다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.deepEqual(validateAction({ op: "fitlist", from: "2026-10-26", to: "2026-11-01" }, ctx, TODAY, "이번 주 일정"),
    { op: "list", from: "2026-10-26", to: "2026-11-01" });
  assert.equal(validateAction({ op: "fit", date: "2026-10-25" }, ctx, TODAY, "제주 여행 넣어줘").op, "unknown");
  assert.equal(validateAction({ op: "fit", date: "2026-10-25" }, ctx, TODAY, "오늘 러닝했어").op, "fit");
  assert.equal(validateAction({ op: "fitlist" }, ctx, TODAY, "이번주 운동 요약해줘").op, "fitlist");
});

test("기억: recall 은 백업에서 찾은 줄만 모델에 주고 그 답을 한다(쓰기 없음)", async () => {
  const said = [], asks = [], searched = [], applied = [];
  const answers = [{ op: "recall", query: "카페 이름" }, { reply: "어니언이었승! 푸히힝" }];
  const a = createAssistant({
    ask: async (m) => { asks.push(m); return answers.shift(); },
    events: () => EVENTS, apply: async (p) => { applied.push(p); }, say: async (t) => { said.push(t); },
    archive: { search: (q) => { searched.push(q); return ["9/12 (토) 13:00 도경: 성수동 카페 어니언 가자"]; } },
  }, { now: () => NOW });
  await a.onMessage({ name: "민지", text: "@당이 우리 갔던 카페 이름 뭐였지", at: NOW - 1000 });
  assert.deepEqual(searched, [{ terms: ["카페", "이름"], from: "2023-10-23", to: "2026-10-25" }]); // 기간 없으면 3년(3×366일)
  assert.match(asks[1][0].content, /성수동 카페 어니언 가자/);
  assert.match(asks[1][1].content, /말한 사람: 민지/);
  assert.equal(asks[1][2].content, "우리 갔던 카페 이름 뭐였지");
  assert.deepEqual(said, ["잠깐만! 찾아볼게승~ 🐴", "어니언이었승! 푸히힝"]); // 먼저 "잠깐만", 그다음 답
  assert.equal(applied.length, 0);
});

test("기억: 기간 해석, 못 찾음, 백업 없음", async () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.deepEqual(validateAction({ op: "recall", query: "", month: "2026-09" }, ctx, TODAY), { op: "recall", terms: [], from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(validateAction({ op: "recall" }, ctx, TODAY), { op: "recall", terms: [], from: "2026-10-24", to: "2026-10-25" });
  assert.deepEqual(validateAction({ op: "recall", query: "얘기", from: "2026-10-24", to: "2026-10-24" }, ctx, TODAY).terms, []); // 뜻 없는 낱말은 버린다
  assert.deepEqual(validateAction({ op: "recall", query: ["여행"], from: "2026-10-20", to: "2026-12-01" }, ctx, TODAY).to, "2026-10-25");
  const run = async (archive) => {
    const said = [];
    await createAssistant({ ask: async () => ({ op: "recall", query: "제주" }), events: () => [], apply: async () => {}, say: async (t) => { said.push(t); }, archive },
      { now: () => NOW }).onMessage({ name: "민지", text: "@당 제주 언제 갔지", at: NOW });
    return said.at(-1);
  };
  assert.match(await run({ search: () => [] }), /못 찾았승.*"제주"/);
  assert.match(await run(undefined), /백업 기록을 읽을 수 없어요/);
});

const MEMORY_EVENTS = [
  { id: "m1", rev: 1, date: "2026-03-14", endDate: "2026-03-16", title: "제주도 여행", owner: "도경", shared: true },
  { id: "m2", rev: 1, date: "2026-09-12", title: "성수동 데이트", start: "13:00", owner: "민지", shared: true },
  { id: "m3", rev: 1, date: "2026-11-20", title: "제주 출장", owner: "도경", shared: false }, // 아직 안 온 일
  { id: "m4", rev: 1, date: "2026-01-05", title: "테니스 레슨", recur: { freq: "weekly" }, shared: true }, // 반복은 추억 아님
  { id: "m5", rev: 1, kind: "bucket", title: "제주 한라산 등반", done: true, doneAt: new Date(2026, 2, 15, 10).getTime() },
  { id: "m6", rev: 1, kind: "bucket", title: "한강 피크닉", done: true }, // 달성 날짜 없음
  { id: "m7", rev: 1, kind: "bucket", title: "제주 오름", done: false }, // 아직 안 함
];

test("추억: 지난 일정·해낸 버킷리스트에서 낱말·기간이 맞는 것(반복·앞으로 올 일·안 한 것 제외)", () => {
  assert.deepEqual(memoryFacts(MEMORY_EVENTS, { terms: ["제주도"], from: "2023-10-23", to: TODAY }), {
    plans: ["📅 3/14 (토) ~ 3/16 (월) 제주도 여행"],
    bucket: ["✓ 3/15 (일) 버킷리스트 달성: 제주 한라산 등반"],
    spans: [{ from: "2026-03-14", to: "2026-03-16", title: "제주도 여행" }],
  });
  // 낱말 없이 기간만: 그 기간의 것 전부. 달성 날짜 없는 옛 항목은 기간 질문엔 끼지 않는다.
  assert.deepEqual(memoryFacts(MEMORY_EVENTS, { terms: [], from: "2026-09-01", to: "2026-09-30" }),
    { plans: ["📅 9/12 (토) 13:00 성수동 데이트"], bucket: [], spans: [] }); // 기간만이면 여러 날 일정(여행)에서만 사진을 고른다
  assert.deepEqual(memoryFacts(MEMORY_EVENTS, { terms: [], from: "2026-03-01", to: "2026-03-31" }).spans, [{ from: "2026-03-14", to: "2026-03-16", title: "제주도 여행" }]);
  assert.deepEqual(memoryFacts(MEMORY_EVENTS, { terms: [], from: "2026-01-01", to: TODAY }).spans, []); // 긴 기간이면 아무 날이나가 되니 안 고른다
  assert.deepEqual(memoryFacts(MEMORY_EVENTS, { terms: ["한강"], from: "2026-09-01", to: TODAY }).bucket, ["✓ 버킷리스트 달성: 한강 피크닉"]);
  assert.deepEqual(memoryFacts(MEMORY_EVENTS, { terms: ["테니스"], from: "2023-10-23", to: TODAY }), { plans: [], bucket: [], spans: [] });
});

test("추억: recall 은 대화가 없어도 캘린더에 남은 것으로 답한다", async () => {
  const asks = [], said = [];
  const answers = [{ op: "recall", query: "제주도" }, { reply: "3월 14일에 갔승!" }];
  await createAssistant({
    ask: async (m) => { asks.push(m); return answers.shift(); },
    events: () => MEMORY_EVENTS, apply: async () => {}, say: async (t) => { said.push(t); },
    archive: { search: () => [] },
  }, { now: () => NOW }).onMessage({ name: "민지", text: "@당 우리 제주도 언제 갔지", at: NOW });
  assert.match(asks[1][0].content, /지난 일정:\n📅 3\/14 \(토\) ~ 3\/16 \(월\) 제주도 여행/);
  assert.match(asks[1][0].content, /해낸 버킷리스트:\n✓ 3\/15 \(일\) 버킷리스트 달성: 제주 한라산 등반/);
  assert.match(asks[1][0].content, /기록:\n\(없음\)/);
  assert.deepEqual(said, ["잠깐만! 찾아볼게승~ 🐴", "3월 14일에 갔승!"]);
  // 백업이 없어도 캘린더 추억은 읽는다
  const said2 = [], answers2 = [{ op: "recall", query: "제주도" }, { reply: "갔승" }];
  await createAssistant({ ask: async () => answers2.shift(), events: () => MEMORY_EVENTS, apply: async () => {}, say: async (t) => { said2.push(t); } },
    { now: () => NOW }).onMessage({ name: "민지", text: "@당 제주도 언제 갔지", at: NOW });
  assert.deepEqual(said2.at(-1), "갔승");
});

test("1년 전 오늘: 1~3년 전 같은 날의 일정·사진·해낸 버킷리스트를 코드가 한 줄로", () => {
  const events = [
    { id: "y1", rev: 1, date: "2025-10-25", endDate: "2025-10-27", title: "강릉 여행", shared: true },
    { id: "y2", rev: 1, date: "2024-10-26", title: "첫 데이트", shared: true },
    { id: "y3", rev: 1, date: "2025-10-26", title: "주간 회의", recur: { freq: "weekly" }, shared: true },
    { id: "y4", rev: 1, kind: "bucket", title: "바다 수영", done: true, doneAt: new Date(2025, 9, 26, 15).getTime() },
  ];
  const archive = { day: (ds) => (ds === "2025-10-26" ? { photos: 4, places: ["강원특별자치도 강릉시"] } : { photos: 0, places: [] }) };
  assert.deepEqual(onThisDay(events, archive, "2026-10-26"), [
    "📸 1년 전 오늘 (10/26 (일)) — 📅 강릉 여행 · 🖼️ 사진 4장 (강원특별자치도 강릉시) · ✓ 바다 수영 달성",
    "📸 2년 전 오늘 (10/26 (토)) — 📅 첫 데이트",
  ]);
  assert.deepEqual(onThisDay(events, undefined, "2026-10-20"), []);
  assert.deepEqual(onThisDay([], archive, "2028-02-29"), []); // 윤날은 건너뛴다
});

test("1년 전 오늘: 브리핑 끝에 붙고, 없으면 아무것도 안 붙는다", async () => {
  const events = [...BRIEF_EVENTS, { id: "y1", rev: 1, date: "2025-10-26", title: "강릉 여행", shared: true }];
  const logs = [];
  const a = createAssistant({ ask: async () => { throw new Error("down"); }, events: () => events, apply: async () => {}, say: async () => {},
    log: (...x) => logs.push(x.join(" ")) }, { now: () => Date.parse("2026-10-25T23:00:00Z") });
  const text = await a.brief();
  assert.match(text, /오늘도 힘내승! 푸히힝 🐴\n📸 1년 전 오늘 \(10\/26 \(일\)\) — 📅 강릉 여행$/);
  assert.match(logs.join("\n"), /추억 1줄/);
  assert.doesNotMatch(await briefHarness(new Error("down")).a.brief(), /년 전 오늘/);
});

test("브리핑: 오늘 날씨 줄은 모델 답 뒤·추억 앞에 붙고, 날씨가 죽어도 브리핑은 나간다", async () => {
  const events = [...BRIEF_EVENTS, { id: "y1", rev: 1, date: "2025-10-26", title: "강릉 여행", shared: true }];
  const mk = (weather) => createAssistant({ ask: async () => ({ reply: "좋은 아침이승~" }), events: () => events, apply: async () => {}, say: async () => {},
    weather, log: () => {} }, { now: () => Date.parse("2026-10-25T23:00:00Z") });
  const days = [];
  const text = await mk(async (d) => { days.push(d); return ["🌡️ 오늘 날씨", "· 청주 ☀️ 맑음"]; }).brief();
  assert.deepEqual(days, ["2026-10-26"]); // KST 오늘
  assert.match(text, /🌡️ 오늘 날씨\n· 청주 ☀️ 맑음\n📸 1년 전 오늘/);
  assert.match(await mk(async () => { throw new Error("offline"); }).brief(), /\n📸 1년 전 오늘/);
  // 모델도 날씨를 보고 인사를 맞춘다 — 날씨를 못 가져왔으면 (모름)
  const asked = [];
  const ask = (weather) => createAssistant({ ask: async (m) => { asked.push(m[1].content); return { reply: "좋은 아침이승~" }; }, events: () => events,
    apply: async () => {}, say: async () => {}, weather, log: () => {} }, { now: () => Date.parse("2026-10-25T23:00:00Z") }).brief();
  await ask(async () => ["🌡️ 오늘 날씨", "· 청주 ☁️ 흐림 · 비 60% ☔ 우산 챙기승!"]);
  await ask(async () => { throw new Error("offline"); });
  assert.match(asked[0], /오늘 날씨:\n- 청주 ☁️ 흐림 · 비 60%/);
  assert.doesNotMatch(asked[0], /🌡️/);
  assert.match(asked[1], /오늘 날씨:\n\(모름\)/);
});

test("사진: photos 는 사진 낱말이 있어야 하고, '사진 보여줘' 는 recall 로 골라도 photos 다", () => {
  const ctx = buildContext(EVENTS, TODAY);
  assert.deepEqual(validateAction({ op: "photos", query: "제주 사진" }, ctx, TODAY, "제주에서 찍은 사진 보여줘"),
    { op: "photos", terms: ["제주"], from: "2023-10-23", to: TODAY });
  assert.deepEqual(validateAction({ op: "recall", query: "강남" }, ctx, TODAY, "강남 사진 가져와").op, "photos");
  assert.deepEqual(validateAction({ op: "photos", query: "" }, ctx, TODAY, "사진 보여줘"), { op: "photos", terms: [], from: "2023-10-23", to: TODAY });
  assert.deepEqual(validateAction({ op: "photos", query: "", month: "2026-09" }, ctx, TODAY, "9월 사진 보여줘"),
    { op: "photos", terms: [], from: "2026-09-01", to: "2026-09-30" });
  assert.equal(validateAction({ op: "photos", query: "제주" }, ctx, TODAY, "제주도 언제 갔지").op, "recall"); // 사진 얘기가 아니다
  assert.equal(validateAction({ op: "unknown", reason: "?" }, ctx, TODAY, "사진 보여줘").op, "photos"); // 작은 모델이 놓쳐도
  // "7월" 은 낱말이 아니라 기간 — 지난 달이면 올해, 아직 안 온 달이면 작년
  assert.deepEqual(validateAction({ op: "photos", query: "7월" }, ctx, TODAY, "7월에 찍은 사진 보여줘"), { op: "photos", terms: [], from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(validateAction({ op: "photos", query: "12월 제주" }, ctx, TODAY, "12월에 제주 사진 보여줘"), { op: "photos", terms: ["제주"], from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(validateAction({ op: "recall", query: "" }, ctx, TODAY, "지난달에 우리 어디 갔었지?"), { op: "recall", terms: [], from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(validateAction({ op: "recall", query: "13일", from: "2026-09-13", to: "2026-09-13" }, ctx, TODAY, "9월 13일에 뭐 했지?"), { op: "recall", terms: [], from: "2026-09-13", to: "2026-09-13" });
  assert.equal(validateAction({ op: "chat", reply: "응" }, ctx, TODAY, "사진 잘 나왔어?").op, "chat"); // 달라는 말이 아니면 그대로
});

test("사진: 백업에서 고른 사진의 seq 만 보낸다(많으면 기간 전체에 고르게 6장)", async () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ seq: 100 + i, at: 0, date: `2026-09-${String(10 + i).padStart(2, "0")}`, where: i < 7 ? "제주특별자치도 제주시" : "제주특별자치도 서귀포시" }));
  const said = [], queried = [];
  const archive = { photos: (q) => { queried.push(q); return q.terms.includes("없는곳") ? [] : rows; } };
  const run = (query, text) => createAssistant({ ask: async () => ({ op: "photos", query }), events: () => [], apply: async () => {},
    say: async (t, st, ph) => { said.push([t, st, ph]); }, archive }, { now: () => NOW }).onMessage({ name: "민지", text, at: NOW });
  await run("제주", "@당 제주 사진 보여줘");
  assert.deepEqual(queried[0], { op: "photos", terms: ["제주"], from: "2023-10-23", to: TODAY });
  assert.deepEqual(said[0], ['📸 "제주" 사진 13장 중 6장 가져왔승! (9/10 (목)~9/22 (화), 제주특별자치도 제주시, 제주특별자치도 서귀포시)', null, [100, 102, 105, 107, 110, 112]]);
  await run("없는곳", "@당 없는곳 사진 보여줘");
  assert.match(said[1][0], /"없는곳" 사진은 못 찾았승/);
  assert.deepEqual(said[1][2], []); // 빈 목록이면 앱엔 글만 간다
});

test("사진: 앱이 당이 메시지의 botPhotos 를 읽어 캐시의 사진을 그린다(다시 올리지 않는다)", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../../duri/index.html", import.meta.url), "utf8");
  assert.match(app, /p\.name === DANGI_NAME && Array\.isArray\(p\.botPhotos\)/);
  const sink = readFileSync(new URL("duri-sink.mjs", import.meta.url), "utf8");
  assert.match(sink, /botPhotos: photos/);
  assert.doesNotMatch(sink, /_duri\/photo["`]\s*,\s*\{\s*method:\s*"POST"/); // 사진 업로드 경로는 없다
  // 폰 캐시 밖의 옛 사진은 원본을 빌려준다(/_duri/lend — 채팅 버퍼 밖) — 앱은 그 열쇠로 받는다
  assert.match(sink, /_duri\/lend`, \{\s*method: "POST"/);
  assert.match(sink, /botLend: lend/);
  assert.match(app, /rec\.botLend = lend/);
  assert.match(app, /dangiPhotos\(rec\.botPhotos, rec\.botLend\)/);
});

test("사진 고르기: 한 날에 몰리지 않게 날짜에 고르게(시간순)", () => {
  const ph = (seq, date) => ({ seq, date });
  const many = [...Array.from({ length: 30 }, (_, i) => ph(i, "2026-07-26")), ph(40, "2026-07-28"), ph(41, "2026-07-31"), ph(42, "2026-07-31")];
  const got = spreadPick(many, 6);
  assert.equal(got.length, 6);
  assert.deepEqual([...new Set(got.map((p) => p.date))], ["2026-07-26", "2026-07-28", "2026-07-31"]); // 세 날 모두 나온다
  assert.deepEqual(got.map((p) => p.seq), [0, 15, 29, 40, 41, 42]);
  assert.equal(spreadPick(many.slice(0, 3), 6).length, 3);
});

test("기억 + 사진: 사진이 어느 일정에서 왔는지 모델에 알려 주고, 사진이 없으면 사진 얘기를 못 하게 한다", async () => {
  const asks = [];
  const answers = [{ op: "recall", query: "" }, { reply: "평창 갔승" }];
  await createAssistant({ ask: async (m) => { asks.push(m); return answers.shift(); }, events: () => MEMORY_EVENTS, apply: async () => {}, say: async () => {},
    archive: { search: () => [], hitDates: () => [], photos: (q) => (q.from === "2026-03-14" ? [{ seq: 7, date: "2026-03-15" }] : []) } },
  { now: () => NOW }).onMessage({ name: "민지", text: "@당 3월에 어디 갔었지?", at: NOW });
  assert.match(asks[1][0].content, /3월 15일 "제주도 여행" 사진 한 장을 답과 같이 보낸다\. 답에 그 날짜\(3월 15일\)를 넣고/);
  const asks2 = [];
  const answers2 = [{ op: "recall", query: "" }, { reply: "평창 갔승" }];
  await createAssistant({ ask: async (m) => { asks2.push(m); return answers2.shift(); }, events: () => MEMORY_EVENTS, apply: async () => {}, say: async () => {},
    archive: { search: () => [], hitDates: () => [], photos: () => [] } },
  { now: () => NOW }).onMessage({ name: "민지", text: "@당 3월에 어디 갔었지?", at: NOW });
  assert.match(asks2[1][0].content, /사진을 찍었다거나 가져왔다고 말하지 않는다/);
  // 하루를 콕 집어 물으면 그날 사진
  const said3 = [], answers3 = [{ op: "recall", query: "", from: "2026-09-13", to: "2026-09-13" }, { reply: "바베큐 했승" }];
  await createAssistant({ ask: async () => answers3.shift(), events: () => [], apply: async () => {}, say: async (t, st, ph) => { said3.push([t, ph]); },
    archive: { search: () => ["9/13 (일) 12:00 쫑: 고기 굽자"], hitDates: () => [], photos: (q) => (q.from === "2026-09-13" ? [{ seq: 1, date: "2026-09-13" }, { seq: 2, date: "2026-09-13" }] : []) } },
  { now: () => NOW }).onMessage({ name: "민지", text: "@당 9월 13일에 뭐 했지?", at: NOW });
  assert.deepEqual(said3.at(-1), ["바베큐 했승", [1]]);
});

test("앱의 DANGI_RE 와 데몬의 TRIGGER 가 같은 말을 명령으로 본다", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../../duri/index.html", import.meta.url), "utf8");
  const re = new RegExp(app.match(/^const DANGI_RE = \/(.+)\/;/m)[1]);
  for (const t of ["@당이 해줘", "@당 해줘", "@당아 해줘", "@당야, 안녕", "@당이야! 고마워", "@당이", "@당근 사 와", "@당아지 귀여워", "당이야 해줘", "@비서 해줘"]) {
    assert.equal(re.test(t), parseTrigger(t) !== null, t);
  }
});

test("기억 + 사진: '봉천동 언제 갔지' 는 그 말을 한 날의 사진 한 장을 답에 곁들인다", async () => {
  const said = [], asks = [];
  const answers = [{ op: "recall", query: "봉천동" }, { reply: "9월 12일에 갔승! 그날 사진도 가져왔승~" }];
  const archive = {
    search: () => ["9/12 (토) 13:00 도경: 봉천동 샤로수길 도착"],
    hitDates: () => ["2026-09-12"],
    photos: (q) => (q.from === "2026-09-12" ? [{ seq: 501, date: "2026-09-12" }, { seq: 502, date: "2026-09-12" }, { seq: 503, date: "2026-09-12" }] : []),
  };
  await createAssistant({ ask: async (m) => { asks.push(m); return answers.shift(); }, events: () => [], apply: async () => {},
    say: async (t, st, ph) => { said.push([t, ph]); }, archive }, { now: () => NOW })
    .onMessage({ name: "민지", text: "@당아 우리 봉천동 언제 갔었지?", at: NOW });
  assert.deepEqual(said, [["잠깐만! 찾아볼게승~ 🐴", undefined], ["9월 12일에 갔승! 그날 사진도 가져왔승~", [502]]]);
  assert.match(asks[1][0].content, /9월 12일 사진 한 장을 답과 같이 보낸다\. .*사진 내용은 모르니 묘사하지 않는다/);
  assert.match(asks[1][0].content, /'N월 N일'/);
  // 일정이 있으면 일정 날이 먼저, 사진이 없으면 사진 없이
  const said2 = [];
  const answers2 = [{ op: "recall", query: "제주도" }, { reply: "3월에 갔승" }];
  await createAssistant({ ask: async () => answers2.shift(), events: () => MEMORY_EVENTS, apply: async () => {},
    say: async (t, st, ph) => { said2.push([t, ph]); },
    archive: { search: () => [], hitDates: () => [], photos: (q) => (q.from === "2026-03-14" && q.to === "2026-03-16" ? [{ seq: 7, date: "2026-03-15" }] : []) } },
  { now: () => NOW }).onMessage({ name: "민지", text: "@당 제주도 언제 갔지", at: NOW });
  assert.deepEqual(said2.at(-1), ["3월에 갔승", [7]]);
});

test("말한 사람 이름은 긴 지시문 뒤 별도 시스템 메시지로 간다(앞부분 재사용)", () => {
  const ctx = buildContext(EVENTS, TODAY);
  const a = buildMessages("안녕", ctx, "도경"), b = buildMessages("안녕", ctx, "민지");
  assert.equal(a[0].content, b[0].content);
  assert.match(a[1].content, /말한 사람: 도경/);
  assert.equal(a[2].content, "안녕");
});

// ── 반복 일정(repeat)·누구 일정(who) — "@당이 당이야 11월이랑 12월 모든 수요일에 쫑이의 테니스 레슨 일정을 추가해줘" ──
// 앱에서 일정 색은 공통이면 공통 색, 아니면 주인(owner)의 색이다(쫑 = 노랑). 그래서 쫑의 일정은
// owner:"쫑", shared:false 여야 노란 라벨로 보인다.
const PEOPLE_EVENTS = [
  ...EVENTS,
  { id: "palettecolors", rev: 1, deleted: false, kind: "palette", byName: { 쫑: "#bcc900", 빵: "#9529e3" }, shared: "#ff5c5c" },
];
const TENNIS = "당이야 11월이랑 12월 모든 수요일에 쫑이의 테니스 레슨 일정을 추가해줘";

test("문맥: 사람 목록은 색 설정·일정 주인에서 모은다(당이 빼고)", () => {
  const ctx = buildContext([...PEOPLE_EVENTS, { id: "x", rev: 1, deleted: false, date: "2026-11-01", title: "t", owner: BOT_NAME }], TODAY);
  assert.deepEqual(ctx.people, ["도형", "빵", "쫑"]);
  assert.match(buildMessages("hi", ctx)[0].content, /사람: 도형, 빵, 쫑\./);
});

test("repeat: 11·12월 모든 수요일 → 코드가 날짜를 세고, 쫑의 개인 일정(노란 라벨)으로", () => {
  const ctx = buildContext(PEOPLE_EVENTS, TODAY);
  const a = validateAction({ op: "repeat", title: "테니스 레슨", weekdays: ["수"], from: "2026-11-01", to: "2026-12-31", who: "쫑이" }, ctx, TODAY, TENNIS);
  assert.equal(a.op, "repeat");
  assert.equal(a.who, "쫑");
  assert.deepEqual(a.dates, ["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25", "2026-12-02", "2026-12-09", "2026-12-16", "2026-12-23", "2026-12-30"]);
  const p = plan(a, { events: PEOPLE_EVENTS, sender: "빵", now: NOW });
  assert.equal(p.puts.length, 9);
  for (const { content } of p.puts) assert.deepEqual({ ...content, date: undefined }, { date: undefined, title: "테니스 레슨", owner: "쫑", shared: false });
  assert.equal(new Set(p.puts.map((x) => x.id)).size, 9);
  assert.match(p.reply, /9개 추가됨 \(쫑 일정\)/);
  assert.match(p.reply, /11월 4, 11, 18, 25일 \(수\)\n· 12월 2, 9, 16, 23, 30일 \(수\)/);
});

test("repeat: 모델이 who 를 빠뜨려도 요청의 '쫑이의 …' 로 주인을 찾는다, 지어낸 이름은 공통", () => {
  const ctx = buildContext(PEOPLE_EVENTS, TODAY);
  const r = { op: "repeat", title: "테니스 레슨", weekdays: "수요일", from: "2026-11-01", to: "2026-12-31" };
  assert.equal(validateAction(r, ctx, TODAY, TENNIS).who, "쫑");
  assert.equal(validateAction({ ...r, who: "철수" }, ctx, TODAY, "매주 수요일 테니스").who, undefined);
  assert.equal(validateAction({ ...r, who: "빵" }, ctx, TODAY, "빵 테니스").who, "빵");
  // 제목에 붙은 주인 이름은 뺀다
  assert.equal(validateAction({ ...r, title: "쫑이의 테니스 레슨", who: "쫑" }, ctx, TODAY, TENNIS).title, "테니스 레슨");
  // 단건 add 도 같다
  assert.equal(validateAction({ op: "add", title: "레슨", date: "2026-11-04", who: "쫑님" }, ctx, TODAY, "x").who, "쫑");
  const add = plan(validateAction({ op: "add", title: "레슨", date: "2026-11-04" }, ctx, TODAY, "쫑이의 레슨 넣어줘"), { events: PEOPLE_EVENTS, sender: "빵", now: NOW });
  assert.deepEqual([add.puts[0].content.owner, add.puts[0].content.shared], ["쫑", false]);
  assert.match(add.reply, /쫑 일정/);
});

test("repeat: 요일·기간 검증 — 지난 날은 빼고, 너무 많거나 길면 거절", () => {
  const ctx = buildContext(PEOPLE_EVENTS, TODAY);
  const v = (r) => validateAction({ op: "repeat", title: "t", ...r }, ctx, TODAY, "x");
  assert.deepEqual(v({ weekdays: ["화", "목"], from: "2026-10-01", to: "2026-11-01" }).dates, ["2026-10-27", "2026-10-29"]);
  assert.equal(v({ weekdays: ["평일"], from: "2026-10-26", to: "2026-10-30" }).dates.length, 5);
  assert.equal(v({ weekdays: ["wed"], from: "2026-11-01", to: "2026-11-30" }).dates.length, 4);
  assert.equal(v({ weekdays: ["수"], from: "2026-11-01" }).op, "unknown"); // 언제까지인지 모름
  assert.equal(v({ weekdays: [], from: "2026-11-01", to: "2026-11-30" }).op, "unknown");
  assert.equal(v({ weekdays: ["매일"], from: "2026-11-01", to: "2026-11-30" }).op, "unknown");
  assert.match(v({ weekdays: ["평일"], from: "2026-11-01", to: "2027-03-31" }).reason, /60개까지/);
  assert.match(v({ weekdays: ["수"], from: "2026-11-01", to: "2028-01-01" }).reason, /1년/);
  // 달로 주면 그 달들만(사이 달을 건너뛰어도) — 이번 달이면 남은 날만
  assert.equal(v({ weekdays: ["수"], months: ["2026-11", "2026-12"] }).dates.length, 9);
  assert.deepEqual(v({ weekdays: ["화", "목"], months: ["2026-10"] }).dates, ["2026-10-27", "2026-10-29"]);
  assert.deepEqual(v({ weekdays: ["금"], months: "2026-11" }).dates, ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  assert.equal(v({ weekdays: ["월"], months: ["2026-11", "2027-01"] }).dates.filter((d) => d.startsWith("2026-12")).length, 0);
  // 요청에 적힌 달이 모델이 고른 달보다 우선
  const vc = (r, cmd) => validateAction({ op: "repeat", title: "t", ...r }, ctx, TODAY, cmd);
  assert.deepEqual(vc({ weekdays: ["금"], months: ["2026-11", "2026-12"] }, "다음 달 매주 금요일 필라테스").dates, ["2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27"]);
  assert.equal(vc({ weekdays: ["수"], months: ["2026-11"] }, TENNIS).dates.length, 9);
  assert.deepEqual(vc({ weekdays: ["월"], months: ["2026-11"] }, "1월 매주 월요일 수영").dates[0], "2027-01-04");
  assert.equal(vc({ weekdays: ["월"], months: ["2026-11"] }, "11월 3일부터 월요일마다").dates.length, 5); // "11월 3일" 은 날짜라 달로 안 센다 → 모델 값
  // 달을 말했는데 모델이 from/to 로 넘치게 잡으면 그 달 안으로 자른다(좁게 잡은 건 그대로), "부터" 가 있으면 모델 값
  assert.deepEqual(vc({ weekdays: ["화", "목"], from: "2026-10-27", to: "2026-11-30" }, "이번 달 남은 화요일이랑 목요일에 영어 스터디 추가").dates, ["2026-10-27", "2026-10-29"]);
  assert.deepEqual(vc({ weekdays: ["금"], from: "2026-11-15", to: "2026-11-30" }, "다음 달 셋째 주 금요일마다 회의").dates, ["2026-11-20", "2026-11-27"]);
  assert.equal(vc({ weekdays: ["수"], from: "2026-11-01", to: "2027-01-31" }, "11월부터 석 달 동안 수요일마다 수영").dates.length, 13);
});

test("repeat: 여러 개는 되묻고 '@당이 응' 에 한꺼번에 넣는다", async () => {
  const said = [], applied = [];
  const a = createAssistant({
    ask: async () => ({ op: "repeat", title: "테니스 레슨", weekdays: ["수"], months: ["2026-11", "2026-12"], who: "쫑" }),
    events: () => PEOPLE_EVENTS, apply: async (p) => { applied.push(p); }, say: async (t) => { said.push(t); },
  }, { now: () => NOW });
  await a.onMessage({ name: "빵", text: `@당이 ${TENNIS}`, at: NOW - 1000 });
  assert.equal(applied.length, 0);
  assert.match(said[0], /"테니스 레슨" 쫑 일정 9개를 넣을까요\? "@당이 응"/);
  await a.onMessage({ name: "빵", text: "@당이 응", at: NOW - 500 });
  assert.equal(applied[0].puts.length, 9);
  assert.match(said[1], /9개 추가됨/);
});

// ── 버킷리스트(✓) 읽기·데이트 추천 — 앱의 kind:"bucket"/"bucketcanvas" 레코드(읽기만) ──
const BUCKET_EVENTS = [
  ...EVENTS,
  { id: "cv00001", rev: 1, deleted: false, kind: "bucketcanvas", title: "여행", by: "쫑", at: 1 },
  { id: "bk00001", rev: 1, deleted: false, kind: "bucket", title: "한강 피크닉", by: "쫑", at: 10 },
  { id: "bk00002", rev: 1, deleted: false, kind: "bucket", title: "도자기 공방", by: "빵", at: 20, memo: "원데이 클래스" },
  { id: "bk00003", rev: 1, deleted: false, kind: "bucket", title: "제주도 일출", by: "빵", at: 30, list: "cv00001" },
  { id: "bk00004", rev: 1, deleted: false, kind: "bucket", title: "방탈출", by: "쫑", at: 5, done: true, doneAt: new Date(2026, 9, 3).getTime(), doneBy: "빵" },
  { id: "bk00005", rev: 1, deleted: true, kind: "bucket", title: "지운 항목" },
];

test("bucket: 남은 것·해낸 것·찾기를 코드가 정리한다(목록이 여럿이면 목록 이름)", () => {
  const ctx = buildContext(BUCKET_EVENTS, TODAY);
  const run = (raw) => plan(validateAction({ op: "bucket", ...raw }, ctx, TODAY, "x"), { events: BUCKET_EVENTS, sender: "쫑", now: NOW }).reply;
  const todo = run({});
  assert.match(todo, /^✓ 버킷리스트 4개 중 1개 달성\n남은 것 3개\n· 한강 피크닉 \[기본\]\n· 도자기 공방 \[기본\]\n· 제주도 일출 \[여행\]$/);
  assert.doesNotMatch(todo, /지운 항목|방탈출/);
  assert.match(run({ show: "done" }), /해낸 것 1개\n· 방탈출 \[기본\] \(10\/3 \(토\) 달성\)/);
  assert.match(run({ show: "all" }), /남은 것 3개[\s\S]*해낸 것 1개/);
  assert.match(run({ query: "제주" }), /· 제주도 일출/);
  assert.match(run({ query: "공방" }), /도자기 공방/); // 메모·제목 어디든
  assert.match(run({ query: "스카이다이빙" }), /"스카이다이빙" 은\(는\) 없어요/);
  assert.match(plan({ op: "bucket", show: "todo", terms: [] }, { events: EVENTS, sender: "쫑" }).reply, /비어 있어요/);
});

test("recommend: 안 한 버킷리스트·빈 주말만 근거로 2단계 질의하고, 해낸 건 '최근 해낸 것' 으로만", async () => {
  const said = [], asks = [];
  const answers = [{ op: "recommend", hint: "이번 주말" }, { reply: "이번 주말엔 한강 피크닉 어떠승?" }];
  const a = createAssistant({
    ask: async (m) => { asks.push(m); return answers.shift(); },
    events: () => BUCKET_EVENTS, apply: async () => { throw new Error("캘린더를 고치면 안 됨"); }, say: async (t) => { said.push(t); },
  }, { now: () => NOW });
  await a.onMessage({ name: "쫑", text: "@당이 이번 주말 데이트 추천해줘", at: NOW - 1000 });
  assert.equal(said[0], "이번 주말엔 한강 피크닉 어떠승?");
  const sys = asks[1][0].content;
  assert.match(sys, /아직 안 한 버킷리스트:\n- 한강 피크닉\n- 도자기 공방 \(메모: 원데이 클래스\)\n- 제주도 일출\n/);
  assert.match(sys, /최근 해낸 것:\n- 방탈출\n/);
  // 10/31 (토) 은 "르파비스 임장" 이 있어 빠지고, 11/1 (일) 은 비어 있다
  assert.match(sys, /일정 없는 주말\(3주 안\): 10\/25 \(일\), 11\/1 \(일\), 11\/7 \(토\)/);
  assert.doesNotMatch(sys, /지운 항목/);
  assert.equal(asks[1].at(-1).content, "이번 주말 데이트 추천해줘");
});

test("recommend: 버킷리스트가 비어도 답한다, 모델이 죽으면 그렇다고", async () => {
  const msgs = buildRecommendMessages("추천", { todo: [], done: [], free: [] }, "빵");
  assert.match(msgs[0].content, /아직 안 한 버킷리스트:\n\(없음\)/);
  const said = [];
  const a = createAssistant({
    ask: (() => { let n = 0; return async () => { if (n++ === 0) return { op: "recommend" }; throw new Error("ECONNREFUSED"); }; })(),
    events: () => EVENTS, apply: async () => {}, say: async (t) => { said.push(t); },
  }, { now: () => NOW });
  await a.onMessage({ name: "빵", text: "@당이 데이트 추천", at: NOW - 1000 });
  assert.match(said[0], /모델 서버/);
});

test("반복: calEventOnDate 가 웹앱(duri/index.html)의 recurMatches·calEventOnDate 와 같다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../../duri/index.html", import.meta.url), "utf8");
  const src = ["recurMatches", "calEventOnDate"].map((f) => html.match(new RegExp(`function ${f}\\(ev, ds\\) \\{[\\s\\S]*?\\n\\}`))[0]).join("\n");
  const app = new Function(`${src}; return calEventOnDate;`)();
  const evs = [
    { date: "2026-10-27", recur: { freq: "weekly" } },
    { date: "2026-10-27", recur: { freq: "weekly", count: 3, exclude: ["2026-11-03"] } },
    { date: "2026-01-31", recur: { freq: "monthly", until: "2026-12-31" } },
    { date: "2024-02-29", recur: { freq: "yearly" } },
    { date: "2026-10-30", recur: { freq: "daily", count: 2 } },
    { date: "2026-11-03", endDate: "2026-11-04" },
    { date: "2026-10-31" },
  ];
  for (const ev of evs) for (let i = -3; i < 60; i++) {
    const d = new Date(2026, 9, 25 + i), ds = ymd(d);
    assert.equal(calEventOnDate(ev, ds), app(ev, ds), `${JSON.stringify(ev)} @ ${ds}`);
  }
});

test("브리핑: 08:00~08:09 KST, 그날 한 번만(PC 시간대와 무관, 08:10 은 서버 fallback)", () => {
  const at = (iso) => Date.parse(iso); // UTC 로 적는다: KST = UTC+9
  assert.equal(kstYmd(at("2026-10-25T23:30:00Z")), "2026-10-26");
  assert.equal(briefDue(at("2026-10-25T22:59:00Z"), ""), false); // 07:59
  assert.equal(briefDue(at("2026-10-25T23:00:00Z"), ""), true); // 08:00
  assert.equal(briefDue(at("2026-10-25T23:09:00Z"), "2026-10-25"), true); // 08:09, 어제 했음
  assert.equal(briefDue(at("2026-10-25T23:10:00Z"), ""), false); // 08:10 — 서버 리마인드 몫
  assert.equal(briefDue(at("2026-10-25T23:30:00Z"), "2026-10-26"), false); // 이미 함
  assert.equal(briefDue(at("2026-10-26T00:05:00Z"), "", "09:00"), true);
  assert.equal(briefDue(at("2026-10-26T00:00:00Z"), "", "off"), false);
});

const BRIEF_EVENTS = [
  { id: "b1", rev: 1, date: "2026-10-26", title: "치과", start: "15:00", owner: "쫑", shared: false },
  { id: "b2", rev: 1, date: "2026-10-19", title: "테니스 레슨", start: "19:00", end: "20:00", recur: { freq: "weekly" }, owner: "쫑", shared: false },
  { id: "b3", rev: 1, date: "2026-10-25", endDate: "2026-10-27", title: "출장", owner: "빵", shared: false },
  { id: "b4", rev: 1, date: "2026-10-27", title: "저녁 약속", start: "18:30", shared: true },
  { id: "b5", rev: 1, date: "2026-10-28", title: "모레 일정", shared: true },
  { id: "b6", rev: 1, kind: "bucket", title: "제주도" },
  { id: "b7", rev: 1, date: "2026-10-26", title: "지운 일정", deleted: true },
];

test("브리핑: 오늘·내일 일정을 코드가 고른다(반복·여러 날 포함, 지운 것·표식 제외)", () => {
  const f = briefFacts(BRIEF_EVENTS, "2026-10-26");
  assert.deepEqual(f.todays.map((i) => i.title), ["출장", "치과", "테니스 레슨"]);
  assert.deepEqual(f.tomorrows.map((i) => i.title), ["출장", "저녁 약속"]);
  const [sys, user] = buildBriefingMessages(f);
  assert.match(sys.content, /다그당스/);
  assert.match(user.content, /10\/26 \(월\)/);
  assert.match(user.content, /- 19:00–20:00 테니스 레슨 \(쫑\)/);
  assert.match(user.content, /- 출장 \(빵\)/);
  assert.doesNotMatch(user.content, /모레 일정|지운 일정|제주도/);
  assert.match(briefFallback({ today: "2026-10-26", todays: [], tomorrows: [] }), /오늘은 일정이 없승/);
});

function briefHarness(answer, events = BRIEF_EVENTS) {
  const logs = [], said = [];
  const a = createAssistant({
    ask: async () => { if (answer instanceof Error) throw answer; return answer; },
    events: () => events, apply: async () => {}, say: async (t) => { said.push(t); },
    log: (...x) => logs.push(x.join(" ")),
  }, { now: () => Date.parse("2026-10-25T23:00:00Z") });
  return { a, logs, said };
}

test("브리핑: 모델 답이 오늘 일정을 다 담으면 그대로, 빠뜨리거나 모델이 죽으면 틀 문장", async () => {
  const good = "좋은 아침이승~ ☀️\n· 빵이 출장 중이승\n· 오후 3시 쫑이 치과\n· 19:00 쫑이 테니스 레슨\n내일은 저녁 약속 있승! 힘내승~";
  const ok = briefHarness({ reply: good });
  assert.equal(await ok.a.brief(), good);
  assert.match(ok.logs.join("\n"), /아침 브리핑 — 오늘 3개·내일 2개$/m);
  assert.doesNotMatch(ok.logs.join("\n"), /치과/); // 내용은 로그에 없다

  const missing = briefHarness({ reply: "좋은 아침이승! 오늘은 치과랑 테니스 레슨 있승" }); // 시각·출장 빠짐
  const text = await missing.a.brief();
  assert.match(text, /· 15:00 치과 \(쫑\)/);
  assert.match(text, /· 출장 \(빵\)/);
  assert.match(missing.logs.join("\n"), /틀 문장/);

  const dead = briefHarness(new Error("down"));
  assert.match(await dead.a.brief(), /오늘 일정 3개/);
});

test("브리핑: '@당이 브리핑' 이면 지금 바로 채팅에 한다", async () => {
  const h = briefHarness({ reply: "오늘은 일정이 없승~ 푹 쉬승!" }, []);
  await h.a.onMessage({ name: "쫑", text: "@당이 오늘 브리핑 해줘", at: Date.parse("2026-10-25T23:00:00Z") });
  assert.deepEqual(h.said, ["오늘은 일정이 없승~ 푹 쉬승!"]);
});

test("빈 주말: 매주 반복되는 주말 일정이 있는 날은 비어 있지 않다", async () => {
  const asks = [];
  let n = 0; // 첫 질의는 분류, 두 번째가 추천
  const b = createAssistant({
    ask: async (m) => { asks.push(m); return n++ === 0 ? { op: "recommend" } : { reply: "피크닉 가자승" }; },
    events: () => [{ id: "r1", rev: 1, date: "2026-10-31", title: "등산", recur: { freq: "weekly" }, shared: true }],
    apply: async () => {}, say: async () => {},
  }, { now: () => NOW });
  await b.onMessage({ name: "쫑", text: "@당이 주말 데이트 추천해줘", at: NOW - 1000 });
  const sys = asks.at(-1)[0].content;
  const line = sys.split("\n").find((l) => l.startsWith("일정 없는 주말"));
  assert.doesNotMatch(line, /10\/31|11\/7|11\/14/); // 토요일 등산(매주)
  assert.match(line, /11\/1 \(일\)/);
});

function stickerHarness(answers, events = []) {
  const said = [];
  const a = createAssistant({
    ask: async () => { const x = answers.shift(); if (x instanceof Error) throw x; return x; },
    events: () => events, apply: async () => {}, say: async (text, sticker) => { said.push({ text, sticker }); },
  }, { now: () => NOW });
  return { said, send: (text) => a.onMessage({ name: "쫑", text, at: NOW - 1000 }) };
}

test("이모티콘: 일 답(일정 넣기·오류·목록·버킷)엔 붙이지 않는다 — 필요할 때만", async () => {
  const h = stickerHarness([{ op: "add", title: "치과", date: "2026-10-27", start: "15:00" }, new Error("down"),
    { op: "list", from: "2026-10-25", to: "2026-10-31" }, { op: "chat", reply: "응 듣고 있승" }]);
  await h.send("@당이 내일 3시 치과 넣어줘 고마워"); // 고마워가 있어도 일정 넣기 답엔 안 붙인다
  await h.send("@당이 아무거나");
  await h.send("@당이 이번 주 일정");
  await h.send("@당이 오늘 뭐 해?"); // 잡담이어도 맞는 말이 없으면 안 붙인다
  assert.deepEqual(h.said.map((x) => x.sticker ?? null), [null, null, null, null]);
});

test("이모티콘: 잡담은 말에 맞는 게 있을 때만, '이모티콘 보내줘' 는 다그당스 3 중 하나", async () => {
  assert.deepEqual(chatSticker("당이야 잘 자"), { pack: "dageudangseu-3", n: 6 });
  assert.deepEqual(chatSticker("오늘 너무 힘들었어"), { pack: "dageudangseu-3", n: 9 });
  assert.equal(chatSticker("오늘 뭐 해?"), null);
  assert.deepEqual(chatSticker("헐 대박"), { pack: "dageudangseu-4", n: 6 }); // 먼저 맞는 것 하나
  assert.deepEqual(chatSticker("오늘도 수고했어"), { pack: "dageudangseu-4", n: 16 });
  const r = chatSticker("이모티콘 보내줘");
  assert.match(r.pack, /^dageudangseu-[34]$/);
  const packs = new Set(["1", "2", "3", "4", "5", "6"].map((x) => chatSticker(`이모티콘 ${x}`).pack));
  assert.equal(packs.size, 2, "3·4 둘 다 나온다");
  assert.ok(r.n >= 1 && r.n <= 16);
  assert.deepEqual(chatSticker("이모티콘 보내줘"), r, "같은 말엔 같은 것");
  const h = stickerHarness([{ op: "chat", reply: "고마웁승~" }]);
  await h.send("@당이 고마워");
  assert.deepEqual(h.said[0], { text: "고마웁승~", sticker: { pack: "dageudangseu-3", n: 5 } });
});

test("이모티콘: 당이가 쓰는 번호가 팩에 있고, duri 앱 서랍(DURI_ONLY_PACKS)에 그 팩이 있다", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../../duri/index.html", import.meta.url), "utf8");
  const used = [...["잘 자", "사과", "각설탕", "사랑해", "힘들어", "배고파", "퇴근", "생일", "화이팅", "고마워", "굿모닝", "데이트", "충성",
    "안녕", "웅웅", "히히", "부끄", "키키", "헐", "귀여워", "호이", "잘됐다", "대박", "나두", "우와", "알림", "신나", "테니스", "수고"].map(chatSticker)];
  for (const { pack, n } of used) {
    const meta = JSON.parse(readFileSync(new URL(`../../_assets/sticker/${pack}/metadata.json`, import.meta.url), "utf8"));
    assert.ok(n >= 1 && n <= meta.downloads.length, `${pack}/${n}`);
    assert.match(html, new RegExp(`id: "${pack}", title: "[^"]+", count: ${meta.downloads.length}`), `${pack} 가 duri 서랍에 없다`);
  }
  assert.match(html, /p\.botSticker/, "앱이 botSticker 를 읽는다");
  // 캐시된 팩 목록에 새 팩이 없어도 그린다(iOS 에서 당이 이모티콘이 안 보이던 원인).
  assert.match(html, /if \(st && knownPack\(st\.pack\)\)/);
  const known = new Function("PACK_IDS", "DURI_ONLY_PACKS", `${html.match(/const knownPack = [^\n]+/)[0]}; return knownPack;`)(
    new Map(), [{ id: "dageudangseu-3" }]);
  assert.equal(known("dageudangseu-3"), true);
  assert.equal(known("nope"), false);
});

test("한가할 때 뒷일: 10분 안에 누가 불렀으면 안 하고, 하면 명령과 같은 줄에 선다", async () => {
  let t = NOW;
  const a = createAssistant({ ask: async () => ({ op: "chat", reply: "응" }), events: () => [], apply: async () => {}, say: async () => {} }, { now: () => t });
  let ran = 0;
  assert.equal(await a.idle(async () => ++ran), 1); // 처음엔 아무도 안 불렀다
  await a.onMessage({ name: "쫑", text: "@당이 안녕", at: t });
  t += 9 * 60_000;
  assert.equal(await a.idle(async () => ++ran), false);
  t += 2 * 60_000;
  assert.equal(await a.idle(async () => ++ran), 2);
  await a.onMessage({ name: "쫑", text: "그냥 대화", at: t }); // 당이를 부른 게 아니면 한가함 그대로
  assert.equal(await a.idle(async () => ++ran), 3);
});

test("기억 + 사진: '회 뭐였지' 는 그날 아무 사진이 아니라 설명에 회가 있는 그 사진, 설명과 날짜를 모델에 준다", async () => {
  const said = [], asks = [];
  const answers = [{ op: "recall", query: "회" }, { reply: "10월 5일에 먹은 회였승!" }];
  const archive = {
    search: () => ["10/5 (월) 19:42 쫑: 🖼️ 사진 [얼음 위에 담긴 회 접시]"],
    hitDates: () => ["2026-10-05"],
    photos: (q) => (q.terms.length ? [{ seq: 1248, date: "2026-10-05", desc: "얼음 위에 담긴 회 접시" }]
      : [{ seq: 1201, date: "2026-10-05" }, { seq: 1202, date: "2026-10-05" }, { seq: 1248, date: "2026-10-05" }]),
  };
  await createAssistant({ ask: async (m) => { asks.push(m); return answers.shift(); }, events: () => [], apply: async () => {},
    say: async (t, st, ph) => { said.push([t, ph]); }, archive }, { now: () => NOW })
    .onMessage({ name: "빵", text: "@당이 우리 예전에 먹었던 회 뭐였지?", at: NOW });
  assert.deepEqual(said.at(-1), ["10월 5일에 먹은 회였승!", [1248]]);
  assert.match(asks[1][0].content, /10월 5일 사진 한 장을 답과 같이 보낸다 — 찍힌 것: 얼음 위에 담긴 회 접시\. 답에 그 날짜\(10월 5일\)를 넣고/);
  assert.match(asks[1][0].content, /사진은 이 설명에 있는 것만 말한다/);
});

test("사진: '하나 보여줘'·'두 장' 이면 그만큼만 가져온다", async () => {
  assert.equal(countSaid("우리 세종에서 찍은 사진 하나 보여줘"), 1);
  assert.equal(countSaid("사진 두 장만"), 2);
  assert.equal(countSaid("3장 보여줘"), 3);
  assert.equal(countSaid("20장 보여줘"), 6);
  assert.equal(countSaid("제주 사진 보여줘"), null);
  assert.equal(countSaid("하나님 사진"), null);
  const said = [];
  const answers = [{ op: "photos", query: "세종" }];
  const all = [890, 965, 966, 967, 968].map((seq, i) => ({ seq, date: i ? "2026-08-17" : "2026-08-15", where: "세종특별자치시 세종시" }));
  await createAssistant({ ask: async () => answers.shift(), events: () => [], apply: async () => {},
    say: async (t, st, ph) => { said.push([t, ph]); }, archive: { photos: () => all } }, { now: () => NOW })
    .onMessage({ name: "빵", text: "@당이 우리 세종에서 찍은 사진 하나 보여줘", at: NOW });
  assert.equal(said[0][1].length, 1);
  assert.match(said[0][0], /사진 5장 중 1장/);
});

test("자는 시간: 모델 서버가 꺼졌거나 모델을 올리는 중(503)이면 '자는 중' 이고, 새벽엔 자는 시간을 알려 준다", async () => {
  const { llamaAsk, ModelAsleep, downText } = await import("./assistant.mjs");
  const { createServer } = await import("node:http");
  const srv = createServer((req, res) => { res.statusCode = 503; res.end('{"error":{"message":"Loading model"}}'); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  try {
    await assert.rejects(llamaAsk({ url: `http://127.0.0.1:${port}` })([]), (e) => e.asleep === true);
  } finally { srv.close(); }
  await new Promise((r) => srv.once("close", r));
  await assert.rejects(llamaAsk({ url: `http://127.0.0.1:${port}` })([]), (e) => e.asleep === true); // 꺼져 있음(연결 거부)

  const kst = (h) => Date.parse(`2026-10-29T${String(h).padStart(2, "0")}:30:00+09:00`);
  assert.match(downText(new ModelAsleep("x"), kst(4)), /새벽 3시~6시에 자고/);
  assert.match(downText(new ModelAsleep("x"), kst(6)), /새벽 3시~6시에 자고/); // 기상이 최대 한 시간 늦어진다
  assert.match(downText(new ModelAsleep("x"), kst(14)), /지금 자고 있어요/);
  assert.match(downText(new Error("llama-server HTTP 500"), kst(4)), /모델 서버 확인/); // 고장은 고장이라고

  const said = [];
  const at = kst(4);
  const a = createAssistant({ ask: async () => { throw new ModelAsleep("꺼짐"); }, events: () => EVENTS, apply: async () => {},
    say: async (t) => { said.push(t); } }, { now: () => at });
  await a.onMessage({ name: "빵", text: "@당이 이번 주 일정", at: at - 1000 });
  assert.deepEqual(said, ["😴 당이는 새벽 3시~6시에 자고 있어요. 6시 넘어서 다시 불러 주승!"]);
});
