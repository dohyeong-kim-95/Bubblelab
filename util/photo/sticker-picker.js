// 스티커 고르기·누끼 — util/photo(네컷사진)·util/calendar(달력 배경)·util/chat(채팅)이 같이 쓴다.
// 폴더가 photo 안에 있는 것은 util 아래 폴더가 전부 카드로 잡히기 때문이다(_lib 같은 폴더를 두면
// 카테고리 홈에 카드가 생긴다). 다른 화면은 `../photo/sticker-picker.js` 로 불러온다.
//
// 사용: window.blStickers.cutoutStickerUrl(src) · isCutoutUrl(url) · setupPicker({...})
// 순수 함수 cutoutWhiteBackground 는 _infra/util-stickers.test.mjs 가 고정한다.
(() => {
  const STICKER_FILE = /\.(png|webp|jpe?g)$/i;

  const escapeText = (value) => String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);

  // 테두리에서 시작하는 flood fill로 흰 배경만 투명 처리 (그림 속 흰색은 유지)
  function cutoutWhiteBackground(imageData) {
    const { data, width, height } = imageData;
    // 이미 누끼가 된 PNG(모서리가 투명)는 건너뛴다. 생성 시점에 엄격한 임계값으로 땄는데
    // 여기서 느슨한 임계값으로 한 번 더 따면 투명 픽셀에서 번져 흰 몸통·털까지 지워진다.
    const corners = [0, width - 1, (height - 1) * width, height * width - 1];
    if (corners.some((p) => data[p * 4 + 3] === 0)) return;
    const whiteness = (i) => Math.min(data[i], data[i + 1], data[i + 2]);
    const visited = new Uint8Array(width * height);
    const queue = [];
    for (let x = 0; x < width; x++) queue.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) queue.push(y * width, y * width + width - 1);
    while (queue.length) {
      const p = queue.pop();
      if (visited[p]) continue;
      visited[p] = 1;
      const i = p * 4;
      const w = whiteness(i);
      if (w < 208) continue;
      // 235 이상은 완전 투명, 208~235는 경계 안티앨리어싱을 살려 반투명 처리
      data[i + 3] = w >= 235 ? 0 : Math.round(((235 - w) / 27) * 255);
      const x = p % width, y = (p / width) | 0;
      if (x > 0) queue.push(p - 1);
      if (x < width - 1) queue.push(p + 1);
      if (y > 0) queue.push(p - width);
      if (y < height - 1) queue.push(p + width);
    }
  }

  async function makeCutoutUrl(src) {
    const source = new Image();
    source.src = src;
    await source.decode();
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(source, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    cutoutWhiteBackground(imageData);
    context.putImageData(imageData, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("cutout failed");
    return URL.createObjectURL(blob);
  }

  // 같은 스티커는 한 번만 딴다. 캐시의 URL 은 다시 내주므로 화면이 회수(revoke)하면 안 된다 —
  // 회수 전에 isCutoutUrl 로 확인한다. 실패하면 캐시에서 빼서 다음에 다시 시도한다.
  const cutoutPromises = new Map();   // 원본 주소 → Promise<blob URL>
  const cutoutUrls = new Set();       // 이미 만들어진 blob URL
  function cutoutStickerUrl(src) {
    if (!cutoutPromises.has(src)) {
      const pending = makeCutoutUrl(src).then((url) => { cutoutUrls.add(url); return url; });
      pending.catch(() => cutoutPromises.delete(src));
      cutoutPromises.set(src, pending);
    }
    return cutoutPromises.get(src);
  }
  const isCutoutUrl = (url) => cutoutUrls.has(url);

  // 카카오톡 이모티콘 픽커처럼 팩 탭을 두고 현재 팩의 스티커만 로드한다.
  // 스티커를 눌렀을 때의 일(개수 제한·붙이기)은 화면마다 달라서 body 의 클릭은 화면이 받는다
  // (버튼은 `button[data-src]`). 돌려주는 open() 을 열기 버튼에 단다.
  function setupPicker({ picker, body, tabs, status, closeButton, readyText }) {
    let packs = null, activePack = 0;

    function renderPack(direction = 0) {
      const pack = packs[activePack];
      [...tabs.children].forEach((tab, index) => {
        tab.classList.toggle("on", index === activePack);
        if (index === activePack) tab.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      });
      status.textContent = `${pack.title} · ${readyText}`;
      body.innerHTML = pack.downloads
        .filter((download) => STICKER_FILE.test(download.file))
        .map((download) => `<button type="button" data-src="${escapeText(download.url)}" aria-label="${escapeText(download.label)}">
      <img src="${escapeText(download.url)}" alt="" loading="lazy" decoding="async"></button>`).join("");
      body.classList.remove("swap-left", "swap-right");
      if (direction) {
        void body.offsetWidth;
        body.classList.add(direction > 0 ? "swap-left" : "swap-right");
      }
    }

    // 그리드에서 좌우 스와이프로 이웃 팩으로 이동 (세로 스크롤과 구분)
    let packSwipe = null;
    body.addEventListener("touchstart", (event) => {
      packSwipe = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });
    body.addEventListener("touchend", (event) => {
      if (!packSwipe || !packs) return;
      const dx = event.changedTouches[0].clientX - packSwipe.x;
      const dy = event.changedTouches[0].clientY - packSwipe.y;
      packSwipe = null;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const next = activePack + (dx < 0 ? 1 : -1);
      if (next < 0 || next >= packs.length) return;
      activePack = next;
      renderPack(dx < 0 ? 1 : -1);
    }, { passive: true });

    tabs.addEventListener("click", (event) => {
      const tab = event.target.closest("button[data-pack]");
      if (!tab) return;
      activePack = Number(tab.dataset.pack);
      renderPack();
    });

    closeButton.addEventListener("click", () => { picker.hidden = true; });
    picker.addEventListener("click", (event) => { if (event.target === picker) picker.hidden = true; });

    async function open() {
      picker.hidden = false;
      if (packs) return;
      status.textContent = "스티커를 불러오는 중…";
      try {
        const response = await fetch("/_assets/catalog.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("catalog unavailable");
        const catalog = await response.json();
        const found = (catalog.items || []).filter((item) => item.category === "sticker"
          && item.downloads.some((download) => STICKER_FILE.test(download.file)));
        if (!found.length) { status.textContent = "아직 등록된 스티커가 없습니다."; return; }
        packs = found;
        tabs.hidden = false;
        tabs.innerHTML = packs.map((pack, index) =>
          `<button type="button" data-pack="${index}" aria-label="${escapeText(pack.title)}">
        <img src="${escapeText(pack.preview)}" alt="" decoding="async"></button>`).join("");
        renderPack();
      } catch (_) {
        status.textContent = "스티커 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";
      }
    }

    return open;
  }

  window.blStickers = { cutoutWhiteBackground, cutoutStickerUrl, isCutoutUrl, setupPicker };
})();
