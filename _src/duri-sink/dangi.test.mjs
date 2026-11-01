import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./dangi.mjs";
import { FAKE_EVENTS, FAKE_TODAY } from "./fixtures.mjs";
import { buildContext } from "./assistant.mjs";

const NOW = Date.parse(`${FAKE_TODAY}T09:00:00+09:00`);

test("하네스: 일정 추가는 메모리에만 반영되고 원본 배열은 그대로다", async () => {
  const seen = [];
  const h = createHarness({
    ask: async () => ({ op: "add", title: "필라테스", date: "2026-10-28", start: "19:00" }),
    events: FAKE_EVENTS, now: () => NOW, out: (e) => seen.push(e),
  });
  await h.send("쫑", "수요일 7시 필라테스 넣어줘"); // @당이 없이 써도 당이에게 간다
  assert.ok(h.events().some((e) => e.title === "필라테스" && !e.deleted));
  assert.ok(!FAKE_EVENTS.some((e) => e.title === "필라테스"), "가짜 캘린더 원본을 건드리면 다음 실행이 달라진다");
  assert.ok(seen.some((e) => e.type === "apply" && e.puts[0].title === "필라테스"));
  assert.ok(seen.some((e) => e.type === "say" && /필라테스/.test(e.text)));
  h.reset();
  assert.ok(!h.events().some((e) => e.title === "필라테스"));
});

test("하네스: 지우기는 되묻고, 같은 사람이 응 해야 실행한다", async () => {
  const said = [], events = FAKE_EVENTS.filter((e) => e.id === "a4");
  const [alias] = [...buildContext(events, FAKE_TODAY).aliases.keys()]; // 모델은 buildContext 가 매긴 별칭으로 고른다
  const h = createHarness({
    ask: async () => ({ op: "delete", id: alias }),
    events, now: () => NOW, out: (e) => e.type === "say" && said.push(e.text),
  });
  await h.send("쫑", "테스트 일정 지워줘");
  assert.ok(h.events().every((e) => !e.deleted), "확인 전엔 지우지 않는다");
  await h.send("빵", "응");
  assert.ok(h.events().every((e) => !e.deleted), "다른 사람의 응으로는 지우지 않는다");
  await h.send("쫑", "응");
  assert.ok(h.events().some((e) => e.id === "a4" && e.deleted), said.join(" / "));
});

test("승인 카드: 되묻는 말풍선에 카드가 실리고, 부탁한 사람이 눌러야 실행되며 결과가 카드를 끈다", async () => {
  const seen = [], events = FAKE_EVENTS.filter((e) => e.id === "a4");
  const [alias] = [...buildContext(events, FAKE_TODAY).aliases.keys()];
  const h = createHarness({ ask: async () => ({ op: "delete", id: alias }), events, now: () => NOW, out: (e) => e.type === "say" && seen.push(e) });
  await h.send("쫑", "테스트 지워줘");
  const card = seen.at(-1).ask;
  assert.ok(card && card.by === "쫑" && card.until > NOW && /^[a-z0-9]{12}$/.test(card.id));
  await h.tap("빵", true);
  assert.match(seen.at(-1).text, /쫑님이 눌러야/);
  assert.ok(h.events().every((e) => !e.deleted));
  await h.tap("쫑", true);
  assert.ok(h.events().some((e) => e.id === "a4" && e.deleted));
  assert.equal(seen.at(-1).done, card.id, "결과 말풍선이 그 카드를 끈다");
});

test("승인 카드: 취소·지난 카드도 done 으로 끈다", async () => {
  let t = NOW;
  const seen = [], events = FAKE_EVENTS.filter((e) => e.id === "a4");
  const [alias] = [...buildContext(events, FAKE_TODAY).aliases.keys()];
  const h = createHarness({ ask: async () => ({ op: "delete", id: alias }), events, now: () => t, out: (e) => e.type === "say" && seen.push(e) });
  await h.send("쫑", "테스트 지워줘");
  const first = seen.at(-1).ask;
  await h.tap("쫑", false);
  assert.equal(seen.at(-1).text, "🤖 취소했어요");
  assert.equal(seen.at(-1).done, first.id);
  await h.send("쫑", "테스트 지워줘");
  const second = seen.at(-1).ask;
  t += 11 * 60 * 1000; // 10분 지나면 카드는 끝
  await h.tap("쫑", true);
  assert.match(seen.at(-1).text, /지난 부탁/);
  assert.equal(seen.at(-1).done, second.id);
  assert.ok(h.events().every((e) => !e.deleted));
});

test("승인 카드: 앱과 싱크가 같은 필드 이름·id 형식을 쓴다", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../../duri/index.html", import.meta.url), "utf8");
  const sink = readFileSync(new URL("./duri-sink.mjs", import.meta.url), "utf8");
  for (const f of ["botAsk", "botDone", "dangiAnswer"]) {
    assert.ok(app.includes(f), `앱에 ${f} 가 없다`);
    assert.ok(sink.includes(f), `싱크에 ${f} 가 없다`);
  }
  assert.ok(app.includes("/^[a-z0-9]{12}$/.test(ask.id)"), "앱의 카드 id 검사는 randId(12자) 와 맞아야 한다");
  assert.ok(app.includes('text: ok ? "@당이 응" : "@당이 취소"'), "카드 답 글은 옛 싱크도 알아듣는 말이어야 한다");
});
