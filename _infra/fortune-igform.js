// 만화 사주 신청서(util/fortune/insta/) 의 FortuneDO 몫 — 화면에 그려지지 않는 서버 코드라
// fortune.js(운세 노트 글꼴 조각 검사 대상)와 떼어 둔다. 워커 라우트·본문 검사는 fortune.js 의 handleFortuneIgForm.
//
// 저장 모양(2026-11-18 메일 접수창과 하나로 합침):
//   igform:round              { n, cap, count, open, opened } — admin 📸 에서 새 회차를 연다. 없으면 닫혀 있다.
//   igform:req:<id>           { id, contact:"instagram"|"email", handle, email?, name, birth, time, calendar, gender,
//                               round, seq, created, receipt(토큰 해시), failed?, link?, expires?, readyAt? }
//   igform:handle:<handle>    id — 같은 인스타 아이디가 대기 중이면 dup
//   igform:email:<해시32>      id — 같은 메일이 대기 중이면 dup(메일 원문은 키에 두지 않는다)
//   igform:receipt:<해시>      { id } 대기·완성 동안 | { link, expires, sent } 보낸 뒤(개인정보 없음)
//   igform:push:<id>          { subs:[{endpoint,keys}] } — 접수증의 「완성되면 알림 받기」(기기 2대까지). 접수증 해시로 찾은
//                             신청에 묶일 뿐 토큰 원문은 서버 어디에도 두지 않는다 — 완성 알림은 토큰 없는 접수증 주소를 열고, 화면이
//                             그 기기의 localStorage(구독할 때 적어 둔 토큰)로 복원한다. 처음 ready 때 한 번 보내고 바로 지우며,
//                             보냄·치우기·done 때도 지운다.
// 집 PC 가 ready(link) 를 보고해도 지우지 않는다 — 사람이 admin 에서 보내고 「보냄」을 누르면 이름·생년월일·연락처를
// 지우고 접수증에는 링크·만료만 남긴다. 링크 만료 뒤 RECEIPT_KEEP_MS 가 지나면 그것도 지운다.
import {
  comicMessage, IG_FORM_MSG, IG_FORM_ROUND_CAP, igFormFailedNotice, igFormNotice, igFormReadyNotice,
} from "./fortune-comic-notice.js";
import { sendWebPush, validPushSubscription } from "./webpush.js";

export const RECEIPT_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const RECEIPT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;   // 링크 만료 뒤 「만료」라고 알려 줄 기간
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;                // fortune-share.js SHARE_TTL_MS 와 같다
const ID_RE = /^[0-9a-f]{16}$/;
/** 새 회차 정원 — 정수 1..IG_FORM_ROUND_CAP 만, 없거나 범위 밖이면 기본(IG_FORM_ROUND_CAP). */
export function roundCap(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return Number.isInteger(n) && n >= 1 && n <= IG_FORM_ROUND_CAP ? n : IG_FORM_ROUND_CAP;
}
export const RECEIPT_PAGE_URL = "https://util.bubblelab.dev/fortune/receipt/";
export const MAX_RECEIPT_SUBS = 2;
export const RECEIPT_PUSH = { title: "만화 사주가 완성됐어요", body: "접수증에서 바로 보고 내려받을 수 있어요." };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (text) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** 접수증 토큰 — 32바이트 base64url(43자). 서버에는 해시만 남는다. */
export function newReceiptToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const receiptHash = (token) => sha256(`igform-receipt:${token}`);

async function dupKey(item) {
  if (item.contact === "email") return `igform:email:${(await sha256(String(item.email).toLowerCase())).slice(0, 32)}`;
  return `igform:handle:${item.handle}`;
}

// 집 PC 는 share 가 준 만료(ms 숫자)를 보낸다 — 문자열로 와도 읽고, 못 읽으면 ready 시각 + 7일.
export function parseExpires(value, from) {
  const s = String(value ?? "").trim();
  const n = /^\d{10,14}$/.test(s) ? Number(s.length <= 10 ? Number(s) * 1000 : s) : Date.parse(s);
  return Number.isFinite(n) && n > 0 ? n : from + LINK_TTL_MS;
}

const sortReqs = (list) => list.sort((a, b) => (a.round - b.round) || (a.seq - b.seq) || (a.created < b.created ? -1 : 1));
// 집 PC 가 아직 만들어야 하는 것 — 링크가 없고 멈추지 않은 것. 맨 앞이 지금 그리는 차례다.
const waiting = (reqs) => reqs.filter((r) => !r.link && !r.failed);

function stateOf(item, reqs, now) {
  if (item.link) return item.expires <= now ? "expired" : "ready";
  if (item.failed) return "failed";
  return waiting(reqs)[0]?.id === item.id ? "making" : "queued";
}

// 「내일 확인 알림을 캘린더에 넣기」 — 다음 날 10:00 KST 15분 일정 하나와 그 시각 알람. 토큰 없이 접수증 기본 주소만 싣는다
// (접수증은 이 기기에 적어 둔 토큰으로 다시 연다). 요청에 아무것도 받지 않으니 누구에게나 같은 파일이다.
const icsText = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
function foldIcs(line) {   // RFC 5545 — 75옥텟마다 접는다(한글이 3옥텟이라 글자 단위로 센다)
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
export function reminderIcs(now = Date.now()) {
  const kst = new Date(now + 9 * 3600 * 1000);   // KST 오늘 → 내일 10:00 KST = 01:00 UTC
  const day = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1));
  const ymd = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//bubblelab//fortune comic receipt//KO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:comic-check-${ymd}-${crypto.randomUUID()}@bubblelab.dev`,
    `DTSTAMP:${stamp}`, `DTSTART:${ymd}T010000Z`, `DTEND:${ymd}T011500Z`,
    `SUMMARY:${icsText("만화 사주 확인하기")}`,
    `DESCRIPTION:${icsText(`접수증에서 만화 사주가 완성됐는지 확인해 보세요. 신청한 기기에서 열면 접수증이 바로 떠요.\n${RECEIPT_PAGE_URL}`)}`,
    `URL:${RECEIPT_PAGE_URL}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText("만화 사주 확인하기")}`, "TRIGGER:PT0M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}

// 완성 알림 한 번 — 실패해도(만료 구독·설정 없음·네트워크) 부르는 쪽(ready 보고)은 깨지지 않는다. 보내든 못 보내든 지운다.
async function pushReady(storage, env, id, send) {
  const key = `igform:push:${id}`;
  const rec = await storage.get(key);
  if (!rec) return 0;
  await storage.delete(key);
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = env ?? {};
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return 0;
  const vapid = { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT || "https://util.bubblelab.dev" };
  const payload = JSON.stringify({ ...RECEIPT_PUSH, url: RECEIPT_PAGE_URL, tag: "comic-ready" });
  let sent = 0;
  for (const sub of rec.subs ?? []) {
    try {
      if ((await send(sub, payload, vapid, { ttl: 3 * 24 * 60 * 60 }))?.ok) sent += 1;
    } catch (error) {
      console.error("comic receipt push failed", error);
    }
  }
  return sent;
}

export async function igformInDO(storage, env, request, url, notify, send = sendWebPush) {
  const path = url.pathname;
  const now = Date.now();
  const round = (await storage.get("igform:round")) ?? null;
  const remainingOf = (r) => (r ? Math.max(0, r.cap - r.count) : 0);
  const statusOf = (r) => ({ open: !!r?.open && remainingOf(r) > 0, remaining: remainingOf(r), cap: r?.cap ?? IG_FORM_ROUND_CAP });
  const all = async () => sortReqs([...(await storage.list({ prefix: "igform:req:" })).values()]);
  const body = async () => (request.method === "POST" ? await request.json().catch(() => ({})) : {}) ?? {};
  const forget = async (item) => {   // 개인정보째 지운다(접수증 연결은 부르는 쪽이 정한다)
    await storage.delete(`igform:req:${item.id}`);
    await storage.delete(`igform:push:${item.id}`);
    await storage.delete(await dupKey(item));
  };
  const sweepReceipts = async () => {
    for (const [key, rec] of await storage.list({ prefix: "igform:receipt:" })) {
      if (rec?.sent && rec.expires + RECEIPT_KEEP_MS <= now) await storage.delete(key);
    }
  };

  if (path === "/igform/status" && request.method === "GET") return Response.json(statusOf(round));

  if (path === "/igform/request" && request.method === "POST") {
    const value = await body();
    if (!value?.contact || !/^[0-9a-f]{64}$/.test(value.receipt ?? "")) return Response.json({ error: "invalid" }, { status: 400 });
    const key = await dupKey(value);
    if (await storage.get(key)) return Response.json({ error: "dup", message: IG_FORM_MSG.dup }, { status: 409 });
    if (!round?.open) return Response.json({ error: "closed", message: IG_FORM_MSG.closed, ...statusOf(round) }, { status: 409 });
    if (round.count >= round.cap) return Response.json({ error: "full", message: IG_FORM_MSG.full, ...statusOf(round) }, { status: 409 });
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const next = { ...round, count: round.count + 1 };
    await storage.put(`igform:req:${id}`, { id, ...value, round: round.n, seq: next.count, created: new Date(now).toISOString() });
    await storage.put(key, id);
    await storage.put(`igform:receipt:${value.receipt}`, { id });
    await storage.put("igform:round", next);
    await notify(igFormNotice(next.count, next.cap));
    return Response.json({ ok: true, remaining: remainingOf(next) });
  }

  // 접수증 — 토큰 해시로만 찾는다. 대기(n번째) → 만드는 중 → 완성(링크) → 만료.
  if (path === "/igform/receipt" && request.method === "POST") {
    const { hash } = await body();
    if (!/^[0-9a-f]{64}$/.test(hash ?? "")) return Response.json({ error: "token" }, { status: 400 });
    const key = `igform:receipt:${hash}`;
    const rec = await storage.get(key);
    const item = rec?.id ? await storage.get(`igform:req:${rec.id}`) : null;
    const done = item?.link ? item : rec?.sent ? rec : null;
    if (done) {
      if (done.expires <= now) return Response.json({ state: "expired" });
      return Response.json({ state: "ready", link: done.link, expires: done.expires });
    }
    if (!item) return Response.json({ state: "unknown" });
    if (item.failed) return Response.json({ state: "delayed" });
    const queue = waiting(await all());
    const position = queue.findIndex((r) => r.id === item.id) + 1;
    return Response.json(position === 1 ? { state: "making" } : { state: "queued", position: Math.max(1, position) });
  }

  // 접수증의 「완성되면 알림 받기」 — 워커가 토큰을 본문으로 받아 해시만 넘긴다(DO 는 토큰 원문을 받지도 않는다). 아직 만들 것(대기·그리는 중·멈춤)에만.
  if (path === "/igform/receipt-push" && request.method === "POST") {
    const { hash, subscription } = await body();
    if (!/^[0-9a-f]{64}$/.test(hash ?? "")) return Response.json({ error: "token" }, { status: 400 });
    if (!validPushSubscription(subscription)) return Response.json({ error: "subscription" }, { status: 400 });
    const rec = await storage.get(`igform:receipt:${hash}`);
    const item = rec?.id ? await storage.get(`igform:req:${rec.id}`) : null;
    if (!item) return Response.json({ error: "unknown" }, { status: 404 });
    if (item.link) return Response.json({ error: "ready" }, { status: 409 });
    const key = `igform:push:${item.id}`;
    const sub = { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
    const others = ((await storage.get(key))?.subs ?? []).filter((s) => s.endpoint !== sub.endpoint);
    await storage.put(key, { subs: [...others, sub].slice(-MAX_RECEIPT_SUBS) });
    return Response.json({ ok: true });
  }

  // 집 PC 목록 — 아직 만들 것(멈춘 것은 failed 표시로)만. 완성돼 보낼 차례인 것은 admin 몫이라 빠진다.
  // 메일 주소·접수증 해시는 집 PC 에 주지 않는다(그리는 데 쓰지 않는다). handle 은 옛 집 PC 호환으로 늘 있다.
  if (path === "/igform/list" && request.method === "GET") {
    const requests = (await all()).filter((r) => !r.link).map((r) => ({
      id: r.id, contact: r.contact ?? "instagram", handle: r.handle ?? "", name: r.name, birth: r.birth, time: r.time ?? null,
      calendar: r.calendar, gender: r.gender, round: r.round, seq: r.seq, created: r.created, ...(r.failed ? { failed: r.failed } : {}),
    }));
    return Response.json({ requests });
  }

  if (path === "/igform/round" && request.method === "GET") {
    await sweepReceipts();
    const reqs = await all();
    const pending = reqs.map((r) => {
      const contact = r.contact ?? "instagram";
      const state = stateOf(r, reqs, now);
      return {
        id: r.id, round: r.round, seq: r.seq, created: r.created, contact,
        to: contact === "email" ? r.email : r.handle, name: r.name ?? "", state,
        ...(r.failed ? { failed: r.failed } : {}),
        ...(r.link ? { link: r.link, expires: r.expires, message: comicMessage(r.name ?? "", r.link) } : {}),
      };
    });
    return Response.json({ round, pending });
  }

  if (path === "/igform/round" && request.method === "POST") {
    const { action, id, cap } = await body();
    if (["sent", "retry", "drop"].includes(action)) {
      if (!ID_RE.test(id ?? "")) return Response.json({ error: "id" }, { status: 400 });
      const item = await storage.get(`igform:req:${id}`);
      if (!item) return Response.json({ error: "not found" }, { status: 404 });
      if (action === "sent") {
        if (!item.link) return Response.json({ error: "not ready" }, { status: 409 });
        await forget(item);
        if (item.receipt) await storage.put(`igform:receipt:${item.receipt}`, { link: item.link, expires: item.expires, sent: now });
        await sweepReceipts();
      } else if (action === "retry") {
        const { failed: _, ...rest } = item;
        await storage.put(`igform:req:${id}`, rest);
      } else {
        await forget(item);
        if (item.receipt) await storage.delete(`igform:receipt:${item.receipt}`);
      }
      return Response.json({ ok: true });
    }
    let next;
    if (action === "new") next = { n: (round?.n ?? 0) + 1, cap: roundCap(cap), count: 0, open: true, opened: new Date(now).toISOString() };
    else if ((action === "open" || action === "close") && round) next = { ...round, open: action === "open" };
    else return Response.json({ error: round ? "action" : "no-round" }, { status: 400 });
    await storage.put("igform:round", next);
    return Response.json({ round: next });
  }

  const m = /^\/igform\/(ready|done)\/([0-9a-f]{16})$/.exec(path);
  if (m && request.method === "POST") {
    const key = `igform:req:${m[2]}`;
    const item = await storage.get(key);
    if (!item) return Response.json({ error: "not found" }, { status: 404 });
    if (m[1] === "done") {   // 집 PC 가 보내지 않고 치운다
      await forget(item);
      if (item.receipt) await storage.delete(`igform:receipt:${item.receipt}`);
      return Response.json({ ok: true });
    }
    const got = await body();
    if (got.status === "failed") {
      await storage.put(key, { ...item, failed: got.reason || "unknown" });
      const notified = await notify(igFormFailedNotice(got.reason));
      return Response.json({ ok: true, notified });
    }
    // 완성 — 지우지 않고 링크를 붙여 둔다. 같은 보고가 다시 와도(집 PC 재시도) 알림은 처음 한 번만.
    const { failed: _, ...rest } = item;
    await storage.put(key, { ...rest, link: got.link, expires: parseExpires(got.expires, now), readyAt: item.readyAt ?? now });
    if (!item.link) {
      const ready = (await all()).filter((r) => r.link).length;
      await notify(igFormReadyNotice(ready));
      try { await pushReady(storage, env, item.id, send); } catch (error) { console.error("comic receipt push failed", error); }
    }
    return Response.json({ ok: true });
  }
  return new Response("not found", { status: 404 });
}
