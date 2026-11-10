#!/usr/bin/env node
// opic-sink — 매일 아침 「오늘의 오픽」 AL 모범답안을 만든다. cron 이 몇 분마다 부른다.
//
// 논문 다이제스트(_src/papers-sink)와 같은 구조다: 엣지가 "오늘 것을 만들 때인가"를 판단하고
// 문항을 정해 주면, 여기서 집 PC 의 Claude Code(`claude -p`, 구독 차감 — API 키·청구서 없음)가
// 답안을 쓰고, 엣지가 보관·디스코드 발송을 한다. PC 가 꺼져 있으면 켜질 때 만든다.
// 도구 없이 부른다(`_src/claude-ask.mjs`) — 프롬프트는 우리 문항 은행뿐이지만 습관으로 막아 둔다.
//
//   PAPERS_SINK_SECRET=... node _src/opic-sink/index.mjs
//   node _src/opic-sink/index.mjs --dry   # 엣지 없이 오늘 문항으로 답안만 만들어 출력

import { buildDailyPrompt, parseDaily } from "../../_infra/opic.js";
import { kstDate } from "../../_infra/papers.js";
import { dailyQuestion, DAILY_LEVEL } from "../../opic/questions.js";
import { askClaude } from "../claude-ask.mjs";

const BASE = (process.env.OPIC_ENDPOINT ?? "").trim() || "https://opic.bubblelab.dev";
const TIMEOUT_MS = 240_000;

const ask = (prompt) => askClaude(prompt, { timeoutMs: TIMEOUT_MS });

/** 형식이 어긋나면 한 번만 다시 쓴다. */
async function write(question, level) {
  const prompt = buildDailyPrompt(question, level);
  try { return parseDaily(await ask(prompt)); } catch (error) {
    console.error(`  첫 답안 버림: ${error.message} — 다시 씀`);
    return parseDaily(await ask(prompt));
  }
}

async function api(path, secret, init = {}) {
  const res = await fetch(`${BASE}/_sink${path}`, {
    ...init, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`${path} 실패 (HTTP ${res.status}) ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function main() {
  if (process.argv.includes("--dry")) {
    const date = kstDate();
    const question = dailyQuestion(date);
    console.log(JSON.stringify({ date, question, ...(await write(question, DAILY_LEVEL)) }, null, 2));
    return;
  }
  const secret = (process.env.PAPERS_SINK_SECRET ?? "").trim();
  if (!secret) { console.error("환경변수 PAPERS_SINK_SECRET 가 필요합니다."); process.exit(2); }

  const pending = await api("/daily/pending", secret);
  if (!pending?.due) return;   // 할 일이 없으면 조용히 끝난다(로그가 조용한 게 정상)
  console.log(`${new Date().toLocaleString("ko-KR")} ${pending.date} 오늘의 오픽 — ${pending.question.kind} · ${pending.question.topic}`);
  const data = await write(pending.question, pending.level);
  const done = await api("/daily/done", secret, { method: "POST", body: JSON.stringify({ date: pending.date, ...data }) });
  console.log(`  저장 ${done.date} · 디스코드 ${done.sent ? "보냄" : "안 보냄"}`);
}

main().catch((error) => { console.error(`${new Date().toLocaleString("ko-KR")} opic-sink 실패: ${error.message}`); process.exit(1); });
