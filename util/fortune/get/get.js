// 만화 사주 다운로드 — 주소의 # 뒤 토큰으로 /_fortune/share/<토큰> 을 읽는다(토큰은 서버 로그·Referer 로 가지 않는다).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const token = location.hash.slice(1);
  const status = $("get-status");
  const gone = (msg) => { status.textContent = msg; };
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) { gone("주소가 올바르지 않아요. 받은 링크를 그대로 열어 주세요."); return; }
  const base = `/_fortune/share/${token}`;
  fetch(base, { cache: "no-store" }).then(async (res) => {
    if (res.status === 410) { gone("받을 수 있는 기간(7일)이 지나서 지워졌어요."); return; }
    if (!res.ok) { gone("불러오지 못했어요. 잠시 뒤에 다시 열어 주세요."); return; }
    const meta = await res.json();
    if (meta.title) $("get-title").textContent = `「${meta.title}」`;
    const left = Math.max(0, Math.ceil((meta.expires - Date.now()) / 86400000));
    $("get-expire").textContent = `이 링크는 ${left}일 뒤 자동으로 지워져요. 필요하면 미리 내려받아 두세요.`;
    if (meta.files.includes("saju_comic.pdf")) $("get-pdf").href = `${base}/saju_comic.pdf`; else $("get-pdf").hidden = true;
    if (meta.files.includes("comic.zip")) { $("get-zip").href = `${base}/comic.zip`; $("get-zip").hidden = false; }
    const pages = $("get-pages");
    for (const f of meta.files.filter((x) => x.endsWith(".jpg"))) {
      const img = document.createElement("img");
      img.src = `${base}/${f}`; img.alt = `만화 사주 ${f.slice(5, 7)}쪽`; img.loading = "lazy"; img.width = 720;
      pages.append(img);
    }
    status.hidden = true;
    $("get-body").hidden = false;
    const N = window.Note;
    if (N) (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(() =>
      document.querySelectorAll(".get-page .pen").forEach((b) => b.offsetParent && N.ring(b, N.INK.blue))));
  }).catch(() => gone("불러오지 못했어요. 인터넷 연결을 확인해 주세요."));
})();
