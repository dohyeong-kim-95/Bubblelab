// 만화 사주 신청서 — 받을 곳은 인스타 아이디나 메일 주소 하나. 서버 검사는 _infra/fortune.js 의 validateIgForm,
// 상한은 회차(게시글)마다. 접수되면 접수증 주소(토큰은 # 뒤에만)를 보여 주고 이 기기에도 적어 둔다.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const N = window.Note;
  const HOURS = ["자시 23:30–01:29", "축시 01:30–03:29", "인시 03:30–05:29", "묘시 05:30–07:29", "진시 07:30–09:29", "사시 09:30–11:29",
    "오시 11:30–13:29", "미시 13:30–15:29", "신시 15:30–17:29", "유시 17:30–19:29", "술시 19:30–21:29", "해시 21:30–23:29"];
  for (const [i, label] of HOURS.entries()) $("insta-h").append(new Option(label, String(i)));

  let calendar = "solar", gender = "", contact = "instagram", consent = false, busy = false, done = false;
  const RECEIPT_KEY = "bl-comic-receipt";
  const receiptUrl = (token) => new URL(`../receipt/#${token}`, location.href).href;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(RECEIPT_KEY) || "null"); } catch { return null; } })();
  if (saved && /^[A-Za-z0-9_-]{43}$/.test(saved.token ?? "")) {
    $("insta-mine-link").href = receiptUrl(saved.token);
    $("insta-mine").hidden = false;
  }
  // 고른 칸은 연필 동그라미로(본 화면의 빈칸 문장과 같은 표시)
  const circle = (b) => {
    b.querySelector(":scope > svg.ring")?.remove();
    if (N && b.getAttribute("aria-pressed") === "true") N.ring(b, N.INK.blue);
  };
  const picks = (attr, value) => document.querySelectorAll(`[data-${attr}]`).forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset[attr] === value));
    circle(b);
  });
  document.querySelectorAll("[data-cal]").forEach((b) => b.addEventListener("click", () => {
    calendar = b.dataset.cal;
    picks("cal", calendar);
    $("insta-leap-row").hidden = calendar !== "lunar";
  }));
  document.querySelectorAll("[data-gender]").forEach((b) => b.addEventListener("click", () => { gender = b.dataset.gender; picks("gender", gender); }));
  // 받을 곳은 하나만 — 고르지 않은 칸은 비운다(서버도 둘 다 오면 거절한다)
  document.querySelectorAll("[data-contact]").forEach((b) => b.addEventListener("click", () => {
    contact = b.dataset.contact;
    picks("contact", contact);
    const mail = contact === "email";
    $("insta-handle-row").hidden = mail;
    $("insta-email-row").hidden = !mail;
    $((mail ? "insta-handle" : "insta-email")).value = "";
    $("insta-name-help").textContent = mail ? "안 적으면 이름 없이 그려요." : "안 적으면 아이디로 써요.";
  }));

  const draw = () => {
    if (!N) return;
    N.checkbox($("insta-consent"), consent);
    if ($("insta-send").offsetParent) N.ring($("insta-send"), N.INK.blue);
    document.querySelectorAll(".pick").forEach(circle);
  };
  $("insta-consent").addEventListener("click", () => { consent = !consent; draw(); });

  (async () => {
    let s = null;
    try { s = await (await fetch("/_fortune/ig-form/status", { cache: "no-store" })).json(); } catch { /* 아래에서 닫힘으로 */ }
    const open = !!s?.open;
    $("insta-form").hidden = !open;
    $("insta-closed").hidden = open;
    $("insta-left").textContent = open ? `이번 게시글 남은 자리 ${s.remaining}/${s.cap}` : "";
    (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(draw));
  })();

  const num = (id) => Number($(id).value.trim());
  $("insta-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || done) return;
    const err = $("insta-err");
    err.textContent = "";
    const handle = contact === "instagram" ? $("insta-handle").value.trim().replace(/^@+/, "").toLowerCase() : "";
    const email = contact === "email" ? $("insta-email").value.trim() : "";
    if (contact === "instagram" && !/^[a-z0-9._]{1,30}$/.test(handle)) { err.textContent = "인스타 아이디를 다시 확인해 주세요(영문·숫자·점·밑줄)."; $("insta-handle").focus(); return; }
    if (contact === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = "메일 주소를 다시 확인해 주세요."; $("insta-email").focus(); return; }
    const y = num("insta-y"), m = num("insta-m"), d = num("insta-d");
    if (!(y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) { err.textContent = "태어난 날을 다시 확인해 주세요."; $("insta-y").focus(); return; }
    if (!gender) { err.textContent = "성별을 골라 주세요."; return; }
    if (!consent) { err.textContent = "동의해 주셔야 그려 드릴 수 있어요."; return; }
    const h = $("insta-h").value;
    const body = {
      contact, ...(contact === "email" ? { email } : { handle }),
      name: $("insta-name").value.trim(), calendar, gender, consent: true, time: null, website: $("insta-web").value,
      birth: { y, m, d, h: h === "" ? null : Number(h), calendar, lunarLeap: calendar === "lunar" && $("insta-leap").checked },
    };
    const send = $("insta-send");
    send.disabled = true;
    busy = true;
    try {
      const res = await fetch("/_fortune/ig-form", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        done = true;
        $("insta-form").hidden = true;
        $("insta-left").textContent = "";
        $("insta-done-how").textContent = contact === "email" ? "다 되면 메일로 보내 드려요." : "다 되면 인스타 DM 으로 보내 드려요.";
        if (out.receipt) {
          const url = receiptUrl(out.receipt);
          try { localStorage.setItem(RECEIPT_KEY, JSON.stringify({ token: out.receipt, at: Date.now() })); } catch { /* 저장이 막혀도 링크는 보인다 */ }
          $("insta-receipt").href = url;
          $("insta-receipt").textContent = url;
          $("insta-mine").hidden = true;
          $("insta-copy").addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(url); $("insta-copy").textContent = "복사했어요"; }
            catch { $("insta-copy").textContent = "길게 눌러 복사해 주세요"; }
          });
        } else {
          $("insta-receipt").closest("p").hidden = true;
          $("insta-copy").hidden = true;
        }
        $("insta-done").hidden = false;
        if (N) requestAnimationFrame(() => N.ring($("insta-copy"), N.INK.blue));
        return;
      }
      err.textContent = res.status === 429 ? "잠시 뒤에 다시 보내 주세요."
        : { handle: "인스타 아이디를 다시 확인해 주세요.", email: "메일 주소를 다시 확인해 주세요.", contact: "인스타 아이디나 메일 주소 중 하나만 적어 주세요.",
          name: "이름은 12자 안으로 적어 주세요.", birth: "태어난 날을 다시 확인해 주세요.",
          consent: "동의해 주셔야 그려 드릴 수 있어요.", dup: "이미 접수됐어요. 다 되면 보내 드릴게요.",
          full: "이번 게시글 신청은 마감됐어요. 다음 게시글에서 만나요!", closed: "지금은 신청을 받지 않아요." }[out.error]
        ?? "보내지 못했어요. 잠시 뒤에 다시 해 주세요.";
    } catch {
      err.textContent = "보내지 못했어요. 인터넷 연결을 확인해 주세요.";
    } finally {
      busy = false;
      send.disabled = done;
    }
  });
})();
