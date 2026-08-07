import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGUNGU, normalizeName, parseJibunAddr, pickSpec, buildComplexes, readTargets,
} from "./estate-kapt.mjs";

test("단지명 정규화가 공백·마침표·괄호·'아파트' 꼬리표를 흡수한다", () => {
  assert.equal(normalizeName("롯데캐슬 알바트로스"), normalizeName("롯데캐슬알바트로스아파트"));
  assert.equal(normalizeName("레이크반도유보라아이비파크9.0"), normalizeName("레이크반도유보라아이비파크 9.0"));
  assert.equal(normalizeName("동탄역 시범한화 꿈에그린(프레스티지)"), "동탄역시범한화꿈에그린");
  assert.notEqual(normalizeName("호반베르디움22단지"), normalizeName("호반베르디움21단지"));
});

test("지번주소에서 법정동·본번을 뽑고 부번은 버린다", () => {
  assert.deepEqual(parseJibunAddr("경기도 화성시 동탄구 장지동 1009"), { dong: "장지동", jibun: "1009" });
  assert.deepEqual(parseJibunAddr("경기도 용인시 기흥구 신갈동 12-3"), { dong: "신갈동", jibun: "12" });
  assert.deepEqual(parseJibunAddr("경기도 화성시 반송동 96번지"), { dong: "반송동", jibun: "96" });
});

test("법정동을 못 찾는 주소는 매칭에 쓰지 않는다", () => {
  assert.equal(parseJibunAddr("경기도 화성시 동탄역로 151"), null);
  assert.equal(parseJibunAddr("경기도 화성시 산척동 산 12"), null);
  assert.equal(parseJibunAddr(""), null);
  assert.equal(parseJibunAddr(null), null);
});

const BASIC = {
  kaptName: "동탄역시범더샵센트럴시티", kaptUsedate: "20150630", kaptdaCnt: "874",
  kaptDongCnt: "9", kaptBcompany: "포스코건설", kaptTopFloor: "29",
  codeHeatNm: "지역난방", codeHallNm: "계단식", kaptAddr: "경기도 화성시 동탄구 청계동 1120",
};
const DETAIL = {
  kaptdPcnt: "120", kaptdPcntu: "1,050", kaptdEcnt: "18",
  subwayLine: "SRT", subwayStation: "동탄역", kaptdWtimesub: "5분이내",
};

test("기본·상세 응답에서 화면에 쓸 필드만 추리고 세대당 주차를 계산한다", () => {
  const spec = pickSpec(BASIC, DETAIL);
  assert.equal(spec.units, 874);
  assert.equal(spec.built, 2015);
  assert.equal(spec.builder, "포스코건설");
  assert.equal(spec.parking, 1170);
  assert.equal(spec.parkingPer, 1.34); // 1170 / 874
  assert.equal(spec.subway, "SRT 동탄역");
  assert.equal(spec.subwayWalk, "5분이내");
});

test("상세 정보가 없어도 기본 정보만으로 스펙을 만든다", () => {
  const spec = pickSpec(BASIC, null);
  assert.equal(spec.units, 874);
  assert.equal(spec.parking, null);
  assert.equal(spec.parkingPer, null);
  assert.equal(spec.subway, null);
});

test("빈 값과 '-' 는 null로 정리한다", () => {
  const spec = pickSpec({ kaptName: "무명", kaptBcompany: "-", kaptdaCnt: "" }, {});
  assert.equal(spec.builder, null);
  assert.equal(spec.units, null);
});

const TARGETS = {
  dongtan: {
    keys: new Set(["dongtan|청계동|1120", "dongtan|반송동|96"]),
    names: new Map([
      ["동탄역시범더샵센트럴시티", "동탄역시범더샵센트럴시티"],
      ["메타폴리스", "메타폴리스"],
    ]),
  },
};

test("지번주소가 실거래 키와 맞으면 (지역|동|지번)으로 붙인다", () => {
  const spec = pickSpec(BASIC, DETAIL);
  const { complexes, stats } = buildComplexes(
    { dongtan: [{ code: "A13001", spec }] }, TARGETS);
  assert.equal(complexes["dongtan|청계동|1120"].code, "A13001");
  assert.equal(complexes["dongtan|청계동|1120"].units, 874);
  assert.equal(stats.dongtan.matchedByAddr, 1);
});

test("단지명 색인으로도 찾을 수 있다 (지번 없는 전월세용)", () => {
  const spec = pickSpec({ ...BASIC, kaptName: "메타폴리스", kaptAddr: "경기도 화성시 반송동 96" }, DETAIL);
  const { byName } = buildComplexes({ dongtan: [{ code: "A13002", spec }] }, TARGETS);
  assert.equal(byName["dongtan|메타폴리스"].code, "A13002");
});

test("실거래에 없는 단지는 버린다", () => {
  const spec = pickSpec(
    { ...BASIC, kaptName: "다른시아파트", kaptAddr: "경기도 수원시 영통구 원천동 1" }, DETAIL);
  const { complexes, byName, stats } = buildComplexes(
    { dongtan: [{ code: "A99999", spec }] }, TARGETS);
  assert.deepEqual(complexes, {});
  assert.deepEqual(byName, {});
  assert.equal(stats.dongtan.matchedByAddr, 0);
});

test("실거래 파일에서 (동|지번) 키와 단지명을 모은다", () => {
  const dir = mkdtempSync(join(tmpdir(), "kapt-"));
  writeFileSync(join(dir, "trade-dongtan-202606.json"), JSON.stringify({
    region: "dongtan",
    items: [
      { apt: "롯데캐슬 알바트로스", dong: "청계동", jibun: "541" },
      { apt: "푸른마을두산위브", dong: "능동", jibun: "1137-2" },
    ],
  }));
  writeFileSync(join(dir, "rent-dongtan-202606.json"), JSON.stringify({ region: "dongtan", items: [] }));
  const targets = readTargets(dir);
  assert.ok(targets.dongtan.keys.has("dongtan|청계동|541"));
  assert.ok(targets.dongtan.keys.has("dongtan|능동|1137"), "부번은 떼고 본번으로 담는다");
  assert.equal(targets.dongtan.names.get(normalizeName("롯데캐슬알바트로스아파트")), "롯데캐슬 알바트로스");
});

test("화성시는 동탄구 신코드를 먼저 시도하고 폐지된 통합코드로 폴백한다", () => {
  assert.deepEqual(SIGUNGU.dongtan, ["41597", "41590"]);
  assert.deepEqual(SIGUNGU.giheung, ["41463"]);
});
