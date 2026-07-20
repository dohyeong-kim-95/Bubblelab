// [인계용 백엔드 사본 — work/daonfit 자체 완결]
// 이 파일은 다온핏 폴더가 통째로 인계될 때 함께 전달되는 리뷰 동기화 백엔드
// 원본입니다. 리포의 _infra/reviews.js와 "완전히 독립된 동일 사본"이며 서로
// import하지 않습니다 (work 폴더가 삭제돼도 리포가 깨지지 않고, 이 폴더만
// 넘겨도 그대로 구동됩니다).
//
// - 지금 라이브 사이트는 리포의 _infra 워커가 이 로직으로 /_workreviews/daonfit를
//   서빙합니다.
// - 인계 후에는 인수 측이 이 파일을 자신의 Cloudflare Worker(또는 동등한 백엔드)에
//   붙여 동일 라우트를 제공하면 됩니다.
// - 실제 커머스 API 전환·주의사항은 ../REVIEWS.md 참고.
//
// 네이버 커머스 API(판매자 인증)에서 리뷰를 주기적으로 받아 DO에 캐시하고,
// 품목별 상세페이지가 이 캐시를 읽어 노출한다. 실제 API 호출부
// (fetchNaverCommerceReviews)는 판매자 자격증명이 있을 때만 실행되며, 없으면
// mock 데이터로 동작한다.

const KEY = "reviews:data";
const MAX_ITEMS = 200;
const NAVER_API = "https://api.commerce.naver.com/external";

// --- mock 리뷰 ------------------------------------------------------------
// 스마트스토어 실제 리뷰 톤을 재현한 예시. product 값은 goods/<slug>.html의
// 품목 slug와 일치해야 상세페이지가 자기 리뷰만 골라 보여준다.
const MOCK_REVIEWS = {
  daonfit: [
    { id: "kb1", product: "keybox", nick: "골댕이아빠", rating: 5, text: "차 키를 안에 두고 문을 잠근 적이 있어서 큰맘 먹고 샀는데 견인고리 자리에 딱 맞아요. 이제 마음이 놓입니다.", date: "2025-05-12" },
    { id: "kb2", product: "keybox", nick: "초보운전서연", rating: 5, text: "차종 알려주니 정확히 맞게 제작해 주셨어요. 눈에 잘 안 띄면서 꺼내긴 쉬워서 만족합니다.", date: "2025-06-03" },
    { id: "kb3", product: "keybox", nick: "제주한달살이", rating: 5, text: "부모님 차에도 하나 더 주문했어요. 마감이 깔끔하고 튼튼합니다.", date: "2025-06-21" },
    { id: "kb4", product: "keybox", nick: "출퇴근2시간", rating: 5, text: "주문 제작이라 배송은 조금 걸리지만 그만한 값어치가 있네요. 강추합니다.", date: "2025-07-02" },
    { id: "pk1", product: "parking-keyring", nick: "마트왕복", rating: 5, text: "지하주차장에서 맨날 헤맸는데 슬라이드 밀어두는 습관 하나로 해결됐어요.", date: "2025-05-28" },
    { id: "pk2", product: "parking-keyring", nick: "워킹맘하루", rating: 4, text: "아이디어 정말 좋아요. 색상 선택지가 더 많으면 좋겠어요.", date: "2025-06-15" },
    { id: "pk3", product: "parking-keyring", nick: "주말드라이버", rating: 5, text: "키링이라 항상 들고 다녀서 잊어버릴 일이 없네요. 선물로도 좋아요.", date: "2025-07-05" },
    { id: "vc1", product: "vent-clip", nick: "방향제덕후", rating: 5, text: "송풍구에 헐렁하던 방향제가 딱 고정됐어요. 덜렁거림 전혀 없습니다.", date: "2025-06-08" },
    { id: "vc2", product: "vent-clip", nick: "신차오너", rating: 5, text: "작지만 매일 타는 차라 체감이 큽니다. 재구매 의사 있어요.", date: "2025-06-30" },
    { id: "am1", product: "mini-atm", nick: "조카바보", rating: 5, text: "조카 용돈 줄 때 넣어줬더니 눈이 휘둥그레졌어요. 이벤트 대성공입니다!", date: "2025-05-19" },
    { id: "am2", product: "mini-atm", nick: "어린이날준비", rating: 5, text: "비밀번호 누르고 돈 나오는 게 신기해서 아이가 계속 저금하네요.", date: "2025-06-10" },
    { id: "am3", product: "mini-atm", nick: "생일서프라이즈", rating: 4, text: "퀄리티 좋아요. 크기가 생각보다 커서 놀랐지만 만족합니다.", date: "2025-06-27" },
    { id: "fs1", product: "figure-stand", nick: "티니핑수집가", rating: 5, text: "픽픽 쓰러지던 피규어들이 반듯하게 섰어요. 10개입이라 넉넉합니다.", date: "2025-04-30" },
  ],
};

function mockReviews(project) {
  return (MOCK_REVIEWS[project] ?? []).map((review) => ({ ...review }));
}

// 프로바이더 계층: 판매자 자격증명이 있으면 실제 커머스 API, 없으면 mock.
// worker의 cron·최초 조회가 이 함수를 호출해 DO 캐시를 채운다.
export async function fetchStoreReviews(env, project) {
  const live = Boolean(env?.NAVER_COMMERCE_CLIENT_ID && env?.NAVER_COMMERCE_CLIENT_SECRET);
  const items = live ? await fetchNaverCommerceReviews(env, project) : mockReviews(project);
  return {
    project,
    source: live ? "naver-commerce" : "mock",
    syncedAt: new Date().toISOString(),
    items: items.slice(0, MAX_ITEMS),
  };
}

// --- 실제 네이버 커머스 API 경로 (자격증명이 있을 때만 실행) ----------------
// 절차: (1) client_secret 전자서명으로 OAuth2 토큰 발급
//       (2) 상품별 리뷰 목록 조회 → 사이트 표시용으로 정규화
// 이 경로는 지금 배포(mock)에서는 절대 실행되지 않는다. 실서비스 전
// 토큰 서명·상품ID 매핑·엔드포인트 스키마를 REVIEWS.md 절차대로 검증할 것.
async function fetchNaverCommerceReviews(env, project) {
  const token = await issueNaverToken(env);
  const productMap = JSON.parse(env.NAVER_PRODUCT_MAP || "{}")[project] || {};
  const collected = [];
  for (const [slug, productId] of Object.entries(productMap)) {
    const res = await fetch(`${NAVER_API}/v1/reviews?productId=${encodeURIComponent(productId)}&size=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const body = await res.json().catch(() => ({}));
    for (const review of body?.contents ?? []) {
      collected.push({
        id: `nv-${review.reviewId}`,
        product: slug,
        nick: maskNick(review.writerName || "구매자"),
        rating: Number(review.reviewScore) || 5,
        text: String(review.reviewContent || "").trim().slice(0, 400),
        date: String(review.createDate || "").slice(0, 10),
      });
    }
  }
  return collected;
}

async function issueNaverToken(env) {
  const timestamp = Date.now();
  const sign = signClientSecret(env.NAVER_COMMERCE_CLIENT_ID, env.NAVER_COMMERCE_CLIENT_SECRET, timestamp);
  const params = new URLSearchParams({
    client_id: env.NAVER_COMMERCE_CLIENT_ID,
    timestamp: String(timestamp),
    grant_type: "client_credentials",
    client_secret_sign: sign,
    type: "SELF",
  });
  const res = await fetch(`${NAVER_API}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) throw new Error(`naver token failed: ${res.status}`);
  return (await res.json()).access_token;
}

// 커머스 API는 client_secret_sign = base64(bcrypt(`${client_id}_${timestamp}`,
// client_secret)) 서명을 요구한다. Workers 기본 런타임에는 bcrypt가 없으므로
// 실서비스 전 서명 구현을 붙여야 한다 (REVIEWS.md의 "토큰 서명" 항목).
function signClientSecret() {
  throw new Error("Naver Commerce 토큰 서명 미구현 — work/daonfit/REVIEWS.md 참고");
}

// 개인정보 최소화: 작성자명을 첫·끝 글자만 남기고 마스킹한다.
function maskNick(name) {
  const value = String(name).trim();
  if (value.length <= 1) return value || "구매자";
  if (value.length === 2) return `${value[0]}*`;
  return `${value[0]}${"*".repeat(value.length - 2)}${value[value.length - 1]}`;
}

// --- 캐시 저장소 (프로젝트당 DO 하나) --------------------------------------
export class WorkReviewsDO {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET") {
      const data = (await this.storage.get(KEY)) ?? { items: [], source: null, syncedAt: null };
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "PUT" && url.pathname === "/sync") {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.items)) return new Response("invalid payload", { status: 400 });
      const data = {
        items: body.items.slice(0, MAX_ITEMS),
        source: body.source ?? null,
        syncedAt: body.syncedAt ?? new Date().toISOString(),
      };
      await this.storage.put(KEY, data);
      return Response.json({ saved: true, count: data.items.length });
    }
    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, PUT" } });
  }
}
