#!/usr/bin/env node
// duri 세계 지도용 나라 경계 GeoJSON 생성기.
//
// 원본은 Natural Earth(퍼블릭 도메인)를 TopoJSON 으로 묶은 world-atlas 다.
// 리포에 의존성으로 넣지 않고, 필요할 때만 받아서 이 스크립트에 넘긴다:
//
//   npm pack world-atlas@2 && tar xzf world-atlas-2.0.2.tgz
//   node _infra/duri-world-geo.mjs package/countries-50m.json
//
// 50m 을 쓰는 이유: 110m 에는 싱가포르·몰디브·몰타·모리셔스·바레인처럼 작지만
// 실제로 가는 나라가 통째로 빠져 있다(177개국 vs 241개국). 대신 50m 원본은
// 8만 점이라 그대로 쓰면 1.6MB 가 넘어서, 여기서 Douglas-Peucker 로 줄인다.
// **작은 나라는 줄이지 않는다** — 단순화 허용오차를 그 링의 크기에 비례시켜
// (`eps = min(EPS, 지름 * 0.02)`) 싱가포르가 뭉개져 점-폴리곤 판정에서 빠지는
// 일을 막는다. 큰 나라만 실제로 깎인다.
//
// 산출물: duri/data/world-countries.geojson (WGS84, 좌표 소수 4자리)
//   properties: { iso, name(한국어), en }
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "duri/data/world-countries.geojson");
const APP = path.join(ROOT, "duri/index.html");
// 해안선을 이보다 세밀하게 둘 이유가 없다 — 화면은 나라 단위로만 칠하고,
// 판정은 폴리곤 밖 20km 까지 가까운 나라로 붙여 주기 때문이다(SNAP_KM).
// 실제로 EPS 를 0.01 까지 낮춰 봐도 뉴욕·해운대 같은 해안 지점은 여전히 폴리곤
// 밖이었다 — 원본(Natural Earth 50m) 해안선 자체가 그 정도라서, 정밀도를 올려
// 파일만 두 배가 됐다. 근접 판정이 답이고 이 값은 보기 좋을 만큼만 두면 된다.
const EPS = +(process.env.EPS ?? 0.08);   // 단순화 허용오차 상한(도)
const SMALL = +(process.env.SMALL ?? 0.02); // 링 지름 대비 허용오차 — 작은 나라는 원본에 가깝게
const ISLE = +(process.env.ISLE ?? 0.02);   // 이보다 작은 부속 섬은 버린다(도) — 제주·오아후는 남는다
const DIGITS = 4;                           // 좌표 소수 자릿수(약 11m — 나라 단위엔 충분)

// 사람이 살지 않거나 다른 나라 영토와 겹치는 조각. 지도에 그려도 아무도 안 가고,
// 남극권은 bbox 를 통째로 늘려 정작 사람이 사는 곳을 손톱만 하게 만든다.
const DROP = new Set([
  "Antarctica", "Fr. S. Antarctic Lands", "Heard I. and McDonald Is.",
  "S. Geo. and the Is.", "Siachen Glacier", "Ashmore and Cartier Is.",
  "Indian Ocean Ter.", "Br. Indian Ocean Ter.",
]);

// 화면에 뜰 이름은 한국어여야 한다(리포 관례 — 영문 이름은 en 에 남긴다).
const KO = {
  "Afghanistan": "아프가니스탄", "Åland": "올란드 제도", "Albania": "알바니아",
  "Algeria": "알제리", "American Samoa": "아메리칸사모아", "Andorra": "안도라",
  "Angola": "앙골라", "Anguilla": "앵귈라", "Antigua and Barb.": "앤티가 바부다",
  "Argentina": "아르헨티나", "Armenia": "아르메니아", "Aruba": "아루바",
  "Australia": "호주", "Austria": "오스트리아", "Azerbaijan": "아제르바이잔",
  "Bahamas": "바하마", "Bahrain": "바레인", "Bangladesh": "방글라데시",
  "Barbados": "바베이도스", "Belarus": "벨라루스", "Belgium": "벨기에",
  "Belize": "벨리즈", "Benin": "베냉", "Bermuda": "버뮤다", "Bhutan": "부탄",
  "Bolivia": "볼리비아", "Bosnia and Herz.": "보스니아 헤르체고비나",
  "Botswana": "보츠와나", "Brazil": "브라질", "British Virgin Is.": "영국령 버진아일랜드",
  "Brunei": "브루나이", "Bulgaria": "불가리아", "Burkina Faso": "부르키나파소",
  "Burundi": "부룬디", "Cabo Verde": "카보베르데", "Cambodia": "캄보디아",
  "Cameroon": "카메룬", "Canada": "캐나다", "Cayman Is.": "케이맨 제도",
  "Central African Rep.": "중앙아프리카 공화국", "Chad": "차드", "Chile": "칠레",
  "China": "중국", "Colombia": "콜롬비아", "Comoros": "코모로", "Congo": "콩고",
  "Cook Is.": "쿡 제도", "Costa Rica": "코스타리카", "Côte d'Ivoire": "코트디부아르",
  "Croatia": "크로아티아", "Cuba": "쿠바", "Curaçao": "퀴라소", "Cyprus": "키프로스",
  "Czechia": "체코", "Dem. Rep. Congo": "콩고 민주공화국", "Denmark": "덴마크",
  "Djibouti": "지부티", "Dominica": "도미니카 연방", "Dominican Rep.": "도미니카 공화국",
  "Ecuador": "에콰도르", "Egypt": "이집트", "El Salvador": "엘살바도르",
  "Eq. Guinea": "적도 기니", "Eritrea": "에리트레아", "Estonia": "에스토니아",
  "eSwatini": "에스와티니", "Ethiopia": "에티오피아", "Faeroe Is.": "페로 제도",
  "Falkland Is.": "포클랜드 제도", "Fiji": "피지", "Finland": "핀란드",
  "Fr. Polynesia": "프랑스령 폴리네시아", "France": "프랑스", "Gabon": "가봉",
  "Gambia": "감비아", "Georgia": "조지아", "Germany": "독일", "Ghana": "가나",
  "Greece": "그리스", "Greenland": "그린란드", "Grenada": "그레나다", "Guam": "괌",
  "Guatemala": "과테말라", "Guernsey": "건지섬", "Guinea": "기니",
  "Guinea-Bissau": "기니비사우", "Guyana": "가이아나", "Haiti": "아이티",
  "Honduras": "온두라스", "Hong Kong": "홍콩", "Hungary": "헝가리",
  "Iceland": "아이슬란드", "India": "인도", "Indonesia": "인도네시아", "Iran": "이란",
  "Iraq": "이라크", "Ireland": "아일랜드", "Isle of Man": "맨섬", "Israel": "이스라엘",
  "Italy": "이탈리아", "Jamaica": "자메이카", "Japan": "일본", "Jersey": "저지섬",
  "Jordan": "요르단", "Kazakhstan": "카자흐스탄", "Kenya": "케냐",
  "Kiribati": "키리바시", "Kosovo": "코소보", "Kuwait": "쿠웨이트",
  "Kyrgyzstan": "키르기스스탄", "Laos": "라오스", "Latvia": "라트비아",
  "Lebanon": "레바논", "Lesotho": "레소토", "Liberia": "라이베리아", "Libya": "리비아",
  "Liechtenstein": "리히텐슈타인", "Lithuania": "리투아니아", "Luxembourg": "룩셈부르크",
  "Macao": "마카오", "Macedonia": "북마케도니아", "Madagascar": "마다가스카르",
  "Malawi": "말라위", "Malaysia": "말레이시아", "Maldives": "몰디브", "Mali": "말리",
  "Malta": "몰타", "Marshall Is.": "마셜 제도", "Mauritania": "모리타니",
  "Mauritius": "모리셔스", "Mexico": "멕시코", "Micronesia": "미크로네시아",
  "Moldova": "몰도바", "Monaco": "모나코", "Mongolia": "몽골", "Montenegro": "몬테네그로",
  "Montserrat": "몬트세랫", "Morocco": "모로코", "Mozambique": "모잠비크",
  "Myanmar": "미얀마", "N. Cyprus": "북키프로스", "N. Mariana Is.": "북마리아나 제도",
  "Namibia": "나미비아", "Nauru": "나우루", "Nepal": "네팔", "Netherlands": "네덜란드",
  "New Caledonia": "누벨칼레도니", "New Zealand": "뉴질랜드", "Nicaragua": "니카라과",
  "Niger": "니제르", "Nigeria": "나이지리아", "Niue": "니우에", "Norfolk Island": "노퍽섬",
  "North Korea": "북한", "Norway": "노르웨이", "Oman": "오만", "Pakistan": "파키스탄",
  "Palau": "팔라우", "Palestine": "팔레스타인", "Panama": "파나마",
  "Papua New Guinea": "파푸아뉴기니", "Paraguay": "파라과이", "Peru": "페루",
  "Philippines": "필리핀", "Pitcairn Is.": "핏케언 제도", "Poland": "폴란드",
  "Portugal": "포르투갈", "Puerto Rico": "푸에르토리코", "Qatar": "카타르",
  "Romania": "루마니아", "Russia": "러시아", "Rwanda": "르완다", "S. Sudan": "남수단",
  "Saint Helena": "세인트헬레나", "Saint Lucia": "세인트루시아", "Samoa": "사모아",
  "San Marino": "산마리노", "São Tomé and Principe": "상투메 프린시페",
  "Saudi Arabia": "사우디아라비아", "Senegal": "세네갈", "Serbia": "세르비아",
  "Seychelles": "세이셸", "Sierra Leone": "시에라리온", "Singapore": "싱가포르",
  "Sint Maarten": "신트마르턴", "Slovakia": "슬로바키아", "Slovenia": "슬로베니아",
  "Solomon Is.": "솔로몬 제도", "Somalia": "소말리아", "Somaliland": "소말릴란드",
  "South Africa": "남아프리카 공화국", "South Korea": "대한민국", "Spain": "스페인",
  "Sri Lanka": "스리랑카", "St-Barthélemy": "생바르텔레미", "St-Martin": "생마르탱",
  "St. Kitts and Nevis": "세인트키츠 네비스", "St. Pierre and Miquelon": "생피에르 미클롱",
  "St. Vin. and Gren.": "세인트빈센트 그레나딘", "Sudan": "수단", "Suriname": "수리남",
  "Sweden": "스웨덴", "Switzerland": "스위스", "Syria": "시리아", "Taiwan": "대만",
  "Tajikistan": "타지키스탄", "Tanzania": "탄자니아", "Thailand": "태국",
  "Timor-Leste": "동티모르", "Togo": "토고", "Tonga": "통가",
  "Trinidad and Tobago": "트리니다드 토바고", "Tunisia": "튀니지", "Turkey": "튀르키예",
  "Turkmenistan": "투르크메니스탄", "Turks and Caicos Is.": "터크스 케이커스 제도",
  "U.S. Virgin Is.": "미국령 버진아일랜드", "Uganda": "우간다", "Ukraine": "우크라이나",
  "United Arab Emirates": "아랍에미리트", "United Kingdom": "영국",
  "United States of America": "미국", "Uruguay": "우루과이", "Uzbekistan": "우즈베키스탄",
  "Vanuatu": "바누아투", "Vatican": "바티칸", "Venezuela": "베네수엘라",
  "Vietnam": "베트남", "W. Sahara": "서사하라", "Wallis and Futuna Is.": "월리스 푸투나",
  "Yemen": "예멘", "Zambia": "잠비아", "Zimbabwe": "짐바브웨",
};

// ── TopoJSON 디코딩 (라이브러리 없이) ───────────────────────────
// 아크는 양자화된 델타 좌표다. 절대 좌표로 펴 두고, 음수 인덱스는 뒤집어 쓴다.
function decodeArcs(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  return topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
}
function ringOf(arcs, indexes) {
  const out = [];
  for (const idx of indexes) {
    const a = idx < 0 ? arcs[~idx].slice().reverse() : arcs[idx];
    // 이어 붙일 때 겹치는 첫 점은 버린다
    for (let i = out.length ? 1 : 0; i < a.length; i++) out.push(a[i]);
  }
  return out;
}
const polysOf = (arcs, geom) =>
  (geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [])
    .map((poly) => poly.map((ring) => ringOf(arcs, ring)));

// ── 날짜변경선 자르기 ───────────────────────────────────────────
// 러시아처럼 ±180 을 넘는 나라는 한 링 안에서 경도가 179.9 → -180 으로 튄다.
// 평면에 그대로 그리면 그 한 변이 **지도를 가로지르는 직선**이 된다(실제로 북위
// 65·69·71·71.5도에 네 줄이 그어졌다). 점-폴리곤 판정도 같이 망가진다.
// 링을 이어지게 편 뒤(unwrap) 경도 180도 간격의 띠마다 잘라 조각으로 나눈다.
function unwrapLng(ring) { // 튀는 지점마다 ±360 을 더해 경도를 이어 붙인다
  const out = [[...ring[0]]];
  for (let i = 1; i < ring.length; i++) {
    let x = ring[i][0];
    const prev = out[i - 1][0];
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    out.push([x, ring[i][1]]);
  }
  return out;
}
function clipHalf(ring, lim, keepBelow) { // 반평면으로 자르기(Sutherland–Hodgman)
  const inside = (p) => (keepBelow ? p[0] <= lim : p[0] >= lim);
  const out = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const ia = inside(a), ib = inside(b);
    if (ia !== ib) {
      const t = (lim - a[0]) / (b[0] - a[0]);
      out.push([lim, a[1] + t * (b[1] - a[1])]);
    }
    if (ib) out.push([...b]);
  }
  return out;
}
function splitAntimeridian(ring) { // 닫힌 링 → 닫힌 링 여러 개
  const open = ring.slice(0, -1);
  const un = unwrapLng(open);
  let min = Infinity, max = -Infinity;
  for (const p of un) { if (p[0] < min) min = p[0]; if (p[0] > max) max = p[0]; }
  if (min >= -180 && max <= 180) return [ring];  // 안 넘는다 — 그대로
  if (max - min >= 360) return [ring];           // 지구를 한 바퀴 — 이 방법으로는 못 나눈다
  const parts = [];
  for (let k = Math.floor((min + 180) / 360); k <= Math.floor((max + 180) / 360); k++) {
    const piece = clipHalf(clipHalf(un, 180 + 360 * k, true), -180 + 360 * k, false);
    if (piece.length < 3) continue;
    const moved = piece.map(([x, y]) => [x - 360 * k, y]); // 제자리로 되돌린다
    moved.push([...moved[0]]);
    parts.push(moved);
  }
  return parts.length ? parts : [ring];
}

// ── 단순화 (Douglas-Peucker) ────────────────────────────────────
function perpSq(p, a, b) {
  let dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx || dy) {
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    if (t > 1) { dx = p[0] - b[0]; dy = p[1] - b[1]; }
    else if (t > 0) { dx = p[0] - (a[0] + t * dx); dy = p[1] - (a[1] + t * dy); }
    else { dx = p[0] - a[0]; dy = p[1] - a[1]; }
  } else { dx = p[0] - a[0]; dy = p[1] - a[1]; }
  return dx * dx + dy * dy;
}
function dp(pts, epsSq) {
  if (pts.length < 3) return pts;
  let far = 0, best = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpSq(pts[i], pts[0], pts[pts.length - 1]);
    if (d > best) { best = d; far = i; }
  }
  if (best <= epsSq) return [pts[0], pts[pts.length - 1]];
  return [...dp(pts.slice(0, far + 1), epsSq).slice(0, -1), ...dp(pts.slice(far), epsSq)];
}
function simplifyRing(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  // 작은 링은 거의 손대지 않는다 — 싱가포르(0.3°)를 EPS(0.08°)로 깎으면
  // 사각형 하나로 뭉개져서 그 안에 찍힌 사진이 판정에서 빠진다.
  const eps = Math.min(EPS, span * SMALL);
  const open = ring.slice(0, -1);
  let out = dp([...open, open[0]], eps * eps);
  out = out.map(([x, y]) => [+x.toFixed(DIGITS), +y.toFixed(DIGITS)]);
  const dedup = out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
  if (dedup.length < 4) return null; // 닫힌 링이 되려면 최소 4점
  const first = dedup[0], last = dedup[dedup.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) dedup.push([first[0], first[1]]);
  return { ring: dedup, span };
}

function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("사용법: node _infra/duri-world-geo.mjs <countries-50m.json>");
    process.exit(1);
  }
  const topo = JSON.parse(fs.readFileSync(src, "utf8"));
  const arcs = decodeArcs(topo);
  const features = [];
  const missing = [];
  let points = 0;

  for (const geom of topo.objects.countries.geometries) {
    const en = geom.properties?.name;
    if (!en || DROP.has(en)) continue;
    const ko = KO[en];
    if (!ko) missing.push(en);

    const polys = [];
    for (const poly of polysOf(arcs, geom)) {
      // 외곽이 날짜변경선을 넘으면 조각으로 나눠 각각을 하나의 폴리곤으로 둔다.
      // 이 데이터에는 구멍이 하나도 없어(생성 시 확인) 구멍 재배치는 필요 없다 —
      // 구멍이 생기면 자르지 않고 그대로 딸려 보낸다.
      const outers = splitAntimeridian(poly[0]);
      for (const outer of outers) {
        const rings = [];
        for (const raw of [outer, ...poly.slice(1)]) {
          const s = simplifyRing(raw);
          if (!s) { if (!rings.length) break; continue; } // 외곽이 죽으면 이 조각은 버린다
          rings.push(s.ring);
        }
        if (rings.length) polys.push({ rings, span: spanOf(rings[0]) });
      }
    }
    if (!polys.length) continue;
    // 아주 작은 부속 섬은 뺀다 — 나라마다 제일 큰 조각은 반드시 남긴다(섬나라 보호).
    polys.sort((a, b) => b.span - a.span);
    const kept = polys.filter((p, i) => i === 0 || p.span >= ISLE);
    const coords = kept.map((p) => p.rings);
    for (const p of kept) for (const r of p.rings) points += r.length;

    features.push({
      type: "Feature",
      properties: { iso: geom.id || "", name: ko || en, en },
      geometry: coords.length === 1
        ? { type: "Polygon", coordinates: coords[0] }
        : { type: "MultiPolygon", coordinates: coords },
    });
  }

  features.sort((a, b) => a.properties.en.localeCompare(b.properties.en));
  const json = JSON.stringify({ type: "FeatureCollection", features });
  fs.writeFileSync(OUT, json + "\n");

  // 앱이 부르는 주소의 ?v= 를 새 내용 해시로 갈아 끼운다. 이걸 안 하면 폰은
  // force-cache + 30일 캐시로 **옛 파일을 계속 쓴다** — 러시아 가로줄을 고쳐
  // 배포하고도 실기기에서는 그대로였던 적이 있다(코드만 새것, 데이터는 옛것).
  const stamp = stampApp();

  if (missing.length) console.warn("한국어 이름 없음(영문 그대로 나감):", missing.join(", "));
  const kb = (json.length / 1024).toFixed(0);
  console.log(`${path.relative(ROOT, OUT)} — 나라 ${features.length}개, 좌표 ${points}점, ${kb}KB`);
  console.log(`${path.relative(ROOT, APP)} — 캐시 버전 ?v=${stamp}`);
}

export const fileStamp = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 8);

function stampApp() {
  const stamp = fileStamp(OUT);
  const app = fs.readFileSync(APP, "utf8");
  const re = /(file: "data\/world-countries\.geojson\?v=)[0-9a-f]{8}(")/;
  if (!re.test(app)) throw new Error(`${path.relative(ROOT, APP)} 에서 ?v= 자리를 못 찾았다`);
  fs.writeFileSync(APP, app.replace(re, `$1${stamp}$2`));
  return stamp;
}
function spanOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return Math.max(maxX - minX, maxY - minY);
}
main();
