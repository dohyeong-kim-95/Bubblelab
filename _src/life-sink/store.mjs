import {
  chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const ITERATIONS = 310_000;
export const MAX_CONSECUTIVE_DECRYPT_FAILURES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const json = (value) => `${JSON.stringify(value)}\n`;
const fromBase64Url = (value) => Buffer.from(String(value), "base64url");

export class SnapshotRequiredError extends Error {
  constructor(message = "snapshot recovery required") { super(message); this.name = "SnapshotRequiredError"; }
}

export class WrongPassphraseError extends Error {
  constructor(seq) { super(`decrypt/schema failed ${MAX_CONSECUTIVE_DECRYPT_FAILURES} consecutive times at seq ${seq}`); this.name = "WrongPassphraseError"; this.seq = seq; }
}

export async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const rawSalt = typeof salt === "string" ? fromBase64Url(salt) : salt;
  if (!passphrase || !rawSalt?.length) throw new Error("passphrase and bootstrap salt are required");
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: rawSalt, iterations },
    material, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
}

export function ensurePrivateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function syncDirectory(path, warn = console.warn) {
  let fd;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch (error) {
    warn(`directory fsync unsupported for ${path}: ${error.message}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function atomicWrite(path, data, { warn = console.warn } = {}) {
  ensurePrivateDir(dirname(path));
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = openSync(temp, "wx", 0o600);
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, path);
    chmodSync(path, 0o600);
    syncDirectory(dirname(path), warn);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function appendDurable(path, line, warn) {
  ensurePrivateDir(dirname(path));
  const fd = openSync(path, "a", 0o600);
  try {
    const bytes = Buffer.from(line);
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  chmodSync(path, 0o600);
  syncDirectory(dirname(path), warn);
}

export function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") throw new Error("missing envelope");
  const entityId = envelope.entityId ?? envelope.id;
  const rev = envelope.nextRev ?? envelope.rev;
  if (!UUID.test(entityId ?? "")) throw new Error("invalid entityId");
  if (!Number.isSafeInteger(rev) || rev < 1) throw new Error("invalid envelope revision");
  if (typeof envelope.deleted !== "boolean") throw new Error("invalid deleted flag");
  if (envelope.schema !== 1) throw new Error("unsupported envelope schema");
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(envelope.iv ?? "")) throw new Error("invalid AES-GCM iv");
  if (typeof envelope.ct !== "string" || !envelope.ct.length) throw new Error("missing ciphertext");
  return { entityId, rev };
}

export function validateEntity(entity, expectedId) {
  if (!entity || typeof entity !== "object" || entity.id !== expectedId) throw new Error("entity id mismatch");
  if (entity.schemaVersion !== 1 || typeof entity.kind !== "string" || typeof entity.title !== "string") {
    throw new Error("invalid decrypted entity schema");
  }
  return entity;
}

export async function decryptEnvelope(key, envelope) {
  const { entityId, rev } = validateEnvelope(envelope);
  const aad = encoder.encode(`life:v1:${entityId}:${rev}:${envelope.deleted}`);
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(envelope.iv), additionalData: aad },
    key, fromBase64Url(envelope.ct),
  );
  return validateEntity(JSON.parse(decoder.decode(bytes)), entityId);
}

const envelopeOf = (record) => record?.envelope ?? record?.frame ?? record;

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

/** 화면과 같은 순서: 날짜 → 만든 시각 → id. 계층이 없으므로 평면 정렬 하나뿐이다. */
function orderEntities(entities) {
  return [...entities].sort((a, b) =>
    String(a.date ?? "").localeCompare(String(b.date ?? "")) ||
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) ||
    String(a.id).localeCompare(String(b.id)));
}

export function validateCurrentExport(current) {
  if (!current || current.protocol !== 1 || !Number.isSafeInteger(current.head) || !Array.isArray(current.entities)) {
    throw new Error("invalid current.json");
  }
  const ids = new Set();
  for (const entity of current.entities) {
    validateEntity(entity, entity?.id);
    if (ids.has(entity.id)) throw new Error("duplicate current entity");
    ids.add(entity.id);
  }
  return current;
}

export function createStore({ dir, key, now = () => new Date(), warn = console.warn }) {
  ensurePrivateDir(dir);
  for (const sub of ["archive/journal", "archive/snapshots", "quarantine", "state", "views"]) ensurePrivateDir(join(dir, sub));
  const cursorPath = join(dir, "state/cursor.json");
  const currentPath = join(dir, "views/current.json");
  const failurePath = join(dir, "state/decrypt-failures.json");
  let cursor = readJson(cursorPath, { seq: 0 }).seq ?? 0;
  let current = readJson(currentPath, { protocol: 1, head: 0, incomplete: false, entities: [] });
  let consecutiveFailures = readJson(failurePath, { count: 0 }).count ?? 0;
  const archived = new Set();
  for (const name of readdirSync(join(dir, "archive/journal"))) {
    if (!name.endsWith(".ndjson")) continue;
    for (const line of readFileSync(join(dir, "archive/journal", name), "utf8").split("\n")) {
      if (!line) continue;
      try { const seq = JSON.parse(line).seq; if (Number.isSafeInteger(seq)) archived.add(seq); } catch { /* corrupt archive is surfaced on replay */ }
    }
  }

  const publishCurrent = (entities, head, incomplete = current.incomplete) => {
    if (head < current.head || (entities.length === 0 && current.entities.length > 0 && head <= current.head)) {
      throw new Error("refusing to replace newer/non-empty current view");
    }
    const value = { protocol: 1, head, incomplete: Boolean(incomplete), updatedAt: now().toISOString(), entities: orderEntities(entities) };
    atomicWrite(currentPath, JSON.stringify(value, null, 2), { warn });
    current = value;
    return value;
  };

  const saveCursor = (seq) => {
    if (seq < cursor) throw new Error("cursor cannot move backwards");
    atomicWrite(cursorPath, JSON.stringify({ seq, updatedAt: now().toISOString() }, null, 2), { warn });
    cursor = seq;
  };

  const archiveChange = (change) => {
    if (archived.has(change.seq)) return false;
    const month = now().toISOString().slice(0, 7);
    appendDurable(join(dir, "archive/journal", `${month}.ndjson`), json(change), warn);
    archived.add(change.seq);
    return true;
  };

  async function applyChange(change) {
    if (!Number.isSafeInteger(change?.seq) || change.seq < 1) throw new Error("invalid journal seq");
    if (change.seq <= cursor) return { seq: cursor, duplicate: true, ack: true };
    if (cursor !== current.head) throw new SnapshotRequiredError(`local cursor ${cursor} does not match current view head ${current.head}`);
    if (change.seq !== cursor + 1) throw new SnapshotRequiredError(`journal gap ${cursor + 1}..${change.seq - 1}`);

    archiveChange(change); // canonical ciphertext is durable before decrypt/view/cursor
    let entity;
    try {
      entity = await decryptEnvelope(key, envelopeOf(change));
      consecutiveFailures = 0;
      atomicWrite(failurePath, JSON.stringify({ count: 0 }, null, 2), { warn });
    } catch (error) {
      consecutiveFailures += 1;
      atomicWrite(failurePath, JSON.stringify({ count: consecutiveFailures, lastSeq: change.seq }, null, 2), { warn });
      if (consecutiveFailures >= MAX_CONSECUTIVE_DECRYPT_FAILURES) throw new WrongPassphraseError(change.seq);
      atomicWrite(join(dir, "quarantine", `${String(change.seq).padStart(12, "0")}.json`), JSON.stringify({
        seq: change.seq, reason: error.message, archived: true, recordedAt: now().toISOString(), change,
      }, null, 2), { warn });
      publishCurrent(current.entities, change.seq, true);
      saveCursor(change.seq);
      return { seq: cursor, quarantined: true, ack: true };
    }

    const byId = new Map(current.entities.map((item) => [item.id, item]));
    if (entity.deletedAt) byId.delete(entity.id); else byId.set(entity.id, entity);
    publishCurrent([...byId.values()], change.seq);
    saveCursor(change.seq);
    return { seq: cursor, ack: true };
  }

  /* 저널이 우리 커서보다 앞서 잘렸을 때 서버가 통째로 넘겨준 현재 상태.
   * 암호문을 먼저 durable 하게 남긴 뒤 복호화·발행한다 — 저널이 잘려 사라진
   * 구간에서는 이 파일이 유일한 원본 기록이다. */
  async function applySnapshot(envelopes, head) {
    if (!Array.isArray(envelopes)) throw new Error("invalid snapshot envelopes");
    if (!Number.isSafeInteger(head) || head < 0) throw new Error("invalid snapshot head");
    for (const envelope of envelopes) validateEnvelope(envelopeOf(envelope));
    atomicWrite(
      join(dir, "archive/snapshots", `${String(head).padStart(12, "0")}.json`),
      JSON.stringify({ head, capturedAt: now().toISOString(), envelopes }, null, 2), { warn },
    );
    const byId = new Map();
    let incomplete = false;
    for (const envelope of envelopes) {
      try {
        const entity = await decryptEnvelope(key, envelopeOf(envelope));
        if (!entity.deletedAt) byId.set(entity.id, entity);
      } catch { incomplete = true; /* ciphertext is archived above; view says so */ }
    }
    publishCurrent([...byId.values()], head, incomplete);
    if (head >= cursor) saveCursor(head);
    return { head, entityCount: byId.size, incomplete, ack: true };
  }

  return {
    get cursor() { return cursor; },
    get current() { return current; },
    applyChange, applySnapshot, archiveChange,
    importCurrent(value) {
      validateCurrentExport(value);
      publishCurrent(value.entities, value.head, value.incomplete);
      saveCursor(value.head);
    },
  };
}
