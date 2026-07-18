import test from "node:test";
import assert from "node:assert/strict";
import { PodcastDO, hashInviteCode, newInviteCode, validInviteCode, kstToday } from "./podcast.js";
import { bytesToBase64 } from "./podcast-ai.js";

class MemoryStorage {
  constructor() { this.data = new Map(); this.alarmAt = null; }
  async get(key) { return this.data.get(key); }
  async put(key, value) { this.data.set(key, value); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix = "" } = {}) {
    const entries = [...this.data.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return new Map(entries);
  }
  async setAlarm(at) { this.alarmAt = at; }
}

class FakeBucket {
  constructor() { this.objects = new Map(); }
  async put(key, value) { this.objects.set(key, value instanceof Uint8Array ? value : new Uint8Array(value)); }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.length, arrayBuffer: async () => bytes.buffer } : null;
  }
  async delete(key) { this.objects.delete(key); }
  async list({ prefix = "" } = {}) {
    return { objects: [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const internal = (path, init) => new Request(`https://podcast.internal${path}`, init);
const post = (path, body) => internal(path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

function makeDO(env = {}) {
  const storage = new MemoryStorage();
  const bucket = new FakeBucket();
  const podcastDO = new PodcastDO({ storage }, { PODCAST_BUCKET: bucket, GEMINI_API_KEY: "k", ...env });
  return { podcastDO, storage, bucket };
}

async function createUser(podcastDO, name = "테스터") {
  const response = await podcastDO.fetch(post("/admin/users", { name }));
  return response.json();
}

test("초대 코드 형식과 해시", async () => {
  const code = newInviteCode();
  assert.equal(validInviteCode(code), true);
  assert.equal(validInviteCode("ABCD-EFGH-IO01"), false); // 헷갈리는 글자 불허
  assert.equal(await hashInviteCode(code), await hashInviteCode(code));
});

test("사용자 생성 → 코드 로그인 → 홈 조회", async () => {
  const { podcastDO } = makeDO();
  const { user, code } = await createUser(podcastDO);
  assert.equal(validInviteCode(code), true);

  const login = await podcastDO.fetch(post("/login", { codeHash: await hashInviteCode(code) }));
  assert.equal(login.status, 200);
  assert.equal((await login.json()).userId, user.id);

  const badLogin = await podcastDO.fetch(post("/login", { codeHash: "wrong" }));
  assert.equal(badLogin.status, 401);

  const home = await (await podcastDO.fetch(internal(`/home?uid=${user.id}`))).json();
  assert.equal(home.user.name, "테스터");
  assert.deepEqual(home.sources, []);
  assert.equal(home.todayPodcast, null);
});

test("소스 등록·삭제와 생성 큐잉 규칙", async () => {
  const { podcastDO, storage, bucket } = makeDO();
  const { user } = await createUser(podcastDO);

  // 소스 없이 생성 → 거절
  const early = await podcastDO.fetch(internal(`/generate?uid=${user.id}`, { method: "POST" }));
  assert.equal(early.status, 409);

  const added = await podcastDO.fetch(post(`/sources?uid=${user.id}`, {
    name: "doc.pdf", mime: "application/pdf", size: 3,
  }));
  assert.equal(added.status, 200);
  const { source } = await added.json();
  await bucket.put(source.r2Key, new Uint8Array([1, 2, 3]));

  const queued = await podcastDO.fetch(internal(`/generate?uid=${user.id}`, { method: "POST" }));
  assert.equal(queued.status, 200);
  assert.ok(storage.alarmAt !== null);

  // 같은 날 두 번째 생성 → 거절 (pending 상태)
  const again = await podcastDO.fetch(internal(`/generate?uid=${user.id}`, { method: "POST" }));
  assert.equal(again.status, 409);

  const home = await (await podcastDO.fetch(internal(`/home?uid=${user.id}`))).json();
  assert.equal(home.todayPodcast.status, "pending");
  assert.equal(home.queued, true);
});

const geminiResponses = (pcm) => async (url) => {
  if (String(url).includes("preview-tts")) {
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: bytesToBase64(pcm) } }] } }],
    });
  }
  return Response.json({
    candidates: [{ content: { parts: [{ text: '{"title":"아침 방송","turns":[{"speaker":"A","text":"안녕하세요"},{"speaker":"B","text":"반갑습니다"}]}' }] } }],
  });
};

test("alarm이 대본→TTS→저장→소스 정리까지 처리한다", async () => {
  const { podcastDO, storage, bucket } = makeDO();
  const { user } = await createUser(podcastDO);
  const { source } = await (await podcastDO.fetch(post(`/sources?uid=${user.id}`, {
    name: "doc.pdf", mime: "application/pdf", size: 3,
  }))).json();
  await bucket.put(source.r2Key, new Uint8Array([1, 2, 3]));
  await podcastDO.fetch(internal(`/generate?uid=${user.id}`, { method: "POST" }));

  const pcm = new Uint8Array(24000 * 2 * 2); // 2초
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => geminiResponses(pcm)(url);
  try { await podcastDO.alarm(); }
  finally { globalThis.fetch = original; }

  const home = await (await podcastDO.fetch(internal(`/home?uid=${user.id}`))).json();
  const pod = home.todayPodcast;
  assert.equal(pod.status, "completed");
  assert.equal(pod.title, "아침 방송");
  assert.equal(pod.durationSeconds, 2);
  assert.deepEqual(pod.sourceNames, ["doc.pdf"]);
  assert.deepEqual(home.sources, []); // 소비된 소스는 정리
  assert.equal(bucket.objects.has(source.r2Key), false);
  assert.equal((await storage.get("jobs")).length, 0);

  // 오디오 메타 조회 → R2에 실제 오디오 존재
  const podId = pod.id;
  const meta = await (await podcastDO.fetch(internal(`/audio-meta?pod=${podId}`))).json();
  assert.equal(meta.userId, user.id);
  const audio = await bucket.get(meta.audioKey);
  assert.ok(audio && audio.size > 44);
});

test("생성 실패 시 소스는 남고 실패 상태·사유가 기록된다", async () => {
  const { podcastDO, bucket } = makeDO();
  const { user } = await createUser(podcastDO);
  const { source } = await (await podcastDO.fetch(post(`/sources?uid=${user.id}`, {
    name: "doc.pdf", mime: "application/pdf", size: 3,
  }))).json();
  await bucket.put(source.r2Key, new Uint8Array([1, 2, 3]));
  await podcastDO.fetch(internal(`/generate?uid=${user.id}`, { method: "POST" }));

  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("quota exceeded", { status: 429 });
  try { await podcastDO.alarm(); }
  finally { globalThis.fetch = original; }

  const home = await (await podcastDO.fetch(internal(`/home?uid=${user.id}`))).json();
  assert.equal(home.todayPodcast.status, "failed");
  assert.ok(home.todayPodcast.error.length > 0);
  assert.equal(home.sources.length, 1); // 재시도 가능

  // 실패 상태에서는 재생성 허용
  const retry = await podcastDO.fetch(internal(`/generate?uid=${user.id}`, { method: "POST" }));
  assert.equal(retry.status, 200);
});

test("run-daily는 소스 있는 사용자만 큐잉한다", async () => {
  const { podcastDO, storage, bucket } = makeDO();
  const { user: withSource } = await createUser(podcastDO, "가");
  await createUser(podcastDO, "나"); // 소스 없음
  const { source } = await (await podcastDO.fetch(post(`/sources?uid=${withSource.id}`, {
    name: "doc.pdf", mime: "application/pdf", size: 3,
  }))).json();
  await bucket.put(source.r2Key, new Uint8Array([1]));

  const result = await (await podcastDO.fetch(internal("/run-daily", { method: "POST" }))).json();
  assert.equal(result.queued, 1);
  assert.equal((await storage.get("jobs")).length, 1);
  assert.equal((await storage.get("jobs"))[0].userId, withSource.id);
});

test("사용자 삭제는 데이터·파일·코드를 함께 정리한다", async () => {
  const { podcastDO, storage, bucket } = makeDO();
  const { user, code } = await createUser(podcastDO);
  const { source } = await (await podcastDO.fetch(post(`/sources?uid=${user.id}`, {
    name: "doc.pdf", mime: "application/pdf", size: 1,
  }))).json();
  await bucket.put(source.r2Key, new Uint8Array([1]));

  const deleted = await podcastDO.fetch(internal(`/admin/users?id=${user.id}`, { method: "DELETE" }));
  assert.equal(deleted.status, 200);
  assert.equal(await storage.get(`user:${user.id}`), undefined);
  assert.equal(bucket.objects.size, 0);
  const login = await podcastDO.fetch(post("/login", { codeHash: await hashInviteCode(code) }));
  assert.equal(login.status, 401);
});

test("kstToday는 KST 날짜 문자열을 준다", () => {
  assert.match(kstToday(), /^\d{4}-\d{2}-\d{2}$/);
});
