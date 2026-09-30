// 약속(util/yaksok) — 여럿이 날짜를 잡고, 만나고, 사진을 모으고, 정산하는 방.
// 방 하나가 YaksokDO 인스턴스 하나다(idFromName(코드)). 방들은 서로 모르므로 싱글턴에
// 모을 이유가 없고, 방마다 만료 알람을 따로 건다.
//
// 로그인은 없다. 참여하면 기기에 토큰을 주고 서버는 그 SHA-256 만 가진다. 링크를 아는
// 사람은 방을 볼 수 있고(카톡방이 곧 입장 경계), 무언가 바꾸려면 닉네임으로 참여한다.
// 송금 정보(카카오페이 링크·계좌)만은 참여자에게만 보인다.
//
// 사진은 R2 가 아니라 이 DO 저장소에 조각으로 둔다 — 방을 터트리면 deleteAll 한 번에
// 사진까지 사라지고, 방마다 50장·100MB 라 DO 한도(값 하나 2MB)만 조각으로 피하면 된다.
//
// 방은 저절로 사라진다 — 약속을 확정하면 그날로부터 30일, 확정하지 않으면 후보 기간
// 끝에서 30일. 방장이 터트리면 즉시 지우고 "터진 방"이라는 표시만 7일 남긴다.
import {
  AMOUNT_MAX, CAPACITY_DEFAULT, CODE_RE, NAME_MAX, NO, NONE, PHASES, PHOTO_BYTES_MAX, PHOTO_MAX, PHOTO_ONE_MAX,
  SLOT_LABEL, addDays, candidatePeriod, cleanAmount, cleanCapacity, cleanText, dateLabel, isValidDate,
  kakaopayUrl, kstToday, naverMapUrl, normalizeCode, phaseOf,
} from "../util/yaksok/logic.js";
import { parseReceipt } from "./yaksok-receipt.js";

const KEEP_DAYS = 30;
const TOMBSTONE_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
const PAGE_ORIGIN = "https://util.bubblelab.dev";
const CHUNK = 512 * 1024;            // DO 값 하나는 2MB 까지 — 넉넉히 잘라 둔다
const OG_MAX = 600 * 1024;
const EXPENSE_MAX = 100;
const PARSE_PER_DAY = 30;

const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const fail = (error, status, extra = {}) => json({ error, ...extra }, status);

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromBase64(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const isJpeg = (b) => b?.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b) => b?.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

const capacityOf = (room) => room.capacity ?? CAPACITY_DEFAULT;

// 만료 시각: 확정일(또는 후보 기간 끝) 다음 날 KST 0시 + 30일.
function expiryFor(room) {
  const base = room.confirmed?.date ?? room.period.end;
  return Date.parse(`${addDays(base, 1 + KEEP_DAYS)}T00:00:00+09:00`);
}

export class YaksokDO {
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const [action, arg] = url.pathname.slice(1).split("/");
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
    const token = request.headers.get("X-Yaksok-Token") ?? "";
    if (action === "init") return this.init(body);

    const room = await this.storage.get("room");
    if (!room) {
      const popped = await this.storage.get("popped");
      return popped ? fail("터트린 방이에요.", 410, { popped: true }) : fail("없는 방이에요.", 404);
    }
    if (request.method === "GET") {
      if (action === "photo") return this.photoFile(room, arg, url.searchParams.get("size"));
      if (action === "og") return this.ogFile(room);
    }
    const me = token ? await this.member(room, token) : null;
    if (action === "state") return json(this.view(room, me));
    if (action === "join") return this.join(room, me, body);
    if (!me) return fail("먼저 닉네임으로 참여해 주세요.", 401);

    // 참여자 누구나
    const member = {
      vote: () => this.vote(room, me, body),
      og: () => this.saveOg(room, me, body),
      photo: () => this.addPhoto(room, me, body),
      "photo-delete": () => this.deletePhoto(room, me, body),
      pay: () => this.setPay(room, me, body),
      expense: () => this.expense(room, me, body),
      sent: () => this.markSent(room, me, body),
      parse: () => this.parse(room, me, body),
    }[action];
    if (member) return member();

    if (me.id !== room.hostId) return fail("방장만 할 수 있어요.", 403);
    const host = {
      confirm: () => this.confirm(room, me, body),
      place: () => this.place(room, me, body),
      host: () => this.handOver(room, me, body),
      capacity: () => this.setCapacity(room, me, body),
      settle: () => this.setSettling(room, me, body),
      pop: () => this.pop(room, body),
    }[action];
    return host ? host() : fail("not found", 404);
  }

  async member(room, token) {
    const hash = await sha256(token);
    return room.members.find((m) => m.tokenHash === hash) ?? null;
  }

  view(room, me) {
    return {
      code: room.code,
      version: room.version ?? 0,
      period: room.period,
      phase: phaseOf(room, kstToday()),
      settling: Boolean(room.settling),
      members: room.members.map((m) => ({
        id: m.id, name: m.name, host: m.id === room.hostId,
        responded: Object.keys(room.votes[m.id] ?? {}).length > 0,
        // 송금 정보는 참여자에게만 — 링크만 아는 사람에게 계좌를 보이지 않는다.
        ...(me ? { pay: m.pay ?? null } : {}),
      })),
      votes: room.votes,
      confirmed: room.confirmed,
      place: room.place,
      photos: room.photos ?? [],
      photoBytes: (room.photos ?? []).reduce((n, p) => n + p.bytes, 0),
      expenses: room.expenses ?? [],
      sent: room.sent ?? {},
      og: room.og ?? null,
      expiresAt: room.expiresAt,
      me: me ? { id: me.id, name: me.name, host: me.id === room.hostId } : null,
      max: capacityOf(room),
    };
  }

  // 내용이 바뀔 때마다 version 을 올린다 — 미리보기 이미지가 어느 상태를 그린 것인지 가린다.
  async save(room, { content = true } = {}) {
    if (content) room.version = (room.version ?? 0) + 1;
    room.expiresAt = expiryFor(room);
    await this.storage.put("room", room);
    await this.storage.setAlarm(room.expiresAt);
  }

  ok(room, me, extra = {}) {
    return json({ state: this.view(room, me), ...extra });
  }

  async init(body) {
    if (await this.storage.get("room")) return fail("이미 있는 방이에요.", 409, { exists: true });
    if (await this.storage.get("popped")) {
      return fail("얼마 전 터트린 코드예요. 🎲 로 다른 코드를 골라 주세요.", 409, { popped: true });
    }
    const name = cleanText(body.name, NAME_MAX);
    if (!name || !CODE_RE.test(body.code ?? "")) return fail("닉네임을 적어 주세요.", 400);
    const capacity = body.capacity === undefined ? CAPACITY_DEFAULT : cleanCapacity(body.capacity);
    if (!capacity) return fail("정원은 2~20명 사이로 골라 주세요.", 400);
    const token = randomToken();
    const today = isValidDate(body.today) ? body.today : kstToday();
    const room = {
      code: body.code, createdAt: Date.now(), period: candidatePeriod(today), capacity, version: 0,
      hostId: "m1", nextId: 2,
      members: [{ id: "m1", name, tokenHash: await sha256(token), joinedAt: Date.now() }],
      votes: {}, confirmed: null, place: null, settling: false,
      photos: [], expenses: [], sent: {}, og: null,
    };
    await this.save(room);
    return json({ code: room.code, token, state: this.view(room, room.members[0]) }, 201);
  }

  async join(room, me, body) {
    if (me) return this.ok(room, me);
    const name = cleanText(body.name, NAME_MAX);
    if (!name) return fail("닉네임을 적어 주세요.", 400);
    if (room.members.length >= capacityOf(room)) {
      return fail(`이 방은 정원 ${capacityOf(room)}명이 다 찼어요. 방장에게 정원을 늘려 달라고 해 주세요.`, 409);
    }
    if (room.members.some((m) => m.name === name)) {
      return fail("이미 있는 닉네임이에요. 다른 기기에서 들어온 거라면 그 기기의 \"내 이어하기 링크\"로 열어 주세요.",
        409, { duplicate: true });
    }
    const token = randomToken();
    const member = { id: `m${room.nextId++}`, name, tokenHash: await sha256(token), joinedAt: Date.now() };
    room.members.push(member);
    await this.save(room);
    return json({ token, state: this.view(room, member) }, 201);
  }

  // 여러 날짜를 한 번에 받는다(화면이 연타를 모아 보낸다). 0 은 응답 지우기.
  async vote(room, me, body) {
    const changes = body.votes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) return fail("votes 가 필요해요.", 400);
    const entries = Object.entries(changes);
    if (entries.length > 100) return fail("한 번에 너무 많아요.", 400);
    const mine = { ...(room.votes[me.id] ?? {}) };
    for (const [date, state] of entries) {
      if (!isValidDate(date) || date < room.period.start || date > room.period.end) {
        return fail(`후보 기간 밖의 날짜예요: ${date}`, 400);
      }
      if (!Number.isInteger(state) || state < NONE || state > NO) return fail("응답 값이 올바르지 않아요.", 400);
      if (state === NONE) delete mine[date];
      else mine[date] = state;
    }
    if (Object.keys(mine).length) room.votes[me.id] = mine;
    else delete room.votes[me.id];
    await this.save(room);
    return this.ok(room, me);
  }

  async confirm(room, me, body) {
    if (body.date === null) {
      room.confirmed = null;
      room.settling = false;
    } else {
      if (!isValidDate(body.date) || body.date < room.period.start || body.date > room.period.end) {
        return fail("후보 기간 안의 날짜를 골라 주세요.", 400);
      }
      if (!["full", "lunch", "dinner"].includes(body.slot)) return fail("점심·저녁·전일 중에 골라 주세요.", 400);
      room.confirmed = { date: body.date, slot: body.slot, at: Date.now() };
    }
    await this.save(room);
    return this.ok(room, me);
  }

  async place(room, me, body) {
    if (body.url === null) {
      room.place = null;
    } else {
      const url = naverMapUrl(body.url);
      if (!url) return fail("네이버 지도 링크를 붙여 넣어 주세요 (naver.me/…).", 400);
      room.place = { name: cleanText(body.name, 40) ?? "약속 장소", url };
    }
    await this.save(room);
    return this.ok(room, me);
  }

  async handOver(room, me, body) {
    const target = room.members.find((m) => m.id === body.memberId);
    if (!target) return fail("없는 참여자예요.", 400);
    room.hostId = target.id;
    await this.save(room);
    return this.ok(room, me);
  }

  async setCapacity(room, me, body) {
    const capacity = cleanCapacity(body.capacity);
    if (!capacity) return fail("정원은 2~20명 사이로 골라 주세요.", 400);
    if (capacity < room.members.length) {
      return fail(`이미 ${room.members.length}명이 들어와 있어서 그보다 줄일 수 없어요.`, 400);
    }
    room.capacity = capacity;
    await this.save(room);
    return this.ok(room, me);
  }

  // 놀기 끝 → 정산. 약속일이 지나지 않았어도 당일 저녁에 나누는 게 보통이라 방장이 연다.
  async setSettling(room, me, body) {
    if (!room.confirmed) return fail("날짜를 먼저 확정해 주세요.", 400);
    room.settling = body.settling !== false;
    await this.save(room);
    return this.ok(room, me);
  }

  // ── 미리보기 이미지 ── 참여자의 화면이 현재 상태를 그려 올린다. 그린 뒤에 상태가 바뀌었으면
  // (version 불일치) 받지 않는다 — 옛 그림이 새 상태의 미리보기로 나가지 않게.
  async saveOg(room, me, body) {
    if (body.version !== (room.version ?? 0)) return fail("그새 방이 바뀌었어요.", 409, { stale: true });
    const png = fromBase64(body.png);
    if (!isPng(png) || png.length > OG_MAX) return fail("미리보기 이미지가 올바르지 않아요.", 400);
    await this.storage.put("og", png);
    room.og = { version: room.version, at: Date.now() };
    await this.save(room, { content: false });
    return this.ok(room, me);
  }

  async ogFile(room) {
    const png = room.og ? await this.storage.get("og") : null;
    if (!png) return fail("미리보기가 아직 없어요.", 404);
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  }

  // ── 사진 ── 화면이 긴 변 2048px JPEG(원본)와 360px 썸네일로 줄여 올린다. 다시 인코딩하므로
  // EXIF(촬영 위치)는 이미 빠져 있고, 여기서는 JPEG 인지와 크기만 본다.
  async addPhoto(room, me, body) {
    const photos = room.photos ?? (room.photos = []);
    const full = fromBase64(body.full);
    const thumb = fromBase64(body.thumb);
    if (!isJpeg(full) || !isJpeg(thumb) || thumb.length > 256 * 1024) return fail("사진을 읽지 못했어요.", 400);
    if (full.length > PHOTO_ONE_MAX) return fail("사진이 너무 커요.", 413);
    if (photos.length >= PHOTO_MAX) return fail(`사진은 방마다 ${PHOTO_MAX}장까지예요.`, 409);
    const used = photos.reduce((n, p) => n + p.bytes, 0);
    if (used + full.length > PHOTO_BYTES_MAX) return fail("사진 용량(100MB)이 다 찼어요.", 409);
    const id = randomId();
    const chunks = Math.ceil(full.length / CHUNK);
    const entries = { [`p:${id}:t`]: thumb };
    for (let i = 0; i < chunks; i += 1) entries[`p:${id}:${i}`] = full.slice(i * CHUNK, (i + 1) * CHUNK);
    await this.storage.put(entries);
    photos.push({
      id, by: me.id, at: Date.now(), bytes: full.length, chunks,
      w: Number.isInteger(body.w) ? body.w : null, h: Number.isInteger(body.h) ? body.h : null,
    });
    await this.save(room);
    return this.ok(room, me, { id });
  }

  async deletePhoto(room, me, body) {
    const photos = room.photos ?? [];
    const photo = photos.find((p) => p.id === body.id);
    if (!photo) return fail("없는 사진이에요.", 404);
    if (photo.by !== me.id && me.id !== room.hostId) return fail("올린 사람과 방장만 지울 수 있어요.", 403);
    const keys = [`p:${photo.id}:t`, ...Array.from({ length: photo.chunks }, (_, i) => `p:${photo.id}:${i}`)];
    await this.storage.delete(keys);
    room.photos = photos.filter((p) => p !== photo);
    await this.save(room);
    return this.ok(room, me);
  }

  async photoFile(room, id, size) {
    const photo = (room.photos ?? []).find((p) => p.id === id);
    if (!photo) return fail("없는 사진이에요.", 404);
    let bytes;
    if (size === "thumb") {
      bytes = await this.storage.get(`p:${id}:t`);
    } else {
      const keys = Array.from({ length: photo.chunks }, (_, i) => `p:${id}:${i}`);
      const parts = await this.storage.get(keys);
      bytes = new Uint8Array(photo.bytes);
      let offset = 0;
      for (const key of keys) {
        const part = parts.get(key);
        if (!part) return fail("사진 조각이 없어요.", 500);
        bytes.set(part, offset);
        offset += part.length;
      }
    }
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        // 사진 id 는 바뀌지 않는다 — 한 번 받으면 다시 묻지 않게(방이 터지면 id 도 사라진다).
        "Cache-Control": "private, max-age=86400, immutable",
        "Content-Disposition": `inline; filename="yaksok-${room.code}-${id}.jpg"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // ── 정산 ──
  async setPay(room, me, body) {
    const kakaopay = body.kakaopay ? kakaopayUrl(body.kakaopay) : null;
    if (body.kakaopay && !kakaopay) return fail("카카오페이 송금 링크(qr.kakaopay.com/…)를 붙여 넣어 주세요.", 400);
    const account = cleanText(body.account ?? "", 60);
    const target = room.members.find((m) => m.id === me.id);
    target.pay = kakaopay || account ? { kakaopay, account } : null;
    await this.save(room);
    return this.ok(room, me);
  }

  // op: add | update | delete. 지우고 고치는 건 올린 사람과 방장만.
  async expense(room, me, body) {
    const expenses = room.expenses ?? (room.expenses = []);
    const ids = new Set(room.members.map((m) => m.id));
    if (body.op === "delete" || body.op === "update") {
      const found = expenses.find((e) => e.id === body.id);
      if (!found) return fail("없는 항목이에요.", 404);
      if (found.by !== me.id && me.id !== room.hostId) return fail("올린 사람과 방장만 고칠 수 있어요.", 403);
      if (body.op === "delete") {
        room.expenses = expenses.filter((e) => e !== found);
        await this.save(room);
        return this.ok(room, me);
      }
    }
    if (!["add", "update"].includes(body.op)) return fail("op 는 add·update·delete 예요.", 400);
    const items = body.op === "add" && Array.isArray(body.items) ? body.items : [body];
    if (body.op === "add" && expenses.length + items.length > EXPENSE_MAX) return fail("항목이 너무 많아요.", 409);
    const cleaned = [];
    for (const item of items) {
      const amount = cleanAmount(item.amount);
      if (!amount) return fail(`금액은 1원~${AMOUNT_MAX.toLocaleString("ko-KR")}원 사이로 적어 주세요.`, 400);
      const payer = item.payer ?? me.id;
      if (!ids.has(payer)) return fail("낸 사람이 방에 없어요.", 400);
      const participants = item.participants == null ? null
        : Array.isArray(item.participants) ? [...new Set(item.participants)].filter((id) => ids.has(id)) : [];
      if (participants && !participants.length) return fail("나눌 사람을 한 명 이상 골라 주세요.", 400);
      cleaned.push({ title: cleanText(item.title ?? "", 40) ?? "결제", amount, payer, participants,
        source: item.source === "parsed" ? "parsed" : "manual" });
    }
    if (body.op === "update") Object.assign(expenses.find((e) => e.id === body.id), cleaned[0]);
    else for (const item of cleaned) expenses.push({ id: randomId(), by: me.id, at: Date.now(), ...item });
    await this.save(room);
    return this.ok(room, me);
  }

  // 보냈어요(보내는 사람) / 받았어요(받는 사람). 키는 "보내는id>받는id".
  async markSent(room, me, body) {
    const ids = new Set(room.members.map((m) => m.id));
    const { from, to } = body;
    if (!ids.has(from) || !ids.has(to) || from === to) return fail("잘못된 송금이에요.", 400);
    if (me.id !== from && me.id !== to) return fail("보내는 사람이나 받는 사람만 표시할 수 있어요.", 403);
    const key = `${from}>${to}`;
    const sent = room.sent ?? (room.sent = {});
    const entry = { ...(sent[key] ?? {}) };
    if (me.id === from) entry.sentAt = body.done === false ? null : Date.now();
    if (me.id === to) entry.receivedAt = body.done === false ? null : Date.now();
    if (Number.isInteger(body.amount)) entry.amount = body.amount;
    sent[key] = entry;
    await this.save(room);
    return this.ok(room, me);
  }

  async parse(room, me, body) {
    const mime = ["image/jpeg", "image/png", "image/webp"].includes(body.mime) ? body.mime : null;
    const bytes = fromBase64(body.data);
    if (!mime || !bytes || bytes.length > 5 * 1024 * 1024) return fail("이미지를 읽지 못했어요.", 400);
    const today = kstToday();
    const count = room.parseDay === today ? room.parseCount ?? 0 : 0;
    if (count >= PARSE_PER_DAY) return fail("오늘 자동 인식을 다 썼어요. 금액을 직접 적어 주세요.", 429);
    room.parseDay = today;
    room.parseCount = count + 1;
    await this.save(room, { content: false });
    try {
      const items = await parseReceipt(this.env ?? {}, { data: body.data, mime }, this.env?.fetchImpl);
      return json({ items });
    } catch (error) {
      return fail(error.message || "자동 인식에 실패했어요.", error.status ?? 502);
    }
  }

  // 방 코드를 그대로 적어야 터진다 — 잘못 누른 한 번에 모두의 기록이 사라지지 않게.
  async pop(room, body) {
    if (normalizeCode(body.code) !== room.code) return fail("방 코드를 똑같이 적어 주세요.", 400);
    await this.storage.deleteAll();
    await this.storage.put("popped", Date.now());
    await this.storage.setAlarm(Date.now() + TOMBSTONE_DAYS * DAY_MS);
    return json({ popped: true });
  }

  async alarm() {
    const room = await this.storage.get("room");
    // 확정일을 옮겨 만료가 뒤로 밀렸으면 아직 지우지 않는다.
    if (room && room.expiresAt > Date.now()) {
      await this.storage.setAlarm(room.expiresAt);
      return;
    }
    await this.storage.deleteAll();
  }
}

// ── 워커 쪽 ─────────────────────────────────────────────────────

const stubFor = (env, code) => env.YAKSOK.get(env.YAKSOK.idFromName(code));

function forward(env, code, action, request, body) {
  const headers = { "Content-Type": "application/json" };
  const token = request.headers.get("X-Yaksok-Token");
  if (token) headers["X-Yaksok-Token"] = token;
  return stubFor(env, code).fetch(`https://yaksok.internal/${action}`, {
    method: body === undefined ? "GET" : "POST", headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ACTIONS = new Set(["join", "vote", "confirm", "place", "host", "capacity", "settle", "pop",
  "og", "photo", "photo-delete", "pay", "expense", "sent", "parse"]);

// /_yaksok/rooms                    POST 방 만들기 {code, name, capacity} — 이미 있으면 409 {exists}
// /_yaksok/rooms/<코드>              GET  방 상태
// /_yaksok/rooms/<코드>/og.png       GET  미리보기 이미지
// /_yaksok/rooms/<코드>/photos/<id>  GET  사진 (?size=thumb)
// /_yaksok/rooms/<코드>/<동작>        POST 참여·투표·확정·장소·방장·정원·정산·터트리기·사진·송금·항목
export async function handleYaksokApi(request, env, path) {
  const segments = path.split("/").filter(Boolean).slice(1);   // ["rooms", code?, action?, arg?]
  if (segments[0] !== "rooms" || segments.length > 4) return fail("not found", 404);
  const [, code, action, arg] = segments;

  if (!code) {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    const body = await request.json().catch(() => ({}));
    const wanted = normalizeCode(body.code);
    if (!CODE_RE.test(wanted)) return fail("방 코드는 영문 소문자·숫자 6자리예요.", 400);
    return forward(env, wanted, "init", request, {
      code: wanted, name: body.name, capacity: body.capacity, today: kstToday(),
    });
  }

  if (!CODE_RE.test(code)) return fail("없는 방이에요.", 404);
  if (request.method === "GET") {
    if (!action) return forward(env, code, "state", request);
    if (action === "og.png" && !arg) return forward(env, code, "og", request);
    if (action === "photos" && /^[0-9a-f]{16}$/.test(arg ?? "")) {
      const size = new URL(request.url).searchParams.get("size") === "thumb" ? "thumb" : "full";
      return forward(env, code, `photo/${arg}?size=${size}`, request);
    }
    return fail("not found", 404);
  }
  if (!action || arg || !ACTIONS.has(action)) return fail("not found", 404);
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  return forward(env, code, action, request, await request.json().catch(() => ({})));
}

// 카톡이 링크를 긁어 미리보기를 만든다 — 단계에 맞는 제목·설명과, 참여자가 그려 올린 현재 상태
// 그림을 OG 에 끼운다. 그림 주소에 버전을 붙여 카톡 캐시가 옛 그림을 내지 않게 한다.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function ogDescription(room) {
  if (!room) return "되는 날짜를 톡톡 눌러 주세요. 모두 되는 날을 찾아 드려요.";
  const responded = room.members.filter((m) => m.responded).length;
  const when = room.confirmed ? `${dateLabel(room.confirmed.date)} ${SLOT_LABEL[room.confirmed.slot]}` : "";
  switch (room.phase) {
    case 0: return `되는 날짜를 톡톡 눌러 주세요 · ${room.max}명 중 ${responded}명 응답`;
    case 1: return `📅 ${when} 확정! 장소는 곧 알려 드려요.`;
    case 2: return `📅 ${when} · 📍 ${room.place?.name ?? ""}`;
    default: return `💸 정산 중이에요 — 보낼 돈을 확인해 주세요. (${when})`;
  }
}

export function ogTags(room, code) {
  const title = room ? `🫧 약속 방 ${room.code} · ${PHASES[room.phase]}` : "🫧 약속 잡기";
  const description = ogDescription(room);
  const image = room?.og
    ? `${PAGE_ORIGIN}/_yaksok/rooms/${code}/og.png?v=${room.og.version}`
    : `${PAGE_ORIGIN}/yaksok/og.png`;
  const tags = {
    "og:type": "website",
    "og:site_name": "bubblelab 약속",
    "og:title": title,
    "og:description": description,
    "og:url": `${PAGE_ORIGIN}/yaksok/${code}`,
    "og:image": image,
    "og:image:width": "1200",
    "og:image:height": "630",
  };
  return Object.entries(tags)
    .map(([key, value]) => `<meta property="${key}" content="${escapeHtml(value)}">`)
    .join("\n") + `\n<meta name="description" content="${escapeHtml(description)}">`;
}

export async function renderRoomPage(html, env, code) {
  let room = null;
  try {
    const response = await forward(env, code, "state", new Request("https://yaksok.internal/"));
    if (response.ok) room = await response.json();
  } catch { /* 미리보기는 방 정보가 없어도 뜬다 */ }
  return html.replace("<!--yaksok-og-->", ogTags(room, code));
}
