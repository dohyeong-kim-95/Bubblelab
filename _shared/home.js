// 모든 토이 공용 "카테고리 홈으로" 버튼.
// 빌드가 카드 페이지에만 자동 주입하므로 토이가 직접 챙길 필요가 없다
// (_infra/build.mjs의 injectShared — 카테고리 홈 자체에는 주입되지 않는다).
//
// 자리는 우하단 유틸 독(dock.js) 안이다. 독을 우하단에 둔 이유:
//  - 상단은 거의 모든 토이가 점수·타이머 HUD로 쓴다 (실측 결과 상단 배치는
//    21개 중 7~9개에서 UI를 가렸고, 하단은 3개였다).
//  - 좌하단·하단 중앙은 주간 기록 배지가 펼쳐지면 폭도 높이도 크게 자라
//    (390px 화면에서 높이 169px) 침범당한다. 위로 쌓아도 마찬가지다.
(() => {
  // 카드 페이지가 아니면(= 카테고리 홈) 버튼을 만들지 않는다.
  // 호스트 판별은 engagement.js와 같은 규칙 — 로컬(wrangler dev)에서는 첫 경로
  // 세그먼트가 서브도메인 역할을 하므로 홈 주소가 "/"가 아니라 "/<site>/"다.
  const host = location.hostname.toLowerCase();
  const parts = location.pathname.split("/").filter(Boolean);
  let home, card;
  if (host === "bubblelab.dev" || host === "www.bubblelab.dev") {
    return; // apex 랜딩에는 위로 갈 곳이 없다
  } else if (host.endsWith(".bubblelab.dev")) {
    home = "/";
    [card] = parts;
  } else {
    const [site, local] = parts;
    if (!site) return;
    home = `/${site}/`;
    card = local;
  }
  if (!card) return;

  // 우하단 공용 유틸 독에 등록한다. 모양·배치·접기·탭 전파 차단은 독이 맡는다.
  (window.blDock = window.blDock || []).push({
    id: "bl-home",
    icon: "🏠",
    label: "홈으로",
    href: home,
    order: 10, // 공유(20)보다 왼쪽
  });
})();
