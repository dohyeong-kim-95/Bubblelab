// 품목별 상세페이지 리뷰 위젯.
// /_workreviews/daonfit 에서 동기화된 리뷰(백엔드는 커머스 API, 현재 mock)를
// 받아 현재 상품(window.blProduct)의 리뷰만 골라 #reviews에 렌더한다.
(() => {
  const mount = document.getElementById("reviews");
  const product = window.blProduct;
  if (!mount || !product) return;

  const esc = (value) => String(value).replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[c]);
  const stars = (n) => "★★★★★☆☆☆☆☆".slice(5 - Math.round(n), 10 - Math.round(n));
  const dateOf = (s) => String(s || "").slice(0, 10).replaceAll("-", ".");

  fetch("/_workreviews/daonfit", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then(({ items = [] }) => {
      const list = items.filter((review) => review.product === product);
      if (!list.length) {
        mount.innerHTML = '<p class="rv-empty">아직 등록된 후기가 없어요.</p>';
        return;
      }
      const avg = list.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / list.length;
      mount.innerHTML =
        `<div class="rv-summary"><span class="rv-avg">★ ${avg.toFixed(1)}</span>` +
        `<span class="rv-count">후기 ${list.length}개</span></div>` +
        list.map((review) => `
          <article class="rv-item">
            <p class="rv-head"><b>${esc(review.nick)}</b>
              <span class="rv-stars" aria-label="별점 ${Math.round(review.rating)}점">${stars(review.rating)}</span>
              <span class="rv-date">${dateOf(review.date)}</span></p>
            <p class="rv-text">${esc(review.text)}</p>
          </article>`).join("");
    })
    .catch(() => { mount.innerHTML = '<p class="rv-empty">후기를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>'; });
})();
