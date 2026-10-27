#!/usr/bin/env node
// Duri 데스크톱 싱크 — 사용자 PC에서 상주하며 대화·사진을 로컬 디스크에 보존한다.
//
// "엣지는 중계소, 원본은 내 PC" 설계의 진실의 원천 쪽. 하는 일:
//   1. /_duri 에 싱크 토큰으로 WebSocket 접속 (커서 이후 항목을 받는다)
//   2. 공유 패스프레이즈로 E2E 복호화 → 로컬 DuriStorage/ 에 기록 (store.mjs)
//   3. 디스크에 확실히 쓴 뒤에만 ack → 서버는 그 항목을 버퍼·R2에서 폐기
//
// 서버·R2는 암호블롭만 갖고 있으므로, 패스프레이즈를 아는 이 데몬만 평문을 만든다.
// 의존성 없음 — Node 22+ 의 전역 WebSocket·crypto 만 쓴다.
//
// 실행:  DURI_URL=… DURI_TOKEN=… DURI_PASSPHRASE=… DURI_DIR=… node duri-sink.mjs
//        또는 같은 폴더의 duri-sink.config.json 에 값을 넣고  node duri-sink.mjs

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveKey, createStore, atomicWrite, encryptJson, encryptBytes } from "./store.mjs";
import { createAssistant, ollamaAsk, llamaAsk, parseTrigger, briefDue, kstYmd, BOT_NAME } from "./assistant.mjs";
import { createArchive } from "./archive.mjs";
import { createPlaces } from "./places.mjs";
import { createCaptioner } from "./captions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fatal = (msg) => { console.error("✖", msg); process.exit(1); };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (typeof WebSocket === "undefined") {
  fatal("전역 WebSocket 이 없습니다. Node 22+ 로 실행하거나, Node 20.10~21 이면\n" +
        "  node --experimental-websocket duri-sink.mjs  로 실행하세요 (install.sh 가 자동으로 붙여 줍니다).");
}

// ── 설정 (env 우선, 없으면 config 파일) ──────────────────────
function loadConfig() {
  let file = {};
  const path = join(HERE, "duri-sink.config.json");
  if (existsSync(path)) {
    try { file = JSON.parse(readFileSync(path, "utf8")); }
    catch { fatal(`설정 파일을 읽을 수 없습니다: ${path}`); }
  }
  const cfg = {
    url: process.env.DURI_URL || file.url,
    token: process.env.DURI_TOKEN || file.token,
    passphrase: process.env.DURI_PASSPHRASE || file.passphrase,
    dir: process.env.DURI_DIR || file.dir || join(HERE, "DuriStorage"),
    // 일정 비서 "당이"(선택, 기본 꺼짐) — 로컬 모델로 "@당이 …" 를 처리한다(assistant.mjs).
    // api: "llama"(llama.cpp llama-server) 또는 "ollama"(기본).
    assistant: {
      enabled: process.env.DURI_ASSISTANT ? process.env.DURI_ASSISTANT === "1" : Boolean(file.assistant?.enabled),
      api: process.env.DURI_MODEL_API || file.assistant?.api || "ollama",
      llama: process.env.LLAMA_URL || file.assistant?.llama || "http://127.0.0.1:8090",
      ollama: process.env.OLLAMA_URL || file.assistant?.ollama || "http://127.0.0.1:11434",
      model: process.env.DURI_MODEL || file.assistant?.model || "qwen2.5:7b",
      keepAlive: process.env.DURI_KEEP_ALIVE || file.assistant?.keepAlive || "1h",
      // 아침 브리핑 시각(KST, "HH:MM"). false 또는 "off" 면 끈다.
      briefing: process.env.DURI_BRIEF || (file.assistant?.briefing === false ? "off" : file.assistant?.briefing) || "08:00",
      // 한가할 때 사진 설명 달기(llama + 비전일 때만). false 면 끈다.
      captions: file.assistant?.captions !== false,
    },
  };
  for (const k of ["url", "token", "passphrase"]) {
    if (!cfg[k]) fatal(`설정 누락: ${k} (env DURI_${k.toUpperCase()} 또는 duri-sink.config.json)`);
  }
  cfg.url = cfg.url.replace(/\/+$/, "");
  return cfg;
}

const cfg = loadConfig();
const cursorPath = join(cfg.dir, ".duri-cursor");
const loadCursor = () => {
  try { return Number(readFileSync(cursorPath, "utf8").trim()) || 0; } catch { return 0; }
};

async function downloadPhoto(r2key) {
  const res = await fetch(`${cfg.url}/_duri/photo/${r2key}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`photo ${r2key} HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ── 순차 처리 큐 + ack ───────────────────────────────────────
// 엔트리는 seq 순으로 도착한다. 하나씩 디스크에 쓰고 커서를 전진시킨다.
// 실패(예: 사진 다운로드 일시 오류)하면 커서를 멈추고 재시도 — ack 하지 않으므로
// 서버가 폐기하지 않아 데이터가 유실되지 않는다.
let store, archive, cursor = loadCursor();
const queue = [];
let draining = false, ackTimer = null, socket = null;
// 이번 연결에서 백필(서버가 가진 것 전부 전송)이 끝났는지 — 갭을 기다릴지 건너뛸지 가른다.
let backfilled = false;
// 연속 복호화 실패 상한 — 이만큼 이어지면 문구 자체가 틀린 것으로 보고 멈춘다.
// 산발적인 실패는 격리(quarantine)하고 지나간다.
const MAX_DECRYPT_FAILS = 10;
let decryptFails = 0;

function enqueue(entry) {
  if (entry.seq <= cursor) return; // 이미 보존됨
  queue.push(entry);
  queue.sort((a, b) => a.seq - b.seq);
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const entry = queue[0];
    if (entry.seq <= cursor) { queue.shift(); continue; }
    if (entry.seq !== cursor + 1) {
      // 중간이 비어 있다. 백필이 끝나기 전이면 아직 오는 중일 수 있으니 기다리고,
      // 끝난 뒤라면 그 번호는 영원히 오지 않는다 — 삭제된 사진(deleteEntry)이나
      // 이미 폐기된 항목이라 서버에 없다. 기다리기만 하면 거기서 영영 멈춘다.
      if (!backfilled) break;
      log(`서버에 없는 구간 건너뜀: ${cursor + 1}~${entry.seq - 1} (삭제됐거나 이미 폐기된 항목)`);
      cursor = entry.seq - 1;
      atomicWrite(cursorPath, String(cursor));
    }
    let keepGoing = true;
    try {
      const payload = await store.persist(entry);
      decryptFails = 0;
      // 보존이 끝난 뒤에만 당이에게 넘긴다(느려도 persist → ack 순서는 그대로). 접속 직후
      // 백필로 받은 것은 싱크가 없던 동안 온 말이다 — 그때 앱이 이미 "당이가 자고 있어요" 라고
      // 했으니 실행하지 않는다. 실시간으로 받은 것(live)만 처리한다.
      if (assistant && entry.live && payload?.text) assistant.onMessage({ name: payload.name, text: payload.text, at: payload.at ?? entry.at });
    } catch (e) {
      if (e?.name === "OperationError" || /decrypt/i.test(String(e))) {
        // 산발적으로 안 풀리는 한 건(문구를 바꾸기 전의 옛 항목 등) 때문에 그 뒤
        // 전부가 막히면 안 된다 — 실제로 731건이 딱 한 건에 막혀 있었다. 원문을
        // 못 읽어도 원본까지 잃을 이유는 없으니 암호블롭 그대로 격리하고 넘어간다.
        // 다만 연속으로 계속 실패하면 문구 자체가 틀린 것이므로 그때는 멈춘다
        // (전부 격리한 채 ack 해서 서버에서 지워 버리는 게 최악이다).
        if (++decryptFails >= MAX_DECRYPT_FAILS) {
          fatal(`복호화가 연속 ${MAX_DECRYPT_FAILS}건 실패 — 패스프레이즈가 상대와 다릅니다. 중단합니다.`);
        }
        try {
          const saved = await store.quarantine(entry);
          log(`⚠ seq ${entry.seq} 복호화 실패 — 암호문 그대로 보관: undecryptable/${saved}`);
        } catch (qe) {
          log("⏳ 격리 보관 재시도:", entry.seq, String(qe?.message || qe));
          keepGoing = false; // 사진 다운로드 실패 등 — ack 하지 않고 다음 기회에
        }
      } else {
        log("⏳ 보존 재시도:", entry.seq, String(e?.message || e));
        keepGoing = false; // 커서 전진 안 함 → ack 안 함 → 서버 유지
      }
    }
    if (!keepGoing) break;
    queue.shift();
    cursor = entry.seq;
    atomicWrite(cursorPath, String(cursor));
    scheduleAck();
  }
  draining = false;
  if (queue.length && queue[0].seq > cursor + 1) setTimeout(drain, 3000); // 빠진 항목 대기 후 재시도
}

// 백필이 끝나면 "서버가 가진 건 다 보냈다"는 뜻이다. 이후로는 커서와 큐 사이의
// 빈 번호를 기다릴 이유가 없다(drain 이 알아서 건너뛴다). 이 표시가 없으면
// ackSeq>0 인 방에 새 싱크를 붙였을 때(=처음 설치할 때) 큐만 쌓인 채 3초마다
// 재시도하며 한 건도 저장하지 못하고 영원히 멈춘다. 실제로 그랬다.
function markBackfilled() {
  backfilled = true;
  drain();
}

function scheduleAck() {
  if (ackTimer) return;
  ackTimer = setTimeout(() => {
    ackTimer = null;
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "ack", seq: cursor }));
  }, 800);
}

// 캘린더 저장. 문구가 다르면(복호화 실패) 대화와 같은 이유로 즉시 멈춘다 —
// 그 외 오류는 로그만 남기고 넘어간다(대화·사진 보존이 더 중요하다).
function saveCal(entries, note) {
  store.persistCalendar(entries).then((count) => {
    if (note) log(note, `(총 ${count}건 보관)`);
  }).catch((e) => {
    if (e?.name === "OperationError" || /decrypt/i.test(String(e))) {
      fatal("캘린더 복호화 실패 — 패스프레이즈가 상대와 다릅니다.");
    }
    log("캘린더 저장 실패:", String(e?.message || e));
  });
}

// ── WebSocket 접속 루프 ──────────────────────────────────────
let backoff = 1000;
// 감시견 — 끊긴 뒤 다시 붙으려던 소켓이 열리지도 닫히지도 않고 멈춘 적이 있다(2026-10-27 18:35, 2시간 반 동안
// 당이도 백업도 멈춤. 같은 날 22:21 재부팅 직후에도). Node 22 의 WebSocket 은 **접속에 실패하면 error 만 내고
// close 는 끝내 안 낸다**(readyState 가 0, close() 를 부르면 2 에 멈춘다) — close 만 기다리던 재연결이 영영
// 안 왔다. 그래서 error 에서도 다시 붙고, 30초 넘게 열려 있지 않거나 열린 채 2분 동안 아무것도(서버는 30초마다
// ping) 안 오면 그 소켓을 버리고 새로 붙는다. retry 는 소켓마다 한 번만 돈다.
// 시계는 performance.now()(단조) — 부팅 직후 시각 맞추기로 Date.now() 가 뒤로 뛰면 감시견이 잠든다.
const CONNECT_TIMEOUT_MS = 30_000, SILENT_MS = 120_000;
const mono = () => performance.now();
let lastHeard = 0, openedAt = 0;
setInterval(() => {
  const ws = socket;
  if (!ws) return;
  const stuck = ws.readyState !== 1 && mono() - openedAt > CONNECT_TIMEOUT_MS;
  const silent = ws.readyState === 1 && mono() - lastHeard > SILENT_MS;
  if (!stuck && !silent) return;
  if (ws.__retried) return; // 이미 다시 붙는 중(다음 소켓이 곧 socket 이 된다)
  log(stuck ? "접속이 30초 넘게 안 열림 — 새로 붙음" : "2분 동안 서버 소식 없음 — 새로 붙음");
  ws.__retry?.();
  try { ws.close(); } catch { /* 이미 닫힘 */ }
}, 15_000);

function connect() {
  const wsUrl = `${cfg.url.replace(/^http/, "ws")}/_duri?token=${encodeURIComponent(cfg.token)}`;
  const ws = new WebSocket(wsUrl);
  socket = ws;
  openedAt = lastHeard = mono();
  let retried = false;
  ws.__retry = () => {
    if (retried) return;
    retried = ws.__retried = true;
    log("연결 끊김. 재연결", backoff, "ms 후");
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };
  ws.addEventListener("open", () => {
    backoff = 1000;
    backfilled = false; // 재연결마다 다시 백필을 받는다
    log("접속됨. 커서", cursor, "이후 수신");
    ws.send(JSON.stringify({ type: "hello", since: cursor }));
    ws.send(JSON.stringify({ type: "cal-hello" })); // 공유 캘린더 전체 상태도 받는다
  });
  ws.addEventListener("message", (e) => {
    lastHeard = mono();
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
    if (m.type === "entry") { enqueue({ ...m, live: backfilled }); return; }
    // more 가 true 면 서버가 앞 구간을 잘라 보낸 것이다. 그 상태로 백필 완료로 보면
    // drain 이 빈 번호를 "없는 항목"으로 건너뛰고 ack 해서 받지 못한 앞 구간이 지워진다.
    // 그래서 앞 구간을 끝까지 더 받아 온 뒤에만 완료로 본다.
    if (m.type === "backfill-done" || m.type === "older-done") {
      if (m.more && Number.isInteger(m.oldest)) {
        ws.send(JSON.stringify({ type: "fetch-older", before: m.oldest }));
        return;
      }
      log("백필 완료. head", m.head ?? "");
      markBackfilled();
      return;
    }
    if (m.type === "welcome") { log("welcome. head", m.head); return; }
    // 캘린더는 ack 이 없다(서버가 계속 들고 있는 지속 상태다). 실패해도 대화·사진
    // 보존을 막으면 안 되므로 커서와 분리해 여기서 삼키고 로그만 남긴다.
    if (m.type === "cal-state") { saveCal(m.events, `캘린더 ${m.events?.length ?? 0}건 동기화`); return; }
    if (m.type === "cal-put") { saveCal([m]); return; }
    if (m.type === "cal-del") { saveCal([{ id: m.id, rev: m.rev, deleted: true }]); return; }
    if (m.type === "error") { log("서버 오류:", m.error); return; }
  });
  ws.addEventListener("close", () => ws.__retry());
  ws.addEventListener("error", () => { ws.__retry(); try { ws.close(); } catch { /* 이미 닫힘 */ } });
}

// ── 일정 비서 → 서버로 보내기 ────────────────────────────────
// 일정은 웹앱(calSaveEvent)과 같은 평문 구조를 같은 키로 암호화해 cal-put 한다.
// 서버는 보낸 연결에는 되돌려 주지 않으므로 로컬 백업(events.json)도 여기서 바로 고친다.
let assistant = null;
function sendFrame(frame) {
  if (socket?.readyState !== 1) throw new Error("서버와 연결이 끊겨 있음");
  socket.send(JSON.stringify(frame));
}
// 서버는 연결마다 10초에 30프레임까지만 받는다(_infra/duri.js FLOOD_LIMIT). 당이가 반복 일정을
// 한꺼번에 넣을 때 넘지 않게 많으면 사이를 띄운다(25개/10초).
const PACE_MS = 400;
async function assistantApply({ puts, dels }) {
  const local = [];
  const pace = puts.length + dels.length > 10;
  for (const { id, rev, content } of puts) {
    if (pace && local.length) await new Promise((r) => setTimeout(r, PACE_MS));
    const f = await encryptJson(key, content);
    sendFrame({ type: "cal-put", id, iv: f.iv, ct: f.ct, rev });
    local.push({ id, rev, iv: f.iv, ct: f.ct });
  }
  for (const { id, rev } of dels) {
    sendFrame({ type: "cal-del", id, rev });
    local.push({ id, rev, deleted: true });
  }
  saveCal(local);
}
// ── 옛 사진 빌려주기 ─────────────────────────────────────────
// 폰은 최근 MAX_CACHE(2000) 항목만 들고 있고(duri/index.html), 그마저 기기마다 다르다(새 폰·지운 캐시·
// 앱을 깔기 전 사진). seq 만 보고는 그 폰에 있는지 알 수 없어서 — "2000 안쪽이면 있겠지" 로 빼먹었다가 사진이
// 하나도 안 뜬 적이 있다(2026-10-27) — 당이가 보여 주는 사진은 **전부** PC 원본을 같은 문구로 암호화해 서버에
// 7일 맡기고(/_duri/lend, 채팅 버퍼 밖이라 백업·지도에 안 겹친다) 열쇠를 싣는다. 앱은 캐시에 있으면 그걸 쓴다.
const LEND_MAX_BYTES = 25 * 1024 * 1024; // 동영상 같은 큰 원본은 빌려주지 않는다(서버 상한보다 훨씬 작게)
async function lendPhotos(seqs) {
  const out = [];
  for (const seq of seqs) {
    const f = archive?.photoFile(seq);
    if (!f) continue;
    try {
      const bytes = readFileSync(f.path);
      if (bytes.length > LEND_MAX_BYTES) continue;
      const { iv, ct } = await encryptBytes(key, bytes);
      const res = await fetch(`${cfg.url}/_duri/lend`, {
        method: "POST", body: ct,
        headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/octet-stream" },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { key: lendKey } = await res.json();
      out.push({ seq, key: lendKey, iv, ...(f.mime && { mime: f.mime }) });
    } catch (e) { log("당이: 옛 사진 빌려주기 실패", String(e?.message || e)); }
  }
  if (out.length) log(`당이: 옛 사진 ${out.length}장 빌려줌(7일)`);
  return out;
}

// sticker: 다그당스 이모티콘 {pack,n}(선택) — 글과 같은 메시지에 botSticker 로 싣는다.
async function assistantSay(text, sticker, photos) {
  const lend = photos?.length ? await lendPhotos(photos) : [];
  const f = await encryptJson(key, { name: BOT_NAME, text, at: Date.now(), sys: true, ...(sticker && { botSticker: sticker }),
    ...(photos?.length && { botPhotos: photos }), // 사진은 seq — 앱이 자기 캐시에서 꺼내 그린다
    ...(lend.length && { botLend: lend }) }); // 캐시에 없을 옛 사진은 빌려준 열쇠로
  try { sendFrame({ type: "msg", ...f }); } catch (e) { log("당이 답 전송 실패:", String(e?.message || e)); }
}

// ── 아침 브리핑 ──────────────────────────────────────────────
// 1분마다 시각을 보고, 그날(KST) 아직 안 했으면 당이가 일정 브리핑을 채팅에 올린다.
// 마지막으로 한 날짜를 설치 폴더에 남겨 데몬을 다시 띄워도 두 번 하지 않는다. 서버에
// 실제로 보낸 뒤에만 남긴다 — 연결이 끊겨 있으면 다음 분에 다시 한다. 보낸 뒤 서버에
// "brief-done" 을 알려 08:10 의 "📅 캘린더" 리마인드(fallback)를 건너뛰게 한다.
const briefPath = join(HERE, ".dangi-brief");
let briefLast = (() => { try { return readFileSync(briefPath, "utf8").trim(); } catch { return ""; } })();
let briefBusy = false;
async function briefTick() {
  if (briefBusy || !briefDue(Date.now(), briefLast, cfg.assistant.briefing) || socket?.readyState !== 1) return;
  briefBusy = true;
  try {
    const day = kstYmd(Date.now()), text = await assistant.brief();
    const f = await encryptJson(key, { name: BOT_NAME, text, at: Date.now(), sys: true });
    sendFrame({ type: "msg", ...f });
    sendFrame({ type: "brief-done", date: day });
    briefLast = day;
    atomicWrite(briefPath, day);
  } catch (e) {
    log("아침 브리핑 실패(다음 분에 다시):", String(e?.message || e));
  } finally { briefBusy = false; }
}

// ── 사진 설명 달기 ───────────────────────────────────────────
// 모델 서버에 비전(mmproj)이 켜져 있으면, 당이가 10분 넘게 한가할 때 30초마다 사진 한 장씩 보고 설명을
// captions.json 에 남긴다(captions.mjs). 당이가 사진을 찾을 땐 그 글만 읽는다 — 묻는 순간엔 비전을 안 쓴다.
async function startCaptions() {
  if (cfg.assistant.api !== "llama" || cfg.assistant.captions === false) return;
  try {
    const props = await (await fetch(`${cfg.assistant.llama}/props`, { signal: AbortSignal.timeout(10_000) })).json();
    if (!props?.modalities?.vision) { log("사진 설명: 모델 서버에 비전이 없어 끔(--mmproj)"); return; }
  } catch { setTimeout(startCaptions, 5 * 60_000); return; } // 모델 서버가 아직 안 떴다 — 나중에 다시
  const captioner = createCaptioner({ dir: cfg.dir, list: () => archive.photoFiles(), see: llamaAsk({ url: cfg.assistant.llama, timeoutMs: 120_000 }), log });
  let reported = false;
  setInterval(() => {
    assistant.idle(() => captioner.step()).then((did) => {
      if (did) reported = false;
      else if (!reported && captioner.left() === 0) { reported = true; log("사진 설명: 다 달았음"); }
    }).catch((e) => log("사진 설명 오류:", String(e?.message || e)));
  }, 30_000);
  log(`사진 설명 켜짐 — 남은 사진 ${captioner.left()}장, 당이가 10분 한가할 때 한 장씩`);
}

// ── 시작 ─────────────────────────────────────────────────────
const key = await deriveKey(cfg.passphrase);
store = createStore({ dir: cfg.dir, key, fetchPhoto: downloadPhoto });
if (cfg.assistant.enabled) {
  // 당이 자신의 답과 "@당이 …" 명령은 근거에서 뺀다. 사진 좌표는 앱 지도와 같은 geojson 으로 지역 이름이 된다.
  archive = createArchive(cfg.dir, { skip: (name, text) => name === BOT_NAME || parseTrigger(text) !== null, place: createPlaces() });
  assistant = createAssistant({
    ask: cfg.assistant.api === "llama"
      ? llamaAsk({ url: cfg.assistant.llama })
      : ollamaAsk({ url: cfg.assistant.ollama, model: cfg.assistant.model, keepAlive: cfg.assistant.keepAlive }),
    events: () => store.calendarEvents(),
    apply: assistantApply,
    say: assistantSay,
    archive, // 당이가 지난 대화를 찾아 읽는 백업 — 읽기 전용(archive.mjs 엔 쓰는 함수가 없다)
    log,
  });
  log(`일정 비서 당이 켜짐 — ${cfg.assistant.api === "llama" ? `llama-server @ ${cfg.assistant.llama}` : `${cfg.assistant.model} @ ${cfg.assistant.ollama}`} (채팅에서 "@당이 …")`);
  if (cfg.assistant.briefing !== "off") {
    setInterval(briefTick, 60_000);
    log(`아침 브리핑 매일 ${cfg.assistant.briefing} KST`);
  }
  startCaptions();
}
mkdirSync(cfg.dir, { recursive: true });
log(`Duri 싱크 시작 — 저장 위치: ${cfg.dir}`);
connect();
