// 품목별 상세페이지 리뷰·문의(Q&A) 위젯.
// - /_workreviews/daonfit : 네이버에서 동기화된 리뷰 + 상품 문의(백엔드는 커머스
//   API, 현재 mock). 네이버 출처(source: "naver")에는 네이버 마크를 붙인다.
// - /_workqna/daonfit : 다온핏 사이트 자체 문의(고객이 qna.html에서 남긴 것).
//   네이버 마크 없이 함께 노출한다.
// 현재 상품(window.blProduct)에 해당하는 항목만 골라 렌더한다.
(() => {
  const product = window.blProduct;
  if (!product) return;
  const reviewsMount = document.getElementById("reviews");
  const qnaMount = document.getElementById("qna");

  // 사이트 자체 문의(WorkQnaDO)는 product를 표시명으로 저장하므로 slug와 매핑한다.
  const PRODUCT_NAMES = {
    "keybox": "차량용 견인고리 비상키함",
    "parking-keyring": "주차위치 표시 슬라이드 키링",
    "vent-clip": "차량용 방향제 연장 클립",
    "mini-atm": "미니 ATM 저금통",
    "figure-stand": "티니핑 피규어 받침대",
  };

  const esc = (value) => String(value).replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[c]);
  const stars = (n) => "★★★★★☆☆☆☆☆".slice(5 - Math.round(n), 10 - Math.round(n));
  const dateOf = (s) => String(s || "").slice(0, 10).replaceAll("-", ".");
  const naverBadge = '<span class="nv-badge" title="네이버 스토어에서 가져온 항목" aria-label="네이버">N</span>';

  const jsonOrEmpty = (response) => (response.ok ? response.json() : { items: [], questions: [] });

  Promise.all([
    fetch("/_workreviews/daonfit", { cache: "no-store" }).then(jsonOrEmpty).catch(() => ({ items: [], questions: [] })),
    fetch("/_workqna/daonfit", { cache: "no-store" }).then(jsonOrEmpty).catch(() => ({ items: [] })),
  ]).then(([store, ownQna]) => {
    renderReviews(store.items ?? []);
    renderQna(store.questions ?? [], ownQna.items ?? []);
  });

  function renderReviews(all) {
    if (!reviewsMount) return;
    const list = all.filter((review) => review.product === product);
    if (!list.length) {
      reviewsMount.innerHTML = '<p class="rv-empty">아직 등록된 후기가 없어요.</p>';
      return;
    }
    const avg = list.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / list.length;
    reviewsMount.innerHTML =
      `<div class="rv-summary"><span class="rv-avg">★ ${avg.toFixed(1)}</span>` +
      `<span class="rv-count">후기 ${list.length}개</span></div>` +
      list.map((review) => `
        <article class="rv-item">
          <p class="rv-head"><b>${esc(review.nick)}</b>
            ${review.source === "naver" ? naverBadge : ""}
            <span class="rv-stars" aria-label="별점 ${Math.round(review.rating)}점">${stars(review.rating)}</span>
            <span class="rv-date">${dateOf(review.date)}</span></p>
          <p class="rv-text">${esc(review.text)}</p>
        </article>`).join("");
  }

  function renderQna(naverQna, ownItems) {
    if (!qnaMount) return;
    // 네이버 상품 문의 + 이 상품에 대한 다온핏 자체 문의를 합쳐 최신순 정렬.
    const fromNaver = naverQna
      .filter((q) => q.product === product)
      .map((q) => ({ nick: q.nick, question: q.question, answer: q.answer, date: dateOf(q.date), isNaver: true }));
    const displayName = PRODUCT_NAMES[product];
    const fromOwn = ownItems
      .filter((q) => q.product === displayName)
      .map((q) => ({ nick: q.nick, question: q.question, answer: q.answer, date: dateOf(q.askedAt), isNaver: false }));

    const list = [...fromNaver, ...fromOwn].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) {
      qnaMount.innerHTML = '<p class="rv-empty">아직 등록된 문의가 없어요. 궁금한 점은 문의 Q&amp;A에 남겨주세요.</p>';
      return;
    }
    qnaMount.innerHTML = list.map((item) => `
      <article class="qa-item">
        <p class="qa-q"><span class="qa-mark">Q</span>
          <span class="qa-body">${esc(item.question)}</span></p>
        <p class="qa-meta"><b>${esc(item.nick)}</b>
          ${item.isNaver ? naverBadge : '<span class="own-badge">다온핏</span>'}
          <span class="rv-date">${item.date}</span></p>
        ${item.answer ? `<p class="qa-a"><span class="qa-mark ans">A</span>
          <span class="qa-body">${esc(item.answer)}</span></p>` : ""}
      </article>`).join("");
  }
})();
