// 오늘 할 일 한 종류만 다룬다. 계층도 부모도 없다 — 항목은 날짜 하나에
// 매달려 있고, 끝내지 못한 항목은 그 날짜가 지나면 이월 목록으로 보인다.
// 날짜 경계는 KST 자정이며 그 판단은 이 파일에만 있다.

const KINDS = new Set(["daily-action"]);
const STATUS = new Set(["active", "done"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const TITLE_MAX = 400;

export function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

export function makeAction(fields = {}, now = new Date()) {
  const timestamp = now.toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    kind: "daily-action",
    title: "",
    date: kstDate(now),
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    deletedAt: null,
    ...fields,
  };
}

export function validateEntity(entity) {
  const errors = [];
  if (!entity || typeof entity !== "object") return ["할 일이 객체가 아닙니다"];
  if (entity.schemaVersion !== 1) errors.push("지원하지 않는 schemaVersion입니다");
  if (!KINDS.has(entity.kind)) errors.push("알 수 없는 kind입니다");
  if (!UUID.test(entity.id || "")) errors.push("id가 올바른 UUID가 아닙니다");
  if (typeof entity.title !== "string" || !entity.title.trim() || entity.title.trim().length > TITLE_MAX) {
    errors.push("제목은 1자 이상 400자 이하여야 합니다");
  }
  if (!STATUS.has(entity.status)) errors.push("상태가 올바르지 않습니다");
  if (!DATE.test(entity.date || "")) errors.push("날짜가 올바르지 않습니다");
  if (entity.completedAt != null && typeof entity.completedAt !== "string") errors.push("완료 시각이 올바르지 않습니다");
  if (entity.deletedAt != null && typeof entity.deletedAt !== "string") errors.push("삭제 시각이 올바르지 않습니다");
  return errors;
}

export function validateCollection(entities) {
  if (!Array.isArray(entities)) return ["entities가 배열이 아닙니다"];
  const ids = new Set();
  const errors = [];
  for (const entity of entities) {
    if (ids.has(entity?.id)) errors.push(`중복 ID: ${entity.id}`);
    ids.add(entity?.id);
    errors.push(...validateEntity(entity).map((message) => `${entity?.id || "unknown"}: ${message}`));
  }
  return errors;
}

/** 살아 있는 항목을 만든 순서대로. 목록 정렬은 전부 이 함수를 지난다. */
export function openActions(entities) {
  return entities.filter((item) => !item.deletedAt)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
}

export function actionsOn(entities, date) {
  return openActions(entities).filter((item) => item.date === date);
}

/** 지난 날짜에 남아 있는 미완료 항목 — 오늘 화면 아래에 이월로 보인다. */
export function carriedOver(entities, today) {
  return openActions(entities).filter((item) => item.date < today && item.status !== "done");
}

export function conflictCopy(entity, now = new Date()) {
  const timestamp = now.toISOString();
  return {
    ...entity,
    id: crypto.randomUUID(),
    title: `${entity.title} (충돌 복사본)`.slice(0, TITLE_MAX),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** 가져오기는 기존 항목을 덮어쓰지 않는다 — id가 겹치면 새 id의 복사본이 된다. */
export function planImport(existing, imported, uuid = () => crypto.randomUUID(), now = new Date()) {
  const sourceErrors = validateCollection(imported);
  if (sourceErrors.length) throw new Error(sourceErrors.join(" · "));
  const occupied = new Set(existing.map((item) => item.id));
  const timestamp = now.toISOString();
  let copies = 0;
  const entities = imported.map((entity) => {
    let id = entity.id;
    if (occupied.has(id)) {
      do { id = uuid(); } while (occupied.has(id));
      copies += 1;
    }
    occupied.add(id);
    return {
      ...entity,
      id,
      title: id === entity.id ? entity.title : `${entity.title} (가져온 복사본)`.slice(0, TITLE_MAX),
      createdAt: id === entity.id ? entity.createdAt : timestamp,
      updatedAt: timestamp,
    };
  });
  const plannedErrors = validateCollection(entities);
  if (plannedErrors.length) throw new Error(plannedErrors.join(" · "));
  return { entities, copies };
}
