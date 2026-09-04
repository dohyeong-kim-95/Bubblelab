import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCspServer } from "./csp-serve.mjs";

const dir = await mkdtemp(join(tmpdir(), "csp-"));
await mkdir(join(dir, "life", "dram"), { recursive: true });
await mkdir(join(dir, "slop"), { recursive: true });
await writeFile(join(dir, "life", "dram", "index.html"), "<!doctype html><title>t</title>");
await writeFile(join(dir, "slop", "index.html"), "<!doctype html><title>t</title>");

const server = createCspServer({ dir, port: 0 });
await new Promise((done) => server.listen(0, done));
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

test("life 화면에는 워커와 같은 CSP 가 붙는다 — 이 서버의 존재 이유다", async () => {
  const res = await fetch(`${base}/life/dram/`);
  const csp = res.headers.get("content-security-policy");
  assert.equal(res.status, 200);
  // 인라인 style 이 막히는지가 핵심이다. 로컬에서 이게 빠지면 프로덕션에서만 깨진다.
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
});

test("life 밖은 life 의 CSP 를 쓰지 않는다 — 정책을 한 벌로 뭉뚱그리지 않는다", async () => {
  const res = await fetch(`${base}/slop/`);
  assert.equal(res.status, 200);
  assert.notEqual(res.headers.get("content-security-policy"), (await fetch(`${base}/life/dram/`)).headers.get("content-security-policy"));
});

test("루트 밖으로 나가는 경로는 받지 않는다", async () => {
  const res = await fetch(`${base}/../../etc/passwd`, { redirect: "manual" });
  assert.ok(res.status === 403 || res.status === 404, `403/404 이어야 하는데 ${res.status}`);
});

test("없는 파일은 404 이고, 그때도 보안 헤더는 붙는다", async () => {
  const res = await fetch(`${base}/life/dram/nope.js`);
  assert.equal(res.status, 404);
  assert.ok(res.headers.get("content-security-policy"));
});
