// games/avalon 은 _src/avalon 의 빌드 산출물이다(직접 수정 금지). 소스만 고치고
// rebuild.sh 를 잊으면 배포된 게임이 소스보다 낡은 채로 남는데, 지금까지 그걸
// 잡아주는 곳이 없었다 — Deploy는 아발론을 아예 빌드하지 않았고 CI는 빌드만 하고
// 산출물과 대조하지 않았다.
//
// 이 스크립트는 방금 빌드한 _src/avalon/dist 와 커밋된 games/avalon 을 파일 단위로
// 비교해서, 다르면 무엇이 다른지 적고 실패한다.
//
//   node _infra/check-avalon-sync.mjs
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 트리를 { 상대경로: 내용해시 } 로 납작하게 편다
export function hashTree(dir) {
  const files = new Map();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        files.set(relative(dir, path).split("\\").join("/"),
          createHash("sha256").update(readFileSync(path)).digest("hex"));
      }
    }
  };
  walk(dir);
  return files;
}

// 산출물 두 벌의 차이를 사람이 읽을 수 있는 줄들로 (같으면 빈 배열)
export function compareTrees(expected, actual) {
  const problems = [];
  for (const [path, hash] of expected) {
    if (!actual.has(path)) problems.push(`빠짐: ${path} (빌드에는 있는데 games/avalon에 없음)`);
    else if (actual.get(path) !== hash) problems.push(`다름: ${path}`);
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) problems.push(`남음: ${path} (games/avalon에만 있음 — 옛 빌드 찌꺼기)`);
  }
  return problems.sort();
}

function main() {
  const dist = join(ROOT, "_src", "avalon", "dist");
  const deployed = join(ROOT, "games", "avalon");
  if (!existsSync(dist)) {
    console.error("_src/avalon/dist 가 없습니다 — 먼저 아발론을 빌드하세요 (npm run build --prefix _src/avalon)");
    process.exit(1);
  }
  if (!existsSync(deployed)) {
    console.error("games/avalon 이 없습니다 — _src/avalon/rebuild.sh 를 실행하고 커밋하세요");
    process.exit(1);
  }

  const problems = compareTrees(hashTree(dist), hashTree(deployed));
  if (!problems.length) {
    console.log("games/avalon 이 _src/avalon 빌드와 일치합니다");
    return;
  }
  console.error("games/avalon 이 소스 빌드와 다릅니다 — _src/avalon/rebuild.sh 를 실행하고 결과를 커밋하세요:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// 테스트가 import 할 때는 돌지 않고, CLI로 부를 때만 돈다
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
