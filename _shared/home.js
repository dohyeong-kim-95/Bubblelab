// 모든 토이 공용 "카테고리 홈으로" 버튼.
// 빌드가 카드 페이지에만 자동 주입하므로 토이가 직접 챙길 필요가 없다
// (_infra/build.mjs의 injectShared — 카테고리 홈 자체에는 주입되지 않는다).
//
// 자리는 좌하단이다. 상단은 거의 모든 토이가 점수·타이머 HUD로 쓰고 있어
// (측정 결과 상단은 21개 중 7~9개에서 UI를 가렸고 하단은 3개) 공용 버튼이
// 이미 모여 있는 아래쪽이 토이와 부딪히지 않는다.
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
  #bl-home { position: fixed; left: 1rem; bottom: 1rem; z-index: 9999;
    font: bold .85rem ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace;
    padding: .55rem .95rem; border-radius: 2rem; border: 1.5px solid currentColor;
    cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: .3rem;
    color: light-dark(#334, #ccd);
    background: light-dark(rgba(255,255,255,.75), rgba(20,26,36,.75));
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  #bl-home:active { transform: scale(.94); }
  /* 주간 기록 배지가 좌하단을 먼저 쓰므로 그 위로 쌓는다 (suggest.js와 같은 방식).
     배지는 기록 조회 후 생기지만 :has()가 실시간이라 그때 알아서 밀려 올라간다. */
  body:has(#bl-weekly) #bl-home { bottom: 3.8rem; }`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const a = document.createElement("a");
  a.id = "bl-home";
  a.href = home;
  a.textContent = "← 홈";
  a.setAttribute("aria-label", "카테고리 홈으로 이동");
  // 화면 전체를 탭 영역으로 쓰는 토이(우드 스택 등)에 탭이 새지 않게 한다.
  // body 직계 자식이라 버블링으로 새지는 않지만, 캔버스 위에 겹쳐 있을 때
  // pointerdown을 먼저 삼키는 토이가 있어 방어적으로 막는다.
  for (const ev of ["pointerdown", "touchstart", "mousedown"]) {
    a.addEventListener(ev, (e) => e.stopPropagation());
  }
  document.body.appendChild(a);
})();
