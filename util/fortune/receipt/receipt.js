// 만화 사주 접수증 — 주소의 # 뒤 토큰을 본문(POST)으로만 보내 지금 상태를 묻는다(토큰은 주소·로그·Referer 로 가지 않는다).
// # 이 비어 있으면(홈 화면 앱·완성 알림·캘린더 일정으로 열 때) 이 기기에 적어 둔 토큰을 쓰고, 그것도 없으면 링크를 붙여 넣게 한다.
// 상태: queued(n번째) → making → ready(링크) → expired. delayed 는 그리다 멈춰 사람이 보는 중, unknown 은 못 찾음.
// 기다리는 동안 덤 두 가지: 완성되면 웹 푸시 한 번(아이폰은 홈 화면 앱에서만), 내일 확인 캘린더 일정(.ics, 토큰 없음).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const N = window.Note;
  const L = window.ReceiptLib;
  const RECEIPT_KEY = "bl-comic-receipt";
  const PUSH_KEY = "bl-comic-receipt-push";   // 알림을 켜 둔 접수증(토큰 해시가 아니라 "켰다"는 표시만 — 같은 토큰일 때만 켜짐으로 본다)
  const say = (head, text) => { $("rc-head").textContent = head; $("rc-text").textContent = text; };
  const ring = () => {
    if (!N) return;
    (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(() =>
      document.querySelectorAll(".receipt-page .pen").forEach((b) => b.offsetParent && N.ring(b, N.INK.blue))));
  };
  const load = (key) => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
  const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장이 막혀도 화면은 그대로 */ } };

  const hash = location.hash.slice(1);
  const token = L.tokenFrom(hash, load(RECEIPT_KEY));
  if (!token) {
    if (hash) { say("주소가 올바르지 않아요", "신청을 마치고 받은 링크를 그대로 열어 주세요."); return; }
    say("접수증 링크가 필요해요", "");
    $("rc-paste").hidden = false;
    $("rc-paste-go").addEventListener("click", () => {
      const got = L.tokenFromPaste($("rc-paste-input").value);
      if (!got) { $("rc-paste-err").textContent = "접수증 링크를 그대로 붙여 넣어 주세요."; return; }
      keep(RECEIPT_KEY, { token: got, at: Date.now() });
      location.reload();
    });
    ring();
    return;
  }
  // 이 기기에서 연 접수증은 신청서 화면·홈 화면 앱·캘린더 일정에서도 다시 찾을 수 있게 적어 둔다
  keep(RECEIPT_KEY, { token, at: Date.now() });
  const pageUrl = `${location.origin}${location.pathname}#${token}`;

  const day = (ms) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };
  let busy = false;
  async function look() {
    if (busy) return;
    busy = true;
    $("rc-again").disabled = true;
    try {
      const res = await fetch("/_fortune/ig-form/receipt", {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (res.status === 429) { say("잠시 뒤에 다시 봐 주세요", "너무 자주 열어서 잠깐 쉬고 있어요."); return; }
      const out = res.ok ? await res.json() : null;
      const st = out?.state;
      const waiting = st === "queued" || st === "making" || st === "delayed";
      $("rc-keep").hidden = !waiting;
      $("rc-extra").hidden = !waiting;
      $("rc-get-row").hidden = st !== "ready";
      $("rc-expire").hidden = st !== "ready";
      if (st === "queued") say("기다리는 중이에요", `지금 ${out.position}번째 차례예요. 신청하신 순서대로 하나씩 그려요.`);
      else if (st === "making") say("그리는 중이에요", "차례가 와서 지금 그리고 있어요.");
      else if (st === "delayed") say("조금 늦어지고 있어요", "그리다 멈춘 곳이 있어서 확인하고 있어요. 다시 그려서 보내 드릴게요.");
      else if (st === "ready") {
        say("완성됐어요!", "아래 버튼으로 바로 보고 내려받을 수 있어요.");
        const linkHash = new URL(out.link).hash;
        $("rc-get").href = `../get/${linkHash}`;
        $("rc-expire").textContent = `${day(out.expires)}까지 받을 수 있어요. 그 뒤에는 만화 파일이 지워지니 미리 내려받아 두세요.`;
      } else if (st === "expired") say("받을 수 있는 기간이 지났어요", "링크는 7일 동안만 열려요. 만화 파일은 지워졌어요.");
      else if (st === "unknown") say("이 링크로는 신청을 찾지 못했어요", "받은 링크를 그대로 열었는지 확인해 주세요. 기간이 지나 지워졌을 수도 있어요.");
      else say("불러오지 못했어요", "잠시 뒤에 다시 열어 주세요.");
      if (waiting) setupPush();
      ring();
    } catch {
      say("불러오지 못했어요", "인터넷 연결을 확인하고 다시 열어 주세요.");
    } finally {
      busy = false;
      $("rc-again").disabled = false;
    }
  }
  $("rc-again").addEventListener("click", look);
  $("rc-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(pageUrl); $("rc-copy").textContent = "복사했어요"; }
    catch { $("rc-copy").textContent = "주소창에서 복사해 주세요"; }
  });

  // ── 완성되면 알림 받기 ── 운세 노트와 같은 서비스워커(../sw.js, 자리 /fortune/)를 쓴다. 구독은 이 접수증 하나에만 묶이고,
  // 서버가 완성 때 한 번 보내고 지운다. 기기 구독을 끊지는 않는다(오늘의 운세 알림과 같은 구독일 수 있다).
  let pushReady = false;
  function setupPush() {
    if (pushReady) return;
    pushReady = true;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && isSecureContext;
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const mode = L.pushMode({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, standalone, supported });
    const help = $("rc-push-help");
    if (mode === "ios-guide") { $("rc-ios").hidden = false; return; }
    if (mode !== "button") { help.textContent = "이 브라우저는 알림을 받지 못해요. 캘린더 일정으로 챙겨 주세요."; return; }
    const on = load(PUSH_KEY)?.token === token;
    if (on) help.textContent = "알림을 켜 두었어요. 완성되면 한 번 알려 드려요.";
    $("rc-push-row").hidden = false;
    const btn = $("rc-push");
    const vapidKeyBytes = (b64u) => {
      const padded = b64u.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64u.length / 4) * 4, "=");
      return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    };
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      // 완성 알림은 토큰 없는 접수증 주소를 연다 — 이 기기(이 앱)의 저장소에 토큰이 꼭 있어야 한다
      keep(RECEIPT_KEY, { token, at: Date.now() });
      try {
        if ((await Notification.requestPermission()) !== "granted") {
          help.textContent = "브라우저 설정에서 알림을 허용해야 받을 수 있어요.";
          return;
        }
        const res = await fetch("/_fortune/push", { method: "GET", cache: "no-store" });
        const key = res.ok ? (await res.json()).vapidPublicKey : null;
        if (!key) { help.textContent = "지금은 알림을 켤 수 없어요. 캘린더 일정으로 챙겨 주세요."; return; }
        const registration = await navigator.serviceWorker.register("../sw.js");
        await navigator.serviceWorker.ready;
        const subscription = (await registration.pushManager.getSubscription())
          ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(key) });
        const saved = await fetch("/_fortune/ig-form/receipt/push", {
          method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, subscription }),
        });
        if (saved.status === 409) { look(); return; }   // 그새 완성됐다
        if (!saved.ok) throw new Error(`push ${saved.status}`);
        keep(PUSH_KEY, { token, at: Date.now() });
        help.textContent = "알림을 켜 두었어요. 완성되면 한 번 알려 드려요.";
      } catch {
        help.textContent = "알림을 켜지 못했어요. 잠시 뒤에 다시 해 주세요.";
      } finally {
        btn.disabled = false;
      }
    });
  }
  look();
})();
