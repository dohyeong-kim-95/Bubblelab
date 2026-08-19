import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  MAX_LISTS, NAME_MAX, TEXT_MAX, addItem, addList, clearDone, emptyState, parseState,
  LOG_MAX, orderedItems, progressOf, removeItem, removeList, renameList, reorderItems,
  reorderLists, setTool, toggleItem, toolSlug,
} = await import("../life/store.js");

const first = (state) => state.lists[0];

test("빈 상태는 목록 하나로 시작한다", () => {
  const state = emptyState();
  assert.equal(state.lists.length, 1);
  assert.deepEqual(first(state).items, []);
});

test("깨진 저장값은 조용히 빈 상태가 된다", () => {
  for (const raw of [null, "", "{", "[]", '{"v":2,"lists":[]}', '{"v":1,"lists":"x"}', '{"v":1,"lists":[]}']) {
    const state = parseState(raw);
    assert.equal(state.v, 1);
    assert.equal(state.lists.length, 1, `${raw} 에서 복구 실패`);
  }
});

test("저장했다 읽으면 그대로 돌아온다", () => {
  let state = emptyState();
  state = addItem(state, first(state).id, "우유 사기");
  state = addItem(state, first(state).id, "세탁");
  state = toggleItem(state, first(state).id, first(state).items[1].id);
  state = addList(state, "장보기");
  const restored = parseState(JSON.stringify(state));
  assert.deepEqual(restored, state);
});

test("불량 항목은 읽을 때 걸러진다", () => {
  const state = parseState(JSON.stringify({
    v: 1,
    lists: [
      { id: "a", name: "  이름   정리  ", items: [
        { id: "1", text: "정상", done: false },
        { id: "2", text: "   " },
        { text: "id 없음" },
        { id: "3", text: "x".repeat(TEXT_MAX + 50), done: "네" },
      ] },
      { id: "b" },
    ],
  }));
  assert.equal(state.lists.length, 1, "이름 없는 목록은 버린다");
  assert.equal(state.lists[0].name, "이름 정리");
  assert.equal(state.lists[0].items.length, 2, "빈 텍스트와 id 없는 항목은 버린다");
  assert.equal(state.lists[0].items[1].text.length, TEXT_MAX);
  assert.equal(state.lists[0].items[1].done, true);
});

test("항목을 더하고 지우고 완료한다", () => {
  let state = emptyState();
  const list = first(state).id;
  state = addItem(state, list, "  공백 정리   해줘 ");
  assert.equal(first(state).items[0].text, "공백 정리 해줘");
  state = addItem(state, list, "   ");
  assert.equal(first(state).items.length, 1, "빈 입력은 무시한다");

  const item = first(state).items[0].id;
  state = toggleItem(state, list, item);
  assert.equal(first(state).items[0].done, true);
  assert.deepEqual(progressOf(first(state)), { done: 1, total: 1 });
  state = toggleItem(state, list, item);
  assert.equal(first(state).items[0].done, false);
  state = removeItem(state, list, item);
  assert.equal(first(state).items.length, 0);
});

test("완료한 항목만 한 번에 지운다", () => {
  let state = emptyState();
  const list = first(state).id;
  state = addItem(state, list, "남을 것");
  state = addItem(state, list, "지울 것");
  state = toggleItem(state, list, first(state).items[1].id);
  state = clearDone(state, list);
  assert.deepEqual(first(state).items.map((item) => item.text), ["남을 것"]);
});

test("목록을 더하고 이름을 바꾸고 지운다", () => {
  let state = emptyState();
  state = addList(state, "장보기");
  assert.equal(state.lists.length, 2);
  state = renameList(state, state.lists[1].id, "주말 장보기");
  assert.equal(state.lists[1].name, "주말 장보기");
  assert.throws(() => renameList(state, state.lists[1].id, "   "), /이름/);
  assert.throws(() => addList(state, ""), /이름/);

  state = removeList(state, state.lists[1].id);
  assert.equal(state.lists.length, 1);
  assert.throws(() => removeList(state, first(state).id), /하나 이상/, "마지막 목록은 지울 수 없다");
});

test("목록 이름과 개수에 상한이 있다", () => {
  let state = emptyState();
  state = renameList(state, first(state).id, "가".repeat(NAME_MAX + 10));
  assert.equal(first(state).name.length, NAME_MAX);
  for (let n = state.lists.length; n < MAX_LISTS; n += 1) state = addList(state, `목록 ${n}`);
  assert.equal(state.lists.length, MAX_LISTS);
  assert.throws(() => addList(state, "하나 더"), new RegExp(`${MAX_LISTS}개`));
});

test("바꾸기는 원래 상태를 건드리지 않는다", () => {
  const state = emptyState();
  const snapshot = JSON.stringify(state);
  addItem(state, first(state).id, "새 항목");
  addList(state, "새 목록");
  assert.equal(JSON.stringify(state), snapshot);
});

test("도구 이름은 주소에 쓸 수 있는 슬러그만 받는다", () => {
  assert.equal(toolSlug("invest"), "invest");
  assert.equal(toolSlug("  Trip Budget "), "trip-budget");
  for (const bad of ["", "-시작", "../etc", "javascript:alert(1)", "a".repeat(33), "한글", "a b/c"]) {
    assert.equal(toolSlug(bad), null, `${bad} 는 거절해야 한다`);
  }
});

test("할 일에 도구를 붙이고 뗀다", () => {
  let state = emptyState();
  const list = first(state).id;
  state = addItem(state, list, "잔고 확인");
  const item = first(state).items[0].id;

  state = setTool(state, list, item, "Invest");
  assert.equal(first(state).items[0].tool, "invest");
  assert.throws(() => setTool(state, list, item, "../secret"), /소문자/);
  assert.equal(first(state).items[0].tool, "invest", "거절된 입력은 아무것도 바꾸지 않는다");

  state = setTool(state, list, item, "  ");
  assert.equal("tool" in first(state).items[0], false, "빈 값이면 연결이 끊긴다");
});

test("저장된 도구 이름도 읽을 때 검사한다", () => {
  const state = parseState(JSON.stringify({
    v: 1,
    lists: [{ id: "a", name: "목록", items: [
      { id: "1", text: "정상", tool: "invest" },
      { id: "2", text: "위험", tool: "javascript:alert(1)" },
      { id: "3", text: "대문자", tool: "Trip" },
    ] }],
  }));
  const [ok, unsafe, upper] = state.lists[0].items;
  assert.equal(ok.tool, "invest");
  assert.equal("tool" in unsafe, false, "주소에 못 쓰는 이름은 버린다");
  assert.equal(upper.tool, "trip");
});

test("미완료가 항상 위, 완료가 항상 아래", () => {
  let state = emptyState();
  const list = first(state).id;
  for (const text of ["하나", "둘", "셋", "넷"]) state = addItem(state, list, text);
  const [a, b, c, d] = first(state).items.map((item) => item.id);

  assert.deepEqual(orderedItems(first(state)).map((item) => item.text), ["하나", "둘", "셋", "넷"]);

  state = toggleItem(state, list, b);
  assert.deepEqual(orderedItems(first(state)).map((item) => item.text), ["하나", "셋", "넷", "둘"]);

  state = toggleItem(state, list, d);
  assert.deepEqual(orderedItems(first(state)).map((item) => item.text), ["하나", "셋", "둘", "넷"],
    "완료끼리도 적은 순서를 지킨다");

  // 완료를 취소하면 원래 자리로 돌아온다 — 저장된 배열을 흔들지 않기 때문이다.
  state = toggleItem(state, list, b);
  assert.deepEqual(orderedItems(first(state)).map((item) => item.text), ["하나", "둘", "셋", "넷"]);
  assert.equal(first(state).items[0].id, a);
  assert.equal(first(state).items[2].id, c);
});

test("한 목록 안에서 순서를 바꾼다", () => {
  let state = emptyState();
  const list = first(state).id;
  for (const text of ["하나", "둘", "셋"]) state = addItem(state, list, text);
  const [a, b, c] = first(state).items.map((item) => item.id);

  state = reorderItems(state, list, [c, a, b]);
  assert.deepEqual(first(state).items.map((item) => item.text), ["셋", "하나", "둘"]);

  // 넘어오지 않은 항목은 잃어버리지 않고 뒤에 남는다.
  state = reorderItems(state, list, [b]);
  assert.deepEqual(first(state).items.map((item) => item.text), ["둘", "셋", "하나"]);
  // 모르는 id 는 무시한다.
  state = reorderItems(state, list, ["없는-id", a]);
  assert.deepEqual(first(state).items.map((item) => item.text), ["하나", "둘", "셋"]);
});

test("완료한 항목은 순서를 바꿔도 아래에 남는다", () => {
  let state = emptyState();
  const list = first(state).id;
  for (const text of ["하나", "둘", "셋"]) state = addItem(state, list, text);
  const [a, b, c] = first(state).items.map((item) => item.id);
  state = toggleItem(state, list, a);
  // 완료한 "하나"를 맨 앞으로 끌어도 보이는 순서에서는 여전히 아래다.
  state = reorderItems(state, list, [a, c, b]);
  assert.deepEqual(orderedItems(first(state)).map((item) => item.text), ["셋", "둘", "하나"]);
});

test("목록끼리 순서를 바꾼다", () => {
  let state = emptyState();
  state = addList(state, "둘째");
  state = addList(state, "셋째");
  const [a, b, c] = state.lists.map((list) => list.id);
  state = reorderLists(state, [c, b, a]);
  assert.deepEqual(state.lists.map((list) => list.name), ["셋째", "둘째", "할 일"]);
  assert.equal(state.lists.length, 3);
});

test("끝낸 일은 기록으로 남는다 — 나중에 돌아보려면 지금부터 쌓여야 한다", () => {
  let state = emptyState();
  const list = first(state).id;
  state = addItem(state, list, "이력서 고치기");
  const item = first(state).items[0].id;

  const at = new Date("2026-08-19T09:00:00Z");
  state = toggleItem(state, list, item, at);
  assert.equal(first(state).items[0].doneAt, at.toISOString());
  assert.deepEqual(state.log, [{ id: item, text: "이력서 고치기", at: at.toISOString() }]);

  // 되돌리면 기록도 지운다 — 잘못 누른 것까지 세면 숫자가 거짓말이 된다.
  state = toggleItem(state, list, item, new Date("2026-08-19T09:01:00Z"));
  assert.equal(first(state).items[0].doneAt, null);
  assert.deepEqual(state.log, []);
});

test("항목을 지워도 끝냈다는 기록은 남는다", () => {
  let state = emptyState();
  const list = first(state).id;
  state = addItem(state, list, "치울 것");
  const item = first(state).items[0].id;
  state = toggleItem(state, list, item, new Date("2026-08-19T09:00:00Z"));

  state = clearDone(state, list);
  assert.equal(first(state).items.length, 0);
  assert.equal(state.log.length, 1, "정리해도 한 일은 남는다");

  state = addItem(state, list, "또 하나");
  const second = first(state).items[0].id;
  state = toggleItem(state, list, second, new Date("2026-08-20T09:00:00Z"));
  state = removeItem(state, list, second);
  assert.equal(state.log.length, 2, "지워도 남는다");
});

test("기록은 저장했다 읽어도 그대로고, 상한을 넘으면 오래된 것부터 버린다", () => {
  const at = (n) => new Date(2026, 0, 1, 0, 0, n).toISOString();
  const log = Array.from({ length: LOG_MAX + 20 }, (_, index) =>
    ({ id: `id-${index}`, text: `할 일 ${index}`, at: at(index) }));
  const state = parseState(JSON.stringify({ v: 1, lists: [{ id: "a", name: "목록", items: [] }], log }));
  assert.equal(state.log.length, LOG_MAX);
  assert.equal(state.log[0].id, "id-20", "오래된 것부터 버린다");
  assert.equal(state.log.at(-1).id, `id-${LOG_MAX + 19}`);
});

test("깨진 기록은 걸러 낸다", () => {
  const state = parseState(JSON.stringify({
    v: 1, lists: [{ id: "a", name: "목록", items: [] }],
    log: [{ id: "ok", text: "정상", at: "2026-08-19T00:00:00Z" }, { id: "x" }, null, { text: "id 없음", at: "x" }],
  }));
  assert.deepEqual(state.log.map((entry) => entry.id), ["ok"]);
});
