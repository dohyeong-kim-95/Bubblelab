// 사진 좌표 → 지역 이름(한국이면 "시도 시군구", 밖이면 나라). 당이가 "어디서 찍었는지" 를 읽게 한다.
//
// 앱 지도(duri/index.html 의 pointInRing·pointInPolys·sggOfPoint)와 같은 판정, 같은 geojson
// (duri/data) 이다. install.sh 가 설치 폴더의 data/ 로 복사하고, 리포에서 돌 땐 duri/data 를 읽는다.
// 파일이 없으면 이름 없이(null) — 당이는 그냥 "사진" 으로 읽는다. 외부 API 는 쓰지 않는다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIRS = [fileURLToPath(new URL("./data/", import.meta.url)), fileURLToPath(new URL("../../duri/data/", import.meta.url))];

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolys(x, y, polys) {
  for (const poly of polys) {
    if (!poly.length || !pointInRing(x, y, poly[0])) continue; // 외곽 안?
    let inHole = false;
    for (let k = 1; k < poly.length; k++) if (pointInRing(x, y, poly[k])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

// 나라 폴리곤은 무거워서(233개 3만 점) bbox 로 먼저 거른다 — 판정은 그대로, 속도만 는다.
function load(file, name) {
  if (!existsSync(file)) return null;
  let geo;
  try { geo = JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
  return (geo.features ?? []).map((f) => {
    const g = f.geometry ?? {};
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const p of polys) for (const [x, y] of p[0] ?? []) {
      if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
      if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
    }
    return { name: name(f.properties ?? {}), polys, minLng, minLat, maxLng, maxLat };
  }).filter((f) => f.name && f.polys.length);
}

/** place(lat, lng) → "서울특별시 성동구" | "일본" | null. geojson 은 처음 부를 때 한 번 읽는다. */
export function createPlaces(dirs = DEFAULT_DIRS) {
  let maps = null;
  const init = () => {
    const dir = dirs.find((d) => existsSync(join(d, "kr-sgg.geojson"))) ?? dirs[0];
    maps = [
      load(join(dir, "kr-sgg.geojson"), (p) => p.sggnm && `${p.sidonm ? `${p.sidonm} ` : ""}${p.sggnm}`),
      load(join(dir, "world-countries.geojson"), (p) => p.name),
    ].filter(Boolean);
  };
  return (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (!maps) init();
    for (const feats of maps) { // 한국 시군구가 먼저 — 맞으면 나라는 안 본다
      for (const f of feats) {
        if (lng < f.minLng || lng > f.maxLng || lat < f.minLat || lat > f.maxLat) continue;
        if (pointInPolys(lng, lat, f.polys)) return f.name;
      }
    }
    return null;
  };
}
