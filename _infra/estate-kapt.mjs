#!/usr/bin/env node
// K-apt(공동주택 단지 기본정보)를 받아 estate/data/kapt.json으로 저장하는 CLI.
// 실거래(RTMS)에는 없는 세대수·동수·시공사·주차·난방·지하철 정보를 붙여 준다.
// 인증키는 실거래와 **같은** 공공데이터포털 서비스키(MOLIT_SERVICE_KEY)를 쓴다 —
// data.go.kr에서 아래 두 API를 추가로 활용신청하면 새 키 발급 없이 바로 된다.
//
//   - 공동주택 단지 목록제공 서비스 (AptListService3)
//   - 공동주택 기본 정보제공 서비스 (AptBasisInfoServiceV4)
//
//   MOLIT_SERVICE_KEY=키 node _infra/estate-kapt.mjs [--limit N] [--force]
//
// 이미 받아둔 단지는 건너뛰므로 중간에 일일 호출 한도에 걸려도 다음 날 다시
// 돌리면 이어서 채운다 (--limit N 으로 한 번에 받을 단지 수를 제한할 수 있다).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readServiceKey } from "./estate-import.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "estate", "data");
const KAPT_FILE = join(DATA_DIR, "kapt.json");

const LIST_BASE = "https://apis.data.go.kr/1613000/AptListService3";
const INFO_BASE = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4";

// 시군구 코드. 화성시는 일반구 설치로 41590이 폐지되고 41597(동탄구)로 이관됐지만
// K-apt는 실거래(RTMS)와 갱신 주기가 달라 아직 옛 코드일 수 있다. 순서대로 시도해
// 처음으로 단지를 돌려주는 코드를 쓴다. 폐지 전 코드는 화성시 전체를 주지만,
// 실거래에 등장하는 단지만 남기므로 동탄 밖 단지는 어차피 걸러진다.
export const SIGUNGU = { dongtan: ["41597", "41590"], giheung: ["41463"] };

// ── 순수 함수 (테스트 대상) ──────────────────────────────────

// 단지명 대조용 정규화. 공백·괄호·마침표·하이픈을 지우고 "아파트" 꼬리표를
// 떼어 "롯데캐슬 알바트로스" == "롯데캐슬알바트로스아파트" 가 되게 한다.
export function normalizeName(value) {
  return String(value ?? "")
    .replace(/\(.*?\)/g, "")
    .replace(/[\s.·・_/\-,]/g, "")
    .replace(/아파트$/, "")
    .toLowerCase();
}

// K-apt 지번주소에서 (법정동, 본번)을 뽑는다. "경기도 화성시 동탄구 장지동 1009"
// → { dong: "장지동", jibun: "1009" }. 부번(1009-1)은 실거래 jibun과 맞추기
// 위해 본번만 남기고, "산 12" 같은 임야 지번은 매칭 대상이 아니라 버린다.
export function parseJibunAddr(addr) {
  const tokens = String(addr ?? "").trim().split(/\s+/);
  for (let i = tokens.length - 1; i > 0; i -= 1) {
    const jibun = /^(\d+)(-\d+)?번?지?$/.exec(tokens[i]);
    if (!jibun) continue;
    const dong = tokens[i - 1];
    if (!/[동리가]$/.test(dong) || /^(산|번지)$/.test(dong)) return null;
    return { dong, jibun: jibun[1] };
  }
  return null;
}

const text = (value) => {
  const out = String(value ?? "").trim();
  return out && out !== "-" ? out : null;
};
const int = (value) => {
  const out = text(value);
  if (out === null) return null;
  const n = Number(out.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// 응답에서 화면에 쓸 필드만 골라 담는다 (kapt.json을 작게 유지).
export function pickSpec(basic, detail) {
  const useDate = text(basic?.kaptUsedate);
  const units = int(basic?.kaptdaCnt);
  const parking = (int(detail?.kaptdPcnt) ?? 0) + (int(detail?.kaptdPcntu) ?? 0);
  const station = text(detail?.subwayStation);
  return {
    name: text(basic?.kaptName),
    units,
    dongs: int(basic?.kaptDongCnt),
    built: useDate && useDate.length >= 4 ? Number(useDate.slice(0, 4)) : null,
    builder: text(basic?.kaptBcompany),
    topFloor: int(basic?.kaptTopFloor),
    heat: text(basic?.codeHeatNm),
    hall: text(basic?.codeHallNm),
    parking: parking || null,
    // 세대당 주차대수. 신축은 1.2대 이상, 2000년대 초 단지는 1대 미만이 흔하다.
    parkingPer: parking && units ? Math.round(parking / units * 100) / 100 : null,
    elevators: int(detail?.kaptdEcnt),
    subway: station ? [text(detail?.subwayLine), station].filter(Boolean).join(" ") : null,
    subwayWalk: text(detail?.kaptdWtimesub),
    addr: text(basic?.kaptAddr),
  };
}

// 실거래에 등장하는 단지만 남기고 (지역|동|지번) 키에 맞춘다.
// 1순위는 지번주소 매칭(정확), 2순위는 정규화 단지명 매칭(주소 파싱 실패·부번 차이).
export function buildComplexes(regions, targets) {
  const complexes = {}, byName = {};
  const stats = {};
  for (const [region, entries] of Object.entries(regions)) {
    const target = targets[region] ?? { keys: new Set(), names: new Map() };
    let byAddr = 0, byNameHit = 0;
    for (const { code, spec } of entries) {
      if (!spec?.name) continue;
      const parsed = parseJibunAddr(spec.addr);
      const key = parsed ? `${region}|${parsed.dong}|${parsed.jibun}` : null;
      const norm = normalizeName(spec.name);
      const record = { code, ...spec };
      if (key && target.keys.has(key)) {
        if (!complexes[key]) byAddr += 1;
        complexes[key] = record;
      }
      // 단지명 색인은 주소가 맞은 단지도 함께 담는다 (전월세는 지번이 없어
      // 화면이 단지명으로만 찾는 경우가 있다).
      const tradedName = target.names.get(norm);
      if (tradedName && !byName[`${region}|${tradedName}`]) {
        byName[`${region}|${tradedName}`] = record;
        byNameHit += 1;
      }
    }
    stats[region] = {
      traded: target.names.size, listed: entries.length,
      matchedByAddr: byAddr, matchedByName: byNameHit,
    };
  }
  return { complexes, byName, stats };
}

// 실거래 파일에서 지역별 (동|지번) 키와 정규화 단지명을 모은다.
export function readTargets(dataDir = DATA_DIR) {
  const targets = {};
  for (const file of readdirSync(dataDir)) {
    if (!file.startsWith("trade-")) continue;
    const { region, items } = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
    const bucket = targets[region] ??= { keys: new Set(), names: new Map() };
    for (const r of items) {
      if (r.jibun) bucket.keys.add(`${region}|${r.dong}|${String(r.jibun).split("-")[0]}`);
      if (r.apt) bucket.names.set(normalizeName(r.apt), r.apt);
    }
  }
  return targets;
}

// ── API 호출 ────────────────────────────────────────────────

async function getJson(url, key) {
  url.searchParams.set("serviceKey", key);
  const res = await fetch(url, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (body.trimStart().startsWith("<")) {
    // 인증키 오류·미신청 API는 XML 봉투로 온다.
    const msg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(body)?.[1];
    throw new Error(msg ? `${msg} (API 활용신청 확인)` : "XML 응답 (JSON 미지원 또는 키 오류)");
  }
  const json = JSON.parse(body);
  const code = json?.response?.header?.resultCode;
  if (code && code !== "00" && code !== "000") {
    throw new Error(json?.response?.header?.resultMsg || `resultCode ${code}`);
  }
  return json?.response?.body ?? null;
}

const asArray = (items) => {
  if (!items) return [];
  const inner = Array.isArray(items) ? items : items.item;
  if (!inner) return [];
  return Array.isArray(inner) ? inner : [inner];
};

async function fetchAptList(sigunguCode, key) {
  const out = [];
  for (let pageNo = 1; pageNo <= 30; pageNo += 1) {
    const url = new URL(`${LIST_BASE}/getSigunguAptList3`);
    url.searchParams.set("sigunguCode", sigunguCode);
    url.searchParams.set("pageNo", String(pageNo));
    url.searchParams.set("numOfRows", "100");
    const body = await getJson(url, key);
    const items = asArray(body?.items);
    out.push(...items);
    const total = Number(body?.totalCount ?? out.length);
    if (!items.length || out.length >= total) break;
  }
  return out;
}

async function fetchSpec(kaptCode, key) {
  const call = async (op) => {
    const url = new URL(`${INFO_BASE}/${op}`);
    url.searchParams.set("kaptCode", kaptCode);
    return (await getJson(url, key))?.item ?? null;
  };
  const basic = await call("getAphusBassInfoV4");
  if (!basic) return null;
  // 상세(주차·엘리베이터·지하철)는 없는 단지도 있어 실패해도 기본정보는 살린다.
  const detail = await call("getAphusDtlInfoV4").catch(() => null);
  return pickSpec(basic, detail);
}

// ── 실행 ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Math.max(1, +args[limitArg + 1]) : Infinity;
  const force = args.includes("--force");
  const key = readServiceKey();
  if (!key) {
    console.error("MOLIT_SERVICE_KEY가 없습니다. env로 주거나 .dev.vars에 한 줄 추가하세요.");
    process.exit(1);
  }

  const targets = readTargets();
  const cached = !force && existsSync(KAPT_FILE)
    ? JSON.parse(readFileSync(KAPT_FILE, "utf8")).specs ?? {}
    : {};

  // 1단계: 시군구 단지 목록에서 실거래에 등장하는 단지만 추린다 (상세 조회 절약).
  const wanted = [];
  for (const [region, codes] of Object.entries(SIGUNGU)) {
    const names = targets[region]?.names ?? new Map();
    let list = [];
    for (const code of codes) {
      list = await fetchAptList(code, key).catch((error) => {
        console.error(`  단지목록 실패 ${region}/${code}: ${error.message}`);
        return [];
      });
      if (list.length) { console.log(`  ${region}: 시군구 ${code} → 단지 ${list.length}개`); break; }
    }
    for (const item of list) {
      const code = text(item.kaptCode), name = text(item.kaptName);
      if (code && name && names.has(normalizeName(name))) wanted.push({ region, code });
    }
  }
  const pending = wanted.filter(({ code }) => !cached[code]).slice(0, limit);
  console.log(`실거래 단지와 매칭된 K-apt 단지 ${wanted.length}개 · 신규 조회 ${pending.length}개`);

  // 2단계: 단지별 기본+상세 정보. 공공 API라 동시 3으로 얌전하게 돈다.
  let ok = 0, failed = 0;
  const queue = [...pending];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        const spec = await fetchSpec(job.code, key);
        if (!spec) throw new Error("기본정보 없음");
        cached[job.code] = spec;
        ok += 1;
      } catch (error) {
        failed += 1;
        console.error(`  실패 ${job.region}/${job.code}: ${error.message}`);
      }
    }
  }));

  // 3단계: 실거래 키에 붙여 저장.
  const regions = {};
  for (const { region, code } of wanted) {
    if (cached[code]) (regions[region] ??= []).push({ code, spec: cached[code] });
  }
  const { complexes, byName, stats } = buildComplexes(regions, targets);
  // 내용이 그대로면 generatedAt도 그대로 둔다 — 매번 타임스탬프만 바뀌면
  // estate-refresh.sh의 "변경 없음" 판정이 이 파일 때문에 늘 깨진다.
  const payload = { specs: cached, complexes, byName, stats };
  const prev = existsSync(KAPT_FILE) ? JSON.parse(readFileSync(KAPT_FILE, "utf8")) : null;
  const unchanged = prev && JSON.stringify({
    specs: prev.specs, complexes: prev.complexes, byName: prev.byName, stats: prev.stats,
  }) === JSON.stringify(payload);
  writeFileSync(KAPT_FILE, JSON.stringify({
    generatedAt: unchanged ? prev.generatedAt : new Date().toISOString(), ...payload,
  }));
  for (const [region, s] of Object.entries(stats)) {
    console.log(`  ${region}: 실거래 단지 ${s.traded}개 중 주소매칭 ${s.matchedByAddr} · 이름매칭 ${s.matchedByName}`);
  }
  console.log(`완료: ${ok}개 조회, ${failed}개 실패 → estate/data/kapt.json`);
  if (failed) process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
