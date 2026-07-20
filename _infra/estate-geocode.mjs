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

// 통근·환금성 기준점. 도로명주소는 공개된 주소다.
// 동탄역은 매도 시 GTX 수요층 관점의 보조축 (실거주 축은 캠퍼스).
const REFS = [
  { id: "hwaseong-campus", label: "삼성 화성캠퍼스", road: "경기도 화성시 삼성전자로 1" },
  { id: "giheung-campus", label: "삼성 기흥캠퍼스", road: "경기도 용인시 기흥구 삼성로 1" },
  { id: "dongtan-station", label: "동탄역 (GTX·SRT)", road: "경기도 화성시 동탄역로 151" },
];

function readKey() {
  if (process.env.VWORLD_KEY?.trim()) return process.env.VWORLD_KEY.trim();
  const devVars = join(ROOT, ".dev.vars");
  if (existsSync(devVars)) {
    const match = /^VWORLD_KEY\s*=\s*(.+)$/m.exec(readFileSync(devVars, "utf8"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
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
    if (geo.refs[ref.id] && !force) continue;
    const point = await vworldGeocode(key, ref.road, "ROAD").catch(() => null);
    if (point) geo.refs[ref.id] = { ...point, label: ref.label };
    else console.error(`  기준점 실패: ${ref.label}`);
  }

  geo.generatedAt = new Date().toISOString();
  writeFileSync(GEO_FILE, JSON.stringify(geo));
  console.log(`완료: 신규 ${ok}개, 실패 ${failed}개 → geo.json (총 ${Object.keys(geo.points).length}개 좌표)`);
  console.log("기준점:", Object.entries(geo.refs).map(([id, r]) => `${r.label} ${r.lat.toFixed(4)},${r.lng.toFixed(4)}`).join(" / "));
}

main();
