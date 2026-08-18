import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  MAX_LISTS, NAME_MAX, TEXT_MAX, addItem, addList, clearDone, emptyState, parseState,
  progressOf, removeItem, removeList, renameList, toggleItem,
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
