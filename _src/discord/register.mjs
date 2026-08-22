#!/usr/bin/env node
// 슬래시 명령을 디스코드에 등록한다. 명령어를 바꿨을 때 다시 돌린다
// (`_infra/discord.js` 의 COMMANDS 가 원본).
//
// **봇 토큰이 여기 필요 없다.** 등록은 엣지가 대신 한다 — 토큰은 다이제스트
// 발송 때문에 어차피 Cloudflare 에 있고, 그걸 로컬로 꺼내면 셸 히스토리에
// 남는다. 이 스크립트는 sink secret 으로 "등록해줘" 하고 부르기만 한다.
//
//   PAPERS_SINK_SECRET=... node _src/discord/register.mjs

const BASE = (process.env.PAPERS_ENDPOINT ?? "").trim() || "https://life.bubblelab.dev";
const secret = (process.env.PAPERS_SINK_SECRET ?? "").trim();

if (!secret) {
  console.error("환경변수 PAPERS_SINK_SECRET 가 필요합니다 (~/.bubblelab/papers.env).");
  process.exit(2);
}

const response = await fetch(`${BASE}/_discord/commands`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
const body = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(`등록 실패 (HTTP ${response.status}):`, body.error ?? "");
  if (response.status === 503) console.error("→ Cloudflare 에 DISCORD_BOT_TOKEN 이 있는지 확인하세요.");
  process.exit(1);
}

console.log(`등록 완료: ${body.commands.map((name) => `/${name}`).join(", ")}`);
console.log("전역 명령은 반영에 최대 1시간 걸릴 수 있습니다.");
