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
