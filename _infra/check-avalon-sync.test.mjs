import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareTrees, hashTree } from "./check-avalon-sync.mjs";

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "avalon-sync-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test("같은 트리는 문제가 없다", () => {
  const files = { "index.html": "<html>", "assets/app.js": "console.log(1)" };
  const a = tree(files);
  const b = tree(files);
  try {
    assert.deepEqual(compareTrees(hashTree(a), hashTree(b)), []);
  } finally { rmSync(a, { recursive: true }); rmSync(b, { recursive: true }); }
});

test("소스만 고치고 rebuild를 잊은 상태를 잡는다", () => {
  const built = tree({ "index.html": "<html>새 버전", "assets/app.js": "2" });
  const deployed = tree({ "index.html": "<html>옛 버전", "assets/app.js": "2" });
  try {
    const problems = compareTrees(hashTree(built), hashTree(deployed));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /다름: index\.html/);
  } finally { rmSync(built, { recursive: true }); rmSync(deployed, { recursive: true }); }
});

test("새 파일 누락과 옛 빌드 찌꺼기를 구분해서 알린다", () => {
  const built = tree({ "index.html": "x", "assets/new-hash.js": "new" });
  const deployed = tree({ "index.html": "x", "assets/old-hash.js": "old" });
  try {
    const problems = compareTrees(hashTree(built), hashTree(deployed)).join("\n");
    assert.match(problems, /빠짐: assets\/new-hash\.js/);
    assert.match(problems, /남음: assets\/old-hash\.js/);
  } finally { rmSync(built, { recursive: true }); rmSync(deployed, { recursive: true }); }
});
