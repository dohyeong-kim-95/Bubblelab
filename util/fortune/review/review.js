// 만화 사주 후기 — 별점·글·별명·소개 동의만 보낸다(연락처는 받지 않는다). 서버는 _infra/fortune.js 의 validateReview.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const N = window.Note;
  let rating = 0, publish = false;

  const stars = $("stars");
  const buttons = [1, 2, 3, 4, 5].map((n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "star";
    b.textContent = "★";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.setAttribute("aria-label", `${n}점`);
    b.addEventListener("click", () => setRating(n));
    stars.append(b);
    return b;
  });
  function setRating(n) {
    rating = n;
    buttons.forEach((b, i) => {
      b.classList.toggle("on", i < n);
      b.setAttribute("aria-checked", String(i + 1 === n));
    });
  }

  const text = $("review-text");
  text.addEventListener("input", () => { $("review-count").textContent = `${text.value.length} / 500`; });

  const draw = () => {
    if (!N) return;
    N.checkbox($("review-publish"), publish);
    if ($("review-send").offsetParent) N.ring($("review-send"), N.INK.blue);
  };
  (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(draw));
  $("review-publish").addEventListener("click", () => { publish = !publish; draw(); });

  // 보내는 중·보낸 뒤에는 다시 못 보낸다(2026-11-15 같은 후기가 20초 간격으로 두 번 들어왔다 — 서버도 10분 안 중복은 버린다).
  let busy = false, done = false;
  $("review-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || done) return;
    const err = $("review-err");
    err.textContent = "";
    const body = text.value.trim();
    if (!rating) { err.textContent = "별점을 골라 주세요."; return; }
    if (body.length < 5) { err.textContent = "다섯 글자 이상 적어 주세요."; text.focus(); return; }
    const send = $("review-send");
    send.disabled = true;
    busy = true;
    try {
      const res = await fetch("/_fortune/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, text: body, nick: $("review-nick").value, publish, website: $("review-web").value }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        done = true;
        $("review-form").hidden = true;
        $("review-done").hidden = false;
        return;
      }
      err.textContent = res.status === 429 ? "잠시 뒤에 다시 보내 주세요."
        : { rating: "별점을 골라 주세요.", text: "다섯 글자 이상, 500자 안으로 적어 주세요.", full: "후기 칸이 다 찼어요. 고마워요!" }[out.error]
        ?? "보내지 못했어요. 잠시 뒤에 다시 해 주세요.";
    } catch {
      err.textContent = "보내지 못했어요. 인터넷 연결을 확인해 주세요.";
    } finally {
      busy = false;
      send.disabled = done;   // 성공했으면 끝까지 잠근다
    }
  });
})();
