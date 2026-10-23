// scripts/lint-html.mjs — HTML 인라인 스크립트 문법 검사(lint.sh 의 .html 단계).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inlineScripts, checkScript } from "../../scripts/lint-html.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LINT = join(ROOT, "scripts/lint.sh");

function lint(files) {
  const dir = mkdtempSync(join(tmpdir(), "bl-lint-html-test-"));
  try {
    const paths = [];
    for (const [name, body] of Object.entries(files)) {
      const path = join(dir, name);
      writeFileSync(path, body);
      paths.push(path);
    }
    const done = spawnSync("bash", [LINT, ...paths], { cwd: ROOT, encoding: "utf8" });
    return { ok: done.status === 0, out: done.stdout + done.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("lint-html: src 있는 스크립트와 템플릿은 건너뛰고 나머지 종류를 가른다", () => {
  const scripts = inlineScripts([
    '<script defer src="/a.js"></script>',
    "<script>let a = 1;</script>",
    '<script type="module">import x from "./x.js";</script>',
    '<script type="application/json" id="data">{"a": 1}</script>',
    '<script type="text/template"><b>{{x}}</b></script>',
    "<script>  </script>",
  ].join("\n"));
  assert.deepEqual(scripts.map((script) => [script.kind, script.line]), [["classic", 2], ["module", 3], ["json", 4]]);
});

test("lint-html: 에러 줄 번호는 HTML 파일의 줄이다", () => {
  const [script] = inlineScripts("<!doctype html>\n<p>\n<script>\nconst ok = 1;\nconst bad = ;\n</script>");
  const problem = checkScript(script, tmpdir());
  assert.match(problem, /^5행:/);
});

test("lint.sh: 인라인 스크립트 오타를 잡는다(보통·모듈·JSON)", () => {
  assert.equal(lint({ "a.html": "<script>document.querySelector('#a'.addEventListener('click', () => {});</script>" }).ok, false);
  assert.equal(lint({ "b.html": '<script type="module">const = 1;</script>' }).ok, false);
  const json = lint({ "c.html": '<script type="application/json">{"a": 1,}</script>' });
  assert.equal(json.ok, false);
  assert.match(json.out, /c\.html — 인라인 스크립트 문법 오류/);
});

test("lint.sh: 멀쩡한 HTML 은 통과하고, 스크립트가 없는 HTML 은 세지 않는다", () => {
  const result = lint({
    "ok.html": "<script>const f = (n) => n * 2;</script>\n<script type=\"module\">await Promise.resolve();</script>",
    "plain.html": "<p>안 닫힌 태그",
  });
  assert.equal(result.ok, true, result.out);
  assert.match(result.out, /1개 파일 문법 통과/);
});
