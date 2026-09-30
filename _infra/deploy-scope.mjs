import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SITES = [
  "admin", "assets", "duri", "espanol", "estate", "games", "idle", "invest", "lab",
  "life", "mindfulness", "podcast", "puzzle", "sktest", "slop", "test",
  "trip", "util", "work", "www",
];

const SITE_TESTS = {
  admin: ["_infra/analytics.test.mjs"],
  assets: [
    "_infra/asset-flags.test.mjs", "_infra/assets-store.test.mjs", "_infra/assets.test.mjs",
    "_infra/devices.test.mjs", "_infra/downloads.test.mjs", "_infra/gif.test.mjs",
    "_infra/sticker-pack.test.mjs", "_infra/wallpaper.test.mjs",
  ],
  duri: [
    "_infra/duri-world.test.mjs", "_infra/duri.test.mjs", "_src/duri-sink/store.test.mjs",
  ],
  espanol: [],
  estate: ["_infra/estate.test.mjs"],
  games: [
    "_infra/check-avalon-sync.test.mjs", "_infra/liargame.test.mjs",
    "_infra/realtime.test.mjs", "_infra/stepcam.test.mjs",
  ],
  idle: ["_infra/idle.test.mjs"],
  invest: ["_infra/invest.test.mjs"],
  lab: ["_infra/insights-publish.test.mjs"],
  life: [
    "_infra/backup-slim.test.mjs", "_infra/backup.test.mjs",
    "_infra/budget-sms.test.mjs", "_infra/budget.test.mjs",
    "_infra/discord.test.mjs", "_infra/dram.test.mjs", "_infra/espanol.test.mjs",
    "_infra/kcal.test.mjs", "_infra/library.test.mjs", "_infra/life.test.mjs",
    "_infra/papers.test.mjs", "_infra/pops.test.mjs", "_infra/pushup.test.mjs",
    "_infra/review.test.mjs", "_infra/tts.test.mjs", "_src/life-sink/store.test.mjs",
  ],
  mindfulness: [],
  podcast: ["_infra/podcast-ai.test.mjs", "_infra/podcast.test.mjs"],
  puzzle: [],
  sktest: ["_infra/sktest.test.mjs"],
  slop: ["_infra/animal-vs.test.mjs", "_infra/podium.test.mjs"],
  test: [],
  trip: [
    "_infra/trip-packages.test.mjs", "_infra/trip-watch.test.mjs", "_infra/trip.test.mjs",
  ],
  util: [
    "_infra/brief.test.mjs", "_infra/chat.test.mjs", "_infra/fortune.test.mjs",
    "_infra/planner.test.mjs", "_infra/proofread.test.mjs", "_infra/saju-detail.test.mjs",
    "_infra/stars-skyline.test.mjs", "_infra/stars.test.mjs", "_infra/tojeong.test.mjs",
    "_infra/yaksok.test.mjs",
  ],
  work: [
    "_infra/emoticon-gate.test.mjs", "_infra/emoticon-prompt.test.mjs",
    "_infra/emoticon-review.test.mjs", "_infra/emoticon-rig.test.mjs",
    "_infra/emoticon-vision.test.mjs", "_infra/emoticon.test.mjs",
    "_infra/reviews.test.mjs", "_infra/skeleton.test.mjs", "_infra/workqna.test.mjs",
  ],
  www: ["_infra/search-rules.test.mjs"],
};

const SITE_E2E = {
  duri: [
    "_infra/e2e/duri-fit.spec.mjs", "_infra/e2e/duri-map.spec.mjs",
    "_infra/e2e/duri-picker.spec.mjs", "_infra/e2e/duri-timelapse.spec.mjs",
  ],
  life: [
    "_infra/e2e/backup.spec.mjs", "_infra/e2e/budget.spec.mjs",
    "_infra/e2e/espanol.spec.mjs", "_infra/e2e/kcal.spec.mjs",
    "_infra/e2e/library.spec.mjs", "_infra/e2e/life.spec.mjs",
    "_infra/e2e/pushup.spec.mjs", "_infra/e2e/review.spec.mjs",
  ],
  sktest: ["_infra/e2e/sktest-workbook.spec.mjs"],
  util: ["_infra/e2e/yaksok.spec.mjs"],
};

const GLOBAL_TESTS = [
  "_infra/agent-worktree.test.mjs", "_infra/csp-serve.test.mjs",
  "_infra/deploy-check.test.mjs", "_infra/deploy-prepare.test.mjs",
  "_infra/deploy-release.test.mjs", "_infra/deploy-scope.test.mjs",
  "_infra/deploy-workflow.test.mjs", "_infra/home-button.test.mjs", "_infra/lint.test.mjs",
  "_infra/records.test.mjs", "_infra/security.test.mjs", "_infra/verify-prod.test.mjs",
  "_infra/ship.test.mjs", "_infra/webpush.test.mjs", "_infra/worker.test.mjs",
];
const CLASSIFIED_TESTS = new Set([...GLOBAL_TESTS, ...Object.values(SITE_TESTS).flat()]);
const BUILD_CONTRACT = "_infra/home-button.test.mjs";
const SMOKE = "_infra/e2e/smoke.spec.mjs";
const CLASSIFIED_E2E = new Set([SMOKE, ...Object.values(SITE_E2E).flat()]);
const TEST_DIRECTORIES = ["_infra", "_src/duri-sink", "_src/life-sink"];
const E2E_DIRECTORIES = ["_infra/e2e"];

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

function discover(root, directories, suffix) {
  return sortedUnique(directories.flatMap((directory) => {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) return [];
    return readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => `${directory}/${entry.name}`);
  }));
}

function isClassifiedTest(file) {
  return CLASSIFIED_TESTS.has(file);
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

function requiresFull(file) {
  if (/(?:^|\/)\.?.+\.test\.mjs$/.test(file) || /(?:^|\/).+\.spec\.mjs$/.test(file)) return true;
  if (file === "www/index.html") return true;
  return /^(?:_infra|_src|_shared|_assets|scripts|\.github)(?:\/|$)/.test(file)
    || /^package[^/]*$/.test(file);
}

function fullPlan(files, root, discoveredTests, discoveredE2e) {
  return {
    mode: "full",
    sites: [...SITES],
    tests: discoveredTests ?? discover(root, TEST_DIRECTORIES, ".test.mjs"),
    e2e: discoveredE2e ?? discover(root, E2E_DIRECTORIES, ".spec.mjs"),
    avalon: true,
    files,
  };
}

export function planDeployment(files, { root = repoRoot, full = false } = {}) {
  const normalized = normalizeFiles(files);
  const absoluteRoot = resolve(root);
  const discoveredTests = discover(absoluteRoot, TEST_DIRECTORIES, ".test.mjs");
  const discoveredE2e = discover(absoluteRoot, E2E_DIRECTORIES, ".spec.mjs");
  const hasUnknownTest = discoveredTests.some((file) => !isClassifiedTest(file));
  const hasUnknownE2e = discoveredE2e.some((file) => !CLASSIFIED_E2E.has(file));

  if (full || hasUnknownTest || hasUnknownE2e) {
    return fullPlan(normalized, absoluteRoot, discoveredTests, discoveredE2e);
  }

  const sites = new Set();
  const owned = ownershipOf(absoluteRoot);
  for (const file of normalized) {
    if (isDocumentation(file)) continue;
    const owner = owned.find((rule) => rule.re.test(file))?.site;
    if (owner) { sites.add(owner); continue; }
    if (requiresFull(file)) return fullPlan(normalized, absoluteRoot, discoveredTests, discoveredE2e);
    const [site] = file.split("/", 1);
    if (!SITES.includes(site)) return fullPlan(normalized, absoluteRoot, discoveredTests, discoveredE2e);
    sites.add(site);
  }

  if (sites.size === 0) {
    return { mode: "none", sites: [], tests: [], e2e: [], avalon: false, files: normalized };
  }

  const selectedSites = [...sites].sort();
  const availableTests = new Set(discoveredTests);
  return {
    mode: "scoped",
    sites: selectedSites,
    tests: sortedUnique([
      BUILD_CONTRACT,
      ...selectedSites.flatMap((site) => SITE_TESTS[site]).filter((file) => availableTests.has(file)),
    ]),
    e2e: sortedUnique([SMOKE, ...selectedSites.flatMap((site) => SITE_E2E[site] ?? [])]),
    avalon: sites.has("games"),
    files: normalized,
  };
}

function parseArgs(argv) {
  const options = { full: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--full") {
      options.full = true;
      continue;
    }
    if (!["--base", "--head", "--output"].includes(arg)) throw new Error(`unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    const key = arg.slice(2);
    if (options[key] !== undefined) throw new Error(`${arg} may only be provided once`);
    options[key] = value;
    index += 1;
  }
  for (const key of ["base", "head", "output"]) {
    if (!options[key]) throw new Error(`--${key} is required`);
  }
  return options;
}

function commit(cwd, label, revision) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`invalid --${label} commit: ${revision}`, { cause: error });
  }
}

async function main(argv) {
  const options = parseArgs(argv);
  const base = commit(process.cwd(), "base", options.base);
  const head = commit(process.cwd(), "head", options.head);
  const diff = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", base, head, "--"], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  const files = diff.split("\0").filter(Boolean);
  const plan = planDeployment(files, { root: process.cwd(), full: options.full });
  const output = resolve(process.cwd(), options.output);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
