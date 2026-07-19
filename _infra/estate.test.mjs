import test from "node:test";
import assert from "node:assert/strict";
import { parseDealsXml, validateDealsQuery, REGIONS, handleEstateDeals } from "./estate.js";
import { monthsBack, shouldFetch } from "./estate-import.mjs";

const TRADE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items>
<item><aptNm>동탄역시범더샵센트럴시티</aptNm><buildYear>2015</buildYear>
<cdealType> </cdealType><dealAmount> 82,500</dealAmount><dealDay>3</dealDay>
<dealMonth>6</dealMonth><dealYear>2026</dealYear><dealingGbn>중개거래</dealingGbn>
<excluUseAr>84.9</excluUseAr><floor>21</floor><jibun>1120</jibun><umdNm>청계동</umdNm></item>
<item><aptNm>시범한빛마을</aptNm><buildYear>2007</buildYear>
<cdealType>O</cdealType><dealAmount>45,000</dealAmount><dealDay>15</dealDay>
<dealMonth>6</dealMonth><dealYear>2026</dealYear><dealingGbn>직거래</dealingGbn>
<excluUseAr>59.98</excluUseAr><floor>7</floor><jibun>101</jibun><umdNm>반송동</umdNm></item>
</items><numOfRows>1500</numOfRows><pageNo>1</pageNo><totalCount>2</totalCount></body></response>`;

const RENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items>
<item><aptNm>힐스테이트기흥</aptNm><buildYear>2018</buildYear><contractType>갱신</contractType>
<dealDay>9</dealDay><dealMonth>5</dealMonth><dealYear>2026</dealYear>
<deposit>52,000</deposit><monthlyRent>0</monthlyRent>
<excluUseAr>84.97</excluUseAr><floor>12</floor><umdNm>신갈동</umdNm></item>
</items><numOfRows>1500</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount></body></response>`;

test("매매 XML을 만원 정수·ISO 날짜로 파싱하고 해제·직거래를 표시한다", () => {
  const { total, items } = parseDealsXml(TRADE_XML, "trade");
  assert.equal(total, 2);
  assert.deepEqual(items[0], {
    apt: "동탄역시범더샵센트럴시티", dong: "청계동", jibun: "1120",
    amt: 82500, area: 84.9, floor: 21, built: 2015,
    date: "2026-06-03", canceled: false, direct: false,
  });
  assert.equal(items[1].canceled, true);
  assert.equal(items[1].direct, true);
  assert.equal(items[1].amt, 45000);
});

test("전월세 XML은 보증금·월세·갱신 여부를 담는다", () => {
  const { items } = parseDealsXml(RENT_XML, "rent");
  assert.deepEqual(items[0], {
    apt: "힐스테이트기흥", dong: "신갈동", dep: 52000, rent: 0,
    area: 84.97, floor: 12, built: 2018, date: "2026-05-09", renewal: true,
  });
});

test("data.go.kr 오류 봉투와 resultCode 오류를 error로 돌려준다", () => {
  const auth = `<OpenAPI_ServiceResponse><cmmMsgHeader>
  <returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>
  <returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
  assert.equal(parseDealsXml(auth, "trade").error, "SERVICE_KEY_IS_NOT_REGISTERED_ERROR");
  const failed = `<response><header><resultCode>10</resultCode>
  <resultMsg>잘못된 요청 파라메터 에러</resultMsg></header></response>`;
  assert.equal(parseDealsXml(failed, "trade").error, "잘못된 요청 파라메터 에러");
});

test("쿼리 검증: 허용된 type·region·기간만 통과한다", () => {
  const now = new Date("2026-07-19T00:00:00+09:00");
  const query = (entries) => validateDealsQuery(new URLSearchParams(entries), now);
  assert.deepEqual(query({ type: "trade", region: "hwaseong", ym: "202607" }),
    { type: "trade", region: "hwaseong", ym: "202607" });
  assert.ok(query({ type: "sale", region: "hwaseong", ym: "202607" }).error);
  assert.ok(query({ type: "trade", region: "seoul", ym: "202607" }).error);
  assert.ok(query({ type: "trade", region: "hwaseong", ym: "202608" }).error, "미래 월 거절");
  assert.ok(query({ type: "trade", region: "hwaseong", ym: "200512" }).error, "너무 오래된 월 거절");
  assert.ok(query({ type: "trade", region: "giheung", ym: "2026-07" }).error);
});

test("지역 허용 목록은 화성시·기흥구 법정동코드다", () => {
  assert.equal(REGIONS.get("hwaseong").lawd, "41590");
  assert.equal(REGIONS.get("giheung").lawd, "41463");
});

test("인증키 미설정이면 not-configured JSON을 준다", async () => {
  const url = new URL("https://estate.bubblelab.dev/_estate/deals?type=trade&region=hwaseong&ym=202601");
  const response = await handleEstateDeals(new Request(url), {}, url);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "not-configured" });
});

test("가져오기 CLI: 최근 3개월은 늘 다시 받고, 그 전은 파일이 있으면 건너뛴다", () => {
  assert.deepEqual(monthsBack(3, "202607"), ["202605", "202606", "202607"]);
  assert.equal(shouldFetch("202607", "202607", true, false), true, "이번 달 재수집");
  assert.equal(shouldFetch("202605", "202607", true, false), true, "3개월 내 재수집");
  assert.equal(shouldFetch("202604", "202607", true, false), false, "받아둔 과거 달 건너뜀");
  assert.equal(shouldFetch("202604", "202607", false, false), true, "없는 달은 받음");
  assert.equal(shouldFetch("202001", "202607", true, true), true, "--force면 전부 다시");
});

test("GET 외의 메서드는 거절한다", async () => {
  const url = new URL("https://estate.bubblelab.dev/_estate/deals");
  const response = await handleEstateDeals(new Request(url, { method: "POST" }), {}, url);
  assert.equal(response.status, 405);
});
