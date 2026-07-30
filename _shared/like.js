// 게임 추천(좋아요) 버튼. 사용법: blWeekly 선언 뒤에
//   <script defer src="/_shared/like.js"></script>
// 한 줄이면 끝 — 우하단 유틸 독에 👍 버튼이 붙고, 옆의 숫자로 추천 수를 보여준다.
// 방문자당 게임별 1회(서버 vid 기준), localStorage로 눌렀던 상태를 기억한다.
(() => {
  const game = window.blWeekly?.game || window.blLikeGame;
  if (!game || !/^[a-z0-9-]{2,32}$/.test(game)) return;
  const KEY = `bl-liked-${game}`;

  let liked = false;
  try { liked = localStorage.getItem(KEY) === "1"; } catch {}

  const paint = (el, n) => {
    el.innerHTML = "";
    const icon = document.createElement("span");
    icon.textContent = "👍";
    icon.style.cssText = liked ? "" : "filter: grayscale(1); opacity: .75;";
    el.appendChild(icon);
    if (n > 0) {
      const cnt = document.createElement("span");
      cnt.textContent = n > 999 ? "999+" : String(n);
      cnt.style.cssText = "font-size:.55rem; margin-left:1px;";
      el.appendChild(cnt);
    }
    el.title = liked ? "추천 완료!" : "이 게임 추천하기";
    el.setAttribute("aria-label", el.title);
  };

  let count = 0;
  (window.blDock = window.blDock || []).push({
    id: "bl-like",
    icon: "👍",
    label: "이 게임 추천하기",
    order: 30,
    ready: async (el) => {
      paint(el, 0);
      try {
        const res = await fetch(`/_like?game=${game}`, { cache: "no-store" });
        if (res.ok) { count = (await res.json()).n ?? 0; paint(el, count); }
      } catch {}
    },
    onClick: async (el) => {
      if (liked) { paint(el, count); return; }
      liked = true;
      try { localStorage.setItem(KEY, "1"); } catch {}
      paint(el, ++count);                       // 낙관적 반영
      el.animate?.([{ transform: "scale(1.4)" }, { transform: "scale(1)" }],
                   { duration: 180 });
      try {
        const res = await fetch("/_like", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ game }),
        });
        if (res.ok) { count = (await res.json()).n ?? count; paint(el, count); }
      } catch {}
    },
  });
})();
