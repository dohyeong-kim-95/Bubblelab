#!/usr/bin/env node
// 슬래시 명령을 디스코드에 등록한다. 배포와 무관하게 한 번만 돌리면 되고,
// 명령어를 바꿨을 때 다시 돌린다 (`_infra/discord.js` 의 COMMANDS 가 원본).
//
//   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node _src/discord/register.mjs
//
// 봇 토큰은 여기서만 쓴다 — 엣지에는 넣지 않아도 된다(등록은 배포와 무관하고,
// 답변은 interaction 토큰만으로 돌려보낼 수 있다).

import { COMMANDS, registerCommands } from "../../_infra/discord.js";

for (const name of ["DISCORD_APPLICATION_ID", "DISCORD_BOT_TOKEN"]) {
  if (!process.env[name]?.trim()) {
    console.error(`환경변수 ${name} 가 필요합니다.`);
    process.exit(2);
  }
}

const registered = await registerCommands(process.env);
console.log(`등록 완료 (${registered.length}개):`);
for (const command of registered) {
  const options = (COMMANDS.find((c) => c.name === command.name)?.options ?? [])
    .map((o) => `<${o.name}>`).join(" ");
  console.log(`  /${command.name} ${options}  — ${command.description}`);
}
console.log("\n전역 명령은 반영에 최대 1시간 걸릴 수 있습니다.");
