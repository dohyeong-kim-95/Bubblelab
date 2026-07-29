// 우하단 공용 유틸 독(dock). 홈·공유처럼 토이 바깥에서 붙는 버튼들을 세로 알약
// 하나로 모은다. 아래 끝의 토글을 축으로 위로 자라고, 버튼이 늘어나면 원형으로
// 접혔다가 누르면 다시 위로 펼쳐진다.
//
// 등록 방법 — 로드 순서를 신경 쓸 필요가 없다. 독보다 먼저 실행돼도 큐에 쌓였다가
// 독이 생길 때 함께 그려진다:
//
//   (window.blDock = window.blDock || []).push({
//     id: "bl-mute", icon: "🔊", label: "소리 끄기", order: 50,
//     onClick: (el) => { ... el.textContent = "🔇"; },
//   });
//
// 필드: id(필수) · icon(필수) · label(스크린리더/툴팁) · order(작을수록 아래쪽)
//       href(링크로 만들 때) · onClick(버튼으로 만들 때) · ready(el)(생성 직후 콜백)
(() => {
  const MAX_INLINE = 3; // 이보다 많아지면 접기 토글이 붙는다
  const STORE = "bl-dock-collapsed";

  const css = `
  /* 아래를 축으로 위로 자란다 — 토글은 늘 맨 아래(엄지 자리)에 붙어 있고
     버튼이 그 위로 쌓인다. 가로로 늘리면 좌하단 주간 기록 배지 쪽으로
     번져 부딪히므로 세로를 택했다. */
  #bl-dock { position: fixed; right: 1rem; bottom: 1rem; z-index: 9999;
    display: flex; flex-direction: column; align-items: center;
    gap: .25rem; padding: .25rem;
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
    // 세로 배치라 order가 작을수록 아래(토글 쪽)에 와야 손이 먼저 닿는다.
    // DOM은 위→아래 순서이므로 내림차순으로 넣고 토글을 맨 끝(=맨 아래)에 붙인다.
    for (const it of [...items].sort((a, b) => (b.order ?? 50) - (a.order ?? 50))) {
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
