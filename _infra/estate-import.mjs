#!/usr/bin/env node
// 국토부 실거래가를 정적 JSON으로 내려받아 estate/data/에 저장하는 CLI.
// RTMS API가 해외 IP를 차단해 Cloudflare Worker에서는 못 부르므로,
// 한국 IP인 로컬에서 이 스크립트를 돌리고 결과를 커밋해 배포한다.
//
//   MOLIT_SERVICE_KEY=키 node _infra/estate-import.mjs [--months 36] [--force]
//
// 키는 env가 없으면 리포 루트 .dev.vars의 MOLIT_SERVICE_KEY= 줄에서 읽는다.
// 지난달 이전에 이미 받아둔 달은 건너뛰고(신고 정정을 다시 반영하려면
// --force), 최근 3개월은 신고가 계속 쌓이므로 항상 다시 받는다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, fetchDealsMonth } from "./estate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "estate", "data");
const TYPES = ["trade", "rent"];

export function monthsBack(n, nowYm) {
  let y = +nowYm.slice(0, 4), m = +nowYm.slice(4);
  const list = [];
  for (let i = 0; i < n; i += 1) {
    list.unshift(`${y}${String(m).padStart(2, "0")}`);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
  return list;
}

// 최근 3개월(신고 유입 중)은 항상 다시 받고, 그 전은 파일이 있으면 둔다.
export function shouldFetch(ym, nowYm, exists, force) {
  if (force || !exists) return true;
  const recentFloor = monthsBack(3, nowYm)[0];
  return ym >= recentFloor;
}

function kstNowYm() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${value.year}${value.month}`;
}

function readServiceKey() {
  if (process.env.MOLIT_SERVICE_KEY?.trim()) return process.env.MOLIT_SERVICE_KEY.trim();
  const devVars = join(ROOT, ".dev.vars");
  if (existsSync(devVars)) {
    const match = /^MOLIT_SERVICE_KEY\s*=\s*(.+)$/m.exec(readFileSync(devVars, "utf8"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const monthsArg = args.indexOf("--months");
  const months = monthsArg >= 0 ? Math.min(120, Math.max(1, +args[monthsArg + 1])) : 36;
  const force = args.includes("--force");
  const key = readServiceKey();
  if (!key) {
    console.error("MOLIT_SERVICE_KEY가 없습니다. env로 주거나 .dev.vars에 한 줄 추가하세요.");
    process.exit(1);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const nowYm = kstNowYm();
  const jobs = [];
  for (const [region, { lawd }] of REGIONS) {
    for (const type of TYPES) {
      for (const ym of monthsBack(months, nowYm)) {
        const file = join(DATA_DIR, `${type}-${region}-${ym}.json`);
        if (shouldFetch(ym, nowYm, existsSync(file), force)) jobs.push({ region, lawd, type, ym, file });
      }
    }
  }
  console.log(`받을 달: ${jobs.length}개 (기간 ${months}개월 × ${REGIONS.size}지역 × 매매·전월세)`);

  let done = 0, failed = 0;
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        const result = await fetchDealsMonth(job.type, job.lawd, job.ym, key);
        if (result.error) throw new Error(result.error);
        writeFileSync(job.file, JSON.stringify({
          status: "ok", type: job.type, region: job.region, ym: job.ym,
          total: result.total, items: result.items,
        }));
        done += 1;
        console.log(`  ${job.type} ${job.region} ${job.ym}: ${result.items.length}건 (${done + failed}/${jobs.length})`);
      } catch (error) {
        failed += 1;
        console.error(`  실패 ${job.type} ${job.region} ${job.ym}: ${error.message}`);
      }
    }
  }));

  // 실제로 존재하는 파일 기준으로 목록을 다시 만든다 (실패 달은 빠짐).
  const index = { generatedAt: new Date().toISOString(), months: {} };
  for (const [region] of REGIONS) {
    for (const type of TYPES) {
      index.months[`${type}:${region}`] = monthsBack(120, nowYm)
        .filter((ym) => existsSync(join(DATA_DIR, `${type}-${region}-${ym}.json`)));
    }
  }
  writeFileSync(join(DATA_DIR, "index.json"), JSON.stringify(index));
  console.log(`완료: ${done}개 저장, ${failed}개 실패 → estate/data/ (index.json 갱신)`);
  if (failed) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
