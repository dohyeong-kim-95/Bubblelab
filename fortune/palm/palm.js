// 손금 보기(베타) 화면 모듈 — mountPalm(root, opts). 원본은 fortune/palm/(운세 코드의 최종 집). util/fortune/palm/ 페이지는
// 이주(M4.5) 동안 _infra/build.mjs 가 util/fortune/palm/ 로 복사해 둔 것을 쓰고, 종합 노트(fortune/index.html)의 손금 칸도 같은 모듈.
// 서버는 _infra/fortune.js 의 handleFortunePalm, 판독은 집 PC(_src/util-palm-sink).
// 사진은 이 화면 안 카메라로 찍는 게 기본(getUserMedia, 뒤 카메라). 권한이 막혔거나 카메라가 없으면 조용히 갤러리 고르기로.
// 찍은 프레임·고른 사진은 긴 변 1800 JPEG 로 줄여(갤러리 사진은 EXIF 대로 세워) 바로 올리고, 결과 선은 폰에 남은 그 사진 위에 그린다.
// 왼손·오른손은 묻지 않는다(hand=auto) — 판독이 사진에서 알아보고 결과의 hand.detected 를 화면에 적는다.
// 결과 JSON 은 palm.m2.v1(설계 palm/lab/BUILD-M2.md §3) — 좌표는 0~1 비율. 이름표 자리는 labels.js.
// 부품은 id 로 찾는다(한 화면에 손금 칸은 하나) — 마크업은 아래 TEMPLATE 한 곳.
import { anchorsOf, placeLabels } from "./labels.js";
import { palmLineSummary, palmLineView, traitId } from "../lib/palm-lines.js";   // 선별 풀이 문구 원본(상담 노트와 같이 씀)

const TEMPLATE = (privacyHref, keepNote) => `
    <span class="tape"></span>
    <p class="small" id="palm-loading">잠깐만요…</p>

    <div id="palm-rest" hidden>
      <p class="hand h-sub faint">지금은 손금 보기가 잠시 쉬어요.</p>
      <p class="small">조금 뒤에 다시 와 주세요.</p>
    </div>

    <form id="palm-form" novalidate hidden>
      <div class="consent">
        <button type="button" class="check" id="palm-consent" role="checkbox" aria-checked="false" aria-labelledby="palm-consent-text"></button>
        <p id="palm-consent-text"><b>사진은 보관하지 않아요.</b> 손금을 읽는 동안만 잠깐 올라가고, 다 읽으면 바로 지워요(늦어도 하루 안에). 읽을 때 AI(Claude)가 사진을 봐요. 결과는 이 화면에만 보여 드리고 한 시간 뒤 지워요.${keepNote ? " 결과 중 선마다 읽은 글과 특성 목록(예: ‘감정을 차분하게 다루는 편’)만 이 기기의 노트에 남겨요. 사진과 선 위치는 남기지 않아요." : ""} <a class="link" href="${privacyHref}">개인정보처리방침</a></p>
      </div>

      <!-- 기본은 이 화면 안 카메라. 막혀 있거나 없으면 갤러리 고르기로 -->
      <div class="palm-cam" id="palm-cam" hidden>
        <video id="palm-video" playsinline muted autoplay aria-label="카메라 미리보기"></video>
        <svg class="palm-guide" viewBox="0 0 100 140" aria-hidden="true">
          <rect x="22" y="58" width="56" height="62" rx="20"/>
          <rect x="24" y="22" width="11" height="42" rx="5.5"/>
          <rect x="37" y="12" width="11" height="50" rx="5.5"/>
          <rect x="50" y="14" width="11" height="48" rx="5.5"/>
          <rect x="63" y="24" width="10" height="40" rx="5"/>
          <rect x="74" y="66" width="10" height="34" rx="5" transform="rotate(-38 79 83)"/>
        </svg>
        <div class="palm-cam-bar">
          <label class="palm-cam-gallery" for="palm-file">🖼️ 갤러리에서 찾기</label>
          <button type="button" class="palm-shutter" id="palm-shutter" aria-label="찍기"></button>
          <span class="palm-cam-space"></span>
        </div>
      </div>
      <div id="palm-nocam" hidden>
        <p class="small faint" id="palm-nocam-why">카메라를 열 수 없어서 갤러리에서 골라 주세요.</p>
        <label class="pen sm" for="palm-file">🖼️ 갤러리에서 찾기 →</label>
      </div>
      <input type="file" id="palm-file" accept="image/*" class="palm-file">
      <p class="small faint">손바닥 전체가 들어오게, 밝은 쪽을 보고 찍으면 선이 더 잘 보여요. 왼손·오른손은 사진에서 알아봐요.</p>

      <div id="palm-held" hidden>
        <canvas id="palm-preview" class="palm-photo"></canvas>
        <button type="submit" class="pen sm" id="palm-send">이 사진으로 손금 봐 주세요 →</button>
        <button type="button" class="link small" id="palm-reshoot">다시 찍기</button>
      </div>
      <p class="err small red" id="palm-err" role="alert"></p>
    </form>

    <div id="palm-wait" hidden aria-live="polite">
      <p class="hand h-sub say" id="palm-wait-title">손금을 읽고 있어요…</p>
      <p class="small" id="palm-wait-sub">보통 30초쯤 걸려요. 이 화면을 닫지 말아 주세요.</p>
    </div>

    <div id="palm-result" hidden>
      <canvas id="palm-canvas" class="palm-photo" aria-label="손금 선을 그린 사진"></canvas>
      <p class="palm-legend small" id="palm-legend"></p>
      <div class="palm-reading" id="palm-reading"></div>
      <div id="palm-traits-box" hidden>
        <p class="hand h-sub say gap-s">이런 편이에요</p>
        <ul class="palm-traits" id="palm-traits"></ul>
      </div>
      <p class="small faint" id="palm-tip" hidden></p>
      <button type="button" class="pen sm" id="palm-again">다른 사진으로 →</button>
    </div>

    <div id="palm-fail" hidden>
      <p class="hand h-sub red" id="palm-fail-msg"></p>
      <button type="button" class="pen sm" id="palm-retry">다시 해 볼게요 →</button>
    </div>
`;

// ── 화면과 노트(fortune/notebook)가 같이 쓰는 부품 ──
export const PALM_API = "/_fortune/palm";
const API = PALM_API;
const LONG_SIDE = 1800;
const POLL_MS = 2000, POLL_LIMIT_MS = 5 * 60_000;
// 실패 문구 — 설계 문서 §3-2 표 그대로(TIMEOUT 은 INTERNAL 문구)
export const PALM_MSG = {
  BAD_IMAGE: "사진 파일을 열 수 없어요. 다른 사진으로 한 번 더 올려 주세요.",
  NO_HAND: "사진에서 손을 찾지 못했어요. 손바닥 전체가 화면에 들어오게 찍어 주세요.",
  NOT_PALM: "손바닥이 아닌 쪽(손등 등)이 찍힌 것 같아요. 손바닥이 보이게 찍어 주세요.",
  LLM_ERROR: "잠시 손금을 읽지 못했어요. 조금 뒤에 다시 시도해 주세요.",
  INTERNAL: "처리 중 문제가 생겼어요. 조금 뒤에 다시 시도해 주세요.",
};
PALM_MSG.TIMEOUT = PALM_MSG.INTERNAL;
export const LINE_NAMES = { life: "생명선", head: "두뇌선", heart: "감정선", fate: "운명선" };
const NAMES = LINE_NAMES;
const ORDER = ["fate", "life", "head", "heart"];   // 운명선을 먼저 깔고 나머지를 위에

// ── 사진: EXIF 방향대로 세운 뒤 긴 변 1800 으로 ──
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
    img.src = url;
  });
}
export async function preparePhoto(file) {
  const img = await loadImage(file);
  return shrink(img, img.naturalWidth, img.naturalHeight);
}
export async function shrink(src, w0, h0) {
  if (!w0 || !h0) throw new Error("decode");
  const k = Math.min(1, LONG_SIDE / Math.max(w0, h0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w0 * k);
  canvas.height = Math.round(h0 * k);
  canvas.getContext("2d").drawImage(src, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("encode");
  return { canvas, blob };
}
// ── 결과: 폰에 남은 사진 위에 선 ──
export function drawLines(canvas, r) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, unit = Math.max(W, H);
  const lw = Math.max(3, unit / 230);
  const lines = r.lines || {};
  const lifeColor = lines.life?.color || "#e4572e";
  const labels = [];
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const key of ORDER) {
    const line = lines[key];
    if (!line?.drawn || !Array.isArray(line.pieces) || !line.pieces.length) continue;
    const merged = key === "fate" && r.merged_life_fate;
    const color = merged ? lifeColor : line.color;
    for (const [stroke, width] of [["#ffffff", lw * 2.1], [color, lw]]) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      for (const piece of line.pieces) {
        if (!Array.isArray(piece) || piece.length < 2) continue;
        ctx.beginPath();
        piece.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
        ctx.stroke();
      }
    }
    if (!merged) labels.push({ key, text: NAMES[key], color, anchors: anchorsOf(line.pieces, W, H) });
  }
  // 알약 라벨은 선 시작 쪽에, 서로 겹치지 않고 사진 안에(labels.js — 설계 line-drawing §5-4)
  const fs = Math.max(14, unit / 42);
  ctx.font = `600 ${fs}px "NoteBody", sans-serif`;
  const ph = fs * 1.5;
  for (const l of labels) { l.w = ctx.measureText(l.text).width + fs; l.h = ph; }
  const spots = placeLabels(labels, W, H, { gap: lw * 2 + 4, margin: 6 });
  canvas.dataset.labels = JSON.stringify(spots.map((s) => ({ key: s.key, x: Math.round(s.x), y: Math.round(s.y), w: Math.round(s.w), h: Math.round(s.h) })));
  for (const [i, l] of labels.entries()) {
    const { x, y, w: pw } = spots[i];
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - 2, y - 2, pw + 4, ph + 4, (ph + 4) / 2) : ctx.rect(x - 2, y - 2, pw + 4, ph + 4);
    ctx.fill();
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, pw, ph, ph / 2) : ctx.rect(x, y, pw, ph);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(l.text, x + fs / 2, y + ph / 2);
  }
}


// 손금방이 열려 있는지(집 PC 가 살아 있는지)
export async function palmStatus() {
  try {
    const res = await fetch(`${API}/status`, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
// 사진 한 장 올리기 → {id, position} | {error: "offline"|"busy"|"rate"|"image"|"internal"|"network"}
export async function submitPalm(blob) {
  try {
    const res = await fetch(`${API}/jobs?hand=auto`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.id) return { id: body.id, position: body.position ?? 0 };
    if (body.error === "offline" || body.error === "disabled") return { error: "offline" };
    return { error: body.error === "busy" ? "busy" : res.status === 429 ? "rate" : res.status === 413 || body.error === "image" ? "image" : "internal" };
  } catch { return { error: "network" }; }
}
// 결과 기다리기 → {ok:true, result} | {ok:false, code, message}. onState(state, ahead, online) 로 기다리는 동안 알린다.
export async function waitPalm(id, onState = () => {}) {
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (Date.now() - started > POLL_LIMIT_MS) return { ok: false, code: "TIMEOUT" };
    let s;
    try {
      const res = await fetch(`${API}/jobs/${id}`, { cache: "no-store" });
      if (res.status === 404) return { ok: false, code: "INTERNAL" };
      if (!res.ok) continue;
      s = await res.json();
    } catch { continue; }
    if (s.state === "done" && s.result?.ok) return { ok: true, result: s.result };
    if (s.state === "failed" || s.state === "done") return { ok: false, code: s.result?.error?.code, message: s.result?.error?.message };
    onState(s.state, s.position ?? 0, s.online);
  }
}

// root 에 손금 칸을 그리고 시작한다. opts.onResult(result) — 판독 결과(palm.m2.v1)를 받은 순간 한 번.
// opts.onRest() — 손금방이 쉬는 중일 때. 돌려주는 close() 는 카메라를 끈다(칸을 닫을 때).
export function mountPalm(root, { onResult = null, onRest = null, privacyHref = "../privacy/", keepNote = false } = {}) {
  root.innerHTML = TEMPLATE(privacyHref, keepNote);   // 고정 문구뿐(사용자·서버 값 없음)
  const $ = (id) => document.getElementById(id);
  const N = window.Note;
  const MSG = PALM_MSG;

  let consent = false, photo = null, busy = false, stream = null, closed = false;
  const show = (id) => {
    for (const s of ["palm-loading", "palm-rest", "palm-form", "palm-wait", "palm-result", "palm-fail"]) $(s).hidden = s !== id;
    if (id === "palm-form" && !photo) startCamera(); else stopCamera();
    (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(draw));
  };

  // ── 연필 표시(동의 체크) ──
  function draw() {
    $("palm-consent").setAttribute("aria-checked", String(consent));   // 연필 부품(Note)이 없는 화면도 상태는 남긴다
    if (!N) return;
    if ($("palm-consent").offsetParent) N.checkbox($("palm-consent"), consent);
  }
  $("palm-consent").addEventListener("click", () => { consent = !consent; draw(); });

  const paint = (target, src) => {
    target.width = src.width;
    target.height = src.height;
    target.getContext("2d").drawImage(src, 0, 0);
    target.hidden = false;
  };
  // ── 이 화면 안 카메라 ── 뒤 카메라 실시간 미리보기 + 셔터. 찍거나 화면을 떠나면 스트림을 반드시 끈다.
  async function startCamera() {
    if (closed || stream || photo) return;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia || !isSecureContext) return noCamera("카메라를 쓸 수 없어서 갤러리에서 골라 주세요.");
    try {
      stream = await md.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } } });
    } catch (e) {
      stream = null;
      return noCamera(e?.name === "NotAllowedError" ? "카메라가 막혀 있어서 갤러리에서 골라 주세요." : "카메라를 열 수 없어서 갤러리에서 골라 주세요.");
    }
    if ($("palm-form").hidden || photo) return stopCamera();   // 기다리는 사이 화면이 바뀌었으면 바로 끈다
    const video = $("palm-video");
    video.srcObject = stream;
    $("palm-cam").hidden = false;
    $("palm-nocam").hidden = true;
    video.play?.().catch(() => {});
  }
  function stopCamera() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    const video = $("palm-video");
    if (video) video.srcObject = null;
    $("palm-cam").hidden = true;
  }
  function noCamera(why) {
    stopCamera();
    $("palm-nocam-why").textContent = why;
    $("palm-nocam").hidden = false;
  }
  addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCamera();
    else if (!$("palm-form").hidden && !photo) startCamera();
  });
  $("palm-shutter").addEventListener("click", async () => {
    const video = $("palm-video");
    if (!stream || !video.videoWidth) return;
    try {
      const shot = await shrink(video, video.videoWidth, video.videoHeight);
      stopCamera();
      take(shot);
    } catch { $("palm-err").textContent = MSG.BAD_IMAGE; }
  });

  // 갤러리에서 고른 사진
  $("palm-file").addEventListener("change", async () => {
    const file = $("palm-file").files?.[0];
    $("palm-err").textContent = "";
    if (!file) return;
    try {
      const picked = await preparePhoto(file);
      stopCamera();
      take(picked);
    } catch {
      $("palm-err").textContent = MSG.BAD_IMAGE;
    }
  });

  // 사진이 생기면 바로 판독을 시작한다. 동의 체크만 안 됐으면 사진을 들고 한 번 묻는다.
  function take(shot) {
    photo = shot;
    $("palm-nocam").hidden = true;
    if (consent) return send();
    paint($("palm-preview"), photo.canvas);
    $("palm-held").hidden = false;
    $("palm-err").textContent = "위 안내를 읽고 체크해 주시면 이 사진으로 바로 볼게요.";
    draw();
  }
  $("palm-reshoot").addEventListener("click", () => again());

  // ── 보내기 → 기다리기 ──
  $("palm-form").addEventListener("submit", (e) => { e.preventDefault(); send(); });
  async function send() {
    if (busy) return;
    const err = $("palm-err");
    err.textContent = "";
    if (!photo) { err.textContent = "손바닥 사진을 찍거나 골라 주세요."; return; }
    if (!consent) { err.textContent = "안내를 읽고 체크해 주셔야 손금을 볼 수 있어요."; return; }
    busy = true;
    $("palm-send").disabled = true;
    try {
      const res = await fetch(`${API}/jobs?hand=auto`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: photo.blob });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.id) return wait(body.id, body.position ?? 0);
      if (body.error === "offline" || body.error === "disabled") return show("palm-rest");
      err.textContent = body.error === "busy" ? "지금 기다리는 분이 많아요. 조금 뒤에 다시 시도해 주세요."
        : res.status === 429 ? "조금 쉬었다가 다시 시도해 주세요."
        : res.status === 413 || body.error === "image" ? MSG.BAD_IMAGE : MSG.INTERNAL;
    } catch {
      err.textContent = "인터넷 연결을 확인하고 다시 시도해 주세요.";
    } finally {
      busy = false;
      $("palm-send").disabled = false;
    }
  }

  async function wait(id, position) {
    show("palm-wait");
    const started = Date.now();
    const say = (state, ahead, online) => {
      $("palm-wait-title").textContent = state === "running" ? "손금을 읽고 있어요…" : ahead > 0 ? `앞에 ${ahead}분이 기다리고 있어요.` : "곧 읽기 시작해요…";
      $("palm-wait-sub").textContent = online === false ? "지금은 손금 보기가 잠시 쉬어요. 다시 켜지면 이어서 읽어요."
        : "보통 30초쯤 걸려요. 이 화면을 닫지 말아 주세요.";
    };
    say("queued", position, true);
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (Date.now() - started > POLL_LIMIT_MS) return fail("TIMEOUT");
      let s;
      try {
        const res = await fetch(`${API}/jobs/${id}`, { cache: "no-store" });
        if (res.status === 404) return fail("INTERNAL");
        if (!res.ok) continue;
        s = await res.json();
      } catch { continue; }
      if (s.state === "done" && s.result?.ok) return result(s.result);
      if (s.state === "failed" || s.state === "done") {
        const e = s.result?.error ?? {};
        return fail(e.code, e.message);
      }
      say(s.state, s.position ?? 0, s.online);
    }
  }

  function fail(code, message) {
    $("palm-fail-msg").textContent = message || MSG[code] || MSG.INTERNAL;
    show("palm-fail");
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  /** 풀이 markdown — ### 제목, **굵게**, - 목록, 빈 줄 문단만 쓴다. */
  function renderReading(md) {
    const out = [];
    let list = null;
    for (const block of String(md || "").split(/\n{2,}/)) {
      for (const raw of block.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        if (/^[-*] /.test(line)) { if (!list) { list = []; } list.push(`<li>${inline(line.slice(2))}</li>`); continue; }
        if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
        const h = /^#{1,4}\s+(.*)$/.exec(line);
        out.push(h ? `<p class="hand h-sub say gap-s">${inline(h[1])}</p>` : `<p>${inline(line)}</p>`);
      }
      if (list) { out.push(`<ul>${list.join("")}</ul>`); list = null; }
    }
    return out.join("");
  }

  // 선별 풀이 칸 — 선마다 이름(그 선 색)·보인 정도·모양·한 단락. 문구는 lib/palm-lines.js(상담 노트와 같은 원본).
  function lineBlock(paras) {
    const box = Object.assign(document.createElement("div"), { className: "palm-lines", id: "palm-lines" });
    box.append(Object.assign(document.createElement("p"), { className: "hand h-sub say gap-s", textContent: "선마다 읽어 보면" }));
    for (const p of paras) {
      const row = Object.assign(document.createElement("div"), { className: `palm-line ${p.seen}` });
      row.dataset.line = p.key;
      row.dataset.seen = p.seen;
      row.style.setProperty("--lc", p.color);
      const head = Object.assign(document.createElement("p"), { className: "pl-head" });
      head.append(Object.assign(document.createElement("b"), { textContent: p.name }), Object.assign(document.createElement("span"), { className: "pl-chip", textContent: p.chip }));
      row.append(head);
      if (p.from === "reading" && p.shapes.length) row.append(Object.assign(document.createElement("p"), { className: "pl-shapes small faint", textContent: `모양: ${p.shapes.join(" · ")}` }));
      row.append(Object.assign(document.createElement("p"), { className: "pl-body", textContent: p.body }));
      box.append(row);
    }
    return box;
  }
  // 풀이 markdown 에서 선 단락(**생명선** …)을 걷어 낸다 — 선별 풀이 칸이 대신 쓴다. 비게 된 제목은 같이 뺀다. → [첫 절, 나머지]
  function splitReading(md) {
    const sections = [];
    for (const line of String(md || "").split("\n")) {
      if (/^\s*\*\*(생명선|두뇌선|감정선|운명선)\*\*/.test(line)) continue;
      if (/^#{1,4}\s/.test(line.trim()) || !sections.length) sections.push([]);
      sections.at(-1).push(line);
    }
    const kept = sections.filter((sec) => sec.some((l) => l.trim() && !/^#{1,4}\s/.test(l.trim())));
    return [kept.slice(0, 1), kept.slice(1)].map((xs) => xs.map((sec) => sec.join("\n")).join("\n\n"));
  }

  function result(r) {
    if (photo) { paint($("palm-canvas"), photo.canvas); drawLines($("palm-canvas"), r); }
    else $("palm-canvas").hidden = true;
    const drawn = ORDER.filter((k) => r.lines?.[k]?.drawn && !(k === "fate" && r.merged_life_fate));
    const side = { left: "왼손", right: "오른손" }[r.hand?.detected];
    const lines = drawn.length ? `그린 선: ${["life", "head", "heart", "fate"].filter((k) => drawn.includes(k)).map((k) => NAMES[k]).join(" · ")}` : "";
    $("palm-legend").textContent = [side ? `${side}으로 봤어요.` : "", lines].filter(Boolean).join(" ");
    const { paras, dropped } = palmLineView(palmLineSummary(r));
    if (paras.length) {
      const [lead, rest] = splitReading(r.reading?.markdown);
      $("palm-reading").innerHTML = renderReading(lead);
      $("palm-reading").append(lineBlock(paras));
      $("palm-reading").insertAdjacentHTML("beforeend", renderReading(rest));
    } else $("palm-reading").innerHTML = renderReading(r.reading?.markdown);
    // 선 단락에서 빠진 뜻(같은 손금 안 반대 방향)은 특성 목록에도 쓰지 않는다
    const traits = (Array.isArray(r.traits) ? r.traits : []).filter((t) => !dropped.has(traitId(t.trait)));
    $("palm-traits").replaceChildren(...traits.map((t) => Object.assign(document.createElement("li"), { textContent: t.label })));
    $("palm-traits-box").hidden = !traits.length;
    $("palm-tip").textContent = r.photo?.tip ? `📷 ${r.photo.tip}` : "";
    $("palm-tip").hidden = !r.photo?.tip;
    show("palm-result");
    try { onResult?.(r); } catch { /* 노트 저장이 실패해도 결과 화면은 그대로 */ }
  }

  function again() {
    photo = null;
    $("palm-file").value = "";
    $("palm-held").hidden = true;
    $("palm-err").textContent = "";
    show("palm-form");
  }
  $("palm-again").addEventListener("click", again);
  $("palm-retry").addEventListener("click", again);

  (async () => {
    let s = null;
    try {
      const res = await fetch(`${API}/status`, { cache: "no-store" });
      if (res.ok) s = await res.json();
    } catch { /* 아래에서 쉬어요로 */ }
    show(s?.online ? "palm-form" : "palm-rest");
    if (!s?.online) onRest?.();
  })();
  return {
    close() { closed = true; stopCamera(); },
    open() { closed = false; if (!$("palm-form").hidden && !photo) startCamera(); },
  };
}
