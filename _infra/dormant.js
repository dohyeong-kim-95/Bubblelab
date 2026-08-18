// 잠시 내려 둔 화면. 코드도, 쌓아 둔 데이터(Durable Object)도 그대로 두고
// 입구만 닫는다 — 하나씩 필요해질 때 여기서 한 줄을 지우고 wrangler.jsonc 의
// 해당 ENABLE_* 를 "true" 로 되돌리면 그대로 살아난다.
//
// DO 바인딩과 migrations 는 절대 지우지 않는다. 지우는 순간 invest 잔고 이력과
// trip 가격 관측이 사라지고, 그건 되살릴 방법이 없다.
//
// 항목은 서브도메인("estate") 이거나 그 안의 첫 경로("util/planner") 다.
export const DORMANT = new Set(["estate", "invest", "trip", "util/planner"]);

// 되살릴 때 함께 되돌릴 것:
//   estate        — (서버 기능 없음, 목록에서 빼면 끝)
//   invest        — wrangler.jsonc "ENABLE_INVEST": "true", 집 PC 데몬 cron 재개
//   trip          — "ENABLE_TRIP_WATCH": "true", triggers.crons 에 "20 */6 * * *" 추가
//   util/planner  — "ENABLE_PLANNER": "true"

/** 서브도메인 전체가 잠들었는지. 빌드·검증이 폴더를 건너뛸 때 쓴다. */
export const dormantSubdomains = () => [...DORMANT].filter((entry) => !entry.includes("/"));

/** 한 서브도메인 안에서 잠든 항목 이름들 (카테고리 카드 목록에서 뺄 때). */
export const dormantEntries = (site) =>
  new Set([...DORMANT]
    .filter((entry) => entry.startsWith(`${site}/`))
    .map((entry) => entry.slice(site.length + 1)));

export function isDormant(site, path = "/") {
  if (DORMANT.has(site)) return true;
  const [first] = path.split("/").filter(Boolean);
  return Boolean(first) && DORMANT.has(`${site}/${first}`);
}
