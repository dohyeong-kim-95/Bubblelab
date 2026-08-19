// 백업 봉투를 만들고 검사하는 순수 함수. 브라우저 저장소를 직접 만지는 일은
// app.js 가 한다 — 여기는 화면과 테스트가 같이 쓴다.
//
// 도구 목록을 어디에도 적어 두지 않는다. 도구가 생겼다 없어졌다 하는데 목록을
// 두면 등록을 잊는 순간 조용히 백업에서 빠진다. 대신 접두사로 찾는다.
export const PREFIX = "bl_";
export const FORMAT = 1;

export const isOurs = (name) => typeof name === "string" && name.startsWith(PREFIX);

export function makeEnvelope({ local = {}, databases = [] }, now = new Date()) {
  return {
    app: "life",
    format: FORMAT,
    exportedAt: now.toISOString(),
    local: Object.fromEntries(Object.entries(local).filter(([key]) => isOurs(key))),
    databases: databases.filter((database) => isOurs(database?.name)),
  };
}

export function parseEnvelope(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("JSON 파일이 아닙니다"); }
  if (!value || value.app !== "life") throw new Error("LIFE 백업 파일이 아닙니다");
  if (value.format !== FORMAT) throw new Error(`읽을 수 없는 형식입니다 (format ${value.format})`);
  const local = value.local && typeof value.local === "object" ? value.local : {};
  const databases = Array.isArray(value.databases) ? value.databases : [];
  return {
    app: "life",
    format: FORMAT,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : null,
    // 남의 키까지 덮어쓰지 않는다. 우리 것만 되돌린다.
    local: Object.fromEntries(Object.entries(local).filter(([key, item]) => isOurs(key) && typeof item === "string")),
    databases: databases.filter((database) => isOurs(database?.name) && Array.isArray(database?.stores)),
  };
}

/** 화면에 "무엇이 몇 개 들어 있는지" 보여 주려고. 도구 이름을 몰라도 셀 수 있다. */
export function summarize(envelope) {
  const rows = (database) => database.stores.reduce((sum, store) => sum + (store.rows?.length ?? 0), 0);
  return [
    ...Object.keys(envelope.local).map((key) => ({ name: key, kind: "설정·목록", count: null })),
    ...envelope.databases.map((database) => ({ name: database.name, kind: "기록", count: rows(database) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

/* PC 백업으로 보낼 때는 큰 이미지를 뺀다. 도구 이름을 알 필요 없이 "data: 로
 * 시작하는 긴 문자열"을 걷어낸다 — 앞으로 어떤 도구가 사진을 담아도 자동으로
 * 빠진다. 표지 같은 것은 파일 내보내기로만 보관한다. */
export const BLOB_MIN = 1024;

export function withoutBlobs(value) {
  if (typeof value === "string") {
    return value.startsWith("data:") && value.length > BLOB_MIN ? null : value;
  }
  if (Array.isArray(value)) return value.map(withoutBlobs);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutBlobs(item)]));
  }
  return value;
}

/* localStorage 값은 JSON 문자열이라 한 겹 열어서 훑어야 한다. 열지 못하면 그대로 둔다. */
export function slimEnvelope(envelope) {
  const local = Object.fromEntries(Object.entries(envelope.local).map(([key, raw]) => {
    try { return [key, JSON.stringify(withoutBlobs(JSON.parse(raw)))]; }
    catch { return [key, raw]; }
  }));
  return { ...envelope, local, databases: withoutBlobs(envelope.databases) };
}

export function fileName(now = new Date()) {
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return `life-backup-${stamp}.json`;
}
