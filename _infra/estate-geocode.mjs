#!/usr/bin/env node
// estate/data/의 매매 실거래에 등장하는 (지역·법정동·지번)을 VWorld 지오코더로
// 좌표 변환해 estate/data/geo.json에 저장하는 CLI. 리포가 공개라 키는 커밋하지
// 않고 .dev.vars의 VWORLD_KEY(또는 env)에서만 읽는다. 이미 변환된 지번은
// 건너뛰므로 데이터 갱신 후 다시 돌려도 새 단지만 추가 조회한다.
//
//   VWORLD_KEY=키 node _infra/estate-geocode.mjs [--force]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "estate", "data");
const GEO_FILE = join(DATA_DIR, "geo.json");

// 지번주소 조립용 시군구 명칭. 동탄구 미반영 지도가 있어 옛 화성시 표기를
// 폴백으로 함께 시도한다.
const REGION_ADDR = {
  dongtan: ["경기도 화성시 동탄구", "경기도 화성시"],
  giheung: ["경기도 용인시 기흥구"],
};

// 통근·환금성 기준점. 도로명주소는 공개된 주소다 (coord가 있으면 그 좌표를
// 그대로 쓰고 지오코딩을 건너뛴다 — 역명은 지번 검색이 애매해서 직접 지정).
// 동탄역은 매도 시 GTX 수요층 관점의 보조축 (실거주 축은 캠퍼스).
const REFS = [
  // 화성캠퍼스는 DSR타워(삼성전자로 1-1, DS 부문 R타워)로 고정 — 실제 통근
  // 목적지라 정문(삼성전자로 1)보다 동쪽으로 약 600m 더 정확하다.
  { id: "hwaseong-campus", label: "삼성 화성캠 DSR", coord: { lat: 37.22528, lng: 127.07024 } },
  { id: "giheung-campus", label: "삼성 기흥캠퍼스", road: "경기도 용인시 기흥구 삼성로 1" },
  { id: "dongtan-station", label: "동탄역 (GTX·SRT)", road: "경기도 화성시 동탄역로 151" },
  { id: "gucheong-station", label: "구성역 (GTX-A)", coord: { lat: 37.2996, lng: 127.1054 } },
];

// 지도에 깔 철도 노선. via의 기준점들을 순서대로 이은 폴리라인이 된다.
// 현재 지도 범위(동탄구·기흥구) 안의 GTX-A 구간은 동탄역~구성역 하나다.
const RAIL_LINES = {
  "gtx-a": { label: "GTX-A", color: "#d6336c", via: ["dongtan-station", "gucheong-station"] },
};

// 통근 셔틀 노선 (사용자 제공 UVIS BUS 캡처 기반). 정류장은 대부분 아파트
// 단지라 실거래 좌표(match=정확한 단지명)를 재사용하고, 단지가 아닌 정류장만
// addr(지오코딩)이나 ref(기존 기준점)로 좌표를 얻는다. 새 노선은 여기에 추가.
const SHUTTLE_ROUTES = {
  "h1-dsr-naru1": {
    label: "화성캠 H1 셔틀 (동탄나루1차)", color: "#0ca678",
    stops: [
      { name: "동탄월드반도유보라1차", addr: "경기도 화성시 반송동 442" },
      { name: "나루마을한화우림", match: "나루마을한화꿈에그린우림필유" },
      { name: "솔빛마을신도브래뉴", match: "솔빛마을신도브래뉴" },
      { name: "솔빛마을경남아너스빌", match: "솔빛마을경남아너스빌" },
      { name: "시범다은포스코더샵", match: "시범다은마을포스코더샵" },
      { name: "메타폴리스", addr: "경기도 화성시 반송동 96" },
      { name: "시범한빛동탄아이파크", match: "시범한빛마을동탄아이파크" },
      { name: "화성캠퍼스", ref: "hwaseong-campus" },
    ],
  },
  // 두 번째 노선(사용자 확인 주소 기반). 정류장 좌표는 도로명주소 지오코딩값을
  // 직접 지정(coord). 4번은 힐스테이트·호반5차 두 단지의 중간점.
  "dongtan-east": {
    label: "셔틀 2 (동탄역 동부)", color: "#7048e8",
    stops: [
      { name: "동탄우체국(노작로240)", coord: { lat: 37.20775, lng: 127.07813 } },
      { name: "동탄역", ref: "dongtan-station" },
      { name: "반도유보라·센트럴푸르지오", coord: { lat: 37.19903, lng: 127.11306 } },
      { name: "힐스테이트·호반5차", coord: { lat: 37.18469, lng: 127.12254 } },
    ],
  },
};

function readKey() {
  if (process.env.VWORLD_KEY?.trim()) return process.env.VWORLD_KEY.trim();
  const devVars = join(ROOT, ".dev.vars");
  if (existsSync(devVars)) {
    const match = /^VWORLD_KEY\s*=\s*(.+)$/m.exec(readFileSync(devVars, "utf8"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

// 단지명 → 대표 좌표. 실거래(trade) 파일에서 apt명과 지번을 모아, 이미
// 지오코딩된 geo.points에 있는 지번의 좌표를 그 단지의 좌표로 삼는다.
function buildAptCoordIndex(geo) {
  const index = new Map();
  for (const file of readdirSync(DATA_DIR)) {
    if (!file.startsWith("trade-")) continue;
    const { region, items } = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
    for (const r of items) {
      if (!r.jibun || index.has(r.apt)) continue;
      const pt = geo.points[`${region}|${r.dong}|${r.jibun}`];
      if (pt) index.set(r.apt, { lat: pt.lat, lng: pt.lng });
    }
  }
  return index;
}

async function vworldGeocode(key, address, type) {
  const u = new URL("https://api.vworld.kr/req/address");
  u.searchParams.set("service", "address");
  u.searchParams.set("request", "getcoord");
  u.searchParams.set("version", "2.0");
  u.searchParams.set("crs", "EPSG:4326");
  u.searchParams.set("type", type);
  u.searchParams.set("address", address);
  u.searchParams.set("key", key);
  const body = await (await fetch(u, { signal: AbortSignal.timeout(10000) })).json();
  const point = body?.response?.status === "OK" ? body.response.result?.point : null;
  return point ? { lat: +point.y, lng: +point.x } : null;
}

async function main() {
  const force = process.argv.includes("--force");
  const key = readKey();
  if (!key) {
    console.error("VWORLD_KEY가 없습니다. env로 주거나 .dev.vars에 한 줄 추가하세요.");
    process.exit(1);
  }

  const geo = !force && existsSync(GEO_FILE)
    ? JSON.parse(readFileSync(GEO_FILE, "utf8"))
    : { points: {}, refs: {} };

  // 매매 파일에서 고유 (지역|동|지번) 수집 (전월세는 API가 지번을 주지 않음 —
  // 화면에서 단지명으로 매매 좌표에 매칭한다)
  const targets = new Map();
  for (const file of readdirSync(DATA_DIR)) {
    if (!file.startsWith("trade-")) continue;
    const { region, items } = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
    for (const r of items) {
      if (r.jibun) targets.set(`${region}|${r.dong}|${r.jibun}`, { region, dong: r.dong, jibun: r.jibun });
    }
  }
  const pending = [...targets.entries()].filter(([id]) => !geo.points[id]);
  console.log(`지번 ${targets.size}개 중 신규 ${pending.length}개 변환`);

  let ok = 0, failed = 0;
  const queue = [...pending];
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const [id, t] = queue.shift();
      let point = null;
      for (const prefix of REGION_ADDR[t.region]) {
        point = await vworldGeocode(key, `${prefix} ${t.dong} ${t.jibun}`, "PARCEL").catch(() => null);
        if (point) break;
      }
      if (point) { geo.points[id] = point; ok += 1; }
      else { failed += 1; console.error(`  실패: ${id}`); }
    }
  }));

  for (const ref of REFS) {
    // coord 직접 지정 기준점은 우리가 확정한 값이라 매번 최신 좌표·라벨로 덮어쓴다.
    if (ref.coord) { geo.refs[ref.id] = { ...ref.coord, label: ref.label }; continue; }
    if (geo.refs[ref.id] && !force) continue;
    const point = await vworldGeocode(key, ref.road, "ROAD").catch(() => null);
    if (point) geo.refs[ref.id] = { ...point, label: ref.label };
    else console.error(`  기준점 실패: ${ref.label}`);
  }

  // 철도 노선 폴리라인을 기준점 좌표로 조립 (force와 무관하게 매번 갱신).
  geo.lines = {};
  for (const [id, line] of Object.entries(RAIL_LINES)) {
    const coords = line.via.map((v) => geo.refs[v]).filter(Boolean).map((r) => [r.lat, r.lng]);
    if (coords.length >= 2) geo.lines[id] = { label: line.label, color: line.color, coords };
  }

  // 셔틀 노선: 정류장 좌표를 match(단지명)→실거래 좌표, ref→기준점, addr→지오코딩
  // 순으로 얻는다. 각 정류장 {name, lat, lng}과 폴리라인 coords를 함께 저장한다.
  const aptCoord = buildAptCoordIndex(geo);
  geo.shuttles = {};
  for (const [id, route] of Object.entries(SHUTTLE_ROUTES)) {
    const stops = [];
    for (const s of route.stops) {
      let pt = null;
      if (s.coord) pt = s.coord;
      else if (s.match) pt = aptCoord.get(s.match) ?? null;
      else if (s.ref) pt = geo.refs[s.ref] ? { lat: geo.refs[s.ref].lat, lng: geo.refs[s.ref].lng } : null;
      else if (s.addr) pt = await vworldGeocode(key, s.addr, "PARCEL").catch(() => null);
      if (pt) stops.push({ name: s.name, lat: pt.lat, lng: pt.lng });
      else console.error(`  셔틀 정류장 좌표 실패: ${route.label} / ${s.name}`);
    }
    if (stops.length >= 2) {
      geo.shuttles[id] = { label: route.label, color: route.color, stops };
    }
  }

  geo.generatedAt = new Date().toISOString();
  writeFileSync(GEO_FILE, JSON.stringify(geo));
  console.log(`완료: 신규 ${ok}개, 실패 ${failed}개 → geo.json (총 ${Object.keys(geo.points).length}개 좌표)`);
  console.log("기준점:", Object.entries(geo.refs).map(([id, r]) => `${r.label} ${r.lat.toFixed(4)},${r.lng.toFixed(4)}`).join(" / "));
}

main();
