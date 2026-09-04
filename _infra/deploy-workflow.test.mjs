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


/* 배포 시간의 86%가 의존성 설치였다(한 번은 루트 4분 15초 + 아발론 7분 01초,
 * 실제 검증·빌드·배포는 다 합쳐 1분 35초). 두 가지를 고쳤고, 여기서 되돌아가지
 * 않게 묶어 둔다 — 성능 회귀는 조용히 돌아오고 아무도 눈치채지 못한다. */

test("node_modules 를 통째로 캐시한다 — setup-node 캐시는 내려받기만 아낀다", () => {
  assert.match(workflow, /path:\s*node_modules/, "node_modules 캐시가 없다");
  assert.match(workflow, /if:\s*steps\.node-modules\.outputs\.cache-hit\s*!=\s*'true'/,
    "캐시가 맞아도 npm ci 를 그대로 돌리고 있다");
});

test("아발론은 내용이 바뀌었을 때만 검증한다", () => {
  // 키가 소스와 산출물의 내용 해시여야 한다. 커밋 이력을 보면 force-push 에 취약하다.
  assert.match(workflow, /key:\s*avalon-\$\{\{\s*hashFiles\('_src\/avalon\/\*\*',\s*'games\/avalon\/\*\*'\)/,
    "아발론 캐시 키가 내용 해시가 아니다");
  for (const step of ["Test and build Avalon", "Verify games/avalon matches the source build"]) {
    const at = workflow.indexOf(step);
    assert.ok(at > 0, `${step} 단계가 없다`);
    assert.match(workflow.slice(at, at + 260), /steps\.avalon\.outputs\.cache-hit\s*!=\s*'true'/,
      `${step} 이 무조건 돈다 — 몇 주씩 안 바뀌는 것을 매번 다시 검증하게 된다`);
  }
});

test("설치는 audit·funding 왕복을 하지 않는다", () => {
  for (const [, cmd] of workflow.matchAll(/run:\s*(npm ci[^\n]*)/g)) {
    assert.match(cmd, /--no-audit/, `${cmd} 에 --no-audit 이 없다`);
    assert.match(cmd, /--no-fund/, `${cmd} 에 --no-fund 가 없다`);
  }
});
