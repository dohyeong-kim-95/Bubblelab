// 당이 벤치마크 — 실제 당이 프롬프트(buildContext/buildMessages)를 가짜 캘린더로 모델 서버에 던져
// 정답 수·응답 시간을 잰다. 테스트(npm test)가 아니다: 모델 서버가 떠 있어야 하고 결과가 모델마다 다르다.
//
//   node _src/duri-sink/bench.mjs [url=http://127.0.0.1:8090] [이름]
//   FOLD=1 …  "말한 사람" 시스템 메시지를 user 앞에 합친다(Qwen 처럼 system 이 맨 앞에만 와야 하는 템플릿)
//
// llama-server(OpenAI 호환 /v1/chat/completions)용. 모델을 바꿔 잴 땐 다른 포트에 llama-server 를 하나 더 띄운다.
// 결과는 README 「실행기·모델 고르기」 표에 옮긴다.
const A = await import("./assistant.mjs");
const base = (process.argv[2] || "http://127.0.0.1:8090").replace(/\/+$/, ""), label = process.argv[3] || base;
const today = "2026-10-25"; // 일요일
const ev = (id, date, title, extra = {}) => ({ id, date, title, rev: 1, ...extra });
const events = [
  ev("a1", "2026-10-27", "회식", { start: "19:00" }), ev("a2", "2026-10-29", "PT", { start: "07:00" }),
  ev("a3", "2026-10-31", "임장", { start: "10:00" }), ev("a4", "2026-11-02", "테스트"),
  ev("a5", "2026-11-04", "치과", { start: "15:00" }), ev("a6", "2026-11-07", "결혼식", { start: "12:00" }),
  ev("a7", "2026-11-10", "엄마 생신"), ev("a8", "2026-11-12", "출장", { endDate: "2026-11-13" }),
  { id: "palettecolors", rev: 1, kind: "palette", byName: { 쫑: "#bcc900", 빵: "#9529e3" }, shared: "#ff5c5c" },
  { id: "bk1", rev: 1, kind: "bucket", title: "한강 피크닉", by: "쫑", at: 1 },
  { id: "bk2", rev: 1, kind: "bucket", title: "도자기 공방 원데이 클래스", by: "빵", at: 2 },
  { id: "bk3", rev: 1, kind: "bucket", title: "제주도 일출 보기", by: "빵", at: 3 },
  { id: "bk4", rev: 1, kind: "bucket", title: "방탈출 카페", by: "쫑", at: 4, done: true, doneAt: 5 },
];
const ctx = A.buildContext(events, today);
const idOf = (title) => [...ctx.aliases].find(([, e]) => e.title === title)?.[0];
const cases = [
  ["이번 주 일정", (r) => r.op === "list" && r.from <= "2026-10-26" && r.to >= "2026-10-31" && r.to <= "2026-11-01"],
  ["다음주 토요일 10시 테스트 일정 넣어줘", (r) => r.op === "add" && ["2026-10-31", "2026-11-07"].includes(r.date) && r.start === "10:00"],
  ["테스트 일정 지워줘", (r) => r.op === "delete" && r.id === idOf("테스트")],
  ["임장 일요일로 옮겨줘", (r) => r.op === "move" && r.id === idOf("임장") && r.date === "2026-11-01"],
  ["내일 오후 3시 치과 예약", (r) => r.op === "add" && r.date === "2026-10-26" && (r.start || r.end) === "15:00"],
  ["11월 18일부터 20일까지 제주 여행", (r) => r.op === "add" && r.date === "2026-11-18" && r.endDate === "2026-11-20"],
  ["안녕 당이야!", (r) => r.op === "chat"],
  ["오늘 저녁 뭐 먹을까?", (r) => r.op === "chat"],
  ["고마워 당이", (r) => r.op === "chat"],
  ["내일 서울 날씨 어때?", (r) => r.op === "chat"],
  ["너 무슨 동물이야?", (r) => r.op === "chat"],
  ["오늘 운동했어", (r) => r.op === "fit" && (!r.date || r.date === "2026-10-25")],
  ["어제 헬스 1시간 했어", (r) => r.op === "fit" && r.date === "2026-10-24" && /헬스/.test(r.memo || "")],
  ["오늘 러닝 5km 뛰었당", (r) => r.op === "fit" && (!r.date || r.date === "2026-10-25") && /러닝|5/.test(r.memo || "")],
  ["어제 운동 체크 취소해줘", (r) => r.op === "unfit" && r.date === "2026-10-24"],
  ["이번 달 운동 몇 번 했어?", (r) => r.op === "fitlist" && (!r.month || r.month === "2026-10")],
  ["지난달 운동 기록 보여줘", (r) => r.op === "fitlist" && r.month === "2026-09"],
  ["이번주 운동 요약해줘", (r) => r.op === "fitlist" && r.week === "this"],
  ["지난주 운동 어땠어?", (r) => r.op === "fitlist" && r.week === "last"],
  ["이번 주에 운동 몇 번 했지", (r) => r.op === "fitlist" && r.week === "this"],
  // 반복 일정·누구 일정(2026-10-25 추가) — 검사는 코드 검증(validateAction)을 거친 뒤 결과로 한다
  ["당이야 11월이랑 12월 모든 수요일에 쫑이의 테니스 레슨 일정을 추가해줘", (r, v) => v.op === "repeat" && v.who === "쫑" && v.dates.join() === "2026-11-04,2026-11-11,2026-11-18,2026-11-25,2026-12-02,2026-12-09,2026-12-16,2026-12-23,2026-12-30" && /테니스/.test(v.title)],
  ["다음 달 매주 금요일 저녁 7시 빵 필라테스 넣어줘", (r, v) => v.op === "repeat" && v.who === "빵" && v.start === "19:00" && v.dates.join() === "2026-11-06,2026-11-13,2026-11-20,2026-11-27"],
  ["이번 달 남은 화요일이랑 목요일에 영어 스터디 추가", (r, v) => v.op === "repeat" && !v.who && v.dates.join() === "2026-10-27,2026-10-29"],
  ["내일 오후 2시 쫑이 치과", (r, v) => v.op === "add" && v.who === "쫑" && v.date === "2026-10-26" && v.start === "14:00"],
  ["토요일에 같이 영화 보기 넣어줘", (r, v) => v.op === "add" && !v.who && v.date === "2026-10-31"],
  // 버킷리스트·데이트 추천(2026-10-25 추가)
  ["버킷리스트 뭐 남았어?", (r, v) => v.op === "bucket" && v.show === "todo"],
  ["우리 버킷리스트에서 해본 거 보여줘", (r, v) => v.op === "bucket" && v.show === "done"],
  ["버킷리스트에 제주도 있어?", (r, v) => v.op === "bucket" && v.terms.some((t) => /제주/.test(t))],
  ["이번 주말 데이트 추천해줘", (r, v) => v.op === "recommend"],
  ["비 오는 날 둘이 할 만한 거 추천해줄래?", (r, v) => v.op === "recommend"],
];
const recallCases = [
  ["우리 성수동에서 갔던 카페 이름 뭐였지?", (r) => r.op === "recall" && /카페|성수/.test(JSON.stringify(r))],
  ["지난달에 우리 무슨 얘기 많이 했어?", (r) => r.op === "recall"],
  ["어제 무슨 얘기 했었지?", (r) => r.op === "recall"],
  ["제주도 여행 얘기 언제 했더라", (r) => r.op === "recall" && /제주/.test(JSON.stringify(r))],
];
const lines = [
  "9/12 (토) 13:00 도경: 성수동 카페 어니언 가자", "9/12 (토) 13:05 민지: 좋아 거기 빵 맛있대",
  "9/12 (토) 15:00 도경: 🖼️ 사진 \"어니언 소금빵\"", "10/3 (토) 21:00 민지: 다음달 제주 가면 흑돼지 먹자",
];
const grounded = [
  ["우리 성수동에서 갔던 카페 이름 뭐였지?", (t) => /어니언/.test(t)],
  ["제주 가면 뭐 먹기로 했지?", (t) => /흑돼지/.test(t)],
  ["우리 부산 언제 갔었지?", (t) => /없|못|모르/.test(t) && !/\d+\/\d+.*부산|부산.*\d+월/.test(t)],
];
// 맨 앞이 아닌 system(말한 사람)은 user 앞머리로 합친다 — Qwen 템플릿은 system 이 맨 앞에만 와야 한다.
const fold = (ms) => ms.reduce((acc, m, i) => {
  if (m.role === "system" && i > 0) { acc.pendingWho = m.content; return acc; }
  acc.list.push(m.role === "user" && acc.pendingWho ? { role: "user", content: `(${acc.pendingWho})\n${m.content}` } : m);
  if (m.role === "user") acc.pendingWho = null;
  return acc;
}, { list: [], pendingWho: null }).list;
async function ask(messages) {
  if (process.env.FOLD === "1") messages = fold(messages);
  const res = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, temperature: 0, response_format: { type: "json_object" }, cache_prompt: true, chat_template_kwargs: { enable_thinking: false } }) });
  const j = await res.json();
  return { content: j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 200), gen: j.usage?.completion_tokens };
}
const parse = (c) => { try { return JSON.parse(c); } catch { return null; } };
const out = { label, sched: 0, recall: 0, grounded: 0, times: [], gens: [], cold: 0, bad: [], chats: [] };
let first = true;
for (const [text, check] of cases) {
  const s = Date.now(); const r = await ask(A.buildMessages(text, ctx, "도경")); const sec = (Date.now() - s) / 1000;
  if (first) { out.cold = sec; first = false; } else out.times.push(sec);
  out.gens.push(r.gen);
  const p = parse(r.content);
  const v = p ? A.validateAction(structuredClone(p), ctx, today, text) : { op: "unknown" };
  const pass = !!p && check(p, v) && !(["fit","unfit","fitlist"].includes(p.op) && v.op !== p.op);
  if (pass) out.sched++; else out.bad.push(`${text} → ${String(r.content).replace(/\s+/g," ").slice(0,120)}`);
  if (p?.op === "chat") out.chats.push(p.reply);
}
for (const [text, check] of recallCases) {
  const s = Date.now(); const r = await ask(A.buildMessages(text, ctx, "민지")); out.times.push((Date.now() - s) / 1000);
  const p = parse(r.content);
  if (p && check(p)) out.recall++; else out.bad.push(`${text} → ${String(r.content).replace(/\s+/g," ").slice(0,120)}`);
}
for (const [q, check] of grounded) {
  const s = Date.now(); const r = await ask(A.buildRecallMessages(q, lines, "민지")); out.times.push((Date.now() - s) / 1000);
  const t = String(parse(r.content)?.reply ?? "");
  if (check(t)) out.grounded++; else out.bad.push(`${q} → ${String(r.content).replace(/\s+/g," ").slice(0,120)}`);
  out.chats.push(t);
}
// 데이트 추천 2단계 — 안 한 버킷리스트에서 고르고, 해낸 것(방탈출)은 다시 권하지 않아야 한다.
out.rec = 0;
const recCtx = { todo: ["- 한강 피크닉", "- 도자기 공방 원데이 클래스", "- 제주도 일출 보기"], done: ["- 방탈출 카페"], free: ["11/1 (일)", "11/7 (토)"] };
for (const q of ["이번 주말 데이트 추천해줘", "비 오는 날 둘이 할 만한 거 추천해줄래?"]) {
  const s = Date.now(); const r = await ask(A.buildRecommendMessages(q, recCtx, "쫑")); out.times.push((Date.now() - s) / 1000);
  const t = String(parse(r.content)?.reply ?? "");
  if (/피크닉|공방|일출/.test(t) && !/방탈출/.test(t)) out.rec++; else out.bad.push(`[추천] ${q} → ${t.slice(0, 120)}`);
  out.chats.push(t);
}
const avg = out.times.reduce((a, b) => a + b, 0) / out.times.length;
console.log(`### ${label}: 일정·운동·잡담·반복 ${out.sched}/${cases.length} · 기억분류 ${out.recall}/4 · 기억답 ${out.grounded}/3 · 추천답 ${out.rec}/2 · 첫답 ${out.cold.toFixed(1)}s · 이후평균 ${avg.toFixed(1)}s · 최대생성 ${Math.max(...out.gens)}tok`);
for (const x of out.bad) console.log("  ✗ " + x);
for (const x of out.chats) console.log("  💬 " + x);
