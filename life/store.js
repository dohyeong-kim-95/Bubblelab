// 할 일 목록 상태. 화면과 테스트가 같이 쓰는 순수 함수만 둔다 —
// 저장은 localStorage 한 곳이고 서버로 나가는 것은 없다.

export const STORAGE_KEY = "bl_life_v1";
export const MAX_LISTS = 12;
export const TEXT_MAX = 200;
export const NAME_MAX = 24;

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
        .map((item) => ({ id: item.id, text: clean(item.text, TEXT_MAX), done: Boolean(item.done) }))
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

export const progressOf = (list) => ({
  done: list.items.filter((item) => item.done).length,
  total: list.items.length,
});
