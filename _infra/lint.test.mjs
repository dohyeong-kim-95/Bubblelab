// scripts/lint.sh — 이 리포의 린트는 문법 검사다. 브라우저에서만 도는
// 스크립트는 단위 테스트가 없어서, 오타 하나가 그대로 배포되면 빈 화면이 된다.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LINT = join(ROOT, "scripts/lint.sh");

/** 임시 폴더에 파일을 쓰고 lint.sh 에 그 경로들을 넘긴다. */
const lint = (files) => {
  const dir = mkdtempSync(join(tmpdir(), "bl-lint-"));
  try {
    const paths = Object.entries(files).map(([name, body]) => {
      const path = join(dir, name);
      writeFileSync(path, body);
      return path;
    });
    const done = spawnSync("bash", [LINT, ...paths], { cwd: ROOT, encoding: "utf8" });
    return { ok: done.status === 0, out: done.stdout + done.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("멀쩡한 파일은 통과한다", () => {
  const result = lint({
    "a.mjs": "export const x = 1;\n",
    "b.js": "const f = (n) => n * 2;\nexport default f;\n",
    "c.json": '{"a": 1}\n',
    "d.sh": "#!/usr/bin/env bash\nset -e\necho hi\n",
  });
  assert.equal(result.ok, true, result.out);
  assert.match(result.out, /4개 파일 문법 통과/);
});

test("JS 문법 오류를 잡는다", () => {
  const result = lint({ "bad.mjs": "const x = ;\n" });
  assert.equal(result.ok, false);
  assert.match(result.out, /bad\.mjs — 문법 오류/);
});

test("브라우저 스크립트의 오타도 잡는다 (단위 테스트가 없는 코드)", () => {
  // 실제로 겪은 형태: 괄호를 닫지 않아 파일 전체가 죽는다
  const result = lint({ "toy.js": "document.querySelector('#a'.addEventListener('click', () => {});\n" });
  assert.equal(result.ok, false);
});

test("JSON 파싱 실패를 잡는다", () => {
  const result = lint({ "x.json": '{"a": 1,}\n' });
  assert.equal(result.ok, false);
  assert.match(result.out, /JSON 파싱 실패/);
});

test("셸 문법 오류를 잡는다", () => {
  const result = lint({ "x.sh": "if [ 1 -eq 1 ]; then\n  echo hi\n" });
  assert.equal(result.ok, false);
  assert.match(result.out, /셸 문법 오류/);
});

test("검사 대상이 아닌 확장자는 건드리지 않는다", () => {
  const result = lint({ "a.html": "<p>안 닫힌 태그", "b.css": "a { color: ", "c.md": "# 제목" });
  assert.equal(result.ok, true, result.out);
  assert.match(result.out, /0개 파일 문법 통과/);
});

test("리포 전체가 문법 통과한다", () => {
  const done = spawnSync("bash", [LINT], { cwd: ROOT, encoding: "utf8" });
  assert.equal(done.status, 0, done.stdout + done.stderr);
});
