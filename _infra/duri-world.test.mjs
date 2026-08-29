// duri 세계 지도 데이터 검사.
//
// duri/data/world-countries.geojson 은 _infra/duri-world-geo.mjs 가 Natural Earth
// 에서 구워 낸 576KB 짜리 산출물이라 눈으로 훑을 수가 없다. 다시 구웠을 때
// **실제 여행지 좌표가 맞는 나라로 떨어지는지**를 여기서 지킨다 — 예전에 단순화를
// 세게 걸었다가 해운대·제주공항·싱가포르·뉴욕이 통째로 "해외 미상"이 된 적이 있다.
//
// 판정 알고리즘은 duri/index.html 안에 인라인으로 있다(그 화면은 외부 스크립트를
// 하나도 안 쓰는 단일 파일이다). 그래서 여기서는 같은 규칙 — 폴리곤 안이면 그 나라,
// 밖이면 SNAP_KM 안에서 가장 가까운 나라 — 을 나란히 두고 데이터를 검사한다.
// 두 값(SNAP_KM)이 어긋나면 이 테스트가 통과해도 화면이 다르게 동작하므로,
// index.html 의 SNAP_KM 을 바꾸면 여기도 같이 바꿔야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "duri/data/world-countries.geojson");
const SNAP_KM = 20; // index.html 의 SNAP_KM 과 같아야 한다

const raw = fs.readFileSync(FILE, "utf8");
const geo = JSON.parse(raw);
for (const f of geo.features) {
  f._polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const poly of f._polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
  }
  f._bbox = { minLng, minLat, maxLng, maxLat };
}

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
    if (!poly.length || !pointInRing(x, y, poly[0])) continue;
    let inHole = false;
    for (let k = 1; k < poly.length; k++) if (pointInRing(x, y, poly[k])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}
function segDist(px, py, ax, ay, bx, by, kx) {
  let dx = (bx - ax) * kx, dy = by - ay;
  const ex = (px - ax) * kx, ey = py - ay;
  if (dx || dy) {
    const t = Math.max(0, Math.min(1, (ex * dx + ey * dy) / (dx * dx + dy * dy)));
    dx = ex - t * dx; dy = ey - t * dy;
  } else { dx = ex; dy = ey; }
  return Math.hypot(dx, dy);
}
function countryOf(lat, lng) {
  const hit = geo.features.find((f) => pointInPolys(lng, lat, f._polys));
  if (hit) return hit.properties.name;
  const maxDeg = SNAP_KM / 111.32, kx = Math.cos(lat * Math.PI / 180) || 1;
  let best = null, bestD = maxDeg;
  for (const f of geo.features) {
    const b = f._bbox;
    if (lng < b.minLng - maxDeg / kx || lng > b.maxLng + maxDeg / kx ||
        lat < b.minLat - maxDeg || lat > b.maxLat + maxDeg) continue;
    for (const poly of f._polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
      const d = segDist(lng, lat, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1], kx);
      if (d < bestD) { bestD = d; best = f; }
    }
  }
  return best ? best.properties.name : null;
}

test("FeatureCollection 형태와 속성이 갖춰져 있다", () => {
  assert.equal(geo.type, "FeatureCollection");
  assert.ok(geo.features.length > 200, `나라가 너무 적다: ${geo.features.length}`);
  for (const f of geo.features) {
    assert.ok(f.properties.name, `이름 없는 나라: ${JSON.stringify(f.properties)}`);
    assert.ok(f.properties.en, `영문 이름 없음: ${f.properties.name}`);
    assert.ok(["Polygon", "MultiPolygon"].includes(f.geometry.type));
  }
  const en = geo.features.map((f) => f.properties.en);
  assert.equal(new Set(en).size, en.length, "영문 이름이 겹친다 — 지역 키로 못 쓴다");
});

test("이름은 한국어다 — 화면에 영문이 그대로 나가면 안 된다", () => {
  // 생성기의 KO 표에 없으면 영문이 그대로 name 으로 나간다. 그 누락을 여기서 잡는다.
  const english = geo.features.filter((f) => /^[\x00-\x7F]+$/.test(f.properties.name));
  assert.deepEqual(english.map((f) => f.properties.name), [], "한국어 이름이 없는 나라가 있다");
});

test("링은 닫혀 있고 최소 4점이다", () => {
  for (const f of geo.features) for (const poly of f._polys) for (const ring of poly) {
    assert.ok(ring.length >= 4, `${f.properties.name}: 점이 ${ring.length}개뿐`);
    const a = ring[0], b = ring[ring.length - 1];
    assert.ok(a[0] === b[0] && a[1] === b[1], `${f.properties.name}: 링이 닫히지 않았다`);
  }
});

test("남극은 빼 둔다 — 있으면 사람 사는 곳이 손톱만 해진다", () => {
  assert.ok(!geo.features.some((f) => f.properties.en === "Antarctica"));
  assert.ok(geo.features.every((f) => f._bbox.minLat > -60), "남극권 조각이 남아 있다");
});

test("작지만 실제로 가는 나라가 빠지지 않았다", () => {
  // 110m 데이터에는 이들이 통째로 없어서 50m 를 쓴다. 다시 구울 때 실수로
  // 110m 을 넣으면 여기서 걸린다.
  for (const n of ["싱가포르", "몰디브", "몰타", "모리셔스", "바레인", "홍콩", "마카오", "괌"]) {
    assert.ok(geo.features.some((f) => f.properties.name === n), `${n} 가 없다`);
  }
});

test("실제 여행지 좌표가 맞는 나라로 떨어진다", () => {
  const cases = [
    ["서울 시청", 37.5665, 126.9780, "대한민국"],
    ["제주공항", 33.5104, 126.4914, "대한민국"],       // 섬 + 해안
    ["부산 해운대", 35.1587, 129.1604, "대한민국"],     // 해안
    ["도쿄역", 35.6812, 139.7671, "일본"],
    ["오키나와 나하", 26.2124, 127.6809, "일본"],
    ["싱가포르 마리나베이", 1.2834, 103.8607, "싱가포르"], // 매립지
    ["방콕 왕궁", 13.7500, 100.4913, "태국"],
    ["다낭", 16.0544, 108.2022, "베트남"],
    ["세부", 10.3157, 123.8854, "필리핀"],
    ["발리 덴파사르", -8.6705, 115.2126, "인도네시아"],
    ["타이베이 101", 25.0340, 121.5645, "대만"],
    ["홍콩 센트럴", 22.2819, 114.1585, "홍콩"],
    ["마카오", 22.1987, 113.5439, "마카오"],
    ["괌 투몬", 13.5147, 144.8039, "괌"],
    ["몰디브 말레", 4.1755, 73.5093, "몰디브"],
    ["파리 에펠탑", 48.8584, 2.2945, "프랑스"],
    ["로마 콜로세움", 41.8902, 12.4922, "이탈리아"],
    ["런던 빅벤", 51.5007, -0.1246, "영국"],
    ["프라하", 50.0875, 14.4213, "체코"],
    ["뉴욕 타임스스퀘어", 40.7580, -73.9855, "미국"],   // 섬
    ["하와이 호놀룰루", 21.3069, -157.8583, "미국"],
    ["밴쿠버", 49.2827, -123.1207, "캐나다"],
    ["시드니 오페라하우스", -33.8568, 151.2153, "호주"],
    ["오클랜드", -36.8485, 174.7633, "뉴질랜드"],
    ["두바이", 25.2048, 55.2708, "아랍에미리트"],
    ["이스탄불", 41.0082, 28.9784, "튀르키예"],         // 해협
    ["몰타 발레타", 35.8989, 14.5146, "몰타"],
    ["울란바토르", 47.8864, 106.9057, "몽골"],
  ];
  const wrong = cases
    .map(([n, lat, lng, want]) => [n, countryOf(lat, lng), want])
    .filter(([, got, want]) => got !== want);
  assert.deepEqual(wrong, [], "엉뚱한 나라로 떨어진 좌표가 있다");
});

test("바다 한복판은 어느 나라에도 붙지 않는다", () => {
  assert.equal(countryOf(0, -150), null, "태평양 한복판이 어딘가에 붙었다");
  assert.equal(countryOf(-30, -10), null, "대서양 한복판이 어딘가에 붙었다");
});

test("파일이 감당할 만한 크기다", () => {
  const kb = raw.length / 1024;
  assert.ok(kb < 800, `너무 크다: ${kb.toFixed(0)}KB — 단순화가 풀렸는지 확인`);
});
