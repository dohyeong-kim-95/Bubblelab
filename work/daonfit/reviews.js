// 품목별 상세페이지 리뷰·문의(Q&A) 위젯.
// - /_workreviews/daonfit : 리뷰(items) + 사용자 작성 후기(submitted) + 상품 문의
//   (questions). 백엔드는 커머스 API(현재 mock). 항목별 source로 출처를 구분 —
//   "naver"는 네이버 마크(N), 그 외(다온핏 자체 등록분)는 "다온핏" 배지.
// - /_workqna/daonfit : 다온핏 사이트 자체 문의(고객이 qna.html에서 남긴 것).
// - 후기 남기기: /_workreviews/daonfit/submit 로 POST → source "own"으로 저장.
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
  const ownBadge = '<img class="own-badge" src="../_work_assets/logo.png" alt="다온핏" title="다온핏 자체 등록">';
  const badgeFor = (isNaver) => (isNaver ? naverBadge : ownBadge);

  const jsonOrEmpty = (response) => (response.ok ? response.json() : { items: [], questions: [], submitted: [] });

  function load() {
    return Promise.all([
      fetch("/_workreviews/daonfit", { cache: "no-store" }).then(jsonOrEmpty).catch(() => ({ items: [], questions: [], submitted: [] })),
      fetch("/_workqna/daonfit", { cache: "no-store" }).then(jsonOrEmpty).catch(() => ({ items: [] })),
    ]).then(([store, ownQna]) => {
      renderReviews([...(store.items ?? []), ...(store.submitted ?? [])]);
      renderQna(store.questions ?? [], ownQna.items ?? []);
    });
  }

  function renderReviews(all) {
    if (!reviewsMount) return;
    const list = all.filter((review) => review.product === product)
      .sort((a, b) => (String(a.date) < String(b.date) ? 1 : -1));
    if (!list.length) {
      reviewsMount.innerHTML = '<p class="rv-empty">아직 등록된 후기가 없어요. 첫 후기를 남겨보세요!</p>';
      return;
    }
    const avg = list.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / list.length;
    reviewsMount.innerHTML =
      `<div class="rv-summary"><span class="rv-avg">★ ${avg.toFixed(1)}</span>` +
      `<span class="rv-count">후기 ${list.length}개</span></div>` +
      list.map((review) => `
        <article class="rv-item">
          <p class="rv-head"><b>${esc(review.nick)}</b>
            ${badgeFor(review.source === "naver")}
            <span class="rv-stars" aria-label="별점 ${Math.round(review.rating)}점">${stars(review.rating)}</span>
            <span class="rv-date">${dateOf(review.date)}</span></p>
          <p class="rv-text">${esc(review.text)}</p>
        </article>`).join("");
  }

  function renderQna(storeQuestions, ownItems) {
    if (!qnaMount) return;
    // 네이버/다온핏 mock 문의(store) + 이 상품에 대한 다온핏 자체 문의(WorkQnaDO)를
    // 합쳐 최신순 정렬. 출처는 항목별 source로 구분한다.
    const fromStore = storeQuestions
      .filter((q) => q.product === product)
      .map((q) => ({ nick: q.nick, question: q.question, answer: q.answer, date: dateOf(q.date), isNaver: q.source === "naver" }));
    const displayName = PRODUCT_NAMES[product];
    const fromOwn = ownItems
      .filter((q) => q.product === displayName)
      .map((q) => ({ nick: q.nick, question: q.question, answer: q.answer, date: dateOf(q.askedAt), isNaver: false }));

    const list = [...fromStore, ...fromOwn].sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!list.length) {
      qnaMount.innerHTML = '<p class="rv-empty">아직 등록된 문의가 없어요. 궁금한 점은 문의 Q&amp;A에 남겨주세요.</p>';
      return;
    }
    qnaMount.innerHTML = list.map((item) => `
      <article class="qa-item">
        <p class="qa-q"><span class="qa-mark">Q</span>
          <span class="qa-body">${esc(item.question)}</span></p>
        <p class="qa-meta"><b>${esc(item.nick)}</b>
          ${badgeFor(item.isNaver)}
          <span class="rv-date">${item.date}</span></p>
        ${item.answer ? `<p class="qa-a"><span class="qa-mark ans">A</span>
          <span class="qa-body">${esc(item.answer)}</span></p>` : ""}
      </article>`).join("");
  }

  // 후기 남기기 버튼 + 폼을 리뷰 섹션에 주입하고 제출을 처리한다.
  function setupWriteUI() {
    if (!reviewsMount) return;
    const section = reviewsMount.closest(".reviews-section") || reviewsMount.parentNode;
    const wrap = document.createElement("div");
    wrap.className = "rv-write";
    wrap.innerHTML = `
      <button type="button" class="rv-write-toggle">✍️ 후기 남기기</button>
      <form class="rv-form" hidden>
        <input class="rv-nick" maxlength="20" placeholder="닉네임" aria-label="닉네임" required>
        <div class="rv-rate" role="radiogroup" aria-label="별점 선택">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rv-star on" data-n="${n}" aria-label="${n}점">★</button>`).join("")}
        </div>
        <textarea class="rv-textarea" maxlength="1000" placeholder="상품은 어떠셨나요? 솔직한 후기를 남겨주세요." aria-label="후기 내용" required></textarea>
        <p class="rv-note">후기는 이 페이지에 공개됩니다. 개인정보(전화번호·주소 등)는 적지 말아주세요.</p>
        <button type="submit" class="rv-submit">등록하기</button>
        <p class="rv-status" role="status"></p>
      </form>`;
    section.insertBefore(wrap, reviewsMount);

    const form = wrap.querySelector(".rv-form");
    const toggle = wrap.querySelector(".rv-write-toggle");
    const starButtons = [...wrap.querySelectorAll(".rv-star")];
    const status = wrap.querySelector(".rv-status");
    const submit = wrap.querySelector(".rv-submit");
    let rating = 5;

    const paint = () => starButtons.forEach((b) => b.classList.toggle("on", Number(b.dataset.n) <= rating));
    starButtons.forEach((b) => b.addEventListener("click", () => { rating = Number(b.dataset.n); paint(); }));

    toggle.addEventListener("click", () => {
      form.hidden = !form.hidden;
      if (!form.hidden) wrap.querySelector(".rv-nick").focus();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nick = wrap.querySelector(".rv-nick").value.trim();
      const text = wrap.querySelector(".rv-textarea").value.trim();
      if (!nick || !text) { status.textContent = "닉네임과 후기 내용을 채워주세요."; return; }
      submit.disabled = true;
      status.textContent = "";
      try {
        const response = await fetch("/_workreviews/daonfit/submit", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product, nick, rating, text }),
        });
        if (!response.ok) throw new Error(response.status);
        wrap.querySelector(".rv-textarea").value = "";
        status.textContent = "후기가 등록됐어요. 감사합니다!";
        form.hidden = true;
        await load();
      } catch (failure) {
        status.textContent = String(failure.message) === "429"
          ? "요청이 너무 잦아요. 잠시 후 다시 시도해주세요."
          : "등록하지 못했습니다. 잠시 후 다시 시도해주세요.";
      } finally {
        submit.disabled = false;
      }
    });
  }

  setupWriteUI();
  load();
})();
