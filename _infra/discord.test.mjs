import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  COMMANDS,
  INTERACTION,
  RESPONSE,
  followUp,
  handleInteraction,
  registerCommands,
  runCommand,
  verifySignature,
} from "./discord.js";

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

test("명령은 먼저 미뤄 두고 뒤에서 처리한다", async () => {
  // 3초 안에 답하지 않으면 디스코드가 실패로 처리한다. LLM 은 그보다 오래 걸린다.
  const { publicKey, sign } = await signer();
  const body = JSON.stringify({
    type: INTERACTION.APPLICATION_COMMAND, token: "tok",
    data: { name: "논문", options: [{ name: "질문", value: "이거 800회에 되나?" }] },
  });
  const ctx = ctxStub();
  const response = await handleInteraction(
    post(body, { "X-Signature-Ed25519": await sign("1", body), "X-Signature-Timestamp": "1" }),
    env({ publicKey }), ctx,
  );
  assert.deepEqual(await response.json(), { type: RESPONSE.DEFERRED });
  assert.equal(ctx.held.length, 1, "waitUntil 로 붙잡지 않으면 응답과 함께 죽는다");
});

test("설정이 없으면 503 으로 알린다", async () => {
  const response = await handleInteraction(post("{}"), { DISCORD_PUBLIC_KEY: "" }, ctxStub());
  assert.equal(response.status, 503);
});

// ── 명령 처리 ───────────────────────────────────────────────────────────

/** DO(최신 다이제스트) + Claude + 디스코드 followup 을 한 번에 흉내 낸다. */
function stub({ digest, claude = "쓸 수 있습니다.", claudeStatus = 200 } = {}) {
  const sent = [];
  const impl = async (input, init) => {
    const href = String(input);
    if (href.includes("api.anthropic.com")) {
      if (claudeStatus !== 200) return new Response("nope", { status: claudeStatus });
      return Response.json({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: claude }] });
    }
    sent.push({ url: href, method: init.method, body: JSON.parse(init.body) });
    return new Response(null, { status: 204 });
  };
  const env_ = env({
    PAPERS: {
      idFromName: () => "id",
      get: () => ({ fetch: async () => Response.json(digest ?? { empty: true }) }),
    },
  });
  return { impl, sent, env: env_ };
}

const digest = {
  date: "2026-08-22", hits: [{
    title: "MOCA-HESP", score: 9, link: "https://arxiv.org/abs/x", summary: "초록",
    summary_ko: { "한줄": "조합 공간 BO", "예산": "500회" },
  }], near: [],
};

test("질문에 답해 followup 으로 채운다", async () => {
  const s = stub({ digest });
  await runCommand({ token: "tok", data: { name: "논문", options: [{ name: "질문", value: "되나?" }] } },
    s.env, { fetchImpl: s.impl });

  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].method, "PATCH");
  assert.match(s.sent[0].url, /webhooks\/123\/tok\/messages\/@original$/);
  assert.equal(s.sent[0].body.embeds[0].description, "쓸 수 있습니다.");
  assert.match(s.sent[0].body.embeds[0].footer.text, /2026-08-22/);
});

test("Claude 응답에서 thinking 을 빼고 text 만 읽는다", async () => {
  // Opus 5 는 thinking 이 기본으로 켜져 있어 블록이 섞여 온다.
  const s = stub({ digest, claude: "본문만" });
  await runCommand({ token: "t", data: { name: "논문", options: [{ name: "질문", value: "q" }] } },
    s.env, { fetchImpl: s.impl });
  assert.equal(s.sent[0].body.embeds[0].description, "본문만");
});

test("실패해도 '생각 중…' 을 남기지 않고 이유를 알린다", async () => {
  const s = stub({ digest, claudeStatus: 429 });
  await runCommand({ token: "t", data: { name: "논문", options: [{ name: "질문", value: "q" }] } },
    s.env, { fetchImpl: s.impl });
  assert.match(s.sent[0].body.content, /답하지 못했습니다/);
  assert.match(s.sent[0].body.content, /429/);
});

test("다이제스트가 없어도 답은 돌려준다", async () => {
  const s = stub({ digest: null });
  await runCommand({ token: "t", data: { name: "논문", options: [{ name: "질문", value: "q" }] } },
    s.env, { fetchImpl: s.impl });
  assert.match(s.sent[0].body.embeds[0].footer.text, /아직 쌓인 다이제스트가 없습니다/);
});

test("빈 질문은 LLM 을 부르지 않는다", async () => {
  let claudeCalls = 0;
  const impl = async (input, init) => {
    if (String(input).includes("anthropic")) { claudeCalls++; return Response.json({ content: [] }); }
    return new Response(null, { status: 204 });
  };
  await runCommand({ token: "t", data: { name: "논문", options: [{ name: "질문", value: "   " }] } },
    env(), { fetchImpl: impl });
  assert.equal(claudeCalls, 0);
});

test("명령어를 등록한다", async () => {
  let seen = null;
  const impl = async (url, init) => { seen = { url: String(url), init }; return Response.json([{ id: "1" }]); };
  await registerCommands({ DISCORD_APPLICATION_ID: "123", DISCORD_BOT_TOKEN: "tok" }, { fetchImpl: impl });
  assert.match(seen.url, /applications\/123\/commands$/);
  assert.equal(seen.init.method, "PUT");
  assert.equal(seen.init.headers.Authorization, "Bot tok");
  assert.equal(JSON.parse(seen.init.body)[0].name, "논문");
});
