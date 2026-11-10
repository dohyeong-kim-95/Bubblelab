// 배포 검증 범위를 정한다.
//
// **단위 테스트는 고르지 않는다** — 전부 돌려도 십몇 초다. 예전에는 서브도메인별 테스트 표가
// 있어서 새 테스트를 여기와 그 표를 고정하는 테스트 두 군데에 등록해야 했고, 아낀 것은 몇 초였다.
// 고르는 것은 느린 브라우저 검사(e2e)뿐이다.
//
//   none   — 배포되지 않는 문서만 바뀌었다. 아무것도 돌리지 않고 publish 도 건너뛴다.
//   scoped — 서브도메인 폴더(와 agent-scope.conf 가 그 소유로 적은 파일)만 바뀌었다.
//            스모크 + 그 서브도메인의 spec.
//   full   — 공용·인프라·모르는 경로가 끼었다. spec 전부.
//
// 어느 서브도메인 것인지 `SITE_E2E` 에 없는 spec 은 **언제나** 돈다 — 등록을 잊어도 검사가
// 빠지지 않고, 조금 느려질 뿐이다.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SITES = [
  "admin", "assets", "dageudangs", "duri", "estate", "games", "idle", "interior", "lab",
  "life", "mindfulness", "opic", "podcast", "slop", "test",
  "util", "work", "www",
];

const SITE_E2E = {
  estate: ["_infra/e2e/estate.spec.mjs"],
  duri: [
    "_infra/e2e/duri-fit.spec.mjs", "_infra/e2e/duri-map.spec.mjs",
    "_infra/e2e/duri-picker.spec.mjs", "_infra/e2e/duri-timelapse.spec.mjs",
  ],
  life: [
    "_infra/e2e/backup.spec.mjs", "_infra/e2e/budget.spec.mjs",
    "_infra/e2e/kcal.spec.mjs",
    "_infra/e2e/library.spec.mjs", "_infra/e2e/life.spec.mjs",
    "_infra/e2e/pushup.spec.mjs", "_infra/e2e/review.spec.mjs",
  ],
  util: ["_infra/e2e/yaksok.spec.mjs"],
};
const SITE_SPECS = new Set(Object.values(SITE_E2E).flat());
const E2E_DIRECTORY = "_infra/e2e";

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) throw new TypeError("files must be an array");
  return sortedUnique(files.map((file) => {
    if (typeof file !== "string") throw new TypeError("each changed file must be a string");
    return file.replaceAll("\\", "/").replace(/^\.\//, "");
  }).filter(Boolean));
}

function discoverSpecs(root) {
  const absolute = join(root, E2E_DIRECTORY);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.mjs"))
    .map((entry) => `${E2E_DIRECTORY}/${entry.name}`).sort();
}

function isDocumentation(file) {
  return /^[^/]+\.md$/i.test(file) || /^(?:\.omx|\.codex|\.agents|docs)\//.test(file);
}

// _infra/agent-scope.conf 가 서브도메인 하나의 것이라고 적어 둔 파일(예: util 의 _infra/yaksok.js)은
// 공용 인프라가 아니다 — 그 서브도메인 범위로 검증한다. 워커는 한 번들이지만 publish 뒤 라이브
// 검증이 모든 서브도메인을 매번 찌르고, 깨지면 직전 버전으로 복구한다. *shared* 줄은 소유가 아니다.
function ownershipOf(root) {
  const file = join(root, "_infra", "agent-scope.conf");
  if (!existsSync(file)) return [];
  const rules = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^([a-z][a-z0-9-]*):\s+(.+)$/.exec(line.trim());
    if (!match || !SITES.includes(match[1])) continue;
    for (const pattern of match[2].split(/\s+/)) {
      const source = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")
        .replace(/\/\[\^\/\]\*$/, "/.*");
      rules.push({ site: match[1], re: new RegExp(`^${source}$`) });
    }
  }
  return rules;
}

/** 이 파일이 어느 서브도메인 하나의 것인가. 아니면(공용·인프라·모르는 경로) null. */
function siteOf(file, owned) {
  const owner = owned.find((rule) => rule.re.test(file))?.site;
  if (owner) return owner;
  if (file === "www/index.html") return null;   // 랜딩은 모든 서브도메인의 카드가 모이는 공용 파일
  const [site] = file.split("/", 1);
  return file.includes("/") && SITES.includes(site) ? site : null;
}

export function planDeployment(files, { root = repoRoot, full = false } = {}) {
  const normalized = normalizeFiles(files);
  const absoluteRoot = resolve(root);
  const specs = discoverSpecs(absoluteRoot);
  const fullPlan = { mode: "full", sites: [...SITES], e2e: specs, files: normalized };
  if (full) return fullPlan;

  const sites = new Set();
  const owned = ownershipOf(absoluteRoot);
  for (const file of normalized) {
    if (isDocumentation(file)) continue;
    const site = siteOf(file, owned);
    if (!site) return fullPlan;
    sites.add(site);
  }
  if (sites.size === 0) return { mode: "none", sites: [], e2e: [], files: normalized };

  const selected = [...sites].sort();
  const wanted = new Set(selected.flatMap((site) => SITE_E2E[site] ?? []));
  return {
    mode: "scoped",
    sites: selected,
    // 스모크와 분류 안 된 spec 은 언제나, 서브도메인 spec 은 그 서브도메인이 바뀌었을 때만.
    e2e: specs.filter((spec) => !SITE_SPECS.has(spec) || wanted.has(spec)),
    files: normalized,
  };
}
