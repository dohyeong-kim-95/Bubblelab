import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/* 배포 단계의 wrangler 설치가 매번 4분 가까이 걸렸다. wrangler-action 이 먼저
 * `npx --no-install wrangler --version` 으로 기존 설치를 찾는데, 리포에 wrangler 가
 * 없어서 매번 새로 받았기 때문이다(setup-node 의 npm 캐시는 lockfile 기준인데
 * wrangler 가 거기 없었다).
 *
 * devDependencies 에 **워크플로와 같은 버전으로 핀**해 두면 그 확인이 성공해 설치
 * 단계를 통째로 건너뛴다. 두 버전이 어긋나면 확인이 실패해 느린 설치가 조용히
 * 돌아오므로, 여기서 묶어 둔다. */
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const workflow = await readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");

test("wrangler 는 정확한 버전으로 핀되어 있다 — 범위(^)면 npx 확인이 어긋난다", () => {
  const pinned = pkg.devDependencies?.wrangler;
  assert.ok(pinned, "wrangler 가 devDependencies 에 없다 — 배포마다 4분씩 다시 받게 된다");
  assert.match(pinned, /^\d+\.\d+\.\d+$/, `정확한 버전이어야 한다 (지금 ${pinned})`);
});

test("워크플로의 wranglerVersion 과 같은 버전이다", () => {
  const [, inWorkflow] = workflow.match(/wranglerVersion:\s*"([^"]+)"/) ?? [];
  assert.ok(inWorkflow, "워크플로에서 wranglerVersion 을 찾지 못했다");
  assert.equal(pkg.devDependencies.wrangler, inWorkflow,
    "package.json 과 워크플로의 wrangler 버전이 어긋났다 — 설치 단계가 다시 살아난다");
});
