import { dbAll, dbBulkPut, dbDelete, dbGet, dbPut, dbQueueMutation } from "./db.js";
import { decryptEnvelope, encryptEntity } from "./crypto.js";

// 서버의 LIFE_MAX_FRAMES 와 같아야 한다. 가져오기처럼 한 번에 여러 건을 만드는
// 곳은 이 크기로 잘라 여러 뮤테이션으로 보낸다 — 하나가 통째로 거절당해
// outbox 가 막히는 일이 없도록.
export const MAX_FRAMES = 50;

/** 로컬 개발(`/life/…`)과 프로덕션(`life.bubblelab.dev`) 양쪽에서 게이트 경로를 맞춘다. */
export function lifeBase(pathname = globalThis.location?.pathname || "/") {
  return pathname === "/life" || pathname.startsWith("/life/") ? "/life" : "";
}

export async function lifeFetch(path, options = {}) {
  const response = await fetch(`/_life/${path}`, {
    ...options,
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  if (response.status === 401) globalThis.dispatchEvent?.(new CustomEvent("life:unauthorized"));
  return response;
}

export async function readLocal(db, key) {
  const envelopes = await dbAll(db, "envelopes");
  const entities = [];
  if (!key) return { entities, envelopes };
  for (const envelope of envelopes) {
    if (envelope.deleted) continue;
    try { entities.push(await decryptEnvelope(key, envelope)); } catch { /* corrupt records remain encrypted */ }
  }
  return { entities, envelopes };
}

export async function queueEntity(db, key, entity) {
  const [envelope] = await queueEntities(db, key, [entity]);
  return envelope;
}

export async function queueEntities(db, key, entities) {
  if (!entities.length) return [];
  const queued = [];
  for (let index = 0; index < entities.length; index += MAX_FRAMES) {
    const envelopes = [];
    for (const entity of entities.slice(index, index + MAX_FRAMES)) {
      const current = await dbGet(db, "envelopes", entity.id);
      envelopes.push(await encryptEntity(key, entity, current?.nextRev || 0));
    }
    const mutationId = crypto.randomUUID();
    await dbQueueMutation(
      db,
      envelopes.map((envelope) => ({ id: envelope.entityId, ...envelope })),
      { id: mutationId, mutationId, frames: envelopes, createdAt: new Date().toISOString() },
    );
    queued.push(...envelopes);
  }
  return queued;
}

export function fromServerEnvelope(frame) {
  if (frame.entityId) return frame;
  return { entityId: frame.id, baseRev: frame.rev - 1, nextRev: frame.rev, deleted: frame.deleted, iv: frame.iv, ct: frame.ct, schema: frame.schema };
}

export function toServerFrame(frame) {
  return { baseRev: frame.baseRev, envelope: { id: frame.entityId, rev: frame.nextRev, deleted: frame.deleted, iv: frame.iv, ct: frame.ct, schema: frame.schema } };
}

const storable = (frames) => frames.map((frame) => ({ id: frame.entityId, ...frame }));

/* 저널이 우리 커서보다 앞서 잘렸을 때. 서버의 entity: 전체를 페이지로 받아
 * 통째로 덮어쓴다 — 삭제된 항목도 tombstone envelope 로 들어 있으므로 이
 * 한 번으로 서버 상태와 완전히 같아진다. 페이지를 받는 도중 서버가 바뀌면
 * (head 가 달라지면) 처음부터 다시 받는다. */
export async function restoreSnapshot(db) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const envelopes = [];
    let after = "";
    let head = null;
    let consistent = true;
    let done = false;
    while (!done && consistent) {
      const query = `snapshot?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const response = await lifeFetch(query);
      if (!response.ok) throw new Error(`스냅샷 실패 (${response.status})`);
      const result = await response.json();
      if (head === null) head = result.head;
      else if (result.head !== head) { consistent = false; break; }
      envelopes.push(...(result.envelopes || []).map(fromServerEnvelope));
      if (result.done || !result.nextCursor) done = true;
      else after = result.nextCursor;
    }
    if (!consistent) continue;
    await dbBulkPut(db, "envelopes", storable(envelopes));
    await dbPut(db, "meta", { id: "cursor", value: head });
    return { cursor: head, envelopes };
  }
  throw new Error("스냅샷을 받는 동안 서버가 계속 바뀌었습니다");
}

export async function pullChanges(db, key) {
  let after = (await dbGet(db, "meta", "cursor"))?.value || 0;
  const entities = [];
  const decrypt = async (frames) => {
    for (const frame of frames) {
      if (frame.deleted) continue;
      try { entities.push(await decryptEnvelope(key, frame)); } catch { /* surfaced by local validation later */ }
    }
  };
  for (let page = 0; page < 50; page += 1) {
    const response = await lifeFetch(`changes?after=${after}&limit=100`);
    if (!response.ok) throw new Error(`동기화 실패 (${response.status})`);
    const result = await response.json();
    if (result.snapshotRequired) {
      const restored = await restoreSnapshot(db);
      after = restored.cursor;
      await decrypt(restored.envelopes);
      continue;
    }
    const frames = (result.changes || []).map((change) => fromServerEnvelope(change.envelope || change));
    if (frames.length) {
      await dbBulkPut(db, "envelopes", storable(frames));
      await decrypt(frames);
    }
    after = result.cursor ?? after;
    await dbPut(db, "meta", { id: "cursor", value: after });
    if (!result.hasMore) break;
  }
  return entities;
}

export async function flushOutbox(db) {
  const outbox = await dbAll(db, "outbox");
  const ordered = outbox.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  for (const mutation of ordered) {
    const response = await lifeFetch("commit", {
      method: "POST",
      body: JSON.stringify({ mutationId: mutation.mutationId, frames: mutation.frames.map(toServerFrame) }),
    });
    if (response.status === 409) {
      const conflict = await response.json();
      await dbPut(db, "conflicts", {
        id: mutation.id, mutation, remote: conflict.conflicts || [], createdAt: new Date().toISOString(),
      });
      await dbDelete(db, "outbox", mutation.id);
      continue;
    }
    if (!response.ok) throw new Error(`저장 실패 (${response.status})`);
    await dbDelete(db, "outbox", mutation.id);
  }
}

export async function syncNow(db, key) {
  await flushOutbox(db);
  const entities = await pullChanges(db, key);
  await dbPut(db, "meta", { id: "lastSync", value: new Date().toISOString() });
  return entities;
}
