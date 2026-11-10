// 집 PC 의 claude 호출이 도구 없이·저장소 밖에서 도는지 — 가짜 실행 파일로 실제 인자와
// 작업 폴더를 받아 본다. 2026-11-10 감사에서 `--allowed-tools ""` 가 아무것도 막지 않아
// 저장소의 허용 규칙으로 셸이 돌던 것을 고친 자리다(`_src/claude-ask.mjs`).
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { askClaude } from "../_src/claude-ask.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function stub() {
  const dir = mkdtempSync(join(tmpdir(), "claude-ask-"));
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!${process.execPath}\nconsole.log(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\n`);
  chmodSync(bin, 0o755);
  return { dir, env: { ...process.env, CLAUDE_BIN: bin, CLAUDE_EMPTY_DIR: join(dir, "empty") } };
}

test("도구를 전부 끄고 부른다", async () => {
  const { dir, env } = stub();
  try {
    const { argv } = JSON.parse(await askClaude("질문", { env }));
    assert.deepEqual(argv.slice(0, 2), ["-p", "질문"]);
    assert.equal(argv[argv.indexOf("--tools") + 1], "", "--tools 뒤가 빈 문자열이어야 내장 도구가 사라진다");
    assert.ok(argv.includes("--strict-mcp-config"), "MCP 도구도 빼야 한다");
    // 허용 목록에 더하는 옵션은 도구를 막지 못한다 — 다시 들어오면 막은 줄 착각하게 된다.
    for (const flag of ["--allowed-tools", "--allowedTools", "--dangerously-skip-permissions", "--permission-mode"]) {
      assert.ok(!argv.includes(flag), `${flag} 를 쓰지 않는다`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("저장소 밖의 빈 폴더에서 실행한다", async () => {
  const { dir, env } = stub();
  try {
    const { cwd } = JSON.parse(await askClaude("질문", { env }));
    assert.equal(realpathSync(cwd), realpathSync(env.CLAUDE_EMPTY_DIR));
    assert.ok(!(realpathSync(cwd) + sep).startsWith(REPO + sep), "저장소 안이면 프로젝트 허용 규칙이 따라붙는다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("실패는 exit code 와 함께 던진다", async () => {
  const { dir, env } = stub();
  try {
    writeFileSync(env.CLAUDE_BIN, `#!${process.execPath}\nconsole.error("boom"); process.exit(3);\n`);
    await assert.rejects(askClaude("질문", { env }), /exit 3.*boom/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
