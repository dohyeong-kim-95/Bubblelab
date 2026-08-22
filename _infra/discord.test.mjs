import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  COMMANDS,
  INTERACTION,
  RESPONSE,
  followUp,
  handleCommandRegistration,
  handleInteraction,
  PLACEHOLDER,
  queueAsk,
  registerCommands,
  verifySignature,
} from "./discord.js";
import { secretMatches } from "./papers.js";

// 워커의 crypto 전역을 흉내 낸다.
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** 디스코드처럼 timestamp+body 를 Ed25519 로 서명한다. */
async function signer() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = toHex(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey,
    async sign(timestamp, body) {
      const data = new TextEncoder().encode(timestamp + body);
      return toHex(await crypto.subtle.sign("Ed25519", pair.privateKey, data));
    },
  };
}

// ── 명령어 정의 ─────────────────────────────────────────────────────────

test("명령어 이름이 디스코드 규칙을 지킨다", () => {
  // ^[-_'\p{L}\p{N}...]{1,32}$ — 한글은 \p{L} 이라 통과하고, 대문자가 없어 안전하다.
  const rule = /^[-_'\p{L}\p{N}]{1,32}$/u;
  for (const command of COMMANDS) {
    assert.match(command.name, rule, `명령어 이름이 규칙을 어긴다: ${command.name}`);
    assert.ok(command.description.length <= 100, "설명이 100자를 넘는다");
    for (const option of command.options ?? []) {
      assert.match(option.name, rule);
      assert.ok(option.description.length <= 100);
    }
    // 필수 옵션이 선택 옵션보다 뒤에 오면 등록이 거부된다.
    const required = (command.options ?? []).map((o) => Boolean(o.required));
    assert.deepEqual(required, [...required].sort((a, b) => Number(b) - Number(a)));
  }
});

// ── 서명 검증 ───────────────────────────────────────────────────────────

test("올바른 서명만 통과시킨다", async () => {
  const { publicKey, sign } = await signer();
  const body = JSON.stringify({ type: 1 });
  const timestamp = "1700000000";
  assert.equal(await verifySignature(body, await sign(timestamp, body), timestamp, publicKey), true);
  // 본문이 바뀌면 실패해야 한다 — 안 그러면 아무나 명령을 흉내 낼 수 있다.
  assert.equal(await verifySignature('{"type":2}', await sign(timestamp, body), timestamp, publicKey), false);
  // 타임스탬프도 서명에 들어간다(재전송 방지).
  assert.equal(await verifySignature(body, await sign(timestamp, body), "1700000001", publicKey), false);
});

test("망가진 서명·키에 던지지 않고 false 를 준다", async () => {
  const { publicKey } = await signer();
  for (const bad of ["", "zz", "abc", null, undefined]) {
    assert.equal(await verifySignature("{}", bad, "1", publicKey), false);
    assert.equal(await verifySignature("{}", "00".repeat(64), "1", bad), false);
  }
});

// ── 엔드포인트 ──────────────────────────────────────────────────────────

const env = (over = {}) => ({
  DISCORD_PUBLIC_KEY: over.publicKey ?? "00".repeat(32),
  DISCORD_APPLICATION_ID: "123",
  ANTHROPIC_API_KEY: "k",
  ...over,
});

const post = (body, headers = {}) =>
  new Request("https://papers.bubblelab.dev/_discord/interactions", { method: "POST", body, headers });

const ctxStub = () => { const held = []; return { held, waitUntil: (p) => held.push(p) }; };

test("서명이 틀리면 401 로 거절한다", async () => {
  // 200 으로 답하면 디스코드가 엔드포인트 등록 자체를 거부한다.
  const response = await handleInteraction(
    post(JSON.stringify({ type: 1 }), { "X-Signature-Ed25519": "00".repeat(64), "X-Signature-Timestamp": "1" }),
    env(), ctxStub(),
  );
  assert.equal(response.status, 401);
});

test("PING 에 PONG 으로 답한다", async () => {
  const { publicKey, sign } = await signer();
  const body = JSON.stringify({ type: INTERACTION.PING });
  const response = await handleInteraction(
    post(body, { "X-Signature-Ed25519": await sign("1", body), "X-Signature-Timestamp": "1" }),
    env({ publicKey }), ctxStub(),
  );
  assert.deepEqual(await response.json(), { type: RESPONSE.PONG });
});

test("명령을 큐에 넣고 읽을 수 있는 문구로 즉시 답한다", async () => {
  // 3초 안에 답해야 한다. 엣지는 적어 두기만 하므로 여유가 크다.
  const { publicKey, sign } = await signer();
  const stored = [];
  const body = JSON.stringify({
    type: INTERACTION.APPLICATION_COMMAND, id: "int-1", token: "tok",
    data: { name: "논문", options: [{ name: "질문", value: "이거 800회에 되나?" }] },
  });
  const papers = {
    idFromName: () => "id",
    get: () => ({ fetch: async (req) => { stored.push(await req.json()); return Response.json({ ok: true }); } }),
  };
  const response = await handleInteraction(
    post(body, { "X-Signature-Ed25519": await sign("1", body), "X-Signature-Timestamp": "1" }),
    env({ publicKey, PAPERS: papers }), ctxStub(),
  );
  const json = await response.json();

  // type 5(생각 중) 가 아니라 type 4 — PC 가 꺼져 있어도 무한 스피너가 아니라
  // 읽을 수 있는 글이 남는다.
  assert.equal(json.type, RESPONSE.MESSAGE);
  assert.match(json.data.content, /집 PC에 물어보는 중/);
  assert.match(json.data.content, /800회에 되나/);
  assert.deepEqual(stored, [{ id: "int-1", token: "tok", question: "이거 800회에 되나?" }]);
});

test("빈 질문은 큐에 넣지 않는다", async () => {
  let stored = 0;
  const papers = { idFromName: () => "id", get: () => ({ fetch: async () => { stored++; return Response.json({}); } }) };
  const result = await queueAsk({ id: "i", token: "t", data: { options: [{ name: "질문", value: "  " }] } },
    { PAPERS: papers });
  assert.equal(result.ok, false);
  assert.equal(stored, 0);
});

test("자리를 지키는 문구가 비어 있지 않다", () => {
  // 비면 디스코드가 빈 메시지를 거절한다.
  assert.ok(PLACEHOLDER.trim().length > 0);
});

test("설정이 없으면 503 으로 알린다", async () => {
  const response = await handleInteraction(post("{}"), { DISCORD_PUBLIC_KEY: "" }, ctxStub());
  assert.equal(response.status, 503);
});

// ── 명령어 등록 ────────────────────────────────────────────────────────

test("명령어를 등록한다", async () => {
  let seen = null;
  const impl = async (url, init) => { seen = { url: String(url), init }; return Response.json([{ id: "1" }]); };
  await registerCommands({ DISCORD_APPLICATION_ID: "123", DISCORD_BOT_TOKEN: "tok" }, { fetchImpl: impl });
  assert.match(seen.url, /applications\/123\/commands$/);
  assert.equal(seen.init.method, "PUT");
  assert.equal(seen.init.headers.Authorization, "Bot tok");
  assert.equal(JSON.parse(seen.init.body)[0].name, "논문");
});

// ── 명령어 등록 엔드포인트 ──────────────────────────────────────────────
//
// 봇 토큰을 로컬로 꺼내지 않으려고 등록을 엣지에서 돌린다. 그만큼 이 경로의
// 인증이 느슨하면 남이 내 봇의 명령어를 갈아치울 수 있다.

const reg = (env_, headers = {}, method = "POST") => handleCommandRegistration(
  new Request("https://papers.bubblelab.dev/_discord/commands", { method, headers }), env_);

test("등록 경로는 sink secret 없이 못 연다", async () => {
  const base = { PAPERS_SINK_SECRET: "s", DISCORD_BOT_TOKEN: "t", DISCORD_APPLICATION_ID: "1" };
  assert.equal((await reg({ ...base, PAPERS_SINK_SECRET: "" })).status, 503);
  assert.equal((await reg(base)).status, 401, "인증 없이 통과했다");
  assert.equal((await reg(base, { Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await reg(base, { Authorization: "Bearer s" }, "GET")).status, 404);
});

test("봇 토큰이 없으면 그렇게 알린다", async () => {
  const response = await reg({ PAPERS_SINK_SECRET: "s", DISCORD_APPLICATION_ID: "1" },
    { Authorization: "Bearer s" });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /DISCORD_BOT_TOKEN/);
});

test("길이가 달라도 상수 시간 비교가 통과시키지 않는다", () => {
  assert.equal(secretMatches("s", "s"), true);
  assert.equal(secretMatches("s", "ss"), false);
  assert.equal(secretMatches("", ""), false, "빈 secret 은 항상 거부해야 한다");
  assert.equal(secretMatches(undefined, "s"), false);
});
