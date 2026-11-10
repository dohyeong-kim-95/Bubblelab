// claude-ask — 집 PC 의 Claude Code 를 **도구 없이** 부르는 단 하나의 자리.
//
// papers-sink·papers-gateway·opic-sink 가 모두 이것을 쓴다. 프롬프트에 남이 쓴 글
// (arXiv 초록, 디스코드 메시지)이 그대로 들어가므로, 거기 지시가 심겨 있어도 읽고
// 답하는 것 말고는 할 수 있는 게 없어야 한다. 두 가지로 막는다:
//
//  · **`--tools ""`** — 내장 도구(Bash·Read·Write·WebFetch…)를 아예 없앤다.
//    `--allowed-tools ""` 는 **막는 옵션이 아니다**. 허용 목록에 아무것도 더하지 않을
//    뿐이라 설정 파일의 허용 규칙이 그대로 붙는다 — 2026-11-10 까지 그렇게 불렀고,
//    cron 이 저장소 폴더에서 실행해 `.claude/settings.local.json` 의 `Bash(python3 *)`
//    같은 규칙으로 셸이 실제로 돌았다(실측). `--strict-mcp-config` 는 MCP 도구도 뺀다.
//  · **빈 폴더에서 실행** — 저장소의 프로젝트 설정·CLAUDE.md 가 따라붙지 않게 한다.
//    옵션 하나가 다시 뜻을 바꿔도 남는 두 번째 벽이다.
//
// 그 밖의 둘은 cron 환경 때문이다: stdin 을 닫고(열어 두면 3초를 기다린다), PATH 에
// node 디렉터리를 넣는다(cron 의 PATH 는 /usr/bin:/bin 뿐이라 플러그인 훅이 node 를
// 못 찾는다).

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** claude 에 넘기는 인자. 도구를 여는 옵션을 여기에 더하지 말 것. */
export const claudeArgs = (prompt) =>
  ["-p", prompt, "--tools", "", "--strict-mcp-config", "--output-format", "text"];

/** 실행할 빈 폴더. 없으면 만든다. */
export function claudeCwd(env = process.env) {
  const dir = (env.CLAUDE_EMPTY_DIR ?? "").trim() || join(homedir(), ".bubblelab", "claude-empty");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function askClaude(prompt, { timeoutMs = 180_000, env = process.env } = {}) {
  const bin = (env.CLAUDE_BIN ?? "").trim() || "claude";
  return new Promise((resolve, reject) => {
    const child = spawn(bin, claudeArgs(prompt), {
      cwd: claudeCwd(env),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...env, PATH: `${dirname(process.execPath)}:${env.PATH ?? ""}` },
    });

    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("시간 초과")); }, timeoutMs);
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
