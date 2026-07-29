// 우하단 공용 유틸 독(dock). 홈·공유처럼 토이 바깥에서 붙는 버튼들을 알약 모양
// 한 덩어리로 모은다. 버튼이 늘어나면 원형으로 접히고, 누르면 알약으로 펼쳐진다.
//
// 등록 방법 — 로드 순서를 신경 쓸 필요가 없다. 독보다 먼저 실행돼도 큐에 쌓였다가
// 독이 생길 때 함께 그려진다:
//
//   (window.blDock = window.blDock || []).push({
//     id: "bl-mute", icon: "🔊", label: "소리 끄기", order: 50,
//     onClick: (el) => { ... el.textContent = "🔇"; },
//   });
//
// 필드: id(필수) · icon(필수) · label(스크린리더/툴팁) · order(작을수록 왼쪽)
//       href(링크로 만들 때) · onClick(버튼으로 만들 때) · ready(el)(생성 직후 콜백)
(() => {
  const MAX_INLINE = 3; // 이보다 많아지면 접기 토글이 붙는다
  const STORE = "bl-dock-collapsed";

  const css = `
  #bl-dock { position: fixed; right: 1rem; bottom: 1rem; z-index: 9999;
    display: flex; align-items: center; gap: .25rem; padding: .25rem;
    border-radius: 2rem; border: 1.5px solid currentColor;
    color: light-dark(#334, #ccd);
    background: light-dark(rgba(255,255,255,.75), rgba(20,26,36,.75));
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  #bl-dock .bl-dock-btn { width: 2.4rem; height: 2.4rem; flex: none; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    font: 1.1rem/1 ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Consolas, monospace;
    border: 0; border-radius: 50%; background: none; color: inherit;
    cursor: pointer; text-decoration: none; }
  #bl-dock .bl-dock-btn:active { transform: scale(.9); }
  /* 버튼이 적으면 토글 자체를 숨긴다 — 접을 이유가 없다 */
  #bl-dock .bl-dock-toggle { display: none; }
  #bl-dock.crowded .bl-dock-toggle { display: inline-flex; }
  #bl-dock.crowded.collapsed .bl-dock-btn:not(.bl-dock-toggle) { display: none; }`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const dock = document.createElement("div");
  dock.id = "bl-dock";
  // 화면 전체를 탭 영역으로 쓰는 토이(우드 스택 등)에 탭이 새지 않게 한다.
  for (const ev of ["pointerdown", "touchstart", "mousedown"]) {
    dock.addEventListener(ev, (e) => e.stopPropagation());
  }

  let collapsed = false;
  try { collapsed = localStorage.getItem(STORE) === "1"; } catch {}

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "bl-dock-btn bl-dock-toggle";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    collapsed = !collapsed;
    try { localStorage.setItem(STORE, collapsed ? "1" : "0"); } catch {}
    render();
  });

  const items = [];

  function render() {
    const crowded = items.length > MAX_INLINE;
    dock.classList.toggle("crowded", crowded);
    dock.classList.toggle("collapsed", crowded && collapsed);
    toggle.textContent = crowded && collapsed ? "⋯" : "✕";
    toggle.title = crowded && collapsed ? "유틸 펼치기" : "유틸 접기";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(!(crowded && collapsed)));
    // order 오름차순으로 다시 배열 (토글은 항상 오른쪽 끝)
    for (const it of [...items].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))) {
      dock.appendChild(it.el);
    }
    dock.appendChild(toggle);
    if (!dock.isConnected && items.length) document.body.appendChild(dock);
  }

  function add(item) {
    if (!item?.id || !item.icon) return null;
    if (items.some((i) => i.id === item.id)) return null; // 중복 등록 무시
    const el = document.createElement(item.href ? "a" : "button");
    el.id = item.id;
    el.className = "bl-dock-btn";
    el.textContent = item.icon;
    if (item.href) {
      el.href = item.href;
    } else {
      el.type = "button";
      el.addEventListener("click", (e) => { e.stopPropagation(); item.onClick?.(el); });
    }
    if (item.label) {
      el.title = item.label;
      el.setAttribute("aria-label", item.label);
    }
    items.push({ ...item, el });
    render();
    item.ready?.(el);
    return el;
  }

  // 먼저 실행된 등록들(배열에 쌓인 큐)을 흡수하고, 이후 push는 바로 처리한다.
  const queued = Array.isArray(window.blDock) ? window.blDock : [];
  window.blDock = { add, push: add, get: (id) => items.find((i) => i.id === id)?.el ?? null };
  for (const item of queued) add(item);
})();
