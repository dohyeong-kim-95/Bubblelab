// Duri — 두 사람의 대화·사진을 중계하고 버퍼링하는 Durable Object.
// duri.bubblelab.dev 전용. 단일 인스턴스("main") 하나가 로비처럼 동작한다.
//
// 설계 원칙: 서버는 평문도 키도 신원도 모른다.
//   - 클라이언트가 공유 패스프레이즈(PBKDF2→AES-GCM)로 E2E 암호화한 블롭만 오간다.
//   - 발신자 이름·시각은 블롭 "안"에 들어가므로 서버엔 { iv, ct } 불투명 값뿐이다.
//   - 서버 역할은 두 가지뿐: (1) 접속자에게 실시간 중계 (2) 데스크톱 싱크가
//     받아 ack 할 때까지 버퍼에 적재. ack 되면 버퍼·R2에서 폐기한다.
//   - 사진 원본(암호블롭)은 R2(DURI_BUCKET)에 임시 보관, 메시지엔 참조만.
//
// 인증은 Worker가 판정해 X-Duri-Role 헤더로 알려준다(peer|sink). DO는 이를 신뢰한다.
//   - peer: duri 게이트를 통과한 브라우저. 메시지 전송·수신, 버퍼 폐기 권한 없음.
//   - sink: 싱크 토큰을 제시한 데스크톱 데몬. 전체 수신 + ack 로 버퍼를 폐기한다.
//
// 프로토콜 (JSON 텍스트 프레임):
//   클라 → 서버: { type:"hello", since? }          … 접속. since 이후 버퍼를 받는다
//                { type:"msg", iv, ct }             … E2E 암호화된 텍스트
//                { type:"ack", seq }                … (sink) seq 까지 디스크 보존 완료
//                { type:"pong" }
//   서버 → 클라: { type:"welcome", head, online, sink } … 최신 seq + 접속 인원(peer 만) + PC 싱크 접속 여부
//                { type:"entry", ... }              … 버퍼/실시간 항목(아래 참조)
//                { type:"backfill-done", head }
//                { type:"presence", online, sink }
//                { type:"ping" } / { type:"error", error }
//
// entry(텍스트): { type:"entry", seq, kind:"msg", at, iv, ct }
// entry(사진)  : { type:"entry", seq, kind:"photo", at, r2key, imgIv, sha256, bytes, metaIv, metaCt }

import { sendWebPush } from "./webpush.js";

export const DURI_MAX_TEXT_BLOB = 16 * 1024; // 암호화된 텍스트 base64 상한
export const DURI_MAX_PHOTO_BYTES = 96 * 1024 * 1024; // 암호화된 사진 원본 상한(원본 보존이 원칙)
export const DURI_MAX_META_BLOB = 4 * 1024; // 사진 메타(이름·캡션) 암호블롭 상한
// 사진 미리보기(저해상도)를 **메시지 안에 그대로 실어** 보낸다. 받는 쪽이 원본을
// 내려받기 전에 바로 그릴 수 있어야 채팅이 즉시 뜬다(텔레그램 photoStrippedSize,
// 왓츠앱 envelope thumbnail 과 같은 방식). 서버는 여전히 암호블롭만 본다.
export const DURI_MAX_THUMB_BLOB = 24 * 1024;
const MAX_BUFFER_ENTRIES = 5000; // 싱크가 오래 꺼져 있을 때의 상한
const BACKFILL_LIMIT = 100; // 접속 직후 한 번에 보내는 최대 항목 수(나머지는 요청 시)
const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_CONNECTIONS = 8; // 두 사람 × 기기 몇 + 싱크
const PING_INTERVAL_MS = 30_000;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_LIMIT = 30; // 사진 연속 전송 여지를 두고 채팅보다 넉넉히
const SEQ_KEY = "seq";
const ACK_KEY = "ackSeq";
const BUF_PREFIX = "buf:";
// 공유 캘린더: 채팅 버퍼(ack 후 폐기)와 달리 지속 상태다. 이벤트별로 cal:<id> 에
// E2E 암호블롭({iv,ct})을 rev(수정시각)와 함께 저장하고 last-write-wins 로 병합한다.
export const DURI_MAX_CAL_BLOB = 4 * 1024;
const CAL_PREFIX = "cal:";
const MAX_CAL_EVENTS = 2000; // 살아 있는 일정 기준(툼스톤은 세지 않는다)
// 툼스톤 보존 기간. 이보다 오래 꺼져 있던 기기가 돌아와 삭제를 못 보고 일정을
// 되살릴 수 있지만, 2인용 캘린더에서 90일은 충분히 안전한 여유다.
const CAL_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CAL_ID = /^[A-Za-z0-9]{6,40}$/;
// 웹 푸시 구독(브라우저 알림용, peer 전용 — sink 데몬은 알림을 못 받는다/안 받는다).
// 알림 자체도 암호블롭({iv,ct} 또는 {metaIv,metaCt})을 그대로 실어 보낸다 — 서버는
// 여전히 평문을 모르고, 기기의 서비스워커가 그 자리에서 복호화해 알림을 그린다.
const PUSH_PREFIX = "push:";
const MAX_PUSH_SUBS = 8; // 두 사람 × 기기 몇 대
const DEVICE_ID = /^[A-Za-z0-9_-]{6,64}$/; // 기기 식별자(구독 회전 시 옛 구독 정리용)
// "같은 사람" 표식 — 앱이 이름에서 만든 해시(평문 이름은 아니다). 보낸 사람의 기기들에는
// 푸시를 보내지 않으려고 쓴다: 받은 sw.js 가 "내 메시지"라 알림을 안 띄우면 그게 silent
// push 가 되고, iOS 는 그게 몇 번 쌓이면 구독을 끊어 버린다(알림이 "자꾸" 안 오던 원인).
const WHO = /^[0-9a-f]{8,32}$/;
// 브라우저별 수신 커서. 싱크가 ack 했어도 아직 못 본 기기가 있으면 버퍼를 지우지
// 않기 위해 둔다(사진이 그 기기에서 영영 안 보이던 문제). 한참 안 들르는 기기까지
// 기다리면 버퍼가 무한히 쌓이므로 이 기간이 지나면 계산에서 뺀다.
const PEER_PREFIX = "peer:";
const PEER_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PUSH_PAYLOAD_BYTES = 3000; // 안전 상한 넘으면 내용 없는 일반 알림으로 대체
// 아침 일정 리마인드. 서버는 일정을 못 읽으므로(E2E) **앱이 그날 보낼 채팅 메시지를
// 미리 암호화해 날짜별로 맡겨 두고**, 08:00 KST cron 이 그날 몫을 꺼내 보통 메시지처럼
// 올린다(채팅·푸시·PC 백업이 기존 경로를 그대로 탄다). 서버가 아는 것은 "어느 날짜에
// 맡긴 게 있는가"뿐이다 — 제목·시간·누구 일정인지는 블롭 안에 있다.
const REMIND_PREFIX = "remind:";
export const REMIND_DAYS = 62; // 오늘부터 이만큼 앞까지만 받는다(앱은 60일치를 맡긴다)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const bufKey = (seq) => BUF_PREFIX + String(seq).padStart(12, "0");

async function endpointKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return PUSH_PREFIX + hex.slice(0, 32);
}

// base64(표준) 문자열인지 + 길이 상한 검사. iv/ct 같은 불투명 값에 쓴다.
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export function isBlob(value, maxLen) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLen && B64.test(value);
}

// 클라이언트 텍스트 메시지 프레임 검증. 통과하면 { iv, ct }, 실패하면 throw.
export function validateMsgFrame(msg) {
  if (!msg || typeof msg !== "object") throw new Error("invalid message");
  if (!isBlob(msg.iv, 64)) throw new Error("invalid iv");
  if (!isBlob(msg.ct, DURI_MAX_TEXT_BLOB)) throw new Error("invalid ct");
  return { iv: msg.iv, ct: msg.ct };
}

// 사진 업로드 헤더(암호블롭 메타) 검증. 통과하면 정규화된 메타, 실패하면 null.
export function validatePhotoMeta({ imgIv, sha256, metaIv, metaCt }) {
  if (!isBlob(imgIv, 64)) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (!isBlob(metaIv, 64)) return null;
  if (!isBlob(metaCt, DURI_MAX_META_BLOB)) return null;
  return { imgIv, sha256, metaIv, metaCt };
}

// 앨범(묶어보내기) 헤더 "id.i.n" 파싱. 그룹 정보(어느 사진들이 한 묶음인지)만
// 평문이고 사진 내용·메타는 여전히 암호블롭이다. 형식이 아니면 null.
export function parseAlbumHeader(value) {
  if (typeof value !== "string") return null;
  const m = /^([A-Za-z0-9]{6,32})\.([0-9]{1,2})\.([0-9]{1,2})$/.exec(value);
  if (!m) return null;
  const i = Number(m[2]), n = Number(m[3]);
  if (n < 2 || n > 30 || i < 1 || i > n) return null;
  return { id: m[1], i, n };
}

// 안전한 R2 키인지 (버퍼 항목이 참조하는 사진만 다운로드 허용)
const R2_KEY = /^photo\/[0-9]{12}-[A-Za-z0-9]{8,32}$/;
export const isPhotoKey = (key) => typeof key === "string" && R2_KEY.test(key);

// KST 기준 날짜(YYYY-MM-DD). 두 사람 다 KST 라 앱이 쓰는 로컬 날짜와 같다.
export const kstYmd = (ms = Date.now()) => new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86400_000).toISOString().slice(0, 10);

// remind-set 프레임 검사. 앱은 [from, to] 구간을 통째로 갈아 끼운다 — 그 구간에서
// 빠진 날짜는 "이제 일정이 없다"는 뜻이라 지운다. 프레임 크기 상한(32KB) 때문에
// 60일치를 몇 덩어리로 나눠 보내므로 구간 단위로 받는다.
export function validateRemindSet(msg, today = kstYmd()) {
  const { from, to, days } = msg ?? {};
  if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? "") || from > to) throw new Error("invalid range");
  // 어제는 허용한다 — 자정 직후 날짜가 기기와 서버에서 잠깐 어긋날 수 있다.
  if (from < addDays(today, -1) || to > addDays(today, REMIND_DAYS)) throw new Error("range out of window");
  if (!Array.isArray(days) || days.length > REMIND_DAYS + 1) throw new Error("invalid days");
  const seen = new Set();
  return days.map((d) => {
    if (!DATE_RE.test(d?.date ?? "") || d.date < from || d.date > to || seen.has(d.date)) throw new Error("invalid day");
    if (!isBlob(d.iv, 64) || !isBlob(d.ct, DURI_MAX_TEXT_BLOB)) throw new Error("invalid blob");
    seen.add(d.date);
    return { date: d.date, iv: d.iv, ct: d.ct };
  });
}

export class DuriDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.conns = new Set();
    this.head = undefined; // 최신 seq
    this.ackSeq = undefined; // 싱크가 보존 완료한 seq
    this.alarmScheduled = false;
  }

  async load() {
    if (this.head === undefined) {
      this.head = (await this.state.storage.get(SEQ_KEY)) ?? 0;
      this.ackSeq = (await this.state.storage.get(ACK_KEY)) ?? 0;
    }
  }

  async fetch(request) {
    await this.load();
    const url = new URL(request.url);
    const header = request.headers.get("X-Duri-Role");
    // cron 은 워커의 scheduled 만 붙인다 — 공개 경로는 withDuriRole 이 sink/peer 로 덮어쓴다.
    const role = header === "sink" || header === "cron" ? header : "peer";

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.handleSocket(request, role);
    }
    if (url.pathname.endsWith("/photo") && request.method === "POST") {
      return this.handlePhotoUpload(request);
    }
    const marker = "/photo/";
    const at = url.pathname.indexOf(marker);
    if (at !== -1 && request.method === "GET") {
      return this.handlePhotoDownload(url.pathname.slice(at + marker.length));
    }
    if (url.pathname.endsWith("/status") && request.method === "GET") {
      // pending 은 seq 계산값(head-ackSeq)이라 **실제로 버퍼에 남아 있는 항목 수와
      // 다를 수 있다** — 싱크가 받아갈 게 있는지 판단할 때 이걸 믿으면 안 된다.
      // buffered/firstSeq 는 스토리지를 실제로 세어 본 값이다.
      const buffered = await this.state.storage.list({ prefix: BUF_PREFIX, limit: 1000 });
      const first = buffered.values().next().value;
      return Response.json({
        head: this.head, ackSeq: this.ackSeq, online: this.peerCount(), conns: this.conns.size,
        pending: this.head - this.ackSeq,
        buffered: buffered.size, firstSeq: first?.seq ?? null,
        cal: (await this.state.storage.list({ prefix: CAL_PREFIX, limit: MAX_CAL_EVENTS })).size,
        remind: (await this.state.storage.list({ prefix: REMIND_PREFIX, limit: REMIND_DAYS * 2 })).size,
        // 구독별 푸시 서비스(애플·구글·모질라)와 마지막 발송 결과. 주소·키는 빼고 보인다.
        push: await this.pushDevices(),
      });
    }
    if (url.pathname.endsWith("/remind/fire") && request.method === "POST") {
      if (role !== "cron") return new Response("cron only", { status: 403 });
      return Response.json(await this.state.blockConcurrencyWhile(() => this.fireReminder()));
    }
    if (url.pathname.endsWith("/reset") && request.method === "POST") {
      return this.handleReset();
    }
    if (url.pathname.endsWith("/push/recv") && request.method === "POST") {
      if (role !== "peer") return new Response("peer only", { status: 403 });
      return this.pushReceived(request);
    }
    if (url.pathname.endsWith("/push/test") && request.method === "POST") {
      if (role !== "peer") return new Response("peer only", { status: 403 });
      return this.testPush(request); // 자가진단: 내 기기로 테스트 알림 발송 + 결과 반환
    }
    if (url.pathname.endsWith("/push") && (request.method === "POST" || request.method === "DELETE")) {
      if (role !== "peer") return new Response("peer only", { status: 403 }); // 알림은 브라우저(peer)만
      return request.method === "POST" ? this.subscribePush(request) : this.unsubscribePush(request);
    }
    return new Response("not found", { status: 404 });
  }

  // ── 방 초기화 ────────────────────────────────────────────────
  // 서버 버퍼와 참조 사진(R2)을 전부 비워 "새로 시작"을 만든다. 인증(소유자
  // 판정)은 Worker가 이미 했다. seq 카운터는 되감지 않는다 — 되감으면 초기화
  // 중 오프라인이던 기기가 재접속할 때 옛 커서(lastSeq)보다 작은 새 메시지를
  // 건너뛴다. 대신 ackSeq 를 head 로 올려 "전부 소비됨"으로 만들면, 어떤 커서로
  // 재접속해도 빈 버퍼만 받는다. 각자 PC 싱크 아카이브(원본)는 손대지 않는다.
  async handleReset() {
    // 1) 버퍼의 모든 항목 삭제 (+ 참조 R2 사진). 1000개씩 페이지.
    for (;;) {
      const entries = await this.state.storage.list({ prefix: BUF_PREFIX, limit: 1000 });
      if (entries.size === 0) break;
      const keys = [];
      for (const [key, value] of entries) {
        if (value.kind === "photo" && isPhotoKey(value.r2key)) {
          await this.env.DURI_BUCKET?.delete(value.r2key).catch(() => {});
        }
        keys.push(key);
      }
      await this.state.storage.delete(keys);
      if (entries.size < 1000) break;
    }
    // 2) 버퍼에서 이미 폐기됐으나 R2엔 남은 고아 사진까지 prefix 전체 정리.
    if (this.env.DURI_BUCKET) {
      let cursor;
      do {
        const listed = await this.env.DURI_BUCKET.list({ prefix: "photo/", cursor });
        if (listed.objects.length) {
          await this.env.DURI_BUCKET.delete(listed.objects.map((o) => o.key)).catch(() => {});
        }
        cursor = listed.truncated ? listed.cursor : undefined;
      } while (cursor);
    }
    // 3) 공유 캘린더와, 거기서 나온 아침 리마인드도 비운다.
    for (const prefix of [CAL_PREFIX, REMIND_PREFIX]) {
      for (;;) {
        const cal = await this.state.storage.list({ prefix, limit: 1000 });
        if (cal.size === 0) break;
        await this.state.storage.delete([...cal.keys()]);
        if (cal.size < 1000) break;
      }
    }
    // 4) 전부 소비됨으로 표시(seq 는 유지).
    this.ackSeq = this.head;
    await this.state.storage.put(ACK_KEY, this.head);
    // 5) 접속자에게 알린다 → 클라가 로컬 기록을 비우고 재시작.
    this.broadcast({ type: "reset" });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  // ── WebSocket ────────────────────────────────────────────────
  handleSocket(request, role) {
    if (this.conns.size >= MAX_CONNECTIONS) {
      return new Response("too many connections", { status: 503 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    const conn = { ws: server, role, stamps: [], alive: true, endpoint: null };
    this.conns.add(conn);
    this.scheduleAlarm();

    server.addEventListener("message", (e) => {
      if (typeof e.data !== "string" ||
          new TextEncoder().encode(e.data).byteLength > MAX_MESSAGE_BYTES) {
        try { server.close(1009, "message too large"); } catch { /* 닫힘 */ }
        return;
      }
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handle(conn, msg);
    });
    const bye = () => this.onClose(conn);
    server.addEventListener("close", bye);
    server.addEventListener("error", bye);

    return new Response(null, { status: 101, webSocket: client });
  }

  handle(conn, msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

    if (msg.type === "pong") { conn.alive = true; return; }

    if (msg.type === "hello") {
      const since = Number.isInteger(msg.since) && msg.since >= 0 ? msg.since : this.head;
      // 이 기기의 푸시 endpoint 를 기억해 둔다 → 접속 중(=화면을 보고 있는)인 기기에는
      // 푸시를 보내지 않는다. iOS는 "받았는데 알림을 안 띄운 푸시(silent push)"를
      // 예산으로 계산해, 반복되면 구독을 조여버린다(결국 백그라운드 알림까지 끊김).
      conn.endpoint = typeof msg.endpoint === "string" ? msg.endpoint : null;
      // 접속 시점의 커서를 바로 기록한다 — 재접속 직후 싱크가 ack 해서 아직 못 본
      // 항목이 지워지는 걸 막는다("seen" 을 보낼 틈도 없이 사라지던 자리).
      const dev = typeof msg.deviceId === "string" && DEVICE_ID.test(msg.deviceId) ? msg.deviceId : null;
      const who = typeof msg.who === "string" && WHO.test(msg.who) ? msg.who : null;
      if (conn.role === "peer" && dev) {
        conn.deviceId = dev;
        conn.who = who;
        this.state.blockConcurrencyWhile(async () => {
          const cur = await this.state.storage.get(PEER_PREFIX + dev);
          await this.state.storage.put(PEER_PREFIX + dev, { seq: since, at: Date.now(), who: who ?? cur?.who ?? null });
        });
      }
      this.send(conn, { type: "welcome", head: this.head, ...this.presence() });
      this.broadcast({ type: "presence", ...this.presence() }, conn);
      this.backfill(conn, since);
      return;
    }

    // 접속 중 알림을 켜고/끄면 endpoint 가 생기거나 사라진다 → 갱신.
    if (msg.type === "presence-endpoint") {
      conn.endpoint = typeof msg.endpoint === "string" ? msg.endpoint : null;
      return;
    }

    if (msg.type === "ack") {
      if (conn.role !== "sink") return; // 싱크만 버퍼를 폐기할 수 있다
      if (Number.isInteger(msg.seq)) this.state.blockConcurrencyWhile(() => this.prune(msg.seq));
      return;
    }

    // 위로 올려 캐시가 바닥났을 때 그 앞 구간을 요청한다.
    if (msg.type === "fetch-older") {
      if (!Number.isInteger(msg.before)) return;
      this.fetchOlder(conn, msg.before, Number.isInteger(msg.limit) ? msg.limit : 0);
      return;
    }

    // 브라우저가 "여기까지 받아서 그렸다"고 알린다. 싱크가 ack 했더라도 **아직 못 본
    // 기기가 있으면 버퍼를 지우지 않기 위해** 필요하다 — 예전엔 싱크 ack 만으로
    // 지워서, 그 순간 앱을 안 열어 둔 쪽은 사진을 영영 받지 못했다(알림만 오고
    // 화면엔 안 뜸). 기기 구분은 클라이언트가 만든 deviceId 로 한다.
    if (msg.type === "seen") {
      if (conn.role !== "peer" || !Number.isInteger(msg.seq)) return;
      const id = typeof msg.deviceId === "string" && DEVICE_ID.test(msg.deviceId) ? msg.deviceId : null;
      if (!id) return;
      this.state.blockConcurrencyWhile(async () => {
        const key = PEER_PREFIX + id;
        const cur = await this.state.storage.get(key);
        if (cur && cur.seq >= msg.seq) { // 커서는 되감지 않되 생존 신호는 갱신한다
          await this.state.storage.put(key, { ...cur, at: Date.now() });
          return;
        }
        await this.state.storage.put(key, { ...cur, seq: msg.seq, at: Date.now() });
      });
      return;
    }

    // 캘린더 현재 상태 요청(읽기 전용) → 접속 시 동기화.
    if (msg.type === "cal-hello") {
      this.state.blockConcurrencyWhile(() => this.sendCalState(conn));
      return;
    }

    // 플러드 제한 (ack/pong 제외)
    const now = Date.now();
    conn.stamps = conn.stamps.filter((t) => now - t < FLOOD_WINDOW_MS);
    if (conn.stamps.length >= FLOOD_LIMIT) {
      this.send(conn, { type: "error", error: "rate" });
      return;
    }

    if (msg.type === "msg") {
      let payload;
      try { payload = validateMsgFrame(msg); } catch {
        this.send(conn, { type: "error", error: "invalid message" });
        return;
      }
      conn.stamps.push(now);
      this.state.blockConcurrencyWhile(() =>
        this.append({ kind: "msg", at: now, iv: payload.iv, ct: payload.ct },
          { deviceId: conn.deviceId ?? null, who: conn.who ?? null }));
      return;
    }

    // 캘린더 이벤트 추가/수정: E2E 암호블롭 + rev. LWW 로 병합 후 상대에게 전파.
    if (msg.type === "cal-put") {
      if (!CAL_ID.test(msg.id ?? "") || !Number.isFinite(msg.rev)) return;
      if (!isBlob(msg.iv, 64) || !isBlob(msg.ct, DURI_MAX_CAL_BLOB)) return;
      conn.stamps.push(now);
      this.state.blockConcurrencyWhile(() => this.calPut(conn, msg.id, msg.iv, msg.ct, msg.rev));
      return;
    }
    // 아침 리마인드 맡기기: [from, to] 구간을 통째로 갈아 끼운다(브라우저만).
    if (msg.type === "remind-set") {
      if (conn.role !== "peer") return;
      let days;
      try { days = validateRemindSet(msg); } catch {
        this.send(conn, { type: "error", error: "invalid remind" });
        return;
      }
      conn.stamps.push(now);
      this.state.blockConcurrencyWhile(() => this.setReminders(msg.from, msg.to, days));
      return;
    }
    // 캘린더 이벤트 삭제(툼스톤으로 전파).
    if (msg.type === "cal-del") {
      if (!CAL_ID.test(msg.id ?? "") || !Number.isFinite(msg.rev)) return;
      conn.stamps.push(now);
      this.state.blockConcurrencyWhile(() => this.calDel(conn, msg.id, msg.rev));
      return;
    }
    // 사진(또는 메시지) 삭제: 버퍼 항목·R2 원본을 지우고 양쪽에서 제거하게 전파.
    if (msg.type === "del") {
      if (conn.role === "sink" || !Number.isInteger(msg.seq)) return; // 브라우저만
      conn.stamps.push(now);
      this.state.blockConcurrencyWhile(() => this.deleteEntry(msg.seq));
      return;
    }
  }

  // ── 공유 캘린더 ──────────────────────────────────────────────
  // 툼스톤(삭제 표시)은 오프라인이던 기기가 "이건 지워졌다"를 알기 위한 것이라
  // 지우자마자 없앨 수 없다 — 없으면 그 기기의 사본이 살아남아 되살아난다.
  // 대신 **충분히 오래된 것**은 정리한다. 그만큼 오래 꺼져 있던 기기가 돌아와
  // 좀비를 되살릴 확률은 낮고, 되살아나도 다시 지우면 된다. 접속 때(cal-hello)만
  // 훑으므로 빈도도 낮다.
  async sweepCalTombstones() {
    const entries = await this.state.storage.list({ prefix: CAL_PREFIX, limit: MAX_CAL_EVENTS * 2 });
    const now = Date.now();
    const cutoff = now - CAL_TOMBSTONE_TTL_MS;
    const stale = [];
    for (const [key, v] of entries) {
      if (!v?.deleted) continue;
      // 삭제 시각이 없는 옛 툼스톤은 나이를 알 수 없다. 지금 찍어 두고 그때부터
      // 세기 시작한다 — 모른다고 지워 버리면 아직 못 본 기기가 되살릴 수 있다.
      if (typeof v.at !== "number") { await this.state.storage.put(key, { ...v, at: now }); continue; }
      if (v.at < cutoff) stale.push(key);
    }
    if (stale.length) await this.state.storage.delete(stale);
    return stale.length;
  }
  async sendCalState(conn) {
    await this.sweepCalTombstones();
    const entries = await this.state.storage.list({ prefix: CAL_PREFIX, limit: MAX_CAL_EVENTS * 2 });
    this.send(conn, { type: "cal-state", events: [...entries.values()] });
  }
  async calPut(conn, id, iv, ct, rev) {
    const key = CAL_PREFIX + id;
    const cur = await this.state.storage.get(key);
    if (cur && cur.rev >= rev) return; // last-write-wins: 오래된 갱신 무시
    if (!cur) {
      // 상한은 **살아 있는 일정** 기준이다. 툼스톤까지 세면 만들고 지우기를 반복한
      // 것만으로 한도가 차 버린다(실제로 61건 중 41건이 툼스톤이었다).
      const entries = await this.state.storage.list({ prefix: CAL_PREFIX, limit: MAX_CAL_EVENTS * 2 });
      let live = 0;
      for (const [, v] of entries) if (!v?.deleted) live++;
      if (live >= MAX_CAL_EVENTS) {
        // 예전엔 조용히 버렸다 — 기기에는 저장돼 화면에 보이는데 서버엔 없어서
        // 상대에게 안 보이고 새로고침하면 사라졌다. 거부를 알려 되돌리게 한다.
        this.send(conn, { type: "cal-reject", id, reason: "full" });
        return;
      }
    }
    await this.state.storage.put(key, { id, iv, ct, rev, deleted: false });
    this.broadcast({ type: "cal-put", id, iv, ct, rev }, conn);
  }
  async calDel(conn, id, rev) {
    const key = CAL_PREFIX + id;
    const cur = await this.state.storage.get(key);
    if (cur && cur.rev >= rev) return;
    // 툼스톤(삭제 전파용). 삭제 시각은 **서버가** 찍는다 — rev 는 클라이언트 시계라
    // 그걸 기준으로 정리하면 시계가 어긋난 기기 하나가 남의 툼스톤을 조기에 날린다.
    await this.state.storage.put(key, { id, rev, deleted: true, at: Date.now() });
    this.broadcast({ type: "cal-del", id, rev }, conn);
  }

  // 항목 삭제: 버퍼에 있으면 R2 원본까지 지우고, 양쪽 클라이언트가 화면·캐시에서
  // 지우도록 전파한다. 이미 싱크가 가져가 버퍼에서 빠진 항목이어도 전파는 한다
  // (그 기기 화면에서 지우기 위함 — PC 아카이브 원본은 손대지 않는다).
  async deleteEntry(seq) {
    const key = bufKey(seq);
    const entry = await this.state.storage.get(key);
    if (entry) {
      if (entry.kind === "photo" && isPhotoKey(entry.r2key)) {
        await this.env.DURI_BUCKET?.delete(entry.r2key).catch(() => {});
      }
      await this.state.storage.delete(key);
    }
    this.broadcast({ type: "deleted", seq });
  }

  // ── 아침 리마인드 ────────────────────────────────────────────
  async setReminders(from, to, days) {
    const existing = await this.state.storage.list({
      prefix: REMIND_PREFIX, start: REMIND_PREFIX + from, end: REMIND_PREFIX + to + "~",
    });
    const keep = new Set(days.map((d) => REMIND_PREFIX + d.date));
    const gone = [...existing.keys()].filter((k) => !keep.has(k));
    if (gone.length) await this.state.storage.delete(gone);
    for (const d of days) await this.state.storage.put(REMIND_PREFIX + d.date, { iv: d.iv, ct: d.ct });
  }
  // 08:00 KST cron 이 부른다. 오늘 몫이 있으면 보통 메시지로 올리고(→ 실시간 전달·푸시·
  // 싱크 백업), 오늘까지의 몫은 전부 지운다 — cron 이 두 번 돌아도 두 번 올리지 않고,
  // 지나간 날짜가 쌓이지도 않는다.
  async fireReminder(today = kstYmd()) {
    const due = await this.state.storage.list({ prefix: REMIND_PREFIX, end: REMIND_PREFIX + today + "~" });
    const todays = due.get(REMIND_PREFIX + today);
    if (due.size) await this.state.storage.delete([...due.keys()]);
    if (!todays) return { date: today, posted: false };
    const entry = await this.append({ kind: "msg", at: Date.now(), iv: todays.iv, ct: todays.ct });
    return { date: today, posted: true, seq: entry.seq };
  }

  // ── 버퍼 적재/폐기 ───────────────────────────────────────────
  // sender: 보낸 기기 {deviceId, who} — 그 사람의 기기들은 푸시에서 뺀다(없으면 전체).
  async append(entry, sender = null) {
    const seq = this.head + 1;
    const full = { seq, ...entry };
    await this.state.storage.put(bufKey(seq), full);
    this.head = seq;
    await this.state.storage.put(SEQ_KEY, seq);
    await this.capBuffer();
    this.broadcast({ type: "entry", ...full });
    // 실시간 접속자는 이미 위 broadcast로 받으므로, 푸시는 앱이 꺼져 있는 기기를
    // 위한 것이다. 네트워크 호출이라 append 자체를 막지 않게 기다리지 않는다.
    if (entry.kind === "msg" || entry.kind === "photo") this.notifyPush(full, sender).catch(() => {});
    return full;
  }

  // ── 웹 푸시 ──────────────────────────────────────────────────
  async subscribePush(request) {
    const body = await request.json().catch(() => ({}));
    const sub = body.subscription ?? body;
    if (typeof sub?.endpoint !== "string" || !sub.endpoint.startsWith("https://") ||
        typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") {
      return Response.json({ error: "invalid subscription" }, { status: 400 });
    }
    // 기기 식별자(클라이언트가 만들어 보관하는 임의 토큰). 브라우저가 구독을
    // 회전시키면 endpoint 가 바뀌는데, 이게 있어야 "같은 기기의 옛 구독"을
    // 알아보고 치울 수 있다.
    const deviceId = typeof body.deviceId === "string" && DEVICE_ID.test(body.deviceId)
      ? body.deviceId : null;
    const key = await endpointKey(sub.endpoint);
    const existing = await this.state.storage.get(key);
    const all = [...(await this.state.storage.list({ prefix: PUSH_PREFIX }))];

    // ① 같은 기기가 쓰던 옛 endpoint 를 먼저 치운다. 이게 없으면 배포·SW 갱신 때마다
    // 죽은 구독이 하나씩 쌓여 슬롯을 채운다(pushsubscriptionchange 는 브라우저가
    // 잘 쏘지 않고 iOS 는 아예 지원하지 않아, 옛 구독을 지울 다른 기회가 없다).
    if (deviceId) {
      const stale = all.filter(([k, v]) => k !== key && v?.deviceId === deviceId).map(([k]) => k);
      if (stale.length) await this.state.storage.delete(stale);
    }
    // ② 슬롯이 찼으면 새 구독을 거절하는 대신 가장 오래된 것을 밀어낸다. 방금 알림을
    // 켠 기기가 좀비 구독 때문에 등록에 실패해 조용히 알림이 끊기는 쪽이 훨씬 나쁘다.
    if (!existing) {
      const live = all.filter(([k, v]) => k !== key && !(deviceId && v?.deviceId === deviceId));
      if (live.length >= MAX_PUSH_SUBS) {
        live.sort((a, b) => (a[1]?.at ?? 0) - (b[1]?.at ?? 0));
        await this.state.storage.delete(live.slice(0, live.length - MAX_PUSH_SUBS + 1).map(([k]) => k));
      }
    }
    await this.state.storage.put(key, {
      endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      deviceId, at: Date.now(),
    });
    return Response.json({ subscribed: true });
  }
  async unsubscribePush(request) {
    const body = await request.json().catch(() => ({}));
    const endpoint = String(body.endpoint ?? "");
    if (endpoint) await this.state.storage.delete(await endpointKey(endpoint));
    return Response.json({ subscribed: false });
  }
  // 새 항목(msg/photo)이 생길 때마다 등록된 모든 기기로 발송(만료 구독은 정리).
  // 페이로드는 여전히 암호블롭뿐 — 서버는 누가 뭐라고 보냈는지 모른다.
  async notifyPush(full, sender = null) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = this.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
    const subs = await this.state.storage.list({ prefix: PUSH_PREFIX });
    if (subs.size === 0) return;
    // 접속 중인 기기도 건너뛰지 않는다. 예전엔 "보고 있다"(hello·presence 의 endpoint)를
    // 믿고 건너뛰었는데, 앱이 백그라운드에서 재접속하면(배포마다 모든 연결이 끊긴다)
    // hello 가 endpoint 를 실어 서버는 "보는 중"으로 알고 그 연결이 살아 있는 내내 푸시를
    // 안 보냈다 — "잠깐 오다가 배포하면 또 안 온다"의 원인. 보고 있는지는 기기 안의
    // sw.js 가 판단하고, 그때는 알림을 띄웠다 바로 닫는다(silent push 가 안 되게).
    const mine = await this.senderDevices(sender);
    const vapid = {
      publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT || "https://duri.bubblelab.dev",
    };
    // seq 는 도착 확인(/push/recv)이 "어느 푸시가 왔나"를 알리려고 싣는다(평문 숫자일 뿐).
    const body = JSON.stringify({ ...this.buildPushPayload(full), seq: full.seq });
    for (const [key, sub] of subs) {
      if (sub.deviceId && mine.has(sub.deviceId)) continue; // 보낸 사람의 기기엔 안 보냄
      let status;
      try {
        const result = await sendWebPush(sub, body, vapid, { urgency: "high" });
        if (result.gone) { await this.state.storage.delete(key); continue; } // 만료 구독 정리
        status = result.status;
      } catch (error) {
        console.error("duri push send failed", error);
        status = 0;
      }
      // 마지막 발송 결과를 남긴다 — 실패가 조용히 삼켜져 "왜 안 오지"를 알 길이 없었다.
      // /status 의 push 칸으로 본다(주소·키는 내보내지 않는다).
      const cur = await this.state.storage.get(key); // 그사이 알림을 껐으면 되살리지 않는다
      if (cur) await this.state.storage.put(key, { ...cur, last: { status, at: Date.now(), seq: full.seq } });
    }
  }
  // sw.js 의 도착 확인. 발송(last)은 "푸시 서비스가 받았다"까지라, 애플·구글이 기기에
  // 안 넘겨 주거나 기기가 알림을 못 띄우면 서버에선 성공으로만 보였다. recv 와 견주면 갈린다.
  async pushReceived(request) {
    const body = await request.json().catch(() => ({}));
    if (typeof body.endpoint !== "string" || !body.endpoint.startsWith("https://")) {
      return Response.json({ error: "invalid" }, { status: 400 });
    }
    const key = await endpointKey(body.endpoint);
    const cur = await this.state.storage.get(key);
    if (!cur) return Response.json({ known: false });
    const recv = {
      at: Date.now(),
      seq: Number.isInteger(body.seq) ? body.seq : null,
      shown: body.shown === true || (body.shown === "quiet" ? "quiet" : false), // quiet = 보는 중이라 띄웠다 닫음
      ...(typeof body.error === "string" && { error: body.error.slice(0, 120) }),
    };
    await this.state.storage.put(key, { ...cur, recv });
    return Response.json({ known: true });
  }
  // 구독별 푸시 서비스(애플·구글·모질라)와 마지막 발송 결과. 주소·키는 빼고 보인다.
  async pushDevices() {
    const subs = await this.state.storage.list({ prefix: PUSH_PREFIX, limit: MAX_PUSH_SUBS * 2 });
    return [...subs.values()].map((v) => ({
      host: (() => { try { return new URL(v.endpoint).host; } catch { return "?"; } })(),
      device: v.deviceId ? v.deviceId.slice(0, 4) : null, since: v.at ?? null, last: v.last ?? null,
      recv: v.recv ?? null,
    }));
  }
  // 보낸 사람의 기기 집합: 보낸 기기 자신 + 같은 who 로 접속했던 기기들.
  async senderDevices(sender) {
    const set = new Set();
    if (sender?.deviceId) set.add(sender.deviceId);
    if (sender?.who) {
      const peers = await this.state.storage.list({ prefix: PEER_PREFIX, limit: 32 });
      for (const [k, v] of peers) if (v?.who === sender.who) set.add(k.slice(PEER_PREFIX.length));
    }
    return set;
  }
  // 자가진단용 테스트 알림. endpoint 를 주면 그 기기(내 기기)로만, 없으면 전체로.
  // 결과(구독 수·발송·만료·실패, VAPID 미설정 여부)를 돌려줘 어디서 막히는지 알린다.
  async testPush(request) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = this.env;
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return Response.json({ ok: false, reason: "no-vapid" }); // 서버에 푸시 개인키 미설정
    }
    const body = await request.json().catch(() => ({}));
    const onlyEndpoint = typeof body.endpoint === "string" ? body.endpoint : null;
    const nonce = typeof body.nonce === "string" && /^[A-Za-z0-9_-]{4,40}$/.test(body.nonce) ? body.nonce : null;
    const subs = await this.state.storage.list({ prefix: PUSH_PREFIX });
    const registered = onlyEndpoint ? subs.has(await endpointKey(onlyEndpoint)) : null;
    const devices = () => this.pushDevices();
    // dry: 보내지 않고 등록 여부·기기 목록만(진단 화면의 "서버에 등록돼 있나" 단계).
    if (body.dry) return Response.json({ ok: true, subs: subs.size, registered, devices: await devices() });
    const vapid = {
      publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY,
      subject: VAPID_SUBJECT || "https://duri.bubblelab.dev",
    };
    const payload = JSON.stringify({ kind: "test", ...(nonce && { nonce }) });
    let sent = 0, gone = 0, failed = 0, targeted = 0, status = null;
    for (const [key, sub] of subs) {
      if (onlyEndpoint && sub.endpoint !== onlyEndpoint) continue;
      targeted++;
      try {
        const result = await sendWebPush(sub, payload, vapid, { urgency: "high" });
        status = result.status;
        if (result.gone) { await this.state.storage.delete(key); gone++; }
        else if (result.ok) sent++;
        else failed++; // 403(키 불일치)·413 등 — 예전엔 이것도 "보냈어요"로 셌다
      } catch { failed++; }
    }
    return Response.json({ ok: true, subs: subs.size, registered, targeted, sent, gone, failed, status, devices: await devices() });
  }
  buildPushPayload(full) {
    let content;
    if (full.kind === "msg") content = { kind: "msg", iv: full.iv, ct: full.ct };
    else if (full.kind === "photo") content = { kind: "photo", metaIv: full.metaIv, metaCt: full.metaCt };
    else return { kind: "generic" };
    // 너무 크면(긴 텍스트 등) 복호화용 블롭 대신 내용 없는 일반 알림으로 대체.
    return JSON.stringify(content).length > MAX_PUSH_PAYLOAD_BYTES ? { kind: "generic" } : content;
  }

  // 싱크가 seq 까지 보존 완료 → 그 이하 버퍼와 사진 R2 객체를 폐기한다.
  // 아직 못 본 기기가 있으면 그 앞까지만 지운다. 싱크(=PC 백업)가 받아 갔다는 것과
  // 두 사람이 다 봤다는 것은 다른 얘기인데, 예전엔 싱크 ack 하나로 버퍼·R2 를 비워서
  // **그 순간 앱을 안 열어 둔 쪽은 사진을 영영 못 받았다**(알림만 오고 화면엔 안 뜸).
  // 오래 소식이 없는 기기까지 기다리면 버퍼가 무한히 쌓이므로 그건 건너뛴다.
  async safePruneSeq(sinkSeq) {
    const peers = await this.state.storage.list({ prefix: PEER_PREFIX, limit: 32 });
    const cutoff = Date.now() - PEER_STALE_MS;
    let upto = sinkSeq;
    for (const [, v] of peers) {
      if (!v || (v.at ?? 0) < cutoff) continue; // 한참 안 들른 기기는 기다려 주지 않는다
      upto = Math.min(upto, v.seq ?? 0);
    }
    return upto;
  }
  async prune(seq) {
    const upto = Math.min(await this.safePruneSeq(seq), this.head);
    if (upto <= this.ackSeq) return;
    const entries = await this.state.storage.list({
      prefix: BUF_PREFIX, end: bufKey(upto + 1), limit: 1000,
    });
    const keys = [];
    for (const [key, value] of entries) {
      if (value.kind === "photo" && isPhotoKey(value.r2key)) {
        await this.env.DURI_BUCKET.delete(value.r2key).catch(() => {});
      }
      keys.push(key);
    }
    if (keys.length) await this.state.storage.delete(keys);
    this.ackSeq = upto;
    await this.state.storage.put(ACK_KEY, upto);
  }

  // 미ack 항목이 상한을 넘으면 오래된 것부터 버린다(PC가 오래 꺼진 경우의 손실 상한).
  async capBuffer() {
    const pending = this.head - this.ackSeq;
    const overflow = pending - MAX_BUFFER_ENTRIES;
    if (overflow <= 0) return;
    const entries = await this.state.storage.list({
      prefix: BUF_PREFIX, limit: overflow,
    });
    const keys = [];
    let last = this.ackSeq;
    for (const [key, value] of entries) {
      if (value.kind === "photo" && isPhotoKey(value.r2key)) {
        await this.env.DURI_BUCKET.delete(value.r2key).catch(() => {});
      }
      keys.push(key);
      last = value.seq;
    }
    if (keys.length) await this.state.storage.delete(keys);
    if (last > this.ackSeq) { this.ackSeq = last; await this.state.storage.put(ACK_KEY, last); }
  }

  // 접속 직후엔 **최근 것부터 BACKFILL_LIMIT 개만** 보낸다. 그 앞은 클라이언트가
  // 위로 올려 필요해질 때 fetch-older 로 따로 가져간다(커서 기반 페이지네이션).
  // 단 싱크에는 자르지 않고 전부 보낸다 — 싱크는 backfill-done 뒤의 빈 번호를
  // "서버에 없는 항목"으로 보고 건너뛴 뒤 ack 하므로, 잘라 보내면 받지 못한 앞 구간이
  // ack 되어 지워진다(옛 데몬은 more 를 보지 않는다).
  async backfill(conn, since) {
    const from = Math.max(since, this.ackSeq) + 1;
    if (conn.role === "sink") {
      await this.sendAllFrom(conn, from);
      this.send(conn, { type: "backfill-done", head: this.head, oldest: null, more: false });
      return;
    }
    // reverse 로 읽어야 "가장 최근" 것이 나온다(정방향 limit 은 가장 오래된 것부터 자른다).
    const newestFirst = await this.state.storage.list({
      prefix: BUF_PREFIX, start: bufKey(from), reverse: true, limit: BACKFILL_LIMIT + 1,
    });
    const page = [...newestFirst.values()].slice(0, BACKFILL_LIMIT).reverse();
    for (const value of page) this.send(conn, { type: "entry", ...value });
    this.send(conn, {
      type: "backfill-done", head: this.head,
      // 아직 서버에 남아 있는 더 오래된 구간이 있는지 알려 준다(있으면 위로 올릴 때 가져간다).
      oldest: page.length ? page[0].seq : null,
      more: newestFirst.size > BACKFILL_LIMIT,
    });
  }

  // from 이후 버퍼 전부를 오래된 순으로 보낸다(1000개씩 나눠 읽는다).
  async sendAllFrom(conn, from) {
    let start = bufKey(from);
    while (true) {
      const chunk = await this.state.storage.list({ prefix: BUF_PREFIX, start, limit: 1000 });
      let lastSeq = null;
      for (const value of chunk.values()) {
        this.send(conn, { type: "entry", ...value });
        lastSeq = value.seq;
      }
      if (chunk.size < 1000 || lastSeq === null) return;
      start = bufKey(lastSeq + 1);
    }
  }

  // 위로 올려 캐시가 바닥났을 때 서버에 남아 있는 그 앞 구간을 가져간다.
  async fetchOlder(conn, before, limit) {
    const end = bufKey(Math.max(0, before));
    const pageSize = Math.min(limit || BACKFILL_LIMIT, BACKFILL_LIMIT);
    const newestFirst = await this.state.storage.list({
      prefix: BUF_PREFIX, end, reverse: true, limit: pageSize + 1,
    });
    const page = [...newestFirst.values()].slice(0, pageSize).reverse();
    for (const value of page) this.send(conn, { type: "entry", ...value });
    this.send(conn, {
      type: "older-done",
      oldest: page.length ? page[0].seq : null,
      more: newestFirst.size > pageSize,
    });
  }

  // ── 사진 (R2 임시 버퍼) ──────────────────────────────────────
  async handlePhotoUpload(request) {
    if (!this.env.DURI_BUCKET) return new Response("storage unavailable", { status: 503 });
    const meta = validatePhotoMeta({
      imgIv: request.headers.get("X-Duri-Img-Iv"),
      sha256: request.headers.get("X-Duri-Sha256"),
      metaIv: request.headers.get("X-Duri-Meta-Iv"),
      metaCt: request.headers.get("X-Duri-Meta"),
    });
    if (!meta) return new Response("invalid photo metadata", { status: 400 });
    // 큰 업로드는 메모리에 담기 전에 Content-Length 로 먼저 거른다.
    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > DURI_MAX_PHOTO_BYTES) {
      return new Response(`photo too large (${declared} bytes, max ${DURI_MAX_PHOTO_BYTES})`, { status: 413 });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return new Response("empty body", { status: 400 });
    if (body.byteLength > DURI_MAX_PHOTO_BYTES) {
      return new Response(`photo too large (${body.byteLength} bytes, max ${DURI_MAX_PHOTO_BYTES})`, { status: 413 });
    }
    const seq = this.head + 1;
    const rand = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const r2key = `photo/${String(seq).padStart(12, "0")}-${rand}`;
    await this.env.DURI_BUCKET.put(r2key, body, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    const thumbIv = request.headers.get("X-Duri-Thumb-Iv");
    const thumbCt = request.headers.get("X-Duri-Thumb");
    const thumb = isBlob(thumbIv, 64) && isBlob(thumbCt, DURI_MAX_THUMB_BLOB)
      ? { thumbIv, thumbCt } : null; // 없으면 받는 쪽이 예전처럼 원본을 기다린다
    const album = parseAlbumHeader(request.headers.get("X-Duri-Album"));
    const dev = request.headers.get("X-Duri-Device");
    const senderDev = dev && DEVICE_ID.test(dev) ? dev : null;
    const sender = senderDev
      ? { deviceId: senderDev, who: (await this.state.storage.get(PEER_PREFIX + senderDev))?.who ?? null }
      : null;
    const entry = await this.state.blockConcurrencyWhile(() => this.append({
      kind: "photo", at: Date.now(), r2key,
      imgIv: meta.imgIv, sha256: meta.sha256, bytes: body.byteLength,
      metaIv: meta.metaIv, metaCt: meta.metaCt,
      ...(thumb || {}),
      ...(album ? { album } : {}),
    }, sender));
    return Response.json({ seq: entry.seq, r2key }, { headers: { "Cache-Control": "no-store" } });
  }

  async handlePhotoDownload(key) {
    if (!isPhotoKey(key)) return new Response("invalid key", { status: 400 });
    if (!this.env.DURI_BUCKET) return new Response("storage unavailable", { status: 503 });
    const object = await this.env.DURI_BUCKET.get(key);
    if (!object) return new Response("not found", { status: 404 });
    return new Response(object.body, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  }

  // ── 연결 유지 / 정리 ─────────────────────────────────────────
  scheduleAlarm() {
    if (this.alarmScheduled) return;
    this.alarmScheduled = true;
    this.state.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
  }

  async alarm() {
    this.alarmScheduled = false;
    for (const conn of [...this.conns]) {
      if (!conn.alive) {
        try { conn.ws.close(4002, "ping timeout"); } catch { /* 닫힘 */ }
        this.onClose(conn);
        continue;
      }
      conn.alive = false;
      this.send(conn, { type: "ping" });
    }
    if (this.conns.size) this.scheduleAlarm();
  }

  // 화면의 "접속중"은 **사람**을 뜻한다. 데스크톱 싱크도 같은 WebSocket 으로 붙기
  // 때문에 전체 연결 수를 세면, 싱크를 켜 둔 순간부터 상대가 없어도 늘 "상대
  // 접속중"으로 보인다(실제로 그렇게 보였다). peer 만 센다.
  peerCount() {
    let n = 0;
    for (const c of this.conns) if (c.role === "peer") n++;
    return n;
  }
  // sink: PC 싱크가 붙어 있는지. 채팅의 "@당이" 비서는 PC 에서 도므로, 꺼져 있으면
  // 앱이 바로 "자고 있어요" 라고 알려 줄 수 있게 한다(사람 수 online 과는 따로 센다).
  presence() {
    return { online: this.peerCount(), sink: [...this.conns].some((c) => c.role === "sink") };
  }
  send(conn, obj) {
    if (!conn) return; // 보낸 주체가 없는 경로(내부 호출)도 있다
    try { conn.ws.send(JSON.stringify(obj)); } catch { this.onClose(conn); }
  }

  broadcast(obj, except = null) {
    const frame = JSON.stringify(obj);
    for (const conn of [...this.conns]) {
      if (conn === except) continue;
      try { conn.ws.send(frame); } catch { this.onClose(conn); }
    }
  }

  onClose(conn) {
    if (!this.conns.delete(conn)) return;
    this.broadcast({ type: "presence", ...this.presence() });
  }
}
