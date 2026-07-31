// 움직이는 이모티콘 CLI의 실행 안전성·재현성 공용 유틸.
// 외부 의존성 없이 원자적 저장, 입력 해시, 실행 이력, 비용 상한을 관리한다.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const EMOTICON_SCHEMA_VERSION = 2;
export const EMOTICON_CLI_VERSION = 2;
export const EMOTICON_PROMPT_VERSION = "2026-07-keys-v1";
export const IMAGE_COST_USD = 0.039;

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function atomicWriteFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.partial-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, value);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function atomicWriteJson(path, value) {
  atomicWriteFile(path, JSON.stringify(value, null, 2) + "\n");
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function specHash(value) {
  return sha256(JSON.stringify(value));
}

function sameArray(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => value === b[index]);
}

export function assertResumeCompatible(existing, expected) {
  if (existing.schemaVersion !== EMOTICON_SCHEMA_VERSION) {
    throw new Error(
      `--resume은 schemaVersion ${EMOTICON_SCHEMA_VERSION} 컷만 지원합니다 ` +
      `(현재 ${existing.schemaVersion ?? "없음"}) — --force로 새로 생성하세요`,
    );
  }
  for (const key of ["mode", "specHash", "sheetHash"]) {
    if (existing[key] !== expected[key]) {
      throw new Error(`--resume 입력 불일치: ${key}가 기존 컷과 다릅니다 — --force로 새로 생성하세요`);
    }
  }
  if (!sameArray(existing.referenceHashes, expected.referenceHashes)) {
    throw new Error("--resume 입력 불일치: 캐릭터 레퍼런스가 기존 컷과 다릅니다 — --force로 새로 생성하세요");
  }
}

export function prepareCutRun({ cutDir, options, base, provider }) {
  if (options.force && options.resume) throw new Error("--force와 --resume은 함께 사용할 수 없습니다");
  const metaPath = join(cutDir, "cut.json");
  let meta = null;

  if (existsSync(cutDir)) {
    if (options.force) rmSync(cutDir, { recursive: true, force: true });
    else if (!options.resume) throw new Error(`이미 존재하는 컷입니다: ${cutDir} (이어하려면 --resume, 덮어쓰려면 --force)`);
    else {
      if (!existsSync(metaPath)) throw new Error(`--resume 메타가 없습니다: ${metaPath} — --force로 새로 생성하세요`);
      meta = readJson(metaPath);
      assertResumeCompatible(meta, base);
    }
  } else if (options.resume) {
    throw new Error(`이어갈 컷이 없습니다: ${cutDir}`);
  }

  mkdirSync(cutDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const run = {
    runId: randomUUID(),
    startedAt,
    provider,
    gitCommit: process.env.GITHUB_SHA || process.env.BUBBLELAB_COMMIT || null,
    calls: 0,
    estimatedCostUsd: 0,
    status: "running",
  };
  meta = meta ? {
    ...meta,
    ...base,
    status: "running",
    updatedAt: startedAt,
    completedAt: null,
    unitCostUsd: IMAGE_COST_USD,
    runs: [...(Array.isArray(meta.runs) ? meta.runs : []), run],
  } : {
    schemaVersion: EMOTICON_SCHEMA_VERSION,
    cliVersion: EMOTICON_CLI_VERSION,
    promptVersion: EMOTICON_PROMPT_VERSION,
    ...base,
    provider,
    status: "running",
    createdAt: startedAt,
    updatedAt: startedAt,
    completedAt: null,
    calls: 0,
    unitCostUsd: IMAGE_COST_USD,
    estimatedCostUsd: 0,
    runs: [run],
  };
  atomicWriteJson(metaPath, meta);
  return { meta, metaPath, runIndex: meta.runs.length - 1 };
}

export function updateCutRun(state, patch = {}) {
  const now = new Date().toISOString();
  state.meta = { ...state.meta, ...patch, updatedAt: now };
  atomicWriteJson(state.metaPath, state.meta);
}

export function finishCutRun(state, status, error = null, patch = {}) {
  const completedAt = new Date().toISOString();
  const runs = [...state.meta.runs];
  runs[state.runIndex] = {
    ...runs[state.runIndex],
    status,
    completedAt,
    ...(error ? { error: String(error.message ?? error).slice(0, 1000) } : {}),
  };
  state.meta = {
    ...state.meta,
    ...patch,
    status,
    updatedAt: completedAt,
    ...(status === "complete" ? { completedAt } : {}),
    runs,
  };
  atomicWriteJson(state.metaPath, state.meta);
}

function finiteLimit(value, name, { integer = false } = {}) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`--${name} 는 0 이상의 ${integer ? "정수" : "숫자"}여야 합니다`);
  }
  return parsed;
}

export function assertPlannedBudget(plan, options) {
  const maxCalls = finiteLimit(options["max-calls"], "max-calls", { integer: true });
  const maxCost = finiteLimit(options["max-cost"], "max-cost");
  if (maxCalls !== null && plan.remainingCalls > maxCalls) {
    throw new Error(`예상 호출 ${plan.remainingCalls}회가 --max-calls ${maxCalls}회를 넘습니다`);
  }
  const cost = plan.remainingCalls * IMAGE_COST_USD;
  if (maxCost !== null && cost > maxCost + 1e-9) {
    throw new Error(`예상 비용 $${cost.toFixed(3)}가 --max-cost $${maxCost.toFixed(3)}를 넘습니다`);
  }
  return { maxCalls, maxCost };
}

export function budgetedProvider(provider, options, plan, state) {
  const limits = assertPlannedBudget(plan, options);
  return {
    name: provider.name,
    async generate(request) {
      const run = state.meta.runs[state.runIndex];
      const nextRunCalls = run.calls + 1;
      const nextRunCost = nextRunCalls * IMAGE_COST_USD;
      if (limits.maxCalls !== null && nextRunCalls > limits.maxCalls) {
        throw new Error(`--max-calls ${limits.maxCalls}회에 도달했습니다 — --resume으로 이어가세요`);
      }
      if (limits.maxCost !== null && nextRunCost > limits.maxCost + 1e-9) {
        throw new Error(`--max-cost $${limits.maxCost.toFixed(3)}에 도달했습니다 — --resume으로 이어가세요`);
      }

      // 실패 응답도 과금됐을 가능성을 보존하기 위해 호출 직전에 시도 횟수를 기록한다.
      const runs = [...state.meta.runs];
      runs[state.runIndex] = {
        ...run,
        calls: nextRunCalls,
        estimatedCostUsd: Number(nextRunCost.toFixed(6)),
      };
      state.meta = {
        ...state.meta,
        runs,
        calls: Number(state.meta.calls ?? 0) + 1,
        estimatedCostUsd: Number((Number(state.meta.estimatedCostUsd ?? 0) + IMAGE_COST_USD).toFixed(6)),
        updatedAt: new Date().toISOString(),
      };
      atomicWriteJson(state.metaPath, state.meta);
      return provider.generate(request);
    },
  };
}

export function planCost(calls) {
  return Number((calls * IMAGE_COST_USD).toFixed(6));
}
