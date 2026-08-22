#!/usr/bin/env node
// papers-sink — 디스코드 `/논문` 질문을 집 PC 의 Claude Code 로 답한다.
//
// 왜 PC 에서 도는가: 엣지에서 Claude 를 부르려면 API 키(=별도 과금)가 필요하다.
// `claude -p` 는 이미 쓰는 구독에서 차감되므로 키도 청구서도 늘지 않는다.
// 대신 이 PC 가 켜져 있어야 한다 — invest-sink 와 같은 거래다.
//
// **도구 없이 부른다(`--allowed-tools ""`).** 프롬프트에 arXiv 초록이 그대로
// 들어가는데, 그건 남이 쓴 검증되지 않은 텍스트다. 도구가 없으면 초록에 지시를
// 심어 둬도 읽고 답하는 것 말고 할 수 있는 게 없다.
//
//   PAPERS_SINK_SECRET=... node _src/papers-sink/index.mjs

import { spawn } from "node:child_process";
import { dirname } from "node:path";

import { ANSWER_LIMIT, buildAskPrompt, RESEARCH_PROFILE } from "../../_infra/papers.js";

const BASE = (process.env.PAPERS_ENDPOINT ?? "").trim() || "https://papers.bubblelab.dev";
const CLAUDE = (process.env.CLAUDE_BIN ?? "").trim() || "claude";
// 한 번에 답할 개수. 폭주해도 구독 한도를 한꺼번에 태우지 않게 막아 둔다.
const MAX_PER_RUN = 3;
const TIMEOUT_MS = 180_000;

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    console.error(`환경변수 ${name} 가 필요합니다.`);
    process.exit(2);
  }
  return value;
}

async function api(path, secret, init = {}) {
  const response = await fetch(`${BASE}/_papers${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new Error(`${path} 실패 (HTTP ${response.status})`);
  return response.json();
}

/** 최신 다이제스트. 공개 경로라 인증이 필요 없다. */
async function latestDigest() {
  try {
    const response = await fetch(`${BASE}/_papers/latest`);
    const body = await response.json();
    return body?.empty ? null : body;
  } catch {
    return null;
  }
}

/**
 * Claude Code 헤드리스 호출. 도구를 주지 않는다.
 *
 * 두 가지를 cron 환경에 맞춰 둔다:
 *  · **stdin 을 닫는다.** 열어 두면 claude 가 파이프 입력을 3초 기다렸다가
 *    "no stdin data received" 경고를 내고 진행한다 — 질문마다 3초씩 손해다.
 *  · **PATH 에 node 디렉터리를 넣는다.** cron 의 PATH 는 /usr/bin:/bin 뿐이라
 *    claude 의 플러그인 훅이 `node` 를 못 찾고 실패 로그를 남긴다(답변 자체는
 *    나오지만 로그가 지저분해져 진짜 오류가 묻힌다).
 */
function ask(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, ["-p", prompt, "--allowed-tools", "", "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` },
    });

    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("시간 초과")); }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude 실패 (exit ${code}): ${err.trim().slice(0, 200)}`));
    });
  });
}

/** 디스코드의 원래 메시지를 답으로 갈아끼운다. 봇 토큰이 필요 없다. */
async function reply(applicationId, token, embed) {
  const response = await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "", embeds: [embed] }),
    },
  );
  if (!response.ok) console.error(`  디스코드 응답 실패 (HTTP ${response.status})`);
  return response.ok;
}

async function main() {
  const secret = required("PAPERS_SINK_SECRET");
  const applicationId = required("DISCORD_APPLICATION_ID");

  const { asks } = await api("/asks", secret);
  if (!asks?.length) return;   // 조용히 끝낸다 — 1분마다 도는 자리다

  const digest = await latestDigest();
  const profile = process.env.PAPERS_PROFILE || RESEARCH_PROFILE;
  const done = [];

  for (const item of asks.slice(0, MAX_PER_RUN)) {
    console.log(`${new Date().toLocaleString("ko-KR")} 질문: ${item.question.slice(0, 60)}`);
    try {
      const answer = (await ask(buildAskPrompt(digest, item.question, profile))).slice(0, ANSWER_LIMIT);
      await reply(applicationId, item.token, {
        title: `📄 ${item.question.slice(0, 240)}`,
        description: answer || "답을 만들지 못했습니다.",
        footer: { text: digest?.date ? `${digest.date} 다이제스트 기준` : "아직 쌓인 다이제스트가 없습니다" },
      });
      console.log(`  답변 ${answer.length}자`);
    } catch (error) {
      // 실패해도 자리를 지키던 문구를 갈아끼운다 — 안 그러면 "물어보는 중"이 남는다.
      await reply(applicationId, item.token, {
        title: "답하지 못했습니다",
        description: String(error.message ?? error).slice(0, 500),
      });
      console.error("  실패:", error.message);
    }
    done.push(item.id);
  }

  await api("/asks/done", secret, { method: "POST", body: JSON.stringify({ ids: done }) });
}

main().catch((error) => {
  console.error("실패:", error.message);
  process.exit(1);
});
