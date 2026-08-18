import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { createSentinel, decodeBase64Url, deriveKey, encryptEntity, randomSalt, verifySentinel, decryptEnvelope } = await import("../life/crypto.js");
const { actionsOn, carriedOver, conflictCopy, kstDate, makeAction, planImport, validateCollection, validateEntity } = await import("../life/model.js");
const { MAX_FRAMES, fromServerEnvelope, lifeBase, toServerFrame } = await import("../life/sync.js");

const AT = new Date("2026-08-17T02:00:00.000Z");
const action = (title, fields = {}) => makeAction({ title, ...fields }, AT);

test("KST 자정에서 날짜가 넘어간다", () => {
  assert.equal(kstDate(new Date("2026-08-16T14:59:59Z")), "2026-08-16");
  assert.equal(kstDate(new Date("2026-08-16T15:00:00Z")), "2026-08-17");
  assert.equal(makeAction({}, new Date("2026-08-16T15:00:00Z")).date, "2026-08-17");
});

test("할 일은 제목과 날짜만 요구하고 부모를 갖지 않는다", () => {
  const item = action("20분 달리기");
  assert.deepEqual(validateEntity(item), []);
  assert.equal(item.kind, "daily-action");
  assert.equal(item.status, "active");
  assert.match(validateEntity({ ...item, title: "   " }).join(" "), /제목/);
  assert.match(validateEntity({ ...item, title: "가".repeat(401) }).join(" "), /제목/);
  assert.match(validateEntity({ ...item, date: "2026-8-1" }).join(" "), /날짜/);
  assert.match(validateEntity({ ...item, status: "archived" }).join(" "), /상태/);
  assert.match(validateEntity({ ...item, id: "sys:focus:v1" }).join(" "), /UUID/);
});

test("hostile title은 이스케이프 없이 데이터로 남는다", () => {
  const hostile = action("<img src=x onerror=alert(1)>");
  assert.deepEqual(validateEntity(hostile), []);
  assert.equal(hostile.title, "<img src=x onerror=alert(1)>");
});

test("오늘 목록과 이월 목록을 날짜로 가른다", () => {
  const entities = [
    action("오늘 하나", { date: "2026-08-17" }),
    action("어제 못한 것", { date: "2026-08-16" }),
    action("어제 끝낸 것", { date: "2026-08-16", status: "done" }),
    action("지운 것", { date: "2026-08-17", deletedAt: AT.toISOString() }),
  ];
  assert.deepEqual(actionsOn(entities, "2026-08-17").map((item) => item.title), ["오늘 하나"]);
  assert.deepEqual(carriedOver(entities, "2026-08-17").map((item) => item.title), ["어제 못한 것"]);
  assert.deepEqual(carriedOver(entities, "2026-08-16"), [], "미래 날짜는 이월이 아니다");
});

test("AES-GCM envelope이 왕복되고 IV는 매번 달라진다", async () => {
  const key = await deriveKey("correct horse battery staple", randomSalt());
  const entity = action("20분 달리기");
  const first = await encryptEntity(key, entity, 0);
  const second = await encryptEntity(key, entity, 0);
  assert.notEqual(first.iv, second.iv);
  assert.equal(decodeBase64Url(first.iv).byteLength, 12);
  assert.deepEqual(await decryptEnvelope(key, first), entity);
});

test("삭제된 항목은 envelope의 deleted 플래그로 표시된다", async () => {
  const key = await deriveKey("correct horse battery staple", randomSalt());
  const removed = { ...action("지울 것"), deletedAt: AT.toISOString() };
  assert.equal((await encryptEntity(key, removed, 1)).deleted, true);
  assert.equal((await encryptEntity(key, action("남길 것"), 1)).deleted, false);
});

test("잘못된 키는 sentinel과 entity를 열지 못한다", async () => {
  const salt = randomSalt();
  const key = await deriveKey("correct horse battery staple", salt);
  const wrong = await deriveKey("wrong horse battery staple", salt);
  const sentinel = await createSentinel(key);
  assert.equal(await verifySentinel(key, sentinel), true);
  assert.equal(await verifySentinel(wrong, sentinel), false);
  const envelope = await encryptEntity(key, action("비밀"), 0);
  await assert.rejects(() => decryptEnvelope(wrong, envelope));
});

test("client와 LifeDO의 envelope wire 형식을 손실 없이 변환한다", async () => {
  const key = await deriveKey("correct horse battery staple", randomSalt());
  const local = await encryptEntity(key, action("20분 달리기"), 4);
  const wire = toServerFrame(local);
  assert.equal(wire.baseRev, 4);
  assert.equal(wire.envelope.rev, 5);
  assert.deepEqual(fromServerEnvelope(wire.envelope), local);
});

test("충돌 복사본은 새 ID를 받고 원본을 덮지 않는다", () => {
  const entity = action("20분 달리기");
  const copy = conflictCopy(entity, new Date("2026-08-18T00:00:00Z"));
  assert.notEqual(copy.id, entity.id);
  assert.match(copy.title, /충돌 복사본/);
  assert.deepEqual(validateEntity(copy), []);
});

test("import는 ID가 겹칠 때만 복사본을 만들고 나머지는 그대로 둔다", () => {
  const existing = [action("이미 있는 것")];
  const imported = [existing[0], action("새로 들어온 것")];
  const planned = planImport(existing, imported, () => "20000000-0000-4000-8000-000000000001", new Date("2026-08-18T00:00:00Z"));
  assert.equal(planned.copies, 1);
  assert.equal(planned.entities[0].id, "20000000-0000-4000-8000-000000000001");
  assert.match(planned.entities[0].title, /가져온 복사본/);
  assert.equal(planned.entities[1].id, imported[1].id, "겹치지 않는 항목은 ID를 유지한다");
  assert.deepEqual(validateCollection(planned.entities), []);
});

test("잘못된 import는 ID를 하나도 만들기 전에 거부된다", () => {
  let uuidCalls = 0;
  assert.throws(
    () => planImport([], [{ ...action("깨진 것"), date: "어제" }], () => { uuidCalls += 1; return crypto.randomUUID(); }),
    /날짜/,
  );
  assert.equal(uuidCalls, 0);
});

test("가져오기는 서버 프레임 한도보다 큰 뮤테이션을 만들지 않는다", () => {
  // queueEntities 가 MAX_FRAMES 로 잘라 담는다. 서버의 LIFE_MAX_FRAMES 와 같아야
  // 한 뮤테이션이 통째로 400 을 맞고 outbox 가 막히는 일이 없다.
  assert.equal(MAX_FRAMES, 50);
});

test("로컬 개발과 프로덕션의 게이트 경로가 다르다", () => {
  assert.equal(lifeBase("/life/"), "/life");
  assert.equal(lifeBase("/life"), "/life");
  assert.equal(lifeBase("/"), "");
  assert.equal(lifeBase("/lifelong"), "", "접두사만 같은 경로는 life 가 아니다");
});
