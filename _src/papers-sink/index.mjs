#!/usr/bin/env node
// papers-sink — 하루치 다이제스트를 만들고, 디스코드 `/논문` 질문에 답한다.
// 둘 다 집 PC 의 Claude Code 가 한다. 1분마다 cron 이 부른다.
//
// 전용 채널의 자유 대화도 여기서 받는다(1~2분 지연). 집 PC 에 상주 데몬
// (`gateway.mjs`)을 띄우면 그쪽이 즉시 답하고 이쪽은 저절로 비켜선다.
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

import {
  ANSWER_LIMIT, buildAskPrompt, buildChatAnswerPrompt, buildChatPrompt, buildScorePrompt,
  buildSummaryPrompt, CHAT_ANSWER_LIMIT, fetchCandidates, parseScores, parseSummary,
  parseVerb, pickPapers, RESEARCH_PROFILE, runVerb,
} from "../../_infra/papers.js";

const BASE = (process.env.PAPERS_ENDPOINT ?? "").trim() || "https://life.bubblelab.dev";
const CLAUDE = (process.env.CLAUDE_BIN ?? "").trim() || "claude";
// 한 번에 답할 개수. 폭주해도 구독 한도를 한꺼번에 태우지 않게 막아 둔다.
const MAX_PER_RUN = 3;
const TIMEOUT_MS = 180_000;
// 한 번에 채점할 후보 수. 프롬프트 하나에 전부 넣어야 서로를 보고 상대 순위를
// 매길 수 있는데, 너무 길면 뒤쪽을 대충 읽는다. 실측 후보가 하루 ~30편이라
// 평소엔 걸리지 않고, 연휴 뒤처럼 몰릴 때만 최신순으로 자른다.
const MAX_SCORED = 40;

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

/**
 * 하루치를 만든다. 엣지가 "만들 때"라고 할 때만 들어온다.
 *
 * 채점은 **한 번의 호출로 전부** 한다 — 편마다 부르면 서로를 못 보고 매기게 되어
 * 같은 날 상대 순위가 흔들린다. 요약은 반대로 실제로 보낼 것에만 붙인다(후보
 * 전부에 붙이면 호출이 예닐곱 배가 된다).
 */
async function buildDigest(secret) {
  const pending = await api("/digest/pending", secret);
  if (!pending?.due) return;

  console.log(`${new Date().toLocaleString("ko-KR")} ${pending.date} 다이제스트 생성`);
  const profile = pending.profile || RESEARCH_PROFILE;
  const seen = new Set(pending.seen ?? []);

  const candidates = await fetchCandidates();
  const fresh = candidates.filter((paper) => !seen.has(paper.id)).slice(0, MAX_SCORED);
  console.log(`  후보 ${candidates.length}편 중 새것 ${fresh.length}편`);

  let hits = [], near = [];
  if (fresh.length) {
    const scored = parseScores(await ask(buildScorePrompt(fresh, profile)), fresh);
    ({ hits, near } = pickPapers(scored));

    for (const paper of [...hits, ...near]) {
      try {
        paper.summary_ko = parseSummary(await ask(buildSummaryPrompt(paper, profile)));
      } catch (error) {
        // 요약 하나가 실패해도 나머지는 보낸다 — 화면에서는 초록으로 대체된다.
        console.error(`  요약 실패(${paper.id}): ${error.message}`);
      }
    }
  }

  // 고른 게 없어도 본 것은 올린다 — 안 그러면 내일 같은 논문을 다시 채점한다.
  const result = await api("/digest/done", secret, {
    method: "POST",
    body: JSON.stringify({
      date: pending.date, scanned: candidates.length,
      ids: fresh.map((paper) => paper.id), hits, near,
    }),
  });
  console.log(`  ${JSON.stringify(result)}`);
}

/**
 * 전용 채널의 자유 대화. 새 말이 있으면 답한다.
 *
 * 상주 데몬(`gateway.mjs`)이 듣고 있으면 엣지가 빈 목록을 준다 — 둘 다 답하면
 * 같은 말에 두 번 답하기 때문이다. 설정을 바꿀 필요는 없다.
 *
 * **검색은 모델이 아니라 여기서 돈다.** 도구 없이 부르는 claude 에게 논문을 물으면
 * arXiv 번호를 지어내므로, "찾아봐야겠다" 는 판단만 모델에게 맡기고 실제 조회는
 * 이 함수가 한 뒤 그 결과만 보여 주고 다시 답하게 한다.
 */
async function chat(secret) {
  const poll = await api("/chat", secret);
  const messages = poll?.messages ?? [];
  if (poll?.needsIntent) {
    // 조용히 넘기면 사용자는 "썼는데 답이 없다" 만 겪는다. 로그에 남긴다.
    console.error(`${new Date().toLocaleString("ko-KR")} ${poll.reason}`);
    return;
  }
  if (!messages.length) return;

  // 한꺼번에 여러 줄을 썼으면 한 번의 말로 묶어 답한다 — 줄마다 답하면 시끄럽다.
  const question = messages.map((m) => m.text).join("\n").slice(0, 2000);
  console.log(`${new Date().toLocaleString("ko-KR")} 대화: ${question.slice(0, 60)}`);

  const digest = await latestDigest();
  const profile = process.env.PAPERS_PROFILE || RESEARCH_PROFILE;
  const history = poll.history ?? [];

  let answer;
  try {
    const first = await ask(buildChatPrompt(history, question, digest, profile));
    const wanted = parseVerb(first);
    if (wanted) {
      console.log(`  ${wanted.verb}: ${wanted.arg}`);
      const found = await runVerb(wanted, {
        lookup: (q) => api(`/reviews/search?q=${encodeURIComponent(q)}`, secret).then((r) => r.reviews ?? []),
      });
      console.log(`  ${found.papers.length}편 찾음`);
      answer = await ask(buildChatAnswerPrompt(history, question, found.papers, found.query, profile));
    } else {
      answer = first;
    }
  } catch (error) {
    // 답을 못 만들어도 커서는 옮긴다 — 안 그러면 같은 말에 매분 다시 걸린다.
    answer = `답하지 못했습니다: ${String(error.message ?? error).slice(0, 300)}`;
    console.error("  실패:", error.message);
  }

  await api("/chat/reply", secret, {
    method: "POST",
    body: JSON.stringify({ cursor: poll.cursor, question, answer: answer.slice(0, CHAT_ANSWER_LIMIT) }),
  });
  console.log(`  답변 ${answer.length}자`);
}

async function main() {
  const secret = required("PAPERS_SINK_SECRET");
  const applicationId = required("DISCORD_APPLICATION_ID");

  // 질문을 먼저 본다. interaction 토큰이 15분이면 죽어서 다이제스트(몇 분 걸린다)
  // 뒤로 밀면 그 사이에 시한을 넘긴다.
  const { asks } = await api("/asks", secret);
  if (!asks?.length) {
    // 조용히 끝낸다 — 1분마다 도는 자리다.
    await chat(secret);
    return buildDigest(secret);
  }

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
  await chat(secret);
  await buildDigest(secret);
}

main().catch((error) => {
  console.error("실패:", error.message);
  process.exit(1);
});
