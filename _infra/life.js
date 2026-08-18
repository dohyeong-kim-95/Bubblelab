// Life OS encrypted state relay. The Worker authenticates callers and assigns
// X-Life-Role (owner|sink); this object only ever stores opaque envelopes.
//
// 저장 구조는 두 가지뿐이다. `entity:<id>` 가 현재 상태이고 `journal:<seq>` 는
// 거기에 이르기까지의 변경 로그다. 스냅샷은 따로 만들어 두지 않는다 —
// `entity:` 를 페이지로 훑어 주면 그게 곧 스냅샷이라, 싱크나 오래 쉰 기기가
// 저널이 잘린 지점보다 뒤처져도 여기서 다시 시작할 수 있다.

export const LIFE_PROTOCOL = 1;
export const LIFE_MAX_ENTITY_BYTES = 64 * 1024;
export const LIFE_MAX_COMMIT_BYTES = 512 * 1024;
export const LIFE_MAX_FRAMES = 50;
export const LIFE_PAGE_MAX_RECORDS = 100;
// 싱크가 받아갔더라도 이만큼은 남겨 둔다(다른 기기가 조금 뒤처져 있어도
// 스냅샷까지 가지 않고 저널만 따라잡게).
export const LIFE_JOURNAL_KEEP = 500;
export const LIFE_WARN_BYTES = 24 * 1024 * 1024;
export const LIFE_MAX_CURRENT_BYTES = 32 * 1024 * 1024;
export const LIFE_MAX_ENTITIES = 50_000;
// DurableObjectStorage 의 put/get/delete 는 한 번에 128개까지만 받는다.
const STORAGE_BATCH = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B64URL = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();
const bytesOf = (value) => encoder.encode(JSON.stringify(value)).byteLength;
const seqKey = (seq) => `journal:${String(seq).padStart(12, "0")}`;
const entityKey = (id) => `entity:${id}`;

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function validateLifeEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid envelope");
  const entityId = value.entityId ?? value.id;
  const nextRev = value.nextRev ?? value.rev;
  if (!UUID.test(entityId ?? "")) throw new Error("invalid entity id");
  if (!Number.isSafeInteger(nextRev) || nextRev < 1) throw new Error("invalid revision");
  if (typeof value.deleted !== "boolean") throw new Error("invalid deleted flag");
  if (value.schema !== 1) throw new Error("unsupported envelope schema");
  if (typeof value.iv !== "string" || value.iv.length < 16 || value.iv.length > 32 || !B64URL.test(value.iv)) {
    throw new Error("invalid iv");
  }
  if (typeof value.ct !== "string" || !value.ct.length || !B64URL.test(value.ct)) throw new Error("invalid ciphertext");
  const normalized = { entityId, nextRev, deleted: value.deleted, iv: value.iv, ct: value.ct, schema: 1 };
  if (bytesOf(normalized) > LIFE_MAX_ENTITY_BYTES) throw new Error("entity too large");
  return normalized;
}

function validateSentinel(value) {
  if (!value || typeof value !== "object" || value.schema !== 1 ||
      typeof value.iv !== "string" || value.iv.length < 16 || value.iv.length > 32 || !B64URL.test(value.iv) ||
      typeof value.ct !== "string" || !value.ct.length || !B64URL.test(value.ct)) throw new Error("invalid sentinel");
  const normalized = { iv: value.iv, ct: value.ct, schema: 1 };
  if (bytesOf(normalized) > LIFE_MAX_ENTITY_BYTES) throw new Error("sentinel too large");
  return normalized;
}

function parseLimit(value) {
  const n = Number(value ?? LIFE_PAGE_MAX_RECORDS);
  return Number.isInteger(n) ? Math.min(LIFE_PAGE_MAX_RECORDS, Math.max(1, n)) : LIFE_PAGE_MAX_RECORDS;
}

function storageEntries(result) {
  return result instanceof Map ? [...result.entries()] : Object.entries(result ?? {});
}

async function list(storage, options) {
  return storageEntries(await storage.list(options));
}

/* 아래 셋은 128개 배치 한도를 넘지 않게 잘라서 부른다. 트랜잭션 안에서
 * 부르므로 여러 번 나눠 써도 커밋 원자성은 그대로다. */
async function putAll(storage, entries) {
  const keys = Object.keys(entries);
  for (let index = 0; index < keys.length; index += STORAGE_BATCH) {
    const chunk = {};
    for (const key of keys.slice(index, index + STORAGE_BATCH)) chunk[key] = entries[key];
    await storage.put(chunk);
  }
}

async function deleteAll(storage, keys) {
  for (let index = 0; index < keys.length; index += STORAGE_BATCH) {
    await storage.delete(keys.slice(index, index + STORAGE_BATCH));
  }
}

async function getAll(storage, keys) {
  const found = new Map();
  for (let index = 0; index < keys.length; index += STORAGE_BATCH) {
    for (const [key, value] of storageEntries(await storage.get(keys.slice(index, index + STORAGE_BATCH)))) {
      found.set(key, value);
    }
  }
  return found;
}

export class LifeDO {
  constructor(state) {
    this.state = state;
  }

  async atomic(fn) {
    if (typeof this.state.storage.transaction === "function") {
      return this.state.storage.transaction(fn);
    }
    return fn(this.state.storage);
  }

  async meta(storage = this.state.storage) {
    return (await storage.get("meta")) ?? {
      protocol: LIFE_PROTOCOL, head: 0, oldestSeq: 1, entityCount: 0,
      currentBytes: 0, sinkAckSeq: 0, sinkLastSeen: null,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = request.headers.get("X-Life-Role") === "sink" ? "sink" : "owner";
    try {
      if (url.pathname === "/bootstrap") {
        return request.method === "GET" ? this.getBootstrap() :
          request.method === "POST" && role === "owner" ? this.bootstrap(request) : json({ error: "method not allowed" }, 405);
      }
      if (url.pathname === "/commit") {
        return request.method === "POST" && role === "owner" ? this.commit(request) : json({ error: "forbidden" }, 403);
      }
      if (url.pathname === "/changes" && request.method === "GET") return this.changes(url);
      if (url.pathname === "/snapshot" && request.method === "GET") return this.snapshot(url);
      if (url.pathname === "/status" && request.method === "GET") return this.status();
      if (url.pathname === "/sink/ack") {
        return request.method === "POST" && role === "sink" ? this.ack(request) : json({ error: "forbidden" }, 403);
      }
      return json({ error: "not found" }, 404);
    } catch (error) {
      return json({ error: error?.message || "invalid request" }, 400);
    }
  }

  async getBootstrap() {
    const [bootstrap, meta] = await Promise.all([this.state.storage.get("bootstrap"), this.meta()]);
    return json({ protocol: LIFE_PROTOCOL, initialized: Boolean(bootstrap), ...(bootstrap ?? {}),
      head: meta.head, oldestSeq: meta.oldestSeq, sinkAckSeq: meta.sinkAckSeq });
  }

  async bootstrap(request) {
    const body = await request.json();
    if (typeof body?.salt !== "string" || body.salt.length < 16 || body.salt.length > 128 || !B64URL.test(body.salt)) {
      return json({ error: "invalid salt" }, 400);
    }
    const sentinel = validateSentinel(body.sentinel);
    return this.atomic(async (storage) => {
      if (await storage.get("bootstrap")) return json({ error: "already initialized" }, 409);
      await storage.put({ bootstrap: { salt: body.salt, sentinel }, meta: await this.meta(storage) });
      return json({ created: true, protocol: LIFE_PROTOCOL }, 201);
    });
  }

  async commit(request) {
    const body = await request.json();
    if (!body || typeof body.mutationId !== "string" || !UUID.test(body.mutationId)) return json({ error: "invalid mutationId" }, 400);
    if (!Array.isArray(body.frames) || !body.frames.length || body.frames.length > LIFE_MAX_FRAMES) return json({ error: "invalid frames" }, 400);
    if (bytesOf(body) > LIFE_MAX_COMMIT_BYTES) return json({ error: "request body too large" }, 413);
    const ids = new Set();
    let frames;
    try {
      frames = body.frames.map((frame) => {
        const source = frame?.envelope ?? frame;
        const envelope = validateLifeEnvelope(source);
        const baseRev = frame?.baseRev ?? source?.baseRev;
        if (!Number.isSafeInteger(baseRev) || baseRev < 0 || envelope.nextRev !== baseRev + 1) throw new Error("invalid revision transition");
        if (ids.has(envelope.entityId)) throw new Error("duplicate entity frame");
        ids.add(envelope.entityId);
        return { baseRev, envelope, bytes: bytesOf(envelope) };
      });
    } catch (error) { return json({ error: error.message }, error.message === "entity too large" ? 413 : 400); }

    return this.atomic(async (storage) => {
      const replay = await storage.get(`mutation:${body.mutationId}`);
      if (replay) return json(replay);
      const current = await getAll(storage, [...ids].map(entityKey));
      const conflicts = [];
      for (const frame of frames) {
        const latest = current.get(entityKey(frame.envelope.entityId));
        if ((latest?.nextRev ?? 0) !== frame.baseRev) conflicts.push({ entityId: frame.envelope.entityId, latest: latest ?? null });
      }
      if (conflicts.length) return json({ error: "revision conflict", conflicts }, 409);
      const meta = await this.meta(storage);
      let projectedBytes = meta.currentBytes;
      let projectedCount = meta.entityCount;
      for (const frame of frames) {
        const old = current.get(entityKey(frame.envelope.entityId));
        projectedBytes += frame.bytes - (old ? bytesOf(old) : 0);
        if (!old) projectedCount += 1;
      }
      if ((projectedBytes > LIFE_MAX_CURRENT_BYTES || projectedCount > LIFE_MAX_ENTITIES) && projectedBytes > meta.currentBytes) {
        return json({ error: "storage capacity exceeded" }, 507);
      }
      const puts = {};
      let head = meta.head;
      for (const frame of frames) {
        head += 1;
        puts[entityKey(frame.envelope.entityId)] = frame.envelope;
        puts[seqKey(head)] = { seq: head, mutationId: body.mutationId, envelope: frame.envelope };
      }
      const result = { mutationId: body.mutationId, head,
        revisions: frames.map((f) => ({ entityId: f.envelope.entityId, nextRev: f.envelope.nextRev })) };
      puts.meta = { ...meta, head, entityCount: projectedCount, currentBytes: projectedBytes };
      puts[`mutation:${body.mutationId}`] = result;
      await putAll(storage, puts);
      return json(result);
    });
  }

  async changes(url) {
    const meta = await this.meta();
    const after = Math.max(0, Number(url.searchParams.get("after") ?? 0));
    if (!Number.isSafeInteger(after)) return json({ error: "invalid cursor" }, 400);
    // 저널이 이 지점보다 앞서 잘렸다 — 스냅샷부터 다시 시작해야 한다.
    if (after < meta.oldestSeq - 1) {
      return json({ snapshotRequired: true, head: meta.head, oldestSeq: meta.oldestSeq });
    }
    const limit = parseLimit(url.searchParams.get("limit"));
    const rows = await list(this.state.storage, { prefix: "journal:", start: seqKey(after + 1), limit });
    const changes = rows.map(([, value]) => value).filter((v) => v.seq > after).slice(0, limit);
    const cursor = changes.at(-1)?.seq ?? after;
    return json({ changes, cursor, head: meta.head, oldestSeq: meta.oldestSeq, hasMore: cursor < meta.head });
  }

  /* 현재 엔터티를 그대로 페이지로 돌려준다. 페이지마다 그 시점의 head 를 함께
   * 보내므로, 읽는 도중 쓰기가 끼어들면 호출자가 head 가 달라진 것을 보고
   * 처음부터 다시 받는다. */
  async snapshot(url) {
    const meta = await this.meta();
    const limit = parseLimit(url.searchParams.get("limit"));
    const after = url.searchParams.get("after") || "";
    const rows = await list(this.state.storage, {
      prefix: "entity:", ...(after ? { start: `${entityKey(after)}\0` } : {}), limit,
    });
    const nextCursor = rows.length === limit ? rows.at(-1)[0].slice("entity:".length) : null;
    return json({ protocol: LIFE_PROTOCOL, head: meta.head, entityCount: meta.entityCount,
      envelopes: rows.map(([, value]) => value), nextCursor, done: nextCursor === null });
  }

  async status() {
    const meta = await this.meta();
    return json({ protocol: LIFE_PROTOCOL, head: meta.head, oldestSeq: meta.oldestSeq,
      entityCount: meta.entityCount, currentBytes: meta.currentBytes, storageWarning: meta.currentBytes >= LIFE_WARN_BYTES,
      sinkAckSeq: meta.sinkAckSeq, sinkLag: meta.head - meta.sinkAckSeq, sinkLastSeen: meta.sinkLastSeen });
  }

  async ack(request) {
    const body = await request.json();
    if (!Number.isSafeInteger(body?.seq) || body.seq < 0) return json({ error: "invalid seq" }, 400);
    return this.atomic(async (storage) => {
      const meta = await this.meta(storage);
      if (body.seq < meta.sinkAckSeq || body.seq > meta.head) return json({ error: "invalid ack" }, 409);
      const next = { ...meta, sinkAckSeq: body.seq, sinkLastSeen: Date.now() };
      const through = body.seq - LIFE_JOURNAL_KEEP;
      if (through >= next.oldestSeq) {
        const rows = await list(storage, { prefix: "journal:", end: seqKey(through + 1), limit: LIFE_PAGE_MAX_RECORDS });
        if (rows.length) {
          const keys = rows.map(([key]) => key);
          for (const [, entry] of rows) if (entry?.mutationId) keys.push(`mutation:${entry.mutationId}`);
          await deleteAll(storage, [...new Set(keys)]);
          // 한 번에 한 페이지씩만 지우므로 실제로 지운 마지막 seq 를 기준으로 옮긴다.
          next.oldestSeq = Math.max(next.oldestSeq, rows.at(-1)[1].seq + 1);
        }
      }
      await storage.put("meta", next);
      return json({ ackSeq: next.sinkAckSeq, head: next.head, oldestSeq: next.oldestSeq });
    });
  }
}
