import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const KEEP = 30;   // 하루 한 번 올라오므로 대략 한 달치

export function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

/** 임시 파일에 쓰고 fsync 한 뒤 옮긴다 — 도중에 죽어도 반쪽짜리 파일이 남지 않는다. */
export function atomicWrite(path, data) {
  ensurePrivateDir(dirname(path));
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    const bytes = Buffer.from(data);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, path);
    chmodSync(path, 0o600);
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function kstDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export const fileNameFor = (now = new Date()) => `life-backup-${kstDate(now)}.json`;

/** 백업 파일이 맞는지. 아니면 쓰지 않는다 — 게이트가 로그인 HTML 을 돌려줬을 수도 있다. */
export function validateBackup(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error("JSON 이 아니다"); }
  if (!value || value.app !== "life") throw new Error("LIFE 백업이 아니다");
  if (typeof value.local !== "object" || !Array.isArray(value.databases)) throw new Error("형식이 다르다");
  const entries = Object.keys(value.local).length + value.databases.length;
  if (entries === 0) throw new Error("빈 백업은 받지 않는다");
  return value;
}

/** 오래된 것부터 지우고 최근 KEEP 개만 남긴다. */
export function prune(dir, keep = KEEP) {
  const files = readdirSync(dir)
    .filter((name) => /^life-backup-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  const dropped = files.slice(0, Math.max(0, files.length - keep));
  for (const name of dropped) unlinkSync(join(dir, name));
  return dropped;
}

export function createStore({ dir, now = () => new Date() }) {
  ensurePrivateDir(dir);
  const statePath = join(dir, "state.json");
  let state = {};
  try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { state = {}; }

  return {
    get etag() { return state.etag ?? null; },
    /** 받은 본문을 그날 파일로 남긴다. 같은 날 다시 오면 덮어쓴다. */
    save(text, etag) {
      validateBackup(text);
      const path = join(dir, fileNameFor(now()));
      atomicWrite(path, text);
      state = { etag: etag ?? null, savedAt: now().toISOString(), file: basename(path) };
      atomicWrite(statePath, JSON.stringify(state, null, 2));
      return { path, dropped: prune(dir) };
    },
  };
}
