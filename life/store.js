// 할 일 목록 상태. 화면과 테스트가 같이 쓰는 순수 함수만 둔다 —
// 저장은 localStorage 한 곳이고 서버로 나가는 것은 없다.

export const STORAGE_KEY = "bl_life_v1";
export const MAX_LISTS = 12;
export const TEXT_MAX = 200;
export const NAME_MAX = 24;
// 도구 이름은 그대로 주소가 된다(life.bubblelab.dev/<이름>). 슬러그만 허용해
// javascript: 나 ../ 같은 것이 주소에 섞이지 않게 한다.
export const TOOL_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

const id = () => crypto.randomUUID();
const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function emptyState() {
  return { v: 1, lists: [{ id: id(), name: "할 일", items: [] }] };
}

/** 저장된 문자열을 상태로. 깨졌거나 비었으면 빈 상태로 시작한다. */
export function parseState(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { return emptyState(); }
  if (!value || value.v !== 1 || !Array.isArray(value.lists)) return emptyState();
  const lists = value.lists
    .filter((list) => list && typeof list.id === "string" && typeof list.name === "string")
    .slice(0, MAX_LISTS)
    .map((list) => ({
      id: list.id,
      name: clean(list.name, NAME_MAX) || "목록",
      items: (Array.isArray(list.items) ? list.items : [])
        .filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
        .map((item) => ({
          id: item.id,
          text: clean(item.text, TEXT_MAX),
          done: Boolean(item.done),
          ...(toolSlug(item.tool) ? { tool: toolSlug(item.tool) } : {}),
        }))
        .filter((item) => item.text),
    }));
  return lists.length ? { v: 1, lists } : emptyState();
}

const mapList = (state, listId, fn) => ({
  ...state,
  lists: state.lists.map((list) => (list.id === listId ? fn(list) : list)),
});

export function addList(state, name) {
  if (state.lists.length >= MAX_LISTS) throw new Error(`목록은 ${MAX_LISTS}개까지예요`);
  const label = clean(name, NAME_MAX);
  if (!label) throw new Error("목록 이름을 적어주세요");
  return { ...state, lists: [...state.lists, { id: id(), name: label, items: [] }] };
}

export function renameList(state, listId, name) {
  const label = clean(name, NAME_MAX);
  if (!label) throw new Error("목록 이름을 적어주세요");
  return mapList(state, listId, (list) => ({ ...list, name: label }));
}

export function removeList(state, listId) {
  if (state.lists.length <= 1) throw new Error("목록은 하나 이상 있어야 해요");
  return { ...state, lists: state.lists.filter((list) => list.id !== listId) };
}

/** 사람이 적은 것을 주소에 쓸 수 있는 이름으로. 못 쓰는 글자면 null. */
export function toolSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return TOOL_PATTERN.test(slug) ? slug : null;
}

/** 할 일에 도구를 연결한다. 빈 값을 주면 연결을 끊는다. */
export function setTool(state, listId, itemId, value) {
  const raw = String(value ?? "").trim();
  const slug = raw ? toolSlug(raw) : null;
  if (raw && !slug) throw new Error("영문 소문자·숫자·하이픈으로 32자까지만 쓸 수 있어요");
  return mapList(state, listId, (list) => ({
    ...list,
    items: list.items.map((item) => {
      if (item.id !== itemId) return item;
      const next = { ...item };
      if (slug) next.tool = slug; else delete next.tool;
      return next;
    }),
  }));
}

export function addItem(state, listId, text) {
  const label = clean(text, TEXT_MAX);
  if (!label) return state;
  return mapList(state, listId, (list) => ({
    ...list, items: [...list.items, { id: id(), text: label, done: false }],
  }));
}

export function toggleItem(state, listId, itemId) {
  return mapList(state, listId, (list) => ({
    ...list,
    items: list.items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item)),
  }));
}

export function removeItem(state, listId, itemId) {
  return mapList(state, listId, (list) => ({
    ...list, items: list.items.filter((item) => item.id !== itemId),
  }));
}

export function clearDone(state, listId) {
  return mapList(state, listId, (list) => ({ ...list, items: list.items.filter((item) => !item.done) }));
}

/* 순서 바꾸기는 "화면에 보이던 id 순서"를 그대로 받는다. 화면이 이미 정답을
 * 들고 있으니 인덱스 계산을 양쪽에서 되풀이하지 않는다. 목록에 있는데 넘어오지
 * 않은 것은 뒤에 붙여 잃어버리지 않는다. */
function applyOrder(items, orderedIds) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const moved = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(moved.map((item) => item.id));
  return [...moved, ...items.filter((item) => !seen.has(item.id))];
}

export function reorderItems(state, listId, orderedIds) {
  return mapList(state, listId, (list) => ({ ...list, items: applyOrder(list.items, orderedIds) }));
}

export function reorderLists(state, orderedIds) {
  return { ...state, lists: applyOrder(state.lists, orderedIds) };
}

/** 화면에 보이는 순서: 미완료가 먼저, 완료가 뒤. 각 묶음 안에서는 적은 순서 그대로.
 *  저장된 배열은 건드리지 않는다 — 완료를 취소하면 원래 자리로 돌아가야 한다. */
export function orderedItems(list) {
  const items = list.items;
  return [...items.filter((item) => !item.done), ...items.filter((item) => item.done)];
}

export const progressOf = (list) => ({
  done: list.items.filter((item) => item.done).length,
  total: list.items.length,
});
