#!/usr/bin/env node
// papers-gateway — 디스코드 전용 채널에 쓰면 **그 자리에서** 답하는 상주 데몬.
//
// cron 폴링(1분)과 달리 게이트웨이는 밀어 주는 방식이라 지연이 사람이 느끼는
// 수준으로 사라진다. 대신 프로세스가 늘 떠 있어야 한다 — systemd 유저 서비스로
// 올린다(`install.sh`). duri-sink 와 같은 모양이다.
//
// **봇 토큰이 이 PC 에 있어야 한다.** 게이트웨이는 붙는 쪽이 토큰을 들고
// IDENTIFY 를 보내야 해서, 엣지가 대신 붙어 줄 수가 없다. 다이제스트 발송은
// 여전히 엣지가 자기 토큰으로 한다.
//
// 답을 만드는 것은 `claude -p`(구독)다. 오간 말과 다이제스트는 엣지에 있고
// 여기서는 그때그때 받아 쓴다 — PC 를 갈아엎어도 대화가 남는다.
//
// **여기는 거르는 자리다.** 초록까지만 보고 읽어볼 만한지 가른다. 제대로 읽는
// 것은 사람이 `/paper` 로 직접 하고, life/papers 에는 그렇게 이해한 것만 남는다.

import { spawn } from "node:child_process";
import { dirname } from "node:path";

import {
  buildChatAnswerPrompt, buildChatPrompt, CHAT_ANSWER_LIMIT,
  parseVerb, RESEARCH_PROFILE, runVerb,
} from "../../_infra/papers.js";

const BASE = (process.env.PAPERS_ENDPOINT ?? "").trim() || "https://life.bubblelab.dev";
const CLAUDE = (process.env.CLAUDE_BIN ?? "").trim() || "claude";
const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 180_000;
const DISCORD_MESSAGE_LIMIT = 2000;

// GUILD_MESSAGES(1<<9) | MESSAGE_CONTENT(1<<15). 두 번째가 privileged 라
// 개발자 포털에서 토글을 켜 둬야 내용이 빈 채로 오지 않는다.
const INTENTS = (1 << 9) | (1 << 15);

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`환경변수 ${name} 가 필요합니다.`);
    process.exit(2);
  }
  return value;
}

const TOKEN = required("DISCORD_BOT_TOKEN");
const CHANNEL = required("DISCORD_CHAT_CHANNEL_ID");
const SECRET = required("PAPERS_SINK_SECRET");

const log = (...parts) => console.log(new Date().toLocaleString("ko-KR"), ...parts);

/**
 * "나 듣고 있다" 를 엣지에 1분마다 알린다.
 *
 * 이게 신선하면 1분 cron 폴링이 비켜선다 — **둘 다 답하면 같은 말에 두 번
 * 답한다.** 설정을 바꿔 가며 고르지 않아도 되고, 이 프로세스가 죽으면 신호가
 * 상해서 폴링이 저절로 이어받는다.
 *
 * READY 가 아니라 **시작하자마자** 알린다: 붙는 데 시간이 걸려도 그 사이에
 * 폴링이 끼어들지 않게.
 */
function announce() {
  const tell = () => edge("/chat/alive", { method: "POST", body: "{}" })
    .catch((error) => log("살아있음 알림 실패:", error.message));
  tell();
  setInterval(tell, 60_000);
}

/* ── 디스코드 REST ─────────────────────────────────────────────────────── */

async function discord(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`디스코드 ${path} 실패 (HTTP ${response.status})`);
  return response.status === 204 ? null : response.json();
}

/** 답이 길면 나눠 보낸다. 문단 경계에서 끊어야 읽을 수 있다. */
async function say(text) {
  const chunks = [];
  let rest = String(text ?? "").trim() || "답을 만들지 못했습니다.";
  while (rest.length > DISCORD_MESSAGE_LIMIT) {
    const cut = rest.lastIndexOf("\n", DISCORD_MESSAGE_LIMIT);
    const at = cut > DISCORD_MESSAGE_LIMIT / 2 ? cut : DISCORD_MESSAGE_LIMIT;
    chunks.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  chunks.push(rest);
  for (const chunk of chunks) {
    await discord(`/channels/${CHANNEL}/messages`, { method: "POST", body: JSON.stringify({ content: chunk }) });
  }
}

/**
 * "입력 중…" 을 띄워 둔다. 디스코드는 10초면 지우므로 답이 나올 때까지 다시 찍는다.
 * 이게 없으면 생각하는 30~60초 동안 죽은 것처럼 보인다 — 상주로 만든 이유의 절반이다.
 */
function typing() {
  const tick = () => discord(`/channels/${CHANNEL}/typing`, { method: "POST" }).catch(() => {});
  tick();
  const timer = setInterval(tick, 8000);
  return () => clearInterval(timer);
}

/* ── 엣지 ──────────────────────────────────────────────────────────────── */

async function edge(path, init = {}) {
  const response = await fetch(`${BASE}/_papers${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`${path} 실패 (HTTP ${response.status})`);
  return response.json();
}

async function latestDigest() {
  try {
    const body = await (await fetch(`${BASE}/_papers/latest`)).json();
    return body?.empty ? null : body;
  } catch {
    return null;
  }
}

/* ── Claude ────────────────────────────────────────────────────────────── */

/** 도구를 주지 않는다 — 프롬프트에 남이 쓴 초록이 들어가기 때문이다. */
function ask(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, ["-p", prompt, "--allowed-tools", "", "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("시간 초과")); }, TIMEOUT_MS);
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { err += c; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude 실패 (exit ${code}): ${err.trim().slice(0, 200)}`));
    });
  });
}

/**
 * 한 마디에 답한다.
 *
 * **검색은 모델이 아니라 여기서 돈다.** 도구 없이 부르는 claude 에게 논문을
 * 물으면 arXiv 번호를 지어내므로, "찾아야 하나" 판단만 맡기고 조회는 우리가 한다.
 */
async function answer(question) {
  const [state, digest] = await Promise.all([
    edge("/chat/history").catch(() => ({ history: [] })),
    latestDigest(),
  ]);
  const history = state.history ?? [];
  const focus = state.focus ?? null;
  const profile = process.env.PAPERS_PROFILE || RESEARCH_PROFILE;
  if (focus) log(`  붙든 논문: ${focus.title.slice(0, 50)}`);

  const first = await ask(buildChatPrompt(history, question, digest, profile, focus));
  const wanted = parseVerb(first);
  if (!wanted) return first;

  log(`  ${wanted.verb}: ${wanted.arg}`);
  const found = await runVerb(wanted, {
    lookup: (q) => edge(`/reviews/search?q=${encodeURIComponent(q)}`).then((r) => r.reviews ?? []),
  });

  // 붙들기·놓기는 답이 아니라 상태가 바뀌는 일이다.
  if (wanted.verb === "FOCUS" || wanted.verb === "RELEASE") {
    if (found.failed) return found.failed;
    await edge("/chat/focus", { method: "POST", body: JSON.stringify(found.focus ?? {}) });
    if (!found.focus) return "붙들고 있던 논문을 놓았습니다.";
    log(`  본문 ${found.focus.text.length}자 붙듦`);
    // 붙든 김에 첫 설명까지 해 준다 — 붙들었다는 말만 하면 한 번 더 물어야 한다.
    return ask(buildChatPrompt(history, question, null, profile, found.focus));
  }

  log(`  ${found.papers.length}편 찾음`);
  return ask(buildChatAnswerPrompt(history, question, found.papers, found.query, profile));
}

/* ── 한 번에 하나씩 ─────────────────────────────────────────────────────
 * 답하는 데 30초~몇 분이 걸린다. 그 사이 들어온 말을 동시에 처리하면 claude 가
 * 여러 개 뜨고 대화 순서도 뒤엉킨다 — 줄을 세워 하나씩 답한다.
 */
let queue = Promise.resolve();

function handle(message) {
  queue = queue.then(async () => {
    log(`대화: ${message.slice(0, 60)}`);
    const stop = typing();
    try {
      const text = (await answer(message)).slice(0, CHAT_ANSWER_LIMIT);
      await say(text);
      await edge("/chat/remember", { method: "POST", body: JSON.stringify({ question: message, answer: text }) });
      log(`  답변 ${text.length}자`);
    } catch (error) {
      log("  실패:", error.message);
      await say(`답하지 못했습니다: ${String(error.message ?? error).slice(0, 300)}`).catch(() => {});
    } finally {
      stop();
    }
  }).catch((error) => log("큐 오류:", error.message));
  return queue;
}

/* ── 게이트웨이 ─────────────────────────────────────────────────────────
 * 재접속이 이 프로토콜의 대부분이다. 끊기는 건 예외가 아니라 정상이고
 * (디스코드가 주기적으로 op 7 로 옮기라고 한다), 그때 **RESUME 으로 이어붙여야**
 * 끊긴 사이의 말을 놓치지 않는다.
 */

let socket = null;
let heartbeat = null;
let acked = true;
let seq = null;
let sessionId = null;
let resumeUrl = null;
let backoff = 1000;

const send = (payload) => socket?.readyState === 1 && socket.send(JSON.stringify(payload));

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

function connect() {
  const url = `${resumeUrl ?? "wss://gateway.discord.gg"}/?v=10&encoding=json`;
  socket = new WebSocket(url);

  socket.addEventListener("open", () => log("게이트웨이 연결"));

  socket.addEventListener("message", ({ data }) => {
    let frame;
    try { frame = JSON.parse(data); } catch { return; }
    const { op, d, s, t } = frame;
    if (s !== null && s !== undefined) seq = s;

    if (op === 10) {
      // HELLO. 첫 박동은 지터를 줘서 여러 봇이 동시에 때리지 않게 한다(스펙 권고).
      acked = true;
      stopHeartbeat();
      const beat = () => {
        if (!acked) { log("박동 응답 없음 — 다시 붙는다"); socket.close(4000); return; }
        acked = false;
        send({ op: 1, d: seq });
      };
      setTimeout(() => { beat(); heartbeat = setInterval(beat, d.heartbeat_interval); },
        d.heartbeat_interval * Math.random());

      if (sessionId && seq !== null) send({ op: 6, d: { token: TOKEN, session_id: sessionId, seq } });
      else send({ op: 2, d: { token: TOKEN, intents: INTENTS, properties: { os: "linux", browser: "papers", device: "papers" } } });
      return;
    }

    if (op === 11) { acked = true; return; }
    if (op === 1) { send({ op: 1, d: seq }); return; }
    if (op === 7) { log("디스코드가 재접속을 요청"); socket.close(4000); return; }
    if (op === 9) {
      // 세션이 죽었다. 이어붙일 수 없으니 처음부터 — 자리도 새로 잡는다.
      log("세션 무효 — 새로 시작");
      sessionId = null; seq = null; resumeUrl = null;
      setTimeout(() => socket.close(4000), 1000 + Math.random() * 4000);
      return;
    }

    if (op !== 0) return;
    if (t === "READY") {
      sessionId = d.session_id;
      resumeUrl = d.resume_gateway_url;
      backoff = 1000;
      log(`준비 완료 — ${d.user?.username} 로 듣는다`);
      return;
    }
    if (t === "RESUMED") { backoff = 1000; log("이어붙임"); return; }
    if (t !== "MESSAGE_CREATE") return;

    // 우리 채널의, 봇이 아닌, 내용이 있는 말만.
    if (d.channel_id !== CHANNEL || d.author?.bot) return;
    const text = String(d.content ?? "").trim();
    if (!text) {
      log("내용이 비어 있다 — 개발자 포털에서 Message Content 인텐트를 켜세요");
      return;
    }
    handle(text.slice(0, 2000));
  });

  socket.addEventListener("close", ({ code }) => {
    stopHeartbeat();
    // 4004(인증 실패)·4014(인텐트 거부)는 다시 붙어도 같은 결과다. 무한 재시도로
    // 로그를 채우지 말고 사람이 고치게 세운다.
    if (code === 4004 || code === 4014) {
      console.error(`게이트웨이 거부(${code}). 토큰이나 인텐트 설정을 확인하세요.`);
      process.exit(2);
    }
    log(`연결 끊김(${code}) — ${Math.round(backoff / 1000)}초 뒤 다시`);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  });

  socket.addEventListener("error", () => {});   // close 가 이어서 오므로 여기선 조용히
}

if (typeof WebSocket !== "function") {
  console.error("이 Node 에는 WebSocket 이 없습니다. Node 22+ 를 쓰거나 --experimental-websocket 을 붙여주세요.");
  process.exit(2);
}
log(`대화 채널 ${CHANNEL} 을 듣습니다`);
announce();
connect();
