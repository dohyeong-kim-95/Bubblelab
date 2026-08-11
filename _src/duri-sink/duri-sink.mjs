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
import { deriveKey, createStore, atomicWrite } from "./store.mjs";

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
let store, cursor = loadCursor();
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
      await store.persist(entry);
      decryptFails = 0;
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
function connect() {
  const wsUrl = `${cfg.url.replace(/^http/, "ws")}/_duri?token=${encodeURIComponent(cfg.token)}`;
  const ws = new WebSocket(wsUrl);
  socket = ws;
  ws.addEventListener("open", () => {
    backoff = 1000;
    backfilled = false; // 재연결마다 다시 백필을 받는다
    log("접속됨. 커서", cursor, "이후 수신");
    ws.send(JSON.stringify({ type: "hello", since: cursor }));
    ws.send(JSON.stringify({ type: "cal-hello" })); // 공유 캘린더 전체 상태도 받는다
  });
  ws.addEventListener("message", (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
    if (m.type === "entry") { enqueue(m); return; }
    if (m.type === "backfill-done") { log("백필 완료. head", m.head); markBackfilled(); return; }
    if (m.type === "welcome") { log("welcome. head", m.head); return; }
    // 캘린더는 ack 이 없다(서버가 계속 들고 있는 지속 상태다). 실패해도 대화·사진
    // 보존을 막으면 안 되므로 커서와 분리해 여기서 삼키고 로그만 남긴다.
    if (m.type === "cal-state") { saveCal(m.events, `캘린더 ${m.events?.length ?? 0}건 동기화`); return; }
    if (m.type === "cal-put") { saveCal([m]); return; }
    if (m.type === "cal-del") { saveCal([{ id: m.id, rev: m.rev, deleted: true }]); return; }
    if (m.type === "error") { log("서버 오류:", m.error); return; }
  });
  ws.addEventListener("close", () => {
    log("연결 끊김. 재연결", backoff, "ms 후");
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
  ws.addEventListener("error", () => { try { ws.close(); } catch { /* 이미 닫힘 */ } });
}

// ── 시작 ─────────────────────────────────────────────────────
const key = await deriveKey(cfg.passphrase);
store = createStore({ dir: cfg.dir, key, fetchPhoto: downloadPhoto });
mkdirSync(cfg.dir, { recursive: true });
log(`Duri 싱크 시작 — 저장 위치: ${cfg.dir}`);
connect();
