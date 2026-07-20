// work.bubblelab.dev 외주 프로젝트용 상품 리뷰·문의(Q&A) 동기화.
// 네이버 커머스 API(판매자 인증)에서 리뷰와 상품 문의를 주기적으로 받아 DO에
// 캐시하고, 품목별 상세페이지가 이 캐시를 읽어 노출한다.
//
// 실제 커머스 API 호출부(fetchNaver*)는 판매자 자격증명이 있을 때만 실행되며,
// 없으면 mock 데이터로 동작한다("mock으로 처리"). 항목별 source로 출처를 구분해
// 상세페이지에서 네이버 출처(source: "naver")엔 네이버 마크(N), 다온핏 자체
// 등록분(source: "own")엔 다온핏 배지를 붙인다. 실서비스 전환 절차·주의사항은
// work/daonfit/REVIEWS.md 참고.

const KEY = "reviews:data";
const SUB = "reviews:submitted";
const MAX_ITEMS = 200;
const NAVER_API = "https://api.commerce.naver.com/external";

// 캐시 데이터 구조 버전. 구조가 바뀌면 올리면, 라우트가 옛 캐시를 감지해 자동
// 재동기화한다 (syncedAt만으로는 옛 구조가 그대로 남는 문제 방지).
export const REVIEWS_SYNC_VERSION = 2;

// --- mock 리뷰 ------------------------------------------------------------
// 스마트스토어 실제 리뷰 톤을 재현한 예시. product 값은 goods/<slug>.html의
// 품목 slug와 일치해야 상세페이지가 자기 리뷰만 골라 보여준다. source는 출처
// 표시용으로, "naver"는 네이버에서 가져온 것, "own"은 다온핏 자체 등록분.
const MOCK_REVIEWS = {
  daonfit: [
    { id: "kb1", product: "keybox", nick: "골댕이아빠", rating: 5, text: "차 키를 안에 두고 문을 잠근 적이 있어서 큰맘 먹고 샀는데 견인고리 자리에 딱 맞아요. 이제 마음이 놓입니다.", date: "2025-05-12", source: "naver" },
    { id: "kb2", product: "keybox", nick: "초보운전서연", rating: 5, text: "차종 알려주니 정확히 맞게 제작해 주셨어요. 눈에 잘 안 띄면서 꺼내긴 쉬워서 만족합니다.", date: "2025-06-03", source: "naver" },
    { id: "kb3", product: "keybox", nick: "제주한달살이", rating: 5, text: "부모님 차에도 하나 더 주문했어요. 마감이 깔끔하고 튼튼합니다.", date: "2025-06-21", source: "own" },
    { id: "kb4", product: "keybox", nick: "출퇴근2시간", rating: 5, text: "주문 제작이라 배송은 조금 걸리지만 그만한 값어치가 있네요. 강추합니다.", date: "2025-07-02", source: "naver" },
    { id: "pk1", product: "parking-keyring", nick: "마트왕복", rating: 5, text: "지하주차장에서 맨날 헤맸는데 슬라이드 밀어두는 습관 하나로 해결됐어요.", date: "2025-05-28", source: "naver" },
    { id: "pk2", product: "parking-keyring", nick: "워킹맘하루", rating: 4, text: "아이디어 정말 좋아요. 색상 선택지가 더 많으면 좋겠어요.", date: "2025-06-15", source: "own" },
    { id: "pk3", product: "parking-keyring", nick: "주말드라이버", rating: 5, text: "키링이라 항상 들고 다녀서 잊어버릴 일이 없네요. 선물로도 좋아요.", date: "2025-07-05", source: "naver" },
    { id: "vc1", product: "vent-clip", nick: "방향제덕후", rating: 5, text: "송풍구에 헐렁하던 방향제가 딱 고정됐어요. 덜렁거림 전혀 없습니다.", date: "2025-06-08", source: "naver" },
    { id: "vc2", product: "vent-clip", nick: "신차오너", rating: 5, text: "작지만 매일 타는 차라 체감이 큽니다. 재구매 의사 있어요.", date: "2025-06-30", source: "own" },
    { id: "am1", product: "mini-atm", nick: "조카바보", rating: 5, text: "조카 용돈 줄 때 넣어줬더니 눈이 휘둥그레졌어요. 이벤트 대성공입니다!", date: "2025-05-19", source: "naver" },
    { id: "am2", product: "mini-atm", nick: "어린이날준비", rating: 5, text: "비밀번호 누르고 돈 나오는 게 신기해서 아이가 계속 저금하네요.", date: "2025-06-10", source: "own" },
    { id: "am3", product: "mini-atm", nick: "생일서프라이즈", rating: 4, text: "퀄리티 좋아요. 크기가 생각보다 커서 놀랐지만 만족합니다.", date: "2025-06-27", source: "naver" },
    { id: "fs1", product: "figure-stand", nick: "티니핑수집가", rating: 5, text: "픽픽 쓰러지던 피규어들이 반듯하게 섰어요. 10개입이라 넉넉합니다.", date: "2025-04-30", source: "naver" },
  ],
};

// --- mock 상품 문의(Q&A) --------------------------------------------------
// 네이버 스토어 "상품 문의"(source: "naver")와 다온핏 사이트 자체 문의
// (source: "own", 고객이 사이트에서 남긴 것)를 섞은 예시.
const MOCK_QNA = {
  daonfit: [
    { id: "kbq1", product: "keybox", nick: "현대차오너", question: "아반떼CN7도 견인고리 위치에 맞게 제작되나요?", answer: "네, 주문 시 차종을 알려주시면 해당 차종 견인고리 캡 자리에 맞춰 제작해 드립니다.", date: "2025-06-05", source: "naver" },
    { id: "kbq2", product: "keybox", nick: "안전제일", question: "주행 중에 키가 흔들려 소리 나지는 않나요?", answer: "내부 실리콘 패드로 고정돼 주행 중 흔들림이나 소음이 없습니다.", date: "2025-06-18", source: "own" },
    { id: "pkq1", product: "parking-keyring", nick: "지하주차초보", question: "숫자 대신 B1·B2 같은 층수 표기도 가능한가요?", answer: "네, B1~B5 표기 버전으로 제작 가능합니다. 주문 시 요청해 주세요.", date: "2025-06-12", source: "naver" },
    { id: "pkq2", product: "parking-keyring", nick: "선물포장", question: "선물용 포장도 되나요?", answer: "간단한 선물 포장 가능합니다. 요청사항에 남겨주세요.", date: "2025-06-22", source: "own" },
    { id: "vcq1", product: "vent-clip", nick: "방향제고민", question: "원형 송풍구에도 장착되나요?", answer: "원형·수직형 등 송풍구 형태를 알려주시면 맞춰 제작해 드립니다.", date: "2025-06-20", source: "naver" },
    { id: "amq1", product: "mini-atm", nick: "선물고민중", question: "지폐는 몇 장까지 들어가나요?", answer: "5만원권 기준 약 20장까지 여유 있게 들어갑니다.", date: "2025-06-14", source: "naver" },
    { id: "amq2", product: "mini-atm", nick: "조카생일", question: "건전지도 포함해서 오나요?", answer: "AA 건전지 2개가 필요하며, 기본 포함해 발송해 드립니다.", date: "2025-06-25", source: "own" },
    { id: "fsq1", product: "figure-stand", nick: "재입고문의", question: "재입고는 언제쯤 되나요?", answer: "다음 제작 배치 일정은 스마트스토어 소식·문의로 안내드리고 있습니다.", date: "2025-05-02", source: "naver" },
  ],
};

const clone = (list) => (list ?? []).map((entry) => ({ ...entry }));

// 프로바이더 계층: 판매자 자격증명이 있으면 실제 커머스 API, 없으면 mock.
// worker의 cron·최초 조회가 이 함수를 호출해 DO 캐시를 채운다.
export async function fetchStoreReviews(env, project) {
  const live = Boolean(env?.NAVER_COMMERCE_CLIENT_ID && env?.NAVER_COMMERCE_CLIENT_SECRET);
  let reviews;
  let questions;
  if (live) {
    const token = await issueNaverToken(env);
    const productMap = JSON.parse(env.NAVER_PRODUCT_MAP || "{}")[project] || {};
    reviews = await fetchNaverReviews(token, productMap);
    questions = await fetchNaverQna(token, productMap);
  } else {
    reviews = clone(MOCK_REVIEWS[project]);
    questions = clone(MOCK_QNA[project]);
  }
  return {
    project,
    source: live ? "naver-commerce" : "mock",
    version: REVIEWS_SYNC_VERSION,
    syncedAt: new Date().toISOString(),
    items: reviews.slice(0, MAX_ITEMS),
    questions: questions.slice(0, MAX_ITEMS),
  };
}

// --- 실제 네이버 커머스 API 경로 (자격증명이 있을 때만 실행) ----------------
// 절차: (1) client_secret 전자서명으로 OAuth2 토큰 발급
//       (2) 상품별 리뷰·문의 목록 조회 → 사이트 표시용으로 정규화(source: "naver")
// 이 경로는 지금 배포(mock)에서는 절대 실행되지 않는다. 실서비스 전
// 토큰 서명·상품ID 매핑·엔드포인트 스키마를 REVIEWS.md 절차대로 검증할 것.
async function fetchNaverReviews(token, productMap) {
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
        source: "naver",
      });
    }
  }
  return collected;
}

async function fetchNaverQna(token, productMap) {
  const collected = [];
  for (const [slug, productId] of Object.entries(productMap)) {
    const res = await fetch(`${NAVER_API}/v1/pay-user/inquiries?productId=${encodeURIComponent(productId)}&size=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const body = await res.json().catch(() => ({}));
    for (const inquiry of body?.contents ?? []) {
      collected.push({
        id: `nv-${inquiry.inquiryNo}`,
        product: slug,
        nick: maskNick(inquiry.writerName || "구매자"),
        question: String(inquiry.inquiryContent || "").trim().slice(0, 500),
        answer: String(inquiry.answerContent || "").trim().slice(0, 500),
        date: String(inquiry.inquiryRegistrationDateTime || "").slice(0, 10),
        source: "naver",
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

// 닉네임·상품·본문 정리 (공백 정규화 + 길이 제한).
const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// --- 캐시 저장소 (프로젝트당 DO 하나) --------------------------------------
// 동기화된 리뷰·문의(reviews:data)와 사용자가 남긴 후기(reviews:submitted)를
// 분리 저장한다. sync는 동기화분만 교체하므로 사용자 후기는 보존된다.
export class WorkReviewsDO {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      const synced = (await this.storage.get(KEY)) ?? { items: [], questions: [], source: null, version: null, syncedAt: null };
      const submitted = (await this.storage.get(SUB)) ?? [];
      return Response.json({ ...synced, submitted }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "PUT" && url.pathname === "/sync") {
      const body = await request.json().catch(() => null);
      if (!body || !Array.isArray(body.items)) return new Response("invalid payload", { status: 400 });
      const data = {
        items: body.items.slice(0, MAX_ITEMS),
        questions: Array.isArray(body.questions) ? body.questions.slice(0, MAX_ITEMS) : [],
        source: body.source ?? null,
        version: body.version ?? null,
        syncedAt: body.syncedAt ?? new Date().toISOString(),
      };
      await this.storage.put(KEY, data);
      return Response.json({ saved: true, reviews: data.items.length, questions: data.questions.length });
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      const body = await request.json().catch(() => ({}));
      const product = clean(body.product, 40);
      const nick = clean(body.nick, 20);
      const text = String(body.text ?? "").trim().slice(0, 1000);
      const rating = Math.round(Number(body.rating));
      if (!/^[a-z0-9-]{1,40}$/.test(product) || !nick || !text || !(rating >= 1 && rating <= 5)) {
        return new Response("invalid review", { status: 400 });
      }
      const submitted = (await this.storage.get(SUB)) ?? [];
      const item = {
        id: crypto.randomUUID(), product, nick, rating, text,
        date: new Date().toISOString().slice(0, 10), source: "own",
      };
      submitted.unshift(item);
      await this.storage.put(SUB, submitted.slice(0, MAX_ITEMS));
      return Response.json({ saved: true, item });
    }

    return new Response("method not allowed", { status: 405, headers: { Allow: "GET, PUT, POST" } });
  }
}
