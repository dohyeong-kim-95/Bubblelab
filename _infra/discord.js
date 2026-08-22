// discord — 슬래시 명령을 받는 자리.
//
// 게이트웨이(상시 웹소켓)가 아니라 **HTTP Interactions** 를 쓴다. 디스코드가 우리
// 엔드포인트로 POST 하고 우리는 JSON 으로 답하는 구조라, 워커처럼 요청 단위로만
// 사는 런타임에서도 봇이 성립한다. 상시 켜 둘 프로세스가 없다는 뜻이다.
//
// 지켜야 하는 규칙 세 가지 — 하나라도 어기면 디스코드가 엔드포인트를 꺼 버린다:
//  ① 모든 요청의 Ed25519 서명을 검증하고, 틀리면 401 로 돌려보낸다.
//  ② PING(type 1) 에는 PONG(type 1) 으로 답한다. 등록 때 이걸로 확인한다.
//  ③ **3초 안에** 답해야 한다. LLM 은 그보다 오래 걸리므로 먼저 "생각 중"(type 5)
//     으로 답해 두고, 실제 답은 15분 안에 followup 으로 채운다.



export const INTERACTION = { PING: 1, APPLICATION_COMMAND: 2 };
export const RESPONSE = { PONG: 1, MESSAGE: 4, DEFERRED: 5 };

// 답이 오기 전까지 자리를 지키는 문구. "생각 중…"(type 5) 대신 실제 메시지로
// 답하는 이유는, PC 가 꺼져 있어 답이 영영 안 올 때 무한 스피너가 아니라
// 읽을 수 있는 글이 남게 하기 위해서다.
export const PLACEHOLDER = "🤔 집 PC에 물어보는 중… (보통 1분 이내)";

export const DISCORD_API = "https://discord.com/api/v10";

/** 한글 이름이 허용된다 — 명령어 규칙의 `\p{L}` 에 한글이 들어간다(대소문자 없음). */
export const COMMANDS = [{
  name: "논문",
  description: "오늘 고른 논문에 대해 물어봅니다",
  options: [{
    type: 3,          // STRING
    name: "질문",
    description: "예: 이 방법 800회 예산에 현실적이야?",
    required: true,
  }],
}];

const hex = (value) => {
  const clean = String(value ?? "");
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
  return Uint8Array.from(clean.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));
};

/**
 * 디스코드가 보낸 요청인지 확인한다.
 *
 * 표준 `Ed25519` 를 쓴다 — 워커에 예전부터 있던 비표준 `NODE-ED25519`(namedCurve
 * 필요)도 살아 있지만 레거시 호환용이다.
 */
export async function verifySignature(body, signature, timestamp, publicKey) {
  const sig = hex(signature);
  const key = hex(publicKey);
  if (!sig || !key || !timestamp) return false;
  try {
    const imported = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", imported, sig, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

/** 답을 나중에 채운다. 토큰만 있으면 되고 봇 토큰은 필요 없다. */
export async function followUp(applicationId, token, payload, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(
    `${DISCORD_API}/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) console.error("디스코드 followup 실패", response.status, await response.text());
  return response.ok;
}

const optionOf = (interaction, name) =>
  (interaction?.data?.options ?? []).find((option) => option?.name === name)?.value ?? "";

/**
 * 질문을 큐에 넣는다. **엣지는 답하지 않는다** — 답은 집 PC 의 Claude Code 가
 * 만든다(구독 사용, API 키 불필요). 여기서는 적어 두기만 하므로 3초 제한을
 * 넉넉히 지킨다.
 */
export async function queueAsk(interaction, env) {
  const question = String(optionOf(interaction, "질문")).trim().slice(0, 500);
  if (!question) return { ok: false, message: "질문을 적어주세요." };

  const id = env.PAPERS.idFromName("main");
  const response = await env.PAPERS.get(id).fetch(new Request("https://papers/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: interaction.id, token: interaction.token, question }),
  }));
  if (!response.ok) return { ok: false, message: "질문을 받지 못했습니다." };
  return { ok: true, message: `${PLACEHOLDER}\n> ${question.slice(0, 200)}` };
}

/**
 * 엔드포인트. 서명 확인 → PING 응답 → 명령은 먼저 미뤄 두고 뒤에서 처리한다.
 *
 * `ctx.waitUntil` 이 핵심이다. 응답을 돌려준 뒤에도 LLM 호출이 살아 있어야 하는데,
 * 워커는 응답과 함께 죽기 때문에 이걸로 붙잡아 둔다.
 */
export async function handleInteraction(request, env, ctx) {
  if (request.method !== "POST") return new Response("not found", { status: 404 });
  if (!env.DISCORD_PUBLIC_KEY || !env.DISCORD_APPLICATION_ID) {
    return new Response("discord is not configured", { status: 503 });
  }

  const body = await request.text();
  const ok = await verifySignature(
    body,
    request.headers.get("X-Signature-Ed25519"),
    request.headers.get("X-Signature-Timestamp"),
    env.DISCORD_PUBLIC_KEY,
  );
  // 401 이 아니라 200 으로 답하면 디스코드가 엔드포인트 등록을 거부한다.
  if (!ok) return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(body || "{}");
  if (interaction.type === INTERACTION.PING) return Response.json({ type: RESPONSE.PONG });

  if (interaction.type === INTERACTION.APPLICATION_COMMAND) {
    if (interaction?.data?.name !== "논문" || !env.PAPERS) {
      return Response.json({ type: RESPONSE.MESSAGE, data: { content: "모르는 명령입니다." } });
    }
    const queued = await queueAsk(interaction, env);
    return Response.json({ type: RESPONSE.MESSAGE, data: { content: queued.message } });
  }

  return Response.json({ type: RESPONSE.PONG });
}

/** 명령어를 디스코드에 등록한다. 배포 후 한 번만 부르면 된다. */
export async function registerCommands(env, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(
    `${DISCORD_API}/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(COMMANDS),
    },
  );
  if (!response.ok) throw new Error(`명령어 등록 실패 (HTTP ${response.status}): ${await response.text()}`);
  return response.json();
}
