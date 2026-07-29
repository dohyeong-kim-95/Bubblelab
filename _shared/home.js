// 모든 토이 공용 "카테고리 홈으로" 버튼.
// 빌드가 카드 페이지에만 자동 주입하므로 토이가 직접 챙길 필요가 없다
// (_infra/build.mjs의 injectShared — 카테고리 홈 자체에는 주입되지 않는다).
//
// 자리는 우하단, 공유 버튼 바로 왼쪽이다.
//  - 상단을 피하는 이유: 거의 모든 토이가 점수·타이머 HUD로 쓴다 (실측 결과
//    상단 배치는 21개 중 7~9개에서 UI를 가렸고, 하단은 3개였다).
//  - 좌하단·하단 중앙을 피하는 이유: 주간 기록 배지가 펼쳐지면 폭도 높이도
//    크게 자라 (390px 화면에서 높이 169px) 그 영역을 침범한다.
//  - 위로 쌓지 않고 옆에 세우는 이유: 배지가 세로로 자라 3.8rem 높이까지
//    올라오기 때문이다. 대신 공유 버튼과 함께 아이콘만 남겨, 둘을 합쳐도
//    예전 "📤 공유" 하나와 비슷한 폭에 머문다.
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

  const css = `
  #bl-home { position: fixed; right: 1rem; bottom: 1rem; z-index: 9999;
    font: bold 1.1rem ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace;
    width: 2.8rem; height: 2.8rem; padding: 0; display: inline-flex;
    align-items: center; justify-content: center; line-height: 1;
    border-radius: 50%; border: 1.5px solid currentColor;
    cursor: pointer; text-decoration: none;
    color: light-dark(#334, #ccd);
    background: light-dark(rgba(255,255,255,.75), rgba(20,26,36,.75));
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  #bl-home:active { transform: scale(.94); }
  /* 공유 버튼이 우하단 끝을 쓰므로 그 왼쪽에 나란히 선다. 위로 쌓지 않는 이유는
     좌하단 주간 기록 배지가 펼쳐지면 세로로 크게 자라 그 높이를 침범해서다.
     공유 버튼은 defer 로드라 나중에 생기지만 :has()가 실시간이라 알아서 비켜준다. */
  body:has(#bl-share) #bl-home { right: 4.3rem; }`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const a = document.createElement("a");
  a.id = "bl-home";
  a.href = home;
  a.textContent = "🏠";
  a.title = "홈으로";
  a.setAttribute("aria-label", "카테고리 홈으로 이동");
  // 화면 전체를 탭 영역으로 쓰는 토이(우드 스택 등)에 탭이 새지 않게 한다.
  // body 직계 자식이라 버블링으로 새지는 않지만, 캔버스 위에 겹쳐 있을 때
  // pointerdown을 먼저 삼키는 토이가 있어 방어적으로 막는다.
  for (const ev of ["pointerdown", "touchstart", "mousedown"]) {
    a.addEventListener(ev, (e) => e.stopPropagation());
  }
  document.body.appendChild(a);
})();
