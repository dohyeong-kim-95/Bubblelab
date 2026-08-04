import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSTELLATIONS, SEGMENTS, STARS, angularSeparation, dominantConstellation,
  equatorialToHorizontal, horizontalToEquatorial, lst, makeProjection, starById, starsInView,
} from "../util/stars/sky.js";

const sep = (a, b) => {
  const A = starById(a), B = starById(b);
  return angularSeparation(A.ra, A.dec, B.ra, B.dec);
};

// ── 데이터 무결성 ─────────────────────────────────────────────
test("별 id는 겹치지 않고 좌표·등급이 범위 안에 있다", () => {
  const ids = new Set();
  for (const star of STARS) {
    assert.ok(!ids.has(star.id), `id 중복: ${star.id}`);
    ids.add(star.id);
    assert.ok(star.ra >= 0 && star.ra < 24, `${star.id} 적경이 범위 밖: ${star.ra}`);
    assert.ok(star.dec >= -90 && star.dec <= 90, `${star.id} 적위가 범위 밖: ${star.dec}`);
    assert.ok(star.mag >= -2 && star.mag <= 5.5, `${star.id} 등급이 범위 밖: ${star.mag}`);
  }
  assert.ok(STARS.length > 200, "별이 너무 적으면 하늘 대부분이 빈다");
});

test("별자리 선은 모두 실재하는 별을 가리킨다", () => {
  // 선언한 쌍 수와 해석된 선 수가 다르면 오타난 바이어 기호가 조용히 버려진 것이다.
  const declared = CONSTELLATIONS.reduce((n, c) => n + c.lines.split(",").filter(Boolean).length, 0);
  assert.equal(SEGMENTS.length, declared, "가리키는 별이 없는 선이 있다");
  for (const s of SEGMENTS) assert.notEqual(s.a.id, s.b.id, `자기 자신을 잇는 선: ${s.a.id}`);
});

// 좌표 오타는 그 별을 별자리 밖으로 튕겨낸다 — 산포와 선 길이로 잡는다.
// 바다뱀·에리다누스처럼 실제로 하늘을 가로지르는 별자리가 있어 상한은 넉넉히 잡되,
// 한 자리 숫자를 잘못 친 수준(수십 도 이동)은 반드시 걸리게 한다.
test("별자리는 하늘에서 뭉쳐 있다 (좌표 오타 탐지)", () => {
  for (const con of CONSTELLATIONS) {
    const stars = STARS.filter((s) => s.con === con.id);
    let widest = 0;
    for (const a of stars) for (const b of stars) {
      widest = Math.max(widest, angularSeparation(a.ra, a.dec, b.ra, b.dec));
    }
    assert.ok(widest <= 90, `${con.ko}(${con.id})의 별이 ${widest.toFixed(1)}° 흩어져 있다`);
  }
});

test("별자리 선이 지나치게 길지 않다 (좌표 오타 탐지)", () => {
  for (const s of SEGMENTS) {
    const d = angularSeparation(s.a.ra, s.a.dec, s.b.ra, s.b.dec);
    assert.ok(d <= 40, `${s.con} ${s.a.bayer}-${s.b.bayer} 선이 ${d.toFixed(1)}°로 너무 길다`);
  }
});

// 데이터가 실제 하늘과 맞는지 — 널리 알려진 각거리로 대조한다.
// 좌표를 옮겨 적다 틀리면 이 값들이 먼저 어긋난다.
test("밝은 별 사이 각거리가 실제 하늘과 맞는다", () => {
  const known = [
    ["UMa:α", "UMa:β", 5.37, "두베–메라크"],
    ["Ori:δ", "Ori:ζ", 2.73, "민타카–알니타크"],
    ["CMa:α", "Ori:α", 27.1, "시리우스–베텔게우스"],
    ["Lyr:α", "Aql:α", 34.2, "직녀–견우"],
    ["Lyr:α", "Cyg:α", 23.9, "직녀–데네브"],
    ["UMi:α", "UMa:α", 28.6, "북극성–두베"],
    ["Gem:α", "Gem:β", 4.5, "카스토르–폴룩스"],
    ["Ori:α", "Ori:β", 18.6, "베텔게우스–리겔"],
    ["Boo:α", "Vir:α", 32.8, "아르크투루스–스피카"],
  ];
  for (const [a, b, expected, label] of known) {
    const got = sep(a, b);
    assert.ok(Math.abs(got - expected) < 0.6, `${label}: ${got.toFixed(2)}° (알려진 값 ${expected}°)`);
  }
});

// ── 좌표 변환 ─────────────────────────────────────────────────
const SEOUL = { lat: 37.5665, lon: 126.978 };

test("북극성의 고도는 관측지의 위도와 같다 (시각과 무관)", () => {
  const polaris = starById("UMi:α");
  for (const iso of ["2026-01-01T12:00:00Z", "2026-06-15T03:00:00Z", "2026-11-30T19:00:00Z"]) {
    for (const lat of [37.5665, 0.0, 55.0]) {
      const { alt, az } = equatorialToHorizontal(
        polaris.ra, polaris.dec, lat, SEOUL.lon, new Date(iso));
      // 북극성은 천구 북극에서 0.74° 떨어져 있다 — 그만큼의 오차를 허용한다.
      assert.ok(Math.abs(alt - lat) < 0.8, `위도 ${lat}에서 북극성 고도 ${alt.toFixed(2)}°`);
      if (lat > 5) {
        const fromNorth = Math.min(az, 360 - az);
        assert.ok(fromNorth < 2, `북극성이 북쪽(0°)이 아니라 ${az.toFixed(1)}°에 있다`);
      }
    }
  }
});

test("천정을 겨누면 적위는 위도, 적경은 지방항성시가 된다", () => {
  const date = new Date("2026-08-04T12:34:56Z");
  const { ra, dec } = horizontalToEquatorial(90, 0, SEOUL.lat, SEOUL.lon, date);
  assert.ok(Math.abs(dec - SEOUL.lat) < 1e-6, `천정 적위 ${dec}`);
  assert.ok(Math.abs(ra - lst(date, SEOUL.lon) / 15) < 1e-6, `천정 적경 ${ra}`);
});

test("적도좌표 ↔ 지평좌표 왕복 변환이 제자리로 돌아온다", () => {
  const date = new Date("2026-03-21T15:00:00Z");
  for (const [ra, dec] of [[5.6, 0], [18.6, 38.8], [2.5, 89.3], [12.4, -63.1], [23.9, -17.9]]) {
    const h = equatorialToHorizontal(ra, dec, SEOUL.lat, SEOUL.lon, date);
    const back = horizontalToEquatorial(h.alt, h.az, SEOUL.lat, SEOUL.lon, date);
    assert.ok(angularSeparation(ra, dec, back.ra, back.dec) < 1e-6,
      `왕복 오차: ${ra},${dec} → ${back.ra},${back.dec}`);
  }
});

test("지평선 아래를 겨누면 그 방향의 하늘이 나온다 (땅을 찍어도 별자리가 있다)", () => {
  // 이 토이의 전제 — "아무 데나" 찍어도 그 방향의 천구를 계산한다.
  const date = new Date("2026-08-04T12:00:00Z");
  const down = horizontalToEquatorial(-70, 180, SEOUL.lat, SEOUL.lon, date);
  assert.ok(down.dec < 0, `발밑 방향인데 적위가 ${down.dec}`);
  const back = equatorialToHorizontal(down.ra, down.dec, SEOUL.lat, SEOUL.lon, date);
  assert.ok(Math.abs(back.alt + 70) < 1e-6);
});

// ── 시야와 별자리 판정 ────────────────────────────────────────
test("겨눈 방향의 별자리를 고른다", () => {
  const cases = [
    [5.60, -1.2, "Ori"],    // 오리온 벨트
    [11.9, 55.0, "UMa"],    // 북두칠성 한가운데
    [0.7, 59.0, "Cas"],     // 카시오페이아 W
    [16.6, -26.0, "Sco"],   // 전갈 심장
    [20.4, 40.0, "Cyg"],    // 백조 가슴
  ];
  for (const [ra, dec, expected] of cases) {
    const found = dominantConstellation(ra, dec, 25);
    assert.equal(found?.id, expected, `${ra}h ${dec}° → ${found?.id ?? "없음"}`);
  }
});

test("시야 반경 밖의 별은 들어오지 않는다", () => {
  const inView = starsInView(5.6, -1.2, 10);
  assert.ok(inView.length > 3, "오리온 벨트 주변인데 별이 없다");
  for (const s of inView) assert.ok(angularSeparation(5.6, -1.2, s.ra, s.dec) <= 10);
  assert.ok(!inView.some((s) => s.id === "UMi:α"), "북극성이 오리온 시야에 들어왔다");
});

// ── 투영 ──────────────────────────────────────────────────────
test("투영은 중심을 원점에 두고 좌우·상하를 뒤집지 않는다", () => {
  const project = makeProjection(6.0, 0);
  const center = project(6.0, 0);
  assert.ok(Math.hypot(center.x, center.y) < 1e-9, "중심이 원점이 아니다");
  // 적경이 커지는 쪽(동쪽)은 화면 오른쪽, 적위가 커지는 쪽(북쪽)은 화면 위쪽
  assert.ok(project(6.5, 0).x > 0, "동쪽이 오른쪽이 아니다");
  assert.ok(project(6.0, 10).y > 0, "북쪽이 위쪽이 아니다");
  // 반대편 하늘은 그리지 않는다
  assert.equal(project(18.0, 0), null);
});

test("투영은 별자리 모양을 유지한다 (오리온 벨트는 거의 일직선)", () => {
  const project = makeProjection(5.6, -1.2);
  const belt = ["Ori:δ", "Ori:ε", "Ori:ζ"].map((id) => {
    const s = starById(id);
    return project(s.ra, s.dec);
  });
  // 세 점이 이루는 삼각형 넓이가 거의 0이어야 한다(일직선)
  const area = Math.abs((belt[1].x - belt[0].x) * (belt[2].y - belt[0].y)
    - (belt[2].x - belt[0].x) * (belt[1].y - belt[0].y)) / 2;
  assert.ok(area < 1e-4, `벨트가 일직선이 아니다 (넓이 ${area})`);
});
