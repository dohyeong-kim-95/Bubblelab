import test from "node:test";
import assert from "node:assert/strict";
import {
  LifeDO, LIFE_JOURNAL_KEEP, LIFE_MAX_ENTITY_BYTES, LIFE_MAX_FRAMES,
  LIFE_PAGE_MAX_RECORDS, validateLifeEnvelope,
} from "./life.js";

// 실제 DurableObjectStorage 의 배치 한도를 그대로 흉내낸다. 예전에 이 한도가
// 없는 가짜 스토리지 때문에, 한 번에 128개를 넘겨 프로덕션에서만 터지는
// put/delete 가 테스트를 그대로 통과한 적이 있다.
const STORAGE_MAX_BATCH = 128;

class MemoryStorage {
  constructor() { this.map = new Map(); this.listCalls = []; }
  async get(key) {
    if (Array.isArray(key)) {
      assert.ok(key.length <= STORAGE_MAX_BATCH, `get() 는 한 번에 ${STORAGE_MAX_BATCH}개까지다 (${key.length})`);
      return new Map(key.filter((k) => this.map.has(k)).map((k) => [k, this.map.get(k)]));
    }
    return this.map.get(key);
  }
  async put(key, value) {
    if (typeof key === "object") {
      const entries = Object.entries(key);
      assert.ok(entries.length <= STORAGE_MAX_BATCH, `put() 는 한 번에 ${STORAGE_MAX_BATCH}쌍까지다 (${entries.length})`);
      for (const [k, v] of entries) this.map.set(k, v);
    } else this.map.set(key, value);
  }
  async delete(keys) {
    const list = [].concat(keys);
    assert.ok(list.length <= STORAGE_MAX_BATCH, `delete() 는 한 번에 ${STORAGE_MAX_BATCH}개까지다 (${list.length})`);
    for (const key of list) this.map.delete(key);
  }
  async list(options = {}) {
    this.listCalls.push(options);
    let keys = [...this.map.keys()].sort();
    if (options.prefix) keys = keys.filter((k) => k.startsWith(options.prefix));
    if (options.start) keys = keys.filter((k) => k >= options.start);
    if (options.end) keys = keys.filter((k) => k < options.end);
    if (options.reverse) keys.reverse();
    if (options.limit != null) keys = keys.slice(0, options.limit);
    return new Map(keys.map((k) => [k, this.map.get(k)]));
  }
  async transaction(fn) { return fn(this); }
}

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mutation = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (n, nextRev = 1, extra = {}) => ({
  entityId: id(n), nextRev, deleted: false, iv: "AAAAAAAAAAAAAAAA", ct: `cipher_${n}`,
  schema: 1, ...extra,
});
const req = (path, method = "GET", body, role = "owner") => new Request(`https://life.internal${path}`, {
  method, headers: { "X-Life-Role": role, ...(body ? { "Content-Type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const parse = async (response) => ({ status: response.status, body: await response.json() });

async function commitOne(life, n) {
  const response = await life.fetch(req("/commit", "POST", {
    mutationId: mutation(n), frames: [{ baseRev: 0, ...envelope(n) }],
  }));
  assert.equal(response.status, 200, `commit ${n} 실패`);
}

test("envelope validator fixes the opaque server schema and 64KiB cap", () => {
  assert.deepEqual(validateLifeEnvelope(envelope(1)), envelope(1));
  assert.throws(() => validateLifeEnvelope({ ...envelope(1), entityId: "sys:forged" }), /entity id/);
  assert.throws(() => validateLifeEnvelope({ ...envelope(1), ct: "x".repeat(LIFE_MAX_ENTITY_BYTES) }), /too large/);
});

test("bootstrap is create-once and never replaces the original sentinel", async () => {
  const storage = new MemoryStorage();
  const life = new LifeDO({ storage });
  const first = { salt: "AAAAAAAAAAAAAAAA", sentinel: { iv: "BBBBBBBBBBBBBBBB", ct: "opaque", schema: 1 } };
  assert.equal((await parse(await life.fetch(req("/bootstrap", "POST", first)))).status, 201);
  assert.equal((await parse(await life.fetch(req("/bootstrap", "POST", { ...first, salt: "CCCCCCCCCCCCCCCC" })))).status, 409);
  assert.equal((await storage.get("bootstrap")).salt, first.salt);
});

test("commit is CAS atomic, idempotent, paginated and does not expose plaintext", async () => {
  const storage = new MemoryStorage();
  const life = new LifeDO({ storage });
  const body = { mutationId: mutation(1), frames: [{ baseRev: 0, ...envelope(1) }, { baseRev: 0, ...envelope(2) }] };
  let result = await parse(await life.fetch(req("/commit", "POST", body)));
  assert.equal(result.status, 200);
  assert.equal(result.body.head, 2);
  assert.equal((await parse(await life.fetch(req("/commit", "POST", body)))).body.head, 2);
  assert.equal((await storage.get("meta")).head, 2);

  result = await parse(await life.fetch(req("/commit", "POST", {
    mutationId: mutation(2), frames: [{ baseRev: 0, ...envelope(1, 1) }, { baseRev: 0, ...envelope(3) }],
  })));
  assert.equal(result.status, 409);
  assert.equal(result.body.conflicts[0].entityId, id(1));
  assert.equal(await storage.get(`entity:${id(3)}`), undefined, "stale batch must write nothing");
  const page = (await parse(await life.fetch(req("/changes?after=0&limit=1")))).body;
  assert.equal(page.changes.length, 1);
  assert.equal(page.hasMore, true);
  assert.equal(JSON.stringify(await (await life.fetch(req("/status"))).json()).includes("cipher_"), false);
});

test("서버가 처음 보는 항목의 충돌에는 latest 가 null 로 실린다", async () => {
  const life = new LifeDO({ storage: new MemoryStorage() });
  // baseRev 1 은 서버에 rev 1 이 이미 있다는 주장인데 실제로는 아무것도 없다.
  const result = await parse(await life.fetch(req("/commit", "POST", {
    mutationId: mutation(1), frames: [{ baseRev: 1, ...envelope(1, 2) }],
  })));
  assert.equal(result.status, 409);
  assert.deepEqual(result.body.conflicts, [{ entityId: id(1), latest: null }]);
});

test("최대 크기 커밋도 스토리지 배치 한도를 넘지 않는다", async () => {
  const storage = new MemoryStorage();
  const life = new LifeDO({ storage });
  const frames = Array.from({ length: LIFE_MAX_FRAMES }, (_, index) => ({ baseRev: 0, ...envelope(index + 1) }));
  const result = await parse(await life.fetch(req("/commit", "POST", { mutationId: mutation(1), frames })));
  assert.equal(result.status, 200);
  assert.equal(result.body.head, LIFE_MAX_FRAMES);
  assert.equal((await storage.get("meta")).entityCount, LIFE_MAX_FRAMES);
  assert.equal((await parse(await life.fetch(req("/commit", "POST", {
    mutationId: mutation(2), frames: [...frames, { baseRev: 0, ...envelope(999) }],
  })))).status, 400, "프레임 한도를 넘으면 거절한다");
});

test("snapshot 은 현재 엔터티를 head 와 함께 페이지로 돌려준다", async () => {
  const storage = new MemoryStorage();
  const life = new LifeDO({ storage });
  for (let n = 1; n <= 205; n += 1) await commitOne(life, n);

  const collected = [];
  let after = "";
  let pages = 0;
  for (;;) {
    const body = (await parse(await life.fetch(req(`/snapshot?limit=100${after ? `&after=${after}` : ""}`, "GET", undefined, "sink")))).body;
    assert.equal(body.head, 205, "페이지마다 그 시점의 head 를 알려준다");
    collected.push(...body.envelopes);
    pages += 1;
    if (body.done) { assert.equal(body.nextCursor, null); break; }
    after = body.nextCursor;
    assert.ok(after, "done 이 아니면 다음 커서가 있어야 한다");
  }
  assert.equal(pages, 3);
  assert.equal(collected.length, 205);
  assert.equal(collected[0].entityId, id(1));
  assert.equal(new Set(collected.map((item) => item.entityId)).size, 205);
  assert.ok(storage.listCalls.every((call) => call.limit <= LIFE_PAGE_MAX_RECORDS), "no unbounded list");
});

test("sink ack 은 단조롭고, 잘라낸 저널 뒤의 커서는 snapshot 으로 돌려보낸다", async () => {
  const storage = new MemoryStorage();
  const life = new LifeDO({ storage });
  const total = LIFE_JOURNAL_KEEP + 110;
  for (let n = 1; n <= total; n += 1) await commitOne(life, n);

  assert.equal((await life.fetch(req("/sink/ack", "POST", { seq: total }, "owner"))).status, 403, "owner 는 ack 할 수 없다");
  // 한 번의 ack 는 저널 한 페이지(100건)와 그 뮤테이션 키까지 200개를 지운다 —
  // 나눠 지우지 않으면 여기서 배치 한도에 걸린다.
  let acked = (await parse(await life.fetch(req("/sink/ack", "POST", { seq: total }, "sink")))).body;
  assert.equal(acked.ackSeq, total);
  assert.equal(acked.oldestSeq, 101);
  acked = (await parse(await life.fetch(req("/sink/ack", "POST", { seq: total }, "sink")))).body;
  assert.equal(acked.oldestSeq, 111, "다음 ack 가 남은 구간을 이어서 지운다");
  assert.equal((await life.fetch(req("/sink/ack", "POST", { seq: total - 1 }, "sink"))).status, 409, "뒤로 가는 ack 는 거절");

  assert.ok(await storage.get(`entity:${id(1)}`), "저널을 잘라도 현재 엔터티는 남는다");
  assert.equal(await storage.get("journal:000000000001"), undefined);
  const stale = (await parse(await life.fetch(req("/changes?after=50")))).body;
  assert.equal(stale.snapshotRequired, true);
  assert.equal(stale.oldestSeq, 111);
  const fresh = (await parse(await life.fetch(req(`/changes?after=${total - 1}`)))).body;
  assert.equal(fresh.snapshotRequired, undefined);
  assert.equal(fresh.changes.length, 1);
});
